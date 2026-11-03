package com.unifiedexam.platform.security;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WorkspaceAccessWebConfig implements WebMvcConfigurer {
    private final WorkspaceAccessInterceptor interceptor;

    public WorkspaceAccessWebConfig(WorkspaceAccessInterceptor interceptor) { this.interceptor = interceptor; }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(interceptor).addPathPatterns("/api/**");
    }
}
