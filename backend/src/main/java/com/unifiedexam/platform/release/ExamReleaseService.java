package com.unifiedexam.platform.release;

import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.List;

/** Maintains common exam schedules, targets, and stable student eligibility. */
@Service
public class ExamReleaseService {

    private final JdbcTemplate jdbcTemplate;
    private final ExamTypeRegistry examTypeRegistry;

    public ExamReleaseService(JdbcTemplate jdbcTemplate, ExamTypeRegistry examTypeRegistry) {
        this.jdbcTemplate = jdbcTemplate;
        this.examTypeRegistry = examTypeRegistry;
    }

    @Transactional
    public List<ExamSummary> list(String examTypeCode) {
        closeExpiredPublishedExams();
        return jdbcTemplate.query("""
            SELECT e.id, p.exam_type_code, e.paper_id, p.title AS paper_title, e.title, e.description,
                   e.status, e.target_scope, e.opens_at, e.closes_at,
                   COALESCE(NULLIF(e.duration_seconds, 0), p.default_duration_seconds) AS duration_seconds,
                   e.attempt_limit,
                   e.created_at, e.published_at
            FROM exams e JOIN papers p ON p.id = e.paper_id
            WHERE p.exam_type_code = ? ORDER BY e.created_at DESC, e.id DESC
            """, (rs, rowNum) -> mapSummary(rs), examTypeCode);
    }

    /** 定时关闭已过结束时间的发布，避免历史考试继续显示为已发布。 */
    @Scheduled(fixedDelay = 60_000)
    @Transactional
    public void closeExpiredExams() {
        closeExpiredPublishedExams();
    }

    private void closeExpiredPublishedExams() {
        jdbcTemplate.update("""
            UPDATE exams SET status = 'CLOSED'
            WHERE status = 'PUBLISHED' AND closes_at <= CURRENT_TIMESTAMP(6)
            """);
    }

    @Transactional
    public ExamDetail create(long paperId, ExamRequest request, String actorUsername) {
        ensurePaperExists(paperId);
        requireActiveType(typeCode(paperId));
        validateWindow(request.opensAt(), request.closesAt());
        String targetScope = normalizeTargetScope(request.targetScope());
        Long actorId = jdbcTemplate.query("SELECT id FROM users WHERE username = ? AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getLong(1) : null, actorUsername);
        if (actorId == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Your account is no longer active.");
        jdbcTemplate.update("""
            INSERT INTO exams
                (paper_id, scoring_profile_id, title, description, target_scope, opens_at, closes_at,
                 duration_seconds, attempt_limit, answer_visibility, score_visibility, allow_review, created_by)
            SELECT id, default_scoring_profile_id, ?, ?, ?, ?, ?, ?, ?,
                   IF(exam_type_code IN ('SAT', 'PSAT'), 'AFTER_SUBMIT', 'AFTER_CLOSE'),
                   IF(exam_type_code IN ('SAT', 'PSAT'), 'AFTER_SUBMIT', 'AFTER_CLOSE'),
                   exam_type_code IN ('SAT', 'PSAT'), ?
            FROM papers WHERE id = ?
            """, request.title(), request.description(), targetScope,
            Timestamp.from(request.opensAt().toInstant()), Timestamp.from(request.closesAt().toInstant()),
            resolveDuration(paperId, request.durationSeconds()), request.attemptLimit(), actorId, paperId);
        Long examId = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return get(examId);
    }

    public ExamDetail get(long examId) {
        ExamSummary summary = summary(examId);
        List<Long> classIds = jdbcTemplate.query("SELECT class_id FROM exam_target_classes WHERE exam_id = ? ORDER BY class_id",
            (rs, rowNum) -> rs.getLong(1), examId);
        List<Long> studentIds = jdbcTemplate.query("SELECT student_user_id FROM exam_target_students WHERE exam_id = ? ORDER BY student_user_id",
            (rs, rowNum) -> rs.getLong(1), examId);
        return new ExamDetail(summary, classIds, studentIds);
    }

    @Transactional
    public ExamDetail update(long examId, ExamRequest request) {
        requireDraft(examId);
        validateWindow(request.opensAt(), request.closesAt());
        String targetScope = normalizeTargetScope(request.targetScope());
        jdbcTemplate.update("""
            UPDATE exams SET title = ?, description = ?, target_scope = ?, opens_at = ?, closes_at = ?,
                duration_seconds = ?, attempt_limit = ? WHERE id = ? AND status = 'DRAFT'
            """, request.title(), request.description(), targetScope,
            Timestamp.from(request.opensAt().toInstant()), Timestamp.from(request.closesAt().toInstant()),
            resolveDuration(paperId(examId), request.durationSeconds()), request.attemptLimit(), examId);
        if ("ALL_STUDENTS".equals(targetScope)) {
            jdbcTemplate.update("DELETE FROM exam_target_classes WHERE exam_id = ?", examId);
            jdbcTemplate.update("DELETE FROM exam_target_students WHERE exam_id = ?", examId);
        }
        return get(examId);
    }

    @Transactional
    public ExamDetail saveTargets(long examId, TargetRequest request) {
        requireDraft(examId);
        if ("ALL_STUDENTS".equals(examTargetScope(examId))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This exam targets all active students and does not accept a selected target list.");
        }
        List<Long> classIds = request.classIds().stream().distinct().toList();
        List<Long> studentIds = request.studentUserIds().stream().distinct().toList();
        if (classIds.isEmpty() && studentIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one class or student.");
        }
        for (Long classId : classIds) {
            Boolean active = jdbcTemplate.queryForObject("SELECT EXISTS(SELECT 1 FROM classes WHERE id = ? AND status = 'ACTIVE')", Boolean.class, classId);
            if (!Boolean.TRUE.equals(active)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One or more selected classes are unavailable.");
        }
        for (Long studentId : studentIds) {
            Boolean activeStudent = jdbcTemplate.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM users WHERE id = ? AND role_code = 'STUDENT' AND status = 'ACTIVE')
                """, Boolean.class, studentId);
            if (!Boolean.TRUE.equals(activeStudent)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One or more selected accounts are not active students.");
        }
        jdbcTemplate.update("DELETE FROM exam_target_classes WHERE exam_id = ?", examId);
        jdbcTemplate.update("DELETE FROM exam_target_students WHERE exam_id = ?", examId);
        for (Long classId : classIds) jdbcTemplate.update("INSERT INTO exam_target_classes (exam_id, class_id) VALUES (?, ?)", examId, classId);
        for (Long studentId : studentIds) jdbcTemplate.update("INSERT INTO exam_target_students (exam_id, student_user_id) VALUES (?, ?)", examId, studentId);
        return get(examId);
    }

    @Transactional
    public ExamDetail publish(long examId) {
        String examStatus = jdbcTemplate.query("SELECT status FROM exams WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? rs.getString(1) : null, examId);
        if (examStatus == null) throw notFound();
        if (!"DRAFT".equals(examStatus)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Only draft exams can be published.");
        Boolean expired = jdbcTemplate.queryForObject(
            "SELECT closes_at <= CURRENT_TIMESTAMP(6) FROM exams WHERE id = ?", Boolean.class, examId);
        if (Boolean.TRUE.equals(expired)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The exam closing time must be in the future.");
        }
        jdbcTemplate.query("""
            SELECT c.id FROM classes c JOIN exam_target_classes tc ON tc.class_id = c.id
            WHERE tc.exam_id = ? ORDER BY c.id FOR UPDATE
            """, (rs, rowNum) -> rs.getLong(1), examId);
        Integer archivedTargets = jdbcTemplate.queryForObject("""
            SELECT COUNT(*) FROM exam_target_classes tc JOIN classes c ON c.id = tc.class_id
            WHERE tc.exam_id = ? AND c.status <> 'ACTIVE'
            """, Integer.class, examId);
        if (archivedTargets != null && archivedTargets > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Remove archived classes from the targets before publishing.");
        }
        Long paperId = jdbcTemplate.query("SELECT paper_id FROM exams WHERE id = ?", rs -> rs.next() ? rs.getLong(1) : null, examId);
        requireActiveType(typeCode(paperId));
        String paperStatus = jdbcTemplate.query("SELECT status FROM papers WHERE id = ?", rs -> rs.next() ? rs.getString(1) : null, paperId);
        if (!"READY".equals(paperStatus)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Seal the paper before publishing this exam.");
        }
        String targetScope = examTargetScope(examId);
        Integer targetCount = jdbcTemplate.queryForObject("""
            SELECT (SELECT COUNT(*) FROM exam_target_classes WHERE exam_id = ?) +
                   (SELECT COUNT(*) FROM exam_target_students WHERE exam_id = ?)
            """, Integer.class, examId, examId);
        if (!"ALL_STUDENTS".equals(targetScope) && (targetCount == null || targetCount == 0)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Select at least one class or student before publishing.");
        }
        jdbcTemplate.update("UPDATE exams SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP(6) WHERE id = ?", examId);
        jdbcTemplate.update("""
            INSERT IGNORE INTO exam_participants (exam_id, student_user_id)
            SELECT ?, ts.student_user_id FROM exam_target_students ts
            JOIN users u ON u.id = ts.student_user_id AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
            WHERE ts.exam_id = ?
            UNION
            SELECT ?, cm.student_user_id
            FROM exam_target_classes tc
            JOIN classes c ON c.id = tc.class_id AND c.status = 'ACTIVE'
            JOIN class_memberships cm ON cm.class_id = c.id AND cm.left_at IS NULL
            JOIN users u ON u.id = cm.student_user_id AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
            WHERE tc.exam_id = ?
            """, examId, examId, examId, examId);
        if ("ALL_STUDENTS".equals(targetScope)) {
            jdbcTemplate.update("""
                INSERT IGNORE INTO exam_participants (exam_id, student_user_id)
                SELECT ?, u.id FROM users u
                WHERE u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
                """, examId);
        }
        Integer participantCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM exam_participants WHERE exam_id = ? AND revoked_at IS NULL", Integer.class, examId);
        if (participantCount == null || participantCount == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "No active students match the selected targets.");
        }
        return get(examId);
    }

    @Transactional
    public ExamDetail unpublish(long examId) {
        String status = jdbcTemplate.query("SELECT status FROM exams WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? rs.getString(1) : null, examId);
        if (status == null) throw notFound();
        if (!"PUBLISHED".equals(status)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only published exams can be unpublished.");
        }
        Integer attemptCount = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM attempts WHERE exam_id = ?", Integer.class, examId);
        if (attemptCount != null && attemptCount > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "An exam with student attempts cannot be unpublished.");
        }
        jdbcTemplate.update("DELETE FROM exam_participants WHERE exam_id = ?", examId);
        jdbcTemplate.update("UPDATE exams SET status = 'DRAFT', published_at = NULL WHERE id = ?", examId);
        return get(examId);
    }

    @Transactional
    public void delete(long examId) {
        List<Long> lockedExamIds = jdbcTemplate.query("SELECT id FROM exams WHERE id = ? FOR UPDATE",
            (rs, rowNum) -> rs.getLong(1), examId);
        if (lockedExamIds.isEmpty()) throw notFound();
        jdbcTemplate.update("DELETE FROM shsat_wrong_answer_tasks WHERE exam_id = ?", examId);
        jdbcTemplate.update("DELETE FROM attempts WHERE exam_id = ?", examId);
        jdbcTemplate.update("DELETE FROM exam_participants WHERE exam_id = ?", examId);
        jdbcTemplate.update("DELETE FROM exams WHERE id = ?", examId);
    }

    public List<StudentExamView> listForStudent(String username) {
        Long studentId = jdbcTemplate.query("SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT' AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        if (studentId == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Student account required.");
        return jdbcTemplate.query("""
            SELECT e.id, p.exam_type_code, e.title, e.description, e.opens_at, e.closes_at,
                   p.title AS paper_title,
                   COALESCE(NULLIF(e.duration_seconds, 0), p.default_duration_seconds) AS duration_seconds,
                   e.attempt_limit,
                   (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.student_user_id = ? AND a.status IN ('SUBMITTED','COMPLETED','EXPIRED') AND a.is_practice = FALSE) AS attempts_used,
                   (SELECT MAX(a.id) FROM attempts a WHERE a.exam_id = e.id AND a.student_user_id = ? AND a.status = 'IN_PROGRESS' AND a.is_practice = FALSE) AS active_attempt_id,
                   (SELECT MAX(a.id) FROM attempts a WHERE a.exam_id = e.id AND a.student_user_id = ? AND a.is_practice = FALSE) AS latest_attempt_id
            FROM exam_participants ep JOIN exams e ON e.id = ep.exam_id
            JOIN papers p ON p.id = e.paper_id
            JOIN exam_types et ON et.code = p.exam_type_code AND et.is_active = TRUE
            WHERE ep.student_user_id = ? AND ep.revoked_at IS NULL AND e.status = 'PUBLISHED'
                AND (e.closes_at > CURRENT_TIMESTAMP(6) OR EXISTS (
                    SELECT 1 FROM attempts a WHERE a.exam_id = e.id AND a.student_user_id = ep.student_user_id AND a.is_practice = FALSE
                ))
            ORDER BY e.opens_at, e.id
            """, (rs, rowNum) -> new StudentExamView(rs.getLong("id"), rs.getString("exam_type_code"),
                rs.getString("title"), rs.getString("description"), rs.getTimestamp("opens_at").toInstant().toString(),
                rs.getTimestamp("closes_at").toInstant().toString(), rs.getString("paper_title"),
                nullableInt(rs, "duration_seconds"), rs.getInt("attempt_limit"), rs.getInt("attempts_used"),
                nullableLong(rs, "active_attempt_id"), nullableLong(rs, "latest_attempt_id")),
            studentId, studentId, studentId, studentId).stream()
            .filter(exam -> examTypeRegistry.module(exam.examTypeCode())
                .map(module -> module.supportsStudentAttempts()).orElse(false))
            .toList();
    }

    private ExamSummary summary(long examId) {
        List<ExamSummary> result = jdbcTemplate.query("""
            SELECT e.id, p.exam_type_code, e.paper_id, p.title AS paper_title, e.title, e.description,
                   e.status, e.target_scope, e.opens_at, e.closes_at,
                   COALESCE(NULLIF(e.duration_seconds, 0), p.default_duration_seconds) AS duration_seconds,
                   e.attempt_limit,
                   e.created_at, e.published_at
            FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ?
            """, (rs, rowNum) -> mapSummary(rs), examId);
        if (result.isEmpty()) throw notFound();
        return result.get(0);
    }

    private ExamSummary mapSummary(java.sql.ResultSet rs) throws java.sql.SQLException {
        Timestamp publishedAt = rs.getTimestamp("published_at");
        return new ExamSummary(rs.getLong("id"), rs.getString("exam_type_code"), rs.getLong("paper_id"),
            rs.getString("paper_title"), rs.getString("title"), rs.getString("description"), rs.getString("status"),
            rs.getString("target_scope"), rs.getTimestamp("opens_at").toInstant().toString(),
            rs.getTimestamp("closes_at").toInstant().toString(), nullableInt(rs, "duration_seconds"),
            rs.getInt("attempt_limit"), rs.getTimestamp("created_at").toInstant().toString(),
            publishedAt == null ? null : publishedAt.toInstant().toString());
    }

    private void ensurePaperExists(long paperId) {
        Boolean exists = jdbcTemplate.queryForObject("SELECT EXISTS(SELECT 1 FROM papers WHERE id = ?)", Boolean.class, paperId);
        if (!Boolean.TRUE.equals(exists)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Paper not found.");
    }

    private String typeCode(long paperId) {
        String code = jdbcTemplate.query("SELECT exam_type_code FROM papers WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, paperId);
        if (code == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Paper not found.");
        return code;
    }

    private long paperId(long examId) {
        Long id = jdbcTemplate.query("SELECT paper_id FROM exams WHERE id = ?",
            rs -> rs.next() ? rs.getLong(1) : null, examId);
        if (id == null) throw notFound();
        return id;
    }

    private Integer resolveDuration(long paperId, Integer requestedDuration) {
        if (requestedDuration != null) return requestedDuration;
        return jdbcTemplate.query("SELECT default_duration_seconds FROM papers WHERE id = ?",
            rs -> rs.next() ? nullableInt(rs, "default_duration_seconds") : null, paperId);
    }

    private Long nullableLong(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).longValue();
    }

    private Integer nullableInt(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).intValue();
    }

    private void requireActiveType(String code) {
        boolean installed = examTypeRegistry.listAvailableTypes().stream().anyMatch(type -> type.code().equals(code));
        Boolean active = jdbcTemplate.queryForObject("SELECT is_active FROM exam_types WHERE code = ?", Boolean.class, code);
        if (!installed || !Boolean.TRUE.equals(active)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "This exam type is unavailable.");
        }
    }

    private String examTargetScope(long examId) {
        String scope = jdbcTemplate.query("SELECT target_scope FROM exams WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, examId);
        if (scope == null) throw notFound();
        return scope;
    }

    private String normalizeTargetScope(String scope) {
        String normalized = scope == null ? "SELECTED" : scope.trim().toUpperCase(java.util.Locale.ROOT);
        if (!"SELECTED".equals(normalized) && !"ALL_STUDENTS".equals(normalized)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose selected students or all active students.");
        }
        return normalized;
    }

    private void requireDraft(long examId) {
        String status = jdbcTemplate.query("SELECT status FROM exams WHERE id = ?", rs -> rs.next() ? rs.getString(1) : null, examId);
        if (status == null) throw notFound();
        if (!"DRAFT".equals(status)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Only draft exams can be changed.");
    }

    private void validateWindow(OffsetDateTime opensAt, OffsetDateTime closesAt) {
        if (!closesAt.isAfter(opensAt)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The closing time must be after the opening time.");
    }

    private ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Exam not found.");
    }

    public record ExamRequest(@NotBlank @Size(max = 200) String title, @Size(max = 2000) String description,
                              @NotNull OffsetDateTime opensAt, @NotNull OffsetDateTime closesAt,
                              @Positive Integer durationSeconds, @NotNull @Positive Integer attemptLimit,
                              String targetScope) { }
    public record TargetRequest(@NotNull List<@Positive Long> classIds,
                                @NotNull List<@Positive Long> studentUserIds) { }
    public record ExamSummary(long id, String examTypeCode, long paperId, String paperTitle, String title,
                              String description, String status, String targetScope, String opensAt,
                              String closesAt, Integer durationSeconds, int attemptLimit,
                              String createdAt, String publishedAt) { }
    public record ExamDetail(ExamSummary summary, List<Long> classIds, List<Long> studentUserIds) { }
    public record StudentExamView(long id, String examTypeCode, String title, String description,
                                  String opensAt, String closesAt, String paperTitle,
                                  Integer durationSeconds, int attemptLimit, int attemptsUsed, Long activeAttemptId,
                                  Long latestAttemptId) { }
}
