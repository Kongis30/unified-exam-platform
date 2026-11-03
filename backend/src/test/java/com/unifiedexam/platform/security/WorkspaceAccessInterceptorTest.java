package com.unifiedexam.platform.security;

import com.unifiedexam.platform.identity.WorkspaceAccessService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerMapping;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.never;

class WorkspaceAccessInterceptorTest {
    private final WorkspaceAccessService access = mock(WorkspaceAccessService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final WorkspaceAccessInterceptor interceptor = new WorkspaceAccessInterceptor(access, jdbc);

    @AfterEach
    void clearContext() { SecurityContextHolder.clearContext(); }

    @Test
    void resolvesExamOwnershipBeforeCheckingTheStudentWorkspace() {
        var user = new UsernamePasswordAuthenticationToken("student", "", List.of(new SimpleGrantedAuthority("ROLE_STUDENT")));
        SecurityContextHolder.getContext().setAuthentication(user);
        var request = new MockHttpServletRequest("POST", "/api/student/exams/17/sat-attempt");
        request.setAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE, Map.of("examId", "17"));
        when(jdbc.queryForList("SELECT p.exam_type_code FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ?", String.class, "17"))
            .thenReturn(List.of("PSAT"));

        interceptor.preHandle(request, new MockHttpServletResponse(), new Object());

        verify(access).requireExamType(user, "PSAT");
    }

    @Test
    void checksEveryRequestedClassWorkspaceForTeachers() {
        var user = new UsernamePasswordAuthenticationToken("teacher", "", List.of(new SimpleGrantedAuthority("ROLE_TEACHER")));
        SecurityContextHolder.getContext().setAuthentication(user);
        var request = new MockHttpServletRequest("GET", "/api/admin/classes");
        request.setParameter("examTypeCodes", "SAT", "PSAT");
        interceptor.preHandle(request, new MockHttpServletResponse(), new Object());
        verify(access).requireExamType(user, "SAT");
        verify(access).requireExamType(user, "PSAT");
    }

    @Test
    void administratorsBypassIndividualWorkspaceChecks() {
        var user = new UsernamePasswordAuthenticationToken("admin", "", List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
        SecurityContextHolder.getContext().setAuthentication(user);
        var request = new MockHttpServletRequest("GET", "/api/admin/exam-types/PSAT/papers");
        request.setAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE, Map.of("examTypeCode", "PSAT"));
        interceptor.preHandle(request, new MockHttpServletResponse(), new Object());
        verify(access, never()).requireExamType(user, "PSAT");
    }
}
