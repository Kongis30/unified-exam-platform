-- 一次性补齐现有账号的所有启用工作区，后续新账号仍由管理员选择权限。
INSERT IGNORE INTO user_workspace_access (user_id, workspace_code)
SELECT u.id, w.code FROM users u CROSS JOIN exam_workspaces w
WHERE u.role_code IN ('STUDENT', 'TEACHER') AND w.is_active = TRUE;
