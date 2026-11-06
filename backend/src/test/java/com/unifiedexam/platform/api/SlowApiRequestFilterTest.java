package com.unifiedexam.platform.api;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.HandlerMapping;

import static org.junit.jupiter.api.Assertions.*;

class SlowApiRequestFilterTest {
    @Test
    void logsSlowRouteTemplateWithoutRequestDetails() throws Exception {
        Logger logger = (Logger) LoggerFactory.getLogger(SlowApiRequestFilter.class);
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            var request = new MockHttpServletRequest("GET", "/api/admin/classes/123/students");
            request.setQueryString("name=private");
            new SlowApiRequestFilter(0).doFilter(request, new MockHttpServletResponse(), (req, res) ->
                req.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/api/admin/classes/{classId}/students"));
            assertEquals(1, appender.list.size());
            String message = appender.list.get(0).getFormattedMessage();
            assertTrue(message.contains("route=/api/admin/classes/{classId}/students"));
            assertTrue(message.contains("status=200"));
            assertFalse(message.contains("123"));
            assertFalse(message.contains("private"));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void skipsFastAndNonApiRequestsAndRecordsUncaughtFailure() throws Exception {
        Logger logger = (Logger) LoggerFactory.getLogger(SlowApiRequestFilter.class);
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        try {
            var api = new MockHttpServletRequest("GET", "/api/test");
            new SlowApiRequestFilter(Long.MAX_VALUE).doFilter(api, new MockHttpServletResponse(), (req, res) -> {});
            new SlowApiRequestFilter(0).doFilter(new MockHttpServletRequest("GET", "/assets/app.js"),
                new MockHttpServletResponse(), (req, res) -> {});
            assertTrue(appender.list.isEmpty());
            assertThrows(ServletException.class, () -> new SlowApiRequestFilter(0).doFilter(
                new MockHttpServletRequest("GET", "/api/secret/123"), new MockHttpServletResponse(),
                (req, res) -> { throw new ServletException("test"); }));
            assertEquals(1, appender.list.size());
            assertTrue(appender.list.get(0).getFormattedMessage().contains("route=unmatched status=500"));
            assertFalse(appender.list.get(0).getFormattedMessage().contains("secret"));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }
}
