<script setup>
import { computed } from 'vue';

import FormulaText from '@shsat/components/FormulaText.vue';
import RichSelect from '@shsat/components/RichSelect.vue';
import {
  normalizeInlineChoiceAnswerMap,
  normalizeInlineChoiceConfig,
  parseInlineTextParts,
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

const config = computed(() => normalizeInlineChoiceConfig(props.question.questionConfig, props.question.options));
const blanks = computed(() => config.value.blanks);
const blankById = computed(() => new Map(blanks.value.map((blank) => [blank.id, blank])));
const inlineParts = computed(() => parseInlineTextParts(config.value.inlineText));
const answerMap = computed(() => normalizeInlineChoiceAnswerMap(props.modelValue, blanks.value));
const correctAnswerMap = computed(() => normalizeInlineChoiceAnswerMap(
  props.correctAnswerData || props.question.correctAnswerData || props.question.correctAnswer,
  blanks.value
));
const correctAnswerRows = computed(() => {
  return blanks.value
    .map((blank) => {
      const optionKey = correctAnswerMap.value[blank.id] || '';
      const option = (blank.options || []).find((candidate) => candidate.key === optionKey);
      return {
        id: blank.id,
        label: blank.label || blank.id,
        value: option ? option.text : optionKey,
      };
    })
    .filter((row) => row.value);
});

function getBlank(blankId) {
  return blankById.value.get(blankId) || null;
}

function isCorrect(blankId) {
  return answerMap.value[blankId] && answerMap.value[blankId] === correctAnswerMap.value[blankId];
}

function isIncorrect(blankId) {
  return answerMap.value[blankId] && correctAnswerMap.value[blankId] && answerMap.value[blankId] !== correctAnswerMap.value[blankId];
}

function updateAnswer(blankId, optionKey) {
  if (props.readonly) {
    return;
  }

  const nextAnswers = { ...answerMap.value };
  if (optionKey) {
    nextAnswers[blankId] = optionKey;
  } else {
    delete nextAnswers[blankId];
  }

  const nextValue = {
    ...(props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue) ? props.modelValue : {}),
    answers: nextAnswers,
  };

  emit('update:modelValue', nextValue);
  emit('change', nextValue);
}
</script>

<template>
  <div class="structured-answer inline-choice-answer">
    <p class="inline-choice-answer__text">
      <template v-for="(part, index) in inlineParts" :key="`${part.type}-${part.id || index}`">
        <FormulaText v-if="part.type === 'text'" :content="part.text" />
        <span v-else-if="getBlank(part.id)" class="inline-choice-answer__blank">
          <span class="inline-choice-answer__label"><FormulaText :content="getBlank(part.id).label" /></span>
          <RichSelect
            :options="getBlank(part.id).options"
            :model-value="answerMap[part.id] || ''"
            :disabled="readonly"
            :placeholder="'Select one'"
            :aria-label="getBlank(part.id).label"
            :state="answersVisible && isCorrect(part.id) ? 'correct' : (answersVisible && isIncorrect(part.id) ? 'incorrect' : '')"
            @update:model-value="updateAnswer(part.id, $event)"
          />
        </span>
        <span v-else class="inline-choice-answer__missing">{{ part.placeholder }}</span>
      </template>
    </p>

    <p v-if="!readonly" class="fill-blank-hint">Select one option for each dropdown.</p>
    <p v-if="answersVisible && correctAnswerRows.length" class="inline-choice-answer__correct-reference">
      <strong>Correct answer:</strong>
      <span v-for="row in correctAnswerRows" :key="row.id" class="inline-choice-answer__correct-item">
        {{ row.label }}: <FormulaText :content="row.value" />
      </span>
    </p>
  </div>
</template>

<style scoped>
.inline-choice-answer {
  display: grid;
  gap: 8px;
}

.inline-choice-answer__text {
  margin: 0;
  color: #24314a;
  font-size: calc(15px * var(--exam-font-scale));
  line-height: 1.9;
}

.inline-choice-answer__blank {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 3px;
  vertical-align: baseline;
}

.inline-choice-answer__label {
  color: var(--color-muted);
  font-size: calc(12px * var(--exam-font-scale));
  font-weight: 700;
}

.inline-choice-answer__missing {
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  color: var(--color-danger);
  background: #fff1f3;
  font-weight: 700;
}

.inline-choice-answer__correct-reference {
  margin: 0;
  border: 1px solid rgba(20, 135, 101, 0.24);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  color: var(--color-success);
  background: rgba(20, 135, 101, 0.06);
  font-size: calc(13px * var(--exam-font-scale));
}

.inline-choice-answer__correct-item {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  margin-right: 10px;
}

.inline-choice-answer__correct-item :deep(.formula-text) {
  white-space: nowrap;
}
</style>
