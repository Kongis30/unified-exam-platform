import DragAndDropAnswer from './DragAndDropAnswer.vue';
import DragAndDropEditor from './DragAndDropEditor.vue';
import DragAndDropReport from './DragAndDropReport.vue';
import {
  DRAG_AND_DROP_TYPE,
  TARGET_SORT_MODE,
  createDefaultDragAndDropConfig,
  createDefaultDragAndDropCorrectAnswerData,
  formatDragAndDropMatches,
  getDragAndDropValidationIssues,
  normalizeDragAndDropAnswerData,
  normalizeDragAndDropConfig,
  normalizeDragAndDropMatches,
  normalizeDragAndDropPlacements,
} from './helpers';

export const dragAndDropQuestionTypeDefinition = {
  type: DRAG_AND_DROP_TYPE,
  aliases: [DRAG_AND_DROP_TYPE],
  label: 'Drag and Drop',
  usesGlobalOptions: false,
  components: {
    editor: DragAndDropEditor,
    answer: DragAndDropAnswer,
    report: DragAndDropReport,
  },
  createDefaultConfig: createDefaultDragAndDropConfig,
  createDefaultCorrectAnswerData: createDefaultDragAndDropCorrectAnswerData,
  normalizeQuestion(question = {}) {
    const questionConfig = normalizeDragAndDropConfig(question.questionConfig);
    return {
      ...question,
      options: [],
      questionConfig,
      correctAnswerData: {
        placements: normalizeDragAndDropPlacements(question.correctAnswerData, questionConfig),
      },
    };
  },
  normalizeAnswerData(rawAnswer, { question } = {}) {
    const questionConfig = normalizeDragAndDropConfig(question?.questionConfig);
    return {
      placements: normalizeDragAndDropAnswerData(rawAnswer, questionConfig),
    };
  },
  validateQuestion(question = {}) {
    return getDragAndDropValidationIssues(question);
  },
  formatReportAnswer({ question, answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    const questionConfig = normalizeDragAndDropConfig(question?.questionConfig);
    return formatDragAndDropMatches(
      normalizeDragAndDropPlacements(answerData ?? selectedAnswer, questionConfig),
      questionConfig,
      emptyText
    );
  },
};

export {
  DRAG_AND_DROP_TYPE,
  TARGET_SORT_MODE,
  createDefaultDragAndDropConfig,
  createDefaultDragAndDropCorrectAnswerData,
  getDragAndDropValidationIssues,
  normalizeDragAndDropAnswerData,
  normalizeDragAndDropConfig,
  normalizeDragAndDropMatches,
  normalizeDragAndDropPlacements,
};

export default dragAndDropQuestionTypeDefinition;
