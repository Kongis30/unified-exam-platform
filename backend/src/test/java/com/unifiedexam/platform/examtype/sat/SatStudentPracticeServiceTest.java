package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.attempt.SatStudentAttemptService;
import com.unifiedexam.platform.attempt.StudentAttemptService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;


import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SatStudentPracticeServiceTest {

    @Test
    void practiceHistoryReturnsOnlyOwnedCompletedPracticeRecordsAndClampsPaging() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("student"))).thenReturn(true);
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq("student"))).thenReturn(42L);
        when(jdbc.queryForObject(anyString(), eq(Long.class), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull(), eq(42L))).thenReturn(1L);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<SatStudentAttemptService.PracticeAttemptView> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getLong("attempt_id")).thenReturn(9L);
            when(row.getLong("paper_id")).thenReturn(7L);
            when(row.getString("paper_title")).thenReturn("SAT Practice");
            when(row.getString("exam_type_code")).thenReturn("SAT");
            when(row.getTimestamp("started_at")).thenReturn(Timestamp.from(Instant.parse("2026-10-01T10:00:00Z")));
            when(row.getTimestamp("submitted_at")).thenReturn(Timestamp.from(Instant.parse("2026-10-01T12:00:00Z")));
            when(row.getBigDecimal("total_points")).thenReturn(new java.math.BigDecimal("42"));
            when(row.getBigDecimal("max_points")).thenReturn(new java.math.BigDecimal("98"));
            when(row.getLong("time_spent_seconds")).thenReturn(7200L);
            return List.of(mapper.mapRow(row, 0));
        });

        SatStudentAttemptService service = new SatStudentAttemptService(jdbc, new ObjectMapper(), mock(StudentAttemptService.class));
        var history = service.practiceHistory("student", -2, 500);

        assertEquals(1, history.current());
        assertEquals(100, history.size());
        assertEquals(1, history.total());
        assertEquals(9L, history.records().get(0).attemptId());
        assertEquals("SAT", history.records().get(0).examTypeCode());
        assertEquals(new java.math.BigDecimal("42"), history.records().get(0).rawScore());

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(sql.capture(), eq(Long.class), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull(), eq(42L));
        assertPracticeHistoryLinks(sql.getValue());
        verify(jdbc).query(sql.capture(), any(RowMapper.class), any(Object[].class));
        assertPracticeHistoryLinks(sql.getValue());
    }

    /** 迁移归档与可重复练习模板都必须能进入本人历史。 */
    private void assertPracticeHistoryLinks(String sql) {
        assertTrue(sql.contains("sat_practice_papers spp") && sql.contains("sat_practice_paper_templates spt"));
        assertTrue(sql.contains("spp.practice_exam_id = a.exam_id") && sql.contains("spt.practice_exam_id = a.exam_id"));
        assertTrue(sql.contains("a.is_practice = TRUE") && sql.contains("a.status = 'SUBMITTED'"));
    }
}
