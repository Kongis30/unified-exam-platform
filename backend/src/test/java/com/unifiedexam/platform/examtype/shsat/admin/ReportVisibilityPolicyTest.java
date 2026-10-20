package com.unifiedexam.platform.examtype.shsat.admin;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReportVisibilityPolicyTest {

    @Test
    void afterSubmitVisibilityRequiresSubmittedAttempt() {
        assertTrue(ReportVisibilityPolicy.isVisible("AFTER_SUBMIT", true, false));
        assertFalse(ReportVisibilityPolicy.isVisible("AFTER_SUBMIT", false, true));
    }

    @Test
    void afterCloseVisibilityWaitsForExamWindowToEnd() {
        assertFalse(ReportVisibilityPolicy.isVisible("AFTER_CLOSE", true, false));
        assertTrue(ReportVisibilityPolicy.isVisible("AFTER_CLOSE", true, true));
    }

    @Test
    void unknownVisibilityRulesFailClosed() {
        assertFalse(ReportVisibilityPolicy.isVisible("IMMEDIATE", true, true));
        assertFalse(ReportVisibilityPolicy.isVisible(null, true, true));
    }
}
