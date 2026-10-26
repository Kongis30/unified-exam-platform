<script setup>
import { computed } from 'vue';

import AppButton from '@/components/AppButton.vue';
import FormulaText from '@shsat/components/FormulaText.vue';
import { isMultiSelectType, normalizeAnswerList, normalizeOption } from '@shsat/questionTypes/utils';

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

const options = computed(() => Array.isArray(props.question.options) ? props.question.options : []);
const answers = computed(() => normalizeAnswerList(props.question.correctAnswerData));
const isSingleChoice = computed(() => !isMultiSelectType(props.question.questionType));
const isFixedMultiSelect = computed(() => props.question.questionType === 'MULTI_SELECT_FIXED');
const selectionLimit = computed(() => isFixedMultiSelect.value ? answers.value.length : 0);

function patchQuestion(patch) {
  if (props.readonly) {
    return;
  }

  emit('patch', patch);
  emit('dirty');
}

function updateOption(index, fieldName, value) {
  const currentOption = options.value[index];
  if (!currentOption) {
    return;
  }

  const nextOptions = options.value.map((option, optionIndex) => {
    return optionIndex === index ? { ...option, [fieldName]: value } : option;
  });

  if (fieldName === 'key') {
    const previousKey = currentOption.key;
    const nextKey = String(value ?? '').trim();
    const duplicateKey = options.value.some((option, optionIndex) => (
      optionIndex !== index
      && String(option.key ?? '').trim().toUpperCase() === nextKey.toUpperCase()
    ));

    if (duplicateKey) {
      return;
    }

    const nextAnswers = answers.value.map((answer) => (
      answer === previousKey ? nextKey : answer
    ));
    patchQuestion({
      options: nextOptions,
      correctAnswerData: { ...props.question.correctAnswerData, answers: nextAnswers },
    });
    return;
  }

  patchQuestion({ options: nextOptions });
}

function insertOptionFormula(index, mode = 'inline') {
  const option = options.value[index];
  if (!option) {
    return;
  }

  const source = String(option.text || '');
  const needsGap = source && !/\s$/.test(source);
  const snippet = mode === 'block' ? `${source ? '\n' : ''}$$\nx^2\n$$` : `${needsGap ? ' ' : ''}$x^2$`;
  updateOption(index, 'text', `${source}${snippet}`);
}

function addOption() {
  const nextKey = String.fromCharCode(65 + options.value.length);
  patchQuestion({
    options: [...options.value, normalizeOption({ key: nextKey, text: `Option ${nextKey}` }, options.value.length)],
  });
}

function removeOption(index) {
  const removedOption = options.value[index];
  const nextOptions = options.value.filter((_, optionIndex) => optionIndex !== index);
  const nextAnswers = removedOption
    ? answers.value.filter((answer) => answer !== removedOption.key)
    : answers.value;

  patchQuestion({
    options: nextOptions,
    correctAnswerData: { ...props.question.correctAnswerData, answers: nextAnswers },
  });
}

function setSingleCorrectOption(key) {
  patchQuestion({
    correctAnswerData: { ...props.question.correctAnswerData, answers: key ? [key] : [] },
  });
}

function toggleCorrectOption(key) {
  const nextAnswers = answers.value.includes(key)
    ? answers.value.filter((answer) => answer !== key)
    : [...answers.value, key];

  patchQuestion({
    correctAnswerData: { ...props.question.correctAnswerData, answers: nextAnswers },
  });
}
</script>

<template>
  <div class="choice-editor">
    <section class="choice-editor__section">
      <div class="choice-editor__title">
        <div>
          <strong>Choice Options</strong>
          <p>Mark the correct answer directly on each option row.</p>
        </div>
        <AppButton variant="secondary" :disabled="readonly" @click="addOption">Add Option</AppButton>
      </div>

      <div v-if="options.length" class="choice-editor__options">
        <div v-for="(option, index) in options" :key="`${option.key}-${index}`" class="choice-editor__option-row">
          <div class="choice-editor__option-main">
            <label class="choice-editor__correct-control" :title="answers.includes(option.key) ? 'Correct answer' : 'Mark as correct'">
              <input
                v-if="isSingleChoice"
                type="radio"
                :name="`correct-option-${question.localId || question.questionId || 'draft'}`"
                :checked="answers.includes(option.key)"
                :disabled="readonly"
                @change="setSingleCorrectOption(option.key)"
              />
              <input
                v-else
                type="checkbox"
                :checked="answers.includes(option.key)"
                :disabled="readonly"
                @change="toggleCorrectOption(option.key)"
              />
              <span>Correct</span>
            </label>
            <input
              class="choice-editor__option-key"
              :value="option.key"
              :disabled="readonly"
              aria-label="Option key"
              @input="updateOption(index, 'key', $event.target.value)"
            />
            <input
              class="form-input"
              :value="option.text"
              :disabled="readonly"
              placeholder="Option text"
              @input="updateOption(index, 'text', $event.target.value)"
            />
            <div class="choice-editor__formula-actions" aria-label="Option formula tools">
              <button type="button" :disabled="readonly" @click="insertOptionFormula(index, 'inline')">Formula</button>
              <button type="button" :disabled="readonly" @click="insertOptionFormula(index, 'block')">Block</button>
            </div>
            <button class="choice-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove option" @click="removeOption(index)">&times;</button>
          </div>
          <div class="choice-editor__option-preview" aria-label="Option review">
            <span class="choice-editor__option-review-label">Option Review:</span>
            <FormulaText v-if="option.text" :content="option.text" />
            <em v-else>No option text.</em>
          </div>
        </div>
      </div>
      <p v-else class="empty-inline">No options. Use Add Option for multiple-choice questions.</p>

      <div v-if="isFixedMultiSelect" class="choice-editor__limit">
        Student must select exactly <strong>{{ selectionLimit }}</strong>
        {{ selectionLimit === 1 ? 'answer' : 'answers' }}.
        <span>Change this by marking correct rows above.</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.choice-editor {
  display: grid;
  gap: 12px;
}

.choice-editor__section {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(31, 75, 135, 0.12);
  border-radius: var(--paper-radius-sm);
  padding: 10px;
  background: #ffffff;
}

.choice-editor__title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.choice-editor__title p {
  margin: 3px 0 0;
  color: var(--color-muted);
  font-size: 12px;
}

.choice-editor__options {
  display: grid;
  gap: 8px;
}

.choice-editor__option-row {
  display: grid;
  gap: 7px;
  border: 1px solid rgba(31, 75, 135, 0.1);
  border-radius: var(--paper-radius-sm);
  padding: 6px;
  background: #fbfdff;
}

.choice-editor__option-main {
  display: grid;
  grid-template-columns: auto 44px minmax(0, 1fr) auto 28px;
  gap: 8px;
  align-items: center;
}

.choice-editor__correct-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 82px;
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
}

.choice-editor__option-key {
  width: 44px;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-sm);
  padding: 8px;
  text-align: center;
  background: #fbfdff;
}

.choice-editor__formula-actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.choice-editor__formula-actions button {
  border: 1px solid rgba(31, 75, 135, 0.16);
  border-radius: 999px;
  padding: 4px 7px;
  color: #1f4b87;
  background: #ffffff;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.choice-editor__formula-actions button:hover:not(:disabled) {
  border-color: rgba(47, 111, 237, 0.34);
  background: #eef5ff;
}

.choice-editor__formula-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.choice-editor__remove-button {
  width: 26px;
  height: 26px;
  border: 1px solid rgba(199, 55, 71, 0.22);
  border-radius: 999px;
  color: var(--color-danger);
  background: #ffffff;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.choice-editor__remove-button:hover:not(:disabled) {
  background: #fff4f5;
}

.choice-editor__remove-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.choice-editor__option-preview {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  border-top: 1px dashed rgba(31, 75, 135, 0.12);
  padding-top: 7px;
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.45;
}

.choice-editor__option-review-label {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: none;
}

.choice-editor__option-preview :deep(.formula-text) {
  text-transform: none;
}

.choice-editor__option-preview em {
  color: var(--color-muted);
  font-style: normal;
}

.choice-editor__limit {
  border: 1px solid rgba(31, 75, 135, 0.16);
  border-radius: var(--paper-radius-sm);
  padding: 8px 10px;
  color: var(--color-text);
  background: #ffffff;
  font-size: 13px;
}

.choice-editor__limit span {
  margin-left: 6px;
  color: var(--color-muted);
}

@media (max-width: 560px) {
  .choice-editor__option-main {
    grid-template-columns: auto 44px minmax(0, 1fr) 28px;
    gap: 8px 6px;
  }

  .choice-editor__option-key {
    grid-column: 2;
    min-width: 0;
  }

  .choice-editor__option-main > .form-input {
    grid-column: 1 / -1;
    grid-row: 2;
    width: 100%;
    min-width: 0;
  }

  .choice-editor__formula-actions {
    grid-column: 1 / -1;
    grid-row: 3;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .choice-editor__remove-button {
    grid-column: 4;
    grid-row: 1;
  }
}
</style>
