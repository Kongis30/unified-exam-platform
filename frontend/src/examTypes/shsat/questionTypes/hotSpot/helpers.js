import { normalizeAnswerToken, parseJson, parseJsonObject } from '../utils';

export const HOT_SPOT_TYPE = 'HOT_SPOT';

export function createDefaultHotSpotConfig() {
  return {
    selectionMode: 'multi',
    imageUrl: '',
    regions: [
      { id: 'region1', label: 'Region 1', shape: 'rect', x: 0.2, y: 0.2, width: 0.22, height: 0.16 },
    ],
  };
}

export function createDefaultHotSpotCorrectAnswerData() {
  return { selectedRegionIds: ['region1'] };
}

export function normalizeHotSpotConfig(rawConfig) {
  const parsedConfig = parseJsonObject(rawConfig, createDefaultHotSpotConfig());
  const regions = normalizeHotSpotRegions(parsedConfig.regions || parsedConfig.hotSpotRegions);

  return {
    ...parsedConfig,
    selectionMode: normalizeSelectionMode(parsedConfig.selectionMode),
    imageUrl: String(parsedConfig.imageUrl || parsedConfig.assetUrl || ''),
    regions: regions.length ? regions : [],
  };
}

function normalizeSelectionMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'single' || normalized === 'one' ? 'single' : 'multi';
}

export function normalizeHotSpotRegions(regions = []) {
  if (!Array.isArray(regions)) {
    return [];
  }

  const usedIds = new Set();
  return regions.map((region, index) => {
    const fallbackId = `region${index + 1}`;
    const id = uniqueRegionId(normalizeAnswerToken(region?.id) || fallbackId, usedIds);
    usedIds.add(id);
    return {
      id,
      label: String(region?.label || `Region ${index + 1}`),
      shape: 'rect',
      x: normalizeRatio(region?.x, 0.1),
      y: normalizeRatio(region?.y, 0.1),
      width: normalizeRatio(region?.width, 0.2),
      height: normalizeRatio(region?.height, 0.16),
    };
  });
}

export function normalizeHotSpotAnswerData(rawData, config = createDefaultHotSpotConfig()) {
  const data = parseJson(rawData, rawData);
  const source = Array.isArray(data)
    ? data
    : data?.selectedRegionIds || data?.regions || data?.selectedIds || data?.answers || [];
  const validIds = new Set(normalizeHotSpotConfig(config).regions.map((region) => region.id));
  const seen = new Set();

  return (Array.isArray(source) ? source : String(source || '').split(/[;,|]/))
    .map(normalizeAnswerToken)
    .filter((id) => id && !seen.has(id) && (!validIds.size || validIds.has(id)) && seen.add(id));
}

export function nextRegionId(regions = []) {
  const usedIds = new Set(regions.map((region) => region.id).filter(Boolean));
  let index = usedIds.size + 1;
  while (usedIds.has(`region${index}`)) {
    index += 1;
  }
  return `region${index}`;
}

export function formatHotSpotSelection(selectedIds = [], config = createDefaultHotSpotConfig(), emptyText = 'Not answered') {
  const regions = normalizeHotSpotConfig(config).regions;
  if (!selectedIds.length) {
    return emptyText;
  }
  return selectedIds
    .map((id) => regions.find((region) => region.id === id)?.label || id)
    .join('; ');
}

export function getHotSpotValidationIssues(question = {}) {
  const config = normalizeHotSpotConfig(question.questionConfig);
  const correctIds = normalizeHotSpotAnswerData(question.correctAnswerData, config);
  const issues = [];

  if (!config.imageUrl && !question.material?.assetUrl && !question.imageUrl) {
    issues.push('Add an image URL or attach an image material for the hot spot area.');
  }
  if (!config.regions.length) {
    issues.push('Add at least one clickable region.');
  }
  if (!correctIds.length) {
    issues.push('Select at least one correct region.');
  }

  return issues;
}

export function imageUrlForQuestion(question = {}, config = normalizeHotSpotConfig(question.questionConfig)) {
  return question.material?.assetUrl || question.material?.imageUrl || question.imageUrl || config.imageUrl || '';
}

function normalizeRatio(value, fallbackValue) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallbackValue;
  }
  return Math.min(1, Math.max(0, number));
}

function uniqueRegionId(id, usedIds) {
  if (!usedIds.has(id)) {
    return id;
  }
  let index = 2;
  while (usedIds.has(`${id}_${index}`)) {
    index += 1;
  }
  return `${id}_${index}`;
}
