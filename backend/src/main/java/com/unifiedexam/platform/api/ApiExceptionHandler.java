package com.unifiedexam.platform.api;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/** Keep API errors stable and in English so browser locale never changes system prompts. */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger logger = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiError> handleStatus(ResponseStatusException exception) {
        String message = exception.getReason() == null ? "The request could not be completed." : exception.getReason();
        return ResponseEntity.status(exception.getStatusCode())
            .body(new ApiError("HTTP_" + exception.getStatusCode().value(), message));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleInvalidRequest(MethodArgumentNotValidException exception) {
        var fieldError = exception.getBindingResult().getFieldErrors().stream().findFirst().orElse(null);
        if (fieldError == null) {
            return ResponseEntity.badRequest()
                .body(new ApiError("INVALID_REQUEST", "Please review the submitted information and try again."));
        }
        String field = fieldError.getField();
        return ResponseEntity.badRequest().body(new ApiError("INVALID_REQUEST", validationMessage(field), field));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> handleUnreadableRequest(HttpMessageNotReadableException exception) {
        return ResponseEntity.badRequest()
            .body(new ApiError("INVALID_REQUEST", "The submitted information could not be read. Check the form and try again."));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleUnexpectedError(Exception exception) {
        logger.error("Unhandled API error", exception);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ApiError("INTERNAL_ERROR", "Something went wrong. Please try again."));
    }

    private String validationMessage(String field) {
        return switch (field) {
            case "username" -> "Enter a username no longer than 80 characters.";
            case "password", "newPassword" -> "Password must be between 6 and 100 characters.";
            case "realName" -> "Enter a full name no longer than 80 characters.";
            case "roleCode" -> "Choose a valid account role.";
            case "email" -> "Enter a valid email address no longer than 160 characters.";
            case "phone" -> "Phone must be 30 characters or fewer.";
            default -> "Please review the submitted information and try again.";
        };
    }

    public record ApiError(String code, String message, String field) {
        public ApiError(String code, String message) {
            this(code, message, null);
        }
    }
}
