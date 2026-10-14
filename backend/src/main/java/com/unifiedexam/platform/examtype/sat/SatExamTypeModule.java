package com.unifiedexam.platform.examtype.sat;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import org.springframework.stereotype.Component;

/** 注册 SAT 类型入口；考试流程将在 SAT/PSAT 模块阶段接入。 */
@Component
public class SatExamTypeModule implements ExamTypeModule {

    @Override
    public ExamTypeDefinition definition() {
        return new ExamTypeDefinition("SAT", "SAT", "自适应阅读写作与数学考试", 10);
    }
}
