-- 历史试卷按原评分表归入工作区；考试、作答、成绩及试卷 ID 不变。
INSERT INTO sat_paper_settings (paper_id, scoring_table_code)
SELECT p.id, p.exam_type_code FROM papers p
LEFT JOIN sat_paper_settings s ON s.paper_id = p.id
WHERE p.exam_type_code IN ('SAT', 'PSAT') AND s.paper_id IS NULL;

-- 目标模块没有同名文件夹时先创建，避免迁移后引用另一模块的文件夹。
INSERT IGNORE INTO paper_groups (exam_type_code, name, description, sort_order)
SELECT DISTINCT s.scoring_table_code, g.name, g.description, g.sort_order
FROM papers p JOIN sat_paper_settings s ON s.paper_id = p.id
JOIN paper_groups g ON g.id = p.group_id
WHERE p.exam_type_code IN ('SAT', 'PSAT') AND p.exam_type_code <> s.scoring_table_code;

-- 迁移的版本族使用稳定的内部编码，避免与目标模块已有的同编码版本冲突。
UPDATE papers p
JOIN sat_paper_settings s ON s.paper_id = p.id
LEFT JOIN paper_groups source_group ON source_group.id = p.group_id
LEFT JOIN paper_groups destination_group
    ON destination_group.exam_type_code = s.scoring_table_code AND destination_group.name = source_group.name
SET p.paper_code = CONCAT('migrated-', SHA2(CONCAT(p.exam_type_code, ':', p.paper_code, ':', s.scoring_table_code), 256)),
    p.group_id = destination_group.id,
    p.exam_type_code = s.scoring_table_code
WHERE p.exam_type_code IN ('SAT', 'PSAT') AND p.exam_type_code <> s.scoring_table_code;
