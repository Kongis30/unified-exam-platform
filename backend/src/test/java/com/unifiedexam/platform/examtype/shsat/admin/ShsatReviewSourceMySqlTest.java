package com.unifiedexam.platform.examtype.shsat.admin;

import com.unifiedexam.platform.review.ReviewSourceRepository;
import com.unifiedexam.platform.review.ReviewTaskService;
import com.unifiedexam.platform.review.ReviewPracticeService;
import com.unifiedexam.platform.review.ReviewReportService;
import com.unifiedexam.platform.attempt.StudentAttemptService;
import com.unifiedexam.platform.attempt.SatStudentAttemptService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.List;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import org.springframework.web.server.ResponseStatusException;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/** 在隔离库验证多班级来源，事务结束后回滚全部测试数据。 */
@EnabledIfEnvironmentVariable(named = "EXAM_ATTRIBUTION_TEST_URL", matches = ".+")
class ShsatReviewSourceMySqlTest {
    @Test
    void usesLatestCompletedFormalAttemptInTheSelectedClass() {
        var source = new DriverManagerDataSource(System.getenv("EXAM_ATTRIBUTION_TEST_URL"),
            System.getenv("EXAM_ATTRIBUTION_TEST_USER"), System.getenv("EXAM_ATTRIBUTION_TEST_PASSWORD"));
        var jdbc = new JdbcTemplate(source);
        new TransactionTemplate(new DataSourceTransactionManager(source)).executeWithoutResult(tx -> {
            tx.setRollbackOnly();
            jdbc.update("INSERT INTO users (id,username,password_hash,real_name,role_code,status) VALUES (890001,'review-test-admin','x','Admin','ADMIN','ACTIVE'),(890002,'review-test-student','x','Student','STUDENT','ACTIVE')");
            jdbc.update("INSERT INTO classes (id,name,status) VALUES (890011,'A','ACTIVE'),(890012,'B','ACTIVE'),(890013,'C','ACTIVE')");
            jdbc.update("INSERT INTO papers (id,exam_type_code,paper_code,version_no,title,status,sealed_at,created_by) VALUES (890021,'SHSAT','REVIEW-TEST',1,'Review test','READY',CURRENT_TIMESTAMP,890001)");
            jdbc.update("INSERT INTO exams (id,paper_id,title,status,target_scope,opens_at,closes_at,created_by) VALUES (890031,890021,'Review test','PUBLISHED','SELECTED',CURRENT_TIMESTAMP,DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY),890001)");
            jdbc.update("INSERT INTO exam_participants (exam_id,student_user_id) VALUES (890031,890002)");
            jdbc.update("INSERT INTO attempts (id,exam_id,student_user_id,attempt_no,status,is_practice) VALUES (890041,890031,890002,1,'SUBMITTED',FALSE),(890042,890031,890002,2,'SUBMITTED',FALSE),(890043,890031,890002,3,'SUBMITTED',TRUE),(890044,890031,890002,4,'IN_PROGRESS',FALSE)");
            jdbc.update("INSERT INTO attempt_classes (attempt_id,class_id) VALUES (890041,890011),(890042,890012),(890043,890011),(890044,890011)");
            var service = new ReviewSourceRepository(jdbc);
            assertEquals(890041L, service.findLatestAttempts(890031, 890011).get(890002L));
            assertEquals(890042L, service.findLatestAttempts(890031, 890012).get(890002L));
            assertNull(service.findLatestAttempts(890031, 890013).get(890002L));
            jdbc.update("INSERT INTO paper_sections (id,paper_id,section_code,section_kind,title,sort_order) VALUES (890051,890021,'ELA','PART','ELA',0),(890052,890021,'MATH','PART','Math',1)");
            jdbc.update("INSERT INTO questions (id,question_type_code,stem,answer_key_json) VALUES (890061,'MULTIPLE_CHOICE','First',JSON_OBJECT()),(890062,'MULTIPLE_CHOICE','Second',JSON_OBJECT()),(890063,'MULTIPLE_CHOICE','Third',JSON_OBJECT()),(890064,'MULTIPLE_CHOICE','Fourth',JSON_OBJECT())");
            jdbc.update("INSERT INTO paper_items (id,section_id,question_id,sort_order,display_number) VALUES (890071,890051,890061,0,1),(890072,890052,890062,0,1),(890073,890052,890063,1,2),(890074,890052,890064,2,3)");
            jdbc.update("INSERT INTO attempt_items (attempt_id,paper_item_id,served_order) VALUES (890041,890071,1),(890041,890072,2),(890041,890073,3),(890041,890074,4)");
            jdbc.update("INSERT INTO attempt_answers (attempt_id,paper_item_id,answer_json,is_correct) VALUES (890041,890071,JSON_OBJECT(),FALSE),(890041,890072,JSON_OBJECT(),NULL),(890041,890073,JSON_OBJECT(),TRUE)");
            assertEquals(List.of(new ReviewSourceRepository.SourceItem(890071, 1),
                new ReviewSourceRepository.SourceItem(890072, 1), new ReviewSourceRepository.SourceItem(890074, 3)),
                service.findReviewItemsByAttempt(List.of(890041L)).get(890041L));
            jdbc.update("INSERT INTO review_tasks (id,exam_type_code,exam_id,class_id,title,starts_at,ends_at,created_by) VALUES (890081,'SHSAT',890031,890011,'Review',CURRENT_TIMESTAMP,DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY),890001)");
            jdbc.update("INSERT INTO review_assignments (id,task_id,student_user_id,source_attempt_id,status) VALUES (890082,890081,890002,890041,'NOT_STARTED')");
            jdbc.update("INSERT INTO review_assignment_items (assignment_id,paper_item_id,sort_order) VALUES (890082,890071,1),(890082,890072,2),(890082,890074,3)");
            assertEquals(3, jdbc.queryForObject("SELECT COUNT(*) FROM review_assignment_items WHERE assignment_id=890082", Integer.class));
            jdbc.update("INSERT INTO class_exam_workspaces (class_id,exam_type_code) VALUES (890011,'SHSAT'),(890012,'SHSAT')");
            jdbc.update("INSERT INTO class_memberships (class_id,student_user_id) VALUES (890011,890002),(890012,890002)");
            jdbc.update("INSERT INTO user_workspace_access (user_id,workspace_code) VALUES (890002,'SHSAT')");
            jdbc.update("INSERT INTO exam_target_classes (exam_id,class_id) VALUES (890031,890011),(890031,890012)");
            var tasks = new ReviewTaskService(jdbc, service);
            var start = LocalDateTime.now().minusHours(1);
            var end = start.plusDays(1);
            long taskA = tasks.create("SHSAT", new ReviewTaskService.CreateTask(890031, 890011, "Review A", null, start, end), "review-test-admin");
            long taskB = tasks.create("SHSAT", new ReviewTaskService.CreateTask(890031, 890012, "Review B", null, start, end), "review-test-admin");
            assertEquals(890041L, jdbc.queryForObject("SELECT source_attempt_id FROM review_assignments WHERE task_id=?", Long.class, taskA));
            assertEquals(890042L, jdbc.queryForObject("SELECT source_attempt_id FROM review_assignments WHERE task_id=?", Long.class, taskB));
            assertEquals(3, jdbc.queryForObject("SELECT COUNT(*) FROM review_assignment_items i JOIN review_assignments a ON a.id=i.assignment_id WHERE a.task_id=?", Integer.class, taskA));
            assertEquals("NO_WRONG_ANSWERS", jdbc.queryForObject("SELECT status FROM review_assignments WHERE task_id=?", String.class, taskB));
            jdbc.update("INSERT INTO users (id,username,password_hash,real_name,role_code,status) VALUES (890003,'review-test-no-attempt','x','No attempt','STUDENT','ACTIVE'),(890004,'review-test-no-access','x','No access','STUDENT','ACTIVE')");
            jdbc.update("INSERT INTO class_memberships (class_id,student_user_id) VALUES (890011,890003),(890011,890004)");
            jdbc.update("INSERT INTO user_workspace_access (user_id,workspace_code) VALUES (890003,'SHSAT')");
            long taskC = tasks.create("SHSAT", new ReviewTaskService.CreateTask(890031, 890011, "Review C", null, start, end), "review-test-admin");
            assertEquals("NO_SOURCE_ATTEMPT", jdbc.queryForObject("SELECT status FROM review_assignments WHERE task_id=? AND student_user_id=890003", String.class, taskC));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM review_assignments WHERE task_id=? AND student_user_id=890004", Integer.class, taskC));
            assertEquals(2, tasks.detail("SHSAT", taskC).assignments().size());
            assertEquals(3, tasks.detail("SHSAT", taskC).assignments().stream().filter(a -> a.studentId() == 890002).findFirst().orElseThrow().questionCount());
            assertThrows(ResponseStatusException.class, () -> tasks.detail("SAT", taskC));
            assertEquals("ENDED", tasks.end("SHSAT", taskC).status());
            assertEquals("ENDED", jdbc.queryForObject("SELECT status FROM review_assignments WHERE task_id=? AND student_user_id=890002", String.class, taskC));
            // 旧 SHSAT 任务仍沿用题号格式，同时验证批量来源查询和模块权限筛选。
            var legacy = new ShsatWrongAnswerTaskService(jdbc, new ObjectMapper(), null, service);
            var legacyTask = legacy.create(new ShsatWrongAnswerTaskService.CreateTaskRequest(
                890031L, 890011L, "Legacy review", null, start, end), "review-test-admin");
            assertEquals(2, legacyTask.assignedCount());
            assertEquals(890041L, jdbc.queryForObject("SELECT source_attempt_id FROM shsat_wrong_answer_assignments WHERE task_id=? AND student_user_id=890002", Long.class, legacyTask.taskId()));
            assertEquals("[1, 3]", jdbc.queryForObject("SELECT CAST(question_numbers_json AS CHAR) FROM shsat_wrong_answer_assignments WHERE task_id=? AND student_user_id=890002", String.class, legacyTask.taskId()));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM shsat_wrong_answer_assignments WHERE task_id=? AND student_user_id=890004", Integer.class, legacyTask.taskId()));
            int sequence = 0;
            for (String type : List.of("SAT", "PSAT")) {
                int offset = sequence++ * 10;
                long classId = 890101 + offset, paperId = 890102 + offset, examId = 890103 + offset;
                jdbc.update("INSERT INTO classes (id,name,status) VALUES (?,?,'ACTIVE')", classId, type + " class");
                jdbc.update("INSERT INTO class_exam_workspaces (class_id,exam_type_code) VALUES (?,?)", classId, type);
                jdbc.update("INSERT INTO class_memberships (class_id,student_user_id) VALUES (?,890002)", classId);
                jdbc.update("INSERT INTO user_workspace_access (user_id,workspace_code) VALUES (890002,?)", type);
                jdbc.update("INSERT INTO papers (id,exam_type_code,paper_code,version_no,title,status,sealed_at,created_by) VALUES (?,?,?,1,'Paper','READY',CURRENT_TIMESTAMP,890001)", paperId, type, "REVIEW-" + type);
                jdbc.update("INSERT INTO exams (id,paper_id,title,status,target_scope,opens_at,closes_at,created_by) VALUES (?,?,'Exam','CLOSED','SELECTED',CURRENT_TIMESTAMP,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY),890001)", examId, paperId);
                jdbc.update("INSERT INTO exam_target_classes (exam_id,class_id) VALUES (?,?)", examId, classId);
                long task = tasks.create(type, new ReviewTaskService.CreateTask(examId, classId, type + " review", null, start, end), "review-test-admin");
                assertEquals("NO_SOURCE_ATTEMPT", jdbc.queryForObject("SELECT status FROM review_assignments WHERE task_id=?", String.class, task));
                assertEquals(type, jdbc.queryForObject("SELECT exam_type_code FROM review_tasks WHERE id=?", String.class, task));
            }
            jdbc.update("INSERT INTO paper_sections (id,paper_id,section_code,section_kind,title,sort_order) VALUES (890201,890102,'RW1','MODULE','RW1',0)");
            jdbc.update("INSERT INTO questions (id,question_type_code,stem,answer_key_json) VALUES (890202,'SAT_MULTIPLE_CHOICE','Question',JSON_OBJECT('correctAnswer','A'))");
            jdbc.update("INSERT INTO paper_items (id,section_id,question_id,sort_order,display_number) VALUES (890203,890201,890202,0,1)");
            jdbc.update("INSERT INTO exam_participants (exam_id,student_user_id) VALUES (890103,890002)");
            jdbc.update("INSERT INTO attempts (id,exam_id,student_user_id,attempt_no,status,is_practice) VALUES (890204,890103,890002,1,'SUBMITTED',FALSE)");
            jdbc.update("INSERT INTO attempt_classes (attempt_id,class_id) VALUES (890204,890101)");
            jdbc.update("INSERT INTO attempt_items (attempt_id,paper_item_id,served_order) VALUES (890204,890203,1)");
            LocalDateTime utcNow = LocalDateTime.now(ZoneOffset.UTC);
            long satTask = tasks.create("SAT", new ReviewTaskService.CreateTask(890103, 890101, "Practice", null, utcNow.minusMinutes(1), utcNow.plusHours(1)), "review-test-admin");
            long assignment = jdbc.queryForObject("SELECT id FROM review_assignments WHERE task_id=?", Long.class, satTask);
            var practice = new ReviewPracticeService(jdbc, mock(StudentAttemptService.class));
            assertEquals("Exam", practice.list("SAT", "review-test-student").get(0).examTitle());
            practice.start("SAT", assignment, "review-test-student");
            practice.start("SAT", assignment, "review-test-student");
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM review_practice_rounds WHERE assignment_id=?", Integer.class, assignment));
            long practiceId = jdbc.queryForObject("SELECT attempt_id FROM review_practice_rounds WHERE assignment_id=?", Long.class, assignment);
            jdbc.update("UPDATE attempts SET status='SUBMITTED' WHERE id=?", practiceId);
            assertEquals(practiceId, practice.list("SAT", "review-test-student").get(0).latestAttemptId());
            assertEquals(practiceId, tasks.detail("SAT", satTask).assignments().get(0).latestAttemptId());
            var reportDelegate = mock(SatStudentAttemptService.class);
            var reports = new ReviewReportService(jdbc, reportDelegate);
            reports.studentReport("SAT", assignment, "review-test-student");
            verify(reportDelegate).report(practiceId, "review-test-student");
            reports.staffReport("SAT", assignment);
            verify(reportDelegate).reportForStaff(practiceId);
            assertThrows(ResponseStatusException.class, () -> reports.studentReport("SAT", assignment, "review-test-no-attempt"));
            assertThrows(ResponseStatusException.class, () -> reports.studentReport("PSAT", assignment, "review-test-student"));
            assertThrows(ResponseStatusException.class, () -> practice.start("PSAT", assignment, "review-test-student"));
            assertThrows(ResponseStatusException.class, () -> practice.start("SAT", assignment, "review-test-no-attempt"));
        });
    }
}
