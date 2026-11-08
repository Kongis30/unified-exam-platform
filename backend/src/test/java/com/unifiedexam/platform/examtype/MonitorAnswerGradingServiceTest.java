package com.unifiedexam.platform.examtype;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class MonitorAnswerGradingServiceTest {

    @Test
    @SuppressWarnings("unchecked")
    void pendingAnswerLookupFiltersByPaperWorkspaceForEveryExamModule() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        ExamTypeModule module = mock(ExamTypeModule.class);
        when(registry.module(anyString())).thenReturn(Optional.of(module));
        AtomicReference<String> capturedSql = new AtomicReference<>();
        AtomicReference<Object[]> capturedArguments = new AtomicReference<>();
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            capturedSql.set(invocation.getArgument(0));
            capturedArguments.set(java.util.Arrays.copyOfRange(invocation.getArguments(), 2,
                invocation.getArguments().length));
            return List.of();
        });

        MonitorAnswerGradingService service = new MonitorAnswerGradingService(jdbc, new ObjectMapper(), registry);
        for (String examType : List.of("SHSAT", "SAT", "PSAT")) {
            service.gradePendingAnswers(42L, examType);

            String sql = capturedSql.get();
            assertTrue(sql.contains("JOIN papers p ON p.id = e.paper_id"));
            assertTrue(sql.contains("p.exam_type_code = ?"));
            assertFalse(sql.contains("e.exam_type_code"));
            assertArrayEquals(new Object[] {42L, examType}, capturedArguments.get());
        }
    }
}
