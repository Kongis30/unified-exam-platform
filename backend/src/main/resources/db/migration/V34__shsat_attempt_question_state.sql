-- 保存新建 SHSAT 作答开始时的题目和材料，供后续历史读取使用。
CREATE TABLE shsat_attempt_question_state (
    attempt_id BIGINT UNSIGNED NOT NULL,
    paper_item_id BIGINT UNSIGNED NOT NULL,
    question_json JSON NOT NULL,
    PRIMARY KEY (attempt_id, paper_item_id),
    CONSTRAINT fk_shsat_question_state_attempt_item FOREIGN KEY (attempt_id, paper_item_id)
        REFERENCES attempt_items (attempt_id, paper_item_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
