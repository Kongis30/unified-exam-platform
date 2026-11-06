package com.unifiedexam.platform.paper;

import jakarta.validation.constraints.Positive;
import com.unifiedexam.platform.security.PaperManagementAccessPolicy;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Validated
@RestController
@RequestMapping("/api/admin/papers/{paperId}")
public class PaperImageController {

    private final JdbcTemplate jdbcTemplate;
    private final PaperImageStorage imageStorage;
    private final PaperManagementAccessPolicy paperAccess;

    public PaperImageController(JdbcTemplate jdbcTemplate, PaperImageStorage imageStorage,
                                PaperManagementAccessPolicy paperAccess) {
        this.jdbcTemplate = jdbcTemplate;
        this.imageStorage = imageStorage;
        this.paperAccess = paperAccess;
    }

    @PostMapping("/question-images")
    public PaperImageStorage.StoredImage uploadQuestionImage(@PathVariable @Positive long paperId,
                                                              @RequestPart("file") MultipartFile file,
                                                              Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        requireEditablePaper(paperId);
        return imageStorage.store(paperId, file);
    }

    @PostMapping("/materials/images")
    public MaterialImageView uploadMaterialImage(@PathVariable @Positive long paperId,
            @RequestPart("file") MultipartFile file,
            @RequestParam(required = false) Long materialId,
            @RequestParam(required = false) Long partId,
            @RequestParam(required = false) Long subTypeId,
            @RequestParam(required = false) String materialTitle,
            @RequestParam(required = false) String materialCategory,
            @RequestParam(required = false, defaultValue = "0") Integer displayOrder,
            Authentication authentication) {
        paperAccess.requireAdministrator(authentication);
        requireEditablePaper(paperId);
        PaperImageStorage.StoredImage image = imageStorage.store(paperId, file);
        return new MaterialImageView(materialId, paperId, partId, subTypeId, "image",
            StringUtils.hasText(materialTitle) ? materialTitle : image.originalFileName(), materialCategory,
            null, image.assetUrl(), displayOrder, image.originalFileName(), image.fileSize(), image.fileType());
    }

    private void requireEditablePaper(long paperId) {
        var paper = jdbcTemplate.query("SELECT status, exam_type_code FROM papers WHERE id = ?",
            rs -> rs.next() ? new String[] {rs.getString(1), rs.getString(2)} : null, paperId);
        if (paper == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Paper not found.");
        if (!"SHSAT".equals(paper[1]) && !"DRAFT".equals(paper[0])) throw new ResponseStatusException(HttpStatus.CONFLICT, "Create an editable paper version before uploading images.");
    }

    public record MaterialImageView(Long materialId, long paperId, Long partId, Long subTypeId,
            String materialType, String materialTitle, String materialCategory, String materialContent,
            String assetUrl, Integer displayOrder, String originalFileName, long fileSize, String fileType) { }
}
