-- 工作区是账号授权单位；一个工作区可以包含多个考试类型。
CREATE TABLE exam_workspaces (
    code VARCHAR(32) NOT NULL,
    name VARCHAR(80) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO exam_workspaces (code, name, sort_order) VALUES
    ('SAT', 'SAT', 10),
    ('PSAT', 'PSAT', 20),
    ('SHSAT', 'SHSAT', 30);

-- 未知的现有类型保留独立入口，避免迁移时丢失访问入口。
INSERT INTO exam_workspaces (code, name, is_active, sort_order)
SELECT code, display_name, is_active, sort_order FROM exam_types
WHERE code NOT IN ('SAT', 'PSAT', 'SHSAT');

ALTER TABLE exam_types ADD COLUMN workspace_code VARCHAR(32) NULL;
UPDATE exam_types SET workspace_code = code WHERE workspace_code IS NULL;

ALTER TABLE exam_types MODIFY workspace_code VARCHAR(32) NOT NULL,
    ADD KEY idx_exam_types_workspace (workspace_code),
    ADD CONSTRAINT fk_exam_types_workspace FOREIGN KEY (workspace_code) REFERENCES exam_workspaces(code);

CREATE TABLE user_workspace_access (
    user_id BIGINT UNSIGNED NOT NULL,
    workspace_code VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, workspace_code),
    KEY idx_user_workspace_access_workspace (workspace_code, user_id),
    CONSTRAINT fk_user_workspace_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_workspace_access_workspace FOREIGN KEY (workspace_code) REFERENCES exam_workspaces(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 保留既有学生和教师访问三个考试系统的能力；新增工作区不会自动授权。
INSERT INTO user_workspace_access (user_id, workspace_code)
SELECT u.id, w.code FROM users u
JOIN exam_workspaces w ON w.code IN ('SAT', 'PSAT', 'SHSAT')
WHERE u.role_code IN ('STUDENT', 'TEACHER');
