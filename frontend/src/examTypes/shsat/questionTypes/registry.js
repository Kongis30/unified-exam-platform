import fallbackQuestionTypeDefinition from './fallback';
import { normalizeQuestionType, typeMatches } from './utils';

const registeredDefinitions = new Map();

function normalizeDefinition(definition) {
  if (!definition?.type) {
    throw new Error('Question type definition must include a type.');
  }

  const type = normalizeQuestionType(definition.type);
  const aliases = Array.isArray(definition.aliases)
    ? definition.aliases.map((alias) => normalizeQuestionType(alias)).filter(Boolean)
    : [];

  return {
    label: type,
    usesGlobalOptions: false,
    migrated: true,
    components: {
      editor: null,
      answer: null,
      report: null,
      ...(definition.components || {}),
    },
    createDefaultConfig: () => ({}),
    createDefaultCorrectAnswerData: () => ({ answers: [] }),
    normalizeQuestion: (question) => question,
    normalizeAnswerData: (answerData) => answerData,
    validateQuestion: () => [],
    formatReportAnswer: () => '',
    ...definition,
    type,
    aliases,
  };
}

function createFallbackDefinition(questionType) {
  const normalizedType = normalizeQuestionType(questionType || fallbackQuestionTypeDefinition.type);

  return {
    ...fallbackQuestionTypeDefinition,
    type: normalizedType,
    label: normalizedType === fallbackQuestionTypeDefinition.type
      ? fallbackQuestionTypeDefinition.label
      : normalizedType,
  };
}

export function registerQuestionType(definition) {
  const normalizedDefinition = normalizeDefinition(definition);
  registeredDefinitions.set(normalizedDefinition.type, normalizedDefinition);
  return normalizedDefinition;
}

export function registerQuestionTypes(definitions = []) {
  return definitions.map(registerQuestionType);
}

export function getQuestionTypeDefinition(questionType) {
  const normalizedType = normalizeQuestionType(questionType, '');
  if (!normalizedType) {
    return createFallbackDefinition();
  }

  const exactDefinition = registeredDefinitions.get(normalizedType);
  if (exactDefinition) {
    return exactDefinition;
  }

  const aliasDefinition = [...registeredDefinitions.values()]
    .find((definition) => typeMatches(normalizedType, definition.type, definition.aliases));

  return aliasDefinition || createFallbackDefinition(normalizedType);
}

export function hasQuestionTypeDefinition(questionType) {
  const definition = getQuestionTypeDefinition(questionType);
  return definition.migrated === true;
}

export function listQuestionTypeDefinitions() {
  return [...registeredDefinitions.values()];
}

export function clearQuestionTypeRegistry() {
  registeredDefinitions.clear();
}

export { fallbackQuestionTypeDefinition };

export default {
  registerQuestionType,
  registerQuestionTypes,
  getQuestionTypeDefinition,
  hasQuestionTypeDefinition,
  listQuestionTypeDefinitions,
  clearQuestionTypeRegistry,
  fallbackQuestionTypeDefinition,
};
