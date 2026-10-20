<script setup>
import { computed, ref } from 'vue';

import DragAndDropAnswer from './DragAndDropAnswer.vue';
import {
  INLINE_GAP_MATCH_MODE,
  TARGET_SORT_MODE,
  TARGET_MATCH_MODE,
  getDragAndDropValidationIssues,
  nextChoiceId,
  nextTargetId,
  normalizeDragAndDropConfig,
  normalizeDragAndDropPlacements,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['patch', 'dirty']);

const questionConfig = computed(() => normalizeDragAndDropConfig(props.question.questionConfig));
const placements = computed(() => normalizeDragAndDropPlacements(props.question.correctAnswerData, questionConfig.value));
const validationIssues = computed(() => getDragAndDropValidationIssues(props.question));
const draggedInlinePartIndex = ref(null);
const dragOverInlinePartIndex = ref(null);
const dragOverInlinePosition = ref('after');

function patchEditor(nextConfig, nextPlacements = placements.value) {
  if (props.readonly) {
    return;
  }

  emit('patch', {
    options: [],
    questionConfig: {
      ...questionConfig.value,
      ...nextConfig,
    },
    correctAnswerData: {
      placements: nextPlacements,
    },
  });
  emit('dirty');
}

function setMode(mode) {
  patchEditor({
    mode,
    contentParts: mode === INLINE_GAP_MATCH_MODE
      ? questionConfig.value.targets.map((target) => ({ type: 'gap', id: target.id, label: target.label }))
      : [],
  }, normalizePlacementsForMode(placements.value, mode));
}

function addChoice() {
  const id = nextChoiceId(questionConfig.value.choices);
  patchEditor({
    choices: [...questionConfig.value.choices, { id, text: `Answer choice ${questionConfig.value.choices.length + 1}` }],
  });
}

function updateChoice(choiceId, text) {
  patchEditor({
    choices: questionConfig.value.choices.map((choice) => choice.id === choiceId ? { ...choice, text } : choice),
  });
}

function removeChoice(choiceId) {
  const nextPlacements = Object.fromEntries(
    Object.entries(placements.value)
      .map(([targetId, choiceIds]) => [targetId, choiceIds.filter((id) => id !== choiceId)])
      .filter(([, choiceIds]) => choiceIds.length)
  );
  patchEditor({
    choices: questionConfig.value.choices.filter((choice) => choice.id !== choiceId),
  }, nextPlacements);
}

function addTarget() {
  const id = nextTargetId(questionConfig.value.targets);
  const label = `Drop target ${questionConfig.value.targets.length + 1}`;
  patchEditor({
    targets: [...questionConfig.value.targets, { id, label }],
    contentParts: questionConfig.value.mode === INLINE_GAP_MATCH_MODE
      ? [...questionConfig.value.contentParts, { type: 'gap', id, label }]
      : questionConfig.value.contentParts,
  });
}

function updateTarget(targetId, patch) {
  const nextTargets = questionConfig.value.targets.map((target) => target.id === targetId ? { ...target, ...patch } : target);
  const nextContentParts = questionConfig.value.contentParts.map((part) => (
    part.type === 'gap' && part.id === targetId ? { ...part, label: patch.label ?? part.label } : part
  ));
  patchEditor({ targets: nextTargets, contentParts: nextContentParts });
}

function removeTarget(targetId) {
  const nextPlacements = { ...placements.value };
  delete nextPlacements[targetId];
  patchEditor({
    targets: questionConfig.value.targets.filter((target) => target.id !== targetId),
    contentParts: questionConfig.value.contentParts.filter((part) => part.id !== targetId),
  }, nextPlacements);
}

function setCorrectMatch(targetId, choiceId) {
  setCorrectPlacements(targetId, choiceId ? [choiceId] : []);
}

function setCorrectPlacements(targetId, choiceIds) {
  const nextPlacements = removeChoiceIds(placements.value, choiceIds, targetId);
  if (choiceIds.length) {
    nextPlacements[targetId] = questionConfig.value.mode === TARGET_SORT_MODE ? choiceIds : choiceIds.slice(0, 1);
  } else {
    delete nextPlacements[targetId];
  }
  patchEditor({}, normalizePlacementsForMode(nextPlacements, questionConfig.value.mode));
}

function toggleCorrectPlacement(targetId, choiceId) {
  const currentChoiceIds = placements.value[targetId] || [];
  const nextChoiceIds = currentChoiceIds.includes(choiceId)
    ? currentChoiceIds.filter((id) => id !== choiceId)
    : [...currentChoiceIds, choiceId];
  setCorrectPlacements(targetId, nextChoiceIds);
}

function addInlineText() {
  patchEditor({
    contentParts: [...questionConfig.value.contentParts, { type: 'text', text: ' text ' }],
  });
}

function addInlineGap(targetId = '') {
  const target = questionConfig.value.targets.find((candidate) => candidate.id === targetId) || questionConfig.value.targets[0];
  if (!target) {
    return;
  }
  patchEditor({
    contentParts: [...questionConfig.value.contentParts, { type: 'gap', id: target.id, label: target.label }],
  });
}

function updateInlineText(index, text) {
  patchEditor({
    contentParts: questionConfig.value.contentParts.map((part, partIndex) => partIndex === index ? { ...part, text } : part),
  });
}

function removeInlinePart(index) {
  patchEditor({
    contentParts: questionConfig.value.contentParts.filter((_, partIndex) => partIndex !== index),
  });
}

function startInlinePartDrag(event, index) {
  if (props.readonly) {
    event.preventDefault();
    return;
  }

  draggedInlinePartIndex.value = index;
  dragOverInlinePartIndex.value = index;
  dragOverInlinePosition.value = 'after';
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(index));
}

function updateInlinePartDragTarget(event, index) {
  if (props.readonly || draggedInlinePartIndex.value === null) {
    return;
  }

  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  dragOverInlinePartIndex.value = index;
  dragOverInlinePosition.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  event.dataTransfer.dropEffect = 'move';
}

function clearInlinePartDrag() {
  draggedInlinePartIndex.value = null;
  dragOverInlinePartIndex.value = null;
  dragOverInlinePosition.value = 'after';
}

function inlinePartDragClass(index) {
  return {
    'is-dragging': draggedInlinePartIndex.value === index,
    'is-drop-before': dragOverInlinePartIndex.value === index && dragOverInlinePosition.value === 'before',
    'is-drop-after': dragOverInlinePartIndex.value === index && dragOverInlinePosition.value === 'after',
  };
}

function dropInlinePart(event, targetIndex) {
  if (props.readonly) {
    return;
  }

  event.preventDefault();
  const sourceIndex = draggedInlinePartIndex.value;
  if (sourceIndex === null || sourceIndex === targetIndex) {
    clearInlinePartDrag();
    return;
  }

  const orderedParts = [...questionConfig.value.contentParts];
  const [movedPart] = orderedParts.splice(sourceIndex, 1);
  let insertIndex = targetIndex + (dragOverInlinePosition.value === 'after' ? 1 : 0);
  if (sourceIndex < insertIndex) {
    insertIndex -= 1;
  }

  orderedParts.splice(insertIndex, 0, movedPart);
  clearInlinePartDrag();
  patchEditor({ contentParts: orderedParts });
}

function normalizePlacementsForMode(sourcePlacements, mode) {
  if (mode === TARGET_SORT_MODE) {
    return sourcePlacements;
  }

  return Object.fromEntries(
    Object.entries(sourcePlacements)
      .filter(([, choiceIds]) => choiceIds.length)
      .map(([targetId, choiceIds]) => [targetId, choiceIds.slice(0, 1)])
  );
}

function removeChoiceIds(sourcePlacements, choiceIds, keepTargetId) {
  const choiceIdSet = new Set(choiceIds);
  return Object.fromEntries(
    Object.entries(sourcePlacements)
      .map(([targetId, existingChoiceIds]) => [
        targetId,
        targetId === keepTargetId
          ? existingChoiceIds
          : existingChoiceIds.filter((choiceId) => !choiceIdSet.has(choiceId)),
      ])
      .filter(([, existingChoiceIds]) => existingChoiceIds.length)
  );
}
</script>

<template>
  <div class="type-editor-panel drag-editor">
    <div class="drag-editor__intro">
        <div>
        <strong>Build a drag-and-drop question</strong>
        <p>Create answer cards, define targets, then choose the correct card for each target.</p>
        </div>
      <div class="drag-editor__mode-toggle">
        <label>
          <input type="radio" :checked="questionConfig.mode === TARGET_MATCH_MODE" :disabled="readonly" @change="setMode(TARGET_MATCH_MODE)" />
          Target boxes
        </label>
        <label>
          <input type="radio" :checked="questionConfig.mode === TARGET_SORT_MODE" :disabled="readonly" @change="setMode(TARGET_SORT_MODE)" />
          Sorting boxes
        </label>
        <label>
          <input type="radio" :checked="questionConfig.mode === INLINE_GAP_MATCH_MODE" :disabled="readonly" @change="setMode(INLINE_GAP_MATCH_MODE)" />
          Inline gaps
        </label>
      </div>
    </div>
    <ul v-if="validationIssues.length" class="drag-editor__warning-list">
      <li v-for="issue in validationIssues" :key="issue">{{ issue }}</li>
    </ul>

    <section class="drag-editor__section">
      <div class="drag-editor__section-header">
        <div>
          <strong>Answer cards</strong>
          <p>These are the cards students drag into boxes or gaps. Use $...$ for inline formulas or $$...$$ for display formulas.</p>
        </div>
        <button class="text-button" type="button" :disabled="readonly" @click="addChoice">Add Card</button>
      </div>
      <div class="drag-editor__list">
        <div class="drag-editor__list-header drag-editor__list-header--cards">
          <span>Card text</span>
          <span></span>
        </div>
        <div v-for="choice in questionConfig.choices" :key="choice.id" class="drag-editor__row drag-editor__row--choice">
          <input class="form-input" :value="choice.text" :disabled="readonly" placeholder="Answer card text" @input="updateChoice(choice.id, $event.target.value)" />
          <button class="drag-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove card" @click="removeChoice(choice.id)">×</button>
        </div>
        <p v-if="questionConfig.choices.length === 0" class="empty-inline">No cards yet. Add at least one answer card.</p>
      </div>
    </section>

    <section class="drag-editor__section">
      <div class="drag-editor__section-header">
        <div>
          <strong>Drop targets and correct cards</strong>
          <p>Each target needs a visible prompt and the card that should count as correct.</p>
        </div>
        <button class="text-button" type="button" :disabled="readonly" @click="addTarget">Add Target</button>
      </div>
      <div class="drag-editor__list">
        <div class="drag-editor__list-header drag-editor__list-header--targets">
          <span>Target prompt</span>
          <span>Correct card placement</span>
          <span></span>
        </div>
        <div v-for="target in questionConfig.targets" :key="target.id" class="drag-editor__row drag-editor__row--target">
          <input class="form-input" :value="target.label" :disabled="readonly" placeholder="Target label" @input="updateTarget(target.id, { label: $event.target.value })" />
          <div v-if="questionConfig.mode === TARGET_SORT_MODE" class="drag-editor__choice-checks">
            <label v-for="choice in questionConfig.choices" :key="choice.id" class="checkbox-label">
              <input type="checkbox" :checked="placements[target.id]?.includes(choice.id)" :disabled="readonly" @change="toggleCorrectPlacement(target.id, choice.id)" />
              {{ choice.text }}
            </label>
          </div>
          <select v-else class="form-input" :value="placements[target.id]?.[0] || ''" :disabled="readonly" @change="setCorrectMatch(target.id, $event.target.value)">
            <option value="">Correct answer</option>
            <option v-for="choice in questionConfig.choices" :key="choice.id" :value="choice.id">{{ choice.text }}</option>
          </select>
          <button class="drag-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove target" @click="removeTarget(target.id)">×</button>
        </div>
        <p v-if="questionConfig.targets.length === 0" class="empty-inline">No targets yet. Add a target for each place students can drop a card.</p>
      </div>
    </section>

    <section v-if="questionConfig.mode === INLINE_GAP_MATCH_MODE" class="drag-editor__section">
      <div class="drag-editor__section-header">
        <div>
          <strong>Inline expression / sentence</strong>
          <p>Build the exact text students see, inserting gaps where cards should be dropped.</p>
        </div>
        <div class="button-row">
          <button class="text-button" type="button" :disabled="readonly" @click="addInlineText">Add Text</button>
          <button class="text-button" type="button" :disabled="readonly" @click="addInlineGap()">Add Gap</button>
        </div>
      </div>
      <div class="drag-editor__inline-list">
        <div
          v-for="(part, index) in questionConfig.contentParts"
          :key="`${part.type}-${part.id || index}-${index}`"
          class="drag-editor__inline-row"
          :class="inlinePartDragClass(index)"
          @dragover="updateInlinePartDragTarget($event, index)"
          @drop="dropInlinePart($event, index)"
        >
          <button
            class="drag-editor__drag-handle"
            type="button"
            :disabled="readonly"
            draggable="true"
            aria-label="Drag to reorder inline part"
            @dragstart="startInlinePartDrag($event, index)"
            @dragend="clearInlinePartDrag"
          >
            ⋮⋮
          </button>
          <input v-if="part.type === 'text'" class="form-input" :value="part.text" :disabled="readonly" placeholder="Text around gaps" @input="updateInlineText(index, $event.target.value)" />
          <span v-else class="drag-editor__gap-chip">{{ part.label || part.id }}</span>
          <button class="drag-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove part" @click="removeInlinePart(index)">×</button>
        </div>
      </div>
    </section>

    <section class="drag-editor__section drag-editor__section--preview">
      <div class="drag-editor__section-header">
        <div>
          <strong>Student preview</strong>
          <p>Check that the interaction looks clear before saving.</p>
        </div>
      </div>
      <DragAndDropAnswer :question="{ ...question, questionConfig }" :model-value="{ placements: {} }" readonly />
    </section>
  </div>
</template>

<style scoped>
.drag-editor {
  display: grid;
  gap: 12px;
}

.drag-editor__intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid rgba(47, 111, 237, 0.16);
  border-radius: 12px;
  background: rgba(47, 111, 237, 0.06);
}

.drag-editor__intro strong {
  display: block;
  color: #24314a;
  font-size: 14px;
}

.drag-editor__intro p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.drag-editor__section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fbfcfe;
}

.drag-editor__section-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}

.drag-editor__section-header strong {
  display: block;
  color: #24314a;
  font-size: 14px;
}

.drag-editor__section-header p {
  margin: 3px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.drag-editor__warning-list {
  margin: 0;
  padding: 10px 14px 10px 30px;
  border: 1px solid rgba(213, 126, 0, 0.28);
  border-radius: 10px;
  color: #8a5600;
  background: #fff8e6;
}

.drag-editor__mode-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.drag-editor__mode-toggle label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 7px 10px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: #ffffff;
  font-size: 13px;
}

.drag-editor__list,
.drag-editor__inline-list {
  display: grid;
  gap: 8px;
}

.drag-editor__list-header {
  display: grid;
  gap: 8px;
  padding: 0 8px;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.drag-editor__list-header--cards {
  grid-template-columns: minmax(0, 1fr) 30px;
}

.drag-editor__list-header--targets {
  grid-template-columns: minmax(0, 0.85fr) minmax(240px, 1.15fr) 30px;
}

.drag-editor__row {
  display: grid;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 11px;
  background: #ffffff;
}

.drag-editor__row--choice {
  grid-template-columns: minmax(0, 1fr) 30px;
}

.drag-editor__row--target {
  grid-template-columns: minmax(0, 0.85fr) minmax(240px, 1.15fr) 30px;
}

.drag-editor__choice-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.drag-editor__choice-checks .checkbox-label {
  padding: 5px 8px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  background: #f8fafc;
  font-size: 12px;
}

.drag-editor__inline-row {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 30px;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 11px;
  background: #ffffff;
}

.drag-editor__inline-row.is-dragging {
  opacity: 0.56;
}

.drag-editor__inline-row.is-drop-before::before,
.drag-editor__inline-row.is-drop-after::after {
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 999px;
  background: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.12);
  content: '';
}

.drag-editor__inline-row.is-drop-before::before {
  top: -5px;
}

.drag-editor__inline-row.is-drop-after::after {
  bottom: -5px;
}

.drag-editor :deep(.form-input) {
  min-height: 34px;
  padding: 7px 10px;
  font-size: 13px;
}

.drag-editor__drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 9px;
  background: #f8fafc;
  color: #8fa1b8;
  font-size: 16px;
  letter-spacing: -3px;
  cursor: grab;
  user-select: none;
}

.drag-editor__drag-handle:active {
  cursor: grabbing;
}

.drag-editor__drag-handle:hover:not(:disabled) {
  border-color: rgba(47, 111, 237, 0.38);
  color: var(--color-primary);
  background: #f1f6ff;
}

.drag-editor__drag-handle:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.drag-editor__gap-chip {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid rgba(47, 111, 237, 0.28);
  border-radius: 10px;
  background: rgba(47, 111, 237, 0.08);
  color: #1f4fa8;
}

.drag-editor__remove-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 999px;
  background: #ffffff;
  color: #64748b;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.drag-editor__remove-button:hover:not(:disabled) {
  border-color: rgba(220, 38, 38, 0.35);
  color: #b42318;
  background: #fff7f7;
}

.drag-editor__remove-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.drag-editor__section--preview {
  gap: 8px;
  background: #ffffff;
}

.drag-editor__section--preview :deep(.drag-answer) {
  border-color: rgba(148, 163, 184, 0.22);
  background: #fbfcfe;
}

@media (max-width: 900px) {
  .drag-editor__intro {
    grid-template-columns: 1fr;
  }

  .drag-editor__mode-toggle {
    justify-content: flex-start;
  }

  .drag-editor__section-header {
    grid-template-columns: 1fr;
  }

  .drag-editor__section-header .text-button,
  .drag-editor__section-header .button-row {
    justify-self: start;
  }

  .drag-editor__list-header--targets {
    display: none;
  }

  .drag-editor__row--target {
    grid-template-columns: 1fr;
  }

  .drag-editor__row--target .drag-editor__remove-button {
    justify-self: end;
  }
}
</style>
