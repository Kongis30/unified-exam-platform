-- Expose previously imported standalone SAT practice records in the student's practice history.
INSERT IGNORE INTO sat_practice_papers (paper_id, practice_exam_id)
SELECT paper_map.target_id, archive_map.target_id
FROM sat_import_id_map archive_map
JOIN sat_import_id_map paper_map
  ON paper_map.source_system = archive_map.source_system
 AND paper_map.entity_type = 'paper'
 AND paper_map.source_id = archive_map.source_id
JOIN sat_exam_settings settings ON settings.exam_id = archive_map.target_id AND settings.is_practice_archive = TRUE
WHERE archive_map.entity_type = 'practice_archive'
  AND archive_map.target_id IS NOT NULL
  AND paper_map.target_id IS NOT NULL;
