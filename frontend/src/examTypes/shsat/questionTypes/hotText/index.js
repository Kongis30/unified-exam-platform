import HotTextAnswer from './HotTextAnswer.vue';
import HotTextEditor from './HotTextEditor.vue';
import HotTextReport from './HotTextReport.vue';
import {
  HOT_TEXT_TYPE,
  createDefaultHotTextConfig,
  createDefaultHotTextCorrectAnswerData,
  formatHotTextSelection,
  getHotTextValidationIssues,
  normalizeHotTextAnswerData,
  normalizeHotTextConfig,
} from './helpers';

export const hotTextQuestionTypeDefinition = {
  type: HOT_TEXT_TYPE,
  aliases: [HOT_TEXT_TYPE],
  label: 'Hot Text',
  usesGlobalOptions: false,
  components: {
    editor: HotTextEditor,
    answer: HotTextAnswer,
    report: HotTextReport,
  },
  createDefaultConfig: createDefaultHotTextConfig,
  createDefaultCorrectAnswerData: createDefaultHotTextCorrectAnswerData,
  normalizeQuestion(question = {}) {
    const questionConfig = normalizeHotTextConfig(question.questionConfig);
    return {
      ...question,
      options: [],
      questionConfig,
      correctAnswerData: {
        selectedSegmentIds: normalizeHotTextAnswerData(question.correctAnswerData, questionConfig),
      },
    };
  },
  normalizeAnswerData(rawAnswer, { question } = {}) {
    const questionConfig = normalizeHotTextConfig(question?.questionConfig);
    return {
      selectedSegmentIds: normalizeHotTextAnswerData(rawAnswer, questionConfig),
    };
  },
  validateQuestion(question = {}) {
    return getHotTextValidationIssues(question);
  },
  formatReportAnswer({ question, answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    const questionConfig = normalizeHotTextConfig(question?.questionConfig);
    return formatHotTextSelection(
      normalizeHotTextAnswerData(answerData ?? selectedAnswer, questionConfig),
      questionConfig,
      emptyText
    );
  },
};

export {
  HOT_TEXT_TYPE,
  createDefaultHotTextConfig,
  createDefaultHotTextCorrectAnswerData,
  getHotTextValidationIssues,
  normalizeHotTextAnswerData,
  normalizeHotTextConfig,
};

export default hotTextQuestionTypeDefinition;
