package com.unifiedexam.platform.attempt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SatStudentAttemptServiceTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void importedReportUsesArchivedLegacyScoresInsteadOfRecountingAnswers() throws Exception {
        ObjectNode summary = mapper.createObjectNode();
        summary.put("rw1Raw", 25);
        summary.put("rw2Raw", 24);
        summary.put("math1Raw", 21);
        summary.put("math2Raw", 19);
        summary.put("totalRaw", 89);
        summary.put("ebrwScaled", 760);
        summary.put("mathScaled", 760);
        summary.put("totalScaled", 1520);
        var sourceScore = mapper.readTree("""
            {"rw_total_scaled":770,"math_total_scaled":760,"total_score":1530}
            """);

        SatStudentAttemptService.applyLegacyReportSummary(summary, sourceScore,
            26, 24, 21, 19, 1628, 1260, 822, 3106);

        assertEquals(26, summary.path("rw1Raw").asInt());
        assertEquals(90, summary.path("totalRaw").asInt());
        assertEquals(770, summary.path("ebrwScaled").asInt());
        assertEquals(760, summary.path("mathScaled").asInt());
        assertEquals(1530, summary.path("totalScaled").asInt());
        assertEquals(1628, summary.path("rw1Spend").asInt());
    }

    @Test
    void importedReportKeepsCalculatedValuesWhenLegacyFieldsAreMissing() {
        ObjectNode summary = mapper.createObjectNode();
        summary.put("totalRaw", 42);
        summary.put("totalScaled", 1200);

        SatStudentAttemptService.applyLegacyReportSummary(summary, mapper.nullNode(),
            null, null, null, null, null, null, null, null);

        assertEquals(42, summary.path("totalRaw").asInt());
        assertEquals(1200, summary.path("totalScaled").asInt());
    }

    @Test
    void studentQuestionReviewEndpointsRequireAnswerVisibility() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(false);
        SatStudentAttemptService service = new SatStudentAttemptService(jdbc, mapper, mock(StudentAttemptService.class));

        ResponseStatusException modulesError = Assertions.assertThrows(ResponseStatusException.class,
            () -> service.modulesForStudent(329, "student"));
        ResponseStatusException questionsError = Assertions.assertThrows(ResponseStatusException.class,
            () -> service.questionsForStudent(329, 20, "student"));

        assertEquals(404, modulesError.getStatusCode().value());
        assertEquals(404, questionsError.getStatusCode().value());
        var sql = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(2)).queryForObject(sql.capture(), eq(Boolean.class), any(Object[].class));
        assertEquals(2, sql.getAllValues().stream().filter(query ->
            query.contains("e.answer_visibility = 'AFTER_SUBMIT'")
                && query.contains("e.answer_visibility = 'AFTER_CLOSE'")
                && query.contains("e.closes_at <= CURRENT_TIMESTAMP(6)")
        ).count());
        verify(jdbc, never()).query(anyString(), any(org.springframework.jdbc.core.RowMapper.class), any(Object[].class));
    }

    @Test
    void questionMaterialFallbackIsLimitedToCurrentTimedModuleOrReleasedReview() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(false);
        SatStudentAttemptService service = new SatStudentAttemptService(jdbc, mapper, mock(StudentAttemptService.class));

        ResponseStatusException error = Assertions.assertThrows(ResponseStatusException.class,
            () -> service.questionDetailForStudent(9001, "student"));

        assertEquals(404, error.getStatusCode().value());
        var sql = org.mockito.ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(sql.capture(), eq(Boolean.class), any(Object[].class));
        assertTrue(sql.getValue().contains("state.active_module_section_id = pi.section_id"));
        assertTrue(sql.getValue().contains("state.module_started_at IS NOT NULL"));
        assertTrue(sql.getValue().contains("TIMESTAMPDIFF(SECOND, state.module_started_at, CURRENT_TIMESTAMP(6))"));
        assertTrue(sql.getValue().contains("e.answer_visibility = 'AFTER_CLOSE'"));
    }
}
