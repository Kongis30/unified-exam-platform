package com.unifiedexam.platform.security;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** 纸卷内容、答案与题库结构只允许管理员管理。 */
@Component
public class PaperManagementAccessPolicy {

    public void requireAdministrator(Authentication authentication) {
        boolean administrator = authentication != null && authentication.getAuthorities().stream()
            .anyMatch(authority -> "ROLE_ADMIN".equals(authority.getAuthority()));
        if (!administrator) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                "Administrator role required for paper management.");
        }
    }
}
