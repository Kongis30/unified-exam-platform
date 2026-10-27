package com.unifiedexam.platform.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;

/** 限制登录后绝对有效时长，保证持续活动也不会延长超过 SHSAT 的凭证有效期。 */
public class AuthenticatedSessionExpiryFilter extends OncePerRequestFilter {

    public static final String AUTHENTICATED_AT_ATTRIBUTE = AuthenticatedSessionExpiryFilter.class.getName() + ".authenticatedAt";

    private final Duration maxAge;
    private final Clock clock;
    private final SecurityContextLogoutHandler logoutHandler = new SecurityContextLogoutHandler();

    public AuthenticatedSessionExpiryFilter(Duration maxAge, Clock clock) {
        this.maxAge = maxAge;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (isAuthenticated(authentication)) {
            HttpSession session = request.getSession(false);
            if (session != null && isExpired(session)) {
                logoutHandler.logout(request, response, authentication);
            }
        }
        chain.doFilter(request, response);
    }

    private boolean isExpired(HttpSession session) {
        Object authenticatedAt = session.getAttribute(AUTHENTICATED_AT_ATTRIBUTE);
        if (!(authenticatedAt instanceof Long startedAt)) {
            session.setAttribute(AUTHENTICATED_AT_ATTRIBUTE, clock.millis());
            return false;
        }
        return clock.millis() - startedAt >= maxAge.toMillis();
    }

    private static boolean isAuthenticated(Authentication authentication) {
        return authentication != null
            && authentication.isAuthenticated()
            && !(authentication instanceof AnonymousAuthenticationToken);
    }
}
