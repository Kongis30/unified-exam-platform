package com.unifiedexam.platform.examtype.sat;

import com.unifiedexam.platform.attempt.SatStudentAttemptService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;

/** 为管理端学生成绩历史提供受角色保护的 SAT 报告入口。 */
@RestController
@RequestMapping("/api/admin/sat/attempts")
public class SatAdminReportController {

    private final SatStudentAttemptService attempts;

    public SatAdminReportController(SatStudentAttemptService attempts) {
        this.attempts = attempts;
    }

    @GetMapping("/{attemptId}/report")
    public JsonNode report(@PathVariable long attemptId) {
        return attempts.reportForStaff(attemptId);
    }
}
