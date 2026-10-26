package com.unifiedexam.platform.paper;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** 管理试卷元数据和规范化题目结构；类型专属结构校验由考试模块后续补入。 */
@Service
public class PaperService {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final ExamTypeRegistry examTypeRegistry;

    public PaperService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper, ExamTypeRegistry examTypeRegistry) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.examTypeRegistry = examTypeRegistry;
    }

    public List<PaperSummary> list(String examTypeCode) {
        requireActiveType(examTypeCode);
        return jdbcTemplate.query("""
            SELECT p.id, p.exam_type_code, p.group_id, g.name AS group_name, p.paper_code, p.version_no,
                   p.source_paper_id,
                   EXISTS(SELECT 1 FROM exams e WHERE e.paper_id = p.id) AS used_by_exam,
                   p.title, p.status, p.default_duration_seconds,
                   (SELECT COUNT(*) FROM paper_sections section WHERE section.paper_id = p.id) AS section_count,
                   (SELECT COUNT(*) FROM paper_items item JOIN paper_sections section ON section.id = item.section_id
                    WHERE section.paper_id = p.id) AS question_count,
                   p.created_at, p.updated_at
            FROM papers p LEFT JOIN paper_groups g ON g.id = p.group_id
            WHERE p.exam_type_code = ? ORDER BY p.updated_at DESC, p.id DESC
            """, (rs, rowNum) -> new PaperSummary(rs.getLong("id"), rs.getString("exam_type_code"),
                nullableLong(rs, "group_id"), rs.getString("group_name"), rs.getString("paper_code"),
                rs.getInt("version_no"), nullableLong(rs, "source_paper_id"), rs.getBoolean("used_by_exam"),
                rs.getString("title"), rs.getString("status"),
                nullableInt(rs, "default_duration_seconds"),
                rs.getInt("section_count"), rs.getInt("question_count"),
                rs.getTimestamp("created_at").toInstant().toString(), rs.getTimestamp("updated_at").toInstant().toString()), examTypeCode);
    }

    @Transactional
    public PaperDetail create(String examTypeCode, CreatePaperRequest request, String actorUsername) {
        requireActiveType(examTypeCode);
        requireMatchingGroup(examTypeCode, request.groupId());
        long creatorId = userId(actorUsername);
        String paperCode = request.paperCode() == null || request.paperCode().isBlank()
            ? generatePaperCode() : request.paperCode().trim();
        int nextVersion = nextVersion(examTypeCode, paperCode);
        long paperId = insertPaper(examTypeCode, request.groupId(), paperCode, nextVersion,
            request.title(), request.description(), request.defaultDurationSeconds(), null, creatorId);
        if (isSatWorkspaceType(examTypeCode)) {
            jdbcTemplate.update("INSERT INTO sat_paper_settings (paper_id, scoring_table_code) VALUES (?, ?)",
                paperId, "PSAT".equals(examTypeCode) ? "PSAT" : "SAT");
        }
        return get(paperId);
    }

    private String generatePaperCode() {
        return "PAPER_" + UUID.randomUUID().toString().replace("-", "").toUpperCase(Locale.ROOT);
    }

    public PaperDetail get(long paperId) {
        PaperSummary summary = summary(paperId);
        String description = jdbcTemplate.queryForObject("SELECT description FROM papers WHERE id = ?", String.class, paperId);
        Long groupId = jdbcTemplate.queryForObject("SELECT group_id FROM papers WHERE id = ?", Long.class, paperId);
        String scoringProfileCode = jdbcTemplate.queryForObject("""
            SELECT sp.profile_code FROM papers p LEFT JOIN scoring_profiles sp ON sp.id = p.default_scoring_profile_id
            WHERE p.id = ?
            """, String.class, paperId);
        List<SectionView> sections = loadSections(paperId, null);
        return new PaperDetail(summary, description, groupId, scoringProfileCode, sections);
    }

    @Transactional
    public PaperDetail update(long paperId, UpdatePaperRequest request) {
        String examTypeCode = typeCode(paperId);
        requireEditable(paperId, examTypeCode);
        requireMatchingGroup(examTypeCode, request.groupId());
        jdbcTemplate.update("""
            UPDATE papers SET title = ?, description = ?, group_id = ?, default_duration_seconds = ?
            WHERE id = ?
            """, request.title(), request.description(), request.groupId(), request.defaultDurationSeconds(), paperId);
        return get(paperId);
    }

    @Transactional
    public PaperSummary moveToGroup(long paperId, Long groupId) {
        requireMatchingGroup(typeCode(paperId), groupId);
        jdbcTemplate.update("UPDATE papers SET group_id = ? WHERE id = ?", groupId, paperId);
        return summary(paperId);
    }

    @Transactional
    public PaperSummary setArchived(long paperId, boolean archived) {
        if (!isSatWorkspaceType(typeCode(paperId))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Archive status is only managed in the SAT workspace.");
        }
        String currentStatus = jdbcTemplate.query("SELECT status FROM papers WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, paperId);
        if (currentStatus == null) throw notFound();
        if ("DRAFT".equals(currentStatus)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Seal a draft paper before archiving it.");
        }
        String targetStatus = archived ? "ARCHIVED" : "READY";
        jdbcTemplate.update("UPDATE papers SET status = ? WHERE id = ?", targetStatus, paperId);
        return summary(paperId);
    }

    /** 从同类型已发布考试复制题目，按 section_code 对齐目标试卷结构。 */
    @Transactional
    public List<QuestionView> importQuestions(long targetPaperId, ImportQuestionsRequest request) {
        requireEditable(targetPaperId, typeCode(targetPaperId));
        long sourcePaperId = jdbcTemplate.query("""
            SELECT e.paper_id FROM exams e WHERE e.id = ? AND e.status = 'PUBLISHED'
                AND (SELECT exam_type_code FROM papers WHERE id = e.paper_id) = ?
            """, rs -> rs.next() ? rs.getLong(1) : 0L, request.sourceExamId(), typeCode(targetPaperId));
        if (sourcePaperId == 0L) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Source exam not found.");
        if (sourcePaperId == targetPaperId) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Create a new paper version before importing questions from the same paper.");
        }
        List<Integer> requested = request.questionNumbers().stream().distinct().toList();
        if (requested.size() != request.questionNumbers().size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A question is selected more than once.");
        }
        Map<Integer, QuestionView> sourceByNumber = new HashMap<>();
        flatten(loadSections(sourcePaperId, null)).forEach(question -> {
            int number = question.displayNumber() == null ? question.sortOrder() : question.displayNumber();
            sourceByNumber.put(number, question);
        });
        List<QuestionView> selected = requested.stream().map(sourceByNumber::get).toList();
        if (selected.stream().anyMatch(java.util.Objects::isNull)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "One or more selected questions are unavailable.");
        }
        Map<String, Long> targetSections = new HashMap<>();
        flattenSections(loadSections(targetPaperId, null)).forEach(section -> targetSections.put(section.sectionCode(), section.id()));
        int nextDisplayNumber = flatten(loadSections(targetPaperId, null)).stream()
            .map(QuestionView::displayNumber).filter(java.util.Objects::nonNull).mapToInt(Integer::intValue).max().orElse(0) + 1;
        List<Long> insertedIds = new ArrayList<>();
        for (int index = 0; index < selected.size(); index++) {
            QuestionView source = selected.get(index);
            Long sectionId = targetSections.get(sectionCode(sourcePaperId, source.paperItemId()));
            if (sectionId == null) throw new ResponseStatusException(HttpStatus.CONFLICT, "The target paper is missing a matching section.");
            Integer sortOrder = jdbcTemplate.queryForObject("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM paper_items WHERE section_id = ?", Integer.class, sectionId);
            long importedId = insertQuestion(sectionId, new QuestionRequest(source.questionTypeCode(), source.stem(), source.render(),
                source.answerKey(), source.grading(), source.explanation(), source.categoryId(), sortOrder,
                nextDisplayNumber + index, source.maxPoints(), source.scoringSectionCode(), source.payloadSchemaVersion()));
            insertedIds.add(importedId);
        }
        List<QuestionView> all = flatten(loadSections(targetPaperId, null));
        return all.stream().filter(question -> insertedIds.contains(question.questionId())).toList();
    }

    private List<QuestionView> flatten(List<SectionView> sections) {
        List<QuestionView> result = new ArrayList<>();
        for (SectionView section : sections) {
            result.addAll(section.questions());
            result.addAll(flatten(section.children()));
        }
        return result;
    }

    private List<SectionView> flattenSections(List<SectionView> sections) {
        List<SectionView> result = new ArrayList<>();
        for (SectionView section : sections) {
            result.add(section);
            result.addAll(flattenSections(section.children()));
        }
        return result;
    }

    private String sectionCode(long paperId, long paperItemId) {
        return jdbcTemplate.query("""
            SELECT ps.section_code FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE ps.paper_id = ? AND pi.id = ?
            """, rs -> rs.next() ? rs.getString(1) : null, paperId, paperItemId);
    }

    @Transactional
    public PaperDetail updateScoringProfile(long paperId, String profileCode) {
        requireDraft(paperId);
        if (!"SHSAT".equals(typeCode(paperId))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Scoring profiles can only be changed for SHSAT papers.");
        }
        Long profileId = jdbcTemplate.query("""
            SELECT id FROM scoring_profiles WHERE exam_type_code = 'SHSAT' AND profile_code = ?
            ORDER BY version_no DESC LIMIT 1
            """, rs -> rs.next() ? rs.getLong(1) : null, profileCode);
        if (profileId == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Select an available SHSAT scoring profile.");
        jdbcTemplate.update("UPDATE papers SET default_scoring_profile_id = ? WHERE id = ?", profileId, paperId);
        return get(paperId);
    }

    /** 用新结构覆盖草稿结构；问题答案键只通过管理员接口返回。 */
    @Transactional
    public PaperDetail saveStructure(long paperId, SaveStructureRequest request) {
        requireEditable(paperId, typeCode(paperId));
        validateSectionOrders(request.sections());
        List<Long> oldQuestionIds = jdbcTemplate.query("""
            SELECT DISTINCT pi.question_id FROM paper_items pi
            JOIN paper_sections ps ON ps.id = pi.section_id WHERE ps.paper_id = ?
            """, (rs, rowNum) -> rs.getLong(1), paperId);
        jdbcTemplate.update("""
            DELETE pi FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE ps.paper_id = ?
            """, paperId);
        jdbcTemplate.update("DELETE FROM paper_sections WHERE paper_id = ?", paperId);
        for (Long questionId : oldQuestionIds) {
            jdbcTemplate.update("DELETE FROM questions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM paper_items WHERE question_id = ?)",
                questionId, questionId);
        }
        for (SectionRequest section : request.sections()) {
            insertSection(paperId, null, section);
        }
        return get(paperId);
    }

    /** 创建下一版本并复制完整结构；SAT/PSAT 继承源状态，SHSAT 保留草稿流程。 */
    @Transactional
    public PaperDetail createVersion(long sourcePaperId, String actorUsername) {
        PaperDetail source = get(sourcePaperId);
        requireActiveType(source.summary().examTypeCode());
        String code = source.summary().paperCode();
        int nextVersion = nextVersion(source.summary().examTypeCode(), code);
        long newPaperId = insertPaper(source.summary().examTypeCode(), source.groupId(), code, nextVersion,
            source.summary().title(), source.description(), source.summary().defaultDurationSeconds(),
            sourcePaperId, userId(actorUsername));
        saveStructure(newPaperId, new SaveStructureRequest(source.sections().stream().map(this::toRequest).toList()));
        if (isSatWorkspaceType(source.summary().examTypeCode())) {
            copySatPaperExtensions(sourcePaperId, newPaperId);
            if (!"DRAFT".equals(source.summary().status())) {
                jdbcTemplate.update("UPDATE papers SET status = ?, sealed_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
                    source.summary().status(), newPaperId);
            }
        }
        return get(newPaperId);
    }

    private void copySatPaperExtensions(long sourcePaperId, long newPaperId) {
        jdbcTemplate.update("""
            INSERT INTO sat_paper_settings (paper_id, scoring_table_code, adaptive_mode, rest_time_seconds, settings_json)
            SELECT ?, scoring_table_code, adaptive_mode, rest_time_seconds, settings_json
            FROM sat_paper_settings WHERE paper_id = ?
            """, newPaperId, sourcePaperId);
        jdbcTemplate.update("""
            INSERT INTO sat_question_materials (question_id, material_id, material_ref)
            SELECT new_item.question_id, link.material_id, link.material_ref
            FROM paper_sections old_section
            JOIN paper_items old_item ON old_item.section_id = old_section.id
            JOIN sat_question_materials link ON link.question_id = old_item.question_id
            JOIN paper_sections new_section ON new_section.paper_id = ?
                AND new_section.section_code = old_section.section_code
            JOIN paper_items new_item ON new_item.section_id = new_section.id
                AND new_item.sort_order = old_item.sort_order
            WHERE old_section.paper_id = ?
            """, newPaperId, sourcePaperId);
    }

    @Transactional
    public PaperDetail seal(long paperId) {
        requireDraft(paperId);
        String examTypeCode = typeCode(paperId);
        requireActiveType(examTypeCode);
        Integer sectionCount = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM paper_sections WHERE paper_id = ?", Integer.class, paperId);
        Integer itemCount = jdbcTemplate.queryForObject("""
            SELECT COUNT(*) FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id WHERE ps.paper_id = ?
            """, Integer.class, paperId);
        if (sectionCount == null || sectionCount == 0 || itemCount == null || itemCount == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Add at least one section and one question before sealing this paper.");
        }
        jdbcTemplate.update("""
            UPDATE questions q JOIN paper_items pi ON pi.question_id = q.id
            JOIN paper_sections ps ON ps.id = pi.section_id
            SET q.sealed_at = COALESCE(q.sealed_at, CURRENT_TIMESTAMP(6)) WHERE ps.paper_id = ?
            """, paperId);
        jdbcTemplate.update("UPDATE papers SET status = 'READY', sealed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", paperId);
        return get(paperId);
    }

    public PaperDeleteImpact deleteImpact(long paperId) {
        PaperSummary paper = summary(paperId);
        return new PaperDeleteImpact(paperId, paper.title(), count("SELECT COUNT(*) FROM exams WHERE paper_id = ?", paperId),
            count("SELECT COUNT(*) FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE e.paper_id = ?", paperId),
            count("SELECT COUNT(*) FROM paper_sections WHERE paper_id = ? AND section_kind = 'PART'", paperId),
            count("SELECT COUNT(*) FROM paper_sections WHERE paper_id = ? AND section_kind = 'SUBTYPE'", paperId),
            count("SELECT COUNT(*) FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id WHERE ps.paper_id = ?", paperId),
            count("SELECT COUNT(*) FROM shsat_section_materials sm JOIN paper_sections ps ON ps.id = sm.section_id WHERE ps.paper_id = ?", paperId),
            count("SELECT COUNT(*) FROM shsat_paper_solutions WHERE paper_id = ?", paperId));
    }

    @Transactional
    public void delete(long paperId) {
        if (!isSatWorkspaceType(typeCode(paperId))) requireDraft(paperId);
        PaperDeleteImpact impact = deleteImpact(paperId);
        if (impact.examCount() > 0 || impact.attemptCount() > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A paper used by an exam or exam record cannot be deleted.");
        }
        Long dependentVersions = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM papers WHERE source_paper_id = ?", Long.class, paperId);
        if (dependentVersions != null && dependentVersions > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Deletion is unavailable while newer paper versions depend on this paper.");
        }
        List<Long> questionIds = jdbcTemplate.query("""
            SELECT DISTINCT pi.question_id FROM paper_items pi
            JOIN paper_sections ps ON ps.id = pi.section_id WHERE ps.paper_id = ?
            """, (rs, rowNum) -> rs.getLong(1), paperId);
        // 先删除子题型分组，避免父子分组的 RESTRICT 外键阻止试卷级联删除。
        jdbcTemplate.update("DELETE FROM paper_sections WHERE paper_id = ? AND parent_section_id IS NOT NULL", paperId);
        jdbcTemplate.update("DELETE FROM papers WHERE id = ?", paperId);
        for (Long questionId : questionIds) {
            jdbcTemplate.update("DELETE FROM questions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM paper_items WHERE question_id = ?)",
                questionId, questionId);
        }
    }

    private long count(String sql, long paperId) {
        Long value = jdbcTemplate.queryForObject(sql, Long.class, paperId);
        return value == null ? 0 : value;
    }

    public List<PaperGroupView> listGroups(String examTypeCode) {
        requireActiveType(examTypeCode);
        return jdbcTemplate.query("""
            SELECT g.id, g.exam_type_code, g.name, g.description, g.sort_order,
                   (SELECT COUNT(*) FROM papers p WHERE p.group_id = g.id) AS paper_count
            FROM paper_groups g WHERE g.exam_type_code = ? ORDER BY g.sort_order, g.name
            """, (rs, rowNum) -> new PaperGroupView(rs.getLong("id"), rs.getString("exam_type_code"),
                rs.getString("name"), rs.getString("description"), rs.getInt("sort_order"), rs.getInt("paper_count")), examTypeCode);
    }

    @Transactional
    public PaperGroupView createGroup(String examTypeCode, SaveGroupRequest request) {
        requireActiveType(examTypeCode);
        try {
            jdbcTemplate.update("INSERT INTO paper_groups (exam_type_code, name, description, sort_order) VALUES (?, ?, ?, ?)",
                examTypeCode, request.name(), request.description(), request.sortOrder());
        } catch (org.springframework.dao.DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A paper group with that name already exists.");
        }
        Long id = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return new PaperGroupView(id, examTypeCode, request.name(), request.description(), request.sortOrder(), 0);
    }

    @Transactional
    public PaperGroupView updateGroup(long groupId, SaveGroupRequest request) {
        String typeCode = groupType(groupId);
        try {
            jdbcTemplate.update("UPDATE paper_groups SET name = ?, description = ?, sort_order = ? WHERE id = ?",
                request.name(), request.description(), request.sortOrder(), groupId);
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A paper group with that name already exists.");
        }
        return group(groupId, typeCode);
    }

    @Transactional
    public void deleteGroup(long groupId) {
        Integer paperCount = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM papers WHERE group_id = ?", Integer.class, groupId);
        if (paperCount == null || paperCount == 0) {
            int deleted = jdbcTemplate.update("DELETE FROM paper_groups WHERE id = ?", groupId);
            if (deleted == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Paper group not found.");
            return;
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Move papers out of this group before deleting it.");
    }

    @Transactional
    public List<PaperGroupView> reorderGroups(String examTypeCode, ReorderGroupsRequest request) {
        requireActiveType(examTypeCode);
        List<Long> existing = jdbcTemplate.query("SELECT id FROM paper_groups WHERE exam_type_code = ? ORDER BY id",
            (rs, rowNum) -> rs.getLong(1), examTypeCode);
        if (existing.size() != request.paperGroupIds().size()
                || !new java.util.HashSet<>(existing).equals(new java.util.HashSet<>(request.paperGroupIds()))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The group order must include every group exactly once.");
        }
        for (int i = 0; i < request.paperGroupIds().size(); i++) {
            jdbcTemplate.update("UPDATE paper_groups SET sort_order = ? WHERE id = ?", i, request.paperGroupIds().get(i));
        }
        return listGroups(examTypeCode);
    }

    /** SAT 工作区跨 SAT/PSAT 保存统一顺序，避免各类型独立排序后出现相同序号。 */
    @Transactional
    public void reorderWorkspaceGroups(String workspaceCode, ReorderWorkspaceGroupsRequest request) {
        List<String> typeCodes = examTypeRegistry.listAvailableTypes().stream()
            .filter(type -> type.workspaceCode().equals(workspaceCode))
            .map(ExamTypeDefinition::code)
            .toList();
        if (typeCodes.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Workspace not found.");
        typeCodes.forEach(this::requireActiveType);

        Map<GroupReferenceKey, WorkspaceGroupRow> existing = new HashMap<>();
        for (String typeCode : typeCodes) {
            jdbcTemplate.query("SELECT id, exam_type_code, name FROM paper_groups WHERE exam_type_code = ?",
                (RowCallbackHandler) rs -> {
                    String groupTypeCode = rs.getString("exam_type_code");
                    existing.put(new GroupReferenceKey(groupTypeCode, rs.getLong("id")),
                        new WorkspaceGroupRow(groupTypeCode, rs.getString("name")));
                }, typeCode);
        }

        Set<GroupReferenceKey> submitted = new HashSet<>();
        Set<String> submittedNames = new HashSet<>();
        for (int sortOrder = 0; sortOrder < request.groups().size(); sortOrder++) {
            WorkspaceGroupOrder order = request.groups().get(sortOrder);
            if (order.groups() == null || order.groups().isEmpty()) {
                throw invalidWorkspaceGroupOrder("Each folder must reference at least one exam type.");
            }

            String mergedName = null;
            Set<String> includedTypes = new HashSet<>();
            for (WorkspaceGroupReference reference : order.groups()) {
                GroupReferenceKey key = new GroupReferenceKey(reference.examTypeCode(), reference.groupId());
                WorkspaceGroupRow group = existing.get(key);
                if (group == null) {
                    throw invalidWorkspaceGroupOrder("A folder references a group outside this workspace.");
                }
                if (!submitted.add(key)) throw invalidWorkspaceGroupOrder("A group is listed more than once.");
                if (!includedTypes.add(group.examTypeCode())) {
                    throw invalidWorkspaceGroupOrder("A folder cannot contain multiple groups of the same exam type.");
                }
                String normalizedName = normalizeGroupName(group.name());
                if (mergedName != null && !mergedName.equals(normalizedName)) {
                    throw invalidWorkspaceGroupOrder("Groups combined in one folder must have the same name.");
                }
                mergedName = normalizedName;
            }
            if (!submittedNames.add(mergedName)) {
                throw invalidWorkspaceGroupOrder("A folder name is listed more than once.");
            }
            for (WorkspaceGroupReference reference : order.groups()) {
                jdbcTemplate.update("UPDATE paper_groups SET sort_order = ? WHERE id = ? AND exam_type_code = ?",
                    sortOrder, reference.groupId(), reference.examTypeCode());
            }
        }
        if (submitted.size() != existing.size()) {
            throw invalidWorkspaceGroupOrder("The order must include every group in the workspace exactly once.");
        }
    }

    private String normalizeGroupName(String name) {
        return name.trim().toLowerCase(Locale.ROOT);
    }

    private ResponseStatusException invalidWorkspaceGroupOrder(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    private PaperGroupView group(long groupId, String typeCode) {
        return jdbcTemplate.query("""
            SELECT g.id, g.exam_type_code, g.name, g.description, g.sort_order,
                   (SELECT COUNT(*) FROM papers p WHERE p.group_id = g.id) AS paper_count
            FROM paper_groups g WHERE g.id = ?
            """,
            rs -> rs.next() ? new PaperGroupView(rs.getLong("id"), typeCode, rs.getString("name"),
                rs.getString("description"), rs.getInt("sort_order"), rs.getInt("paper_count")) : null, groupId);
    }

    private String groupType(long groupId) {
        String typeCode = jdbcTemplate.query("SELECT exam_type_code FROM paper_groups WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, groupId);
        if (typeCode == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Paper group not found.");
        return typeCode;
    }

    private void insertSection(long paperId, Long parentId, SectionRequest section) {
        GeneratedKeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO paper_sections
                    (paper_id, parent_section_id, section_code, section_kind, title, sort_order, instructions, settings_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
                """, Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, paperId);
            if (parentId == null) statement.setNull(2, java.sql.Types.BIGINT); else statement.setLong(2, parentId);
            statement.setString(3, section.sectionCode());
            statement.setString(4, section.sectionKind());
            statement.setString(5, section.title());
            statement.setInt(6, section.sortOrder());
            statement.setString(7, section.instructions());
            statement.setString(8, json(section.settings()));
            return statement;
        }, keyHolder);
        long sectionId = keyHolder.getKey().longValue();

        for (QuestionRequest question : section.questions()) {
            validateCategory(sectionId, question.categoryId());
            insertQuestion(sectionId, question);
        }
        for (SectionRequest child : section.children()) {
            insertSection(paperId, sectionId, child);
        }
    }

    private long insertQuestion(long sectionId, QuestionRequest question) {
        GeneratedKeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO questions
                    (question_type_code, payload_schema_version, stem, render_json, answer_key_json, grading_json, explanation)
                VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?)
                """, Statement.RETURN_GENERATED_KEYS);
            statement.setString(1, question.questionTypeCode());
            statement.setInt(2, question.payloadSchemaVersion() == null ? 1 : question.payloadSchemaVersion());
            statement.setString(3, question.stem());
            statement.setString(4, json(question.render()));
            statement.setString(5, json(question.answerKey()));
            statement.setString(6, json(question.grading()));
            statement.setString(7, question.explanation());
            return statement;
        }, keyHolder);
        long questionId = keyHolder.getKey().longValue();
        String typeCode = jdbcTemplate.query("""
            SELECT p.exam_type_code FROM paper_sections ps JOIN papers p ON p.id = ps.paper_id WHERE ps.id = ?
            """, rs -> rs.next() ? rs.getString(1) : null, sectionId);
        String skillTagCode = question.render() == null ? null
            : question.render().path("questionConfig").path("shsatSkillTag").path("skillCode").asText(null);
        if ("SHSAT".equals(typeCode) && skillTagCode != null && !skillTagCode.isBlank()) {
            jdbcTemplate.update("""
                INSERT INTO shsat_question_metadata (question_id, skill_tag_code)
                VALUES (?, ?)
                """, questionId, skillTagCode);
        }
        jdbcTemplate.update("""
            INSERT INTO paper_items (section_id, question_id, category_id, sort_order, display_number, max_points, scoring_section_code)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, sectionId, questionId, question.categoryId(), question.sortOrder(), question.displayNumber(),
            question.maxPoints(), question.scoringSectionCode());
        return questionId;
    }

    private List<SectionView> loadSections(long paperId, Long parentId) {
        List<SectionRow> rows = jdbcTemplate.query(parentId == null ? """
            SELECT id, section_code, section_kind, title, sort_order, instructions, settings_json
            FROM paper_sections WHERE paper_id = ? AND parent_section_id IS NULL ORDER BY sort_order, id
            """ : """
            SELECT id, section_code, section_kind, title, sort_order, instructions, settings_json
            FROM paper_sections WHERE paper_id = ? AND parent_section_id = ? ORDER BY sort_order, id
            """, (rs, rowNum) -> new SectionRow(rs.getLong("id"), rs.getString("section_code"),
                rs.getString("section_kind"), rs.getString("title"), rs.getInt("sort_order"),
                rs.getString("instructions"), readJson(rs.getString("settings_json"))),
            parentId == null ? new Object[]{paperId} : new Object[]{paperId, parentId});
        List<SectionView> sections = new ArrayList<>(rows.size());
        for (SectionRow row : rows) {
            sections.add(new SectionView(row.id(), row.sectionCode(), row.sectionKind(), row.title(), row.sortOrder(),
                row.instructions(), row.settings(), loadItems(row.id()), loadSections(paperId, row.id())));
        }
        return sections;
    }

    private List<QuestionView> loadItems(long sectionId) {
        return jdbcTemplate.query("""
            SELECT q.id AS question_id, pi.id AS paper_item_id, q.question_type_code, q.payload_schema_version,
                   q.stem, q.render_json, q.answer_key_json, q.grading_json,
                   q.explanation, pi.category_id, pi.sort_order, pi.display_number, pi.max_points, pi.scoring_section_code
            FROM paper_items pi JOIN questions q ON q.id = pi.question_id
            WHERE pi.section_id = ? ORDER BY pi.sort_order, pi.id
            """, (rs, rowNum) -> new QuestionView(rs.getLong("question_id"), rs.getLong("paper_item_id"),
                rs.getString("question_type_code"), rs.getInt("payload_schema_version"), rs.getString("stem"),
                readJson(rs.getString("render_json")), readJson(rs.getString("answer_key_json")),
                readJson(rs.getString("grading_json")), rs.getString("explanation"),
                nullableLong(rs, "category_id"), rs.getInt("sort_order"),
                (Integer) rs.getObject("display_number"), rs.getBigDecimal("max_points"),
                rs.getString("scoring_section_code")), sectionId);
    }

    private SectionRequest toRequest(SectionView section) {
        return new SectionRequest(section.sectionCode(), section.sectionKind(), section.title(), section.sortOrder(),
            section.instructions(), section.settings(), section.questions().stream().map(this::toRequest).toList(),
            section.children().stream().map(this::toRequest).toList());
    }

    private QuestionRequest toRequest(QuestionView question) {
        return new QuestionRequest(question.questionTypeCode(), question.stem(), question.render(), question.answerKey(),
            question.grading(), question.explanation(), question.categoryId(), question.sortOrder(),
            question.displayNumber(), question.maxPoints(), question.scoringSectionCode(), question.payloadSchemaVersion());
    }

    private long insertPaper(String typeCode, Long groupId, String paperCode, int versionNo, String title,
                             String description, Integer duration, Long sourceId, long creatorId) {
        try {
            jdbcTemplate.update("""
                INSERT INTO papers (exam_type_code, group_id, paper_code, version_no, title, description,
                                    default_duration_seconds, source_paper_id, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, typeCode, groupId, paperCode, versionNo, title, description, duration, sourceId, creatorId);
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A paper with this code and version already exists.");
        }
        return jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    private PaperSummary summary(long paperId) {
        List<PaperSummary> result = jdbcTemplate.query("""
            SELECT p.id, p.exam_type_code, p.group_id, g.name AS group_name, p.paper_code, p.version_no,
                   p.source_paper_id,
                   EXISTS(SELECT 1 FROM exams e WHERE e.paper_id = p.id) AS used_by_exam,
                   p.title, p.status, p.default_duration_seconds,
                   (SELECT COUNT(*) FROM paper_sections section WHERE section.paper_id = p.id) AS section_count,
                   (SELECT COUNT(*) FROM paper_items item JOIN paper_sections section ON section.id = item.section_id
                    WHERE section.paper_id = p.id) AS question_count,
                   p.created_at, p.updated_at
            FROM papers p LEFT JOIN paper_groups g ON g.id = p.group_id WHERE p.id = ?
            """, (rs, rowNum) -> new PaperSummary(rs.getLong("id"), rs.getString("exam_type_code"),
                nullableLong(rs, "group_id"), rs.getString("group_name"), rs.getString("paper_code"),
                rs.getInt("version_no"), nullableLong(rs, "source_paper_id"), rs.getBoolean("used_by_exam"),
                rs.getString("title"), rs.getString("status"),
                nullableInt(rs, "default_duration_seconds"),
                rs.getInt("section_count"), rs.getInt("question_count"),
                rs.getTimestamp("created_at").toInstant().toString(), rs.getTimestamp("updated_at").toInstant().toString()), paperId);
        if (result.isEmpty()) throw notFound();
        return result.get(0);
    }

    private int nextVersion(String typeCode, String paperCode) {
        Integer highest = jdbcTemplate.queryForObject(
            "SELECT COALESCE(MAX(version_no), 0) FROM papers WHERE exam_type_code = ? AND paper_code = ?",
            Integer.class, typeCode, paperCode);
        return (highest == null ? 0 : highest) + 1;
    }

    private long userId(String username) {
        Long id = jdbcTemplate.query("SELECT id FROM users WHERE username = ? AND status = 'ACTIVE'",
            rs -> rs.next() ? rs.getLong(1) : null, username);
        if (id == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Your account is no longer active.");
        return id;
    }

    private String typeCode(long paperId) {
        String code = jdbcTemplate.query("SELECT exam_type_code FROM papers WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, paperId);
        if (code == null) throw notFound();
        return code;
    }

    private boolean isSatWorkspaceType(String code) {
        return "SAT".equals(code) || "PSAT".equals(code);
    }

    private void requireActiveType(String code) {
        boolean installed = examTypeRegistry.listAvailableTypes().stream().anyMatch(type -> type.code().equals(code));
        Boolean active = jdbcTemplate.queryForObject("SELECT is_active FROM exam_types WHERE code = ?", Boolean.class, code);
        if (!installed || !Boolean.TRUE.equals(active)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "This exam type is unavailable.");
        }
    }

    private void requireMatchingGroup(String typeCode, Long groupId) {
        if (groupId == null) return;
        Boolean matches = jdbcTemplate.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM paper_groups WHERE id = ? AND exam_type_code = ?)
            """, Boolean.class, groupId, typeCode);
        if (!Boolean.TRUE.equals(matches)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The paper group does not belong to this exam type.");
    }

    private void validateSectionOrders(List<SectionRequest> sections) {
        java.util.Set<Integer> siblingOrders = new java.util.HashSet<>();
        for (SectionRequest section : sections) {
            if (!siblingOrders.add(section.sortOrder())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Section order values must be unique among siblings.");
            }
            java.util.Set<Integer> questionOrders = new java.util.HashSet<>();
            for (QuestionRequest question : section.questions()) {
                if (!questionOrders.add(question.sortOrder())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Question order values must be unique within a section.");
                }
            }
            validateSectionOrders(section.children());
        }
    }

    private void validateCategory(long sectionId, Long categoryId) {
        if (categoryId == null) return;
        Boolean matches = jdbcTemplate.queryForObject("""
            SELECT EXISTS(
                SELECT 1 FROM paper_sections ps
                JOIN papers p ON p.id = ps.paper_id
                JOIN question_categories qc ON qc.id = ? AND qc.exam_type_code = p.exam_type_code
                WHERE ps.id = ?
            )
            """, Boolean.class, categoryId, sectionId);
        if (!Boolean.TRUE.equals(matches)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The question category does not belong to this exam type.");
        }
    }

    private void requireDraft(long paperId) {
        String status = jdbcTemplate.query("SELECT status FROM papers WHERE id = ?", rs -> rs.next() ? rs.getString(1) : null, paperId);
        if (status == null) throw notFound();
        if (!"DRAFT".equals(status)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Only draft papers can be changed.");
    }

    /** SAT/PSAT 已就绪版本在尚未被考试引用时可编辑；SHSAT 继续遵守草稿封存规则。 */
    private void requireEditable(long paperId, String examTypeCode) {
        if (!isSatWorkspaceType(examTypeCode)) {
            requireDraft(paperId);
            return;
        }
        String status = jdbcTemplate.query("SELECT status FROM papers WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, paperId);
        if ("DRAFT".equals(status)) return;
        Boolean usedByExam = jdbcTemplate.queryForObject(
            "SELECT EXISTS(SELECT 1 FROM exams WHERE paper_id = ?)", Boolean.class, paperId);
        if (!"READY".equals(status) || Boolean.TRUE.equals(usedByExam)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "This paper version is locked. Create a new version before editing it.");
        }
    }

    private Long nullableLong(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).longValue();
    }

    private Integer nullableInt(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        Object value = rs.getObject(column);
        return value == null ? null : ((Number) value).intValue();
    }

    private String json(JsonNode value) {
        if (value == null || value.isNull()) return null;
        try { return objectMapper.writeValueAsString(value); }
        catch (JsonProcessingException exception) { throw new IllegalArgumentException("Invalid JSON value.", exception); }
    }

    private JsonNode readJson(String value) {
        if (value == null) return null;
        try { return objectMapper.readTree(value); }
        catch (JsonProcessingException exception) { throw new IllegalStateException("The saved paper contains invalid JSON.", exception); }
    }

    private ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Paper not found.");
    }

    public record CreatePaperRequest(@Size(max = 80) String paperCode,
                                     @NotBlank @Size(max = 200) String title,
                                     @Size(max = 2000) String description,
                                     Long groupId,
                                     @Positive Integer defaultDurationSeconds) { }

    public record UpdatePaperRequest(@NotBlank @Size(max = 200) String title,
                                     @Size(max = 2000) String description,
                                     Long groupId,
                                     @Positive Integer defaultDurationSeconds) { }

    public record SaveGroupRequest(@NotBlank @Size(max = 100) String name, @Size(max = 500) String description,
                                   @PositiveOrZero int sortOrder) { }
    public record ReorderGroupsRequest(@NotNull List<@Positive Long> paperGroupIds) { }
    public record ReorderWorkspaceGroupsRequest(@NotNull List<@NotNull @Valid WorkspaceGroupOrder> groups) { }
    public record WorkspaceGroupOrder(@NotNull List<@NotNull @Valid WorkspaceGroupReference> groups) { }
    public record WorkspaceGroupReference(@NotBlank @Size(max = 32) String examTypeCode,
                                          @Positive long groupId) { }
    public record SaveStructureRequest(@NotNull @Valid List<SectionRequest> sections) { }
    public record ImportQuestionsRequest(@NotNull Long sourceExamId,
            @NotNull @Size(min = 1, max = 100) List<@NotNull @Positive Integer> questionNumbers) { }
    public record SectionRequest(@NotBlank @Size(max = 60) String sectionCode,
                                @NotBlank @Size(max = 30) String sectionKind,
                                @NotBlank @Size(max = 200) String title,
                                @PositiveOrZero int sortOrder,
                                String instructions,
                                JsonNode settings,
                                @NotNull @Valid List<QuestionRequest> questions,
                                @NotNull @Valid List<SectionRequest> children) { }
    public record QuestionRequest(@NotBlank @Size(max = 50) String questionTypeCode,
                                  @NotBlank String stem,
                                  JsonNode render,
                                  @NotNull JsonNode answerKey,
                                  JsonNode grading,
                                  String explanation,
                                  Long categoryId,
                                  @PositiveOrZero int sortOrder,
                                  Integer displayNumber,
                                  @NotNull @DecimalMin("0.0") BigDecimal maxPoints,
                                  @Size(max = 30) String scoringSectionCode,
                                  @Positive Integer payloadSchemaVersion) { }
    public record PaperSummary(long id, String examTypeCode, Long groupId, String groupName,
                               String paperCode, int versionNo, Long sourcePaperId, boolean usedByExam, String title,
                               String status, Integer defaultDurationSeconds, int sectionCount, int questionCount,
                               String createdAt, String updatedAt) { }
    public record PaperDetail(PaperSummary summary, String description, Long groupId, String scoringProfileCode,
                              List<SectionView> sections) { }
    public record SectionView(long id, String sectionCode, String sectionKind, String title, int sortOrder,
                              String instructions, JsonNode settings, List<QuestionView> questions,
                              List<SectionView> children) { }
    public record QuestionView(long questionId, long paperItemId, String questionTypeCode, int payloadSchemaVersion,
                               String stem, JsonNode render, JsonNode answerKey,
                               JsonNode grading, String explanation, Long categoryId, int sortOrder,
                               Integer displayNumber, BigDecimal maxPoints, String scoringSectionCode) { }
    public record PaperGroupView(long id, String examTypeCode, String name, String description, int sortOrder,
                                 int paperCount) { }
    public record PaperDeleteImpact(long paperId, String paperName, long examCount, long attemptCount,
                                    long partCount, long subTypeCount, long questionCount,
                                    long materialCount, long solutionCount) { }
    private record SectionRow(long id, String sectionCode, String sectionKind, String title, int sortOrder,
                              String instructions, JsonNode settings) { }
    private record GroupReferenceKey(String examTypeCode, long groupId) { }
    private record WorkspaceGroupRow(String examTypeCode, String name) { }
}
