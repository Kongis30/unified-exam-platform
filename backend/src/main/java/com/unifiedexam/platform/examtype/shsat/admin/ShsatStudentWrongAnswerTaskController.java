package com.unifiedexam.platform.examtype.shsat.admin;

import com.unifiedexam.platform.attempt.StudentAttemptService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 学生查看并开始分配给自己的 SHSAT 错题复习任务。 */
@RestController
@RequestMapping("/api/student/wrong-answer-tasks")
public class ShsatStudentWrongAnswerTaskController {

    private final ShsatWrongAnswerTaskService taskService;

    public ShsatStudentWrongAnswerTaskController(ShsatWrongAnswerTaskService taskService) {
        this.taskService = taskService;
    }

    @GetMapping
    public List<ShsatWrongAnswerTaskService.StudentTaskView> list(Authentication authentication) {
        return taskService.listForStudent(authentication.getName());
    }

    @PostMapping("/{assignmentId}/start")
    public StudentAttemptService.AttemptView start(@PathVariable long assignmentId, Authentication authentication) {
        return taskService.startForStudent(assignmentId, authentication.getName());
    }
}
