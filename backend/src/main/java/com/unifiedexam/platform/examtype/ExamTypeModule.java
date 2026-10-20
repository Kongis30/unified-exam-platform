package com.unifiedexam.platform.examtype;

import com.fasterxml.jackson.databind.JsonNode;

/** 类型模块的最小注册契约；试卷和考试能力在对应业务接入时再扩充。 */
public interface ExamTypeModule {

    ExamTypeDefinition definition();

    /** 类型模块按自己的题型语义评分；null 表示该题型暂不支持自动评分。 */
    default Boolean grade(String questionTypeCode, JsonNode answerKey, JsonNode answer) {
        return null;
    }

    /** 提供展示配置与评分规则，使复杂题型可依其结构评分；旧类型仍使用三参数契约。 */
    default Boolean grade(String questionTypeCode, JsonNode answerKey, JsonNode answer,
                          JsonNode render, JsonNode grading) {
        return grade(questionTypeCode, answerKey, answer);
    }

    /** 只有已完成最小作答链路的类型才会进入学生可作答列表。 */
    default boolean supportsStudentAttempts() {
        return false;
    }

    /** 管理员和教师的练习权限独立于学生正式考试流程，避免未完成的考试类型误入学生端。 */
    default boolean supportsStaffPracticeAttempts() {
        return false;
    }
}
