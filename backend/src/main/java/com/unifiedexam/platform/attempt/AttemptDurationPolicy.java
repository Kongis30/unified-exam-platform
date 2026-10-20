package com.unifiedexam.platform.attempt;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Resolves a fixed attempt duration from release, paper, and SHSAT accommodation settings. */
final class AttemptDurationPolicy {

    private AttemptDurationPolicy() { }

    static Integer resolve(Integer releaseSeconds, Integer paperDefaultSeconds,
                           BigDecimal timeMultiplier, boolean shsat) {
        Integer standardSeconds = positive(releaseSeconds) ? releaseSeconds
            : positive(paperDefaultSeconds) ? paperDefaultSeconds : null;
        if (standardSeconds == null) return null;
        if (!shsat) return standardSeconds;

        BigDecimal multiplier = timeMultiplier == null || timeMultiplier.compareTo(BigDecimal.ONE) < 0
            ? BigDecimal.ONE : timeMultiplier;
        return BigDecimal.valueOf(standardSeconds).multiply(multiplier)
            .setScale(0, RoundingMode.DOWN).intValueExact();
    }

    private static boolean positive(Integer seconds) {
        return seconds != null && seconds > 0;
    }
}
