package com.unifiedexam.platform.review;

import org.springframework.security.core.Authentication;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 管理端统一入口；模块访问权限由 WorkspaceAccessInterceptor 根据路径校验。 */
@RestController
@RequestMapping("/api/admin/review-assignments/{examTypeCode}")
public class ReviewTaskController {
    private final ReviewTaskService tasks;
    private final ReviewReportService reports;

    public ReviewTaskController(ReviewTaskService tasks, ReviewReportService reports) {
        this.tasks = tasks;
        this.reports = reports;
    }

    @GetMapping
    public List<ReviewTaskService.TaskView> list(@PathVariable String examTypeCode) {
        requireSupported(examTypeCode);
        return tasks.list(examTypeCode);
    }

    @PostMapping
    public ReviewTaskService.TaskDetail create(@PathVariable String examTypeCode,
            @RequestBody ReviewTaskService.CreateTask request, Authentication authentication) {
        requireSupported(examTypeCode);
        return tasks.detail(examTypeCode, tasks.create(examTypeCode, request, authentication.getName()));
    }

    @GetMapping("/{taskId}")
    public ReviewTaskService.TaskDetail detail(@PathVariable String examTypeCode, @PathVariable long taskId) {
        requireSupported(examTypeCode);
        return tasks.detail(examTypeCode, taskId);
    }

    @PostMapping("/{taskId}/end")
    public ReviewTaskService.TaskView end(@PathVariable String examTypeCode, @PathVariable long taskId) {
        requireSupported(examTypeCode);
        return tasks.end(examTypeCode, taskId);
    }

    @GetMapping("/assignments/{assignmentId}/report")
    public JsonNode report(@PathVariable String examTypeCode, @PathVariable long assignmentId) {
        requireSupported(examTypeCode);
        return reports.staffReport(examTypeCode, assignmentId);
    }

    // SHSAT 继续使用现有入口，避免生成学生端无法打开的任务。
    private void requireSupported(String type) {
        if (!"SAT".equals(type) && !"PSAT".equals(type)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select a supported exam system.");
        }
    }
}
