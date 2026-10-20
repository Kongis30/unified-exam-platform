<script setup>
import { computed } from 'vue';

import EquationEditorAnswer from './EquationEditorAnswer.vue';
import {
  TOOL_GROUPS,
  createDefaultEquationConfig,
  getEquationValidationIssues,
  normalizeAcceptedAnswers,
  normalizeEquationConfig,
  normalizeVariables,
} from './helpers';

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

const questionConfig = computed(() => normalizeEquationConfig(props.question.questionConfig));
const acceptedAnswers = computed(() => normalizeAcceptedAnswers(props.question.correctAnswerData, { keepBlank: true }));
const validationIssues = computed(() => getEquationValidationIssues(props.question));
const configurableToolGroups = computed(() => TOOL_GROUPS.filter((group) => !group.legacy));
const enabledToolSummary = computed(() => {
  const enabledTools = new Set(questionConfig.value.enabledTools);
  const enabledGroups = configurableToolGroups.value.filter((group) => enabledTools.has(group.key));

  if (!enabledGroups.length) {
    return 'No keypad groups selected. Students can still type directly.';
  }

  return `${enabledGroups.length} keypad group${enabledGroups.length === 1 ? '' : 's'} enabled.`;
});

function patchEditor(nextConfig, nextAnswers = acceptedAnswers.value) {
  if (props.readonly) {
    return;
  }

  emit('patch', {
    options: [],
    questionConfig: {
      ...questionConfig.value,
      ...nextConfig,
    },
    correctAnswerData: {
      acceptedAnswers: nextAnswers,
    },
  });
  emit('dirty');
}

function updateConfigField(fieldName, value) {
  patchEditor({ [fieldName]: value });
}

function updateVariables(value) {
  patchEditor({ variables: normalizeVariables(value) });
}

function toggleTool(toolKey) {
  const currentTools = new Set(questionConfig.value.enabledTools);
  if (currentTools.has(toolKey)) {
    currentTools.delete(toolKey);
  } else {
    currentTools.add(toolKey);
  }
  patchEditor({ enabledTools: [...currentTools] });
}

function addAnswer() {
  patchEditor({}, [...acceptedAnswers.value, { value: '', compareMode: 'normalized_exact' }]);
}

function updateAnswer(index, value) {
  patchEditor({}, acceptedAnswers.value.map((answer, answerIndex) => (
    answerIndex === index ? { ...answer, value } : answer
  )));
}

function removeAnswer(index) {
  patchEditor({}, acceptedAnswers.value.filter((_, answerIndex) => answerIndex !== index));
}
</script>

<template>
  <div class="type-editor-panel equation-editor">
    <div class="equation-editor__intro">
      <strong>Build a math input question</strong>
      <p>Students type a number, expression, or equation using the input box and math keyboard.</p>
    </div>

    <ul v-if="validationIssues.length" class="equation-editor__warning-list">
      <li v-for="issue in validationIssues" :key="issue">{{ issue }}</li>
    </ul>

    <section class="equation-editor__section">
      <div class="equation-editor__section-header">
        <span class="equation-editor__eyebrow">Setup</span>
        <div>
          <strong>Editor setup</strong>
          <p>Choose what kind of math response students should enter.</p>
        </div>
      </div>
      <div class="equation-editor__setup-grid">
        <label>
          <span>Answer type</span>
          <select class="form-input" :value="questionConfig.editorMode" :disabled="readonly" @change="updateConfigField('editorMode', $event.target.value)">
            <option value="number">Number</option>
            <option value="expression">Expression</option>
            <option value="equation">Equation</option>
          </select>
        </label>
        <label>
          <span>Variables</span>
          <input class="form-input" :value="questionConfig.variables.join(', ')" :disabled="readonly" placeholder="x, y" @input="updateVariables($event.target.value)" />
        </label>
      </div>
      <label>
        <span>Student instruction</span>
        <input class="form-input" :value="questionConfig.placeholder" :disabled="readonly" placeholder="Enter only the equation." @input="updateConfigField('placeholder', $event.target.value)" />
      </label>
    </section>

    <section class="equation-editor__section">
      <div class="equation-editor__section-header">
        <span class="equation-editor__eyebrow">Tools</span>
        <div>
          <strong>Student input tools</strong>
          <p>{{ enabledToolSummary }} Typing directly is still allowed.</p>
        </div>
      </div>
      <div class="equation-editor__tool-grid">
        <label v-for="group in configurableToolGroups" :key="group.key" class="equation-editor__tool-card">
          <input type="checkbox" :checked="questionConfig.enabledTools.includes(group.key)" :disabled="readonly" @change="toggleTool(group.key)" />
          <span>
            <strong>{{ group.label }}</strong>
            <small>{{ group.description }}</small>
          </span>
        </label>
      </div>
    </section>

    <section class="equation-editor__section">
      <div class="equation-editor__section-header">
        <span class="equation-editor__eyebrow">Answers</span>
        <div>
          <strong>Accepted answers</strong>
          <p>The system ignores spaces and normalizes basic operators before comparing.</p>
        </div>
        <button class="equation-editor__add-button" type="button" :disabled="readonly" @click="addAnswer">
          <span aria-hidden="true">+</span>
          Add Answer
        </button>
      </div>
      <div class="equation-editor__answer-list">
        <div v-for="(answer, index) in acceptedAnswers" :key="index" class="equation-editor__answer-row">
          <EquationEditorAnswer
            :question="{ ...question, questionConfig }"
            :model-value="{ value: answer.value }"
            :readonly="readonly"
            compact
            :label="`Accepted answer ${index + 1}`"
            @update:model-value="updateAnswer(index, $event.value)"
          />
          <button class="equation-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove answer" @click="removeAnswer(index)">×</button>
        </div>
      </div>
      <button class="equation-editor__add-inline-button" type="button" :disabled="readonly" @click="addAnswer">Add another accepted answer</button>
    </section>

    <section class="equation-editor__section">
      <div class="equation-editor__section-header">
        <span class="equation-editor__eyebrow">Preview</span>
        <div>
          <strong>Student-facing preview</strong>
          <p>Check the input and keyboard students will see on the exam page.</p>
        </div>
        <span class="equation-editor__readonly-badge">Read-only</span>
      </div>
      <EquationEditorAnswer :question="{ ...question, questionConfig }" :model-value="{ value: '' }" readonly />
    </section>
  </div>
</template>

<style scoped>
.equation-editor {
  display: grid;
  gap: 14px;
}

.equation-editor__intro {
  padding: 12px 14px;
  border: 1px solid rgba(47, 111, 237, 0.16);
  border-radius: 12px;
  background: rgba(47, 111, 237, 0.06);
}

.equation-editor__intro strong,
.equation-editor__section-header strong {
  display: block;
  color: #24314a;
  font-size: 14px;
}

.equation-editor__intro p,
.equation-editor__section-header p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.equation-editor__section {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #fbfcfe;
}

.equation-editor__section-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}

.equation-editor__eyebrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 0 9px;
  background: rgba(47, 111, 237, 0.1);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.equation-editor__warning-list {
  margin: 0;
  padding: 10px 14px 10px 30px;
  border: 1px solid rgba(213, 126, 0, 0.28);
  border-radius: 10px;
  color: #8a5600;
  background: #fff8e6;
}

.equation-editor__setup-grid,
.equation-editor__tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.equation-editor label {
  display: grid;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.equation-editor :deep(.form-input) {
  min-height: 34px;
  padding: 7px 10px;
  font-size: 13px;
}

.equation-editor__tool-card {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: #ffffff;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}

.equation-editor__tool-card:hover {
  border-color: rgba(47, 111, 237, 0.3);
  background: rgba(47, 111, 237, 0.04);
}

.equation-editor__tool-card small {
  display: block;
  color: var(--color-text-muted);
}

.equation-editor__add-button,
.equation-editor__add-inline-button {
  appearance: none;
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  border: 1px solid rgba(47, 111, 237, 0.32);
  border-radius: 999px;
  color: #ffffff;
  background: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.16);
  transition: background-color 140ms ease, box-shadow 140ms ease, transform 140ms ease, opacity 140ms ease;
}

.equation-editor__add-button {
  padding: 0 14px;
}

.equation-editor__add-button span {
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

.equation-editor__add-inline-button {
  justify-self: start;
  padding: 0 13px;
  color: var(--color-primary);
  background: #ffffff;
  box-shadow: none;
}

.equation-editor__add-button:hover:not(:disabled),
.equation-editor__add-inline-button:hover:not(:disabled) {
  background: var(--color-primary-strong);
  color: #ffffff;
  box-shadow: 0 10px 22px rgba(47, 111, 237, 0.2);
  transform: translateY(-1px);
}

.equation-editor__answer-list {
  display: grid;
  gap: 8px;
}

.equation-editor__answer-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  gap: 8px;
  align-items: start;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 11px;
  background: #ffffff;
}

.equation-editor__remove-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 999px;
  background: #ffffff;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, transform 140ms ease, opacity 140ms ease;
}

.equation-editor__remove-button:hover:not(:disabled) {
  border-color: rgba(220, 38, 38, 0.35);
  color: #b42318;
  background: #fff7f7;
  transform: translateY(-1px);
}

.equation-editor__add-button:disabled,
.equation-editor__add-inline-button:disabled,
.equation-editor__remove-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
  transform: none;
}

.equation-editor__add-button:focus-visible,
.equation-editor__add-inline-button:focus-visible,
.equation-editor__remove-button:focus-visible {
  outline: 2px solid rgba(47, 111, 237, 0.32);
  outline-offset: 2px;
}

.equation-editor__readonly-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  border: 1px solid rgba(47, 111, 237, 0.2);
  border-radius: 999px;
  padding: 0 10px;
  color: var(--color-primary);
  background: rgba(47, 111, 237, 0.07);
  font-size: 12px;
  font-weight: 800;
}

@media (max-width: 800px) {
  .equation-editor__section-header,
  .equation-editor__setup-grid,
  .equation-editor__tool-grid {
    grid-template-columns: 1fr;
  }
}
</style>
