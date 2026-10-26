package com.unifiedexam.platform.attempt;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.unifiedexam.platform.examtype.ExamTypeModule;
import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Collection;

/** 学生作答生命周期：由学生 API 调用，公共服务处理资格和状态，类型模块负责题型评分。 */
@Service
public class StudentAttemptService {

    private final JdbcTemplate jdbcTemplate;
    private final ExamTypeRegistry examTypeRegistry;
    private final ObjectMapper objectMapper;

    public StudentAttemptService(JdbcTemplate jdbcTemplate, ExamTypeRegistry examTypeRegistry,
                                 ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.examTypeRegistry = examTypeRegistry;
        this.objectMapper = objectMapper;
    }

    /** 锁定考试行，串行化同一场考试的并发开考请求并创建固定题目顺序。 */
    @Transactional(noRollbackFor = ExpiredAttemptStartConflictException.class)
    public AttemptView start(long examId, String firstSection, String username) {
        return start(examId, firstSection, username, false, false);
    }

    /** 超时尝试已由 SAT 服务先评分交卷；保留其结果并继续执行相同的开考资格校验。 */
    @Transactional(noRollbackFor = ExpiredAttemptStartConflictException.class)
    public AttemptView startAfterExpiredSubmission(long examId, String username) {
        return start(examId, null, username, false, true);
    }

    /** 为 SAT/PSAT 学生开放已封存试卷的自助练习；只接受平台内部创建的练习场次。 */
    @Transactional
    public AttemptView startPractice(long examId, String username) {
        return start(examId, null, username, true, false);
    }

    /** 仅为本人可查看答案的 SHSAT 正式尝试建立个人错题练习，不复用教师任务记录。 */
    @Transactional
    public AttemptView startWrongAnswerPractice(long sourceAttemptId, String username) {
        Account student = account(username);
        if (!"STUDENT".equals(student.roleCode())) throw notFound("Attempt not found.");
        AttemptState source = lockOwnedAttempt(sourceAttemptId, student.id());
        if (!"SHSAT".equals(source.examTypeCode()) || source.practice()
                || !List.of("SUBMITTED", "COMPLETED", "EXPIRED").contains(source.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A completed SHSAT exam is required.");
        }
        requireStudentAnswersVisible(sourceAttemptId);

        Long openPracticeId = jdbcTemplate.query("""
            SELECT id FROM attempts WHERE shsat_self_practice_source_attempt_id = ? AND student_user_id = ?
              AND status = 'IN_PROGRESS' ORDER BY started_at DESC, id DESC LIMIT 1
            """, rs -> rs.next() ? rs.getLong(1) : null, sourceAttemptId, student.id());
        if (openPracticeId != null) return getOwnedAttempt(openPracticeId, student.id());

        List<SelfPracticeQuestion> questions = findRemainingWrongQuestions(sourceAttemptId, student.id());
        if (questions.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT, "There are no wrong answers left to practice.");
        List<Integer> numbers = questions.stream().map(SelfPracticeQuestion::displayNumber).toList();
        Integer attemptNo = jdbcTemplate.queryForObject(
            "SELECT COALESCE(MAX(attempt_no), 0) + 1 FROM attempts WHERE exam_id = ? AND student_user_id = ?",
            Integer.class, source.examId(), student.id());
        jdbcTemplate.update("""
            INSERT INTO attempts (exam_id, student_user_id, attempt_no, is_practice,
                shsat_self_practice_source_attempt_id, shsat_self_practice_questions_json, started_at, expires_at)
            SELECT e.id, ?, ?, TRUE, ?, CAST(? AS JSON), CURRENT_TIMESTAMP(6),
                   CASE WHEN COALESCE(e.duration_seconds, p.default_duration_seconds) IS NULL THEN NULL
                        ELSE DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL COALESCE(e.duration_seconds, p.default_duration_seconds) SECOND) END
            FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ?
            """, student.id(), attemptNo, sourceAttemptId, json(objectMapper.valueToTree(numbers)), source.examId());
        Long practiceId = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        List<Object> parameters = new ArrayList<>();
        parameters.add(practiceId);
        questions.forEach(question -> parameters.add(question.paperItemId()));
        String placeholders = String.join(",", java.util.Collections.nCopies(questions.size(), "?"));
        jdbcTemplate.update("""
            INSERT INTO attempt_items (attempt_id, paper_item_id, served_order)
            SELECT ?, pi.id, ROW_NUMBER() OVER (ORDER BY pi.display_number, pi.id)
            FROM paper_items pi WHERE pi.id IN (""" + placeholders + ")", parameters.toArray());
        initializeShsatAttemptState(practiceId, null);
        return getOwnedAttempt(practiceId, student.id());
    }

    /** 返回当前仍需复习的错题编号；没有本人权限或答案尚未开放时不暴露题目数据。 */
    @Transactional(readOnly = true)
    public List<Integer> wrongAnswerQuestionNumbers(long sourceAttemptId, String username) {
        Account student = account(username);
        if (!"STUDENT".equals(student.roleCode())) throw notFound("Attempt not found.");
        AttemptState source = ownedAttemptState(sourceAttemptId, student.id());
        if (!"SHSAT".equals(source.examTypeCode()) || source.practice()
                || !List.of("SUBMITTED", "COMPLETED", "EXPIRED").contains(source.status())) {
            throw notFound("Attempt not found.");
        }
        requireStudentAnswersVisible(sourceAttemptId);
        return findRemainingWrongQuestions(sourceAttemptId, student.id()).stream()
            .map(SelfPracticeQuestion::displayNumber).toList();
    }

    private void requireStudentAnswersVisible(long attemptId) {
        Boolean visible = jdbcTemplate.queryForObject("""
            SELECT e.allow_review AND (e.answer_visibility = 'AFTER_SUBMIT'
                OR (e.answer_visibility = 'AFTER_CLOSE' AND e.closes_at <= CURRENT_TIMESTAMP(6)))
            FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE a.id = ?
            """, Boolean.class, attemptId);
        if (!Boolean.TRUE.equals(visible)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Answers are not available for this exam yet.");
    }

    private List<SelfPracticeQuestion> findRemainingWrongQuestions(long sourceAttemptId, long studentId) {
        return jdbcTemplate.query("""
            SELECT pi.id, pi.display_number
            FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            WHERE ai.attempt_id = ? AND (aa.paper_item_id IS NULL OR aa.is_correct = FALSE)
              AND NOT EXISTS (SELECT 1 FROM shsat_self_practice_cleared_questions cleared
                  WHERE cleared.source_attempt_id = ai.attempt_id AND cleared.student_user_id = ?
                    AND cleared.paper_item_id = pi.id)
            ORDER BY pi.display_number, pi.id
            """, (rs, rowNum) -> new SelfPracticeQuestion(rs.getLong("id"), rs.getInt("display_number")),
            sourceAttemptId, studentId);
    }

    private AttemptView start(long examId, String firstSection, String username, boolean requestedPractice,
                              boolean expiredAttemptWasSubmitted) {
        Account account = account(username);
        long studentId = account.id();
        boolean isStudent = "STUDENT".equals(account.roleCode());
        if (requestedPractice && !isStudent) throw notFound("Practice paper not found.");
        ExamRow exam = jdbcTemplate.query("""
            SELECT e.id, e.paper_id, e.duration_seconds, p.default_duration_seconds,
                   e.attempt_limit, p.exam_type_code,
                   (EXISTS(SELECT 1 FROM sat_practice_papers spp WHERE spp.practice_exam_id = e.id)
                    OR EXISTS(SELECT 1 FROM sat_practice_paper_templates spt WHERE spt.practice_exam_id = e.id)) AS sat_practice
            FROM exams e JOIN papers p ON p.id = e.paper_id
            JOIN exam_types et ON et.code = p.exam_type_code AND et.is_active = TRUE
            WHERE e.id = ? FOR UPDATE
            """, rs -> rs.next() ? new ExamRow(rs.getLong("id"), rs.getLong("paper_id"),
                nullableInt(rs, "duration_seconds"), nullableInt(rs, "default_duration_seconds"),
                rs.getInt("attempt_limit"), rs.getString("exam_type_code"), rs.getBoolean("sat_practice")) : null, examId);
        if (exam == null) throw notFound("Exam not found.");
        if (exam.satPractice() && !requestedPractice) throw notFound("Exam not found.");
        if (requestedPractice && (!exam.satPractice() || !("SAT".equals(exam.examTypeCode()) || "PSAT".equals(exam.examTypeCode())))) {
            throw notFound("Practice paper not found.");
        }
        boolean practice = requestedPractice || !isStudent;
        ExamTypeModule module = registeredModule(exam.examTypeCode());
        if (!module.supportsStudentAttempts() && !(practice && module.supportsStaffPracticeAttempts())) {
            throw notFound("This exam is not available yet.");
        }

        Boolean open = jdbcTemplate.queryForObject("""
            SELECT status = 'PUBLISHED' AND opens_at <= CURRENT_TIMESTAMP(6) AND closes_at > CURRENT_TIMESTAMP(6)
            FROM exams WHERE id = ?
            """, Boolean.class, examId);
        if (practice && !Boolean.TRUE.equals(open)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This exam is not open for practice.");
        }
        if (practice) {
            jdbcTemplate.update("INSERT IGNORE INTO exam_participants (exam_id, student_user_id) VALUES (?, ?)",
                examId, studentId);
        } else {
            Boolean eligible = jdbcTemplate.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM exam_participants WHERE exam_id = ? AND student_user_id = ? AND revoked_at IS NULL)
                """, Boolean.class, examId, studentId);
            if (!Boolean.TRUE.equals(eligible)) throw notFound("Exam not found.");
        }

        int expiredAttempts = expireTimedOutAttempts(examId, studentId, practice);
        Long existingAttempt = jdbcTemplate.query("""
            SELECT id FROM attempts WHERE exam_id = ? AND student_user_id = ? AND status = 'IN_PROGRESS' AND is_practice = ?
                AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(6))
            ORDER BY attempt_no DESC LIMIT 1
            """, rs -> rs.next() ? rs.getLong(1) : null, examId, studentId, practice);
        if (existingAttempt != null) return getOwnedAttempt(existingAttempt, studentId);

        BigDecimal timeMultiplier = "SHSAT".equals(exam.examTypeCode())
            ? jdbcTemplate.query("SELECT time_multiplier FROM shsat_student_accommodations WHERE student_user_id = ?",
                rs -> rs.next() ? rs.getBigDecimal(1) : null, studentId)
            : BigDecimal.ONE;
        Integer durationSeconds = AttemptDurationPolicy.resolve(exam.durationSeconds(), exam.paperDefaultSeconds(),
            timeMultiplier, "SHSAT".equals(exam.examTypeCode()));
        if (durationSeconds == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "This exam has no valid time limit. Contact your administrator before starting.");
        }

        if (!practice) {
            if (!Boolean.TRUE.equals(open)) {
                if (expiredAttempts > 0 || expiredAttemptWasSubmitted) {
                    throw new ExpiredAttemptStartConflictException("This exam is not open for starting.");
                }
                throw new ResponseStatusException(HttpStatus.CONFLICT, "This exam is not open for starting.");
            }

            Integer attemptsUsed = countUsedFormalAttempts(examId, studentId);
            if (attemptsUsed != null && attemptsUsed >= exam.attemptLimit()) {
                if (expiredAttempts > 0 || expiredAttemptWasSubmitted) {
                    throw new ExpiredAttemptStartConflictException("You have used all available attempts for this exam.");
                }
                throw new ResponseStatusException(HttpStatus.CONFLICT, "You have used all available attempts for this exam.");
            }
        }
        Integer latestAttemptNo = jdbcTemplate.queryForObject(
            "SELECT COALESCE(MAX(attempt_no), 0) FROM attempts WHERE exam_id = ? AND student_user_id = ?",
            Integer.class, examId, studentId);
        int attemptNo = latestAttemptNo == null ? 1 : latestAttemptNo + 1;

        Integer questionCount = jdbcTemplate.queryForObject("""
            SELECT COUNT(*) FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE ps.paper_id = ?
            """, Integer.class, exam.paperId());
        if (questionCount == null || questionCount == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This exam does not contain any questions.");
        }
        jdbcTemplate.update("""
            INSERT INTO attempts (exam_id, student_user_id, attempt_no, is_practice, started_at, expires_at)
            SELECT ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CASE WHEN ? IS NULL THEN closes_at
                ELSE LEAST(DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND), closes_at) END
            FROM exams WHERE id = ?
            """, examId, studentId, attemptNo, practice, durationSeconds, durationSeconds, examId);
        Long attemptId = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        jdbcTemplate.update("""
            INSERT INTO attempt_items (attempt_id, paper_item_id, served_order)
            WITH RECURSIVE section_tree AS (
                SELECT id, CAST(LPAD(sort_order, 10, '0') AS CHAR(2000)) AS sort_path
                FROM paper_sections WHERE paper_id = ? AND parent_section_id IS NULL
                UNION ALL
                SELECT child.id, CONCAT(parent.sort_path, '.', LPAD(child.sort_order, 10, '0'))
                FROM paper_sections child JOIN section_tree parent ON child.parent_section_id = parent.id
            )
            SELECT ?, pi.id, ROW_NUMBER() OVER (ORDER BY st.sort_path, pi.sort_order, pi.id)
            FROM section_tree st JOIN paper_items pi ON pi.section_id = st.id
            """, exam.paperId(), attemptId);
        if ("SHSAT".equals(exam.examTypeCode())) initializeShsatAttemptState(attemptId, firstSection);
        return getOwnedAttempt(attemptId, studentId);
    }

    /** 开考重试时先封存超时尝试，避免把已不能作答的记录当作可续考场次。 */
    int expireTimedOutAttempts(long examId, long studentId, boolean practice) {
        return jdbcTemplate.update("""
            UPDATE attempts SET status = 'EXPIRED'
            WHERE exam_id = ? AND student_user_id = ? AND is_practice = ?
              AND status = 'IN_PROGRESS' AND expires_at <= CURRENT_TIMESTAMP(6)
            """, examId, studentId, practice);
    }

    /** 与学生考试列表使用同一套已消耗次数定义，忽略未开始和已取消的导入记录。 */
    int countUsedFormalAttempts(long examId, long studentId) {
        return jdbcTemplate.queryForObject("""
            SELECT COUNT(*) FROM attempts
            WHERE exam_id = ? AND student_user_id = ? AND is_practice = FALSE
              AND status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')
            """, Integer.class, examId, studentId);
    }

    /** 保留刚刚提交的过期状态，同时仍向学生返回正常的 409 冲突。 */
    static final class ExpiredAttemptStartConflictException extends ResponseStatusException {
        ExpiredAttemptStartConflictException(String reason) {
            super(HttpStatus.CONFLICT, reason);
        }
    }

    /** 为已验证的 SHSAT 错题任务创建只含本轮未清除题目的独立练习。 */
    @Transactional
    public AttemptView startWrongAnswerPractice(long assignmentId, Collection<Integer> questionNumbers, String username) {
        Account account = account(username);
        long studentId = account.id();
        if (!"STUDENT".equals(account.roleCode())) throw notFound("Assigned review not found.");
        if (questionNumbers == null || questionNumbers.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "There are no remaining questions to review.");
        }
        List<Integer> numbers = questionNumbers.stream().filter(number -> number != null && number > 0).distinct().sorted().toList();
        if (numbers.isEmpty()) throw new ResponseStatusException(HttpStatus.CONFLICT, "There are no remaining questions to review.");

        Long examId = jdbcTemplate.query("""
            SELECT t.exam_id FROM shsat_wrong_answer_assignments a
            JOIN shsat_wrong_answer_tasks t ON t.id = a.task_id
            WHERE a.id = ? AND a.student_user_id = ?
            """, rs -> rs.next() ? rs.getLong(1) : null, assignmentId, studentId);
        if (examId == null) throw notFound("Assigned review not found.");
        Long activeAttemptId = jdbcTemplate.query("""
            SELECT id FROM attempts
            WHERE shsat_wrong_answer_assignment_id = ? AND status = 'IN_PROGRESS'
            ORDER BY attempt_no DESC LIMIT 1
            """, rs -> rs.next() ? rs.getLong(1) : null, assignmentId);
        if (activeAttemptId != null) return getOwnedAttempt(activeAttemptId, studentId);

        ExamRow exam = jdbcTemplate.query("""
            SELECT e.id, e.paper_id, e.duration_seconds, p.default_duration_seconds,
                   e.attempt_limit, p.exam_type_code
            FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ? FOR UPDATE
            """, rs -> rs.next() ? new ExamRow(rs.getLong("id"), rs.getLong("paper_id"),
                nullableInt(rs, "duration_seconds"), nullableInt(rs, "default_duration_seconds"),
                rs.getInt("attempt_limit"), rs.getString("exam_type_code"), false) : null, examId);
        if (exam == null || !"SHSAT".equals(exam.examTypeCode())) throw notFound("Assigned review not found.");
        Integer durationSeconds = AttemptDurationPolicy.resolve(exam.durationSeconds(), exam.paperDefaultSeconds(),
            jdbcTemplate.query("SELECT time_multiplier FROM shsat_student_accommodations WHERE student_user_id = ?",
                rs -> rs.next() ? rs.getBigDecimal(1) : null, studentId), true);
        if (durationSeconds == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This review has no valid time limit. Contact your administrator.");
        }

        String placeholders = String.join(",", java.util.Collections.nCopies(numbers.size(), "?"));
        List<Object> itemParameters = new ArrayList<>();
        itemParameters.add(exam.paperId());
        itemParameters.addAll(numbers);
        Integer questionCount = jdbcTemplate.queryForObject("""
            SELECT COUNT(*) FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE ps.paper_id = ? AND pi.display_number IN (""" + placeholders + ")", Integer.class, itemParameters.toArray());
        if (questionCount == null || questionCount != numbers.size()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Some assigned review questions are no longer available.");
        }
        jdbcTemplate.update("INSERT IGNORE INTO exam_participants (exam_id, student_user_id) VALUES (?, ?)", examId, studentId);
        Integer latestAttemptNo = jdbcTemplate.queryForObject(
            "SELECT COALESCE(MAX(attempt_no), 0) FROM attempts WHERE exam_id = ? AND student_user_id = ?",
            Integer.class, examId, studentId);
        int attemptNo = latestAttemptNo == null ? 1 : latestAttemptNo + 1;
        jdbcTemplate.update("""
            INSERT INTO attempts (exam_id, student_user_id, attempt_no, is_practice,
                shsat_wrong_answer_assignment_id, shsat_wrong_answer_questions_json, started_at, expires_at)
            VALUES (?, ?, ?, TRUE, ?, CAST(? AS JSON), CURRENT_TIMESTAMP(6), DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND))
            """, examId, studentId, attemptNo, assignmentId, json(objectMapper.valueToTree(numbers)), durationSeconds);
        Long attemptId = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        List<Object> insertParameters = new ArrayList<>();
        insertParameters.add(attemptId);
        insertParameters.add(exam.paperId());
        insertParameters.addAll(numbers);
        jdbcTemplate.update("""
            INSERT INTO attempt_items (attempt_id, paper_item_id, served_order)
            SELECT ?, pi.id, ROW_NUMBER() OVER (ORDER BY pi.display_number, pi.id)
            FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE ps.paper_id = ? AND pi.display_number IN (""" + placeholders + ")", insertParameters.toArray());
        jdbcTemplate.update("UPDATE shsat_wrong_answer_assignments SET practice_attempt_id = ?, status = 'IN_PROGRESS' WHERE id = ?",
            attemptId, assignmentId);
        initializeShsatAttemptState(attemptId, null);
        return getOwnedAttempt(attemptId, studentId);
    }

    public AttemptView get(long attemptId, String username) {
        return getOwnedAttempt(attemptId, account(username).id());
    }

    @Transactional
    public AttemptView submitSection(long attemptId, String username) {
        long studentId = account(username).id();
        AttemptState attempt = lockOwnedAttempt(attemptId, studentId);
        requireInProgress(attempt);
        if (!"SHSAT".equals(attempt.examTypeCode())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Section submission is only available for SHSAT exams.");
        }
        JsonNode state = jdbcTemplate.query("SELECT flow_json FROM shsat_attempt_state WHERE attempt_id = ? FOR UPDATE",
            rs -> rs.next() ? parseNullable(rs.getString(1)) : null, attemptId);
        String current = state == null ? "ELA" : state.path("currentSection").asText("ELA");
        ArrayNode order = state != null && state.path("selectedSectionOrder").isArray()
            ? (ArrayNode) state.path("selectedSectionOrder") : objectMapper.createArrayNode().add("ELA").add("MATH");
        int index = -1;
        for (int i = 0; i < order.size(); i++) if (current.equals(order.get(i).asText())) index = i;
        if (index < 0 || index + 1 >= order.size()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "There is no remaining section to open.");
        }
        String next = order.get(index + 1).asText();
        Integer unanswered = jdbcTemplate.queryForObject("""
            SELECT COUNT(*) FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN paper_sections section ON section.id = pi.section_id
            LEFT JOIN paper_sections parent ON parent.id = section.parent_section_id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            WHERE ai.attempt_id = ? AND COALESCE(parent.section_code, section.section_code) = ? AND aa.paper_item_id IS NULL
            """, Integer.class, attemptId, current);
        if (unanswered != null && unanswered > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Complete this section before submitting.");
        }
        ObjectNode updated = objectMapper.createObjectNode();
        updated.set("selectedSectionOrder", order);
        ArrayNode completed = state != null && state.path("completedSections").isArray()
            ? (ArrayNode) state.path("completedSections") : objectMapper.createArrayNode();
        if (!completed.toString().contains("\"" + current + "\"")) completed.add(current);
        updated.set("completedSections", completed);
        updated.put("currentSection", next);
        updated.set("currentOpenGroup", objectMapper.createObjectNode());
        updated.set("lockedGroups", objectMapper.createArrayNode());
        updated.set("lockedQuestions", objectMapper.createArrayNode());
        jdbcTemplate.update("UPDATE shsat_attempt_state SET active_section_code = ?, flow_json = CAST(? AS JSON) WHERE attempt_id = ?",
            next, json(updated), attemptId);
        return getOwnedAttempt(attemptId, studentId);
    }

    @Transactional
    public void updatePresence(long attemptId, int questionNumber, String username) {
        long studentId = account(username).id();
        AttemptState attempt = lockOwnedAttempt(attemptId, studentId);
        requireInProgress(attempt);
        Long itemId = jdbcTemplate.query("""
            SELECT pi.id FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            WHERE ai.attempt_id = ? AND pi.display_number = ?
            """, rs -> rs.next() ? rs.getLong(1) : null, attemptId, questionNumber);
        if (itemId == null) throw notFound("Question not found in this attempt.");
        updateShsatAttemptState(attemptId, itemId);
    }

    @Transactional
    public int recordFocusViolation(long attemptId, String username) {
        long studentId = account(username).id();
        AttemptState attempt = lockOwnedAttempt(attemptId, studentId);
        requireInProgress(attempt);
        if (!"SHSAT".equals(attempt.examTypeCode())) return 0;
        jdbcTemplate.update("""
            UPDATE shsat_attempt_state SET flow_json = JSON_SET(COALESCE(flow_json, JSON_OBJECT()),
                '$.focusViolationCount', COALESCE(JSON_EXTRACT(flow_json, '$.focusViolationCount'), 0) + 1)
            WHERE attempt_id = ?
            """, attemptId);
        return jdbcTemplate.queryForObject("""
            SELECT COALESCE(JSON_EXTRACT(flow_json, '$.focusViolationCount'), 0)
            FROM shsat_attempt_state WHERE attempt_id = ?
            """, Integer.class, attemptId);
    }

    /** 只接收本次考试快照中的题目 ID；答题内容按 JSON 原样保存。 */
    @Transactional
    public AttemptView saveAnswer(long attemptId, long paperItemId, JsonNode answer, Integer timeSpentSeconds, String username) {
        long studentId = account(username).id();
        AttemptState attempt = lockOwnedAttempt(attemptId, studentId);
        requireInProgress(attempt);
        Boolean expired = jdbcTemplate.queryForObject(
            "SELECT expires_at <= CURRENT_TIMESTAMP(6) FROM attempts WHERE id = ?", Boolean.class, attemptId);
        if (Boolean.TRUE.equals(expired)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The time limit has ended. Submit your saved answers to finish the exam.");
        }
        if ("SAT".equals(attempt.examTypeCode()) || "PSAT".equals(attempt.examTypeCode())) {
            Boolean activeModuleQuestion = jdbcTemplate.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM sat_attempt_state state
                    JOIN paper_items pi ON pi.id = ? AND pi.section_id = state.active_module_section_id
                    JOIN paper_sections section ON section.id = state.active_module_section_id
                    WHERE state.attempt_id = ? AND state.awaiting_break = FALSE
                      AND TIMESTAMPDIFF(SECOND, state.module_started_at, CURRENT_TIMESTAMP(6))
                        < CAST(JSON_UNQUOTE(JSON_EXTRACT(section.settings_json, '$.timeLimitSeconds')) AS UNSIGNED))
                """, Boolean.class, paperItemId, attemptId);
            if (!attempt.practice() && !Boolean.TRUE.equals(activeModuleQuestion)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "This SAT module is locked.");
            }
        }
        Boolean belongs = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM attempt_items WHERE attempt_id = ? AND paper_item_id = ?)
            """, Boolean.class, attemptId, paperItemId);
        if (!Boolean.TRUE.equals(belongs)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Question not found in this attempt.");
        if ("SHSAT".equals(attempt.examTypeCode())) {
            String questionSection = jdbcTemplate.queryForObject("""
                SELECT COALESCE(parent.section_code, section.section_code)
                FROM paper_items pi JOIN paper_sections section ON section.id = pi.section_id
                LEFT JOIN paper_sections parent ON parent.id = section.parent_section_id WHERE pi.id = ?
                """, String.class, paperItemId);
            String currentSection = jdbcTemplate.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(flow_json, '$.currentSection')) FROM shsat_attempt_state WHERE attempt_id = ?",
                rs -> rs.next() ? rs.getString(1) : null, attemptId);
            if (currentSection != null && !currentSection.equalsIgnoreCase(questionSection)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "This question is locked for the current section.");
            }
        }
        jdbcTemplate.update("""
            INSERT INTO attempt_answers (attempt_id, paper_item_id, answer_json, time_spent_seconds)
            VALUES (?, ?, CAST(? AS JSON), ?)
            ON DUPLICATE KEY UPDATE answer_json = VALUES(answer_json),
                time_spent_seconds = time_spent_seconds + VALUES(time_spent_seconds),
                answered_at = CURRENT_TIMESTAMP(6)
            """, attemptId, paperItemId, json(answer), timeSpentSeconds == null ? 0 : timeSpentSeconds);
        if ("SHSAT".equals(attempt.examTypeCode())) updateShsatAttemptState(attemptId, paperItemId);
        return getOwnedAttempt(attemptId, studentId);
    }

    /** 提交时按题目所属考试类型评分；未接入自动评分的题型以零分计入总分。 */
    @Transactional
    public AttemptView submit(long attemptId, String username) {
        long studentId = account(username).id();
        AttemptState attempt = lockOwnedAttempt(attemptId, studentId);
        if ("SUBMITTED".equals(attempt.status())) return getOwnedAttempt(attemptId, studentId);
        if (!attempt.practice() && ("SAT".equals(attempt.examTypeCode()) || "PSAT".equals(attempt.examTypeCode()))) {
            Boolean complete = jdbcTemplate.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM sat_attempt_state state
                    WHERE state.attempt_id = ? AND state.active_module_section_id IS NULL AND state.awaiting_break = FALSE
                      AND JSON_LENGTH(state.completed_modules_json) >= (SELECT COUNT(*) FROM paper_sections
                          WHERE paper_id = ? AND parent_section_id IS NULL))
                """, Boolean.class, attemptId, attempt.paperId());
            if (!Boolean.TRUE.equals(complete)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Complete every SAT module before submitting the exam.");
            }
        }
        ExamTypeModule module = registeredModule(attempt.examTypeCode());
        List<GradingRow> items = jdbcTemplate.query("""
            SELECT ai.paper_item_id, pi.section_id, q.question_type_code, q.answer_key_json,
                   q.render_json, q.grading_json, pi.max_points, aa.answer_json, qm.skill_tag_code
            FROM attempt_items ai
            JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN questions q ON q.id = pi.question_id
            LEFT JOIN shsat_question_metadata qm ON qm.question_id = q.id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            WHERE ai.attempt_id = ? ORDER BY ai.served_order
            """, (rs, rowNum) -> new GradingRow(rs.getLong("paper_item_id"), rs.getLong("section_id"),
                rs.getString("question_type_code"), parse(rs.getString("answer_key_json")),
                parseNullable(rs.getString("render_json")), parseNullable(rs.getString("grading_json")),
                rs.getBigDecimal("max_points"), parseNullable(rs.getString("answer_json")),
                rs.getString("skill_tag_code")), attemptId);
        Map<Long, PaperSection> sections = loadPaperSections(attempt.paperId());
        Map<String, BreakdownAccumulator> resultBreakdowns = new LinkedHashMap<>();

        BigDecimal total = BigDecimal.ZERO;
        BigDecimal maximum = BigDecimal.ZERO;
        int ungradedCount = 0;
        ArrayNode breakdown = objectMapper.createArrayNode();
        for (GradingRow item : items) {
            Boolean correct = module.grade(item.questionTypeCode(), item.answerKey(), item.answer(),
                item.render(), item.grading());
            if (correct == null) ungradedCount++;
            BigDecimal points = Boolean.TRUE.equals(correct) ? item.maxPoints() : BigDecimal.ZERO;
            total = total.add(points);
            maximum = maximum.add(item.maxPoints());
            jdbcTemplate.update("""
                UPDATE attempt_answers SET is_correct = ?, awarded_points = ?
                WHERE attempt_id = ? AND paper_item_id = ?
                """, correct, points, attemptId, item.paperItemId());
            ObjectNode result = breakdown.addObject();
            result.put("paperItemId", item.paperItemId());
            if (correct == null) result.putNull("isCorrect"); else result.put("isCorrect", correct);
            result.put("awardedPoints", points);
            result.put("maxPoints", item.maxPoints());
            addSectionBreakdowns(resultBreakdowns, sections, sections.get(item.sectionId()),
                points, item.maxPoints(), correct);
            addSkillBreakdown(resultBreakdowns, sections.get(item.sectionId()), item.skillTagCode(),
                points, item.maxPoints(), correct);
        }
        ResultProfile profile = loadResultProfile(attemptId);
        jdbcTemplate.update("""
            INSERT INTO attempt_results
                (attempt_id, scoring_profile_id, algorithm_version, total_points, max_points,
                 ungraded_count, breakdown_schema_version, is_estimated, breakdown_json)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, CAST(? AS JSON))
            """, attemptId, profile.id(), profile.version(), total, maximum, ungradedCount,
            profile.estimated(), json(breakdown));
        persistResultBreakdowns(attemptId, sections, resultBreakdowns);
        jdbcTemplate.update("UPDATE attempts SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP(6) WHERE id = ?", attemptId);
        updateWrongAnswerAssignmentStatus(attemptId);
        clearCorrectSelfPracticeQuestions(attemptId, studentId);
        return getOwnedAttempt(attemptId, studentId);
    }

    private void clearCorrectSelfPracticeQuestions(long attemptId, long studentId) {
        jdbcTemplate.update("""
            INSERT IGNORE INTO shsat_self_practice_cleared_questions
                (source_attempt_id, student_user_id, paper_item_id)
            SELECT practice.shsat_self_practice_source_attempt_id, practice.student_user_id, answer.paper_item_id
            FROM attempts practice JOIN attempt_answers answer ON answer.attempt_id = practice.id
            WHERE practice.id = ? AND practice.shsat_self_practice_source_attempt_id IS NOT NULL
              AND practice.student_user_id = ? AND answer.is_correct = TRUE
            """, attemptId, studentId);
    }

    private void updateWrongAnswerAssignmentStatus(long attemptId) {
        Long assignmentId = jdbcTemplate.query("SELECT shsat_wrong_answer_assignment_id FROM attempts WHERE id = ?",
            rs -> rs.next() ? nullableLong(rs, "shsat_wrong_answer_assignment_id") : null, attemptId);
        if (assignmentId == null) return;
        String taskStatus = jdbcTemplate.queryForObject("""
            SELECT t.status FROM shsat_wrong_answer_assignments a
            JOIN shsat_wrong_answer_tasks t ON t.id = a.task_id WHERE a.id = ?
            """, String.class, assignmentId);
        Boolean hasRemaining = jdbcTemplate.queryForObject("""
            SELECT EXISTS(
                SELECT 1 FROM shsat_wrong_answer_assignments assignment,
                JSON_TABLE(assignment.question_numbers_json, '$[*]' COLUMNS (question_number INT PATH '$')) assigned
                WHERE assignment.id = ? AND NOT EXISTS (
                    SELECT 1 FROM attempts practice
                    JOIN attempt_items ai ON ai.attempt_id = practice.id
                    JOIN paper_items pi ON pi.id = ai.paper_item_id
                    JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
                    WHERE practice.shsat_wrong_answer_assignment_id = assignment.id
                      AND practice.status IN ('SUBMITTED', 'COMPLETED', 'EXPIRED')
                      AND JSON_CONTAINS(practice.shsat_wrong_answer_questions_json, JSON_ARRAY(assigned.question_number))
                      AND pi.display_number = assigned.question_number AND aa.is_correct = TRUE
                )
            )
            """, Boolean.class, assignmentId);
        String status = Boolean.TRUE.equals(hasRemaining)
            ? ("ENDED".equals(taskStatus) ? "ENDED" : "RETRY_REQUIRED") : "COMPLETED";
        jdbcTemplate.update("UPDATE shsat_wrong_answer_assignments SET status = ? WHERE id = ?", status, assignmentId);
    }

    private AttemptView getOwnedAttempt(long attemptId, long studentId) {
        OwnedAttemptSummary owned = jdbcTemplate.query("""
            SELECT a.id, a.exam_id, a.status, a.is_practice, a.started_at, a.expires_at, a.submitted_at,
                   e.title AS exam_title, e.paper_id, p.exam_type_code, r.total_points, r.max_points, r.graded_at,
                   e.auto_submit, e.allow_review, state.flow_json,
                   (a.status = 'SUBMITTED' AND r.ungraded_count = 0 AND (e.score_visibility = 'AFTER_SUBMIT'
                    OR (e.score_visibility = 'AFTER_CLOSE' AND e.closes_at <= CURRENT_TIMESTAMP(6)))) AS result_visible
            FROM attempts a JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            LEFT JOIN shsat_attempt_state state ON state.attempt_id = a.id
            WHERE a.id = ? AND a.student_user_id = ?
            """, rs -> rs.next() ? new OwnedAttemptSummary(new AttemptView(rs.getLong("id"), rs.getLong("exam_id"),
                rs.getLong("paper_id"), rs.getString("exam_title"), rs.getString("exam_type_code"), rs.getString("status"),
                rs.getBoolean("auto_submit"), rs.getBoolean("is_practice"),
                iso(rs.getTimestamp("started_at")), iso(rs.getTimestamp("expires_at")),
                iso(rs.getTimestamp("submitted_at")), List.of(),
                rs.getBoolean("result_visible") ? new AttemptResultView(rs.getBigDecimal("total_points"),
                    rs.getBigDecimal("max_points"), iso(rs.getTimestamp("graded_at"))) : null,
                parseNullable(rs.getString("flow_json"))),
                rs.getBoolean("allow_review"), parseNullable(rs.getString("flow_json"))) : null,
            attemptId, studentId);
        if (owned == null) throw notFound("Attempt not found.");
        AttemptView summary = owned.view();
        if ("SUBMITTED".equals(summary.status()) && !owned.allowReview()) {
            return summary;
        }
        List<AttemptQuestion> questions = jdbcTemplate.query("""
            SELECT ai.paper_item_id, q.question_type_code, q.payload_schema_version, q.stem, q.render_json,
                   pi.display_number, pi.max_points, section.section_code, section.title AS section_title,
                   parent.section_code AS parent_section_code, parent.title AS parent_section_title,
                   aa.answer_json, sm.id AS sat_material_id, sm.title AS sat_material_title,
                   sm.material_type AS sat_material_type, sm.content AS sat_material_content,
                   sm.file_url AS sat_material_file_url
            FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN questions q ON q.id = pi.question_id
            JOIN paper_sections section ON section.id = pi.section_id
            LEFT JOIN paper_sections parent ON parent.id = section.parent_section_id
            LEFT JOIN attempt_answers aa ON aa.attempt_id = ai.attempt_id AND aa.paper_item_id = ai.paper_item_id
            LEFT JOIN sat_question_materials sqm ON sqm.question_id = q.id
            LEFT JOIN sat_materials sm ON sm.id = sqm.material_id
            WHERE ai.attempt_id = ? ORDER BY ai.served_order
            """, (rs, rowNum) -> {
                JsonNode display = parseNullable(rs.getString("render_json"));
                if (rs.getObject("sat_material_id") != null) {
                    ObjectNode enrichedDisplay = display != null && display.isObject()
                        ? ((ObjectNode) display).deepCopy() : objectMapper.createObjectNode();
                    ObjectNode material = objectMapper.createObjectNode();
                    material.put("title", rs.getString("sat_material_title"));
                    material.put("type", rs.getString("sat_material_type"));
                    material.put("content", rs.getString("sat_material_content"));
                    material.put("assetUrl", rs.getString("sat_material_file_url"));
                    enrichedDisplay.set("material", material);
                    display = enrichedDisplay;
                }
                return new AttemptQuestion(rs.getLong("paper_item_id"), rs.getString("question_type_code"),
                    rs.getInt("payload_schema_version"), rs.getString("stem"), display,
                    (Integer) rs.getObject("display_number"), rs.getString("section_code"), rs.getString("section_title"),
                    rs.getString("parent_section_code"), rs.getString("parent_section_title"),
                    rs.getBigDecimal("max_points"), parseNullable(rs.getString("answer_json")));
            }, attemptId);
        return new AttemptView(summary.id(), summary.examId(), summary.paperId(), summary.examTitle(), summary.examTypeCode(), summary.status(),
            summary.autoSubmit(), summary.practice(), summary.startedAt(), summary.expiresAt(), summary.submittedAt(), questions,
            summary.result(), summary.progressState());
    }

    private AttemptState lockOwnedAttempt(long attemptId, long studentId) {
        AttemptState state = jdbcTemplate.query("""
            SELECT a.status, a.is_practice, a.exam_id, p.exam_type_code, p.id AS paper_id FROM attempts a
            JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            WHERE a.id = ? AND a.student_user_id = ? FOR UPDATE
            """, rs -> rs.next() ? new AttemptState(rs.getString("status"), rs.getBoolean("is_practice"),
                rs.getLong("exam_id"), rs.getString("exam_type_code"), rs.getLong("paper_id")) : null,
            attemptId, studentId);
        if (state == null) throw notFound("Attempt not found.");
        return state;
    }

    private AttemptState ownedAttemptState(long attemptId, long studentId) {
        AttemptState state = jdbcTemplate.query("""
            SELECT a.status, a.is_practice, a.exam_id, p.exam_type_code, p.id AS paper_id FROM attempts a
            JOIN exams e ON e.id = a.exam_id JOIN papers p ON p.id = e.paper_id
            WHERE a.id = ? AND a.student_user_id = ?
            """, rs -> rs.next() ? new AttemptState(rs.getString("status"), rs.getBoolean("is_practice"),
                rs.getLong("exam_id"), rs.getString("exam_type_code"), rs.getLong("paper_id")) : null,
            attemptId, studentId);
        if (state == null) throw notFound("Attempt not found.");
        return state;
    }

    private void requireInProgress(AttemptState state) {
        if (!"IN_PROGRESS".equals(state.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This attempt has already been submitted.");
        }
    }

    private void initializeShsatAttemptState(long attemptId, String firstSection) {
        jdbcTemplate.update("""
            INSERT INTO shsat_attempt_state
                (attempt_id, active_section_code, active_question_number, section_started_at, remaining_seconds)
            SELECT a.id, COALESCE(?, COALESCE(parent.section_code, ps.section_code)), pi.display_number, CURRENT_TIMESTAMP(6),
                   GREATEST(0, TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(6), a.expires_at))
            FROM attempts a
            JOIN attempt_items ai ON ai.attempt_id = a.id
            JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN paper_sections ps ON ps.id = pi.section_id
            LEFT JOIN paper_sections parent ON parent.id = ps.parent_section_id
            WHERE a.id = ? ORDER BY ai.served_order LIMIT 1
            """, firstSection, attemptId);
        List<String> sectionOrder = jdbcTemplate.query("""
            SELECT COALESCE(parent.section_code, section.section_code) AS section_code
            FROM attempt_items ai JOIN paper_items pi ON pi.id = ai.paper_item_id
            JOIN paper_sections section ON section.id = pi.section_id
            LEFT JOIN paper_sections parent ON parent.id = section.parent_section_id
            WHERE ai.attempt_id = ? GROUP BY COALESCE(parent.section_code, section.section_code)
            ORDER BY MIN(section.sort_order)
            """, (rs, rowNum) -> rs.getString("section_code"), attemptId);
        String selected = firstSection == null || firstSection.isBlank()
            ? sectionOrder.stream().findFirst().orElse("ELA") : firstSection.toUpperCase();
        ArrayNode order = objectMapper.createArrayNode().add(selected);
        sectionOrder.stream().filter(code -> !code.equalsIgnoreCase(selected)).forEach(order::add);
        ObjectNode flow = objectMapper.createObjectNode();
        flow.set("selectedSectionOrder", order);
        flow.put("currentSection", selected);
        flow.set("completedSections", objectMapper.createArrayNode());
        flow.set("currentOpenGroup", objectMapper.createObjectNode());
        flow.set("lockedGroups", objectMapper.createArrayNode());
        flow.set("lockedQuestions", objectMapper.createArrayNode());
        jdbcTemplate.update("UPDATE shsat_attempt_state SET flow_json = CAST(? AS JSON), active_section_code = ? WHERE attempt_id = ?",
            json(flow), selected, attemptId);
    }

    private void updateShsatAttemptState(long attemptId, long paperItemId) {
        jdbcTemplate.update("""
            INSERT INTO shsat_attempt_state
                (attempt_id, active_section_code, active_question_number, section_started_at, remaining_seconds)
            SELECT a.id, ps.section_code, pi.display_number, CURRENT_TIMESTAMP(6),
                   GREATEST(0, TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP(6), a.expires_at))
            FROM attempts a JOIN paper_items pi ON pi.id = ?
            JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE a.id = ?
            ON DUPLICATE KEY UPDATE active_section_code = VALUES(active_section_code),
                active_question_number = VALUES(active_question_number),
                section_started_at = CURRENT_TIMESTAMP(6), remaining_seconds = VALUES(remaining_seconds)
            """, paperItemId, attemptId);
    }

    private Account account(String username) {
        Account account = jdbcTemplate.query("""
            SELECT id, role_code FROM users
            WHERE username = ? AND role_code IN ('STUDENT', 'ADMIN', 'TEACHER') AND status = 'ACTIVE'
            """, rs -> rs.next() ? new Account(rs.getLong("id"), rs.getString("role_code")) : null, username);
        if (account == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Active account required.");
        return account;
    }

    private ExamTypeModule registeredModule(String code) {
        return examTypeRegistry.module(code)
            .orElseThrow(() -> notFound("This exam is not available yet."));
    }

    private Map<Long, PaperSection> loadPaperSections(long paperId) {
        return jdbcTemplate.query("""
            SELECT id, parent_section_id, section_code, section_kind, title, sort_order
            FROM paper_sections WHERE paper_id = ? ORDER BY sort_order, id
            """, rs -> {
                Map<Long, PaperSection> sections = new HashMap<>();
                while (rs.next()) {
                    long id = rs.getLong("id");
                    sections.put(id, new PaperSection(id, nullableLong(rs, "parent_section_id"),
                        rs.getString("section_code"), rs.getString("section_kind"), rs.getString("title"),
                        rs.getInt("sort_order")));
                }
                return sections;
            }, paperId);
    }

    private ResultProfile loadResultProfile(long attemptId) {
        return jdbcTemplate.query("""
            SELECT sp.id, sp.profile_code, sp.version_no, sp.is_estimated
            FROM attempts a JOIN exams e ON e.id = a.exam_id
            LEFT JOIN scoring_profiles sp ON sp.id = e.scoring_profile_id
            WHERE a.id = ?
            """, rs -> {
                if (!rs.next()) return new ResultProfile(null, null, false);
                Long id = nullableLong(rs, "id");
                if (id == null) return new ResultProfile(null, null, false);
                return new ResultProfile(id, rs.getString("profile_code") + ":v" + rs.getInt("version_no"),
                    rs.getBoolean("is_estimated"));
            }, attemptId);
    }

    private void addSectionBreakdowns(Map<String, BreakdownAccumulator> totals,
                                      Map<Long, PaperSection> sections, PaperSection section,
                                      BigDecimal points, BigDecimal maximum, Boolean correct) {
        PaperSection current = section;
        while (current != null) {
            PaperSection dimension = current;
            PaperSection parent = dimension.parentId() == null ? null : sections.get(dimension.parentId());
            BreakdownAccumulator total = totals.computeIfAbsent(dimension.code(), ignored ->
                new BreakdownAccumulator(dimension.code(), parent == null ? null : parent.code(),
                    dimension.kind(), dimension.title(), dimension.sortOrder()));
            total.add(points, maximum, correct);
            current = parent;
        }
    }

    private void addSkillBreakdown(Map<String, BreakdownAccumulator> totals, PaperSection section,
                                   String skillTagCode, BigDecimal points, BigDecimal maximum, Boolean correct) {
        if (section == null || skillTagCode == null || skillTagCode.isBlank()) return;
        String code = section.code() + "::" + skillTagCode.trim();
        BreakdownAccumulator total = totals.computeIfAbsent(code, ignored ->
            new BreakdownAccumulator(code, section.code(), "SKILL_TAG", skillTagCode.trim(), section.sortOrder()));
        total.add(points, maximum, correct);
    }

    private void persistResultBreakdowns(long attemptId, Map<Long, PaperSection> sections,
                                         Map<String, BreakdownAccumulator> totals) {
        List<BreakdownAccumulator> ordered = new ArrayList<>(totals.values());
        ordered.sort(Comparator.<BreakdownAccumulator>comparingInt(value -> breakdownDepth(value, sections))
            .thenComparingInt(value -> value.sortOrder));
        for (BreakdownAccumulator value : ordered) {
            ObjectNode metrics = objectMapper.createObjectNode();
            metrics.put("correctCount", value.correctCount);
            metrics.put("incorrectCount", value.incorrectCount);
            metrics.put("ungradedCount", value.ungradedCount);
            jdbcTemplate.update("""
                INSERT INTO attempt_result_breakdowns
                    (attempt_id, breakdown_code, parent_breakdown_code, dimension_kind, display_name,
                     sort_order, raw_score, raw_max_score, metrics_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
                """, attemptId, value.code, value.parentCode, value.kind, value.name, value.sortOrder,
                value.score, value.maximum, json(metrics));
        }
    }

    private int breakdownDepth(BreakdownAccumulator value, Map<Long, PaperSection> sections) {
        int depth = 0;
        String parentCode = value.parentCode;
        while (parentCode != null) {
            depth++;
            PaperSection parent = null;
            for (PaperSection section : sections.values()) {
                if (section.code().equals(parentCode)) {
                    parent = section;
                    break;
                }
            }
            parentCode = parent == null || parent.parentId() == null ? null
                : sections.get(parent.parentId()).code();
        }
        return depth;
    }

    private String json(JsonNode value) {
        try { return objectMapper.writeValueAsString(value); }
        catch (JsonProcessingException exception) { throw new IllegalArgumentException("Answer must be valid JSON.", exception); }
    }

    private JsonNode parse(String value) {
        try { return objectMapper.readTree(value); }
        catch (JsonProcessingException exception) { throw new IllegalStateException("Stored question data is invalid.", exception); }
    }

    private JsonNode parseNullable(String value) {
        return value == null ? null : parse(value);
    }

    private Long nullableLong(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).longValue();
    }

    private Integer nullableInt(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).intValue();
    }

    private String iso(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    private ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }

    private record Account(long id, String roleCode) { }
    private record ExamRow(long id, long paperId, Integer durationSeconds, Integer paperDefaultSeconds,
                           int attemptLimit, String examTypeCode, boolean satPractice) { }
    private record AttemptState(String status, boolean practice, long examId, String examTypeCode, long paperId) { }
    private record SelfPracticeQuestion(long paperItemId, int displayNumber) { }
    private record OwnedAttemptSummary(AttemptView view, boolean allowReview, JsonNode progressState) { }
    private record GradingRow(long paperItemId, long sectionId, String questionTypeCode, JsonNode answerKey,
                              JsonNode render, JsonNode grading, BigDecimal maxPoints, JsonNode answer,
                              String skillTagCode) { }
    private record PaperSection(long id, Long parentId, String code, String kind, String title, int sortOrder) { }
    private record ResultProfile(Long id, String version, boolean estimated) { }
    private static final class BreakdownAccumulator {
        private final String code;
        private final String parentCode;
        private final String kind;
        private final String name;
        private final int sortOrder;
        private BigDecimal score = BigDecimal.ZERO;
        private BigDecimal maximum = BigDecimal.ZERO;
        private int correctCount;
        private int incorrectCount;
        private int ungradedCount;

        private BreakdownAccumulator(String code, String parentCode, String kind, String name, int sortOrder) {
            this.code = code;
            this.parentCode = parentCode;
            this.kind = kind;
            this.name = name;
            this.sortOrder = sortOrder;
        }

        private void add(BigDecimal points, BigDecimal maxPoints, Boolean correct) {
            score = score.add(points);
            maximum = maximum.add(maxPoints);
            if (correct == null) ungradedCount++;
            else if (correct) correctCount++;
            else incorrectCount++;
        }
    }
    public record AttemptQuestion(long paperItemId, String questionTypeCode, int payloadSchemaVersion,
                                  String stem, JsonNode display, Integer displayNumber,
                                  String sectionCode, String sectionTitle, String parentSectionCode,
                                  String parentSectionTitle, BigDecimal maxPoints, JsonNode answer) { }
    public record AttemptView(long id, long examId, long paperId, String examTitle, String examTypeCode, String status,
                              boolean autoSubmit, boolean practice,
                              String startedAt, String expiresAt, String submittedAt,
                              List<AttemptQuestion> questions, AttemptResultView result, JsonNode progressState) { }
    public record AttemptResultView(BigDecimal totalPoints, BigDecimal maxPoints, String gradedAt) { }
}
