import InlineChoiceAnswer from './InlineChoiceAnswer.vue';
import { parseJsonObject, parseOptions } from '../utils';
import InlineChoiceEditor from './InlineChoiceEditor.vue';
import InlineChoiceReport from './InlineChoiceReport.vue';
import {
  formatInlineChoiceAnswerMap,
  getInlineChoiceValidationIssues,
  normalizeInlineChoiceAnswerMap,
  normalizeInlineChoiceConfig,
} from './helpers';

export const INLINE_CHOICE_TYPE = 'INLINE_CHOICE';

export function createDefaultInlineChoiceConfig() {
  return {
    inlineText: 'Select the best answer: {{blank:blank1}}',
    blanks: [
      {
        id: 'blank1',
        label: 'Dropdown 1',
        options: [
          { key: 'A', text: 'Option' },
          { key: 'B', text: 'Option' },
        ],
      },
    ],
  };
}

export function createDefaultInlineChoiceCorrectAnswerData() {
  return {
    answers: {
      blank1: '',
    },
  };
}

function inlineChoiceBlanksForReport(question = {}) {
  if (Array.isArray(question.inlineChoices)) {
    return question.inlineChoices;
  }

  return normalizeInlineChoiceConfig(
    parseJsonObject(question.questionConfig),
    parseOptions(question.options)
  ).blanks;
}

export const inlineChoiceQuestionTypeDefinition = {
  type: INLINE_CHOICE_TYPE,
  aliases: [INLINE_CHOICE_TYPE],
  label: 'Inline Choice',
  usesGlobalOptions: false,
  components: {
    editor: InlineChoiceEditor,
    answer: InlineChoiceAnswer,
    report: InlineChoiceReport,
  },
  createDefaultConfig: createDefaultInlineChoiceConfig,
  createDefaultCorrectAnswerData: createDefaultInlineChoiceCorrectAnswerData,
  normalizeQuestion(question = {}) {
    const globalOptions = parseOptions(question.options);
    const questionConfig = normalizeInlineChoiceConfig(
      parseJsonObject(question.questionConfig, createDefaultInlineChoiceConfig()),
      globalOptions
    );
    const inlineChoices = questionConfig.blanks;

    return {
      ...question,
      questionType: INLINE_CHOICE_TYPE,
      options: globalOptions,
      questionConfig,
      inlineChoices,
      correctAnswerData: {
        answers: normalizeInlineChoiceAnswerMap(
          question.correctAnswerData || createDefaultInlineChoiceCorrectAnswerData(),
          inlineChoices
        ),
      },
      validationRules: parseJsonObject(question.validationRules),
      scoringRules: parseJsonObject(question.scoringRules),
    };
  },
  normalizeAnswerData(rawAnswer, { question } = {}) {
    const blanks = question?.inlineChoices
      || question?.questionConfig?.blanks
      || createDefaultInlineChoiceConfig().blanks;

    return {
      answers: normalizeInlineChoiceAnswerMap(rawAnswer, blanks),
    };
  },
  validateQuestion(question = {}) {
    return getInlineChoiceValidationIssues(question);
  },
  formatReportAnswer({ question, answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    const blanks = inlineChoiceBlanksForReport(question);
    const answerMap = normalizeInlineChoiceAnswerMap(answerData ?? selectedAnswer, blanks);
    return formatInlineChoiceAnswerMap(answerMap, emptyText, blanks);
  },
};

export default inlineChoiceQuestionTypeDefinition;
