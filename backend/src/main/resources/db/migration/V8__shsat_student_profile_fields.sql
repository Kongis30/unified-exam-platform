-- SHSAT-specific profile details not shared by other exam modules.
CREATE TABLE shsat_student_profiles (
    student_user_id BIGINT UNSIGNED NOT NULL,
    gender VARCHAR(40) NULL,
    notes VARCHAR(1000) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (student_user_id),
    CONSTRAINT fk_shsat_student_profiles_user FOREIGN KEY (student_user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
