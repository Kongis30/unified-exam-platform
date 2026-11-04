package com.unifiedexam.platform.classroom;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** 在隔离 MySQL 中验证学生权限与模块内分班，测试事务结束后回滚。 */
@EnabledIfEnvironmentVariable(named = "EXAM_ATTRIBUTION_TEST_URL", matches = ".+")
class StudentWorkspaceMySqlTest {
    @Test
    void directoryAndMembershipRespectShsatAccess() {
        var source = new DriverManagerDataSource(System.getenv("EXAM_ATTRIBUTION_TEST_URL"),
            System.getenv("EXAM_ATTRIBUTION_TEST_USER"), System.getenv("EXAM_ATTRIBUTION_TEST_PASSWORD"));
        var jdbc = new JdbcTemplate(source);
        new TransactionTemplate(new DataSourceTransactionManager(source)).executeWithoutResult(status -> {
            try {
                jdbc.update("INSERT INTO users (id,username,password_hash,real_name,role_code) VALUES (98001,'scope-sat','x','SAT only','STUDENT'),(98002,'scope-both','x','Both','STUDENT'),(98003,'scope-psat','x','PSAT only','STUDENT')");
                jdbc.update("INSERT INTO user_workspace_access (user_id,workspace_code) VALUES (98001,'SAT'),(98002,'SAT'),(98002,'SHSAT'),(98003,'PSAT')");
                jdbc.update("INSERT INTO classes (id,name) VALUES (98101,'SAT scope'),(98102,'SHSAT scope'),(98103,'PSAT scope')");
                jdbc.update("INSERT INTO class_exam_workspaces (class_id,exam_type_code) VALUES (98101,'SAT'),(98102,'SHSAT'),(98103,'PSAT')");
                jdbc.update("INSERT INTO class_memberships (class_id,student_user_id) VALUES (98101,98002),(98102,98001)");
                var controller = new ClassAdminController(jdbc);
                var students = controller.availableStudents("SHSAT");
                assertTrue(students.stream().noneMatch(s -> s.id() == 98001));
                assertTrue(controller.availableStudents("SAT").stream().noneMatch(s -> s.id() == 98003));
                assertTrue(controller.availableStudents("PSAT").stream().anyMatch(s -> s.id() == 98003));
                assertTrue(controller.availableStudents("PSAT").stream().noneMatch(s -> s.id() == 98001));
                assertEquals("", students.stream().filter(s -> s.id() == 98002).findFirst().orElseThrow().classNames());
                assertTrue(controller.listStudents(98102, List.of("SHSAT")).stream().noneMatch(s -> s.id() == 98001));
                assertThrows(ResponseStatusException.class, () -> controller.addStudent(98102, new ClassAdminController.MembershipRequest(98001)));
                controller.addStudent(98103, new ClassAdminController.MembershipRequest(98003));
                controller.addStudent(98102, new ClassAdminController.MembershipRequest(98002));
                assertTrue(controller.listStudents(98102, List.of("SHSAT")).stream().anyMatch(s -> s.id() == 98002));
            } finally { status.setRollbackOnly(); }
        });
    }
}
