package com.unifiedexam.platform.examtype.sat;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** SAT 纸级参数独立于通用试卷元数据，编辑器通过这里读取和保存评分配置。 */
@RestController
@RequestMapping("/api/admin/papers/{paperId}/sat-settings")
public class SatPaperSettingsController {

    private final JdbcTemplate jdbcTemplate;

    public SatPaperSettingsController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping
    public SatPaperSettings get(@PathVariable long paperId) {
        ensureSatPaper(paperId);
        return jdbcTemplate.query("""
            SELECT scoring_table_code, adaptive_mode, rest_time_seconds
            FROM sat_paper_settings WHERE paper_id = ?
            """, rs -> rs.next()
                ? new SatPaperSettings(rs.getString(1), rs.getBoolean(2), rs.getInt(3))
                : new SatPaperSettings(typeCode(paperId), true, 600), paperId);
    }

    @PutMapping
    @Transactional
    public SatPaperSettings update(@PathVariable long paperId, @Valid @RequestBody UpdateRequest request) {
        ensureSatPaper(paperId);
        String status = paperStatus(paperId);
        Boolean usedByExam = jdbcTemplate.queryForObject(
            "SELECT EXISTS(SELECT 1 FROM exams WHERE paper_id = ?)", Boolean.class, paperId);
        if (!"DRAFT".equals(status) && (!"READY".equals(status) || Boolean.TRUE.equals(usedByExam))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "This paper version is locked. Create a new version before changing SAT settings.");
        }
        jdbcTemplate.update("""
            INSERT INTO sat_paper_settings (paper_id, scoring_table_code, adaptive_mode, rest_time_seconds)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE scoring_table_code = VALUES(scoring_table_code),
                adaptive_mode = VALUES(adaptive_mode), rest_time_seconds = VALUES(rest_time_seconds)
            """, paperId, request.scoringTableCode(), request.adaptiveMode(), request.restTimeSeconds());
        return get(paperId);
    }

    private void ensureSatPaper(long paperId) {
        if (!"SAT".equals(typeCode(paperId)) && !"PSAT".equals(typeCode(paperId))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "SAT paper not found.");
        }
    }

    private String typeCode(long paperId) {
        return jdbcTemplate.query("SELECT exam_type_code FROM papers WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, paperId);
    }

    private String paperStatus(long paperId) {
        return jdbcTemplate.query("SELECT status FROM papers WHERE id = ?", rs -> rs.next() ? rs.getString(1) : null, paperId);
    }

    public record SatPaperSettings(String scoringTableCode, boolean adaptiveMode, int restTimeSeconds) { }

    public record UpdateRequest(@Pattern(regexp = "SAT|PSAT") String scoringTableCode,
            boolean adaptiveMode, @Min(0) int restTimeSeconds) { }
}
