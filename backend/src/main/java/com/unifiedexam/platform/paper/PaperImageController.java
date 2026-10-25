package com.unifiedexam.platform.paper;

import jakarta.validation.constraints.Positive;
import com.unifiedexam.platform.security.SatAdminAccessPolicy;
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
    private final SatAdminAccessPolicy satAccess;

    public PaperImageController(JdbcTemplate jdbcTemplate, PaperImageStorage imageStorage,
                                SatAdminAccessPolicy satAccess) {
        this.jdbcTemplate = jdbcTemplate;
        this.imageStorage = imageStorage;
        this.satAccess = satAccess;
    }

    @PostMapping("/question-images")
    public PaperImageStorage.StoredImage uploadQuestionImage(@PathVariable @Positive long paperId,
                                                              @RequestPart("file") MultipartFile file,
                                                              Authentication authentication) {
        satAccess.requireAdminForPaper(paperId, authentication);
        requireDraftPaper(paperId);
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
        satAccess.requireAdminForPaper(paperId, authentication);
        requireDraftPaper(paperId);
        PaperImageStorage.StoredImage image = imageStorage.store(paperId, file);
        return new MaterialImageView(materialId, paperId, partId, subTypeId, "image",
            StringUtils.hasText(materialTitle) ? materialTitle : image.originalFileName(), materialCategory,
            null, image.assetUrl(), displayOrder, image.originalFileName(), image.fileSize(), image.fileType());
    }

    private void requireDraftPaper(long paperId) {
        String status = jdbcTemplate.query("SELECT status FROM papers WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, paperId);
        if (status == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Paper not found.");
        if (!"DRAFT".equals(status)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Create an editable paper version before uploading images.");
    }

    public record MaterialImageView(Long materialId, long paperId, Long partId, Long subTypeId,
            String materialType, String materialTitle, String materialCategory, String materialContent,
            String assetUrl, Integer displayOrder, String originalFileName, long fileSize, String fileType) { }
}
