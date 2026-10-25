package com.unifiedexam.platform.examtype.sat;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;

class SatAdminExamResultsServiceTest {

    @Test
    void summarizesOnlyCompletedStudentsWithScores() {
        SatAdminExamResultsService service = new SatAdminExamResultsService(
            mock(JdbcTemplate.class), mock(SatAdminStudentScoreService.class));
        Map<String, Object> summary = new HashMap<>();

        service.addScoreSummary(summary, List.of(
            participant("COMPLETED", "43", "850"),
            participant("COMPLETED", "81", "1340"),
            participant("IN_PROGRESS", "99", "1500"),
            participant("COMPLETED", null, null)
        ));

        assertEquals(new BigDecimal("62.0"), summary.get("averageRawScore"));
        assertEquals(new BigDecimal("43"), summary.get("lowestRawScore"));
        assertEquals(new BigDecimal("81"), summary.get("highestRawScore"));
        assertEquals(new BigDecimal("1095.0"), summary.get("averageScaledScore"));
        assertEquals(new BigDecimal("850"), summary.get("lowestScaledScore"));
        assertEquals(new BigDecimal("1340"), summary.get("highestScaledScore"));
    }

    @Test
    void leavesScoreStatisticsEmptyWhenNoStudentHasCompleted() {
        SatAdminExamResultsService service = new SatAdminExamResultsService(
            mock(JdbcTemplate.class), mock(SatAdminStudentScoreService.class));
        Map<String, Object> summary = new HashMap<>();

        service.addScoreSummary(summary, List.of(participant("IN_PROGRESS", "50", "900")));

        assertEquals(null, summary.get("averageRawScore"));
        assertEquals(null, summary.get("highestRawScore"));
        assertEquals(null, summary.get("lowestRawScore"));
        assertEquals(null, summary.get("averageScaledScore"));
        assertEquals(null, summary.get("highestScaledScore"));
        assertEquals(null, summary.get("lowestScaledScore"));
        assertEquals(null, summary.get("averageRw1RawScore"));
        assertEquals(null, summary.get("averageMathRawScore"));
    }

    @Test
    void summarizesModuleAndSectionRawAveragesFromCompletedAttemptsOnly() {
        SatAdminExamResultsService service = new SatAdminExamResultsService(
            mock(JdbcTemplate.class), mock(SatAdminStudentScoreService.class));
        Map<String, Object> summary = new HashMap<>();

        service.addScoreSummary(summary, List.of(
            participant("COMPLETED", "20", "900", "10", "4", "8", "2", "14", "10"),
            participant("COMPLETED", "42", "1200", "20", "6", "12", "4", "26", "16"),
            participant("IN_PROGRESS", "99", "1500", "99", "99", "99", "99", "198", "198")
        ));

        assertEquals(new BigDecimal("15.0"), summary.get("averageRw1RawScore"));
        assertEquals(new BigDecimal("5.0"), summary.get("averageRw2RawScore"));
        assertEquals(new BigDecimal("10.0"), summary.get("averageMath1RawScore"));
        assertEquals(new BigDecimal("3.0"), summary.get("averageMath2RawScore"));
        assertEquals(new BigDecimal("20.0"), summary.get("averageRwRawScore"));
        assertEquals(new BigDecimal("13.0"), summary.get("averageMathRawScore"));
    }

    @Test
    void formatsConfiguredSatModuleNamesAndKeepsUnknownNames() {
        assertEquals("R&W Module 1", SatAdminExamResultsService.moduleLabel("RW", 1, "Reading 1"));
        assertEquals("Math Module 2", SatAdminExamResultsService.moduleLabel("MATH", 2, "Math 2"));
        assertEquals("Custom section", SatAdminExamResultsService.moduleLabel(null, null, "Custom section"));
    }

    private Map<String, Object> participant(String status, String raw, String scaled) {
        Map<String, Object> row = new HashMap<>();
        row.put("status", status);
        row.put("rawTotalScore", raw == null ? null : new BigDecimal(raw));
        row.put("totalScaledScore", scaled == null ? null : new BigDecimal(scaled));
        return row;
    }

    private Map<String, Object> participant(String status, String raw, String scaled,
            String rw1, String rw2, String math1, String math2, String rw, String math) {
        Map<String, Object> row = participant(status, raw, scaled);
        row.put("rw1RawScore", new BigDecimal(rw1));
        row.put("rw2RawScore", new BigDecimal(rw2));
        row.put("math1RawScore", new BigDecimal(math1));
        row.put("math2RawScore", new BigDecimal(math2));
        row.put("rwRawScore", new BigDecimal(rw));
        row.put("mathRawScore", new BigDecimal(math));
        return row;
    }
}
