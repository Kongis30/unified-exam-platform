package com.unifiedexam.platform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 统一考试平台后端启动入口。 */
@SpringBootApplication
@EnableScheduling
public class ExamPlatformApplication {

    public static void main(String[] args) {
        SpringApplication.run(ExamPlatformApplication.class, args);
    }
}
