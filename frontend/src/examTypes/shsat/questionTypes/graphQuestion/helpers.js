import { normalizeAnswerToken, parseJson, parseJsonObject } from '../utils';

export const GRAPH_POINT_MODE = 'point_graph';
export const GRAPH_SELECT_POINTS_MODE = 'select_points';

export function createDefaultGraphSelectPointsConfig() {
  return {
    graphMode: GRAPH_SELECT_POINTS_MODE,
    showCandidatePoints: true,
    graph: {
      title: 'Coordinate Graph',
      xLabel: 'x',
      yLabel: 'y',
      xMin: -5,
      xMax: 5,
      xStep: 1,
      yMin: -5,
      yMax: 5,
      yStep: 1,
      showGrid: true,
      showAxisArrows: true,
    },
    points: [],
    selection: {
      mode: 'multi',
      instruction: 'Select all the correct points.',
    },
    interaction: {
      snapToGrid: true,
      instruction: 'Plot the point on the coordinate plane.',
    },
  };
}

export function createDefaultGraphSelectPointsCorrectAnswerData() {
  return { selectedPointIds: [] };
}

export function normalizeGraphConfig(rawConfig) {
  const parsedConfig = parseJsonObject(rawConfig, createDefaultGraphSelectPointsConfig());
  const defaults = createDefaultGraphSelectPointsConfig();
  const graph = {
    ...defaults.graph,
    ...(parsedConfig.graph && typeof parsedConfig.graph === 'object' ? parsedConfig.graph : {}),
  };

  const requestedGraphMode = normalizeGraphMode(parsedConfig.graphMode);
  const showCandidatePoints = parsedConfig.showCandidatePoints === undefined
    ? requestedGraphMode === GRAPH_SELECT_POINTS_MODE
    : parsedConfig.showCandidatePoints !== false;

  const interaction = {
    ...defaults.interaction,
    ...(parsedConfig.interaction && typeof parsedConfig.interaction === 'object' ? parsedConfig.interaction : {}),
  };
  // 旧数据可能带有 maxPoints，统一丢弃，避免旧限制继续影响学生答题。
  delete interaction.maxPoints;
  interaction.snapToGrid = true;

  return {
    ...defaults,
    ...parsedConfig,
    // 学生端的交互模式只由“是否显示候选点”决定，避免配置和答案格式不一致。
    graphMode: showCandidatePoints ? GRAPH_SELECT_POINTS_MODE : GRAPH_POINT_MODE,
    showCandidatePoints,
    graph: normalizeGraphSettings(graph),
    points: normalizeGraphPoints(parsedConfig.points),
    selection: {
      ...defaults.selection,
      ...(parsedConfig.selection && typeof parsedConfig.selection === 'object' ? parsedConfig.selection : {}),
      mode: parsedConfig.selection?.mode === 'single' ? 'single' : 'multi',
      instruction: String(parsedConfig.selection?.instruction || defaults.selection.instruction).trim(),
    },
    interaction,
  };
}

function normalizeGraphMode(graphMode) {
  return graphMode === GRAPH_POINT_MODE ? GRAPH_POINT_MODE : GRAPH_SELECT_POINTS_MODE;
}

export function normalizeGraphSettings(graph = {}) {
  const normalized = {
    ...graph,
    title: String(graph.title || '').trim(),
    xLabel: String(graph.xLabel || 'x').trim(),
    yLabel: String(graph.yLabel || 'y').trim(),
    xMin: normalizeNumber(graph.xMin, 0),
    xMax: normalizeNumber(graph.xMax, 6),
    xStep: normalizePositiveNumber(graph.xStep, 1),
    yMin: normalizeNumber(graph.yMin, 0),
    yMax: normalizeNumber(graph.yMax, 10),
    yStep: normalizePositiveNumber(graph.yStep, 1),
    showGrid: graph.showGrid !== false,
    showAxisArrows: graph.showAxisArrows !== false,
  };

  if (normalized.xMax <= normalized.xMin) {
    normalized.xMax = normalized.xMin + normalized.xStep;
  }
  if (normalized.yMax <= normalized.yMin) {
    normalized.yMax = normalized.yMin + normalized.yStep;
  }

  return normalized;
}

export function normalizeGraphPoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  const usedIds = new Set();
  return points.map((point, index) => {
    const fallbackId = nextPointId(points, index + 1, usedIds);
    const rawId = normalizeAnswerToken(point?.id || point?.key || point?.value || fallbackId);
    const id = rawId && !usedIds.has(rawId) ? rawId : fallbackId;
    usedIds.add(id);

    return {
      id,
      x: normalizeNumber(point?.x, 0),
      y: normalizeNumber(point?.y, 0),
      label: String(point?.label || '').trim(),
    };
  });
}

export function nextPointId(points = [], startAt = 1, reservedIds = new Set()) {
  const existingIds = new Set(points.map((point) => normalizeAnswerToken(point?.id)).filter(Boolean));
  let nextIndex = startAt;

  while (existingIds.has(`p${nextIndex}`) || reservedIds.has(`p${nextIndex}`)) {
    nextIndex += 1;
  }

  return `p${nextIndex}`;
}

export function normalizeGraphAnswerPoints(rawData, questionConfig = {}) {
  const data = parseJson(rawData, rawData);
  const source = Array.isArray(data)
    ? data
    : data?.points || data?.placedPoints || data?.selectedPoints || [];

  if (Array.isArray(source) && source.length > 0) {
    return uniqueCoordinatePoints(source.map((point) => ({
      x: normalizeNumber(point?.x, Number.NaN),
      y: normalizeNumber(point?.y, Number.NaN),
      label: String(point?.label || '').trim(),
    })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }

  const legacyIds = normalizeSelectedPointIds(data, questionConfig.points || []);
  if (!legacyIds.length) {
    return [];
  }

  return legacyIds
    .map((id) => (questionConfig.points || []).find((point) => point.id === id))
    .filter(Boolean)
    .map((point) => ({ x: point.x, y: point.y, label: point.label || '' }));
}

export function normalizeSelectedPointIds(rawData, points = []) {
  const data = parseJson(rawData, rawData);
  const source = Array.isArray(data)
    ? data
    : (data && typeof data === 'object'
      ? data.selectedPointIds || data.selectedIds || data.points || data.answers || []
      : data);
  const validIds = new Set(points.map((point) => point.id));
  const seen = new Set();

  return (Array.isArray(source) ? source : String(source || '').split(/[;,|]/))
    .filter((value) => typeof value !== 'object' || value === null)
    .map(normalizeAnswerToken)
    .filter((id) => id && !seen.has(id) && (!validIds.size || validIds.has(id)) && seen.add(id));
}

export function formatGraphPoints(points = [], emptyText = 'Not answered') {
  if (!points.length) {
    return emptyText;
  }

  return points
    .map((point) => {
      const label = point.label ? `${point.label} ` : '';
      return `${label}(${formatNumber(point.x)}, ${formatNumber(point.y)})`;
    })
    .join('; ');
}

export function formatSelectedPoints(selectedPointIds = [], points = [], emptyText = 'Not answered') {
  if (!selectedPointIds.length) {
    return emptyText;
  }

  return selectedPointIds
    .map((id) => {
      const point = points.find((candidate) => candidate.id === id);
      if (!point) {
        return id;
      }
      const label = point.label ? `${point.label} ` : '';
      return `${label}(${formatNumber(point.x)}, ${formatNumber(point.y)})`;
    })
    .join('; ');
}

export function getGraphSelectPointsValidationIssues(question = {}) {
  const rawConfig = parseJsonObject(question.questionConfig, createDefaultGraphSelectPointsConfig());
  const rawGraph = rawConfig.graph && typeof rawConfig.graph === 'object' ? rawConfig.graph : {};
  const questionConfig = normalizeGraphConfig(question.questionConfig);
  const graph = {
    ...questionConfig.graph,
    xMin: normalizeNumber(rawGraph.xMin, questionConfig.graph.xMin),
    xMax: normalizeNumber(rawGraph.xMax, questionConfig.graph.xMax),
    xStep: normalizeNumber(rawGraph.xStep, questionConfig.graph.xStep),
    yMin: normalizeNumber(rawGraph.yMin, questionConfig.graph.yMin),
    yMax: normalizeNumber(rawGraph.yMax, questionConfig.graph.yMax),
    yStep: normalizeNumber(rawGraph.yStep, questionConfig.graph.yStep),
  };
  const issues = [];

  if (![GRAPH_POINT_MODE, GRAPH_SELECT_POINTS_MODE].includes(questionConfig.graphMode)) {
    issues.push('Graph mode must be select points or point graph.');
  }
  if (graph.xMax <= graph.xMin) {
    issues.push('X-axis maximum must be greater than the minimum.');
  }
  if (graph.yMax <= graph.yMin) {
    issues.push('Y-axis maximum must be greater than the minimum.');
  }
  if (graph.xStep <= 0 || graph.yStep <= 0) {
    issues.push('Axis steps must be greater than zero.');
  }

  if (questionConfig.graphMode === GRAPH_SELECT_POINTS_MODE) {
    addSelectPointsValidationIssues(question, questionConfig, graph, issues);
  } else {
    addPointGraphValidationIssues(question, questionConfig, graph, issues);
  }

  return issues;
}

function addSelectPointsValidationIssues(question, questionConfig, graph, issues) {
  const points = questionConfig.points;
  const selectedPointIds = normalizeSelectedPointIds(question.correctAnswerData, points);
  const rawSelectedPointIds = rawSelectedPointIdsFrom(question.correctAnswerData);
  const pointIds = new Set();

  if (points.length === 0) {
    issues.push('Add at least one candidate point.');
  }
  points.forEach((point, index) => {
    if (!point.id) {
      issues.push(`Candidate point ${index + 1} needs an internal id.`);
    }
    if (pointIds.has(point.id)) {
      issues.push('Candidate point ids must be unique.');
    }
    pointIds.add(point.id);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      issues.push(`Candidate point ${index + 1} needs valid coordinates.`);
    }
    if (point.x < graph.xMin || point.x > graph.xMax || point.y < graph.yMin || point.y > graph.yMax) {
      issues.push(`Candidate point ${index + 1} must be within the graph range.`);
    }
  });
  if (selectedPointIds.length === 0) {
    issues.push('Select at least one correct point.');
  }
  if (rawSelectedPointIds.some((id) => id && !pointIds.has(id))) {
    issues.push('Each correct point must come from the candidate points.');
  }
}

function addPointGraphValidationIssues(question, questionConfig, graph, issues) {
  const points = normalizeGraphAnswerPoints(question.correctAnswerData, questionConfig);

  if (points.length === 0) {
    issues.push('Add at least one correct point.');
  }
  points.forEach((point, index) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      issues.push(`Point ${index + 1} needs valid coordinates.`);
    }
    if (point.x < graph.xMin || point.x > graph.xMax || point.y < graph.yMin || point.y > graph.yMax) {
      issues.push(`Point ${index + 1} must be within the graph range.`);
    }
  });
}

function rawSelectedPointIdsFrom(rawData) {
  const data = parseJson(rawData, rawData);
  const source = Array.isArray(data)
    ? data
    : data?.selectedPointIds || data?.selectedIds || data?.answers || [];

  return (Array.isArray(source) ? source : String(source || '').split(/[;,|]/))
    .filter((value) => typeof value !== 'object' || value === null)
    .map(normalizeAnswerToken)
    .filter(Boolean);
}

export function normalizeNumber(value, fallbackValue = 0) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallbackValue;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallbackValue;
}

function normalizePositiveNumber(value, fallbackValue = 1) {
  const number = normalizeNumber(value, fallbackValue);
  return number > 0 ? number : fallbackValue;
}

function uniqueCoordinatePoints(points = []) {
  const seen = new Set();
  return points.filter((point) => {
    const key = `${formatNumber(point.x)},${formatNumber(point.y)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(2).replace(/\.?0+$/, '');
}
