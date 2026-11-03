-- 旧班级此前同时显示在 SAT 和 SHSAT；保留两处可见性，PSAT 从空班级开始。
CREATE TABLE class_exam_workspaces (
    class_id BIGINT UNSIGNED NOT NULL,
    exam_type_code VARCHAR(20) NOT NULL,
    PRIMARY KEY (class_id, exam_type_code),
    KEY idx_class_workspace_type (exam_type_code, class_id),
    CONSTRAINT fk_class_workspace_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO class_exam_workspaces (class_id, exam_type_code)
SELECT id, 'SAT' FROM classes;
INSERT INTO class_exam_workspaces (class_id, exam_type_code)
SELECT id, 'SHSAT' FROM classes;
