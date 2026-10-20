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
}
