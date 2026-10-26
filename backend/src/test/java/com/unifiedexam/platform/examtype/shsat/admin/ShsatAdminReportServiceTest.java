package com.unifiedexam.platform.examtype.shsat.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ShsatAdminReportServiceTest {

    @Test
    void reportReturnsSafeQuestionCountsAlongsideHiddenQuestionDetails() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            ResultSetExtractor<Object> extractor = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.next()).thenReturn(true, false);
            when(row.getLong("id")).thenReturn(993L);
            when(row.getLong("exam_id")).thenReturn(515L);
            when(row.getLong("paper_id")).thenReturn(244L);
            when(row.getLong("question_count")).thenReturn(100L);
            when(row.getLong("answered_count")).thenReturn(100L);
            when(row.getInt("attempt_no")).thenReturn(1);
            when(row.getInt("time_used")).thenReturn(500);
            when(row.getString("status")).thenReturn("COMPLETED");
            when(row.getString("exam_title")).thenReturn("SHSAT UI Audit");
            when(row.getString("paper_name")).thenReturn("SHSAT Practice");
            when(row.getString("real_name")).thenReturn("Audit Student");
            when(row.getObject("is_estimated")).thenReturn(null);
            when(row.getBigDecimal("total_points")).thenReturn(new BigDecimal("50"));
            when(row.getBigDecimal("max_points")).thenReturn(new BigDecimal("100"));
            when(row.getLong("correct_count")).thenReturn(50L);
            when(row.getLong("wrong_count")).thenReturn(50L);
            when(row.getBoolean("is_practice")).thenReturn(false);
            return extractor.extractData(row);
        });
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());

        Map<String, Object> result = new ShsatAdminReportService(jdbc, new ObjectMapper()).attemptResult(993L);

        assertEquals(100L, result.get("questionCount"));
        assertEquals(100L, result.get("answeredCount"));
        assertEquals(List.of(), result.get("questions"));
    }

    @Test
    void monitorCountsSavedAnswersInsteadOfServedQuestions() throws Exception {
        JdbcTemplate jdbc = monitorJdbc(0, 0, 0);

        Map<String, Object> result = new ShsatAdminReportService(jdbc, new ObjectMapper()).monitorAnalytics(27L);
        Map<?, ?> question = firstQuestion(result);

        assertEquals(0L, question.get("attemptedCount"));
        assertEquals(1L, question.get("unansweredCount"));
        assertEquals(0L, question.get("pendingCount"));
        assertNull(question.get("accuracy"));
        verify(jdbc).query(
            org.mockito.ArgumentMatchers.argThat(sql -> sql.contains("FROM attempt_answers aa JOIN attempts a")
                && sql.contains("JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'NULL'")
                && !sql.contains("FROM attempt_items ai JOIN attempts a")),
            any(RowMapper.class), eq(27L), eq(27L), eq(27L), eq(27L), eq(88L));
    }

    @Test
    void monitorSeparatesPendingAnswersFromScoredAccuracy() throws Exception {
        JdbcTemplate jdbc = monitorJdbc(2, 1, 0);

        Map<String, Object> result = new ShsatAdminReportService(jdbc, new ObjectMapper()).monitorAnalytics(27L);
        Map<?, ?> question = firstQuestion(result);

        assertEquals(2L, question.get("attemptedCount"));
        assertEquals(1L, question.get("pendingCount"));
        assertEquals(0L, question.get("unansweredCount"));
        assertEquals(new BigDecimal("100.00"), question.get("accuracy"));
    }

    private JdbcTemplate monitorJdbc(long attempted, long correct, long wrong) throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            ResultSetExtractor<Object> extractor = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.next()).thenReturn(true, false);
            when(row.getLong("id")).thenReturn(27L);
            when(row.getLong("paper_id")).thenReturn(88L);
            when(row.getString("title")).thenReturn("SHSAT Practice");
            when(row.getTimestamp("opens_at")).thenReturn(Timestamp.valueOf("2026-10-20 09:00:00"));
            when(row.getTimestamp("closes_at")).thenReturn(Timestamp.valueOf("2026-10-20 12:00:00"));
            when(row.getObject("duration_seconds", Integer.class)).thenReturn(10800);
            when(row.getLong("participants")).thenReturn(1L);
            return extractor.extractData(row);
        });
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq(27L))).thenReturn(1L);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getLong("question_id")).thenReturn(700L);
            when(row.getInt("display_number")).thenReturn(1);
            when(row.getString("question_type_code")).thenReturn("MULTIPLE_CHOICE");
            when(row.getString("skill_tag_code")).thenReturn(null);
            when(row.getLong("attempted")).thenReturn(attempted);
            when(row.getLong("correct")).thenReturn(correct);
            when(row.getLong("wrong")).thenReturn(wrong);
            when(row.getBigDecimal("average_time_spent")).thenReturn(null);
            return List.of(mapper.mapRow(row, 0));
        });
        return jdbc;
    }

    private Map<?, ?> firstQuestion(Map<String, Object> result) {
        return (Map<?, ?>) ((List<?>) result.get("questionAnalytics")).get(0);
    }
}
