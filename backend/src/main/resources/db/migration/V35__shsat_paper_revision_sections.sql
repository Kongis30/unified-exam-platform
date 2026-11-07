-- 保留被历史作答引用的 SHSAT 分段；当前版本使用 0，历史版本使用分段自身 ID。
ALTER TABLE paper_sections
    ADD COLUMN archived_key BIGINT UNSIGNED NOT NULL DEFAULT 0,
    DROP INDEX uk_paper_sections_code,
    ADD UNIQUE KEY uk_paper_sections_code (paper_id, section_code, archived_key);

-- 关联同一试题的不同版本，便于按题汇总各版本的历史答题。
ALTER TABLE paper_items
    ADD COLUMN lineage_id BIGINT UNSIGNED NULL,
    ADD INDEX idx_paper_items_lineage (lineage_id);

-- 编辑页提交读取时的版本号，拒绝覆盖其他管理员刚保存的修改。
ALTER TABLE papers ADD COLUMN structure_revision BIGINT UNSIGNED NOT NULL DEFAULT 0;
