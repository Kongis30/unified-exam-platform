package com.unifiedexam.platform.attempt;

import com.unifiedexam.platform.examtype.ScoreTrendProvider;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 学生个人分数趋势的唯一入口。
 *
 * <p>平台层只做三件事：解析当前学员、按 {@code examTypeCode} 找到已注册的
 * {@link ScoreTrendProvider}、原样返回其组装结果。口径（哪些尝试计入、量表分怎么换算、
 * 原始分满分是什么）全部归各考试类型模块，符合「平台通过稳定的项目编码找到已注册的处理器」。
 */
@Service
public class StudentScoreTrendService {

    private final JdbcTemplate jdbc;
    private final Map<String, ScoreTrendProvider> providers;

    public StudentScoreTrendService(JdbcTemplate jdbc, List<ScoreTrendProvider> providers) {
        this.jdbc = jdbc;
        Map<String, ScoreTrendProvider> byCode = new HashMap<>();
        for (ScoreTrendProvider provider : providers) {
            String code = provider.examTypeCode();
            if (byCode.put(code, provider) != null) {
                throw new IllegalStateException("Duplicate score trend provider: " + code);
            }
        }
        this.providers = Map.copyOf(byCode);
    }

    /** 趋势数据属于考试类型，因此入参是 examTypeCode 而不是 workspaceCode。 */
    public StudentScoreTrend load(String examTypeCode, String username) {
        if (examTypeCode == null || examTypeCode.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select an exam system.");
        }
        ScoreTrendProvider provider = providers.get(examTypeCode);
        if (provider == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "This exam system has no score trend.");
        }
        Long studentUserId = jdbc.query(
            "SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT' AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        if (studentUserId == null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Student account required.");
        }
        return provider.load(studentUserId);
    }

    /** 供管理员/教师侧复用同一套分数口径（当前仅学生端使用）。 */
    public boolean supports(String examTypeCode) {
        return examTypeCode != null && providers.containsKey(examTypeCode);
    }
}
