package com.unifiedexam.platform.examtype.shsat;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import org.springframework.stereotype.Component;

/** 注册新版 SHSAT 类型入口；题型和考试流程由 SHSAT 模块独立维护。 */
@Component
public class ShsatExamTypeModule implements ExamTypeModule {

    @Override
    public ExamTypeDefinition definition() {
        return new ExamTypeDefinition("SHSAT", "SHSAT", "结构化题型与独立考试流程", 30);
    }
}
