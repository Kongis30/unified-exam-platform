package com.unifiedexam.platform.examtype.psat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.examtype.sat.SatFamilyScoreTrendProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * PSAT 学生个人分数趋势。
 *
 * <p>试卷结构与换算表与 SAT 一致（换算差异由 {@code scoring_table_code = PSAT} 决定，
 * 满分 1520），因此复用 SAT 模块的共享实现，只声明自己的类型编码。
 * 与 {@code PsatExamTypeModule} 的继承方式保持一致。
 */
@Component
public class PsatScoreTrendProvider extends SatFamilyScoreTrendProvider {

    public PsatScoreTrendProvider(JdbcTemplate jdbc, ObjectMapper mapper) {
        super(jdbc, mapper);
    }

    @Override
    public String examTypeCode() {
        return "PSAT";
    }
}
