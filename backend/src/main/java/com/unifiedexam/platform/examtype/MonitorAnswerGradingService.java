package com.unifiedexam.platform.examtype;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

/** Monitor 统计前补齐已保存答案的评分，使各模块与 SHSAT V2 的展示时机一致。 */
@Service
public class MonitorAnswerGradingService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ExamTypeRegistry registry;

    public MonitorAnswerGradingService(JdbcTemplate jdbc, ObjectMapper mapper, ExamTypeRegistry registry) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.registry = registry;
    }

    /** 仅处理已开始正式考试中有实际答案且尚未评分的题目；重复读取不会重复计分。 */
    @Transactional
    public void gradePendingAnswers(long examId, String examTypeCode) {
        var module = registry.module(examTypeCode).orElse(null);
        if (module == null) return;
        var answers = jdbc.query("""
            SELECT aa.attempt_id, aa.paper_item_id, aa.answer_json, q.question_type_code,
                   q.answer_key_json, q.render_json, q.grading_json, pi.max_points
            FROM attempt_answers aa
            JOIN attempts a ON a.id = aa.attempt_id
            JOIN exams e ON e.id = a.exam_id
            JOIN paper_items pi ON pi.id = aa.paper_item_id
            JOIN questions q ON q.id = pi.question_id
            WHERE a.exam_id = ? AND e.exam_type_code = ? AND a.is_practice = FALSE
              AND a.status NOT IN ('NOT_STARTED', 'CANCELLED') AND aa.is_correct IS NULL
            ORDER BY aa.attempt_id, aa.paper_item_id
            """, (rs, row) -> new PendingAnswer(rs.getLong("attempt_id"), rs.getLong("paper_item_id"),
                readJson(rs.getString("answer_json")), rs.getString("question_type_code"),
                readJson(rs.getString("answer_key_json")), readNullableJson(rs.getString("render_json")),
                readNullableJson(rs.getString("grading_json")), rs.getBigDecimal("max_points")), examId, examTypeCode);
        for (PendingAnswer answer : answers) {
            if (!module.hasMeaningfulAnswer(answer.questionType(), answer.answer())) continue;
            Boolean correct = module.grade(answer.questionType(), answer.answerKey(), answer.answer(), answer.render(), answer.grading());
            if (correct == null) continue;
            BigDecimal points = correct ? answer.maxPoints() : BigDecimal.ZERO;
            jdbc.update("""
                UPDATE attempt_answers SET is_correct = ?, awarded_points = ?
                WHERE attempt_id = ? AND paper_item_id = ? AND is_correct IS NULL
                """, correct, points, answer.attemptId(), answer.paperItemId());
        }
    }

    private JsonNode readJson(String value) {
        try { return mapper.readTree(value); }
        catch (Exception exception) { return mapper.nullNode(); }
    }

    private JsonNode readNullableJson(String value) {
        return value == null ? null : readJson(value);
    }

    private record PendingAnswer(long attemptId, long paperItemId, JsonNode answer, String questionType,
                                 JsonNode answerKey, JsonNode render, JsonNode grading, BigDecimal maxPoints) { }
}
