-- Version exam-owned question payloads and preserve hierarchical report dimensions.

ALTER TABLE questions
    ADD COLUMN payload_schema_version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER question_type_code;

ALTER TABLE attempt_results
    ADD COLUMN scoring_profile_id BIGINT UNSIGNED NULL AFTER attempt_id,
    ADD COLUMN algorithm_version VARCHAR(120) NULL AFTER scoring_profile_id,
    ADD COLUMN breakdown_schema_version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER ungraded_count,
    ADD COLUMN is_estimated BOOLEAN NOT NULL DEFAULT FALSE AFTER breakdown_schema_version,
    ADD CONSTRAINT fk_attempt_results_scoring_profile FOREIGN KEY (scoring_profile_id)
        REFERENCES scoring_profiles (id) ON DELETE RESTRICT;

CREATE TABLE attempt_result_breakdowns (
    attempt_id BIGINT UNSIGNED NOT NULL,
    breakdown_code VARCHAR(200) NOT NULL,
    parent_breakdown_code VARCHAR(200) NULL,
    dimension_kind VARCHAR(30) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    raw_score DECIMAL(10,2) NULL,
    raw_max_score DECIMAL(10,2) NULL,
    scaled_score DECIMAL(10,2) NULL,
    scaled_max_score DECIMAL(10,2) NULL,
    metrics_json JSON NULL,
    PRIMARY KEY (attempt_id, breakdown_code),
    KEY idx_attempt_result_breakdowns_parent (attempt_id, parent_breakdown_code, sort_order),
    CONSTRAINT fk_attempt_result_breakdowns_result FOREIGN KEY (attempt_id)
        REFERENCES attempt_results (attempt_id) ON DELETE CASCADE,
    CONSTRAINT fk_attempt_result_breakdowns_parent FOREIGN KEY (attempt_id, parent_breakdown_code)
        REFERENCES attempt_result_breakdowns (attempt_id, breakdown_code) ON DELETE CASCADE,
    CONSTRAINT ck_attempt_result_breakdowns_scores CHECK (
        (raw_score IS NULL OR raw_max_score IS NULL OR raw_score <= raw_max_score)
        AND (scaled_score IS NULL OR scaled_max_score IS NULL OR scaled_score <= scaled_max_score)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
