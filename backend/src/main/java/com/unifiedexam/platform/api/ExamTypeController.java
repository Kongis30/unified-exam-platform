package com.unifiedexam.platform.api;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 向前端提供后端实际注册的考试类型，不把页面路由配置存进数据库。 */
@RestController
@RequestMapping("/api/exam-types")
public class ExamTypeController {

    private final ExamTypeRegistry examTypeRegistry;

    public ExamTypeController(ExamTypeRegistry examTypeRegistry) {
        this.examTypeRegistry = examTypeRegistry;
    }

    @GetMapping
    public List<ExamTypeDefinition> listExamTypes() {
        return examTypeRegistry.listAvailableTypes();
    }
}
