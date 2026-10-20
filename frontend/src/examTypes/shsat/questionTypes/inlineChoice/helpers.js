import { normalizeAnswerToken, normalizeOption, parseJson } from '../utils';

export const INLINE_CHOICE_PLACEHOLDER_PATTERN = /\{\{\s*blank:([A-Za-z0-9_-]+)\s*\}\}/g;

export function createInlineChoicePlaceholder(blankId) {
  const id = normalizeAnswerToken(blankId);
  return id ? `{{blank:${id}}}` : '';
}

export function parseInlineTextParts(inlineText = '') {
  const parts = [];
  const text = String(inlineText || '');
  let lastIndex = 0;
  let match;

  INLINE_CHOICE_PLACEHOLDER_PATTERN.lastIndex = 0;
  while ((match = INLINE_CHOICE_PLACEHOLDER_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    parts.push({ type: 'blank', id: match[1], placeholder: match[0] });
    lastIndex = INLINE_CHOICE_PLACEHOLDER_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', text }];
}

export function findInlineTextBlankIds(inlineText = '') {
  return parseInlineTextParts(inlineText)
    .filter((part) => part.type === 'blank')
    .map((part) => part.id);
}

function duplicateValues(values = []) {
  const seen = new Set();
  const duplicates = new Set();

  values.forEach((value) => {
    const normalized = normalizeAnswerToken(value);
    if (!normalized) {
      return;
    }
    if (seen.has(normalized)) {
      duplicates.add(normalized);
    }
    seen.add(normalized);
  });

  return [...duplicates];
}

function normalizeInlineChoiceOptionLine(line, index) {
  const trimmed = String(line || '').trim();
  const matched = trimmed.match(/^([A-Za-z0-9_-]+)\s*[-.:)]\s*(.+)$/);

  if (matched) {
    return normalizeOption({ key: matched[1], text: matched[2] }, index);
  }

  return normalizeOption(trimmed, index);
}

export function normalizeInlineChoiceOptions(rawOptions = []) {
  const parsed = parseJson(rawOptions, rawOptions);

  if (Array.isArray(parsed)) {
    return parsed
      .map((option, index) => (
        typeof option === 'string' ? normalizeInlineChoiceOptionLine(option, index) : normalizeOption(option, index)
      ))
      .filter((option) => option.key && option.text);
  }

  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed)
      .map(([key, value], index) => normalizeOption({ key, value }, index))
      .filter((option) => option.key && option.text);
  }

  if (typeof rawOptions === 'string' && rawOptions.trim()) {
    return rawOptions
      .split(/\r?\n/)
      .map((line, index) => normalizeInlineChoiceOptionLine(line, index))
      .filter((option) => option.key && option.text);
  }

  return [];
}

export function normalizeInlineChoiceBlank(blank = {}, index = 0, fallbackOptions = []) {
  const fallbackId = `blank${index + 1}`;
  const id = normalizeAnswerToken(blank.id || blank.key || blank.value || fallbackId) || fallbackId;
  const options = normalizeInlineChoiceOptions(
    blank.options || blank.choices || blank.values || fallbackOptions
  );

  return {
    ...blank,
    id,
    key: normalizeAnswerToken(blank.key || id),
    label: String(blank.label || blank.text || blank.title || `Dropdown ${index + 1}`),
    options,
  };
}

export function normalizeInlineChoiceBlanks(questionConfig = {}, globalOptions = []) {
  const rawBlanks = questionConfig.blanks || questionConfig.inlineChoices;
  if (Array.isArray(rawBlanks)) {
    return rawBlanks.map((blank, index) => normalizeInlineChoiceBlank(blank, index, globalOptions));
  }

  const options = normalizeInlineChoiceOptions(globalOptions);
  return options.length > 0 ? [normalizeInlineChoiceBlank({}, 0, options)] : [];
}

function optionKeySet(blank) {
  return new Set((blank.options || []).map((option) => normalizeAnswerToken(option.key)).filter(Boolean));
}

function normalizeDirectAnswerMap(rawMap, blanks = []) {
  if (!rawMap || Array.isArray(rawMap) || typeof rawMap !== 'object') {
    return {};
  }

  const blankById = new Map(blanks.map((blank) => [blank.id, blank]));
  return Object.entries(rawMap).reduce((result, [rawBlankId, rawOptionKey]) => {
    const blankId = normalizeAnswerToken(rawBlankId);
    const optionKey = normalizeAnswerToken(rawOptionKey);
    const validOptions = optionKeySet(blankById.get(blankId) || {});

    const isValidBlank = !blankById.size || blankById.has(blankId);
    const isValidOption = !validOptions.size || validOptions.has(optionKey);
    if (blankId && optionKey && isValidBlank && isValidOption) {
      result[blankId] = optionKey;
    }
    return result;
  }, {});
}

function normalizeAnswerArray(rawAnswers, blanks = []) {
  return rawAnswers.reduce((result, item, index) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return {
        ...result,
        ...normalizeDirectAnswerMap(
          { [item.blankId || item.id || item.key || blanks[index]?.id]: item.optionKey || item.value || item.answer },
          blanks
        ),
      };
    }

    return {
      ...result,
      ...normalizeDirectAnswerMap({ [blanks[index]?.id]: item }, blanks),
    };
  }, {});
}

export function normalizeInlineChoiceAnswerMap(rawAnswerData, blanks = []) {
  const data = parseJson(rawAnswerData, rawAnswerData);
  if (!data) {
    return {};
  }

  if (Array.isArray(data)) {
    return normalizeAnswerArray(data, blanks);
  }

  if (typeof data === 'object') {
    const candidates = [data.answers, data.selectedAnswers, data.selections, data.values, data];
    for (const candidate of candidates) {
      const normalized = Array.isArray(candidate)
        ? normalizeAnswerArray(candidate, blanks)
        : normalizeDirectAnswerMap(candidate, blanks);
      if (Object.keys(normalized).length > 0) {
        return normalized;
      }
    }
  }

  return normalizeAnswerArray([data], blanks);
}

export function ensureInlineText(questionConfig = {}, blanks = []) {
  const inlineText = String(questionConfig.inlineText || '').trim();
  if (inlineText) {
    return questionConfig.inlineText;
  }

  // Legacy data only has a blank list. Generate a readable template so it can render inline.
  return blanks
    .map((blank) => createInlineChoicePlaceholder(blank.id))
    .filter(Boolean)
    .join(' ');
}

export function normalizeInlineChoiceConfig(questionConfig = {}, globalOptions = []) {
  const blanks = normalizeInlineChoiceBlanks(questionConfig, globalOptions);
  return {
    ...questionConfig,
    inlineText: ensureInlineText(questionConfig, blanks),
    blanks,
  };
}

export function formatInlineChoiceAnswerMap(answerMap = {}, emptyText = 'Not answered', blanks = []) {
  const entries = Object.entries(answerMap);
  if (entries.length === 0) {
    return emptyText;
  }

  const blankById = new Map(blanks.map((blank) => [blank.id, blank]));
  return entries
    .map(([blankId, optionKey]) => {
      const blank = blankById.get(blankId);
      const option = blank?.options?.find((candidate) => candidate.key === optionKey);
      return `${blank?.label || blankId}: ${option ? option.text : optionKey}`;
    })
    .join('; ');
}

export function getInlineChoiceValidationIssues(question = {}) {
  const config = question.questionConfig || {};
  const inlineText = String(config.inlineText || '').trim();
  const blanks = Array.isArray(config.blanks) ? config.blanks : [];
  const answerMap = question.correctAnswerData?.answers || {};
  const issues = [];

  if (!inlineText) {
    issues.push('Inline Choice paragraph text is required.');
  }
  if (blanks.length === 0) {
    issues.push('Inline Choice needs at least one dropdown.');
  }

  const blankIds = blanks.map((blank) => normalizeAnswerToken(blank.id));
  duplicateValues(blankIds).forEach(() => {
    issues.push('Two dropdowns conflict. Remove one duplicate dropdown and add it again.');
  });

  const definedBlankIds = new Set(blankIds.filter(Boolean));
  const referencedBlankIds = findInlineTextBlankIds(inlineText).map(normalizeAnswerToken).filter(Boolean);

  referencedBlankIds.forEach((blankId) => {
    if (!definedBlankIds.has(blankId)) {
      issues.push('Paragraph references a dropdown that no longer exists. Remove it and insert a new dropdown.');
    }
  });

  blankIds.forEach((blankId, index) => {
    const dropdownLabel = blanks[index]?.label || `Dropdown ${index + 1}`;

    if (!blankId) {
      issues.push(`Dropdown ${index + 1} is incomplete. Remove it and add the dropdown again.`);
    } else if (!referencedBlankIds.includes(blankId)) {
      issues.push(`${dropdownLabel} is not inserted in the paragraph.`);
    }
  });

  blanks.forEach((blank, blankIndex) => {
    const blankLabel = blank.label || blank.id || `Dropdown ${blankIndex + 1}`;
    const options = Array.isArray(blank.options) ? blank.options : [];
    const optionKeys = options.map((option) => normalizeAnswerToken(option.key));

    if (!String(blank.label || '').trim()) {
      issues.push(`${blankLabel} needs a label.`);
    }
    if (options.length === 0) {
      issues.push(`${blankLabel} needs at least one option.`);
    }

    duplicateValues(optionKeys).forEach((optionKey) => {
      issues.push(`${blankLabel} has duplicated option key "${optionKey}".`);
    });

    options.forEach((option, optionIndex) => {
      if (!normalizeAnswerToken(option.key)) {
        issues.push(`${blankLabel} option ${optionIndex + 1} needs a key.`);
      }
      if (!String(option.text || '').trim()) {
        issues.push(`${blankLabel} option ${option.key || optionIndex + 1} needs text.`);
      }
    });

    const correctAnswer = normalizeAnswerToken(answerMap[blank.id]);
    if (!correctAnswer) {
      issues.push(`${blankLabel} needs a correct answer.`);
    } else if (!optionKeys.includes(correctAnswer)) {
      issues.push(`${blankLabel} correct answer "${correctAnswer}" is not in its options.`);
    }
  });

  return issues;
}
