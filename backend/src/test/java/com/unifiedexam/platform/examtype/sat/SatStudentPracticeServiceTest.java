package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.attempt.SatStudentAttemptService;
import com.unifiedexam.platform.attempt.StudentAttemptService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq(42L))).thenReturn(1L);
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
    }

    @Test
    void deletingAnotherUsersOrNonPracticeRecordReturnsNotFound() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("student"))).thenReturn(true);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(9L), eq("student"))).thenReturn(List.of());
        SatStudentAttemptService service = new SatStudentAttemptService(jdbc, new ObjectMapper(), mock(StudentAttemptService.class));

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.deletePracticeAttempt(9L, "student"));

        assertEquals(404, error.getStatusCode().value());
    }

    @Test
    void deletingOwnedCompletedPracticeRecordRemovesAttemptAndCascadedAnswers() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq("student"))).thenReturn(true);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(9L), eq("student"))).thenReturn(List.of(9L));
        SatStudentAttemptService service = new SatStudentAttemptService(jdbc, new ObjectMapper(), mock(StudentAttemptService.class));

        service.deletePracticeAttempt(9L, "student");

        verify(jdbc).update("DELETE FROM attempts WHERE id = ?", 9L);
    }
}
