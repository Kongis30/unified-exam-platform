-- Imported releases can lack a duration even when their paper defines one.
UPDATE exams e
JOIN papers p ON p.id = e.paper_id
SET e.duration_seconds = p.default_duration_seconds
WHERE (e.duration_seconds IS NULL OR e.duration_seconds = 0)
  AND p.default_duration_seconds > 0;
