package com.unifiedexam.platform.attempt;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
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
    @Transactional
    public SatAttemptView start(long examId, String username) {
        String examType = jdbc.query("""
            SELECT p.exam_type_code FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ?
            """, rs -> rs.next() ? rs.getString(1) : null, examId);
        if (!"SAT".equals(examType) && !"PSAT".equals(examType)) throw notFound("Exam not found.");
        StudentAttemptService.AttemptView attempt = attempts.start(examId, null, username);
        ensureState(attempt.id(), attempt.paperId());
        return snapshot(attempt.id(), username);
    }

    public SatAttemptView get(long attemptId, String username) {
        StudentAttemptService.AttemptView attempt = attempts.get(attemptId, username);
        requireSat(attempt.examTypeCode());
        ensureState(attemptId, attempt.paperId());
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
                WHERE a.student_user_id = (SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT')
                  AND a.is_practice = FALSE)
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
        StudentAttemptService.AttemptView attempt = attempts.get(attemptId, username);
        requireSat(attempt.examTypeCode());
        if (!"SUBMITTED".equalsIgnoreCase(attempt.status())) throw conflict("The exam report is not ready yet.");
        ObjectNode report = mapper.createObjectNode();
        ReportIdentity identity = jdbc.query("""
            SELECT u.display_name, e.title, p.title AS paper_title, p.id AS paper_id, s.scoring_table_code,
                   COALESCE(state.focus_violation_count, 0) AS focus_violation_count,
                   (e.score_visibility = 'AFTER_SUBMIT' OR
                    (e.score_visibility = 'AFTER_CLOSE' AND e.closes_at <= CURRENT_TIMESTAMP(6))) AS score_visible,
                   (e.allow_review AND (e.answer_visibility = 'AFTER_SUBMIT' OR
                    (e.answer_visibility = 'AFTER_CLOSE' AND e.closes_at <= CURRENT_TIMESTAMP(6)))) AS answers_visible
            FROM attempts a JOIN users u ON u.id = a.student_user_id JOIN exams e ON e.id = a.exam_id
            JOIN papers p ON p.id = e.paper_id JOIN sat_paper_settings s ON s.paper_id = p.id
            LEFT JOIN sat_attempt_state state ON state.attempt_id = a.id
            WHERE a.id = ? AND u.username = ?
            """, rs -> rs.next() ? new ReportIdentity(rs.getString("display_name"), rs.getString("title"),
                rs.getString("paper_title"), rs.getLong("paper_id"), rs.getString("scoring_table_code"),
                rs.getInt("focus_violation_count"), rs.getBoolean("score_visible"), rs.getBoolean("answers_visible")) : null,
            attemptId, username);
        if (identity == null) throw notFound("Report not found.");
        if (!identity.scoreVisible()) throw conflict("The score report is not available yet.");

        ArrayNode answers = report.putArray("answers");
        Map<String, ModuleReportStats> statsByModule = new LinkedHashMap<>();
        Map<String, SkillReportStats> skills = new LinkedHashMap<>();
        jdbc.query("""
            SELECT pi.id AS item_id, q.id AS question_id, pi.display_number, pi.max_points, q.stem, q.question_type_code,
                   q.render_json, q.answer_key_json, q.explanation, ps.section_code, ps.title AS module_title,
                   ps.id AS module_id, ps.settings_json, aa.answer_json, aa.is_correct, aa.time_spent_seconds
            FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN paper_sections ps ON ps.id = pi.section_id JOIN questions q ON q.id = pi.question_id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            WHERE ai.attempt_id = ? ORDER BY ai.served_order
            """, rs -> {
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
                    if (identity.answersVisible()) {
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
            }, attemptId);
        report.put("userName", identity.studentName());
        report.put("examName", identity.examName());
        report.put("paperName", identity.paperName());
        report.put("paperId", identity.paperId());
        report.put("scoringType", identity.scoringType());
        report.put("totalScore", "PSAT".equals(identity.scoringType()) ? 1520 : 1600);
        report.put("mode", "exam");
        report.put("abnormalCount", identity.focusViolationCount());
        report.put("answersVisible", identity.answersVisible());
        int paperQuestionCount = statsByModule.values().stream().mapToInt(value -> value.questions).sum();
        fillSummary(report.putObject("summary"), statsByModule, identity.scoringType(), paperQuestionCount);
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
        requireInProgress(state);
        requireActiveModule(state, moduleId);
        if (state.awaitingBreak()) throw conflict("Resume the break before continuing.");
        // 到时后的客户端交卷只结束模块，不能用未保存的迟交答案覆盖服务端快照。
        if (remainingSeconds(state) > 0) persistAnswers(attemptId, moduleId, submission.answers());
        List<ModuleRow> modules = modules(state.paperId());
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
                    active_question_number = NULL, completed_modules_json = CAST(? AS JSON), awaiting_break = ?
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
        if (!state.awaitingBreak()) throw conflict("There is no active break.");
        List<ModuleRow> modules = modules(state.paperId());
        int index = moduleIndex(modules, state.activeModuleId());
        if (index < 0 || index + 1 >= modules.size()) throw conflict("The next module is unavailable.");
        jdbc.update("""
            UPDATE sat_attempt_state SET active_module_section_id = ?, module_started_at = CURRENT_TIMESTAMP(6),
                active_question_number = NULL, awaiting_break = FALSE WHERE attempt_id = ?
            """, modules.get(index + 1).id(), attemptId);
        return snapshot(attemptId, username);
    }

    @Transactional
    public SatAttemptView updatePresence(long attemptId, int questionNumber, String username) {
        SatState state = lockState(attemptId, username);
        jdbc.update("UPDATE sat_attempt_state SET active_question_number = ? WHERE attempt_id = ? AND awaiting_break = FALSE",
            questionNumber, attemptId);
        return snapshot(attemptId, username);
    }

    @Transactional
    public int recordFocusViolation(long attemptId, String username) {
        lockState(attemptId, username);
        jdbc.update("UPDATE sat_attempt_state SET focus_violation_count = focus_violation_count + 1 WHERE attempt_id = ?", attemptId);
        return jdbc.queryForObject("SELECT focus_violation_count FROM sat_attempt_state WHERE attempt_id = ?", Integer.class, attemptId);
    }

    @Transactional
    public SatAttemptView finish(long attemptId, String username) {
        lockState(attemptId, username);
        attempts.submit(attemptId, username);
        return snapshot(attemptId, username);
    }

    private SatAttemptView snapshot(long attemptId, String username) {
        StudentAttemptService.AttemptView attempt = attempts.get(attemptId, username);
        requireSat(attempt.examTypeCode());
        SatState state = state(attemptId);
        List<ModuleRow> moduleRows = modules(attempt.paperId());
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
        int restSeconds = jdbc.queryForObject("SELECT rest_time_seconds FROM sat_paper_settings WHERE paper_id = ?", Integer.class, attempt.paperId());
        return new SatAttemptView(attempt.id(), attempt.examId(), attempt.paperId(), attempt.examTitle(), attempt.examTypeCode(),
            submitted ? "finished" : "ongoing", active == null ? null : active.id(), remainingSeconds(state),
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
                  AND a.status = 'SUBMITTED' AND e.allow_review = TRUE)
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
            SELECT a.paper_id, state.active_module_section_id, state.active_question_number,
                   state.module_started_at, state.completed_modules_json, state.awaiting_break,
                   state.focus_violation_count, e.duration_seconds, p.exam_type_code, a.status
            FROM sat_attempt_state state JOIN attempts a ON a.id = state.attempt_id
            JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            WHERE state.attempt_id = ?
            """, rs -> rs.next() ? new SatState(rs.getLong("paper_id"), nullableLong(rs, "active_module_section_id"),
                (Integer) rs.getObject("active_question_number"), rs.getTimestamp("module_started_at"),
                rs.getString("completed_modules_json"), rs.getBoolean("awaiting_break"), rs.getInt("focus_violation_count"),
                rs.getObject("duration_seconds") == null ? null : rs.getInt("duration_seconds"), rs.getString("exam_type_code"),
                rs.getString("status")) : null, attemptId);
    }

    private SatState lockState(long attemptId, String username) {
        StudentAttemptService.AttemptView owned = attempts.get(attemptId, username);
        requireSat(owned.examTypeCode());
        SatState state = jdbc.query("""
            SELECT a.paper_id, state.active_module_section_id, state.active_question_number,
                   state.module_started_at, state.completed_modules_json, state.awaiting_break,
                   state.focus_violation_count, e.duration_seconds, p.exam_type_code, a.status
            FROM sat_attempt_state state JOIN attempts a ON a.id = state.attempt_id
            JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            WHERE state.attempt_id = ? AND a.student_user_id = (
                SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT' AND status = 'ACTIVE'
            ) FOR UPDATE
            """, rs -> rs.next() ? new SatState(rs.getLong("paper_id"), nullableLong(rs, "active_module_section_id"),
                (Integer) rs.getObject("active_question_number"), rs.getTimestamp("module_started_at"),
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
                   (SELECT COUNT(*) FROM paper_items pi WHERE pi.section_id = paper_sections.id) AS question_count
            FROM paper_sections WHERE paper_id = ? AND parent_section_id IS NULL
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

    private int remainingSeconds(SatState state) {
        if (state.awaitingBreak() || state.moduleStartedAt() == null || state.activeModuleId() == null) return 0;
        ModuleRow active = modules(state.paperId()).stream().filter(module -> module.id() == state.activeModuleId()).findFirst().orElse(null);
        if (active == null) return 0;
        Integer elapsed = jdbc.queryForObject("SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, ?, CURRENT_TIMESTAMP(6)))", Integer.class,
            state.moduleStartedAt());
        return Math.max(0, active.durationSeconds() - (elapsed == null ? 0 : elapsed));
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
            String status, Long currentModuleId, int remainingSeconds, boolean awaitingBreak, int restTimeSeconds,
            int abnormalCount, List<SatModule> modules, List<SatQuestion> questions, List<SatSavedAnswer> savedAnswers) { }

    private record SatState(long paperId, Long activeModuleId, Integer activeQuestionNumber, Timestamp moduleStartedAt,
            String completedModulesJson, boolean awaitingBreak, int focusViolationCount, Integer examDurationSeconds,
            String examTypeCode, String status) { }
    private record ModuleRow(long id, String code, String title, String subject, int moduleNumber,
            int sortOrder, int durationSeconds, int questionCount) { }
    private record AnswerMetadata(int timeSpentSeconds, boolean marked) { }
    private record ReportIdentity(String studentName, String examName, String paperName, long paperId,
            String scoringType, int focusViolationCount, boolean scoreVisible, boolean answersVisible) { }
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
