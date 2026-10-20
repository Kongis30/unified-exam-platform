<script setup>
import { computed, ref, watch } from 'vue';

import GraphSelectPointsPlot from './GraphSelectPointsPlot.vue';
import {
  GRAPH_POINT_MODE,
  GRAPH_SELECT_POINTS_MODE,
  formatGraphPoints,
  formatSelectedPoints,
  getGraphSelectPointsValidationIssues,
  normalizeGraphAnswerPoints,
  normalizeGraphConfig,
  normalizeNumber,
  normalizeSelectedPointIds,
  nextPointId,
} from './helpers';
import { parseJsonObject } from '../utils';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['patch', 'dirty']);

const questionConfig = computed(() => {
  return normalizeGraphConfig(props.question.questionConfig);
});
const graph = computed(() => questionConfig.value.graph);
const candidatePoints = computed(() => questionConfig.value.points);
const showCandidatePoints = computed(() => questionConfig.value.showCandidatePoints);
const correctPointCoordinates = computed(() => normalizeGraphAnswerPoints(
  props.question.correctAnswerData,
  questionConfig.value,
));
const selectedPointIds = computed(() => {
  if (showCandidatePoints.value) {
    return normalizeSelectedPointIds(props.question.correctAnswerData, candidatePoints.value);
  }

  return candidatePoints.value
    .filter((point) => correctPointCoordinates.value.some((correctPoint) => sameCoordinates(point, correctPoint)))
    .map((point) => point.id);
});
const validationIssues = computed(() => getGraphSelectPointsValidationIssues(props.question));
const graphSettingsDraft = ref({});
const previewSelectedPointIds = ref([]);
const previewPlottedPoints = ref([]);
const addPointHelpText = computed(() => {
  return showCandidatePoints.value
    ? 'Click an empty grid point to add a candidate. Click an existing point again to remove it, or edit exact coordinates in the table.'
    : 'Candidate points remain available for authoring. Click an empty grid point to add one, or click an existing point again to remove it.';
});
const correctSummary = computed(() => showCandidatePoints.value
  ? formatSelectedPoints(selectedPointIds.value, candidatePoints.value, 'No correct points selected.')
  : formatGraphPoints(correctPointCoordinates.value, 'No correct points selected.'));
const previewSummary = computed(() => showCandidatePoints.value
  ? formatSelectedPoints(previewSelectedPointIds.value, candidatePoints.value, 'No preview points selected.')
  : formatGraphPoints(previewPlottedPoints.value, 'No preview points plotted.'));
const previewHasSelection = computed(() => showCandidatePoints.value
  ? previewSelectedPointIds.value.length > 0
  : previewPlottedPoints.value.length > 0);
const xAxisSummary = computed(() => {
  return `X axis shows ${graph.value.xMin} to ${graph.value.xMax} in steps of ${graph.value.xStep}.`;
});
const yAxisSummary = computed(() => {
  return `Y axis shows ${graph.value.yMin} to ${graph.value.yMax} in steps of ${graph.value.yStep}.`;
});

const graphNumberFields = ['xMin', 'xMax', 'xStep', 'yMin', 'yMax', 'yStep'];

watch(
  () => props.question.questionConfig,
  syncGraphSettingsDraft,
  { immediate: true },
);

watch(
  candidatePoints,
  () => {
    const validIds = new Set(candidatePoints.value.map((point) => point.id));
    previewSelectedPointIds.value = previewSelectedPointIds.value.filter((id) => validIds.has(id));
  },
  { deep: true },
);

function emitChange(nextQuestionConfig = questionConfig.value, nextCorrectAnswerData) {
  const correctAnswerData = nextCorrectAnswerData || currentCorrectAnswerData();
  props.question.options = [];
  props.question.questionConfig = nextQuestionConfig;
  props.question.correctAnswerData = correctAnswerData;
  emit('patch', {
    options: [],
    questionConfig: props.question.questionConfig,
    correctAnswerData,
  });
  emit('dirty');
}

function setGraphField(fieldName, value) {
  if (props.readonly) {
    return;
  }

  const booleanFields = ['showGrid', 'showAxisArrows'];
  const nextValue = graphNumberFields.includes(fieldName)
    ? normalizeNumber(value, graph.value[fieldName])
    : booleanFields.includes(fieldName)
      ? Boolean(value)
      : value;
  emitChange(buildQuestionConfig({ graph: { ...getEditableGraphSettings(), [fieldName]: nextValue } }));
}

function updateGraphTextField(fieldName, value) {
  graphSettingsDraft.value[fieldName] = value;
  setGraphField(fieldName, value);
}

function updateGraphNumberDraft(fieldName, value) {
  if (props.readonly) {
    return;
  }

  graphSettingsDraft.value[fieldName] = value;
  if (isCompleteNumberInput(value)) {
    setGraphField(fieldName, value);
  }
}

function commitGraphNumberDraft(fieldName) {
  if (props.readonly) {
    return;
  }

  const draftValue = graphSettingsDraft.value[fieldName];
  if (!isCompleteNumberInput(draftValue)) {
    graphSettingsDraft.value[fieldName] = formatDraftNumber(getEditableGraphSettings()[fieldName]);
    return;
  }

  const committedValue = normalizeNumber(draftValue, graph.value[fieldName]);
  graphSettingsDraft.value[fieldName] = formatDraftNumber(committedValue);
  setGraphField(fieldName, committedValue);
}

function isCompleteNumberInput(value) {
  const text = String(value ?? '').trim();
  return text !== '' && text !== '-' && text !== '+' && Number.isFinite(Number(text));
}

function formatDraftNumber(value) {
  return Number.isFinite(Number(value)) ? String(value) : '';
}

function getEditableGraphSettings() {
  const rawConfig = parseJsonObject(props.question.questionConfig, {});
  const rawGraph = rawConfig.graph && typeof rawConfig.graph === 'object' ? rawConfig.graph : {};

  // Keep raw min/max values in the editor so validation can guide the user
  // instead of immediately replacing partially invalid ranges.
  return {
    ...graph.value,
    ...rawGraph,
  };
}

function syncGraphSettingsDraft() {
  const nextGraph = getEditableGraphSettings();
  graphSettingsDraft.value = {
    title: nextGraph.title,
    xLabel: nextGraph.xLabel,
    yLabel: nextGraph.yLabel,
    xMin: formatDraftNumber(nextGraph.xMin),
    xMax: formatDraftNumber(nextGraph.xMax),
    xStep: formatDraftNumber(nextGraph.xStep),
    yMin: formatDraftNumber(nextGraph.yMin),
    yMax: formatDraftNumber(nextGraph.yMax),
    yStep: formatDraftNumber(nextGraph.yStep),
  };
}

function buildQuestionConfig(patch = {}) {
  const nextShowCandidatePoints = patch.showCandidatePoints === undefined
    ? showCandidatePoints.value
    : Boolean(patch.showCandidatePoints);

  return {
    ...questionConfig.value,
    ...patch,
    graphMode: nextShowCandidatePoints ? GRAPH_SELECT_POINTS_MODE : GRAPH_POINT_MODE,
    showCandidatePoints: nextShowCandidatePoints,
    graph: patch.graph || getEditableGraphSettings(),
    points: patch.points || candidatePoints.value,
    selection: patch.selection || questionConfig.value.selection,
    interaction: {
      ...questionConfig.value.interaction,
      ...(patch.interaction || {}),
      snapToGrid: true,
    },
  };
}

function buildCorrectAnswerData(pointIds = selectedPointIds.value, points = candidatePoints.value, showPoints = showCandidatePoints.value) {
  if (showPoints) {
    return { selectedPointIds: pointIds };
  }

  return {
    points: points
      .filter((point) => pointIds.includes(point.id))
      .map((point) => ({ x: point.x, y: point.y, label: point.label || '' })),
  };
}

function currentCorrectAnswerData() {
  return showCandidatePoints.value
    ? { selectedPointIds: selectedPointIds.value }
    : {
        points: correctPointCoordinates.value.map((point) => ({
          x: point.x,
          y: point.y,
          label: point.label || '',
        })),
      };
}

function sameCoordinates(first, second) {
  return first?.x === second?.x && first?.y === second?.y;
}

function addCandidatePoint(point = {}) {
  if (props.readonly) {
    return;
  }

  const nextPoint = {
    id: nextPointId(candidatePoints.value),
    x: normalizeNumber(point.x, graph.value.xMin),
    y: normalizeNumber(point.y, graph.value.yMin),
    label: '',
  };
  emitChange(buildQuestionConfig({ points: [...candidatePoints.value, nextPoint] }));
}

function setCandidateVisibility(value) {
  if (props.readonly) {
    return;
  }

  const nextShowCandidatePoints = Boolean(value);
  emitChange(
    buildQuestionConfig({ showCandidatePoints: nextShowCandidatePoints }),
    buildCorrectAnswerData(selectedPointIds.value, candidatePoints.value, nextShowCandidatePoints),
  );
  previewSelectedPointIds.value = [];
  previewPlottedPoints.value = [];
}

function removeCandidatePoint(index) {
  if (props.readonly) {
    return;
  }

  const removedPointId = candidatePoints.value[index]?.id;
  const nextPoints = candidatePoints.value.filter((_, pointIndex) => pointIndex !== index);
  const nextSelectedPointIds = selectedPointIds.value.filter((id) => id !== removedPointId);
  previewSelectedPointIds.value = previewSelectedPointIds.value.filter((id) => id !== removedPointId);
  emitChange(
    buildQuestionConfig({ points: nextPoints }),
    buildCorrectAnswerData(nextSelectedPointIds, nextPoints),
  );
}

function removeCandidatePointById(pointId) {
  const pointIndex = candidatePoints.value.findIndex((point) => point.id === pointId);
  if (pointIndex >= 0) {
    removeCandidatePoint(pointIndex);
  }
}

function updateCandidatePoint(index, fieldName, value) {
  if (props.readonly) {
    return;
  }

  const nextPoints = candidatePoints.value.map((candidate, pointIndex) => pointIndex === index
    ? {
        ...candidate,
        [fieldName]: fieldName === 'label' ? value : normalizeNumber(value, candidate[fieldName]),
      }
    : candidate);
  emitChange(
    buildQuestionConfig({ points: nextPoints }),
    buildCorrectAnswerData(selectedPointIds.value, nextPoints),
  );
}

function setSelectionField(fieldName, value) {
  if (props.readonly) {
    return;
  }

  const nextValue = fieldName === 'mode'
    ? value === 'single' ? 'single' : 'multi'
    : String(value || '');
  const nextSelection = {
    ...questionConfig.value.selection,
    [fieldName]: nextValue,
  };
  emitChange(buildQuestionConfig({ selection: nextSelection }));
}

function setStudentInstruction(value) {
  if (showCandidatePoints.value) {
    setSelectionField('instruction', value);
    return;
  }

  if (props.readonly) {
    return;
  }

  emitChange(buildQuestionConfig({
    interaction: {
      ...questionConfig.value.interaction,
      instruction: String(value || ''),
    },
  }));
}

function toggleCorrectPoint(pointId) {
  if (props.readonly) {
    return;
  }

  const nextSelectedPointIds = selectedPointIds.value.includes(pointId)
    ? selectedPointIds.value.filter((id) => id !== pointId)
    : [...selectedPointIds.value, pointId];
  emitChange(
    buildQuestionConfig(),
    buildCorrectAnswerData(nextSelectedPointIds),
  );
}

function togglePreviewPoint(pointId) {
  if (props.readonly) {
    return;
  }

  previewSelectedPointIds.value = previewSelectedPointIds.value.includes(pointId)
    ? previewSelectedPointIds.value.filter((id) => id !== pointId)
    : [...previewSelectedPointIds.value, pointId];
}

function addPreviewPoint(point) {
  if (props.readonly || previewPlottedPoints.value.some((existingPoint) => sameCoordinates(existingPoint, point))) {
    return;
  }

  previewPlottedPoints.value = [...previewPlottedPoints.value, point];
}

function removePreviewPoint(index) {
  if (props.readonly) {
    return;
  }

  previewPlottedPoints.value = previewPlottedPoints.value.filter((_, pointIndex) => pointIndex !== index);
}

function clearPreviewSelection() {
  previewSelectedPointIds.value = [];
  previewPlottedPoints.value = [];
}

function pointDisplayName(point, index) {
  return point.label || `Point ${index + 1}`;
}
</script>

<template>
  <div class="type-editor-panel graph-select-editor">
    <div class="graph-select-editor__intro">
      <strong>Build a point selection graph</strong>
      <p>Set the coordinate plane, add candidate points, choose the correct points, then test the student preview.</p>
    </div>
    <ul v-if="validationIssues.length" class="graph-select-editor__warning-list">
      <li v-for="issue in validationIssues" :key="issue">{{ issue }}</li>
    </ul>

    <section class="graph-select-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Graph Settings</strong>
          <p class="section-note">Set the visible coordinate range and labels.</p>
        </div>
      </div>
      <div class="graph-select-editor__settings-grid">
        <div class="graph-select-editor__settings-card graph-select-editor__settings-card--labels">
          <strong>Labels</strong>
          <div class="graph-select-editor__settings">
            <label class="form-field">
              <span class="form-label">Title</span>
              <input class="form-input graph-select-editor__settings-input graph-select-editor__settings-input--wide" :value="graphSettingsDraft.title" :disabled="readonly" @input="updateGraphTextField('title', $event.target.value)" />
            </label>
            <label class="form-field">
              <span class="form-label">X Label</span>
              <input class="form-input graph-select-editor__settings-input" :value="graphSettingsDraft.xLabel" :disabled="readonly" @input="updateGraphTextField('xLabel', $event.target.value)" />
            </label>
            <label class="form-field">
              <span class="form-label">Y Label</span>
              <input class="form-input graph-select-editor__settings-input" :value="graphSettingsDraft.yLabel" :disabled="readonly" @input="updateGraphTextField('yLabel', $event.target.value)" />
            </label>
          </div>
        </div>

        <div class="graph-select-editor__settings-card">
          <div class="graph-select-editor__settings-card-title">
            <strong>X Axis</strong>
            <span>{{ xAxisSummary }}</span>
          </div>
          <div class="graph-select-editor__axis-fields">
            <label class="form-field">
              <span class="form-label">Min</span>
              <input class="form-input graph-select-editor__settings-input" inputmode="decimal" :value="graphSettingsDraft.xMin" :disabled="readonly" @input="updateGraphNumberDraft('xMin', $event.target.value)" @blur="commitGraphNumberDraft('xMin')" />
            </label>
            <label class="form-field">
              <span class="form-label">Max</span>
              <input class="form-input graph-select-editor__settings-input" inputmode="decimal" :value="graphSettingsDraft.xMax" :disabled="readonly" @input="updateGraphNumberDraft('xMax', $event.target.value)" @blur="commitGraphNumberDraft('xMax')" />
            </label>
            <label class="form-field">
              <span class="form-label">Step</span>
              <input class="form-input graph-select-editor__settings-input" inputmode="decimal" :value="graphSettingsDraft.xStep" :disabled="readonly" @input="updateGraphNumberDraft('xStep', $event.target.value)" @blur="commitGraphNumberDraft('xStep')" />
            </label>
          </div>
        </div>

        <div class="graph-select-editor__settings-card">
          <div class="graph-select-editor__settings-card-title">
            <strong>Y Axis</strong>
            <span>{{ yAxisSummary }}</span>
          </div>
          <div class="graph-select-editor__axis-fields">
            <label class="form-field">
              <span class="form-label">Min</span>
              <input class="form-input graph-select-editor__settings-input" inputmode="decimal" :value="graphSettingsDraft.yMin" :disabled="readonly" @input="updateGraphNumberDraft('yMin', $event.target.value)" @blur="commitGraphNumberDraft('yMin')" />
            </label>
            <label class="form-field">
              <span class="form-label">Max</span>
              <input class="form-input graph-select-editor__settings-input" inputmode="decimal" :value="graphSettingsDraft.yMax" :disabled="readonly" @input="updateGraphNumberDraft('yMax', $event.target.value)" @blur="commitGraphNumberDraft('yMax')" />
            </label>
            <label class="form-field">
              <span class="form-label">Step</span>
              <input class="form-input graph-select-editor__settings-input" inputmode="decimal" :value="graphSettingsDraft.yStep" :disabled="readonly" @input="updateGraphNumberDraft('yStep', $event.target.value)" @blur="commitGraphNumberDraft('yStep')" />
            </label>
          </div>
        </div>

        <div class="graph-select-editor__settings-card graph-select-editor__settings-card--display">
          <strong>Display</strong>
          <div class="graph-select-editor__display-options">
            <label class="graph-select-editor__switch">
              <input type="checkbox" :checked="graph.showGrid" :disabled="readonly" @change="setGraphField('showGrid', $event.target.checked)" />
              <span>Show grid</span>
            </label>
            <label class="graph-select-editor__switch">
              <input type="checkbox" :checked="graph.showAxisArrows" :disabled="readonly" @change="setGraphField('showAxisArrows', $event.target.checked)" />
              <span>Show axis arrows</span>
            </label>
            <label class="graph-select-editor__switch">
              <input type="checkbox" :checked="showCandidatePoints" :disabled="readonly" @change="setCandidateVisibility($event.target.checked)" />
              <span>Show candidate points to students</span>
            </label>
          </div>
        </div>

        <div class="graph-select-editor__settings-card graph-select-editor__settings-card--labels">
          <strong>Student Instruction</strong>
          <input
            class="form-input graph-select-editor__settings-input graph-select-editor__settings-input--wide"
            :value="showCandidatePoints ? questionConfig.selection.instruction : questionConfig.interaction.instruction"
            :disabled="readonly"
            @input="setStudentInstruction($event.target.value)"
          />
        </div>
      </div>
    </section>

    <section class="graph-select-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Candidate Points</strong>
          <p class="section-note">Add every point students may select. Point ids are generated internally and stay stable when coordinates change.</p>
        </div>
        <button class="graph-select-editor__add-button" type="button" :disabled="readonly" @click="addCandidatePoint()">
          <span aria-hidden="true">+</span>
          Add Candidate Point
        </button>
      </div>
      <div class="graph-select-editor__point-guidance">
        <strong>{{ candidatePoints.length }} candidate points</strong>
        <p>{{ addPointHelpText }}</p>
      </div>
      <div class="graph-select-editor__point-table">
        <div class="graph-select-editor__point-head">
          <span>Label</span>
          <span>X</span>
          <span>Y</span>
          <span></span>
        </div>
        <div v-for="(point, index) in candidatePoints" :key="point.id" class="graph-select-editor__point-row">
          <input class="form-input" :value="point.label" placeholder="Optional" :disabled="readonly" @input="updateCandidatePoint(index, 'label', $event.target.value)" />
          <input class="form-input" type="number" step="any" :value="point.x" :disabled="readonly" @input="updateCandidatePoint(index, 'x', $event.target.value)" />
          <input class="form-input" type="number" step="any" :value="point.y" :disabled="readonly" @input="updateCandidatePoint(index, 'y', $event.target.value)" />
          <button class="graph-select-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove candidate point" @click="removeCandidatePoint(index)">&times;</button>
        </div>
      </div>

      <GraphSelectPointsPlot
        :question-config="questionConfig"
        :candidate-points="candidatePoints"
        :selected-point-ids="selectedPointIds"
        :readonly="readonly"
        mode="edit-candidates"
        @add-point="addCandidatePoint"
        @toggle-point="removeCandidatePointById"
      />
    </section>

    <section class="graph-select-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Correct Points</strong>
          <p class="section-note">Check the candidate points that count as the official correct answer.</p>
        </div>
      </div>
      <div class="graph-select-editor__answer-list">
        <label v-for="(point, index) in candidatePoints" :key="point.id" class="graph-select-editor__answer-option">
          <input type="checkbox" :checked="selectedPointIds.includes(point.id)" :disabled="readonly" @change="toggleCorrectPoint(point.id)" />
          <span>
            <strong>{{ pointDisplayName(point, index) }}</strong>
            <small>({{ point.x }}, {{ point.y }})</small>
          </span>
        </label>
      </div>
      <p class="graph-select-editor__summary"><strong>Correct answer:</strong> {{ correctSummary }}</p>
    </section>

    <section class="graph-select-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Student Preview</strong>
          <p class="section-note">{{ showCandidatePoints ? 'Click candidate points to confirm the student answer flow before saving.' : 'Click anywhere on the graph to test a snapped student coordinate.' }}</p>
        </div>
        <button class="graph-select-editor__preview-clear" type="button" :disabled="!previewHasSelection" @click="clearPreviewSelection">
          Clear Preview
        </button>
      </div>
      <p class="fill-blank-hint">{{ showCandidatePoints ? questionConfig.selection.instruction : questionConfig.interaction.instruction }}</p>
      <GraphSelectPointsPlot
        v-if="showCandidatePoints"
        :question-config="questionConfig"
        :candidate-points="candidatePoints"
        :selected-point-ids="previewSelectedPointIds"
        :correct-point-ids="selectedPointIds"
        :readonly="readonly"
        mode="answer"
        show-correct
        @toggle-point="togglePreviewPoint"
      />
      <GraphSelectPointsPlot
        v-else
        :question-config="questionConfig"
        :plotted-points="previewPlottedPoints"
        :correct-points="correctPointCoordinates"
        :readonly="readonly"
        mode="answer"
        show-correct
        @add-point="addPreviewPoint"
        @remove-point="removePreviewPoint"
      />
      <p class="graph-select-editor__summary"><strong>Preview selection:</strong> {{ previewSummary }}</p>
    </section>
  </div>
</template>

<style scoped>
.graph-select-editor {
  display: grid;
  gap: 12px;
}

.graph-select-editor__intro {
  padding: 12px 14px;
  border: 1px solid rgba(47, 111, 237, 0.16);
  border-radius: 12px;
  background: rgba(47, 111, 237, 0.06);
}

.graph-select-editor__intro strong {
  display: block;
  color: #24314a;
  font-size: 14px;
}

.graph-select-editor__intro p {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 13px;
}

.graph-select-editor__warning-list {
  margin: 0;
  padding: 12px 16px 12px 32px;
  border: 1px solid rgba(213, 126, 0, 0.28);
  border-radius: 12px;
  color: #8a5600;
  background: #fff8e6;
}

.graph-select-editor__section {
  display: grid;
  gap: 12px;
  border: 1px solid rgba(31, 75, 135, 0.12);
  border-radius: 12px;
  padding: 12px;
  background: #ffffff;
}

.graph-select-editor__settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.graph-select-editor__settings-card {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  padding: 10px;
  background: #fbfdff;
}

.graph-select-editor__settings-card--labels {
  grid-column: 1 / -1;
}

.graph-select-editor__settings-card--display {
  align-content: start;
}

.graph-select-editor__settings-card > strong,
.graph-select-editor__settings-card-title strong {
  color: #24314a;
  font-size: 13px;
}

.graph-select-editor__settings-card-title {
  display: grid;
  gap: 3px;
}

.graph-select-editor__settings-card-title span {
  color: var(--color-muted);
  font-size: 12px;
}

.graph-select-editor__settings,
.graph-select-editor__axis-fields,
.graph-select-editor__display-options {
  display: grid;
  gap: 8px;
}

.graph-select-editor__settings {
  grid-template-columns: minmax(180px, 1fr) repeat(2, minmax(110px, 0.45fr));
}

.graph-select-editor__axis-fields {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.graph-select-editor__interaction {
  display: grid;
  grid-template-columns: 120px minmax(220px, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.graph-select-editor__instruction {
  min-width: 0;
}

.graph-select-editor__settings-input {
  min-height: 30px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 12px;
}

.graph-select-editor__settings-input--wide {
  min-width: 180px;
}

.graph-select-editor__toggle {
  align-self: end;
  min-height: 40px;
}

.graph-select-editor__switch {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  padding: 7px 10px;
  color: var(--color-text);
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}

.graph-select-editor__switch input {
  margin: 0;
}

.graph-select-editor__switch:hover {
  border-color: rgba(47, 111, 237, 0.32);
  background: rgba(47, 111, 237, 0.05);
}

.graph-select-editor__switch--inline {
  align-self: end;
  min-height: 34px;
  justify-content: center;
}

.graph-select-editor__add-button {
  appearance: none;
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  border: 1px solid rgba(47, 111, 237, 0.32);
  border-radius: 999px;
  padding: 0 14px;
  color: #ffffff;
  background: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.16);
  transition: background-color 140ms ease, box-shadow 140ms ease, transform 140ms ease, opacity 140ms ease;
}

.graph-select-editor__add-button span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  color: var(--color-primary);
  background: #ffffff;
  line-height: 1;
}

.graph-select-editor__add-button:hover:not(:disabled) {
  background: var(--color-primary-strong);
  box-shadow: 0 10px 22px rgba(47, 111, 237, 0.2);
  transform: translateY(-1px);
}

.graph-select-editor__add-button:focus-visible,
.graph-select-editor__remove-button:focus-visible {
  outline: 2px solid rgba(47, 111, 237, 0.32);
  outline-offset: 2px;
}

.graph-select-editor__add-button:disabled,
.graph-select-editor__remove-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
  transform: none;
}

.graph-select-editor__point-guidance {
  display: grid;
  gap: 3px;
  border: 1px solid rgba(47, 111, 237, 0.14);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(47, 111, 237, 0.05);
}

.graph-select-editor__point-guidance strong {
  color: #24314a;
  font-size: 13px;
}

.graph-select-editor__point-guidance p {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}

.graph-select-editor__point-table {
  display: grid;
  gap: 8px;
}

.graph-select-editor__point-head,
.graph-select-editor__point-row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 110px 110px auto;
  gap: 10px;
  align-items: center;
}

.graph-select-editor__point-row {
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 11px;
  padding: 8px;
  background: #fbfdff;
}

.graph-select-editor__point-head {
  color: #53627a;
  font-size: 13px;
  font-weight: 700;
}

.graph-select-editor__remove-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(199, 55, 71, 0.22);
  border-radius: 999px;
  color: var(--color-danger);
  background: #ffffff;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease, opacity 140ms ease;
}

.graph-select-editor__remove-button:hover:not(:disabled) {
  border-color: rgba(199, 55, 71, 0.38);
  background: #fff4f5;
  transform: translateY(-1px);
}

.graph-select-editor__answer-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.graph-select-editor__answer-option {
  display: inline-flex;
  gap: 10px;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  padding: 9px 10px;
  background: #fbfdff;
  cursor: pointer;
}

.graph-select-editor__answer-option input {
  margin: 0;
}

.graph-select-editor__answer-option span {
  display: grid;
  gap: 2px;
}

.graph-select-editor__answer-option strong {
  color: #24314a;
  font-size: 13px;
}

.graph-select-editor__answer-option small {
  color: var(--color-muted);
  font-size: 12px;
}

.graph-select-editor__summary {
  margin: 0;
  color: #53627a;
  font-size: 13px;
  line-height: 1.5;
}

.graph-select-editor__preview-clear {
  appearance: none;
  min-height: 32px;
  border: 1px solid rgba(47, 111, 237, 0.24);
  border-radius: 999px;
  padding: 0 12px;
  color: var(--color-primary);
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.graph-select-editor__preview-clear:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 760px) {
  .graph-select-editor__settings-grid,
  .graph-select-editor__settings,
  .graph-select-editor__axis-fields {
    grid-template-columns: 1fr;
  }

  .graph-select-editor__point-head {
    display: none;
  }

  .graph-select-editor__point-row {
    grid-template-columns: 1fr;
  }
}
</style>
