-- SHSAT 管理扩展只保存通用试卷/发布模型无法表达的编辑与监考数据。

ALTER TABLE paper_groups
    ADD COLUMN description VARCHAR(500) NULL AFTER name;

ALTER TABLE papers
    ADD COLUMN default_scoring_profile_id BIGINT UNSIGNED NULL AFTER default_duration_seconds,
    ADD CONSTRAINT fk_papers_default_scoring_profile FOREIGN KEY (default_scoring_profile_id)
        REFERENCES scoring_profiles (id) ON DELETE RESTRICT;

CREATE TABLE shsat_section_materials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    section_id BIGINT UNSIGNED NOT NULL,
    material_type VARCHAR(20) NOT NULL DEFAULT 'TEXT',
    category VARCHAR(100) NULL,
    title VARCHAR(200) NULL,
    content LONGTEXT NULL,
    asset_key VARCHAR(500) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_shsat_materials_section_order (section_id, sort_order),
    CONSTRAINT fk_shsat_materials_section FOREIGN KEY (section_id)
        REFERENCES paper_sections (id) ON DELETE CASCADE,
    CONSTRAINT ck_shsat_materials_type CHECK (material_type IN ('TEXT', 'IMAGE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_question_metadata (
    question_id BIGINT UNSIGNED NOT NULL,
    skill_tag_code VARCHAR(80) NULL,
    extra_json JSON NULL,
    PRIMARY KEY (question_id),
    CONSTRAINT fk_shsat_question_metadata_question FOREIGN KEY (question_id)
        REFERENCES questions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_exam_monitor_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    attempt_id BIGINT UNSIGNED NOT NULL,
    event_code VARCHAR(40) NOT NULL,
    event_data_json JSON NULL,
    occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_shsat_monitor_attempt_time (attempt_id, occurred_at),
    CONSTRAINT fk_shsat_monitor_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_wrong_answer_tasks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(1000) NULL,
    starts_at DATETIME(6) NULL,
    ends_at DATETIME(6) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_shsat_tasks_class_status (class_id, status, ends_at),
    CONSTRAINT fk_shsat_tasks_exam FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE RESTRICT,
    CONSTRAINT fk_shsat_tasks_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE RESTRICT,
    CONSTRAINT fk_shsat_tasks_creator FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_shsat_tasks_status CHECK (status IN ('PUBLISHED', 'ENDED')),
    CONSTRAINT ck_shsat_tasks_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE shsat_wrong_answer_assignments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    source_attempt_id BIGINT UNSIGNED NULL,
    question_numbers_json JSON NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
    practice_attempt_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_shsat_wrong_assignment_student (task_id, student_user_id),
    KEY idx_shsat_wrong_assignment_status (student_user_id, status),
    CONSTRAINT fk_shsat_wrong_assignment_task FOREIGN KEY (task_id)
        REFERENCES shsat_wrong_answer_tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_shsat_wrong_assignment_student FOREIGN KEY (student_user_id)
        REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_shsat_wrong_assignment_source_attempt FOREIGN KEY (source_attempt_id)
        REFERENCES attempts (id) ON DELETE SET NULL,
    CONSTRAINT fk_shsat_wrong_assignment_practice_attempt FOREIGN KEY (practice_attempt_id)
        REFERENCES attempts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
