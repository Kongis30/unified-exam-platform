<script setup>
import { computed } from 'vue';

import {
  GRAPH_SELECT_POINTS_MODE,
  formatGraphPoints,
  formatSelectedPoints,
  normalizeGraphConfig,
} from './helpers';

const props = defineProps({
  questionConfig: {
    type: Object,
    required: true,
  },
  plottedPoints: {
    type: Array,
    default: () => [],
  },
  candidatePoints: {
    type: Array,
    default: () => [],
  },
  selectedPointIds: {
    type: Array,
    default: () => [],
  },
  correctPointIds: {
    type: Array,
    default: () => [],
  },
  correctPoints: {
    type: Array,
    default: () => [],
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  showCorrect: {
    type: Boolean,
    default: false,
  },
  mode: {
    type: String,
    default: 'answer',
  },
});

const emit = defineEmits(['add-point', 'remove-point', 'toggle-point']);

const width = 680;
const height = 420;
const padding = {
  top: 52,
  right: 36,
  bottom: 70,
  left: 78,
};

const config = computed(() => normalizeGraphConfig(props.questionConfig));
const graph = computed(() => config.value.graph);
const isSelectPointsMode = computed(() => config.value.graphMode === GRAPH_SELECT_POINTS_MODE);
const isCandidateEditor = computed(() => props.mode === 'edit-candidates');
const isCandidatePointView = computed(() => isSelectPointsMode.value || isCandidateEditor.value);
const points = computed(() => props.plottedPoints);
const candidatePoints = computed(() => props.candidatePoints.length ? props.candidatePoints : config.value.points);
const selectedPointIdSet = computed(() => new Set(props.selectedPointIds));
const correctPointIdSet = computed(() => new Set(props.correctPointIds));
const plotWidth = computed(() => width - padding.left - padding.right);
const plotHeight = computed(() => height - padding.top - padding.bottom);
const xTicks = computed(() => buildTicks(graph.value.xMin, graph.value.xMax, graph.value.xStep));
const yTicks = computed(() => buildTicks(graph.value.yMin, graph.value.yMax, graph.value.yStep));
const plottedSummary = computed(() => {
  return isCandidatePointView.value
    ? isSelectPointsMode.value
      ? formatSelectedPoints(props.selectedPointIds, candidatePoints.value, 'No points selected.')
      : formatGraphPoints(candidatePoints.value, 'No candidate points added.')
    : isSelectPointsMode.value
    ? formatSelectedPoints(props.selectedPointIds, candidatePoints.value, 'No points selected.')
    : formatGraphPoints(points.value, 'No points plotted.');
});

function buildTicks(min, max, step) {
  const ticks = [];
  const safeStep = step > 0 ? step : 1;
  const maxTicks = 80;

  for (let value = min, index = 0; value <= max + safeStep / 1000 && index < maxTicks; value += safeStep, index += 1) {
    ticks.push(Number(value.toFixed(8)));
  }

  return ticks;
}

function xToSvg(x) {
  return padding.left + ((Number(x) - graph.value.xMin) / (graph.value.xMax - graph.value.xMin)) * plotWidth.value;
}

function yToSvg(y) {
  return padding.top + plotHeight.value - ((Number(y) - graph.value.yMin) / (graph.value.yMax - graph.value.yMin)) * plotHeight.value;
}

function svgToPoint(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const svgX = ((event.clientX - rect.left) / rect.width) * width;
  const svgY = ((event.clientY - rect.top) / rect.height) * height;
  const clampedX = Math.min(Math.max(svgX, padding.left), padding.left + plotWidth.value);
  const clampedY = Math.min(Math.max(svgY, padding.top), padding.top + plotHeight.value);
  const x = graph.value.xMin + ((clampedX - padding.left) / plotWidth.value) * (graph.value.xMax - graph.value.xMin);
  const y = graph.value.yMin + ((padding.top + plotHeight.value - clampedY) / plotHeight.value) * (graph.value.yMax - graph.value.yMin);

  return {
    x: snapToStep(x, graph.value.xMin, graph.value.xStep),
    y: snapToStep(y, graph.value.yMin, graph.value.yStep),
  };
}

function snapToStep(value, min, step) {
  if (!config.value.interaction.snapToGrid || !step || step <= 0) {
    return Number(value.toFixed(2));
  }

  return Number((Math.round((value - min) / step) * step + min).toFixed(8));
}

function handlePlotClick(event) {
  if (props.readonly) {
    return;
  }
  if (isCandidateEditor.value) {
    emit('add-point', svgToPoint(event));
    return;
  }
  if (isSelectPointsMode.value && props.mode !== 'edit-candidates') {
    return;
  }
  if (!isSelectPointsMode.value && !['edit', 'answer'].includes(props.mode)) {
    return;
  }

  emit('add-point', svgToPoint(event));
}

function removePoint(index) {
  if (props.readonly) {
    return;
  }

  emit('remove-point', index);
}

function togglePoint(point) {
  if (props.readonly) {
    return;
  }

  emit('toggle-point', point.id);
}

function pointLabel(point) {
  return point.label || `(${point.x}, ${point.y})`;
}

function isCorrectPoint(point) {
  return props.correctPoints.some((correctPoint) => correctPoint.x === point.x && correctPoint.y === point.y);
}

function isSelectedCandidate(point) {
  return selectedPointIdSet.value.has(point.id);
}

function isCorrectCandidate(point) {
  return correctPointIdSet.value.has(point.id);
}
</script>

<template>
  <figure class="graph-plot">
    <svg
      class="graph-plot__svg"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      :aria-label="graph.title || 'Coordinate graph'"
      @click="handlePlotClick"
    >
      <defs>
        <marker id="graph-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" />
        </marker>
      </defs>
      <text v-if="graph.title" class="graph-plot__title" :x="width / 2" y="26" text-anchor="middle">{{ graph.title }}</text>

      <g v-if="graph.showGrid" class="graph-plot__grid">
        <line
          v-for="tick in xTicks"
          :key="`x-grid-${tick}`"
          :x1="xToSvg(tick)"
          :x2="xToSvg(tick)"
          :y1="padding.top"
          :y2="padding.top + plotHeight"
          :class="{ 'is-axis': tick === 0 }"
        />
        <line
          v-for="tick in yTicks"
          :key="`y-grid-${tick}`"
          :x1="padding.left"
          :x2="padding.left + plotWidth"
          :y1="yToSvg(tick)"
          :y2="yToSvg(tick)"
          :class="{ 'is-axis': tick === 0 }"
        />
      </g>

      <g class="graph-plot__axes">
        <line :x1="padding.left" :x2="padding.left + plotWidth" :y1="padding.top + plotHeight" :y2="padding.top + plotHeight" :marker-end="graph.showAxisArrows ? 'url(#graph-arrow)' : null" />
        <line :x1="padding.left" :x2="padding.left" :y1="padding.top + plotHeight" :y2="padding.top" :marker-end="graph.showAxisArrows ? 'url(#graph-arrow)' : null" />
      </g>

      <g class="graph-plot__ticks">
        <g v-for="tick in xTicks" :key="`x-tick-${tick}`">
          <line :x1="xToSvg(tick)" :x2="xToSvg(tick)" :y1="padding.top + plotHeight" :y2="padding.top + plotHeight + 6" />
          <text :x="xToSvg(tick)" :y="padding.top + plotHeight + 22" text-anchor="middle">{{ tick }}</text>
        </g>
        <g v-for="tick in yTicks" :key="`y-tick-${tick}`">
          <line :x1="padding.left - 6" :x2="padding.left" :y1="yToSvg(tick)" :y2="yToSvg(tick)" />
          <text :x="padding.left - 12" :y="yToSvg(tick) + 4" text-anchor="end">{{ tick }}</text>
        </g>
      </g>

      <text class="graph-plot__label" :x="padding.left + plotWidth / 2" :y="height - 20" text-anchor="middle">{{ graph.xLabel }}</text>
      <text class="graph-plot__label" :x="24" :y="padding.top + plotHeight / 2" text-anchor="middle" transform="rotate(-90 24 210)">{{ graph.yLabel }}</text>

      <g v-if="isCandidatePointView" class="graph-plot__points">
        <g
          v-for="point in candidatePoints"
          :key="point.id"
          class="graph-plot__point"
          :class="{
            'is-selected': isSelectedCandidate(point),
            'is-correct': showCorrect && isCorrectCandidate(point),
            'is-readonly': readonly,
          }"
          role="button"
          tabindex="0"
          :aria-pressed="isSelectedCandidate(point) ? 'true' : 'false'"
          :aria-label="`${pointLabel(point)} candidate point. ${isSelectedCandidate(point) ? 'Selected.' : 'Not selected.'}`"
          @click.stop="togglePoint(point)"
          @keydown.enter.prevent="togglePoint(point)"
          @keydown.space.prevent="togglePoint(point)"
        >
          <circle :cx="xToSvg(point.x)" :cy="yToSvg(point.y)" r="8" />
          <text v-if="point.label" :x="xToSvg(point.x) + 12" :y="yToSvg(point.y) - 10">{{ point.label }}</text>
        </g>
      </g>

      <g v-else class="graph-plot__points">
        <g
          v-for="(point, index) in points"
          :key="`${point.x}-${point.y}-${index}`"
          class="graph-plot__point"
          :class="{
            'is-selected': true,
            'is-correct': showCorrect && isCorrectPoint(point),
            'is-readonly': readonly,
          }"
          role="button"
          tabindex="0"
          aria-pressed="true"
          :aria-label="`${pointLabel(point)} plotted. Activate to remove.`"
          @click.stop="removePoint(index)"
          @keydown.enter.prevent="removePoint(index)"
          @keydown.space.prevent="removePoint(index)"
        >
          <circle :cx="xToSvg(point.x)" :cy="yToSvg(point.y)" r="8" />
          <text v-if="point.label" :x="xToSvg(point.x) + 12" :y="yToSvg(point.y) - 10">{{ point.label }}</text>
        </g>
      </g>
    </svg>
    <figcaption class="graph-plot__summary">{{ plottedSummary }}</figcaption>
  </figure>
</template>

<style scoped>
.graph-plot {
  margin: 0;
}

.graph-plot__svg {
  width: 100%;
  max-width: 760px;
  height: auto;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #ffffff;
}

.graph-plot__title,
.graph-plot__label {
  fill: #24314a;
  font-weight: 700;
}

.graph-plot__grid line {
  stroke: #dbe4f0;
  stroke-width: 1;
}

.graph-plot__grid line.is-axis {
  stroke: #9aa8bd;
  stroke-width: 1.5;
}

.graph-plot__axes line {
  stroke: #24314a;
  stroke-width: 2;
}

.graph-plot__axes path,
.graph-plot marker path {
  fill: #24314a;
}

.graph-plot__ticks line {
  stroke: #53627a;
}

.graph-plot__ticks text {
  fill: #53627a;
  font-size: 12px;
}

.graph-plot__point {
  cursor: pointer;
  outline: none;
}

.graph-plot__point circle {
  fill: #ffffff;
  stroke: var(--color-primary);
  stroke-width: 3;
  transition: fill 160ms ease, stroke 160ms ease, transform 160ms ease;
}

.graph-plot__point text {
  fill: #24314a;
  font-size: 13px;
  font-weight: 700;
}

.graph-plot__point.is-selected circle {
  fill: var(--color-primary);
  stroke: #163f96;
}

.graph-plot__point.is-correct circle {
  stroke: var(--color-success);
  stroke-width: 4;
}

.graph-plot__point:focus-visible circle {
  stroke-width: 5;
}

.graph-plot__point.is-readonly {
  cursor: default;
}

.graph-plot__summary {
  margin-top: 8px;
  color: #53627a;
  font-size: 14px;
}
</style>
