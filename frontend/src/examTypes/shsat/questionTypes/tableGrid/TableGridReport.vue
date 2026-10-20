<script setup>
import { computed } from 'vue';

import {
  TABLE_GRID_TEXT_MODE,
  normalizeTableGridAnswerMap,
  normalizeTableGridColumnIds,
  normalizeTableGridItems,
  normalizeTableGridMode,
  normalizeTableGridTextCellMap,
} from './helpers';
import { parseJsonObject } from '../utils';

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

const normalizedQuestion = computed(() => {
  const questionConfig = parseJsonObject(props.question.questionConfig, {});

  return {
    ...props.question,
    questionConfig,
    tableRows: normalizeTableGridItems(questionConfig.rows, 'row'),
    tableColumns: normalizeTableGridItems(questionConfig.columns, 'column'),
  };
});

const rows = computed(() => normalizedQuestion.value.tableRows || []);
const columns = computed(() => normalizedQuestion.value.tableColumns || []);

// Text mode ("table fill blank") stores per-cell free text instead of a row->column map.
const isTextMode = computed(() => normalizeTableGridMode(normalizedQuestion.value.questionConfig) === TABLE_GRID_TEXT_MODE);

const answerMap = computed(() => {
  return normalizeTableGridAnswerMap(normalizedQuestion.value, props.answerData ?? props.selectedAnswer);
});

const textCellMap = computed(() => {
  return normalizeTableGridTextCellMap(normalizedQuestion.value, props.answerData ?? props.selectedAnswer);
});

const hasAnswer = computed(() => {
  return isTextMode.value
    ? Object.keys(textCellMap.value).length > 0
    : Object.keys(answerMap.value).length > 0;
});

function textCellValue(rowId, columnId) {
  return textCellMap.value[`${rowId}.${columnId}`] || '';
}

function isSelected(rowId, columnId) {
  return normalizeTableGridColumnIds(answerMap.value[rowId], columns.value).includes(columnId);
}

function isRowAnswered(rowId) {
  if (isTextMode.value) {
    return columns.value.some((column) => textCellValue(rowId, column.id));
  }
  return normalizeTableGridColumnIds(answerMap.value[rowId], columns.value).length > 0;
}
</script>

<template>
  <span v-if="!hasAnswer" class="table-grid-report__empty">{{ emptyText }}</span>
  <table v-else class="table-grid-report">
    <thead>
      <tr>
        <th scope="col">Row</th>
        <th v-for="column in columns" :key="column.id" scope="col">{{ column.label }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.id">
        <th scope="row">{{ row.label }}</th>
        <td v-if="!isRowAnswered(row.id)" class="table-grid-report__unanswered" :colspan="columns.length">
          -
        </td>
        <template v-else-if="isTextMode">
          <td v-for="column in columns" :key="column.id">
            <span class="table-grid-report__text">{{ textCellValue(row.id, column.id) || '-' }}</span>
          </td>
        </template>
        <td v-for="column in columns" v-else :key="column.id">
          <span class="table-grid-report__cell" :class="{ 'is-selected': isSelected(row.id, column.id) }">
            {{ isSelected(row.id, column.id) ? '✓' : '' }}
          </span>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.table-grid-report {
  width: max-content;
  max-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: #ffffff;
  font-size: 12px;
}

.table-grid-report th,
.table-grid-report td {
  border-bottom: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
  padding: 6px 8px;
  text-align: center;
  vertical-align: middle;
}

.table-grid-report tr:last-child th,
.table-grid-report tr:last-child td {
  border-bottom: 0;
}

.table-grid-report th:last-child,
.table-grid-report td:last-child {
  border-right: 0;
}

.table-grid-report thead th {
  color: #53627a;
  background: #f6f8fb;
  font-weight: 700;
}

.table-grid-report tbody th {
  max-width: 220px;
  color: #24314a;
  background: #fbfdff;
  text-align: left;
  line-height: 1.35;
}

.table-grid-report__cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: transparent;
}

.table-grid-report__cell.is-selected {
  border-color: var(--color-primary);
  color: #ffffff;
  background: var(--color-primary);
  font-weight: 800;
}

.table-grid-report__unanswered {
  color: var(--color-muted);
  font-weight: 700;
  letter-spacing: 0.08em;
}

.table-grid-report__empty {
  color: var(--color-muted);
}
</style>
