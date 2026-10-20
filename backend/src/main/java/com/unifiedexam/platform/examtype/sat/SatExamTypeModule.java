package com.unifiedexam.platform.examtype.sat;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Locale;

/** 注册 SAT 项目，并将 SAT 系统工作区信息提供给前端目录。 */
@Component
public class SatExamTypeModule implements ExamTypeModule {

    @Override
    public ExamTypeDefinition definition() {
        return new ExamTypeDefinition("SAT", "SAT", "SAT and PSAT assessments", 10, "SAT", "SAT");
    }

    /** SAT/PSAT 练习按原题的正确答案字段评分；其余新题型留给对应模块实现。 */
    @Override
    public Boolean grade(String questionTypeCode, JsonNode answerKey, JsonNode answer) {
        String type = questionTypeCode == null ? "" : questionTypeCode.toUpperCase(Locale.ROOT);
        if (!type.equals("SAT_MULTIPLE_CHOICE") && !type.equals("SAT_FILL_IN_BLANK")) return null;

        JsonNode expected = answerKey == null ? null : answerKey.get("correctAnswer");
        if (expected == null || expected.isNull()) return null;
        JsonNode actual = answer != null && answer.isObject() ? answer.get("value") : answer;
        if (actual == null || actual.isNull()) return false;
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
            value.forEach(item -> values.add(item.asText().trim().toUpperCase(Locale.ROOT)));
            values.sort(String::compareTo);
            return String.join("|", values);
        }
        return value.asText().trim().replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
    }
}
