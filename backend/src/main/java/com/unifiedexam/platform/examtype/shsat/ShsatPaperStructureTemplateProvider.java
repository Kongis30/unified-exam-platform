package com.unifiedexam.platform.examtype.shsat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.paper.PaperService;
import com.unifiedexam.platform.paper.PaperStructureTemplateProvider;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/** 与独立 SHSAT 系统一致，初始化 ELA/Math Part 及官方子题型。 */
@Component
public class ShsatPaperStructureTemplateProvider implements PaperStructureTemplateProvider {

    private final ObjectMapper objectMapper;

    public ShsatPaperStructureTemplateProvider(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public String examTypeCode() {
        return "SHSAT";
    }

    @Override
    public List<PaperService.SectionRequest> sections() {
        return List.of(
            part("ELA", "English Language Arts", "SHSAT English Language Arts section with 50 scored questions.", "1-50", List.of(
                subtype("ELA_REVISING_EDITING_PART_A", "REVISING_EDITING_PART_A", "Revising/Editing Part A", "Stand-alone language and writing questions."),
                subtype("ELA_REVISING_EDITING_PART_B", "REVISING_EDITING_PART_B", "Revising/Editing Part B", "Passage-based writing improvement questions."),
                subtype("ELA_READING_COMPREHENSION", "READING_COMPREHENSION", "Reading Comprehension", "Passage-based reading analysis questions.")
            )),
            part("MATH", "Mathematics", "SHSAT Mathematics section with 50 scored questions.", "51-100", List.of(
                subtype("MATH_MATH_FILL_IN_BLANK", "MATH_FILL_IN_BLANK", "Math Fill in the Blank", "Math questions answered by entering a value."),
                subtype("MATH_MATH_MULTIPLE_CHOICE", "MATH_MULTIPLE_CHOICE", "Math Multiple Choice", "Math questions answered by choosing one option."),
                subtype("MATH_MATH_TECH_ENHANCED", "MATH_TECH_ENHANCED", "Math Tech-Enhanced", "Technology-enhanced SHSAT math interaction questions.")
            ))
        );
    }

    private PaperService.SectionRequest part(String code, String title, String instructions, String range,
                                              List<PaperService.SectionRequest> subtypes) {
        return section(code, "PART", title, instructions,
            objectMapper.valueToTree(Map.of("partNumber", "ELA".equals(code) ? 1 : 2,
                "questionRange", range, "questionCount", 50, "partCode", code)),
            subtypes, "ELA".equals(code) ? 0 : 1);
    }

    private PaperService.SectionRequest subtype(String sectionCode, String code, String title, String instructions) {
        return section(sectionCode, "SUBTYPE", title, instructions,
            objectMapper.valueToTree(Map.of("questionRange", "", "questionCount", 0, "subTypeCode", code)),
            List.of(), subtypeOrder(code));
    }

    private int subtypeOrder(String code) {
        return switch (code) {
            case "REVISING_EDITING_PART_A", "MATH_FILL_IN_BLANK" -> 0;
            case "REVISING_EDITING_PART_B", "MATH_MULTIPLE_CHOICE" -> 1;
            default -> 2;
        };
    }

    private PaperService.SectionRequest section(String code, String kind, String title, String instructions,
                                                  JsonNode settings, List<PaperService.SectionRequest> children,
                                                  int order) {
        return new PaperService.SectionRequest(code, kind, title, order, instructions, settings,
            List.of(), children);
    }

}
