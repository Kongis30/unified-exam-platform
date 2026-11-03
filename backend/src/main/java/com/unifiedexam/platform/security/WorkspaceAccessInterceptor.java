package com.unifiedexam.platform.security;

import com.unifiedexam.platform.identity.WorkspaceAccessService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

import java.util.List;
import java.util.Map;

/** 从资源所属考试类型校验工作区，避免仅靠前端入口隐藏控制访问。 */
@Component
public class WorkspaceAccessInterceptor implements HandlerInterceptor {
    private final WorkspaceAccessService access;
    private final JdbcTemplate jdbc;

    public WorkspaceAccessInterceptor(WorkspaceAccessService access, JdbcTemplate jdbc) {
        this.access = access;
        this.jdbc = jdbc;
    }

    @Override
    @SuppressWarnings("unchecked")
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String path = request.getRequestURI();
        if (!path.startsWith("/api/student/") && !path.startsWith("/api/admin/")) return true;
        Authentication user = SecurityContextHolder.getContext().getAuthentication();
        if (user == null || user.getAuthorities().stream().anyMatch(role -> "ROLE_ADMIN".equals(role.getAuthority()))) return true;
        if (path.startsWith("/api/admin/classes")) {
            String[] requestedTypes = request.getParameterValues("examTypeCodes");
            if (requestedTypes != null) {
                for (String value : requestedTypes) {
                    for (String type : value.split(",")) access.requireExamType(user, type.trim());
                }
            } else if (path.matches("/api/admin/classes/[0-9]+/(?:exams|score-trend)(?:/.*)?")) {
                // 旧 SHSAT 调用省略类型时，服务端默认只返回 SHSAT 考试。
                access.requireExamType(user, "SHSAT");
            } else if ("GET".equals(request.getMethod()) && (path.equals("/api/admin/classes")
                || path.matches("/api/admin/classes/[0-9]+(?:/students)?"))) {
                throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "Select an exam system.");
            }
        }
        Object raw = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        Map<String, String> vars = raw instanceof Map<?, ?> ? (Map<String, String>) raw : Map.of();
        String code = vars.get("examTypeCode");
        if (code == null && vars.containsKey("paperId")) {
            code = typeFor("SELECT exam_type_code FROM papers WHERE id = ?", vars.get("paperId"));
        }
        if (code == null && vars.containsKey("examId")) {
            code = typeFor("SELECT p.exam_type_code FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ?", vars.get("examId"));
        }
        if (code == null && vars.containsKey("attemptId")) {
            code = typeFor("SELECT p.exam_type_code FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id WHERE a.id = ?", vars.get("attemptId"));
        }
        if (code == null && vars.containsKey("groupId")) {
            code = typeFor("SELECT exam_type_code FROM paper_groups WHERE id = ?", vars.get("groupId"));
        }
        if (code == null && vars.containsKey("workspaceCode")) {
            code = typeFor("SELECT code FROM exam_types WHERE workspace_code = ? AND is_active = TRUE LIMIT 1", vars.get("workspaceCode"), false);
        }
        if (code == null && path.startsWith("/api/student/sat-questions/") && vars.containsKey("questionId")) {
            var types = jdbc.queryForList("""
                SELECT DISTINCT p.exam_type_code FROM paper_items i
                JOIN paper_sections s ON s.id = i.section_id JOIN papers p ON p.id = s.paper_id
                WHERE i.question_id = ?
                """, String.class, vars.get("questionId"));
            var allowed = access.accessibleExamTypes(user);
            if (!types.isEmpty() && types.stream().noneMatch(allowed::contains)) {
                access.requireExamType(user, types.get(0));
            }
        }
        if (code == null && (path.startsWith("/api/student/wrong-answer-tasks")
            || path.startsWith("/api/admin/wrong-answer-tasks") || path.startsWith("/api/admin/reports/students/")
            || path.equals("/api/student/attempts/history"))) code = "SHSAT";
        if (code != null) access.requireExamType(user, code);
        return true;
    }

    private String typeFor(String sql, String id) {
        return typeFor(sql, id, true);
    }

    private String typeFor(String sql, String id, boolean numeric) {
        if (id == null || (numeric && !id.matches("[0-9]+"))) return null;
        List<String> types = jdbc.queryForList(sql, String.class, id);
        return types.isEmpty() ? null : types.get(0);
    }
}
