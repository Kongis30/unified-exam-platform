package com.unifiedexam.platform.paper;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

class PaperStructureValidationTest {
    @Test
    void acceptsLegacyGraphQuestionWithEmptyStem() {
        var question = new PaperService.QuestionRequest("GRAPH_QUESTION", "", null,
            JsonNodeFactory.instance.objectNode(), null, null, null, 0, 1, BigDecimal.ONE, null, 1);
        var section = new PaperService.SectionRequest("ELA", "PART", "English", 0, null, null,
            List.of(question), List.of());
        var request = new PaperService.SaveStructureRequest(List.of(section));
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertTrue(factory.getValidator().validate(request).isEmpty());
        }
    }
}
