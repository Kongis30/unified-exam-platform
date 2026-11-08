package com.unifiedexam.platform.attempt;

import org.springframework.jdbc.core.JdbcTemplate;

/** 固定 SAT/PSAT 作答使用的题目与评分数据，供编辑保存和考试开考共用。 */
public final class SatAttemptQuestionSnapshots {

    private final JdbcTemplate jdbc;

    public SatAttemptQuestionSnapshots(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 在修改整张试卷或共享材料前，补齐该试卷已有答卷的快照。 */
    public void capturePaper(long paperId) {
        capture(null, paperId);
    }

    /** 考试创建 attempt_items 后立即保存其题目快照。 */
    public void captureAttempt(long attemptId) {
        capture(attemptId, null);
    }

    private void capture(Long attemptId, Long paperId) {
        jdbc.update("""
            INSERT IGNORE INTO sat_attempt_question_state (attempt_id, paper_item_id, question_json)
            SELECT a.id, ai.paper_item_id, JSON_OBJECT(
                'questionTypeCode', q.question_type_code, 'payloadSchemaVersion', q.payload_schema_version,
                'stem', q.stem, 'render', q.render_json, 'answerKey', q.answer_key_json,
                'grading', q.grading_json, 'explanation', q.explanation,
                'displayNumber', pi.display_number, 'maxPoints', pi.max_points,
                'sectionId', section.id, 'sectionCode', section.section_code,
                'sectionTitle', section.title, 'sectionSettings', section.settings_json,
                'parentSectionCode', parent.section_code,
                'parentSectionTitle', parent.title,
                'scoringTableCode', settings.scoring_table_code,
                'restTimeSeconds', settings.rest_time_seconds,
                'display', CASE WHEN sm.id IS NULL THEN COALESCE(q.render_json, JSON_OBJECT())
                    ELSE JSON_SET(COALESCE(q.render_json, JSON_OBJECT()), '$.material',
                        JSON_OBJECT('title', sm.title, 'type', sm.material_type,
                            'content', sm.content, 'assetUrl', sm.file_url)) END)
            FROM attempts a
            JOIN attempt_items ai ON ai.attempt_id = a.id
            JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN paper_sections section ON section.id = pi.section_id
            JOIN questions q ON q.id = pi.question_id
            LEFT JOIN paper_sections parent ON parent.id = section.parent_section_id
            LEFT JOIN sat_question_materials sqm ON sqm.question_id = q.id
            LEFT JOIN sat_materials sm ON sm.id = sqm.material_id
            LEFT JOIN sat_paper_settings settings ON settings.paper_id = section.paper_id
            WHERE (? IS NULL OR a.id = ?)
              AND (? IS NULL OR section.paper_id = ?)
            """, attemptId, attemptId, paperId, paperId);
    }
}
