-- 删除旧系统迁移进来的 "Default Class"。
--
-- 背景：这些班级是旧 SAT 库 `class` 表源 id=3 的记录，由 scripts/migrate_sat_to_unified.py
-- 搬入并**按工作区拆分**（源班级 3 在旧系统同时含 SAT 与 PSAT 两类学生：
--   class_workspace 3:SAT -> 一个平台班级，3:PSAT -> 另一个平台班级）。
-- 因此线上存在两个 "Default Class"（SAT 一个、PSAT 一个），本地则只有一个。
-- 本迁移按旧系统来源定位全部拆分实例，不假设数量、不硬编码 id。
--
-- 产品要求：把 Default Class 从系统中彻底删除；班内学生账户与全部成绩保留，
-- 只解除学生与这个班级的关联；学生若还在其他班，其他班归属不受影响；
-- 若只属于该班，解除后即为合法的"无班级学生"。
--
-- 处置原则：
--   1) 班级物理删除，不归档、不改名；
--   2) 学生账户、attempts/attempt_results 一律不动；
--   3) 学生若还在其他班级，其他班级归属完全不受影响；
--   4) 学生若只属于该班，解除关联后即为合法的"无班级学生"。
--
-- 关于成绩归属（attempt_classes）：本表记录"这次成绩算哪个班"。线上这 6 条记录的
-- 作答本身及其 attempt_results、exam_participants 全部保留，学生照常能看到并查看成绩，
-- 只是不再挂在 Default Class 名下。删除前完整写入审计快照，可据此还原。
--
-- 删除前把班级、成员、发布目标、资格快照、成绩归属、旧系统元数据写入 audit_events。
--
-- 幂等：所有语句以定位到的班级集合为条件，集合为空时全部为 no-op。
-- 保护：若这些班仍承载复习任务(review_tasks / shsat_wrong_answer_tasks)，中止迁移交由人工处理。

-- 定位目标班级集合：旧 SAT 系统 class 源 id=3 的全部映射，含按工作区拆分的实例。
-- 用实体表而非临时表：MySQL 不允许在同一语句内多次引用临时表。
DROP TABLE IF EXISTS tmp_legacy_default_classes;
CREATE TABLE tmp_legacy_default_classes (class_id BIGINT UNSIGNED PRIMARY KEY);

INSERT IGNORE INTO tmp_legacy_default_classes (class_id)
SELECT target_id FROM sat_import_id_map
WHERE source_system = 'SAT_V1' AND entity_type = 'class' AND source_id = '3' AND target_id IS NOT NULL;

INSERT IGNORE INTO tmp_legacy_default_classes (class_id)
SELECT target_id FROM sat_import_id_map
WHERE source_system = 'SAT_V1' AND entity_type = 'class_workspace' AND source_id LIKE '3:%' AND target_id IS NOT NULL;

-- 兜底：映射已置空但班级仍在时，按旧系统元数据定位（旧班级 id=3 或同名 Default Class）。
INSERT IGNORE INTO tmp_legacy_default_classes (class_id)
SELECT s.class_id FROM sat_class_settings s
JOIN classes c ON c.id = s.class_id
WHERE JSON_UNQUOTE(JSON_EXTRACT(s.source_metadata_json, '$.id')) = '3'
  AND JSON_UNQUOTE(JSON_EXTRACT(s.source_metadata_json, '$.class_name')) = 'Default Class';

-- 只保留实际仍存在的班级，避免对已删行做无意义操作。
DELETE FROM tmp_legacy_default_classes
WHERE class_id NOT IN (SELECT id FROM classes);

-- 安全闸门：复习任务无法通过删班安全解除，宁可让迁移失败也不静默丢弃。
-- 中止手法：SET 单值变量接多行子查询会报 ERROR 1242，使 Flyway 迁移失败回滚。
SET @review_task_count = (
    (SELECT COUNT(*) FROM review_tasks WHERE class_id IN (SELECT class_id FROM tmp_legacy_default_classes))
  + (SELECT COUNT(*) FROM shsat_wrong_answer_tasks WHERE class_id IN (SELECT class_id FROM tmp_legacy_default_classes))
);
SET @guard = IF(@review_task_count > 0, (SELECT 1 UNION ALL SELECT 2), 0);

-- 审计快照：删除前从实际数据聚合，不写字面量，避免与实际不一致。
INSERT INTO audit_events (action_code, entity_type, entity_key, detail_json)
SELECT
    'DELETE_LEGACY_CLASS',
    'CLASS',
    CAST(c.id AS CHAR),
    JSON_OBJECT(
        'reason', 'Legacy Default Class removed at product request; students kept and unlinked',
        'classId', c.id,
        'className', c.name,
        'classType', c.class_type,
        'status', c.status,
        'sortOrder', c.sort_order,
        'createdAt', DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s'),
        'legacySource', (
            SELECT JSON_OBJECT('system', m.source_system, 'entityType', m.entity_type, 'classId', m.source_id)
            FROM sat_import_id_map m
            WHERE m.source_system = 'SAT_V1' AND m.target_id = c.id
              AND m.entity_type IN ('class', 'class_workspace')
            LIMIT 1
        ),
        'legacyMetadata', (
            SELECT s.source_metadata_json FROM sat_class_settings s WHERE s.class_id = c.id
        ),
        'workspaces', (
            SELECT JSON_ARRAYAGG(w.exam_type_code) FROM class_exam_workspaces w WHERE w.class_id = c.id
        ),
        'members', (
            SELECT JSON_ARRAYAGG(JSON_OBJECT(
                'userId', u.id,
                'username', u.username,
                'name', u.real_name,
                'status', u.status,
                'joinedAt', DATE_FORMAT(cm.joined_at, '%Y-%m-%d %H:%i:%s'),
                'leftAt', DATE_FORMAT(cm.left_at, '%Y-%m-%d %H:%i:%s'),
                'stillActive', cm.left_at IS NULL,
                'otherClasses', (
                    SELECT JSON_ARRAYAGG(JSON_OBJECT('classId', oc.id, 'className', oc.name))
                    FROM class_memberships other
                    JOIN classes oc ON oc.id = other.class_id
                    WHERE other.student_user_id = u.id AND other.left_at IS NULL AND other.class_id <> c.id
                )
            ))
            FROM class_memberships cm JOIN users u ON u.id = cm.student_user_id
            WHERE cm.class_id = c.id
        ),
        'membershipPeriods', (
            SELECT JSON_ARRAYAGG(JSON_OBJECT(
                'studentUserId', p.student_user_id,
                'joinedAt', DATE_FORMAT(p.joined_at, '%Y-%m-%d %H:%i:%s'),
                'leftAt', DATE_FORMAT(p.left_at, '%Y-%m-%d %H:%i:%s')))
            FROM class_membership_periods p WHERE p.class_id = c.id
        ),
        'targetedExams', (
            SELECT JSON_ARRAYAGG(JSON_OBJECT(
                'examId', e.id, 'title', e.title, 'status', e.status, 'targetScope', e.target_scope))
            FROM exam_target_classes tc JOIN exams e ON e.id = tc.exam_id
            WHERE tc.class_id = c.id
        ),
        'participantSnapshot', (
            SELECT JSON_ARRAYAGG(JSON_OBJECT(
                'examId', pc.exam_id, 'studentUserId', pc.student_user_id))
            FROM exam_participant_classes pc WHERE pc.class_id = c.id
        ),
        'scoreAttributions', (
            SELECT JSON_ARRAYAGG(JSON_OBJECT(
                'attemptId', ac.attempt_id,
                'examId', a.exam_id,
                'examTitle', e.title,
                'studentUserId', a.student_user_id,
                'attemptStatus', a.status,
                'totalPoints', r.total_points,
                'maxPoints', r.max_points,
                'submittedAt', DATE_FORMAT(a.submitted_at, '%Y-%m-%d %H:%i:%s')))
            FROM attempt_classes ac
            JOIN attempts a ON a.id = ac.attempt_id
            LEFT JOIN exams e ON e.id = a.exam_id
            LEFT JOIN attempt_results r ON r.attempt_id = a.id
            WHERE ac.class_id = c.id
        ),
        'preserved', 'Student accounts, attempts, attempt_results, exam_participants and workspace access untouched'
    )
FROM classes c
WHERE c.id IN (SELECT class_id FROM tmp_legacy_default_classes);

-- 解除成绩归属。作答、成绩与考试参与记录全部保留，学生仍能看到并查看这些成绩。
DELETE FROM attempt_classes WHERE class_id IN (SELECT class_id FROM tmp_legacy_default_classes);

-- 解除考试资格快照（考试本身与 exam_participants 保留）。
DELETE FROM exam_participant_classes WHERE class_id IN (SELECT class_id FROM tmp_legacy_default_classes);

-- 解除按班记录的个人定向考试归属（exam_target_students 不动）。
DELETE FROM exam_target_student_classes WHERE class_id IN (SELECT class_id FROM tmp_legacy_default_classes);

-- 解除考试的班级发布目标（考试本身保留，其它目标班不受影响）。
DELETE FROM exam_target_classes WHERE class_id IN (SELECT class_id FROM tmp_legacy_default_classes);

-- 解除成员关系历史与当前成员关系；学生账户与在其它班级的归属不受影响。
DELETE FROM class_membership_periods WHERE class_id IN (SELECT class_id FROM tmp_legacy_default_classes);
DELETE FROM class_memberships WHERE class_id IN (SELECT class_id FROM tmp_legacy_default_classes);

-- 解除旧系统映射指向，避免悬空引用；保留映射行作为导入审计痕迹，
-- 同时防止重跑迁移脚本重建该班。
UPDATE sat_import_id_map SET target_id = NULL
WHERE source_system = 'SAT_V1' AND target_id IN (SELECT class_id FROM tmp_legacy_default_classes)
  AND entity_type IN ('class', 'class_workspace');

-- 删除班级本体；class_exam_workspaces / sat_class_settings / shsat_class_metadata /
-- exam_excluded_classes 由外键 ON DELETE CASCADE 一并清理。
DELETE FROM classes WHERE id IN (SELECT class_id FROM tmp_legacy_default_classes);

DROP TABLE IF EXISTS tmp_legacy_default_classes;
