<script setup>
import { computed } from 'vue';

import {
  GRAPH_SELECT_POINTS_MODE,
  formatGraphPoints,
  formatSelectedPoints,
  normalizeGraphAnswerPoints,
  normalizeGraphConfig,
  normalizeSelectedPointIds,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  answerData: {
    type: [Object, String, null],
    default: null,
  },
  selectedAnswer: {
    type: [String, Object, null],
    default: null,
  },
  emptyText: {
    type: String,
    default: 'Not answered',
  },
});

const formattedAnswer = computed(() => {
  const questionConfig = normalizeGraphConfig(props.question.questionConfig);
  if (questionConfig.graphMode === GRAPH_SELECT_POINTS_MODE) {
    const pointIds = normalizeSelectedPointIds(props.answerData ?? props.selectedAnswer, questionConfig.points);
    return formatSelectedPoints(pointIds, questionConfig.points, props.emptyText);
  }

  const points = normalizeGraphAnswerPoints(props.answerData ?? props.selectedAnswer, questionConfig);
  return formatGraphPoints(points, props.emptyText);
});
</script>

<template>
  <span>{{ formattedAnswer }}</span>
</template>
