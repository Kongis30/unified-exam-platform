package com.unifiedexam.platform.identity;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class PlatformUserDetailsService implements UserDetailsService {

    private final JdbcTemplate jdbcTemplate;

    public PlatformUserDetailsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        return jdbcTemplate.query("""
            SELECT username, password_hash, role_code, status
            FROM users WHERE username = ?
            """, resultSet -> {
                if (!resultSet.next()) {
                    throw new UsernameNotFoundException("Invalid username or password.");
                }
                return User.withUsername(resultSet.getString("username"))
                    .password(resultSet.getString("password_hash"))
                    .roles(resultSet.getString("role_code"))
                    .disabled(!"ACTIVE".equals(resultSet.getString("status")))
                    .build();
            }, username);
    }
}
