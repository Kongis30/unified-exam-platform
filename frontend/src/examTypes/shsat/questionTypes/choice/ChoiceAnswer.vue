<script setup>
import { computed } from 'vue';

import FormulaText from '@shsat/components/FormulaText.vue';
import {
  isMultiSelectType,
  normalizeAnswerList,
  normalizeQuestionType,
  parseOptions,
} from '@shsat/questionTypes/utils';

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
  // Answer Eliminator tool: when active, clicking an option crosses it out instead of selecting it.
  eliminateMode: {
    type: Boolean,
    default: false,
  },
  eliminatedKeys: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['update:modelValue', 'change', 'toggle-eliminate']);

// Normalize options so raw string/object shapes still render a proper key and text
// instead of blank markers when a paper stores options in a legacy format.
const options = computed(() => parseOptions(props.question.options));
const isMultiSelect = computed(() => isMultiSelectType(props.question.questionType));
const isFixedMultiSelect = computed(() => normalizeQuestionType(props.question.questionType, '') === 'MULTI_SELECT_FIXED');
const selectedAnswers = computed(() => normalizeAnswerList(props.modelValue));
const selectionLimit = computed(() => {
  const candidates = [
    props.question.selectionLimit,
    props.question.questionConfig?.selectionLimit,
    props.question.scoringRules?.selectionLimit,
  ];
  return candidates.map((value) => Number(value)).find((value) => Number.isInteger(value) && value > 0) || null;
});

const multiSelectHint = computed(() => {
  if (!isMultiSelect.value) {
    return '';
  }
  if (selectionLimit.value) {
    const countLabel = `${selectionLimit.value} answer${selectionLimit.value > 1 ? 's' : ''}`;
    return isFixedMultiSelect.value
      ? `Select exactly ${countLabel}.`
      : `Select up to ${countLabel}.`;
  }

  return 'Select all answers you think are correct.';
});

function isSelected(optionKey) {
  return selectedAnswers.value.includes(optionKey);
}

function isEliminated(optionKey) {
  return props.eliminatedKeys.includes(optionKey);
}

function isDisabled(optionKey) {
  if (props.readonly) {
    return true;
  }
  // Eliminated options cannot be chosen until the student un-crosses them.
  if (isEliminated(optionKey) && !isSelected(optionKey)) {
    return true;
  }
  if (!isMultiSelect.value || !selectionLimit.value || isSelected(optionKey)) {
    return false;
  }

  return selectedAnswers.value.length >= selectionLimit.value;
}

function handleOptionClick(optionKey, event) {
  // In eliminate mode a click toggles the strike-through instead of changing the answer.
  if (props.eliminateMode && !props.readonly) {
    event.preventDefault();
    emit('toggle-eliminate', optionKey);
  }
}

function updateAnswer(answers) {
  const answerData = { answers };
  emit('update:modelValue', answerData);
  emit('change', answerData);
}

function selectSingleAnswer(optionKey) {
  if (props.readonly || isEliminated(optionKey)) {
    return;
  }

  updateAnswer(optionKey ? [optionKey] : []);
}

function toggleMultiAnswer(optionKey, checked) {
  if (props.readonly || isEliminated(optionKey)) {
    return;
  }
  if (checked && selectionLimit.value && selectedAnswers.value.length >= selectionLimit.value && !isSelected(optionKey)) {
    return;
  }

  const nextAnswers = checked
    ? Array.from(new Set([...selectedAnswers.value, optionKey]))
    : selectedAnswers.value.filter((answer) => answer !== optionKey);

  updateAnswer(nextAnswers);
}
</script>

<template>
  <div class="choice-answer" :class="{ 'choice-answer--eliminate': eliminateMode }">
    <label
      v-for="option in options"
      :key="option.key"
      class="choice-answer__option"
      :class="{
        selected: isSelected(option.key),
        readonly: isDisabled(option.key),
        eliminated: isEliminated(option.key),
      }"
      @click="handleOptionClick(option.key, $event)"
    >
      <input
        v-if="isMultiSelect"
        type="checkbox"
        class="choice-answer__input"
        :checked="isSelected(option.key)"
        :disabled="isDisabled(option.key)"
        @change="toggleMultiAnswer(option.key, $event.target.checked)"
      />
      <input
        v-else
        type="radio"
        class="choice-answer__input"
        :name="`question-${question.questionNumber}`"
        :value="option.key"
        :checked="isSelected(option.key)"
        :disabled="isDisabled(option.key)"
        @change="selectSingleAnswer(option.key)"
      />
      <span class="choice-answer__marker">{{ option.key }}</span>
      <span class="choice-answer__text">
        <FormulaText :content="option.text" />
      </span>
      <button
        v-if="eliminateMode && !readonly"
        type="button"
        class="choice-answer__eliminate"
        :title="isEliminated(option.key) ? 'Restore this option' : 'Cross out this option'"
        :aria-label="isEliminated(option.key) ? 'Restore this option' : 'Cross out this option'"
        @click.stop.prevent="emit('toggle-eliminate', option.key)"
      >{{ isEliminated(option.key) ? '↺' : '✕' }}</button>
    </label>

    <div v-if="multiSelectHint" class="choice-answer__hint">
      {{ multiSelectHint }}
    </div>
  </div>
</template>

<style scoped>
.choice-answer {
  display: grid;
  gap: 8px;
  font-size: var(--exam-answer-size, 15px);
}

.choice-answer__option {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  min-height: 42px;
  padding: 8px 12px;
  background: #ffffff;
  font-size: inherit;
  cursor: pointer;
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.choice-answer__option:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(31, 75, 135, 0.07);
}

.choice-answer__option.selected {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.choice-answer__option.readonly {
  cursor: not-allowed;
  opacity: 0.75;
}

/* The native input drives state; the marker keeps the existing visual control. */
.choice-answer__input {
  width: 0;
  height: 0;
  margin: 0;
  opacity: 0;
}

.choice-answer__marker {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.6em;
  height: 1.6em;
  border-radius: 999px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  font-size: 0.87em;
  font-weight: 700;
}

.choice-answer__option.selected .choice-answer__marker {
  color: #ffffff;
  background: var(--color-primary);
}

.choice-answer__text {
  min-width: 0;
  font-size: inherit;
  line-height: 1.35;
  text-transform: none;
}

.choice-answer__text :deep(.formula-text) {
  text-transform: none;
}

/* Answer Eliminator: crossed-out options stay readable but visibly struck through. */
.choice-answer--eliminate .choice-answer__option {
  cursor: pointer;
}

.choice-answer__option.eliminated {
  border-color: var(--color-border);
  background: #f7f8fa;
  opacity: 0.7;
}

.choice-answer__option.eliminated .choice-answer__marker,
.choice-answer__option.eliminated .choice-answer__text {
  color: var(--color-muted);
  text-decoration: line-through;
}

.choice-answer__eliminate {
  flex: 0 0 auto;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-muted);
  background: #ffffff;
  font-size: var(--exam-caption-size, 12px);
  line-height: 1;
  cursor: pointer;
}

.choice-answer__eliminate:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.choice-answer__hint {
  color: var(--color-muted);
  font-size: var(--exam-caption-size, 12px);
  font-style: italic;
}
</style>
