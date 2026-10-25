package com.unifiedexam.platform.paper;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Paths;

/** 配置 SHSAT 上传图和导入 SAT 原图的本地静态资源映射。 */
@Configuration
public class PaperImageResourceConfiguration implements WebMvcConfigurer {

    private final PaperImageStorage imageStorage;
    private final String satImportedMaterialsLocation;

    public PaperImageResourceConfiguration(
            PaperImageStorage imageStorage,
            @Value("${platform.uploads.sat-import-materials-directory:uploads/sat-import/materials}")
            String satImportedMaterialsDirectory) {
        this.imageStorage = imageStorage;
        this.satImportedMaterialsLocation = Paths.get(satImportedMaterialsDirectory)
            .toAbsolutePath()
            .normalize()
            .toUri()
            .toString();
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/uploads/paper-materials/**")
            .addResourceLocations(imageStorage.resourceLocation());
        registry.addResourceHandler("/sat-api/uploads/materials/**")
            .addResourceLocations(satImportedMaterialsLocation);
    }
}
