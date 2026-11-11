package com.unifiedexam.platform.examtype;

import com.unifiedexam.platform.attempt.StudentScoreTrend;

/**
 * 考试类型模块向平台提供「该类型的学生个人分数趋势」的契约。
 *
 * <p>平台层只按 {@code examTypeCode} 找到已注册实现，不出现类型分支；
 * 每个类型模块自行查询自己的表、应用自己的评分规则与可见性口径。
 *
 * <p>一次 {@link #load(long)} 返回完整趋势（两条序列 + 计数 + 排除数），
 * 避免拆成多个方法导致同一批数据被重复查询。
 *
 * @see com.unifiedexam.platform.attempt.StudentScoreTrendService
 */
public interface ScoreTrendProvider {

    /** 该实现负责的稳定类型编码，如 SAT / PSAT / SHSAT。 */
    String examTypeCode();

    /** 返回该学生在此类型下的完整趋势；无作答时返回两条空序列，不能返回 null。 */
    StudentScoreTrend load(long studentUserId);
}
