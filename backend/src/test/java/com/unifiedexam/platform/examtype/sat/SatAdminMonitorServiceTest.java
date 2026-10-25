package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SatAdminMonitorServiceTest {

    @Test
    void analyticsNumbersQuestionsAcrossModulesAndCalculatesAccuracy() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            ResultSetExtractor<Object> extractor = invocation.getArgument(1);
            ResultSet examRow = mock(ResultSet.class);
            when(examRow.next()).thenReturn(true, false);
            when(examRow.getLong("id")).thenReturn(7L);
            when(examRow.getLong("paper_id")).thenReturn(12L);
            when(examRow.getString("exam_type_code")).thenReturn("SAT");
            when(examRow.getString("title")).thenReturn("SAT Practice");
            when(examRow.getTimestamp("opens_at")).thenReturn(Timestamp.valueOf("2026-10-20 09:00:00"));
            when(examRow.getTimestamp("closes_at")).thenReturn(Timestamp.valueOf("2026-10-20 12:00:00"));
            when(examRow.getObject("duration_seconds", Integer.class)).thenReturn(10800);
            when(examRow.getLong("participants")).thenReturn(4L);
            return extractor.extractData(examRow);
        });
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq(7L))).thenReturn(2L);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
            ResultSet questionRow = mock(ResultSet.class);
            when(questionRow.getLong("question_id")).thenReturn(100L);
            when(questionRow.getInt("question_number")).thenReturn(29);
            when(questionRow.getString("question_type_code")).thenReturn("SAT_MULTIPLE_CHOICE");
            when(questionRow.getLong("attempted")).thenReturn(2L);
            when(questionRow.getLong("correct")).thenReturn(1L);
            when(questionRow.getLong("wrong")).thenReturn(0L);
            when(questionRow.getBigDecimal("average_time_spent")).thenReturn(new BigDecimal("42.5"));
            return List.of(mapper.mapRow(questionRow, 0));
        });

        Map<String, Object> result = new SatAdminMonitorService(jdbc, new ObjectMapper()).analytics(7L);
        @SuppressWarnings("unchecked")
        Map<String, Object> question = (Map<String, Object>) ((List<?>) result.get("questionAnalytics")).get(0);

        assertEquals(29, question.get("questionNumber"));
        assertEquals(2L, question.get("attemptedCount"));
        assertEquals(1L, question.get("correctCount"));
        assertEquals(0L, question.get("wrongCount"));
        assertEquals(1L, question.get("pendingCount"));
        assertEquals(new BigDecimal("100.00"), question.get("accuracy"));
        assertEquals(0L, question.get("unansweredCount"));
        assertEquals(new BigDecimal("42.5"), question.get("averageTimeSpent"));
    }

    @Test
    void monitorRejectsNonSatExam() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            ResultSetExtractor<Object> extractor = invocation.getArgument(1);
            ResultSet empty = mock(ResultSet.class);
            when(empty.next()).thenReturn(false);
            return extractor.extractData(empty);
        });

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> new SatAdminMonitorService(jdbc, new ObjectMapper()).live(99L));
        assertEquals(404, error.getStatusCode().value());
    }
}
