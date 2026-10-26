-- Link personal SHSAT wrong-answer practice to its source attempt and keep cleared questions.
ALTER TABLE attempts
    ADD COLUMN shsat_self_practice_source_attempt_id BIGINT UNSIGNED NULL AFTER shsat_wrong_answer_questions_json,
    ADD COLUMN shsat_self_practice_questions_json JSON NULL AFTER shsat_self_practice_source_attempt_id,
    ADD KEY idx_attempts_shsat_self_practice (shsat_self_practice_source_attempt_id, status),
    ADD CONSTRAINT fk_attempts_shsat_self_practice_source FOREIGN KEY (shsat_self_practice_source_attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE;

CREATE TABLE shsat_self_practice_cleared_questions (
    source_attempt_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    paper_item_id BIGINT UNSIGNED NOT NULL,
    cleared_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (source_attempt_id, paper_item_id),
    KEY idx_shsat_self_practice_cleared_student (student_user_id, source_attempt_id),
    CONSTRAINT fk_shsat_self_practice_cleared_source FOREIGN KEY (source_attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE,
    CONSTRAINT fk_shsat_self_practice_cleared_student FOREIGN KEY (student_user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_shsat_self_practice_cleared_item FOREIGN KEY (source_attempt_id, paper_item_id)
        REFERENCES attempt_items (attempt_id, paper_item_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
