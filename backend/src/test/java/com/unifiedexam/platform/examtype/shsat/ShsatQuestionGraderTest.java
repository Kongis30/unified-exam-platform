package com.unifiedexam.platform.examtype.shsat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ShsatQuestionGraderTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ShsatQuestionGrader grader = new ShsatQuestionGrader();

    @Test
    void treatsEmptyStructuredValuesAsUnanswered() throws Exception {
        assertFalse(grader.hasMeaningfulAnswer(json("{}")));
        assertFalse(grader.hasMeaningfulAnswer(json("{\"answers\":[\"\",null]}")));
        assertTrue(grader.hasMeaningfulAnswer(json("{\"answers\":[\"A\"]}")));
        assertTrue(grader.hasMeaningfulAnswer(json("{\"answers\":[false]}")));
        assertNull(grader.grade("MULTIPLE_CHOICE", json("{\"answers\":[\"A\"]}"), json("{}"), null, null));
        assertNull(grader.grade("INLINE_CHOICE", json("{\"answers\":{\"b1\":\"A\"}}"),
            json("{\"answers\":[]}"), null, null));
        assertNull(grader.grade("DRAG_AND_DROP", json("{\"placements\":{\"odd\":[\"one\"]}}"),
            json("{\"placements\":{\"odd\":[]}}"), null, null));
        assertNull(grader.grade("HOT_TEXT", json("{\"selectedSegmentIds\":[\"s1\"]}"),
            json("{\"selectedSegmentIds\":[]}"), null, null));
        assertNull(grader.grade("HOT_SPOT", json("{\"selectedRegionIds\":[\"r1\"]}"),
            json("{\"selectedRegionIds\":[]}"), null, null));
        assertNull(grader.grade("TABLE_GRID", json("{\"answers\":{\"r1\":[\"c1\"]}}"),
            json("{\"answers\":{}}"), null, null));
        assertNull(grader.grade("GRAPH_QUESTION", json("{\"points\":[{\"x\":2,\"y\":3}]}"),
            json("{\"points\":[]}"), null, null));
    }

    @Test
    void gradesSingleAndMultipleSelectionAsExactSets() throws Exception {
        assertTrue(grade("MULTIPLE_CHOICE", "{\"answers\":[\"B\"]}", "{\"value\":\"b\"}"));
        assertFalse(grade("MULTI_SELECT", "{\"answers\":[\"A\",\"C\"]}", "{\"answers\":[\"A\"]}"));
        assertFalse(grade("MULTIPLE_CHOICE", "{\"answers\":[\"A\"]}", "{\"answers\":[\"A\",\"A\"]}"));
        assertFalse(grade("MULTIPLE_CHOICE", "{\"answers\":[\"A\",\"A\"]}", "{\"answers\":[\"A\"]}"));
    }

    @Test
    void appliesSelectionCountConstraintsFromQuestionAndScoringConfiguration() throws Exception {
        JsonNode questionConfig = json("{\"questionConfig\":{\"requiredSelections\":2}}");
        assertFalse(grader.grade("MULTI_SELECT", json("{\"answers\":[\"A\"]}"),
            json("{\"answers\":[\"A\"]}"), questionConfig, null));

        JsonNode scoringRules = json("{\"maxSelections\":1}");
        assertFalse(grader.grade("MULTI_SELECT", json("{\"answers\":[\"A\",\"B\"]}"),
            json("{\"answers\":[\"A\",\"B\"]}"), null, scoringRules));

        JsonNode fixedConfig = json("{\"questionConfig\":{\"selectionLimit\":2}}");
        assertFalse(grader.grade("MULTI_SELECT_FIXED", json("{\"answers\":[\"A\"]}"),
            json("{\"answers\":[\"A\"]}"), fixedConfig, null));
    }

    @Test
    void rejectsSelectionAnswersThatAreNotConfiguredOptions() throws Exception {
        JsonNode render = json("{\"options\":[{\"key\":\"A\"},{\"key\":\"B\"}]}");
        assertFalse(grader.grade("MULTIPLE_CHOICE", json("{\"answers\":[\"Z\"]}"),
            json("{\"answers\":[\"Z\"]}"), render, null));
        assertFalse(grader.grade("MULTIPLE_CHOICE", json("{\"answers\":[\"A\"]}"),
            json("{\"answers\":[\"Z\"]}"), render, null));
        assertTrue(grader.grade("MULTIPLE_CHOICE", json("{\"answers\":[\"A\"]}"),
            json("{\"answers\":[\"a\"]}"), render, null));
        assertTrue(grade("MULTIPLE_CHOICE", "{\"answers\":[\"A\"]}", "{\"answers\":[\"A\"]}"));
    }

    @Test
    void gradesTextAndMathEquivalentFractions() throws Exception {
        assertTrue(grade("MATH_FILL_IN_BLANK", "{\"acceptedAnswers\":[\"\\\\frac{1}{2}\",\"0.25\"]}", "{\"value\":\"0.5\"}"));
    }

    @Test
    void rejectsRoundedDecimalThatOnlyApproximatesAnExactFraction() throws Exception {
        assertFalse(grade("MATH_FILL_IN_BLANK", "{\"acceptedAnswers\":[\"1/3\"]}",
            "{\"value\":\"0.333333333333\"}"));
        assertTrue(grade("MATH_FILL_IN_BLANK", "{\"acceptedAnswers\":[\"1/3\"]}",
            "{\"value\":\"2/6\"}"));
    }

    @Test
    void gradesEquationEditorEquivalentInequalityAndMultiplicationNotation() throws Exception {
        assertTrue(grade("EQUATION_EDITOR", "{\"acceptedAnswers\":[{\"value\":\"8x+35\\\\le95\"}]}",
            "{\"value\":\"8*x + 35 ≤ 95\"}"));
        assertTrue(grader.grade("EQUATION_EDITOR", json("{\"acceptedAnswers\":[{\"value\":\"8x+35\\\\le95\"}]}"),
            json("{\"value\":\"8*x + 35 \\\\le 95\"}"),
            json("{\"questionConfig\":{\"normalization\":{\"ignoreWhitespace\":true,\"normalizeOperators\":true,\"caseInsensitive\":true}}}"), null));
        assertTrue(grade("EQUATION_EDITOR", "{\"acceptedAnswers\":[\"x\\\\geq2\"]}",
            "{\"value\":\"x >= 2\"}"));
        assertFalse(grade("EQUATION_EDITOR", "{\"acceptedAnswers\":[\"8x+35\\\\le95\"]}",
            "{\"value\":\"8x+35 > 95\"}"));
        assertFalse(grader.grade("EQUATION_EDITOR", json("{\"acceptedAnswers\":[\"x\\\\le2\"]}"),
            json("{\"value\":\"x<=2\"}"),
            json("{\"questionConfig\":{\"normalization\":{\"normalizeOperators\":false}}}"), null));
    }

    @Test
    void gradesInlineChoiceAgainstBlankAndOptionConfiguration() throws Exception {
        assertTrue(grader.grade("INLINE_CHOICE", json("{\"answers\":{\"b1\":\"A\",\"b2\":\"D\"}}"),
            json("{\"answers\":{\"b2\":\"D\",\"b1\":\"a\"}}"),
            json("{\"questionConfig\":{\"blanks\":[{\"id\":\"b1\",\"options\":[{\"key\":\"A\"}]},{\"id\":\"b2\",\"options\":[{\"key\":\"D\"}]}]}}"), null));
        assertFalse(grader.grade("INLINE_CHOICE", json("{\"answers\":{\"b1\":\"A\"}}"),
            json("{\"answers\":{\"b1\":\"Z\"}}"),
            json("{\"questionConfig\":{\"blanks\":[{\"id\":\"b1\",\"options\":[{\"key\":\"A\"}]}]}}"), null));
    }

    @Test
    void validatesLegacyInlineChoiceDropdownConfigurationAliases() throws Exception {
        JsonNode config = json("{\"questionConfig\":{\"dropdowns\":[{\"id\":\"b1\",\"options\":[{\"key\":\"A\"}]}]}}");
        assertTrue(grader.grade("INLINE_CHOICE", json("{\"answers\":{\"b1\":\"A\"}}"),
            json("{\"answers\":{\"b1\":\"A\"}}"), config, null));
        assertFalse(grader.grade("INLINE_CHOICE", json("{\"answers\":{\"b1\":\"A\"}}"),
            json("{\"answers\":{\"b1\":\"Z\"}}"), config, null));
    }

    @Test
    void gradesDragAndDropPlacementsWithoutDependingOnOrder() throws Exception {
        assertTrue(grader.grade("DRAG_AND_DROP", json("{\"placements\":{\"odd\":[\"one\",\"three\"],\"even\":[\"two\"]}}"),
            json("{\"placements\":{\"even\":[\"two\"],\"odd\":[\"three\",\"one\"]}}"),
            json("{\"questionConfig\":{\"choices\":[{\"id\":\"one\"},{\"id\":\"two\"},{\"id\":\"three\"}],\"targets\":[{\"id\":\"odd\"},{\"id\":\"even\"}]}}"), null));
        assertFalse(grade("DRAG_AND_DROP", "{\"matches\":{\"odd\":\"one\"}}", "{\"matches\":{\"odd\":\"two\"}}"));
    }

    @Test
    void gradesHotTextAndHotSpotSelectionsAgainstConfiguredIds() throws Exception {
        assertTrue(grader.grade("HOT_TEXT", json("{\"selectedSegmentIds\":[\"s1\"]}"),
            json("{\"selectedIds\":[\"S1\"]}"),
            json("{\"questionConfig\":{\"contentParts\":[{\"type\":\"segment\",\"id\":\"s1\"}]}}"), null));
        assertFalse(grader.grade("HOT_TEXT", json("{\"selectedSegmentIds\":[\"s1\"]}"),
            json("{\"selectedSegmentIds\":[\"s1\",\"s1\"]}"),
            json("{\"questionConfig\":{\"contentParts\":[{\"type\":\"segment\",\"id\":\"s1\"}]}}"), null));
        assertTrue(grader.grade("HOT_SPOT", json("{\"selectedRegionIds\":[\"r1\"]}"),
            json("{\"regions\":[\"r1\"]}"),
            json("{\"questionConfig\":{\"regions\":[{\"id\":\"r1\"}]}}"), null));
        assertFalse(grader.grade("HOT_SPOT", json("{\"selectedRegionIds\":[\"r1\"]}"),
            json("{\"selectedRegionIds\":[\"r1\",\"r1\"]}"),
            json("{\"questionConfig\":{\"regions\":[{\"id\":\"r1\"}]}}"), null));
        assertFalse(grader.grade("HOT_SPOT", json("{\"selectedRegionIds\":[\"r2\"]}"),
            json("{\"selectedRegionIds\":[\"r2\"]}"),
            json("{\"questionConfig\":{\"hotSpots\":[{\"id\":\"r1\"}]}}"), null));
        assertTrue(grader.grade("HOT_SPOT", json("{\"selectedRegionIds\":[\"r1\"]}"),
            json("{\"selectedRegionIds\":[\"r1\"]}"),
            json("{\"questionConfig\":{\"hotSpots\":[{\"id\":\"r1\"}]}}"), null));
    }

    @Test
    void gradesTableGridSelectionsAndRejectsUnknownRows() throws Exception {
        JsonNode config = json("{\"questionConfig\":{\"rows\":[{\"id\":\"r1\"}],\"columns\":[{\"id\":\"c1\"}]}}");
        assertTrue(grader.grade("TABLE_GRID", json("{\"cells\":{\"r1.c1\":\"true\"}}"),
            json("{\"selections\":{\"r1\":\"c1\"}}"), config, null));
        assertFalse(grader.grade("TABLE_GRID", json("{\"selections\":{\"r1\":\"c1\"}}"),
            json("{\"selections\":{\"r2\":\"c1\"}}"), config, null));
    }

    @Test
    void rejectsDuplicateTableSelectionsAndFallsBackToLegacyCellsWhenNewShapeIsEmpty() throws Exception {
        JsonNode config = json("{\"questionConfig\":{\"rows\":[{\"id\":\"r1\"}],\"columns\":[{\"id\":\"c1\"}]}}");
        assertFalse(grader.grade("TABLE_GRID", json("{\"answers\":{\"r1\":[\"c1\"]}}"),
            json("{\"answers\":{\"r1\":[\"c1\",\"c1\"]}}"), config, null));
        assertFalse(grader.grade("TABLE_GRID", json("{\"answers\":{\"r1\":[\"c1\",\"c1\"]}}"),
            json("{\"answers\":{\"r1\":[\"c1\"]}}"), config, null));
        assertTrue(grader.grade("TABLE_GRID", json("{\"cells\":{\"r1.c1\":\"true\"}}"),
            json("{\"answers\":{},\"cells\":{\"r1.c1\":\"true\"}}"), config, null));
    }

    @Test
    void gradesGraphCoordinatesExactlyRejectsDuplicatePointsAndHonorsBounds() throws Exception {
        assertTrue(grade("GRAPH_QUESTION", "{\"points\":[{\"x\":2,\"y\":3}]}",
            "{\"points\":[{\"x\":2.0,\"y\":3.0}]}"));
        assertFalse(grader.grade("GRAPH_QUESTION", json("{\"points\":[{\"x\":2,\"y\":3}]}"),
            json("{\"points\":[{\"x\":2.1,\"y\":3}]}"),
            json("{\"questionConfig\":{\"graph\":{\"xMin\":-5,\"xMax\":5,\"yMin\":-5,\"yMax\":5}}}"),
            json("{\"tolerance\":0.1}")));
        assertFalse(grade("GRAPH_QUESTION", "{\"points\":[{\"x\":2,\"y\":3},{\"x\":2,\"y\":3}]}",
            "{\"points\":[{\"x\":2,\"y\":3},{\"x\":2,\"y\":3}]}"));
        assertFalse(grader.grade("GRAPH_QUESTION", json("{\"points\":[{\"x\":2,\"y\":3}]}"),
            json("{\"points\":[{\"x\":6,\"y\":3}]}"),
            json("{\"questionConfig\":{\"graph\":{\"xMin\":-5,\"xMax\":5,\"yMin\":-5,\"yMax\":5}}}"), null));
        JsonNode selectionConfig = json("{\"questionConfig\":{\"graphMode\":\"select_points\",\"points\":[{\"id\":\"p1\"}]}}");
        assertTrue(grader.grade("GRAPH_QUESTION", json("{\"selectedPointIds\":[\"p1\"]}"),
            json("{\"selectedPointIds\":[\"p1\"]}"), selectionConfig, null));
        assertFalse(grader.grade("GRAPH_QUESTION", json("{\"selectedPointIds\":[\"p1\",\"p1\"]}"),
            json("{\"selectedPointIds\":[\"p1\",\"p1\"]}"), selectionConfig, null));
        assertFalse(grader.grade("GRAPH_QUESTION", json("{\"selectedPointIds\":[\"missing\"]}"),
            json("{\"selectedPointIds\":[\"missing\"]}"), selectionConfig, null));
    }

    @Test
    void distinguishesInvalidSolutionSetAnswersFromIncorrectValidAnswers() throws Exception {
        String expected = "{\"solution\":{\"type\":\"ray\",\"endpoint\":1,\"endpointIncluded\":true,\"direction\":\"right\"}}";
        assertTrue(grade("SOLUTION_SET", expected,
            "{\"solution\":{\"type\":\"ray\",\"endpoint\":1.0,\"endpointIncluded\":true,\"direction\":\"right\"}}"));
        assertFalse(grade("SOLUTION_SET", expected,
            "{\"solution\":{\"type\":\"ray\",\"endpoint\":2,\"endpointIncluded\":true,\"direction\":\"right\"}}"));
        assertNull(grade("SOLUTION_SET", expected,
            "{\"solution\":{\"type\":\"ray\",\"endpoint\":\"1\",\"endpointIncluded\":true,\"direction\":\"right\"}}"));
        assertNull(grade("SOLUTION_SET", expected, "{}"));
        assertFalse(grader.hasMeaningfulAnswer("SOLUTION_SET",
            json("{\"solution\":{\"type\":\"ray\",\"endpoint\":\"1\",\"endpointIncluded\":true,\"direction\":\"right\"}}")));
        assertTrue(grader.hasMeaningfulAnswer("SOLUTION_SET",
            json("{\"solution\":{\"type\":\"ray\",\"endpoint\":1,\"endpointIncluded\":true,\"direction\":\"right\"}}")));
    }

    @Test
    void leavesManualOrUnknownTypesUnscored() throws Exception {
        assertNull(grade("ESSAY", "{\"answer\":\"sample\"}", "{\"value\":\"student response\"}"));
        assertNull(grade("CUSTOM_STRUCTURED", "{\"answers\":[\"A\"]}", "{\"answers\":[\"A\"]}"));
    }

    private Boolean grade(String type, String key, String answer) throws Exception {
        return grader.grade(type, json(key), json(answer), null, null);
    }

    private JsonNode json(String value) throws Exception {
        return mapper.readTree(value);
    }
}
