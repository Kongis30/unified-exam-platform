-- 保留来源账户或报名关系已丢失的历史记录，避免绑定到错误的统一账号。
CREATE TABLE sat_import_orphan_attempts (
    source_record_id BIGINT UNSIGNED NOT NULL,
    import_run_id BIGINT UNSIGNED NOT NULL,
    archive_reason VARCHAR(200) NOT NULL,
    source_record_json JSON NOT NULL,
    source_score_json JSON NULL,
    source_answers_json JSON NOT NULL,
    archived_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (source_record_id),
    CONSTRAINT fk_sat_orphan_attempt_run FOREIGN KEY (import_run_id)
        REFERENCES sat_import_runs (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
