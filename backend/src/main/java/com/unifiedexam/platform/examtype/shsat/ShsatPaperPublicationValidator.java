package com.unifiedexam.platform.examtype.shsat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/** 对齐独立 SHSAT 的发布校验：必须有题目，且计分题归属 ELA 或 MATH。 */
@Component
public class ShsatPaperPublicationValidator {

    private static final Set<String> SCORED_PART_CODES = Set.of("ELA", "MATH");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ShsatPaperPublicationValidator(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public void validate(long paperId) {
        List<PublicationQuestion> questions = jdbcTemplate.query("""
            SELECT CASE
                       WHEN section.section_kind = 'PART'
                           THEN COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(section.settings_json, '$.partCode')), ''), section.section_code)
                       WHEN section.section_kind = 'SUBTYPE'
                           THEN COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(parent.settings_json, '$.partCode')), ''), parent.section_code)
                       ELSE NULL
                   END AS part_code,
                   question.grading_json
            FROM paper_items item
            JOIN paper_sections section ON section.id = item.section_id
            LEFT JOIN paper_sections parent ON parent.id = section.parent_section_id
            JOIN questions question ON question.id = item.question_id
            WHERE section.paper_id = ? AND section.archived_key = 0
            ORDER BY section.sort_order, item.sort_order, item.id
            """, (resultSet, rowNumber) -> new PublicationQuestion(
                resultSet.getString("part_code"), resultSet.getString("grading_json")), paperId);

        if (questions.isEmpty()) {
            throw conflict("Add at least one question before publishing.");
        }

        boolean hasUnassignedScoredQuestion = questions.stream()
            .filter(question -> isScored(question.gradingJson()))
            .map(PublicationQuestion::partCode)
            .map(this::normalizeCode)
            .anyMatch(code -> !SCORED_PART_CODES.contains(code));
        if (hasUnassignedScoredQuestion) {
            throw conflict("Assign scored questions to ELA or MATH before publishing.");
        }
    }

    private boolean isScored(String gradingJson) {
        if (!StringUtils.hasText(gradingJson)) return true;
        try {
            JsonNode isScored = objectMapper.readTree(gradingJson).path("isScored");
            return !isScored.isBoolean() || isScored.asBoolean();
        } catch (JsonProcessingException exception) {
            return true;
        }
    }

    private String normalizeCode(String code) {
        return code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
    }

    private ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }

    private record PublicationQuestion(String partCode, String gradingJson) {}
}
