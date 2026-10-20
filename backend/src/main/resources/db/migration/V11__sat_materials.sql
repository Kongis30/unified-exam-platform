-- SAT/PSAT reading materials retain their reusable library identity separately from question payloads.
CREATE TABLE sat_materials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(200) NOT NULL,
    material_type VARCHAR(20) NOT NULL,
    content LONGTEXT NULL,
    file_url VARCHAR(1000) NULL,
    source VARCHAR(200) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    CONSTRAINT ck_sat_materials_type CHECK (material_type IN ('text', 'image', 'mixed')),
    CONSTRAINT ck_sat_materials_content CHECK (content IS NOT NULL OR file_url IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sat_question_materials (
    question_id BIGINT UNSIGNED NOT NULL,
    material_id BIGINT UNSIGNED NOT NULL,
    material_ref VARCHAR(500) NULL,
    PRIMARY KEY (question_id),
    KEY idx_sat_question_materials_material (material_id),
    CONSTRAINT fk_sat_question_materials_question FOREIGN KEY (question_id)
        REFERENCES questions (id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_question_materials_material FOREIGN KEY (material_id)
        REFERENCES sat_materials (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
