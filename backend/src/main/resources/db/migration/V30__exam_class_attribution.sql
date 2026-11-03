-- 个人派发时保留从哪个班级选择学生；不自动推断旧数据。
CREATE TABLE exam_target_student_classes (
    exam_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (exam_id, student_user_id, class_id),
    KEY idx_target_student_classes_class (class_id, exam_id, student_user_id),
    CONSTRAINT fk_target_student_classes_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT fk_target_student_classes_user FOREIGN KEY (student_user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_target_student_classes_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 一个学生在同一场考试可以通过多个班级获得资格，但参与资格本身只保留一份。
CREATE TABLE exam_participant_classes (
    exam_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (exam_id, student_user_id, class_id),
    KEY idx_participant_classes_class (class_id, exam_id, student_user_id),
    CONSTRAINT fk_participant_classes_participant FOREIGN KEY (exam_id, student_user_id)
        REFERENCES exam_participants (exam_id, student_user_id) ON DELETE CASCADE,
    CONSTRAINT fk_participant_classes_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 作答开始时固定班级来源，之后的成员变化不改变已有成绩归属。
CREATE TABLE attempt_classes (
    attempt_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (attempt_id, class_id),
    KEY idx_attempt_classes_class (class_id, attempt_id),
    CONSTRAINT fk_attempt_classes_attempt FOREIGN KEY (attempt_id) REFERENCES attempts (id) ON DELETE CASCADE,
    CONSTRAINT fk_attempt_classes_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 历史成员区间独立保存，避免离班后再次入班覆盖上一次加入时间。
CREATE TABLE class_membership_periods (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    class_id BIGINT UNSIGNED NOT NULL,
    student_user_id BIGINT UNSIGNED NOT NULL,
    joined_at DATETIME(6) NOT NULL,
    left_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_membership_period_lookup (class_id, student_user_id, joined_at, left_at),
    CONSTRAINT fk_membership_period_class FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE RESTRICT,
    CONSTRAINT fk_membership_period_student FOREIGN KEY (student_user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO class_membership_periods (class_id, student_user_id, joined_at, left_at)
SELECT class_id, student_user_id, joined_at, left_at FROM class_memberships;

-- 已发布的整班考试仍可能有学生尚未开考：保留当前成员的班级资格。
-- 旧的个人派发及所有学生派发没有可靠的班级来源，不在这里推断。
INSERT IGNORE INTO exam_participant_classes (exam_id, student_user_id, class_id)
SELECT ep.exam_id, ep.student_user_id, tc.class_id
FROM exam_participants ep
JOIN exams e ON e.id = ep.exam_id AND e.target_scope = 'SELECTED' AND e.status = 'PUBLISHED'
JOIN exam_target_classes tc ON tc.exam_id = ep.exam_id
JOIN class_memberships cm ON cm.class_id = tc.class_id
    AND cm.student_user_id = ep.student_user_id AND cm.left_at IS NULL;
