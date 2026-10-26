package com.unifiedexam.platform.examtype.shsat.admin;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StudentReportSanitizerTest {

    @Test
    void hidesScoresAndQuestionPointsWhenScoreIsNotVisible() {
        Map<String, Object> report = report();
        StudentReportSanitizer.apply(report, false, true, true);
        assertNull(report.get("totalScore"));
        assertNull(question(report).get("score"));
        assertNull(question(report).get("maxScore"));
        assertTrue(question(report).containsKey("correct"));
    }

    @Test
    void hidesCorrectAnswersAndOutcomeMetricsUntilAnswerReviewIsAllowed() {
        Map<String, Object> report = report();
        StudentReportSanitizer.apply(report, true, false, true);
        assertNull(report.get("correctCount"));
        assertEquals(List.of(), report.get("knowledgeBreakdown"));
        assertTrue(question(report).containsKey("answerData"));
        assertFalse(question(report).containsKey("correctAnswerData"));
        assertFalse(question(report).containsKey("correct"));
        assertFalse(question(report).containsKey("score"));
    }

    @Test
    void removesQuestionsWhenReviewIsDisabled() {
        Map<String, Object> report = report();
        report.put("questionCount", 100);
        report.put("answeredCount", 98);
        StudentReportSanitizer.apply(report, true, false, false);
        assertEquals(List.of(), report.get("questions"));
        assertEquals(100, report.get("questionCount"));
        assertEquals(98, report.get("answeredCount"));
    }

    @Test
    void keepsFullReportWhenPoliciesAllowIt() {
        Map<String, Object> report = report();
        StudentReportSanitizer.apply(report, true, true, true);
        assertEquals(37, report.get("totalScore"));
        assertEquals("B", question(report).get("correctAnswer"));
    }

    private Map<String, Object> report() {
        Map<String, Object> question = new LinkedHashMap<>();
        question.put("correctAnswerData", Map.of("answers", List.of("B")));
        question.put("correctAnswer", "B");
        question.put("correct", false);
        question.put("score", 0);
        question.put("maxScore", 1);
        question.put("answerData", "A");
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("totalScore", 37);
        report.put("correctCount", 37);
        report.put("knowledgeBreakdown", List.of(Map.of("correct", 1)));
        report.put("questions", new ArrayList<>(List.of(question)));
        return report;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> question(Map<String, Object> report) {
        return (Map<String, Object>) ((List<?>) report.get("questions")).get(0);
    }
}
