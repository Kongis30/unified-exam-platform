package com.unifiedexam.platform.examtype.shsat.admin;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** 新版 SHSAT 管理报表 API，共用平台考试与作答数据。 */
@RestController
@RequestMapping("/api/admin/reports")
public class ShsatAdminReportController {

    private final ShsatAdminReportService reportService;

    public ShsatAdminReportController(ShsatAdminReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping("/exams/{examId}/classes/{classId}")
    public List<Map<String, Object>> classExamScores(@PathVariable long examId, @PathVariable long classId) {
        return reportService.classExamScores(examId, classId);
    }

    @GetMapping("/students/{studentId}/attempts")
    public List<Map<String, Object>> studentAttemptHistory(@PathVariable long studentId) {
        return reportService.studentAttemptHistory(studentId);
    }

    @GetMapping("/attempts/{attemptId}/result")
    public Map<String, Object> attemptResult(@PathVariable long attemptId) {
        return reportService.attemptResult(attemptId);
    }

    @GetMapping("/exams/{examId}/monitor/live")
    public Map<String, Object> monitorLive(@PathVariable long examId) {
        return reportService.monitorLive(examId);
    }

    @GetMapping("/exams/{examId}/monitor/analytics")
    public Map<String, Object> monitorAnalytics(@PathVariable long examId) {
        return reportService.monitorAnalytics(examId);
    }

    @GetMapping("/exams/{examId}/monitor/questions/{questionNumber}")
    public Map<String, Object> monitorQuestion(@PathVariable long examId, @PathVariable int questionNumber) {
        return reportService.monitorQuestion(examId, questionNumber);
    }
}
