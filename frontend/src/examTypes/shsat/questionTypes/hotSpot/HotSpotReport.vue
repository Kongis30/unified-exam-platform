<script setup>
import { computed } from 'vue';

import {
  formatHotSpotSelection,
  normalizeHotSpotAnswerData,
  normalizeHotSpotConfig,
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
  const config = normalizeHotSpotConfig(props.question.questionConfig);
  return formatHotSpotSelection(
    normalizeHotSpotAnswerData(props.answerData ?? props.selectedAnswer, config),
    config,
    props.emptyText
  );
});
</script>

<template>
  <span>{{ displayText }}</span>
</template>
