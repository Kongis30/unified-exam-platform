<script setup>
import { computed } from 'vue';

import {
  createDefaultSolutionSetCorrectAnswerData,
  formatSolutionSetAnswer,
  getSolutionSetValidationIssues,
  normalizeSolutionSetAnswerData,
  normalizeSolutionSetConfig,
} from './helpers';
import SolutionSetAnswer from './SolutionSetAnswer.vue';

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

const questionConfig = computed(() => normalizeSolutionSetConfig(props.question.questionConfig));
const correctAnswerData = computed(() => normalizeSolutionSetAnswerData(props.question.correctAnswerData, questionConfig.value));
const validationIssues = computed(() => getSolutionSetValidationIssues(props.question));
const answerSummary = computed(() => formatSolutionSetAnswer(correctAnswerData.value, questionConfig.value));

function patchEditor(nextConfig = questionConfig.value, nextCorrectAnswerData = correctAnswerData.value) {
  if (props.readonly) {
    return;
  }
  emit('patch', {
    options: [],
    questionConfig: nextConfig,
    correctAnswerData: nextCorrectAnswerData,
  });
  emit('dirty');
}

function updateLine(fieldName, value) {
  const nextLine = {
    ...questionConfig.value.numberLine,
    [fieldName]: Number.parseFloat(value),
  };
  patchEditor({
    ...questionConfig.value,
    numberLine: nextLine,
  });
}

function updateInstruction(value) {
  patchEditor({
    ...questionConfig.value,
    instruction: value,
  });
}

function updateCorrectAnswer(value) {
  patchEditor(questionConfig.value, normalizeSolutionSetAnswerData(value, questionConfig.value));
}

function resetCorrectAnswer() {
  patchEditor(questionConfig.value, createDefaultSolutionSetCorrectAnswerData());
}
</script>

<template>
  <div class="type-editor-panel solution-editor">
    <div class="solution-editor__intro">
      <div>
        <strong>Build a solution set question</strong>
        <p>Use this for number-line ray answers such as x ≥ 1 or x &lt; -2.</p>
      </div>
      <button class="text-button" type="button" :disabled="readonly" @click="resetCorrectAnswer">Reset Answer</button>
    </div>

    <ul v-if="validationIssues.length" class="solution-editor__warning-list">
      <li v-for="issue in validationIssues" :key="issue">{{ issue }}</li>
    </ul>

    <div class="solution-editor__main">
      <section class="solution-editor__section solution-editor__section--settings">
        <div class="solution-editor__section-header">
          <div>
            <strong>Number Line</strong>
            <p>Set the visible range and tick interval.</p>
          </div>
        </div>
        <div class="solution-editor__settings">
          <label class="form-field">
            <span class="form-label">Min</span>
            <input class="form-input" type="number" step="any" :value="questionConfig.numberLine.min" :disabled="readonly" @input="updateLine('min', $event.target.value)" />
          </label>
          <label class="form-field">
            <span class="form-label">Max</span>
            <input class="form-input" type="number" step="any" :value="questionConfig.numberLine.max" :disabled="readonly" @input="updateLine('max', $event.target.value)" />
          </label>
          <label class="form-field">
            <span class="form-label">Step</span>
            <input class="form-input" type="number" step="any" min="0.1" :value="questionConfig.numberLine.step" :disabled="readonly" @input="updateLine('step', $event.target.value)" />
          </label>
        </div>
        <label class="form-field">
          <span class="form-label">Student Instruction</span>
          <textarea class="form-input solution-editor__instruction" rows="2" :value="questionConfig.instruction" :disabled="readonly" @input="updateInstruction($event.target.value)"></textarea>
        </label>
      </section>

      <section class="solution-editor__section solution-editor__section--answer">
        <div class="solution-editor__section-header">
          <div>
            <strong>Correct Ray</strong>
            <p>Select the ray type and click the number line endpoint.</p>
          </div>
          <span class="solution-editor__summary">{{ answerSummary }}</span>
        </div>
        <SolutionSetAnswer
          :question="{ ...question, questionConfig }"
          :model-value="correctAnswerData"
          :readonly="readonly"
          compact
          @update:model-value="updateCorrectAnswer"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.solution-editor {
  display: grid;
  gap: 10px;
}

.solution-editor__intro,
.solution-editor__section {
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fbfcfe;
}

.solution-editor__intro {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border-color: rgba(47, 111, 237, 0.16);
  background: rgba(47, 111, 237, 0.06);
}

.solution-editor__main {
  display: grid;
  grid-template-columns: minmax(220px, 0.44fr) minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.solution-editor strong {
  display: block;
  color: #24314a;
  font-size: 14px;
}

.solution-editor p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.solution-editor__warning-list {
  margin: 0;
  padding: 10px 14px 10px 30px;
  border: 1px solid rgba(213, 126, 0, 0.28);
  border-radius: 10px;
  color: #8a5600;
  background: #fff8e6;
}

.solution-editor__section-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}

.solution-editor__settings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.solution-editor__instruction {
  min-height: 56px;
  resize: vertical;
}

.solution-editor__summary {
  padding: 5px 9px;
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.1);
  color: #1f4fa8;
  font-size: 12px;
  font-weight: 700;
}

@media (max-width: 920px) {
  .solution-editor__main {
    grid-template-columns: 1fr;
  }
}
</style>
