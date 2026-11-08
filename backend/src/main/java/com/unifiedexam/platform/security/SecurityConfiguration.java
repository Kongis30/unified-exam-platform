package com.unifiedexam.platform.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.identity.PlatformUserDetailsService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

import java.util.Map;
import java.time.Clock;
import java.time.Duration;

@Configuration
public class SecurityConfiguration {

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    DaoAuthenticationProvider authenticationProvider(UserDetailsService userDetailsService,
                                                       PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
        provider.setUserDetailsService(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return provider;
    }

    @Bean
    AuthenticationManager authenticationManager(DaoAuthenticationProvider authenticationProvider) {
        return new ProviderManager(authenticationProvider);
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http,
                                             SecurityContextRepository contextRepository,
                                             DaoAuthenticationProvider authenticationProvider,
                                             PlatformUserDetailsService userDetailsService,
                                             @Value("${platform.session.cookie-secure:false}") boolean secureCookie,
                                             @Value("${platform.session.max-age:24h}") Duration sessionMaxAge,
                                             ObjectMapper objectMapper) throws Exception {
        CookieCsrfTokenRepository csrfRepository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfRepository.setCookieCustomizer(cookie -> cookie.secure(secureCookie).path("/"));
        CsrfTokenRequestAttributeHandler csrfHandler = new CsrfTokenRequestAttributeHandler();

        http
            .csrf(csrf -> csrf.csrfTokenRepository(csrfRepository).csrfTokenRequestHandler(csrfHandler))
            .securityContext(context -> context.securityContextRepository(contextRepository))
            .sessionManagement(session -> session.sessionFixation(fixation -> fixation.migrateSession()))
            .addFilterAfter(new AccountStatusFilter(userDetailsService), SecurityContextHolderFilter.class)
            .addFilterAfter(new AuthenticatedSessionExpiryFilter(sessionMaxAge, Clock.systemUTC()), AccountStatusFilter.class)
            .authenticationProvider(authenticationProvider)
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/health", "/api/auth/csrf", "/api/auth/login", "/api/exam-types",
                    "/uploads/paper-materials/**", "/uploads/images/**", "/sat-api/uploads/materials/**").permitAll()
                .requestMatchers("/api/auth/**").authenticated()
                .requestMatchers("/api/admin/users/**").hasRole("ADMIN")
                .requestMatchers("/api/admin/sat/papers/**", "/api/admin/papers/*/sat-settings",
                    "/api/admin/papers/*/sat-settings/**").hasRole("ADMIN")
                .requestMatchers("/api/admin/sat/reports/exams/*/monitor/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/admin/sat/students/*/attempts/*").hasRole("ADMIN")
                .requestMatchers(HttpMethod.DELETE, "/api/admin/exams/*").hasRole("ADMIN")
                .requestMatchers("/api/admin/classes/**").hasAnyRole("ADMIN", "TEACHER")
                .requestMatchers("/api/admin/**").hasAnyRole("ADMIN", "TEACHER")
                .requestMatchers("/api/student/exams/*/attempts", "/api/student/attempts/**",
                    "/api/student/exams/*/sat-attempt", "/api/student/sat-attempts/**")
                    .hasAnyRole("ADMIN", "TEACHER", "STUDENT")
                .requestMatchers("/api/student/**").hasRole("STUDENT")
                .anyRequest().denyAll())
            .formLogin(AbstractHttpConfigurer::disable)
            .httpBasic(AbstractHttpConfigurer::disable)
            .logout(AbstractHttpConfigurer::disable)
            .exceptionHandling(exceptions -> exceptions
                .authenticationEntryPoint((request, response, exception) -> writeError(response, objectMapper, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Please sign in to continue."))
                .accessDeniedHandler((request, response, exception) -> writeError(response, objectMapper, HttpStatus.FORBIDDEN, "FORBIDDEN", "You do not have permission to perform this action.")));

        return http.build();
    }

    private static void writeError(HttpServletResponse response, ObjectMapper mapper,
                                   HttpStatus status, String code, String message) throws java.io.IOException {
        response.setStatus(status.value());
        response.setContentType("application/json;charset=UTF-8");
        mapper.writeValue(response.getWriter(), Map.of("code", code, "message", message));
    }
}
