package com.unifiedexam.platform.classroom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.attempt.SatScoreScale;
import com.unifiedexam.platform.examtype.sat.SatModuleScoreSql;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.Collections;
import java.util.List;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api/admin/classes")
public class ClassAdminController {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final SatScoreScale satScoreScale = new SatScoreScale();

    public ClassAdminController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 按考试模块汇总班级成员实际开始过的非练习考试数，并返回班级列表。 */
    @GetMapping
    public List<ClassView> listClasses(@RequestParam(required = false) List<String> examTypeCodes) {
        List<String> types = validateExamTypeCodes(examTypeCodes);
        List<Object> parameters = new java.util.ArrayList<>(types);
        String typeFilter = examTypeFilter(types);
        return jdbcTemplate.query("""
            SELECT c.id, c.name, c.description, c.status, c.sort_order,
                (SELECT COUNT(*) FROM class_memberships m WHERE m.class_id = c.id AND m.left_at IS NULL) AS student_count,
                (SELECT COUNT(DISTINCT a.exam_id)
                 FROM class_memberships m
                 JOIN attempts a ON a.student_user_id = m.student_user_id
                 JOIN exams e ON e.id = a.exam_id
                 JOIN papers p ON p.id = e.paper_id
                 WHERE m.class_id = c.id
                   AND m.joined_at <= a.started_at
                   AND (m.left_at IS NULL OR a.started_at <= m.left_at)
                   AND a.is_practice = FALSE
                   AND (e.target_scope = 'ALL_STUDENTS' OR EXISTS (
                       SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = e.id AND tc.class_id = c.id
                   ))
                   %s) AS exam_count
            FROM classes c ORDER BY c.sort_order, c.id DESC
            """.formatted(typeFilter), (rs, rowNum) -> new ClassView(rs.getLong("id"), rs.getString("name"),
                rs.getString("description"), rs.getString("status"), rs.getInt("sort_order"),
                rs.getInt("student_count"), rs.getInt("exam_count")), parameters.toArray());
    }

    @GetMapping("/available-students")
    public List<StudentOption> availableStudents() {
        return jdbcTemplate.query("""
            SELECT u.id, u.username, u.real_name,
                   COALESCE(GROUP_CONCAT(DISTINCT c.name ORDER BY c.name SEPARATOR ' · '), '') AS class_names
            FROM users u
            LEFT JOIN class_memberships m ON m.student_user_id = u.id AND m.left_at IS NULL
            LEFT JOIN classes c ON c.id = m.class_id
            WHERE u.role_code = 'STUDENT' AND u.status = 'ACTIVE'
            GROUP BY u.id, u.username, u.real_name
            ORDER BY u.real_name, u.id
            """, (rs, rowNum) -> new StudentOption(rs.getLong("id"), rs.getString("username"),
                rs.getString("real_name"), rs.getString("class_names")));
    }

    @GetMapping("/{classId}")
    public ClassView getClass(@PathVariable long classId,
                              @RequestParam(required = false) List<String> examTypeCodes) {
        return findClass(classId, validateExamTypeCodes(examTypeCodes));
    }

    @GetMapping("/{classId}/exams")
    public List<ClassExamView> listClassExams(@PathVariable long classId,
                                               @RequestParam(required = false) List<String> examTypeCodes) {
        requireClass(classId);
        List<String> types = examTypeCodes == null || examTypeCodes.isEmpty() ? List.of("SHSAT") : examTypeCodes;
        if (types.size() > 10 || types.stream().anyMatch(code -> code == null
                || !java.util.regex.Pattern.matches("[A-Z0-9_]{1,32}", code))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid exam type selection.");
        }
        String typePlaceholders = String.join(", ", Collections.nCopies(types.size(), "?"));
        String sql = """
            SELECT e.id, e.title, e.description, e.status,
                   CASE WHEN e.target_scope = 'ALL_STUDENTS' THEN 'ALL_STUDENTS' ELSE 'SPECIFIC_CLASSES' END AS target_type,
                   e.opens_at, e.closes_at,
                   e.duration_seconds, e.attempt_limit, p.title AS paper_name,
                   COALESCE((SELECT JSON_ARRAYAGG(tc.class_id) FROM exam_target_classes tc WHERE tc.exam_id = e.id), JSON_ARRAY()) AS target_class_ids
            FROM exams e JOIN papers p ON p.id = e.paper_id
            WHERE p.exam_type_code IN (%s) AND (e.target_scope = 'ALL_STUDENTS' OR EXISTS (
                SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = e.id AND tc.class_id = ?
            ))
            ORDER BY e.created_at DESC, e.id DESC
            """.formatted(typePlaceholders);
        Object[] parameters = Stream.concat(types.stream().map(code -> (Object) code), Stream.of(classId)).toArray();
        return jdbcTemplate.query(sql, (rs, rowNum) -> new ClassExamView(rs.getLong("id"), rs.getString("title"),
                rs.getString("paper_name"), rs.getString("target_type"), rs.getString("target_class_ids"),
                "PUBLISHED".equals(rs.getString("status")), rs.getString("status"),
                rs.getTimestamp("opens_at").toInstant().toString(), rs.getTimestamp("closes_at").toInstant().toString(),
                nullableInt(rs, "duration_seconds"), rs.getInt("attempt_limit")), parameters);
    }

    /** 按考试与考试类型汇总班级成员在班期间的最新已完成成绩，保留 raw/scaled 两种口径。 */
    @GetMapping("/{classId}/score-trend")
    public List<ClassExamScoreTrendView> classExamScoreTrend(@PathVariable long classId,
                                                              @RequestParam(required = false) List<String> examTypeCodes) {
        requireClass(classId);
        List<String> types = examTypeCodes == null || examTypeCodes.isEmpty() ? List.of("SHSAT") : examTypeCodes;
        if (types.size() > 10 || types.stream().anyMatch(code -> code == null
                || !java.util.regex.Pattern.matches("[A-Z0-9_]{1,32}", code))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid exam type selection.");
        }

        String typePlaceholders = String.join(", ", Collections.nCopies(types.size(), "?"));
        String sql = """
            WITH ranked_attempts AS (
                SELECT e.id AS exam_id, e.title AS exam_title, p.exam_type_code,
                       COALESCE(e.opens_at, a.submitted_at) AS exam_date,
                       a.student_user_id, r.total_points, d.source_score_json,
                       d.rw_module1_raw AS imported_rw1_raw, d.rw_module2_raw AS imported_rw2_raw,
                       d.math_module1_raw AS imported_math1_raw, d.math_module2_raw AS imported_math2_raw,
                       s.scoring_table_code,
                       %s AS rw1_raw,
                       %s AS rw2_raw,
                       %s AS math1_raw,
                       %s AS math2_raw,
                       (SELECT COUNT(*) FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
                        WHERE ps.paper_id = p.id) AS paper_question_count,
                       ROW_NUMBER() OVER (
                           PARTITION BY e.id, a.student_user_id
                           ORDER BY a.submitted_at DESC, a.id DESC
                       ) AS attempt_rank
                FROM class_memberships cm
                JOIN attempts a ON a.student_user_id = cm.student_user_id
                JOIN attempt_results r ON r.attempt_id = a.id
                LEFT JOIN sat_attempt_details d ON d.attempt_id = a.id
                JOIN exams e ON e.id = a.exam_id
                JOIN papers p ON p.id = e.paper_id
                LEFT JOIN sat_paper_settings s ON s.paper_id = p.id
                WHERE cm.class_id = ?
                  AND a.status IN ('SUBMITTED', 'COMPLETED')
                  AND a.is_practice = FALSE
                  AND p.exam_type_code IN (%s)
                  AND cm.joined_at <= COALESCE(a.submitted_at, a.started_at)
                  AND (cm.left_at IS NULL OR COALESCE(a.submitted_at, a.started_at) <= cm.left_at)
                  AND (e.target_scope = 'ALL_STUDENTS' OR EXISTS (
                      SELECT 1 FROM exam_target_classes tc
                      WHERE tc.exam_id = e.id AND tc.class_id = cm.class_id
                  ))
            )
            SELECT * FROM ranked_attempts
            WHERE attempt_rank = 1
            ORDER BY exam_date, exam_id
            """.formatted(SatModuleScoreSql.rawScore("RW", 1), SatModuleScoreSql.rawScore("RW", 2),
                SatModuleScoreSql.rawScore("Math", 1), SatModuleScoreSql.rawScore("Math", 2), typePlaceholders);
        Object[] parameters = Stream.concat(Stream.of((Object) classId), types.stream().map(code -> (Object) code)).toArray();
        List<TrendAttemptRow> attempts = jdbcTemplate.query(sql, (rs, rowNum) -> new TrendAttemptRow(
            rs.getLong("exam_id"), rs.getString("exam_title"), rs.getString("exam_type_code"),
            rs.getTimestamp("exam_date") == null ? null : rs.getTimestamp("exam_date").toLocalDateTime(),
            rs.getBigDecimal("total_points"), rs.getString("source_score_json"),
            firstValue(rs.getBigDecimal("imported_rw1_raw"), rs.getBigDecimal("rw1_raw")),
            firstValue(rs.getBigDecimal("imported_rw2_raw"), rs.getBigDecimal("rw2_raw")),
            firstValue(rs.getBigDecimal("imported_math1_raw"), rs.getBigDecimal("math1_raw")),
            firstValue(rs.getBigDecimal("imported_math2_raw"), rs.getBigDecimal("math2_raw")),
            rs.getString("scoring_table_code"), rs.getInt("paper_question_count")), parameters);
        java.util.Map<Long, List<TrendAttemptRow>> byExam = attempts.stream()
            .collect(java.util.stream.Collectors.groupingBy(TrendAttemptRow::examId, java.util.LinkedHashMap::new,
                java.util.stream.Collectors.toList()));
        return byExam.values().stream().map(this::summarizeTrend).toList();
    }

    /** 汇总去重后的最新学生尝试；优先使用迁移快照，再按当前量表换算。 */
    private ClassExamScoreTrendView summarizeTrend(List<TrendAttemptRow> rows) {
        TrendAttemptRow first = rows.get(0);
        List<java.math.BigDecimal> rawScores = new java.util.ArrayList<>();
        List<java.math.BigDecimal> scaledScores = new java.util.ArrayList<>();
        for (TrendAttemptRow row : rows) {
            JsonNode legacy = readJson(row.sourceScoreJson());
            java.math.BigDecimal rw1 = row.rw1Raw();
            java.math.BigDecimal rw2 = row.rw2Raw();
            java.math.BigDecimal math1 = row.math1Raw();
            java.math.BigDecimal math2 = row.math2Raw();
            java.math.BigDecimal rwRaw = sum(rw1, rw2);
            java.math.BigDecimal mathRaw = sum(math1, math2);
            java.math.BigDecimal raw = sum(rw1, rw2, math1, math2);
            if (raw == null && legacy.path("correct_questions").isNumber()) raw = legacy.path("correct_questions").decimalValue();
            if (raw == null) raw = row.totalPoints();
            if (raw != null) rawScores.add(raw);

            java.math.BigDecimal scaled = legacy.path("total_score").isNumber()
                ? legacy.path("total_score").decimalValue()
                : scaledSubjectTotal(row.scoringTableCode(), "RW", rwRaw, row.paperQuestionCount())
                    .add(scaledSubjectTotal(row.scoringTableCode(), "Math", mathRaw, row.paperQuestionCount()));
            if (rwRaw != null && mathRaw != null) scaledScores.add(scaled);
        }
        return new ClassExamScoreTrendView(first.examId(), first.examTitle(), first.examTypeCode(), first.examDate(),
            average(rawScores), average(scaledScores), rows.size());
    }

    /** 使用旧 SAT/PSAT 总分量表换算单科 raw 分。 */
    private java.math.BigDecimal scaledSubjectTotal(String scoringType, String subject,
                                                     java.math.BigDecimal raw, int questionCount) {
        return raw == null ? java.math.BigDecimal.ZERO : java.math.BigDecimal.valueOf(
            satScoreScale.scaledTotal(scoringType, subject, raw.intValue(), questionCount));
    }

    private JsonNode readJson(String json) {
        if (json == null || json.isBlank()) return objectMapper.nullNode();
        try { return objectMapper.readTree(json); } catch (Exception ignored) { return objectMapper.nullNode(); }
    }

    private java.math.BigDecimal firstValue(java.math.BigDecimal preferred, java.math.BigDecimal fallback) {
        return preferred == null ? fallback : preferred;
    }

    private java.math.BigDecimal sum(java.math.BigDecimal... values) {
        java.math.BigDecimal total = java.math.BigDecimal.ZERO;
        boolean found = false;
        for (java.math.BigDecimal value : values) if (value != null) { total = total.add(value); found = true; }
        return found ? total : null;
    }

    private java.math.BigDecimal average(List<java.math.BigDecimal> values) {
        if (values.isEmpty()) return null;
        return values.stream().reduce(java.math.BigDecimal.ZERO, java.math.BigDecimal::add)
            .divide(java.math.BigDecimal.valueOf(values.size()), 2, java.math.RoundingMode.HALF_UP);
    }

    @PostMapping("/reorder")
    @Transactional
    public List<ClassView> reorderClasses(@Valid @RequestBody ReorderClassesRequest request,
                                           @RequestParam(required = false) List<String> examTypeCodes) {
        List<String> types = validateExamTypeCodes(examTypeCodes);
        List<Long> current = jdbcTemplate.query("SELECT id FROM classes ORDER BY id", (rs, rowNum) -> rs.getLong(1));
        List<Long> requested = request.classIds().stream().distinct().toList();
        if (requested.size() != request.classIds().size()
                || current.size() != requested.size()
                || !new java.util.HashSet<>(current).equals(new java.util.HashSet<>(requested))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The class order must include every class exactly once.");
        }
        for (int i = 0; i < requested.size(); i++) {
            jdbcTemplate.update("UPDATE classes SET sort_order = ? WHERE id = ?", i, requested.get(i));
        }
        return listClasses(types);
    }

    @PostMapping
    @Transactional
    public ClassView createClass(@Valid @RequestBody SaveClassRequest request,
                                 @RequestParam(required = false) List<String> examTypeCodes) {
        jdbcTemplate.update("INSERT INTO classes (name, description, sort_order) VALUES (?, ?, ?)",
            request.name(), request.description(), request.sortOrder());
        Long id = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return findClass(id, validateExamTypeCodes(examTypeCodes));
    }

    @PatchMapping("/{classId}")
    public ClassView updateClass(@PathVariable long classId, @Valid @RequestBody SaveClassRequest request,
                                 @RequestParam(required = false) List<String> examTypeCodes) {
        requireClass(classId);
        jdbcTemplate.update("UPDATE classes SET name = ?, description = ?, sort_order = ? WHERE id = ?",
            request.name(), request.description(), request.sortOrder(), classId);
        return findClass(classId, validateExamTypeCodes(examTypeCodes));
    }

    @PatchMapping("/{classId}/status")
    public void setClassStatus(@PathVariable long classId, @Valid @RequestBody ClassStatusRequest request) {
        requireClass(classId);
        jdbcTemplate.update("UPDATE classes SET status = ? WHERE id = ?", request.status(), classId);
    }

    /** 管理员硬删除班级；保留学生、考试及成绩，并阻止删除仍承载 SHSAT 任务的班级。 */
    @DeleteMapping("/{classId}")
    @Transactional
    public void deleteClass(@PathVariable long classId) {
        requireClass(classId);
        jdbcTemplate.queryForObject("SELECT id FROM classes WHERE id = ? FOR UPDATE", Long.class, classId);
        Integer taskCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM shsat_wrong_answer_tasks WHERE class_id = ?", Integer.class, classId);
        if (taskCount != null && taskCount > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "Reassign or remove this class's SHSAT review tasks before deleting the class.");
        }

        // 先解除会阻止班级删除的关系；学生账户和考试参与记录继续保留。
        jdbcTemplate.update("DELETE FROM exam_target_classes WHERE class_id = ?", classId);
        jdbcTemplate.update("DELETE FROM class_memberships WHERE class_id = ?", classId);
        int deleted = jdbcTemplate.update("DELETE FROM classes WHERE id = ?", classId);
        if (deleted == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Class not found.");
    }

    @GetMapping("/{classId}/students")
    public List<StudentView> listStudents(@PathVariable long classId) {
        requireClass(classId);
        return jdbcTemplate.query("""
            SELECT u.id, u.username, u.real_name, u.email, m.joined_at, u.status,
                   sp.gender, sp.notes, sa.time_multiplier
            FROM class_memberships m JOIN users u ON u.id = m.student_user_id
            LEFT JOIN shsat_student_profiles sp ON sp.student_user_id = u.id
            LEFT JOIN shsat_student_accommodations sa ON sa.student_user_id = u.id
            WHERE m.class_id = ? AND m.left_at IS NULL ORDER BY u.real_name, u.id
            """, (rs, rowNum) -> new StudentView(rs.getLong("id"), rs.getString("username"),
                rs.getString("real_name"), rs.getString("email"), rs.getTimestamp("joined_at").toInstant().toString(),
                rs.getString("gender"), rs.getString("notes"), rs.getBigDecimal("time_multiplier"),
                "ACTIVE".equals(rs.getString("status"))), classId);
    }

    @PutMapping("/{classId}/students/{studentUserId}")
    @Transactional
    public StudentView updateStudent(@PathVariable long classId, @PathVariable long studentUserId,
                                     @Valid @RequestBody UpdateStudentRequest request) {
        requireClass(classId);
        Boolean isMember = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM class_memberships WHERE class_id = ? AND student_user_id = ? AND left_at IS NULL)
            """, Boolean.class, classId, studentUserId);
        if (!Boolean.TRUE.equals(isMember)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Student is not in this class.");
        String role = jdbcTemplate.query("SELECT role_code FROM users WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, studentUserId);
        if (!"STUDENT".equals(role)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Student not found.");
        long targetClassId = request.classId() == null ? classId : request.classId();
        String targetClassStatus = jdbcTemplate.query("SELECT status FROM classes WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, targetClassId);
        if (!"ACTIVE".equals(targetClassStatus)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select an active class.");
        jdbcTemplate.update("UPDATE users SET real_name = ?, status = ? WHERE id = ?",
            request.studentName().trim(), Boolean.FALSE.equals(request.active()) ? "DISABLED" : "ACTIVE", studentUserId);
        jdbcTemplate.update("""
            INSERT INTO shsat_student_profiles (student_user_id, gender, notes) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE gender = VALUES(gender), notes = VALUES(notes)
            """, studentUserId, request.gender(), request.notes());
        if (request.timeMultiplier() != null) {
            jdbcTemplate.update("""
                INSERT INTO shsat_student_accommodations (student_user_id, time_multiplier) VALUES (?, ?)
                ON DUPLICATE KEY UPDATE time_multiplier = VALUES(time_multiplier)
                """, studentUserId, request.timeMultiplier());
        }
        jdbcTemplate.update("""
            INSERT INTO class_memberships (class_id, student_user_id, joined_at, left_at)
            VALUES (?, ?, CURRENT_TIMESTAMP(6), NULL)
            ON DUPLICATE KEY UPDATE joined_at = IF(left_at IS NULL, joined_at, CURRENT_TIMESTAMP(6)), left_at = NULL
            """, targetClassId, studentUserId);
        return findStudent(targetClassId, studentUserId);
    }

    @PostMapping("/{classId}/students")
    @Transactional
    public void addStudent(@PathVariable long classId, @Valid @RequestBody MembershipRequest request) {
        lockActiveClass(classId);
        addStudentToClass(classId, request.studentUserId());
    }

    @PostMapping("/{classId}/students/batch")
    @Transactional
    public void addStudents(@PathVariable long classId, @Valid @RequestBody BatchMembershipRequest request) {
        lockActiveClass(classId);
        List<Long> studentIds = request.studentUserIds();
        if (studentIds.stream().distinct().count() != studentIds.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose each student only once.");
        }
        studentIds.forEach(studentId -> addStudentToClass(classId, studentId));
    }

    @DeleteMapping("/{classId}/students/{studentUserId}")
    public void removeStudent(@PathVariable long classId, @PathVariable long studentUserId) {
        int updated = jdbcTemplate.update("""
            UPDATE class_memberships SET left_at = CURRENT_TIMESTAMP(6)
            WHERE class_id = ? AND student_user_id = ? AND left_at IS NULL
            """, classId, studentUserId);
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "That student is not currently in this class.");
        }
    }

    private Integer nullableInt(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).intValue();
    }

    private ClassView findClass(long id, List<String> examTypeCodes) {
        String typeFilter = examTypeFilter(examTypeCodes);
        List<ClassView> classes = jdbcTemplate.query("""
            SELECT c.id, c.name, c.description, c.status, c.sort_order,
                (SELECT COUNT(*) FROM class_memberships m WHERE m.class_id = c.id AND m.left_at IS NULL) AS student_count,
                (SELECT COUNT(DISTINCT a.exam_id)
                 FROM class_memberships m
                 JOIN attempts a ON a.student_user_id = m.student_user_id
                 JOIN exams e ON e.id = a.exam_id
                 JOIN papers p ON p.id = e.paper_id
                 WHERE m.class_id = c.id
                   AND m.joined_at <= a.started_at
                   AND (m.left_at IS NULL OR a.started_at <= m.left_at)
                   AND a.is_practice = FALSE
                   AND (e.target_scope = 'ALL_STUDENTS' OR EXISTS (
                       SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = e.id AND tc.class_id = c.id
                   ))
                   %s) AS exam_count
            FROM classes c WHERE c.id = ?
            """.formatted(typeFilter), (rs, rowNum) -> new ClassView(rs.getLong("id"), rs.getString("name"),
                rs.getString("description"), rs.getString("status"), rs.getInt("sort_order"),
                rs.getInt("student_count"), rs.getInt("exam_count")), examTypeCodes.isEmpty()
                ? new Object[] { id } : Stream.concat(examTypeCodes.stream().map(code -> (Object) code), Stream.of(id)).toArray());
        if (classes.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Class not found.");
        }
        return classes.get(0);
    }

    private StudentView findStudent(long classId, long studentUserId) {
        return jdbcTemplate.query("""
            SELECT u.id, u.username, u.real_name, u.email, m.joined_at, u.status,
                   sp.gender, sp.notes, sa.time_multiplier
            FROM class_memberships m JOIN users u ON u.id = m.student_user_id
            LEFT JOIN shsat_student_profiles sp ON sp.student_user_id = u.id
            LEFT JOIN shsat_student_accommodations sa ON sa.student_user_id = u.id
            WHERE m.class_id = ? AND m.student_user_id = ? AND m.left_at IS NULL
            """, rs -> rs.next() ? new StudentView(rs.getLong("id"), rs.getString("username"),
                rs.getString("real_name"), rs.getString("email"), rs.getTimestamp("joined_at").toInstant().toString(),
                rs.getString("gender"), rs.getString("notes"), rs.getBigDecimal("time_multiplier"),
                "ACTIVE".equals(rs.getString("status"))) : null, classId, studentUserId);
    }

    private void requireClass(long classId) {
        if (Boolean.FALSE.equals(jdbcTemplate.queryForObject("SELECT EXISTS(SELECT 1 FROM classes WHERE id = ?)", Boolean.class, classId))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Class not found.");
        }
    }

    private void lockActiveClass(long classId) {
        Long activeClassId = jdbcTemplate.query("SELECT id FROM classes WHERE id = ? AND status = 'ACTIVE' FOR UPDATE",
            rs -> rs.next() ? rs.getLong(1) : null, classId);
        if (activeClassId == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active class not found.");
        }
    }

    private void addStudentToClass(long classId, long studentUserId) {
        String role = jdbcTemplate.query("SELECT role_code FROM users WHERE id = ? AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getString(1) : null, studentUserId);
        if (!"STUDENT".equals(role)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only active student accounts can join a class.");
        }
        jdbcTemplate.update("""
            INSERT INTO class_memberships (class_id, student_user_id, joined_at, left_at)
            VALUES (?, ?, CURRENT_TIMESTAMP(6), NULL)
            ON DUPLICATE KEY UPDATE joined_at = IF(left_at IS NULL, joined_at, CURRENT_TIMESTAMP(6)), left_at = NULL
            """, classId, studentUserId);
        jdbcTemplate.update("""
            INSERT IGNORE INTO exam_participants (exam_id, student_user_id)
            SELECT tc.exam_id, ? FROM exam_target_classes tc
            JOIN exams e ON e.id = tc.exam_id
            WHERE tc.class_id = ? AND e.status = 'PUBLISHED'
                AND e.opens_at <= CURRENT_TIMESTAMP(6) AND e.closes_at > CURRENT_TIMESTAMP(6)
            """, studentUserId, classId);
    }

    /** 校验模块传入的考试类型，空列表表示跨类型统计。 */
    private List<String> validateExamTypeCodes(List<String> examTypeCodes) {
        if (examTypeCodes == null || examTypeCodes.isEmpty()) return List.of();
        if (examTypeCodes.size() > 10 || examTypeCodes.stream().anyMatch(code -> code == null
                || !java.util.regex.Pattern.matches("[A-Z0-9_]{1,32}", code))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid exam type selection.");
        }
        return examTypeCodes.stream().distinct().toList();
    }

    private String examTypeFilter(List<String> examTypeCodes) {
        if (examTypeCodes.isEmpty()) return "";
        return "AND p.exam_type_code IN (" + String.join(", ", Collections.nCopies(examTypeCodes.size(), "?")) + ")";
    }

    public record SaveClassRequest(@NotBlank @Size(max = 100) String name,
                                   @Size(max = 500) String description, int sortOrder) { }
    public record ClassStatusRequest(@NotBlank @Pattern(regexp = "ACTIVE|ARCHIVED") String status) { }
    public record MembershipRequest(@Positive long studentUserId) { }
    public record BatchMembershipRequest(@NotNull @Size(min = 1, max = 500) List<@Positive Long> studentUserIds) { }
    public record UpdateStudentRequest(@NotBlank @Size(max = 80) String studentName, Long classId,
            @Size(max = 40) String gender, @Size(max = 1000) String notes,
            @DecimalMin("1.0") java.math.BigDecimal timeMultiplier, Boolean active) { }
    public record ReorderClassesRequest(@NotNull List<@Positive Long> classIds) { }
    public record ClassView(long id, String name, String description, String status, int sortOrder,
                            int studentCount, int examCount) { }
    public record StudentView(long id, String username, String realName, String email, String joinedAt,
                              String gender, String notes, java.math.BigDecimal timeMultiplier, boolean active) { }
    public record StudentOption(long id, String username, String realName, String classNames) { }
    public record ClassExamView(long examId, String examTitle, String paperName, String targetType,
                                String targetIds, boolean published, String status, String startTime,
                                String endTime, Integer duration, int attemptLimit) { }
    record TrendAttemptRow(long examId, String examTitle, String examTypeCode,
                           java.time.LocalDateTime examDate, java.math.BigDecimal totalPoints,
                           String sourceScoreJson, java.math.BigDecimal rw1Raw, java.math.BigDecimal rw2Raw,
                           java.math.BigDecimal math1Raw, java.math.BigDecimal math2Raw,
                           String scoringTableCode, int paperQuestionCount) { }
    public record ClassExamScoreTrendView(long examId, String examTitle, String examTypeCode,
                                          java.time.LocalDateTime examDate, java.math.BigDecimal averageRawScore,
                                          java.math.BigDecimal averageScaledScore, long studentCount) { }
}
