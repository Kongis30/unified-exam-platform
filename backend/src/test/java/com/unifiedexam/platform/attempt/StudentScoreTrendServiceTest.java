package com.unifiedexam.platform.attempt;

import com.unifiedexam.platform.examtype.ScoreTrendProvider;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 平台层只负责按类型编码分发与学员校验；口径归各类型 provider。
 * 这些用例确保平台不会自作主张地解析数据或允许越权。
 */
class StudentScoreTrendServiceTest {

    private static StudentScoreTrend emptyTrend(String code) {
        return StudentScoreTrend.empty(code, StudentScoreTrend.Unit.SCALED, StudentScoreTrend.Unit.POINTS);
    }

    @Test
    void dispatchesToProviderRegisteredForExamType() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenReturn(7L);

        ScoreTrendProvider shsat = mock(ScoreTrendProvider.class);
        when(shsat.examTypeCode()).thenReturn("SHSAT");
        when(shsat.load(7L)).thenReturn(emptyTrend("SHSAT"));

        ScoreTrendProvider sat = mock(ScoreTrendProvider.class);
        when(sat.examTypeCode()).thenReturn("SAT");

        StudentScoreTrendService service = new StudentScoreTrendService(jdbc, List.of(shsat, sat));
        StudentScoreTrend result = service.load("SHSAT", "student@jin");

        assertEquals("SHSAT", result.examTypeCode());
        verify(shsat).load(7L);
        // 只应调用被请求的类型，不能顺带查询其他类型。
        verify(sat, never()).load(any(Long.class));
    }

    @Test
    void rejectsUnknownExamTypeBeforeTouchingTheDatabase() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ScoreTrendProvider shsat = mock(ScoreTrendProvider.class);
        when(shsat.examTypeCode()).thenReturn("SHSAT");

        StudentScoreTrendService service = new StudentScoreTrendService(jdbc, List.of(shsat));

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.load("TOEFL", "student@jin"));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        verify(jdbc, never()).query(anyString(), any(ResultSetExtractor.class), any(Object[].class));
    }

    @Test
    void rejectsBlankExamType() {
        StudentScoreTrendService service = new StudentScoreTrendService(mock(JdbcTemplate.class), List.of());

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.load("  ", "student@jin"));
        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
    }

    @Test
    void rejectsStaffAccountsBecauseTrendIsAStudentFeature() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenReturn(null);

        ScoreTrendProvider shsat = mock(ScoreTrendProvider.class);
        when(shsat.examTypeCode()).thenReturn("SHSAT");

        StudentScoreTrendService service = new StudentScoreTrendService(jdbc, List.of(shsat));

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.load("SHSAT", "teacher@jin"));
        assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
        verify(shsat, never()).load(any(Long.class));
    }

    @Test
    void duplicateProviderRegistrationFailsFast() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ScoreTrendProvider first = mock(ScoreTrendProvider.class);
        when(first.examTypeCode()).thenReturn("SAT");
        ScoreTrendProvider second = mock(ScoreTrendProvider.class);
        when(second.examTypeCode()).thenReturn("SAT");

        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> new StudentScoreTrendService(jdbc, List.of(first, second)));
        assertEquals("Duplicate score trend provider: SAT", error.getMessage());
    }
}
