import ChoiceAnswer from './ChoiceAnswer.vue';
import ChoiceEditor from './ChoiceEditor.vue';
import {
  isMultiSelectType,
  normalizeAnswerList,
  normalizeQuestionType,
  parseJsonObject,
  parseOptions,
} from '../utils';

function isSingleChoice(questionType) {
  return !isMultiSelectType(questionType);
}

function normalizeChoiceQuestionType(questionType) {
  const normalizedType = normalizeQuestionType(questionType, 'MULTIPLE_CHOICE');

  if (['MULTI_SELECT_FIXED', 'MULTISELECT_FIXED', 'FIXED_MULTI_SELECT'].includes(normalizedType)) {
    return 'MULTI_SELECT_FIXED';
  }
  if (isMultiSelectType(normalizedType)) {
    return 'MULTI_SELECT';
  }

  return 'MULTIPLE_CHOICE';
}

function normalizeChoiceAnswerData(rawAnswer, { questionType } = {}) {
  const answers = normalizeAnswerList(rawAnswer);
  return {
    answers: isSingleChoice(questionType) ? answers.slice(0, 1) : answers,
  };
}

function normalizeChoiceQuestionAnswerData(question, questionType) {
  const structuredAnswer = normalizeChoiceAnswerData(question.correctAnswerData, { questionType });
  if (structuredAnswer.answers.length > 0) {
    return structuredAnswer;
  }

  return normalizeChoiceAnswerData(question.correctAnswer, { questionType });
}

function formatChoiceAnswer(value, emptyText = 'Not answered') {
  const answers = normalizeAnswerList(value);
  return answers.length > 0 ? answers.join(', ') : emptyText;
}

const choiceQuestionTypeDefinition = {
  type: 'MULTIPLE_CHOICE',
  aliases: [
    'MULTI_SELECT',
    'MULTI_SELECT_FIXED',
    'SINGLE_CHOICE',
    'CHOICE',
    'CHECKBOX',
    'MULTIPLE_RESPONSE',
    'MULTIPLE_ANSWER',
  ],
  label: 'Choice',
  usesGlobalOptions: true,
  components: {
    editor: ChoiceEditor,
    answer: ChoiceAnswer,
    report: null,
  },
  createDefaultConfig() {
    return {};
  },
  createDefaultCorrectAnswerData({ questionType, correctAnswer } = {}) {
    return normalizeChoiceAnswerData(correctAnswer, { questionType });
  },
  normalizeQuestion(question = {}) {
    const questionType = normalizeChoiceQuestionType(question.questionType || question.type);

    return {
      ...question,
      questionType,
      options: parseOptions(question.options),
      questionConfig: parseJsonObject(question.questionConfig),
      correctAnswerData: normalizeChoiceQuestionAnswerData(question, questionType),
      validationRules: parseJsonObject(question.validationRules),
      scoringRules: parseJsonObject(question.scoringRules),
    };
  },
  normalizeAnswerData(rawAnswer, context = {}) {
    const questionType = context.questionType || context.question?.questionType;
    return normalizeChoiceAnswerData(rawAnswer, { questionType });
  },
  formatReportAnswer({ answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    return formatChoiceAnswer(answerData ?? selectedAnswer, emptyText);
  },
};

export default choiceQuestionTypeDefinition;
