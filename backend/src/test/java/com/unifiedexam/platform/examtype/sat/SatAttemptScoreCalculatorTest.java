package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * 分数换算抽取后的行为锁定：SAT/PSAT/旧数据三条路径必须与教师端原算法一致。
 * 学生端分数趋势复用同一实现，因此这些断言同时保护两个页面。
 */
class SatAttemptScoreCalculatorTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private SatAttemptScoreCalculator.Result calculate(BigDecimal rw1, BigDecimal rw2,
                                                       BigDecimal math1, BigDecimal math2,
                                                       String scoringType, int questionCount) {
        return SatAttemptScoreCalculator.calculate(
            new SatAttemptScoreCalculator.Input(NullNode.instance,
                null, null, null, null, rw1, rw2, math1, math2,
                scoringType, "UNIFIED", questionCount, null),
            "Mid", "Mid");
    }

    @Test
    void satTranslatesModuleRawScoresThroughItsRealScaleTable() {
        SatAttemptScoreCalculator.Result score = calculate(
            new BigDecimal("20"), new BigDecimal("20"), new BigDecimal("18"), new BigDecimal("20"),
            "SAT", 98);

        assertEquals(new BigDecimal("78"), score.rawTotal());
        assertEquals(98, score.rawMax());
        assertEquals(new BigDecimal("40"), score.rwRaw());
        assertEquals(new BigDecimal("38"), score.mathRaw());
        // 量表是真实映射表，不是线性比例：40 道 RW 对 670，38 道 Math 对 740。
        assertEquals(1600, score.scaledMax());
        assertEquals(670, score.rwScaled().intValue());
        assertEquals(740, score.mathScaled().intValue());
        assertEquals(1410, score.totalScaled().intValue());
    }

    @Test
    void psatUsesItsOwnTableAndMaxScore() {
        SatAttemptScoreCalculator.Result score = calculate(
            new BigDecimal("20"), new BigDecimal("20"), new BigDecimal("18"), new BigDecimal("20"),
            "PSAT", 98);

        // 同样的原始分在 PSAT 表上得分更低，且满分是 1520 而非 1600。
        assertEquals(1520, score.scaledMax());
        assertEquals(610, score.rwScaled().intValue());
        assertEquals(650, score.mathScaled().intValue());
        assertEquals(1260, score.totalScaled().intValue());
    }

    @Test
    void importedLegacyScoresWinOverComputedValues() {
        ObjectNode legacy = mapper.createObjectNode();
        legacy.put("rw_total_scaled", 610);
        legacy.put("math_total_scaled", 640);
        legacy.put("total_score", 1250);

        SatAttemptScoreCalculator.Result score = SatAttemptScoreCalculator.calculate(
            new SatAttemptScoreCalculator.Input(legacy,
                new BigDecimal("31"), new BigDecimal("28"), new BigDecimal("26"), new BigDecimal("27"),
                null, null, null, null,
                "SAT", "SAT_LEGACY", 98, null),
            "Mid", "Mid");

        assertEquals(1250, score.totalScaled().intValue());
        assertEquals(610, score.rwScaled().intValue());
        assertEquals(640, score.mathScaled().intValue());
        assertEquals(new BigDecimal("112").intValue(), score.rawTotal().intValue());
    }

    @Test
    void legacyAttemptWithoutModuleRawScoresFallsBackToCorrectQuestionCount() {
        ObjectNode legacy = mapper.createObjectNode();
        legacy.put("correct_questions", 84);

        SatAttemptScoreCalculator.Result score = SatAttemptScoreCalculator.calculate(
            new SatAttemptScoreCalculator.Input(legacy, null, null, null, null,
                null, null, null, null, "SAT", "SAT_LEGACY", 98, new BigDecimal("999")),
            "Mid", "Mid");

        // 旧数据的题数优先于 attempt_results 的总分，避免两个来源冲突。
        assertEquals(new BigDecimal("84"), score.rawTotal());
    }

    @Test
    void missingRawScoresProduceNullTotalsInsteadOfZero() {
        SatAttemptScoreCalculator.Result score = calculate(null, null, null, null, "SAT", 98);

        assertNull(score.rawTotal());
        assertNull(score.rwRaw());
        assertNull(score.rwScaled());
        assertNull(score.totalScaled());
    }

    /**
     * 旧库有记录用 SAT 量表给 PSAT 卷判分，单科会超过 PSAT 的 760。
     * 这些封存分数必须整体判为无效并重算，否则界面会出现「1590 / 1520」。
     */
    @Test
    void legacyScaledScoresAboveSectionMaxFallBackToRecomputation() {
        ObjectNode legacy = mapper.createObjectNode();
        legacy.put("rw_total_scaled", 800);
        legacy.put("math_total_scaled", 790);
        legacy.put("total_score", 1590);

        SatAttemptScoreCalculator.Result score = SatAttemptScoreCalculator.calculate(
            new SatAttemptScoreCalculator.Input(legacy,
                new BigDecimal("26"), new BigDecimal("27"), new BigDecimal("22"), new BigDecimal("21"),
                null, null, null, null,
                "PSAT", "SAT_LEGACY", 98, null),
            "Mid", "Mid");

        // PSAT 单科上限 760，800 / 790 都越界，改用 PSAT 表重算：750 + 750。
        assertEquals(750, score.rwScaled().intValue());
        assertEquals(750, score.mathScaled().intValue());
        assertEquals(1500, score.totalScaled().intValue());
        assertEquals(1520, score.scaledMax());
    }

    /**
     * 只有单科越界时也必须整条重算。逐科替换会得出「旧 RW 550 + 新 Math 720 = 1270」，
     * 与数据修复后的 1210 不一致，导致同一学生在报告页与趋势图看到两个分数。
     */
    @Test
    void oneOverLimitSectionDiscardsTheWholeLegacyScore() {
        ObjectNode legacy = mapper.createObjectNode();
        legacy.put("rw_total_scaled", 550);
        legacy.put("math_total_scaled", 780);
        legacy.put("total_score", 1330);

        SatAttemptScoreCalculator.Result score = SatAttemptScoreCalculator.calculate(
            new SatAttemptScoreCalculator.Input(legacy,
                new BigDecimal("17"), new BigDecimal("11"), new BigDecimal("20"), new BigDecimal("22"),
                null, null, null, null,
                "PSAT", "SAT_LEGACY", 98, null),
            "Mid", "Mid");

        // RW raw=28 → 490，Math raw=42 → 720；不能保留旧 RW 550。
        assertEquals(490, score.rwScaled().intValue());
        assertEquals(720, score.mathScaled().intValue());
        assertEquals(1210, score.totalScaled().intValue());
    }

    /** 恰好等于上限的旧分数是合法的，不能被误判成脏数据。 */
    @Test
    void legacyScaledScoreExactlyAtSectionMaxIsAccepted() {
        ObjectNode legacy = mapper.createObjectNode();
        legacy.put("rw_total_scaled", 760);
        legacy.put("math_total_scaled", 760);
        legacy.put("total_score", 1520);

        SatAttemptScoreCalculator.Result score = SatAttemptScoreCalculator.calculate(
            new SatAttemptScoreCalculator.Input(legacy,
                new BigDecimal("20"), new BigDecimal("20"), new BigDecimal("18"), new BigDecimal("20"),
                null, null, null, null,
                "PSAT", "SAT_LEGACY", 98, null),
            "Mid", "Mid");

        assertEquals(1520, score.totalScaled().intValue());
    }

    /** SAT 单科上限是 800，770/790 在 SAT 下合法，不应被改写。 */
    @Test
    void satKeepsLegacyScoresWithinItsOwnCeiling() {
        ObjectNode legacy = mapper.createObjectNode();
        legacy.put("rw_total_scaled", 770);
        legacy.put("math_total_scaled", 790);
        legacy.put("total_score", 1560);

        SatAttemptScoreCalculator.Result score = SatAttemptScoreCalculator.calculate(
            new SatAttemptScoreCalculator.Input(legacy,
                new BigDecimal("26"), new BigDecimal("27"), new BigDecimal("22"), new BigDecimal("21"),
                null, null, null, null,
                "SAT", "SAT_LEGACY", 98, null),
            "Mid", "Mid");

        assertEquals(1560, score.totalScaled().intValue());
        assertEquals(1600, score.scaledMax());
    }
}
