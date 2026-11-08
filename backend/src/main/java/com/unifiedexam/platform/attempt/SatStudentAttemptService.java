package com.unifiedexam.platform.attempt;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** SAT/PSAT 正式考试适配层：将模块化考试状态映射到平台通用 attempt 与答案记录。 */
@Service
public class SatStudentAttemptService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final StudentAttemptService attempts;
    private final SatScoreScale scoreScale = new SatScoreScale();

    public SatStudentAttemptService(JdbcTemplate jdbc, ObjectMapper mapper, StudentAttemptService attempts) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.attempts = attempts;
    }

    /** 开始或续考：先由通用服务校验考试窗口、报名资格与次数，再初始化 SAT 模块状态。 */
    @Transactional(noRollbackFor = StudentAttemptService.ExpiredAttemptStartConflictException.class)
    public SatAttemptView start(long examId, String username) {
        // 与通用开考流程保持先锁考试、后锁尝试的顺序，避免并发续考时反向持锁。
        String examType = jdbc.query("""
            SELECT p.exam_type_code FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ? FOR UPDATE
            """, rs -> rs.next() ? rs.getString(1) : null, examId);
        if (!"SAT".equals(examType) && !"PSAT".equals(examType)) throw notFound("Exam not found.");
        boolean finalizedExpiredAttempt = finalizeExpiredAttempts(examId, username);
        StudentAttemptService.AttemptView attempt = finalizedExpiredAttempt
            ? attempts.startAfterExpiredSubmission(examId, username)
            : attempts.start(examId, null, username);
        ensureState(attempt.id(), attempt.paperId());
        return snapshot(attempt.id(), username);
    }

    /** 将已封存 SAT/PSAT 试卷映射到隐藏的练习场次，再复用统一作答生命周期。 */
    @Transactional
    public SatAttemptView startPractice(long paperId, String username) {
        long examId = practiceExamId(paperId, username);
        StudentAttemptService.AttemptView attempt = attempts.startPractice(examId, username);
        ensureState(attempt.id(), attempt.paperId());
        return snapshot(attempt.id(), username);
    }

    /** 提供包含题目的可用 SAT/PSAT 试卷。 */
    public List<PracticePaperView> practicePapers(String username) {
        return practicePapers(username, null);
    }

    public List<PracticePaperView> practicePapers(String username, String examTypeCode) {
        validatePracticeType(examTypeCode);
        requireStudent(username);
        return jdbc.query("""
            SELECT p.id, p.title, p.description, p.exam_type_code, p.default_duration_seconds,
                   g.name AS group_name, COUNT(pi.id) AS question_count
            FROM papers p LEFT JOIN paper_groups g ON g.id = p.group_id
            JOIN paper_sections s ON s.paper_id = p.id AND s.archived_key = 0
            LEFT JOIN paper_items pi ON pi.section_id = s.id AND pi.is_active = TRUE
            WHERE p.exam_type_code IN ('SAT', 'PSAT') AND (? IS NULL OR p.exam_type_code = ?) AND p.status <> 'ARCHIVED'
              AND (p.status = 'READY' OR EXISTS (SELECT 1 FROM sat_practice_paper_templates template WHERE template.paper_id = p.id)
                   OR EXISTS (SELECT 1 FROM exams published WHERE published.paper_id = p.id
                       AND published.status IN ('PUBLISHED', 'CLOSED') AND published.release_hidden_at IS NULL))
            GROUP BY p.id, p.title, p.description, p.exam_type_code, p.default_duration_seconds, g.name
            HAVING COUNT(pi.id) > 0
            ORDER BY g.sort_order, g.name, p.title, p.id
            """, (rs, row) -> new PracticePaperView(rs.getLong("id"), rs.getString("title"),
                rs.getString("description"), rs.getString("exam_type_code"), rs.getString("group_name"),
                nullableInt(rs, "default_duration_seconds"), rs.getInt("question_count")), examTypeCode, examTypeCode);
    }

    /** 返回学生本人已完成的练习历史，避免练习成绩混入正式考试成绩。 */
    public PracticeHistoryPage practiceHistory(String username, int page, int size) {
        return practiceHistory(username, page, size, null);
    }

    public PracticeHistoryPage practiceHistory(String username, int page, int size, String examTypeCode) {
        validatePracticeType(examTypeCode);
        requireStudent(username);
        int currentPage = Math.max(1, page);
        int pageSize = Math.max(1, Math.min(100, size));
        long studentId = jdbc.queryForObject("SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT'", Long.class, username);
        Long total = jdbc.queryForObject("""
            SELECT COUNT(*) FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            WHERE (? IS NULL OR p.exam_type_code = ?) AND a.student_user_id = ? AND a.is_practice = TRUE AND a.status = 'SUBMITTED'
              AND (EXISTS(SELECT 1 FROM sat_practice_papers spp WHERE spp.practice_exam_id = a.exam_id)
                OR EXISTS(SELECT 1 FROM sat_practice_paper_templates spt WHERE spt.practice_exam_id = a.exam_id))
            """, Long.class, examTypeCode, examTypeCode, studentId);
        List<PracticeAttemptView> records = jdbc.query("""
            SELECT a.id AS attempt_id, e.paper_id, p.title AS paper_title, p.exam_type_code, a.started_at,
                   a.submitted_at, ar.total_points, ar.max_points,
                   COALESCE(SUM(aa.time_spent_seconds), 0) AS time_spent_seconds
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            LEFT JOIN attempt_results ar ON ar.attempt_id = a.id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = a.id
            WHERE (? IS NULL OR p.exam_type_code = ?) AND a.student_user_id = ? AND a.is_practice = TRUE AND a.status = 'SUBMITTED'
              AND (EXISTS(SELECT 1 FROM sat_practice_papers spp WHERE spp.practice_exam_id = a.exam_id)
                OR EXISTS(SELECT 1 FROM sat_practice_paper_templates spt WHERE spt.practice_exam_id = a.exam_id))
            GROUP BY a.id, e.paper_id, p.title, p.exam_type_code, a.started_at, a.submitted_at, ar.total_points, ar.max_points
            ORDER BY a.submitted_at DESC, a.id DESC LIMIT ? OFFSET ?
            """, (rs, row) -> new PracticeAttemptView(rs.getLong("attempt_id"), rs.getLong("paper_id"),
                rs.getString("paper_title"), rs.getString("exam_type_code"), toInstant(rs.getTimestamp("started_at")),
                toInstant(rs.getTimestamp("submitted_at")), rs.getBigDecimal("total_points"),
                rs.getBigDecimal("max_points"), rs.getLong("time_spent_seconds")),
            examTypeCode, examTypeCode, studentId, pageSize, (currentPage - 1) * pageSize);
        long count = total == null ? 0 : total;
        return new PracticeHistoryPage(currentPage, pageSize, count, records);
    }

    // 旧调用仍可请求两个类型；工作区入口只接收明确的 SAT 或 PSAT。
    private void validatePracticeType(String code) {
        if (code != null && !List.of("SAT", "PSAT").contains(code)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported practice exam type.");
        }
    }

    private long practiceExamId(long paperId, String username) {
        requireStudent(username);
        Long studentId = jdbc.query("SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT' AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        PracticePaper paper = jdbc.query("""
            SELECT p.id, p.exam_type_code, p.title, p.status
            FROM papers p WHERE p.id = ? FOR UPDATE
            """, rs -> rs.next() ? new PracticePaper(rs.getLong("id"), rs.getString("exam_type_code"),
                rs.getString("title"), rs.getString("status")) : null, paperId);
        if (paper == null || !List.of("SAT", "PSAT").contains(paper.examTypeCode()) || "ARCHIVED".equals(paper.status())) {
            throw notFound("Practice paper not found.");
        }
        Long existing = jdbc.query("SELECT practice_exam_id FROM sat_practice_paper_templates WHERE paper_id = ?",
            rs -> rs.next() ? rs.getLong(1) : null, paperId);
        if (existing != null) return existing;
        // 保留既有练习权限；新试卷发布或结束后可练习，草稿不会自动向学生公开。
        Boolean released = jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM exams WHERE paper_id = ? AND status IN ('PUBLISHED', 'CLOSED')
                AND release_hidden_at IS NULL)
            """, Boolean.class, paperId);
        if (!"READY".equals(paper.status()) && !Boolean.TRUE.equals(released)) throw notFound("Practice paper not found.");

        jdbc.update("""
            INSERT INTO exams
                (paper_id, scoring_profile_id, title, description, status, target_scope, opens_at, closes_at,
                 duration_seconds, attempt_limit, answer_visibility, score_visibility, allow_review, created_by, published_at)
            SELECT id, default_scoring_profile_id, ?, 'Self practice', 'PUBLISHED', 'SELECTED',
                   TIMESTAMPADD(YEAR, -100, CURRENT_TIMESTAMP(6)), TIMESTAMPADD(YEAR, 100, CURRENT_TIMESTAMP(6)),
                   default_duration_seconds, 1, 'AFTER_SUBMIT', 'AFTER_SUBMIT', TRUE, ?, CURRENT_TIMESTAMP(6)
            FROM papers WHERE id = ?
            """, paper.title(), studentId, paperId);
        Long examId = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        jdbc.update("INSERT INTO sat_practice_paper_templates (paper_id, practice_exam_id) VALUES (?, ?)", paperId, examId);
        return examId;
    }

    private void requireStudent(String username) {
        Boolean student = jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM users WHERE username = ? AND role_code = 'STUDENT' AND status = 'ACTIVE')
            """, Boolean.class, username);
        if (!Boolean.TRUE.equals(student)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Student account required.");
    }

    /** 找回已过截止时间的 SAT/PSAT 尝试并按已保存答案交卷，避免通用开考逻辑先将其封存为不可评分的 EXPIRED。 */
    private boolean finalizeExpiredAttempts(long examId, String username) {
        List<DeadlineAttempt> expired = jdbc.query("""
            SELECT a.id, e.paper_id, a.status
            FROM attempts a
            JOIN exams e ON e.id = a.exam_id
            JOIN papers p ON p.id = e.paper_id
            JOIN users u ON u.id = a.student_user_id
            WHERE a.exam_id = ? AND u.username = ? AND p.exam_type_code IN ('SAT', 'PSAT')
              AND a.is_practice = FALSE AND a.status IN ('IN_PROGRESS', 'EXPIRED')
              AND a.expires_at <= CURRENT_TIMESTAMP(6)
            FOR UPDATE
            """, (rs, rowNum) -> new DeadlineAttempt(rs.getLong("id"), rs.getLong("paper_id"), rs.getString("status")),
            examId, username);
        expired.forEach(attempt -> forceSubmitAtDeadline(attempt.id(), username, attempt.paperId(), attempt.status()));
        return !expired.isEmpty();
    }

    /** 截止后用服务端已保存答案补齐未完成模块并统一评分；迟到的请求体不会覆盖答案快照。 */
    private void forceSubmitAtDeadline(long attemptId, String username, long paperId) {
        forceSubmitAtDeadline(attemptId, username, paperId, "IN_PROGRESS");
    }

    private void forceSubmitAtDeadline(long attemptId, String username, long paperId, String status) {
        List<Long> moduleIds = modules(paperId).stream().map(ModuleRow::id).toList();
        completeAtDeadline(attemptId, username, moduleIds, status);
    }

    /** 按试卷模块顺序锁定整场考试后调用统一评分入口，确保超时交卷沿用正式成绩与报告逻辑。 */
    void completeAtDeadline(long attemptId, String username, List<Long> moduleIds, String status) {
        ArrayNode completed = mapper.createArrayNode();
        moduleIds.forEach(completed::add);
        jdbc.update("""
            UPDATE sat_attempt_state SET active_module_section_id = NULL, module_started_at = NULL,
                completed_modules_json = CAST(? AS JSON), awaiting_break = FALSE
            WHERE attempt_id = ?
            """, json(completed), attemptId);
        if ("EXPIRED".equals(status)) {
            jdbc.update("UPDATE attempts SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'EXPIRED'", attemptId);
        }
        attempts.submit(attemptId, username);
    }

    private boolean isDeadlineReached(long attemptId) {
        Boolean reached = jdbc.queryForObject("""
            SELECT expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP(6)
            FROM attempts WHERE id = ?
            """, Boolean.class, attemptId);
        return Boolean.TRUE.equals(reached);
    }

    private boolean isUnfinished(String status) {
        return "IN_PROGRESS".equals(status) || "EXPIRED".equals(status);
    }

    private Integer nullableInt(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    @Transactional
    public SatAttemptView get(long attemptId, String username) {
        StudentAttemptService.AttemptView attempt = attempts.get(attemptId, username);
        requireSat(attempt.examTypeCode());
        ensureState(attemptId, attempt.paperId());
        SatState state = lockState(attemptId, username);
        if (isDeadlineReached(attemptId) && isUnfinished(state.status())) {
            forceSubmitAtDeadline(attemptId, username, state.paperId(), state.status());
        }
        return snapshot(attemptId, username);
    }

    public List<SatModule> modulesForStudent(long paperId, String username) {
        requirePaperAccess(paperId, username);
        return modules(paperId).stream().map(module -> new SatModule(module.id(), module.code(), module.title(),
            module.subject(), module.moduleNumber(), module.sortOrder(), module.durationSeconds(), module.questionCount())).toList();
    }

    public List<SatQuestion> questionsForStudent(long paperId, long moduleId, String username) {
        requirePaperAccess(paperId, username);
        Boolean belongs = jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM paper_sections WHERE id = ? AND paper_id = ? AND parent_section_id IS NULL)
            """, Boolean.class, moduleId, paperId);
        if (!Boolean.TRUE.equals(belongs)) throw notFound("SAT module not found.");
        return jdbc.query("""
            SELECT q.id AS question_id, q.question_type_code, q.stem, q.render_json, s.title AS section_title,
                   sm.content AS material_content, sm.file_url AS material_file_url
            FROM paper_items pi JOIN questions q ON q.id = pi.question_id
            JOIN paper_sections s ON s.id = pi.section_id
            LEFT JOIN sat_question_materials sqm ON sqm.question_id = q.id
            LEFT JOIN sat_materials sm ON sm.id = sqm.material_id
            WHERE pi.section_id = ? ORDER BY pi.sort_order, pi.id
            """, (rs, row) -> {
                JsonNode display = readJson(rs.getString("render_json"));
                JsonNode sat = display.path("sat");
                String material = rs.getString("material_content");
                String type = "SAT_FILL_IN_BLANK".equals(rs.getString("question_type_code")) ? "fill_blank" : "multiple_choice";
                return new SatQuestion(rs.getLong("question_id"), rs.getString("stem"), type, material,
                    display.path("options"), rs.getString("material_file_url"), rs.getString("material_file_url"),
                    new SatQuestionMetadata(sat.path("subject").asText("RW"), sat.path("typeName").asText("Multiple Choice")));
            }, moduleId);
    }

    public JsonNode questionDetailForStudent(long questionId, String username) {
        Boolean hasAccess = jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM attempts a JOIN exams e ON e.id = a.exam_id
                JOIN paper_items pi ON pi.question_id = ? JOIN paper_sections s ON s.id = pi.section_id AND s.paper_id = e.paper_id
                JOIN sat_attempt_state state ON state.attempt_id = a.id
                WHERE a.student_user_id = (SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT')
                  AND a.is_practice = FALSE AND (
                    (a.status = 'IN_PROGRESS' AND a.expires_at > CURRENT_TIMESTAMP(6)
                      AND state.active_module_section_id = pi.section_id AND state.awaiting_break = FALSE
                      AND state.module_started_at IS NOT NULL
                      AND TIMESTAMPDIFF(SECOND, state.module_started_at, CURRENT_TIMESTAMP(6))
                        < CAST(JSON_UNQUOTE(JSON_EXTRACT(s.settings_json, '$.timeLimitSeconds')) AS UNSIGNED))
                    OR (a.status = 'SUBMITTED' AND e.allow_review = TRUE
                      AND (e.answer_visibility = 'AFTER_SUBMIT' OR
                           (e.answer_visibility = 'AFTER_CLOSE' AND e.closes_at <= CURRENT_TIMESTAMP(6))))
                  ))
            """, Boolean.class, questionId, username);
        if (!Boolean.TRUE.equals(hasAccess)) throw notFound("Question not found.");
        return jdbc.query("""
            SELECT sm.title, sm.material_type, sm.content, sm.file_url
            FROM questions q LEFT JOIN sat_question_materials sqm ON sqm.question_id = q.id
            LEFT JOIN sat_materials sm ON sm.id = sqm.material_id WHERE q.id = ?
            """, rs -> {
                ObjectNode result = mapper.createObjectNode();
                if (rs.next() && rs.getObject("file_url") != null) {
                    ObjectNode material = result.putObject("material");
                    material.put("title", rs.getString("title"));
                    material.put("type", rs.getString("material_type"));
                    material.put("content", rs.getString("content"));
                    material.put("fileUrl", rs.getString("file_url"));
                }
                return result;
            }, questionId);
    }

    /** 构造旧 SAT 报告页的数据结构，同时只允许查看本人已提交的正式考试。 */
    public JsonNode report(long attemptId, String username) {
        return report(attemptId, username, false);
    }

    /** 管理员和教师从学生成绩页查看完整 SAT 报告，不受学生端的成绩开放时间限制。 */
    public JsonNode reportForStaff(long attemptId) {
        String username = jdbc.query("""
            SELECT u.username FROM attempts a JOIN users u ON u.id = a.student_user_id WHERE a.id = ?
            """, rs -> rs.next() ? rs.getString(1) : null, attemptId);
        if (username == null) throw notFound("Report not found.");
        return report(attemptId, username, true);
    }

    private JsonNode report(long attemptId, String username, boolean staffView) {
        StudentAttemptService.AttemptView attempt = attempts.get(attemptId, username);
        requireSat(attempt.examTypeCode());
        if (!"SUBMITTED".equalsIgnoreCase(attempt.status())) throw conflict("The exam report is not ready yet.");
        ObjectNode report = mapper.createObjectNode();
        ReportIdentity identity = jdbc.query("""
            SELECT u.real_name, e.title, p.title AS paper_title, p.id AS paper_id,
                   COALESCE((SELECT JSON_UNQUOTE(JSON_EXTRACT(question_json, '$.scoringTableCode'))
                       FROM sat_attempt_question_state WHERE attempt_id = a.id LIMIT 1), s.scoring_table_code) AS scoring_table_code,
                   r.algorithm_version, r.max_points AS legacy_max_points, d.source_score_json,
                   d.rw_module1_raw, d.rw_module2_raw, d.math_module1_raw, d.math_module2_raw,
                   d.rw_module1_seconds, d.rw_module2_seconds, d.math_module1_seconds, d.math_module2_seconds,
                   COALESCE(state.focus_violation_count, 0) AS focus_violation_count,
                   (e.score_visibility = 'AFTER_SUBMIT' OR
                    (e.score_visibility = 'AFTER_CLOSE' AND e.closes_at <= CURRENT_TIMESTAMP(6))) AS score_visible,
                   (e.allow_review AND (e.answer_visibility = 'AFTER_SUBMIT' OR
                    (e.answer_visibility = 'AFTER_CLOSE' AND e.closes_at <= CURRENT_TIMESTAMP(6)))) AS answers_visible
            FROM attempts a JOIN users u ON u.id = a.student_user_id JOIN exams e ON e.id = a.exam_id
            JOIN papers p ON p.id = e.paper_id JOIN sat_paper_settings s ON s.paper_id = p.id
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN sat_attempt_details d ON d.attempt_id = a.id
            LEFT JOIN sat_attempt_state state ON state.attempt_id = a.id
            WHERE a.id = ? AND u.username = ?
            """, rs -> rs.next() ? new ReportIdentity(rs.getString("real_name"), rs.getString("title"),
                rs.getString("paper_title"), rs.getLong("paper_id"), rs.getString("scoring_table_code"),
                rs.getInt("focus_violation_count"), rs.getBoolean("score_visible"), rs.getBoolean("answers_visible"),
                "SAT_LEGACY".equals(rs.getString("algorithm_version")), nullableInt(rs, "legacy_max_points"), rs.getString("source_score_json"),
                nullableInt(rs, "rw_module1_raw"), nullableInt(rs, "rw_module2_raw"),
                nullableInt(rs, "math_module1_raw"), nullableInt(rs, "math_module2_raw"),
                nullableInt(rs, "rw_module1_seconds"), nullableInt(rs, "rw_module2_seconds"),
                nullableInt(rs, "math_module1_seconds"), nullableInt(rs, "math_module2_seconds")) : null,
            attemptId, username);
        if (identity == null) throw notFound("Report not found.");
        if (staffView) {
            identity = new ReportIdentity(identity.studentName(), identity.examName(), identity.paperName(), identity.paperId(),
                identity.scoringType(), identity.focusViolationCount(), true, true, identity.legacyImported(), identity.legacyMaxPoints(),
                identity.sourceScoreJson(), identity.rw1Raw(), identity.rw2Raw(), identity.math1Raw(), identity.math2Raw(),
                identity.rw1Seconds(), identity.rw2Seconds(), identity.math1Seconds(), identity.math2Seconds());
        }
        if (!identity.scoreVisible()) throw conflict("The score report is not available yet.");
        boolean answerDetailsVisible = identity.answersVisible();

        ArrayNode answers = report.putArray("answers");
        Map<String, ModuleReportStats> statsByModule = new LinkedHashMap<>();
        Map<String, SkillReportStats> skills = new LinkedHashMap<>();
        String reportItemsSql = """
            SELECT pi.id AS item_id, q.id AS question_id,
                   COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.displayNumber')) AS UNSIGNED), pi.display_number) AS display_number,
                   COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.maxPoints')) AS DECIMAL(8,2)), pi.max_points) AS max_points,
                   COALESCE(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.stem')), q.stem) AS stem,
                   COALESCE(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.questionTypeCode')), q.question_type_code) AS question_type_code,
                   COALESCE(JSON_EXTRACT(sat_state.question_json, '$.render'), q.render_json) AS render_json,
                   COALESCE(JSON_EXTRACT(sat_state.question_json, '$.answerKey'), q.answer_key_json) AS answer_key_json,
                   CASE WHEN sat_state.question_json IS NOT NULL
                       THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.explanation')), 'null')
                       ELSE q.explanation END AS explanation,
                   COALESCE(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.sectionCode')), ps.section_code) AS section_code,
                   COALESCE(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.sectionTitle')), ps.title) AS module_title,
                   ps.id AS module_id,
                   COALESCE(JSON_EXTRACT(sat_state.question_json, '$.sectionSettings'), ps.settings_json) AS settings_json,
                   aa.answer_json, aa.is_correct, aa.time_spent_seconds,
                   CASE WHEN sat_state.question_json IS NOT NULL
                       THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.display.material.content')), 'null')
                       ELSE material.content END AS material_content,
                   CASE WHEN sat_state.question_json IS NOT NULL
                       THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(sat_state.question_json, '$.display.material.assetUrl')), 'null')
                       ELSE material.file_url END AS material_file_url
            FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN paper_sections ps ON ps.id = pi.section_id JOIN questions q ON q.id = pi.question_id
            LEFT JOIN sat_attempt_question_state sat_state
                ON sat_state.attempt_id = ai.attempt_id AND sat_state.paper_item_id = ai.paper_item_id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            LEFT JOIN sat_question_materials qm ON qm.question_id = q.id
            LEFT JOIN sat_materials material ON material.id = qm.material_id
            WHERE ai.attempt_id = ? ORDER BY ai.served_order
            """;
        // 这里需要自行遍历结果集；显式使用 ResultSetExtractor，避免被推断为逐行回调后跳过首行。
        ResultSetExtractor<Void> collectReportItems = rs -> {
            while (rs.next()) {
                JsonNode settings = readJson(rs.getString("settings_json"));
                JsonNode render = readJson(rs.getString("render_json"));
                JsonNode answer = readJson(rs.getString("answer_json"));
                JsonNode key = readJson(rs.getString("answer_key_json"));
                String subject = settings.path("subject").asText("RW").equalsIgnoreCase("MATH")
                    || settings.path("subject").asText("").equalsIgnoreCase("Math") ? "Math" : "RW";
                int moduleNumber = settings.path("moduleNumber").asInt(1);
                String module = ("Math".equals(subject) ? "Math" : "RW") + moduleNumber;
                int spend = rs.getInt("time_spent_seconds");
                Boolean correct = rs.getObject("is_correct") == null ? null : rs.getBoolean("is_correct");
                JsonNode chosen = answer.path("value");
                String tags = render.path("sat").path("tags").asText("");
                ArrayNode tagPath = mapper.createArrayNode();
                for (String tag : tags.split("[>/]") ) if (!tag.isBlank()) tagPath.add(tag.trim());
                if (answerDetailsVisible) {
                    ObjectNode row = answers.addObject();
                    row.put("questionId", rs.getLong("question_id"));
                    row.put("qid", rs.getLong("question_id"));
                    row.put("paperItemId", rs.getLong("item_id"));
                    row.put("module", module);
                    row.put("moduleId", rs.getLong("module_id"));
                    row.set("tagPath", tagPath);
                    row.put("tagLabel", tagPath.isEmpty() ? "Uncategorized" : tagPath.get(tagPath.size() - 1).asText());
                    row.put("spendSeconds", spend);
                    if (chosen.isMissingNode() || chosen.isNull()) row.putNull("chosen");
                    else row.put("chosen", chosen.asText(chosen.toString()));
                    if (correct == null) row.putNull("isCorrect"); else row.put("isCorrect", correct ? 1 : 0);
                    row.put("correct", key.path("correctAnswer").asText(""));
                    row.put("question", rs.getString("stem"));
                    row.set("options", render.path("options"));
                    row.put("materialContent", rs.getString("material_content"));
                    row.put("materialFileUrl", rs.getString("material_file_url"));
                    row.put("explanation", rs.getString("explanation"));

                    List<String> tagsForSkill = new ArrayList<>();
                    tagPath.forEach(tag -> tagsForSkill.add(tag.asText()));
                    String skillKey = tagsForSkill.isEmpty() ? "Uncategorized" : String.join(" > ", tagsForSkill);
                    SkillReportStats skill = skills.computeIfAbsent(skillKey, ignored -> new SkillReportStats(
                        List.copyOf(tagsForSkill), tagsForSkill.isEmpty() ? "Uncategorized" : tagsForSkill.get(tagsForSkill.size() - 1)));
                    skill.total++;
                    if (Boolean.TRUE.equals(correct)) skill.correct++;
                }
                ModuleReportStats moduleStats = statsByModule.computeIfAbsent(module, ignored -> new ModuleReportStats());
                moduleStats.questions++;
                moduleStats.spendSeconds += spend;
                if (Boolean.TRUE.equals(correct)) moduleStats.correct++;
            }
            return null;
        };
        jdbc.query(reportItemsSql, collectReportItems, attemptId);
        report.put("userName", identity.studentName());
        report.put("examName", identity.examName());
        report.put("paperName", identity.paperName());
        report.put("paperId", identity.paperId());
        report.put("scoringType", identity.scoringType());
        report.put("totalScore", reportMaxPoints(identity.scoringType(), identity.legacyImported(), identity.legacyMaxPoints()));
        Boolean reviewRound = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM review_practice_rounds WHERE attempt_id = ?)", Boolean.class, attemptId);
        report.put("mode", Boolean.TRUE.equals(reviewRound) ? "review" : attempt.practice() ? "practice" : "exam");
        report.put("abnormalCount", identity.focusViolationCount());
        report.put("answersVisible", identity.answersVisible());
        int paperQuestionCount = statsByModule.values().stream().mapToInt(value -> value.questions).sum();
        fillSummary(report.putObject("summary"), statsByModule, identity.scoringType(), paperQuestionCount);
        if (identity.legacyImported()) {
            applyLegacyReportSummary(report.path("summary"), readJson(identity.sourceScoreJson()),
                identity.rw1Raw(), identity.rw2Raw(), identity.math1Raw(), identity.math2Raw(),
                identity.rw1Seconds(), identity.rw2Seconds(), identity.math1Seconds(), identity.math2Seconds());
        }
        fillTimeAnalysis(report.putObject("timeAnalysis"), statsByModule);
        ArrayNode knowledge = report.putArray("knowledgeBreakdown");
        skills.values().forEach(skill -> {
            ObjectNode item = knowledge.addObject();
            item.set("tagPath", mapper.valueToTree(skill.tagPath()));
            item.put("label", skill.label());
            item.put("total", skill.total);
            item.put("correct", skill.correct);
            item.put("accuracy", skill.total == 0 ? 0 : Math.round((skill.correct * 1000.0) / skill.total) / 10.0);
        });
        return report;
    }

    /** 自动保存当前模块答案和标记；服务端拒绝在模块计时结束后继续改答案。 */
    @Transactional
    public SatAttemptView saveModule(long attemptId, long moduleId, ModuleSubmission submission, String username) {
        SatState state = lockState(attemptId, username);
        requireInProgress(state);
        requireActiveModule(state, moduleId);
        if (state.awaitingBreak()) throw conflict("Resume the break before continuing.");
        if (isDeadlineReached(attemptId)) {
            forceSubmitAtDeadline(attemptId, username, state.paperId());
            return snapshot(attemptId, username);
        }
        if (remainingSeconds(state) <= 0) throw conflict("This module has ended.");
        persistAnswers(attemptId, moduleId, submission.answers());
        if (submission.abnormalCount() != null) {
            jdbc.update("UPDATE sat_attempt_state SET focus_violation_count = GREATEST(focus_violation_count, ?) WHERE attempt_id = ?",
                submission.abnormalCount(), attemptId);
        }
        return snapshot(attemptId, username);
    }

    /** 交卷后立即封锁本模块，并推进到下一段；Reading and Writing 后进入旧 SAT 休息页。 */
    @Transactional
    public SatAttemptView submitModule(long attemptId, long moduleId, ModuleSubmission submission, String username) {
        SatState state = lockState(attemptId, username);
        if (contains(readArray(state.completedModulesJson()), moduleId)
                && ("IN_PROGRESS".equals(state.status()) || "SUBMITTED".equals(state.status()))) {
            return snapshot(attemptId, username);
        }
        requireInProgress(state);
        requireActiveModule(state, moduleId);
        if (state.awaitingBreak()) throw conflict("Resume the break before continuing.");
        if (isDeadlineReached(attemptId)) {
            forceSubmitAtDeadline(attemptId, username, state.paperId());
            return snapshot(attemptId, username);
        }
        // 到时后的客户端交卷只结束模块，不能用未保存的迟交答案覆盖服务端快照。
        if (remainingSeconds(state) > 0) persistAnswers(attemptId, moduleId, submission.answers());
        List<ModuleRow> modules = modulesForAttempt(state.attemptId(), state.paperId());
        int index = moduleIndex(modules, moduleId);
        if (index < 0) throw notFound("Module not found in this paper.");
        ArrayNode completed = readArray(state.completedModulesJson());
        if (!contains(completed, moduleId)) completed.add(moduleId);
        if (index + 1 == modules.size()) {
            jdbc.update("UPDATE sat_attempt_state SET active_module_section_id = NULL, module_started_at = NULL, completed_modules_json = CAST(? AS JSON) WHERE attempt_id = ?",
                json(completed), attemptId);
            attempts.submit(attemptId, username);
        } else {
            ModuleRow current = modules.get(index);
            ModuleRow next = modules.get(index + 1);
            boolean breakAfterReadingWriting = "RW".equals(current.subject()) && "MATH".equals(next.subject());
            jdbc.update("""
                UPDATE sat_attempt_state SET active_module_section_id = ?, module_started_at = ?,
                    completed_modules_json = CAST(? AS JSON), awaiting_break = ?
                WHERE attempt_id = ?
                """, breakAfterReadingWriting ? current.id() : next.id(),
                breakAfterReadingWriting ? null : Timestamp.from(Instant.now()), json(completed), breakAfterReadingWriting, attemptId);
        }
        return snapshot(attemptId, username);
    }

    /** Break 页面点击继续时才启用数学模块计时，避免刷新或停留时间消耗考试时长。 */
    @Transactional
    public SatAttemptView resumeBreak(long attemptId, String username) {
        SatState state = lockState(attemptId, username);
        if (!state.awaitingBreak()) {
            if ("IN_PROGRESS".equals(state.status()) && state.activeModuleId() != null) return snapshot(attemptId, username);
            if ("SUBMITTED".equals(state.status())) return snapshot(attemptId, username);
            throw conflict("There is no active break.");
        }
        if (isDeadlineReached(attemptId)) {
            forceSubmitAtDeadline(attemptId, username, state.paperId(), state.status());
            return snapshot(attemptId, username);
        }
        List<ModuleRow> modules = modulesForAttempt(state.attemptId(), state.paperId());
        int index = moduleIndex(modules, state.activeModuleId());
        if (index < 0 || index + 1 >= modules.size()) throw conflict("The next module is unavailable.");
        jdbc.update("""
            UPDATE sat_attempt_state SET active_module_section_id = ?, module_started_at = CURRENT_TIMESTAMP(6),
                awaiting_break = FALSE WHERE attempt_id = ?
            """, modules.get(index + 1).id(), attemptId);
        return snapshot(attemptId, username);
    }

    @Transactional
    public SatAttemptView updatePresence(long attemptId, int questionNumber, String username) {
        SatState state = lockState(attemptId, username);
        if (isDeadlineReached(attemptId) && isUnfinished(state.status())) {
            forceSubmitAtDeadline(attemptId, username, state.paperId(), state.status());
            return snapshot(attemptId, username);
        }
        if ("SUBMITTED".equals(state.status())) return snapshot(attemptId, username);
        requireInProgress(state);
        if (state.awaitingBreak() || state.activeModuleId() == null) {
            throw conflict("There is no active module to report.");
        }
        Integer questionCount = jdbc.queryForObject("""
            SELECT COUNT(*) FROM attempt_items ai
            JOIN paper_items pi ON pi.id = ai.paper_item_id
            WHERE ai.attempt_id = ? AND pi.section_id = ?
            """, Integer.class, attemptId, state.activeModuleId());
        if (questionCount == null || questionNumber > questionCount) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The current question is not in this module.");
        }
        jdbc.update("""
            INSERT INTO sat_attempt_presence
                (attempt_id, exam_id, active_module_section_id, active_question_number, question_entered_at, last_seen_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))
            ON DUPLICATE KEY UPDATE
                question_entered_at = IF(
                    active_module_section_id <=> VALUES(active_module_section_id)
                    AND active_question_number <=> VALUES(active_question_number),
                    question_entered_at, CURRENT_TIMESTAMP(6)),
                active_module_section_id = VALUES(active_module_section_id),
                active_question_number = VALUES(active_question_number),
                last_seen_at = CURRENT_TIMESTAMP(6)
            """, attemptId, state.examId(), state.activeModuleId(), questionNumber);
        return snapshot(attemptId, username);
    }

    @Transactional
    public SatAttemptView finish(long attemptId, String username) {
        SatState state = lockState(attemptId, username);
        if (isDeadlineReached(attemptId) && isUnfinished(state.status())) {
            forceSubmitAtDeadline(attemptId, username, state.paperId(), state.status());
            return snapshot(attemptId, username);
        }
        attempts.submit(attemptId, username);
        return snapshot(attemptId, username);
    }

    private SatAttemptView snapshot(long attemptId, String username) {
        StudentAttemptService.AttemptView attempt = attempts.get(attemptId, username);
        requireSat(attempt.examTypeCode());
        SatState state = state(attemptId);
        List<ModuleRow> moduleRows = modulesForAttempt(attempt.id(), attempt.paperId());
        List<SatModule> moduleViews = moduleRows.stream().map(module -> new SatModule(module.id(), module.code(),
            module.title(), module.subject(), module.moduleNumber(), module.sortOrder(), module.durationSeconds(), module.questionCount())).toList();
        long activeModuleId = state.activeModuleId() == null ? -1 : state.activeModuleId();
        ModuleRow active = moduleRows.stream().filter(module -> module.id() == activeModuleId).findFirst().orElse(null);
        List<SatQuestion> questions = active == null ? List.of() : attempt.questions().stream()
            .filter(question -> sectionBelongsToModule(question.sectionCode(), active.code()))
            .map(this::satQuestion).toList();
        List<SatSavedAnswer> savedAnswers = active == null ? List.of() : attempt.questions().stream()
            .filter(question -> sectionBelongsToModule(question.sectionCode(), active.code()) && question.answer() != null)
            .map(question -> savedAnswer(attemptId, question)).toList();
        boolean submitted = "SUBMITTED".equals(attempt.status());
        Integer restSnapshot = jdbc.query("""
            SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(question_json, '$.restTimeSeconds')) AS UNSIGNED)
            FROM sat_attempt_question_state WHERE attempt_id = ? LIMIT 1
            """, rs -> {
                if (!rs.next()) return null;
                Number value = (Number) rs.getObject(1);
                return value == null ? null : value.intValue();
            }, attemptId);
        int restSeconds = restSnapshot == null
            ? jdbc.queryForObject("SELECT rest_time_seconds FROM sat_paper_settings WHERE paper_id = ?", Integer.class, attempt.paperId())
            : restSnapshot;
        return new SatAttemptView(attempt.id(), attempt.examId(), attempt.paperId(), attempt.examTitle(), attempt.examTypeCode(),
            submitted ? "finished" : "ongoing", attempt.practice(), active == null ? null : active.id(), remainingSeconds(state),
            state.awaitingBreak(), restSeconds, state.focusViolationCount(), moduleViews, questions, savedAnswers);
    }

    private SatSavedAnswer savedAnswer(long attemptId, StudentAttemptService.AttemptQuestion question) {
        JsonNode answer = question.answer();
        JsonNode value = answer != null && answer.isObject() ? answer.path("value") : answer;
        AnswerMetadata metadata = jdbc.query("""
            SELECT time_spent_seconds, is_marked_for_review FROM attempt_answers
            WHERE attempt_id = ? AND paper_item_id = ?
            """, rs -> rs.next() ? new AnswerMetadata(rs.getInt(1), rs.getBoolean(2)) : new AnswerMetadata(0, false),
            attemptId, question.paperItemId());
        return new SatSavedAnswer(question.paperItemId(), value.isMissingNode() || value.isNull() ? null : value,
            metadata.timeSpentSeconds(), metadata.marked());
    }

    private SatQuestion satQuestion(StudentAttemptService.AttemptQuestion question) {
        JsonNode display = question.display() == null ? mapper.createObjectNode() : question.display();
        JsonNode sat = display.path("sat");
        JsonNode material = display.path("material");
        String type = "SAT_FILL_IN_BLANK".equals(question.questionTypeCode()) ? "fill_blank" : "multiple_choice";
        return new SatQuestion(question.paperItemId(), question.stem(), type, question.sectionTitle(),
            display.path("options"), material.path("content").asText(""), material.path("assetUrl").asText(""),
            new SatQuestionMetadata(sat.path("subject").asText("RW"), sat.path("typeName").asText("Multiple Choice")));
    }

    private void persistAnswers(long attemptId, long moduleId, List<AnswerInput> answers) {
        if (answers == null) return;
        for (AnswerInput answer : answers) {
            if (answer.questionId() == null) continue;
            Boolean belongs = jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
                    WHERE ai.attempt_id = ? AND pi.id = ? AND pi.section_id = ?)
                """, Boolean.class, attemptId, answer.questionId(), moduleId);
            if (!Boolean.TRUE.equals(belongs)) throw notFound("Question does not belong to the active module.");
            ObjectNode stored = mapper.createObjectNode();
            if (answer.answer() == null || answer.answer().isNull()) stored.putNull("value");
            else stored.set("value", answer.answer());
            jdbc.update("""
                INSERT INTO attempt_answers
                    (attempt_id, paper_item_id, answer_json, time_spent_seconds, is_marked_for_review)
                VALUES (?, ?, CAST(? AS JSON), ?, ?)
                ON DUPLICATE KEY UPDATE answer_json = VALUES(answer_json),
                    time_spent_seconds = VALUES(time_spent_seconds), is_marked_for_review = VALUES(is_marked_for_review),
                    answered_at = CURRENT_TIMESTAMP(6)
                """, attemptId, answer.questionId(), json(stored), Math.max(0, answer.spendSeconds() == null ? 0 : answer.spendSeconds()),
                Boolean.TRUE.equals(answer.isMarked()));
        }
    }

    private void ensureState(long attemptId, long paperId) {
        Boolean exists = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM sat_attempt_state WHERE attempt_id = ?)", Boolean.class, attemptId);
        if (Boolean.TRUE.equals(exists)) return;
        List<ModuleRow> modules = modules(paperId);
        if (modules.isEmpty()) throw conflict("This SAT paper has no modules.");
        jdbc.update("""
            INSERT INTO sat_attempt_state (attempt_id, active_module_section_id, module_started_at, completed_modules_json)
            VALUES (?, ?, CURRENT_TIMESTAMP(6), JSON_ARRAY())
            """, attemptId, modules.get(0).id());
    }

    private void requirePaperAccess(long paperId, String username) {
        Boolean allowed = jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM attempts a JOIN exams e ON e.id = a.exam_id
                JOIN papers p ON p.id = e.paper_id JOIN users u ON u.id = a.student_user_id
                WHERE p.id = ? AND u.username = ? AND u.role_code = 'STUDENT' AND a.is_practice = FALSE
                  AND a.status = 'SUBMITTED' AND e.allow_review = TRUE
                  AND (e.answer_visibility = 'AFTER_SUBMIT' OR
                       (e.answer_visibility = 'AFTER_CLOSE' AND e.closes_at <= CURRENT_TIMESTAMP(6))))
            """, Boolean.class, paperId, username);
        if (!Boolean.TRUE.equals(allowed)) throw notFound("SAT paper not found.");
    }

    private void fillSummary(ObjectNode summary, Map<String, ModuleReportStats> stats, String scoringType, int paperQuestionCount) {
        int rwCorrect = 0;
        int mathCorrect = 0;
        for (Map.Entry<String, ModuleReportStats> entry : stats.entrySet()) {
            String code = entry.getKey();
            ModuleReportStats module = entry.getValue();
            if (code.startsWith("RW")) rwCorrect += module.correct;
            else if (code.startsWith("Math")) mathCorrect += module.correct;
            String prefix = switch (code) {
                case "RW1" -> "rw1";
                case "RW2" -> "rw2";
                case "Math1" -> "math1";
                case "Math2" -> "math2";
                default -> null;
            };
            if (prefix != null) {
                summary.put(prefix + "Raw", module.correct);
                summary.put(prefix + "Spend", module.spendSeconds);
            }
        }
        int rwScaled = scoreScale.scaledTotal(scoringType, "RW", rwCorrect, paperQuestionCount);
        int mathScaled = scoreScale.scaledTotal(scoringType, "Math", mathCorrect, paperQuestionCount);
        summary.put("totalRaw", rwCorrect + mathCorrect);
        summary.put("ebrwScaled", rwScaled);
        summary.put("mathScaled", mathScaled);
        summary.put("totalScaled", rwScaled + mathScaled);
    }

    /** 已迁移报告保留原考试满分，新考试使用当前试卷评分类型。 */
    static int reportMaxPoints(String scoringType, boolean legacyImported, Integer legacyMaxPoints) {
        if (legacyImported && legacyMaxPoints != null && legacyMaxPoints > 0) return legacyMaxPoints;
        return "PSAT".equals(scoringType) ? 1520 : 1600;
    }

    /** 已导入尝试的总分以旧系统封存字段为准，避免与逐题答案计数冲突。 */
    static void applyLegacyReportSummary(JsonNode summaryNode, JsonNode sourceScore,
            Integer rw1Raw, Integer rw2Raw, Integer math1Raw, Integer math2Raw,
            Integer rw1Seconds, Integer rw2Seconds, Integer math1Seconds, Integer math2Seconds) {
        if (!(summaryNode instanceof ObjectNode summary)) return;
        int totalRaw = 0;
        putIfPresent(summary, "rw1Raw", rw1Raw); if (rw1Raw != null) totalRaw += rw1Raw;
        putIfPresent(summary, "rw2Raw", rw2Raw); if (rw2Raw != null) totalRaw += rw2Raw;
        putIfPresent(summary, "math1Raw", math1Raw); if (math1Raw != null) totalRaw += math1Raw;
        putIfPresent(summary, "math2Raw", math2Raw); if (math2Raw != null) totalRaw += math2Raw;
        if (rw1Raw != null && rw2Raw != null && math1Raw != null && math2Raw != null) summary.put("totalRaw", totalRaw);
        putIfPresent(summary, "rw1Spend", rw1Seconds);
        putIfPresent(summary, "rw2Spend", rw2Seconds);
        putIfPresent(summary, "math1Spend", math1Seconds);
        putIfPresent(summary, "math2Spend", math2Seconds);

        copyNumber(sourceScore, "rw_total_scaled", summary, "ebrwScaled");
        copyNumber(sourceScore, "math_total_scaled", summary, "mathScaled");
        copyNumber(sourceScore, "total_score", summary, "totalScaled");
    }

    private static void putIfPresent(ObjectNode target, String field, Integer value) {
        if (value != null) target.put(field, value);
    }

    private static void copyNumber(JsonNode source, String sourceField, ObjectNode target, String targetField) {
        JsonNode value = source.path(sourceField);
        if (value.isNumber()) target.set(targetField, value);
    }

    private void fillTimeAnalysis(ObjectNode analysis, Map<String, ModuleReportStats> stats) {
        int totalSeconds = stats.values().stream().mapToInt(value -> value.spendSeconds).sum();
        int totalQuestions = stats.values().stream().mapToInt(value -> value.questions).sum();
        analysis.put("totalSpendSeconds", totalSeconds);
        analysis.put("avgPerQuestionSeconds", totalQuestions == 0 ? 0 : totalSeconds / totalQuestions);
        analysis.put("correctAvgSeconds", 0);
        analysis.put("incorrectAvgSeconds", 0);
        analysis.put("hasQuestionTiming", true);
        ArrayNode modules = analysis.putArray("byModule");
        for (Map.Entry<String, ModuleReportStats> entry : stats.entrySet()) {
            ModuleReportStats value = entry.getValue();
            ObjectNode module = modules.addObject();
            module.put("module", entry.getKey());
            module.put("spendSeconds", value.spendSeconds);
            module.put("avgSeconds", value.questions == 0 ? 0 : value.spendSeconds / value.questions);
            module.put("questionCount", value.questions);
            module.put("correct", value.correct);
            module.put("accuracy", value.questions == 0 ? 0 : (value.correct * 100.0) / value.questions);
        }
        analysis.putArray("byQuestion");
    }

    private SatState state(long attemptId) {
        return jdbc.query("""
            SELECT state.attempt_id, e.id AS exam_id, e.paper_id, state.active_module_section_id,
                   state.module_started_at, state.completed_modules_json, state.awaiting_break,
                   state.focus_violation_count, e.duration_seconds, p.exam_type_code, a.status
            FROM sat_attempt_state state JOIN attempts a ON a.id = state.attempt_id
            JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            WHERE state.attempt_id = ?
            """, rs -> rs.next() ? new SatState(rs.getLong("attempt_id"), rs.getLong("exam_id"), rs.getLong("paper_id"), nullableLong(rs, "active_module_section_id"),
                rs.getTimestamp("module_started_at"),
                rs.getString("completed_modules_json"), rs.getBoolean("awaiting_break"), rs.getInt("focus_violation_count"),
                rs.getObject("duration_seconds") == null ? null : rs.getInt("duration_seconds"), rs.getString("exam_type_code"),
                rs.getString("status")) : null, attemptId);
    }

    private SatState lockState(long attemptId, String username) {
        StudentAttemptService.AttemptView owned = attempts.get(attemptId, username);
        requireSat(owned.examTypeCode());
        SatState state = jdbc.query("""
            SELECT state.attempt_id, e.id AS exam_id, e.paper_id, state.active_module_section_id,
                   state.module_started_at, state.completed_modules_json, state.awaiting_break,
                   state.focus_violation_count, e.duration_seconds, p.exam_type_code, a.status
            FROM sat_attempt_state state JOIN attempts a ON a.id = state.attempt_id
            JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            WHERE state.attempt_id = ? AND a.student_user_id = (
                SELECT id FROM users WHERE username = ? AND role_code IN ('STUDENT', 'ADMIN', 'TEACHER') AND status = 'ACTIVE'
            ) FOR UPDATE
            """, rs -> rs.next() ? new SatState(rs.getLong("attempt_id"), rs.getLong("exam_id"), rs.getLong("paper_id"), nullableLong(rs, "active_module_section_id"),
                rs.getTimestamp("module_started_at"),
                rs.getString("completed_modules_json"), rs.getBoolean("awaiting_break"), rs.getInt("focus_violation_count"),
                rs.getObject("duration_seconds") == null ? null : rs.getInt("duration_seconds"), rs.getString("exam_type_code"),
                rs.getString("status")) : null,
            attemptId, username);
        if (state == null) throw notFound("Attempt not found.");
        return state;
    }

    private List<ModuleRow> modules(long paperId) {
        return jdbc.query("""
            SELECT id, section_code, title, sort_order, settings_json,
                   (SELECT COUNT(*) FROM paper_items pi WHERE pi.section_id = paper_sections.id AND pi.is_active = TRUE) AS question_count
            FROM paper_sections WHERE paper_id = ? AND archived_key = 0 AND parent_section_id IS NULL
            ORDER BY sort_order, id
            """, (rs, row) -> {
                JsonNode settings = readJson(rs.getString("settings_json"));
                String subject = settings.path("subject").asText("RW").toUpperCase();
                int number = settings.path("moduleNumber").asInt(1);
                String code = rs.getString("section_code");
                return new ModuleRow(rs.getLong("id"), code, rs.getString("title"), subject, number,
                    rs.getInt("sort_order"), settings.path("timeLimitSeconds").asInt(1800), rs.getInt("question_count"));
            }, paperId);
    }

    /** 为正在作答的考试读取它实际获得的分段，支持编辑后同时保留旧版考试。 */
    private List<ModuleRow> modulesForAttempt(long attemptId, long paperId) {
        return jdbc.query("""
            SELECT DISTINCT section.id, section.section_code, section.title, section.sort_order, section.settings_json,
                   (SELECT COUNT(*) FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
                    WHERE ai.attempt_id = ? AND pi.section_id = section.id) AS question_count
            FROM attempt_items ai
            JOIN paper_items item ON item.id = ai.paper_item_id
            JOIN paper_sections section ON section.id = item.section_id
            WHERE ai.attempt_id = ? AND section.paper_id = ? AND section.parent_section_id IS NULL
            ORDER BY section.sort_order, section.id
            """, (rs, row) -> {
                JsonNode settings = readJson(rs.getString("settings_json"));
                String subject = settings.path("subject").asText("RW").toUpperCase();
                String code = rs.getString("section_code");
                return new ModuleRow(rs.getLong("id"), code, rs.getString("title"), subject,
                    settings.path("moduleNumber").asInt(1), rs.getInt("sort_order"),
                    settings.path("timeLimitSeconds").asInt(1800), rs.getInt("question_count"));
            }, attemptId, attemptId, paperId);
    }

    private int remainingSeconds(SatState state) {
        if (state.awaitingBreak() || state.moduleStartedAt() == null || state.activeModuleId() == null) return 0;
        ModuleRow active = modulesForAttempt(state.attemptId(), state.paperId()).stream()
            .filter(module -> module.id() == state.activeModuleId()).findFirst().orElse(null);
        if (active == null) return 0;
        Integer elapsed = jdbc.queryForObject("SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, ?, CURRENT_TIMESTAMP(6)))", Integer.class,
            state.moduleStartedAt());
        int moduleRemaining = Math.max(0, active.durationSeconds() - (elapsed == null ? 0 : elapsed));
        Integer deadlineRemaining = jdbc.queryForObject("""
            SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(6), expires_at))
            FROM attempts WHERE id = ?
            """, Integer.class, state.attemptId());
        return deadlineRemaining == null ? moduleRemaining : Math.min(moduleRemaining, deadlineRemaining);
    }

    private void requireActiveModule(SatState state, long moduleId) {
        if (state.activeModuleId() == null || state.activeModuleId() != moduleId) throw conflict("This module is locked.");
    }

    private void requireInProgress(SatState state) {
        if (!"IN_PROGRESS".equals(state.status())) throw conflict("This exam has already been submitted.");
    }

    private int moduleIndex(List<ModuleRow> modules, long moduleId) {
        for (int index = 0; index < modules.size(); index++) if (modules.get(index).id() == moduleId) return index;
        return -1;
    }

    private boolean sectionBelongsToModule(String sectionCode, String moduleCode) { return moduleCode.equals(sectionCode); }
    private boolean contains(ArrayNode values, long id) { for (JsonNode value : values) if (value.asLong() == id) return true; return false; }
    private ArrayNode readArray(String value) { try { return (ArrayNode) mapper.readTree(value); } catch (Exception ignored) { return mapper.createArrayNode(); } }
    private JsonNode readJson(String value) { try { return value == null ? mapper.createObjectNode() : mapper.readTree(value); } catch (JsonProcessingException ex) { throw new IllegalStateException("Saved SAT module settings are invalid.", ex); } }
    private String json(Object value) { try { return mapper.writeValueAsString(value); } catch (JsonProcessingException ex) { throw new IllegalArgumentException("Could not encode SAT exam data.", ex); } }
    private Long nullableLong(java.sql.ResultSet rs, String field) throws java.sql.SQLException { long value = rs.getLong(field); return rs.wasNull() ? null : value; }
    private void requireSat(String code) { if (!"SAT".equals(code) && !"PSAT".equals(code)) throw notFound("SAT exam not found."); }
    private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
    private ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }

    public record AnswerInput(Long questionId, JsonNode answer, Integer spendSeconds, Boolean isMarked) {
    }
    public record ModuleSubmission(List<AnswerInput> answers, Integer abnormalCount) { }
    public record SatModule(long id, String moduleCode, String moduleName, String subject, int moduleNumber,
            int sortOrder, int durationSeconds, int questionCount) { }
    public record SatQuestion(long id, String question, String type, String passage, JsonNode options,
            String materialFileUrl, String fileUrl, SatQuestionMetadata metadata) { }
    public record SatQuestionMetadata(String subject, String typeName) { }
    public record SatSavedAnswer(long questionId, JsonNode answer, int spendSeconds, boolean isMarked) { }
    public record SatAttemptView(long attemptId, long examId, long paperId, String examTitle, String examTypeCode,
            String status, boolean practice, Long currentModuleId, int remainingSeconds, boolean awaitingBreak, int restTimeSeconds,
            int abnormalCount, List<SatModule> modules, List<SatQuestion> questions, List<SatSavedAnswer> savedAnswers) { }
    public record PracticePaperView(long id, String title, String description, String examTypeCode, String groupName,
            Integer durationSeconds, int questionCount) { }
    public record PracticeHistoryPage(int current, int size, long total, List<PracticeAttemptView> records) { }
    public record PracticeAttemptView(long attemptId, long paperId, String paperTitle, String examTypeCode,
                                      Instant startedAt, Instant submittedAt, java.math.BigDecimal rawScore,
                                      java.math.BigDecimal rawMaximum, long timeSpentSeconds) { }

    private record PracticePaper(long id, String examTypeCode, String title, String status) { }
    private record DeadlineAttempt(long id, long paperId, String status) { }
    private record SatState(long attemptId, long examId, long paperId, Long activeModuleId, Timestamp moduleStartedAt,
            String completedModulesJson, boolean awaitingBreak, int focusViolationCount, Integer examDurationSeconds,
            String examTypeCode, String status) { }
    private record ModuleRow(long id, String code, String title, String subject, int moduleNumber,
            int sortOrder, int durationSeconds, int questionCount) { }
    private record AnswerMetadata(int timeSpentSeconds, boolean marked) { }
    private record ReportIdentity(String studentName, String examName, String paperName, long paperId,
            String scoringType, int focusViolationCount, boolean scoreVisible, boolean answersVisible,
            boolean legacyImported, Integer legacyMaxPoints, String sourceScoreJson, Integer rw1Raw, Integer rw2Raw, Integer math1Raw,
            Integer math2Raw, Integer rw1Seconds, Integer rw2Seconds, Integer math1Seconds, Integer math2Seconds) { }
    private static final class ModuleReportStats {
        private int questions;
        private int correct;
        private int spendSeconds;
    }
    private static final class SkillReportStats {
        private final List<String> tagPath;
        private final String label;
        private int total;
        private int correct;

        private SkillReportStats(List<String> tagPath, String label) {
            this.tagPath = tagPath;
            this.label = label;
        }

        private List<String> tagPath() { return tagPath; }
        private String label() { return label; }
    }
}
