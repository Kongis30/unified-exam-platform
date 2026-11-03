package com.unifiedexam.platform.examtype.sat;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** 汇总一场 SAT/PSAT 考试的参与者、最新尝试和分数。 */
@Service
public class SatAdminExamResultsService {
    private final JdbcTemplate jdbc;
    private final SatAdminStudentScoreService scores;

    public SatAdminExamResultsService(JdbcTemplate jdbc, SatAdminStudentScoreService scores) {
        this.jdbc = jdbc;
        this.scores = scores;
    }

    public Map<String, Object> results(long examId) {
        return results(examId, null);
    }

    public Map<String, Object> results(long examId, Long classId) {
        Map<String, Object> exam = jdbc.query("""
            SELECT e.id, e.paper_id, e.title, e.status, e.opens_at, e.closes_at, p.title AS paper_title,
                   p.exam_type_code, e.duration_seconds, p.default_duration_seconds
            FROM exams e JOIN papers p ON p.id = e.paper_id
            WHERE e.id = ? AND p.exam_type_code IN ('SAT', 'PSAT')
            """, rs -> {
            if (!rs.next()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "SAT exam not found.");
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getLong("id"));
            row.put("paperId", rs.getLong("paper_id"));
            row.put("title", rs.getString("title"));
            row.put("status", rs.getString("status"));
            row.put("paperTitle", rs.getString("paper_title"));
            row.put("examTypeCode", rs.getString("exam_type_code"));
            row.put("opensAt", iso(rs.getTimestamp("opens_at")));
            row.put("closesAt", iso(rs.getTimestamp("closes_at")));
            row.put("durationSeconds", rs.getObject("duration_seconds") == null
                ? rs.getInt("default_duration_seconds") : rs.getInt("duration_seconds"));
            return row;
        }, examId);

        long paperId = ((Number) exam.remove("paperId")).longValue();
        List<String> modules = jdbc.query("""
            SELECT title,
                   JSON_UNQUOTE(JSON_EXTRACT(settings_json, '$.subject')) AS subject,
                   JSON_EXTRACT(settings_json, '$.moduleNumber') AS module_number
            FROM paper_sections
            WHERE paper_id = ? AND parent_section_id IS NULL AND section_kind = 'MODULE'
            ORDER BY sort_order, id
            """, (rs, rowNum) -> moduleLabel(rs.getString("subject"),
                rs.getObject("module_number") == null ? null : rs.getInt("module_number"),
                rs.getString("title")), paperId);
        exam.put("modules", modules);

        List<Map<String, Object>> attempts = scores.scoresForExam(examId);
        Map<Long, Map<String, Object>> latestScores = attempts.stream().collect(Collectors.toMap(
            row -> ((Number) row.get("attemptId")).longValue(), row -> row, (first, ignored) -> first));
        String classAttemptFilter = classId == null ? "" : " AND EXISTS (SELECT 1 FROM attempt_classes ac WHERE ac.attempt_id = a.id AND ac.class_id = ?)";
        String classParticipantFilter = classId == null ? "" : " AND EXISTS (SELECT 1 FROM exam_participant_classes pc WHERE pc.exam_id = ep.exam_id AND pc.student_user_id = ep.student_user_id AND pc.class_id = ?)";
        Object[] participantParameters = classId == null ? new Object[] { examId } : new Object[] { classId, examId, classId };
        List<Map<String, Object>> participants = jdbc.query(("""
            SELECT u.id AS student_id, u.real_name, u.username, latest.id AS attempt_id,
                   latest.attempt_no, latest.status, latest.started_at, latest.submitted_at
            FROM exam_participants ep JOIN users u ON u.id = ep.student_user_id
            LEFT JOIN attempts latest ON latest.id = (
                SELECT a.id FROM attempts a WHERE a.exam_id = ep.exam_id
                    AND a.student_user_id = ep.student_user_id AND a.is_practice = FALSE %s
                ORDER BY a.attempt_no DESC, a.id DESC LIMIT 1
            )
            WHERE ep.exam_id = ? AND ep.revoked_at IS NULL AND u.role_code = 'STUDENT' %s
            ORDER BY u.real_name, u.id
            """).formatted(classAttemptFilter, classParticipantFilter), (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            Long attemptId = nullableLong(rs, "attempt_id");
            row.put("studentId", rs.getLong("student_id"));
            row.put("studentName", rs.getString("real_name"));
            row.put("username", rs.getString("username"));
            row.put("attemptId", attemptId);
            row.put("attemptNumber", nullableInt(rs, "attempt_no"));
            row.put("status", resultStatus(rs.getString("status")));
            row.put("startedAt", iso(rs.getTimestamp("started_at")));
            row.put("submittedAt", iso(rs.getTimestamp("submitted_at")));
            return row;
        }, participantParameters);

        int completed = 0;
        int inProgress = 0;
        for (Map<String, Object> participant : participants) {
            Object id = participant.get("attemptId");
            Map<String, Object> score = id == null ? null : latestScores.get(((Number) id).longValue());
            if (score != null) participant.putAll(score);
            if ("COMPLETED".equals(participant.get("status"))) completed++;
            if ("IN_PROGRESS".equals(participant.get("status"))) inProgress++;
        }

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("participants", participants.size());
        summary.put("completed", completed);
        summary.put("inProgress", inProgress);
        summary.put("notStarted", Math.max(0, participants.size() - completed - inProgress));
        addScoreSummary(summary, participants);
        return Map.of("exam", exam, "summary", summary, "participants", participants);
    }

    // 只统计已完成且实际有分数的考生；空考试的统计字段保留 null，避免误报为零分。
    void addScoreSummary(Map<String, Object> summary, List<Map<String, Object>> participants) {
        List<BigDecimal> raw = scoreValues(participants, "rawTotalScore");
        List<BigDecimal> scaled = scoreValues(participants, "totalScaledScore");
        summary.put("averageRawScore", average(raw));
        summary.put("highestRawScore", extreme(raw, true));
        summary.put("lowestRawScore", extreme(raw, false));
        summary.put("averageScaledScore", average(scaled));
        summary.put("highestScaledScore", extreme(scaled, true));
        summary.put("lowestScaledScore", extreme(scaled, false));
        summary.put("averageRw1RawScore", average(scoreValues(participants, "rw1RawScore")));
        summary.put("averageRw2RawScore", average(scoreValues(participants, "rw2RawScore")));
        summary.put("averageMath1RawScore", average(scoreValues(participants, "math1RawScore")));
        summary.put("averageMath2RawScore", average(scoreValues(participants, "math2RawScore")));
        summary.put("averageRwRawScore", average(scoreValues(participants, "rwRawScore")));
        summary.put("averageMathRawScore", average(scoreValues(participants, "mathRawScore")));
    }

    private List<BigDecimal> scoreValues(List<Map<String, Object>> participants, String key) {
        List<BigDecimal> values = new ArrayList<>();
        for (Map<String, Object> row : participants) {
            Object value = row.get(key);
            if ("COMPLETED".equals(row.get("status")) && value instanceof BigDecimal score) values.add(score);
        }
        return values;
    }

    private BigDecimal average(List<BigDecimal> values) {
        if (values.isEmpty()) return null;
        return values.stream().reduce(BigDecimal.ZERO, BigDecimal::add)
            .divide(BigDecimal.valueOf(values.size()), 1, RoundingMode.HALF_UP);
    }

    private BigDecimal extreme(List<BigDecimal> values, boolean highest) {
        return values.stream().reduce((left, right) -> highest
            ? left.max(right) : left.min(right)).orElse(null);
    }

    private String resultStatus(String status) {
        if (status == null) return "NOT_STARTED";
        return "SUBMITTED".equalsIgnoreCase(status) ? "COMPLETED" : status;
    }

    static String moduleLabel(String subject, Integer moduleNumber, String title) {
        if (moduleNumber == null || subject == null) return title;
        String subjectLabel = "RW".equalsIgnoreCase(subject) ? "R&W" :
            "MATH".equalsIgnoreCase(subject) ? "Math" : null;
        return subjectLabel == null ? title : subjectLabel + " Module " + moduleNumber;
    }

    private String iso(Timestamp value) { return value == null ? null : value.toInstant().toString(); }
    private Long nullableLong(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }
    private Integer nullableInt(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }
}
