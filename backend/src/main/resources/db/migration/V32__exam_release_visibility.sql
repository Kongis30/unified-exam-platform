-- 发布管理列表隐藏时间；保留考试及其学生记录。
ALTER TABLE exams ADD COLUMN release_hidden_at DATETIME(6) NULL;

CREATE TABLE exam_excluded_classes (
    exam_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (exam_id, class_id),
    CONSTRAINT fk_excluded_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    CONSTRAINT fk_excluded_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
