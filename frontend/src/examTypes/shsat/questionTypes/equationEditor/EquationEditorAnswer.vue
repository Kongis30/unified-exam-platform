<script setup>
import 'mathlive';

import { computed, nextTick, onMounted, ref, watch } from 'vue';

import {
  enabledButtons,
  normalizeEquationAnswerData,
  normalizeEquationConfig,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: [Object, String],
    default: () => ({ value: '' }),
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  compact: {
    type: Boolean,
    default: false,
  },
  label: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:modelValue']);

const mathFieldRef = ref(null);
const activeToolKey = ref('');
const keypadOpen = ref(false);
const undoStack = ref([]);
const redoStack = ref([]);

const questionConfig = computed(() => normalizeEquationConfig(props.question.questionConfig));
const answerValue = computed(() => normalizeEquationAnswerData(props.modelValue));
const toolGroups = computed(() => enabledButtons(questionConfig.value));
const showKeyboard = computed(() => !props.compact || keypadOpen.value);
const activeToolGroup = computed(() => {
  const groups = toolGroups.value;
  if (!groups.length) {
    return null;
  }
  return groups.find((group) => group.key === activeToolKey.value) || groups[0];
});
onMounted(() => {
  syncMathFieldValue();
});

watch(answerValue, () => {
  syncMathFieldValue();
});

watch(() => props.readonly, () => {
  syncMathFieldState();
});

function syncMathFieldValue() {
  nextTick(() => {
    const mathField = mathFieldRef.value;
    if (!mathField) {
      return;
    }
    syncMathFieldState();
    const nextValue = toMathfieldLatex(answerValue.value);
    if (mathField.value !== nextValue) {
      mathField.value = nextValue;
    }
  });
}

function syncMathFieldState() {
  const mathField = mathFieldRef.value;
  if (!mathField) {
    return;
  }
  mathField.readOnly = props.readonly;
  mathField.mathVirtualKeyboardPolicy = 'manual';
}

function updateValue(value, trackHistory = true) {
  if (props.readonly) {
    return;
  }
  if (trackHistory && value !== answerValue.value) {
    undoStack.value.push(answerValue.value);
    redoStack.value = [];
  }
  emit('update:modelValue', { value });
}

function handleMathInput(event) {
  updateValue(event.target.value);
}

function insertToken(button) {
  if (props.readonly) {
    return;
  }

  const token = typeof button === 'object' ? button.token : button;
  const mathField = mathFieldRef.value;
  if (!mathField) {
    updateValue(`${answerValue.value}${token}`);
    return;
  }

  mathField.focus();
  mathField.insert(token, { focus: true, format: 'latex', selectionMode: 'placeholder' });
  updateValue(mathField.value);
}

function backspace() {
  if (props.readonly) {
    return;
  }
  const mathField = mathFieldRef.value;
  if (!mathField) {
    updateValue(answerValue.value.slice(0, -1));
    return;
  }

  mathField.focus();
  mathField.executeCommand('deleteBackward');
  updateValue(mathField.value);
}

function undo() {
  const previousValue = undoStack.value.pop();
  if (previousValue === undefined) {
    return;
  }
  redoStack.value.push(answerValue.value);
  updateValue(previousValue, false);
  setMathFieldValue(previousValue);
}

function redo() {
  const nextValue = redoStack.value.pop();
  if (nextValue === undefined) {
    return;
  }
  undoStack.value.push(answerValue.value);
  updateValue(nextValue, false);
  setMathFieldValue(nextValue);
}

function buttonLabel(button) {
  return typeof button === 'object' ? button.label : button;
}

function clearAll() {
  updateValue('');
  setMathFieldValue('');
}

function setMathFieldValue(value) {
  const mathField = mathFieldRef.value;
  if (mathField) {
    mathField.value = toMathfieldLatex(value);
  }
}

function toMathfieldLatex(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  if (text.includes('\\')) {
    return text;
  }

  return text
    .replace(/sqrt\s*\(([^()]*)\)/gi, '\\sqrt{$1}')
    .replace(/\bpi\b/gi, '\\pi')
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ')
    .replace(/!=|<>/g, '\\ne ')
    .replace(/\*/g, '\\cdot ');
}
</script>

<template>
  <div class="equation-answer" :class="{ 'equation-answer--compact': compact }">
    <div class="equation-answer__response-box">
      <label class="equation-answer__field">
        <span>{{ label || questionConfig.placeholder }}</span>
        <math-field
          ref="mathFieldRef"
          class="equation-answer__math-field"
          default-mode="math"
          math-virtual-keyboard-policy="manual"
          smart-fence
          smart-mode
          @input="handleMathInput"
          @change="handleMathInput"
          @blur="handleMathInput"
        ></math-field>
      </label>

    </div>

    <button
      v-if="compact"
      class="equation-answer__keypad-toggle"
      type="button"
      :disabled="readonly"
      @click="keypadOpen = !keypadOpen"
    >
      {{ keypadOpen ? 'Hide math keypad' : 'Use math keypad' }}
    </button>

    <div v-if="showKeyboard" class="equation-answer__keyboard" aria-label="Math keyboard">
      <div class="equation-answer__keyboard-header">
        <div class="equation-answer__keyboard-title">
          <strong>Math Keyboard</strong>
          <span>Type in the box or choose a keypad tab.</span>
        </div>
      </div>

      <section v-if="activeToolGroup" class="equation-answer__tools">
        <div class="equation-answer__tabs" role="tablist" aria-label="More math tools">
          <button
            v-for="group in toolGroups"
            :key="group.key"
            type="button"
            :class="{ 'is-active': activeToolGroup?.key === group.key }"
            :disabled="readonly"
            @click="activeToolKey = group.key"
          >
            {{ group.label }}
          </button>
        </div>

        <div class="equation-answer__actions" aria-label="Editing controls">
          <button type="button" :disabled="readonly || !undoStack.length" @click="undo">Undo</button>
          <button type="button" :disabled="readonly || !redoStack.length" @click="redo">Redo</button>
          <button type="button" :disabled="readonly" @click="backspace">Backspace</button>
          <button type="button" :disabled="readonly" @click="clearAll">Clear All</button>
        </div>

        <div class="equation-answer__key-group" :class="`equation-answer__key-group--${activeToolGroup.key}`">
          <span>{{ activeToolGroup.description }}</span>
          <div>
            <button
              v-for="button in activeToolGroup.buttons"
              :key="`${activeToolGroup.key}-${buttonLabel(button)}`"
              type="button"
              :disabled="readonly"
              @click="insertToken(button)"
            >
              {{ buttonLabel(button) }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.equation-answer {
  display: grid;
  gap: 10px;
  max-width: 680px;
}

.equation-answer__response-box {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.equation-answer__field {
  display: grid;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: calc(12px * var(--exam-font-scale));
}

.equation-answer__math-field {
  display: block;
  width: 100%;
  min-height: 48px;
  border: 1px solid #94a3b8;
  border-radius: 10px;
  padding: 8px 10px;
  background: #ffffff;
  color: var(--color-text);
  font-size: calc(20px * var(--exam-font-scale));
  line-height: 1.35;
  --caret-color: var(--color-primary);
  --selection-background-color: rgba(47, 111, 237, 0.18);
}

.equation-answer__math-field:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.14);
  outline: none;
}

.equation-answer__math-field::part(menu-toggle),
.equation-answer__math-field::part(virtual-keyboard-toggle) {
  display: none;
}

.equation-answer__keyboard {
  display: grid;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: #f8fafc;
}

.equation-answer__keypad-toggle {
  appearance: none;
  justify-self: start;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(47, 111, 237, 0.28);
  border-radius: 999px;
  background: rgba(47, 111, 237, 0.06);
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease, opacity 140ms ease;
}

.equation-answer__keypad-toggle:hover:not(:disabled) {
  border-color: rgba(47, 111, 237, 0.4);
  background: rgba(47, 111, 237, 0.1);
  transform: translateY(-1px);
}

.equation-answer__keyboard-header {
  display: grid;
  gap: 2px;
}

.equation-answer__keyboard-title {
  display: grid;
  gap: 2px;
}

.equation-answer__keyboard-title strong {
  color: var(--color-text);
  font-size: 13px;
}

.equation-answer__keyboard-title span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.equation-answer__tabs,
.equation-answer__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.equation-answer__actions {
  justify-content: flex-start;
}

.equation-answer__tabs button {
  appearance: none;
  min-width: 50px;
  min-height: 28px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: #ffffff;
  color: #475569;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, opacity 140ms ease;
}

.equation-answer__tabs button.is-active {
  border-color: var(--color-primary);
  background: rgba(47, 111, 237, 0.1);
  color: var(--color-primary);
}

.equation-answer__key-group {
  display: grid;
  gap: 7px;
}

.equation-answer__key-group span {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 800;
}

.equation-answer__key-group div {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(44px, max-content));
  justify-content: flex-start;
  gap: 6px;
}

.equation-answer__key-group--templates div {
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  max-width: 460px;
}

.equation-answer__key-group--symbols div {
  grid-template-columns: repeat(auto-fit, minmax(54px, max-content));
}

.equation-answer__tools {
  display: grid;
  gap: 8px;
}

.equation-answer__keyboard button {
  appearance: none;
  min-height: 32px;
  min-width: 44px;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #ffffff;
  color: #24314a;
  font: inherit;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease, opacity 140ms ease;
}

.equation-answer__key-group--templates button {
  justify-content: flex-start;
  min-height: 44px;
  padding: 0 12px;
  font-size: calc(13px * var(--exam-font-scale));
  text-align: left;
  white-space: normal;
}

.equation-answer__actions button {
  min-height: 28px;
  padding: 0 9px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.equation-answer__keyboard button:hover:not(:disabled) {
  border-color: rgba(47, 111, 237, 0.45);
  background: rgba(47, 111, 237, 0.08);
  transform: translateY(-1px);
}

.equation-answer__keyboard button:disabled,
.equation-answer__keypad-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.equation-answer__keyboard button:focus-visible,
.equation-answer__keypad-toggle:focus-visible {
  outline: 2px solid rgba(47, 111, 237, 0.32);
  outline-offset: 2px;
}

.equation-answer--compact {
  max-width: none;
}

.equation-answer--compact .equation-answer__response-box {
  padding: 9px;
}

.equation-answer--compact .equation-answer__math-field {
  min-height: 42px;
  font-size: calc(18px * var(--exam-font-scale));
}

.equation-answer--compact .equation-answer__keyboard {
  padding: 10px;
}

@media (max-width: 780px) {
  .equation-answer__keyboard-header {
    display: grid;
  }

  .equation-answer__actions {
    justify-content: flex-start;
  }

  .equation-answer__key-group--templates div {
    grid-template-columns: 1fr;
  }
}
</style>
