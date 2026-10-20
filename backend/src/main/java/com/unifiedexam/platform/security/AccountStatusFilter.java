package com.unifiedexam.platform.security;

import com.unifiedexam.platform.identity.PlatformUserDetailsService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;
import java.util.stream.Collectors;

/** 每个已登录请求重新读取账号状态，使停用和改权即时生效，而不等旧会话过期。 */
public class AccountStatusFilter extends OncePerRequestFilter {

    private final PlatformUserDetailsService userDetailsService;
    private final SecurityContextLogoutHandler logoutHandler = new SecurityContextLogoutHandler();

    public AccountStatusFilter(PlatformUserDetailsService userDetailsService) {
        this.userDetailsService = userDetailsService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()
            && !(authentication instanceof AnonymousAuthenticationToken)) {
            try {
                UserDetails account = userDetailsService.loadUserByUsername(authentication.getName());
                if (!account.isEnabled() || !sameAuthorities(account, authentication)) {
                    logoutHandler.logout(request, response, authentication);
                }
            } catch (UsernameNotFoundException exception) {
                logoutHandler.logout(request, response, authentication);
            }
        }
        chain.doFilter(request, response);
    }

    private static boolean sameAuthorities(UserDetails account, Authentication authentication) {
        Set<String> currentAuthorities = account.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.toSet());
        Set<String> sessionAuthorities = authentication.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.toSet());
        return currentAuthorities.equals(sessionAuthorities);
    }
}
