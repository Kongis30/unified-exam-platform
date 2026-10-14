package com.unifiedexam.platform.examtype;

/** 前后端共用的考试类型目录字段；业务规则由各类型模块单独实现。 */
public record ExamTypeDefinition(
        String code,
        String displayName,
        String summary,
        int sortOrder
) {
}
