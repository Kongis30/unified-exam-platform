package com.unifiedexam.platform.identity;

import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/** 空数据库首次启动时可用环境变量创建唯一初始管理员；后续账号统一由管理 API 维护。 */
@Component
public class AdminBootstrap implements CommandLineRunner {

    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;

    public AdminBootstrap(JdbcTemplate jdbcTemplate, PasswordEncoder passwordEncoder) {
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(String... args) {
        String username = System.getenv("PLATFORM_BOOTSTRAP_ADMIN_USERNAME");
        String password = System.getenv("PLATFORM_BOOTSTRAP_ADMIN_PASSWORD");
        if (!StringUtils.hasText(username) && !StringUtils.hasText(password)) {
            return;
        }
        if (!StringUtils.hasText(username) || password == null || password.length() < 6) {
            throw new IllegalStateException("Initial administrator setup is incomplete. Provide a username and a password of at least 6 characters.");
        }
        Integer userCount = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM users", Integer.class);
        if (userCount != null && userCount == 0) {
            jdbcTemplate.update("""
                INSERT INTO users (username, password_hash, real_name, role_code)
                VALUES (?, ?, ?, 'ADMIN')
                """, username, passwordEncoder.encode(password), username);
        }
    }
}
