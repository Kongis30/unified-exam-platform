package com.unifiedexam.platform.examtype.shsat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

import java.sql.ResultSet;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ShsatPaperPublicationValidatorTest {

    private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
    private final ShsatPaperPublicationValidator validator =
        new ShsatPaperPublicationValidator(jdbcTemplate, new ObjectMapper());

    @Test
    void rejectsScoredQuestionsOutsideOfficialPartsAndAllowsUnscoredQuestionsThere() throws Exception {
        stubQuestion("CUSTOM", null);
        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> validator.validate(12L));
        assertEquals("Assign scored questions to ELA or MATH before publishing.", error.getReason());

        stubQuestion("CUSTOM", "{\"isScored\":false}");
        validator.validate(12L);
    }

    @Test
    void rejectsPapersWithoutQuestions() {
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), eq(12L))).thenReturn(List.of());

        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> validator.validate(12L));

        assertEquals("Add at least one question before publishing.", error.getReason());
    }

    private void stubQuestion(String partCode, String gradingJson) throws Exception {
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), eq(12L))).thenAnswer(invocation -> {
            RowMapper<?> mapper = invocation.getArgument(1);
            ResultSet row = mock(ResultSet.class);
            when(row.getString("part_code")).thenReturn(partCode);
            when(row.getString("grading_json")).thenReturn(gradingJson);
            return List.of(mapper.mapRow(row, 0));
        });
    }
}
