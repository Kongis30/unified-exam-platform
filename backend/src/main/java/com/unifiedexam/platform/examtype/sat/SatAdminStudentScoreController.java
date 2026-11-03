package com.unifiedexam.platform.examtype.sat;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import org.springframework.security.core.Authentication;
import com.unifiedexam.platform.identity.WorkspaceAccessService;

/** SAT/PSAT 管理端的学生成绩历史 API。 */
@RestController
@RequestMapping("/api/admin/sat/students")
public class SatAdminStudentScoreController {
    private final SatAdminStudentScoreService scores;
    private final WorkspaceAccessService workspaceAccess;

    public SatAdminStudentScoreController(SatAdminStudentScoreService scores, WorkspaceAccessService workspaceAccess) {
        this.scores = scores;
        this.workspaceAccess = workspaceAccess;
    }

    @GetMapping("/{studentId}/scores")
    public Map<String, Object> scores(@PathVariable long studentId, @RequestParam(required = false) Long classId,
                                      @RequestParam(required = false) String examType, Authentication authentication) {
        var allowed = workspaceAccess.accessibleExamTypes(authentication);
        if (!allowed.contains("SAT") && !allowed.contains("PSAT")) {
            throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN,
                "You do not have access to this exam system.");
        }
        if (examType != null && (!java.util.Set.of("SAT", "PSAT").contains(examType) || !allowed.contains(examType))) {
            throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN,
                "You do not have access to this exam system.");
        }
        return classId == null && examType == null ? scores.scores(studentId, allowed)
            : scores.scores(studentId, allowed, classId, examType);
    }

    public Map<String, Object> scores(long studentId, Authentication authentication) {
        return scores(studentId, null, null, authentication);
    }

    @DeleteMapping("/{studentId}/attempts/{attemptId}")
    public void deleteAttempt(@PathVariable long studentId, @PathVariable long attemptId) {
        scores.deleteAttempt(studentId, attemptId);
    }
}
