package com.unifiedexam.platform.examtype.shsat;

import com.fasterxml.jackson.databind.JsonNode;
import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** 注册新版 SHSAT 类型入口；题型和考试流程由 SHSAT 模块独立维护。 */
@Component
public class ShsatExamTypeModule implements ExamTypeModule {

    private final ShsatQuestionGrader questionGrader;

    @Autowired
    public ShsatExamTypeModule(ShsatQuestionGrader questionGrader) {
        this.questionGrader = questionGrader;
    }

    @Override
    public ExamTypeDefinition definition() {
        return new ExamTypeDefinition("SHSAT", "SHSAT", "Structured question types and a dedicated exam flow", 30,
                "SHSAT", "SHSAT");
    }

    @Override
    public Boolean grade(String questionTypeCode, JsonNode answerKey, JsonNode answer) {
        return questionGrader.grade(questionTypeCode, answerKey, answer, null, null);
    }

    @Override
    public Boolean grade(String questionTypeCode, JsonNode answerKey, JsonNode answer, JsonNode render, JsonNode grading) {
        return questionGrader.grade(questionTypeCode, answerKey, answer, render, grading);
    }

    @Override
    public boolean supportsStudentAttempts() {
        return true;
    }

}
