package com.unifiedexam.platform.attempt;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class AttemptDurationPolicyTest {

    @Test
    void releaseDurationTakesPrecedenceOverPaperDefault() {
        assertEquals(10_800, AttemptDurationPolicy.resolve(5_400, 7_200, BigDecimal.valueOf(2), true));
    }

    @Test
    void fallsBackToPaperDefaultWhenReleaseDurationIsMissing() {
        assertEquals(7_200, AttemptDurationPolicy.resolve(null, 7_200, BigDecimal.ONE, true));
    }

    @Test
    void appliesShsatMultiplierAndRoundsDownLikeTheLegacyShsatSystem() {
        assertEquals(8_100, AttemptDurationPolicy.resolve(5_400, null, BigDecimal.valueOf(1.5), true));
        assertEquals(8_101, AttemptDurationPolicy.resolve(5_401, null, BigDecimal.valueOf(1.5), true));
    }

    @Test
    void ignoresShsatAccommodationForOtherExamTypes() {
        assertEquals(5_400, AttemptDurationPolicy.resolve(5_400, null, BigDecimal.valueOf(2), false));
    }

    @Test
    void returnsNoDurationWhenNeitherSourceContainsAPositiveValue() {
        assertNull(AttemptDurationPolicy.resolve(null, null, BigDecimal.ONE, true));
        assertNull(AttemptDurationPolicy.resolve(0, -1, BigDecimal.ONE, true));
    }
}
