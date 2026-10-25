package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SatExamTypeModuleTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final SatExamTypeModule module = new SatExamTypeModule(mapper);

    @Test
    void acceptsAnyLegacyFillInAlternativeStoredAsJsonText() throws Exception {
        JsonNode key = mapper.readTree("{\"correctAnswer\":\"[\\\"New York\\\",\\\"Albany\\\"]\"}");
        JsonNode answer = mapper.readTree("{\"value\":\"  aLb any \"}");

        assertTrue(module.grade("SAT_FILL_IN_BLANK", key, answer));
    }

    @Test
    void acceptsAnyFillInAlternativeStoredAsJsonArray() throws Exception {
        JsonNode key = mapper.readTree("{\"correctAnswer\":[\"42\",\"forty two\"]}");
        JsonNode answer = mapper.readTree("{\"value\":\"Forty   Two\"}");

        assertTrue(module.grade("SAT_FILL_IN_BLANK", key, answer));
    }

    @Test
    void rejectsBlankAndUnknownFillInAnswers() throws Exception {
        JsonNode key = mapper.readTree("{\"correctAnswer\":\"[\\\"42\\\",\\\"forty two\\\"]\"}");

        assertFalse(module.grade("SAT_FILL_IN_BLANK", key, mapper.readTree("{\"value\":\"\"}")));
        assertFalse(module.grade("SAT_FILL_IN_BLANK", key, mapper.readTree("{\"value\":\"43\"}")));
    }

    @Test
    void keepsMultipleChoiceAnswerMatchingAndUnknownQuestionBehavior() throws Exception {
        JsonNode key = mapper.readTree("{\"correctAnswer\":\"A\"}");

        assertTrue(module.grade("SAT_MULTIPLE_CHOICE", key, mapper.readTree("{\"value\":\" a \"}")));
        assertFalse(module.grade("SAT_MULTIPLE_CHOICE", key, mapper.readTree("{\"value\":\"B\"}")));
        assertNull(module.grade("OTHER", key, mapper.readTree("{\"value\":\"A\"}")));
    }
}
