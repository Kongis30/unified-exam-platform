package com.unifiedexam.platform.identity;

import com.unifiedexam.platform.security.AuthenticatedSessionExpiryFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository contextRepository;
    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;

    public AuthController(AuthenticationManager authenticationManager,
                          SecurityContextRepository contextRepository,
                          JdbcTemplate jdbcTemplate,
                          PasswordEncoder passwordEncoder) {
        this.authenticationManager = authenticationManager;
        this.contextRepository = contextRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken csrfToken) {
        return Map.of("token", csrfToken.getToken());
    }

    @PostMapping("/login")
    public UserView login(@Valid @RequestBody LoginRequest request,
                          HttpServletRequest servletRequest,
                          HttpServletResponse servletResponse) {
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                UsernamePasswordAuthenticationToken.unauthenticated(request.username(), request.password()));
        } catch (AuthenticationException exception) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid username or password.");
        }
        jdbcTemplate.update("UPDATE users SET last_login_at = CURRENT_TIMESTAMP(6) WHERE username = ?", request.username());
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        contextRepository.saveContext(context, servletRequest, servletResponse);
        servletRequest.getSession(true).setAttribute(
            AuthenticatedSessionExpiryFilter.AUTHENTICATED_AT_ATTRIBUTE, System.currentTimeMillis());
        return findCurrentUser(request.username());
    }

    @GetMapping("/me")
    public UserView me(Authentication authentication) {
        return findCurrentUser(authentication.getName());
    }

    @PutMapping("/profile")
    public UserView updateProfile(@Valid @RequestBody ProfileRequest request, Authentication authentication) {
        jdbcTemplate.update("""
            UPDATE users SET real_name = ?, email = ?, phone = ? WHERE username = ?
            """, request.realName().trim(), normalizeOptional(request.email()), normalizeOptional(request.phone()),
            authentication.getName());
        return findCurrentUser(authentication.getName());
    }

    @PutMapping("/password")
    public Map<String, String> changePassword(@Valid @RequestBody PasswordChangeRequest request,
                                              Authentication authentication) {
        String currentHash = jdbcTemplate.query("SELECT password_hash FROM users WHERE username = ?",
            rs -> rs.next() ? rs.getString(1) : null, authentication.getName());
        if (currentHash == null || !passwordEncoder.matches(request.currentPassword(), currentHash)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Current password is incorrect.");
        }
        jdbcTemplate.update("UPDATE users SET password_hash = ? WHERE username = ?",
            passwordEncoder.encode(request.newPassword()), authentication.getName());
        return Map.of("message", "Password updated.");
    }

    @PostMapping("/logout")
    public Map<String, String> logout(HttpServletRequest request, HttpServletResponse response,
                                      Authentication authentication) {
        new SecurityContextLogoutHandler().logout(request, response, authentication);
        return Map.of("message", "You have signed out.");
    }

    private UserView findCurrentUser(String username) {
        List<UserView> users = jdbcTemplate.query("""
            SELECT id, username, real_name, role_code, email, phone, status
            FROM users WHERE username = ?
            """, (rs, rowNum) -> new UserView(rs.getLong("id"), rs.getString("username"),
                rs.getString("real_name"), rs.getString("role_code"), rs.getString("email"),
                rs.getString("phone"), rs.getString("status")), username);
        if (users.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        return users.get(0);
    }

    private String normalizeOptional(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    public record LoginRequest(@NotBlank @Size(max = 80) String username,
                               @NotBlank @Size(max = 100) String password) { }

    public record ProfileRequest(@NotBlank @Size(max = 80) String realName,
                                 @Email @Size(max = 160) String email,
                                 @Size(max = 30) String phone) { }

    public record PasswordChangeRequest(@NotBlank @Size(max = 100) String currentPassword,
                                        @NotBlank @Size(min = 6, max = 100) String newPassword) { }

    public record UserView(long id, String username, String realName, String roleCode,
                           String email, String phone, String status) { }
}
