package com.unifiedexam.platform.examtype.psat;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.sat.SatExamTypeModule;
import org.springframework.stereotype.Component;

/** 注册 SAT 工作区中的 PSAT 项目；数据编码和评分规则保持独立。 */
@Component
public class PsatExamTypeModule extends SatExamTypeModule {

    @Override
    public ExamTypeDefinition definition() {
        return new ExamTypeDefinition("PSAT", "PSAT", "PSAT practice and exams", 20, "SAT", "SAT");
    }
}
