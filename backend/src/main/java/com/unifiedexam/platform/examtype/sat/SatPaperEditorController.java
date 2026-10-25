package com.unifiedexam.platform.examtype.sat;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/** 原 SAT 编辑器的兼容接口；数据写入统一平台主表及 SAT 专属素材扩展表。 */
@Validated
@RestController
@RequestMapping("/api/admin/sat/papers/{paperId}/editor")
public class SatPaperEditorController {

    private final SatPaperEditorService editorService;

    public SatPaperEditorController(SatPaperEditorService editorService) {
        this.editorService = editorService;
    }

    @GetMapping("/structure")
    public SatPaperEditorService.PaperStructure structure(@PathVariable @Positive long paperId) {
        return editorService.structure(paperId);
    }

    @GetMapping("/questions/{questionId}")
    public SatPaperEditorService.QuestionDetail question(@PathVariable @Positive long paperId,
            @PathVariable @Positive long questionId) {
        return editorService.question(paperId, questionId);
    }

    @PostMapping("/questions")
    public Map<String, Long> createQuestion(@PathVariable @Positive long paperId,
            @Valid @RequestBody SatPaperEditorService.QuestionWrite request) {
        return Map.of("id", editorService.createQuestion(paperId, request));
    }

    @PutMapping("/questions/{questionId}")
    public Map<String, Long> updateQuestion(@PathVariable @Positive long paperId,
            @PathVariable @Positive long questionId,
            @Valid @RequestBody SatPaperEditorService.QuestionWrite request) {
        editorService.updateQuestion(paperId, questionId, request);
        return Map.of("id", questionId);
    }

    @DeleteMapping("/questions/{questionId}")
    public void deleteQuestion(@PathVariable @Positive long paperId,
            @PathVariable @Positive long questionId) {
        editorService.deleteQuestion(paperId, questionId);
    }

    @PostMapping("/modules")
    public Map<String, Long> createModule(@PathVariable @Positive long paperId,
            @Valid @RequestBody SatPaperEditorService.ModuleWrite request) {
        return Map.of("id", editorService.createModule(paperId, request));
    }

    @PutMapping("/modules/{moduleId}/question-order")
    public void reorderQuestions(@PathVariable @Positive long paperId,
            @PathVariable @Positive long moduleId, @RequestBody List<@Positive Long> questionIds) {
        editorService.reorderQuestions(paperId, moduleId, questionIds);
    }

    @PutMapping("/question-layout")
    public void saveQuestionLayout(@PathVariable @Positive long paperId,
            @Valid @RequestBody SatPaperEditorService.QuestionLayoutWrite request) {
        editorService.saveQuestionLayout(paperId, request);
    }

    @PostMapping("/questions/{questionId}/copy/{moduleId}")
    public Map<String, Long> copyQuestion(@PathVariable @Positive long paperId,
            @PathVariable @Positive long questionId, @PathVariable @Positive long moduleId) {
        return Map.of("id", editorService.copyQuestion(paperId, questionId, moduleId));
    }

    @GetMapping("/materials")
    public List<SatPaperEditorService.MaterialView> materials(@PathVariable @Positive long paperId,
            @RequestParam(required = false) String subject) {
        return editorService.materials(paperId, subject);
    }

    @PostMapping("/materials")
    public Map<String, Long> createMaterial(@PathVariable @Positive long paperId,
            @Valid @RequestBody MaterialWriteRequest request) {
        long id = editorService.createMaterial(paperId, new SatPaperEditorService.MaterialWrite(
            request.title(), request.materialType(), request.content(), request.fileUrl(), request.source()));
        return Map.of("id", id);
    }

    @PutMapping("/materials/{materialId}")
    public Map<String, Long> updateMaterial(@PathVariable @Positive long paperId,
            @PathVariable @Positive long materialId, @Valid @RequestBody MaterialWriteRequest request) {
        editorService.updateMaterial(paperId, materialId, new SatPaperEditorService.MaterialWrite(
            request.title(), request.materialType(), request.content(), request.fileUrl(), request.source()));
        return Map.of("id", materialId);
    }

    @DeleteMapping("/materials/{materialId}")
    public void deleteMaterial(@PathVariable @Positive long paperId, @PathVariable @Positive long materialId) {
        editorService.deleteMaterial(paperId, materialId);
    }

    public record MaterialWriteRequest(@NotBlank @Size(max = 200) String title,
            @NotBlank @Size(max = 20) String materialType, String content,
            @Size(max = 1000) String fileUrl, @Size(max = 200) String source) { }

}
