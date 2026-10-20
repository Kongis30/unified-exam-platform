package com.unifiedexam.platform.examtype.shsat.admin;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.attempt.StudentAttemptService;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.List;
import java.util.ArrayList;
import java.util.Set;
import java.util.HashSet;

/** SHSAT 错题任务只引用平台统一考试、班级、学生与作答数据。 */
@Service
public class ShsatWrongAnswerTaskService {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final StudentAttemptService attemptService;

    public ShsatWrongAnswerTaskService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper,
                                       StudentAttemptService attemptService) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.attemptService = attemptService;
    }

    public List<TaskView> list(Long examId, Long classId) {
        if ((examId == null) != (classId == null)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "examId and classId must be provided together.");
        }
        String filter = examId == null ? "" : " WHERE t.exam_id = ? AND t.class_id = ?";
        Object[] parameters = examId == null ? new Object[0] : new Object[]{examId, classId};
        return jdbcTemplate.query("""
            SELECT t.id, t.exam_id, e.title AS exam_title, p.title AS paper_name,
                   t.class_id, c.name AS class_name, t.title, t.description,
                   t.starts_at, t.ends_at,
                   CASE WHEN t.status = 'ENDED' OR (t.ends_at IS NOT NULL AND t.ends_at <= CURRENT_TIMESTAMP(6))
                        THEN 'ENDED' ELSE t.status END AS status,
                   t.created_at,
                   COUNT(a.id) AS assigned_count,
                   SUM(CASE WHEN a.status = 'NO_SOURCE_ATTEMPT' THEN 1 ELSE 0 END) AS no_source_count,
                   SUM(CASE WHEN a.status = 'NO_WRONG_ANSWERS' THEN 1 ELSE 0 END) AS no_wrong_count,
                   SUM(CASE WHEN a.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_count,
                   SUM(CASE WHEN a.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count,
                   SUM(CASE WHEN a.status = 'NOT_STARTED' AND t.status = 'PUBLISHED'
                        AND (t.ends_at IS NULL OR t.ends_at > CURRENT_TIMESTAMP(6)) THEN 1 ELSE 0 END) AS not_started_count,
                   SUM(CASE WHEN a.status = 'RETRY_REQUIRED' AND t.status = 'PUBLISHED'
                        AND (t.ends_at IS NULL OR t.ends_at > CURRENT_TIMESTAMP(6)) THEN 1 ELSE 0 END) AS retry_count,
                   SUM(CASE WHEN a.status = 'ENDED' OR ((t.status = 'ENDED' OR
                        (t.ends_at IS NOT NULL AND t.ends_at <= CURRENT_TIMESTAMP(6)))
                        AND a.status IN ('NOT_STARTED', 'RETRY_REQUIRED')) THEN 1 ELSE 0 END) AS ended_count
            FROM shsat_wrong_answer_tasks t
            JOIN exams e ON e.id = t.exam_id
            JOIN papers p ON p.id = e.paper_id
            JOIN classes c ON c.id = t.class_id
            LEFT JOIN shsat_wrong_answer_assignments a ON a.task_id = t.id
            """ + filter + " GROUP BY t.id ORDER BY t.created_at DESC, t.id DESC",
            (rs, rowNum) -> new TaskView(rs.getLong("id"), rs.getLong("exam_id"), rs.getString("exam_title"),
                rs.getString("paper_name"), rs.getLong("class_id"), rs.getString("class_name"),
                rs.getString("title"), rs.getString("description"), localDateTime(rs.getTimestamp("starts_at")),
                localDateTime(rs.getTimestamp("ends_at")), rs.getString("status"), rs.getInt("assigned_count"),
                rs.getInt("assigned_count") - rs.getInt("no_source_count") - rs.getInt("no_wrong_count"),
                rs.getInt("completed_count"), rs.getInt("in_progress_count"), rs.getInt("not_started_count"),
                rs.getInt("retry_count"), rs.getInt("ended_count"), rs.getInt("no_source_count"), rs.getInt("no_wrong_count"),
                localDateTime(rs.getTimestamp("created_at"))), parameters);
    }

    @Transactional
    public TaskView create(CreateTaskRequest request, String username) {
        Long examType = jdbcTemplate.query("""
            SELECT COUNT(*) FROM exams e JOIN papers p ON p.id = e.paper_id
            JOIN classes c ON c.id = ? AND c.status = 'ACTIVE'
            WHERE e.id = ? AND p.exam_type_code = 'SHSAT' AND e.status = 'PUBLISHED'
              AND (e.target_scope = 'ALL_STUDENTS' OR EXISTS (
                  SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = e.id AND tc.class_id = c.id
              ))
            """, rs -> rs.next() ? rs.getLong(1) : 0L, request.classId(), request.examId());
        if (examType == null || examType == 0) throw notFound();
        if (!request.endAt().isAfter(request.startAt())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The task end time must be after its start time.");
        }
        Long userId = jdbcTemplate.query("SELECT id FROM users WHERE username = ?",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        if (userId == null) throw notFound();
        jdbcTemplate.update("""
            INSERT INTO shsat_wrong_answer_tasks
                (exam_id, class_id, title, description, starts_at, ends_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, request.examId(), request.classId(), request.title(), request.description(),
            request.startAt(), request.endAt(), userId);
        Long taskId = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        List<Long> classStudents = jdbcTemplate.query("""
            SELECT cm.student_user_id FROM class_memberships cm
            JOIN users u ON u.id = cm.student_user_id AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
            WHERE cm.class_id = ? AND cm.left_at IS NULL ORDER BY cm.student_user_id
            """, (rs, rowNum) -> rs.getLong(1), request.classId());
        for (Long studentId : classStudents) {
            Long sourceAttemptId = jdbcTemplate.query("""
                SELECT id FROM attempts WHERE exam_id = ? AND student_user_id = ? AND is_practice = FALSE
                    AND status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')
                ORDER BY attempt_no DESC LIMIT 1
                """, rs -> rs.next() ? rs.getLong(1) : null, request.examId(), studentId);
            List<Integer> questionNumbers = sourceAttemptId == null ? List.of() : jdbcTemplate.query("""
                SELECT DISTINCT pi.display_number
                FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
                LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
                WHERE ai.attempt_id = ? AND pi.display_number IS NOT NULL
                  AND (aa.paper_item_id IS NULL OR aa.is_correct IS NULL OR aa.is_correct = FALSE)
                ORDER BY pi.display_number
                """, (rs, rowNum) -> rs.getInt(1), sourceAttemptId);
            String assignmentStatus = sourceAttemptId == null ? "NO_SOURCE_ATTEMPT"
                : questionNumbers.isEmpty() ? "NO_WRONG_ANSWERS" : "NOT_STARTED";
            try {
                jdbcTemplate.update("""
                    INSERT INTO shsat_wrong_answer_assignments
                        (task_id, student_user_id, source_attempt_id, question_numbers_json, status)
                    VALUES (?, ?, ?, CAST(? AS JSON), ?)
                    """, taskId, studentId, sourceAttemptId,
                    objectMapper.writeValueAsString(questionNumbers), assignmentStatus);
            } catch (JsonProcessingException exception) {
                throw new IllegalStateException("Unable to save the task question list.", exception);
            }
        }
        return list(request.examId(), request.classId()).stream().filter(task -> task.taskId() == taskId).findFirst().orElseThrow(this::notFound);
    }

    @Transactional
    public TaskView end(long taskId) {
        int updated = jdbcTemplate.update("UPDATE shsat_wrong_answer_tasks SET status = 'ENDED' WHERE id = ?", taskId);
        if (updated == 0) throw notFound();
        jdbcTemplate.update("""
            UPDATE shsat_wrong_answer_assignments SET status = 'ENDED'
            WHERE task_id = ? AND status IN ('NOT_STARTED', 'RETRY_REQUIRED')
            """, taskId);
        return list(null, null).stream().filter(task -> task.taskId() == taskId).findFirst().orElseThrow(this::notFound);
    }

    public TaskDetail detail(long taskId) {
        TaskView task = list(null, null).stream().filter(value -> value.taskId() == taskId).findFirst().orElseThrow(this::notFound);
        List<AssignmentView> assignments = jdbcTemplate.query("""
            SELECT a.id, a.task_id, a.student_user_id, u.real_name, a.source_attempt_id,
                   a.practice_attempt_id,
                   CASE WHEN (t.status = 'ENDED' OR (t.ends_at IS NOT NULL AND t.ends_at <= CURRENT_TIMESTAMP(6)))
                             AND a.status IN ('NOT_STARTED', 'RETRY_REQUIRED') THEN 'ENDED' ELSE a.status END AS status,
                   JSON_LENGTH(a.question_numbers_json) AS question_count, a.created_at
            FROM shsat_wrong_answer_assignments a
            JOIN users u ON u.id = a.student_user_id
            JOIN shsat_wrong_answer_tasks t ON t.id = a.task_id
            WHERE a.task_id = ? ORDER BY u.real_name, u.id
            """, (rs, rowNum) -> {
                long assignmentId = rs.getLong("id");
                Long practiceAttemptId = nullableLong(rs, "practice_attempt_id");
                int questionCount = rs.getInt("question_count");
                AssignmentMetrics metrics = assignmentMetrics(assignmentId, practiceAttemptId, questionCount);
                return new AssignmentView(assignmentId, rs.getLong("task_id"), rs.getLong("student_user_id"),
                    rs.getString("real_name"), null, nullableLong(rs, "source_attempt_id"), null, practiceAttemptId,
                    rs.getString("status"), questionCount, Math.max(0, questionCount - metrics.cleared()), metrics.cleared(),
                    metrics.roundCount(), metrics.answered(), metrics.correct(), metrics.wrong(), metrics.unanswered(),
                    metrics.accuracy(), localDateTime(rs.getTimestamp("created_at")), metrics.completedAt());
            }, taskId);
        return new TaskDetail(task, assignments);
    }

    /** 学生首页只返回有复习题的本人任务；任务结束后仍保留已开始的练习供继续完成。 */
    public List<StudentTaskView> listForStudent(String username) {
        Long studentId = jdbcTemplate.query("SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT'",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        if (studentId == null) throw notFound();
        return jdbcTemplate.query("""
            SELECT a.id, t.id AS task_id, t.exam_id, e.title AS exam_title, t.title, t.description,
                   t.starts_at, t.ends_at,
                   CASE WHEN t.status = 'ENDED' OR (t.ends_at IS NOT NULL AND t.ends_at <= CURRENT_TIMESTAMP(6))
                        THEN 'ENDED' ELSE t.status END AS task_status, a.status,
                   a.practice_attempt_id, a.question_numbers_json, practice.status AS practice_status,
                   JSON_LENGTH(a.question_numbers_json) AS question_count
            FROM shsat_wrong_answer_assignments a
            JOIN shsat_wrong_answer_tasks t ON t.id = a.task_id
            JOIN exams e ON e.id = t.exam_id
            LEFT JOIN attempts practice ON practice.id = a.practice_attempt_id
            WHERE a.student_user_id = ? AND a.status NOT IN ('NO_SOURCE_ATTEMPT', 'NO_WRONG_ANSWERS')
              AND (t.status = 'PUBLISHED' OR practice.id IS NOT NULL)
            ORDER BY t.created_at DESC, t.id DESC
            """, (rs, rowNum) -> {
                Long practiceId = nullableLong(rs, "practice_attempt_id");
                int count = rs.getInt("question_count");
                int cleared = clearedQuestionNumbers(rs.getLong("id"), rs.getString("question_numbers_json")).size();
                String assignmentStatus = resolveStudentStatus(rs.getString("task_status"), rs.getString("status"),
                    rs.getString("practice_status"), count - cleared);
                boolean inProgress = "IN_PROGRESS".equals(rs.getString("practice_status"));
                return new StudentTaskView(rs.getLong("id"), rs.getLong("task_id"), rs.getLong("exam_id"),
                    rs.getString("exam_title"), rs.getString("title"), rs.getString("description"),
                    localDateTime(rs.getTimestamp("starts_at")), localDateTime(rs.getTimestamp("ends_at")),
                    assignmentStatus,
                    count, cleared, Math.max(0, count - cleared), practiceId,
                    (isTaskAvailable(rs.getString("task_status"), rs.getTimestamp("starts_at"), rs.getTimestamp("ends_at"))
                        && count > cleared) || inProgress);
            }, studentId);
    }

    @Transactional
    public StudentAttemptService.AttemptView startForStudent(long assignmentId, String username) {
        Long studentId = jdbcTemplate.query("SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT'",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        if (studentId == null) throw notFound();
        StudentAssignment assignment = jdbcTemplate.query("""
            SELECT a.id, a.student_user_id, a.status, a.source_attempt_id, a.question_numbers_json,
                   t.status AS task_status, t.starts_at, t.ends_at
            FROM shsat_wrong_answer_assignments a JOIN shsat_wrong_answer_tasks t ON t.id = a.task_id
            WHERE a.id = ? FOR UPDATE
            """, rs -> rs.next() ? new StudentAssignment(rs.getLong("id"), rs.getLong("student_user_id"),
                rs.getString("status"), nullableLong(rs, "source_attempt_id"), rs.getString("question_numbers_json"),
                rs.getString("task_status"), rs.getTimestamp("starts_at"), rs.getTimestamp("ends_at")) : null, assignmentId);
        if (assignment == null || assignment.studentId() != studentId) throw notFound();
        Long inProgress = jdbcTemplate.query("""
            SELECT id FROM attempts WHERE shsat_wrong_answer_assignment_id = ? AND status = 'IN_PROGRESS'
            ORDER BY attempt_no DESC LIMIT 1
            """, rs -> rs.next() ? rs.getLong(1) : null, assignmentId);
        if (inProgress != null) return attemptService.get(inProgress, username);
        if ("NO_SOURCE_ATTEMPT".equals(assignment.status()) || "NO_WRONG_ANSWERS".equals(assignment.status())
                || assignment.sourceAttemptId() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This assignment has no questions available to review.");
        }
        if (!"PUBLISHED".equals(assignment.taskStatus()) || !isTaskAvailable(assignment.taskStatus(), assignment.startsAt(), assignment.endsAt())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This review assignment is not currently available.");
        }
        List<Integer> assigned = parseQuestionNumbers(assignment.questionNumbersJson());
        Set<Integer> cleared = clearedQuestionNumbers(assignmentId, assignment.questionNumbersJson());
        List<Integer> remaining = assigned.stream().filter(number -> !cleared.contains(number)).toList();
        if (remaining.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT, "All assigned questions have been answered correctly.");
        return attemptService.startWrongAnswerPractice(assignmentId, remaining, username);
    }

    private Set<Integer> clearedQuestionNumbers(long assignmentId, String questionNumbersJson) {
        List<Integer> assigned = parseQuestionNumbers(questionNumbersJson);
        if (assigned.isEmpty()) return Set.of();
        String placeholders = String.join(",", java.util.Collections.nCopies(assigned.size(), "?"));
        List<Object> parameters = new ArrayList<>();
        parameters.add(assignmentId);
        parameters.addAll(assigned);
        return new HashSet<>(jdbcTemplate.query("""
            SELECT DISTINCT pi.display_number FROM attempts a
            JOIN attempt_items ai ON ai.attempt_id = a.id
            JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            WHERE a.shsat_wrong_answer_assignment_id = ? AND a.status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')
              AND aa.is_correct = TRUE AND pi.display_number IN (""" + placeholders + ")",
            (rs, rowNum) -> rs.getInt(1), parameters.toArray()));
    }

    private AssignmentMetrics assignmentMetrics(long assignmentId, Long practiceAttemptId, int questionCount) {
        if (practiceAttemptId == null) return new AssignmentMetrics(0, questionCount, 0, 0, 0, questionCount, null, null);
        return jdbcTemplate.query("""
            SELECT
                (SELECT COUNT(*) FROM JSON_TABLE(a.question_numbers_json, '$[*]' COLUMNS (question_number INT PATH '$')) assigned
                 WHERE EXISTS (SELECT 1 FROM attempts linked
                    JOIN attempt_items ai ON ai.attempt_id = linked.id
                    JOIN paper_items pi ON pi.id = ai.paper_item_id
                    JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
                    WHERE linked.shsat_wrong_answer_assignment_id = a.id
                      AND linked.status IN ('SUBMITTED','COMPLETED','EXPIRED')
                      AND JSON_CONTAINS(linked.shsat_wrong_answer_questions_json, JSON_ARRAY(assigned.question_number))
                      AND pi.display_number = assigned.question_number AND aa.is_correct = TRUE)) AS cleared_count,
                (SELECT COUNT(*) FROM attempt_items WHERE attempt_id = current_attempt.id) AS round_count,
                (SELECT COUNT(*) FROM attempt_answers WHERE attempt_id = current_attempt.id) AS answered_count,
                (SELECT COUNT(*) FROM attempt_answers WHERE attempt_id = current_attempt.id AND is_correct = TRUE) AS correct_count,
                (SELECT COUNT(*) FROM attempt_answers WHERE attempt_id = current_attempt.id AND is_correct = FALSE) AS wrong_count,
                (SELECT COUNT(*) FROM attempt_items ai LEFT JOIN attempt_answers aa
                    ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
                 WHERE ai.attempt_id = current_attempt.id AND aa.paper_item_id IS NULL) AS unanswered_count,
                current_attempt.submitted_at
            FROM shsat_wrong_answer_assignments a JOIN attempts current_attempt ON current_attempt.id = ?
            WHERE a.id = ?
            """, rs -> {
                if (!rs.next()) return new AssignmentMetrics(0, questionCount, 0, 0, 0, questionCount, null, null);
                int answered = rs.getInt("answered_count");
                int correct = rs.getInt("correct_count");
                java.math.BigDecimal accuracy = answered == 0 ? null
                    : java.math.BigDecimal.valueOf(correct * 100.0 / answered).setScale(2, java.math.RoundingMode.HALF_UP);
                return new AssignmentMetrics(rs.getInt("cleared_count"), rs.getInt("round_count"), answered,
                    correct, rs.getInt("wrong_count"), rs.getInt("unanswered_count"), accuracy,
                    localDateTime(rs.getTimestamp("submitted_at")));
            }, practiceAttemptId, assignmentId);
    }

    private List<Integer> parseQuestionNumbers(String value) {
        try {
            return objectMapper.readValue(value, objectMapper.getTypeFactory().constructCollectionType(List.class, Integer.class));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("The assigned review question list is invalid.", exception);
        }
    }

    private boolean isTaskAvailable(String status, java.sql.Timestamp startsAt, java.sql.Timestamp endsAt) {
        return ShsatWrongAnswerTaskPolicy.isAvailable(status, localDateTime(startsAt), localDateTime(endsAt), LocalDateTime.now());
    }

    private String resolveStudentStatus(String taskStatus, String assignmentStatus, String attemptStatus, int remaining) {
        return ShsatWrongAnswerTaskPolicy.studentStatus(taskStatus, attemptStatus, assignmentStatus, remaining);
    }

    private Long nullableLong(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).longValue();
    }

    private LocalDateTime localDateTime(java.sql.Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toLocalDateTime();
    }

    private ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Wrong-answer task not found.");
    }

    public record CreateTaskRequest(@NotNull @Positive Long examId, @NotNull @Positive Long classId,
            @NotBlank @Size(max = 200) String title, @Size(max = 1000) String description,
            @NotNull LocalDateTime startAt, @NotNull LocalDateTime endAt) { }
    public record TaskView(long taskId, long examId, String examTitle, String paperName, long classId,
            String className, String title, String description, LocalDateTime startAt, LocalDateTime endAt,
            String status, int assignedCount, int eligibleCount, int completedCount, int inProgressCount,
            int notStartedCount, int retryRequiredCount, int endedCount, int noSourceAttemptCount,
            int noWrongAnswerCount, LocalDateTime createdAt) { }
    public record AssignmentView(long assignmentId, long taskId, long studentId, String studentName,
            String studentNumber, Long sourceAttemptId, String sourceAttemptStatus, Long practiceAttemptId,
            String status, int totalQuestions, int remainingQuestionCount, int clearedQuestionCount,
            int roundQuestionCount, int answeredQuestions, int correctCount, int wrongCount,
            int unansweredCount, java.math.BigDecimal accuracy, LocalDateTime startedAt, LocalDateTime completedAt) { }
    public record TaskDetail(TaskView task, List<AssignmentView> assignments) { }
    public record StudentTaskView(long assignmentId, long taskId, long examId, String examTitle, String title,
            String description, LocalDateTime startAt, LocalDateTime endAt, String status, int totalQuestions,
            int clearedQuestionCount, int remainingQuestionCount, Long practiceAttemptId, boolean canStart) { }
    private record StudentAssignment(long id, long studentId, String status, Long sourceAttemptId,
            String questionNumbersJson, String taskStatus, java.sql.Timestamp startsAt, java.sql.Timestamp endsAt) { }
    private record AssignmentMetrics(int cleared, int roundCount, int answered, int correct, int wrong,
            int unanswered, java.math.BigDecimal accuracy, LocalDateTime completedAt) { }
}
