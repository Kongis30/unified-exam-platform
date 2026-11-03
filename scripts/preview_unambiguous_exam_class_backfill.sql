-- 只读预演：事务最终 ROLLBACK，不提交任何历史归属。
-- 仅预演 SELECTED 且非个人派发、按现存成员区间恰好匹配一个整班目标的正式作答。
-- 执行前必须先应用 V30；实际回填应以同一审计快照经核对后制定可回滚方案。
START TRANSACTION;
CREATE TEMPORARY TABLE candidate_attempt_classes AS
SELECT a.id AS attempt_id, a.exam_id, a.student_user_id, MIN(tc.class_id) AS class_id
FROM attempts a
JOIN exams e ON e.id = a.exam_id AND e.target_scope = 'SELECTED'
JOIN papers p ON p.id = e.paper_id AND p.exam_type_code IN ('SAT', 'PSAT', 'SHSAT')
JOIN exam_target_classes tc ON tc.exam_id = a.exam_id
JOIN class_memberships cm ON cm.class_id = tc.class_id AND cm.student_user_id = a.student_user_id
  AND cm.joined_at <= a.started_at AND (cm.left_at IS NULL OR a.started_at <= cm.left_at)
WHERE a.is_practice = FALSE
  AND NOT EXISTS (SELECT 1 FROM exam_target_students ts
                  WHERE ts.exam_id = a.exam_id AND ts.student_user_id = a.student_user_id)
GROUP BY a.id, a.exam_id, a.student_user_id
HAVING COUNT(DISTINCT tc.class_id) = 1;

SELECT COUNT(*) AS candidate_attempts FROM candidate_attempt_classes;
INSERT IGNORE INTO attempt_classes (attempt_id, class_id)
SELECT attempt_id, class_id FROM candidate_attempt_classes;
SELECT ROW_COUNT() AS proposed_attempt_class_rows;
INSERT IGNORE INTO exam_participant_classes (exam_id, student_user_id, class_id)
SELECT DISTINCT c.exam_id, c.student_user_id, c.class_id
FROM candidate_attempt_classes c
JOIN exam_participants p ON p.exam_id = c.exam_id AND p.student_user_id = c.student_user_id;
SELECT ROW_COUNT() AS proposed_participant_class_rows;
ROLLBACK;
