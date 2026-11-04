-- 继承现有班级排序，并允许同一班级在不同考试模块中保持独立顺序。
ALTER TABLE class_exam_workspaces ADD COLUMN sort_order INT NULL;
