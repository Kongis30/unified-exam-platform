<script setup>
import { computed } from 'vue';

import {
  formatEquationAnswer,
  formatEquationPreview,
  normalizeAcceptedAnswers,
} from './helpers';
import { parseJson } from '../utils';

const props = defineProps({
  question: {
    type: Object,
    default: () => ({}),
  },
  answerData: {
    type: [Object, String],
    default: null,
  },
  selectedAnswer: {
    type: String,
    default: '',
  },
  emptyText: {
    type: String,
    default: 'Not answered',
  },
});

const acceptedAnswers = computed(() => {
  const data = parseJson(props.answerData, props.answerData);
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.acceptedAnswers)) {
    return normalizeAcceptedAnswers(data);
  }
  return [];
});

const displayText = computed(() => {
  return formatEquationAnswer(props.answerData ?? props.selectedAnswer, props.emptyText);
});

const formattedAcceptedAnswers = computed(() => {
  return acceptedAnswers.value.map((answer) => formatEquationPreview(answer.value) || answer.value);
});
</script>

<template>
  <span v-if="!acceptedAnswers.length" class="equation-report__answer">
    {{ formatEquationPreview(displayText) || displayText }}
  </span>
  <ul v-else class="equation-report__accepted">
    <li v-for="answer in formattedAcceptedAnswers" :key="answer">
      <code>{{ answer }}</code>
    </li>
  </ul>
</template>

<style scoped>
.equation-report__answer,
.equation-report__accepted code {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
}

.equation-report__accepted {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.equation-report__accepted code,
.equation-report__answer {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 3px 8px;
  color: #24314a;
  background: #f8fafc;
}
</style>
