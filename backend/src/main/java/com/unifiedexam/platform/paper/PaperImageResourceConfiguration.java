package com.unifiedexam.platform.paper;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class PaperImageResourceConfiguration implements WebMvcConfigurer {

    private final PaperImageStorage imageStorage;

    public PaperImageResourceConfiguration(PaperImageStorage imageStorage) {
        this.imageStorage = imageStorage;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/uploads/paper-materials/**")
            .addResourceLocations(imageStorage.resourceLocation());
    }
}
