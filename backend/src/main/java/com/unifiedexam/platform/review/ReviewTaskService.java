package com.unifiedexam.platform.review;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.Map;

/** 管理跨模块复习任务；创建时固定班级学生、来源作答和题目。 */
@Service
public class ReviewTaskService {
    private static final Set<String> TYPES = Set.of("SAT", "PSAT", "SHSAT");
    private final JdbcTemplate jdbc;
    private final ReviewSourceRepository sources;

    public ReviewTaskService(JdbcTemplate jdbc, ReviewSourceRepository sources) {
        this.jdbc = jdbc;
        this.sources = sources;
    }

    @Transactional
    public long create(String type, CreateTask request, String username) {
        if (!TYPES.contains(type)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select a valid exam system.");
        if (request.startAt() == null || request.endAt() == null || !request.endAt().isAfter(request.startAt()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The end time must be after the start time.");
        if (request.title() == null || request.title().isBlank() || request.title().length() > 200
                || (request.description() != null && request.description().length() > 1000))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a valid task title and description.");
        Boolean matches = jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM exams e JOIN papers p ON p.id = e.paper_id
              JOIN classes c ON c.id = ? AND c.status = 'ACTIVE'
              JOIN class_exam_workspaces cw ON cw.class_id = c.id AND cw.exam_type_code = p.exam_type_code
              WHERE e.id = ? AND p.exam_type_code = ? AND e.status IN ('PUBLISHED', 'CLOSED')
                AND NOT EXISTS (SELECT 1 FROM exam_excluded_classes x WHERE x.exam_id = e.id AND x.class_id = c.id)
                AND (EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = e.id AND tc.class_id = c.id)
                  OR EXISTS (SELECT 1 FROM exam_target_student_classes st WHERE st.exam_id = e.id AND st.class_id = c.id)
                  OR EXISTS (SELECT 1 FROM attempts a JOIN attempt_classes ac ON ac.attempt_id = a.id
                             WHERE a.exam_id = e.id AND ac.class_id = c.id)))
            """, Boolean.class, request.classId(), request.examId(), type);
        if (!Boolean.TRUE.equals(matches)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Exam or class not found.");
        Long actorId = jdbc.query("SELECT id FROM users WHERE username = ? AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        if (actorId == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "User not found.");

        long taskId = insertTask(type, request, actorId);
        List<Long> students = jdbc.query("""
            SELECT cm.student_user_id FROM class_memberships cm
            JOIN users u ON u.id = cm.student_user_id AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
            JOIN exam_types et ON et.code = ?
            JOIN user_workspace_access access ON access.user_id = u.id AND access.workspace_code = et.workspace_code
            WHERE cm.class_id = ? AND cm.left_at IS NULL ORDER BY cm.student_user_id
            """, (rs, row) -> rs.getLong(1), type, request.classId());
        Map<Long, Long> sourceAttempts = sources.findLatestAttempts(request.examId(), request.classId());
        List<Long> selectedAttempts = students.stream().map(sourceAttempts::get).filter(java.util.Objects::nonNull).toList();
        Map<Long, List<ReviewSourceRepository.SourceItem>> reviewItems = sources.findReviewItemsByAttempt(selectedAttempts);
        for (long studentId : students) {
            Long sourceId = sourceAttempts.get(studentId);
            List<ReviewSourceRepository.SourceItem> items = sourceId == null ? List.of() : reviewItems.getOrDefault(sourceId, List.of());
            String status = sourceId == null ? "NO_SOURCE_ATTEMPT" : items.isEmpty() ? "NO_WRONG_ANSWERS" : "NOT_STARTED";
            long assignmentId = insertAssignment(taskId, studentId, sourceId, status);
            for (int i = 0; i < items.size(); i++) {
                jdbc.update("INSERT INTO review_assignment_items (assignment_id, paper_item_id, sort_order) VALUES (?, ?, ?)",
                    assignmentId, items.get(i).paperItemId(), i);
            }
        }
        return taskId;
    }

    private long insertTask(String type, CreateTask request, long actorId) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement sql = connection.prepareStatement("""
                INSERT INTO review_tasks (exam_type_code, exam_id, class_id, title, description, starts_at, ends_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
            sql.setString(1, type); sql.setLong(2, request.examId()); sql.setLong(3, request.classId());
            sql.setString(4, request.title().trim()); sql.setString(5, request.description());
            sql.setTimestamp(6, Timestamp.valueOf(request.startAt())); sql.setTimestamp(7, Timestamp.valueOf(request.endAt()));
            sql.setLong(8, actorId);
            return sql;
        }, keys);
        return keys.getKey().longValue();
    }

    private long insertAssignment(long taskId, long studentId, Long sourceId, String status) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement sql = connection.prepareStatement("""
                INSERT INTO review_assignments (task_id, student_user_id, source_attempt_id, status) VALUES (?, ?, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
            sql.setLong(1, taskId); sql.setLong(2, studentId); sql.setObject(3, sourceId); sql.setString(4, status);
            return sql;
        }, keys);
        return keys.getKey().longValue();
    }

    /** 列表只读取指定考试模块，过期任务按结束状态展示。 */
    public List<TaskView> list(String type) {
        return queryTasks(type, null);
    }

    private List<TaskView> queryTasks(String type, Long taskId) {
        requireType(type);
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        return jdbc.query("""
            SELECT t.id, t.exam_id, e.title AS exam_title, t.class_id, c.name AS class_name,
                   t.title, t.description, t.starts_at, t.ends_at, t.status,
                   COUNT(a.id) AS assigned_count,
                   SUM(CASE WHEN a.status IN ('NO_SOURCE_ATTEMPT', 'NO_WRONG_ANSWERS') THEN 1 ELSE 0 END) AS ineligible_count,
                   SUM(CASE WHEN a.status = 'NO_SOURCE_ATTEMPT' THEN 1 ELSE 0 END) AS no_source_count,
                   SUM(CASE WHEN a.status = 'NO_WRONG_ANSWERS' THEN 1 ELSE 0 END) AS no_wrong_count,
                   SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_count,
                   SUM(CASE WHEN a.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count,
                   SUM(CASE WHEN a.status = 'NOT_STARTED' THEN 1 ELSE 0 END) AS not_started_count,
                   SUM(CASE WHEN a.status = 'RETRY_REQUIRED' THEN 1 ELSE 0 END) AS retry_count,
                   SUM(CASE WHEN a.status = 'ENDED' THEN 1 ELSE 0 END) AS ended_count
            FROM review_tasks t JOIN exams e ON e.id = t.exam_id JOIN classes c ON c.id = t.class_id
            LEFT JOIN review_assignments a ON a.task_id = t.id
            WHERE t.exam_type_code = ?
            """ + (taskId == null ? "" : " AND t.id = ?") + " GROUP BY t.id ORDER BY t.created_at DESC, t.id DESC",
            (rs, row) -> {
                LocalDateTime end = rs.getTimestamp("ends_at").toLocalDateTime();
                String status = "ENDED".equals(rs.getString("status")) || !end.isAfter(now) ? "ENDED" : "PUBLISHED";
                int pending = rs.getInt("not_started_count"), retry = rs.getInt("retry_count");
                int ended = rs.getInt("ended_count");
                if ("ENDED".equals(status)) { ended += pending + retry; pending = 0; retry = 0; }
                return new TaskView(rs.getLong("id"), rs.getLong("exam_id"), rs.getString("exam_title"),
                    rs.getLong("class_id"), rs.getString("class_name"), rs.getString("title"),
                    rs.getString("description"), rs.getTimestamp("starts_at").toLocalDateTime(), end, status,
                    rs.getInt("assigned_count"), rs.getInt("assigned_count") - rs.getInt("ineligible_count"),
                    rs.getInt("completed_count"), rs.getInt("in_progress_count"),
                    pending, retry, ended,
                    rs.getInt("no_source_count"), rs.getInt("no_wrong_count"));
            }, taskId == null ? new Object[] { type } : new Object[] { type, taskId });
    }

    /** 详情以分配记录为范围统计题目，不按题号合并。 */
    public TaskDetail detail(String type, long taskId) {
        TaskView task = findTask(type, taskId);
        var assignments = jdbc.query("""
            SELECT a.id, a.student_user_id, u.real_name, a.status,
                   (SELECT r.attempt_id FROM review_practice_rounds r JOIN attempts p ON p.id = r.attempt_id
                    WHERE r.assignment_id = a.id AND p.status = 'SUBMITTED' ORDER BY r.id DESC LIMIT 1) AS latest_attempt,
                   COUNT(i.paper_item_id) AS total_count,
                   SUM(CASE WHEN i.cleared_at IS NOT NULL THEN 1 ELSE 0 END) AS cleared_count
            FROM review_assignments a JOIN users u ON u.id = a.student_user_id
            LEFT JOIN review_assignment_items i ON i.assignment_id = a.id
            WHERE a.task_id = ? GROUP BY a.id ORDER BY u.real_name, u.id
            """, (rs, row) -> {
                int total = rs.getInt("total_count"), cleared = rs.getInt("cleared_count");
                String status = rs.getString("status");
                if ("ENDED".equals(task.status()) && ("NOT_STARTED".equals(status) || "RETRY_REQUIRED".equals(status))) status = "ENDED";
                return new AssignmentView(rs.getLong("id"), rs.getLong("student_user_id"), rs.getString("real_name"),
                    status, total, cleared, Math.max(0, total - cleared),
                    rs.getObject("latest_attempt") == null ? null : rs.getLong("latest_attempt"));
            }, taskId);
        return new TaskDetail(task, assignments);
    }

    /** 提前结束时保留正在进行的练习，未开始和待重试的任务不再开放。 */
    @Transactional
    public TaskView end(String type, long taskId) {
        requireType(type);
        int changed = jdbc.update("UPDATE review_tasks SET status = 'ENDED' WHERE id = ? AND exam_type_code = ?", taskId, type);
        if (changed == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Review assignment not found.");
        jdbc.update("UPDATE review_assignments SET status = 'ENDED' WHERE task_id = ? AND status IN ('NOT_STARTED','RETRY_REQUIRED')", taskId);
        return findTask(type, taskId);
    }

    private TaskView findTask(String type, long taskId) {
        return queryTasks(type, taskId).stream().findFirst()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Review assignment not found."));
    }

    private void requireType(String type) {
        if (!TYPES.contains(type)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select a valid exam system.");
    }

    public record CreateTask(long examId, long classId, String title, String description,
                             LocalDateTime startAt, LocalDateTime endAt) { }
    public record TaskView(long id, long examId, String examTitle, long classId, String className, String title,
                           String description, LocalDateTime startAt, LocalDateTime endAt, String status,
                           int assignedCount, int eligibleCount, int completedCount, int inProgressCount,
                           int notStartedCount, int retryRequiredCount, int endedCount,
                           int noSourceAttemptCount, int noWrongAnswerCount) { }
    public record AssignmentView(long id, long studentId, String studentName, String status,
                                 int questionCount, int clearedCount, int remainingCount, Long latestAttemptId) { }
    public record TaskDetail(TaskView task, List<AssignmentView> assignments) { }
}
