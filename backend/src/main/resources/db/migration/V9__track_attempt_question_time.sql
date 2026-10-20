ALTER TABLE attempt_answers
    ADD COLUMN time_spent_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER awarded_points;
