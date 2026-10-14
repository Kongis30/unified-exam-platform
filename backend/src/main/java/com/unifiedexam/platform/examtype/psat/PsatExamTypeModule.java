package com.unifiedexam.platform.examtype.psat;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import org.springframework.stereotype.Component;

/** 注册 PSAT 类型入口；可共享 SAT/PSAT 的内部实现，类型编码和评分规则仍独立。 */
@Component
public class PsatExamTypeModule implements ExamTypeModule {

    @Override
    public ExamTypeDefinition definition() {
        return new ExamTypeDefinition("PSAT", "PSAT", "PSAT 练习与考试", 20);
    }
}
