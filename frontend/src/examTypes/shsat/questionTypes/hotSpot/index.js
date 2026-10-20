import HotSpotAnswer from './HotSpotAnswer.vue';
import HotSpotEditor from './HotSpotEditor.vue';
import HotSpotReport from './HotSpotReport.vue';
import {
  HOT_SPOT_TYPE,
  createDefaultHotSpotConfig,
  createDefaultHotSpotCorrectAnswerData,
  formatHotSpotSelection,
  getHotSpotValidationIssues,
  normalizeHotSpotAnswerData,
  normalizeHotSpotConfig,
} from './helpers';

export const hotSpotQuestionTypeDefinition = {
  type: HOT_SPOT_TYPE,
  aliases: [HOT_SPOT_TYPE],
  label: 'Hot Spot',
  usesGlobalOptions: false,
  components: {
    editor: HotSpotEditor,
    answer: HotSpotAnswer,
    report: HotSpotReport,
  },
  createDefaultConfig: createDefaultHotSpotConfig,
  createDefaultCorrectAnswerData: createDefaultHotSpotCorrectAnswerData,
  normalizeQuestion(question = {}) {
    const questionConfig = normalizeHotSpotConfig(question.questionConfig);
    return {
      ...question,
      options: [],
      questionConfig,
      correctAnswerData: {
        selectedRegionIds: normalizeHotSpotAnswerData(question.correctAnswerData, questionConfig),
      },
    };
  },
  normalizeAnswerData(rawAnswer, { question } = {}) {
    const questionConfig = normalizeHotSpotConfig(question?.questionConfig);
    return {
      selectedRegionIds: normalizeHotSpotAnswerData(rawAnswer, questionConfig),
    };
  },
  validateQuestion(question = {}) {
    return getHotSpotValidationIssues(question);
  },
  formatReportAnswer({ question, answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    const questionConfig = normalizeHotSpotConfig(question?.questionConfig);
    return formatHotSpotSelection(
      normalizeHotSpotAnswerData(answerData ?? selectedAnswer, questionConfig),
      questionConfig,
      emptyText
    );
  },
};

export {
  HOT_SPOT_TYPE,
  createDefaultHotSpotConfig,
  createDefaultHotSpotCorrectAnswerData,
  getHotSpotValidationIssues,
  normalizeHotSpotAnswerData,
  normalizeHotSpotConfig,
};

export default hotSpotQuestionTypeDefinition;
