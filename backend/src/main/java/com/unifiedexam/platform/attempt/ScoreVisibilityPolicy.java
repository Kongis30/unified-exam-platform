package com.unifiedexam.platform.attempt;

/**
 * 考试成绩与答案可见性口径。
 *
 * <p>{@code exams.score_visibility} 的语义（AFTER_SUBMIT / AFTER_CLOSE）与考试类型无关，
 * 因此放在平台层供各类型模块共用：SHSAT 的学生报告、学生分数趋势，以及 SAT/PSAT 的
 * 学生分数趋势都必须遵循同一规则，不能在各自模块里各写一份。
 */
public final class ScoreVisibilityPolicy {

    private ScoreVisibilityPolicy() { }

    /** 成绩对学生的可见规则；未提交（含未开考）一律不可见。 */
    public static boolean isVisible(String rule, boolean submitted, boolean examClosed) {
        if (!submitted || rule == null) return false;
        return switch (rule) {
            case "AFTER_SUBMIT" -> true;
            case "AFTER_CLOSE" -> examClosed;
            default -> false;
        };
    }

    /** 答案复习由 allow_review 控制，提交后即可开放，不受考试窗口关闭时间限制。 */
    public static boolean isReviewVisible(boolean allowReview, boolean submitted) {
        return allowReview && submitted;
    }
}
