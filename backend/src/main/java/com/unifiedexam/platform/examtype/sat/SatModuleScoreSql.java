package com.unifiedexam.platform.examtype.sat;

/** 学生成绩历史与班级趋势共用的 SAT 模块取分 SQL，按章节元数据兼容迁入的章节编码。 */
public final class SatModuleScoreSql {

    private SatModuleScoreSql() {
    }

    public static String rawScore(String subject, int moduleNumber) {
        if (!"RW".equals(subject) && !"Math".equals(subject)) {
            throw new IllegalArgumentException("Unsupported SAT score subject.");
        }
        if (moduleNumber < 1 || moduleNumber > 2) {
            throw new IllegalArgumentException("Unsupported SAT module number.");
        }
        return """
            (SELECT rb.raw_score FROM paper_sections ps
             JOIN attempt_result_breakdowns rb
               ON rb.attempt_id = a.id AND rb.breakdown_code = ps.section_code
             WHERE ps.paper_id = p.id
               AND JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.subject')) = '%s'
               AND CAST(JSON_UNQUOTE(JSON_EXTRACT(ps.settings_json, '$.moduleNumber')) AS UNSIGNED) = %d
             ORDER BY ps.sort_order, ps.id LIMIT 1)
            """.formatted(subject, moduleNumber);
    }
}
