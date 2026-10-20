<script setup>
import { computed } from 'vue';

import {
  createDefaultSolutionSetCorrectAnswerData,
  formatSolutionSetAnswer,
  normalizeSolutionSetAnswerData,
  normalizeSolutionSetConfig,
  rayOptions,
} from './helpers';
import SolutionSetNumberLine from './SolutionSetNumberLine.vue';

const props = defineProps({
  question: {
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

const questionConfig = computed(() => normalizeSolutionSetConfig(props.question.questionConfig));
const answerData = computed(() => normalizeSolutionSetAnswerData(props.modelValue, questionConfig.value));
const solution = computed(() => answerData.value.solution);
const options = computed(rayOptions);
const selectedSummary = computed(() => formatSolutionSetAnswer(answerData.value, questionConfig.value, 'No ray selected'));

function updateSolution(patch) {
  if (props.readonly) {
    return;
  }
  const base = solution.value || createDefaultSolutionSetCorrectAnswerData().solution;
  emit('update:modelValue', {
    solution: {
      ...base,
      ...patch,
    },
  });
}

function selectRay(option) {
  updateSolution({
    direction: option.direction,
    endpointIncluded: option.endpointIncluded,
  });
}
</script>

<template>
  <div class="solution-answer" :class="{ 'solution-answer--compact': compact }">
    <p class="fill-blank-hint">{{ questionConfig.instruction }}</p>

    <section class="solution-answer__step">
      <div class="solution-answer__step-header">
        <span class="solution-answer__step-kicker">Step 1</span>
        <h4>Choose the ray type</h4>
      </div>

      <div class="solution-answer__ray-picker" aria-label="Ray options">
        <button
          v-for="option in options"
          :key="`${option.direction}-${option.endpointIncluded}`"
          type="button"
          class="solution-answer__ray-button"
          :class="{ 'is-selected': solution?.direction === option.direction && solution?.endpointIncluded === option.endpointIncluded }"
          :disabled="readonly"
          @click="selectRay(option)"
        >
          <span class="solution-answer__ray-symbol">{{ option.symbol }}</span>
          <span class="solution-answer__ray-label">{{ option.label }}</span>
          <span class="solution-answer__selected-badge">Selected</span>
        </button>
      </div>
    </section>

    <section class="solution-answer__step solution-answer__step--line">
      <div class="solution-answer__step-header">
        <span class="solution-answer__step-kicker">Step 2</span>
        <h4>Move the endpoint</h4>
        <p>Click a tick on the number line.</p>
      </div>

      <SolutionSetNumberLine
        :question-config="questionConfig"
        :model-value="answerData"
        :readonly="readonly"
        :compact="compact"
        @update:model-value="$emit('update:modelValue', $event)"
      />

      <p class="solution-answer__summary">Current answer: <strong>{{ selectedSummary }}</strong></p>
    </section>
  </div>
</template>

<style scoped>
.solution-answer {
  display: grid;
  gap: 12px;
  font-size: var(--exam-answer-size, 15px);
}

.solution-answer--compact {
  gap: 10px;
}

.solution-answer__step {
  display: grid;
  gap: 8px;
}

.solution-answer__step--line {
  gap: 8px;
}

.solution-answer__step-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 10px;
}

.solution-answer__step-header h4 {
  margin: 0;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 800;
}

.solution-answer__step-header p {
  flex-basis: 100%;
  margin: -2px 0 0;
  color: var(--color-text-muted);
  font-size: 11px;
}

.solution-answer__step-kicker {
  border-radius: 999px;
  padding: 3px 7px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.solution-answer__ray-picker {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}

.solution-answer__ray-button {
  position: relative;
  display: grid;
  gap: 5px;
  align-items: center;
  justify-items: center;
  min-height: 62px;
  padding: 8px;
  border: 2px solid var(--color-border);
  border-radius: 12px;
  background: #ffffff;
  color: #172033;
  box-shadow: 0 8px 18px rgba(20, 48, 89, 0.06);
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}

.solution-answer__ray-button:hover:not(:disabled) {
  border-color: rgba(47, 111, 237, 0.55);
  transform: translateY(-1px);
}

.solution-answer__ray-symbol {
  font-size: 1.6em;
  font-weight: 800;
  line-height: 1;
}

.solution-answer__ray-label {
  color: var(--color-text);
  font-size: inherit;
  font-weight: 800;
  line-height: 1.2;
  text-align: center;
}

.solution-answer__selected-badge {
  display: none;
  border-radius: 999px;
  padding: 2px 6px;
  color: #ffffff;
  background: var(--color-primary);
  font-size: var(--exam-caption-size, 12px);
  font-weight: 800;
  line-height: 1;
}

.solution-answer__ray-button.is-selected {
  border-color: var(--color-primary);
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.14), rgba(47, 111, 237, 0.06));
  box-shadow: 0 12px 24px rgba(47, 111, 237, 0.16), inset 0 0 0 1px rgba(47, 111, 237, 0.25);
}

.solution-answer__ray-button.is-selected .solution-answer__selected-badge {
  display: inline-flex;
}

.solution-answer__ray-button:disabled {
  cursor: not-allowed;
}

.solution-answer__summary {
  justify-self: center;
  margin: 2px 0 0;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 5px 10px;
  color: var(--color-text-muted);
  background: #fbfdff;
  font-size: var(--exam-caption-size, 12px);
}

.solution-answer__summary strong {
  color: var(--color-text);
}

.solution-answer--compact .solution-answer__ray-picker {
  gap: 7px;
}

.solution-answer--compact .solution-answer__ray-button {
  min-height: 64px;
  border-radius: 13px;
  padding: 8px;
}

.solution-answer--compact .solution-answer__ray-symbol {
  font-size: 1.6em;
}

.solution-answer--compact .solution-answer__ray-label {
  font-size: inherit;
  line-height: 1.15;
}

.solution-answer--compact .solution-answer__selected-badge,
.solution-answer--compact .solution-answer__summary,
.solution-answer--compact .solution-answer__step-header p {
  display: none;
}

@media (max-width: 720px) {
  .solution-answer__ray-picker {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
