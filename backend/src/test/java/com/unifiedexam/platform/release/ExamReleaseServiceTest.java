package com.unifiedexam.platform.release;

import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ExamReleaseServiceTest {

    @Test
    void examListExposesWhetherFormalAttemptsPreventUnpublishing() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));

        service.list("SAT");

        verify(jdbc).query(argThat(sql -> sql.contains("AS has_student_attempts")
                && sql.contains("a.is_practice = FALSE")), any(RowMapper.class), eq("SAT"));
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
            "Practice Paper", 7200, 1, 0, 55L, 55L);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq("student"))).thenReturn(42L);
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(exam));
        when(registry.module("SAT")).thenReturn(Optional.of(satModule));
        when(satModule.supportsStudentAttempts()).thenReturn(true);

        List<ExamReleaseService.StudentExamView> exams = service.listForStudent("student");

        assertEquals(1, exams.size());
        assertEquals(55L, exams.get(0).activeAttemptId());

        verify(jdbc).query(argThat(sql -> sql.contains("e.status IN ('PUBLISHED', 'CLOSED')")
                && sql.contains("e.status = 'PUBLISHED' AND e.closes_at > CURRENT_TIMESTAMP(6)")
                && sql.contains("OR EXISTS (")
                && sql.contains("a.student_user_id = ep.student_user_id")
                && sql.contains("a.is_practice = FALSE")
                && sql.contains("a.status = 'IN_PROGRESS' AND a.expires_at <= CURRENT_TIMESTAMP(6)")
                && sql.contains("a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP(6)")
                && sql.contains("a.status IN ('SUBMITTED', 'COMPLETED') AND a.is_practice = FALSE) AS latest_attempt_id")),
            any(RowMapper.class), any(Object[].class));
    }

    @Test
    void closeEndsPublishedExamAndKeepsItsTargetsReadable() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        ExamReleaseService.ExamSummary summary = new ExamReleaseService.ExamSummary(41L, "SAT", 12L,
            "Practice Paper", "Saturday Test", null, "CLOSED", "SELECTED", "2026-10-24T09:00:00Z",
            "2026-10-24T12:00:00Z", 7200, 1, false, "2026-10-20T09:00:00Z", "2026-10-24T10:00:00Z",
            "2026-10-20T09:00:00Z");

        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(false);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq(41L))).thenReturn("PUBLISHED");
        when(jdbc.query(any(String.class), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            return sql.contains("FROM exams e JOIN papers p") ? List.of(summary) : List.of();
        });

        ExamReleaseService.ExamDetail result = service.close(41L);

        assertEquals("CLOSED", result.summary().status());
        verify(jdbc).update("UPDATE exams SET status = 'CLOSED' WHERE id = ?", 41L);
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
    void unpublishRejectsExamAfterStudentsHaveStartedAttempts() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(false);
        when(jdbc.query(any(String.class), any(ResultSetExtractor.class), eq(41L))).thenReturn("PUBLISHED");
        when(jdbc.queryForObject(any(String.class), eq(Integer.class), eq(41L))).thenReturn(1);

        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.unpublish(41L));

        assertEquals(409, error.getStatusCode().value());
        verify(jdbc).queryForObject(argThat(sql -> sql.contains("is_practice = FALSE")), eq(Integer.class), eq(41L));
        verify(jdbc, never()).update(any(String.class), eq(41L));
    }

    @Test
    void deleteClearsDependentRowsBeforeDeletingExam() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(false);
        when(jdbc.query(any(String.class), any(RowMapper.class), eq(41L))).thenReturn(List.of(41L));

        service.delete(41L);

        var ordered = inOrder(jdbc);
        ordered.verify(jdbc).update("DELETE FROM shsat_wrong_answer_tasks WHERE exam_id = ?", 41L);
        ordered.verify(jdbc).update("DELETE FROM attempts WHERE exam_id = ?", 41L);
        ordered.verify(jdbc).update("DELETE FROM exam_participants WHERE exam_id = ?", 41L);
        ordered.verify(jdbc).update("DELETE FROM exams WHERE id = ?", 41L);
    }

    @Test
    void deleteRejectsPracticeTemplateExamWithoutMutation() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamReleaseService service = new ExamReleaseService(jdbc, mock(ExamTypeRegistry.class));
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class), eq(41L), eq(41L))).thenReturn(true);

        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.delete(41L));

        assertEquals(404, error.getStatusCode().value());
        verify(jdbc, never()).update(any(String.class), eq(41L));
    }
}
