<script setup>
import { computed, ref } from 'vue';

import {
  getHotTextValidationIssues,
  markTextRangeSelectable,
  nextSegmentId,
  normalizeHotTextAnswerData,
  normalizeHotTextConfig,
  plainTextFromParts,
  replacePlainText,
  selectableSegments,
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

const passageInput = ref(null);

const questionConfig = computed(() => normalizeHotTextConfig(props.question.questionConfig));
const contentText = computed(() => plainTextFromParts(questionConfig.value.contentParts));
const segments = computed(() => selectableSegments(questionConfig.value));
const correctIds = computed(() => normalizeHotTextAnswerData(props.question.correctAnswerData, questionConfig.value));
const validationIssues = computed(() => getHotTextValidationIssues(props.question));

function patchEditor(nextConfig, nextCorrectIds = correctIds.value) {
  if (props.readonly) {
    return;
  }

  emit('patch', {
    options: [],
    questionConfig: {
      ...questionConfig.value,
      ...nextConfig,
      selectionMode: 'multi',
    },
    correctAnswerData: {
      selectedSegmentIds: nextCorrectIds,
    },
  });
  emit('dirty');
}

function updatePassageText(value) {
  patchEditor({ contentParts: replacePlainText(value) }, []);
}

function makeSelectionClickable() {
  if (props.readonly || !passageInput.value) {
    return;
  }

  const start = passageInput.value.selectionStart;
  const end = passageInput.value.selectionEnd;
  if (start === end) {
    return;
  }

  const nextContentParts = markTextRangeSelectable(
    questionConfig.value.contentParts,
    start,
    end,
    nextSegmentId(questionConfig.value.contentParts)
  );
  const nextSegmentIds = new Set(selectableSegments({ contentParts: nextContentParts }).map((segment) => segment.id));

  patchEditor(
    { contentParts: nextContentParts },
    correctIds.value.filter((id) => nextSegmentIds.has(id))
  );
}

function removeSegment(segmentId) {
  const nextParts = questionConfig.value.contentParts.map((part) => (
    part.type === 'segment' && part.id === segmentId
      ? { type: 'text', text: part.text }
      : part
  ));
  patchEditor(nextParts.length ? { contentParts: nextParts } : {}, correctIds.value.filter((id) => id !== segmentId));
}

function toggleCorrect(segmentId) {
  patchEditor(
    {},
    correctIds.value.includes(segmentId)
      ? correctIds.value.filter((id) => id !== segmentId)
      : [...correctIds.value, segmentId]
  );
}
</script>

<template>
  <div class="type-editor-panel hot-text-editor">
    <div class="hot-text-editor__intro">
      <strong>Build a hot text question</strong>
      <p>Select text in the passage, make it clickable, then mark which clickable segments are correct.</p>
    </div>
    <ul v-if="validationIssues.length" class="hot-text-editor__warning-list">
      <li v-for="issue in validationIssues" :key="issue">{{ issue }}</li>
    </ul>

    <section class="hot-text-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Passage Text</strong>
          <p class="section-note">Paste the passage, select a word or phrase, then add it as a clickable segment.</p>
        </div>
        <button class="hot-text-editor__mark-button" type="button" :disabled="readonly" @click="makeSelectionClickable">
          <span aria-hidden="true">+</span>
          Make selected text clickable
        </button>
      </div>
      <textarea
        ref="passageInput"
        class="form-input hot-text-editor__textarea"
        rows="6"
        :value="contentText"
        :disabled="readonly"
        placeholder="Paste the paragraph or sentences here, select a word or phrase, then click Make Selection Clickable."
        @input="updatePassageText($event.target.value)"
      ></textarea>
      <div class="hot-text-editor__marked-passage">
        <div class="hot-text-editor__marked-heading">
          <strong>Marked clickable text</strong>
          <span>{{ segments.length }} {{ segments.length === 1 ? 'segment' : 'segments' }}</span>
        </div>
        <div v-if="segments.length" class="hot-text-editor__marked-preview">
          <template v-for="(part, index) in questionConfig.contentParts" :key="`${part.type}-${part.id || index}`">
            <mark v-if="part.type === 'segment'" class="hot-text-editor__marked-segment" :class="{ 'is-correct': correctIds.includes(part.id) }">
              {{ part.text }}
            </mark>
            <span v-else>{{ part.text }}</span>
          </template>
        </div>
        <p v-else class="hot-text-editor__marked-empty">
          No text has been marked clickable yet. Select text in the passage above, then use the button.
        </p>
      </div>
    </section>

    <section class="hot-text-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Selected Segments</strong>
          <p class="section-note">Each segment becomes clickable for students. Mark the segments that should count as correct.</p>
        </div>
      </div>
      <div v-if="segments.length" class="hot-text-editor__segments">
        <div
          v-for="(segment, index) in segments"
          :key="segment.id"
          class="hot-text-editor__segment-card"
          :class="{ 'hot-text-editor__segment-card--correct': correctIds.includes(segment.id) }"
        >
          <div class="hot-text-editor__segment-main">
            <span class="hot-text-editor__segment-index">{{ index + 1 }}</span>
            <span class="hot-text-editor__segment-text">{{ segment.text }}</span>
          </div>
          <label class="hot-text-editor__correct-control">
            <input type="checkbox" :checked="correctIds.includes(segment.id)" :disabled="readonly" @change="toggleCorrect(segment.id)" />
            <span>{{ correctIds.includes(segment.id) ? 'Correct' : 'Mark correct' }}</span>
          </label>
          <button class="hot-text-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove segment" @click="removeSegment(segment.id)">&times;</button>
        </div>
      </div>
      <p v-else class="hot-text-editor__empty">No clickable text yet. Select text in the passage and make it clickable.</p>
    </section>

    <section class="hot-text-editor__section hot-text-editor__section--preview">
      <div class="subsection-title">
        <div>
          <strong>Student Preview</strong>
          <p class="section-note">Clickable segments are highlighted below.</p>
        </div>
      </div>
      <div class="hot-text-editor__preview">
        <template v-for="(part, index) in questionConfig.contentParts" :key="`${part.type}-${part.id || index}`">
          <span v-if="part.type === 'segment'" class="hot-text-editor__preview-segment" :class="{ 'is-correct': correctIds.includes(part.id) }">{{ part.text }}</span>
          <span v-else>{{ part.text }}</span>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hot-text-editor {
  display: grid;
  gap: 12px;
}

.hot-text-editor__intro {
  padding: 12px 14px;
  border: 1px solid rgba(47, 111, 237, 0.16);
  border-radius: 12px;
  background: rgba(47, 111, 237, 0.06);
}

.hot-text-editor__intro strong {
  display: block;
  color: #24314a;
  font-size: 14px;
}

.hot-text-editor__intro p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.hot-text-editor__section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #fbfcfe;
}

.hot-text-editor__warning-list {
  margin: 0;
  padding: 10px 14px 10px 30px;
  border: 1px solid rgba(213, 126, 0, 0.28);
  border-radius: 10px;
  color: #8a5600;
  background: #fff8e6;
}

.hot-text-editor__textarea {
  min-height: 120px;
}

.hot-text-editor__mark-button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  align-self: start;
  min-height: 34px;
  border: 1px solid rgba(47, 111, 237, 0.34);
  border-radius: 999px;
  padding: 0 14px;
  color: #ffffff;
  background: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.16);
}

.hot-text-editor__mark-button span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  color: var(--color-primary);
  background: #ffffff;
  font-size: 13px;
  line-height: 1;
}

.hot-text-editor__mark-button:hover:not(:disabled) {
  background: var(--color-primary-strong);
}

.hot-text-editor__mark-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}

.hot-text-editor__marked-passage {
  display: grid;
  gap: 8px;
  border: 1px dashed rgba(47, 111, 237, 0.22);
  border-radius: 11px;
  padding: 10px;
  background: #ffffff;
}

.hot-text-editor__marked-heading {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.hot-text-editor__marked-heading strong {
  color: var(--color-text);
  font-size: 13px;
}

.hot-text-editor__marked-heading span {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.hot-text-editor__marked-preview {
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.hot-text-editor__marked-segment {
  margin: 0 2px;
  border: 1px solid rgba(47, 111, 237, 0.28);
  border-radius: 7px;
  padding: 1px 6px;
  color: #1f4fa8;
  background: rgba(47, 111, 237, 0.1);
  font-weight: 700;
}

.hot-text-editor__marked-segment.is-correct {
  border-color: rgba(47, 111, 237, 0.5);
  background: rgba(47, 111, 237, 0.16);
  box-shadow: inset 0 0 0 1px rgba(47, 111, 237, 0.18);
}

.hot-text-editor__marked-empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.hot-text-editor__segments {
  display: grid;
  gap: 8px;
}

.hot-text-editor__segment-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 28px;
  gap: 10px;
  align-items: center;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 11px;
  background: #ffffff;
}

.hot-text-editor__segment-card--correct {
  border-color: rgba(47, 111, 237, 0.34);
  background: #f8fbff;
}

.hot-text-editor__segment-main {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.hot-text-editor__segment-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--color-primary);
  background: rgba(47, 111, 237, 0.1);
  font-size: 12px;
  font-weight: 800;
}

.hot-text-editor__segment-text {
  min-width: 0;
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.45;
}

.hot-text-editor__correct-control {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  border: 1px solid rgba(47, 111, 237, 0.22);
  border-radius: 999px;
  padding: 6px 10px;
  color: var(--color-primary);
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.hot-text-editor__correct-control input {
  margin: 0;
}

.hot-text-editor__remove-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(199, 55, 71, 0.22);
  border-radius: 999px;
  color: var(--color-danger);
  background: #ffffff;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.hot-text-editor__remove-button:hover:not(:disabled) {
  background: #fff4f5;
}

.hot-text-editor__remove-button:disabled,
.hot-text-editor__correct-control:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.55;
}

.hot-text-editor__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.hot-text-editor__section--preview {
  background: #ffffff;
}

.hot-text-editor__preview {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #ffffff;
  line-height: 1.8;
  white-space: pre-wrap;
}

.hot-text-editor__preview-segment {
  margin: 0 2px;
  border-radius: 7px;
  padding: 2px 6px;
  background: rgba(47, 111, 237, 0.08);
  color: #1f4fa8;
}

.hot-text-editor__preview-segment.is-correct {
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

@media (max-width: 720px) {
  .hot-text-editor__segment-card {
    grid-template-columns: 1fr;
  }

  .hot-text-editor__remove-button {
    justify-self: start;
  }
}
</style>
