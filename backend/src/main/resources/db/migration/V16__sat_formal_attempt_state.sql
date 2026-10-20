-- 保存 SAT/PSAT 正式考试的模块边界、模块计时和休息状态。
ALTER TABLE attempt_answers
    ADD COLUMN is_marked_for_review BOOLEAN NOT NULL DEFAULT FALSE AFTER answered_at;

CREATE TABLE sat_attempt_state (
    attempt_id BIGINT UNSIGNED NOT NULL,
    active_module_section_id BIGINT UNSIGNED NULL,
    active_question_number INT NULL,
    module_started_at DATETIME(6) NULL,
    completed_modules_json JSON NOT NULL,
    awaiting_break BOOLEAN NOT NULL DEFAULT FALSE,
    focus_violation_count INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (attempt_id),
    KEY idx_sat_attempt_state_module (active_module_section_id),
    CONSTRAINT fk_sat_attempt_state_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_attempt_state_module FOREIGN KEY (active_module_section_id)
        REFERENCES paper_sections (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
