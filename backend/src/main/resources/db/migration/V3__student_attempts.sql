-- 学生作答、答案与统一分数摘要；题目内容仍来自已封存试卷。
CREATE TABLE attempts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    attempt_no INT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at DATETIME(6) NULL,
    submitted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_attempts_number (exam_id, student_user_id, attempt_no),
    KEY idx_attempts_student_status (student_user_id, status, exam_id),
    CONSTRAINT fk_attempts_exam_student FOREIGN KEY (exam_id, student_user_id)
        REFERENCES exam_participants (exam_id, student_user_id) ON DELETE RESTRICT,
    CONSTRAINT ck_attempts_status CHECK (status IN ('IN_PROGRESS', 'SUBMITTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE attempt_items (
    attempt_id BIGINT UNSIGNED NOT NULL,
    paper_item_id BIGINT UNSIGNED NOT NULL,
    served_order INT UNSIGNED NOT NULL,
    PRIMARY KEY (attempt_id, paper_item_id),
    UNIQUE KEY uk_attempt_items_order (attempt_id, served_order),
    CONSTRAINT fk_attempt_items_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE,
    CONSTRAINT fk_attempt_items_paper_item FOREIGN KEY (paper_item_id)
        REFERENCES paper_items (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE attempt_answers (
    attempt_id BIGINT UNSIGNED NOT NULL,
    paper_item_id BIGINT UNSIGNED NOT NULL,
    answer_json JSON NOT NULL,
    is_correct BOOLEAN NULL,
    awarded_points DECIMAL(8,2) NOT NULL DEFAULT 0,
    answered_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (attempt_id, paper_item_id),
    CONSTRAINT fk_attempt_answers_item FOREIGN KEY (attempt_id, paper_item_id)
        REFERENCES attempt_items (attempt_id, paper_item_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE attempt_results (
    attempt_id BIGINT UNSIGNED NOT NULL,
    total_points DECIMAL(10,2) NOT NULL,
    max_points DECIMAL(10,2) NOT NULL,
    ungraded_count INT UNSIGNED NOT NULL DEFAULT 0,
    breakdown_json JSON NOT NULL,
    graded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (attempt_id),
    CONSTRAINT fk_attempt_results_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
