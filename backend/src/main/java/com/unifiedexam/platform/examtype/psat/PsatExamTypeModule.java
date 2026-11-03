package com.unifiedexam.platform.examtype.psat;

import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.sat.SatExamTypeModule;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

/** 注册独立的 PSAT 工作区，复用 SAT 的答题评分逻辑。 */
@Component
public class PsatExamTypeModule extends SatExamTypeModule {

    public PsatExamTypeModule(ObjectMapper mapper) {
        super(mapper);
    }

    @Override
    public ExamTypeDefinition definition() {
        return new ExamTypeDefinition("PSAT", "PSAT", "PSAT practice and exams", 20, "PSAT", "PSAT");
    }
}
