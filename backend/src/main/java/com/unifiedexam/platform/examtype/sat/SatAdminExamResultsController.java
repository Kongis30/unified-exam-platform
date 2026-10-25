package com.unifiedexam.platform.examtype.sat;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/admin/sat/exams")
public class SatAdminExamResultsController {
    private final SatAdminExamResultsService results;

    public SatAdminExamResultsController(SatAdminExamResultsService results) {
        this.results = results;
    }

    @GetMapping("/{examId}/results")
    public Map<String, Object> results(@PathVariable long examId) {
        return results.results(examId);
    }
}
