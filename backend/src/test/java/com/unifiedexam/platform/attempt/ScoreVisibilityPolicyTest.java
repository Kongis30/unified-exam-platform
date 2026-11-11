package com.unifiedexam.platform.attempt;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScoreVisibilityPolicyTest {

    @Test
    void afterSubmitVisibilityRequiresSubmittedAttempt() {
        assertTrue(ScoreVisibilityPolicy.isVisible("AFTER_SUBMIT", true, false));
        assertFalse(ScoreVisibilityPolicy.isVisible("AFTER_SUBMIT", false, true));
    }

    @Test
    void afterCloseVisibilityWaitsForExamWindowToEnd() {
        assertFalse(ScoreVisibilityPolicy.isVisible("AFTER_CLOSE", true, false));
        assertTrue(ScoreVisibilityPolicy.isVisible("AFTER_CLOSE", true, true));
    }

    @Test
    void unknownVisibilityRulesFailClosed() {
        assertFalse(ScoreVisibilityPolicy.isVisible("IMMEDIATE", true, true));
        assertFalse(ScoreVisibilityPolicy.isVisible(null, true, true));
    }

    @Test
    void shsatAnswerReviewOpensAfterSubmissionWithoutWaitingForExamClose() {
        assertTrue(ScoreVisibilityPolicy.isReviewVisible(true, true));
        assertFalse(ScoreVisibilityPolicy.isReviewVisible(true, false));
        assertFalse(ScoreVisibilityPolicy.isReviewVisible(false, true));
    }
}
