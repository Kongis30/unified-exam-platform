package com.unifiedexam.platform.examtype.sat;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** SAT/PSAT 专属监考查询入口。 */
@RestController
@RequestMapping("/api/admin/sat/reports/exams/{examId}/monitor")
public class SatAdminMonitorController {
    private final SatAdminMonitorService monitor;

    public SatAdminMonitorController(SatAdminMonitorService monitor) {
        this.monitor = monitor;
    }

    @GetMapping("/live")
    public Map<String, Object> live(@PathVariable long examId) {
        return monitor.live(examId);
    }

    @GetMapping("/analytics")
    public Map<String, Object> analytics(@PathVariable long examId) {
        return monitor.analytics(examId);
    }

    @GetMapping("/questions/{questionNumber}")
    public Map<String, Object> question(@PathVariable long examId, @PathVariable int questionNumber) {
        return monitor.question(examId, questionNumber);
    }
}
