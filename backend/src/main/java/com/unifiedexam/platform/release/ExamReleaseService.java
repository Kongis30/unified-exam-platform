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
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;

/** Maintains common exam schedules, targets, and stable student eligibility. */
@Service
public class ExamReleaseService {

    private static final int SHSAT_DESCRIPTION_MAX_LENGTH = 500;
    private static final Instant MIN_DATABASE_INSTANT = Instant.parse("1000-01-01T00:00:00Z");
    private static final Instant MAX_DATABASE_INSTANT = Instant.parse("9999-12-31T23:59:59.999999Z");
    private static final String TARGET_SUMMARY_PROJECTION = """
        CASE WHEN e.target_scope = 'ALL_STUDENTS' THEN 'All students'
             ELSE COALESCE(NULLIF(CONCAT_WS(' · ',
                 (SELECT CASE WHEN COUNT(*) > 0 THEN CONCAT('Classes: ', GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ')) END
                  FROM exam_target_classes tc JOIN classes c ON c.id = tc.class_id WHERE tc.exam_id = e.id),
                 (SELECT CASE WHEN COUNT(*) > 0 THEN CONCAT('Students: ', GROUP_CONCAT(COALESCE(NULLIF(u.real_name, ''), u.username) ORDER BY COALESCE(NULLIF(u.real_name, ''), u.username) SEPARATOR ', ')) END
                  FROM exam_target_students ts JOIN users u ON u.id = ts.student_user_id WHERE ts.exam_id = e.id)
             ), ''), 'No students selected') END AS target_summary
        """;

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
                   e.attempt_limit, e.allow_review, e.auto_submit,
                   EXISTS(SELECT 1 FROM attempts a WHERE a.exam_id = e.id AND a.is_practice = FALSE) AS has_student_attempts,
                   e.created_at, e.updated_at, e.published_at,
                   %s
            FROM exams e JOIN papers p ON p.id = e.paper_id
            WHERE p.exam_type_code = ? AND e.release_hidden_at IS NULL AND NOT EXISTS (
                SELECT 1 FROM sat_practice_papers spp WHERE spp.practice_exam_id = e.id
            ) AND NOT EXISTS (
                SELECT 1 FROM sat_practice_paper_templates spt WHERE spt.practice_exam_id = e.id
            ) ORDER BY e.created_at DESC, e.id DESC
            """.formatted(TARGET_SUMMARY_PROJECTION), (rs, rowNum) -> mapSummary(rs), examTypeCode);
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
        String examTypeCode = typeCode(paperId);
        requireActiveType(examTypeCode);
        validateDescriptionLength(examTypeCode, request.description());
        validateWindow(request.opensAt(), request.closesAt());
        String targetScope = normalizeTargetScope(request.targetScope());
        if ("ALL_STUDENTS".equals(targetScope)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select classes or students within a class.");
        }
        Long actorId = jdbcTemplate.query("SELECT id FROM users WHERE username = ? AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getLong(1) : null, actorUsername);
        if (actorId == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Your account is no longer active.");
        jdbcTemplate.update("""
            INSERT INTO exams
                (paper_id, scoring_profile_id, title, description, target_scope, opens_at, closes_at,
                 duration_seconds, attempt_limit, answer_visibility, score_visibility, allow_review, auto_submit, created_by)
            SELECT id, default_scoring_profile_id, ?, ?, ?, ?, ?, ?, ?,
                   IF(exam_type_code IN ('SAT', 'PSAT', 'SHSAT'), 'AFTER_SUBMIT', 'AFTER_CLOSE'),
                   IF(exam_type_code IN ('SAT', 'PSAT', 'SHSAT'), 'AFTER_SUBMIT', 'AFTER_CLOSE'),
                   CASE WHEN exam_type_code = 'SHSAT' THEN TRUE
                        ELSE COALESCE(?, exam_type_code IN ('SAT', 'PSAT')) END,
                   COALESCE(?, TRUE), ?
            FROM papers WHERE id = ?
            """, request.title(), request.description(), targetScope,
            Timestamp.from(request.opensAt().toInstant()), Timestamp.from(request.closesAt().toInstant()),
            resolveDuration(paperId, request.durationSeconds()), request.attemptLimit(), request.allowReview(),
            request.autoSubmit(), actorId, paperId);
        Long examId = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return get(examId);
    }

    public ExamDetail get(long examId) {
        ExamSummary summary = summary(examId);
        List<Long> classIds = jdbcTemplate.query("SELECT class_id FROM exam_target_classes WHERE exam_id = ? ORDER BY class_id",
            (rs, rowNum) -> rs.getLong(1), examId);
        List<Long> studentIds = jdbcTemplate.query("SELECT student_user_id FROM exam_target_students WHERE exam_id = ? ORDER BY student_user_id",
            (rs, rowNum) -> rs.getLong(1), examId);
        List<StudentClassTarget> studentTargets = jdbcTemplate.query("""
            SELECT class_id, student_user_id FROM exam_target_student_classes
            WHERE exam_id = ? ORDER BY class_id, student_user_id
            """, (rs, rowNum) -> new StudentClassTarget(rs.getLong("class_id"), rs.getLong("student_user_id")), examId);
        return new ExamDetail(summary, classIds, studentIds, studentTargets);
    }

    @Transactional
    public ExamDetail update(long examId, ExamRequest request) {
        requireDraft(examId);
        long targetPaperId = paperId(examId);
        validateDescriptionLength(typeCode(targetPaperId), request.description());
        validateWindow(request.opensAt(), request.closesAt());
        String targetScope = normalizeTargetScope(request.targetScope());
        if ("ALL_STUDENTS".equals(targetScope) && !"ALL_STUDENTS".equals(examTargetScope(examId))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select classes or students within a class.");
        }
        jdbcTemplate.update("""
            UPDATE exams SET title = ?, description = ?, target_scope = ?, opens_at = ?, closes_at = ?,
                duration_seconds = ?, attempt_limit = ?, allow_review = CASE WHEN ? = 'SHSAT' THEN TRUE
                    ELSE COALESCE(?, allow_review) END,
                auto_submit = COALESCE(?, auto_submit) WHERE id = ? AND status = 'DRAFT'
            """, request.title(), request.description(), targetScope,
            Timestamp.from(request.opensAt().toInstant()), Timestamp.from(request.closesAt().toInstant()),
            resolveDuration(targetPaperId, request.durationSeconds()), request.attemptLimit(),
            typeCode(targetPaperId), request.allowReview(), request.autoSubmit(), examId);
        if ("ALL_STUDENTS".equals(targetScope)) {
            jdbcTemplate.update("DELETE FROM exam_target_classes WHERE exam_id = ?", examId);
            jdbcTemplate.update("DELETE FROM exam_target_students WHERE exam_id = ?", examId);
            jdbcTemplate.update("DELETE FROM exam_target_student_classes WHERE exam_id = ?", examId);
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
        List<StudentClassTarget> studentTargets = request.studentTargets() == null ? List.of() : request.studentTargets().stream().distinct().toList();
        List<Long> studentIds = java.util.stream.Stream.concat(request.studentUserIds().stream(), studentTargets.stream().map(StudentClassTarget::studentId)).distinct().toList();
        if (studentIds.stream().anyMatch(id -> studentTargets.stream().noneMatch(target -> target.studentId() == id))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a source class for every selected student.");
        }
        if (classIds.isEmpty() && studentIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select at least one class or student.");
        }
        for (Long classId : classIds) {
            Boolean active = jdbcTemplate.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM classes c
                    JOIN class_exam_workspaces cw ON cw.class_id = c.id
                    JOIN exams e ON e.id = ? JOIN papers p ON p.id = e.paper_id
                    WHERE c.id = ? AND c.status = 'ACTIVE' AND cw.exam_type_code = p.exam_type_code)
                """, Boolean.class, examId, classId);
            if (!Boolean.TRUE.equals(active)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One or more selected classes are unavailable.");
        }
        for (Long studentId : studentIds) {
            Boolean activeStudent = jdbcTemplate.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM users WHERE id = ? AND role_code = 'STUDENT' AND status = 'ACTIVE')
                """, Boolean.class, studentId);
            if (!Boolean.TRUE.equals(activeStudent)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One or more selected accounts are not active students.");
        }
        for (StudentClassTarget target : studentTargets) {
            Boolean valid = jdbcTemplate.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM class_memberships cm
                    JOIN classes c ON c.id = cm.class_id AND c.status = 'ACTIVE'
                    JOIN class_exam_workspaces cw ON cw.class_id = c.id
                    JOIN exams e ON e.id = ? JOIN papers p ON p.id = e.paper_id AND p.exam_type_code = cw.exam_type_code
                    WHERE cm.class_id = ? AND cm.student_user_id = ? AND cm.left_at IS NULL)
                """, Boolean.class, examId, target.classId(), target.studentId());
            if (!Boolean.TRUE.equals(valid)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One or more selected students are unavailable in the chosen class.");
        }
        jdbcTemplate.update("DELETE FROM exam_target_classes WHERE exam_id = ?", examId);
        jdbcTemplate.update("DELETE FROM exam_target_students WHERE exam_id = ?", examId);
        jdbcTemplate.update("DELETE FROM exam_target_student_classes WHERE exam_id = ?", examId);
        for (Long classId : classIds) {
            jdbcTemplate.update("DELETE FROM exam_excluded_classes WHERE exam_id = ? AND class_id = ?", examId, classId);
            jdbcTemplate.update("INSERT INTO exam_target_classes (exam_id, class_id) VALUES (?, ?)", examId, classId);
        }
        for (Long studentId : studentIds) jdbcTemplate.update("INSERT INTO exam_target_students (exam_id, student_user_id) VALUES (?, ?)", examId, studentId);
        for (StudentClassTarget target : studentTargets) {
            jdbcTemplate.update("DELETE FROM exam_excluded_classes WHERE exam_id = ? AND class_id = ?", examId, target.classId());
            jdbcTemplate.update("INSERT INTO exam_target_student_classes (exam_id, student_user_id, class_id) VALUES (?, ?, ?)", examId, target.studentId(), target.classId());
        }
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
        if ("ARCHIVED".equals(paperStatus)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Restore the archived paper before publishing this exam.");
        }
        Boolean hasQuestions = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM paper_items item JOIN paper_sections section ON section.id = item.section_id
                WHERE section.paper_id = ? AND section.archived_key = 0)
            """, Boolean.class, paperId);
        if (!Boolean.TRUE.equals(hasQuestions)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Add at least one question before publishing this exam.");
        }
        examTypeRegistry.validatePaperForPublication(typeCode(paperId), paperId);
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
        jdbcTemplate.update("""
            INSERT IGNORE INTO exam_participant_classes (exam_id, student_user_id, class_id)
            SELECT tc.exam_id, cm.student_user_id, tc.class_id
            FROM exam_target_classes tc JOIN class_memberships cm ON cm.class_id = tc.class_id AND cm.left_at IS NULL
            JOIN users u ON u.id = cm.student_user_id AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
            WHERE tc.exam_id = ?
            UNION
            SELECT ts.exam_id, ts.student_user_id, ts.class_id FROM exam_target_student_classes ts
            JOIN users u ON u.id = ts.student_user_id AND u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
            WHERE ts.exam_id = ?
            """, examId, examId);
        if ("ALL_STUDENTS".equals(targetScope)) {
            jdbcTemplate.update("""
                INSERT IGNORE INTO exam_participants (exam_id, student_user_id)
                SELECT ?, u.id FROM users u
                WHERE u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
                  AND (NOT EXISTS (SELECT 1 FROM exam_excluded_classes excluded JOIN class_memberships cm
                                   ON cm.class_id = excluded.class_id AND cm.left_at IS NULL
                                   WHERE excluded.exam_id = ? AND cm.student_user_id = u.id)
                       OR EXISTS (SELECT 1 FROM exams e JOIN papers p ON p.id = e.paper_id
                                  JOIN class_exam_workspaces cw ON cw.exam_type_code = p.exam_type_code
                                  JOIN class_memberships cm ON cm.class_id = cw.class_id AND cm.left_at IS NULL
                                  WHERE e.id = ? AND cm.student_user_id = u.id
                                    AND NOT EXISTS (SELECT 1 FROM exam_excluded_classes excluded
                                                    WHERE excluded.exam_id = e.id AND excluded.class_id = cw.class_id)))
                """, examId, examId, examId);
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
        requireManageableExam(examId);
        String status = jdbcTemplate.query("SELECT status FROM exams WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? rs.getString(1) : null, examId);
        if (status == null) throw notFound();
        if (!"PUBLISHED".equals(status)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only published exams can be unpublished.");
        }
        // 正式和练习答题都会引用参与者，撤回时保留所有已有答题记录的参与者。
        jdbcTemplate.update("""
            DELETE FROM exam_participants ep
            WHERE ep.exam_id = ? AND NOT EXISTS (
                SELECT 1 FROM attempts a
                WHERE a.exam_id = ep.exam_id AND a.student_user_id = ep.student_user_id
            )
            """, examId);
        jdbcTemplate.update("UPDATE exams SET status = 'DRAFT', published_at = NULL WHERE id = ?", examId);
        return get(examId);
    }

    /** 由后台提前结束已发布场次；学生不能再开考，进行中的尝试仍可正常提交。 */
    @Transactional
    public ExamDetail close(long examId) {
        requireManageableExam(examId);
        String status = jdbcTemplate.query("SELECT status FROM exams WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? rs.getString(1) : null, examId);
        if (status == null) throw notFound();
        if (!"PUBLISHED".equals(status)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only published exams can be ended.");
        }
        jdbcTemplate.update("UPDATE exams SET status = 'CLOSED', closes_at = CURRENT_TIMESTAMP(6) WHERE id = ?", examId);
        return get(examId);
    }

    @Transactional
    public void hideFromReleaseList(long examId) {
        requireManageableExam(examId);
        Long locked = jdbcTemplate.query("SELECT id FROM exams WHERE id = ? FOR UPDATE", rs -> rs.next() ? rs.getLong(1) : null, examId);
        if (locked == null) throw notFound();
        jdbcTemplate.update("UPDATE exams SET release_hidden_at = COALESCE(release_hidden_at, CURRENT_TIMESTAMP(6)) WHERE id = ?", examId);
    }

    /** 移除一个班的考试和其专属作答；仍被其他班引用的作答和资格必须保留。 */
    @Transactional
    public void deleteClassExam(long classId, long examId) {
        requireManageableExam(examId);
        Long locked = jdbcTemplate.query("SELECT id FROM exams WHERE id = ? FOR UPDATE", rs -> rs.next() ? rs.getLong(1) : null, examId);
        if (locked == null) throw notFound();
        Boolean linked = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM exam_target_classes WHERE exam_id = ? AND class_id = ?)
                OR EXISTS(SELECT 1 FROM exam_participant_classes WHERE exam_id = ? AND class_id = ?)
                OR EXISTS(SELECT 1 FROM exam_target_student_classes WHERE exam_id = ? AND class_id = ?)
                OR EXISTS(SELECT 1 FROM attempts a JOIN attempt_classes ac ON ac.attempt_id = a.id
                          WHERE a.exam_id = ? AND ac.class_id = ? AND a.is_practice = FALSE)
            """, Boolean.class, examId, classId, examId, classId, examId, classId, examId, classId);
        if (!Boolean.TRUE.equals(linked)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Exam not found for this class.");

        Boolean unattributed = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM attempts a
                          WHERE a.exam_id = ? AND a.is_practice = FALSE
                            AND (EXISTS(SELECT 1 FROM exam_participant_classes pc WHERE pc.exam_id = a.exam_id AND pc.student_user_id = a.student_user_id AND pc.class_id = ?)
                                 OR EXISTS(SELECT 1 FROM exam_target_student_classes ts WHERE ts.exam_id = a.exam_id AND ts.student_user_id = a.student_user_id AND ts.class_id = ?)
                                 OR EXISTS(SELECT 1 FROM class_memberships cm WHERE cm.student_user_id = a.student_user_id AND cm.class_id = ? AND cm.left_at IS NULL))
                            AND NOT EXISTS(SELECT 1 FROM attempt_classes ac WHERE ac.attempt_id = a.id)
                            AND (EXISTS(SELECT 1 FROM exam_participant_classes pc WHERE pc.exam_id = a.exam_id
                                        AND pc.student_user_id = a.student_user_id AND pc.class_id <> ?)
                                 OR EXISTS(SELECT 1 FROM exam_target_student_classes ts WHERE ts.exam_id = a.exam_id
                                           AND ts.student_user_id = a.student_user_id AND ts.class_id <> ?)
                                 OR EXISTS(SELECT 1 FROM exams e JOIN papers p ON p.id = e.paper_id
                                           JOIN class_exam_workspaces cw ON cw.exam_type_code = p.exam_type_code
                                           JOIN class_memberships other ON other.class_id = cw.class_id AND other.left_at IS NULL
                                           WHERE e.id = a.exam_id AND other.student_user_id = a.student_user_id
                                             AND other.class_id <> ?)))
            """, Boolean.class, examId, classId, classId, classId, classId, classId, classId);
        if (Boolean.TRUE.equals(unattributed)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Some student attempts cannot be assigned to a single class. Resolve their class assignment before deleting.");
        }

        List<Long> users = jdbcTemplate.query("""
            SELECT student_user_id FROM exam_participant_classes WHERE exam_id = ? AND class_id = ?
            UNION SELECT a.student_user_id FROM attempts a JOIN attempt_classes ac ON ac.attempt_id = a.id
                  WHERE a.exam_id = ? AND ac.class_id = ? AND a.is_practice = FALSE
            UNION SELECT student_user_id FROM exam_target_student_classes WHERE exam_id = ? AND class_id = ?
            UNION SELECT ep.student_user_id FROM exam_participants ep JOIN class_memberships cm
                  ON cm.student_user_id = ep.student_user_id AND cm.left_at IS NULL
                  WHERE ep.exam_id = ? AND cm.class_id = ?
            """, (rs, rowNum) -> rs.getLong(1), examId, classId, examId, classId, examId, classId, examId, classId);
        jdbcTemplate.update("DELETE FROM shsat_wrong_answer_tasks WHERE exam_id = ? AND class_id = ?", examId, classId);
        // 先清理该班的复习练习，再删除任务，其他班引用的作答不受影响。
        jdbcTemplate.update("""
            DELETE practice FROM attempts practice JOIN review_practice_rounds round_row ON round_row.attempt_id = practice.id
            JOIN review_assignments assignment ON assignment.id = round_row.assignment_id
            JOIN review_tasks task ON task.id = assignment.task_id
            WHERE task.exam_id = ? AND task.class_id = ?
            """, examId, classId);
        jdbcTemplate.update("DELETE FROM review_tasks WHERE exam_id = ? AND class_id = ?", examId, classId);
        // 旧数据没有作答归属时，仅清理能够确定只属于本班的学生记录。
        jdbcTemplate.update("""
            DELETE a FROM attempts a
            WHERE a.exam_id = ? AND a.is_practice = FALSE
              AND NOT EXISTS(SELECT 1 FROM attempt_classes ac WHERE ac.attempt_id = a.id)
              AND (EXISTS(SELECT 1 FROM exam_participant_classes pc WHERE pc.exam_id = a.exam_id AND pc.student_user_id = a.student_user_id AND pc.class_id = ?)
                   OR EXISTS(SELECT 1 FROM exam_target_student_classes ts WHERE ts.exam_id = a.exam_id AND ts.student_user_id = a.student_user_id AND ts.class_id = ?)
                   OR EXISTS(SELECT 1 FROM class_memberships cm WHERE cm.student_user_id = a.student_user_id AND cm.class_id = ? AND cm.left_at IS NULL))
            """, examId, classId, classId, classId);
        jdbcTemplate.update("""
            DELETE a FROM attempts a JOIN attempt_classes ac ON ac.attempt_id = a.id AND ac.class_id = ?
            WHERE a.exam_id = ? AND a.is_practice = FALSE AND NOT EXISTS (
                SELECT 1 FROM attempt_classes other_class WHERE other_class.attempt_id = a.id AND other_class.class_id <> ?)
              AND NOT EXISTS(SELECT 1 FROM exam_participant_classes pc WHERE pc.exam_id = a.exam_id
                             AND pc.student_user_id = a.student_user_id AND pc.class_id <> ?)
              AND NOT EXISTS(SELECT 1 FROM exam_target_student_classes ts WHERE ts.exam_id = a.exam_id
                             AND ts.student_user_id = a.student_user_id AND ts.class_id <> ?)
              AND NOT EXISTS(SELECT 1 FROM exam_target_classes tc JOIN class_memberships cm
                             ON cm.class_id = tc.class_id AND cm.left_at IS NULL
                             WHERE tc.exam_id = a.exam_id AND tc.class_id <> ? AND cm.student_user_id = a.student_user_id)
              AND NOT EXISTS(SELECT 1 FROM exams e JOIN papers p ON p.id = e.paper_id
                             JOIN class_exam_workspaces cw ON cw.exam_type_code = p.exam_type_code AND cw.class_id <> ?
                             JOIN class_memberships cm ON cm.class_id = cw.class_id AND cm.left_at IS NULL
                             WHERE e.id = a.exam_id AND e.target_scope = 'ALL_STUDENTS' AND cm.student_user_id = a.student_user_id
                               AND NOT EXISTS(SELECT 1 FROM exam_excluded_classes excluded
                                              WHERE excluded.exam_id = e.id AND excluded.class_id = cw.class_id))
            """, classId, examId, classId, classId, classId, classId, classId);
        jdbcTemplate.update("DELETE ac FROM attempt_classes ac JOIN attempts a ON a.id = ac.attempt_id WHERE a.exam_id = ? AND ac.class_id = ? AND a.is_practice = FALSE", examId, classId);
        jdbcTemplate.update("DELETE FROM exam_target_classes WHERE exam_id = ? AND class_id = ?", examId, classId);
        jdbcTemplate.update("DELETE FROM exam_target_student_classes WHERE exam_id = ? AND class_id = ?", examId, classId);
        jdbcTemplate.update("DELETE FROM exam_participant_classes WHERE exam_id = ? AND class_id = ?", examId, classId);
        for (Long user : users) {
            Boolean shared = jdbcTemplate.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM exam_participant_classes WHERE exam_id = ? AND student_user_id = ?)
                    OR EXISTS(SELECT 1 FROM exam_target_student_classes WHERE exam_id = ? AND student_user_id = ?)
                    OR EXISTS(SELECT 1 FROM attempts a JOIN attempt_classes ac ON ac.attempt_id = a.id
                              WHERE a.exam_id = ? AND a.student_user_id = ? AND a.is_practice = FALSE)
                    OR EXISTS(SELECT 1 FROM exam_target_classes tc JOIN class_memberships cm ON cm.class_id = tc.class_id AND cm.left_at IS NULL
                              WHERE tc.exam_id = ? AND cm.student_user_id = ?)
                    OR EXISTS(SELECT 1 FROM exams e JOIN papers p ON p.id = e.paper_id
                              JOIN class_exam_workspaces cw ON cw.exam_type_code = p.exam_type_code AND cw.class_id <> ?
                              JOIN class_memberships cm ON cm.class_id = cw.class_id AND cm.left_at IS NULL
                              WHERE e.id = ? AND e.target_scope = 'ALL_STUDENTS' AND cm.student_user_id = ?
                                AND NOT EXISTS(SELECT 1 FROM exam_excluded_classes excluded
                                               WHERE excluded.exam_id = e.id AND excluded.class_id = cw.class_id))
                """, Boolean.class, examId, user, examId, user, examId, user, examId, user, classId, examId, user);
            if (!Boolean.TRUE.equals(shared)) {
                jdbcTemplate.update("DELETE FROM exam_target_students WHERE exam_id = ? AND student_user_id = ?", examId, user);
                jdbcTemplate.update("DELETE FROM exam_participants WHERE exam_id = ? AND student_user_id = ?", examId, user);
            }
        }
        jdbcTemplate.update("INSERT IGNORE INTO exam_excluded_classes (exam_id, class_id) VALUES (?, ?)", examId, classId);
        jdbcTemplate.update("INSERT INTO audit_events (action_code, entity_type, entity_key, detail_json) VALUES ('DELETE_CLASS_EXAM', 'EXAM', ?, JSON_OBJECT('classId', ?, 'affectedStudents', ?))",
            Long.toString(examId), classId, users.size());
    }

    public List<StudentExamView> listForStudent(String username) {
        Long studentId = jdbcTemplate.query("SELECT id FROM users WHERE username = ? AND role_code = 'STUDENT' AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        if (studentId == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Student account required.");
        return jdbcTemplate.query("""
            SELECT e.id, p.exam_type_code, e.title, e.description, e.opens_at, e.closes_at,
                   p.title AS paper_title,
                   COALESCE(NULLIF(e.duration_seconds, 0), p.default_duration_seconds) AS duration_seconds,
                   e.attempt_limit, e.allow_review, e.auto_submit,
                   (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.student_user_id = ?
                       AND (a.status IN ('SUBMITTED','COMPLETED','EXPIRED') OR
                            (a.status = 'IN_PROGRESS' AND a.expires_at <= CURRENT_TIMESTAMP(6)))
                       AND a.is_practice = FALSE) AS attempts_used,
                   (SELECT MAX(a.id) FROM attempts a WHERE a.exam_id = e.id AND a.student_user_id = ?
                       AND a.status = 'IN_PROGRESS' AND a.is_practice = FALSE
                       AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP(6))) AS active_attempt_id,
                   (SELECT MAX(a.id) FROM attempts a WHERE a.exam_id = e.id AND a.student_user_id = ?
                       AND a.status IN ('SUBMITTED', 'COMPLETED') AND a.is_practice = FALSE) AS latest_attempt_id,
                   CASE WHEN e.target_scope = 'ALL_STUDENTS' THEN 'GROUP'
                        WHEN EXISTS (
                            SELECT 1 FROM exam_participant_classes pc
                            JOIN exam_target_classes tc ON tc.exam_id = pc.exam_id AND tc.class_id = pc.class_id
                            WHERE pc.exam_id = e.id AND pc.student_user_id = ep.student_user_id
                        ) THEN 'GROUP'
                        ELSE 'ONE_ON_ONE' END AS assignment_kind
            FROM exam_participants ep JOIN exams e ON e.id = ep.exam_id
            JOIN papers p ON p.id = e.paper_id
            JOIN exam_types et ON et.code = p.exam_type_code AND et.is_active = TRUE
            WHERE ep.student_user_id = ? AND ep.revoked_at IS NULL AND e.release_hidden_at IS NULL AND e.status IN ('PUBLISHED', 'CLOSED', 'DRAFT')
                AND NOT EXISTS (SELECT 1 FROM sat_practice_papers spp WHERE spp.practice_exam_id = e.id)
                AND NOT EXISTS (SELECT 1 FROM sat_practice_paper_templates spt WHERE spt.practice_exam_id = e.id)
                AND ((e.status = 'PUBLISHED' AND e.closes_at > CURRENT_TIMESTAMP(6)) OR EXISTS (
                    SELECT 1 FROM attempts a
                    WHERE a.exam_id = e.id AND a.student_user_id = ep.student_user_id AND a.is_practice = FALSE
                      AND (e.status = 'CLOSED' OR (e.status = 'DRAFT' AND a.status = 'IN_PROGRESS'
                           AND (a.expires_at IS NULL OR a.expires_at > CURRENT_TIMESTAMP(6))))
                ))
            ORDER BY e.opens_at, e.id
            """, (rs, rowNum) -> new StudentExamView(rs.getLong("id"), rs.getString("exam_type_code"),
                rs.getString("title"), rs.getString("description"), rs.getTimestamp("opens_at").toInstant().toString(),
                rs.getTimestamp("closes_at").toInstant().toString(), rs.getString("paper_title"),
                nullableInt(rs, "duration_seconds"), rs.getInt("attempt_limit"), rs.getInt("attempts_used"),
                nullableLong(rs, "active_attempt_id"), nullableLong(rs, "latest_attempt_id"),
                rs.getString("assignment_kind")),
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
                   e.attempt_limit, e.allow_review, e.auto_submit,
                   EXISTS(SELECT 1 FROM attempts a WHERE a.exam_id = e.id AND a.is_practice = FALSE) AS has_student_attempts,
                   e.created_at, e.updated_at, e.published_at,
                   %s
            FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ? AND NOT EXISTS (
                SELECT 1 FROM sat_practice_papers spp WHERE spp.practice_exam_id = e.id
            ) AND NOT EXISTS (
                SELECT 1 FROM sat_practice_paper_templates spt WHERE spt.practice_exam_id = e.id
            )
            """.formatted(TARGET_SUMMARY_PROJECTION), (rs, rowNum) -> mapSummary(rs), examId);
        if (result.isEmpty()) throw notFound();
        return result.get(0);
    }

    private ExamSummary mapSummary(java.sql.ResultSet rs) throws java.sql.SQLException {
        Timestamp publishedAt = rs.getTimestamp("published_at");
        return new ExamSummary(rs.getLong("id"), rs.getString("exam_type_code"), rs.getLong("paper_id"),
            rs.getString("paper_title"), rs.getString("title"), rs.getString("description"), rs.getString("status"),
            rs.getString("target_scope"), rs.getTimestamp("opens_at").toInstant().toString(),
            rs.getTimestamp("closes_at").toInstant().toString(), nullableInt(rs, "duration_seconds"),
            rs.getInt("attempt_limit"), rs.getBoolean("has_student_attempts"), rs.getBoolean("allow_review"),
            rs.getBoolean("auto_submit"), rs.getTimestamp("created_at").toInstant().toString(),
            rs.getTimestamp("updated_at").toInstant().toString(),
            publishedAt == null ? null : publishedAt.toInstant().toString(), rs.getString("target_summary"));
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

    private void requireManageableExam(long examId) {
        Boolean practice = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM sat_practice_papers WHERE practice_exam_id = ?)
                OR EXISTS(SELECT 1 FROM sat_practice_paper_templates WHERE practice_exam_id = ?)
            """, Boolean.class, examId, examId);
        if (Boolean.TRUE.equals(practice)) throw notFound();
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
        // 与 publish 使用同一把 exam 行锁，避免发布和目标/设置修改并发时产生半更新状态。
        String status = jdbcTemplate.query("SELECT status FROM exams WHERE id = ? FOR UPDATE",
            rs -> rs.next() ? rs.getString(1) : null, examId);
        if (status == null) throw notFound();
        if (!"DRAFT".equals(status)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Only draft exams can be changed.");
    }

    private void validateWindow(OffsetDateTime opensAt, OffsetDateTime closesAt) {
        if (!closesAt.isAfter(opensAt)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The closing time must be after the opening time.");
        if (opensAt.toInstant().isBefore(MIN_DATABASE_INSTANT) || closesAt.toInstant().isAfter(MAX_DATABASE_INSTANT)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "The exam window must fall between January 1, 1000 and December 31, 9999 UTC.");
        }
    }

    private void validateDescriptionLength(String examTypeCode, String description) {
        if ("SHSAT".equals(examTypeCode) && description != null && description.length() > SHSAT_DESCRIPTION_MAX_LENGTH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "The exam description must be no more than 500 characters.");
        }
    }

    private ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Exam not found.");
    }

    public record ExamRequest(@NotBlank @Size(max = 200) String title, @Size(max = 2000) String description,
                              @NotNull OffsetDateTime opensAt, @NotNull OffsetDateTime closesAt,
                              @Positive Integer durationSeconds, @NotNull @Positive Integer attemptLimit,
                              String targetScope, Boolean autoSubmit, Boolean allowReview) { }
    public record StudentClassTarget(@Positive long classId, @Positive long studentId) { }
    public record TargetRequest(List<@NotNull @Positive Long> classIds,
                                List<@NotNull @Positive Long> studentUserIds,
                                List<@NotNull @jakarta.validation.Valid StudentClassTarget> studentTargets) {
        public TargetRequest {
            classIds = classIds == null ? List.of() : classIds;
            studentUserIds = studentUserIds == null ? List.of() : studentUserIds;
            studentTargets = studentTargets == null ? List.of() : studentTargets;
        }
        public TargetRequest(List<Long> classIds, List<Long> studentUserIds) { this(classIds, studentUserIds, List.of()); }
    }
    public record ExamSummary(long id, String examTypeCode, long paperId, String paperTitle, String title,
                              String description, String status, String targetScope, String opensAt,
                              String closesAt, Integer durationSeconds, int attemptLimit, boolean hasStudentAttempts,
                              boolean allowReview, boolean autoSubmit,
                              String createdAt, String updatedAt, String publishedAt, String targetSummary) { }
    public record ExamDetail(ExamSummary summary, List<Long> classIds, List<Long> studentUserIds,
                             List<StudentClassTarget> studentTargets) {
        public ExamDetail(ExamSummary summary, List<Long> classIds, List<Long> studentUserIds) { this(summary, classIds, studentUserIds, List.of()); }
    }
    public record StudentExamView(long id, String examTypeCode, String title, String description,
                                  String opensAt, String closesAt, String paperTitle,
                                  Integer durationSeconds, int attemptLimit, int attemptsUsed, Long activeAttemptId,
                                  Long latestAttemptId, String assignmentKind) { }
}
