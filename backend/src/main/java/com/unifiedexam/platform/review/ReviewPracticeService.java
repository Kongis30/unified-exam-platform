package com.unifiedexam.platform.review;

import com.unifiedexam.platform.attempt.StudentAttemptService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;

/** 学生复习入口；每轮使用独立 practice attempt 保存答案及判分。 */
@Service
public class ReviewPracticeService {
    private static final Set<String> SUPPORTED = Set.of("SAT", "PSAT");
    private final JdbcTemplate jdbc;
    private final StudentAttemptService attempts;

    public ReviewPracticeService(JdbcTemplate jdbc, StudentAttemptService attempts) {
        this.jdbc = jdbc;
        this.attempts = attempts;
    }

    public List<StudentAssignment> list(String type, String username) {
        requireType(type);
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        return jdbc.query("""
            SELECT a.id, t.id AS task_id, t.exam_id, t.title, t.description, e.title AS exam_title, t.starts_at, t.ends_at,
                   t.status AS task_status, a.status, COUNT(i.paper_item_id) AS total,
                   SUM(CASE WHEN i.cleared_at IS NOT NULL THEN 1 ELSE 0 END) AS cleared,
                   (SELECT r.attempt_id FROM review_practice_rounds r JOIN attempts p ON p.id = r.attempt_id
                    WHERE r.assignment_id = a.id AND p.status = 'IN_PROGRESS' ORDER BY r.id DESC LIMIT 1) AS active_attempt,
                   (SELECT r.attempt_id FROM review_practice_rounds r JOIN attempts p ON p.id = r.attempt_id
                    WHERE r.assignment_id = a.id AND p.status = 'SUBMITTED' ORDER BY r.id DESC LIMIT 1) AS latest_attempt
            FROM review_assignments a JOIN review_tasks t ON t.id = a.task_id JOIN exams e ON e.id = t.exam_id
            JOIN users u ON u.id = a.student_user_id
            LEFT JOIN review_assignment_items i ON i.assignment_id = a.id
            WHERE u.username = ? AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE' AND t.exam_type_code = ?
              AND a.status NOT IN ('NO_SOURCE_ATTEMPT', 'NO_WRONG_ANSWERS')
            GROUP BY a.id ORDER BY t.created_at DESC, t.id DESC
            """, (rs, row) -> {
                LocalDateTime start = rs.getTimestamp("starts_at").toLocalDateTime();
                LocalDateTime end = rs.getTimestamp("ends_at").toLocalDateTime();
                int total = rs.getInt("total"), cleared = rs.getInt("cleared");
                Long activeAttempt = rs.getObject("active_attempt") == null ? null : rs.getLong("active_attempt");
                boolean available = "PUBLISHED".equals(rs.getString("task_status")) && !now.isBefore(start) && now.isBefore(end);
                String status = rs.getString("status");
                if (!available && activeAttempt == null && ("ENDED".equals(rs.getString("task_status")) || !now.isBefore(end))
                        && ("NOT_STARTED".equals(status) || "RETRY_REQUIRED".equals(status))) status = "ENDED";
                return new StudentAssignment(rs.getLong("id"), rs.getLong("task_id"), rs.getLong("exam_id"), rs.getString("title"),
                    rs.getString("description"), rs.getString("exam_title"), start, end, status, total, cleared, Math.max(0, total - cleared),
                    activeAttempt, rs.getObject("latest_attempt") == null ? null : rs.getLong("latest_attempt"), activeAttempt != null || (available && total > cleared));
            }, username, type);
    }

    /** 串行锁定任务，避免重复创建练习；允许任务关闭后续做已开始的一轮。 */
    @Transactional
    public StudentAttemptService.AttemptView start(String type, long assignmentId, String username) {
        requireType(type);
        var row = jdbc.query("""
            SELECT a.id, a.student_user_id, a.status, t.exam_id, t.status AS task_status, t.starts_at, t.ends_at,
                   COALESCE(e.duration_seconds, p.default_duration_seconds) AS duration_seconds
            FROM review_assignments a JOIN review_tasks t ON t.id = a.task_id
            JOIN exams e ON e.id = t.exam_id JOIN papers p ON p.id = e.paper_id
            JOIN users u ON u.id = a.student_user_id
            WHERE a.id = ? AND t.exam_type_code = ? AND u.username = ? AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
            FOR UPDATE
            """, rs -> rs.next() ? new StartRow(rs.getLong("student_user_id"), rs.getLong("exam_id"),
            rs.getString("status"), rs.getString("task_status"), rs.getTimestamp("starts_at").toLocalDateTime(),
            rs.getTimestamp("ends_at").toLocalDateTime(), (Integer) rs.getObject("duration_seconds")) : null,
            assignmentId, type, username);
        if (row == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Review assignment not found.");
        Long active = jdbc.query("""
            SELECT p.id FROM review_practice_rounds r JOIN attempts p ON p.id = r.attempt_id
            WHERE r.assignment_id = ? AND p.status = 'IN_PROGRESS' ORDER BY r.id DESC LIMIT 1
            """, rs -> rs.next() ? rs.getLong(1) : null, assignmentId);
        if (active != null) return attempts.get(active, username);
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        if (!"PUBLISHED".equals(row.taskStatus()) || now.isBefore(row.startAt()) || !now.isBefore(row.endAt())
                || !Set.of("NOT_STARTED", "RETRY_REQUIRED").contains(row.status()))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This review assignment is not currently available.");
        List<Long> items = jdbc.query("SELECT paper_item_id FROM review_assignment_items WHERE assignment_id = ? AND cleared_at IS NULL ORDER BY sort_order",
            (rs, index) -> rs.getLong(1), assignmentId);
        if (items.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT, "All assigned questions have been answered correctly.");
        // 同一学生可并发启动同场考试的不同任务；锁住考试后再分配作答序号。
        jdbc.queryForObject("SELECT id FROM exams WHERE id = ? FOR UPDATE", Long.class, row.examId());
        jdbc.update("INSERT IGNORE INTO exam_participants (exam_id, student_user_id) VALUES (?, ?)", row.examId(), row.studentId());
        int attemptNo = jdbc.queryForObject("SELECT COALESCE(MAX(attempt_no), 0) + 1 FROM attempts WHERE exam_id = ? AND student_user_id = ?",
            Integer.class, row.examId(), row.studentId());
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement sql = connection.prepareStatement("""
                INSERT INTO attempts (exam_id, student_user_id, attempt_no, is_practice, started_at, expires_at)
                VALUES (?, ?, ?, TRUE, CURRENT_TIMESTAMP(6),
                        CASE WHEN ? IS NULL THEN NULL ELSE TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(6)) END)
                """, Statement.RETURN_GENERATED_KEYS);
            sql.setLong(1, row.examId()); sql.setLong(2, row.studentId()); sql.setInt(3, attemptNo);
            sql.setObject(4, row.duration()); sql.setObject(5, row.duration());
            return sql;
        }, keys);
        long attemptId = keys.getKey().longValue();
        for (int i = 0; i < items.size(); i++) jdbc.update(
            "INSERT INTO attempt_items (attempt_id, paper_item_id, served_order) VALUES (?, ?, ?)", attemptId, items.get(i), i + 1);
        jdbc.update("INSERT INTO review_practice_rounds (assignment_id, attempt_id) VALUES (?, ?)", assignmentId, attemptId);
        jdbc.update("UPDATE review_assignments SET status = 'IN_PROGRESS' WHERE id = ?", assignmentId);
        return attempts.get(attemptId, username);
    }

    private void requireType(String type) {
        if (!SUPPORTED.contains(type)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select a valid exam system.");
    }

    private record StartRow(long studentId, long examId, String status, String taskStatus,
                            LocalDateTime startAt, LocalDateTime endAt, Integer duration) { }
    public record StudentAssignment(long id, long taskId, long examId, String title, String description, String examTitle, LocalDateTime startAt,
                                    LocalDateTime endAt, String status, int questionCount, int clearedCount,
                                    int remainingCount, Long activeAttemptId, Long latestAttemptId, boolean canStart) { }
}
