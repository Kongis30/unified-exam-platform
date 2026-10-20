<script setup>
import { computed } from 'vue';

import {
  TABLE_GRID_MULTI_MODE,
  TABLE_GRID_TEXT_MODE,
  normalizeTableGridAnswerMap,
  normalizeTableGridColumnIds,
  normalizeTableGridItems,
  normalizeTableGridMode,
  normalizeTableGridTextCellMap,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: [Object, Array, String, Number, Boolean],
    default: '',
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  answersVisible: {
    type: Boolean,
    default: false,
  },
  correctAnswerData: {
    type: [Object, String, null],
    default: null,
  },
});

const emit = defineEmits(['update:modelValue', 'change']);

// Fall back to questionConfig.rows/columns so a paper stored without the top-level
// tableRows/tableColumns fields still renders instead of showing an empty grid.
const rows = computed(() => props.question.tableRows || normalizeTableGridItems(props.question.questionConfig?.rows, 'row'));
const columns = computed(() => props.question.tableColumns || normalizeTableGridItems(props.question.questionConfig?.columns, 'column'));

// Text mode ("table fill blank") needs free-text inputs per cell instead of radios.
const isTextMode = computed(() => normalizeTableGridMode(props.question.questionConfig) === TABLE_GRID_TEXT_MODE);
const isMultiMode = computed(() => normalizeTableGridMode(props.question.questionConfig) === TABLE_GRID_MULTI_MODE);

const answerMap = computed(() => normalizeTableGridAnswerMap(props.question, props.modelValue));
const textCellMap = computed(() => normalizeTableGridTextCellMap(props.question, props.modelValue));
const correctAnswerMap = computed(() => normalizeTableGridAnswerMap(
  props.question,
  props.correctAnswerData || props.question.correctAnswerData || props.question.correctAnswer
));

const correctAnswerSummary = computed(() => {
  const answeredRows = rows.value.filter((row) => normalizeTableGridColumnIds(correctAnswerMap.value[row.id], columns.value).length > 0);
  return answeredRows.map((row) => {
    const columnIds = normalizeTableGridColumnIds(correctAnswerMap.value[row.id], columns.value);
    const labels = columnIds
      .map((columnId) => columns.value.find((item) => item.id === columnId)?.label || columnId)
      .join(', ');
    return `${row.label}: ${labels}`;
  }).join('; ');
});

function textCellKey(rowId, columnId) {
  return `${rowId}.${columnId}`;
}

function textCellValue(rowId, columnId) {
  return textCellMap.value[textCellKey(rowId, columnId)] || '';
}

function selectedColumns(rowId) {
  return normalizeTableGridColumnIds(answerMap.value[rowId], columns.value);
}

function isSelected(rowId, columnId) {
  return selectedColumns(rowId).includes(columnId);
}

function isCorrect(rowId, columnId) {
  return normalizeTableGridColumnIds(correctAnswerMap.value[rowId], columns.value).includes(columnId);
}

function updateAnswer(rowId, columnId, checked = true) {
  if (props.readonly) {
    return;
  }

  const nextColumns = isMultiMode.value
    ? (checked
      ? [...new Set([...selectedColumns(rowId), columnId])]
      : selectedColumns(rowId).filter((selectedColumnId) => selectedColumnId !== columnId))
    : [columnId];
  const nextAnswers = { ...answerMap.value };
  if (nextColumns.length > 0) {
    nextAnswers[rowId] = isMultiMode.value ? nextColumns : nextColumns[0];
  } else {
    delete nextAnswers[rowId];
  }

  const nextAnswer = {
    ...(props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue) ? props.modelValue : {}),
    answers: nextAnswers,
  };

  emit('update:modelValue', nextAnswer);
  emit('change', nextAnswer);
}

function updateTextCell(rowId, columnId, value) {
  if (props.readonly) {
    return;
  }

  const nextCells = { ...textCellMap.value };
  const key = textCellKey(rowId, columnId);
  if (String(value ?? '').trim()) {
    nextCells[key] = value;
  } else {
    delete nextCells[key];
  }

  const nextAnswer = {
    ...(props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue) ? props.modelValue : {}),
    cells: nextCells,
  };

  emit('update:modelValue', nextAnswer);
  emit('change', nextAnswer);
}
</script>

<template>
  <div class="structured-answer table-grid-answer">
    <table>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th v-for="column in columns" :key="column.id" scope="col">
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <th class="table-grid-answer__row-label" scope="row">{{ row.label }}</th>
          <td
            v-for="column in columns"
            :key="column.id"
            class="table-grid-answer__cell"
            :class="{
              selected: !isTextMode && isSelected(row.id, column.id),
              correct: answersVisible && isCorrect(row.id, column.id),
            }"
          >
            <input
              v-if="isTextMode"
              class="form-input table-grid-answer__text-input"
              type="text"
              :value="textCellValue(row.id, column.id)"
              :disabled="readonly"
              :aria-label="`${row.label}: ${column.label}`"
              placeholder="Type here"
              @input="updateTextCell(row.id, column.id, $event.target.value)"
            />
            <label v-else class="table-grid-answer__choice">
              <input
                class="table-grid-answer__input"
                :type="isMultiMode ? 'checkbox' : 'radio'"
                :name="`question-${question.questionNumber}-row-${row.id}`"
                :value="column.id"
                :checked="isSelected(row.id, column.id)"
                :disabled="readonly"
                :aria-label="`${row.label}: ${column.label}`"
                @change="updateAnswer(row.id, column.id, $event.target.checked)"
              />
              <span class="table-grid-answer__control" :class="{ 'table-grid-answer__control--multi': isMultiMode }" aria-hidden="true"></span>
            </label>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!readonly" class="fill-blank-hint">
      {{ isTextMode ? 'Enter the requested value for each cell.' : (isMultiMode ? 'Select all correct options for each row.' : 'Select one option for each row.') }}
    </p>
    <p v-if="answersVisible && correctAnswerSummary" class="table-grid-answer__correct-reference">
      <strong>Correct answer:</strong> {{ correctAnswerSummary }}
    </p>
  </div>
</template>

<style scoped>
.structured-answer.table-grid-answer {
  overflow-x: auto;
  padding: 10px;
  border-radius: 14px;
}

.table-grid-answer table {
  width: 100%;
  border-collapse: collapse;
  min-width: 440px;
  background: #ffffff;
}

.table-grid-answer th,
.table-grid-answer td {
  border: 1px solid var(--color-border);
  padding: 8px 10px;
}

.table-grid-answer thead th {
  color: #24314a;
  background: var(--color-surface-soft);
  font-size: calc(13px * var(--exam-font-scale));
  font-weight: 700;
  text-align: center;
}

.table-grid-answer thead th:first-child,
.table-grid-answer__row-label {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 140px;
  text-align: left;
}

.table-grid-answer__row-label {
  color: #24314a;
  background: #ffffff;
  font-size: calc(14px * var(--exam-font-scale));
  font-weight: 700;
  line-height: 1.4;
}

.table-grid-answer__cell {
  min-width: 92px;
  background: #ffffff;
  text-align: center;
  transition: background-color 160ms ease, box-shadow 160ms ease;
}

.table-grid-answer__cell.selected {
  background: var(--color-primary-soft);
  box-shadow: inset 0 0 0 2px var(--color-primary);
}

.table-grid-answer__cell.correct {
  box-shadow: inset 0 0 0 2px var(--color-success);
}

.table-grid-answer__choice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 30px;
  cursor: pointer;
}

.table-grid-answer__text-input {
  width: 100%;
  min-width: 80px;
  text-align: center;
}

.table-grid-answer__input {
  width: 0;
  height: 0;
  margin: 0;
  opacity: 0;
}

.table-grid-answer__control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border-strong);
  border-radius: 999px;
  background: #ffffff;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.table-grid-answer__control--multi {
  border-radius: 4px;
}

.table-grid-answer__input:checked + .table-grid-answer__control {
  border-color: var(--color-primary);
  box-shadow: inset 0 0 0 4px #ffffff;
  background: var(--color-primary);
}

.table-grid-answer__input:focus-visible + .table-grid-answer__control {
  outline: 3px solid rgba(47, 111, 237, 0.2);
  outline-offset: 3px;
}

.table-grid-answer__input:disabled + .table-grid-answer__control,
.table-grid-answer__input:disabled ~ .table-grid-answer__control {
  cursor: not-allowed;
  opacity: 0.7;
}

.table-grid-answer__correct-reference {
  margin: 0;
  border: 1px solid rgba(20, 135, 101, 0.24);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  color: var(--color-success);
  font-size: calc(13px * var(--exam-font-scale));
}
</style>
