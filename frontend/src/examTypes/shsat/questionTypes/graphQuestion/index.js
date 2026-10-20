import GraphSelectPointsAnswer from './GraphSelectPointsAnswer.vue';
import GraphSelectPointsEditor from './GraphSelectPointsEditor.vue';
import GraphSelectPointsReport from './GraphSelectPointsReport.vue';
import {
  GRAPH_SELECT_POINTS_MODE,
  GRAPH_POINT_MODE,
  createDefaultGraphSelectPointsConfig,
  createDefaultGraphSelectPointsCorrectAnswerData,
  formatGraphPoints,
  formatSelectedPoints,
  getGraphSelectPointsValidationIssues,
  normalizeGraphAnswerPoints,
  normalizeGraphConfig,
  normalizeSelectedPointIds,
} from './helpers';

import { parseJsonObject } from '../utils';

export const GRAPH_QUESTION_TYPE = 'GRAPH_QUESTION';

export const graphQuestionTypeDefinition = {
  type: GRAPH_QUESTION_TYPE,
  aliases: [GRAPH_QUESTION_TYPE],
  label: 'Point Graph',
  usesGlobalOptions: false,
  components: {
    editor: GraphSelectPointsEditor,
    answer: GraphSelectPointsAnswer,
    report: GraphSelectPointsReport,
  },
  createDefaultConfig: createDefaultGraphSelectPointsConfig,
  createDefaultCorrectAnswerData: createDefaultGraphSelectPointsCorrectAnswerData,
  normalizeQuestion(question = {}) {
    const questionConfig = normalizeGraphConfig(question.questionConfig);
    const correctAnswerData = parseJsonObject(
      question.correctAnswerData,
      createDefaultGraphSelectPointsCorrectAnswerData()
    );
    const normalizedCorrectAnswerData = questionConfig.graphMode === GRAPH_SELECT_POINTS_MODE
      ? { selectedPointIds: normalizeSelectedPointIds(correctAnswerData, questionConfig.points) }
      : { points: normalizeGraphAnswerPoints(correctAnswerData, questionConfig) };

    return {
      ...question,
      options: [],
      questionConfig,
      graphConfig: questionConfig.graph,
      correctAnswerData: normalizedCorrectAnswerData,
    };
  },
  normalizeAnswerData(rawAnswer, { question } = {}) {
    const questionConfig = normalizeGraphConfig(question?.questionConfig);
    return questionConfig.graphMode === GRAPH_SELECT_POINTS_MODE
      ? { selectedPointIds: normalizeSelectedPointIds(rawAnswer, questionConfig.points) }
      : { points: normalizeGraphAnswerPoints(rawAnswer, questionConfig) };
  },
  validateQuestion(question = {}) {
    return getGraphSelectPointsValidationIssues(question);
  },
  formatReportAnswer({ question, answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    const questionConfig = normalizeGraphConfig(question?.questionConfig);
    return questionConfig.graphMode === GRAPH_SELECT_POINTS_MODE
      ? formatSelectedPoints(
          normalizeSelectedPointIds(answerData ?? selectedAnswer, questionConfig.points),
          questionConfig.points,
          emptyText
        )
      : formatGraphPoints(normalizeGraphAnswerPoints(answerData ?? selectedAnswer, questionConfig), emptyText);
  },
};

export {
  GRAPH_POINT_MODE,
  GRAPH_SELECT_POINTS_MODE,
  createDefaultGraphSelectPointsConfig,
  createDefaultGraphSelectPointsCorrectAnswerData,
  formatGraphPoints,
  formatSelectedPoints,
  getGraphSelectPointsValidationIssues,
  normalizeGraphAnswerPoints,
  normalizeGraphConfig,
  normalizeSelectedPointIds,
};

export default graphQuestionTypeDefinition;
