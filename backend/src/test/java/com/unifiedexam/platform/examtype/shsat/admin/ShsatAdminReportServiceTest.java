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
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ShsatAdminReportServiceTest {

    @Test
    void classExamScoresExcludeImportedEmptyAnswersFromCompletionAndAccuracy() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("WHERE e.id = ? AND p.exam_type_code = 'SHSAT'")),
            any(ResultSetExtractor.class), eq(20L))).thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                ResultSetExtractor<Object> extractor = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.next()).thenReturn(true, false);
                when(row.getLong("id")).thenReturn(20L);
                when(row.getLong("paper_id")).thenReturn(27L);
                when(row.getString("title")).thenReturn("SHSAT Exam");
                when(row.getLong("participants")).thenReturn(18L);
                return extractor.extractData(row);
            });
        when(jdbc.queryForObject(argThat(sql -> sql.contains("SELECT EXISTS(SELECT 1 FROM classes")),
            eq(Boolean.class), eq(29L))).thenReturn(true);
        when(jdbc.queryForObject(argThat(sql -> sql.contains("target_scope = 'ALL_STUDENTS'")),
            eq(Boolean.class), eq(20L), eq(20L), eq(29L), eq(20L), eq(29L), eq(20L), eq(29L))).thenReturn(true);
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("AS answered_count")),
            any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.getLong("student_id")).thenReturn(213L);
                when(row.getString("real_name")).thenReturn("Harry Lin");
                when(row.getString("username")).thenReturn("HarryL@jin");
                when(row.getLong("answered_count")).thenReturn(98L);
                when(row.getLong("correct_count")).thenReturn(37L);
                when(row.getLong("wrong_count")).thenReturn(61L);
                when(row.getLong("question_count")).thenReturn(100L);
                when(row.getObject("attempt_id")).thenReturn(132L);
                when(row.getObject("attempt_no")).thenReturn(1);
                when(row.getString("attempt_status")).thenReturn("SUBMITTED");
                when(row.getObject("is_estimated")).thenReturn(false);
                return List.of(mapper.mapRow(row, 0));
            });

        Map<String, Object> result = new ShsatAdminReportService(jdbc, new ObjectMapper())
            .classExamScores(20L, 29L).get(0);

        assertEquals(2L, result.get("unansweredCount"));
        assertEquals(new BigDecimal("98.00"), result.get("completionRate"));
        assertEquals(new BigDecimal("37.76"), result.get("accuracy"));
        verify(jdbc).query(argThat(sql -> sql.contains("JSON_CONTAINS_PATH(aa.answer_json, 'one', '$.legacyAnswer')")
                && sql.contains("JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'NULL'")
                && !sql.contains("COALESCE(r.ungraded_count, 0) AS answered_count")),
            any(RowMapper.class), any(Object[].class));
    }

    @Test
    void studentAttemptHistoryIncludesQuestionCount() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), eq(226L))).thenReturn(true);
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("AS question_count")
                && sql.contains("WHERE a.student_user_id = ?") && sql.contains("p.exam_type_code = 'SHSAT'")
                && sql.contains("a.is_practice = FALSE")),
            any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.getLong("question_count")).thenReturn(100L);
                when(row.getLong("answered_count")).thenReturn(100L);
                when(row.getLong("correct_count")).thenReturn(63L);
                when(row.getLong("wrong_count")).thenReturn(37L);
                when(row.getLong("id")).thenReturn(133L);
                when(row.getLong("exam_id")).thenReturn(20L);
                when(row.getLong("paper_id")).thenReturn(247L);
                when(row.getInt("attempt_no")).thenReturn(1);
                when(row.getInt("time_used")).thenReturn(9023);
                when(row.getString("status")).thenReturn("COMPLETED");
                when(row.getString("exam_title")).thenReturn("SHSAT Practice");
                when(row.getString("paper_name")).thenReturn("SHSAT Paper");
                when(row.getObject("is_estimated")).thenReturn(false);
                return List.of(mapper.mapRow(row, 0));
            });

        List<Map<String, Object>> history = new ShsatAdminReportService(jdbc, new ObjectMapper())
            .studentAttemptHistory(226L);

        assertEquals(100L, history.get(0).get("totalQuestions"));
        assertEquals(63L, history.get(0).get("correctCount"));
        assertEquals(37L, history.get(0).get("wrongCount"));
        verify(jdbc).query(argThat(sql -> sql.contains("p.exam_type_code = 'SHSAT'")
                && sql.contains("a.is_practice = FALSE")), any(RowMapper.class), any(Object[].class));
    }

    @Test
    void studentOwnAttemptHistoryOpensReviewAfterSubmitBeforeExamCloses() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("e.allow_review")
                && !sql.contains("e.answer_visibility")), any(RowMapper.class), eq("student")))
            .thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.getLong("question_count")).thenReturn(10L);
                when(row.getLong("answered_count")).thenReturn(10L);
                when(row.getLong("correct_count")).thenReturn(8L);
                when(row.getLong("wrong_count")).thenReturn(2L);
                when(row.getLong("cleared_count")).thenReturn(0L);
                when(row.getLong("id")).thenReturn(41L);
                when(row.getLong("exam_id")).thenReturn(27L);
                when(row.getLong("paper_id")).thenReturn(12L);
                when(row.getInt("attempt_no")).thenReturn(1);
                when(row.getInt("ungraded_count")).thenReturn(0);
                when(row.getString("status")).thenReturn("SUBMITTED");
                when(row.getString("score_visibility")).thenReturn("AFTER_SUBMIT");
                when(row.getString("exam_title")).thenReturn("SHSAT Exam");
                when(row.getString("paper_name")).thenReturn("SHSAT Paper");
                when(row.getBoolean("is_practice")).thenReturn(false);
                when(row.getBoolean("allow_review")).thenReturn(true);
                when(row.getBoolean("exam_closed")).thenReturn(false);
                when(row.getObject("shsat_self_practice_source_attempt_id")).thenReturn(null);
                return List.of(mapper.mapRow(row, 0));
            });

        Map<String, Object> attempt = new ShsatAdminReportService(jdbc, new ObjectMapper())
            .studentOwnAttemptHistory("student").get(0);

        assertEquals(true, attempt.get("answersVisible"), "review is available immediately after submission");
    }

    @Test
    void monitorCountsStudentsOnceWhenTheyHaveMultipleAttempts() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("FROM exams e JOIN papers p")),
            any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                ResultSetExtractor<Object> extractor = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.next()).thenReturn(true, false);
                when(row.getLong("id")).thenReturn(27L);
                when(row.getLong("paper_id")).thenReturn(88L);
                when(row.getString("title")).thenReturn("SHSAT Monitor");
                when(row.getTimestamp("opens_at")).thenReturn(Timestamp.valueOf("2026-10-20 09:00:00"));
                when(row.getTimestamp("closes_at")).thenReturn(Timestamp.valueOf("2026-10-20 12:00:00"));
                when(row.getObject("duration_seconds", Integer.class)).thenReturn(10800);
                when(row.getLong("participants")).thenReturn(2L);
                return extractor.extractData(row);
            });
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("AS in_progress_students")),
            any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                ResultSetExtractor<Object> extractor = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.next()).thenReturn(true);
                when(row.getLong("started")).thenReturn(3L);
                when(row.getLong("in_progress")).thenReturn(1L);
                when(row.getLong("submitted")).thenReturn(2L);
                when(row.getLong("in_progress_students")).thenReturn(1L);
                when(row.getLong("completed_students")).thenReturn(1L);
                when(row.getTimestamp("last_seen")).thenReturn(Timestamp.valueOf("2026-10-20 10:00:00"));
                return extractor.extractData(row);
            });
        when(jdbc.queryForObject(anyString(), eq(Long.class), eq(27L))).thenReturn(1L);
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("FROM shsat_attempt_state s")),
            any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.getInt("question_number")).thenReturn(1);
                when(row.getLong("students")).thenReturn(1L);
                return List.of(mapper.mapRow(row, 0));
            });

        Map<String, Object> result = new ShsatAdminReportService(jdbc, new ObjectMapper()).monitorLive(27L);
        Map<?, ?> summary = (Map<?, ?>) result.get("summary");

        assertEquals(3L, summary.get("startedAttempts"));
        assertEquals(2L, summary.get("finishedAttempts"));
        assertEquals(1L, summary.get("inProgressStudents"));
        assertEquals(1L, summary.get("completedStudents"));
        assertEquals(2L, summary.get("incompleteStudents"));
        verify(jdbc).query(argThat(sql -> sql != null && sql.contains("FROM users u")
                && sql.contains("u.role_code = 'STUDENT' AND u.status = 'ACTIVE'")
                && sql.contains("FROM exam_target_students ts")
                && sql.contains("FROM exam_target_classes tc")
                && sql.contains("cm.left_at IS NULL")
                && !sql.contains("FROM exam_participants ep")),
            any(ResultSetExtractor.class), any(Object[].class));
        verify(jdbc).query(argThat(sql -> sql != null && sql.contains("COUNT(DISTINCT CASE WHEN a.status = 'IN_PROGRESS'")
                && sql.contains("a.student_user_id END) AS in_progress_students")
                && sql.contains("'COMPLETED', 'EXPIRED'")
                && sql.contains("a.status NOT IN ('NOT_STARTED', 'CANCELLED')")),
            any(ResultSetExtractor.class), any(Object[].class));
    }

    @Test
    void importedAnswerAliasesRemainAvailableInTheReport() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("SELECT a.id, a.exam_id")), any(ResultSetExtractor.class), any(Object[].class)))
            .thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                ResultSetExtractor<Object> extractor = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.next()).thenReturn(true, false);
                when(row.getLong("id")).thenReturn(79L);
                when(row.getLong("exam_id")).thenReturn(16L);
                when(row.getLong("paper_id")).thenReturn(244L);
                when(row.getLong("question_count")).thenReturn(1L);
                when(row.getLong("answered_count")).thenReturn(1L);
                when(row.getLong("correct_count")).thenReturn(0L);
                when(row.getLong("wrong_count")).thenReturn(1L);
                when(row.getInt("attempt_no")).thenReturn(1);
                when(row.getInt("time_used")).thenReturn(24);
                when(row.getString("status")).thenReturn("COMPLETED");
                when(row.getString("exam_title")).thenReturn("Imported SHSAT");
                when(row.getString("paper_name")).thenReturn("Imported SHSAT Paper");
                when(row.getString("real_name")).thenReturn("Audit Student");
                when(row.getObject("is_estimated")).thenReturn(false);
                when(row.getBoolean("is_practice")).thenReturn(false);
                when(row.getBigDecimal("total_points")).thenReturn(new BigDecimal("0"));
                when(row.getBigDecimal("max_points")).thenReturn(new BigDecimal("1"));
                return extractor.extractData(row);
            });
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("SELECT breakdown_code, raw_score")), any(ResultSetExtractor.class), any(Object[].class)))
            .thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                ResultSetExtractor<Object> extractor = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.next()).thenReturn(false);
                return extractor.extractData(row);
            });
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("FROM attempt_items ai")), any(RowMapper.class), any(Object[].class)))
            .thenAnswer(invocation -> {
                @SuppressWarnings("unchecked")
                RowMapper<Map<String, Object>> mapper = invocation.getArgument(1);
                ResultSet row = mock(ResultSet.class);
                when(row.getLong("question_id")).thenReturn(700L);
                when(row.getInt("display_number")).thenReturn(1);
                when(row.getString("question_type_code")).thenReturn("MULTIPLE_CHOICE");
                when(row.getString("section_code")).thenReturn("ELA");
                when(row.getString("section_title")).thenReturn("ELA");
                when(row.getString("section_kind")).thenReturn("SECTION");
                when(row.getString("stem")).thenReturn("Question");
                when(row.getString("render_json")).thenReturn("{\"materialId\":7117}");
                when(row.getString("answer_key_json")).thenReturn("{\"answers\":[\"D\"]}");
                when(row.getString("answer_json")).thenReturn("{\"answers\":[\"A\"]}");
                when(row.getString("imported_answer_metadata")).thenReturn("{\"selected_answer\":null,\"correct_answer\":\"D\"}");
                when(row.getString("grading_json")).thenReturn("{}");
                when(row.getObject("is_correct")).thenReturn(false);
                when(row.getBigDecimal("awarded_points")).thenReturn(BigDecimal.ZERO);
                when(row.getBigDecimal("max_points")).thenReturn(BigDecimal.ONE);
                when(row.getObject("shsat_material_id")).thenReturn(7117L);
                when(row.getString("shsat_material_title")).thenReturn("Missing image");
                when(row.getString("shsat_material_type")).thenReturn("IMAGE");
                when(row.getString("shsat_material_category")).thenReturn("Reading Passage");
                when(row.getString("shsat_material_content")).thenReturn(null);
                when(row.getString("shsat_material_asset_key")).thenReturn("1-missing-image.jpg");
                return List.of(mapper.mapRow(row, 0));
            });

        Map<String, Object> report = new ShsatAdminReportService(jdbc, new ObjectMapper()).attemptResult(79L);
        Map<?, ?> question = (Map<?, ?>) ((List<?>) report.get("questions")).get(0);

        assertEquals("{\"answers\":[\"A\"]}", question.get("selectedAnswer"));
        assertEquals("D", question.get("correctAnswer"));
        assertEquals("{\"answers\":[\"A\"]}", question.get("answerData"));
        assertEquals("/uploads/paper-materials/1-missing-image.jpg", question.get("assetUrl"));
        assertEquals("Missing image", question.get("materialTitle"));
        verify(jdbc).query(argThat(sql -> sql.contains("shsat_paper_materials shpm")
                && sql.contains("JSON_EXTRACT(q.render_json, '$.materialId')")),
            any(RowMapper.class), any(Object[].class));
    }

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
        verify(jdbc).query(argThat(sql -> sql.contains("JSON_CONTAINS_PATH(aa.answer_json, 'one', '$.legacyAnswer')")
                && sql.contains("AS answered_count")
                && !sql.contains("COALESCE(r.ungraded_count, 0) AS answered_count")),
            any(ResultSetExtractor.class), any(Object[].class));
    }

    @Test
    void monitorCountsSavedAnswersInsteadOfServedQuestions() throws Exception {
        JdbcTemplate jdbc = monitorJdbc(0, 0, 0, "ELA");

        Map<String, Object> result = new ShsatAdminReportService(jdbc, new ObjectMapper()).monitorAnalytics(27L);
        Map<?, ?> question = firstQuestion(result);

        assertEquals(0L, question.get("attemptedCount"));
        assertEquals(1L, question.get("unansweredCount"));
        org.junit.jupiter.api.Assertions.assertFalse(question.containsKey("pendingCount"));
        assertNull(question.get("accuracy"));
        assertEquals("ELA", question.get("shsatSubjectCode"));
        verify(jdbc).query(
            org.mockito.ArgumentMatchers.argThat(sql -> sql.contains("FROM attempt_answers aa JOIN attempts a")
                && sql.contains("JSON_TYPE(JSON_EXTRACT(aa.answer_json, '$.legacyAnswer')) = 'NULL'")
                && sql.contains("subject_code") && sql.contains("part.settings_json")
                && sql.contains("FROM attempt_items ai JOIN attempts a")),
            any(RowMapper.class), eq(27L), eq(27L), eq(27L), eq(27L), eq(27L), eq(88L));
    }

    @Test
    void monitorReturnsOnlyScoredAccuracyWithoutPendingState() throws Exception {
        JdbcTemplate jdbc = monitorJdbc(2, 1, 0, "MATH");

        Map<String, Object> result = new ShsatAdminReportService(jdbc, new ObjectMapper()).monitorAnalytics(27L);
        Map<?, ?> question = firstQuestion(result);

        assertEquals(2L, question.get("attemptedCount"));
        org.junit.jupiter.api.Assertions.assertFalse(question.containsKey("pendingCount"));
        assertEquals(0L, question.get("unansweredCount"));
        assertEquals(new BigDecimal("100.00"), question.get("accuracy"));
        assertEquals("MATH", question.get("shsatSubjectCode"));
    }

    private JdbcTemplate monitorJdbc(long attempted, long correct, long wrong, String subjectCode) throws Exception {
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
            when(row.getString("subject_code")).thenReturn(subjectCode);
            when(row.getString("skill_tag_code")).thenReturn(null);
            when(row.getLong("served")).thenReturn(Math.max(1L, attempted));
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
