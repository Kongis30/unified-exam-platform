import { normalizeAnswerToken, parseJson, parseJsonObject } from '../utils';

export const DRAG_AND_DROP_TYPE = 'DRAG_AND_DROP';
export const TARGET_SORT_MODE = 'target_sort';
export const TARGET_MATCH_MODE = 'target_match';
export const INLINE_GAP_MATCH_MODE = 'inline_gap_match';

export function createDefaultDragAndDropConfig() {
  return {
    mode: TARGET_SORT_MODE,
    choices: [
      { id: 'choice1', text: 'One' },
      { id: 'choice2', text: 'Two' },
      { id: 'choice3', text: 'Three' },
      { id: 'choice4', text: 'Four' },
    ],
    targets: [
      { id: 'target1', label: 'Odd Numbers' },
      { id: 'target2', label: 'Even Numbers' },
    ],
    contentParts: [
      { type: 'gap', id: 'target1', label: 'Drop target 1' },
      { type: 'text', text: ' - ' },
      { type: 'gap', id: 'target2', label: 'Drop target 2' },
    ],
  };
}

export function createDefaultDragAndDropCorrectAnswerData() {
  return {
    placements: {
      target1: ['choice1', 'choice3'],
      target2: ['choice2', 'choice4'],
    },
  };
}

export function normalizeDragAndDropConfig(rawConfig) {
  const parsedConfig = parseJsonObject(rawConfig, createDefaultDragAndDropConfig());
  const choices = normalizeChoices(parsedConfig.choices || parsedConfig.items || parsedConfig.dragItems);
  const targets = normalizeTargets(parsedConfig.targets || parsedConfig.zones || parsedConfig.dropZones);
  const mode = [TARGET_SORT_MODE, TARGET_MATCH_MODE, INLINE_GAP_MATCH_MODE].includes(parsedConfig.mode)
    ? parsedConfig.mode
    : TARGET_SORT_MODE;

  return {
    ...parsedConfig,
    mode,
    choices: choices.length ? choices : createDefaultDragAndDropConfig().choices,
    targets: targets.length ? targets : createDefaultDragAndDropConfig().targets,
    contentParts: mode === INLINE_GAP_MATCH_MODE
      ? normalizeContentParts(parsedConfig.contentParts, targets)
      : [],
  };
}

export function normalizeChoices(choices = []) {
  if (!Array.isArray(choices)) {
    return [];
  }

  return uniqueItems(choices, 'choice').map((choice, index) => ({
    id: choice.id,
    text: String(choice.text || choice.label || choice.value || `Choice ${index + 1}`),
  }));
}

export function normalizeTargets(targets = []) {
  if (!Array.isArray(targets)) {
    return [];
  }

  return uniqueItems(targets, 'target').map((target, index) => ({
    id: target.id,
    label: String(target.label || target.text || target.value || `Target ${index + 1}`),
  }));
}

export function normalizeContentParts(parts = [], targets = []) {
  const fallbackParts = targets.map((target) => ({ type: 'gap', id: target.id, label: target.label }));
  const rawParts = Array.isArray(parts) && parts.length ? parts : fallbackParts;
  const targetIds = new Set(targets.map((target) => target.id));

  return rawParts
    .map((part) => {
      if (part?.type === 'gap') {
        const id = normalizeAnswerToken(part.id || part.targetId);
        return {
          type: 'gap',
          id,
          label: String(part.label || targets.find((target) => target.id === id)?.label || id),
        };
      }
      return { type: 'text', text: String(part?.text || '') };
    })
    .filter((part) => part.type === 'text' ? part.text.length > 0 : targetIds.has(part.id));
}

export function normalizeDragAndDropAnswerData(rawData, config = createDefaultDragAndDropConfig()) {
  return normalizeDragAndDropPlacements(rawData, config);
}

export function normalizeDragAndDropPlacements(rawData, config = createDefaultDragAndDropConfig()) {
  const data = parseJson(rawData, rawData);
  const questionConfig = normalizeDragAndDropConfig(config);
  const rawPlacements = data?.placements || data?.groups || data?.targetPlacements;
  const normalized = {};

  if (rawPlacements && typeof rawPlacements === 'object' && !Array.isArray(rawPlacements)) {
    normalizePlacementObject(rawPlacements, questionConfig).forEach(([targetId, choiceIds]) => {
      normalized[targetId] = choiceIds;
    });
    return normalized;
  }

  const rawMatches = data?.matches || data?.answers || data?.selections || {};
  const directMatches = rawMatches && typeof rawMatches === 'object' && !Array.isArray(rawMatches) ? rawMatches : {};
  const targetIds = new Set(questionConfig.targets.map((target) => target.id));
  const choiceIds = new Set(questionConfig.choices.map((choice) => choice.id));

  Object.entries(directMatches).forEach(([rawKey, rawValue]) => {
    const key = normalizeAnswerToken(rawKey);
    const value = normalizeAnswerToken(rawValue);
    if (targetIds.has(key) && choiceIds.has(value)) {
      normalized[key] = [value];
      return;
    }
    // Legacy data stored item -> zone. Convert it to target -> choice.
    if (choiceIds.has(key) && targetIds.has(value)) {
      normalized[value] = [key];
    }
  });

  return normalized;
}

export function normalizeDragAndDropMatches(rawData, config = createDefaultDragAndDropConfig()) {
  const placements = normalizeDragAndDropPlacements(rawData, config);
  return Object.fromEntries(
    Object.entries(placements)
      .filter(([, choiceIds]) => choiceIds.length > 0)
      .map(([targetId, choiceIds]) => [targetId, choiceIds[0]])
  );
}

export function formatDragAndDropMatches(matches = {}, config = createDefaultDragAndDropConfig(), emptyText = 'Not answered') {
  const questionConfig = normalizeDragAndDropConfig(config);
  const entries = Object.entries(matches).filter(([, choiceIds]) => Array.isArray(choiceIds) ? choiceIds.length : choiceIds);
  if (!entries.length) {
    return emptyText;
  }

  return entries.map(([targetId, choiceIds]) => {
    const target = questionConfig.targets.find((candidate) => candidate.id === targetId);
    const ids = Array.isArray(choiceIds) ? choiceIds : [choiceIds];
    const labels = ids
      .map((choiceId) => questionConfig.choices.find((candidate) => candidate.id === choiceId)?.text || choiceId)
      .join(', ');
    return `${target?.label || targetId}: ${labels}`;
  }).join('; ');
}

export function nextChoiceId(choices = []) {
  return nextId(choices, 'choice');
}

export function nextTargetId(targets = []) {
  return nextId(targets, 'target');
}

export function getDragAndDropValidationIssues(question = {}) {
  const config = normalizeDragAndDropConfig(question.questionConfig);
  const placements = normalizeDragAndDropPlacements(question.correctAnswerData, config);
  const issues = [];

  if (!config.choices.length) {
    issues.push('Add at least one answer choice.');
  }
  if (!config.targets.length) {
    issues.push('Add at least one drop target.');
  }
  if (config.mode === INLINE_GAP_MATCH_MODE && !config.contentParts.some((part) => part.type === 'gap')) {
    issues.push('Insert at least one gap into the expression or sentence.');
  }
  if (config.mode === TARGET_SORT_MODE) {
    const placedChoiceIds = Object.values(placements).flat();
    config.choices.forEach((choice) => {
      if (!placedChoiceIds.includes(choice.id)) {
        issues.push(`Place ${choice.text || choice.id} into a correct target.`);
      }
    });
  } else {
    config.targets.forEach((target) => {
      if (!placements[target.id]?.length) {
        issues.push(`Choose the correct answer for ${target.label || target.id}.`);
      }
    });
  }

  const duplicateChoiceIds = findDuplicateValues(Object.values(placements).flat());
  duplicateChoiceIds.forEach((choiceId) => {
    const choice = config.choices.find((candidate) => candidate.id === choiceId);
    issues.push(`${choice?.text || choiceId} can only appear in one correct target.`);
  });

  if (config.mode !== TARGET_SORT_MODE) {
    Object.entries(placements).forEach(([targetId, choiceIds]) => {
      if (choiceIds.length > 1) {
        const target = config.targets.find((candidate) => candidate.id === targetId);
        issues.push(`${target?.label || targetId} can only have one correct card in this layout.`);
      }
    });
  }

  return issues;
}

function normalizePlacementObject(rawPlacements, questionConfig) {
  const targetIds = new Set(questionConfig.targets.map((target) => target.id));
  const choiceIds = new Set(questionConfig.choices.map((choice) => choice.id));
  const usedChoiceIds = new Set();

  return Object.entries(rawPlacements)
    .map(([rawTargetId, rawChoiceIds]) => {
      const targetId = normalizeAnswerToken(rawTargetId);
      const ids = Array.isArray(rawChoiceIds) ? rawChoiceIds : [rawChoiceIds];
      const normalizedChoiceIds = ids
        .map(normalizeAnswerToken)
        .filter((choiceId) => {
          if (!targetIds.has(targetId) || !choiceIds.has(choiceId) || usedChoiceIds.has(choiceId)) {
            return false;
          }
          usedChoiceIds.add(choiceId);
          return true;
        });
      return [targetId, normalizedChoiceIds];
    })
    .filter(([targetId, choiceIds]) => targetIds.has(targetId) && choiceIds.length > 0);
}

function findDuplicateValues(values = []) {
  const seen = new Set();
  const duplicates = new Set();
  values.forEach((value) => {
    if (seen.has(value)) {
      duplicates.add(value);
      return;
    }
    seen.add(value);
  });
  return [...duplicates];
}

function uniqueItems(items = [], prefix) {
  const usedIds = new Set();
  return items.map((item, index) => {
    const preferredId = normalizeAnswerToken(item?.id || item?.key || item?.value) || `${prefix}${index + 1}`;
    const id = uniqueId(preferredId, usedIds);
    usedIds.add(id);
    return { ...item, id };
  });
}

function nextId(items = [], prefix) {
  const usedIds = new Set(items.map((item) => item.id).filter(Boolean));
  let index = usedIds.size + 1;
  while (usedIds.has(`${prefix}${index}`)) {
    index += 1;
  }
  return `${prefix}${index}`;
}

function uniqueId(id, usedIds) {
  if (!usedIds.has(id)) {
    return id;
  }
  let index = 2;
  while (usedIds.has(`${id}_${index}`)) {
    index += 1;
  }
  return `${id}_${index}`;
}
