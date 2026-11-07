package com.unifiedexam.platform.paper;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.attempt.StudentAttemptService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/** 双连接覆盖保存与开考抢锁的时序，确保作答读取同一版本。 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "SHSAT_REVISION_MYSQL_TEST", matches = "true")
class ShsatPaperRevisionConcurrencyMySqlTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired PaperService papers;
    @Autowired StudentAttemptService attempts;
    @Autowired ObjectMapper json;
    @Autowired PlatformTransactionManager transactions;

    @Test
    void startingAfterWaitingForSaveReadsOnlyTheNewVersion() throws Exception {
        jdbc.update("INSERT INTO users (id,username,password_hash,real_name,role_code,status) VALUES (982001,'revision-lock-admin','x','Admin','ADMIN','ACTIVE'),(982002,'revision-lock-student','x','Student','STUDENT','ACTIVE')");
        jdbc.update("INSERT INTO papers (id,exam_type_code,paper_code,version_no,title,status,default_duration_seconds,sealed_at,created_by) VALUES (982010,'SHSAT','REVISION-LOCK',1,'Paper','READY',3600,CURRENT_TIMESTAMP,982001)");
        jdbc.update("INSERT INTO paper_sections (id,paper_id,section_code,section_kind,title,sort_order) VALUES (982020,982010,'ELA','PART','ELA',0)");
        jdbc.update("INSERT INTO questions (id,question_type_code,stem,answer_key_json) VALUES (982030,'MULTIPLE_CHOICE','Before',JSON_OBJECT('answers',JSON_ARRAY('A')))");
        jdbc.update("INSERT INTO paper_items (id,section_id,question_id,sort_order,display_number,max_points) VALUES (982040,982020,982030,0,1,1)");
        jdbc.update("INSERT INTO exams (id,paper_id,title,status,target_scope,opens_at,closes_at,duration_seconds,attempt_limit,created_by) VALUES (982060,982010,'Exam','PUBLISHED','SELECTED',DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 HOUR),DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY),3600,1,982001)");
        jdbc.update("INSERT INTO exam_participants (exam_id,student_user_id) VALUES (982060,982002)");
        var worker = Executors.newSingleThreadExecutor();
        try {
            var requestQuestion = new PaperService.QuestionRequest("MULTIPLE_CHOICE", "After", null,
                json.readTree("{\"answers\":[\"B\"]}"), null, null, null, 0, 1, BigDecimal.ONE, "ELA", 1, 982040L);
            var section = new PaperService.SectionRequest("ELA","PART","ELA",0,null,null,List.of(requestQuestion),List.of());
            var started = new CountDownLatch(1);
            var result = new TransactionTemplate(transactions).execute(tx -> {
                jdbc.queryForObject("SELECT id FROM papers WHERE id=982010 FOR UPDATE", Long.class);
                var future = worker.submit(() -> { started.countDown(); return attempts.start(982060, "ELA", "revision-lock-student"); });
                try {
                    assertTrue(started.await(2, TimeUnit.SECONDS));
                    Thread.sleep(250);
                    assertFalse(future.isDone(), "开考应等待保存事务释放试卷锁");
                    papers.saveStructureFromEditor(982010, new PaperService.SaveStructureRequest(List.of(section), List.of(), 0L));
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(exception);
                }
                return future;
            });
            var attempt = result.get(10, TimeUnit.SECONDS);
            assertEquals(1, attempt.questions().size());
            assertEquals("After", attempt.questions().get(0).stem());
            assertEquals("ELA", attempt.progressState().path("currentSection").asText());
        } finally {
            worker.shutdownNow();
            papers.delete(982010);
            jdbc.update("DELETE FROM users WHERE id IN (982001,982002)");
        }
    }
}
