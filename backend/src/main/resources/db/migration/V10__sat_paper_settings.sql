-- SAT/PSAT paper-level settings stay separate from the shared paper lifecycle.
CREATE TABLE sat_paper_settings (
    paper_id BIGINT UNSIGNED NOT NULL,
    scoring_table_code VARCHAR(16) NOT NULL,
    adaptive_mode BOOLEAN NOT NULL DEFAULT TRUE,
    rest_time_seconds INT UNSIGNED NOT NULL DEFAULT 600,
    settings_json JSON NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (paper_id),
    CONSTRAINT fk_sat_paper_settings_paper FOREIGN KEY (paper_id)
        REFERENCES papers (id) ON DELETE CASCADE,
    CONSTRAINT ck_sat_paper_settings_scoring CHECK (scoring_table_code IN ('SAT', 'PSAT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO sat_paper_settings (paper_id, scoring_table_code)
SELECT id, exam_type_code FROM papers WHERE exam_type_code IN ('SAT', 'PSAT');
