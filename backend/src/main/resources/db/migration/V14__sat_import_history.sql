-- 记录独立 SAT 系统的迁移映射，并保存目标通用模型无法表达的 SAT 状态。
CREATE TABLE sat_import_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_database VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL,
    started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    finished_at DATETIME(6) NULL,
    summary_json JSON NULL,
    PRIMARY KEY (id),
    KEY idx_sat_import_runs_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sat_import_id_map (
    source_system VARCHAR(32) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    source_id VARCHAR(120) NOT NULL,
    target_id BIGINT UNSIGNED NULL,
    source_fingerprint CHAR(64) NOT NULL,
    import_run_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (source_system, entity_type, source_id),
    KEY idx_sat_import_map_target (entity_type, target_id),
    CONSTRAINT fk_sat_import_map_run FOREIGN KEY (import_run_id)
        REFERENCES sat_import_runs (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sat_class_settings (
    class_id BIGINT UNSIGNED NOT NULL,
    teacher_user_id BIGINT UNSIGNED NULL,
    starts_on DATE NULL,
    ends_on DATE NULL,
    source_status TINYINT NOT NULL,
    source_student_count INT UNSIGNED NULL,
    source_sort_order INT UNSIGNED NOT NULL DEFAULT 0,
    source_metadata_json JSON NOT NULL,
    PRIMARY KEY (class_id),
    CONSTRAINT fk_sat_class_settings_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_class_settings_teacher FOREIGN KEY (teacher_user_id)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sat_exam_settings (
    exam_id BIGINT UNSIGNED NOT NULL,
    source_exam_type VARCHAR(20) NOT NULL,
    rw_module1_seconds INT UNSIGNED NOT NULL,
    rw_module2_seconds INT UNSIGNED NOT NULL,
    math_module1_seconds INT UNSIGNED NOT NULL,
    math_module2_seconds INT UNSIGNED NOT NULL,
    rest_time_seconds INT UNSIGNED NOT NULL,
    max_students INT UNSIGNED NULL,
    source_student_count INT UNSIGNED NULL,
    source_status VARCHAR(20) NOT NULL,
    is_practice_archive BOOLEAN NOT NULL DEFAULT FALSE,
    source_metadata_json JSON NOT NULL,
    PRIMARY KEY (exam_id),
    CONSTRAINT fk_sat_exam_settings_exam FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sat_attempt_details (
    attempt_id BIGINT UNSIGNED NOT NULL,
    source_record_id BIGINT UNSIGNED NOT NULL,
    source_mode VARCHAR(20) NOT NULL,
    source_status VARCHAR(20) NOT NULL,
    source_current_module_id BIGINT UNSIGNED NULL,
    source_current_module_started_at DATETIME NULL,
    rw_module2_difficulty VARCHAR(20) NULL,
    math_module2_difficulty VARCHAR(20) NULL,
    rw_module1_seconds INT UNSIGNED NULL,
    rw_module2_seconds INT UNSIGNED NULL,
    math_module1_seconds INT UNSIGNED NULL,
    math_module2_seconds INT UNSIGNED NULL,
    rw_module1_raw INT UNSIGNED NULL,
    rw_module2_raw INT UNSIGNED NULL,
    math_module1_raw INT UNSIGNED NULL,
    math_module2_raw INT UNSIGNED NULL,
    abnormal_count INT UNSIGNED NOT NULL DEFAULT 0,
    source_score_json JSON NULL,
    source_report_json JSON NULL,
    source_live_presence_json JSON NULL,
    source_metadata_json JSON NOT NULL,
    PRIMARY KEY (attempt_id),
    UNIQUE KEY uk_sat_attempt_source_record (source_record_id),
    CONSTRAINT fk_sat_attempt_details_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sat_answer_details (
    attempt_id BIGINT UNSIGNED NOT NULL,
    paper_item_id BIGINT UNSIGNED NOT NULL,
    source_answer_id BIGINT UNSIGNED NOT NULL,
    source_question_id BIGINT UNSIGNED NOT NULL,
    source_is_marked BOOLEAN NOT NULL DEFAULT FALSE,
    source_answer_time DATETIME NULL,
    PRIMARY KEY (attempt_id, paper_item_id),
    UNIQUE KEY uk_sat_answer_source_id (source_answer_id),
    CONSTRAINT fk_sat_answer_details_attempt_item FOREIGN KEY (attempt_id, paper_item_id)
        REFERENCES attempt_items (attempt_id, paper_item_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
