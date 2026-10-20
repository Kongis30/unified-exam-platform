package com.unifiedexam.platform.identity;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/admin/users")
public class UserAdminController {

    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;

    public UserAdminController(JdbcTemplate jdbcTemplate, PasswordEncoder passwordEncoder) {
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
    }

    @GetMapping
    public List<UserView> listUsers() {
        return jdbcTemplate.query("""
            SELECT id, username, real_name, role_code, email, phone, status, created_at
            FROM users ORDER BY id DESC
            """, (rs, rowNum) -> new UserView(rs.getLong("id"), rs.getString("username"),
                rs.getString("real_name"), rs.getString("role_code"), rs.getString("email"),
                rs.getString("phone"), rs.getString("status"), rs.getTimestamp("created_at").toInstant().toString()));
    }

    @PostMapping
    @Transactional
    public UserView createUser(@Valid @RequestBody CreateUserRequest request) {
        try {
            jdbcTemplate.update("""
                INSERT INTO users (username, password_hash, real_name, role_code, email, phone)
                VALUES (?, ?, ?, ?, ?, ?)
                """, request.username(), passwordEncoder.encode(request.password()), request.realName(),
                request.roleCode(), request.email(), request.phone());
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That username is already in use.");
        }
        return findUser(request.username());
    }

    @PatchMapping("/{userId}/status")
    public void setUserStatus(@PathVariable long userId, @Valid @RequestBody StatusRequest request) {
        Integer exists = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM users WHERE id = ?", Integer.class, userId);
        if (exists == null || exists == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.");
        }
        jdbcTemplate.update("UPDATE users SET status = ? WHERE id = ?", request.status(), userId);
    }

    @PutMapping("/{userId}/password")
    public void resetPassword(@PathVariable long userId, @Valid @RequestBody PasswordRequest request) {
        int updated = jdbcTemplate.update("UPDATE users SET password_hash = ? WHERE id = ?",
            passwordEncoder.encode(request.password()), userId);
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.");
        }
    }

    private UserView findUser(String username) {
        return jdbcTemplate.queryForObject("""
            SELECT id, username, real_name, role_code, email, phone, status, created_at
            FROM users WHERE username = ?
            """, (rs, rowNum) -> new UserView(rs.getLong("id"), rs.getString("username"),
                rs.getString("real_name"), rs.getString("role_code"), rs.getString("email"),
                rs.getString("phone"), rs.getString("status"), rs.getTimestamp("created_at").toInstant().toString()), username);
    }

    public record CreateUserRequest(@NotBlank @Size(max = 80) String username,
                                    @NotBlank @Size(min = 6, max = 100) String password,
                                    @NotBlank @Size(max = 80) String realName,
                                    @NotBlank @Pattern(regexp = "ADMIN|TEACHER|STUDENT") String roleCode,
                                    @Email @Size(max = 160) String email,
                                    @Size(max = 30) String phone) { }

    public record StatusRequest(@NotBlank @Pattern(regexp = "ACTIVE|DISABLED") String status) { }
    public record PasswordRequest(@NotBlank @Size(min = 6, max = 100) String password) { }
    public record UserView(long id, String username, String realName, String roleCode, String email,
                           String phone, String status, String createdAt) { }
}
