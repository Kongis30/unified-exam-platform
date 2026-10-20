import { getQuestionTypeDefinition } from './registry';

// 污染数据清洗：历史 bug 会把答案对象绑到文本输入框，被 DOM 强转成 "[object Object]"
//（学生误编辑后还可能拼成 "[object Object]4" 之类的字符串存库）。这里在展示/恢复时兜底剔除。
function stripObjectObjectTokens(value) {
  const cleaned = String(value ?? '')
    .split('[object Object]')
    .map((token) => token.trim())
    .filter(Boolean)
    .join('');
  return cleaned.trim();
}

// 恢复已保存答案（重进考试页/回看报告）时，把存储的 JSON 按题型归一化为与活跃会话一致的形态。
// migrated 题型走题型定义自带的 normalizeAnswerData，新增题型只要注册定义即可自动受益；
// 未迁移(legacy)题型没有组件承载结构化答案：文本类答案在活跃会话中始终是纯字符串，
// 恢复时同样展开为字符串，并剔除历史 "[object Object]" 污染，避免对象被输入框再次强转。
export function normalizeRestoredAnswerValue(question, rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  const definition = getQuestionTypeDefinition(question?.questionType);
  if (definition?.migrated && typeof definition.normalizeAnswerData === 'function') {
    const normalized = definition.normalizeAnswerData(rawValue, { question, questionType: question?.questionType });
    if (typeof normalized === 'string' && normalized.includes('[object Object]')) {
      return stripObjectObjectTokens(normalized);
    }
    return normalized;
  }

  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    const listAnswer = rawValue.answers ?? rawValue.selectedAnswers ?? rawValue.selectedIds ?? rawValue.regions;
    if (Array.isArray(listAnswer)) {
      return stripObjectObjectTokens(
        listAnswer.filter((item) => typeof item === 'string' || typeof item === 'number').join(',')
      );
    }
    if (listAnswer && typeof listAnswer === 'object') {
      // 多空格填空的 answers 是 { blankId: 文本 } 映射，按空格顺序拼接便于复核。
      const mapped = Object.entries(listAnswer)
        .filter(([, item]) => item !== null && item !== undefined && String(item).trim() !== '')
        .map(([, item]) => String(item).trim());
      return stripObjectObjectTokens(mapped.join(','));
    }
    if (typeof rawValue.value === 'string') {
      return stripObjectObjectTokens(rawValue.value);
    }
    return '';
  }

  if (typeof rawValue === 'string' && rawValue.includes('[object Object]')) {
    return stripObjectObjectTokens(rawValue);
  }
  return rawValue;
}
