package com.unifiedexam.platform.paper;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class PaperSectionMatcherTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void matchesNestedSectionsUsingNormalizedCodes() {
        PaperService.SectionView sourceSubtype = section(2, "ELA_Reading-Editing", "SUBTYPE",
            "Reading & Editing", settings("subTypeCode", "Reading & Editing"), List.of());
        PaperService.SectionView sourcePart = section(1, "english-language", "PART", "English Language Arts",
            settings("partCode", "ELA"), List.of(sourceSubtype));
        PaperService.SectionView targetSubtype = section(12, "ela_reading_editing", "SUBTYPE",
            "Revising and Editing", settings("subTypeCode", "READING_EDITING"), List.of());
        PaperService.SectionView targetPart = section(11, "ELA", "PART", "ELA",
            settings("partCode", "ela"), List.of(targetSubtype));

        assertEquals(Map.of(1L, 11L, 2L, 12L), PaperSectionMatcher.mapSections(
            List.of(sourcePart), List.of(targetPart)));
    }

    @Test
    void fallsBackToSectionNamesWhenCodesDiffer() {
        PaperService.SectionView sourceSubtype = section(2, "ELA_OLD_SUBTYPE", "SUBTYPE",
            "Reading Comprehension", settings("subTypeCode", "OLD_SUBTYPE"), List.of());
        PaperService.SectionView sourcePart = section(1, "OLD_PART", "PART", "English Language Arts",
            settings("partCode", "OLD_PART"), List.of(sourceSubtype));
        PaperService.SectionView targetSubtype = section(12, "READING_NEW", "SUBTYPE",
            "Reading Comprehension", settings("subTypeCode", "NEW_SUBTYPE"), List.of());
        PaperService.SectionView targetPart = section(11, "NEW_PART", "PART", "English Language Arts",
            settings("partCode", "NEW_PART"), List.of(targetSubtype));

        assertEquals(Map.of(1L, 11L, 2L, 12L), PaperSectionMatcher.mapSections(
            List.of(sourcePart), List.of(targetPart)));
    }

    @Test
    void matchesSameNamedSubtypesOnlyInsideTheirMatchedParent() {
        PaperService.SectionView sourceEla = section(1, "OLD_ELA", "PART", "English Language Arts",
            settings("partCode", "OLD_ELA"), List.of(section(2, "OLD_READING", "SUBTYPE",
                "Reading", settings("subTypeCode", "OLD_READING"), List.of())));
        PaperService.SectionView sourceMath = section(3, "OLD_MATH", "PART", "Math",
            settings("partCode", "OLD_MATH"), List.of(section(4, "OLD_READING", "SUBTYPE",
                "Reading", settings("subTypeCode", "OLD_READING"), List.of())));
        PaperService.SectionView targetMath = section(13, "NEW_MATH", "PART", "Math",
            settings("partCode", "NEW_MATH"), List.of(section(14, "MATH_READING", "SUBTYPE",
                "Reading", settings("subTypeCode", "MATH_READING"), List.of())));
        PaperService.SectionView targetEla = section(11, "NEW_ELA", "PART", "English Language Arts",
            settings("partCode", "NEW_ELA"), List.of(section(12, "ELA_READING", "SUBTYPE",
                "Reading", settings("subTypeCode", "ELA_READING"), List.of())));

        assertEquals(Map.of(1L, 11L, 2L, 12L, 3L, 13L, 4L, 14L), PaperSectionMatcher.mapSections(
            List.of(sourceEla, sourceMath), List.of(targetMath, targetEla)));
    }

    @Test
    void doesNotGuessWhenNameFallbackIsAmbiguous() {
        PaperService.SectionView source = section(1, "OLD_CODE", "PART", "English", null, List.of());
        PaperService.SectionView firstTarget = section(11, "NEW_ONE", "PART", "English", null, List.of());
        PaperService.SectionView secondTarget = section(12, "NEW_TWO", "PART", "English", null, List.of());

        assertFalse(PaperSectionMatcher.mapSections(List.of(source), List.of(firstTarget, secondTarget))
            .containsKey(source.id()));
    }

    private PaperService.SectionView section(long id, String code, String kind, String title,
                                             ObjectNode settings, List<PaperService.SectionView> children) {
        return new PaperService.SectionView(id, code, kind, title, 0, null, settings, List.of(), children);
    }

    private ObjectNode settings(String key, String value) {
        return mapper.createObjectNode().put(key, value);
    }
}
