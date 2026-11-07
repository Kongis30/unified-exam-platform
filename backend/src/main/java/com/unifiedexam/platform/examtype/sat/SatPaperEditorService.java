package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** SAT 编辑数据适配到共享试卷与题目主表，同时保留 SAT 专属模块、材料和题目字段。 */
@Service
public class SatPaperEditorService {

    private static final List<Stage> STAGES = List.of(
        new Stage("RW", "Reading and Writing", 1), new Stage("MATH", "Math", 3));

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public SatPaperEditorService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public PaperStructure structure(long paperId) {
        requireSatPaper(paperId);
        PaperRow paper = paper(paperId);
        List<ModuleView> modules = jdbc.query("""
            SELECT id, section_code, title, sort_order, instructions, settings_json
            FROM paper_sections WHERE paper_id = ? AND parent_section_id IS NULL
            ORDER BY sort_order, id
            """, (rs, row) -> {
            JsonNode settings = readJson(rs.getString("settings_json"));
            String subject = settings.path("subject").asText("RW");
            int order = settings.path("moduleNumber").asInt(subject.equals("RW")
                ? rs.getInt("sort_order") + 1 : rs.getInt("sort_order") - 1);
            Long id = rs.getLong("id");
            List<QuestionView> questions = listQuestions(id);
            return new ModuleView(id, rs.getString("title"), rs.getString("section_code"),
                subject.equals("RW") ? "fixed" : "adaptive", rs.getString("instructions"),
                questions.size(), questions.stream().mapToInt(q -> q.score().intValue()).sum(),
                settings.path("timeLimitSeconds").asInt(subject.equals("RW") ? 1920 : 2100) / 60,
                order + (subject.equals("RW") ? 0 : 2), subject.equals("RW") ? 1 : 2,
                order, settings.path("moduleDifficulty").asText("Mid"), questions, List.of());
        }, paperId);
        List<StageView> stages = STAGES.stream().map(stage -> new StageView(stage.name(), stage.code(), "",
            modules.stream().filter(module -> (module.subjectCode() == 1 ? "RW" : "MATH").equals(stage.code())).toList()))
            .filter(stage -> !stage.modules().isEmpty()).toList();
        return new PaperStructure(paper.id(), paper.title(), paper.description(), paper.status(), stages);
    }

    public QuestionDetail question(long paperId, long questionId) {
        requireSatPaper(paperId);
        return jdbc.query("""
            SELECT q.id, q.stem, q.render_json, q.answer_key_json, q.grading_json, q.explanation,
                   s.settings_json, sm.id AS material_id, sm.title AS material_title,
                   sm.material_type, sm.content AS material_content, sm.file_url, sqm.material_ref
            FROM paper_items pi JOIN paper_sections s ON s.id = pi.section_id
            JOIN questions q ON q.id = pi.question_id
            LEFT JOIN sat_question_materials sqm ON sqm.question_id = q.id
            LEFT JOIN sat_materials sm ON sm.id = sqm.material_id
            WHERE s.paper_id = ? AND q.id = ?
            """, rs -> {
            if (!rs.next()) throw notFound("SAT question not found.");
            JsonNode render = readJson(rs.getString("render_json"));
            JsonNode sat = render.path("sat");
            JsonNode answer = readJson(rs.getString("answer_key_json"));
            JsonNode grading = readJson(rs.getString("grading_json"));
            Map<String, String> options = toStringMap(render.path("options"));
            MaterialDetail material = rs.getObject("material_id") == null ? null
                : new MaterialDetail(rs.getLong("material_id"), rs.getString("material_title"),
                    rs.getString("material_type"), rs.getString("material_content"), rs.getString("file_url"), null, null);
            String correctAnswer = answer.path("correctAnswer").asText("");
            return new QuestionDetail(rs.getLong("id"), sat.path("subject").asText(
                readJson(rs.getString("settings_json")).path("subject").asText("RW")),
                sat.path("typeId").asLong(1), sat.path("typeName").asText("Multiple Choice"),
                rs.getObject("material_id") == null ? null : rs.getLong("material_id"), rs.getString("material_ref"),
                rs.getString("stem"), options, correctAnswer, sat.path("difficulty").asText("Medium"),
                grading.path("score").decimalValue().compareTo(BigDecimal.ZERO) == 0
                    ? BigDecimal.ONE : grading.path("score").decimalValue(),
                sat.path("tags").asText(""), rs.getString("explanation"), material);
        }, paperId, questionId);
    }

    @Transactional
    public long createQuestion(long paperId, QuestionWrite request) {
        requireEditableSatPaper(paperId);
        SectionRow section = section(paperId, request.moduleId());
        ObjectNode render = questionRender(request, section.settings());
        JsonNode answer = mapper.createObjectNode().put("correctAnswer", request.correctAnswer());
        JsonNode grading = mapper.createObjectNode().put("score", request.score());
        long id = insertQuestion(section.id(), request, render, answer, grading, section.code());
        updateMaterialLink(id, request.materialId(), request.materialRef());
        return id;
    }

    @Transactional
    public void updateQuestion(long paperId, long questionId, QuestionWrite request) {
        requireEditableSatPaper(paperId);
        SectionRow section = section(paperId, request.moduleId());
        Boolean belongs = jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
                WHERE ps.paper_id = ? AND pi.question_id = ?)
            """, Boolean.class, paperId, questionId);
        if (!Boolean.TRUE.equals(belongs)) throw notFound("SAT question not found.");
        jdbc.update("""
            UPDATE questions SET stem = ?, render_json = CAST(? AS JSON), answer_key_json = CAST(? AS JSON),
                grading_json = CAST(? AS JSON), explanation = ? WHERE id = ?
            """, request.content(), json(questionRender(request, section.settings())),
            json(mapper.createObjectNode().put("correctAnswer", request.correctAnswer())),
            json(mapper.createObjectNode().put("score", request.score())), request.analysis(), questionId);
        jdbc.update("UPDATE paper_items SET max_points = ?, scoring_section_code = ? WHERE question_id = ?",
            request.score(), section.code(), questionId);
        updateMaterialLink(questionId, request.materialId(), request.materialRef());
    }

    @Transactional
    public void deleteQuestion(long paperId, long questionId) {
        requireEditableSatPaper(paperId);
        int deleted = jdbc.update("""
            DELETE pi FROM paper_items pi JOIN paper_sections s ON s.id = pi.section_id
            WHERE s.paper_id = ? AND pi.question_id = ?
            """, paperId, questionId);
        if (deleted == 0) throw notFound("SAT question not found.");
        jdbc.update("DELETE FROM questions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM paper_items WHERE question_id = ?)",
            questionId, questionId);
    }

    @Transactional
    public long createModule(long paperId, ModuleWrite request) {
        requireEditableSatPaper(paperId);
        if (!List.of("RW", "Math").contains(request.subject()) || request.moduleType() == null
                || request.moduleType() < 1 || request.moduleType() > 2) {
            throw badRequest("Choose a valid SAT subject and module number.");
        }
        String subjectCode = request.subject().equals("RW") ? "RW" : "MATH";
        String code = subjectCode + request.moduleType();
        Boolean exists = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM paper_sections WHERE paper_id = ? AND section_code = ?)",
            Boolean.class, paperId, code);
        if (Boolean.TRUE.equals(exists)) throw new ResponseStatusException(HttpStatus.CONFLICT, "This SAT module already exists.");
        JsonNode settings = mapper.createObjectNode().put("subject", request.subject())
            .put("moduleNumber", request.moduleType()).put("moduleDifficulty", request.moduleDifficulty() == null ? "Mid" : request.moduleDifficulty())
            .put("timeLimitSeconds", (request.timeLimit() == null ? 32 : request.timeLimit()) * 60);
        int order = request.sortOrder() - 1;
        jdbc.update("""
            INSERT INTO paper_sections (paper_id, section_code, section_kind, title, sort_order, instructions, settings_json)
            VALUES (?, ?, 'MODULE', ?, ?, ?, CAST(? AS JSON))
            """, paperId, code, request.moduleName(), order, request.description(), json(settings));
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    @Transactional
    public void reorderQuestions(long paperId, long moduleId, List<Long> questionIds) {
        requireEditableSatPaper(paperId);
        if (section(paperId, moduleId) == null) throw notFound("SAT module not found.");
        List<Long> current = jdbc.query("SELECT question_id FROM paper_items WHERE section_id = ? ORDER BY sort_order, id",
            (rs, row) -> rs.getLong(1), moduleId);
        if (current.size() != questionIds.size() || !new java.util.HashSet<>(current).equals(new java.util.HashSet<>(questionIds))) {
            throw badRequest("The question order must include every question in this module exactly once.");
        }
        if (questionIds.isEmpty()) return;

        // 先将顺序整体移到当前最大值之后，避开唯一索引上的中间态冲突，再写入最终顺序。
        Integer maxOrder = jdbc.queryForObject(
            "SELECT COALESCE(MAX(sort_order), -1) FROM paper_items WHERE section_id = ?", Integer.class, moduleId);
        long temporaryOffset = (maxOrder == null ? -1L : maxOrder.longValue()) + current.size() + 1L;
        jdbc.update("UPDATE paper_items SET sort_order = sort_order + ? WHERE section_id = ?",
            temporaryOffset, moduleId);
        for (int index = 0; index < questionIds.size(); index++) {
            jdbc.update("UPDATE paper_items SET sort_order = ?, display_number = ? WHERE section_id = ? AND question_id = ?",
                index, index + 1, moduleId, questionIds.get(index));
        }
    }

    /** 保存整张试卷的模块题目布局；一次事务完成模块内排序与跨模块移动。 */
    @Transactional
    public void saveQuestionLayout(long paperId, QuestionLayoutWrite request) {
        requireEditableSatPaper(paperId);
        List<ModuleLayout> modules = jdbc.query("""
            SELECT id, section_code, JSON_UNQUOTE(JSON_EXTRACT(settings_json, '$.subject')) AS subject
            FROM paper_sections
            WHERE paper_id = ? AND parent_section_id IS NULL ORDER BY sort_order, id
            """, (rs, row) -> {
            String code = rs.getString("section_code");
            String subject = rs.getString("subject");
            if (subject == null || subject.isBlank()) subject = code.startsWith("MATH") ? "Math" : "RW";
            return new ModuleLayout(rs.getLong("id"), code, subject);
        }, paperId);
        Map<Long, String> moduleCodes = new LinkedHashMap<>();
        Map<Long, String> moduleSubjects = new LinkedHashMap<>();
        modules.forEach(module -> {
            moduleCodes.put(module.moduleId(), module.sectionCode());
            moduleSubjects.put(module.moduleId(), module.subject());
        });
        if (request == null || request.modules() == null || request.modules().size() != modules.size()) {
            throw badRequest("The layout must include every SAT module exactly once.");
        }

        Map<Long, List<Long>> requestedOrder = new LinkedHashMap<>();
        for (ModuleQuestionOrder module : request.modules()) {
            if (module == null || !moduleCodes.containsKey(module.moduleId()) || module.questionIds() == null
                    || requestedOrder.putIfAbsent(module.moduleId(), module.questionIds()) != null) {
                throw badRequest("The layout must include every SAT module exactly once.");
            }
        }
        if (requestedOrder.size() != modules.size()) {
            throw badRequest("The layout must include every SAT module exactly once.");
        }

        List<PaperItemRow> currentItems = jdbc.query("""
            SELECT pi.id, pi.question_id FROM paper_items pi
            JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE ps.paper_id = ? AND ps.parent_section_id IS NULL
            ORDER BY ps.sort_order, pi.sort_order, pi.id
            """, (rs, row) -> new PaperItemRow(rs.getLong("id"), rs.getLong("question_id")), paperId);
        java.util.Set<Long> currentQuestionIds = currentItems.stream().map(PaperItemRow::questionId)
            .collect(java.util.stream.Collectors.toSet());
        List<Long> orderedQuestionIds = requestedOrder.values().stream().flatMap(List::stream).toList();
        if (orderedQuestionIds.size() != currentItems.size()
                || new java.util.HashSet<>(orderedQuestionIds).size() != orderedQuestionIds.size()
                || !currentQuestionIds.equals(new java.util.HashSet<>(orderedQuestionIds))) {
            throw badRequest("The layout must include every question in this paper exactly once.");
        }

        if (currentItems.isEmpty()) return;
        Integer maxOrder = jdbc.queryForObject("""
            SELECT COALESCE(MAX(pi.sort_order), -1) FROM paper_items pi
            JOIN paper_sections ps ON ps.id = pi.section_id
            WHERE ps.paper_id = ? AND ps.parent_section_id IS NULL
            """, Integer.class, paperId);
        long temporaryOffset = (maxOrder == null ? -1L : maxOrder.longValue()) + currentItems.size() + 1L;
        jdbc.update("""
            UPDATE paper_items pi JOIN paper_sections ps ON ps.id = pi.section_id
            SET pi.sort_order = pi.sort_order + ? WHERE ps.paper_id = ? AND ps.parent_section_id IS NULL
            """, temporaryOffset, paperId);

        Map<Long, Long> itemIds = new LinkedHashMap<>();
        currentItems.forEach(item -> itemIds.put(item.questionId(), item.itemId()));
        requestedOrder.forEach((moduleId, questionIds) -> {
            for (int index = 0; index < questionIds.size(); index++) {
                long questionId = questionIds.get(index);
                jdbc.update("""
                    UPDATE questions q JOIN paper_items pi ON pi.question_id = q.id
                    SET q.render_json = JSON_SET(COALESCE(q.render_json, JSON_OBJECT()), '$.sat.subject', ?)
                    WHERE pi.id = ?
                    """, moduleSubjects.get(moduleId), itemIds.get(questionId));
                jdbc.update("""
                    UPDATE paper_items SET section_id = ?, sort_order = ?, display_number = ?, scoring_section_code = ?
                    WHERE id = ?
                    """, moduleId, index, index + 1, moduleCodes.get(moduleId), itemIds.get(questionId));
            }
        });
    }

    @Transactional
    public long copyQuestion(long paperId, long questionId, long targetModuleId) {
        requireEditableSatPaper(paperId);
        SectionRow targetSection = section(paperId, targetModuleId);
        if (targetSection == null) throw notFound("SAT module not found.");
        return jdbc.query("""
            SELECT q.stem, q.question_type_code, q.render_json, q.answer_key_json, q.grading_json, q.explanation,
                   pi.max_points, pi.scoring_section_code, sqm.material_id, sqm.material_ref
            FROM questions q JOIN paper_items pi ON pi.question_id = q.id
            JOIN paper_sections s ON s.id = pi.section_id
            LEFT JOIN sat_question_materials sqm ON sqm.question_id = q.id
            WHERE s.paper_id = ? AND q.id = ?
            """, rs -> {
            if (!rs.next()) throw notFound("SAT question not found.");
            String type = rs.getString("question_type_code").contains("FILL") ? "fill_blank" : "multiple_choice";
            ObjectNode render = (ObjectNode) readJson(rs.getString("render_json")).deepCopy();
            String subject = targetSection.settings().path("subject").asText("RW");
            render.withObject("sat").put("subject", subject);
            QuestionWrite request = new QuestionWrite(targetModuleId, subject, 1, null, null,
                rs.getString("stem"), toStringMap(render.path("options")), "", "Medium",
                rs.getBigDecimal("max_points"), "", rs.getString("explanation"), type);
            JsonNode answer = readJson(rs.getString("answer_key_json"));
            JsonNode grading = readJson(rs.getString("grading_json"));
            long copiedId = insertQuestion(targetModuleId, request, render, answer, grading, targetSection.code());
            if (rs.getObject("material_id") != null) {
                updateMaterialLink(copiedId, rs.getLong("material_id"), rs.getString("material_ref"));
            }
            return copiedId;
        }, paperId, questionId);
    }

    public List<MaterialView> materials(long paperId, String subject) {
        requireSatPaper(paperId);
        if (subject == null || subject.isBlank()) {
            return jdbc.query("SELECT id, title, material_type, content, file_url, source FROM sat_materials ORDER BY updated_at DESC, id DESC",
                (rs, row) -> materialView(rs));
        }
        return jdbc.query("""
            SELECT DISTINCT m.id, m.title, m.material_type, m.content, m.file_url, m.source
            FROM sat_materials m JOIN sat_question_materials qm ON qm.material_id = m.id
            JOIN questions q ON q.id = qm.question_id JOIN paper_items pi ON pi.question_id = q.id
            JOIN paper_sections s ON s.id = pi.section_id
            WHERE s.paper_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(s.settings_json, '$.subject')) = ?
            ORDER BY m.id DESC
            """, (rs, row) -> materialView(rs), paperId, subject);
    }

    @Transactional
    public long createMaterial(long paperId, MaterialWrite request) {
        requireEditableSatPaper(paperId);
        jdbc.update("""
            INSERT INTO sat_materials (title, material_type, content, file_url, source)
            VALUES (?, ?, ?, ?, ?)
            """, request.title(), request.materialType(), request.content(), request.fileUrl(), request.source());
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    @Transactional
    public void updateMaterial(long paperId, long materialId, MaterialWrite request) {
        requireEditableSatPaper(paperId);
        int updated = jdbc.update("""
            UPDATE sat_materials SET title = ?, material_type = ?, content = ?, file_url = ?, source = ? WHERE id = ?
            """, request.title(), request.materialType(), request.content(), request.fileUrl(), request.source(), materialId);
        if (updated == 0) throw notFound("SAT material not found.");
    }

    @Transactional
    public void deleteMaterial(long paperId, long materialId) {
        requireEditableSatPaper(paperId);
        int deleted = jdbc.update("DELETE FROM sat_materials WHERE id = ? AND NOT EXISTS (SELECT 1 FROM sat_question_materials WHERE material_id = ?)",
            materialId, materialId);
        if (deleted == 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "This material is still used by a question.");
    }

    private long insertQuestion(long sectionId, QuestionWrite request, ObjectNode render, JsonNode answer,
                                JsonNode grading, String scoringSectionCode) {
        GeneratedKeyHolder key = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO questions (question_type_code, payload_schema_version, stem, render_json, answer_key_json, grading_json, explanation)
                VALUES (?, 1, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?)
                """, Statement.RETURN_GENERATED_KEYS);
            boolean fillBlank = "fill_blank".equals(request.type()) || request.options() == null || request.options().isEmpty();
            statement.setString(1, fillBlank ? "SAT_FILL_IN_BLANK" : "SAT_MULTIPLE_CHOICE");
            statement.setString(2, request.content()); statement.setString(3, json(render));
            statement.setString(4, json(answer)); statement.setString(5, json(grading)); statement.setString(6, request.analysis());
            return statement;
        }, key);
        long questionId = key.getKey().longValue();
        Integer nextOrder = jdbc.queryForObject("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM paper_items WHERE section_id = ?", Integer.class, sectionId);
        jdbc.update("""
            INSERT INTO paper_items (section_id, question_id, sort_order, display_number, max_points, scoring_section_code)
            VALUES (?, ?, ?, ?, ?, ?)
            """, sectionId, questionId, nextOrder, nextOrder + 1, request.score(), scoringSectionCode);
        return questionId;
    }

    private ObjectNode questionRender(QuestionWrite request, JsonNode sectionSettings) {
        ObjectNode render = mapper.createObjectNode();
        render.set("options", mapper.valueToTree(request.options() == null ? Map.of() : request.options()));
        ObjectNode sat = render.putObject("sat");
        sat.put("subject", request.subject() == null ? sectionSettings.path("subject").asText("RW") : request.subject());
        sat.put("typeId", request.typeId() == null ? 1 : request.typeId());
        boolean fillBlank = "fill_blank".equals(request.type()) || request.options() == null || request.options().isEmpty();
        sat.put("typeName", fillBlank ? "Fill Blank" : "Multiple Choice");
        sat.put("difficulty", request.difficulty() == null ? "Medium" : request.difficulty());
        sat.put("tags", request.tags() == null ? "" : request.tags());
        return render;
    }

    private void updateMaterialLink(long questionId, Long materialId, String materialRef) {
        jdbc.update("DELETE FROM sat_question_materials WHERE question_id = ?", questionId);
        if (materialId == null) return;
        Boolean exists = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM sat_materials WHERE id = ?)", Boolean.class, materialId);
        if (!Boolean.TRUE.equals(exists)) throw badRequest("The selected SAT material is unavailable.");
        jdbc.update("INSERT INTO sat_question_materials (question_id, material_id, material_ref) VALUES (?, ?, ?)",
            questionId, materialId, materialRef);
    }

    private List<QuestionView> listQuestions(long sectionId) {
        return jdbc.query("""
            SELECT q.id, q.stem, q.render_json, q.answer_key_json, q.explanation, pi.sort_order, pi.max_points,
                   sqm.material_id, sm.title AS material_title, sm.material_type, sm.content, sm.file_url, sqm.material_ref
            FROM paper_items pi JOIN questions q ON q.id = pi.question_id
            LEFT JOIN sat_question_materials sqm ON sqm.question_id = q.id
            LEFT JOIN sat_materials sm ON sm.id = sqm.material_id
            WHERE pi.section_id = ? ORDER BY pi.sort_order, pi.id
            """, (rs, row) -> {
            JsonNode render = readJson(rs.getString("render_json"));
            JsonNode sat = render.path("sat");
            JsonNode key = readJson(rs.getString("answer_key_json"));
            MaterialSummary material = rs.getObject("material_id") == null ? null
                : new MaterialSummary(rs.getLong("material_id"), rs.getString("material_title"), rs.getString("material_type"),
                    rs.getString("content"), rs.getString("file_url"), rs.getString("material_ref"));
            return new QuestionView(rs.getLong("id"), rs.getInt("sort_order"), rs.getString("stem"),
                render.path("options").toString(), key.path("correctAnswer").asText(""), rs.getString("explanation"),
                sat.path("typeId").asLong(1), sat.path("typeName").asText("Multiple Choice"),
                sat.path("difficulty").asText("Medium"), rs.getBigDecimal("max_points"), sat.path("tags").asText(""),
                material != null, material == null ? null : material.materialId(), material);
        }, sectionId);
    }

    private SectionRow section(long paperId, long sectionId) {
        return jdbc.query("""
            SELECT id, section_code, settings_json FROM paper_sections WHERE id = ? AND paper_id = ?
            """, rs -> rs.next() ? new SectionRow(rs.getLong(1), rs.getString(2), readJson(rs.getString(3))) : null,
            sectionId, paperId);
    }

    private PaperRow paper(long paperId) {
        return jdbc.query("SELECT id, title, description, status FROM papers WHERE id = ?",
            rs -> rs.next() ? new PaperRow(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4)) : null, paperId);
    }

    private void requireSatPaper(long paperId) {
        String code = jdbc.query("SELECT exam_type_code FROM papers WHERE id = ?", rs -> rs.next() ? rs.getString(1) : null, paperId);
        if (!"SAT".equals(code) && !"PSAT".equals(code)) throw notFound("SAT paper not found.");
    }

    /** SAT 试卷被考试引用后使用副本编辑，避免改写既有考试。 */
    private void requireEditableSatPaper(long paperId) {
        requireSatPaper(paperId);
        String status = paper(paperId).status();
        Boolean usedByExam = jdbc.queryForObject(
            "SELECT EXISTS(SELECT 1 FROM exams WHERE paper_id = ?)", Boolean.class, paperId);
        if ("ARCHIVED".equals(status) || Boolean.TRUE.equals(usedByExam)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                "This paper version is locked. Create a new version before changing SAT content.");
        }
    }

    private JsonNode readJson(String value) {
        if (value == null) return mapper.createObjectNode();
        try { return mapper.readTree(value); }
        catch (JsonProcessingException exception) { throw new IllegalStateException("Saved SAT data contains invalid JSON.", exception); }
    }

    private Map<String, String> toStringMap(JsonNode value) {
        Map<String, String> result = new LinkedHashMap<>();
        value.fields().forEachRemaining(entry -> result.put(entry.getKey(), entry.getValue().asText("")));
        return result;
    }

    private String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (JsonProcessingException exception) { throw new IllegalArgumentException("Invalid SAT paper data.", exception); }
    }

    private MaterialView materialView(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new MaterialView(rs.getLong("id"), rs.getString("title"), rs.getString("material_type"),
            rs.getString("content"), rs.getString("file_url"), rs.getString("source"));
    }

    private ResponseStatusException notFound(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
    private ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

    private record Stage(String code, String name, int order) { }
    private record SectionRow(long id, String code, JsonNode settings) { }

    public record PaperStructure(long paperId, String paperTitle, String paperDescription, String status, List<StageView> stages) { }
    public record StageView(String stageName, String stageCode, String description, List<ModuleView> modules) { }
    public record ModuleView(long moduleId, String moduleName, String moduleCode, String moduleType, String description,
            int questionCount, int totalScore, int duration, int sortOrder, int subjectCode, int moduleNumber,
            String moduleDifficulty, List<QuestionView> questions, List<ModuleView> adaptiveOptions) { }
    public record QuestionView(long questionId, int questionOrder, String content, String options, String correctAnswer,
            String analysis, long typeId, String typeName, String difficulty, BigDecimal score, String tags,
            boolean hasMaterial, Long materialId, MaterialSummary material) { }
    public record MaterialSummary(long materialId, String materialName, String materialType, String content, String fileUrl, String source) { }
    public record QuestionDetail(long id, String subject, long typeId, String typeName, Long materialId, String materialRef,
            String content, Map<String, String> options, String correctAnswer, String difficulty, BigDecimal score,
            String tags, String analysis, MaterialDetail material) { }
    public record MaterialDetail(long id, String title, String materialType, String content, String fileUrl, String source, Integer wordCount) { }
    public record MaterialView(long materialId, String title, String materialType, String content, String fileUrl, String source) { }
    public record QuestionWrite(Long moduleId, String subject, Integer typeId, Long materialId, String materialRef,
            String content, Map<String, String> options, String correctAnswer, String difficulty,
            BigDecimal score, String tags, String analysis, String type) { }
    public record ModuleWrite(String moduleName, String description, String subject, Integer moduleType,
            String moduleDifficulty, Integer timeLimit, Integer questionCount, Integer totalScore, Integer sortOrder) { }
    public record ModuleQuestionOrder(long moduleId, List<Long> questionIds) { }
    public record QuestionLayoutWrite(List<ModuleQuestionOrder> modules) { }
    public record MaterialWrite(String title, String materialType, String content, String fileUrl, String source) { }
    record PaperRow(long id, String title, String description, String status) { }
    record ModuleLayout(long moduleId, String sectionCode, String subject) { }
    record PaperItemRow(long itemId, long questionId) { }
}
