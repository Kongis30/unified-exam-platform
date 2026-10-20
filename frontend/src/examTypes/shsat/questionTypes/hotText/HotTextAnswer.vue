<script setup>
import { computed } from 'vue';

import { normalizeHotTextAnswerData, normalizeHotTextConfig } from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: [Object, String, Array],
    default: () => ({ selectedSegmentIds: [] }),
  },
  readonly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const questionConfig = computed(() => normalizeHotTextConfig(props.question.questionConfig));
const selectedIds = computed(() => normalizeHotTextAnswerData(props.modelValue, questionConfig.value));
const selectedCount = computed(() => selectedIds.value.length);

function toggleSegment(segmentId) {
  if (props.readonly) {
    return;
  }

  const nextIds = selectedIds.value.includes(segmentId)
    ? selectedIds.value.filter((id) => id !== segmentId)
    : [...selectedIds.value, segmentId];
  emit('update:modelValue', { selectedSegmentIds: nextIds });
}
</script>

<template>
  <div class="hot-text-answer">
    <div class="hot-text-answer__toolbar">
      <p class="fill-blank-hint">Click the highlighted word or phrase that answers the question.</p>
      <span class="hot-text-answer__count">{{ selectedCount }} selected</span>
    </div>
    <div class="hot-text-answer__passage">
      <template v-for="(part, index) in questionConfig.contentParts" :key="`${part.type}-${part.id || index}`">
        <button
          v-if="part.type === 'segment'"
          type="button"
          class="hot-text-answer__segment"
          :class="{ 'is-selected': selectedIds.includes(part.id) }"
          :disabled="readonly"
          :aria-pressed="selectedIds.includes(part.id)"
          @click="toggleSegment(part.id)"
        >
          {{ part.text }}
        </button>
        <span v-else>{{ part.text }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.hot-text-answer {
  display: grid;
  gap: 8px;
}

.hot-text-answer__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hot-text-answer__count {
  flex: 0 0 auto;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--color-muted);
  background: #ffffff;
  font-size: calc(12px * var(--exam-font-scale));
  font-weight: 700;
}

.hot-text-answer__passage {
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: #ffffff;
  color: #24314a;
  font-size: calc(15px * var(--exam-font-scale));
  line-height: 1.85;
  white-space: pre-wrap;
}

.hot-text-answer__segment {
  display: inline;
  margin: 0 1px;
  border: 0;
  border-radius: 5px;
  padding: 1px 3px;
  color: #174ea6;
  background:
    linear-gradient(180deg, transparent 55%, rgba(47, 111, 237, 0.17) 55%),
    rgba(47, 111, 237, 0.04);
  font: inherit;
  text-align: inherit;
  text-decoration: underline;
  text-decoration-color: rgba(47, 111, 237, 0.45);
  text-underline-offset: 3px;
  cursor: pointer;
  transition: background-color 140ms ease, box-shadow 140ms ease, color 140ms ease;
}

.hot-text-answer__segment:hover:not(:disabled) {
  color: var(--color-primary-strong);
  background:
    linear-gradient(180deg, transparent 44%, rgba(47, 111, 237, 0.24) 44%),
    rgba(47, 111, 237, 0.08);
}

.hot-text-answer__segment.is-selected {
  color: #ffffff;
  background: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.14);
  text-decoration-color: rgba(255, 255, 255, 0.75);
}

.hot-text-answer__segment:disabled {
  cursor: default;
}
</style>
