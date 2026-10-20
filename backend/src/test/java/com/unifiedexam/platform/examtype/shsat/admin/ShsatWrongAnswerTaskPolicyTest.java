package com.unifiedexam.platform.examtype.shsat.admin;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ShsatWrongAnswerTaskPolicyTest {

    @Test
    void taskWindowIsInclusiveAtStartAndExclusiveAtEnd() {
        LocalDateTime start = LocalDateTime.of(2026, 10, 16, 9, 0);
        LocalDateTime end = start.plusHours(1);

        assertFalse(ShsatWrongAnswerTaskPolicy.isAvailable("PUBLISHED", start, end, start.minusNanos(1)));
        assertTrue(ShsatWrongAnswerTaskPolicy.isAvailable("PUBLISHED", start, end, start));
        assertFalse(ShsatWrongAnswerTaskPolicy.isAvailable("PUBLISHED", start, end, end));
        assertFalse(ShsatWrongAnswerTaskPolicy.isAvailable("ENDED", start, end, start.plusMinutes(1)));
    }

    @Test
    void inProgressAttemptCanContinueAfterTaskEnds() {
        assertEquals("IN_PROGRESS", ShsatWrongAnswerTaskPolicy.studentStatus("ENDED", "IN_PROGRESS", "IN_PROGRESS", 3));
        assertEquals("ENDED", ShsatWrongAnswerTaskPolicy.studentStatus("ENDED", "SUBMITTED", "RETRY_REQUIRED", 3));
    }

    @Test
    void completedAndRetryStatesFollowRemainingQuestionCount() {
        assertEquals("COMPLETED", ShsatWrongAnswerTaskPolicy.studentStatus("PUBLISHED", "SUBMITTED", "RETRY_REQUIRED", 0));
        assertEquals("RETRY_REQUIRED", ShsatWrongAnswerTaskPolicy.studentStatus("PUBLISHED", "SUBMITTED", "IN_PROGRESS", 1));
        assertEquals("NOT_STARTED", ShsatWrongAnswerTaskPolicy.studentStatus("PUBLISHED", null, "NOT_STARTED", 2));
    }
}
