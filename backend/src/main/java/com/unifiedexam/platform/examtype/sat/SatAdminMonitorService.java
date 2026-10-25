package com.unifiedexam.platform.examtype.sat;

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

/** SAT/PSAT 管理监考报表；题号统一按试卷顺序生成，避免模块内重复题号覆盖图表。 */
@Service
public class SatAdminMonitorService {
    private static final int PRESENCE_TIMEOUT_SECONDS = 30;

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public SatAdminMonitorService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Map<String, Object> live(long examId) {
        Exam exam = requireSatExam(examId);
        Long activeAttempts = jdbc.queryForObject("""
            SELECT COUNT(DISTINCT a.id) FROM sat_attempt_presence presence
            JOIN attempts a ON a.id = presence.attempt_id AND a.exam_id = presence.exam_id
            WHERE presence.exam_id = ? AND a.is_practice = FALSE AND a.status = 'IN_PROGRESS'
              AND presence.active_module_section_id IS NOT NULL
              AND presence.last_seen_at >= DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND)
              AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP(6))
            """, Long.class, examId, PRESENCE_TIMEOUT_SECONDS);
        Map<String, Object> summary = jdbc.query("""
            SELECT COUNT(*) AS started,
                   COALESCE(SUM(a.status = 'IN_PROGRESS'), 0) AS in_progress,
                   COALESCE(SUM(a.status = 'SUBMITTED'), 0) AS submitted,
                   MAX(COALESCE(a.submitted_at, a.started_at)) AS last_seen
            FROM attempts a WHERE a.exam_id = ? AND a.is_practice = FALSE
            """, rs -> {
            rs.next();
            long started = rs.getLong("started");
            long submitted = rs.getLong("submitted");
            long participants = Math.max(exam.participants(), started);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("activeAttempts", activeAttempts == null ? 0 : activeAttempts);
            row.put("startedAttempts", started);
            row.put("totalStudents", participants);
            row.put("inProgressAttempts", rs.getLong("in_progress"));
            row.put("finishedAttempts", submitted);
            row.put("inProgressStudents", activeAttempts == null ? 0 : activeAttempts);
            row.put("completedStudents", submitted);
            row.put("incompleteStudents", Math.max(0, participants - submitted));
            row.put("lastSeenAt", iso(rs.getTimestamp("last_seen")));
            return row;
        }, examId);

        List<Map<String, Object>> distribution = jdbc.query("""
            SELECT presence.active_module_section_id, presence.active_question_number, COUNT(*) AS students,
                   (SELECT COUNT(*) FROM paper_items pi JOIN paper_sections prev ON prev.id = pi.section_id
                    WHERE prev.paper_id = ? AND (prev.sort_order < active.sort_order
                        OR (prev.sort_order = active.sort_order AND prev.id < active.id))) AS question_offset
            FROM sat_attempt_presence presence JOIN attempts a
                ON a.id = presence.attempt_id AND a.exam_id = presence.exam_id
            JOIN paper_sections active ON active.id = presence.active_module_section_id
            WHERE a.exam_id = ? AND a.is_practice = FALSE AND a.status = 'IN_PROGRESS'
              AND presence.active_question_number IS NOT NULL
              AND presence.last_seen_at >= DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND)
              AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP(6))
            GROUP BY presence.active_module_section_id, presence.active_question_number, active.sort_order, active.id
            ORDER BY question_offset, presence.active_question_number
            """, (rs, rowNum) -> Map.of("questionNumber", rs.getInt("question_offset") + rs.getInt("active_question_number"),
                "students", rs.getLong("students")), exam.paperId(), examId, PRESENCE_TIMEOUT_SECONDS);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("exam", exam.view());
        payload.put("summary", summary);
        payload.put("currentQuestionDistribution", distribution);
        payload.put("generatedAt", LocalDateTime.now());
        return payload;
    }

    public Map<String, Object> analytics(long examId) {
        Exam exam = requireSatExam(examId);
        long started = jdbc.queryForObject("SELECT COUNT(*) FROM attempts WHERE exam_id = ? AND is_practice = FALSE", Long.class, examId);
        List<Map<String, Object>> questions = jdbc.query("""
            SELECT ROW_NUMBER() OVER (ORDER BY ps.sort_order, ps.id, pi.sort_order, pi.id) AS question_number,
                   q.id AS question_id, q.question_type_code,
                   (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id = pi.id
                      AND JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.value')) <> 'NULL'
                      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(aa.answer_json, '$.value')), '') <> '') AS attempted,
                   (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id = pi.id AND aa.is_correct = TRUE
                      AND JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.value')) <> 'NULL'
                      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(aa.answer_json, '$.value')), '') <> '') AS correct,
                   (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id = pi.id AND aa.is_correct = FALSE
                      AND JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.value')) <> 'NULL'
                      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(aa.answer_json, '$.value')), '') <> '') AS wrong,
                   (SELECT AVG(NULLIF(aa.time_spent_seconds, 0)) FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
                    WHERE a.exam_id = ? AND a.is_practice = FALSE AND aa.paper_item_id = pi.id) AS average_time_spent
            FROM paper_sections ps JOIN paper_items pi ON pi.section_id = ps.id JOIN questions q ON q.id = pi.question_id
            WHERE ps.paper_id = ? ORDER BY ps.sort_order, ps.id, pi.sort_order, pi.id
            """, (rs, rowNum) -> {
            long attempted = rs.getLong("attempted");
            long correct = rs.getLong("correct");
            long wrong = rs.getLong("wrong");
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("questionId", rs.getLong("question_id"));
            row.put("questionNumber", rs.getInt("question_number"));
            row.put("questionType", rs.getString("question_type_code"));
            row.put("attemptedCount", attempted);
            row.put("attempted", attempted);
            row.put("correctCount", correct);
            row.put("wrongCount", wrong);
            row.put("pendingCount", Math.max(0, attempted - correct - wrong));
            row.put("unansweredCount", Math.max(0, started - attempted));
            row.put("accuracy", percent(correct, correct + wrong));
            row.put("averageTimeSpent", rs.getBigDecimal("average_time_spent"));
            return row;
        }, examId, examId, examId, examId, exam.paperId());
        return Map.of("questionAnalytics", questions, "generatedAt", LocalDateTime.now());
    }

    public Map<String, Object> question(long examId, int questionNumber) {
        Exam exam = requireSatExam(examId);
        Map<String, Object> question = jdbc.query("""
            SELECT q.id, q.stem, q.question_type_code, q.render_json, q.answer_key_json, q.explanation,
                   sm.title AS material_title, sm.material_type, sm.content AS material_content, sm.file_url
            FROM (SELECT pi.*, ROW_NUMBER() OVER (ORDER BY ps.sort_order, ps.id, pi.sort_order, pi.id) AS question_number
                  FROM paper_sections ps JOIN paper_items pi ON pi.section_id = ps.id WHERE ps.paper_id = ?) ordered_items
            JOIN paper_items pi ON pi.id = ordered_items.id JOIN questions q ON q.id = pi.question_id
            LEFT JOIN sat_question_materials sqm ON sqm.question_id = q.id
            LEFT JOIN sat_materials sm ON sm.id = sqm.material_id
            WHERE ordered_items.question_number = ?
            """, rs -> rs.next() ? questionView(rs, questionNumber) : null, exam.paperId(), questionNumber);
        if (question == null) throw notFound("Question not found in this exam.");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("question", question);
        payload.put("material", question.get("material"));
        return payload;
    }

    private Map<String, Object> questionView(ResultSet rs, int number) throws SQLException {
        JsonNode render = readJson(rs.getString("render_json"));
        JsonNode answer = readJson(rs.getString("answer_key_json"));
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("questionId", rs.getLong("id"));
        view.put("questionNumber", number);
        view.put("questionType", rs.getString("question_type_code"));
        view.put("stem", rs.getString("stem"));
        view.put("options", render.path("options"));
        view.put("questionConfig", render.path("questionConfig"));
        view.put("validationRules", render.path("validationRules"));
        view.put("correctAnswerData", answer);
        view.put("correctAnswer", answer.path("correctAnswer").asText(null));
        view.put("explanation", rs.getString("explanation"));
        JsonNode sat = render.path("sat");
        view.put("subject", sat.path("subject").asText(""));
        view.put("skillTags", sat.path("tags").asText(""));
        Object material = rs.getObject("file_url") == null && rs.getObject("material_content") == null ? null : Map.of(
            "title", rs.getString("material_title") == null ? "" : rs.getString("material_title"),
            "type", rs.getString("material_type") == null ? "text" : rs.getString("material_type"),
            "materialContent", rs.getString("material_content") == null ? "" : rs.getString("material_content"),
            "assetUrl", rs.getString("file_url") == null ? "" : rs.getString("file_url"));
        view.put("material", material);
        return view;
    }

    private Exam requireSatExam(long examId) {
        return jdbc.query("""
            SELECT e.id, p.id AS paper_id, p.exam_type_code, e.title, e.opens_at, e.closes_at, e.duration_seconds,
                   (SELECT COUNT(*) FROM exam_participants ep WHERE ep.exam_id = e.id AND ep.revoked_at IS NULL) AS participants
            FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ? AND p.exam_type_code IN ('SAT', 'PSAT')
            """, rs -> {
            if (!rs.next()) throw notFound("SAT exam not found.");
            return new Exam(rs.getLong("id"), rs.getLong("paper_id"), rs.getString("exam_type_code"), rs.getString("title"),
                rs.getTimestamp("opens_at"), rs.getTimestamp("closes_at"), rs.getObject("duration_seconds", Integer.class),
                rs.getLong("participants"));
        }, examId);
    }

    private JsonNode readJson(String value) {
        if (value == null || value.isBlank()) return mapper.nullNode();
        try { return mapper.readTree(value); } catch (Exception ignored) { return mapper.nullNode(); }
    }

    private BigDecimal percent(long numerator, long denominator) {
        if (denominator == 0) return null;
        return BigDecimal.valueOf(numerator * 100.0 / denominator).setScale(2, RoundingMode.HALF_UP);
    }

    private String iso(Timestamp value) { return value == null ? null : value.toInstant().toString(); }
    private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }

    private record Exam(long id, long paperId, String type, String title, Timestamp opens, Timestamp closes,
                        Integer durationSeconds, long participants) {
        private Map<String, Object> view() {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("examId", id);
            row.put("paperId", paperId);
            row.put("examTypeCode", type);
            row.put("title", title);
            row.put("startTime", opens == null ? null : opens.toLocalDateTime());
            row.put("endTime", closes == null ? null : closes.toLocalDateTime());
            row.put("duration", durationSeconds == null ? null : durationSeconds / 60);
            return row;
        }
    }
}
