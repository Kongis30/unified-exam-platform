package com.unifiedexam.platform.security;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Keeps SAT/PSAT authoring and release operations administrator-only while preserving shared routes. */
@Component
public class SatAdminAccessPolicy {

    private final JdbcTemplate jdbc;

    public SatAdminAccessPolicy(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void requireAdminForType(String examTypeCode, Authentication authentication) {
        if (isSatType(examTypeCode) && !isAdmin(authentication)) deny();
    }

    public void requireAdminForPaper(long paperId, Authentication authentication) {
        String examTypeCode = jdbc.query("SELECT exam_type_code FROM papers WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, paperId);
        requireAdminForType(examTypeCode, authentication);
    }

    public void requireAdminForExam(long examId, Authentication authentication) {
        String examTypeCode = jdbc.query("""
            SELECT p.exam_type_code FROM exams e JOIN papers p ON p.id = e.paper_id WHERE e.id = ?
            """, rs -> rs.next() ? rs.getString(1) : null, examId);
        requireAdminForType(examTypeCode, authentication);
    }

    private boolean isAdmin(Authentication authentication) {
        return authentication != null && authentication.getAuthorities().stream()
            .anyMatch(authority -> "ROLE_ADMIN".equals(authority.getAuthority()));
    }

    private boolean isSatType(String examTypeCode) {
        return "SAT".equals(examTypeCode) || "PSAT".equals(examTypeCode);
    }

    private void deny() {
        throw new ResponseStatusException(HttpStatus.FORBIDDEN,
            "Administrator role required for SAT and PSAT management.");
    }
}
