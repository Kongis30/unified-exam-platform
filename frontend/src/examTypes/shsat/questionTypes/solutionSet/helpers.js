import { parseJson, parseJsonObject } from '../utils';

export const SOLUTION_SET_TYPE = 'SOLUTION_SET';
export const NUMBER_LINE_RAY_MODE = 'number_line_ray';

export function createDefaultSolutionSetConfig() {
  return {
    mode: NUMBER_LINE_RAY_MODE,
    instruction: 'Select a ray. Then move the endpoint of the ray to the correct position on the number line.',
    numberLine: {
      min: -5,
      max: 5,
      step: 1,
      labelStep: 1,
      showArrows: true,
    },
  };
}

export function createDefaultSolutionSetCorrectAnswerData() {
  return {
    solution: {
      type: 'ray',
      endpoint: 1,
      endpointIncluded: true,
      direction: 'right',
    },
  };
}

export function normalizeSolutionSetConfig(rawConfig) {
  const defaults = createDefaultSolutionSetConfig();
  const parsedConfig = parseJsonObject(rawConfig, defaults);
  const rawLine = parsedConfig.numberLine && typeof parsedConfig.numberLine === 'object'
    ? parsedConfig.numberLine
    : {};

  const min = normalizeNumber(rawLine.min, defaults.numberLine.min);
  const max = normalizeNumber(rawLine.max, defaults.numberLine.max);
  const step = normalizePositiveNumber(rawLine.step, defaults.numberLine.step);

  return {
    ...defaults,
    ...parsedConfig,
    mode: NUMBER_LINE_RAY_MODE,
    instruction: String(parsedConfig.instruction || defaults.instruction),
    numberLine: {
      ...defaults.numberLine,
      ...rawLine,
      min,
      max: max > min ? max : defaults.numberLine.max,
      step,
      labelStep: normalizePositiveNumber(rawLine.labelStep, step),
      showArrows: rawLine.showArrows !== false,
    },
  };
}

export function normalizeSolutionSetAnswerData(rawData, config = createDefaultSolutionSetConfig()) {
  const data = parseJson(rawData, rawData);
  const source = data?.solution || data?.answer || data || {};
  const questionConfig = normalizeSolutionSetConfig(config);
  const line = questionConfig.numberLine;
  const endpoint = clampToNumberLine(normalizeNumber(source.endpoint, Number.NaN), line);
  const direction = normalizeDirection(source.direction);

  if (!Number.isFinite(endpoint) || !direction) {
    return {};
  }

  return {
    solution: {
      type: 'ray',
      endpoint,
      endpointIncluded: Boolean(source.endpointIncluded),
      direction,
    },
  };
}

export function formatSolutionSetAnswer(rawData, config = createDefaultSolutionSetConfig(), emptyText = 'Not answered') {
  const answer = normalizeSolutionSetAnswerData(rawData, config).solution;
  if (!answer) {
    return emptyText;
  }

  const symbol = answer.direction === 'right'
    ? (answer.endpointIncluded ? '≥' : '>')
    : (answer.endpointIncluded ? '≤' : '<');
  return `x ${symbol} ${formatNumber(answer.endpoint)}`;
}

export function getSolutionSetValidationIssues(question = {}) {
  const config = normalizeSolutionSetConfig(question.questionConfig);
  const answer = normalizeSolutionSetAnswerData(question.correctAnswerData, config).solution;
  const issues = [];

  if (config.numberLine.max <= config.numberLine.min) {
    issues.push('Number line maximum must be greater than the minimum.');
  }
  if (config.numberLine.step <= 0) {
    issues.push('Number line step must be greater than zero.');
  }
  if (!answer) {
    issues.push('Set a correct ray solution.');
  }

  return issues;
}

export function buildNumberLineTicks(config = createDefaultSolutionSetConfig()) {
  const line = normalizeSolutionSetConfig(config).numberLine;
  const ticks = [];
  const limit = 500;
  for (let value = line.min, count = 0; value <= line.max + line.step / 2 && count < limit; value += line.step, count += 1) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
}

export function rayOptions() {
  return [
    { direction: 'left', endpointIncluded: true, label: 'Closed left ray', symbol: '←●' },
    { direction: 'left', endpointIncluded: false, label: 'Open left ray', symbol: '←○' },
    { direction: 'right', endpointIncluded: false, label: 'Open right ray', symbol: '○→' },
    { direction: 'right', endpointIncluded: true, label: 'Closed right ray', symbol: '●→' },
  ];
}

export function solutionKey(solution = {}) {
  return [
    solution.direction || '',
    solution.endpointIncluded ? 'closed' : 'open',
    Number.isFinite(solution.endpoint) ? formatNumber(solution.endpoint) : '',
  ].join(':');
}

function normalizeDirection(value) {
  const direction = String(value || '').trim().toLowerCase();
  return ['left', 'right'].includes(direction) ? direction : '';
}

function clampToNumberLine(value, line) {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.min(line.max, Math.max(line.min, value));
}

function normalizePositiveNumber(value, fallbackValue = 1) {
  const number = normalizeNumber(value, fallbackValue);
  return number > 0 ? number : fallbackValue;
}

function normalizeNumber(value, fallbackValue = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(2).replace(/\.?0+$/, '');
}
