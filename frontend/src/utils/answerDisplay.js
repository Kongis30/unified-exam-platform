const ANSWER_VALUE_KEYS = ['label', 'key', 'value', 'text', 'answer', 'correctAnswer', 'option', 'optionId', 'id']
const ANSWER_LIST_KEYS = ['answers', 'selectedAnswers', 'acceptedAnswers', 'selectedIds', 'regions', 'values']

/** 将历史及结构化答案安全转换为可读文本，避免对象被隐式转成 [object Object]。 */
export function answerDisplayText(value, emptyText = '') {
  if (value === null || value === undefined || value === '') return emptyText
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return answerDisplayText(JSON.parse(trimmed), emptyText)
      } catch {
        // 普通文本可能以大括号或中括号开头，解析失败时仍按原文展示。
      }
    }
    return trimmed || emptyText
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim() || emptyText
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => answerDisplayText(item)).filter(Boolean)
    return items.join(', ') || emptyText
  }
  if (typeof value !== 'object') return emptyText

  for (const key of ANSWER_VALUE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== null && value[key] !== undefined) {
      return answerDisplayText(value[key], emptyText)
    }
  }
  for (const key of ANSWER_LIST_KEYS) {
    if (Array.isArray(value[key])) return answerDisplayText(value[key], emptyText)
  }

  // 未覆盖的旧答案形状也以普通文本显示，避免导出 JSON 或 [object Object]。
  return Object.entries(value)
    .map(([key, item]) => {
      const text = answerDisplayText(item)
      return text ? `${key}: ${text}` : ''
    })
    .filter(Boolean)
    .join('; ') || emptyText
}
