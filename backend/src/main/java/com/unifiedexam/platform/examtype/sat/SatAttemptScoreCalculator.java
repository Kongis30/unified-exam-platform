package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.JsonNode;
import com.unifiedexam.platform.attempt.SatScoreScale;

import java.math.BigDecimal;

/**
 * SAT/PSAT 分数换算的唯一实现。
 *
 * <p>教师端学生成绩页（{@code SatAdminStudentScoreService}）与学生端个人分数趋势
 * （SAT/PSAT 两个 provider）必须给出同一个数字，因此换算规则集中在这里：
 * 模块原始分 → 模块量表分 → 总分，并兼容旧系统导入的封存分数（{@code source_score_json}）。
 *
 * <p>纯计算，不访问数据库，便于单测覆盖 SAT 1600 / PSAT 1520 / 旧数据三条路径。
 */
public final class SatAttemptScoreCalculator {

    private static final SatScoreScale SCORE_SCALE = new SatScoreScale();
    private static final String LEGACY_ALGORITHM = "SAT_LEGACY";

    private SatAttemptScoreCalculator() { }

    /**
     * 一次作答的分数输入。
     *
     * @param legacyScore         旧系统封存的分数 JSON；平台新生成的作答为 null
     * @param importedRw1         迁移带入的模块原始分（优先于实时计算的 raw）
     * @param scoringType         {@code sat_paper_settings.scoring_table_code}，SAT 或 PSAT
     * @param paperQuestionCount  试卷题目总数，同时是原始分满分
     * @param totalPoints         {@code attempt_results.total_points}，仅在缺少逐模块原始分时兜底
     */
    public record Input(JsonNode legacyScore,
                        BigDecimal importedRw1, BigDecimal importedRw2,
                        BigDecimal importedMath1, BigDecimal importedMath2,
                        BigDecimal rawRw1, BigDecimal rawRw2, BigDecimal rawMath1, BigDecimal rawMath2,
                        String scoringType, String algorithmVersion,
                        int paperQuestionCount, BigDecimal totalPoints) { }

    /** 换算结果；任何无法计算的字段为 null，由调用方决定如何展示。 */
    public record Result(BigDecimal rw1Raw, BigDecimal rw2Raw, BigDecimal math1Raw, BigDecimal math2Raw,
                         BigDecimal rwRaw, BigDecimal mathRaw, BigDecimal rawTotal, int rawMax,
                         BigDecimal rw1Scaled, BigDecimal rw2Scaled, BigDecimal math1Scaled, BigDecimal math2Scaled,
                         BigDecimal rwScaled, BigDecimal mathScaled, BigDecimal totalScaled, int scaledMax) { }

    public static Result calculate(Input input, String rw2Difficulty, String math2Difficulty) {
        JsonNode legacy = input.legacyScore() == null ? null : input.legacyScore();

        BigDecimal rw1 = firstValue(input.importedRw1(), input.rawRw1());
        BigDecimal rw2 = firstValue(input.importedRw2(), input.rawRw2());
        BigDecimal math1 = firstValue(input.importedMath1(), input.rawMath1());
        BigDecimal math2 = firstValue(input.importedMath2(), input.rawMath2());

        BigDecimal rw1Scaled = moduleScore(legacy, "rw_module1_scaled", "RW", 1, "Mid", rw1);
        BigDecimal rw2Scaled = moduleScore(legacy, "rw_module2_scaled", "RW", 2, rw2Difficulty, rw2);
        BigDecimal math1Scaled = moduleScore(legacy, "math_module1_scaled", "Math", 1, "Mid", math1);
        BigDecimal math2Scaled = moduleScore(legacy, "math_module2_scaled", "Math", 2, math2Difficulty, math2);

        BigDecimal rwRaw = sum(rw1, rw2);
        BigDecimal mathRaw = sum(math1, math2);

        BigDecimal rawTotal = sum(rw1, rw2, math1, math2);
        if (rawTotal == null && legacy != null && legacy.path("correct_questions").isNumber()) {
            rawTotal = legacy.path("correct_questions").decimalValue();
        }
        if (rawTotal == null && !LEGACY_ALGORITHM.equals(input.algorithmVersion())) {
            rawTotal = input.totalPoints();
        }

        String scoringType = input.scoringType();
        int questionCount = input.paperQuestionCount();

        BigDecimal computedRw = computedSection(scoringType, "RW", rwRaw, questionCount);
        BigDecimal computedMath = computedSection(scoringType, "Math", mathRaw, questionCount);

        // 旧封存分数的量表口径可能整体错误（例如用 SAT 表给整张 PSAT 卷判分）。
        // 判据：封存值恰好等于「用另一张表」的重算结果，即确诊评分表用错，整条弃用重算。
        // 不能逐科替换——旧 RW + 新 Math 会得出与重算结果不同的第三种分数。
        boolean legacyScoredByWrongTable = scoredByOtherTable(legacy, scoringType, rwRaw, mathRaw, questionCount);

        BigDecimal rwScaled = legacyScoredByWrongTable ? computedRw
            : firstNumber(legacy == null ? null : legacy.path("rw_total_scaled"), computedRw);
        BigDecimal mathScaled = legacyScoredByWrongTable ? computedMath
            : firstNumber(legacy == null ? null : legacy.path("math_total_scaled"), computedMath);
        BigDecimal totalScaled = rwScaled == null || mathScaled == null ? null : rwScaled.add(mathScaled);
        if (!legacyScoredByWrongTable) {
            totalScaled = firstNumber(legacy == null ? null : legacy.path("total_score"), totalScaled);
        }

        return new Result(rw1, rw2, math1, math2, rwRaw, mathRaw, rawTotal, questionCount,
            rw1Scaled, rw2Scaled, math1Scaled, math2Scaled, rwScaled, mathScaled, totalScaled,
            scaledMax(scoringType));
    }

    /** SAT 满分 1600，PSAT 满分 1520；据此决定学生端纵轴上限。 */
    public static int scaledMax(String scoringType) {
        return "PSAT".equalsIgnoreCase(scoringType) ? 1520 : 1600;
    }

    /** 单科量表上限：SAT 800、PSAT 760，即各自总分的一半。 */
    public static int sectionMax(String scoringType) {
        return scaledMax(scoringType) / 2;
    }

    private static BigDecimal moduleScore(JsonNode legacy, String legacyField, String subject, int module,
                                          String difficulty, BigDecimal raw) {
        BigDecimal computed = raw == null ? null
            : BigDecimal.valueOf(SCORE_SCALE.scaledModule(subject, module, difficulty, raw.intValue()));
        return firstNumber(legacy == null ? null : legacy.path(legacyField), computed);
    }

    private static BigDecimal firstValue(BigDecimal preferred, BigDecimal fallback) {
        return preferred == null ? fallback : preferred;
    }

    private static BigDecimal sum(BigDecimal... values) {
        BigDecimal total = BigDecimal.ZERO;
        boolean found = false;
        for (BigDecimal value : values) {
            if (value != null) {
                total = total.add(value);
                found = true;
            }
        }
        return found ? total : null;
    }

    private static BigDecimal firstNumber(JsonNode preferred, BigDecimal fallback) {
        return preferred != null && preferred.isNumber() ? preferred.decimalValue() : fallback;
    }

    /**
     * 判断旧封存分数是否被「另一张评分表」算过。
     *
     * <p>旧库存在用 SAT 表给整张 PSAT 卷判分的记录。仅凭单科是否超上限无法识别：
     * 有的科目恰好没超（SAT 表给 RW raw=46 算出 730，仍在 PSAT 的 760 内），
     * 但整条记录的两个单科都精确等于 SAT 表结果。故以「两科均等于另一张表的重算值、
     * 且不等于本表重算值」为确诊条件，命中才整条弃用，绝不误伤正常旧成绩。
     */
    private static boolean scoredByOtherTable(JsonNode legacy, String scoringType,
                                              BigDecimal rwRaw, BigDecimal mathRaw, int questionCount) {
        if (legacy == null) return false;
        String otherType = "PSAT".equalsIgnoreCase(scoringType) ? "SAT" : "PSAT";
        BigDecimal otherRw = computedSection(otherType, "RW", rwRaw, questionCount);
        BigDecimal otherMath = computedSection(otherType, "Math", mathRaw, questionCount);
        BigDecimal ownRw = computedSection(scoringType, "RW", rwRaw, questionCount);
        BigDecimal ownMath = computedSection(scoringType, "Math", mathRaw, questionCount);
        if (otherRw == null || otherMath == null) return false;

        boolean equalsOther = matchesExact(legacy.path("rw_total_scaled"), otherRw)
            && matchesExact(legacy.path("math_total_scaled"), otherMath);
        boolean equalsOwn = matchesExact(legacy.path("rw_total_scaled"), ownRw)
            && matchesExact(legacy.path("math_total_scaled"), ownMath);
        return equalsOther && !equalsOwn;
    }

    private static boolean matchesExact(JsonNode legacyValue, BigDecimal computed) {
        return legacyValue != null && legacyValue.isNumber()
            && legacyValue.decimalValue().compareTo(computed) == 0;
    }

    private static BigDecimal computedSection(String scoringType, String subject, BigDecimal raw, int questionCount) {
        return raw == null ? null
            : BigDecimal.valueOf(SCORE_SCALE.scaledTotal(scoringType, subject, raw.intValue(), questionCount));
    }
}
