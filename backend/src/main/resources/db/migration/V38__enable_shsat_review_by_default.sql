UPDATE exams e
JOIN papers p ON p.id = e.paper_id
SET e.allow_review = TRUE
WHERE p.exam_type_code = 'SHSAT';
