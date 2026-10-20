package com.unifiedexam.platform.paper;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Stores SHSAT editor images under a bounded local upload directory and returns stable relative URLs. */
@Service
public class PaperImageStorage {

    private static final long MAX_IMAGE_BYTES = 10L * 1024 * 1024;
    private static final Set<String> ALLOWED_TYPES = Set.of("image/png", "image/jpeg", "image/webp", "image/gif");

    private final Path root;

    public PaperImageStorage(@Value("${platform.uploads.directory:uploads/paper-materials}") String directory) {
        this.root = Paths.get(directory).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to initialize paper image storage.", exception);
        }
    }

    public StoredImage store(long paperId, MultipartFile file) {
        if (file == null || file.isEmpty()) throw badRequest("Choose an image file to upload.");
        if (file.getSize() > MAX_IMAGE_BYTES) throw badRequest("Images must be 10 MB or smaller.");
        String contentType = StringUtils.hasText(file.getContentType())
            ? file.getContentType().toLowerCase(Locale.ROOT) : "";
        if (!ALLOWED_TYPES.contains(contentType)) throw badRequest("Upload a JPG, PNG, WebP, or GIF image.");
        String extension = switch (contentType) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            default -> ".gif";
        };
        String storedName = paperId + "-" + UUID.randomUUID() + extension;
        Path target = root.resolve(storedName).normalize();
        if (!target.startsWith(root)) throw badRequest("Invalid image file name.");
        try (var input = file.getInputStream()) {
            Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to save the uploaded image.");
        }
        String originalName = StringUtils.cleanPath(StringUtils.hasText(file.getOriginalFilename())
            ? file.getOriginalFilename() : "image" );
        return new StoredImage("/uploads/paper-materials/" + storedName, originalName, file.getSize(), contentType);
    }

    public String resourceLocation() {
        return root.toUri().toString();
    }

    private ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    public record StoredImage(String assetUrl, String originalFileName, long fileSize, String fileType) { }
}
