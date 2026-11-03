package com.unifiedexam.platform.api;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ApiExceptionHandlerTest {

    @Test
    void missingStaticResourceReturnsNotFoundInsteadOfInternalError() {
        var response = new ApiExceptionHandler().handleMissingResource(
            new NoResourceFoundException(HttpMethod.GET, "/uploads/paper-materials/missing.png")
        );

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        assertEquals("RESOURCE_NOT_FOUND", response.getBody().code());
        assertEquals("The requested resource was not found.", response.getBody().message());
    }
}
