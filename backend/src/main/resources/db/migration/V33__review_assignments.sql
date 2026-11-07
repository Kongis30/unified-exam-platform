-- 三个考试模块共用复习任务结构；历史 SHSAT 任务暂保留在原表中。
CREATE TABLE review_tasks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_type_code VARCHAR(32) NOT NULL,
    exam_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(1000) NULL,
    starts_at DATETIME(6) NOT NULL,
    ends_at DATETIME(6) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_review_tasks_workspace_class (exam_type_code, class_id, status, ends_at),
    KEY idx_review_tasks_exam_class (exam_id, class_id),
    CONSTRAINT fk_review_tasks_type FOREIGN KEY (exam_type_code) REFERENCES exam_types (code) ON DELETE RESTRICT,
    CONSTRAINT fk_review_tasks_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE RESTRICT,
    CONSTRAINT fk_review_tasks_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT,
    CONSTRAINT fk_review_tasks_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_review_tasks_status CHECK (status IN ('PUBLISHED', 'ENDED')),
    CONSTRAINT ck_review_tasks_window CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 任务发布时固定成员和来源作答；未能确认来源的学生不推断班级。
CREATE TABLE review_assignments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    source_attempt_id BIGINT UNSIGNED NULL,
    status VARCHAR(30) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_review_assignment_student (task_id, student_user_id),
    KEY idx_review_assignment_student_status (student_user_id, status),
    CONSTRAINT fk_review_assignment_task FOREIGN KEY (task_id) REFERENCES review_tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_review_assignment_student FOREIGN KEY (student_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_review_assignment_source FOREIGN KEY (source_attempt_id) REFERENCES attempts (id) ON DELETE SET NULL,
    CONSTRAINT ck_review_assignment_status CHECK (status IN ('NO_SOURCE_ATTEMPT', 'NO_WRONG_ANSWERS', 'NOT_STARTED', 'IN_PROGRESS', 'RETRY_REQUIRED', 'COMPLETED', 'ENDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 同一题号可能存在于多个模块；使用原始 paper item ID 区分并保留出题顺序。
CREATE TABLE review_assignment_items (
    assignment_id BIGINT UNSIGNED NOT NULL,
    paper_item_id BIGINT UNSIGNED NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    cleared_at DATETIME(6) NULL,
    PRIMARY KEY (assignment_id, paper_item_id),
    UNIQUE KEY uk_review_assignment_item_order (assignment_id, sort_order),
    CONSTRAINT fk_review_item_assignment FOREIGN KEY (assignment_id) REFERENCES review_assignments (id) ON DELETE CASCADE,
    CONSTRAINT fk_review_item_paper_item FOREIGN KEY (paper_item_id) REFERENCES paper_items (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 每轮独立关联 practice attempt；正式考试记录不被复习覆盖。
CREATE TABLE review_practice_rounds (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    assignment_id BIGINT UNSIGNED NOT NULL,
    attempt_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_review_round_attempt (attempt_id),
    KEY idx_review_round_assignment (assignment_id, id),
    CONSTRAINT fk_review_round_assignment FOREIGN KEY (assignment_id) REFERENCES review_assignments (id) ON DELETE CASCADE,
    CONSTRAINT fk_review_round_attempt FOREIGN KEY (attempt_id) REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
