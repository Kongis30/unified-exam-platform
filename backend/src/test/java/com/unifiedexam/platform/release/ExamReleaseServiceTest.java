package com.unifiedexam.platform.release;

import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ExamReleaseServiceTest {

    @Test
    void shsatDescriptionMatchesIndependentFiveHundredCharacterLimit() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        when(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM papers WHERE id = ?)", Boolean.class, 12L))
            .thenReturn(true);
        when(jdbc.query(eq("SELECT exam_type_code FROM papers WHERE id = ?"), any(ResultSetExtractor.class), eq(12L)))
            .thenReturn("SHSAT");
        when(registry.listAvailableTypes()).thenReturn(List.of(
            new ExamTypeDefinition("SHSAT", "SHSAT", "", 1, "SHSAT", "SHSAT")));
        when(jdbc.queryForObject("SELECT is_active FROM exam_types WHERE code = ?", Boolean.class, "SHSAT"))
            .thenReturn(true);
        var request = new ExamReleaseService.ExamRequest("Exam", "D".repeat(501),
            java.time.OffsetDateTime.parse("2026-10-28T09:00:00Z"), java.time.OffsetDateTime.parse("2026-10-28T12:00:00Z"),
            7200, 1, "SELECTED", true, true);

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.create(12L, request, "admin"));

        assertEquals(400, error.getStatusCode().value());
        assertEquals("The exam description must be no more than 500 characters.", error.getReason());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void satDescriptionRetainsSharedTwoThousandCharacterLimit() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        String description = "D".repeat(501);
        when(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM papers WHERE id = ?)", Boolean.class, 12L))
            .thenReturn(true);
        when(jdbc.query(eq("SELECT exam_type_code FROM papers WHERE id = ?"), any(ResultSetExtractor.class), eq(12L)))
            .thenReturn("SAT");
        when(registry.listAvailableTypes()).thenReturn(List.of(
            new ExamTypeDefinition("SAT", "SAT", "", 1, "SAT", "SAT")));
        when(jdbc.queryForObject("SELECT is_active FROM exam_types WHERE code = ?", Boolean.class, "SAT"))
            .thenReturn(true);
        when(jdbc.query(eq("SELECT id FROM users WHERE username = ? AND status = 'ACTIVE'"),
            any(ResultSetExtractor.class), eq("admin"))).thenReturn(1L);
        when(jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class)).thenReturn(44L);
        var summary = new ExamReleaseService.ExamSummary(44L, "SAT", 12L, "Paper", "Exam", description,
            "DRAFT", "ALL_STUDENTS", "2026-10-28T09:00:00Z", "2026-10-28T12:00:00Z", 7200,
            1, false, true, true, "2026-10-20T09:00:00Z", "2026-10-20T09:00:00Z", null, "All students");
        when(jdbc.query(anyString(), any(RowMapper.class), eq(44L))).thenAnswer(invocation ->
            invocation.<String>getArgument(0).contains("FROM exams e JOIN papers p") ? List.of(summary) : List.of());
        var request = new ExamReleaseService.ExamRequest("Exam", description,
            java.time.OffsetDateTime.parse("2026-10-28T09:00:00Z"), java.time.OffsetDateTime.parse("2026-10-28T12:00:00Z"),
            7200, 1, "SELECTED", true, true);

        var created = service.create(12L, request, "admin");

        assertEquals(description, created.summary().description());
        verify(jdbc).update(anyString(), any(Object[].class));
    }

    @Test
    void examWindowOutsideDatabaseDateRangeIsRejectedAsBadRequest() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        when(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM papers WHERE id = ?)", Boolean.class, 12L))
            .thenReturn(true);
        when(jdbc.query(eq("SELECT exam_type_code FROM papers WHERE id = ?"), any(ResultSetExtractor.class), eq(12L)))
            .thenReturn("SHSAT");
        when(registry.listAvailableTypes()).thenReturn(List.of(
            new ExamTypeDefinition("SHSAT", "SHSAT", "", 1, "SHSAT", "SHSAT")));
        when(jdbc.queryForObject("SELECT is_active FROM exam_types WHERE code = ?", Boolean.class, "SHSAT"))
            .thenReturn(true);

        var beforeDatabaseRange = new ExamReleaseService.ExamRequest("Early exam", null,
            java.time.OffsetDateTime.parse("0999-12-31T23:59:00Z"),
            java.time.OffsetDateTime.parse("1000-01-01T00:00:00Z"), 60, 1, "ALL_STUDENTS", true, true);
        var afterDatabaseRange = new ExamReleaseService.ExamRequest("Late exam", null,
            java.time.OffsetDateTime.parse("9999-12-31T23:59:00Z"),
            java.time.OffsetDateTime.parse("+10000-01-01T00:00:00Z"), 60, 1, "ALL_STUDENTS", true, true);

        for (var request : List.of(beforeDatabaseRange, afterDatabaseRange)) {
            ResponseStatusException error = assertThrows(ResponseStatusException.class,
                () -> service.create(12L, request, "admin"));
            assertEquals(400, error.getStatusCode().value());
            assertEquals("The exam window must fall between January 1, 1000 and December 31, 9999 UTC.", error.getReason());
        }
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void shsatScoreReportIsVisibleAfterSubmissionByDefault() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        when(registry.listAvailableTypes()).thenReturn(List.of(
            new ExamTypeDefinition("SHSAT", "SHSAT", "", 1, "SHSAT", "SHSAT")));
        when(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM papers WHERE id = ?)", Boolean.class, 12L)).thenReturn(true);
        when(jdbc.queryForObject("SELECT is_active FROM exam_types WHERE code = ?", Boolean.class, "SHSAT"))
            .thenReturn(true);
        when(jdbc.query(eq("SELECT exam_type_code FROM papers WHERE id = ?"), any(ResultSetExtractor.class), eq(12L)))
            .thenReturn("SHSAT");
        when(jdbc.query(eq("SELECT id FROM users WHERE username = ? AND status = 'ACTIVE'"),
            any(ResultSetExtractor.class), eq("admin"))).thenReturn(1L);
        when(jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class)).thenReturn(44L);

        ExamReleaseService.ExamSummary summary = new ExamReleaseService.ExamSummary(44L, "SHSAT", 12L,
            "Paper", "Exam", null, "DRAFT", "ALL_STUDENTS", "2026-10-24T09:00:00Z",
            "2026-10-24T12:00:00Z", 7200, 1, false, true, true,
            "2026-10-20T09:00:00Z", "2026-10-20T09:00:00Z", null, "All students");
        when(jdbc.query(anyString(), any(RowMapper.class), eq(44L))).thenAnswer(invocation ->
            invocation.<String>getArgument(0).contains("FROM exams e JOIN papers p") ? List.of(summary) : List.of());

        service.create(12L, new ExamReleaseService.ExamRequest("Exam", null,
            java.time.OffsetDateTime.parse("2026-10-24T09:00:00Z"), java.time.OffsetDateTime.parse("2026-10-24T12:00:00Z"),
            7200, 1, "SELECTED", true, true), "admin");

        org.mockito.ArgumentCaptor<String> sql = forClass(String.class);
        verify(jdbc).update(sql.capture(), any(Object[].class));
        String shsatAfterSubmitDefault = "IF(exam_type_code IN ('SAT', 'PSAT', 'SHSAT'), 'AFTER_SUBMIT', 'AFTER_CLOSE')";
        assertEquals(2, sql.getValue().split(java.util.regex.Pattern.quote(shsatAfterSubmitDefault), -1).length - 1,
            "SHSAT answer review and score visibility default to after submission");
    }

    @Test
    void examListExposesWhetherFormalAttemptsPreventUnpublishing() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));

        service.list("SAT");

        verify(jdbc).query(argThat(sql -> sql.contains("AS has_student_attempts")
                && sql.contains("a.is_practice = FALSE")
                && sql.contains("target_summary")
                && sql.contains("exam_target_classes")
                && sql.contains("exam_target_students")), any(RowMapper.class), eq("SAT"));
    }

    @Test
    void examDetailsReadReviewSettingsAfterCreation() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        ExamReleaseService.ExamSummary summary = new ExamReleaseService.ExamSummary(41L, "SHSAT", 12L,
            "Practice Paper", "Saturday Test", null, "DRAFT", "SELECTED", "2026-10-24T09:00:00Z",
            "2026-10-24T12:00:00Z", 7200, 1, false, true, true,
            "2026-10-20T09:00:00Z", "2026-10-24T10:00:00Z", null, "No students selected");
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation ->
            invocation.<String>getArgument(0).contains("FROM exams e JOIN papers p") ? List.of(summary) : List.of());

        ExamReleaseService.ExamDetail detail = service.get(41L);

        assertTrue(detail.summary().allowReview());
        assertTrue(detail.summary().autoSubmit());
        verify(jdbc).query(argThat(sql -> sql.contains("e.allow_review") && sql.contains("e.auto_submit")),
            any(RowMapper.class), eq(41L));
    }

    @Test
    void scheduledCloseMovesOnlyExpiredPublishedExamsToHistory() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));

        service.closeExpiredExams();

        verify(jdbc).update("""
            UPDATE exams SET status = 'CLOSED'
            WHERE status = 'PUBLISHED' AND closes_at <= CURRENT_TIMESTAMP(6)
            """);
    }

    @Test
    void studentExamListKeepsClosedReleasesWhenTheStudentHasAnAttempt() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamTypeModule satModule = mock(ExamTypeModule.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        ExamReleaseService.StudentExamView exam = new ExamReleaseService.StudentExamView(41L, "SAT",
            "Saturday Test", null, "2026-10-24T09:00:00Z", "2026-10-24T12:00:00Z",
            "Practice Paper", 7200, 1, 0, 55L, 55L, "ONE_ON_ONE");
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq("student"))).thenReturn(42L);
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(exam));
        when(registry.module("SAT")).thenReturn(Optional.of(satModule));
        when(satModule.supportsStudentAttempts()).thenReturn(true);

        List<ExamReleaseService.StudentExamView> exams = service.listForStudent("student");

        assertEquals(1, exams.size());
        assertEquals(55L, exams.get(0).activeAttemptId());

        verify(jdbc).query(argThat(sql -> sql.contains("e.status IN ('PUBLISHED', 'CLOSED', 'DRAFT')")
                && sql.contains("e.status = 'PUBLISHED' AND e.closes_at > CURRENT_TIMESTAMP(6)")
                && sql.contains("OR EXISTS (")
                && sql.contains("a.student_user_id = ep.student_user_id")
                && sql.contains("a.is_practice = FALSE")
                && sql.contains("e.status = 'DRAFT' AND a.status = 'IN_PROGRESS'")
                && sql.contains("a.status = 'IN_PROGRESS' AND a.expires_at <= CURRENT_TIMESTAMP(6)")
                && sql.contains("a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP(6)")
                && sql.contains("a.status IN ('SUBMITTED', 'COMPLETED') AND a.is_practice = FALSE) AS latest_attempt_id")
                && sql.contains("WHEN e.target_scope = 'ALL_STUDENTS' THEN 'GROUP'")
                && sql.contains("FROM exam_participant_classes pc")
                && sql.contains("JOIN exam_target_classes tc ON tc.exam_id = pc.exam_id AND tc.class_id = pc.class_id")
                && sql.contains("pc.student_user_id = ep.student_user_id")
                && sql.contains("ELSE 'ONE_ON_ONE' END AS assignment_kind")),
            any(RowMapper.class), any(Object[].class));
    }

    /** 学生首页按派发方式分组：整班派发归 GROUP，只派给个人归 ONE_ON_ONE。 */
    @Test
    void studentExamListExposesAssignmentKindForHomeGrouping() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamTypeModule satModule = mock(ExamTypeModule.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        ExamReleaseService.StudentExamView groupExam = new ExamReleaseService.StudentExamView(41L, "SAT",
            "Class Exam", null, "2026-10-24T09:00:00Z", "2026-10-24T12:00:00Z",
            "Practice Paper", 7200, 1, 0, null, null, "GROUP");
        ExamReleaseService.StudentExamView oneOnOneExam = new ExamReleaseService.StudentExamView(42L, "SAT",
            "One-on-One Exam", null, "2026-10-25T09:00:00Z", "2026-10-25T12:00:00Z",
            "Practice Paper", 7200, 1, 0, null, null, "ONE_ON_ONE");
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq("student"))).thenReturn(42L);
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class)))
            .thenReturn(List.of(groupExam, oneOnOneExam));
        when(registry.module("SAT")).thenReturn(Optional.of(satModule));
        when(satModule.supportsStudentAttempts()).thenReturn(true);

        List<ExamReleaseService.StudentExamView> exams = service.listForStudent("student");

        assertEquals(List.of("GROUP", "ONE_ON_ONE"), exams.stream()
            .map(ExamReleaseService.StudentExamView::assignmentKind).toList());
    }

    /** 分组列缺失（例如未应用的旧视图）时不应整块失败，只是无法区分派发方式。 */
    @Test
    void studentExamListKeepsRowsEvenWhenAssignmentKindIsNull() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamTypeModule satModule = mock(ExamTypeModule.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        ExamReleaseService.StudentExamView unknownKind = new ExamReleaseService.StudentExamView(41L, "SAT",
            "Legacy Exam", null, "2026-10-24T09:00:00Z", "2026-10-24T12:00:00Z",
            "Practice Paper", 7200, 1, 0, null, null, null);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq("student"))).thenReturn(42L);
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class)))
            .thenReturn(List.of(unknownKind));
        when(registry.module("SAT")).thenReturn(Optional.of(satModule));
        when(satModule.supportsStudentAttempts()).thenReturn(true);

        List<ExamReleaseService.StudentExamView> exams = service.listForStudent("student");

        assertEquals(1, exams.size(), "a null assignmentKind must not drop the exam from the list");
        assertNull(exams.get(0).assignmentKind());
    }

    /** 不支持学生作答的类型模块被过滤掉，分组不应影响这条既有规则。 */
    @Test
    void studentExamListStillDropsTypesWithoutStudentAttempts() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamTypeModule satModule = mock(ExamTypeModule.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        ExamReleaseService.StudentExamView groupExam = new ExamReleaseService.StudentExamView(41L, "SAT",
            "Class Exam", null, "2026-10-24T09:00:00Z", "2026-10-24T12:00:00Z",
            "Practice Paper", 7200, 1, 0, null, null, "GROUP");
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq("student"))).thenReturn(42L);
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class)))
            .thenReturn(List.of(groupExam));
        when(registry.module("SAT")).thenReturn(Optional.of(satModule));
        when(satModule.supportsStudentAttempts()).thenReturn(false);

        assertEquals(List.of(), service.listForStudent("student"),
            "types that do not support student attempts stay filtered out");
    }

    /** 非学生账号仍应被拒绝，不能因为新增字段而放宽入口校验。 */
    @Test
    void studentExamListRejectsNonStudentAccounts() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq("admin")))
            .thenReturn(null);

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.listForStudent("admin"));
        assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
    }

    @Test
    void closeEndsPublishedExamAndKeepsItsTargetsReadable() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        ExamReleaseService.ExamSummary summary = new ExamReleaseService.ExamSummary(41L, "SAT", 12L,
            "Practice Paper", "Saturday Test", null, "CLOSED", "SELECTED", "2026-10-24T09:00:00Z",
            "2026-10-24T12:00:00Z", 7200, 1, false, false, true,
            "2026-10-20T09:00:00Z", "2026-10-24T10:00:00Z",
            "2026-10-20T09:00:00Z", "No students selected");

        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(false);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq(41L))).thenReturn("PUBLISHED");
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            return sql.contains("FROM exams e JOIN papers p") ? List.of(summary) : List.of();
        });

        ExamReleaseService.ExamDetail result = service.close(41L);

        assertEquals("CLOSED", result.summary().status());
        verify(jdbc).update("UPDATE exams SET status = 'CLOSED', closes_at = CURRENT_TIMESTAMP(6) WHERE id = ?", 41L);
    }

    @Test
    void closeRejectsDraftAndDoesNotChangeItsState() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(false);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq(41L))).thenReturn("DRAFT");

        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.close(41L));

        assertEquals(409, error.getStatusCode().value());
        verify(jdbc, never()).update(any(String.class), eq(41L));
    }

    @Test
    void unpublishPreservesExistingAttemptsAndKeepsTheirActiveParticipants() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(false);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq(41L))).thenReturn("PUBLISHED");
        ExamReleaseService.ExamSummary summary = new ExamReleaseService.ExamSummary(41L, "SHSAT", 12L,
            "Practice Paper", "Saturday Test", null, "DRAFT", "SELECTED", "2026-10-24T09:00:00Z",
            "2026-10-24T12:00:00Z", 7200, 1, true, true, true,
            "2026-10-20T09:00:00Z", "2026-10-24T10:00:00Z", null, "No students selected");
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation ->
            invocation.<String>getArgument(0).contains("FROM exams e JOIN papers p") ? List.of(summary) : List.of());

        ExamReleaseService.ExamDetail result = service.unpublish(41L);

        assertEquals("DRAFT", result.summary().status());
        assertTrue(result.summary().hasStudentAttempts());
        verify(jdbc).update(argThat(sql -> sql.contains("DELETE FROM exam_participants ep")
            && sql.contains("NOT EXISTS") && !sql.contains("a.is_practice")), eq(41L));
        verify(jdbc).update("UPDATE exams SET status = 'DRAFT', published_at = NULL WHERE id = ?", 41L);
    }

    @Test
    void hideReleaseKeepsStudentRecords() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(false);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq(41L))).thenReturn(41L);

        service.hideFromReleaseList(41L);

        verify(jdbc).update("UPDATE exams SET release_hidden_at = COALESCE(release_hidden_at, CURRENT_TIMESTAMP(6)) WHERE id = ?", 41L);
        verify(jdbc, never()).update(argThat(sql -> sql.startsWith("DELETE")), any(Object[].class));
    }

    @Test
    void deleteRejectsPracticeTemplateExamWithoutMutation() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(true);

        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.hideFromReleaseList(41L));

        assertEquals(404, error.getStatusCode().value());
        verify(jdbc, never()).update(any(String.class), eq(41L));
    }

    @Test
    void classDeleteRejectsAmbiguousAttemptsWithoutMutation() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(false);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq(41L))).thenReturn(41L);
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(7L), eq(41L), eq(7L), eq(41L), eq(7L), eq(41L), eq(7L))).thenReturn(true);
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(7L), eq(7L), eq(7L), eq(7L), eq(7L), eq(7L))).thenReturn(true);

        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.deleteClassExam(7L, 41L));

        assertEquals(409, error.getStatusCode().value());
        verify(jdbc, never()).update(any(String.class), any(Object[].class));
    }

    @Test
    void selectedClassMustBelongToTheExamsWorkspace() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("SELECT status FROM exams")), any(ResultSetExtractor.class), eq(41L)))
            .thenReturn("DRAFT");
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("SELECT target_scope FROM exams")), any(ResultSetExtractor.class), eq(41L)))
            .thenReturn("SELECTED");
        when(jdbc.queryForObject(argThat(sql -> sql.contains("class_exam_workspaces")), eq(Boolean.class), eq(41L), eq(7L)))
            .thenReturn(false);

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.saveTargets(41L, new ExamReleaseService.TargetRequest(List.of(7L), List.of())));

        assertEquals(400, error.getStatusCode().value());
        verify(jdbc, never()).update(any(String.class), any(Object[].class));
    }

    @Test
    void selectedStudentRequiresExplicitClassSource() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("SELECT status FROM exams")), any(ResultSetExtractor.class), eq(41L))).thenReturn("DRAFT");
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("SELECT target_scope FROM exams")), any(ResultSetExtractor.class), eq(41L))).thenReturn("SELECTED");

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.saveTargets(41L, new ExamReleaseService.TargetRequest(List.of(), List.of(11L))));
        assertEquals(400, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void selectedStudentMustBelongToTheSelectedClassInTheExamWorkspace() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("SELECT status FROM exams")), any(ResultSetExtractor.class), eq(41L))).thenReturn("DRAFT");
        when(jdbc.query(argThat(sql -> sql != null && sql.contains("SELECT target_scope FROM exams")), any(ResultSetExtractor.class), eq(41L))).thenReturn("SELECTED");
        when(jdbc.queryForObject(argThat(sql -> sql.contains("FROM users WHERE id")), eq(Boolean.class), eq(11L))).thenReturn(true);
        when(jdbc.queryForObject(argThat(sql -> sql.contains("FROM class_memberships cm")), eq(Boolean.class), eq(41L), eq(7L), eq(11L))).thenReturn(false);

        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.saveTargets(41L,
            new ExamReleaseService.TargetRequest(List.of(), List.of(11L), List.of(new ExamReleaseService.StudentClassTarget(7L, 11L)))));
        assertEquals(400, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void targetChangesLockExamAndRejectAfterPublishing() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq(41L))).thenReturn("PUBLISHED");

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.saveTargets(41L, new ExamReleaseService.TargetRequest(List.of(7L), List.of())));

        assertEquals(409, error.getStatusCode().value());
        verify(jdbc).query(argThat(sql -> sql.contains("SELECT status FROM exams WHERE id = ? FOR UPDATE")),
            any(ResultSetExtractor.class), eq(41L));
        verify(jdbc, never()).update(any(String.class), any(Object[].class));
    }
}
