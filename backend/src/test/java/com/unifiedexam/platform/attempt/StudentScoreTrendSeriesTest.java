package com.unifiedexam.platform.attempt;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 序列组装是所有 provider 共用的口径：排序、平均、最高、满分是否可变。
 * 这里锁定行为，避免三个类型模块各自实现导致学生端数字不一致。
 */
class StudentScoreTrendSeriesTest {

    private StudentScoreTrend.Point point(long attemptId, String submittedAt, Integer score, Integer scoreMax) {
        return new StudentScoreTrend.Point(attemptId, 1L, "Exam", 1, submittedAt,
            score == null ? null : BigDecimal.valueOf(score),
            scoreMax == null ? null : BigDecimal.valueOf(scoreMax));
    }

    @Test
    void sortsPointsBySubmissionTimeEarliestFirst() {
        StudentScoreTrend.Series series = StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.SCALED,
            List.of(point(3, "2026-10-20T10:00:00Z", 400, 720),
                point(1, "2026-10-01T10:00:00Z", 300, 720),
                point(2, "2026-10-10T10:00:00Z", 350, 720)));

        assertEquals(List.of(1L, 2L, 3L), series.points().stream().map(StudentScoreTrend.Point::attemptId).toList());
        assertTrue(series.available());
    }

    @Test
    void computesAverageAndHighestFromVisiblePointsOnly() {
        StudentScoreTrend.Series series = StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.SCALED,
            List.of(point(1, "2026-10-01T10:00:00Z", 300, 720),
                point(2, "2026-10-02T10:00:00Z", 401, 720),
                point(3, "2026-10-03T10:00:00Z", null, 720)));

        // 平均只算有分数的两个点：(300 + 401) / 2 = 350.5 → 四舍五入 351。
        assertEquals(351, series.average());
        assertEquals(401, series.highest());
        assertEquals(2, series.points().size());
    }

    @Test
    void emptySeriesIsUnavailableWithNullStatistics() {
        StudentScoreTrend.Series series = StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.SCALED, List.of());

        assertFalse(series.available());
        assertNull(series.average());
        assertNull(series.highest());
        assertNull(series.scoreMax());
        assertTrue(series.points().isEmpty());
    }

    /**
     * 各类型有固定赋分表，满分固定；试卷题数差异不改变量纲，因此序列只取满分最大值，
     * 既不归一也不告警。这条用例锁定该口径，防止有人再加回「满分不一致」的警告。
     */
    @Test
    void usesLargestScoreMaxRegardlessOfPerPointDifferences() {
        StudentScoreTrend.Series series = StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.CORRECT,
            List.of(point(1, "2026-10-01T10:00:00Z", 40, 54),
                point(2, "2026-10-02T10:00:00Z", 44, 66)));

        // 满分取最大值，避免纵轴被小试卷压低。
        assertEquals(0, new BigDecimal("66").compareTo(series.scoreMax()));
        // 原始分按原值展示，不做百分比归一。
        assertEquals(List.of(40, 44), series.points().stream()
            .map(p -> p.score().intValue()).toList());
    }

    @Test
    void uniformMaximaKeepThatMax() {
        StudentScoreTrend.Series series = StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.SCALED,
            List.of(point(1, "2026-10-01T10:00:00Z", 300, 720),
                point(2, "2026-10-02T10:00:00Z", 400, 720)));

        assertEquals(0, new BigDecimal("720").compareTo(series.scoreMax()));
    }

    @Test
    void singlePointProducesAvailableSeriesWithoutLineData() {
        StudentScoreTrend.Series series = StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.POINTS,
            List.of(point(1, "2026-10-01T10:00:00Z", 43, 100)));

        assertTrue(series.available());
        assertEquals(1, series.points().size());
        assertEquals(43, series.average());
        assertEquals(43, series.highest());
    }

    @Test
    void nullAndMissingEntriesAreIgnored() {
        StudentScoreTrend.Series series = StudentScoreTrend.Series.assemble(StudentScoreTrend.Unit.SCALED,
            Arrays.asList(null, point(1, "2026-10-01T10:00:00Z", null, null)));

        assertFalse(series.available());
    }
}
