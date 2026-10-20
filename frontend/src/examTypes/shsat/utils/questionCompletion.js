import {
  normalizeDragAndDropConfig,
  normalizeDragAndDropPlacements,
} from '@shsat/questionTypes/dragAndDrop/helpers';
import {
  normalizeEquationAnswerData,
} from '@shsat/questionTypes/equationEditor/helpers';
import {
  GRAPH_SELECT_POINTS_MODE,
  normalizeGraphAnswerPoints,
  normalizeGraphConfig,
  normalizeSelectedPointIds,
} from '@shsat/questionTypes/graphQuestion/helpers';
import {
  normalizeHotSpotAnswerData,
  normalizeHotSpotConfig,
} from '@shsat/questionTypes/hotSpot/helpers';
import {
  normalizeHotTextAnswerData,
  normalizeHotTextConfig,
} from '@shsat/questionTypes/hotText/helpers';
import {
  normalizeInlineChoiceAnswerMap,
  normalizeInlineChoiceConfig,
} from '@shsat/questionTypes/inlineChoice/helpers';
import {
  normalizeSolutionSetAnswerData,
  normalizeSolutionSetConfig,
} from '@shsat/questionTypes/solutionSet/helpers';
import {
  TABLE_GRID_TEXT_MODE,
  normalizeTableGridAnswerMap,
  normalizeTableGridColumnIds,
  normalizeTableGridItems,
  normalizeTableGridMode,
  normalizeTableGridTextCellMap,
} from '@shsat/questionTypes/tableGrid/helpers';
import {
  isMultiSelectType,
  normalizeAnswerList,
  normalizeQuestionType,
} from '@shsat/questionTypes/utils';

function firstPositiveInteger(values = []) {
  return values.map((value) => Number(value)).find((value) => Number.isInteger(value) && value > 0) || null;
}

function selectionRequirement(question = {}) {
  return firstPositiveInteger([
    question.selectionLimit,
    question.questionConfig?.requiredSelections,
    question.questionConfig?.exactSelections,
    question.questionConfig?.selectCount,
    question.questionConfig?.selectionCount,
    question.questionConfig?.maxSelections,
    question.questionConfig?.maxSelected,
    question.scoringRules?.requiredSelections,
    question.scoringRules?.exactSelections,
    question.scoringRules?.selectCount,
    question.scoringRules?.selectionCount,
    question.scoringRules?.maxSelections,
    question.scoringRules?.maxSelected,
  ]);
}

function exactSelectionRequirement(question = {}) {
  // Only treat explicit "select exactly N" fields as an exact requirement. `selectionLimit`
  // is deliberately excluded: the exam page injects it from `maxSelections` (an upper bound),
  // so counting it here would wrongly force a "select up to N" question to require exactly N.
  return firstPositiveInteger([
    question.questionConfig?.requiredSelections,
    question.questionConfig?.exactSelections,
    question.questionConfig?.selectCount,
    question.questionConfig?.selectionCount,
    question.scoringRules?.requiredSelections,
    question.scoringRules?.exactSelections,
    question.scoringRules?.selectCount,
    question.scoringRules?.selectionCount,
  ]);
}

function answerValueComplete(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(answerValueComplete);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(answerValueComplete);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'boolean') {
    return true;
  }
  return String(value).trim().length > 0;
}

function hasFilledString(value) {
  return String(value ?? '').trim().length > 0;
}

function completeChoice(question, answerValue) {
  const answers = normalizeAnswerList(answerValue);
  const type = normalizeQuestionType(question.questionType, '');

  if (type.includes('MULTI_SELECT_FIXED')) {
    const requiredCount = selectionRequirement(question) || 1;
    return answers.length === requiredCount;
  }
  if (isMultiSelectType(type)) {
    return answers.length > 0;
  }

  return answers.length === 1;
}

function completeFillInBlank(question, answerValue) {
  const scalarAnswer = answerValue && typeof answerValue === 'object' && !Array.isArray(answerValue)
    ? answerValue.value
    : answerValue;
  if (hasFilledString(scalarAnswer)) {
    return true;
  }

  const blanks = question.questionConfig?.blanks || question.inlineChoices || [];
  if (Array.isArray(blanks) && blanks.length > 0) {
    const data = answerValue && typeof answerValue === 'object' && !Array.isArray(answerValue)
      ? (answerValue.answers || answerValue.values || answerValue)
      : {};
    return blanks.every((blank, index) => hasFilledString(data[blank.id || blank.key || `blank${index + 1}`]));
  }

  return hasFilledString(answerValue?.value ?? answerValue);
}

function completeInlineChoice(question, answerValue) {
  const config = normalizeInlineChoiceConfig(question.questionConfig, question.options);
  const answerMap = normalizeInlineChoiceAnswerMap(answerValue, config.blanks);
  return config.blanks.length > 0 && config.blanks.every((blank) => hasFilledString(answerMap[blank.id]));
}

function completeDragAndDrop(question, answerValue) {
  const config = normalizeDragAndDropConfig(question.questionConfig);
  const placements = normalizeDragAndDropPlacements(answerValue, config);
  const placedChoiceIds = Object.values(placements).flat().filter(Boolean);

  if (config.mode === 'target_sort') {
    const required = dragAndDropSortRequirement(question, config);
    return required.choiceCount > 0
      && placedChoiceIds.length >= required.choiceCount
      && required.targetIds.every((targetId) => placements[targetId]?.length > 0);
  }

  const requiredTargetIds = dragAndDropRequiredTargetIds(question, config);
  return requiredTargetIds.length > 0 && requiredTargetIds.every((targetId) => placements[targetId]?.length > 0);
}

function dragAndDropCorrectPlacements(question, config) {
  return normalizeDragAndDropPlacements(question.correctAnswerData || question.correctAnswer, config);
}

function dragAndDropRequiredTargetIds(question, config) {
  const correctPlacements = dragAndDropCorrectPlacements(question, config);
  const targetIds = Object.entries(correctPlacements)
    .filter(([, choiceIds]) => choiceIds.length > 0)
    .map(([targetId]) => targetId);

  return targetIds.length ? targetIds : config.targets.map((target) => target.id);
}

function dragAndDropSortRequirement(question, config) {
  const correctPlacements = dragAndDropCorrectPlacements(question, config);
  const correctChoiceCount = Object.values(correctPlacements).flat().length;
  const targetIds = Object.entries(correctPlacements)
    .filter(([, choiceIds]) => choiceIds.length > 0)
    .map(([targetId]) => targetId);

  return {
    choiceCount: correctChoiceCount || config.choices.length,
    targetIds,
  };
}

function completeHotText(question, answerValue) {
  const config = normalizeHotTextConfig(question.questionConfig);
  return normalizeHotTextAnswerData(answerValue, config).length > 0;
}

function completeHotSpot(question, answerValue) {
  const config = normalizeHotSpotConfig(question.questionConfig);
  const requiredCount = config.selectionMode === 'single' ? 1 : exactSelectionRequirement(question);
  const selections = normalizeHotSpotAnswerData(answerValue, config);
  return requiredCount ? selections.length === requiredCount : selections.length > 0;
}

function completeTableGrid(question, answerValue) {
  const mode = normalizeTableGridMode(question.questionConfig);
  const rows = question.tableRows || normalizeTableGridItems(question.questionConfig?.rows, 'row');
  const columns = question.tableColumns || normalizeTableGridItems(question.questionConfig?.columns, 'column');

  if (mode === TABLE_GRID_TEXT_MODE) {
    const cells = normalizeTableGridTextCellMap(question, answerValue);
    return rows.length > 0
      && columns.length > 0
      && rows.every((row) => columns.every((column) => hasFilledString(cells[`${row.id}.${column.id}`])));
  }

  const answerMap = normalizeTableGridAnswerMap(question, answerValue);
  return rows.length > 0 && rows.every((row) => normalizeTableGridColumnIds(answerMap[row.id], columns).length > 0);
}

function completeGraphQuestion(question, answerValue) {
  const config = normalizeGraphConfig(question.questionConfig);
  if (config.graphMode === GRAPH_SELECT_POINTS_MODE) {
    return normalizeSelectedPointIds(answerValue, config.points).length > 0;
  }

  // Point Graph only needs at least one plotted point to be considered answered;
  // the scoring flow decides whether the selected coordinate set is correct.
  return normalizeGraphAnswerPoints(answerValue, config).length > 0;
}

function completeEquationEditor(answerValue) {
  return hasFilledString(normalizeEquationAnswerData(answerValue));
}

function completeSolutionSet(question, answerValue) {
  const config = normalizeSolutionSetConfig(question.questionConfig);
  const solution = normalizeSolutionSetAnswerData(answerValue, config).solution;
  return Boolean(solution?.direction && Number.isFinite(solution.endpoint));
}

export function isQuestionComplete(question = {}, answerValue = '') {
  const type = normalizeQuestionType(question.questionType, '');

  if (type.includes('INLINE_CHOICE')) {
    return completeInlineChoice(question, answerValue);
  }
  if (type.includes('DRAG_AND_DROP')) {
    return completeDragAndDrop(question, answerValue);
  }
  if (type.includes('HOT_TEXT')) {
    return completeHotText(question, answerValue);
  }
  if (type.includes('HOT_SPOT')) {
    return completeHotSpot(question, answerValue);
  }
  if (type.includes('TABLE_GRID')) {
    return completeTableGrid(question, answerValue);
  }
  if (type.includes('GRAPH')) {
    return completeGraphQuestion(question, answerValue);
  }
  if (type.includes('EQUATION')) {
    return completeEquationEditor(answerValue);
  }
  if (type.includes('SOLUTION_SET')) {
    return completeSolutionSet(question, answerValue);
  }
  if (type.includes('MULTI_SELECT')) {
    return completeChoice(question, answerValue);
  }
  if (type === 'MULTIPLE_CHOICE' || type === 'SINGLE_CHOICE' || type === 'CHOICE') {
    return completeChoice(question, answerValue);
  }
  if (type.includes('FILL_IN_BLANK') || type.includes('FILL') || type.includes('BLANK') || type === 'TEXT' || type.includes('SHORT')) {
    return completeFillInBlank(question, answerValue);
  }

  return answerValueComplete(answerValue);
}

export function getQuestionCompletionIssue(question = {}, answerValue = '') {
  if (isQuestionComplete(question, answerValue)) {
    return '';
  }

  const type = normalizeQuestionType(question.questionType, '');
  if (type.includes('MULTI_SELECT_FIXED')) {
    const requiredCount = selectionRequirement(question) || 1;
    return `Select exactly ${requiredCount} answer choices.`;
  }
  if (type.includes('INLINE_CHOICE')) {
    return 'Answer every dropdown before continuing.';
  }
  if (type.includes('DRAG_AND_DROP')) {
    return 'Place every required answer choice before continuing.';
  }
  if (type.includes('TABLE_GRID')) {
    return 'Complete every required table row before continuing.';
  }
  if (type.includes('GRAPH')) {
    return 'Plot the required point before continuing.';
  }
  if (type.includes('SOLUTION_SET')) {
    return 'Choose the ray and endpoint before continuing.';
  }

  return 'Answer this question before continuing.';
}

export default {
  isQuestionComplete,
  getQuestionCompletionIssue,
};
