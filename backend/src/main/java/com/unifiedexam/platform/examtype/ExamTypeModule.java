package com.unifiedexam.platform.examtype;

/** 类型模块的最小注册契约；试卷和考试能力在对应业务接入时再扩充。 */
public interface ExamTypeModule {

    ExamTypeDefinition definition();
}
