-- Provide the scoring choices used by the migrated SHSAT paper editor.
INSERT INTO scoring_profiles (exam_type_code, profile_code, version_no, name, algorithm_code, config_json, is_estimated)
SELECT 'SHSAT', 'SHSAT_2026_100', 1, '2026 SHSAT · 100 Questions', 'SHSAT_SCALE_TABLE', JSON_OBJECT(), FALSE
WHERE EXISTS (SELECT 1 FROM exam_types WHERE code = 'SHSAT')
  AND NOT EXISTS (SELECT 1 FROM scoring_profiles WHERE exam_type_code = 'SHSAT' AND profile_code = 'SHSAT_2026_100' AND version_no = 1);

INSERT INTO scoring_profiles (exam_type_code, profile_code, version_no, name, algorithm_code, config_json, is_estimated)
SELECT 'SHSAT', 'SHSAT_LEGACY_114', 1, '2025 SHSAT · 114 Questions', 'SHSAT_SCALE_TABLE', JSON_OBJECT(), FALSE
WHERE EXISTS (SELECT 1 FROM exam_types WHERE code = 'SHSAT')
  AND NOT EXISTS (SELECT 1 FROM scoring_profiles WHERE exam_type_code = 'SHSAT' AND profile_code = 'SHSAT_LEGACY_114' AND version_no = 1);

UPDATE papers p
JOIN scoring_profiles sp ON sp.exam_type_code = p.exam_type_code
    AND sp.profile_code = 'SHSAT_2026_100' AND sp.version_no = 1
SET p.default_scoring_profile_id = sp.id
WHERE p.exam_type_code = 'SHSAT' AND p.default_scoring_profile_id IS NULL;
