-- 只读审计：统计历史正式作答按派发班级与现存成员区间得到的候选归属。
-- 成员表只能保留最近一次成员区间，候选结果并非最终归属，不执行任何回填。
WITH candidates AS (
    SELECT a.id AS attempt_id, a.exam_id, a.student_user_id, e.target_scope,
           COUNT(DISTINCT tc.class_id) AS matching_target_classes,
           EXISTS(SELECT 1 FROM exam_target_students ts
                  WHERE ts.exam_id = a.exam_id AND ts.student_user_id = a.student_user_id) AS individually_targeted
    FROM attempts a
    JOIN exams e ON e.id = a.exam_id
    JOIN papers p ON p.id = e.paper_id AND p.exam_type_code IN ('SAT', 'PSAT', 'SHSAT')
    LEFT JOIN exam_target_classes tc ON tc.exam_id = a.exam_id
      AND EXISTS (SELECT 1 FROM class_memberships cm
                  WHERE cm.class_id = tc.class_id AND cm.student_user_id = a.student_user_id
                    AND cm.joined_at <= a.started_at AND (cm.left_at IS NULL OR a.started_at <= cm.left_at))
    WHERE a.is_practice = FALSE
    GROUP BY a.id, a.exam_id, a.student_user_id, e.target_scope
)
SELECT target_scope, individually_targeted, matching_target_classes, COUNT(*) AS attempt_count
FROM candidates
GROUP BY target_scope, individually_targeted, matching_target_classes
ORDER BY target_scope, individually_targeted, matching_target_classes;

-- 账号曾离班后重新加入时，现存成员表无法提供之前区间；需要结合原系统证据核对。
SELECT COUNT(*) AS membership_rows_with_only_latest_known_period
FROM class_memberships;

-- 明细供人工复核；班级候选仅代表现存证据，特别是单独派发及全体派发不可推断为班级归属。
SELECT a.id AS attempt_id, p.exam_type_code, a.exam_id, a.student_user_id, a.started_at,
       e.target_scope,
       EXISTS(SELECT 1 FROM exam_target_students ts
              WHERE ts.exam_id = a.exam_id AND ts.student_user_id = a.student_user_id) AS individually_targeted,
       GROUP_CONCAT(DISTINCT tc.class_id ORDER BY tc.class_id) AS candidate_class_ids
FROM attempts a
JOIN exams e ON e.id = a.exam_id
JOIN papers p ON p.id = e.paper_id AND p.exam_type_code IN ('SAT', 'PSAT', 'SHSAT')
LEFT JOIN exam_target_classes tc ON tc.exam_id = a.exam_id
  AND EXISTS (SELECT 1 FROM class_memberships cm
              WHERE cm.class_id = tc.class_id AND cm.student_user_id = a.student_user_id
                AND cm.joined_at <= a.started_at AND (cm.left_at IS NULL OR a.started_at <= cm.left_at))
WHERE a.is_practice = FALSE
GROUP BY a.id, p.exam_type_code, a.exam_id, a.student_user_id, a.started_at, e.target_scope
ORDER BY p.exam_type_code, a.id;
