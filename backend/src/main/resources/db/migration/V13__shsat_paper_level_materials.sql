-- 保留未绑定 Part/子题型、且未被题目引用的 SHSAT 整卷级材料。
CREATE TABLE shsat_paper_materials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    paper_id BIGINT UNSIGNED NOT NULL,
    source_material_id BIGINT UNSIGNED NOT NULL,
    material_type VARCHAR(20) NOT NULL,
    category VARCHAR(100) NULL,
    title VARCHAR(200) NULL,
    content LONGTEXT NULL,
    asset_key VARCHAR(500) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    source_metadata_json JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uk_shsat_paper_material_source (paper_id, source_material_id),
    KEY idx_shsat_paper_materials_order (paper_id, sort_order),
    CONSTRAINT fk_shsat_paper_materials_paper FOREIGN KEY (paper_id)
        REFERENCES papers (id) ON DELETE CASCADE,
    CONSTRAINT ck_shsat_paper_materials_type
        CHECK (material_type IN ('TEXT', 'IMAGE', 'TABLE', 'HTML', 'PDF', 'OTHER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
