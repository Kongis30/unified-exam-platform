-- Keep assigned SHSAT practice attempts linked to their task assignment and frozen question set.
ALTER TABLE attempts
    ADD COLUMN shsat_wrong_answer_assignment_id BIGINT UNSIGNED NULL AFTER is_practice,
    ADD COLUMN shsat_wrong_answer_questions_json JSON NULL AFTER shsat_wrong_answer_assignment_id,
    ADD KEY idx_attempts_shsat_wrong_assignment (shsat_wrong_answer_assignment_id, status),
    ADD CONSTRAINT fk_attempts_shsat_wrong_assignment FOREIGN KEY (shsat_wrong_answer_assignment_id)
        REFERENCES shsat_wrong_answer_assignments (id) ON DELETE SET NULL;
