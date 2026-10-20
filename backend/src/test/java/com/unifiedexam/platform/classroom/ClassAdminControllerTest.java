package com.unifiedexam.platform.classroom;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ClassAdminControllerTest {

    @Test
    void classScoreTrendFiltersExamTypesAndMapsAggregates() throws Exception {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(Boolean.class), eq(12L))).thenReturn(true);
        LocalDateTime examDate = LocalDateTime.of(2026, 10, 18, 9, 30);
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<ClassAdminController.ClassExamScoreTrendView> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getLong("exam_id")).thenReturn(41L);
            when(row.getString("exam_title")).thenReturn("Practice Exam");
            when(row.getTimestamp("exam_date")).thenReturn(Timestamp.valueOf(examDate));
            when(row.getBigDecimal("average_score")).thenReturn(new java.math.BigDecimal("72.50"));
            when(row.getLong("student_count")).thenReturn(8L);
            return List.of(mapper.mapRow(row, 0));
        });

        List<ClassAdminController.ClassExamScoreTrendView> result = new ClassAdminController(jdbcTemplate)
            .classExamScoreTrend(12L, List.of("SAT", "PSAT"));

        assertEquals(1, result.size());
        assertEquals(41L, result.get(0).examId());
        assertEquals("Practice Exam", result.get(0).examTitle());
        assertEquals(examDate, result.get(0).examDate());
        assertEquals(new java.math.BigDecimal("72.50"), result.get(0).averageScore());
        assertEquals(8L, result.get(0).studentCount());
        verify(jdbcTemplate).query(
            org.mockito.ArgumentMatchers.argThat(sql -> sql.contains("ROW_NUMBER()")
                && sql.contains("a.is_practice = FALSE") && sql.contains("p.exam_type_code IN (?, ?)")),
            any(RowMapper.class),
            eq(12L), eq("SAT"), eq("PSAT"));
    }

    @Test
    void classScoreTrendRejectsMalformedExamTypeCodes() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(Boolean.class), eq(12L))).thenReturn(true);

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> new ClassAdminController(jdbcTemplate).classExamScoreTrend(12L, List.of("SAT; DROP TABLE exams")));

        assertEquals(400, error.getStatusCode().value());
        verify(jdbcTemplate, org.mockito.Mockito.never()).query(anyString(), any(RowMapper.class), any(Object[].class));
    }
}
