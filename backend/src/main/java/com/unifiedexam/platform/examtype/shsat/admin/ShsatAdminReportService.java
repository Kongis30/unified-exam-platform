package com.unifiedexam.platform.examtype.shsat.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.unifiedexam.platform.examtype.shsat.ShsatQuestionGrader;
import com.unifiedexam.platform.examtype.MonitorAnswerGradingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 把统一 attempts/results 组装成新版 SHSAT 管理页面使用的报表视图。 */
@Service
public class ShsatAdminReportService {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final ShsatQuestionGrader questionGrader;
    private final MonitorAnswerGradingService answerGrading;

    @Autowired
    public ShsatAdminReportService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper,
                                   ShsatQuestionGrader questionGrader, MonitorAnswerGradingService answerGrading) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.questionGrader = questionGrader;
        this.answerGrading = answerGrading;
    }

    /** 简化服务层单测构造；运行时由 Spring 注入评分器实例。 */
    public ShsatAdminReportService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this(jdbcTemplate, objectMapper, new ShsatQuestionGrader(), null);
    }

    /** 汇总班级成绩；迁移空题以 legacyAnswer:null 占位，不能把 ungraded_count 当作已作答数。 */
    public List<Map<String, Object>> classExamScores(long examId, long classId) {
        requireShsatExam(examId);
        requireClass(classId);
        Boolean targeted = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM exams WHERE id = ? AND target_scope = 'ALL_STUDENTS')
                OR EXISTS(SELECT 1 FROM exam_target_classes WHERE exam_id = ? AND class_id = ?)
                OR EXISTS(SELECT 1 FROM exam_target_student_classes WHERE exam_id = ? AND class_id = ?)
                OR EXISTS(SELECT 1 FROM attempt_classes ac JOIN attempts a ON a.id = ac.attempt_id WHERE a.exam_id = ? AND ac.class_id = ?)
            """, Boolean.class, examId, examId, classId, examId, classId, examId, classId);
        if (!Boolean.TRUE.equals(targeted)) throw notFound("Class exam results not found.");
        return jdbcTemplate.query("""
            SELECT u.id AS student_id, u.real_name, u.username, a.id AS attempt_id, a.attempt_no, a.status AS attempt_status,
                   a.started_at, a.submitted_at, r.total_points, r.max_points, r.is_estimated,
                   (SELECT rb.raw_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_score,
                   (SELECT rb.raw_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_score,
                   (SELECT rb.raw_max_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_raw_max_score,
                   (SELECT rb.raw_max_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_raw_max_score,
                   (SELECT rb.scaled_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_scaled_score,
                   (SELECT rb.scaled_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_scaled_score,
                   (SELECT rb.scaled_max_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_scaled_max_score,
                   (SELECT rb.scaled_max_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_scaled_max_score,
                   sp.algorithm_code AS scoring_mode,
                   (SELECT COUNT(*) FROM attempt_items ai WHERE ai.attempt_id = a.id) AS question_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id
                    AND NOT (JSON_CONTAINS_PATH(aa.answer_json, 'one', '$.legacyAnswer')
                      AND (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'NULL'
                        OR (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'STRING'
                          AND JSON_UNQUOTE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = '')))) AS answered_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = TRUE) AS correct_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = FALSE) AS wrong_count,
                   TIMESTAMPDIFF(SECOND, a.started_at, COALESCE(a.submitted_at, CURRENT_TIMESTAMP(6))) AS time_used
            FROM exam_participant_classes pc JOIN users u ON u.id = pc.student_user_id
            LEFT JOIN attempts a ON a.id = (
                SELECT a2.id FROM attempts a2 WHERE a2.exam_id = ? AND a2.student_user_id = u.id AND a2.is_practice = FALSE
                    AND EXISTS (SELECT 1 FROM attempt_classes ac WHERE ac.attempt_id = a2.id AND ac.class_id = pc.class_id)
                ORDER BY a2.attempt_no DESC LIMIT 1
            )
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN exams e ON e.id = a.exam_id
            LEFT JOIN scoring_profiles sp ON sp.id = COALESCE(r.scoring_profile_id, e.scoring_profile_id)
            WHERE pc.exam_id = ? AND pc.class_id = ?
            ORDER BY u.real_name, u.id
            """, (rs, rowNum) -> {
                Map<String, Object> row = new LinkedHashMap<>();
                long answered = rs.getLong("answered_count");
                long correct = rs.getLong("correct_count");
                long wrong = rs.getLong("wrong_count");
                long questionCount = rs.getLong("question_count");
                Long attemptId = nullableLong(rs, "attempt_id");
                row.put("studentId", rs.getLong("student_id"));
                row.put("studentName", rs.getString("real_name"));
                row.put("studentNumber", rs.getString("username"));
                row.put("attemptId", attemptId);
                row.put("attemptNumber", nullableInt(rs, "attempt_no"));
                row.put("status", reportStatus(rs.getString("attempt_status")));
                row.put("totalScore", rs.getBigDecimal("total_points"));
                row.put("rawTotalScore", rs.getBigDecimal("total_points"));
                row.put("rawTotalMaxScore", rs.getBigDecimal("max_points"));
                row.put("section1Score", rs.getBigDecimal("ela_score"));
                row.put("section2Score", rs.getBigDecimal("math_score"));
                row.put("elaRawScore", rs.getBigDecimal("ela_score"));
                row.put("mathRawScore", rs.getBigDecimal("math_score"));
                row.put("elaRawMaxScore", rs.getBigDecimal("ela_raw_max_score"));
                row.put("mathRawMaxScore", rs.getBigDecimal("math_raw_max_score"));
                addScaledScores(row, rs.getBigDecimal("ela_scaled_score"), rs.getBigDecimal("math_scaled_score"),
                    nullableInt(rs, "ela_scaled_max_score"), nullableInt(rs, "math_scaled_max_score"),
                    rs.getString("scoring_mode"));
                row.put("estimated", rs.getObject("is_estimated") == null ? false : rs.getBoolean("is_estimated"));
                row.put("correctCount", attemptId == null ? null : correct);
                row.put("wrongCount", attemptId == null ? null : wrong);
                row.put("unansweredCount", attemptId == null ? null : Math.max(0, questionCount - answered));
                row.put("completionRate", percent(answered, questionCount));
                row.put("accuracy", percent(correct, answered));
                row.put("timeUsed", attemptId == null ? null : rs.getInt("time_used"));
                row.put("startedAt", iso(rs.getTimestamp("started_at")));
                row.put("submittedAt", iso(rs.getTimestamp("submitted_at")));
                return row;
            }, examId, examId, classId);
    }

    /** 管理员学生成绩历史只展示正式考试；练习记录留在独立的错题练习流程中。 */
    public List<Map<String, Object>> studentAttemptHistory(long studentId) {
        return studentAttemptHistory(studentId, null);
    }

    public List<Map<String, Object>> studentAttemptHistory(long studentId, Long classId) {
        requireStudent(studentId);
        // 学生班级历史与班级考试列表采用相同的明确目标优先规则。
        String classFilter = classId == null ? "" : " AND EXISTS (SELECT 1 FROM attempt_classes ac WHERE ac.attempt_id = a.id AND ac.class_id = ? AND (EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = a.exam_id AND tc.class_id = ac.class_id) OR NOT EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = a.exam_id)))";
        Object[] parameters = classId == null ? new Object[] { studentId } : new Object[] { studentId, classId };
        return jdbcTemplate.query(("""
            SELECT a.id, a.exam_id, a.attempt_no, a.status, a.started_at, a.submitted_at,
                   e.title AS exam_title, p.id AS paper_id, p.title AS paper_name,
                   r.total_points, r.max_points, r.is_estimated,
                   (SELECT COUNT(*) FROM attempt_items ai WHERE ai.attempt_id = a.id) AS question_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id
                    AND NOT (JSON_CONTAINS_PATH(aa.answer_json, 'one', '$.legacyAnswer')
                      AND (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'NULL'
                        OR (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'STRING'
                          AND JSON_UNQUOTE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = '')))) AS answered_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = TRUE) AS correct_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = FALSE) AS wrong_count,
                   (SELECT raw_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_score,
                   (SELECT raw_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_score,
                   (SELECT raw_max_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_raw_max_score,
                   (SELECT raw_max_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_raw_max_score,
                   (SELECT scaled_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_scaled_score,
                   (SELECT scaled_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_scaled_score,
                   (SELECT scaled_max_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_scaled_max_score,
                   (SELECT scaled_max_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_scaled_max_score,
                   sp.algorithm_code AS scoring_mode,
                   TIMESTAMPDIFF(SECOND, a.started_at, COALESCE(a.submitted_at, CURRENT_TIMESTAMP(6))) AS time_used
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN scoring_profiles sp ON sp.id = COALESCE(r.scoring_profile_id, e.scoring_profile_id)
            WHERE a.student_user_id = ? AND p.exam_type_code = 'SHSAT' AND a.is_practice = FALSE %s
            ORDER BY a.started_at DESC, a.id DESC
            """).formatted(classFilter), (rs, rowNum) -> historyRow(rs), parameters);
    }

    /** 学生工作区仅返回本人 SHSAT 已结束尝试；答案复习由 allow_review 控制，成绩仍遵循发布策略。 */
    public List<Map<String, Object>> studentOwnAttemptHistory(String username) {
        return jdbcTemplate.query("""
            SELECT a.id, a.exam_id, a.attempt_no, a.status, a.is_practice, a.started_at, a.submitted_at,
                   a.shsat_self_practice_source_attempt_id, e.title AS exam_title,
                   e.score_visibility, e.allow_review, e.closes_at <= CURRENT_TIMESTAMP(6) AS exam_closed,
                   p.id AS paper_id, p.title AS paper_name, r.total_points, COALESCE(r.ungraded_count, 0) AS ungraded_count,
                   (SELECT rb.scaled_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_scaled_score,
                   (SELECT rb.scaled_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_scaled_score,
                   (SELECT rb.scaled_max_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_scaled_max_score,
                   (SELECT rb.scaled_max_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_scaled_max_score,
                   sp.algorithm_code AS scoring_mode,
                   (SELECT COUNT(*) FROM attempt_items ai WHERE ai.attempt_id = a.id) AS question_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id
                    AND NOT (JSON_CONTAINS_PATH(aa.answer_json, 'one', '$.legacyAnswer')
                      AND (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'NULL'
                        OR (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'STRING'
                          AND JSON_UNQUOTE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = '')))) AS answered_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = TRUE) AS correct_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = FALSE) AS wrong_count,
                   (SELECT COUNT(*) FROM shsat_self_practice_cleared_questions cleared
                    WHERE cleared.source_attempt_id = a.id AND cleared.student_user_id = a.student_user_id) AS cleared_count
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            JOIN users u ON u.id = a.student_user_id LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN scoring_profiles sp ON sp.id = COALESCE(r.scoring_profile_id, e.scoring_profile_id)
            WHERE u.username = ? AND u.role_code = 'STUDENT' AND p.exam_type_code = 'SHSAT'
              AND a.status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')
            ORDER BY COALESCE(a.submitted_at, a.started_at) DESC, a.id DESC
            """, (rs, rowNum) -> {
                long questionCount = rs.getLong("question_count");
                long answered = rs.getLong("answered_count");
                long reviewCount = rs.getLong("wrong_count") + Math.max(0, questionCount - answered);
                boolean practice = rs.getBoolean("is_practice");
                boolean submitted = "SUBMITTED".equals(rs.getString("status"))
                    || "COMPLETED".equals(rs.getString("status")) || "EXPIRED".equals(rs.getString("status"));
                boolean scoreVisible = practice || (rs.getInt("ungraded_count") == 0
                    && ReportVisibilityPolicy.isVisible(rs.getString("score_visibility"), submitted, rs.getBoolean("exam_closed")));
                boolean answersVisible = practice || ReportVisibilityPolicy.isReviewVisible(
                    rs.getBoolean("allow_review"), submitted);
                long cleared = practice ? 0 : rs.getLong("cleared_count");
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("attemptId", rs.getLong("id"));
                row.put("examId", rs.getLong("exam_id"));
                row.put("examTitle", rs.getString("exam_title"));
                row.put("paperId", rs.getLong("paper_id"));
                row.put("paperName", rs.getString("paper_name"));
                row.put("attemptNumber", rs.getInt("attempt_no"));
                row.put("status", reportStatus(rs.getString("status")));
                row.put("practice", practice);
                row.put("practiceSourceAttemptId", nullableLong(rs, "shsat_self_practice_source_attempt_id"));
                row.put("scoreVisible", scoreVisible);
                row.put("answersVisible", answersVisible);
                row.put("totalScore", scoreVisible ? rs.getBigDecimal("total_points") : null);
                row.put("rawTotalScore", scoreVisible ? rs.getBigDecimal("total_points") : null);
                addScaledScores(row, scoreVisible ? rs.getBigDecimal("ela_scaled_score") : null,
                    scoreVisible ? rs.getBigDecimal("math_scaled_score") : null,
                    scoreVisible ? nullableInt(rs, "ela_scaled_max_score") : null,
                    scoreVisible ? nullableInt(rs, "math_scaled_max_score") : null,
                    scoreVisible ? rs.getString("scoring_mode") : null);
                if (!scoreVisible) row.put("scoringMode", null);
                row.put("correctCount", rs.getLong("correct_count"));
                row.put("wrongCount", rs.getLong("wrong_count"));
                row.put("unansweredCount", Math.max(0, questionCount - answered));
                row.put("reviewCount", practice ? 0 : reviewCount);
                row.put("clearedReviewCount", cleared);
                row.put("remainingReviewCount", Math.max(0, reviewCount - cleared));
                row.put("accuracy", scoreVisible ? percent(rs.getLong("correct_count"), answered) : null);
                row.put("startedAt", local(rs.getTimestamp("started_at")));
                row.put("submittedAt", local(rs.getTimestamp("submitted_at")));
                return row;
            }, username);
    }

    public Map<String, Object> attemptResult(long attemptId) {
        Map<String, Object> report = jdbcTemplate.query("""
            SELECT a.id, a.exam_id, a.student_user_id, a.attempt_no, a.status, a.is_practice, a.started_at, a.submitted_at,
                   e.title AS exam_title, e.answer_visibility, e.score_visibility, p.id AS paper_id, p.title AS paper_name,
                   u.real_name, r.total_points, r.max_points, r.is_estimated, r.scoring_profile_id,
                   sp.algorithm_code AS scoring_mode,
                   (SELECT COUNT(*) FROM attempt_items ai WHERE ai.attempt_id = a.id) AS question_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id
                    AND NOT (JSON_CONTAINS_PATH(aa.answer_json, 'one', '$.legacyAnswer')
                      AND (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'NULL'
                        OR (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'STRING'
                          AND JSON_UNQUOTE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = '')))) AS answered_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = TRUE) AS correct_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = FALSE) AS wrong_count,
                   COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(shsat_state.flow_json, '$.focusViolationCount')) AS UNSIGNED), 0)
                       AS focus_violation_count,
                   TIMESTAMPDIFF(SECOND, a.started_at, COALESCE(a.submitted_at, CURRENT_TIMESTAMP(6))) AS time_used
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            JOIN users u ON u.id = a.student_user_id LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN shsat_attempt_state shsat_state ON shsat_state.attempt_id = a.id
            LEFT JOIN scoring_profiles sp ON sp.id = COALESCE(r.scoring_profile_id, e.scoring_profile_id)
            WHERE a.id = ? AND p.exam_type_code = 'SHSAT'
            """, rs -> {
                if (!rs.next()) throw notFound("Attempt report not found.");
                Map<String, Object> row = new LinkedHashMap<>();
                long answered = rs.getLong("answered_count");
                long questionCount = rs.getLong("question_count");
                row.put("attemptId", rs.getLong("id"));
                row.put("examId", rs.getLong("exam_id"));
                row.put("paperId", rs.getLong("paper_id"));
                row.put("examTitle", rs.getString("exam_title"));
                row.put("paperName", rs.getString("paper_name"));
                row.put("studentName", rs.getString("real_name"));
                row.put("attemptNumber", rs.getInt("attempt_no"));
                row.put("practice", rs.getBoolean("is_practice"));
                row.put("status", reportStatus(rs.getString("status")));
                row.put("scoreVisible", true);
                row.put("answersVisible", true);
                row.put("reportVisible", true);
                row.put("totalScore", rs.getBigDecimal("total_points"));
                row.put("totalMaxScore", rs.getBigDecimal("max_points"));
                row.put("rawTotalScore", rs.getBigDecimal("total_points"));
                row.put("correctCount", rs.getLong("correct_count"));
                row.put("wrongCount", rs.getLong("wrong_count"));
                row.put("questionCount", questionCount);
                row.put("answeredCount", answered);
                row.put("unansweredCount", Math.max(0, questionCount - answered));
                row.put("completionRate", percent(answered, questionCount));
                row.put("accuracy", percent(rs.getLong("correct_count"), answered));
                row.put("timeUsed", rs.getInt("time_used"));
                row.put("focusViolationCount", rs.getInt("focus_violation_count"));
                row.put("estimated", rs.getObject("is_estimated") == null ? false : rs.getBoolean("is_estimated"));
                row.put("scoringMode", scoringMode(rs.getString("scoring_mode")));
                row.put("startedAt", local(rs.getTimestamp("started_at")));
                row.put("submittedAt", local(rs.getTimestamp("submitted_at")));
                return row;
            }, attemptId);
        List<Map<String, Object>> questions = attemptQuestions(attemptId);
        long answered = questions.isEmpty()
            ? ((Number) report.get("answeredCount")).longValue()
            : questions.stream().filter(this::hasMeaningfulAnswer).count();
        long questionCount = ((Number) report.get("questionCount")).longValue();
        long correct = ((Number) report.get("correctCount")).longValue();
        report.put("answeredCount", answered);
        report.put("unansweredCount", Math.max(0, questionCount - answered));
        report.put("completionRate", percent(answered, questionCount));
        report.put("accuracy", percent(correct, answered));
        report.put("questions", questions);
        Map<String, Object> sections = sectionScores(attemptId);
        report.putAll(sections);
        return report;
    }

    private boolean hasMeaningfulAnswer(Map<String, Object> question) {
        String type = String.valueOf(question.get("questionType"));
        Object rawAnswer = question.get("answerData");
        if (rawAnswer == null || rawAnswer.toString().isBlank()) rawAnswer = question.get("selectedAnswer");
        if (rawAnswer == null || rawAnswer.toString().isBlank()) return false;
        JsonNode answer;
        try {
            answer = objectMapper.readTree(rawAnswer.toString());
        } catch (Exception ignored) {
            answer = objectMapper.getNodeFactory().textNode(rawAnswer.toString());
        }
        return questionGrader.hasMeaningfulAnswer(type, answer);
    }

    /** 学生报告复用管理报告结构，答案复习按 allow_review 开放，成绩按独立策略控制。 */
    public Map<String, Object> studentAttemptResult(long attemptId, String username) {
        StudentReportAccess access = jdbcTemplate.query("""
            SELECT a.status, a.is_practice, e.score_visibility, e.allow_review,
                   e.closes_at <= CURRENT_TIMESTAMP(6) AS exam_closed,
                   COALESCE(r.ungraded_count, 0) AS ungraded_count
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            JOIN users u ON u.id = a.student_user_id LEFT JOIN attempt_results r ON r.attempt_id = a.id
            WHERE a.id = ? AND u.username = ? AND u.role_code = 'STUDENT' AND p.exam_type_code = 'SHSAT'
            """, rs -> rs.next() ? new StudentReportAccess(rs.getString("status"), rs.getBoolean("is_practice"),
                rs.getString("score_visibility"), rs.getBoolean("allow_review"),
                rs.getBoolean("exam_closed"), rs.getInt("ungraded_count")) : null, attemptId, username);
        if (access == null) throw notFound("Attempt report not found.");
        if (!List.of("SUBMITTED", "COMPLETED", "EXPIRED").contains(access.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The exam report is not ready yet.");
        }

        boolean scoreVisible = access.practice() || (access.ungradedCount() == 0
            && ReportVisibilityPolicy.isVisible(access.scoreVisibility(), true, access.examClosed()));
        boolean answersVisible = access.practice() || ReportVisibilityPolicy.isReviewVisible(access.allowReview(), true);
        Map<String, Object> report = attemptResult(attemptId);
        report.put("scoreVisible", scoreVisible);
        report.put("answersVisible", answersVisible);
        report.put("reviewAllowed", access.allowReview());
        report.put("reviewAvailableAfterClose", false);
        report.put("reportVisible", true);
        StudentReportSanitizer.apply(report, scoreVisible, answersVisible, access.allowReview());
        return report;
    }

    public Map<String, Object> monitorLive(long examId) {
        ExamMonitor exam = requireShsatExam(examId);
        Map<String, Object> summary = jdbcTemplate.query("""
            SELECT COUNT(*) AS started,
                   SUM(a.status = 'IN_PROGRESS') AS in_progress,
                   SUM(a.status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')) AS submitted,
                   COUNT(DISTINCT CASE WHEN a.status = 'IN_PROGRESS' THEN a.student_user_id END) AS in_progress_students,
                   COUNT(DISTINCT CASE WHEN a.status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')
                       THEN a.student_user_id END) AS completed_students,
                   MAX(COALESCE(a.submitted_at, a.started_at)) AS last_seen
            FROM attempts a
            WHERE a.exam_id = ? AND a.is_practice = FALSE AND a.status NOT IN ('NOT_STARTED', 'CANCELLED')
            """, rs -> {
                rs.next();
                long started = rs.getLong("started");
                long inProgress = rs.getLong("in_progress");
                long submitted = rs.getLong("submitted");
                long inProgressStudents = rs.getLong("in_progress_students");
                long completedStudents = rs.getLong("completed_students");
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("activeAttempts", activeAttempts(examId));
                result.put("startedAttempts", started);
                result.put("totalStudents", Math.max(exam.participantCount(), started));
                result.put("inProgressAttempts", inProgress);
                result.put("finishedAttempts", submitted);
                result.put("inProgressStudents", inProgressStudents);
                result.put("completedStudents", completedStudents);
                result.put("incompleteStudents", Math.max(0, Math.max(exam.participantCount(), started) - completedStudents));
                result.put("lastSeenAt", iso(rs.getTimestamp("last_seen")));
                return result;
            }, examId);
        // 学生每 10 秒同步一次答题状态；只把最近 30 秒有状态更新的尝试视为在线。
        List<Map<String, Object>> distribution = jdbcTemplate.query("""
            SELECT s.active_question_number AS question_number, COUNT(*) AS students
            FROM shsat_attempt_state s JOIN attempts a ON a.id = s.attempt_id
            WHERE a.exam_id = ? AND a.status = 'IN_PROGRESS' AND a.is_practice = FALSE AND s.active_question_number IS NOT NULL
              AND s.updated_at >= CURRENT_TIMESTAMP(6) - INTERVAL 30 SECOND
            GROUP BY s.active_question_number ORDER BY s.active_question_number
            """, (rs, rowNum) -> Map.of("questionNumber", rs.getInt("question_number"), "students", rs.getLong("students")), examId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("exam", exam.toMap());
        result.put("summary", summary);
        result.put("currentQuestionDistribution", distribution);
        result.put("generatedAt", LocalDateTime.now());
        return result;
    }

    public Map<String, Object> monitorAnalytics(long examId) {
        ExamMonitor exam = requireShsatExam(examId);
        if (answerGrading != null) answerGrading.gradePendingAnswers(examId, "SHSAT");
        // 按实际派发版本统计每题人数，新增题不把历史作答计入未答人数。
        // 迁移的未答记录用 legacyAnswer:null 占位，需排除该占位值。
        List<Map<String, Object>> questions = jdbcTemplate.query("""
            SELECT pi.display_number, q.id AS question_id, q.question_type_code,
                   COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(part.settings_json, '$.partCode')), ''),
                            part.section_code) AS subject_code,
                   qm.skill_tag_code,
                   (SELECT COUNT(*) FROM attempt_items ai JOIN attempts a ON a.id = ai.attempt_id
                    JOIN paper_items version ON version.id = ai.paper_item_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE
                      AND COALESCE(version.lineage_id, version.id) = COALESCE(pi.lineage_id, pi.id)) AS served,
                   (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id IN (SELECT version.id FROM paper_items version
                        WHERE version.lineage_id = COALESCE(pi.lineage_id, pi.id) OR version.id = COALESCE(pi.lineage_id, pi.id))
                      AND NOT (JSON_CONTAINS_PATH(aa.answer_json, 'one', '$.legacyAnswer')
                        AND (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'NULL'
                          OR (JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'STRING'
                            AND JSON_UNQUOTE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = '')))) AS attempted,
                   (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id IN (SELECT version.id FROM paper_items version
                        WHERE version.lineage_id = COALESCE(pi.lineage_id, pi.id) OR version.id = COALESCE(pi.lineage_id, pi.id)) AND aa.is_correct = TRUE) AS correct,
                   (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id IN (SELECT version.id FROM paper_items version
                        WHERE version.lineage_id = COALESCE(pi.lineage_id, pi.id) OR version.id = COALESCE(pi.lineage_id, pi.id)) AND aa.is_correct = FALSE) AS wrong,
                   (SELECT AVG(NULLIF(aa.time_spent_seconds, 0)) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id IN (SELECT version.id FROM paper_items version
                        WHERE version.lineage_id = COALESCE(pi.lineage_id, pi.id) OR version.id = COALESCE(pi.lineage_id, pi.id))) AS average_time_spent
            FROM paper_sections ps JOIN paper_items pi ON pi.section_id = ps.id
            JOIN questions q ON q.id = pi.question_id
            LEFT JOIN paper_sections parent ON parent.id = ps.parent_section_id
            LEFT JOIN paper_sections part ON part.id = CASE
                WHEN ps.section_kind = 'PART' THEN ps.id ELSE parent.id END
            LEFT JOIN shsat_question_metadata qm ON qm.question_id = q.id
            WHERE ps.paper_id = ? AND ps.archived_key = 0 AND pi.display_number IS NOT NULL
            ORDER BY pi.display_number, pi.id
            """, (rs, rowNum) -> {
                long attempted = rs.getLong("attempted");
                long correct = rs.getLong("correct");
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("questionId", rs.getLong("question_id"));
                row.put("questionNumber", rs.getInt("display_number"));
                row.put("questionType", rs.getString("question_type_code"));
                row.put("attemptedCount", attempted);
                row.put("attempted", attempted);
                row.put("correctCount", correct);
                long wrong = rs.getLong("wrong");
                row.put("wrongCount", wrong);
                row.put("unansweredCount", Math.max(0, rs.getLong("served") - attempted));
                row.put("accuracy", percent(correct, correct + wrong));
                row.put("averageTimeSpent", rs.getBigDecimal("average_time_spent"));
                row.put("shsatSubjectCode", rs.getString("subject_code"));
                row.put("skillTagCode", rs.getString("skill_tag_code"));
                row.put("materialId", null);
                row.put("materialTitle", null);
                return row;
            }, examId, examId, examId, examId, examId, exam.paperId());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("questionAnalytics", questions);
        result.put("generatedAt", LocalDateTime.now());
        return result;
    }

    public Map<String, Object> monitorQuestion(long examId, int questionNumber) {
        ExamMonitor exam = requireShsatExam(examId);
        Map<String, Object> question = jdbcTemplate.query("""
            SELECT q.id, pi.display_number, q.question_type_code, q.stem, q.render_json, q.answer_key_json, q.grading_json,
                   qm.skill_tag_code
            FROM paper_sections ps JOIN paper_items pi ON pi.section_id = ps.id
            JOIN questions q ON q.id = pi.question_id
            LEFT JOIN shsat_question_metadata qm ON qm.question_id = q.id
            WHERE ps.paper_id = ? AND ps.archived_key = 0 AND pi.display_number = ? ORDER BY pi.id LIMIT 1
            """, rs -> rs.next() ? questionView(rs) : null, exam.paperId(), questionNumber);
        if (question == null) throw notFound("Question not found in this exam.");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("question", question);
        result.put("material", question.get("material"));
        return result;
    }

    private Map<String, Object> questionView(ResultSet rs) throws SQLException {
        JsonNode render = readJson(rs.getString("render_json"));
        JsonNode answerKey = readJson(rs.getString("answer_key_json"));
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("questionId", rs.getLong("id"));
        view.put("questionNumber", rs.getInt("display_number"));
        view.put("questionType", rs.getString("question_type_code"));
        view.put("stem", rs.getString("stem"));
        view.put("options", render.path("options"));
        view.put("questionConfig", render.path("questionConfig"));
        view.put("validationRules", render.path("validationRules"));
        view.put("scoringRules", readJson(rs.getString("grading_json")));
        view.put("correctAnswerData", answerKey);
        view.put("correctAnswer", answerKey.path("answer").asText(null));
        view.put("shsatSkillTag", rs.getString("skill_tag_code"));
        JsonNode material = render.path("material");
        view.put("material", material.isMissingNode() ? null : material);
        return view;
    }

    private List<Map<String, Object>> attemptQuestions(long attemptId) {
        return jdbcTemplate.query("""
            SELECT q.id AS question_id, pi.display_number, q.question_type_code, q.stem, q.render_json,
                   q.answer_key_json, q.grading_json, pi.max_points, aa.answer_json, aa.is_correct,
                   aa.awarded_points, aa.time_spent_seconds, imported_answer.source_metadata_json AS imported_answer_metadata,
                   imported_snapshot.snapshot_json AS imported_question_snapshot,
                   qm.skill_tag_code, ps.section_code, ps.title AS section_title,
                   ps.section_kind, parent.section_code AS parent_section_code, parent.title AS parent_section_title,
                   COALESCE(shsm.id, shpm.id) AS shsat_material_id,
                   COALESCE(shsm.title, shpm.title) AS shsat_material_title,
                   COALESCE(shsm.material_type, shpm.material_type) AS shsat_material_type,
                   COALESCE(shsm.category, shpm.category) AS shsat_material_category,
                   COALESCE(shsm.content, shpm.content) AS shsat_material_content,
                   COALESCE(shsm.asset_key, shpm.asset_key) AS shsat_material_asset_key
            FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN paper_sections ps ON ps.id = pi.section_id
            LEFT JOIN paper_sections parent ON parent.id = ps.parent_section_id
            JOIN papers p ON p.id = ps.paper_id
            JOIN questions q ON q.id = pi.question_id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            LEFT JOIN shsat_attempt_answer_details imported_answer
                ON imported_answer.attempt_id = ai.attempt_id AND imported_answer.target_paper_item_id = ai.paper_item_id
            LEFT JOIN shsat_attempt_item_snapshots imported_snapshot
                ON imported_snapshot.attempt_id = ai.attempt_id AND imported_snapshot.target_paper_item_id = ai.paper_item_id
            LEFT JOIN shsat_question_metadata qm ON qm.question_id = q.id
            LEFT JOIN shsat_section_materials shsm
                ON shsm.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(q.render_json, '$.materialId')) AS UNSIGNED)
                AND (shsm.section_id = ps.id OR shsm.section_id = parent.id)
            LEFT JOIN shsat_paper_materials shpm ON shsm.id IS NULL
                AND shpm.id = CAST(JSON_UNQUOTE(JSON_EXTRACT(q.render_json, '$.materialId')) AS UNSIGNED)
                AND shpm.paper_id = p.id
            WHERE ai.attempt_id = ? ORDER BY ai.served_order
            """, (rs, rowNum) -> {
                JsonNode render = readJson(rs.getString("render_json"));
                JsonNode selected = readJson(rs.getString("answer_json"));
                JsonNode answerKey = readJson(rs.getString("answer_key_json"));
                JsonNode importedAnswer = readJson(rs.getString("imported_answer_metadata"));
                String selectedAnswer = importedAnswer.path("selected_answer").asText(null);
                if (selectedAnswer == null || selectedAnswer.isBlank()) selectedAnswer = selected == null ? null : selected.toString();
                String correctAnswer = answerKey.path("answer").asText(null);
                if (correctAnswer == null || correctAnswer.isBlank()) {
                    correctAnswer = importedAnswer.path("correct_answer").asText(null);
                }
                Map<String, Object> question = new LinkedHashMap<>();
                question.put("questionId", rs.getLong("question_id"));
                question.put("questionNumber", rs.getObject("display_number"));
                question.put("questionType", rs.getString("question_type_code"));
                boolean subType = "SUBTYPE".equals(rs.getString("section_kind"));
                question.put("partCode", subType ? rs.getString("parent_section_code") : rs.getString("section_code"));
                question.put("partName", subType ? rs.getString("parent_section_title") : rs.getString("section_title"));
                question.put("subTypeCode", subType ? rs.getString("section_code") : null);
                question.put("subTypeName", subType ? rs.getString("section_title") : null);
                question.put("stem", rs.getString("stem"));
                question.put("options", render.path("options").toString());
                question.put("questionConfig", render.path("questionConfig").toString());
                question.put("validationRules", render.path("validationRules").toString());
                question.put("scoringRules", readJson(rs.getString("grading_json")));
                question.put("correctAnswerData", answerKey);
                question.put("correctAnswer", correctAnswer);
                question.put("selectedAnswer", selectedAnswer);
                question.put("answerData", selected == null ? null : selected.toString());
                question.put("correct", rs.getObject("is_correct") == null ? null : rs.getBoolean("is_correct"));
                question.put("score", rs.getBigDecimal("awarded_points"));
                question.put("maxScore", rs.getBigDecimal("max_points"));
                question.put("timeSpent", nullableInt(rs, "time_spent_seconds"));
                question.put("skillTagCode", rs.getString("skill_tag_code"));
                JsonNode material = render.path("material");
                if (rs.getObject("shsat_material_id") != null) {
                    ObjectNode materialView = objectMapper.createObjectNode();
                    materialView.put("title", rs.getString("shsat_material_title"));
                    materialView.put("type", rs.getString("shsat_material_type"));
                    materialView.put("category", rs.getString("shsat_material_category"));
                    materialView.put("content", rs.getString("shsat_material_content"));
                    materialView.put("assetUrl", shsatMaterialAssetUrl(rs.getString("shsat_material_asset_key")));
                    ObjectNode enrichedRender = render != null && render.isObject()
                        ? ((ObjectNode) render).deepCopy() : objectMapper.createObjectNode();
                    enrichedRender.set("material", materialView);
                    render = enrichedRender;
                    material = materialView;
                }
                question.put("material", material.isMissingNode() ? null : material);
                question.put("materialType", material.path("type").asText(null));
                question.put("materialTitle", material.path("title").asText(null));
                question.put("materialContent", material.path("content").asText(null));
                question.put("assetUrl", material.path("assetUrl").asText(null));
                applyImportedQuestionSnapshot(question, readJson(rs.getString("imported_question_snapshot")), importedAnswer);
                return question;
            }, attemptId);
    }

    /** 迁移考试优先展示独立系统冻结的题面；已有答题答案和得分仍以迁移记录为准。 */
    private void applyImportedQuestionSnapshot(Map<String, Object> question, JsonNode snapshot, JsonNode answer) {
        if (snapshot == null || !snapshot.isObject()) return;
        Map<String, String> fields = Map.of(
            "question_number", "questionNumber", "question_type", "questionType",
            "part_code", "partCode", "part_name", "partName", "sub_type_code", "subTypeCode",
            "sub_type_name", "subTypeName", "stem", "stem");
        fields.forEach((source, target) -> {
            JsonNode value = snapshot.get(source);
            if (value != null) question.put(target, value.isNull() ? null : objectMapper.convertValue(value, Object.class));
        });
        for (String[] field : new String[][]{{"options", "options"}, {"question_config", "questionConfig"},
                {"validation_rules", "validationRules"}}) {
            JsonNode value = snapshot.get(field[0]);
            if (value != null) question.put(field[1], value.isNull() ? null : value.toString());
        }
        if (snapshot.has("scoring_rules")) question.put("scoringRules", snapshot.get("scoring_rules"));
        JsonNode answerData = answer.path("correct_answer_data");
        if (answerData.isMissingNode() || answerData.isNull()) answerData = snapshot.path("correct_answer_data");
        if (!answerData.isMissingNode()) question.put("correctAnswerData", answerData);
        String correctAnswer = answer.path("correct_answer").asText(null);
        if (correctAnswer == null || correctAnswer.isBlank()) correctAnswer = snapshot.path("correct_answer").asText(null);
        question.put("correctAnswer", correctAnswer);
        JsonNode maxScore = answer.path("max_score");
        if (!maxScore.isNumber()) maxScore = snapshot.path("max_score");
        if (maxScore.isNumber()) question.put("maxScore", maxScore.decimalValue());
        String materialType = snapshot.path("material_type").asText(null);
        String title = snapshot.path("material_title").asText(null);
        String content = snapshot.path("material_content").asText(null);
        String asset = snapshot.path("materialAssetKey").asText(null);
        if (asset == null) asset = snapshot.path("asset_url").asText(null);
        String assetUrl = shsatMaterialAssetUrl(asset);
        ObjectNode material = objectMapper.createObjectNode();
        material.put("type", materialType); material.put("title", title);
        material.put("content", content); material.put("assetUrl", assetUrl);
        question.put("material", materialType == null && title == null && content == null && assetUrl == null ? null : material);
        question.put("materialType", materialType); question.put("materialTitle", title);
        question.put("materialContent", content); question.put("assetUrl", assetUrl);
    }

    private Map<String, Object> historyRow(ResultSet rs) throws SQLException {
        long answered = rs.getLong("answered_count");
        long questionCount = rs.getLong("question_count");
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("attemptId", rs.getLong("id"));
        row.put("examId", rs.getLong("exam_id"));
        row.put("examTitle", rs.getString("exam_title"));
        row.put("paperId", rs.getLong("paper_id"));
        row.put("paperName", rs.getString("paper_name"));
        row.put("totalQuestions", questionCount);
        row.put("attemptNumber", rs.getInt("attempt_no"));
        row.put("status", reportStatus(rs.getString("status")));
        row.put("totalScore", rs.getBigDecimal("total_points"));
        row.put("rawTotalScore", rs.getBigDecimal("total_points"));
        row.put("rawTotalMaxScore", rs.getBigDecimal("max_points"));
        row.put("elaRawScore", rs.getBigDecimal("ela_score"));
        row.put("mathRawScore", rs.getBigDecimal("math_score"));
        row.put("elaRawMaxScore", rs.getBigDecimal("ela_raw_max_score"));
        row.put("mathRawMaxScore", rs.getBigDecimal("math_raw_max_score"));
        addScaledScores(row, rs.getBigDecimal("ela_scaled_score"), rs.getBigDecimal("math_scaled_score"),
            nullableInt(rs, "ela_scaled_max_score"), nullableInt(rs, "math_scaled_max_score"),
            rs.getString("scoring_mode"));
        row.put("section1Score", rs.getBigDecimal("ela_score"));
        row.put("section2Score", rs.getBigDecimal("math_score"));
        row.put("estimated", rs.getObject("is_estimated") == null ? false : rs.getBoolean("is_estimated"));
        row.put("correctCount", rs.getLong("correct_count"));
        row.put("wrongCount", rs.getLong("wrong_count"));
        row.put("unansweredCount", Math.max(0, questionCount - answered));
        row.put("completionRate", percent(answered, questionCount));
        row.put("accuracy", percent(rs.getLong("correct_count"), answered));
        row.put("timeUsed", rs.getInt("time_used"));
        row.put("startedAt", local(rs.getTimestamp("started_at")));
        row.put("submittedAt", local(rs.getTimestamp("submitted_at")));
        return row;
    }

    private Map<String, Object> sectionScores(long attemptId) {
        return jdbcTemplate.query("""
            SELECT breakdown_code, raw_score, raw_max_score, scaled_score, scaled_max_score
            FROM attempt_result_breakdowns WHERE attempt_id = ? AND parent_breakdown_code IS NULL
            """, rs -> {
                Map<String, Object> scores = new LinkedHashMap<>();
                while (rs.next()) {
                    String code = rs.getString("breakdown_code");
                    String key = "ELA".equalsIgnoreCase(code) ? "ela" : "MATH".equalsIgnoreCase(code) ? "math" : null;
                    if (key == null) continue;
                    scores.put(key + "RawScore", rs.getBigDecimal("raw_score"));
                    scores.put(key + "ScaledScore", nullableInt(rs, "scaled_score"));
                    if ("ela".equals(key)) {
                        scores.put("elaRawMaxScore", nullableInt(rs, "raw_max_score"));
                        scores.put("elaScaledMaxScore", nullableInt(rs, "scaled_max_score"));
                    }
                    if ("math".equals(key)) {
                        scores.put("mathRawMaxScore", nullableInt(rs, "raw_max_score"));
                        scores.put("mathScaledMaxScore", nullableInt(rs, "scaled_max_score"));
                    }
                }
                Integer ela = (Integer) scores.get("elaScaledScore");
                Integer math = (Integer) scores.get("mathScaledScore");
                Integer elaMax = (Integer) scores.get("elaScaledMaxScore");
                Integer mathMax = (Integer) scores.get("mathScaledMaxScore");
                if (ela != null && math != null && elaMax != null && mathMax != null) {
                    scores.put("compositeScore", ela + math);
                    scores.put("totalScaledScore", ela + math);
                    scores.put("compositeMaxScore", elaMax + mathMax);
                    scores.put("totalScaledMaxScore", elaMax + mathMax);
                }
                return scores;
            }, attemptId);
    }

    private void addScaledScores(Map<String, Object> row, BigDecimal elaScaled, BigDecimal mathScaled,
                                 Integer elaMax, Integer mathMax, String mode) {
        row.put("elaScaledScore", elaScaled == null ? null : elaScaled.intValue());
        row.put("mathScaledScore", mathScaled == null ? null : mathScaled.intValue());
        row.put("section1ScaledScore", row.get("elaScaledScore"));
        row.put("section2ScaledScore", row.get("mathScaledScore"));
        row.put("elaScaledMaxScore", elaMax);
        row.put("mathScaledMaxScore", mathMax);
        row.put("scoringMode", scoringMode(mode));
        if (elaScaled != null && mathScaled != null && elaMax != null && mathMax != null) {
            int composite = elaScaled.intValue() + mathScaled.intValue();
            row.put("compositeScore", composite);
            row.put("totalScaledScore", composite);
            row.put("compositeMaxScore", elaMax + mathMax);
            row.put("totalScaledMaxScore", elaMax + mathMax);
        } else {
            row.put("compositeScore", null);
            row.put("totalScaledScore", null);
            row.put("compositeMaxScore", null);
            row.put("totalScaledMaxScore", null);
        }
    }

    private String scoringMode(String mode) {
        return mode == null || mode.isBlank() ? "RAW_ONLY" : mode;
    }

    private ExamMonitor requireShsatExam(long examId) {
        return jdbcTemplate.query("""
            SELECT e.id, p.id AS paper_id, e.title, e.opens_at, e.closes_at, e.duration_seconds,
                   (SELECT COUNT(*) FROM users u
                    WHERE u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
                      AND (e.target_scope = 'ALL_STUDENTS'
                        OR EXISTS (SELECT 1 FROM exam_target_students ts
                                   WHERE ts.exam_id = e.id AND ts.student_user_id = u.id)
                        OR EXISTS (SELECT 1 FROM exam_target_classes tc
                                   JOIN class_memberships cm ON cm.class_id = tc.class_id AND cm.left_at IS NULL
                                   WHERE tc.exam_id = e.id AND cm.student_user_id = u.id))) AS participants
            FROM exams e JOIN papers p ON p.id = e.paper_id
            WHERE e.id = ? AND p.exam_type_code = 'SHSAT'
            """, rs -> {
                if (!rs.next()) throw notFound("SHSAT exam not found.");
                return new ExamMonitor(rs.getLong("id"), rs.getLong("paper_id"), rs.getString("title"),
                    rs.getTimestamp("opens_at"), rs.getTimestamp("closes_at"), rs.getObject("duration_seconds", Integer.class),
                    rs.getLong("participants"));
            }, examId);
    }

    private long activeAttempts(long examId) {
        Long count = jdbcTemplate.queryForObject("""
            SELECT COUNT(*) FROM attempts WHERE exam_id = ? AND status = 'IN_PROGRESS' AND is_practice = FALSE
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(6))
            """, Long.class, examId);
        return count == null ? 0 : count;
    }

    private void requireClass(long classId) {
        if (!Boolean.TRUE.equals(jdbcTemplate.queryForObject("SELECT EXISTS(SELECT 1 FROM classes WHERE id = ?)", Boolean.class, classId))) {
            throw notFound("Class not found.");
        }
    }

    private void requireStudent(long studentId) {
        if (!Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM users WHERE id = ? AND role_code = 'STUDENT')", Boolean.class, studentId))) {
            throw notFound("Student not found.");
        }
    }

    private String reportStatus(String status) {
        if (status == null) return "NOT_STARTED";
        return "SUBMITTED".equals(status) ? "COMPLETED" : status;
    }

    private BigDecimal percent(long numerator, long denominator) {
        if (denominator == 0) return null;
        return BigDecimal.valueOf(numerator).multiply(BigDecimal.valueOf(100))
            .divide(BigDecimal.valueOf(denominator), 2, RoundingMode.HALF_UP);
    }

    private JsonNode readJson(String value) {
        if (value == null || value.isBlank()) return objectMapper.nullNode();
        try { return objectMapper.readTree(value); }
        catch (Exception exception) { throw new IllegalStateException("Stored report JSON is invalid.", exception); }
    }

    private String shsatMaterialAssetUrl(String assetKey) {
        if (assetKey == null || assetKey.isBlank()) return null;
        if (assetKey.startsWith("http://") || assetKey.startsWith("https://") || assetKey.startsWith("/")) return assetKey;
        return "/uploads/paper-materials/" + assetKey;
    }

    private Long nullableLong(ResultSet rs, String column) throws SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).longValue();
    }

    private Integer nullableInt(ResultSet rs, String column) throws SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).intValue();
    }

    private String iso(Timestamp timestamp) { return timestamp == null ? null : timestamp.toInstant().toString(); }
    private LocalDateTime local(Timestamp timestamp) { return timestamp == null ? null : timestamp.toLocalDateTime(); }
    private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }

    private record ExamMonitor(long examId, long paperId, String title, Timestamp opensAt, Timestamp closesAt,
                               Integer durationSeconds, long participantCount) {
        private Map<String, Object> toMap() {
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("examId", examId);
            view.put("paperId", paperId);
            view.put("title", title);
            view.put("startTime", opensAt == null ? null : opensAt.toLocalDateTime());
            view.put("endTime", closesAt == null ? null : closesAt.toLocalDateTime());
            view.put("duration", durationSeconds == null ? null : durationSeconds / 60);
            return view;
        }
    }

    private record StudentReportAccess(String status, boolean practice, String scoreVisibility,
                                       boolean allowReview, boolean examClosed, int ungradedCount) { }
}
