package com.unifiedexam.platform.attempt;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import com.unifiedexam.platform.identity.WorkspaceAccessService;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** SAT/PSAT 专属正式考试接口；权限只开放给学生，管理员教师继续走练习模式。 */
@RestController
@RequestMapping("/api/student")
public class SatStudentAttemptController {

    private final SatStudentAttemptService attempts;
    private final WorkspaceAccessService workspaceAccess;

    public SatStudentAttemptController(SatStudentAttemptService attempts, WorkspaceAccessService workspaceAccess) {
        this.attempts = attempts;
        this.workspaceAccess = workspaceAccess;
    }

    @PostMapping("/exams/{examId}/sat-attempt")
    public SatStudentAttemptService.SatAttemptView start(@PathVariable long examId, Authentication authentication) {
        return attempts.start(examId, authentication.getName());
    }

    @PostMapping("/sat-practice-papers/{paperId}/attempts")
    public SatStudentAttemptService.SatAttemptView startPractice(@PathVariable long paperId, Authentication authentication) {
        return attempts.startPractice(paperId, authentication.getName());
    }

    @GetMapping("/sat-practice-papers")
    public List<SatStudentAttemptService.PracticePaperView> practicePapers(@RequestParam(required = false) String examTypeCode, Authentication authentication) {
        return attempts.practicePapers(authentication.getName(), practiceWorkspace(examTypeCode, authentication));
    }

    @GetMapping("/sat-practice-attempts")
    public SatStudentAttemptService.PracticeHistoryPage practiceHistory(
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String examTypeCode, Authentication authentication) {
        return attempts.practiceHistory(authentication.getName(), page, size, practiceWorkspace(examTypeCode, authentication));
    }

    private String practiceWorkspace(String code, Authentication authentication) {
        if (code == null || code.isBlank()) {
            var allowed = workspaceAccess.accessibleExamTypes(authentication);
            boolean sat = allowed.contains("SAT"), psat = allowed.contains("PSAT");
            if (sat && psat) return null;
            if (sat) return "SAT";
            if (psat) return "PSAT";
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "You do not have access to this exam system.");
        }
        if (!"SAT".equals(code) && !"PSAT".equals(code)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select an exam system.");
        }
        workspaceAccess.requireExamType(authentication, code);
        return code;
    }

    @GetMapping("/sat-attempts/{attemptId}")
    public SatStudentAttemptService.SatAttemptView get(@PathVariable long attemptId, Authentication authentication) {
        return attempts.get(attemptId, authentication.getName());
    }

    @GetMapping("/sat-papers/{paperId}/modules")
    public List<SatStudentAttemptService.SatModule> modules(@PathVariable long paperId, Authentication authentication) {
        return attempts.modulesForStudent(paperId, authentication.getName());
    }

    @GetMapping("/sat-papers/{paperId}/modules/{moduleId}/questions")
    public List<SatStudentAttemptService.SatQuestion> questions(@PathVariable long paperId, @PathVariable long moduleId,
            Authentication authentication) {
        return attempts.questionsForStudent(paperId, moduleId, authentication.getName());
    }

    @GetMapping("/sat-questions/{questionId}")
    public Object questionDetail(@PathVariable long questionId, Authentication authentication) {
        return attempts.questionDetailForStudent(questionId, authentication.getName());
    }

    @GetMapping("/sat-attempts/{attemptId}/report")
    public Object report(@PathVariable long attemptId, Authentication authentication) {
        return attempts.report(attemptId, authentication.getName());
    }

    @GetMapping("/sat-attempts/{attemptId}/ready")
    public Map<String, Boolean> ready(@PathVariable long attemptId, Authentication authentication) {
        return Map.of("ready", "finished".equals(attempts.get(attemptId, authentication.getName()).status()));
    }

    @PutMapping("/sat-attempts/{attemptId}/modules/{moduleId}/save")
    public SatStudentAttemptService.SatAttemptView save(@PathVariable long attemptId, @PathVariable long moduleId,
            @Valid @RequestBody SatStudentAttemptService.ModuleSubmission submission, Authentication authentication) {
        return attempts.saveModule(attemptId, moduleId, submission, authentication.getName());
    }

    @PostMapping("/sat-attempts/{attemptId}/modules/{moduleId}/submit")
    public SatStudentAttemptService.SatAttemptView submitModule(@PathVariable long attemptId, @PathVariable long moduleId,
            @Valid @RequestBody SatStudentAttemptService.ModuleSubmission submission, Authentication authentication) {
        return attempts.submitModule(attemptId, moduleId, submission, authentication.getName());
    }

    @PostMapping("/sat-attempts/{attemptId}/resume-break")
    public SatStudentAttemptService.SatAttemptView resumeBreak(@PathVariable long attemptId, Authentication authentication) {
        return attempts.resumeBreak(attemptId, authentication.getName());
    }

    @PostMapping("/sat-attempts/{attemptId}/finish")
    public SatStudentAttemptService.SatAttemptView finish(@PathVariable long attemptId, Authentication authentication) {
        return attempts.finish(attemptId, authentication.getName());
    }

    @PostMapping("/sat-attempts/{attemptId}/presence")
    public SatStudentAttemptService.SatAttemptView updatePresence(@PathVariable long attemptId,
            @Valid @RequestBody PresenceRequest request, Authentication authentication) {
        return attempts.updatePresence(attemptId, request.questionNumber(), authentication.getName());
    }

    public record PresenceRequest(@NotNull @Positive Integer questionNumber) { }
}
