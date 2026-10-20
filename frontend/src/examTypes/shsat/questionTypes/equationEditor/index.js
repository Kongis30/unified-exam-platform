import EquationEditorAnswer from './EquationEditorAnswer.vue';
import EquationEditorEditor from './EquationEditorEditor.vue';
import EquationEditorReport from './EquationEditorReport.vue';
import {
  EQUATION_EDITOR_TYPE,
  createDefaultEquationConfig,
  createDefaultEquationCorrectAnswerData,
  formatEquationAnswer,
  getEquationValidationIssues,
  normalizeAcceptedAnswers,
  normalizeEquationAnswerData,
  normalizeEquationConfig,
} from './helpers';

export const equationEditorQuestionTypeDefinition = {
  type: EQUATION_EDITOR_TYPE,
  aliases: [EQUATION_EDITOR_TYPE],
  label: 'Equation Editor',
  usesGlobalOptions: false,
  components: {
    editor: EquationEditorEditor,
    answer: EquationEditorAnswer,
    report: EquationEditorReport,
  },
  createDefaultConfig: createDefaultEquationConfig,
  createDefaultCorrectAnswerData: createDefaultEquationCorrectAnswerData,
  normalizeQuestion(question = {}) {
    return {
      ...question,
      options: [],
      questionConfig: normalizeEquationConfig(question.questionConfig),
      correctAnswerData: {
        acceptedAnswers: normalizeAcceptedAnswers(question.correctAnswerData),
      },
    };
  },
  normalizeAnswerData(rawAnswer) {
    return { value: normalizeEquationAnswerData(rawAnswer) };
  },
  validateQuestion(question = {}) {
    return getEquationValidationIssues(question);
  },
  formatReportAnswer({ answerData, selectedAnswer, emptyText = 'Not answered' } = {}) {
    return formatEquationAnswer(answerData ?? selectedAnswer, emptyText);
  },
};

export {
  EQUATION_EDITOR_TYPE,
  createDefaultEquationConfig,
  createDefaultEquationCorrectAnswerData,
  getEquationValidationIssues,
  normalizeAcceptedAnswers,
  normalizeEquationAnswerData,
  normalizeEquationConfig,
};

export default equationEditorQuestionTypeDefinition;
