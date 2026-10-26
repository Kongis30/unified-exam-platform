package com.unifiedexam.platform.examtype.shsat.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    public ShsatAdminReportService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public List<Map<String, Object>> classExamScores(long examId, long classId) {
        requireShsatExam(examId);
        requireClass(classId);
        Boolean targeted = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM exams WHERE id = ? AND target_scope = 'ALL_STUDENTS')
                OR EXISTS(SELECT 1 FROM exam_target_classes WHERE exam_id = ? AND class_id = ?)
            """, Boolean.class, examId, examId, classId);
        if (!Boolean.TRUE.equals(targeted)) throw notFound("Class exam results not found.");
        return jdbcTemplate.query("""
            SELECT u.id AS student_id, u.real_name, u.username, a.id AS attempt_id, a.attempt_no, a.status AS attempt_status,
                   a.started_at, a.submitted_at, r.total_points, r.max_points, r.is_estimated,
                   (SELECT rb.raw_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_score,
                   (SELECT rb.raw_score FROM attempt_result_breakdowns rb
                    WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_score,
                   (SELECT COUNT(*) FROM attempt_items ai WHERE ai.attempt_id = a.id) AS question_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id) AS answered_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = TRUE) AS correct_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = FALSE) AS wrong_count,
                   TIMESTAMPDIFF(SECOND, a.started_at, COALESCE(a.submitted_at, CURRENT_TIMESTAMP(6))) AS time_used
            FROM class_memberships cm JOIN users u ON u.id = cm.student_user_id
            LEFT JOIN attempts a ON a.id = (
                SELECT a2.id FROM attempts a2 WHERE a2.exam_id = ? AND a2.student_user_id = u.id AND a2.is_practice = FALSE
                ORDER BY a2.attempt_no DESC LIMIT 1
            )
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            WHERE cm.class_id = ? AND cm.left_at IS NULL
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
                row.put("section1Score", rs.getBigDecimal("ela_score"));
                row.put("section2Score", rs.getBigDecimal("math_score"));
                row.put("elaRawScore", rs.getBigDecimal("ela_score"));
                row.put("mathRawScore", rs.getBigDecimal("math_score"));
                row.put("estimated", rs.getObject("is_estimated") == null ? false : rs.getBoolean("is_estimated"));
                row.put("correctCount", correct);
                row.put("wrongCount", wrong);
                row.put("unansweredCount", Math.max(0, questionCount - answered));
                row.put("completionRate", percent(answered, questionCount));
                row.put("accuracy", percent(correct, answered));
                row.put("timeUsed", attemptId == null ? null : rs.getInt("time_used"));
                row.put("startedAt", iso(rs.getTimestamp("started_at")));
                row.put("submittedAt", iso(rs.getTimestamp("submitted_at")));
                return row;
            }, examId, classId);
    }

    public List<Map<String, Object>> studentAttemptHistory(long studentId) {
        requireStudent(studentId);
        return jdbcTemplate.query("""
            SELECT a.id, a.exam_id, a.attempt_no, a.status, a.started_at, a.submitted_at,
                   e.title AS exam_title, p.id AS paper_id, p.title AS paper_name,
                   r.total_points, r.max_points, r.is_estimated,
                   (SELECT COUNT(*) FROM attempt_items ai WHERE ai.attempt_id = a.id) AS question_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id) AS answered_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = TRUE) AS correct_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = FALSE) AS wrong_count,
                   (SELECT raw_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_score,
                   (SELECT raw_score FROM attempt_result_breakdowns rb WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_score,
                   TIMESTAMPDIFF(SECOND, a.started_at, COALESCE(a.submitted_at, CURRENT_TIMESTAMP(6))) AS time_used
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            WHERE a.student_user_id = ? AND p.exam_type_code = 'SHSAT'
            ORDER BY a.started_at DESC, a.id DESC
            """, (rs, rowNum) -> historyRow(rs), studentId);
    }

    /** 学生工作区仅返回本人 SHSAT 已结束尝试，并按发布策略标注成绩与答案可见性。 */
    public List<Map<String, Object>> studentOwnAttemptHistory(String username) {
        return jdbcTemplate.query("""
            SELECT a.id, a.exam_id, a.attempt_no, a.status, a.is_practice, a.started_at, a.submitted_at,
                   a.shsat_self_practice_source_attempt_id, e.title AS exam_title, e.answer_visibility,
                   e.score_visibility, e.allow_review, e.closes_at <= CURRENT_TIMESTAMP(6) AS exam_closed,
                   p.id AS paper_id, p.title AS paper_name, r.total_points, COALESCE(r.ungraded_count, 0) AS ungraded_count,
                   (SELECT COUNT(*) FROM attempt_items ai WHERE ai.attempt_id = a.id) AS question_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id) AS answered_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = TRUE) AS correct_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = FALSE) AS wrong_count,
                   (SELECT COUNT(*) FROM shsat_self_practice_cleared_questions cleared
                    WHERE cleared.source_attempt_id = a.id AND cleared.student_user_id = a.student_user_id) AS cleared_count
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            JOIN users u ON u.id = a.student_user_id LEFT JOIN attempt_results r ON r.attempt_id = a.id
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
                boolean answersVisible = practice || (rs.getBoolean("allow_review")
                    && ReportVisibilityPolicy.isVisible(rs.getString("answer_visibility"), submitted, rs.getBoolean("exam_closed")));
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
                   (SELECT COUNT(*) FROM attempt_items ai WHERE ai.attempt_id = a.id) AS question_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id) AS answered_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = TRUE) AS correct_count,
                   (SELECT COUNT(*) FROM attempt_answers aa WHERE aa.attempt_id = a.id AND aa.is_correct = FALSE) AS wrong_count,
                   TIMESTAMPDIFF(SECOND, a.started_at, COALESCE(a.submitted_at, CURRENT_TIMESTAMP(6))) AS time_used
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            JOIN users u ON u.id = a.student_user_id LEFT JOIN attempt_results r ON r.attempt_id = a.id
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
                row.put("unansweredCount", Math.max(0, questionCount - answered));
                row.put("completionRate", percent(answered, questionCount));
                row.put("accuracy", percent(rs.getLong("correct_count"), answered));
                row.put("timeUsed", rs.getInt("time_used"));
                row.put("estimated", rs.getObject("is_estimated") == null ? false : rs.getBoolean("is_estimated"));
                row.put("scoringMode", "RAW_ONLY");
                row.put("startedAt", local(rs.getTimestamp("started_at")));
                row.put("submittedAt", local(rs.getTimestamp("submitted_at")));
                return row;
            }, attemptId);
        report.put("questions", attemptQuestions(attemptId));
        Map<String, Object> sections = sectionScores(attemptId);
        report.putAll(sections);
        return report;
    }

    /** 学生报告复用管理报告的展示结构，但先验证本人归属并按可见策略清除答案与成绩字段。 */
    public Map<String, Object> studentAttemptResult(long attemptId, String username) {
        StudentReportAccess access = jdbcTemplate.query("""
            SELECT a.status, a.is_practice, e.answer_visibility, e.score_visibility, e.allow_review,
                   e.closes_at <= CURRENT_TIMESTAMP(6) AS exam_closed,
                   COALESCE(r.ungraded_count, 0) AS ungraded_count
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            JOIN users u ON u.id = a.student_user_id LEFT JOIN attempt_results r ON r.attempt_id = a.id
            WHERE a.id = ? AND u.username = ? AND u.role_code = 'STUDENT' AND p.exam_type_code = 'SHSAT'
            """, rs -> rs.next() ? new StudentReportAccess(rs.getString("status"), rs.getBoolean("is_practice"),
                rs.getString("answer_visibility"), rs.getString("score_visibility"), rs.getBoolean("allow_review"),
                rs.getBoolean("exam_closed"), rs.getInt("ungraded_count")) : null, attemptId, username);
        if (access == null) throw notFound("Attempt report not found.");
        if (!List.of("SUBMITTED", "COMPLETED", "EXPIRED").contains(access.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The exam report is not ready yet.");
        }

        boolean scoreVisible = access.practice() || (access.ungradedCount() == 0
            && ReportVisibilityPolicy.isVisible(access.scoreVisibility(), true, access.examClosed()));
        boolean answersVisible = access.practice() || (access.allowReview()
            && ReportVisibilityPolicy.isVisible(access.answerVisibility(), true, access.examClosed()));
        Map<String, Object> report = attemptResult(attemptId);
        report.put("scoreVisible", scoreVisible);
        report.put("answersVisible", answersVisible);
        report.put("reportVisible", true);
        StudentReportSanitizer.apply(report, scoreVisible, answersVisible, access.allowReview());
        return report;
    }

    public Map<String, Object> monitorLive(long examId) {
        ExamMonitor exam = requireShsatExam(examId);
        Map<String, Object> summary = jdbcTemplate.query("""
            SELECT COUNT(*) AS started,
                   SUM(a.status = 'IN_PROGRESS') AS in_progress,
                   SUM(a.status = 'SUBMITTED') AS submitted,
                   MAX(COALESCE(a.submitted_at, a.started_at)) AS last_seen
            FROM attempts a WHERE a.exam_id = ? AND a.is_practice = FALSE
            """, rs -> {
                rs.next();
                long started = rs.getLong("started");
                long inProgress = rs.getLong("in_progress");
                long submitted = rs.getLong("submitted");
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("activeAttempts", activeAttempts(examId));
                result.put("startedAttempts", started);
                result.put("totalStudents", Math.max(exam.participantCount(), started));
                result.put("inProgressAttempts", inProgress);
                result.put("finishedAttempts", submitted);
                result.put("inProgressStudents", inProgress);
                result.put("completedStudents", submitted);
                result.put("incompleteStudents", Math.max(0, Math.max(exam.participantCount(), started) - submitted));
                result.put("lastSeenAt", iso(rs.getTimestamp("last_seen")));
                return result;
            }, examId);
        List<Map<String, Object>> distribution = jdbcTemplate.query("""
            SELECT s.active_question_number AS question_number, COUNT(*) AS students
            FROM shsat_attempt_state s JOIN attempts a ON a.id = s.attempt_id
            WHERE a.exam_id = ? AND a.status = 'IN_PROGRESS' AND a.is_practice = FALSE AND s.active_question_number IS NOT NULL
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
        long started = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM attempts WHERE exam_id = ? AND is_practice = FALSE", Long.class, examId);
        List<Map<String, Object>> questions = jdbcTemplate.query("""
            SELECT pi.display_number, q.id AS question_id, q.question_type_code,
                   qm.skill_tag_code,
                   (SELECT COUNT(*) FROM attempt_items ai JOIN attempts a ON a.id = ai.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND ai.paper_item_id = pi.id) AS attempted,
                   (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id = pi.id AND aa.is_correct = TRUE) AS correct,
                   (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id = pi.id AND aa.is_correct = FALSE) AS wrong,
                   (SELECT AVG(NULLIF(aa.time_spent_seconds, 0)) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id = pi.id) AS average_time_spent
            FROM paper_sections ps JOIN paper_items pi ON pi.section_id = ps.id
            JOIN questions q ON q.id = pi.question_id
            LEFT JOIN shsat_question_metadata qm ON qm.question_id = q.id
            WHERE ps.paper_id = ? AND pi.display_number IS NOT NULL
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
                row.put("wrongCount", rs.getLong("wrong"));
                row.put("unansweredCount", Math.max(0, started - attempted));
                row.put("accuracy", percent(correct, attempted));
                row.put("averageTimeSpent", rs.getBigDecimal("average_time_spent"));
                row.put("shsatSubjectCode", null);
                row.put("skillTagCode", rs.getString("skill_tag_code"));
                row.put("materialId", null);
                row.put("materialTitle", null);
                return row;
            }, examId, examId, examId, examId, exam.paperId());
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
            WHERE ps.paper_id = ? AND pi.display_number = ? ORDER BY pi.id LIMIT 1
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
                   aa.awarded_points, aa.time_spent_seconds, qm.skill_tag_code, ps.section_code, ps.title AS section_title,
                   ps.section_kind, parent.section_code AS parent_section_code, parent.title AS parent_section_title
            FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN paper_sections ps ON ps.id = pi.section_id
            LEFT JOIN paper_sections parent ON parent.id = ps.parent_section_id
            JOIN questions q ON q.id = pi.question_id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            LEFT JOIN shsat_question_metadata qm ON qm.question_id = q.id
            WHERE ai.attempt_id = ? ORDER BY ai.served_order
            """, (rs, rowNum) -> {
                JsonNode render = readJson(rs.getString("render_json"));
                JsonNode selected = readJson(rs.getString("answer_json"));
                JsonNode answerKey = readJson(rs.getString("answer_key_json"));
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
                question.put("correctAnswer", answerKey.path("answer").asText(null));
                question.put("selectedAnswer", selected == null ? null : selected.path("value").asText(selected.asText(null)));
                question.put("answerData", selected == null ? null : selected.toString());
                question.put("correct", rs.getObject("is_correct") == null ? null : rs.getBoolean("is_correct"));
                question.put("score", rs.getBigDecimal("awarded_points"));
                question.put("maxScore", rs.getBigDecimal("max_points"));
                question.put("timeSpent", nullableInt(rs, "time_spent_seconds"));
                question.put("skillTagCode", rs.getString("skill_tag_code"));
                JsonNode material = render.path("material");
                question.put("material", material.isMissingNode() ? null : material);
                question.put("materialType", material.path("type").asText(null));
                question.put("materialTitle", material.path("title").asText(null));
                question.put("materialContent", material.path("content").asText(null));
                question.put("assetUrl", material.path("assetUrl").asText(null));
                return question;
            }, attemptId);
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
        row.put("attemptNumber", rs.getInt("attempt_no"));
        row.put("status", reportStatus(rs.getString("status")));
        row.put("totalScore", rs.getBigDecimal("total_points"));
        row.put("rawTotalScore", rs.getBigDecimal("total_points"));
        row.put("elaRawScore", rs.getBigDecimal("ela_score"));
        row.put("mathRawScore", rs.getBigDecimal("math_score"));
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
                    if ("ela".equals(key)) scores.put("elaRawMaxScore", nullableInt(rs, "raw_max_score"));
                    if ("math".equals(key)) scores.put("mathRawMaxScore", nullableInt(rs, "raw_max_score"));
                }
                return scores;
            }, attemptId);
    }

    private ExamMonitor requireShsatExam(long examId) {
        return jdbcTemplate.query("""
            SELECT e.id, p.id AS paper_id, e.title, e.opens_at, e.closes_at, e.duration_seconds,
                   (SELECT COUNT(*) FROM exam_participants ep WHERE ep.exam_id = e.id AND ep.revoked_at IS NULL) AS participants
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

    private record StudentReportAccess(String status, boolean practice, String answerVisibility, String scoreVisibility,
                                       boolean allowReview, boolean examClosed, int ungradedCount) { }
}
