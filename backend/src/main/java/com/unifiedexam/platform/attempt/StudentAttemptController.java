package com.unifiedexam.platform.attempt;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 学生作答 API；身份和考试归属由服务层再次校验。 */
@RestController
@RequestMapping("/api/student")
public class StudentAttemptController {

    private final StudentAttemptService attemptService;

    public StudentAttemptController(StudentAttemptService attemptService) {
        this.attemptService = attemptService;
    }

    @PostMapping("/exams/{examId}/attempts")
    public StudentAttemptService.AttemptView start(@PathVariable long examId,
            @RequestBody(required = false) StartRequest request, Authentication authentication) {
        return attemptService.start(examId, request == null ? null : request.firstSection(), authentication.getName());
    }

    @GetMapping("/attempts/{attemptId}")
    public StudentAttemptService.AttemptView get(@PathVariable long attemptId, Authentication authentication) {
        return attemptService.get(attemptId, authentication.getName());
    }

    @PostMapping("/attempts/{attemptId}/wrong-answers/practice")
    public StudentAttemptService.AttemptView startWrongAnswerPractice(@PathVariable long attemptId,
            Authentication authentication) {
        return attemptService.startWrongAnswerPractice(attemptId, authentication.getName());
    }

    @GetMapping("/attempts/{attemptId}/wrong-answer-question-numbers")
    public java.util.List<Integer> wrongAnswerQuestionNumbers(@PathVariable long attemptId,
            Authentication authentication) {
        return attemptService.wrongAnswerQuestionNumbers(attemptId, authentication.getName());
    }

    @PostMapping("/attempts/{attemptId}/sections/submit")
    public StudentAttemptService.AttemptView submitSection(@PathVariable long attemptId, Authentication authentication) {
        return attemptService.submitSection(attemptId, authentication.getName());
    }

    @PostMapping("/attempts/{attemptId}/presence")
    public void updatePresence(@PathVariable long attemptId, @Valid @RequestBody PresenceRequest request,
            Authentication authentication) {
        attemptService.updatePresence(attemptId, request.questionNumber(), authentication.getName());
    }

    @PostMapping("/attempts/{attemptId}/focus-violations")
    public int recordFocusViolation(@PathVariable long attemptId, Authentication authentication) {
        return attemptService.recordFocusViolation(attemptId, authentication.getName());
    }

    @PutMapping("/attempts/{attemptId}/answers/{paperItemId}")
    public StudentAttemptService.AttemptView saveAnswer(@PathVariable long attemptId,
            @PathVariable long paperItemId, @Valid @RequestBody AnswerRequest request,
            Authentication authentication) {
        return attemptService.saveAnswer(attemptId, paperItemId, request.answer(), request.timeSpentSeconds(), authentication.getName());
    }

    @PostMapping("/attempts/{attemptId}/submit")
    public StudentAttemptService.AttemptView submit(@PathVariable long attemptId, Authentication authentication) {
        return attemptService.submit(attemptId, authentication.getName());
    }

    public record AnswerRequest(@NotNull JsonNode answer, @PositiveOrZero Integer timeSpentSeconds) { }
    public record StartRequest(@Pattern(regexp = "(?i)ELA|MATH") String firstSection) { }
    public record PresenceRequest(@Positive int questionNumber) { }
}
