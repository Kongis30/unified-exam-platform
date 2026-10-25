-- 将 SAT/PSAT 监考心跳从考试进度状态中拆出，支持按最后心跳时间识别在线学生。
CREATE TABLE sat_attempt_presence (
    attempt_id BIGINT UNSIGNED NOT NULL,
    exam_id BIGINT UNSIGNED NOT NULL,
    active_module_section_id BIGINT UNSIGNED NOT NULL,
    active_question_number INT UNSIGNED NOT NULL,
    question_entered_at DATETIME(6) NOT NULL,
    last_seen_at DATETIME(6) NOT NULL,
    PRIMARY KEY (attempt_id),
    KEY idx_sat_presence_exam_seen (exam_id, last_seen_at),
    KEY idx_sat_presence_module_question (active_module_section_id, active_question_number),
    CONSTRAINT fk_sat_presence_attempt FOREIGN KEY (attempt_id)
        REFERENCES attempts (id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_presence_exam FOREIGN KEY (exam_id)
        REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_presence_module FOREIGN KEY (active_module_section_id)
        REFERENCES paper_sections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 迁移现有活跃尝试的题位；state.updated_at 是旧实现最近一次题位心跳时间。
INSERT INTO sat_attempt_presence
    (attempt_id, exam_id, active_module_section_id, active_question_number, question_entered_at, last_seen_at)
SELECT a.id, a.exam_id, s.active_module_section_id, s.active_question_number,
       COALESCE(s.module_started_at, a.started_at), s.updated_at
FROM sat_attempt_state s
JOIN attempts a ON a.id = s.attempt_id
WHERE s.active_question_number IS NOT NULL
  AND s.active_module_section_id IS NOT NULL
  AND a.status = 'IN_PROGRESS'
  AND a.is_practice = FALSE;

ALTER TABLE sat_attempt_state DROP COLUMN active_question_number;
