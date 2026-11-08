package com.unifiedexam.platform.examtype.shsat.admin;

final class ReportVisibilityPolicy {

    private ReportVisibilityPolicy() { }

    static boolean isVisible(String rule, boolean submitted, boolean examClosed) {
        if (!submitted || rule == null) return false;
        return switch (rule) {
            case "AFTER_SUBMIT" -> true;
            case "AFTER_CLOSE" -> examClosed;
            default -> false;
        };
    }

    /** SHSAT 答案复习由 allow_review 控制，提交后即可开放，不受考试窗口关闭时间限制。 */
    static boolean isReviewVisible(boolean allowReview, boolean submitted) {
        return allowReview && submitted;
    }
}
