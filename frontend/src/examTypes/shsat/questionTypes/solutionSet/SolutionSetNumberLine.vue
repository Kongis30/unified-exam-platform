<script setup>
import { computed } from 'vue';

import {
  buildNumberLineTicks,
  normalizeSolutionSetAnswerData,
  normalizeSolutionSetConfig,
} from './helpers';

const props = defineProps({
  questionConfig: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: [Object, String],
    default: () => ({}),
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  compact: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const width = 720;
const height = 118;
const padding = { left: 58, right: 58, top: 26, bottom: 32 };

const config = computed(() => normalizeSolutionSetConfig(props.questionConfig));
const line = computed(() => config.value.numberLine);
const ticks = computed(() => buildNumberLineTicks(config.value));
const solution = computed(() => normalizeSolutionSetAnswerData(props.modelValue, config.value).solution);
const plotWidth = computed(() => width - padding.left - padding.right);
const axisY = computed(() => Math.round(height / 2));

function valueToX(value) {
  return padding.left + ((value - line.value.min) / (line.value.max - line.value.min)) * plotWidth.value;
}

function updateEndpoint(endpoint) {
  if (props.readonly || !solution.value) {
    return;
  }
  emit('update:modelValue', {
    solution: {
      ...solution.value,
      endpoint,
    },
  });
}

function selectTick(value) {
  updateEndpoint(value);
}

function rayLineCoordinates() {
  if (!solution.value) {
    return { x1: valueToX(line.value.min), x2: valueToX(line.value.max) };
  }
  const endpointX = valueToX(solution.value.endpoint);
  return solution.value.direction === 'right'
    ? { x1: endpointX, x2: valueToX(line.value.max) }
    : { x1: valueToX(line.value.min), x2: endpointX };
}
</script>

<template>
  <figure class="solution-line" :class="{ 'solution-line--compact': compact }">
    <svg class="solution-line__svg" :viewBox="`0 0 ${width} ${height}`" role="img" aria-label="Number line solution set">
      <defs>
        <marker id="solution-arrow-right" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8" fill="#172033" />
        </marker>
        <marker id="solution-arrow-left" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto">
          <path d="M8,0 L0,4 L8,8" fill="#172033" />
        </marker>
      </defs>

      <line
        :x1="padding.left"
        :x2="width - padding.right"
        :y1="axisY"
        :y2="axisY"
        stroke="#172033"
        stroke-width="3"
        :marker-start="line.showArrows ? 'url(#solution-arrow-left)' : ''"
        :marker-end="line.showArrows ? 'url(#solution-arrow-right)' : ''"
      />

      <g v-if="solution" class="solution-line__answer">
        <line
          :x1="rayLineCoordinates().x1"
          :x2="rayLineCoordinates().x2"
          :y1="axisY"
          :y2="axisY"
          stroke="#2f6fed"
          stroke-width="5"
          stroke-linecap="round"
          :marker-start="solution.direction === 'left' ? 'url(#solution-arrow-left)' : ''"
          :marker-end="solution.direction === 'right' ? 'url(#solution-arrow-right)' : ''"
        />
        <circle
          :cx="valueToX(solution.endpoint)"
          :cy="axisY"
          r="8"
          :fill="solution.endpointIncluded ? '#111827' : '#ffffff'"
          stroke="#111827"
          stroke-width="3"
        />
      </g>

      <g v-for="tick in ticks" :key="tick" class="solution-line__tick">
        <line :x1="valueToX(tick)" :x2="valueToX(tick)" :y1="axisY - 22" :y2="axisY + 22" stroke="#172033" stroke-width="2.5" />
        <text :x="valueToX(tick)" :y="axisY - 32" text-anchor="middle">{{ tick }}</text>
        <circle class="solution-line__hit" :cx="valueToX(tick)" :cy="axisY" r="16" @click="selectTick(tick)" />
      </g>
    </svg>
  </figure>
</template>

<style scoped>
.solution-line {
  display: grid;
  gap: 6px;
  margin: 0;
}

.solution-line__svg {
  width: 100%;
  min-height: 118px;
}

.solution-line__tick text {
  fill: #24314a;
  font-size: 15px;
  font-weight: 700;
}

.solution-line__answer {
  pointer-events: none;
}

.solution-line__hit {
  fill: transparent;
  cursor: pointer;
}

.solution-line--compact {
  gap: 2px;
}

.solution-line--compact .solution-line__svg {
  min-height: 100px;
}

.solution-line--compact .solution-line__tick text {
  font-size: 13px;
}

</style>
