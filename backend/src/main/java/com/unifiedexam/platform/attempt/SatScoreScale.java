package com.unifiedexam.platform.attempt;

/** Retains the standalone SAT/PSAT report's raw-to-scaled score conversion tables. */
final class SatScoreScale {

    private static final int[] SAT_RW = {200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 330,
        340, 350, 360, 370, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600,
        610, 620, 630, 640, 650, 660, 670, 680, 690, 700, 710, 720, 730, 740, 750, 760, 770, 780, 790, 800, 800};
    private static final int[] SAT_MATH = {200, 220, 230, 240, 250, 280, 300, 320, 340, 350, 360, 380, 390, 400,
        450, 460, 480, 490, 510, 520, 530, 550, 560, 570, 580, 590, 610, 620, 630, 640, 650, 670, 680, 690,
        700, 710, 720, 730, 740, 750, 760, 770, 780, 790, 800};
    private static final int[] SAT_LARGE_RW = {200, 200, 200, 200, 200, 200, 200, 210, 220, 230, 250, 260, 270,
        280, 300, 310, 340, 360, 370, 380, 390, 390, 400, 410, 420, 420, 440, 440, 450, 460, 470, 480, 480,
        490, 500, 510, 510, 520, 530, 540, 550, 560, 560, 570, 580, 590, 600, 610, 610, 620, 630, 640, 650,
        660, 660, 670, 680, 690, 700, 710, 720, 730, 740, 750, 770};
    private static final int[] SAT_LARGE_MATH = {200, 200, 200, 200, 200, 200, 200, 220, 230, 250, 280, 310, 320,
        330, 340, 350, 370, 360, 390, 380, 390, 400, 400, 410, 420, 450, 450, 450, 470, 490, 500, 510, 530,
        540, 550, 560, 580, 590, 600, 610, 620, 630, 650, 660, 680, 700, 720, 740, 760, 770, 780, 790, 800,
        800, 800};
    private static final int[] PSAT_RW = {160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 290, 300,
        310, 320, 340, 350, 360, 370, 390, 400, 420, 430, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540,
        550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650, 660, 670, 680, 690, 700, 710, 720, 730, 750, 760};
    private static final int[] PSAT_MATH = {160, 180, 190, 200, 210, 240, 260, 280, 300, 310, 330, 340, 350, 360,
        370, 390, 400, 410, 420, 430, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 590,
        600, 610, 620, 640, 650, 660, 680, 690, 720, 750, 760};

    int scaledTotal(String scoringType, String subject, int rawScore, int paperQuestionCount) {
        boolean readingWriting = "RW".equals(subject);
        int[] table = "PSAT".equalsIgnoreCase(scoringType)
            ? (readingWriting ? PSAT_RW : PSAT_MATH)
            : paperQuestionCount > 98
                ? (readingWriting ? SAT_LARGE_RW : SAT_LARGE_MATH)
                : (readingWriting ? SAT_RW : SAT_MATH);
        return table[Math.max(0, Math.min(rawScore, table.length - 1))];
    }
}
