import { normalizeAnswerToken, parseJson, parseJsonObject } from '../utils';

export const HOT_TEXT_TYPE = 'HOT_TEXT';

export function createDefaultHotTextConfig() {
  return {
    selectionMode: 'multi',
    contentParts: [
      { type: 'text', text: 'Read the passage and select the correct text.' },
    ],
  };
}

export function createDefaultHotTextCorrectAnswerData() {
  return { selectedSegmentIds: [] };
}

export function normalizeHotTextConfig(rawConfig) {
  const parsedConfig = parseJsonObject(rawConfig, createDefaultHotTextConfig());
  const legacySegments = Array.isArray(parsedConfig.segments)
    ? parsedConfig.segments.map((segment) => ({
        type: 'segment',
        id: normalizeAnswerToken(segment?.id),
        text: String(segment?.text || ''),
      }))
    : [];
  const rawParts = Array.isArray(parsedConfig.contentParts) ? parsedConfig.contentParts : legacySegments;
  const contentParts = normalizeContentParts(rawParts);

  return {
    ...parsedConfig,
    selectionMode: 'multi',
    contentParts: contentParts.length ? contentParts : createDefaultHotTextConfig().contentParts,
  };
}

export function normalizeContentParts(parts = []) {
  return parts
    .map((part, index) => {
      if (part?.type === 'segment' || part?.selectable === true) {
        return {
          type: 'segment',
          id: normalizeAnswerToken(part.id) || `seg${index + 1}`,
          text: String(part.text || ''),
        };
      }

      return {
        type: 'text',
        text: String(part?.text || ''),
      };
    })
    .filter((part) => part.type === 'segment' || part.text.length > 0);
}

export function normalizeHotTextAnswerData(rawData, config = createDefaultHotTextConfig()) {
  const data = parseJson(rawData, rawData);
  const source = Array.isArray(data)
    ? data
    : data?.selectedSegmentIds || data?.selectedIds || data?.answers || [];
  const validIds = new Set(selectableSegments(config).map((segment) => segment.id));
  const seen = new Set();

  return (Array.isArray(source) ? source : String(source || '').split(/[;,|]/))
    .map(normalizeAnswerToken)
    .filter((id) => id && !seen.has(id) && (!validIds.size || validIds.has(id)) && seen.add(id));
}

export function selectableSegments(config = createDefaultHotTextConfig()) {
  return normalizeHotTextConfig(config).contentParts.filter((part) => part.type === 'segment');
}

export function plainTextFromParts(parts = []) {
  return normalizeContentParts(parts).map((part) => part.text).join('');
}

export function markTextRangeSelectable(parts = [], start = 0, end = 0, id = '') {
  const normalizedParts = normalizeContentParts(parts);
  const rangeStart = Math.max(0, Math.min(start, end));
  const rangeEnd = Math.max(rangeStart, Math.max(start, end));
  const fullText = plainTextFromParts(normalizedParts);
  const selectedText = fullText.slice(rangeStart, rangeEnd);
  let cursor = 0;
  const nextParts = [];
  let insertedSelection = false;

  normalizedParts.forEach((part) => {
    const partStart = cursor;
    const partEnd = cursor + part.text.length;
    cursor = partEnd;

    if (rangeEnd <= partStart || rangeStart >= partEnd) {
      nextParts.push(part);
      return;
    }

    const localStart = Math.max(0, rangeStart - partStart);
    const localEnd = Math.min(part.text.length, rangeEnd - partStart);
    const before = part.text.slice(0, localStart);
    const after = part.text.slice(localEnd);

    if (before) {
      nextParts.push({ type: 'text', text: before });
    }
    if (!insertedSelection && selectedText) {
      // A drag selection should become one answer target, even when it spans
      // multiple existing text parts or previously marked segments.
      nextParts.push({ type: 'segment', id, text: selectedText });
      insertedSelection = true;
    }
    if (after) {
      nextParts.push({ type: 'text', text: after });
    }
  });

  return mergeAdjacentTextParts(nextParts);
}

export function replacePlainText(text = '') {
  return [{ type: 'text', text: String(text) }];
}

export function nextSegmentId(parts = []) {
  const usedIds = new Set(selectableSegments({ contentParts: parts }).map((segment) => segment.id));
  let index = usedIds.size + 1;
  while (usedIds.has(`seg${index}`)) {
    index += 1;
  }
  return `seg${index}`;
}

export function formatHotTextSelection(selectedIds = [], config = createDefaultHotTextConfig(), emptyText = 'Not answered') {
  const segments = selectableSegments(config);
  if (!selectedIds.length) {
    return emptyText;
  }
  return selectedIds
    .map((id) => segments.find((segment) => segment.id === id)?.text || id)
    .join('; ');
}

export function getHotTextValidationIssues(question = {}) {
  const config = normalizeHotTextConfig(question.questionConfig);
  const segments = selectableSegments(config);
  const correctIds = normalizeHotTextAnswerData(question.correctAnswerData, config);
  const issues = [];

  if (!plainTextFromParts(config.contentParts).trim()) {
    issues.push('Add the passage text students will read.');
  }
  if (!segments.length) {
    issues.push('Mark at least one word, phrase, or sentence as selectable.');
  }
  if (!correctIds.length) {
    issues.push('Select at least one correct text segment.');
  }

  return issues;
}

function mergeAdjacentTextParts(parts = []) {
  return parts.reduce((result, part) => {
    const previous = result.at(-1);
    if (part.type === 'text' && previous?.type === 'text') {
      previous.text += part.text;
      return result;
    }
    result.push(part);
    return result;
  }, []);
}
