package com.unifiedexam.platform.examtype;

import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** 汇总后端已安装的类型模块；启动时检查重复编码，供目录接口和后续业务路由使用。 */
@Service
public class ExamTypeRegistry {

    private final List<ExamTypeModule> modules;
    private final List<ExamTypeDefinition> definitions;

    public ExamTypeRegistry(List<ExamTypeModule> modules) {
        this.modules = List.copyOf(modules);
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

    /** 返回代码中实际安装的类型；目录接口再与数据库中的启用状态取交集。 */
    public List<ExamTypeDefinition> listAvailableTypes() {
        return definitions;
    }

    /** 按稳定类型编码返回规则模块；业务服务据此调用题型专属评分实现。 */
    public Optional<ExamTypeModule> module(String code) {
        return modules.stream().filter(module -> module.definition().code().equals(code)).findFirst();
    }
}
