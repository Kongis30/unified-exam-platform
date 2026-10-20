<script setup>
import { computed } from 'vue';

import {
  formatSolutionSetAnswer,
  normalizeSolutionSetConfig,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  answerData: {
    type: [Object, String],
    default: null,
  },
  selectedAnswer: {
    type: [String, Object, null],
    default: '',
  },
  emptyText: {
    type: String,
    default: 'Not answered',
  },
});

const displayText = computed(() => {
  const config = normalizeSolutionSetConfig(props.question.questionConfig);
  return formatSolutionSetAnswer(props.answerData ?? props.selectedAnswer, config, props.emptyText);
});
</script>

<template>
  <span>{{ displayText }}</span>
</template>
