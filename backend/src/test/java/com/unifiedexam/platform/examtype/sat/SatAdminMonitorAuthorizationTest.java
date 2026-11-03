package com.unifiedexam.platform.examtype.sat;

import com.unifiedexam.platform.identity.PlatformUserDetailsService;
import com.unifiedexam.platform.paper.PaperImageStorage;
import com.unifiedexam.platform.security.SecurityConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.User;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({ SatAdminMonitorController.class, SatAdminStudentScoreController.class })
@Import({ SecurityConfiguration.class, SatAdminMonitorAuthorizationTest.TestBeans.class })
class SatAdminMonitorAuthorizationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PlatformUserDetailsService userDetailsService;

    @MockBean
    private SatAdminMonitorService monitorService;

    @MockBean
    private SatAdminStudentScoreService studentScoreService;

    @MockBean
    private com.unifiedexam.platform.identity.WorkspaceAccessService workspaceAccessService;

    @MockBean
    private org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;


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
    void administratorCanReadSatMonitor() throws Exception {
        when(userDetailsService.loadUserByUsername("admin"))
            .thenReturn(User.withUsername("admin").password("unused").roles("ADMIN").build());
        when(monitorService.live(42L)).thenReturn(Map.of("examId", 42L));

        mockMvc.perform(get("/api/admin/sat/reports/exams/42/monitor/live")
                .with(user("admin").roles("ADMIN")))
            .andExpect(status().isOk());
    }

    @Test
    void teacherCannotReadSatMonitor() throws Exception {
        when(userDetailsService.loadUserByUsername("teacher"))
            .thenReturn(User.withUsername("teacher").password("unused").roles("TEACHER").build());

        mockMvc.perform(get("/api/admin/sat/reports/exams/42/monitor/live")
                .with(user("teacher").roles("TEACHER")))
            .andExpect(status().isForbidden());
    }

    @Test
    void onlyAdministratorCanDeleteSatStudentAttempts() throws Exception {
        when(userDetailsService.loadUserByUsername("admin"))
            .thenReturn(User.withUsername("admin").password("unused").roles("ADMIN").build());
        when(userDetailsService.loadUserByUsername("teacher"))
            .thenReturn(User.withUsername("teacher").password("unused").roles("TEACHER").build());

        mockMvc.perform(delete("/api/admin/sat/students/42/attempts/91")
                .with(user("admin").roles("ADMIN"))
                .with(csrf()))
            .andExpect(status().isOk());
        verify(studentScoreService).deleteAttempt(42L, 91L);
        clearInvocations(studentScoreService);

        mockMvc.perform(delete("/api/admin/sat/students/42/attempts/91")
                .with(user("teacher").roles("TEACHER"))
                .with(csrf()))
            .andExpect(status().isForbidden());
        verify(studentScoreService, never()).deleteAttempt(42L, 91L);
    }
}
