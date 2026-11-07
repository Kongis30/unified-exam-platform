package com.unifiedexam.platform.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.unifiedexam.platform.attempt.SatStudentAttemptService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** 复习报告复用 SAT 报告内容，但先校验任务所属模块及学生身份。 */
@Service
public class ReviewReportService {
    private final JdbcTemplate jdbc;
    private final SatStudentAttemptService reports;

    public ReviewReportService(JdbcTemplate jdbc, SatStudentAttemptService reports) {
        this.jdbc = jdbc;
        this.reports = reports;
    }

    public JsonNode studentReport(String type, long assignmentId, String username) {
        return reports.report(latestAttempt(type, assignmentId, username), username);
    }

    public JsonNode staffReport(String type, long assignmentId) {
        return reports.reportForStaff(latestAttempt(type, assignmentId, null));
    }

    private long latestAttempt(String type, long assignmentId, String username) {
        if (!"SAT".equals(type) && !"PSAT".equals(type)) throw notFound();
        Long attempt = jdbc.query("""
            SELECT r.attempt_id FROM review_assignments a
            JOIN review_tasks t ON t.id = a.task_id JOIN users u ON u.id = a.student_user_id
            JOIN review_practice_rounds r ON r.assignment_id = a.id JOIN attempts p ON p.id = r.attempt_id
            WHERE a.id = ? AND t.exam_type_code = ? AND p.status = 'SUBMITTED'
              AND (? IS NULL OR (u.username = ? AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE'))
            ORDER BY r.id DESC LIMIT 1
            """, rs -> rs.next() ? rs.getLong(1) : null, assignmentId, type, username, username);
        if (attempt == null) throw notFound();
        return attempt;
    }

    private ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Review report not found.");
    }
}
