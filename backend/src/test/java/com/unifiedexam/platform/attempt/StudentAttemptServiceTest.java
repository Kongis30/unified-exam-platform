package com.unifiedexam.platform.attempt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class StudentAttemptServiceTest {

    @Test
    void expiresTimedOutAttemptBeforeItCanBeResumed() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        StudentAttemptService service = new StudentAttemptService(jdbc, mock(ExamTypeRegistry.class), new ObjectMapper());
        when(jdbc.update(any(String.class), any(Object[].class))).thenReturn(1);

        int updated = service.expireTimedOutAttempts(41, 17, false);

        assertEquals(1, updated);
        verify(jdbc).update(eq("""
            UPDATE attempts SET status = 'EXPIRED'
            WHERE exam_id = ? AND student_user_id = ? AND is_practice = ?
              AND status = 'IN_PROGRESS' AND expires_at <= CURRENT_TIMESTAMP(6)
            """), eq(41L), eq(17L), eq(false));
    }

    @Test
    void countsOnlyAttemptsThatHaveConsumedAnAttempt() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        StudentAttemptService service = new StudentAttemptService(jdbc, mock(ExamTypeRegistry.class), new ObjectMapper());
        when(jdbc.queryForObject(any(String.class), eq(Integer.class), eq(41L), eq(17L))).thenReturn(1);

        int used = service.countUsedFormalAttempts(41, 17);

        assertEquals(1, used);
        verify(jdbc).queryForObject(org.mockito.ArgumentMatchers.argThat(sql ->
            sql.contains("is_practice = FALSE") && sql.contains("status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')")),
            eq(Integer.class), eq(41L), eq(17L));
    }
}
