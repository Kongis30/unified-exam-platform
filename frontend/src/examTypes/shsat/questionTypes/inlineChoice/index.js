export {
  INLINE_CHOICE_TYPE,
  createDefaultInlineChoiceConfig,
  createDefaultInlineChoiceCorrectAnswerData,
  inlineChoiceQuestionTypeDefinition,
} from './inlineChoice';

export { default as InlineChoiceReport } from './InlineChoiceReport.vue';

export {
  createInlineChoicePlaceholder,
  ensureInlineText,
  findInlineTextBlankIds,
  formatInlineChoiceAnswerMap,
  getInlineChoiceValidationIssues,
  normalizeInlineChoiceAnswerMap,
  normalizeInlineChoiceBlank,
  normalizeInlineChoiceBlanks,
  normalizeInlineChoiceConfig,
  normalizeInlineChoiceOptions,
  parseInlineTextParts,
} from './helpers';

export { default } from './inlineChoice';
