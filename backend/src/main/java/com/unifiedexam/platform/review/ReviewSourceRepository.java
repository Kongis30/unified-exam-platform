package com.unifiedexam.platform.review;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.ArrayList;

/** 统一定位班级内的正式作答和复习题；题目使用 paper item ID 标识。 */
@Repository
public class ReviewSourceRepository {
    private final JdbcTemplate jdbc;

    public ReviewSourceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 批量查询同一班级每位学生的最近作答，避免创建任务时逐人查询。 */
    public Map<Long, Long> findLatestAttempts(long examId, long classId) {
        return jdbc.query("""
            SELECT student_user_id, id FROM (
                SELECT a.student_user_id, a.id,
                       ROW_NUMBER() OVER (PARTITION BY a.student_user_id ORDER BY a.attempt_no DESC, a.id DESC) AS row_number_in_class
                FROM attempts a JOIN attempt_classes ac ON ac.attempt_id = a.id AND ac.class_id = ?
                WHERE a.exam_id = ? AND a.is_practice = FALSE AND a.status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')
            ) ranked WHERE row_number_in_class = 1
            """, rs -> {
                Map<Long, Long> result = new LinkedHashMap<>();
                while (rs.next()) result.put(rs.getLong("student_user_id"), rs.getLong("id"));
                return result;
            }, classId, examId);
    }

    /** 批量读取题目并按来源作答分组，题号重复时仍以 paper item ID 区分。 */
    public Map<Long, List<SourceItem>> findReviewItemsByAttempt(List<Long> attemptIds) {
        if (attemptIds.isEmpty()) return Map.of();
        String placeholders = String.join(",", java.util.Collections.nCopies(attemptIds.size(), "?"));
        return jdbc.query("""
            SELECT ai.attempt_id, ai.paper_item_id, pi.display_number
            FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            WHERE ai.attempt_id IN (""" + placeholders + """
            ) AND (aa.paper_item_id IS NULL OR aa.is_correct IS NULL OR aa.is_correct = FALSE)
            ORDER BY ai.attempt_id, ai.served_order, ai.paper_item_id
            """, rs -> {
                Map<Long, List<SourceItem>> result = new LinkedHashMap<>();
                while (rs.next()) result.computeIfAbsent(rs.getLong("attempt_id"), ignored -> new ArrayList<>())
                    .add(new SourceItem(rs.getLong("paper_item_id"), (Integer) rs.getObject("display_number")));
                return result;
            }, attemptIds.toArray());
    }

    public record SourceItem(long paperItemId, Integer displayNumber) { }
}
