import TableGridAnswer from './TableGridAnswer.vue';
import TableGridEditor from './TableGridEditor.vue';
import TableGridReport from './TableGridReport.vue';
import {
  TABLE_GRID_TEXT_MODE,
  formatTableGridAnswerMap,
  formatTableGridTextCellMap,
  getTableGridValidationIssues,
  normalizeTableGridAnswerMap,
  normalizeTableGridItems,
  normalizeTableGridMode,
  normalizeTableGridTextCellMap,
} from './helpers';

import { parseJsonObject } from '../utils';

export const TABLE_GRID_TYPE = 'TABLE_GRID';

export function createDefaultTableGridConfig() {
  return {
    rows: [{ id: 'row1', label: 'Row 1' }],
    columns: [{ id: 'col1', label: 'Column 1' }],
  };
}

export function createDefaultTableGridCorrectAnswerData() {
  return { cells: { row1: 'col1' } };
}

export const tableGridQuestionTypeDefinition = {
  type: TABLE_GRID_TYPE,
  aliases: [TABLE_GRID_TYPE],
  label: 'Table Grid',
  usesGlobalOptions: false,
  components: {
    editor: TableGridEditor,
    answer: TableGridAnswer,
    report: TableGridReport,
  },
  createDefaultConfig: createDefaultTableGridConfig,
  createDefaultCorrectAnswerData: createDefaultTableGridCorrectAnswerData,
  normalizeQuestion(question = {}) {
    const questionConfig = parseJsonObject(question.questionConfig, createDefaultTableGridConfig());

    return {
      ...question,
      questionConfig,
      tableRows: normalizeTableGridItems(questionConfig.rows, 'row'),
      tableColumns: normalizeTableGridItems(questionConfig.columns, 'column'),
      correctAnswerData: parseJsonObject(question.correctAnswerData, createDefaultTableGridCorrectAnswerData()),
    };
  },
  normalizeAnswerData(rawAnswer, { question } = {}) {
    // Text mode persists free-text cells; choice/single/multi modes persist a row->column map.
    if (normalizeTableGridMode(question?.questionConfig) === TABLE_GRID_TEXT_MODE) {
      return {
        cells: normalizeTableGridTextCellMap(question, rawAnswer),
      };
    }
    return {
      answers: normalizeTableGridAnswerMap(question, rawAnswer),
    };
  },
  validateQuestion(question = {}) {
    return getTableGridValidationIssues(question);
  },
  formatReportAnswer({ question, answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    if (normalizeTableGridMode(question?.questionConfig) === TABLE_GRID_TEXT_MODE) {
      return formatTableGridTextCellMap(
        normalizeTableGridTextCellMap(question, answerData ?? selectedAnswer),
        emptyText,
        question
      );
    }
    return formatTableGridAnswerMap(
      normalizeTableGridAnswerMap(question, answerData ?? selectedAnswer),
      emptyText,
      question
    );
  },
};

export default tableGridQuestionTypeDefinition;
