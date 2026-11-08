import { answerDisplayText } from '../../../utils/answerDisplay.js'

const MULTI_SELECT_TYPES = new Set([
  'MULTI_SELECT',
  'MULTISELECT',
  'MULTIPLE_SELECT',
  'MULTIPLE_SELECTION',
  'MULTIPLE_RESPONSE',
  'MULTIPLE_ANSWER',
  'CHECKBOX',
  'MULTI_SELECT_FIXED',
  'MULTISELECT_FIXED',
  'FIXED_MULTI_SELECT',
]);

const MULTI_SELECT_TYPE_PATTERN = /(^|_)(MULTI_SELECT|MULTISELECT|MULTIPLE_SELECT|MULTIPLE_SELECTION|MULTIPLE_RESPONSE|MULTIPLE_ANSWER|CHECKBOX)(_|$)/;

const COMPLEX_TYPE_TOKENS = [
  'INLINE_CHOICE',
  'DRAG_AND_DROP',
  'HOT_TEXT',
  'HOT_SPOT',
  'TABLE_GRID',
  'GRAPH_QUESTION',
  'EQUATION_EDITOR',
  'SOLUTION_SET',
];

const QUESTION_TYPE_LABELS = {
  MULTIPLE_CHOICE: 'Multiple Choice',
  MULTI_SELECT: 'Multi Select',
  MULTI_SELECT_FIXED: 'Fixed Multi Select',
  FILL_IN_BLANK: 'Fill in the Blank',
  INLINE_CHOICE: 'Inline Choice',
  DRAG_AND_DROP: 'Drag and Drop',
  HOT_TEXT: 'Hot Text',
  HOT_SPOT: 'Hot Spot',
  TABLE_GRID: 'Table Grid',
  GRAPH_QUESTION: 'Point Graph',
  EQUATION_EDITOR: 'Equation Editor',
  SOLUTION_SET: 'Solution Set',
};

export function normalizeQuestionType(type, fallbackType = 'TEXT') {
  return String(type || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || fallbackType;
}

export function getQuestionTypeLabel(type) {
  const normalizedType = normalizeQuestionType(type, '');
  if (!normalizedType) {
    return 'Question';
  }

  return QUESTION_TYPE_LABELS[normalizedType]
    || normalizedType
      .toLowerCase()
      .split('_')
      .filter(Boolean)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ');
}

export function parseJson(value, fallbackValue = null) {
  if (!value || typeof value !== 'string') {
    return value ?? fallbackValue;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallbackValue;
  }
}

export function parseJsonObject(value, fallbackValue = {}) {
  const parsed = parseJson(value, fallbackValue);
  return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : fallbackValue;
}

export function normalizeOption(option, index = 0) {
  const fallbackKey = String.fromCharCode(65 + index);

  if (typeof option === 'string') {
    return { key: fallbackKey, text: option };
  }

  const key = option?.key || option?.label || option?.value || option?.option || fallbackKey;
  const text = option?.text || option?.content || option?.title || option?.value || option?.label || key;

  return {
    key: String(key),
    text: String(text),
  };
}

export function parseOptions(rawOptions) {
  const parsed = parseJson(rawOptions);

  if (Array.isArray(parsed)) {
    return parsed.map((option, index) => normalizeOption(option, index));
  }

  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed).map(([key, value], index) => normalizeOption({ key, value }, index));
  }

  if (typeof rawOptions === 'string' && rawOptions.trim()) {
    return rawOptions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => normalizeOption(line, index));
  }

  return [];
}

export function normalizeAnswerList(value) {
  const parsed = parseJson(value, value);

  if (Array.isArray(parsed)) {
    return parsed.map(normalizeAnswerToken).filter(Boolean);
  }

  if (parsed && typeof parsed === 'object') {
    const answers = parsed.answers ?? parsed.selectedAnswers ?? parsed.selectedIds ?? parsed.regions
      ?? parsed.acceptedAnswers ?? parsed.correctAnswer ?? parsed.answer ?? parsed.values ?? parsed.value;
    if (answers !== undefined) {
      const values = Array.isArray(answers) ? answers : [answers];
      return values.map(normalizeAnswerToken).filter(Boolean);
    }
    return [];
  }

  return String(parsed || '')
    .split(/[;,|]/)
    .map(normalizeAnswerToken)
    .filter(Boolean);
}

export function normalizeAnswerToken(value) {
  return answerDisplayText(value);
}

export function normalizeMap(rawMap) {
  if (!rawMap || Array.isArray(rawMap) || typeof rawMap !== 'object') {
    return {};
  }

  return Object.entries(rawMap).reduce((result, [rawKey, rawValue]) => {
    const key = normalizeAnswerToken(rawKey);
    const value = normalizeAnswerToken(rawValue);
    if (key && value) {
      result[key] = value;
    }
    return result;
  }, {});
}

export function typeMatches(questionType, candidateType, aliases = []) {
  const normalizedType = normalizeQuestionType(questionType, '');
  const normalizedCandidate = normalizeQuestionType(candidateType, '');
  const normalizedAliases = aliases.map((alias) => normalizeQuestionType(alias, ''));

  if (!normalizedType || !normalizedCandidate) {
    return false;
  }

  return normalizedType === normalizedCandidate
    || normalizedAliases.includes(normalizedType)
    || normalizedAliases.some((alias) => alias && normalizedType.includes(alias));
}

export function isMultiSelectType(questionType) {
  const normalizedType = normalizeQuestionType(questionType, '');
  return MULTI_SELECT_TYPES.has(normalizedType) || MULTI_SELECT_TYPE_PATTERN.test(normalizedType);
}

export function isComplexType(questionType) {
  const normalizedType = normalizeQuestionType(questionType, '');
  return COMPLEX_TYPE_TOKENS.some((token) => normalizedType.includes(token));
}

export function isChoiceLikeQuestion(question) {
  const questionType = normalizeQuestionType(question?.questionType, '');
  return Array.isArray(question?.options)
    && question.options.length > 0
    && !questionType.includes('TEXT')
    && !questionType.includes('ESSAY')
    && !isComplexType(questionType);
}

export const questionTypeHelpers = {
  getQuestionTypeLabel,
  normalizeQuestionType,
  parseJson,
  parseJsonObject,
  normalizeOption,
  parseOptions,
  normalizeAnswerList,
  normalizeAnswerToken,
  normalizeMap,
  typeMatches,
  isMultiSelectType,
  isComplexType,
  isChoiceLikeQuestion,
};
