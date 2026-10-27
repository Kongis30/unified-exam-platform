package com.unifiedexam.platform.examtype.shsat;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.math.BigInteger;
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

/** 按新版 SHSAT 题型结构评分；未作答、需人工评分或题型尚未支持时返回 null。 */
@Component
final class ShsatQuestionGrader {

    private static final String[] MAX_SELECTION_FIELDS = {"selectionLimit", "maxSelections", "maxSelected"};
    private static final String[] EXACT_SELECTION_FIELDS = {"requiredSelections", "exactSelections", "selectCount", "selectionCount"};
    private static final Pattern LATEX_FRACTION = Pattern.compile("\\\\frac\\s*\\{([^{}]+)}\\s*\\{([^{}]+)}");
    private static final Pattern INTEGER = Pattern.compile("[+-]?\\d+");
    private static final Pattern DECIMAL = Pattern.compile("[+-]?(?:\\d+\\.\\d+|\\d+\\.|\\.\\d+)");

    Boolean grade(String rawType, JsonNode key, JsonNode answer, JsonNode render, JsonNode grading) {
        String type = normalize(rawType);
        if (!hasMeaningfulAnswer(type, answer)) return null;
        JsonNode config = render != null && render.path("questionConfig").isObject()
            ? render.path("questionConfig") : render;
        if (type.contains("ESSAY") || type.contains("WRITING") || type.contains("UPLOAD")) return null;

        if (isSelection(type)) return selection(type, key, answer, render, config, grading);
        if (type.equals("INLINE_CHOICE")) return inlineChoice(key, answer, config);
        if (type.equals("DRAG_AND_DROP")) return dragAndDrop(key, answer, config);
        if (type.equals("HOT_TEXT")) return selectionSet(key, answer, config, true);
        if (type.equals("HOT_SPOT")) return selectionSet(key, answer, config, false);
        if (type.equals("TABLE_GRID")) return tableGrid(key, answer, config);
        if (type.equals("GRAPH_QUESTION") || type.contains("POINT_GRAPH")) return graph(key, answer, config);
        if (type.equals("SOLUTION_SET")) return solutionSet(key, answer);
        if (type.contains("FILL") || type.contains("BLANK") || type.contains("SHORT")
            || type.equals("TEXT") || type.equals("EQUATION_EDITOR")) return textAnswer(type, key, answer, config);
        return null;
    }

    /** 与 SHSAT 题型评分共用同一空答案定义，嵌套结构中至少有一个有效值才算作答。 */
    boolean hasMeaningfulAnswer(JsonNode answer) {
        if (answer == null || answer.isNull()) return false;
        if (answer.isTextual()) return !answer.asText().isBlank();
        if (answer.isNumber() || answer.isBoolean()) return true;
        if (answer.isContainerNode()) {
            Iterator<JsonNode> values = answer.elements();
            while (values.hasNext()) {
                if (hasMeaningfulAnswer(values.next())) return true;
            }
        }
        return false;
    }

    boolean hasMeaningfulAnswer(String rawType, JsonNode answer) {
        if (normalize(rawType).equals("SOLUTION_SET")) return solution(answer) != null;
        return hasMeaningfulAnswer(answer);
    }

    private boolean isSelection(String type) {
        return type.equals("MULTIPLE_CHOICE") || type.equals("SINGLE_CHOICE") || type.equals("CHOICE")
            || type.contains("MULTI_SELECT") || type.contains("MULTISELECT") || type.contains("MULTIPLE_RESPONSE")
            || type.contains("MULTIPLE_ANSWER") || type.contains("CHECKBOX");
    }

    private Boolean selection(String type, JsonNode key, JsonNode answer, JsonNode render,
                              JsonNode config, JsonNode grading) {
        JsonNode expected = first(key, "correct", "answers", "selectedAnswers", "answer", "value");
        if (expected == null && key != null && !key.isObject()) expected = key;
        JsonNode actual = first(answer, "value", "answers", "selectedAnswers", "answer");
        if (actual == null && answer != null && !answer.isObject()) actual = answer;
        Set<String> validOptions = optionKeys(render == null ? null : render.path("options"));
        Set<String> expectedTokens = tokens(expected);
        Set<String> actualTokens = tokens(actual);
        boolean fixedSelection = type.contains("FIXED") || type.contains("EXACT");
        Integer requiredCount = firstConfiguredCount(config, grading,
            fixedSelection ? concat(MAX_SELECTION_FIELDS, EXACT_SELECTION_FIELDS) : EXACT_SELECTION_FIELDS);
        if (requiredCount == null && fixedSelection && !expectedTokens.isEmpty()) requiredCount = expectedTokens.size();
        if (requiredCount != null && actualTokens.size() != requiredCount) return false;
        Integer maxCount = firstConfiguredCount(config, grading, MAX_SELECTION_FIELDS);
        if (requiredCount == null && maxCount != null && actualTokens.size() > maxCount) return false;
        return expected != null && actual != null && !empty(actual)
            && duplicateTokenCount(expected) == 0 && duplicateTokenCount(actual) == 0
            && (validOptions.isEmpty() || (validOptions.containsAll(expectedTokens) && validOptions.containsAll(actualTokens)))
            && expectedTokens.equals(actualTokens);
    }

    /** 固定/最多选择数可存在题目配置或评分规则中，和独立 SHSAT 保持一致。 */
    private Integer firstConfiguredCount(JsonNode config, JsonNode grading, String... fields) {
        Integer count = positiveInteger(config, fields);
        return count != null ? count : positiveInteger(grading, fields);
    }

    private Integer positiveInteger(JsonNode node, String... fields) {
        if (node == null || !node.isObject()) return null;
        for (String field : fields) {
            JsonNode value = node.get(field);
            if (value == null || value.isNull()) continue;
            try {
                int count = value.isNumber() ? value.intValue() : Integer.parseInt(value.asText().trim());
                if (count > 0 && (value.isNumber() ? value.asDouble() == count : true)) return count;
            } catch (NumberFormatException ignored) {
                // Ignore malformed constraints, matching standalone behavior.
            }
        }
        return null;
    }

    private String[] concat(String[] first, String[] second) {
        String[] fields = new String[first.length + second.length];
        System.arraycopy(first, 0, fields, 0, first.length);
        System.arraycopy(second, 0, fields, first.length, second.length);
        return fields;
    }

    /** 选择题答案键和提交值都必须引用试题实际配置的选项；旧题没有选项配置时保留兼容行为。 */
    private Set<String> optionKeys(JsonNode options) {
        Set<String> keys = new LinkedHashSet<>();
        if (options == null || options.isNull()) return keys;
        if (options.isArray()) {
            for (JsonNode option : options) {
                String value = option.isObject()
                    ? text(first(option, "key", "id", "value"))
                    : text(option);
                String normalized = token(value);
                if (!normalized.isBlank()) keys.add(normalized);
            }
        } else if (options.isObject()) {
            options.fieldNames().forEachRemaining(name -> {
                String normalized = token(name);
                if (!normalized.isBlank()) keys.add(normalized);
            });
        }
        return keys;
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
        Set<String> blankIds = ids(array(config, "blanks", "dropdowns", "choices", "inlineChoices"));
        if (blankIds.isEmpty()) {
            Matcher matcher = Pattern.compile("\\{\\{\\s*blank:([A-Za-z0-9_-]+)\\s*}}")
                .matcher(config == null ? "" : text(config.path("inlineText")));
            while (matcher.find()) blankIds.add(token(matcher.group(1)));
        }
        if (!blankIds.isEmpty() && !blankIds.equals(expected.keySet())) return false;
        JsonNode blanks = array(config, "blanks", "dropdowns", "choices", "inlineChoices");
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
        if (targetIds.isEmpty() || choiceIds.isEmpty()) return false;
        Map<String, Set<String>> expected = placements(key, targetIds, choiceIds);
        Map<String, Set<String>> submitted = placements(answer, targetIds, choiceIds);
        return !expected.isEmpty() && expected.equals(submitted);
    }

    private Map<String, Set<String>> placements(JsonNode data, Set<String> targets, Set<String> choices) {
        JsonNode node = first(data, "placements", "groups", "targetPlacements");
        boolean groupedPlacements = node != null && node.isObject();
        if (!groupedPlacements) node = first(data, "matches", "answers", "selections");
        if (node == null || !node.isObject()) return Map.of();
        Map<String, Set<String>> result = new LinkedHashMap<>();
        Set<String> used = new LinkedHashSet<>();
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> entry = fields.next();
            String left = token(entry.getKey());
            JsonNode rawValues = entry.getValue();
            if (groupedPlacements && !rawValues.isArray()) return Map.of();
            List<String> values = new ArrayList<>();
            if (rawValues.isArray()) rawValues.forEach(value -> values.add(token(text(value))));
            else values.add(token(text(rawValues)));
            for (String value : values) {
                String target = left;
                String choice = value;
                if (!groupedPlacements && (!targets.contains(left) || !choices.contains(value))
                    && targets.contains(value) && choices.contains(left)) {
                    target = value;
                    choice = left;
                }
                if (target.isBlank() || choice.isBlank() || !targets.contains(target)
                    || !choices.contains(choice) || !used.add(choice)) return Map.of();
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
        JsonNode expectedNode = first(key, keyFields);
        JsonNode submittedNode = first(answer, hotText
            ? new String[]{"selectedSegmentIds", "selectedIds", "answers", "regions"}
            : new String[]{"selectedRegionIds", "regions", "selectedIds", "answers"});
        if (expected.isEmpty() || !expected.equals(submitted)
            || duplicateTokenCount(expectedNode) > 0 || duplicateTokenCount(submittedNode) > 0) return false;
        Set<String> allowed = new LinkedHashSet<>();
        if (hotText) {
            for (JsonNode part : array(config, "contentParts", "segments")) {
                if ("segment".equalsIgnoreCase(text(part.path("type"))) || part.path("selectable").asBoolean(false)) {
                    String id = token(text(part.path("id")));
                    if (!id.isBlank()) allowed.add(id);
                }
            }
        } else {
            allowed = ids(array(config, "regions", "hotSpotRegions", "hotSpots"));
        }
        return allowed.isEmpty() || allowed.containsAll(expected);
    }

    private boolean tableGrid(JsonNode key, JsonNode answer, JsonNode config) {
        boolean textMode = Set.of("text", "fill", "fill_blank", "table_fill_blank")
            .contains(token(text(first(config, "selectionMode", "mode")).toLowerCase(Locale.ROOT)));
        Map<String, Set<String>> expected = tableRows(key, textMode);
        Map<String, Set<String>> submitted = tableRows(answer, textMode);
        if (expected.isEmpty() || !expected.equals(submitted)
            || duplicateTableSelections(key) > 0 || duplicateTableSelections(answer) > 0) return false;
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
            rows.fields().forEachRemaining(entry -> {
                String rowId = token(entry.getKey());
                Set<String> columns = tokens(entry.getValue());
                if (!rowId.isBlank() && !columns.isEmpty()) result.put(rowId, columns);
            });
            if (!result.isEmpty()) return result;
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

    private int duplicateTableSelections(JsonNode data) {
        JsonNode rows = first(data, "answers", "selections", "rowSelections", "selectedColumns", "matches");
        if (rows == null || !rows.isObject()) return 0;
        int duplicates = 0;
        Iterator<JsonNode> values = rows.elements();
        while (values.hasNext()) duplicates += duplicateTokenCount(values.next());
        return duplicates;
    }

    private boolean graph(JsonNode key, JsonNode answer, JsonNode config) {
        String mode = token(text(first(config, "graphMode"))).toLowerCase(Locale.ROOT);
        if (mode.equals("select_points")) {
            JsonNode expectedNode = first(key, "selectedPointIds");
            JsonNode submittedNode = first(answer, "selectedPointIds");
            Set<String> expected = tokens(expectedNode);
            Set<String> submitted = tokens(submittedNode);
            Set<String> configured = ids(array(config, "points"));
            return !expected.isEmpty() && expected.equals(submitted)
                && duplicateTokenCount(expectedNode) == 0 && duplicateTokenCount(submittedNode) == 0
                && configured.containsAll(expected);
        }

        GraphBounds bounds = graphBounds(config);
        CoordinateSet expected = coordinatePoints(first(key, "points", "placedPoints", "selectedPoints"), bounds);
        CoordinateSet submitted = coordinatePoints(first(answer, "points", "placedPoints", "selectedPoints"), bounds);
        return !expected.points().isEmpty() && expected.invalidCount() == 0 && submitted.invalidCount() == 0
            && expected.points().equals(submitted.points());
    }

    private CoordinateSet coordinatePoints(JsonNode node, GraphBounds bounds) {
        Set<String> coordinates = new LinkedHashSet<>();
        if (node == null || !node.isArray()) return new CoordinateSet(coordinates, 0);
        int invalidCount = 0;
        for (JsonNode point : node) {
            if (!point.isObject() || !point.hasNonNull("x") || !point.hasNonNull("y")) {
                invalidCount++;
                continue;
            }
            try {
                double x = Double.parseDouble(text(point.get("x")));
                double y = Double.parseDouble(text(point.get("y")));
                String coordinate = coordinateValue(x) + "," + coordinateValue(y);
                if (!Double.isFinite(x) || !Double.isFinite(y) || !bounds.contains(x, y) || !coordinates.add(coordinate)) {
                    invalidCount++;
                }
            } catch (NumberFormatException exception) {
                invalidCount++;
            }
        }
        return new CoordinateSet(coordinates, invalidCount);
    }

    private String coordinateValue(double value) {
        return value == Math.rint(value) ? Long.toString(Math.round(value)) : Double.toString(value);
    }

    private GraphBounds graphBounds(JsonNode config) {
        JsonNode graph = config == null ? null : config.path("graph");
        JsonNode source = graph != null && graph.isObject() ? graph : config;
        return new GraphBounds(optionalDouble(source, "xMin"), optionalDouble(source, "xMax"),
            optionalDouble(source, "yMin"), optionalDouble(source, "yMax"));
    }

    private Double optionalDouble(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (value == null || value.isNull()) return null;
        try {
            double parsed = Double.parseDouble(text(value));
            return Double.isFinite(parsed) ? parsed : null;
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private record CoordinateSet(Set<String> points, int invalidCount) {}

    private record GraphBounds(Double xMin, Double xMax, Double yMin, Double yMax) {
        private boolean contains(double x, double y) {
            return (xMin == null || x >= xMin) && (xMax == null || x <= xMax)
                && (yMin == null || y >= yMin) && (yMax == null || y <= yMax);
        }
    }

    private Boolean solutionSet(JsonNode key, JsonNode answer) {
        Solution expected = solution(key);
        Solution submitted = solution(answer);
        if (expected == null) return false;
        if (submitted == null) return null;
        return expected.equals(submitted);
    }

    private Solution solution(JsonNode data) {
        // 与独立版一致，只接受数值端点的标准射线；缺失或畸形答案按未作答处理。
        JsonNode solution = first(data, "solution", "answer");
        if (solution == null) solution = data;
        if (solution == null || !solution.isObject()) return null;

        String type = text(solution.path("type")).trim();
        if (type.isBlank()) type = "ray";
        JsonNode endpoint = solution.get("endpoint");
        String direction = text(solution.path("direction")).trim();
        if (!"ray".equals(type) || endpoint == null || !endpoint.isNumber()
            || (!"left".equals(direction) && !"right".equals(direction))) return null;
        return new Solution(endpoint.doubleValue(), solution.path("endpointIncluded").asBoolean(false), direction);
    }

    private record Solution(double endpoint, boolean endpointIncluded, String direction) { }

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

    private int duplicateTokenCount(JsonNode node) {
        if (node == null || node.isNull() || node.isObject()) return 0;
        List<String> values = new ArrayList<>();
        if (node.isArray()) node.forEach(item -> values.add(token(text(item))));
        else for (String value : node.asText("").split("[,;|]")) values.add(token(value));

        Set<String> seen = new LinkedHashSet<>();
        int duplicates = 0;
        for (String value : values) {
            if (!value.isBlank() && !seen.add(value)) duplicates++;
        }
        return duplicates;
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
        if (type.equals("EQUATION_EDITOR")) {
            JsonNode normalization = config == null ? null : config.path("normalization");
            boolean normalizeOperators = normalization == null || normalization.path("normalizeOperators").asBoolean(true);
            boolean ignoreWhitespace = normalization == null || normalization.path("ignoreWhitespace").asBoolean(true);
            if (normalizeOperators) result = normalizeEquationEditorOperators(result);
            result = ignoreWhitespace ? result.replaceAll("\\s+", "") : result.trim();
            if (normalizeOperators) result = result.replaceAll("(?<=[A-Za-z0-9)])\\*(?=[A-Za-z0-9(])", "");
        } else {
            Matcher fraction = LATEX_FRACTION.matcher(result);
            result = fraction.replaceAll("$1/$2").replace("\\times", "*").replace("\\cdot", "*")
                .replace("×", "*").replace("÷", "/").replace("−", "-")
                .replaceAll("\\\\left|\\\\right", "");
            if (config != null && config.path("normalization").path("ignoreWhitespace").asBoolean(true)) {
                result = result.replaceAll("\\s+", "");
            }
        }
        if (config == null || config.path("normalization").path("caseInsensitive").asBoolean(true)) {
            result = result.toUpperCase(Locale.ROOT);
        }
        return result;
    }

    private String normalizeEquationEditorOperators(String value) {
        Matcher fraction = LATEX_FRACTION.matcher(value);
        return fraction.replaceAll("$1/$2")
            .replaceAll("\\\\sqrt\\s*\\{([^{}]+)}", "sqrt($1)")
            .replaceAll("\\^\\s*\\{([^{}]+)}", "^$1")
            .replace("\\left", "").replace("\\right", "")
            .replace("\\leq", "<=").replace("\\le", "<=")
            .replace("\\geq", ">=").replace("\\ge", ">=")
            .replace("\\neq", "!=").replace("\\ne", "!=")
            .replace("\\times", "*").replace("\\cdot", "*").replace("\\div", "/")
            .replace("\\pi", "pi").replace("×", "*").replace("·", "*").replace("÷", "/")
            .replace("−", "-").replace("–", "-").replace("—", "-")
            .replace("≤", "<=").replace("≥", ">=").replace("≠", "!=").replace("π", "pi")
            .replaceAll("√\\s*\\(", "sqrt(");
    }

    private boolean equivalentNumber(String left, String right) {
        RationalNumber a = number(left);
        RationalNumber b = number(right);
        return a != null && a.equals(b);
    }

    /** 与独立 SHSAT 一样以最简有理数比较，避免有限小数近似被当成精确相等。 */
    private RationalNumber number(String value) {
        if (value == null) return null;
        String normalized = value.trim().replaceAll("\\s+", "");
        Matcher fraction = LATEX_FRACTION.matcher(normalized);
        if (fraction.matches()) normalized = fraction.group(1) + "/" + fraction.group(2);

        int separator = normalized.indexOf('/');
        if (separator >= 0) {
            if (normalized.indexOf('/', separator + 1) >= 0) return null;
            String numerator = normalized.substring(0, separator);
            String denominator = normalized.substring(separator + 1);
            if (!INTEGER.matcher(numerator).matches() || !INTEGER.matcher(denominator).matches()) return null;
            BigInteger divisor = new BigInteger(denominator);
            return divisor.signum() == 0 ? null : new RationalNumber(new BigInteger(numerator), divisor);
        }
        if (INTEGER.matcher(normalized).matches()) return new RationalNumber(new BigInteger(normalized), BigInteger.ONE);
        if (!DECIMAL.matcher(normalized).matches()) return null;

        boolean negative = normalized.startsWith("-");
        String unsigned = normalized.startsWith("-") || normalized.startsWith("+") ? normalized.substring(1) : normalized;
        String[] parts = unsigned.split("\\.", -1);
        String integerPart = parts[0].isEmpty() ? "0" : parts[0];
        String decimalPart = parts.length > 1 ? parts[1] : "";
        BigInteger numerator = new BigInteger(integerPart + decimalPart);
        if (negative) numerator = numerator.negate();
        return new RationalNumber(numerator, BigInteger.TEN.pow(decimalPart.length()));
    }

    private record RationalNumber(BigInteger numerator, BigInteger denominator) {
        private RationalNumber {
            if (denominator.signum() < 0) {
                numerator = numerator.negate();
                denominator = denominator.negate();
            }
            BigInteger divisor = numerator.gcd(denominator);
            numerator = numerator.divide(divisor);
            denominator = denominator.divide(divisor);
        }
    }

    private String text(JsonNode node) { return node == null || node.isNull() ? "" : node.asText(""); }
    private String normalize(String value) { return value == null ? "" : value.trim().toUpperCase(Locale.ROOT); }
    private String token(String value) { return value == null ? "" : value.trim().replaceAll("\\s+", "").toUpperCase(Locale.ROOT); }
}
