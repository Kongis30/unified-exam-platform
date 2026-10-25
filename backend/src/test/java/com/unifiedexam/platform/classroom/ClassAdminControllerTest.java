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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ClassAdminControllerTest {

    @Test
    void deleteClassDetachesEnrollmentsAndReleaseTargetsButKeepsStudentAndExamRecords() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(Boolean.class), eq(12L))).thenReturn(true);
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class), eq(12L))).thenReturn(12L);
        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class), eq(12L))).thenReturn(0);
        when(jdbcTemplate.update(anyString(), eq(12L))).thenReturn(1);

        new ClassAdminController(jdbcTemplate).deleteClass(12L);

        verify(jdbcTemplate).update("DELETE FROM exam_target_classes WHERE class_id = ?", 12L);
        verify(jdbcTemplate).update("DELETE FROM class_memberships WHERE class_id = ?", 12L);
        verify(jdbcTemplate).update("DELETE FROM classes WHERE id = ?", 12L);
        verify(jdbcTemplate, never()).update(org.mockito.ArgumentMatchers.contains("DELETE FROM users"), eq(12L));
        verify(jdbcTemplate, never()).update(org.mockito.ArgumentMatchers.contains("DELETE FROM attempts"), eq(12L));
    }

    @Test
    void deleteClassIsBlockedWhileShsatReviewTasksReferToIt() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(Boolean.class), eq(12L))).thenReturn(true);
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class), eq(12L))).thenReturn(12L);
        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class), eq(12L))).thenReturn(2);

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> new ClassAdminController(jdbcTemplate).deleteClass(12L));

        assertEquals(409, error.getStatusCode().value());
        assertTrue(error.getReason().contains("SHSAT review tasks"));
        verify(jdbcTemplate, never()).update(anyString(), eq(12L));
    }

    @Test
    void classScoreTrendFiltersExamTypesAndMapsAggregates() throws Exception {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(Boolean.class), eq(12L))).thenReturn(true);
        LocalDateTime examDate = LocalDateTime.of(2026, 10, 18, 9, 30);
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<ClassAdminController.TrendAttemptRow> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getLong("exam_id")).thenReturn(41L);
            when(row.getString("exam_title")).thenReturn("Practice Exam");
            when(row.getString("exam_type_code")).thenReturn("PSAT");
            when(row.getTimestamp("exam_date")).thenReturn(Timestamp.valueOf(examDate));
            when(row.getBigDecimal("total_points")).thenReturn(new java.math.BigDecimal("60"));
            when(row.getString("source_score_json")).thenReturn("{\"total_score\":1300}");
            when(row.getBigDecimal("imported_rw1_raw")).thenReturn(new java.math.BigDecimal("15"));
            when(row.getBigDecimal("imported_rw2_raw")).thenReturn(new java.math.BigDecimal("15"));
            when(row.getBigDecimal("imported_math1_raw")).thenReturn(new java.math.BigDecimal("15"));
            when(row.getBigDecimal("imported_math2_raw")).thenReturn(new java.math.BigDecimal("15"));
            when(row.getString("scoring_table_code")).thenReturn("PSAT");
            return List.of(mapper.mapRow(row, 0));
        });

        List<ClassAdminController.ClassExamScoreTrendView> result = new ClassAdminController(jdbcTemplate)
            .classExamScoreTrend(12L, List.of("SAT", "PSAT"));

        assertEquals(1, result.size());
        assertEquals(41L, result.get(0).examId());
        assertEquals("Practice Exam", result.get(0).examTitle());
        assertEquals("PSAT", result.get(0).examTypeCode());
        assertEquals(examDate, result.get(0).examDate());
        assertEquals(new java.math.BigDecimal("60.00"), result.get(0).averageRawScore());
        assertEquals(new java.math.BigDecimal("1300.00"), result.get(0).averageScaledScore());
        assertEquals(1L, result.get(0).studentCount());
        verify(jdbcTemplate).query(
            org.mockito.ArgumentMatchers.argThat(sql -> sql.contains("ROW_NUMBER()")
                && sql.contains("a.is_practice = FALSE") && sql.contains("p.exam_type_code IN (?, ?)")
                && sql.contains("source_score_json") && sql.contains("rb.breakdown_code = ps.section_code")
                && sql.contains("'$.moduleNumber')) AS UNSIGNED) = 1")),
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

    @Test
    void classScoreTrendCalculatesScaledScoreForNewAttempts() throws Exception {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(Boolean.class), eq(12L))).thenReturn(true);
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<ClassAdminController.TrendAttemptRow> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getLong("exam_id")).thenReturn(42L);
            when(row.getString("exam_title")).thenReturn("SAT Exam");
            when(row.getString("exam_type_code")).thenReturn("SAT");
            when(row.getTimestamp("exam_date")).thenReturn(Timestamp.valueOf(LocalDateTime.of(2026, 10, 20, 9, 0)));
            when(row.getBigDecimal("total_points")).thenReturn(new java.math.BigDecimal("20"));
            when(row.getBigDecimal("rw1_raw")).thenReturn(new java.math.BigDecimal("5"));
            when(row.getBigDecimal("rw2_raw")).thenReturn(new java.math.BigDecimal("5"));
            when(row.getBigDecimal("math1_raw")).thenReturn(new java.math.BigDecimal("5"));
            when(row.getBigDecimal("math2_raw")).thenReturn(new java.math.BigDecimal("5"));
            when(row.getString("scoring_table_code")).thenReturn("SAT");
            when(row.getInt("paper_question_count")).thenReturn(98);
            return List.of(mapper.mapRow(row, 0));
        });

        var result = new ClassAdminController(jdbcTemplate).classExamScoreTrend(12L, List.of("SAT"));

        assertEquals(new java.math.BigDecimal("20.00"), result.get(0).averageRawScore());
        assertEquals(new java.math.BigDecimal("660.00"), result.get(0).averageScaledScore());
    }
}
