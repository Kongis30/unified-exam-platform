package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.attempt.SatScoreScale;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** SAT/PSAT 学生历史成绩适配层，兼容导入分数与平台新生成的原始分。 */
@Service
public class SatAdminStudentScoreService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final SatScoreScale scoreScale = new SatScoreScale();

    public SatAdminStudentScoreService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Map<String, Object> scores(long studentId) {
        return scores(studentId, java.util.Set.of("SAT", "PSAT"));
    }

    public Map<String, Object> scores(long studentId, java.util.Set<String> permittedTypes) {
        return scores(studentId, permittedTypes, null, null);
    }

    /** 班级详情只读取作答时已记录归属的成绩；学生个人视图可不传班级。 */
    public Map<String, Object> scores(long studentId, java.util.Set<String> permittedTypes, Long classId, String examType) {
        Map<String, Object> student = jdbc.query("""
            SELECT u.id, u.real_name, u.username, u.email,
                   GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ', ') AS class_names
            FROM users u LEFT JOIN class_memberships cm ON cm.student_user_id = u.id AND cm.left_at IS NULL
            LEFT JOIN classes c ON c.id = cm.class_id
            WHERE u.id = ? AND u.role_code = 'STUDENT'
            GROUP BY u.id, u.real_name, u.username, u.email
            """, rs -> {
            if (!rs.next()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Student not found.");
            Map<String, Object> view = new LinkedHashMap<>();
            view.put("id", rs.getLong("id"));
            view.put("name", rs.getString("real_name"));
            view.put("username", rs.getString("username"));
            view.put("email", rs.getString("email"));
            view.put("classes", rs.getString("class_names"));
            return view;
        }, studentId);

        // 已明确指定班级的考试，以发布目标为准，避免迁移时按当前班级推断的旧成绩串班。
        String classFilter = classId == null ? "" : " AND EXISTS (SELECT 1 FROM attempt_classes ac WHERE ac.attempt_id = a.id AND ac.class_id = ? AND (EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = a.exam_id AND tc.class_id = ac.class_id) OR NOT EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = a.exam_id)))";
        String typeFilter = examType == null ? "" : " AND p.exam_type_code = ?";
        List<Object> parameters = new java.util.ArrayList<>();
        parameters.add(studentId);
        if (classId != null) parameters.add(classId);
        if (examType != null) parameters.add(examType);
        List<Map<String, Object>> attempts = jdbc.query(("""
            SELECT a.id AS attempt_id, a.exam_id, a.attempt_no, a.status, a.started_at, a.submitted_at,
                   e.title AS exam_title, e.opens_at, p.title AS paper_title, p.exam_type_code,
                   r.total_points, r.max_points, r.algorithm_version, d.source_score_json,
                   d.rw_module1_raw AS imported_rw1_raw, d.rw_module2_raw AS imported_rw2_raw,
                   d.math_module1_raw AS imported_math1_raw, d.math_module2_raw AS imported_math2_raw,
                   %s AS rw1_raw,
                   %s AS rw2_raw,
                   %s AS math1_raw,
                   %s AS math2_raw,
                   (SELECT JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleDifficulty')) FROM paper_sections ps
                    WHERE ps.paper_id = p.id AND JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.subject')) = 'RW'
                      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleNumber')) AS UNSIGNED) = 2
                    ORDER BY ps.id LIMIT 1) AS rw2_difficulty,
                   (SELECT JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleDifficulty')) FROM paper_sections ps
                    WHERE ps.paper_id = p.id AND JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.subject')) = 'Math'
                      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleNumber')) AS UNSIGNED) = 2
                    ORDER BY ps.id LIMIT 1) AS math2_difficulty,
                   s.scoring_table_code,
                   (SELECT COUNT(*) FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
                    WHERE ps.paper_id = p.id) AS paper_question_count
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN sat_attempt_details d ON d.attempt_id = a.id
            LEFT JOIN sat_paper_settings s ON s.paper_id = p.id
            WHERE a.student_user_id = ? AND a.is_practice = FALSE AND p.exam_type_code IN ('SAT', 'PSAT')
            %s %s ORDER BY COALESCE(a.submitted_at, a.started_at) DESC, a.id DESC
            """).formatted(SatModuleScoreSql.rawScore("RW", 1), SatModuleScoreSql.rawScore("RW", 2),
                SatModuleScoreSql.rawScore("Math", 1), SatModuleScoreSql.rawScore("Math", 2), classFilter, typeFilter), this::scoreRow, parameters.toArray());

        attempts = attempts.stream().filter(row -> permittedTypes.contains(row.get("examTypeCode"))).toList();
        List<Map<String, Object>> completed = attempts.stream()
            .filter(row -> "COMPLETED".equals(row.get("status")) && row.get("rawTotalScore") != null)
            .toList();
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("student", student);
        response.put("scores", attempts);
        response.put("statistics", statistics(completed));
        return response;
    }

    /** 删除指定学生的一次 SAT/PSAT 正式尝试；作答、成绩和模块状态由外键级联清理。 */
    @Transactional
    public void deleteAttempt(long studentId, long attemptId) {
        Long ownedAttempt = jdbc.query("""
            SELECT a.id FROM attempts a
            JOIN users u ON u.id = a.student_user_id AND u.role_code = 'STUDENT'
            JOIN exams e ON e.id = a.exam_id
            JOIN papers p ON p.id = e.paper_id AND p.exam_type_code IN ('SAT', 'PSAT')
            WHERE a.id = ? AND a.student_user_id = ? AND a.is_practice = FALSE
            FOR UPDATE
            """, rs -> rs.next() ? rs.getLong(1) : null, attemptId, studentId);
        if (ownedAttempt == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "SAT/PSAT attempt not found.");
        if (jdbc.update("DELETE FROM attempts WHERE id = ?", ownedAttempt) != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The attempt could not be deleted. Refresh and try again.");
        }
    }

    public List<Map<String, Object>> scoresForExam(long examId) {
        return jdbc.query("""
            SELECT a.id AS attempt_id, a.exam_id, a.attempt_no, a.status, a.started_at, a.submitted_at,
                   e.title AS exam_title, e.opens_at, p.title AS paper_title, p.exam_type_code,
                   r.total_points, r.max_points, r.algorithm_version, d.source_score_json,
                   d.rw_module1_raw AS imported_rw1_raw, d.rw_module2_raw AS imported_rw2_raw,
                   d.math_module1_raw AS imported_math1_raw, d.math_module2_raw AS imported_math2_raw,
                   %s AS rw1_raw,
                   %s AS rw2_raw,
                   %s AS math1_raw,
                   %s AS math2_raw,
                   (SELECT JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleDifficulty')) FROM paper_sections ps
                    WHERE ps.paper_id = p.id AND JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.subject')) = 'RW'
                      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleNumber')) AS UNSIGNED) = 2
                    ORDER BY ps.id LIMIT 1) AS rw2_difficulty,
                   (SELECT JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleDifficulty')) FROM paper_sections ps
                    WHERE ps.paper_id = p.id AND JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.subject')) = 'Math'
                      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleNumber')) AS UNSIGNED) = 2
                    ORDER BY ps.id LIMIT 1) AS math2_difficulty,
                   s.scoring_table_code,
                   (SELECT COUNT(*) FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
                    WHERE ps.paper_id = p.id) AS paper_question_count
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN sat_attempt_details d ON d.attempt_id = a.id
            LEFT JOIN sat_paper_settings s ON s.paper_id = p.id
            WHERE a.exam_id = ? AND a.is_practice = FALSE AND p.exam_type_code IN ('SAT', 'PSAT')
            ORDER BY a.student_user_id, a.attempt_no DESC, a.id DESC
            """.formatted(SatModuleScoreSql.rawScore("RW", 1), SatModuleScoreSql.rawScore("RW", 2),
                SatModuleScoreSql.rawScore("Math", 1), SatModuleScoreSql.rawScore("Math", 2)), this::scoreRow, examId);
    }

    private Map<String, Object> scoreRow(ResultSet rs, int rowNum) throws SQLException {
        JsonNode legacy = readJson(rs.getString("source_score_json"));
        BigDecimal rw1 = firstValue(rs.getBigDecimal("imported_rw1_raw"), rs.getBigDecimal("rw1_raw"));
        BigDecimal rw2 = firstValue(rs.getBigDecimal("imported_rw2_raw"), rs.getBigDecimal("rw2_raw"));
        BigDecimal math1 = firstValue(rs.getBigDecimal("imported_math1_raw"), rs.getBigDecimal("math1_raw"));
        BigDecimal math2 = firstValue(rs.getBigDecimal("imported_math2_raw"), rs.getBigDecimal("math2_raw"));
        BigDecimal rw1Scaled = moduleScore(legacy, "rw_module1_scaled", "RW", 1, rw1);
        BigDecimal rw2Scaled = moduleScore(legacy, "rw_module2_scaled", "RW", 2, rs.getString("rw2_difficulty"), rw2);
        BigDecimal math1Scaled = moduleScore(legacy, "math_module1_scaled", "Math", 1, math1);
        BigDecimal math2Scaled = moduleScore(legacy, "math_module2_scaled", "Math", 2, rs.getString("math2_difficulty"), math2);
        BigDecimal rawTotal = sum(rw1, rw2, math1, math2);
        if (rawTotal == null && legacy.path("correct_questions").isNumber()) {
            rawTotal = legacy.path("correct_questions").decimalValue();
        }
        if (rawTotal == null && !"SAT_LEGACY".equals(rs.getString("algorithm_version"))) {
            rawTotal = rs.getBigDecimal("total_points");
        }
        BigDecimal rwRaw = sum(rw1, rw2);
        BigDecimal mathRaw = sum(math1, math2);
        String scoringType = rs.getString("scoring_table_code");
        int questionCount = rs.getInt("paper_question_count");
        BigDecimal rwScaled = firstNumber(legacy.path("rw_total_scaled"), rwRaw == null ? null
            : BigDecimal.valueOf(scoreScale.scaledTotal(scoringType, "RW", rwRaw.intValue(), questionCount)));
        BigDecimal mathScaled = firstNumber(legacy.path("math_total_scaled"), mathRaw == null ? null
            : BigDecimal.valueOf(scoreScale.scaledTotal(scoringType, "Math", mathRaw.intValue(), questionCount)));
        BigDecimal totalScaled = firstNumber(legacy.path("total_score"), rwScaled == null || mathScaled == null
            ? null : rwScaled.add(mathScaled));

        Map<String, Object> row = new LinkedHashMap<>();
        long attemptId = rs.getLong("attempt_id");
        row.put("attemptId", attemptId);
        row.put("examId", rs.getLong("exam_id"));
        row.put("examTitle", rs.getString("exam_title"));
        row.put("paperTitle", rs.getString("paper_title"));
        row.put("examTypeCode", rs.getString("exam_type_code"));
        row.put("attemptNumber", rs.getInt("attempt_no"));
        row.put("status", "SUBMITTED".equals(rs.getString("status")) ? "COMPLETED" : rs.getString("status"));
        row.put("rawTotalScore", rawTotal);
        row.put("rawMaxScore", questionCount);
        row.put("rwRawScore", rwRaw);
        row.put("mathRawScore", mathRaw);
        row.put("rw1RawScore", rw1);
        row.put("rw2RawScore", rw2);
        row.put("math1RawScore", math1);
        row.put("math2RawScore", math2);
        row.put("rw1ScaledScore", rw1Scaled);
        row.put("rw2ScaledScore", rw2Scaled);
        row.put("math1ScaledScore", math1Scaled);
        row.put("math2ScaledScore", math2Scaled);
        row.put("rwScaledScore", rwScaled);
        row.put("mathScaledScore", mathScaled);
        row.put("totalScaledScore", totalScaled);
        row.put("scaledMaxScore", "PSAT".equalsIgnoreCase(scoringType) ? 1520 : 1600);
        row.put("scoringType", scoringType);
        row.put("algorithmVersion", rs.getString("algorithm_version"));
        row.put("startedAt", iso(rs.getTimestamp("started_at")));
        row.put("submittedAt", iso(rs.getTimestamp("submitted_at")));
        row.put("examDate", iso(rs.getTimestamp("opens_at")));
        return row;
    }

    private BigDecimal moduleScore(JsonNode legacy, String legacyField, String subject, int module, BigDecimal raw) {
        return moduleScore(legacy, legacyField, subject, module, "Mid", raw);
    }

    private BigDecimal moduleScore(JsonNode legacy, String legacyField, String subject, int module,
                                   String difficulty, BigDecimal raw) {
        return firstNumber(legacy.path(legacyField), raw == null ? null
            : BigDecimal.valueOf(scoreScale.scaledModule(subject, module, difficulty, raw.intValue())));
    }

    private Map<String, Object> statistics(List<Map<String, Object>> attempts) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalAttempts", attempts.size());
        result.put("sat", typeStatistics(attempts, "SAT"));
        result.put("psat", typeStatistics(attempts, "PSAT"));
        return result;
    }

    private Map<String, Object> typeStatistics(List<Map<String, Object>> attempts, String examType) {
        List<Map<String, Object>> matching = attempts.stream()
            .filter(row -> examType.equals(row.get("examTypeCode"))).toList();
        List<BigDecimal> raw = matching.stream().map(row -> (BigDecimal) row.get("rawTotalScore")).filter(value -> value != null).toList();
        List<BigDecimal> scaled = matching.stream().map(row -> (BigDecimal) row.get("totalScaledScore")).filter(value -> value != null).toList();
        List<BigDecimal> rwScaled = matching.stream().map(row -> (BigDecimal) row.get("rwScaledScore")).filter(value -> value != null).toList();
        List<BigDecimal> mathScaled = matching.stream().map(row -> (BigDecimal) row.get("mathScaledScore")).filter(value -> value != null).toList();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("attempts", matching.size());
        result.put("averageRawScore", average(raw));
        result.put("highestRawScore", raw.stream().max(BigDecimal::compareTo).orElse(null));
        result.put("lowestRawScore", raw.stream().min(BigDecimal::compareTo).orElse(null));
        result.put("averageScaledScore", average(scaled));
        result.put("highestScaledScore", scaled.stream().max(BigDecimal::compareTo).orElse(null));
        result.put("lowestScaledScore", scaled.stream().min(BigDecimal::compareTo).orElse(null));
        result.put("averageRwScaledScore", average(rwScaled));
        result.put("averageMathScaledScore", average(mathScaled));
        return result;
    }

    private BigDecimal average(List<BigDecimal> values) {
        if (values.isEmpty()) return null;
        return values.stream().reduce(BigDecimal.ZERO, BigDecimal::add)
            .divide(BigDecimal.valueOf(values.size()), 1, RoundingMode.HALF_UP);
    }

    private BigDecimal firstValue(BigDecimal preferred, BigDecimal fallback) { return preferred == null ? fallback : preferred; }
    private BigDecimal sum(BigDecimal... values) {
        BigDecimal total = BigDecimal.ZERO;
        boolean found = false;
        for (BigDecimal value : values) if (value != null) { total = total.add(value); found = true; }
        return found ? total : null;
    }

    private BigDecimal firstNumber(JsonNode preferred, BigDecimal fallback) {
        return preferred != null && preferred.isNumber() ? preferred.decimalValue() : fallback;
    }

    private JsonNode readJson(String json) {
        if (json == null || json.isBlank()) return mapper.nullNode();
        try { return mapper.readTree(json); } catch (Exception ignored) { return mapper.nullNode(); }
    }

    private String iso(Timestamp timestamp) { return timestamp == null ? null : timestamp.toInstant().toString(); }
}
