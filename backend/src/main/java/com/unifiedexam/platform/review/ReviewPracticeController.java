package com.unifiedexam.platform.review;

import com.unifiedexam.platform.attempt.StudentAttemptService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 学生只可查看或启动本人当前模块的复习任务。 */
@RestController
@RequestMapping("/api/student/review-assignments/{examTypeCode}")
public class ReviewPracticeController {
    private final ReviewPracticeService review;
    private final ReviewReportService reports;
    public ReviewPracticeController(ReviewPracticeService review, ReviewReportService reports) { this.review = review; this.reports = reports; }

    @GetMapping
    public List<ReviewPracticeService.StudentAssignment> list(@PathVariable String examTypeCode, Authentication authentication) {
        return review.list(examTypeCode, authentication.getName());
    }

    @PostMapping("/{assignmentId}/start")
    public StudentAttemptService.AttemptView start(@PathVariable String examTypeCode, @PathVariable long assignmentId,
                                                    Authentication authentication) {
        return review.start(examTypeCode, assignmentId, authentication.getName());
    }

    @GetMapping("/{assignmentId}/report")
    public JsonNode report(@PathVariable String examTypeCode, @PathVariable long assignmentId, Authentication authentication) {
        return reports.studentReport(examTypeCode, assignmentId, authentication.getName());
    }
}
