package com.unifiedexam.platform.examtype.shsat.admin;

import java.time.LocalDateTime;

/** SHSAT 复习任务的可用时间和进度标签规则。 */
final class ShsatWrongAnswerTaskPolicy {

    private ShsatWrongAnswerTaskPolicy() { }

    static boolean isAvailable(String taskStatus, LocalDateTime startsAt, LocalDateTime endsAt, LocalDateTime now) {
        return "PUBLISHED".equals(taskStatus)
            && (startsAt == null || !now.isBefore(startsAt))
            && (endsAt == null || now.isBefore(endsAt));
    }

    static String studentStatus(String taskStatus, String attemptStatus, String assignmentStatus, int remaining) {
        if ("NO_SOURCE_ATTEMPT".equals(assignmentStatus) || "NO_WRONG_ANSWERS".equals(assignmentStatus)) {
            return assignmentStatus;
        }
        if (remaining <= 0) return "COMPLETED";
        if ("IN_PROGRESS".equals(attemptStatus)) return "IN_PROGRESS";
        if ("ENDED".equals(taskStatus)) return "ENDED";
        if ("SUBMITTED".equals(attemptStatus) || "EXPIRED".equals(attemptStatus) || "COMPLETED".equals(attemptStatus)) {
            return "RETRY_REQUIRED";
        }
        return assignmentStatus;
    }
}
