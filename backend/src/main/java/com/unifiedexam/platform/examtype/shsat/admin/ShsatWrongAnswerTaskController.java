package com.unifiedexam.platform.examtype.shsat.admin;

import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 新版 SHSAT 错题任务管理 API。 */
@RestController
@RequestMapping("/api/admin/wrong-answer-tasks")
public class ShsatWrongAnswerTaskController {

    private final ShsatWrongAnswerTaskService taskService;

    public ShsatWrongAnswerTaskController(ShsatWrongAnswerTaskService taskService) {
        this.taskService = taskService;
    }

    @GetMapping
    public List<ShsatWrongAnswerTaskService.TaskView> list(
            @RequestParam(required = false) Long examId,
            @RequestParam(required = false) Long classId) {
        return taskService.list(examId, classId);
    }

    @PostMapping
    public ShsatWrongAnswerTaskService.TaskView create(
            @Valid @RequestBody ShsatWrongAnswerTaskService.CreateTaskRequest request,
            Authentication authentication) {
        return taskService.create(request, authentication.getName());
    }

    @PostMapping("/{taskId}/end")
    public ShsatWrongAnswerTaskService.TaskView end(@PathVariable long taskId) {
        return taskService.end(taskId);
    }

    @GetMapping("/{taskId}")
    public ShsatWrongAnswerTaskService.TaskDetail detail(@PathVariable long taskId) {
        return taskService.detail(taskId);
    }
}
