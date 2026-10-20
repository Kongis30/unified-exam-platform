<script setup>
import { computed } from 'vue';

import FormulaText from '@shsat/components/FormulaText.vue';
import { parseJsonObject, parseOptions } from '../utils';
import {
  formatInlineChoiceAnswerMap,
  normalizeInlineChoiceAnswerMap,
  normalizeInlineChoiceConfig,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  answerData: {
    type: [Object, String, Array, null],
    default: null,
  },
  selectedAnswer: {
    type: [String, Object, Array, null],
    default: null,
  },
  emptyText: {
    type: String,
    default: 'Not answered',
  },
});

const blanks = computed(() => {
  if (Array.isArray(props.question?.inlineChoices)) {
    return props.question.inlineChoices;
  }

  const questionConfig = normalizeInlineChoiceConfig(
    parseJsonObject(props.question?.questionConfig),
    parseOptions(props.question?.options)
  );
  return questionConfig.blanks || [];
});

const answerMap = computed(() => {
  return normalizeInlineChoiceAnswerMap(props.answerData ?? props.selectedAnswer, blanks.value);
});

const rows = computed(() => {
  return blanks.value.map((blank) => {
    const optionKey = answerMap.value[blank.id] || '';
    const option = (blank.options || []).find((candidate) => candidate.key === optionKey);
    return {
      id: blank.id,
      label: blank.label || blank.id,
      value: option ? option.text : optionKey,
    };
  });
});

const fallbackText = computed(() => {
  return formatInlineChoiceAnswerMap(answerMap.value, props.emptyText, blanks.value);
});
</script>

<template>
  <ul v-if="rows.length" class="inline-choice-report">
    <li v-for="row in rows" :key="row.id" class="inline-choice-report__row">
      <span class="inline-choice-report__label"><FormulaText :content="row.label" />:</span>
      <span v-if="row.value" class="inline-choice-report__value"><FormulaText :content="row.value" /></span>
      <span v-else>{{ emptyText }}</span>
    </li>
  </ul>
  <span v-else>{{ fallbackText }}</span>
</template>

<style scoped>
.inline-choice-report {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.inline-choice-report__row {
  display: flex;
  gap: 6px;
}

.inline-choice-report__label {
  color: var(--color-muted);
  font-weight: 700;
}
</style>
