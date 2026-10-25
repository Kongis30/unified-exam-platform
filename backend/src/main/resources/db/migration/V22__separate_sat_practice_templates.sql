-- Keep imported practice history mapped separately from reusable self-practice templates.
CREATE TABLE sat_practice_paper_templates (
    paper_id BIGINT UNSIGNED NOT NULL,
    practice_exam_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (paper_id),
    UNIQUE KEY uk_sat_practice_template_exam (practice_exam_id),
    CONSTRAINT fk_sat_practice_template_paper FOREIGN KEY (paper_id)
        REFERENCES papers (id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_practice_template_exam FOREIGN KEY (practice_exam_id)
        REFERENCES exams (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
