package com.unifiedexam.platform.examtype.sat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SatPaperEditorServiceTest {

    @Test
    void savesReorderAndCrossModuleMoveAsOnePaperLayout() {
        JdbcTemplate jdbc = editorJdbc();
        SatPaperEditorService service = new SatPaperEditorService(jdbc, new ObjectMapper());
        var layout = new SatPaperEditorService.QuestionLayoutWrite(List.of(
            new SatPaperEditorService.ModuleQuestionOrder(10, List.of()),
            new SatPaperEditorService.ModuleQuestionOrder(20, List.of(2L, 1L))
        ));

        service.saveQuestionLayout(329, layout);

        var ordered = inOrder(jdbc);
        ordered.verify(jdbc).update(contains("UPDATE paper_items pi JOIN paper_sections ps"), eq(4L), eq(329L));
        ordered.verify(jdbc).update(contains("UPDATE questions q JOIN paper_items pi"), eq("Math"), eq(102L));
        ordered.verify(jdbc).update(contains("SET section_id = ?, sort_order = ?, display_number = ?, scoring_section_code = ?"),
            eq(20L), eq(0), eq(1), eq("MATH1"), eq(102L));
        ordered.verify(jdbc).update(contains("UPDATE questions q JOIN paper_items pi"), eq("Math"), eq(101L));
        ordered.verify(jdbc).update(contains("SET section_id = ?, sort_order = ?, display_number = ?, scoring_section_code = ?"),
            eq(20L), eq(1), eq(2), eq("MATH1"), eq(101L));
    }

    @Test
    void rejectsDuplicateQuestionInLayoutWithoutChangingPaperItems() {
        JdbcTemplate jdbc = editorJdbc();
        SatPaperEditorService service = new SatPaperEditorService(jdbc, new ObjectMapper());
        var layout = new SatPaperEditorService.QuestionLayoutWrite(List.of(
            new SatPaperEditorService.ModuleQuestionOrder(10, List.of(1L)),
            new SatPaperEditorService.ModuleQuestionOrder(20, List.of(1L))
        ));

        ResponseStatusException error = assertThrows(ResponseStatusException.class,
            () -> service.saveQuestionLayout(329, layout));

        assertEquals(400, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    private JdbcTemplate editorJdbc() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Boolean.class), any(Object[].class))).thenReturn(false);
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(Object[].class))).thenReturn(1);
        when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.contains("SELECT exam_type_code")) return "SAT";
            return new SatPaperEditorService.PaperRow(329, "Draft", null, "DRAFT");
        });
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            if (sql.contains("SELECT id, section_code")) {
                return List.of(new SatPaperEditorService.ModuleLayout(10, "RW1", "RW"),
                    new SatPaperEditorService.ModuleLayout(20, "MATH1", "Math"));
            }
            return List.of(new SatPaperEditorService.PaperItemRow(101, 1),
                new SatPaperEditorService.PaperItemRow(102, 2));
        });
        return jdbc;
    }
}
