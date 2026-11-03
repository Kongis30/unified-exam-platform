package com.unifiedexam.platform.identity;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.security.core.Authentication;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** 维护学生及教师的工作区授权；管理员始终拥有所有工作区权限。 */
@Service
public class WorkspaceAccessService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public WorkspaceAccessService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<Workspace> listWorkspaces() {
        return jdbc.query("""
            SELECT code, name, is_active FROM exam_workspaces ORDER BY sort_order, code
            """, (rs, row) -> new Workspace(rs.getString("code"), rs.getString("name"), rs.getBoolean("is_active")));
    }

    public List<String> accessForUser(long userId) {
        return jdbc.queryForList("""
            SELECT workspace_code FROM user_workspace_access WHERE user_id = ? ORDER BY workspace_code
            """, String.class, userId);
    }

    /** 按考试类型检查当前授权，每次读取数据库，授权变动无需重新登录。 */
    public void requireExamType(Authentication authentication, String examTypeCode) {
        if (authentication == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Please sign in to continue.");
        if (!canAccessExamType(authentication, examTypeCode)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You do not have access to this exam system.");
        }
    }

    public boolean canAccessExamType(Authentication authentication, String examTypeCode) {
        if (authentication == null) return false;
        if (authentication.getAuthorities().stream().anyMatch(role -> "ROLE_ADMIN".equals(role.getAuthority()))) return true;
        Integer allowed = jdbc.queryForObject("""
            SELECT COUNT(*) FROM users u
            JOIN user_workspace_access a ON a.user_id = u.id
            JOIN exam_workspaces w ON w.code = a.workspace_code AND w.is_active = TRUE
            JOIN exam_types t ON t.workspace_code = w.code AND t.is_active = TRUE
            WHERE u.username = ? AND u.status = 'ACTIVE' AND t.code = ?
            """, Integer.class, authentication.getName(), examTypeCode);
        return allowed != null && allowed > 0;
    }

    public Set<String> accessibleExamTypes(Authentication authentication) {
        if (authentication == null) return Set.of();
        if (authentication.getAuthorities().stream().anyMatch(role -> "ROLE_ADMIN".equals(role.getAuthority()))) {
            return Set.copyOf(jdbc.queryForList("SELECT code FROM exam_types WHERE is_active = TRUE", String.class));
        }
        return Set.copyOf(jdbc.queryForList("""
            SELECT t.code FROM users u JOIN user_workspace_access a ON a.user_id = u.id
            JOIN exam_workspaces w ON w.code = a.workspace_code AND w.is_active = TRUE
            JOIN exam_types t ON t.workspace_code = w.code AND t.is_active = TRUE
            WHERE u.username = ? AND u.status = 'ACTIVE'
            """, String.class, authentication.getName()));
    }

    /** 锁定账号并一次性替换授权，审计写入与授权更新处于同一事务。 */
    @Transactional
    public void replaceAccess(long userId, List<String> requestedCodes, String actor) {
        String role = jdbc.query("SELECT role_code FROM users WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? rs.getString("role_code") : null, userId);
        if (role == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Account not found.");
        if ("ADMIN".equals(role)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Administrators can access all workspaces.");
        }
        if (requestedCodes == null || requestedCodes.isEmpty() || requestedCodes.stream().anyMatch(code -> code == null || code.isBlank())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one exam system.");
        }
        Set<String> desired = new LinkedHashSet<>(requestedCodes);
        Set<String> active = new LinkedHashSet<>(jdbc.queryForList(
            "SELECT code FROM exam_workspaces WHERE is_active = TRUE", String.class));
        if (!active.containsAll(desired)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One or more workspaces are unavailable.");
        }
        List<String> previous = accessForUser(userId);
        if (Set.copyOf(previous).equals(desired)) return;
        jdbc.update("DELETE FROM user_workspace_access WHERE user_id = ?", userId);
        desired.forEach(code -> jdbc.update("INSERT INTO user_workspace_access (user_id, workspace_code) VALUES (?, ?)", userId, code));
        try {
            String details = mapper.writeValueAsString(java.util.Map.of("previous", previous, "current", desired));
            jdbc.update("""
                INSERT INTO audit_events (actor_user_id, action_code, entity_type, entity_key, detail_json)
                SELECT id, 'WORKSPACE_ACCESS_UPDATED', 'USER', ?, ? FROM users WHERE username = ?
                """, Long.toString(userId), details, actor);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to record workspace access change.", exception);
        }
    }

    public record Workspace(String code, String name, boolean active) { }
}
