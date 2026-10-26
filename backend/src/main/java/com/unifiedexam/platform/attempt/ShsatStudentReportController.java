package com.unifiedexam.platform.attempt;

import com.unifiedexam.platform.examtype.shsat.admin.ShsatAdminReportService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 学生报告只允许读取本人数据，并在服务层按考试策略移除受限字段。 */
@RestController
@RequestMapping("/api/student/attempts")
public class ShsatStudentReportController {

    private final ShsatAdminReportService reportService;

    public ShsatStudentReportController(ShsatAdminReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping("/history")
    public java.util.List<Map<String, Object>> history(Authentication authentication) {
        return reportService.studentOwnAttemptHistory(authentication.getName());
    }

    @GetMapping("/{attemptId}/report")
    public Map<String, Object> report(@PathVariable long attemptId, Authentication authentication) {
        return reportService.studentAttemptResult(attemptId, authentication.getName());
    }
}
