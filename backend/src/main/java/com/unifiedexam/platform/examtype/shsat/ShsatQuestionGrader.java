package com.unifiedexam.platform.examtype.shsat;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 按新版 SHSAT 题型结构评分；返回 null 表示需人工评分或题型尚未支持。 */
@Component
final class ShsatQuestionGrader {

    private static final Pattern LATEX_FRACTION = Pattern.compile("\\\\frac\\s*\\{([^{}]+)}\\s*\\{([^{}]+)}");

    Boolean grade(String rawType, JsonNode key, JsonNode answer, JsonNode render, JsonNode grading) {
        String type = normalize(rawType);
        JsonNode config = render != null && render.path("questionConfig").isObject()
            ? render.path("questionConfig") : render;
        if (type.contains("ESSAY") || type.contains("WRITING") || type.contains("UPLOAD")) return null;

        if (isSelection(type)) return selection(key, answer);
        if (type.equals("INLINE_CHOICE")) return inlineChoice(key, answer, config);
        if (type.equals("DRAG_AND_DROP")) return dragAndDrop(key, answer, config);
        if (type.equals("HOT_TEXT")) return selectionSet(key, answer, config, true);
        if (type.equals("HOT_SPOT")) return selectionSet(key, answer, config, false);
        if (type.equals("TABLE_GRID")) return tableGrid(key, answer, config);
        if (type.equals("GRAPH_QUESTION") || type.contains("POINT_GRAPH")) return graph(key, answer, config, grading);
        if (type.equals("SOLUTION_SET")) return solutionSet(key, answer);
        if (type.contains("FILL") || type.contains("BLANK") || type.contains("SHORT")
            || type.equals("TEXT") || type.equals("EQUATION_EDITOR")) return textAnswer(type, key, answer, config);
        return null;
    }

    private boolean isSelection(String type) {
        return type.equals("MULTIPLE_CHOICE") || type.equals("SINGLE_CHOICE") || type.equals("CHOICE")
            || type.contains("MULTI_SELECT") || type.contains("MULTISELECT") || type.contains("MULTIPLE_RESPONSE")
            || type.contains("MULTIPLE_ANSWER") || type.contains("CHECKBOX");
    }

    private Boolean selection(JsonNode key, JsonNode answer) {
        JsonNode expected = first(key, "correct", "answers", "selectedAnswers", "answer", "value");
        if (expected == null && key != null && !key.isObject()) expected = key;
        JsonNode actual = first(answer, "value", "answers", "selectedAnswers", "answer");
        if (actual == null && answer != null && !answer.isObject()) actual = answer;
        return expected != null && actual != null && !empty(actual) && tokens(expected).equals(tokens(actual));
    }

    private boolean textAnswer(String type, JsonNode key, JsonNode answer, JsonNode config) {
        String submitted = text(first(answer, "value", "answer", "text"));
        if (submitted.isBlank() && answer != null && answer.isValueNode()) submitted = answer.asText("");
        if (submitted.isBlank()) return false;
        JsonNode accepted = first(key, "acceptedAnswers", "answers", "values", "value", "answer", "correct");
        if (accepted == null && key != null && key.isValueNode()) accepted = key;
        List<String> values = new ArrayList<>();
        collectText(accepted, values);
        if (values.isEmpty()) return false;
        for (String expected : values) {
            if (normalizeExpression(expected, type, config).equals(normalizeExpression(submitted, type, config))
                || equivalentNumber(expected, submitted)) return true;
        }
        return false;
    }

    private boolean inlineChoice(JsonNode key, JsonNode answer, JsonNode config) {
        Map<String, String> expected = answerMap(key);
        Map<String, String> submitted = answerMap(answer);
        if (expected.isEmpty() || !expected.equals(submitted)) return false;
        Set<String> blankIds = ids(array(config, "blanks", "inlineChoices"));
        if (blankIds.isEmpty()) {
            Matcher matcher = Pattern.compile("\\{\\{\\s*blank:([A-Za-z0-9_-]+)\\s*}}")
                .matcher(config == null ? "" : text(config.path("inlineText")));
            while (matcher.find()) blankIds.add(token(matcher.group(1)));
        }
        if (!blankIds.isEmpty() && !blankIds.equals(expected.keySet())) return false;
        JsonNode blanks = array(config, "blanks", "inlineChoices");
        for (JsonNode blank : blanks) {
            String blankId = token(text(first(blank, "id", "blankId", "key")));
            if (!submitted.containsKey(blankId)) continue;
            Set<String> options = new LinkedHashSet<>();
            for (JsonNode option : array(blank, "options", "choices", "values")) {
                options.add(token(text(option.isObject() ? first(option, "key", "id", "value") : option)));
            }
            if (!options.isEmpty() && !options.contains(submitted.get(blankId))) return false;
        }
        return true;
    }

    private boolean dragAndDrop(JsonNode key, JsonNode answer, JsonNode config) {
        Set<String> targetIds = ids(array(config, "targets", "zones", "dropZones"));
        Set<String> choiceIds = ids(array(config, "choices", "items", "dragItems"));
        Map<String, Set<String>> expected = placements(key, targetIds, choiceIds);
        Map<String, Set<String>> submitted = placements(answer, targetIds, choiceIds);
        return !expected.isEmpty() && expected.equals(submitted);
    }

    private Map<String, Set<String>> placements(JsonNode data, Set<String> targets, Set<String> choices) {
        JsonNode node = first(data, "placements", "groups", "targetPlacements", "matches", "answers", "selections");
        if (node == null || !node.isObject()) return Map.of();
        Map<String, Set<String>> result = new LinkedHashMap<>();
        Set<String> used = new LinkedHashSet<>();
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String left = token(entry.getKey());
            JsonNode rawValues = entry.getValue();
            List<String> values = new ArrayList<>();
            if (rawValues.isArray()) rawValues.forEach(value -> values.add(token(text(value))));
            else values.add(token(text(rawValues)));
            for (String value : values) {
                String target = left;
                String choice = value;
                if ((!targets.isEmpty() && !targets.contains(left) || !choices.isEmpty() && !choices.contains(value))
                    && targets.contains(value) && choices.contains(left)) {
                    target = value;
                    choice = left;
                }
                if (target.isBlank() || choice.isBlank() || (!targets.isEmpty() && !targets.contains(target))
                    || (!choices.isEmpty() && !choices.contains(choice)) || !used.add(choice)) return Map.of();
                result.computeIfAbsent(target, ignored -> new LinkedHashSet<>()).add(choice);
            }
        }
        return result;
    }

    private boolean selectionSet(JsonNode key, JsonNode answer, JsonNode config, boolean hotText) {
        String[] keyFields = hotText
            ? new String[]{"selectedSegmentIds", "selectedIds", "answers", "regions"}
            : new String[]{"selectedRegionIds", "regions", "selectedIds", "answers"};
        Set<String> expected = tokens(first(key, keyFields));
        Set<String> submitted = tokens(first(answer, hotText
            ? new String[]{"selectedSegmentIds", "selectedIds", "answers", "regions"}
            : new String[]{"selectedRegionIds", "regions", "selectedIds", "answers"}));
        if (expected.isEmpty() || !expected.equals(submitted)) return false;
        Set<String> allowed = new LinkedHashSet<>();
        if (hotText) {
            for (JsonNode part : array(config, "contentParts", "segments")) {
                if ("segment".equalsIgnoreCase(text(part.path("type"))) || part.path("selectable").asBoolean(false)) {
                    String id = token(text(part.path("id")));
                    if (!id.isBlank()) allowed.add(id);
                }
            }
        } else {
            allowed = ids(array(config, "regions", "hotSpotRegions"));
        }
        return allowed.isEmpty() || allowed.containsAll(expected);
    }

    private boolean tableGrid(JsonNode key, JsonNode answer, JsonNode config) {
        boolean textMode = Set.of("text", "fill", "fill_blank", "table_fill_blank")
            .contains(token(text(first(config, "selectionMode", "mode")).toLowerCase(Locale.ROOT)));
        Map<String, Set<String>> expected = tableRows(key, textMode);
        Map<String, Set<String>> submitted = tableRows(answer, textMode);
        if (expected.isEmpty() || !expected.equals(submitted)) return false;
        Set<String> rowIds = ids(array(config, "rows", "tableRows"));
        Set<String> colIds = ids(array(config, "columns", "tableColumns"));
        for (Map.Entry<String, Set<String>> row : expected.entrySet()) {
            if (!rowIds.isEmpty() && !rowIds.contains(row.getKey())) return false;
            for (String col : row.getValue()) if (!colIds.isEmpty() && !colIds.contains(col)) return false;
        }
        return true;
    }

    private Map<String, Set<String>> tableRows(JsonNode data, boolean textMode) {
        JsonNode rows = first(data, "answers", "selections", "rowSelections", "selectedColumns", "matches");
        if (rows != null && rows.isObject()) {
            Map<String, Set<String>> result = new LinkedHashMap<>();
            rows.fields().forEachRemaining(entry -> result.put(token(entry.getKey()), tokens(entry.getValue())));
            return result;
        }
        JsonNode cells = first(data, "cells");
        if (cells == null || !cells.isObject()) return Map.of();
        Map<String, Set<String>> result = new LinkedHashMap<>();
        cells.fields().forEachRemaining(entry -> {
            String[] parts = token(entry.getKey()).split("\\.", 2);
            if (parts.length != 2 || parts[0].isBlank() || parts[1].isBlank()) return;
            String value = token(text(entry.getValue()));
            if (textMode) result.computeIfAbsent(parts[0], ignored -> new LinkedHashSet<>()).add(parts[1] + "=" + value);
            else if (isSelected(value) || value.equals(parts[1])) result.computeIfAbsent(parts[0], ignored -> new LinkedHashSet<>()).add(parts[1]);
        });
        return result;
    }

    private boolean graph(JsonNode key, JsonNode answer, JsonNode config, JsonNode grading) {
        Set<String> expectedIds = tokens(first(key, "selectedPointIds", "pointIds"));
        Set<String> submittedIds = tokens(first(answer, "selectedPointIds", "pointIds"));
        if (!expectedIds.isEmpty() || !submittedIds.isEmpty()) {
            Set<String> configured = ids(array(config, "points"));
            return !expectedIds.isEmpty() && expectedIds.equals(submittedIds)
                && (configured.isEmpty() || configured.containsAll(expectedIds));
        }
        List<double[]> expected = points(first(key, "points", "placedPoints", "selectedPoints"));
        List<double[]> submitted = points(first(answer, "points", "placedPoints", "selectedPoints"));
        if (expected.isEmpty() || expected.size() != submitted.size()) return false;
        double tolerance = decimal(first(grading, "tolerance"), decimal(first(key, "tolerance"), 0));
        for (double[] target : expected) {
            boolean found = submitted.stream().anyMatch(value -> Math.abs(target[0] - value[0]) <= tolerance + 1e-9
                && Math.abs(target[1] - value[1]) <= tolerance + 1e-9);
            if (!found) return false;
        }
        return true;
    }

    private List<double[]> points(JsonNode node) {
        List<double[]> result = new ArrayList<>();
        if (node == null || !node.isArray()) return result;
        for (JsonNode point : node) {
            if (!point.hasNonNull("x") || !point.hasNonNull("y")) return List.of();
            try { result.add(new double[]{Double.parseDouble(text(point.get("x"))), Double.parseDouble(text(point.get("y")))}); }
            catch (NumberFormatException exception) { return List.of(); }
        }
        return result;
    }

    private boolean solutionSet(JsonNode key, JsonNode answer) {
        JsonNode expected = first(key, "solution", "answer");
        JsonNode submitted = first(answer, "solution", "answer");
        if (expected == null) expected = key;
        if (submitted == null) submitted = answer;
        if (expected == null || submitted == null) return false;
        String type = token(text(expected.path("type")));
        if (type.isBlank() || !type.equals(token(text(submitted.path("type"))))) return false;
        for (String field : List.of("direction", "endpointIncluded", "leftIncluded", "rightIncluded")) {
            if (expected.has(field) && !normalizedField(expected.get(field)).equals(normalizedField(submitted.get(field)))) return false;
        }
        for (String field : List.of("endpoint", "left", "right")) {
            if (expected.hasNonNull(field) && !sameDecimal(expected.get(field), submitted.get(field))) return false;
        }
        return true;
    }

    private Map<String, String> answerMap(JsonNode data) {
        JsonNode node = first(data, "answers", "selectedAnswers", "selections", "values");
        if (node == null) node = data;
        Map<String, String> result = new LinkedHashMap<>();
        if (node != null && node.isObject()) {
            node.fields().forEachRemaining(entry -> {
                if (!Set.of("value", "label", "text", "correct").contains(entry.getKey())) {
                    result.put(token(entry.getKey()), token(text(entry.getValue())));
                }
            });
        } else if (node != null && node.isArray()) {
            for (JsonNode item : node) {
                String id = token(text(first(item, "blankId", "id", "key")));
                String value = token(text(first(item, "optionKey", "value", "answer")));
                if (id.isBlank() || value.isBlank() || result.putIfAbsent(id, value) != null) return Map.of();
            }
        }
        result.values().removeIf(String::isBlank);
        return result;
    }

    private Set<String> ids(JsonNode array) {
        Set<String> result = new LinkedHashSet<>();
        if (array != null && array.isArray()) array.forEach(item -> {
            String id = token(text(first(item, "id", "key")));
            if (!id.isBlank()) result.add(id);
        });
        return result;
    }

    private Set<String> tokens(JsonNode node) {
        Set<String> result = new LinkedHashSet<>();
        if (node == null || node.isNull()) return result;
        if (node.isArray()) node.forEach(item -> result.add(token(text(item))));
        else if (node.isObject()) node.fields().forEachRemaining(entry -> {
            if (isSelected(text(entry.getValue()))) result.add(token(entry.getKey()));
        });
        else for (String part : node.asText("").split("[,;|]")) if (!token(part).isBlank()) result.add(token(part));
        result.removeIf(String::isBlank);
        return result;
    }

    private List<String> collectText(JsonNode node, List<String> values) {
        if (node == null || node.isNull()) return values;
        if (node.isArray()) node.forEach(item -> collectText(item, values));
        else if (node.isObject()) {
            JsonNode value = first(node, "value", "text", "answer");
            if (value != null) values.add(text(value));
        } else values.add(node.asText(""));
        return values;
    }

    private JsonNode array(JsonNode node, String... fields) {
        JsonNode value = first(node, fields);
        return value != null && value.isArray() ? value : null;
    }

    private JsonNode first(JsonNode node, String... fields) {
        if (node == null || !node.isObject()) return null;
        for (String field : fields) {
            JsonNode value = node.get(field);
            if (value != null && !value.isNull()) return value;
        }
        return null;
    }

    private boolean empty(JsonNode node) {
        return node == null || node.isNull()
            || (node.isTextual() && node.asText().isBlank())
            || ((node.isArray() || node.isObject()) && node.isEmpty());
    }

    private boolean isSelected(String value) {
        return Set.of("TRUE", "1", "YES", "Y", "ON", "SELECTED", "CHECKED").contains(token(value));
    }

    private String normalizeExpression(String value, String type, JsonNode config) {
        String result = value == null ? "" : value.trim();
        Matcher fraction = LATEX_FRACTION.matcher(result);
        result = fraction.replaceAll("$1/$2").replace("\\times", "*").replace("\\cdot", "*")
            .replace("×", "*").replace("÷", "/").replace("−", "-").replace("−", "-")
            .replaceAll("\\\\left|\\\\right", "");
        if (type.equals("EQUATION_EDITOR") || config != null && config.path("normalization").path("ignoreWhitespace").asBoolean(true)) {
            result = result.replaceAll("\\s+", "");
        }
        if (config == null || config.path("normalization").path("caseInsensitive").asBoolean(true)) {
            result = result.toUpperCase(Locale.ROOT);
        }
        return result;
    }

    private boolean equivalentNumber(String left, String right) {
        BigDecimal a = number(left);
        BigDecimal b = number(right);
        return a != null && b != null && a.compareTo(b) == 0;
    }

    private BigDecimal number(String value) {
        if (value == null) return null;
        String normalized = value.trim().replaceAll("\\s+", "");
        Matcher fraction = LATEX_FRACTION.matcher(normalized);
        if (fraction.matches()) normalized = fraction.group(1) + "/" + fraction.group(2);
        try {
            if (normalized.contains("/")) {
                String[] parts = normalized.split("/", -1);
                if (parts.length != 2) return null;
                return new BigDecimal(parts[0]).divide(new BigDecimal(parts[1]), 12, java.math.RoundingMode.HALF_UP).stripTrailingZeros();
            }
            return new BigDecimal(normalized).stripTrailingZeros();
        } catch (NumberFormatException | ArithmeticException exception) {
            return null;
        }
    }

    private boolean sameDecimal(JsonNode left, JsonNode right) {
        try { return new BigDecimal(text(left)).compareTo(new BigDecimal(text(right))) == 0; }
        catch (NumberFormatException exception) { return false; }
    }

    private double decimal(JsonNode node, double fallback) {
        if (node == null) return fallback;
        try { return Double.parseDouble(text(node)); } catch (NumberFormatException exception) { return fallback; }
    }

    private String normalizedField(JsonNode value) {
        return value == null ? "" : value.isBoolean() ? Boolean.toString(value.asBoolean()) : token(text(value));
    }

    private String text(JsonNode node) { return node == null || node.isNull() ? "" : node.asText(""); }
    private String normalize(String value) { return value == null ? "" : value.trim().toUpperCase(Locale.ROOT); }
    private String token(String value) { return value == null ? "" : value.trim().replaceAll("\\s+", "").toUpperCase(Locale.ROOT); }
}
