package com.unifiedexam.platform.attempt;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SatScoreScaleTest {

    private final SatScoreScale scores = new SatScoreScale();

    @Test
    void usesStandaloneSatTablesAndThePaperSizeBoundary() {
        assertEquals(370, scores.scaledTotal("SAT", "RW", 17, 98));
        assertEquals(450, scores.scaledTotal("SAT", "RW", 18, 98));
        assertEquals(250, scores.scaledTotal("SAT", "RW", 10, 99));
        assertEquals(400, scores.scaledTotal("SAT", "Math", 13, 98));
    }

    @Test
    void usesPsatTablesAndClampsScoresOutsideTheScale() {
        assertEquals(290, scores.scaledTotal("PSAT", "RW", 12, 98));
        assertEquals(760, scores.scaledTotal("PSAT", "RW", 100, 98));
        assertEquals(160, scores.scaledTotal("PSAT", "Math", -1, 98));
    }

    @Test
    void matchesLegacyLowMiddleAndMaximumTotalScoreBaselines() {
        assertEquals(200, scores.scaledTotal("SAT", "RW", 0, 98));
        assertEquals(540, scores.scaledTotal("SAT", "RW", 27, 98));
        assertEquals(800, scores.scaledTotal("SAT", "RW", 54, 98));
        assertEquals(200, scores.scaledTotal("SAT", "Math", 0, 98));
        assertEquals(560, scores.scaledTotal("SAT", "Math", 22, 98));
        assertEquals(800, scores.scaledTotal("SAT", "Math", 44, 98));

        assertEquals(160, scores.scaledTotal("PSAT", "RW", 0, 98));
        assertEquals(480, scores.scaledTotal("PSAT", "RW", 27, 98));
        assertEquals(760, scores.scaledTotal("PSAT", "RW", 54, 98));
        assertEquals(160, scores.scaledTotal("PSAT", "Math", 0, 98));
        assertEquals(470, scores.scaledTotal("PSAT", "Math", 22, 98));
        assertEquals(760, scores.scaledTotal("PSAT", "Math", 44, 98));
    }

    @Test
    void matchesLegacyLargePaperScoreBaselines() {
        assertEquals(200, scores.scaledTotal("SAT", "RW", 0, 99));
        assertEquals(480, scores.scaledTotal("SAT", "RW", 32, 99));
        assertEquals(770, scores.scaledTotal("SAT", "RW", 64, 99));
        assertEquals(200, scores.scaledTotal("SAT", "Math", 0, 99));
        assertEquals(450, scores.scaledTotal("SAT", "Math", 27, 99));
        assertEquals(800, scores.scaledTotal("SAT", "Math", 54, 99));
    }

    @Test
    void preservesStandaloneModuleScoreMaps() {
        assertEquals(300, scores.scaledModule("RW", 1, "Mid", 5));
        assertEquals(400, scores.scaledModule("RW", 2, "High", 2));
        assertEquals(360, scores.scaledModule("Math", 1, "Mid", 8));
        assertEquals(200, scores.scaledModule("Math", 2, "Low", 0));
    }

    @Test
    void preservesAllStandaloneSecondModuleDifficultyBranches() {
        for (String difficulty : new String[] {"Low", "Mid", "High"}) {
            assertEquals(300, scores.scaledModule("RW", 2, difficulty, 1));
            assertEquals(300, scores.scaledModule("Math", 2, difficulty, 1));
        }
        assertEquals(220, scores.scaledModule("RW", 1, "High", 1));
        assertEquals(300, scores.scaledModule("RW", 2, null, 1));
        assertEquals(0, scores.scaledModule("RW", 2, "Easy", 1));
        assertEquals(0, scores.scaledModule("RW", 2, " ", 1));
        assertEquals(0, scores.scaledModule("RW", 3, "Mid", 1));
    }
}
