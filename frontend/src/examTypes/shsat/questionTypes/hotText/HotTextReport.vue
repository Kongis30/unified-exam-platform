<script setup>
import { computed } from 'vue';

import {
  formatHotTextSelection,
  normalizeHotTextAnswerData,
  normalizeHotTextConfig,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  answerData: {
    type: [Object, String, Array],
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

const displayText = computed(() => {
  const config = normalizeHotTextConfig(props.question.questionConfig);
  return formatHotTextSelection(
    normalizeHotTextAnswerData(props.answerData ?? props.selectedAnswer, config),
    config,
    props.emptyText
  );
});
</script>

<template>
  <span>{{ displayText }}</span>
</template>
