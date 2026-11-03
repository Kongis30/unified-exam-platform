package com.unifiedexam.platform.release;

import com.unifiedexam.platform.classroom.ClassAdminController;
import com.unifiedexam.platform.examtype.ExamTypeDefinition;
import com.unifiedexam.platform.examtype.ExamTypeRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 仅在隔离测试库运行：验证真实 MySQL 的跨班派发和班级考试查询。 */
@EnabledIfEnvironmentVariable(named = "EXAM_ATTRIBUTION_TEST_URL", matches = ".+")
class ExamClassAttributionMySqlTest {
    @Test
    void oneAttemptCanBelongToBothSelectedClassesButNotAnotherClass() {
        var source = new DriverManagerDataSource(System.getenv("EXAM_ATTRIBUTION_TEST_URL"),
            System.getenv("EXAM_ATTRIBUTION_TEST_USER"), System.getenv("EXAM_ATTRIBUTION_TEST_PASSWORD"));
        JdbcTemplate jdbc = new JdbcTemplate(source);
        jdbc.update("INSERT INTO users (id, username, password_hash, real_name, role_code, status) VALUES (9001,'test-admin','x','Admin','ADMIN','ACTIVE'),(9002,'test-student','x','Student','STUDENT','ACTIVE')");
        jdbc.update("INSERT INTO classes (id,name,status) VALUES (9101,'A','ACTIVE'),(9102,'B','ACTIVE'),(9103,'C','ACTIVE'),(9104,'D','ACTIVE')");
        jdbc.update("INSERT INTO class_exam_workspaces (class_id,exam_type_code) VALUES (9101,'SAT'),(9102,'SAT'),(9103,'SAT'),(9104,'SAT')");
        jdbc.update("INSERT INTO class_memberships (class_id,student_user_id) VALUES (9101,9002),(9102,9002),(9103,9002)");
        jdbc.update("INSERT INTO papers (id,exam_type_code,paper_code,version_no,title,status,sealed_at,created_by) VALUES (9201,'SAT','TEST-ATTRIBUTION',1,'Paper','READY',CURRENT_TIMESTAMP,9001)");
        jdbc.update("INSERT INTO exams (id,paper_id,title,status,target_scope,opens_at,closes_at,created_by) VALUES (9301,9201,'Exam','DRAFT','SELECTED',DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR),DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY),9001)");
        ExamTypeRegistry registry = mock(ExamTypeRegistry.class);
        when(registry.listAvailableTypes()).thenReturn(List.of(new ExamTypeDefinition("SAT", "SAT", "", 1, "SAT", "SAT")));
        ExamReleaseService service = new ExamReleaseService(jdbc, registry);
        service.saveTargets(9301, new ExamReleaseService.TargetRequest(List.of(9101L), List.of(9002L),
            List.of(new ExamReleaseService.StudentClassTarget(9102, 9002))));
        service.publish(9301);
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM exam_participants WHERE exam_id=9301", Integer.class));
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM exam_participant_classes WHERE exam_id=9301 AND student_user_id=9002", Integer.class));
        jdbc.update("INSERT INTO attempts (id,exam_id,student_user_id,attempt_no,is_practice) VALUES (9401,9301,9002,1,FALSE)");
        jdbc.update("INSERT INTO attempt_classes (attempt_id,class_id) SELECT 9401,class_id FROM exam_participant_classes WHERE exam_id=9301 AND student_user_id=9002");
        ClassAdminController classes = new ClassAdminController(jdbc);
        assertEquals(1, classes.listClassExams(9101, List.of("SAT")).size());
        assertEquals(1, classes.listClassExams(9102, List.of("SAT")).size());
        assertEquals(0, classes.listClassExams(9103, List.of("SAT")).size());
        classes.addStudent(9104, new ClassAdminController.MembershipRequest(9002));
        classes.removeStudent(9104, 9002);
        classes.addStudent(9104, new ClassAdminController.MembershipRequest(9002));
        assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM class_membership_periods WHERE class_id=9104 AND student_user_id=9002", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM class_membership_periods WHERE class_id=9104 AND student_user_id=9002 AND left_at IS NULL", Integer.class));
    }
}
