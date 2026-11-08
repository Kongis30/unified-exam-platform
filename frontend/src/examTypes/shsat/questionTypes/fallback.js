import {
  isMultiSelectType,
  normalizeAnswerList,
  normalizeAnswerToken,
  normalizeQuestionType,
  parseJsonObject,
  parseOptions,
} from './utils';

function createLegacyCorrectAnswerData(correctAnswer, questionType) {
  const answers = normalizeAnswerList(correctAnswer);
  return isAcceptedAnswerListType(questionType) ? { answers } : { answers: answers.slice(0, 1) };
}

function isAcceptedAnswerListType(questionType) {
  return normalizeQuestionType(questionType, '') === 'FILL_IN_BLANK' || isMultiSelectType(questionType);
}

function normalizeCorrectAnswerData(correctAnswerData, questionType, correctAnswer) {
  const parsed = parseJsonObject(correctAnswerData, null);
  if (normalizeQuestionType(questionType, '') !== 'FILL_IN_BLANK') {
    return parsed || createLegacyCorrectAnswerData(correctAnswer, questionType);
  }

  const answers = normalizeAnswerList(parsed || correctAnswerData);
  if (answers.length > 0) {
    return { answers };
  }
  return createLegacyCorrectAnswerData(correctAnswer, questionType);
}

function formatAnswerValue(value, emptyText) {
  if (value === null || value === undefined || value === '') {
    return emptyText;
  }

  const parsedObject = parseJsonObject(value, null);
  if (parsedObject) {
    const answers = normalizeAnswerList(parsedObject);
    if (answers.length > 0) {
      return answers.join(', ');
    }
    if (parsedObject.value !== undefined) {
      return normalizeAnswerToken(parsedObject.value) || emptyText;
    }
    return normalizeAnswerToken(parsedObject) || emptyText;
  }

  return String(value).trim() || emptyText;
}

export const fallbackQuestionTypeDefinition = {
  type: 'FALLBACK',
  aliases: [],
  label: 'Unsupported Question Type',
  usesGlobalOptions: true,
  migrated: false,
  components: {
    editor: null,
    answer: null,
    report: null,
  },
  createDefaultConfig() {
    return {};
  },
  createDefaultCorrectAnswerData({ questionType, correctAnswer } = {}) {
    return createLegacyCorrectAnswerData(correctAnswer, questionType);
  },
  normalizeQuestion(question = {}) {
    const questionType = normalizeQuestionType(question.questionType || question.type, 'MULTIPLE_CHOICE');

    // Keep unmigrated questions in their legacy shape while filling shared module fields.
    return {
      ...question,
      questionType,
      options: parseOptions(question.options),
      questionConfig: parseJsonObject(question.questionConfig),
      correctAnswerData: normalizeCorrectAnswerData(question.correctAnswerData, questionType, question.correctAnswer),
      validationRules: parseJsonObject(question.validationRules),
      scoringRules: parseJsonObject(question.scoringRules),
    };
  },
  normalizeAnswerData(rawAnswer, { questionType } = {}) {
    if (rawAnswer && typeof rawAnswer === 'object' && !Array.isArray(rawAnswer)) {
      return rawAnswer;
    }

    if (Array.isArray(rawAnswer) || isAcceptedAnswerListType(questionType)) {
      return { answers: normalizeAnswerList(rawAnswer) };
    }

    const [answer] = normalizeAnswerList(rawAnswer);
    return { answers: answer ? [answer] : [] };
  },
  validateQuestion() {
    return [];
  },
  formatReportAnswer({
    answerData,
    selectedAnswer,
    correctAnswerData,
    answersVisible = false,
    emptyText = 'Not answered',
  } = {}) {
    const primaryValue = answerData ?? selectedAnswer;
    const formattedAnswer = formatAnswerValue(primaryValue, emptyText);

    if (!answersVisible || correctAnswerData === undefined || correctAnswerData === null) {
      return formattedAnswer;
    }

    const formattedCorrectAnswer = formatAnswerValue(correctAnswerData, '');
    return formattedCorrectAnswer
      ? `${formattedAnswer} (Correct: ${formattedCorrectAnswer})`
      : formattedAnswer;
  },
};

export default fallbackQuestionTypeDefinition;
