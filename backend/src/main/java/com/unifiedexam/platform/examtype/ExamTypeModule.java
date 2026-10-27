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

    /** 依据考试类型的题型结构判断答案是否有实质内容。 */
    default boolean hasMeaningfulAnswer(JsonNode answer) {
        return answer != null && !answer.isNull();
    }

    /** 允许题型模块按答案结构判断作答完整度；默认沿用类型级通用判断。 */
    default boolean hasMeaningfulAnswer(String questionTypeCode, JsonNode answer) {
        return hasMeaningfulAnswer(answer);
    }

    /** 只有已完成最小作答链路的类型才会进入学生可作答列表。 */
    default boolean supportsStudentAttempts() {
        return false;
    }

    /** 管理员和教师的练习权限独立于学生正式考试流程，避免未完成的考试类型误入学生端。 */
    default boolean supportsStaffPracticeAttempts() {
        return false;
    }

    /** 在试卷封存或发布前执行类型专属的内容校验。 */
    default void validatePaperForPublication(long paperId) {
        // Most exam types only require the shared READY-state checks.
    }
}
