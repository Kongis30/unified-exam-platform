import choiceQuestionTypeDefinition from './choice';
import dragAndDropQuestionTypeDefinition from './dragAndDrop';
import equationEditorQuestionTypeDefinition from './equationEditor';
import graphQuestionTypeDefinition from './graphQuestion';
import hotSpotQuestionTypeDefinition from './hotSpot';
import hotTextQuestionTypeDefinition from './hotText';
import inlineChoiceQuestionTypeDefinition from './inlineChoice';
import { registerQuestionTypes } from './registry';
import solutionSetQuestionTypeDefinition from './solutionSet';
import tableGridQuestionTypeDefinition from './tableGrid/tableGrid';

registerQuestionTypes([
  choiceQuestionTypeDefinition,
  dragAndDropQuestionTypeDefinition,
  equationEditorQuestionTypeDefinition,
  graphQuestionTypeDefinition,
  hotSpotQuestionTypeDefinition,
  hotTextQuestionTypeDefinition,
  inlineChoiceQuestionTypeDefinition,
  solutionSetQuestionTypeDefinition,
  tableGridQuestionTypeDefinition,
]);

export {
  clearQuestionTypeRegistry,
  fallbackQuestionTypeDefinition,
  getQuestionTypeDefinition,
  hasQuestionTypeDefinition,
  listQuestionTypeDefinitions,
  registerQuestionType,
  registerQuestionTypes,
} from './registry';

export {
  getQuestionTypeLabel,
  isChoiceLikeQuestion,
  isComplexType,
  isMultiSelectType,
  normalizeAnswerList,
  normalizeAnswerToken,
  normalizeMap,
  normalizeOption,
  normalizeQuestionType,
  parseJson,
  parseJsonObject,
  parseOptions,
  questionTypeHelpers,
  typeMatches,
} from './utils';

export {
  GRAPH_POINT_MODE,
  GRAPH_QUESTION_TYPE,
  GRAPH_SELECT_POINTS_MODE,
  createDefaultGraphSelectPointsConfig,
  createDefaultGraphSelectPointsCorrectAnswerData,
  formatGraphPoints,
  getGraphSelectPointsValidationIssues,
  normalizeGraphAnswerPoints,
  normalizeGraphConfig,
  normalizeSelectedPointIds,
} from './graphQuestion';

export {
  INLINE_CHOICE_TYPE,
  createDefaultInlineChoiceConfig,
  createDefaultInlineChoiceCorrectAnswerData,
  createInlineChoicePlaceholder,
  ensureInlineText,
  findInlineTextBlankIds,
  formatInlineChoiceAnswerMap,
  getInlineChoiceValidationIssues,
  normalizeInlineChoiceAnswerMap,
  normalizeInlineChoiceBlank,
  normalizeInlineChoiceBlanks,
  normalizeInlineChoiceConfig,
  normalizeInlineChoiceOptions,
  parseInlineTextParts,
} from './inlineChoice';

export {
  choiceQuestionTypeDefinition,
  dragAndDropQuestionTypeDefinition,
  equationEditorQuestionTypeDefinition,
  graphQuestionTypeDefinition,
  hotSpotQuestionTypeDefinition,
  hotTextQuestionTypeDefinition,
  inlineChoiceQuestionTypeDefinition,
  solutionSetQuestionTypeDefinition,
  tableGridQuestionTypeDefinition,
};

export {
  DRAG_AND_DROP_TYPE,
  TARGET_SORT_MODE,
  createDefaultDragAndDropConfig,
  createDefaultDragAndDropCorrectAnswerData,
  normalizeDragAndDropPlacements,
} from './dragAndDrop';

export {
  NUMBER_LINE_RAY_MODE,
  SOLUTION_SET_TYPE,
  createDefaultSolutionSetConfig,
  createDefaultSolutionSetCorrectAnswerData,
  normalizeSolutionSetAnswerData,
  normalizeSolutionSetConfig,
} from './solutionSet';
