-- SHSAT 量表换算、学生延时和分段续考状态；正式作答本身仍落在平台 attempts。

CREATE TABLE scoring_scale_rows (
    scoring_profile_id BIGINT UNSIGNED NOT NULL,
    section_code VARCHAR(30) NOT NULL,
    variant_code VARCHAR(40) NOT NULL DEFAULT 'DEFAULT',
    raw_score INT NOT NULL,
    scaled_score INT NOT NULL,
    PRIMARY KEY (scoring_profile_id, section_code, variant_code, raw_score),
    CONSTRAINT fk_scoring_scale_rows_profile FOREIGN KEY (scoring_profile_id)
        REFERENCES scoring_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_student_accommodations (
    student_user_id BIGINT UNSIGNED NOT NULL,
    time_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (student_user_id),
    CONSTRAINT fk_shsat_accommodations_student FOREIGN KEY (student_user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT ck_shsat_accommodations_multiplier CHECK (time_multiplier >= 1.00)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_attempt_state (
    attempt_id BIGINT UNSIGNED NOT NULL,
    active_section_code VARCHAR(60) NULL,
    active_question_number INT NULL,
    section_started_at DATETIME(6) NULL,
    remaining_seconds INT UNSIGNED NULL,
    flow_json JSON NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (attempt_id),
    CONSTRAINT fk_shsat_attempt_state_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_paper_solutions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    paper_id BIGINT UNSIGNED NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    asset_key VARCHAR(500) NOT NULL,
    file_size BIGINT UNSIGNED NULL,
    file_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_shsat_solutions_paper_active (paper_id, is_active, created_at),
    CONSTRAINT fk_shsat_solutions_paper FOREIGN KEY (paper_id)
        REFERENCES papers (id) ON DELETE CASCADE,
    CONSTRAINT fk_shsat_solutions_uploader FOREIGN KEY (uploaded_by)
        REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
