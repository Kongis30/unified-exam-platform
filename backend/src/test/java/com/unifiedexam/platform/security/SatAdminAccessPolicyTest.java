package com.unifiedexam.platform.security;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.mock;

class SatAdminAccessPolicyTest {

    private final SatAdminAccessPolicy policy = new SatAdminAccessPolicy(mock(JdbcTemplate.class));

    @Test
    void satAndPsatAuthoringAreRestrictedToAdministrators() {
        var teacher = authentication("ROLE_TEACHER");
        var admin = authentication("ROLE_ADMIN");

        assertThrows(ResponseStatusException.class, () -> policy.requireAdminForType("SAT", teacher));
        assertThrows(ResponseStatusException.class, () -> policy.requireAdminForType("PSAT", teacher));
        assertDoesNotThrow(() -> policy.requireAdminForType("SAT", admin));
    }

    @Test
    void sharedShsatAuthoringRulesAreNotChangedBySatPolicy() {
        assertDoesNotThrow(() -> policy.requireAdminForType("SHSAT", authentication("ROLE_TEACHER")));
    }

    private UsernamePasswordAuthenticationToken authentication(String role) {
        return new UsernamePasswordAuthenticationToken("user", "unused",
            List.of(new SimpleGrantedAuthority(role)));
    }
}
