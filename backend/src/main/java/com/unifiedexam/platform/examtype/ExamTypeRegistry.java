package com.unifiedexam.platform.examtype;

import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** 汇总后端已安装的类型模块；启动时检查重复编码，供目录接口和后续业务路由使用。 */
@Service
public class ExamTypeRegistry {

    private final List<ExamTypeDefinition> definitions;

    public ExamTypeRegistry(List<ExamTypeModule> modules) {
        List<ExamTypeDefinition> registered = modules.stream()
                .map(ExamTypeModule::definition)
                .sorted(Comparator.comparingInt(ExamTypeDefinition::sortOrder))
                .toList();

        Set<String> codes = new HashSet<>();
        for (ExamTypeDefinition definition : registered) {
            if (!codes.add(definition.code())) {
                throw new IllegalStateException("Duplicate exam type code: " + definition.code());
            }
        }

        this.definitions = List.copyOf(registered);
    }

    /** 返回已在代码中注册的类型；数据库目录状态接入后由目录服务进一步过滤。 */
    public List<ExamTypeDefinition> listAvailableTypes() {
        return definitions;
    }
}
