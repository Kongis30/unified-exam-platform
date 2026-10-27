package com.unifiedexam.platform.examtype.shsat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

/** 按考试冻结的 SHSAT 评分配置将 ELA/Math raw 分转换为 scaled 分。 */
@Service
public class ShsatScoreScaleService {

    private static final String DEFAULT_PROFILE = "SHSAT_2026_100";
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ShsatScoreScaleService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    /** 交卷时读取发布场次绑定的 profile；未绑定 profile 时沿用独立版默认的 2026 规则。 */
    public Result calculate(Long scoringProfileId, Map<String, BigDecimal> rawScores) {
        Profile profile = findProfile(scoringProfileId);
        if (profile == null || !isScaleTable(profile.algorithmCode())) {
            return Result.rawOnly(profile == null ? null : profile.estimated());
        }

        JsonNode config = parseConfig(profile.configJson());
        Map<String, SectionConfig> sections = readSections(config);
        if (!sections.containsKey("ELA") || !sections.containsKey("MATH")) {
            throw new IllegalStateException("SHSAT scoring profile must configure ELA and MATH.");
        }

        Map<String, ScaledSection> scaled = new LinkedHashMap<>();
        for (String code : new String[]{"ELA", "MATH"}) {
            SectionConfig section = sections.get(code);
            int raw = rawValue(rawScores.getOrDefault(code, BigDecimal.ZERO), code, section.maxRaw());
            Integer scaledScore = scaledValue(profile.id(), code, raw);
            scaled.put(code, new ScaledSection(rawScores.getOrDefault(code, BigDecimal.ZERO), section.maxRaw(),
                scaledScore, section.maxScaled()));
        }

        ScaledSection ela = scaled.get("ELA");
        ScaledSection math = scaled.get("MATH");
        return new Result(profile.id(), profile.profileCode() + ":v" + profile.version(), profile.algorithmCode(), profile.estimated(),
            ela.scaledScore() + math.scaledScore(), config.path("compositeMaxScore").isNumber()
                ? config.path("compositeMaxScore").asInt() : null,
            Map.copyOf(scaled));
    }

    private Profile findProfile(Long profileId) {
        return jdbcTemplate.query("""
            SELECT id, profile_code, version_no, algorithm_code, is_estimated, config_json
            FROM scoring_profiles
            WHERE exam_type_code = 'SHSAT' AND ((? IS NULL AND profile_code = ?) OR id = ?)
            ORDER BY version_no DESC LIMIT 1
            """, rs -> rs.next() ? new Profile(rs.getLong("id"), rs.getString("profile_code"),
                rs.getInt("version_no"), rs.getString("algorithm_code"),
                rs.getBoolean("is_estimated"), rs.getString("config_json")) : null,
            profileId, DEFAULT_PROFILE, profileId);
    }

    private Integer scaledValue(long profileId, String sectionCode, int raw) {
        return jdbcTemplate.query("""
            SELECT scaled_score FROM scoring_scale_rows
            WHERE scoring_profile_id = ? AND section_code = ? AND variant_code = 'DEFAULT' AND raw_score = ?
            """, rs -> {
            if (!rs.next()) throw new IllegalStateException("SHSAT scoring profile is missing a required scale value.");
            return rs.getInt("scaled_score");
        }, profileId, sectionCode, raw);
    }

    private Map<String, SectionConfig> readSections(JsonNode config) {
        Map<String, SectionConfig> sections = new LinkedHashMap<>();
        JsonNode sectionConfig = config.path("sections");
        if (!sectionConfig.isArray()) sectionConfig = config.path("sectionConfig").path("sections");
        for (JsonNode item : sectionConfig) {
            String code = item.path("code").asText("").trim().toUpperCase();
            if (!code.isEmpty() && item.path("maxRaw").canConvertToInt() && item.path("maxScaled").canConvertToInt()) {
                sections.put(code, new SectionConfig(item.path("maxRaw").asInt(), item.path("maxScaled").asInt()));
            }
        }
        return sections;
    }

    private JsonNode parseConfig(String raw) {
        if (raw == null || raw.isBlank()) return objectMapper.createObjectNode();
        try {
            return objectMapper.readTree(raw);
        } catch (Exception exception) {
            throw new IllegalStateException("SHSAT scoring profile configuration is invalid.", exception);
        }
    }

    private boolean isScaleTable(String algorithmCode) {
        return "SHSAT_SCALE_TABLE".equals(algorithmCode) || "SHSAT_ESTIMATED".equals(algorithmCode);
    }

    private int rawValue(BigDecimal value, String sectionCode, int maxRaw) {
        final int raw;
        try {
            raw = value.setScale(0, RoundingMode.UNNECESSARY).intValueExact();
        } catch (ArithmeticException exception) {
            throw new IllegalStateException("Raw score for " + sectionCode + " must be a whole number.", exception);
        }
        if (raw < 0 || raw > maxRaw) {
            throw new IllegalStateException("Raw score for " + sectionCode + " is outside the scoring profile range.");
        }
        return raw;
    }

    private record Profile(long id, String profileCode, int version, String algorithmCode, boolean estimated, String configJson) { }
    private record SectionConfig(int maxRaw, int maxScaled) { }
    public record ScaledSection(BigDecimal rawScore, int rawMaxScore, int scaledScore, int scaledMaxScore) { }
    public record Result(Long scoringProfileId, String algorithmVersion, String scoringMode, boolean estimated,
                         Integer compositeScore, Integer compositeMaxScore, Map<String, ScaledSection> sections) {
        static Result rawOnly(boolean estimated) {
            return new Result(null, null, "RAW_ONLY", estimated, null, null, Map.of());
        }
    }
}
