package com.unifiedexam.platform.identity;

import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.HashMap;

@RestController
@RequestMapping("/api/admin/users")
public class UserAdminController {

    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;
    private final WorkspaceAccessService workspaceAccessService;

    public UserAdminController(JdbcTemplate jdbcTemplate, PasswordEncoder passwordEncoder, WorkspaceAccessService workspaceAccessService) {
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
        this.workspaceAccessService = workspaceAccessService;
    }

    @GetMapping
    public List<UserView> listUsers() {
        Map<Long, List<String>> access = new HashMap<>();
        jdbcTemplate.query("SELECT user_id, workspace_code FROM user_workspace_access ORDER BY workspace_code",
            (org.springframework.jdbc.core.RowCallbackHandler) rs -> access.computeIfAbsent(rs.getLong("user_id"), id -> new ArrayList<>())
                .add(rs.getString("workspace_code")));
        return jdbcTemplate.query("""
            SELECT id, username, real_name, role_code, email, phone, status, created_at
            FROM users ORDER BY id DESC
            """, (rs, rowNum) -> new UserView(rs.getLong("id"), rs.getString("username"),
                rs.getString("real_name"), rs.getString("role_code"), rs.getString("email"),
                rs.getString("phone"), rs.getString("status"), rs.getTimestamp("created_at").toInstant().toString(),
                access.getOrDefault(rs.getLong("id"), List.of())));
    }

    @PostMapping
    @Transactional
    public UserView createUser(@Valid @RequestBody CreateUserRequest request, Authentication authentication) {
        try {
            jdbcTemplate.update("""
                INSERT INTO users (username, password_hash, real_name, role_code, email, phone)
                VALUES (?, ?, ?, ?, ?, ?)
                """, request.username(), passwordEncoder.encode(request.password()), request.realName(),
                request.roleCode(), request.email(), request.phone());
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That username is already in use.");
        }
        UserView created = findUser(request.username());
        if (!"ADMIN".equals(request.roleCode())) {
            if (request.workspaceCodes() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select the account's workspaces.");
            }
            workspaceAccessService.replaceAccess(created.id(), request.workspaceCodes(), authentication.getName());
        }
        return new UserView(created.id(), created.username(), created.realName(), created.roleCode(), created.email(),
            created.phone(), created.status(), created.createdAt(), workspaceAccessService.accessForUser(created.id()));
    }

    @PatchMapping("/{userId}/status")
    @Transactional
    public void setUserStatus(@PathVariable long userId, @Valid @RequestBody StatusRequest request,
                             Authentication authentication) {
        jdbcTemplate.query("SELECT id FROM users WHERE role_code = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE",
            (rs, rowNum) -> rs.getLong("id"));
        UserRole target = jdbcTemplate.query("SELECT username, role_code, status FROM users WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? new UserRole(rs.getString("username"), rs.getString("role_code"), rs.getString("status")) : null,
            userId);
        if (target == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.");
        String actor = authentication == null ? "" : authentication.getName();
        if (target.username().equals(actor) && "DISABLED".equals(request.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "You cannot disable your own account.");
        }
        if ("ADMIN".equals(target.roleCode()) && "ACTIVE".equals(target.status()) && "DISABLED".equals(request.status())) {
            Integer activeAdmins = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM users WHERE role_code = 'ADMIN' AND status = 'ACTIVE'", Integer.class);
            if (activeAdmins != null && activeAdmins <= 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "At least one active administrator account must remain.");
            }
        }
        jdbcTemplate.update("UPDATE users SET status = ? WHERE id = ?", request.status(), userId);
    }

    /** 更新账户基本资料；修改当前登录名时结束旧会话，避免会话保留失效的身份。 */
    @PutMapping("/{userId}")
    @Transactional
    public void updateUser(@PathVariable long userId, @Valid @RequestBody UpdateUserRequest request,
                           Authentication authentication, HttpServletRequest httpRequest) {
        String oldUsername = jdbcTemplate.query("SELECT username FROM users WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? rs.getString("username") : null, userId);
        if (oldUsername == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.");
        String username = request.username().trim();
        try {
            jdbcTemplate.update("UPDATE users SET username = ?, real_name = ?, email = ?, phone = ? WHERE id = ?",
                username, request.realName().trim(), request.email(), request.phone(), userId);
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That username is already in use.");
        }
        if (authentication != null && oldUsername.equals(authentication.getName()) && !oldUsername.equals(username)) {
            httpRequest.getSession().invalidate();
        }
    }

    @DeleteMapping("/{userId}")
    @Transactional
    public void deleteUser(@PathVariable long userId, Authentication authentication) {
        // Lock active admins first so deletion cannot race with another request removing the final admin.
        jdbcTemplate.query("SELECT id FROM users WHERE role_code = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE",
            (rs, rowNum) -> rs.getLong("id"));
        UserRole target = jdbcTemplate.query("SELECT username, role_code, status FROM users WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? new UserRole(rs.getString("username"), rs.getString("role_code"), rs.getString("status")) : null,
            userId);
        if (target == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.");
        String actor = authentication == null ? "" : authentication.getName();
        if (target.username().equals(actor)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "You cannot delete your own account.");
        }
        if ("ADMIN".equals(target.roleCode()) && "ACTIVE".equals(target.status())) {
            Integer activeAdmins = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM users WHERE role_code = 'ADMIN' AND status = 'ACTIVE'", Integer.class);
            if (activeAdmins != null && activeAdmins <= 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "At least one active administrator account must remain.");
            }
        }

        long actorId = jdbcTemplate.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, actor);
        jdbcTemplate.update("DELETE FROM shsat_wrong_answer_assignments WHERE student_user_id = ?", userId);
        jdbcTemplate.update("DELETE FROM review_assignments WHERE student_user_id = ?", userId);
        jdbcTemplate.update("DELETE FROM attempts WHERE student_user_id = ?", userId);
        jdbcTemplate.update("DELETE FROM exam_target_students WHERE student_user_id = ?", userId);
        jdbcTemplate.update("DELETE FROM exam_participants WHERE student_user_id = ?", userId);
        jdbcTemplate.update("DELETE FROM class_memberships WHERE student_user_id = ?", userId);
        jdbcTemplate.update("UPDATE sat_class_settings SET teacher_user_id = NULL WHERE teacher_user_id = ?", userId);
        jdbcTemplate.update("UPDATE papers SET created_by = ? WHERE created_by = ?", actorId, userId);
        jdbcTemplate.update("UPDATE exams SET created_by = ? WHERE created_by = ?", actorId, userId);
        jdbcTemplate.update("DELETE FROM users WHERE id = ?", userId);
    }

    @PutMapping("/{userId}/role")
    @Transactional
    public void updateRole(@PathVariable long userId, @Valid @RequestBody RoleRequest request,
                           Authentication authentication) {
        // Serialize administrator role changes so concurrent requests cannot remove the final active admin.
        jdbcTemplate.query("SELECT id FROM users WHERE role_code = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE",
            (rs, rowNum) -> rs.getLong("id"));
        UserRole target = jdbcTemplate.query("SELECT username, role_code, status FROM users WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? new UserRole(rs.getString("username"), rs.getString("role_code"), rs.getString("status")) : null,
            userId);
        if (target == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.");
        String actor = authentication == null ? "" : authentication.getName();
        if (target.username().equals(actor) && !"ADMIN".equals(request.roleCode())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "You cannot remove administrator access from your own account.");
        }
        if ("ADMIN".equals(target.roleCode()) && "ACTIVE".equals(target.status()) && !"ADMIN".equals(request.roleCode())) {
            Integer activeAdmins = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM users WHERE role_code = 'ADMIN' AND status = 'ACTIVE'", Integer.class);
            if (activeAdmins != null && activeAdmins <= 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "At least one active administrator account must remain.");
            }
        }
        jdbcTemplate.update("UPDATE users SET role_code = ? WHERE id = ?", request.roleCode(), userId);
        if ("ADMIN".equals(target.roleCode()) && !"ADMIN".equals(request.roleCode())) {
            // 原管理员没有显式授权时，先保留其访问能力，避免账号从工作区列表消失。
            Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM user_workspace_access WHERE user_id = ?", Integer.class, userId);
            if (count != null && count == 0) {
                jdbcTemplate.update("""
                    INSERT INTO user_workspace_access (user_id, workspace_code)
                    SELECT ?, code FROM exam_workspaces WHERE is_active = TRUE
                    """, userId);
            }
        }
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
                rs.getString("phone"), rs.getString("status"), rs.getTimestamp("created_at").toInstant().toString(), List.of()), username);
    }

    public record CreateUserRequest(@NotBlank @Size(max = 80) String username,
                                    @NotBlank @Size(min = 6, max = 100) String password,
                                    @NotBlank @Size(max = 80) String realName,
                                    @NotBlank @Pattern(regexp = "ADMIN|TEACHER|STUDENT") String roleCode,
                                    @Email @Size(max = 160) String email,
                                    @Size(max = 30) String phone,
                                    List<String> workspaceCodes) { }

    public record StatusRequest(@NotBlank @Pattern(regexp = "ACTIVE|DISABLED") String status) { }
    public record UpdateUserRequest(@NotBlank @Size(max = 80) String username,
                                    @NotBlank @Size(max = 80) String realName,
                                    @Email @Size(max = 160) String email,
                                    @Size(max = 30) String phone) { }
    public record RoleRequest(@NotBlank @Pattern(regexp = "ADMIN|TEACHER|STUDENT") String roleCode) { }
    public record PasswordRequest(@NotBlank @Size(min = 6, max = 100) String password) { }
    public record UserView(long id, String username, String realName, String roleCode, String email,
                           String phone, String status, String createdAt, List<String> workspaceCodes) { }
    private record UserRole(String username, String roleCode, String status) { }
}
