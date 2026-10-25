package com.unifiedexam.platform.examtype.sat;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** SAT/PSAT 管理端的学生成绩历史 API。 */
@RestController
@RequestMapping("/api/admin/sat/students")
public class SatAdminStudentScoreController {
    private final SatAdminStudentScoreService scores;

    public SatAdminStudentScoreController(SatAdminStudentScoreService scores) {
        this.scores = scores;
    }

    @GetMapping("/{studentId}/scores")
    public Map<String, Object> scores(@PathVariable long studentId) {
        return scores.scores(studentId);
    }

    @DeleteMapping("/{studentId}/attempts/{attemptId}")
    public void deleteAttempt(@PathVariable long studentId, @PathVariable long attemptId) {
        scores.deleteAttempt(studentId, attemptId);
    }
}
