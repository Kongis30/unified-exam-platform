package com.unifiedexam.platform.attempt;

import com.unifiedexam.platform.identity.WorkspaceAccessService;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 学生本人在某个考试系统下的分数趋势（成长曲线）。
 *
 * <p>只返回本人数据：学员身份取自会话用户名，接口不接收 {@code studentId}，
 * 因此不存在越权读取他人成绩的路径。工作区授权由 {@link WorkspaceAccessService} 校验。
 */
@RestController
@RequestMapping("/api/student")
public class StudentScoreTrendController {

    private final StudentScoreTrendService trends;
    private final WorkspaceAccessService workspaceAccess;

    public StudentScoreTrendController(StudentScoreTrendService trends, WorkspaceAccessService workspaceAccess) {
        this.trends = trends;
        this.workspaceAccess = workspaceAccess;
    }

    @GetMapping("/score-trend")
    public StudentScoreTrend scoreTrend(@RequestParam String examTypeCode, Authentication authentication) {
        workspaceAccess.requireExamType(authentication, examTypeCode);
        return trends.load(examTypeCode, authentication.getName());
    }
}
