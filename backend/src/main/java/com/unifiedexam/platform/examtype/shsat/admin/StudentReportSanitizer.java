package com.unifiedexam.platform.examtype.shsat.admin;

import java.util.List;
import java.util.Map;

final class StudentReportSanitizer {

    private StudentReportSanitizer() { }

    static void apply(Map<String, Object> report, boolean scoreVisible, boolean answersVisible, boolean allowReview) {
        if (!scoreVisible) {
            for (String field : List.of("totalScore", "totalMaxScore", "rawTotalScore", "elaRawScore", "mathRawScore",
                    "elaScaledScore", "mathScaledScore", "elaRawMaxScore", "mathRawMaxScore", "section1Score",
                    "section2Score", "section1ScaledScore", "section2ScaledScore", "elaScaledMaxScore",
                    "mathScaledMaxScore", "compositeScore", "compositeMaxScore", "totalScaledScore",
                    "totalScaledMaxScore", "correctCount", "wrongCount", "accuracy", "estimated", "scoringMode")) {
                report.put(field, null);
            }
            removeQuestionFields(report, List.of("score", "maxScore"));
        }
        if (!answersVisible) {
            report.put("correctCount", null);
            report.put("wrongCount", null);
            report.put("accuracy", null);
            report.put("knowledgeBreakdown", List.of());
            Object rawQuestions = report.get("questions");
            if (!allowReview || !(rawQuestions instanceof List<?>)) {
                report.put("questions", List.of());
            } else {
                // 答案可见策略控制逐题对错与得分；允许复习时仍应返回标准答案供学生核对。
                removeQuestionFields(report, List.of("correct", "score"));
            }
        }
    }

    private static void removeQuestionFields(Map<String, Object> report, List<String> hiddenFields) {
        Object rawQuestions = report.get("questions");
        if (!(rawQuestions instanceof List<?> questions)) return;
        for (Object rawQuestion : questions) {
            if (rawQuestion instanceof Map<?, ?> question) {
                question.keySet().removeIf(hiddenFields::contains);
            }
        }
    }
}
