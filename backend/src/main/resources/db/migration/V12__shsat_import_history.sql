-- 保留旧 SHSAT V2 导入所需的类型专属历史字段，不扩散到其他考试模块。

ALTER TABLE attempts
    MODIFY COLUMN started_at DATETIME(6) NULL,
    ADD COLUMN is_practice BOOLEAN NOT NULL DEFAULT FALSE AFTER attempt_no,
    DROP CHECK ck_attempts_status,
    ADD CONSTRAINT ck_attempts_status
        CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'EXPIRED', 'CANCELLED'));

ALTER TABLE shsat_section_materials
    DROP CHECK ck_shsat_materials_type,
    ADD CONSTRAINT ck_shsat_materials_type
        CHECK (material_type IN ('TEXT', 'IMAGE', 'TABLE', 'HTML', 'PDF', 'OTHER'));

ALTER TABLE shsat_student_profiles
    ADD COLUMN student_number VARCHAR(40) NULL AFTER notes,
    ADD COLUMN source_metadata_json JSON NULL AFTER student_number;

CREATE TABLE shsat_class_metadata (
    class_id BIGINT UNSIGNED NOT NULL,
    teacher_name VARCHAR(80) NULL,
    teacher_email VARCHAR(160) NULL,
    grade_level VARCHAR(20) NULL,
    academic_year VARCHAR(40) NULL,
    source_counts_json JSON NULL,
    PRIMARY KEY (class_id),
    CONSTRAINT fk_shsat_class_metadata_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_paper_metadata (
    paper_id BIGINT UNSIGNED NOT NULL,
    source_paper_id BIGINT UNSIGNED NOT NULL,
    root_source_paper_id BIGINT UNSIGNED NULL,
    version_label VARCHAR(40) NOT NULL,
    total_parts INT UNSIGNED NOT NULL DEFAULT 0,
    total_questions INT UNSIGNED NOT NULL DEFAULT 0,
    total_score DECIMAL(8,2) NOT NULL DEFAULT 0,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0,
    source_metadata_json JSON NULL,
    PRIMARY KEY (paper_id),
    UNIQUE KEY uk_shsat_paper_metadata_source (source_paper_id),
    CONSTRAINT fk_shsat_paper_metadata_paper FOREIGN KEY (paper_id)
        REFERENCES papers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_attempt_record_details (
    attempt_id BIGINT UNSIGNED NOT NULL,
    source_attempt_id BIGINT UNSIGNED NOT NULL,
    source_class_id BIGINT UNSIGNED NULL,
    elapsed_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    completion_rate DECIMAL(6,2) NOT NULL DEFAULT 0,
    accuracy DECIMAL(6,2) NOT NULL DEFAULT 0,
    correct_count INT UNSIGNED NOT NULL DEFAULT 0,
    wrong_count INT UNSIGNED NOT NULL DEFAULT 0,
    unanswered_count INT UNSIGNED NOT NULL DEFAULT 0,
    auto_submitted BOOLEAN NOT NULL DEFAULT FALSE,
    score_details_json JSON NULL,
    runtime_state_json JSON NULL,
    source_metadata_json JSON NULL,
    PRIMARY KEY (attempt_id),
    UNIQUE KEY uk_shsat_attempt_source_id (source_attempt_id),
    CONSTRAINT fk_shsat_attempt_record_details_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_attempt_item_snapshots (
    attempt_id BIGINT UNSIGNED NOT NULL,
    source_snapshot_id BIGINT UNSIGNED NOT NULL,
    source_question_id BIGINT UNSIGNED NOT NULL,
    question_number INT UNSIGNED NOT NULL,
    target_paper_item_id BIGINT UNSIGNED NULL,
    snapshot_json JSON NOT NULL,
    PRIMARY KEY (attempt_id, source_snapshot_id),
    UNIQUE KEY uk_shsat_snapshot_attempt_number (attempt_id, question_number),
    UNIQUE KEY uk_shsat_attempt_snapshot_source (source_snapshot_id),
    CONSTRAINT fk_shsat_attempt_item_snapshots_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_attempt_answer_details (
    attempt_id BIGINT UNSIGNED NOT NULL,
    source_answer_id BIGINT UNSIGNED NOT NULL,
    source_question_id BIGINT UNSIGNED NOT NULL,
    target_paper_item_id BIGINT UNSIGNED NULL,
    answer_json JSON NULL,
    source_metadata_json JSON NULL,
    PRIMARY KEY (attempt_id, source_answer_id),
    UNIQUE KEY uk_shsat_attempt_answer_source (source_answer_id),
    CONSTRAINT fk_shsat_attempt_answer_details_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_migration_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_system VARCHAR(40) NOT NULL,
    source_database VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    started_at DATETIME(6) NOT NULL,
    finished_at DATETIME(6) NULL,
    summary_json JSON NULL,
    PRIMARY KEY (id),
    KEY idx_shsat_migration_runs_source (source_system, source_database, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_import_id_map (
    source_system VARCHAR(40) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    source_id BIGINT UNSIGNED NOT NULL,
    target_id BIGINT UNSIGNED NOT NULL,
    source_fingerprint CHAR(64) NOT NULL,
    migration_run_id BIGINT UNSIGNED NOT NULL,
    imported_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (source_system, entity_type, source_id),
    KEY idx_shsat_import_id_map_target (entity_type, target_id),
    CONSTRAINT fk_shsat_import_id_map_run FOREIGN KEY (migration_run_id)
        REFERENCES shsat_migration_runs (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
