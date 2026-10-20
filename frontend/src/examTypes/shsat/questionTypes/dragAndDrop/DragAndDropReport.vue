<script setup>
import { computed } from 'vue';

import {
  normalizeDragAndDropAnswerData,
  normalizeDragAndDropConfig,
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
    default: null,
  },
  emptyText: {
    type: String,
    default: 'Not answered',
  },
});

const rows = computed(() => {
  const config = normalizeDragAndDropConfig(props.question.questionConfig);
  const placements = normalizeDragAndDropAnswerData(props.answerData ?? props.selectedAnswer, config);
  const targetIds = new Set(config.targets.map((target) => target.id));
  const rowsByTarget = config.targets
    .map((target) => createRow(target.id, target.label, placements[target.id], config))
    .filter((row) => row.choices.length > 0);

  const orphanRows = Object.entries(placements)
    .filter(([targetId]) => !targetIds.has(targetId))
    .map(([targetId, choiceIds]) => createRow(targetId, targetId, choiceIds, config))
    .filter((row) => row.choices.length > 0);

  return [...rowsByTarget, ...orphanRows];
});

function createRow(targetId, targetLabel, choiceIds, config) {
  const ids = Array.isArray(choiceIds) ? choiceIds : choiceIds ? [choiceIds] : [];
  return {
    targetId,
    targetLabel: targetLabel || targetId,
    choices: ids.map((choiceId) => {
      const choice = config.choices.find((candidate) => candidate.id === choiceId);
      return choice?.text || choiceId;
    }),
  };
}
</script>

<template>
  <span v-if="!rows.length" class="drag-report__empty">{{ emptyText }}</span>
  <div v-else class="drag-report">
    <div v-for="row in rows" :key="row.targetId" class="drag-report__row">
      <span class="drag-report__target">{{ row.targetLabel }}</span>
      <span class="drag-report__choices">
        <span v-for="choice in row.choices" :key="choice" class="drag-report__choice">
          {{ choice }}
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.drag-report {
  display: grid;
  gap: 7px;
  min-width: 220px;
}

.drag-report__row {
  display: grid;
  gap: 5px;
  border: 1px solid rgba(47, 111, 237, 0.12);
  border-radius: 10px;
  padding: 7px;
  background: #fbfdff;
}

.drag-report__target {
  color: #53627a;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.3;
}

.drag-report__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.drag-report__choice {
  border: 1px solid #dbe7ff;
  border-radius: 8px;
  padding: 4px 6px;
  color: #24314a;
  background: #ffffff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
}

.drag-report__empty {
  color: var(--color-muted);
}
</style>
