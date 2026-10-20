-- Keep migrated SAT/PSAT exams consistent with the standalone system's immediate score and review flow.
UPDATE exams e
JOIN papers p ON p.id = e.paper_id
SET e.answer_visibility = 'AFTER_SUBMIT',
    e.score_visibility = 'AFTER_SUBMIT',
    e.allow_review = TRUE
WHERE p.exam_type_code IN ('SAT', 'PSAT');
