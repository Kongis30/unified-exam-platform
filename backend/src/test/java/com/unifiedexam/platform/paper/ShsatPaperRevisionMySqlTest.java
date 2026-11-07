package com.unifiedexam.platform.paper;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedexam.platform.attempt.StudentAttemptService;
import com.unifiedexam.platform.examtype.shsat.admin.ShsatAdminReportService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** 在隔离 MySQL 中验证试卷修改与进行中作答使用不同版本。 */
@SpringBootTest
@Transactional
@EnabledIfEnvironmentVariable(named = "SHSAT_REVISION_MYSQL_TEST", matches = "true")
class ShsatPaperRevisionMySqlTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired PaperService papers;
    @Autowired StudentAttemptService attempts;
    @Autowired ObjectMapper json;
    @Autowired ShsatAdminReportService reports;

    @Test
    void savingAUsedPaperPreservesOldQuestionsAndGradesAgainstTheOldAnswer() throws Exception {
        jdbc.update("INSERT INTO users (id, username, password_hash, real_name, role_code, status) VALUES (980001,'revision-admin','x','Admin','ADMIN','ACTIVE'),(980002,'revision-student','x','Student','STUDENT','ACTIVE'),(980003,'revision-student-2','x','Student 2','STUDENT','ACTIVE')");
        jdbc.update("INSERT INTO papers (id,exam_type_code,paper_code,version_no,title,status,default_duration_seconds,sealed_at,created_by) VALUES (980010,'SHSAT','REVISION-TEST',1,'Paper','READY',3600,CURRENT_TIMESTAMP,980001)");
        jdbc.update("INSERT INTO paper_sections (id,paper_id,section_code,section_kind,title,sort_order) VALUES (980020,980010,'ELA','PART','ELA',0)");
        jdbc.update("INSERT INTO questions (id,question_type_code,stem,answer_key_json) VALUES (980030,'MULTIPLE_CHOICE','Old stem',JSON_OBJECT('answers',JSON_ARRAY('A')))");
        jdbc.update("INSERT INTO paper_items (id,section_id,question_id,sort_order,display_number,max_points) VALUES (980040,980020,980030,0,1,1)");
        jdbc.update("INSERT INTO shsat_section_materials (id,section_id,material_type,title,content,sort_order) VALUES (980050,980020,'TEXT','Passage','Old passage',0)");
        jdbc.update("UPDATE questions SET render_json=JSON_OBJECT('materialId',980050) WHERE id=980030");
        jdbc.update("INSERT INTO exams (id,paper_id,title,status,target_scope,opens_at,closes_at,duration_seconds,attempt_limit,answer_visibility,score_visibility,allow_review,created_by) VALUES (980060,980010,'Exam','PUBLISHED','SELECTED',DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 HOUR),DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY),3600,1,'AFTER_SUBMIT','AFTER_SUBMIT',TRUE,980001)");
        jdbc.update("INSERT INTO exam_participants (exam_id,student_user_id) VALUES (980060,980002),(980060,980003)");
        var oldAttempt = attempts.start(980060, "ELA", "revision-student");
        assertEquals("Old stem", oldAttempt.questions().get(0).stem());
        var question = new PaperService.QuestionRequest("MULTIPLE_CHOICE", "New stem", json.readTree("{\"materialId\":980050}"),
            json.readTree("{\"answers\":[\"B\"]}"), null, null, null, 0, 1, BigDecimal.ONE, "ELA", 1, 980040L);
        var section = new PaperService.SectionRequest("ELA", "PART", "English changed", 0, null, null, List.of(question), List.of());
        var material = new PaperService.MaterialWriteRequest("980050", null, "ELA", null, "TEXT", null, "Passage", "New passage", null, 0);
        var saved = papers.saveStructure(980010, new PaperService.SaveStructureRequest(List.of(section), List.of(material)));
        long currentId = saved.sections().get(0).questions().get(0).paperItemId();
        assertNotEquals(980040L, currentId);
        assertEquals(980040L, jdbc.queryForObject("SELECT lineage_id FROM paper_items WHERE id=?", Long.class, currentId));
        assertEquals(1, papers.structureStats(980010).total());
        assertEquals("Old stem", attempts.get(oldAttempt.id(), "revision-student").questions().get(0).stem());
        assertEquals("Old passage", attempts.get(oldAttempt.id(), "revision-student").questions().get(0).display().path("material").path("content").asText());
        var newAttempt = attempts.start(980060, "ELA", "revision-student-2");
        assertEquals(1, newAttempt.questions().size());
        assertEquals("New stem", newAttempt.questions().get(0).stem());
        assertEquals("New passage", newAttempt.questions().get(0).display().path("material").path("content").asText());
        attempts.saveAnswer(oldAttempt.id(), 980040L, json.readTree("{\"value\":\"A\"}"), 0, "revision-student");
        attempts.submit(oldAttempt.id(), "revision-student");
        assertEquals(0, BigDecimal.ONE.compareTo(jdbc.queryForObject("SELECT total_points FROM attempt_results WHERE attempt_id=?", BigDecimal.class, oldAttempt.id())));
        jdbc.update("""
            INSERT INTO shsat_attempt_item_snapshots (attempt_id,source_snapshot_id,source_question_id,question_number,target_paper_item_id,snapshot_json)
            VALUES (?, 988001, 988002, 1, 980040, JSON_OBJECT('question_number',1,'question_type','MULTIPLE_CHOICE',
                'stem','Original imported stem','part_code','ELA','part_name','Original ELA',
                'options',JSON_ARRAY('A','B'),'correct_answer_data',JSON_OBJECT('answers',JSON_ARRAY('A')),
                'max_score',1,'material_type','TEXT','material_title','Imported','material_content','Imported passage'))
            """, oldAttempt.id());
        var reportQuestions = (List<?>) reports.attemptResult(oldAttempt.id()).get("questions");
        assertEquals("Original imported stem", ((java.util.Map<?, ?>) reportQuestions.get(0)).get("stem"));
        assertEquals("Imported passage", ((java.util.Map<?, ?>) reportQuestions.get(0)).get("materialContent"));
        var analytics = (List<?>) reports.monitorAnalytics(980060).get("questionAnalytics");
        assertEquals(1, analytics.size());
        assertEquals(1L, ((java.util.Map<?, ?>) analytics.get(0)).get("correctCount"));
        assertThrows(ResponseStatusException.class, () -> papers.saveStructure(980010,
            new PaperService.SaveStructureRequest(List.of(section), List.of(material), 0L)));
        long currentMaterialId = saved.materials().get(0).id();
        var materialOnly = papers.updateShsatMaterials(980010, List.of(
            new PaperService.MaterialContentUpdate(currentMaterialId, "Passage", null, "Third passage", null)));
        assertEquals("New passage", attempts.get(newAttempt.id(), "revision-student-2")
            .questions().get(0).display().path("material").path("content").asText());
        assertEquals("Third passage", materialOnly.materials().get(0).content());
        assertEquals(1, papers.structureStats(980010).total());
        assertEquals(3L, jdbc.queryForObject("SELECT COUNT(*) FROM paper_sections WHERE paper_id=980010", Long.class));
        var currentQuestion = materialOnly.sections().get(0).questions().get(0);
        var replacement = new PaperService.QuestionRequest("MULTIPLE_CHOICE", "Replacement", null,
            json.readTree("{\"answers\":[\"C\"]}"), null, null, null, 0, 1, BigDecimal.ONE, "ELA", 1);
        var newSection = new PaperService.SectionRequest("MATH", "PART", "Math", 0, null, null,
            List.of(replacement), List.of());
        var deleted = papers.saveStructure(980010, new PaperService.SaveStructureRequest(
            List.of(newSection), List.of(), materialOnly.structureRevision()));
        assertEquals("Replacement", deleted.sections().get(0).questions().get(0).stem());
        assertEquals("New stem", attempts.get(newAttempt.id(), "revision-student-2").questions().get(0).stem());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM paper_items WHERE id=?", Integer.class,
            currentQuestion.paperItemId()));
        jdbc.update("INSERT INTO classes (id,name,status) VALUES (980070,'Revision class','ACTIVE')");
        jdbc.update("INSERT INTO shsat_wrong_answer_tasks (id,exam_id,class_id,title,created_by) VALUES (980080,980060,980070,'Review',980001)");
        jdbc.update("INSERT INTO shsat_wrong_answer_assignments (id,task_id,student_user_id,source_attempt_id,question_numbers_json) VALUES (980090,980080,980002,?,JSON_ARRAY(1))", oldAttempt.id());
        var review = attempts.startWrongAnswerPractice(980090, List.of(1), "revision-student");
        assertEquals(980040L, review.questions().get(0).paperItemId());
        assertEquals("Old stem", review.questions().get(0).stem());
    }
    @Test
    void preservesPaperMaterialWhenItsNumberMatchesAnUnrelatedSectionMaterial() throws Exception {
        jdbc.update("INSERT INTO users (id,username,password_hash,real_name,role_code,status) VALUES (981001,'material-collision-admin','x','Admin','ADMIN','ACTIVE')");
        jdbc.update("INSERT INTO papers (id,exam_type_code,paper_code,version_no,title,status,created_by) VALUES (981010,'SHSAT','MATERIAL-COLLISION',1,'Paper','DRAFT',981001)");
        jdbc.update("INSERT INTO paper_sections (id,paper_id,section_code,section_kind,title,sort_order) VALUES (981020,981010,'ELA','PART','ELA',0),(981021,981010,'MATH','PART','Math',1)");
        jdbc.update("INSERT INTO shsat_section_materials (id,section_id,material_type,title,content,sort_order) VALUES (981050,981021,'TEXT','Math passage','Math content',0)");
        jdbc.update("INSERT INTO shsat_paper_materials (id,paper_id,source_material_id,material_type,title,content,sort_order) VALUES (981050,981010,981050,'TEXT','Legacy passage','Legacy content',0)");
        jdbc.update("INSERT INTO questions (id,question_type_code,stem,render_json,answer_key_json) VALUES (981030,'MULTIPLE_CHOICE','Question',JSON_OBJECT('materialId',981050),JSON_OBJECT('answers',JSON_ARRAY('A')))");
        jdbc.update("INSERT INTO paper_items (id,section_id,question_id,sort_order,display_number,max_points) VALUES (981040,981020,981030,0,1,1)");
        var before = papers.get(981010);
        var sourceQuestion = before.sections().get(0).questions().get(0);
        assertEquals("PAPER", sourceQuestion.render().path("material").path("scope").asText());
        var question = new PaperService.QuestionRequest(sourceQuestion.questionTypeCode(), sourceQuestion.stem(), sourceQuestion.render(),
            sourceQuestion.answerKey(), sourceQuestion.grading(), sourceQuestion.explanation(), sourceQuestion.categoryId(),
            0, 1, BigDecimal.ONE, "ELA", 1, sourceQuestion.paperItemId());
        var ela = new PaperService.SectionRequest("ELA","PART","ELA",0,null,null,List.of(question),List.of());
        var math = new PaperService.SectionRequest("MATH","PART","Math",1,null,null,List.of(),List.of());
        var saved = papers.saveStructureFromEditor(981010, new PaperService.SaveStructureRequest(List.of(ela,math), null, before.structureRevision()));
        assertEquals("Legacy content", saved.sections().get(0).questions().get(0).render().path("material").path("content").asText());
        assertThrows(ResponseStatusException.class, () -> papers.saveStructureFromEditor(981010,
            new PaperService.SaveStructureRequest(List.of(ela, math), null)));
    }

}
