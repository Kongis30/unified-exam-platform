package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.attempt.ScoreVisibilityPolicy;
import com.unifiedexam.platform.attempt.StudentScoreTrend;
import com.unifiedexam.platform.examtype.ScoreTrendProvider;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;

/**
 * SAT 与 PSAT 的学生个人分数趋势共同实现。
 *
 * <p>两种类型共用同一套试卷结构、模块原始分与换算表，差别只在
 * {@code sat_paper_settings.scoring_table_code}（SAT 1600 / PSAT 1520）。
 * 因此这里放共享取数与换算，SAT 与 PSAT 各自用子类只声明自己的类型编码，
 * 既满足「独立模块各自实现」，又不复制换算逻辑。
 *
 * <p>换算统一走 {@link SatAttemptScoreCalculator}，与教师端学生成绩页给出同一个数字。
 */
public abstract class SatFamilyScoreTrendProvider implements ScoreTrendProvider {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    protected SatFamilyScoreTrendProvider(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public StudentScoreTrend load(long studentUserId) {
        List<Candidate> candidates = jdbc.query(("""
            SELECT a.id, a.exam_id, a.attempt_no, a.status, a.submitted_at, a.started_at,
                   e.title AS exam_title, e.score_visibility, e.closes_at <= CURRENT_TIMESTAMP(6) AS exam_closed,
                   r.total_points, r.algorithm_version, r.ungraded_count,
                   d.source_score_json,
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
            FROM attempts a
            JOIN exams e ON e.id = a.exam_id
            JOIN papers p ON p.id = e.paper_id AND p.exam_type_code = ?
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN sat_attempt_details d ON d.attempt_id = a.id
            LEFT JOIN sat_paper_settings s ON s.paper_id = p.id
            WHERE a.student_user_id = ? AND a.is_practice = FALSE
            ORDER BY COALESCE(a.submitted_at, a.started_at), a.id
            """).formatted(SatModuleScoreSql.rawScore("RW", 1), SatModuleScoreSql.rawScore("RW", 2),
                SatModuleScoreSql.rawScore("Math", 1), SatModuleScoreSql.rawScore("Math", 2)),
            (rs, rowNum) -> {
                Timestamp submitted = rs.getTimestamp("submitted_at");
                String submittedAt = submitted == null
                    ? iso(rs.getTimestamp("started_at")) : submitted.toInstant().toString();
                String status = rs.getString("status");
                boolean completed = "SUBMITTED".equals(status) || "COMPLETED".equals(status)
                    || "EXPIRED".equals(status);
                boolean graded = rs.getInt("ungraded_count") == 0;
                boolean visible = completed && graded && ScoreVisibilityPolicy.isVisible(
                    rs.getString("score_visibility"), true, rs.getBoolean("exam_closed"));

                List<StudentScoreTrend.Point> scaledPoints = new ArrayList<>();
                List<StudentScoreTrend.Point> rawPoints = new ArrayList<>();
                if (visible) {
                    SatAttemptScoreCalculator.Result score = SatAttemptScoreCalculator.calculate(
                        new SatAttemptScoreCalculator.Input(readJson(rs.getString("source_score_json")),
                            rs.getBigDecimal("imported_rw1_raw"), rs.getBigDecimal("imported_rw2_raw"),
                            rs.getBigDecimal("imported_math1_raw"), rs.getBigDecimal("imported_math2_raw"),
                            rs.getBigDecimal("rw1_raw"), rs.getBigDecimal("rw2_raw"),
                            rs.getBigDecimal("math1_raw"), rs.getBigDecimal("math2_raw"),
                            rs.getString("scoring_table_code"), rs.getString("algorithm_version"),
                            rs.getInt("paper_question_count"), rs.getBigDecimal("total_points")),
                        rs.getString("rw2_difficulty"), rs.getString("math2_difficulty"));

                    long attemptId = rs.getLong("id");
                    long examId = rs.getLong("exam_id");
                    String examTitle = rs.getString("exam_title");
                    int attemptNumber = rs.getInt("attempt_no");
                    scaledPoints.add(new StudentScoreTrend.Point(attemptId, examId, examTitle, attemptNumber,
                        submittedAt, score.totalScaled(),
                        score.totalScaled() == null ? null : BigDecimal.valueOf(score.scaledMax())));
                    rawPoints.add(new StudentScoreTrend.Point(attemptId, examId, examTitle, attemptNumber,
                        submittedAt, score.rawTotal(),
                        score.rawMax() <= 0 ? null : BigDecimal.valueOf(score.rawMax())));
                }
                return new Candidate(scaledPoints, rawPoints, completed, graded, visible);
            }, examTypeCode(), studentUserId);

        List<StudentScoreTrend.Point> scaled = new ArrayList<>();
        List<StudentScoreTrend.Point> raw = new ArrayList<>();
        int completedCount = 0;
        int notScored = 0;
        int notVisible = 0;
        for (Candidate candidate : candidates) {
            scaled.addAll(candidate.scaledPoints());
            raw.addAll(candidate.rawPoints());
            if (!candidate.completed()) continue;
            completedCount++;
            if (!candidate.graded()) notScored++;
            else if (!candidate.scoreVisible()) notVisible++;
        }

        return new StudentScoreTrend(examTypeCode(),
            new StudentScoreTrend.Statistics(candidates.size(), completedCount),
            StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.SCALED, scaled),
            StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.CORRECT, raw),
            new StudentScoreTrend.Excluded(notScored, notVisible));
    }

    private JsonNode readJson(String json) {
        if (json == null || json.isBlank()) return mapper.nullNode();
        try {
            return mapper.readTree(json);
        } catch (Exception ignored) {
            return mapper.nullNode();
        }
    }

    private static String iso(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    private record Candidate(List<StudentScoreTrend.Point> scaledPoints,
                             List<StudentScoreTrend.Point> rawPoints,
                             boolean completed, boolean graded, boolean scoreVisible) { }
}
