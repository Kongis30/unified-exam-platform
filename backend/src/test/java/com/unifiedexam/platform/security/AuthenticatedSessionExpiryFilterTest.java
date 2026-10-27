package com.unifiedexam.platform.security;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static com.unifiedexam.platform.security.AuthenticatedSessionExpiryFilter.AUTHENTICATED_AT_ATTRIBUTE;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthenticatedSessionExpiryFilterTest {

    private static final Instant NOW = Instant.parse("2026-10-27T04:00:00Z");
    private final AuthenticatedSessionExpiryFilter filter = new AuthenticatedSessionExpiryFilter(
        Duration.ofHours(24), Clock.fixed(NOW, ZoneOffset.UTC));

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void expiresAtAbsoluteLimitEvenWhenSessionIsStillActive() throws Exception {
        MockHttpServletRequest request = authenticatedRequest();
        MockHttpSession session = (MockHttpSession) request.getSession(false);
        session.setAttribute(AUTHENTICATED_AT_ATTRIBUTE, NOW.minus(Duration.ofHours(24)).toEpochMilli());

        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        assertTrue(session.isInvalid());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void keepsSessionBeforeAbsoluteLimit() throws Exception {
        MockHttpServletRequest request = authenticatedRequest();
        MockHttpSession session = (MockHttpSession) request.getSession(false);
        session.setAttribute(AUTHENTICATED_AT_ATTRIBUTE, NOW.minus(Duration.ofHours(23)).toEpochMilli());

        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        assertFalse(session.isInvalid());
        assertEquals("student", SecurityContextHolder.getContext().getAuthentication().getName());
    }

    @Test
    void initializesExpiryTimestampForExistingSessionWithoutMetadata() throws Exception {
        MockHttpServletRequest request = authenticatedRequest();
        MockHttpSession session = (MockHttpSession) request.getSession(false);

        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        assertEquals(NOW.toEpochMilli(), session.getAttribute(AUTHENTICATED_AT_ATTRIBUTE));
        assertFalse(session.isInvalid());
    }

    private MockHttpServletRequest authenticatedRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSession(new MockHttpSession());
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            "student", "unused", List.of(new SimpleGrantedAuthority("ROLE_STUDENT"))));
        return request;
    }
}
