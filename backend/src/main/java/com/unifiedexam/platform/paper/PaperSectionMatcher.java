package com.unifiedexam.platform.paper;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** 按层级匹配来源与目标试卷的分组，兼容旧 SHSAT 试卷的名称和代码格式。 */
final class PaperSectionMatcher {

    private PaperSectionMatcher() { }

    /** 递归建立来源分组到目标分组的映射；子分组只在已匹配的父分组内查找。 */
    static Map<Long, Long> mapSections(List<PaperService.SectionView> source,
                                       List<PaperService.SectionView> target) {
        Map<Long, Long> result = new HashMap<>();
        mapChildren(source, target, null, null, result);
        return result;
    }

    private static void mapChildren(List<PaperService.SectionView> source,
                                    List<PaperService.SectionView> target,
                                    PaperService.SectionView sourceParent,
                                    PaperService.SectionView targetParent,
                                    Map<Long, Long> result) {
        for (PaperService.SectionView sourceSection : source) {
            List<PaperService.SectionView> sameKind = target.stream()
                .filter(targetSection -> sourceSection.sectionKind().equals(targetSection.sectionKind()))
                .toList();
            String sourceCode = codeKey(sourceSection, sourceParent);
            List<PaperService.SectionView> codeMatches = sameKind.stream()
                .filter(section -> sourceCode.equals(codeKey(section, targetParent)))
                .toList();
            PaperService.SectionView targetSection = codeMatches.size() == 1 ? codeMatches.get(0) : null;
            if (codeMatches.isEmpty()) {
                targetSection = findUnique(sameKind, section -> normalize(section.title())
                    .equals(normalize(sourceSection.title())));
            }
            if (targetSection == null) continue;

            result.put(sourceSection.id(), targetSection.id());
            mapChildren(sourceSection.children(), targetSection.children(), sourceSection, targetSection, result);
        }
    }

    private static PaperService.SectionView findUnique(List<PaperService.SectionView> candidates,
                                                        java.util.function.Predicate<PaperService.SectionView> matches) {
        PaperService.SectionView found = null;
        for (PaperService.SectionView candidate : candidates) {
            if (!matches.test(candidate)) continue;
            if (found != null) return null;
            found = candidate;
        }
        return found;
    }

    private static String codeKey(PaperService.SectionView section, PaperService.SectionView parent) {
        JsonNode settings = section.settings();
        if ("PART".equals(section.sectionKind())) {
            return normalize(settingText(settings, "partCode", section.sectionCode()));
        }
        if ("SUBTYPE".equals(section.sectionKind()) && parent != null) {
            String partCode = settingText(parent.settings(), "partCode", parent.sectionCode());
            String subtypeCode = settingText(settings, "subTypeCode", null);
            if (subtypeCode == null || subtypeCode.isBlank()) {
                String normalizedSectionCode = normalize(section.sectionCode());
                String normalizedPartCode = normalize(partCode);
                subtypeCode = normalizedSectionCode.startsWith(normalizedPartCode)
                    ? normalizedSectionCode.substring(normalizedPartCode.length()) : section.sectionCode();
            }
            return normalize(partCode) + normalize(subtypeCode);
        }
        return normalize(section.sectionCode());
    }

    private static String settingText(JsonNode settings, String key, String fallback) {
        JsonNode value = settings == null ? null : settings.get(key);
        return value == null || value.isNull() || value.asText().isBlank() ? fallback : value.asText();
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]+", "");
    }
}
