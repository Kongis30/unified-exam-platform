package com.unifiedexam.platform.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkspaceAccessServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final WorkspaceAccessService service = new WorkspaceAccessService(jdbc, new ObjectMapper());

    @Test
    void rejectsUnavailableWorkspaceBeforeChangingAuthorization() {
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<ResultSetExtractor<String>>any(), eq(42L)))
            .thenReturn("STUDENT");
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("SAT", "SHSAT"));

        assertThrows(ResponseStatusException.class, () -> service.replaceAccess(42, List.of("PSAT"), "admin"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void rejectsExplicitWorkspaceAssignmentToAdministrators() {
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<ResultSetExtractor<String>>any(), eq(1L)))
            .thenReturn("ADMIN");

        assertThrows(ResponseStatusException.class, () -> service.replaceAccess(1, List.of("SAT"), "admin"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void rejectsRemovingTheLastWorkspace() {
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<ResultSetExtractor<String>>any(), eq(42L)))
            .thenReturn("STUDENT");
        assertThrows(ResponseStatusException.class, () -> service.replaceAccess(42, List.of(), "admin"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test
    void replacesAndDeduplicatesWorkspacesAndRecordsTheChange() {
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<ResultSetExtractor<String>>any(), eq(42L)))
            .thenReturn("TEACHER");
        when(jdbc.queryForList(anyString(), eq(String.class))).thenReturn(List.of("SAT", "PSAT", "SHSAT"));
        when(jdbc.queryForList(anyString(), eq(String.class), eq(42L))).thenReturn(List.of("SAT"));

        service.replaceAccess(42, List.of("PSAT", "SHSAT", "PSAT"), "admin");

        verify(jdbc).update("DELETE FROM user_workspace_access WHERE user_id = ?", 42L);
        verify(jdbc, times(2)).update(eq("INSERT INTO user_workspace_access (user_id, workspace_code) VALUES (?, ?)"), eq(42L), anyString());
        verify(jdbc).update(org.mockito.ArgumentMatchers.contains("INSERT INTO audit_events"),
            eq("42"), org.mockito.ArgumentMatchers.contains("PSAT"), eq("admin"));
    }

    @Test
    void deniesAnUnassignedExamType() {
        var student = new UsernamePasswordAuthenticationToken("student", "", List.of(new SimpleGrantedAuthority("ROLE_STUDENT")));
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq("student"), eq("PSAT"))).thenReturn(0);
        assertThrows(ResponseStatusException.class, () -> service.requireExamType(student, "PSAT"));
    }

    @Test
    void administratorsDoNotNeedIndividualGrants() {
        var admin = new UsernamePasswordAuthenticationToken("admin", "", List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
        service.requireExamType(admin, "PSAT");
        verify(jdbc, never()).queryForObject(anyString(), eq(Integer.class), any(Object[].class));
    }
}
