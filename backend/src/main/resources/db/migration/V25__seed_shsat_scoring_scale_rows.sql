-- Seed the immutable raw-to-scaled tables used by the independent SHSAT system.
UPDATE scoring_profiles
SET config_json = JSON_OBJECT(
        'scaleVersion', CASE profile_code
            WHEN 'SHSAT_2026_100' THEN 'SHSAT_NEW_CONVERT_TABLE_2'
            ELSE 'SHSAT_LEGACY_57_PER_SECTION' END,
        'sections', JSON_ARRAY(
            JSON_OBJECT('code', 'ELA', 'maxRaw', CASE profile_code WHEN 'SHSAT_2026_100' THEN 50 ELSE 57 END, 'maxScaled', 360),
            JSON_OBJECT('code', 'MATH', 'maxRaw', CASE profile_code WHEN 'SHSAT_2026_100' THEN 50 ELSE 57 END, 'maxScaled', 360)
        ),
        'compositeMaxScore', 720
    )
WHERE exam_type_code = 'SHSAT' AND profile_code IN ('SHSAT_2026_100', 'SHSAT_LEGACY_114') AND version_no = 1;

INSERT INTO scoring_scale_rows (scoring_profile_id, section_code, variant_code, raw_score, scaled_score)
SELECT profile.id, section.section_code, 'DEFAULT', scale.raw_score, scale.scaled_score
FROM scoring_profiles profile
CROSS JOIN JSON_TABLE(JSON_ARRAY('ELA', 'MATH'), '$[*]' COLUMNS(section_code VARCHAR(30) PATH '$')) section
JOIN JSON_TABLE(JSON_ARRAY(
    JSON_ARRAY(0,0), JSON_ARRAY(1,17), JSON_ARRAY(2,33), JSON_ARRAY(3,48), JSON_ARRAY(4,62),
    JSON_ARRAY(5,74), JSON_ARRAY(6,86), JSON_ARRAY(7,98), JSON_ARRAY(8,109), JSON_ARRAY(9,120),
    JSON_ARRAY(10,131), JSON_ARRAY(11,138), JSON_ARRAY(12,145), JSON_ARRAY(13,152), JSON_ARRAY(14,159),
    JSON_ARRAY(15,166), JSON_ARRAY(16,172), JSON_ARRAY(17,178), JSON_ARRAY(18,184), JSON_ARRAY(19,190),
    JSON_ARRAY(20,196), JSON_ARRAY(21,201), JSON_ARRAY(22,206), JSON_ARRAY(23,210), JSON_ARRAY(24,214),
    JSON_ARRAY(25,218), JSON_ARRAY(26,222), JSON_ARRAY(27,226), JSON_ARRAY(28,230), JSON_ARRAY(29,234),
    JSON_ARRAY(30,238), JSON_ARRAY(31,242), JSON_ARRAY(32,246), JSON_ARRAY(33,250), JSON_ARRAY(34,255),
    JSON_ARRAY(35,260), JSON_ARRAY(36,264), JSON_ARRAY(37,268), JSON_ARRAY(38,273), JSON_ARRAY(39,278),
    JSON_ARRAY(40,283), JSON_ARRAY(41,289), JSON_ARRAY(42,295), JSON_ARRAY(43,301), JSON_ARRAY(44,308),
    JSON_ARRAY(45,315), JSON_ARRAY(46,323), JSON_ARRAY(47,332), JSON_ARRAY(48,341), JSON_ARRAY(49,350),
    JSON_ARRAY(50,360)
), '$[*]' COLUMNS(raw_score INT PATH '$[0]', scaled_score INT PATH '$[1]')) scale
WHERE profile.exam_type_code = 'SHSAT' AND profile.profile_code = 'SHSAT_2026_100' AND profile.version_no = 1
ON DUPLICATE KEY UPDATE scaled_score = VALUES(scaled_score);

INSERT INTO scoring_scale_rows (scoring_profile_id, section_code, variant_code, raw_score, scaled_score)
SELECT profile.id, section.section_code, 'DEFAULT', scale.raw_score, scale.scaled_score
FROM scoring_profiles profile
CROSS JOIN JSON_TABLE(JSON_ARRAY('ELA', 'MATH'), '$[*]' COLUMNS(section_code VARCHAR(30) PATH '$')) section
JOIN JSON_TABLE(JSON_ARRAY(
    JSON_ARRAY(0,0), JSON_ARRAY(1,14), JSON_ARRAY(2,30), JSON_ARRAY(3,39), JSON_ARRAY(4,54),
    JSON_ARRAY(5,68), JSON_ARRAY(6,79), JSON_ARRAY(7,90), JSON_ARRAY(8,100), JSON_ARRAY(9,111),
    JSON_ARRAY(10,118), JSON_ARRAY(11,126), JSON_ARRAY(12,135), JSON_ARRAY(13,141), JSON_ARRAY(14,147),
    JSON_ARRAY(15,153), JSON_ARRAY(16,158), JSON_ARRAY(17,163), JSON_ARRAY(18,169), JSON_ARRAY(19,173),
    JSON_ARRAY(20,178), JSON_ARRAY(21,183), JSON_ARRAY(22,187), JSON_ARRAY(23,191), JSON_ARRAY(24,194),
    JSON_ARRAY(25,197), JSON_ARRAY(26,201), JSON_ARRAY(27,204), JSON_ARRAY(28,208), JSON_ARRAY(29,212),
    JSON_ARRAY(30,215), JSON_ARRAY(31,219), JSON_ARRAY(32,222), JSON_ARRAY(33,226), JSON_ARRAY(34,229),
    JSON_ARRAY(35,232), JSON_ARRAY(36,236), JSON_ARRAY(37,240), JSON_ARRAY(38,243), JSON_ARRAY(39,247),
    JSON_ARRAY(40,250), JSON_ARRAY(41,254), JSON_ARRAY(42,257), JSON_ARRAY(43,261), JSON_ARRAY(44,265),
    JSON_ARRAY(45,269), JSON_ARRAY(46,274), JSON_ARRAY(47,278), JSON_ARRAY(48,283), JSON_ARRAY(49,290),
    JSON_ARRAY(50,298), JSON_ARRAY(51,305), JSON_ARRAY(52,314), JSON_ARRAY(53,323), JSON_ARRAY(54,333),
    JSON_ARRAY(55,342), JSON_ARRAY(56,352), JSON_ARRAY(57,360)
), '$[*]' COLUMNS(raw_score INT PATH '$[0]', scaled_score INT PATH '$[1]')) scale
WHERE profile.exam_type_code = 'SHSAT' AND profile.profile_code = 'SHSAT_LEGACY_114' AND profile.version_no = 1
ON DUPLICATE KEY UPDATE scaled_score = VALUES(scaled_score);

-- Historical attempts already have frozen profiles and raw section results; populate their matching scaled values.
UPDATE attempt_result_breakdowns result_breakdown
JOIN attempt_results result ON result.attempt_id = result_breakdown.attempt_id
JOIN attempts attempt ON attempt.id = result.attempt_id
JOIN exams exam ON exam.id = attempt.exam_id
JOIN scoring_profiles profile ON profile.id = COALESCE(result.scoring_profile_id, exam.scoring_profile_id)
JOIN scoring_scale_rows scale ON scale.scoring_profile_id = profile.id
    AND scale.section_code = result_breakdown.breakdown_code
    AND scale.variant_code = 'DEFAULT'
    AND scale.raw_score = result_breakdown.raw_score
SET result_breakdown.scaled_score = scale.scaled_score,
    result_breakdown.scaled_max_score = 360
WHERE profile.exam_type_code = 'SHSAT'
  AND profile.algorithm_code IN ('SHSAT_SCALE_TABLE', 'SHSAT_ESTIMATED')
  AND result_breakdown.parent_breakdown_code IS NULL
  AND result_breakdown.breakdown_code IN ('ELA', 'MATH');
