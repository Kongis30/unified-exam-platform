<script setup>
import { computed } from 'vue';

import GraphSelectPointsPlot from './GraphSelectPointsPlot.vue';
import {
  GRAPH_SELECT_POINTS_MODE,
  formatGraphPoints,
  formatSelectedPoints,
  normalizeGraphAnswerPoints,
  normalizeGraphConfig,
  normalizeSelectedPointIds,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: [Object, Array, String, Number, Boolean],
    default: '',
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  answersVisible: {
    type: Boolean,
    default: false,
  },
  correctAnswerData: {
    type: [Object, String, null],
    default: null,
  },
});

const emit = defineEmits(['update:modelValue', 'change']);

const questionConfig = computed(() => normalizeGraphConfig(props.question.questionConfig));
const isSelectPointsMode = computed(() => questionConfig.value.graphMode === GRAPH_SELECT_POINTS_MODE);
const candidatePoints = computed(() => questionConfig.value.points);
const selectedPointIds = computed(() => normalizeSelectedPointIds(props.modelValue, candidatePoints.value));
const correctPointIds = computed(() => normalizeSelectedPointIds(
  props.correctAnswerData || props.question.correctAnswerData || props.question.correctAnswer,
  candidatePoints.value
));
const plottedPoints = computed(() => normalizeGraphAnswerPoints(props.modelValue, questionConfig.value));
const correctPoints = computed(() => normalizeGraphAnswerPoints(
  props.correctAnswerData || props.question.correctAnswerData || props.question.correctAnswer,
  questionConfig.value
));
const instruction = computed(() => {
  return isSelectPointsMode.value
    ? questionConfig.value.selection.instruction
    : questionConfig.value.interaction.instruction;
});
const selectedSummary = computed(() => {
  return isSelectPointsMode.value
    ? formatSelectedPoints(selectedPointIds.value, candidatePoints.value, 'No points selected.')
    : formatGraphPoints(plottedPoints.value, 'No points plotted.');
});
const correctSummary = computed(() => {
  return isSelectPointsMode.value
    ? formatSelectedPoints(correctPointIds.value, candidatePoints.value, 'No correct points returned.')
    : formatGraphPoints(correctPoints.value, 'No correct points returned.');
});

function togglePoint(pointId) {
  if (props.readonly) {
    return;
  }

  const nextSelectedPointIds = selectedPointIds.value.includes(pointId)
    ? selectedPointIds.value.filter((id) => id !== pointId)
    : [...selectedPointIds.value, pointId];
  const nextAnswer = { selectedPointIds: nextSelectedPointIds };

  emit('update:modelValue', nextAnswer);
  emit('change', nextAnswer);
}

function addPoint(point) {
  if (props.readonly) {
    return;
  }
  if (plottedPoints.value.some((existingPoint) => existingPoint.x === point.x && existingPoint.y === point.y)) {
    return;
  }

  const nextPoints = [...plottedPoints.value, point];
  const nextAnswer = { points: nextPoints };

  emit('update:modelValue', nextAnswer);
  emit('change', nextAnswer);
}

function removePoint(index) {
  if (props.readonly) {
    return;
  }

  const nextAnswer = { points: plottedPoints.value.filter((_, pointIndex) => pointIndex !== index) };

  emit('update:modelValue', nextAnswer);
  emit('change', nextAnswer);
}

function clearSelection() {
  if (props.readonly) {
    return;
  }

  const nextAnswer = isSelectPointsMode.value ? { selectedPointIds: [] } : { points: [] };
  emit('update:modelValue', nextAnswer);
  emit('change', nextAnswer);
}
</script>

<template>
  <div class="structured-answer graph-select-answer">
    <p class="fill-blank-hint">{{ instruction }}</p>
    <GraphSelectPointsPlot
      v-if="isSelectPointsMode"
      :question-config="questionConfig"
      :candidate-points="candidatePoints"
      :selected-point-ids="selectedPointIds"
      :correct-point-ids="correctPointIds"
      :readonly="readonly"
      :show-correct="answersVisible"
      mode="answer"
      @toggle-point="togglePoint"
    />
    <GraphSelectPointsPlot
      v-else
      :question-config="questionConfig"
      :plotted-points="plottedPoints"
      :correct-points="correctPoints"
      :readonly="readonly"
      :show-correct="answersVisible"
      mode="answer"
      @add-point="addPoint"
      @remove-point="removePoint"
    />
    <div class="graph-select-answer__footer">
      <p class="graph-select-answer__summary">
        <strong>{{ isSelectPointsMode ? 'Selected points' : 'Plotted points' }}:</strong> {{ selectedSummary }}
      </p>
      <button
        v-if="!readonly"
        class="text-button"
        type="button"
        :disabled="isSelectPointsMode ? selectedPointIds.length === 0 : plottedPoints.length === 0"
        @click="clearSelection"
      >
        Clear Selection
      </button>
    </div>
    <p v-if="answersVisible" class="graph-select-answer__correct-reference">
      <strong>Correct answer:</strong> {{ correctSummary }}
    </p>
  </div>
</template>

<style scoped>
.graph-select-answer {
  display: grid;
  gap: 10px;
}

.graph-select-answer__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.graph-select-answer__summary,
.graph-select-answer__correct-reference {
  margin: 0;
  color: #53627a;
  font-size: calc(13px * var(--exam-font-scale));
  line-height: 1.5;
}

.graph-select-answer__correct-reference {
  color: #176b3a;
}

.text-button {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  min-height: 30px;
  padding: 0 10px;
  color: var(--color-primary);
  background: #ffffff;
  font-weight: 700;
  cursor: pointer;
}

.text-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
