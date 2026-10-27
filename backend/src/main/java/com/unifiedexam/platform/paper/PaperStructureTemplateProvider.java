package com.unifiedexam.platform.paper;

import java.util.List;

/** 为特定考试类型提供新试卷所需的初始结构。 */
public interface PaperStructureTemplateProvider {

    String examTypeCode();

    List<PaperService.SectionRequest> sections();
}
