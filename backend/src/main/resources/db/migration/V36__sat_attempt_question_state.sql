-- SAT/PSAT 作答固定试题内容，编辑试卷时不改写已开始的考试与历史答卷。
CREATE TABLE sat_attempt_question_state (
    attempt_id BIGINT UNSIGNED NOT NULL,
    paper_item_id BIGINT UNSIGNED NOT NULL,
    question_json JSON NOT NULL,
    PRIMARY KEY (attempt_id, paper_item_id),
    CONSTRAINT fk_sat_question_state_attempt_item FOREIGN KEY (attempt_id, paper_item_id)
        REFERENCES attempt_items (attempt_id, paper_item_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
