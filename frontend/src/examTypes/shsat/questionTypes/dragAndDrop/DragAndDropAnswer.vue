<script setup>
import { computed, ref } from 'vue';

import FormulaText from '@shsat/components/FormulaText.vue';

import {
  INLINE_GAP_MATCH_MODE,
  TARGET_SORT_MODE,
  normalizeDragAndDropAnswerData,
  normalizeDragAndDropConfig,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: [Object, String],
    default: () => ({ placements: {} }),
  },
  readonly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const selectedChoiceId = ref('');
const draggedChoiceId = ref('');
const dragOverTargetId = ref('');

const questionConfig = computed(() => normalizeDragAndDropConfig(props.question.questionConfig));
const placements = computed(() => normalizeDragAndDropAnswerData(props.modelValue, questionConfig.value));
const placedChoiceIds = computed(() => new Set(Object.values(placements.value).flat().filter(Boolean)));
const availableChoices = computed(() => questionConfig.value.choices.filter((choice) => !placedChoiceIds.value.has(choice.id)));
const isInlineMode = computed(() => questionConfig.value.mode === INLINE_GAP_MATCH_MODE);
const isSortingMode = computed(() => questionConfig.value.mode === TARGET_SORT_MODE);

function assignChoice(targetId, choiceId) {
  if (props.readonly || !choiceId) {
    return;
  }

  const nextPlacements = removeChoiceFromPlacements(placements.value, choiceId);
  const targetChoiceIds = nextPlacements[targetId] || [];
  nextPlacements[targetId] = isSortingMode.value ? [...targetChoiceIds, choiceId] : [choiceId];
  clearInteractionState();
  emit('update:modelValue', { placements: compactPlacements(nextPlacements) });
}

function clearTarget(targetId, choiceId = '') {
  if (props.readonly) {
    return;
  }
  const currentChoiceIds = placements.value[targetId] || [];
  const nextPlacements = { ...placements.value };
  if (choiceId) {
    nextPlacements[targetId] = currentChoiceIds.filter((id) => id !== choiceId);
  } else {
    delete nextPlacements[targetId];
  }
  emit('update:modelValue', { placements: compactPlacements(nextPlacements) });
}

function choiceText(choiceId) {
  return questionConfig.value.choices.find((choice) => choice.id === choiceId)?.text || '';
}

function startChoiceDrag(event, choiceId) {
  if (props.readonly) {
    return;
  }
  draggedChoiceId.value = choiceId;
  selectedChoiceId.value = choiceId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', choiceId);
}

function selectChoice(choiceId) {
  if (props.readonly) {
    return;
  }
  selectedChoiceId.value = selectedChoiceId.value === choiceId ? '' : choiceId;
}

function allowTargetDrop(targetId, event) {
  if (props.readonly) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  dragOverTargetId.value = targetId;
}

function dropChoice(targetId, event) {
  event.preventDefault();
  const choiceId = event.dataTransfer.getData('text/plain') || draggedChoiceId.value || selectedChoiceId.value;
  if (choiceId) {
    assignChoice(targetId, choiceId);
    return;
  }
  clearInteractionState();
}

function clearInteractionState() {
  selectedChoiceId.value = '';
  draggedChoiceId.value = '';
  dragOverTargetId.value = '';
}

function removeChoiceFromPlacements(sourcePlacements, choiceId) {
  return Object.fromEntries(
    Object.entries(sourcePlacements)
      .map(([targetId, choiceIds]) => [targetId, choiceIds.filter((id) => id !== choiceId)])
      .filter(([, choiceIds]) => choiceIds.length)
  );
}

function compactPlacements(sourcePlacements) {
  return Object.fromEntries(Object.entries(sourcePlacements).filter(([, choiceIds]) => choiceIds.length));
}
</script>

<template>
  <div class="drag-answer">
    <p class="fill-blank-hint">Drag an answer choice to a box, or click a choice and then click a box.</p>

    <div class="drag-answer__choices" aria-label="Answer choices">
      <button
        v-for="choice in availableChoices"
        :key="choice.id"
        type="button"
        class="drag-answer__choice"
        :class="{ 'is-selected': selectedChoiceId === choice.id }"
        :disabled="readonly"
        :draggable="!readonly"
        @click="selectChoice(choice.id)"
        @dragstart="startChoiceDrag($event, choice.id)"
        @dragend="clearInteractionState"
      >
        <FormulaText :content="choice.text" />
      </button>
      <p v-if="!availableChoices.length" class="section-note">All choices have been placed.</p>
    </div>

    <div v-if="isInlineMode" class="drag-answer__inline">
      <template v-for="(part, index) in questionConfig.contentParts" :key="`${part.type}-${part.id || index}`">
        <button
          v-if="part.type === 'gap'"
          type="button"
          class="drag-answer__gap"
          :class="{ 'has-choice': placements[part.id]?.length, 'is-drop-active': dragOverTargetId === part.id }"
          :disabled="readonly"
          @click="placements[part.id]?.length ? clearTarget(part.id) : assignChoice(part.id, selectedChoiceId)"
          @dragenter.prevent
          @dragover="allowTargetDrop(part.id, $event)"
          @dragleave="dragOverTargetId === part.id && (dragOverTargetId = '')"
          @drop="dropChoice(part.id, $event)"
        >
          <FormulaText :content="choiceText(placements[part.id]?.[0]) || part.label || 'Drop here'" />
        </button>
        <span v-else>{{ part.text }}</span>
      </template>
    </div>

    <div v-else class="drag-answer__targets">
      <div
        v-for="target in questionConfig.targets"
        :key="target.id"
        class="drag-answer__target"
        :class="{ 'has-choice': placements[target.id]?.length, 'is-disabled': readonly, 'is-drop-active': dragOverTargetId === target.id }"
        role="button"
        tabindex="0"
        @click="assignChoice(target.id, selectedChoiceId)"
        @keydown.enter.prevent="assignChoice(target.id, selectedChoiceId)"
        @keydown.space.prevent="assignChoice(target.id, selectedChoiceId)"
        @dragenter.prevent
        @dragover="allowTargetDrop(target.id, $event)"
        @dragleave="dragOverTargetId === target.id && (dragOverTargetId = '')"
        @drop="dropChoice(target.id, $event)"
      >
        <span class="drag-answer__target-label">{{ target.label }}</span>
        <div v-if="placements[target.id]?.length" class="drag-answer__placed-list">
          <button
            v-for="choiceId in placements[target.id]"
            :key="choiceId"
            type="button"
            class="drag-answer__placed-choice"
            :disabled="readonly"
            @click.stop="clearTarget(target.id, choiceId)"
          >
            <FormulaText :content="choiceText(choiceId)" />
          </button>
        </div>
        <strong v-else>Drop choice here</strong>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drag-answer {
  display: grid;
  gap: 12px;
  font-size: var(--exam-answer-size, 15px);
}

.drag-answer__choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #f8fafc;
}

.drag-answer__choice,
.drag-answer__gap,
.drag-answer__target,
.drag-answer__placed-choice {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: #ffffff;
  color: #24314a;
  font: inherit;
  cursor: pointer;
}

.drag-answer__choice {
  padding: 7px 10px;
  font-size: inherit;
}

.drag-answer__choice.is-selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.16);
}

.drag-answer__targets {
  display: grid;
  gap: 8px;
}

.drag-answer__target {
  display: grid;
  gap: 6px;
  min-height: 72px;
  padding: 10px;
  text-align: left;
}

.drag-answer__target.is-disabled {
  cursor: default;
}

.drag-answer__target-label {
  color: var(--color-text-muted);
  font-size: var(--exam-caption-size, 12px);
}

.drag-answer__placed-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.drag-answer__placed-choice {
  padding: 6px 9px;
  border-color: rgba(47, 111, 237, 0.28);
  background: rgba(47, 111, 237, 0.08);
  font-size: inherit;
}

.drag-answer__gap {
  display: inline-flex;
  align-items: center;
  min-width: 76px;
  min-height: 32px;
  margin: 0 4px;
  padding: 5px 10px;
  vertical-align: middle;
}

.drag-answer__inline {
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #ffffff;
  font-size: calc(15px * var(--exam-font-scale));
  line-height: 1.9;
  white-space: pre-wrap;
}

.has-choice {
  border-color: var(--color-primary);
  background: rgba(47, 111, 237, 0.08);
}

.is-drop-active {
  border-color: var(--color-primary);
  background: rgba(47, 111, 237, 0.14);
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.16);
}
</style>
