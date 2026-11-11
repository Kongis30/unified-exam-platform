package com.unifiedexam.platform.examtype.shsat;

import com.unifiedexam.platform.attempt.ScoreVisibilityPolicy;
import com.unifiedexam.platform.attempt.StudentScoreTrend;
import com.unifiedexam.platform.examtype.ScoreTrendProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;

/**
 * SHSAT 学生个人分数趋势。
 *
 * <p>量表分来自交卷时写入的 {@code attempt_result_breakdowns}（ELA + MATH 两张量表分之和，
 * 满分 720）；原始分取 {@code attempt_results.total_points}。评分档案为 {@code RAW_ONLY}
 * （无量表换算表）时没有量表分，前端只显示原始分。
 *
 * <p>只统计正式考试：练习与错题重做（{@code is_practice}）一律排除，因为它们的评分口径不同，
 * 混进来会让「里程变化」失去含义。
 */
@Component
public class ShsatScoreTrendProvider implements ScoreTrendProvider {

    private static final String EXAM_TYPE = "SHSAT";
    /** 与 {@code ShsatScoreScaleService.isScaleTable} 保持一致。 */
    private static final String SCALE_TABLE = "SHSAT_SCALE_TABLE";
    private static final String SCALE_ESTIMATED = "SHSAT_ESTIMATED";

    private final JdbcTemplate jdbc;

    public ShsatScoreTrendProvider(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String examTypeCode() {
        return EXAM_TYPE;
    }

    @Override
    public StudentScoreTrend load(long studentUserId) {
        List<Candidate> candidates = jdbc.query("""
            SELECT a.id, a.exam_id, a.attempt_no, a.status, a.submitted_at, a.started_at,
                   e.title AS exam_title, e.score_visibility, e.closes_at <= CURRENT_TIMESTAMP(6) AS exam_closed,
                   r.total_points, r.max_points, COALESCE(r.ungraded_count, 0) AS ungraded_count,
                   sp.algorithm_code AS scoring_mode,
                   (SELECT rb.scaled_score FROM attempt_result_breakdowns rb
                     WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_scaled_score,
                   (SELECT rb.scaled_score FROM attempt_result_breakdowns rb
                     WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_scaled_score,
                   (SELECT rb.scaled_max_score FROM attempt_result_breakdowns rb
                     WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'ELA') AS ela_scaled_max_score,
                   (SELECT rb.scaled_max_score FROM attempt_result_breakdowns rb
                     WHERE rb.attempt_id = a.id AND rb.breakdown_code = 'MATH') AS math_scaled_max_score
            FROM attempts a
            JOIN exams e ON e.id = a.exam_id
            JOIN papers p ON p.id = e.paper_id AND p.exam_type_code = ?
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN scoring_profiles sp ON sp.id = COALESCE(r.scoring_profile_id, e.scoring_profile_id)
            WHERE a.student_user_id = ? AND a.is_practice = FALSE
            ORDER BY COALESCE(a.submitted_at, a.started_at), a.id
            """, (rs, rowNum) -> {
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
                long attemptId = rs.getLong("id");
                long examId = rs.getLong("exam_id");
                String examTitle = rs.getString("exam_title");
                int attemptNumber = rs.getInt("attempt_no");
                if (hasScaleTable(rs.getString("scoring_mode"))) {
                    BigDecimal ela = rs.getBigDecimal("ela_scaled_score");
                    BigDecimal math = rs.getBigDecimal("math_scaled_score");
                    BigDecimal elaMax = rs.getBigDecimal("ela_scaled_max_score");
                    BigDecimal mathMax = rs.getBigDecimal("math_scaled_max_score");
                    if (ela != null && math != null) {
                        BigDecimal max = elaMax == null || mathMax == null ? null : elaMax.add(mathMax);
                        scaledPoints.add(new StudentScoreTrend.Point(attemptId, examId, examTitle, attemptNumber,
                            submittedAt, ela.add(math), max));
                    }
                }
                rawPoints.add(new StudentScoreTrend.Point(attemptId, examId, examTitle, attemptNumber,
                    submittedAt, rs.getBigDecimal("total_points"), rs.getBigDecimal("max_points")));
            }
            return new Candidate(scaledPoints, rawPoints, completed, graded, visible);
        }, EXAM_TYPE, studentUserId);

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

        return new StudentScoreTrend(EXAM_TYPE,
            new StudentScoreTrend.Statistics(candidates.size(), completedCount),
            StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.SCALED, scaled),
            StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.POINTS, raw),
            new StudentScoreTrend.Excluded(notScored, notVisible));
    }

    private boolean hasScaleTable(String algorithmCode) {
        return SCALE_TABLE.equals(algorithmCode) || SCALE_ESTIMATED.equals(algorithmCode);
    }

    private static String iso(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    /** 单次作答的候选点；未完成的作答不产出点，但仍要计数用于统计条与脚注。 */
    private record Candidate(List<StudentScoreTrend.Point> scaledPoints,
                             List<StudentScoreTrend.Point> rawPoints,
                             boolean completed, boolean graded, boolean scoreVisible) { }
}
