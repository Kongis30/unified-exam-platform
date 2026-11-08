-- 历史答卷保留原题目行；删除只将题目从当前试卷版本中移除。
ALTER TABLE paper_items
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER scoring_section_code;
