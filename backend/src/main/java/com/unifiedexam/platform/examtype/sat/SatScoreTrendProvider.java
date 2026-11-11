package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** SAT 学生个人分数趋势；取数与换算见 {@link SatFamilyScoreTrendProvider}。 */
@Component
public class SatScoreTrendProvider extends SatFamilyScoreTrendProvider {

    public SatScoreTrendProvider(JdbcTemplate jdbc, ObjectMapper mapper) {
        super(jdbc, mapper);
    }

    @Override
    public String examTypeCode() {
        return "SAT";
    }
}
