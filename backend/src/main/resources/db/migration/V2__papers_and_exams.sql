-- 共享试卷、版本、题目结构与考试发布。各考试类型专属规则留在类型模块。

CREATE TABLE paper_groups (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_type_code VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_paper_groups_type_name (exam_type_code, name),
    CONSTRAINT fk_paper_groups_exam_type FOREIGN KEY (exam_type_code)
        REFERENCES exam_types (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE papers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_type_code VARCHAR(32) NOT NULL,
    group_id BIGINT UNSIGNED NULL,
    paper_code VARCHAR(80) NOT NULL,
    version_no INT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(2000) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    default_duration_seconds INT UNSIGNED NULL,
    source_paper_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    sealed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_papers_type_code_version (exam_type_code, paper_code, version_no),
    KEY idx_papers_type_status_group (exam_type_code, status, group_id),
    CONSTRAINT fk_papers_exam_type FOREIGN KEY (exam_type_code)
        REFERENCES exam_types (code) ON DELETE RESTRICT,
    CONSTRAINT fk_papers_group FOREIGN KEY (group_id)
        REFERENCES paper_groups (id) ON DELETE SET NULL,
    CONSTRAINT fk_papers_source FOREIGN KEY (source_paper_id)
        REFERENCES papers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_papers_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_papers_status CHECK (status IN ('DRAFT', 'READY', 'ARCHIVED')),
    CONSTRAINT ck_papers_sealed CHECK ((status = 'DRAFT' AND sealed_at IS NULL) OR (status <> 'DRAFT' AND sealed_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE question_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_type_code VARCHAR(32) NOT NULL,
    parent_id BIGINT UNSIGNED NULL,
    code VARCHAR(60) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_question_categories_type_code (exam_type_code, code),
    CONSTRAINT fk_question_categories_exam_type FOREIGN KEY (exam_type_code)
        REFERENCES exam_types (code) ON DELETE RESTRICT,
    CONSTRAINT fk_question_categories_parent FOREIGN KEY (parent_id)
        REFERENCES question_categories (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE questions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    question_type_code VARCHAR(50) NOT NULL,
    stem LONGTEXT NOT NULL,
    render_json JSON NULL,
    answer_key_json JSON NOT NULL,
    grading_json JSON NULL,
    explanation LONGTEXT NULL,
    sealed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE paper_sections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    paper_id BIGINT UNSIGNED NOT NULL,
    parent_section_id BIGINT UNSIGNED NULL,
    section_code VARCHAR(60) NOT NULL,
    section_kind VARCHAR(30) NOT NULL,
    title VARCHAR(200) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    instructions LONGTEXT NULL,
    settings_json JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_paper_sections_code (paper_id, section_code),
    UNIQUE KEY uk_paper_sections_id_paper (id, paper_id),
    KEY idx_paper_sections_order (paper_id, parent_section_id, sort_order),
    CONSTRAINT fk_paper_sections_paper FOREIGN KEY (paper_id)
        REFERENCES papers (id) ON DELETE CASCADE,
    CONSTRAINT fk_paper_sections_parent FOREIGN KEY (parent_section_id, paper_id)
        REFERENCES paper_sections (id, paper_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE paper_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    section_id BIGINT UNSIGNED NOT NULL,
    question_id BIGINT UNSIGNED NOT NULL,
    category_id BIGINT UNSIGNED NULL,
    sort_order INT NOT NULL DEFAULT 0,
    display_number INT NULL,
    max_points DECIMAL(8,2) NOT NULL DEFAULT 1.00,
    scoring_section_code VARCHAR(30) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_paper_items_order (section_id, sort_order),
    KEY idx_paper_items_question (question_id),
    CONSTRAINT fk_paper_items_section FOREIGN KEY (section_id)
        REFERENCES paper_sections (id) ON DELETE CASCADE,
    CONSTRAINT fk_paper_items_question FOREIGN KEY (question_id)
        REFERENCES questions (id) ON DELETE RESTRICT,
    CONSTRAINT fk_paper_items_category FOREIGN KEY (category_id)
        REFERENCES question_categories (id) ON DELETE SET NULL,
    CONSTRAINT ck_paper_items_points CHECK (max_points >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE scoring_profiles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_type_code VARCHAR(32) NOT NULL,
    profile_code VARCHAR(80) NOT NULL,
    version_no INT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    algorithm_code VARCHAR(50) NOT NULL,
    config_json JSON NULL,
    is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
    sealed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_scoring_profiles_version (exam_type_code, profile_code, version_no),
    CONSTRAINT fk_scoring_profiles_exam_type FOREIGN KEY (exam_type_code)
        REFERENCES exam_types (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE exams (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    paper_id BIGINT UNSIGNED NOT NULL,
    scoring_profile_id BIGINT UNSIGNED NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(2000) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    target_scope VARCHAR(20) NOT NULL DEFAULT 'SELECTED',
    opens_at DATETIME(6) NOT NULL,
    closes_at DATETIME(6) NOT NULL,
    duration_seconds INT UNSIGNED NULL,
    attempt_limit INT UNSIGNED NOT NULL DEFAULT 1,
    answer_visibility VARCHAR(30) NOT NULL DEFAULT 'AFTER_CLOSE',
    score_visibility VARCHAR(30) NOT NULL DEFAULT 'AFTER_CLOSE',
    auto_submit BOOLEAN NOT NULL DEFAULT TRUE,
    allow_review BOOLEAN NOT NULL DEFAULT FALSE,
    created_by BIGINT UNSIGNED NOT NULL,
    published_at DATETIME(6) NULL,
    archived_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_exams_status_window (status, opens_at, closes_at),
    KEY idx_exams_paper_status (paper_id, status),
    CONSTRAINT fk_exams_paper FOREIGN KEY (paper_id)
        REFERENCES papers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_exams_scoring_profile FOREIGN KEY (scoring_profile_id)
        REFERENCES scoring_profiles (id) ON DELETE RESTRICT,
    CONSTRAINT fk_exams_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_exams_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED')),
    CONSTRAINT ck_exams_target_scope CHECK (target_scope IN ('ALL_STUDENTS', 'SELECTED')),
    CONSTRAINT ck_exams_window CHECK (closes_at > opens_at),
    CONSTRAINT ck_exams_attempt_limit CHECK (attempt_limit >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE exam_target_classes (
    exam_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (exam_id, class_id),
    CONSTRAINT fk_exam_target_classes_exam FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT fk_exam_target_classes_class FOREIGN KEY (class_id)
        REFERENCES classes (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE exam_target_students (
    exam_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (exam_id, student_user_id),
    CONSTRAINT fk_exam_target_students_exam FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT fk_exam_target_students_user FOREIGN KEY (student_user_id)
        REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE exam_participants (
    exam_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revoked_at DATETIME(6) NULL,
    signed_in_at DATETIME(6) NULL,
    absent_marked_at DATETIME(6) NULL,
    seat_no VARCHAR(30) NULL,
    PRIMARY KEY (exam_id, student_user_id),
    KEY idx_exam_participants_student (student_user_id, revoked_at, exam_id),
    CONSTRAINT fk_exam_participants_exam FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE RESTRICT,
    CONSTRAINT fk_exam_participants_student FOREIGN KEY (student_user_id)
        REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
