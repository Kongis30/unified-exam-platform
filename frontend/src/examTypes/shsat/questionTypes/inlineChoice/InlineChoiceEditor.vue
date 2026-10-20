<script setup>
import { computed, nextTick, ref, watch } from 'vue';

import AppButton from '@/components/AppButton.vue';
import FormulaText from '@shsat/components/FormulaText.vue';
import RichSelect from '@shsat/components/RichSelect.vue';
import {
  createInlineChoicePlaceholder,
  getInlineChoiceValidationIssues,
  parseInlineTextParts,
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

const paragraphEditor = ref(null);
const textPartRefs = ref({});
const selectedBlankId = ref('');
const activeTextCaret = ref({ partIndex: 0, offset: 0 });

const questionConfig = computed(() => props.question.questionConfig || {});
const blanks = computed(() => Array.isArray(questionConfig.value.blanks) ? questionConfig.value.blanks : []);
const answerMap = computed(() => props.question.correctAnswerData?.answers || {});
const inlineText = computed(() => String(questionConfig.value.inlineText || ''));
const previewParts = computed(() => parseInlineTextParts(inlineText.value));
const editorParts = computed(() => materializeEditableParts(inlineText.value));
const validationIssues = computed(() => getInlineChoiceValidationIssues(props.question));

watch(blanks, (nextBlanks) => {
  if (!nextBlanks.some((blank) => blank.id === selectedBlankId.value)) {
    selectedBlankId.value = nextBlanks[0]?.id || '';
  }
}, { immediate: true });

function optionLabel(option) {
  return String(option?.text || '').trim() || 'Option';
}

function optionKeyFromIndex(index) {
  let cursor = index;
  let key = '';

  do {
    key = String.fromCharCode(65 + (cursor % 26)) + key;
    cursor = Math.floor(cursor / 26) - 1;
  } while (cursor >= 0);

  return key;
}

function nextOptionKey(options = []) {
  const usedKeys = new Set(options.map((option) => option.key).filter(Boolean));
  let index = 0;
  let key = optionKeyFromIndex(index);

  while (usedKeys.has(key)) {
    index += 1;
    key = optionKeyFromIndex(index);
  }

  return key;
}

function nextBlankId() {
  const usedIds = new Set(blanks.value.map((blank) => blank.id));
  let index = blanks.value.length + 1;

  while (usedIds.has(`blank${index}`)) {
    index += 1;
  }

  return `blank${index}`;
}

function materializeEditableParts(value) {
  const parsedParts = parseInlineTextParts(value);
  const editableParts = [];

  parsedParts.forEach((part, index) => {
    if (part.type === 'blank' && (editableParts.length === 0 || editableParts.at(-1)?.type === 'blank')) {
      editableParts.push({ type: 'text', text: '' });
    }

    editableParts.push(part);

    if (part.type === 'blank') {
      const nextPart = parsedParts[index + 1];
      if (!nextPart || nextPart.type === 'blank') {
        editableParts.push({ type: 'text', text: '' });
      }
    }
  });

  return editableParts.length > 0 ? editableParts : [{ type: 'text', text: '' }];
}

function buildInlineTextFromParts(parts) {
  return parts.map((part) => (
    part.type === 'blank' ? createInlineChoicePlaceholder(part.id) : part.text || ''
  )).join('');
}

function setTextPartRef(element, index) {
  if (element) {
    textPartRefs.value[index] = element;
  } else {
    delete textPartRefs.value[index];
  }
}

function readCaretOffset(element) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !element.contains(selection.anchorNode)) {
    return element.textContent.length;
  }

  const range = selection.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.endContainer, range.endOffset);

  return preCaretRange.toString().length;
}

function setCaretOffset(element, offset) {
  const selection = window.getSelection();
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remainingOffset = Math.max(0, offset);
  let currentNode = walker.nextNode();

  while (currentNode) {
    if (remainingOffset <= currentNode.textContent.length) {
      range.setStart(currentNode, remainingOffset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    remainingOffset -= currentNode.textContent.length;
    currentNode = walker.nextNode();
  }

  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusTextPart(partIndex, offset = 0) {
  nextTick(() => {
    const element = textPartRefs.value[partIndex];
    if (!element || props.readonly) {
      return;
    }

    element.focus();
    setCaretOffset(element, offset);
  });
}

function rememberTextCaret(partIndex, event) {
  activeTextCaret.value = {
    partIndex,
    offset: readCaretOffset(event.currentTarget),
  };
}

function patchEditor(nextConfig, nextAnswerMap = answerMap.value) {
  if (props.readonly) {
    return;
  }

  const normalizedConfig = {
    ...questionConfig.value,
    ...nextConfig,
  };

  emit('patch', {
    questionConfig: normalizedConfig,
    inlineChoices: normalizedConfig.blanks || [],
    correctAnswerData: {
      ...(props.question.correctAnswerData || {}),
      answers: nextAnswerMap,
    },
  });
  emit('dirty');
}

function updateTextPart(partIndex, nextText, nextOffset) {
  const parts = editorParts.value.map((part) => ({ ...part }));
  if (parts[partIndex]?.type !== 'text') {
    return;
  }

  parts[partIndex].text = nextText;
  activeTextCaret.value = { partIndex, offset: nextOffset };
  patchEditor({ inlineText: buildInlineTextFromParts(parts) });
  focusTextPart(partIndex, nextOffset);
}

function updateTextPartFromEvent(partIndex, event) {
  updateTextPart(partIndex, event.currentTarget.textContent || '', readCaretOffset(event.currentTarget));
}

function insertTextIntoPart(partIndex, text) {
  const element = textPartRefs.value[partIndex];
  const currentText = element?.textContent || '';
  const start = element ? readCaretOffset(element) : currentText.length;
  const nextText = `${currentText.slice(0, start)}${text}${currentText.slice(start)}`;

  updateTextPart(partIndex, nextText, start + text.length);
}

function insertLineBreak(partIndex, event) {
  event.preventDefault();
  insertTextIntoPart(partIndex, '\n');
}

function pastePlainText(partIndex, event) {
  event.preventDefault();
  insertTextIntoPart(partIndex, event.clipboardData?.getData('text/plain') || '');
}

function createDefaultBlank(id) {
  return {
    id,
    label: `Dropdown ${blanks.value.length + 1}`,
    options: [
      { key: 'A', text: 'Option' },
      { key: 'B', text: 'Option' },
    ],
  };
}

function insertDropdown() {
  if (props.readonly) {
    return;
  }

  const id = nextBlankId();
  const parts = editorParts.value.map((part) => ({ ...part }));
  let partIndex = activeTextCaret.value.partIndex;

  if (parts[partIndex]?.type !== 'text') {
    partIndex = parts.findLastIndex((part) => part.type === 'text');
  }
  if (partIndex < 0) {
    parts.push({ type: 'text', text: '' });
    partIndex = parts.length - 1;
  }

  const currentText = parts[partIndex].text || '';
  const offset = Math.min(Math.max(activeTextCaret.value.offset, 0), currentText.length);
  const beforeText = currentText.slice(0, offset);
  const afterText = currentText.slice(offset);

  parts.splice(
    partIndex,
    1,
    { type: 'text', text: beforeText },
    { type: 'blank', id },
    { type: 'text', text: afterText }
  );

  selectedBlankId.value = id;
  patchEditor({
    inlineText: buildInlineTextFromParts(parts),
    blanks: [...blanks.value, createDefaultBlank(id)],
  }, { ...answerMap.value, [id]: '' });

  focusTextPart(partIndex + 2, 0);
}

function focusEditorEnd() {
  if (props.readonly) {
    return;
  }

  const lastTextIndex = editorParts.value.findLastIndex((part) => part.type === 'text');
  const offset = editorParts.value[lastTextIndex]?.text?.length || 0;
  activeTextCaret.value = { partIndex: lastTextIndex, offset };
  focusTextPart(lastTextIndex, offset);
}

function selectDropdown(blankId) {
  selectedBlankId.value = blankId;
}

function dropdownLabel(blankId) {
  const blankIndex = blanks.value.findIndex((candidate) => candidate.id === blankId);
  const blank = blanks.value[blankIndex];

  return blank?.label || `Dropdown ${blankIndex >= 0 ? blankIndex + 1 : ''}`.trim();
}

function removeInlineDropdown(blankId) {
  const blankIndex = blanks.value.findIndex((blank) => blank.id === blankId);
  if (blankIndex >= 0) {
    removeBlank(blankIndex);
  }
}

function removeBlank(index) {
  const removed = blanks.value[index];
  const nextBlanks = blanks.value.filter((_, blankIndex) => blankIndex !== index);
  const nextAnswers = { ...answerMap.value };
  let nextText = inlineText.value;

  if (removed?.id) {
    delete nextAnswers[removed.id];
    nextText = nextText.replaceAll(createInlineChoicePlaceholder(removed.id), '');
  }

  patchEditor({ blanks: nextBlanks, inlineText: nextText }, nextAnswers);
}

function updateBlank(index, patch) {
  const currentBlank = blanks.value[index];
  const nextBlank = { ...currentBlank, ...patch };
  const nextBlanks = blanks.value.map((blank, blankIndex) => (blankIndex === index ? nextBlank : blank));
  const nextAnswers = { ...answerMap.value };
  let nextText = inlineText.value;

  if (patch.id !== undefined && currentBlank.id !== patch.id) {
    nextAnswers[patch.id] = nextAnswers[currentBlank.id] || '';
    delete nextAnswers[currentBlank.id];
    nextText = nextText.replaceAll(
      createInlineChoicePlaceholder(currentBlank.id),
      createInlineChoicePlaceholder(patch.id)
    );
    selectedBlankId.value = patch.id;
  }

  patchEditor({ blanks: nextBlanks, inlineText: nextText }, nextAnswers);
}

function updateBlankOptions(index, options) {
  const blank = blanks.value[index];
  const validKeys = new Set(options.map((option) => option.key));
  const nextAnswers = { ...answerMap.value };

  if (!validKeys.has(nextAnswers[blank.id])) {
    nextAnswers[blank.id] = '';
  }

  patchEditor({
    blanks: blanks.value.map((item, blankIndex) => (blankIndex === index ? { ...item, options } : item)),
  }, nextAnswers);
}

function updateOptionText(blankIndex, optionIndex, text) {
  const blank = blanks.value[blankIndex];
  const nextOptions = (blank.options || []).map((option, index) => (
    index === optionIndex ? { ...option, text } : option
  ));

  updateBlankOptions(blankIndex, nextOptions);
}

function insertOptionFormula(blankIndex, optionIndex, mode = 'inline') {
  const option = blanks.value[blankIndex]?.options?.[optionIndex];
  if (!option) {
    return;
  }

  const source = String(option.text || '');
  const needsGap = source && !/\s$/.test(source);
  const snippet = mode === 'block' ? `${source ? '\n' : ''}$$\nx^2\n$$` : `${needsGap ? ' ' : ''}$x^2$`;
  updateOptionText(blankIndex, optionIndex, `${source}${snippet}`);
}

function addOption(blankIndex) {
  const blank = blanks.value[blankIndex];
  const currentOptions = blank.options || [];
  const nextOptions = [
    ...currentOptions,
    { key: nextOptionKey(currentOptions), text: 'Option' },
  ];

  updateBlankOptions(blankIndex, nextOptions);
}

function removeOption(blankIndex, optionIndex) {
  const blank = blanks.value[blankIndex];
  const removedOption = blank.options?.[optionIndex];
  const nextOptions = (blank.options || []).filter((_, index) => index !== optionIndex);
  const nextAnswers = { ...answerMap.value };

  if (removedOption?.key && nextAnswers[blank.id] === removedOption.key) {
    nextAnswers[blank.id] = '';
  }

  patchEditor({
    blanks: blanks.value.map((item, index) => (index === blankIndex ? { ...item, options: nextOptions } : item)),
  }, nextAnswers);
}

function setCorrectAnswer(blankId, optionKey) {
  patchEditor({ blanks: blanks.value }, { ...answerMap.value, [blankId]: optionKey });
}

function previewOptionText(blank, optionKey) {
  const option = (blank.options || []).find((candidate) => candidate.key === optionKey);
  return option ? optionLabel(option) : '';
}
</script>

<template>
  <div class="inline-choice-editor">
    <p class="section-note">
      Write the paragraph naturally, insert dropdowns where students should choose an answer, then set each answer key.
    </p>

    <ul v-if="validationIssues.length" class="inline-choice-editor__warnings">
      <li v-for="issue in validationIssues" :key="issue">{{ issue }}</li>
    </ul>

    <section class="inline-choice-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Paragraph</strong>
          <p class="section-note">Type the sentence, place the cursor, then add a dropdown token.</p>
        </div>
        <AppButton variant="secondary" :disabled="readonly" @click="insertDropdown">
          Add Dropdown
        </AppButton>
      </div>
      <div class="inline-choice-editor__insert-row">
        <div
          ref="paragraphEditor"
          class="inline-choice-editor__visual-editor"
          :class="{ 'inline-choice-editor__visual-editor--readonly': readonly }"
          role="textbox"
          aria-multiline="true"
          tabindex="0"
          @click.self="focusEditorEnd"
        >
          <template v-for="(part, index) in editorParts" :key="`${part.type}-${part.id || index}`">
            <span
              v-if="part.type === 'text'"
              :ref="(element) => setTextPartRef(element, index)"
              class="inline-choice-editor__text-part"
              :contenteditable="!readonly"
              :data-placeholder="!inlineText && index === 0 ? 'Type paragraph text here...' : ''"
              @click="rememberTextCaret(index, $event)"
              @keyup="rememberTextCaret(index, $event)"
              @input="updateTextPartFromEvent(index, $event)"
              @keydown.enter="insertLineBreak(index, $event)"
              @paste="pastePlainText(index, $event)"
            >{{ part.text }}</span>
            <button
              v-else
              class="inline-choice-editor__chip"
              :class="{ 'inline-choice-editor__chip--selected': part.id === selectedBlankId }"
              type="button"
              :disabled="readonly"
              @click="selectDropdown(part.id)"
            >
              <FormulaText :content="dropdownLabel(part.id)" />
              <span class="inline-choice-editor__chip-remove" @click.stop="removeInlineDropdown(part.id)">&times;</span>
            </button>
          </template>
        </div>
      </div>
    </section>

    <section class="inline-choice-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Dropdown Configuration</strong>
          <p class="section-note">Each dropdown owns its answer choices and correct answer.</p>
        </div>
      </div>

      <div v-if="blanks.length" class="inline-choice-editor__blank-list">
        <article
          v-for="(blank, index) in blanks"
          :key="`${blank.id}-${index}`"
          class="inline-choice-editor__blank-card"
          :class="{ 'inline-choice-editor__blank-card--selected': blank.id === selectedBlankId }"
        >
          <div class="inline-choice-editor__blank-header">
            <button
              class="inline-choice-editor__blank-title"
              type="button"
              :disabled="readonly"
              @click="selectDropdown(blank.id)"
            >
              <span>Dropdown {{ index + 1 }}</span>
              <strong><FormulaText :content="blank.label || blank.id" /></strong>
            </button>
            <button class="inline-choice-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove dropdown" @click="removeBlank(index)">
              &times;
            </button>
          </div>

          <div class="inline-choice-editor__blank-meta">
            <label class="form-field">
              <span class="form-label">Display Name</span>
              <input
                class="form-input"
                :value="blank.label"
                :disabled="readonly"
                @input="updateBlank(index, { label: $event.target.value })"
              />
            </label>
          </div>

          <div class="form-field">
            <div class="inline-choice-editor__option-heading">
              <span class="form-label">Options</span>
              <AppButton variant="secondary" :disabled="readonly" @click="addOption(index)">Add Option</AppButton>
            </div>
            <div class="inline-choice-editor__option-list">
              <div v-for="(option, optionIndex) in blank.options" :key="`${blank.id}-${option.key}-${optionIndex}`" class="inline-choice-editor__option-card">
                <div class="inline-choice-editor__option-main">
                  <label class="inline-choice-editor__correct-option" :title="answerMap[blank.id] === option.key ? 'Correct answer' : 'Mark as correct'">
                    <input
                      type="radio"
                      :name="`inline-choice-${question.localId || question.questionId || 'draft'}-${blank.id}`"
                      :checked="answerMap[blank.id] === option.key"
                      :disabled="readonly"
                      @change="setCorrectAnswer(blank.id, option.key)"
                    />
                    <span>Correct</span>
                  </label>
                  <input
                    class="form-input"
                    :value="option.text"
                    :disabled="readonly"
                    placeholder="Option text"
                    @input="updateOptionText(index, optionIndex, $event.target.value)"
                  />
                  <div class="inline-choice-editor__formula-actions" aria-label="Option formula tools">
                    <button type="button" :disabled="readonly" @click="insertOptionFormula(index, optionIndex, 'inline')">Formula</button>
                    <button type="button" :disabled="readonly" @click="insertOptionFormula(index, optionIndex, 'block')">Block</button>
                  </div>
                  <button
                    class="inline-choice-editor__remove-button"
                    type="button"
                    :disabled="readonly"
                    aria-label="Delete option"
                    @click="removeOption(index, optionIndex)"
                  >
                    &times;
                  </button>
                </div>
                <div class="inline-choice-editor__option-preview" aria-label="Option review">
                  <span class="inline-choice-editor__option-review-label">Option Review:</span>
                  <FormulaText v-if="option.text" :content="option.text" />
                  <em v-else>No option text.</em>
                </div>
              </div>
            </div>
            <button
              v-if="answerMap[blank.id]"
              class="inline-choice-editor__clear-answer"
              type="button"
              :disabled="readonly"
              @click="setCorrectAnswer(blank.id, '')"
            >
              Clear correct answer
            </button>
          </div>
        </article>
      </div>
      <p v-else class="empty-inline">No dropdowns yet. Place the cursor in the paragraph and insert one.</p>
    </section>

    <section class="inline-choice-editor__section inline-choice-editor__section--preview">
      <div class="subsection-title">
        <div>
          <strong>Student Preview</strong>
          <p class="section-note">Read-only rendering of the inline dropdown paragraph.</p>
        </div>
      </div>
      <div class="inline-choice-editor__preview">
        <template v-for="(part, index) in previewParts" :key="`${part.type}-${part.id || index}`">
          <FormulaText v-if="part.type === 'text'" :content="part.text" />
          <RichSelect
            v-else
            class="inline-choice-editor__preview-select"
            :options="blanks.find((blank) => blank.id === part.id)?.options || []"
            :placeholder="dropdownLabel(part.id)"
            disabled
          />
        </template>
      </div>
      <div class="inline-choice-editor__answer-preview">
        <strong>Answer key:</strong>
        <span v-if="blanks.length">
          <span v-for="(blank, index) in blanks" :key="blank.id" class="inline-choice-editor__answer-item">
            <FormulaText :content="blank.label || `Dropdown ${index + 1}`" />:
            <FormulaText v-if="previewOptionText(blank, answerMap[blank.id])" :content="previewOptionText(blank, answerMap[blank.id])" />
            <span v-else>Not set</span>
          </span>
        </span>
        <span v-else>Not set</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.inline-choice-editor {
  display: grid;
  gap: 12px;
}

.inline-choice-editor__section,
.inline-choice-editor__blank-card {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(31, 75, 135, 0.12);
  border-radius: var(--paper-radius-sm);
  padding: 10px;
  background: #ffffff;
}

.inline-choice-editor__warnings {
  display: grid;
  gap: 4px;
  margin: 0;
  border: 1px solid rgba(199, 55, 71, 0.26);
  border-radius: var(--paper-radius-sm);
  padding: 8px 10px 8px 28px;
  color: var(--color-danger);
  background: #fff6f7;
  font-size: 12px;
}

.inline-choice-editor__insert-row,
.inline-choice-editor__blank-meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  align-items: end;
}

.inline-choice-editor__visual-editor {
  min-height: 96px;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-sm);
  padding: 10px;
  background: #ffffff;
  color: var(--color-text);
  font-size: 14px;
  line-height: 2;
  white-space: pre-wrap;
}

.inline-choice-editor__visual-editor:focus-within {
  border-color: rgba(31, 75, 135, 0.48);
  box-shadow: 0 0 0 2px rgba(31, 75, 135, 0.08);
}

.inline-choice-editor__visual-editor--readonly {
  background: #f8fafc;
}

.inline-choice-editor__text-part {
  min-width: 2px;
  outline: none;
  white-space: pre-wrap;
}

.inline-choice-editor__text-part:empty::before {
  color: var(--color-muted);
  content: attr(data-placeholder);
  pointer-events: none;
}

.inline-choice-editor__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 4px;
  border: 1px solid rgba(47, 111, 237, 0.34);
  border-radius: 999px;
  padding: 3px 10px;
  color: var(--color-primary);
  background: #edf5ff;
  font: inherit;
  line-height: 1.4;
  cursor: pointer;
}

.inline-choice-editor__chip--selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(31, 75, 135, 0.12);
}

.inline-choice-editor__chip:disabled {
  cursor: default;
  opacity: 0.72;
}

.inline-choice-editor__chip-remove {
  color: var(--color-muted);
  font-weight: 700;
}

.inline-choice-editor__chip-remove:hover {
  color: var(--color-danger);
}

.inline-choice-editor__blank-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.inline-choice-editor__blank-meta {
  grid-template-columns: minmax(0, 1fr);
}

.inline-choice-editor__blank-list {
  display: grid;
  gap: 10px;
}

.inline-choice-editor__blank-card--selected {
  border-color: rgba(31, 75, 135, 0.36);
  box-shadow: 0 0 0 2px rgba(31, 75, 135, 0.08);
}

.inline-choice-editor__blank-title {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  border: 0;
  padding: 0;
  color: var(--color-text);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.inline-choice-editor__blank-title span {
  color: var(--color-muted);
  font-weight: 700;
}

.inline-choice-editor__blank-title strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-primary-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-choice-editor__option-heading,
.inline-choice-editor__answer-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.inline-choice-editor__option-list {
  display: grid;
  gap: 8px;
}

.inline-choice-editor__option-card {
  display: grid;
  gap: 7px;
  border: 1px solid rgba(31, 75, 135, 0.1);
  border-radius: var(--paper-radius-sm);
  padding: 6px;
  background: #fbfdff;
}

.inline-choice-editor__option-main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 28px;
  gap: 8px;
  align-items: center;
}

.inline-choice-editor__formula-actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.inline-choice-editor__formula-actions button {
  border: 1px solid rgba(31, 75, 135, 0.16);
  border-radius: 999px;
  padding: 4px 7px;
  color: #1f4b87;
  background: #ffffff;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.inline-choice-editor__formula-actions button:hover:not(:disabled) {
  border-color: rgba(47, 111, 237, 0.34);
  background: #eef5ff;
}

.inline-choice-editor__formula-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.inline-choice-editor__option-preview {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  border-top: 1px dashed rgba(31, 75, 135, 0.12);
  padding-top: 7px;
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.45;
}

.inline-choice-editor__option-review-label {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: none;
}

.inline-choice-editor__option-preview :deep(.formula-text) {
  text-transform: none;
}

.inline-choice-editor__option-preview em {
  color: var(--color-muted);
  font-style: normal;
}

.inline-choice-editor__correct-option {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  color: var(--color-text);
  font-size: 12px;
  font-weight: 700;
}

.inline-choice-editor__remove-button {
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

.inline-choice-editor__remove-button:hover:not(:disabled) {
  background: #fff4f5;
}

.inline-choice-editor__remove-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.inline-choice-editor__clear-answer {
  justify-self: start;
  border: 0;
  padding: 0;
  color: var(--color-muted);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.inline-choice-editor__clear-answer:hover:not(:disabled) {
  color: var(--color-danger);
}

.inline-choice-editor__section--preview {
  gap: 8px;
  background: #fbfdff;
}

.inline-choice-editor__preview {
  min-height: 44px;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-sm);
  padding: 10px;
  background: #fbfdff;
  color: var(--color-text);
  font-size: 14px;
  line-height: 2.2;
  white-space: pre-wrap;
}

.inline-choice-editor__preview-select {
  min-width: 130px;
  margin: 0 4px;
}

.inline-choice-editor__answer-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--color-muted);
  font-size: 12px;
}

.inline-choice-editor__answer-item {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
}

.inline-choice-editor__answer-item :deep(.formula-text) {
  white-space: nowrap;
}

@media (max-width: 680px) {
  .inline-choice-editor__insert-row,
  .inline-choice-editor__blank-meta,
  .inline-choice-editor__option-heading,
  .inline-choice-editor__answer-row {
    grid-template-columns: 1fr;
  }

  .inline-choice-editor__option-main {
    grid-template-columns: auto minmax(0, 1fr) 28px;
  }

  .inline-choice-editor__formula-actions {
    grid-column: 2 / 4;
    justify-content: flex-end;
  }
}
</style>
