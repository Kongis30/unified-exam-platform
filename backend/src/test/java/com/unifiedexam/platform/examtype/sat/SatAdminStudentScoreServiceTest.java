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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SatAdminStudentScoreServiceTest {

    @Test
    void keepsImportedRawAndScaledScoresDistinct() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            ResultSetExtractor<Object> extractor = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.next()).thenReturn(true, false);
            when(row.getLong("id")).thenReturn(42L);
            when(row.getString("real_name")).thenReturn("Student One");
            when(row.getString("username")).thenReturn("student1@jin");
            when(row.getString("email")).thenReturn("student@example.com");
            when(row.getString("class_names")).thenReturn("SAT Class");
            return extractor.extractData(row);
        });
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getString("source_score_json")).thenReturn("""
                {"total_score":1400,"rw_total_scaled":700,"math_total_scaled":700,"correct_questions":50,"rw_module1_scaled":420}
                """);
            when(row.getBigDecimal("imported_rw1_raw")).thenReturn(new BigDecimal("12"));
            when(row.getBigDecimal("imported_rw2_raw")).thenReturn(new BigDecimal("12"));
            when(row.getBigDecimal("imported_math1_raw")).thenReturn(new BigDecimal("13"));
            when(row.getBigDecimal("imported_math2_raw")).thenReturn(new BigDecimal("13"));
            when(row.getString("scoring_table_code")).thenReturn("PSAT");
            when(row.getInt("paper_question_count")).thenReturn(98);
            when(row.getLong("attempt_id")).thenReturn(88L);
            when(row.getLong("exam_id")).thenReturn(9L);
            when(row.getInt("attempt_no")).thenReturn(1);
            when(row.getString("status")).thenReturn("SUBMITTED");
            when(row.getString("exam_title")).thenReturn("PSAT Practice");
            when(row.getString("paper_title")).thenReturn("Practice Paper");
            when(row.getString("exam_type_code")).thenReturn("PSAT");
            when(row.getString("algorithm_version")).thenReturn("SAT_LEGACY");
            when(row.getBigDecimal("total_points")).thenReturn(new BigDecimal("1400"));
            when(row.getTimestamp("started_at")).thenReturn(Timestamp.valueOf("2026-10-20 09:00:00"));
            when(row.getTimestamp("submitted_at")).thenReturn(Timestamp.valueOf("2026-10-20 11:00:00"));
            when(row.getTimestamp("opens_at")).thenReturn(Timestamp.valueOf("2026-10-20 08:30:00"));
            return List.of(mapper.mapRow(row, 0));
        });

        Map<String, Object> result = new SatAdminStudentScoreService(jdbc, new ObjectMapper()).scores(42L);
        @SuppressWarnings("unchecked")
        Map<String, Object> score = (Map<String, Object>) ((List<?>) result.get("scores")).get(0);
        @SuppressWarnings("unchecked")
        Map<String, Object> statistics = (Map<String, Object>) result.get("statistics");

        assertEquals(new BigDecimal("50"), score.get("rawTotalScore"));
        assertEquals(new BigDecimal("1400"), score.get("totalScaledScore"));
        assertEquals(new BigDecimal("24"), score.get("rwRawScore"));
        assertEquals(new BigDecimal("12"), score.get("rw1RawScore"));
        assertEquals(new BigDecimal("12"), score.get("rw2RawScore"));
        assertEquals(new BigDecimal("13"), score.get("math1RawScore"));
        assertEquals(new BigDecimal("13"), score.get("math2RawScore"));
        assertEquals(new BigDecimal("700"), score.get("rwScaledScore"));
        assertEquals(new BigDecimal("420"), score.get("rw1ScaledScore"));
        assertEquals(new BigDecimal("400"), score.get("rw2ScaledScore"));
        assertEquals(new BigDecimal("360"), score.get("math1ScaledScore"));
        assertEquals(new BigDecimal("400"), score.get("math2ScaledScore"));
        @SuppressWarnings("unchecked")
        Map<String, Object> psatStats = (Map<String, Object>) statistics.get("psat");
        assertEquals(new BigDecimal("50.0"), psatStats.get("averageRawScore"));
        assertEquals(new BigDecimal("1400.0"), psatStats.get("averageScaledScore"));
        assertEquals(new BigDecimal("50"), psatStats.get("lowestRawScore"));
        assertEquals(new BigDecimal("1400"), psatStats.get("lowestScaledScore"));
        assertEquals(new BigDecimal("700.0"), psatStats.get("averageRwScaledScore"));
        assertEquals(new BigDecimal("700.0"), psatStats.get("averageMathScaledScore"));
        verify(jdbc).query(org.mockito.ArgumentMatchers.argThat(sql -> sql.contains("rb.breakdown_code = ps.section_code")
                && sql.contains("'$.subject')) = 'RW'") && sql.contains("'$.moduleNumber')) AS UNSIGNED) = 2")),
            any(RowMapper.class), eq(42L));
    }

    @Test
    void calculatesMinimumAndSectionAveragesSeparatelyForSatAndPsat() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            ResultSetExtractor<Object> extractor = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.next()).thenReturn(true, false);
            when(row.getLong("id")).thenReturn(42L);
            when(row.getString("real_name")).thenReturn("Student One");
            when(row.getString("username")).thenReturn("student1@jin");
            return extractor.extractData(row);
        });
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
            return List.of(
                scoreRow(mapper, 101L, "SAT", 5, 1000, 500),
                scoreRow(mapper, 102L, "SAT", 6, 1400, 700),
                scoreRow(mapper, 103L, "PSAT", 10, 1200, 600));
        });

        @SuppressWarnings("unchecked")
        Map<String, Object> statistics = (Map<String, Object>) new SatAdminStudentScoreService(jdbc, new ObjectMapper())
            .scores(42L).get("statistics");
        @SuppressWarnings("unchecked")
        Map<String, Object> sat = (Map<String, Object>) statistics.get("sat");
        @SuppressWarnings("unchecked")
        Map<String, Object> psat = (Map<String, Object>) statistics.get("psat");

        assertEquals(2, sat.get("attempts"));
        assertEquals(new BigDecimal("22.0"), sat.get("averageRawScore"));
        assertEquals(new BigDecimal("20"), sat.get("lowestRawScore"));
        assertEquals(new BigDecimal("1200.0"), sat.get("averageScaledScore"));
        assertEquals(new BigDecimal("1000"), sat.get("lowestScaledScore"));
        assertEquals(new BigDecimal("600.0"), sat.get("averageRwScaledScore"));
        assertEquals(new BigDecimal("600.0"), sat.get("averageMathScaledScore"));
        assertEquals(new BigDecimal("40"), psat.get("lowestRawScore"));
        assertEquals(new BigDecimal("1200"), psat.get("lowestScaledScore"));
    }

    private Map<String, Object> scoreRow(RowMapper<Map<String, Object>> mapper, long attemptId,
                                         String examType, int moduleRaw, int totalScaled, int sectionScaled) throws Exception {
        ResultSet row = mock(ResultSet.class);
        when(row.getString("source_score_json")).thenReturn("{\"total_score\":" + totalScaled
            + ",\"rw_total_scaled\":" + sectionScaled + ",\"math_total_scaled\":" + sectionScaled + "}");
        when(row.getBigDecimal("imported_rw1_raw")).thenReturn(BigDecimal.valueOf(moduleRaw));
        when(row.getBigDecimal("imported_rw2_raw")).thenReturn(BigDecimal.valueOf(moduleRaw));
        when(row.getBigDecimal("imported_math1_raw")).thenReturn(BigDecimal.valueOf(moduleRaw));
        when(row.getBigDecimal("imported_math2_raw")).thenReturn(BigDecimal.valueOf(moduleRaw));
        when(row.getString("scoring_table_code")).thenReturn(examType);
        when(row.getInt("paper_question_count")).thenReturn(98);
        when(row.getLong("attempt_id")).thenReturn(attemptId);
        when(row.getLong("exam_id")).thenReturn(attemptId + 1000);
        when(row.getInt("attempt_no")).thenReturn(1);
        when(row.getString("status")).thenReturn("SUBMITTED");
        when(row.getString("exam_title")).thenReturn("Practice " + attemptId);
        when(row.getString("paper_title")).thenReturn("Paper " + attemptId);
        when(row.getString("exam_type_code")).thenReturn(examType);
        when(row.getString("algorithm_version")).thenReturn("SAT_LEGACY");
        return mapper.mapRow(row, (int) attemptId);
    }

    @Test
    void calculatesModuleScoresFromThePaperDifficultySettings() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            ResultSetExtractor<Object> extractor = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.next()).thenReturn(true, false);
            when(row.getLong("id")).thenReturn(42L);
            when(row.getString("real_name")).thenReturn("Student One");
            when(row.getString("username")).thenReturn("student1@jin");
            return extractor.extractData(row);
        });
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getBigDecimal("imported_rw1_raw")).thenReturn(BigDecimal.ONE);
            when(row.getBigDecimal("imported_rw2_raw")).thenReturn(BigDecimal.ONE);
            when(row.getBigDecimal("imported_math1_raw")).thenReturn(BigDecimal.ONE);
            when(row.getBigDecimal("imported_math2_raw")).thenReturn(BigDecimal.ONE);
            when(row.getString("rw2_difficulty")).thenReturn("Low");
            when(row.getString("math2_difficulty")).thenReturn("High");
            when(row.getString("scoring_table_code")).thenReturn("SAT");
            when(row.getString("algorithm_version")).thenReturn("SAT_CURRENT");
            when(row.getString("status")).thenReturn("SUBMITTED");
            when(row.getString("exam_type_code")).thenReturn("SAT");
            when(row.getInt("attempt_no")).thenReturn(1);
            when(row.getInt("paper_question_count")).thenReturn(98);
            return List.of(mapper.mapRow(row, 0));
        });

        Map<String, Object> result = new SatAdminStudentScoreService(jdbc, new ObjectMapper()).scores(42L);
        @SuppressWarnings("unchecked")
        Map<String, Object> score = (Map<String, Object>) ((List<?>) result.get("scores")).get(0);

        assertEquals(new BigDecimal("220"), score.get("rw1ScaledScore"));
        assertEquals(new BigDecimal("300"), score.get("rw2ScaledScore"));
        assertEquals(new BigDecimal("220"), score.get("math1ScaledScore"));
        assertEquals(new BigDecimal("300"), score.get("math2ScaledScore"));
        verify(jdbc).query(org.mockito.ArgumentMatchers.argThat(sql ->
                sql.contains("AS rw2_difficulty") && sql.contains("AS math2_difficulty")),
            any(RowMapper.class), eq(42L));
    }

    @Test
    void examResultsQueryIncludesDifficultyColumnsRequiredBySharedScoreMapper() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(41L))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getString("rw2_difficulty")).thenReturn("Low");
            when(row.getString("math2_difficulty")).thenReturn("High");
            when(row.getBigDecimal("imported_rw1_raw")).thenReturn(BigDecimal.ONE);
            when(row.getBigDecimal("imported_rw2_raw")).thenReturn(BigDecimal.ONE);
            when(row.getBigDecimal("imported_math1_raw")).thenReturn(BigDecimal.ONE);
            when(row.getBigDecimal("imported_math2_raw")).thenReturn(BigDecimal.ONE);
            when(row.getString("scoring_table_code")).thenReturn("SAT");
            when(row.getString("algorithm_version")).thenReturn("SAT_CURRENT");
            when(row.getString("status")).thenReturn("SUBMITTED");
            when(row.getString("exam_type_code")).thenReturn("SAT");
            when(row.getInt("paper_question_count")).thenReturn(98);
            return List.of(mapper.mapRow(row, 0));
        });

        List<Map<String, Object>> results = new SatAdminStudentScoreService(jdbc, new ObjectMapper()).scoresForExam(41L);

        assertEquals(new BigDecimal("300"), results.get(0).get("rw2ScaledScore"));
        assertEquals(new BigDecimal("300"), results.get(0).get("math2ScaledScore"));
        verify(jdbc).query(org.mockito.ArgumentMatchers.argThat(sql ->
                sql.contains("AS rw2_difficulty") && sql.contains("AS math2_difficulty")),
            any(RowMapper.class), eq(41L));
    }

    @Test
    void rejectsIdsThatAreNotStudents() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            @SuppressWarnings("unchecked")
            ResultSetExtractor<Object> extractor = invocation.getArgument(1);
            ResultSet empty = mock(ResultSet.class);
            when(empty.next()).thenReturn(false);
            return extractor.extractData(empty);
        });

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> new SatAdminStudentScoreService(jdbc, new ObjectMapper()).scores(42L));
        assertEquals(404, error.getStatusCode().value());
    }

    @Test
    void deletesOnlyTheOwnedFormalSatAttemptAndReliesOnCascadeForDetails() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), eq(91L), eq(42L))).thenReturn(91L);
        when(jdbc.update("DELETE FROM attempts WHERE id = ?", 91L)).thenReturn(1);

        new SatAdminStudentScoreService(jdbc, new ObjectMapper()).deleteAttempt(42L, 91L);

        verify(jdbc).query(org.mockito.ArgumentMatchers.argThat(sql -> sql.contains("p.exam_type_code IN ('SAT', 'PSAT')")
                && sql.contains("a.is_practice = FALSE") && sql.contains("FOR UPDATE")),
            any(ResultSetExtractor.class), eq(91L), eq(42L));
        verify(jdbc).update("DELETE FROM attempts WHERE id = ?", 91L);
    }

    @Test
    void refusesAttemptsThatBelongToAnotherStudentOrExamType() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), eq(91L), eq(42L))).thenReturn(null);

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> new SatAdminStudentScoreService(jdbc, new ObjectMapper()).deleteAttempt(42L, 91L));

        assertEquals(404, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void mapsImportedSatSectionCodesFromPaperModuleMetadata() {
        String sql = SatModuleScoreSql.rawScore("Math", 2);

        assertTrue(sql.contains("rb.breakdown_code = ps.section_code"));
        assertTrue(sql.contains("'$.subject')) = 'Math'"));
        assertTrue(sql.contains("'$.moduleNumber')) AS UNSIGNED) = 2"));
        assertThrows(IllegalArgumentException.class, () -> SatModuleScoreSql.rawScore("Reading", 1));
        assertThrows(IllegalArgumentException.class, () -> SatModuleScoreSql.rawScore("RW", 3));
    }
}
