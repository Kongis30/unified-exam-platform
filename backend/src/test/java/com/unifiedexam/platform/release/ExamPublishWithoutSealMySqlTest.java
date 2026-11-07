package com.unifiedexam.platform.release;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.*;

/** 验证无需封存即可发布有效试卷，同时阻止发布空卷。 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "SHSAT_REVISION_MYSQL_TEST", matches = "true")
class ExamPublishWithoutSealMySqlTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired ExamReleaseService releases;

    @Test
    void publishesDraftPaperAndStillRejectsEmptyPaper() {
        jdbc.update("INSERT INTO users (id,username,password_hash,real_name,role_code,status) VALUES (983001,'publish-unsealed-admin','x','Admin','ADMIN','ACTIVE'),(983002,'publish-unsealed-student','x','Student','STUDENT','ACTIVE')");
        jdbc.update("INSERT INTO papers (id,exam_type_code,paper_code,version_no,title,status,created_by) VALUES (983010,'SHSAT','UNSEALED-PAPER',1,'Paper','DRAFT',983001),(983011,'SHSAT','EMPTY-PAPER',1,'Empty','DRAFT',983001)");
        jdbc.update("INSERT INTO paper_sections (id,paper_id,section_code,section_kind,title,sort_order) VALUES (983020,983010,'ELA','PART','ELA',0)");
        jdbc.update("INSERT INTO questions (id,question_type_code,stem,answer_key_json) VALUES (983030,'MULTIPLE_CHOICE','Question',JSON_OBJECT('answers',JSON_ARRAY('A')))");
        jdbc.update("INSERT INTO paper_items (id,section_id,question_id,sort_order,display_number,max_points) VALUES (983040,983020,983030,0,1,1)");
        jdbc.update("INSERT INTO exams (id,paper_id,title,status,target_scope,opens_at,closes_at,duration_seconds,attempt_limit,created_by) VALUES (983050,983010,'Exam','DRAFT','SELECTED',DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 HOUR),DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY),3600,1,983001),(983051,983011,'Empty','DRAFT','SELECTED',DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 HOUR),DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY),3600,1,983001)");
        jdbc.update("INSERT INTO exam_target_students (exam_id,student_user_id) VALUES (983050,983002),(983051,983002)");
        assertEquals("PUBLISHED", releases.publish(983050).summary().status());
        assertEquals("DRAFT", jdbc.queryForObject("SELECT status FROM papers WHERE id=983010", String.class));
        var error = assertThrows(ResponseStatusException.class, () -> releases.publish(983051));
        assertEquals("Add at least one question before publishing this exam.", error.getReason());
    }
}
