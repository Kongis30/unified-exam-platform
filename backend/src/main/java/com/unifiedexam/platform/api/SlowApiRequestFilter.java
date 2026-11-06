package com.unifiedexam.platform.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/** 记录超过阈值的 API 请求；只输出路由模板，避免记录请求参数和用户数据。 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class SlowApiRequestFilter extends OncePerRequestFilter {
    private static final Logger logger = LoggerFactory.getLogger(SlowApiRequestFilter.class);
    private final long thresholdMillis;

    public SlowApiRequestFilter(@Value("${platform.performance.slow-api-threshold-ms:1000}") long thresholdMillis) {
        this.thresholdMillis = thresholdMillis;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(request.getContextPath() + "/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long start = System.nanoTime();
        boolean failed = true;
        try {
            chain.doFilter(request, response);
            failed = false;
        } finally {
            long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
            if (thresholdMillis >= 0 && elapsedMillis >= thresholdMillis) {
                Object route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
                int status = failed && response.getStatus() < 400 ? 500 : response.getStatus();
                logger.warn("SLOW_API method={} route={} status={} duration_ms={}", request.getMethod(),
                    route == null ? "unmatched" : route, status, elapsedMillis);
            }
        }
    }
}
