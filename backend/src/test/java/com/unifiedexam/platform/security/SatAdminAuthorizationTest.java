package com.unifiedexam.platform.security;

import com.unifiedexam.platform.identity.PlatformUserDetailsService;
import com.unifiedexam.platform.identity.UserAdminController;
import com.unifiedexam.platform.classroom.ClassAdminController;
import com.unifiedexam.platform.paper.PaperImageStorage;
import com.unifiedexam.platform.paper.PaperController;
import com.unifiedexam.platform.paper.PaperService;
import com.unifiedexam.platform.release.ExamReleaseController;
import com.unifiedexam.platform.release.ExamReleaseService;
import com.unifiedexam.platform.security.SatAdminAccessPolicy;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.User;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({ ExamReleaseController.class, PaperController.class, UserAdminController.class, ClassAdminController.class })
@Import({ SecurityConfiguration.class, SatAdminAccessPolicy.class, PaperManagementAccessPolicy.class,
    SatAdminAuthorizationTest.TestBeans.class })
class SatAdminAuthorizationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PlatformUserDetailsService userDetailsService;

    @MockBean
    private ExamReleaseService examReleaseService;

    @MockBean
    private PaperService paperService;

    @MockBean
    private JdbcTemplate jdbcTemplate;

    @TestConfiguration
    static class TestBeans {
        @Bean
        PaperImageStorage paperImageStorage() {
            PaperImageStorage storage = mock(PaperImageStorage.class);
            when(storage.resourceLocation()).thenReturn("file:/tmp/");
            return storage;
        }
    }

    @Test
    void satReleaseManagementIsAdministratorOnly() throws Exception {
        when(examReleaseService.list("SAT")).thenReturn(List.of());
        when(userDetailsService.loadUserByUsername("admin"))
            .thenReturn(User.withUsername("admin").password("unused").roles("ADMIN").build());
        when(userDetailsService.loadUserByUsername("teacher"))
            .thenReturn(User.withUsername("teacher").password("unused").roles("TEACHER").build());
        when(userDetailsService.loadUserByUsername("student"))
            .thenReturn(User.withUsername("student").password("unused").roles("STUDENT").build());
        when(userDetailsService.loadUserByUsername("student"))
            .thenReturn(User.withUsername("student").password("unused").roles("STUDENT").build());

        mockMvc.perform(get("/api/admin/exam-types/SAT/exams")
                .with(user("admin").roles("ADMIN")))
            .andExpect(status().isOk());
        verify(examReleaseService).list("SAT");

        mockMvc.perform(get("/api/admin/exam-types/SAT/exams")
                .with(user("teacher").roles("TEACHER")))
            .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/admin/exam-types/SAT/exams")
                .with(user("student").roles("STUDENT")))
            .andExpect(status().isForbidden());
        org.mockito.Mockito.verifyNoMoreInteractions(examReleaseService);
    }

    @Test
    void satPaperLibraryIsAdministratorOnly() throws Exception {
        when(paperService.list("SAT")).thenReturn(List.of());
        when(userDetailsService.loadUserByUsername("admin"))
            .thenReturn(User.withUsername("admin").password("unused").roles("ADMIN").build());
        when(userDetailsService.loadUserByUsername("teacher"))
            .thenReturn(User.withUsername("teacher").password("unused").roles("TEACHER").build());

        mockMvc.perform(get("/api/admin/exam-types/SAT/papers")
                .with(user("admin").roles("ADMIN")))
            .andExpect(status().isOk());
        verify(paperService).list("SAT");

        mockMvc.perform(get("/api/admin/exam-types/SAT/papers")
                .with(user("teacher").roles("TEACHER")))
            .andExpect(status().isForbidden());
        org.mockito.Mockito.verifyNoMoreInteractions(paperService);
    }

    @Test
    void shsatPaperDetailsAndAuthoringAreAdministratorOnly() throws Exception {
        when(userDetailsService.loadUserByUsername("teacher"))
            .thenReturn(User.withUsername("teacher").password("unused").roles("TEACHER").build());

        mockMvc.perform(get("/api/admin/papers/247")
                .with(user("teacher").roles("TEACHER")))
            .andExpect(status().isForbidden());

        mockMvc.perform(put("/api/admin/papers/247/structure")
                .with(user("teacher").roles("TEACHER"))
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"sections\":[]}"))
            .andExpect(status().isForbidden());

        org.mockito.Mockito.verifyNoInteractions(paperService);
    }

    @Test
    void accountManagementAndExamDeletionAreAdministratorOnly() throws Exception {
        when(userDetailsService.loadUserByUsername("admin"))
            .thenReturn(User.withUsername("admin").password("unused").roles("ADMIN").build());
        when(userDetailsService.loadUserByUsername("teacher"))
            .thenReturn(User.withUsername("teacher").password("unused").roles("TEACHER").build());

        mockMvc.perform(get("/api/admin/users")
                .with(user("teacher").roles("TEACHER")))
            .andExpect(status().isForbidden());

        mockMvc.perform(delete("/api/admin/exams/42")
                .with(user("admin").roles("ADMIN"))
                .with(csrf()))
            .andExpect(status().isOk());
        verify(examReleaseService).delete(42L);

        mockMvc.perform(delete("/api/admin/exams/42")
                .with(user("teacher").roles("TEACHER"))
                .with(csrf()))
            .andExpect(status().isForbidden());
    }

    @Test
    void administratorsAndTeachersCanDeleteEmptyClasses() throws Exception {
        when(userDetailsService.loadUserByUsername("admin"))
            .thenReturn(User.withUsername("admin").password("unused").roles("ADMIN").build());
        when(userDetailsService.loadUserByUsername("teacher"))
            .thenReturn(User.withUsername("teacher").password("unused").roles("TEACHER").build());
        when(jdbcTemplate.queryForObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq(Boolean.class), org.mockito.ArgumentMatchers.eq(12L)))
            .thenReturn(true);
        when(jdbcTemplate.queryForObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq(Long.class), org.mockito.ArgumentMatchers.eq(12L)))
            .thenReturn(12L);
        when(jdbcTemplate.queryForObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq(Integer.class), org.mockito.ArgumentMatchers.eq(12L)))
            .thenReturn(0, 0, 0, 0);
        when(jdbcTemplate.update(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq(12L)))
            .thenReturn(1);

        mockMvc.perform(delete("/api/admin/classes/12")
                .with(user("teacher").roles("TEACHER"))
                .with(csrf()))
            .andExpect(status().isOk());

        mockMvc.perform(delete("/api/admin/classes/12")
                .with(user("admin").roles("ADMIN"))
                .with(csrf()))
            .andExpect(status().isOk());

        verify(jdbcTemplate, org.mockito.Mockito.times(2)).update("DELETE FROM exam_target_classes WHERE class_id = ?", 12L);
        verify(jdbcTemplate, org.mockito.Mockito.times(2)).update("DELETE FROM class_memberships WHERE class_id = ?", 12L);
        verify(jdbcTemplate, org.mockito.Mockito.times(2)).update("DELETE FROM classes WHERE id = ?", 12L);
    }
}
