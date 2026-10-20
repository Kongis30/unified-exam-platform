<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import FormulaText from '@shsat/components/FormulaText.vue';

const props = defineProps({
  options: {
    type: Array,
    default: () => [],
  },
  modelValue: {
    type: [String, Number],
    default: '',
  },
  placeholder: {
    type: String,
    default: 'Select one',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  ariaLabel: {
    type: String,
    default: 'Select an option',
  },
  state: {
    type: String,
    default: '',
    validator: (value) => ['', 'correct', 'incorrect'].includes(value),
  },
});

const emit = defineEmits(['update:modelValue', 'change']);

const rootRef = ref(null);
const listRef = ref(null);
const open = ref(false);
const activeIndex = ref(-1);

const valueKey = () => String(props.modelValue ?? '');
const selectedOption = () => props.options.find((option) => String(option.key) === valueKey()) || null;

function activateDefaultOption() {
  const currentIndex = props.options.findIndex((option) => String(option.key) === valueKey());
  activeIndex.value = currentIndex >= 0 ? currentIndex : 0;
  nextTick(scrollActiveIntoView);
}

function scrollActiveIntoView() {
  const option = listRef.value?.querySelector?.('.rich-select__option--active');
  option?.scrollIntoView?.({ block: 'nearest' });
}

function moveActive(step) {
  if (props.options.length === 0) {
    return;
  }

  const nextIndex = (activeIndex.value + step + props.options.length) % props.options.length;
  activeIndex.value = nextIndex;
  scrollActiveIntoView();
}

function toggle() {
  if (props.disabled) {
    return;
  }

  open.value = !open.value;
  if (open.value) {
    activateDefaultOption();
  }
}

function openList() {
  if (props.disabled || open.value) {
    return;
  }

  open.value = true;
  activateDefaultOption();
}

function select(optionKey) {
  emit('update:modelValue', optionKey);
  emit('change', optionKey);
  open.value = false;
}

function onTriggerKeydown(event) {
  if (props.disabled) {
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) {
      openList();
    } else {
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
    }
    return;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!open.value) {
      openList();
    } else if (props.options[activeIndex.value]) {
      select(props.options[activeIndex.value].key);
    }
    return;
  }

  if (event.key === 'Escape' && open.value) {
    open.value = false;
  }
}

function onDocumentMouseDown(event) {
  if (rootRef.value && !rootRef.value.contains(event.target)) {
    open.value = false;
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown);
});
</script>

<template>
  <div
    ref="rootRef"
    class="rich-select"
    :class="{
      'rich-select--open': open,
      'rich-select--disabled': disabled,
      'rich-select--correct': state === 'correct',
      'rich-select--incorrect': state === 'incorrect',
    }"
  >
    <button
      type="button"
      class="rich-select__trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span v-if="selectedOption()" class="rich-select__value">
        <FormulaText :content="selectedOption().text || 'Option'" />
      </span>
      <span v-else class="rich-select__placeholder"><FormulaText :content="placeholder" /></span>
      <span class="rich-select__caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" ref="listRef" class="rich-select__list" role="listbox">
      <button
        v-for="(option, index) in options"
        :key="option.key"
        type="button"
        role="option"
        class="rich-select__option"
        :class="{
          'rich-select__option--selected': valueKey() === String(option.key),
          'rich-select__option--active': activeIndex === index,
        }"
        :aria-selected="valueKey() === String(option.key) ? 'true' : 'false'"
        @click="select(option.key)"
        @mouseenter="activeIndex = index"
      >
        <span class="rich-select__option-content">
          <span class="rich-select__option-text"><FormulaText :content="option.text || 'Option'" /></span>
          <span v-if="option.badge" class="rich-select__badge">{{ option.badge }}</span>
        </span>
      </button>
      <p v-if="options.length === 0" class="rich-select__empty">No options</p>
    </div>
  </div>
</template>

<style scoped>
.rich-select {
  position: relative;
  display: inline-flex;
  min-width: 136px;
  max-width: 100%;
}

.rich-select__trigger {
  display: inline-flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  padding: 6px 9px;
  color: #24314a;
  background: #ffffff;
  font: inherit;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

.rich-select__trigger:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.rich-select__trigger:focus-visible {
  border-color: var(--color-primary);
  outline: 3px solid rgba(47, 111, 237, 0.16);
}

.rich-select__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.75;
}

.rich-select--correct .rich-select__trigger {
  border-color: var(--color-success);
  background: rgba(20, 135, 101, 0.08);
}

.rich-select--incorrect .rich-select__trigger {
  border-color: var(--color-danger);
  background: #fff1f3;
}

.rich-select__value,
.rich-select__placeholder {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rich-select__value :deep(.formula-text),
.rich-select__placeholder :deep(.formula-text) {
  white-space: nowrap;
}

.rich-select__placeholder {
  color: var(--color-muted);
}

.rich-select__caret {
  flex: 0 0 auto;
  color: var(--color-muted);
  font-size: 10px;
  line-height: 1;
}

.rich-select__list {
  position: absolute;
  z-index: 60;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  gap: 2px;
  min-width: 100%;
  max-width: 320px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  padding: 4px;
  background: #ffffff;
  box-shadow: 0 12px 28px rgba(31, 75, 135, 0.14);
}

.rich-select__option {
  display: flex;
  width: 100%;
  border: 0;
  border-radius: 6px;
  padding: 7px 10px;
  color: #24314a;
  background: transparent;
  font: inherit;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

.rich-select__option-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.rich-select__option-text {
  min-width: 0;
}

.rich-select__badge {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--color-muted);
  background: var(--color-surface-muted, #eef2f8);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
}

.rich-select__option:hover,
.rich-select__option--active {
  background: var(--color-primary-soft);
}

.rich-select__option--selected {
  color: var(--color-primary-strong);
  font-weight: 700;
}

.rich-select__empty {
  margin: 0;
  padding: 8px 10px;
  color: var(--color-muted);
  font-size: 12px;
}
</style>
