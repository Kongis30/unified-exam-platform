package com.unifiedexam.platform.examtype.sat;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** 注册 SAT 项目，并将 SAT 系统工作区信息提供给前端目录。 */
@Component
public class SatExamTypeModule implements ExamTypeModule {
    private final ObjectMapper mapper;

    public SatExamTypeModule(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public ExamTypeDefinition definition() {
        return new ExamTypeDefinition("SAT", "SAT", "SAT and PSAT assessments", 10, "SAT", "SAT");
    }

    /** SAT/PSAT 正式考试与练习复用原答案字段评分；其余新题型留给对应模块实现。 */
    @Override
    public Boolean grade(String questionTypeCode, JsonNode answerKey, JsonNode answer) {
        String type = questionTypeCode == null ? "" : questionTypeCode.toUpperCase(Locale.ROOT);
        if (!type.equals("SAT_MULTIPLE_CHOICE") && !type.equals("SAT_FILL_IN_BLANK")) return null;

        JsonNode expected = answerKey == null ? null : answerKey.get("correctAnswer");
        if (expected == null || expected.isNull()) return null;
        JsonNode actual = answer != null && answer.isObject() ? answer.get("value") : answer;
        if (actual == null || actual.isNull()) return false;

        if (type.equals("SAT_FILL_IN_BLANK")) {
            List<String> acceptedAnswers = acceptedFillInAnswers(expected);
            if (acceptedAnswers.isEmpty()) return null;
            String response = normalizeScalar(actual);
            return !response.isEmpty() && acceptedAnswers.contains(response);
        }
        return normalize(expected).equals(normalize(actual));
    }

    @Override
    public boolean supportsStaffPracticeAttempts() {
        return true;
    }

    @Override
    public boolean supportsStudentAttempts() {
        return true;
    }

    private String normalize(JsonNode value) {
        if (value.isArray()) {
            ArrayList<String> values = new ArrayList<>();
            value.forEach(item -> values.add(normalizeScalar(item)));
            values.sort(String::compareTo);
            return String.join("|", values);
        }
        return normalizeScalar(value);
    }

    private List<String> acceptedFillInAnswers(JsonNode expected) {
        JsonNode alternatives = expected;
        if (expected.isTextual()) {
            String text = expected.asText().trim();
            if (text.startsWith("[") && text.endsWith("]")) {
                try {
                    JsonNode parsed = mapper.readTree(text);
                    if (parsed != null && parsed.isArray()) alternatives = parsed;
                } catch (JsonProcessingException ignored) {
                    // Treat malformed legacy data as one literal answer instead of failing exam submission.
                }
            }
        }
        if (alternatives.isArray()) {
            List<String> values = new ArrayList<>();
            alternatives.forEach(value -> {
                String normalized = normalizeScalar(value);
                if (!normalized.isEmpty()) values.add(normalized);
            });
            return values;
        }
        String normalized = normalizeScalar(alternatives);
        return normalized.isEmpty() ? List.of() : List.of(normalized);
    }

    private String normalizeScalar(JsonNode value) {
        return value.asText().trim().replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
    }
}
