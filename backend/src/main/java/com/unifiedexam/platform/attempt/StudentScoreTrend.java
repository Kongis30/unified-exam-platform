package com.unifiedexam.platform.attempt;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 学生个人分数趋势的公共响应模型与序列组装。
 *
 * <p>语义固定为学生本人的成长曲线：数据源只按 {@code attempts.student_user_id} 取，
 * 不涉及班级归属、不聚合其他学生、不包含平均分参照线。
 *
 * <p>一次返回 {@code scaled} 与 {@code raw} 两条序列，前端切换纯本地，不再发请求。
 */
public record StudentScoreTrend(String examTypeCode,
                                Statistics statistics,
                                Series scaled,
                                Series raw,
                                Excluded excluded) {

    /** 分数单位，决定前端文案；与考试类型无关，由 provider 按自己的数据决定。 */
    public enum Unit {
        /** 量表分，如 SHSAT 720、SAT 1600、PSAT 1520。 */
        SCALED,
        /** 得分点数，如 SHSAT 原始分。 */
        POINTS,
        /** 正确题数，如 SAT/PSAT 原始分。 */
        CORRECT
    }

    /** 与分数模式无关的计数；平均/最高分放在各自 Series 内，避免前端重复实现口径。 */
    public record Statistics(int totalAttempts, int completedAttempts) {
        public static Statistics empty() {
            return new Statistics(0, 0);
        }
    }

    /**
     * 一条分数序列。
     *
     * @param available      该模式是否有可用点；false 时前端隐藏对应模式
     * @param unit            分数单位
     * @param scoreMax        满分；各点满分不同时取最大值
     * @param average         可见点平均分，四舍五入取整；无点为 null
     * @param highest         可见点最高分；无点为 null
     * @param points          按 submittedAt 升序排列（最早 → 最晚）
     */
    public record Series(boolean available, String unit, BigDecimal scoreMax,
                         Integer average, Integer highest, List<Point> points) {

        public static Series empty(Unit unit) {
            return new Series(false, unit.name(), null, null, null, List.of());
        }

        /**
         * 由未排序的候选点组装序列：过滤无分数的点、按提交时间升序、计算平均与最高。
         * 所有 provider 共用，避免平均/最高口径在各模块漂移。
         *
         * <p>每种考试类型都有固定的 raw → scaled 赋分表，满分因此固定；不同试卷题数差异
         * 不改变量纲，故满分取各点最大值即可，不做归一或告警。
         */
        public static Series assemble(Unit unit, List<Point> candidates) {
            List<Point> scored = new ArrayList<>();
            for (Point point : candidates == null ? List.<Point>of() : candidates) {
                if (point != null && point.score() != null) scored.add(point);
            }
            if (scored.isEmpty()) return empty(unit);

            scored.sort(Comparator.comparing(Point::submittedAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparingLong(Point::attemptId));

            BigDecimal scoreMax = null;
            BigDecimal total = BigDecimal.ZERO;
            BigDecimal highest = null;
            for (Point point : scored) {
                total = total.add(point.score());
                if (highest == null || point.score().compareTo(highest) > 0) highest = point.score();
                if (point.scoreMax() != null && (scoreMax == null || point.scoreMax().compareTo(scoreMax) > 0)) {
                    scoreMax = point.scoreMax();
                }
            }
            int average = total.divide(BigDecimal.valueOf(scored.size()), 0, RoundingMode.HALF_UP).intValue();
            return new Series(true, unit.name(), scoreMax, average,
                highest == null ? null : highest.intValue(), List.copyOf(scored));
        }
    }

    /** 一次作答的分数点。 */
    public record Point(long attemptId, long examId, String examTitle, int attemptNumber,
                        String submittedAt, BigDecimal score, BigDecimal scoreMax) { }

    /** 被排除的作答数量，用于前端脚注说明，避免学生误以为漏分。 */
    public record Excluded(int notScored, int notVisible) {
        public static Excluded empty() {
            return new Excluded(0, 0);
        }
    }

    /** 无作答时的空趋势，两个 provider 都可能返回。 */
    public static StudentScoreTrend empty(String examTypeCode, Unit scaledUnit, Unit rawUnit) {
        return new StudentScoreTrend(examTypeCode, Statistics.empty(),
            Series.empty(scaledUnit), Series.empty(rawUnit), Excluded.empty());
    }
}
