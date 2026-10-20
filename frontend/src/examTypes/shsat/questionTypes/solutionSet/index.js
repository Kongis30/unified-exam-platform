import SolutionSetAnswer from './SolutionSetAnswer.vue';
import SolutionSetEditor from './SolutionSetEditor.vue';
import SolutionSetReport from './SolutionSetReport.vue';
import {
  NUMBER_LINE_RAY_MODE,
  SOLUTION_SET_TYPE,
  createDefaultSolutionSetConfig,
  createDefaultSolutionSetCorrectAnswerData,
  formatSolutionSetAnswer,
  getSolutionSetValidationIssues,
  normalizeSolutionSetAnswerData,
  normalizeSolutionSetConfig,
} from './helpers';

export const solutionSetQuestionTypeDefinition = {
  type: SOLUTION_SET_TYPE,
  aliases: [SOLUTION_SET_TYPE],
  label: 'Solution Set',
  usesGlobalOptions: false,
  components: {
    editor: SolutionSetEditor,
    answer: SolutionSetAnswer,
    report: SolutionSetReport,
  },
  createDefaultConfig: createDefaultSolutionSetConfig,
  createDefaultCorrectAnswerData: createDefaultSolutionSetCorrectAnswerData,
  normalizeQuestion(question = {}) {
    const questionConfig = normalizeSolutionSetConfig(question.questionConfig);
    return {
      ...question,
      options: [],
      questionConfig,
      correctAnswerData: normalizeSolutionSetAnswerData(question.correctAnswerData, questionConfig),
    };
  },
  normalizeAnswerData(rawAnswer, { question } = {}) {
    const questionConfig = normalizeSolutionSetConfig(question?.questionConfig);
    return normalizeSolutionSetAnswerData(rawAnswer, questionConfig);
  },
  validateQuestion(question = {}) {
    return getSolutionSetValidationIssues(question);
  },
  formatReportAnswer({ question, answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    const questionConfig = normalizeSolutionSetConfig(question?.questionConfig);
    return formatSolutionSetAnswer(answerData ?? selectedAnswer, questionConfig, emptyText);
  },
};

export {
  NUMBER_LINE_RAY_MODE,
  SOLUTION_SET_TYPE,
  createDefaultSolutionSetConfig,
  createDefaultSolutionSetCorrectAnswerData,
  formatSolutionSetAnswer,
  getSolutionSetValidationIssues,
  normalizeSolutionSetAnswerData,
  normalizeSolutionSetConfig,
};

export default solutionSetQuestionTypeDefinition;
