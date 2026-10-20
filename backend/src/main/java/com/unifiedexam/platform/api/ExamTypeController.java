package com.unifiedexam.platform.api;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.jdbc.core.JdbcTemplate;

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
    public List<ExamTypeDefinition> listExamTypes() {
        Map<String, ExamTypeDefinition> registeredTypes = new HashMap<>();
        examTypeRegistry.listAvailableTypes().forEach(type -> registeredTypes.put(type.code(), type));
        List<CatalogEntry> activeEntries = jdbcTemplate.query("""
            SELECT code, display_name, sort_order FROM exam_types
            WHERE is_active = TRUE ORDER BY sort_order, code
            """, (rs, rowNum) -> new CatalogEntry(rs.getString("code"),
                rs.getString("display_name"), rs.getInt("sort_order")));
        return activeEntries.stream()
            .filter(entry -> registeredTypes.containsKey(entry.code()))
            .map(entry -> {
                ExamTypeDefinition module = registeredTypes.get(entry.code());
                return new ExamTypeDefinition(entry.code(), entry.displayName(), module.summary(), entry.sortOrder(),
                    module.workspaceCode(), module.workspaceName());
            })
            .toList();
    }

    private record CatalogEntry(String code, String displayName, int sortOrder) { }
}
