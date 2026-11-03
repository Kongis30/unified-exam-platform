package com.unifiedexam.platform.api;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.authentication.AnonymousAuthenticationToken;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 向前端提供后端实际注册的考试类型，不把页面路由配置存进数据库。 */
@RestController
@RequestMapping("/api/exam-types")
public class ExamTypeController {

    private final ExamTypeRegistry examTypeRegistry;
    private final JdbcTemplate jdbcTemplate;

    public ExamTypeController(ExamTypeRegistry examTypeRegistry, JdbcTemplate jdbcTemplate) {
        this.examTypeRegistry = examTypeRegistry;
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping
    public List<ExamTypeDefinition> listExamTypes(Authentication authentication) {
        Map<String, ExamTypeDefinition> registeredTypes = new HashMap<>();
        examTypeRegistry.listAvailableTypes().forEach(type -> registeredTypes.put(type.code(), type));
        List<CatalogEntry> activeEntries = jdbcTemplate.query("""
            SELECT t.code, t.display_name, t.sort_order, w.code AS workspace_code, w.name AS workspace_name
            FROM exam_types t JOIN exam_workspaces w ON w.code = t.workspace_code
            WHERE t.is_active = TRUE AND w.is_active = TRUE ORDER BY t.sort_order, t.code
            """, (rs, rowNum) -> new CatalogEntry(rs.getString("code"),
                rs.getString("display_name"), rs.getInt("sort_order"), rs.getString("workspace_code"), rs.getString("workspace_name")));
        boolean restricted = authentication != null && authentication.isAuthenticated()
            && !(authentication instanceof AnonymousAuthenticationToken)
            && authentication.getAuthorities().stream().noneMatch(role -> role.getAuthority().equals("ROLE_ADMIN"));
        List<String> granted = restricted ? jdbcTemplate.queryForList("""
            SELECT a.workspace_code FROM user_workspace_access a JOIN users u ON u.id = a.user_id WHERE u.username = ?
            """, String.class, authentication.getName()) : List.of();
        return activeEntries.stream()
            .filter(entry -> registeredTypes.containsKey(entry.code()))
            .filter(entry -> !restricted || granted.contains(entry.workspaceCode()))
            .map(entry -> {
                ExamTypeDefinition module = registeredTypes.get(entry.code());
                return new ExamTypeDefinition(entry.code(), entry.displayName(), module.summary(), entry.sortOrder(),
                    entry.workspaceCode(), entry.workspaceName());
            })
            .toList();
    }

    private record CatalogEntry(String code, String displayName, int sortOrder, String workspaceCode, String workspaceName) { }
}
