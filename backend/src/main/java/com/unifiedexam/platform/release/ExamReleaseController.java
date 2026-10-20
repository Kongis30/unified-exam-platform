package com.unifiedexam.platform.release;

import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
public class ExamReleaseController {

    private final ExamReleaseService examReleaseService;

    public ExamReleaseController(ExamReleaseService examReleaseService) {
        this.examReleaseService = examReleaseService;
    }

    @GetMapping("/admin/exam-types/{examTypeCode}/exams")
    public List<ExamReleaseService.ExamSummary> listExams(@PathVariable String examTypeCode) {
        return examReleaseService.list(examTypeCode);
    }

    @PostMapping("/admin/papers/{paperId}/exams")
    public ExamReleaseService.ExamDetail createExam(@PathVariable long paperId,
                                                     @Valid @RequestBody ExamReleaseService.ExamRequest request,
                                                     Authentication authentication) {
        return examReleaseService.create(paperId, request, authentication.getName());
    }

    @GetMapping("/admin/exams/{examId}")
    public ExamReleaseService.ExamDetail getExam(@PathVariable long examId) {
        return examReleaseService.get(examId);
    }

    @PatchMapping("/admin/exams/{examId}")
    public ExamReleaseService.ExamDetail updateExam(@PathVariable long examId,
                                                     @Valid @RequestBody ExamReleaseService.ExamRequest request) {
        return examReleaseService.update(examId, request);
    }

    @PutMapping("/admin/exams/{examId}/targets")
    public ExamReleaseService.ExamDetail setTargets(@PathVariable long examId,
                                                     @Valid @RequestBody ExamReleaseService.TargetRequest request) {
        return examReleaseService.saveTargets(examId, request);
    }

    @PostMapping("/admin/exams/{examId}/publish")
    public ExamReleaseService.ExamDetail publishExam(@PathVariable long examId) {
        return examReleaseService.publish(examId);
    }

    @PostMapping("/admin/exams/{examId}/unpublish")
    public ExamReleaseService.ExamDetail unpublishExam(@PathVariable long examId) {
        return examReleaseService.unpublish(examId);
    }

    @DeleteMapping("/admin/exams/{examId}")
    public void deleteExam(@PathVariable long examId) {
        examReleaseService.delete(examId);
    }

    @GetMapping("/student/exams")
    public List<ExamReleaseService.StudentExamView> listStudentExams(Authentication authentication) {
        return examReleaseService.listForStudent(authentication.getName());
    }
}
