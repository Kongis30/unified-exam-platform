<script setup>
import { computed, watch } from 'vue';

import {
  TABLE_GRID_MULTI_MODE,
  TABLE_GRID_SINGLE_MODE,
  TABLE_GRID_TEXT_MODE,
  getTableGridValidationIssues,
  normalizeTableGridAnswerMap,
  normalizeTableGridItems,
  normalizeTableGridMode,
  normalizeTableGridTextCellMap,
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

const rowItems = computed(() => props.question.questionConfig?.rows || [{ id: 'row1', label: 'Row 1' }]);
const columnItems = computed(() => props.question.questionConfig?.columns || [{ id: 'col1', label: 'Column 1' }]);
const selectionMode = computed(() => normalizeTableGridMode(props.question.questionConfig || {}));
const validationIssues = computed(() => getTableGridValidationIssues(props.question));

watch(
  () => props.question,
  () => ensureQuestionShape(),
  { immediate: true }
);

function ensureQuestionShape() {
  // 初始化阶段一次性补齐数据，避免模板渲染期间修改响应式题目对象。
  const questionConfig = props.question.questionConfig && typeof props.question.questionConfig === 'object'
    ? { ...props.question.questionConfig }
    : {};
  const rows = normalizeTableGridItems(questionConfig.rows, 'row');
  const columns = normalizeTableGridItems(questionConfig.columns, 'col');
  const normalizedRows = rows.length > 0
    ? rows
    : [{ id: 'row1', label: 'Row 1' }];
  const normalizedColumns = columns.length > 0
    ? columns
    : [{ id: 'col1', label: 'Column 1' }];

  ensureStableIds(normalizedRows, 'row');
  ensureStableIds(normalizedColumns, 'col');
  props.question.questionConfig = {
    ...questionConfig,
    rows: normalizedRows,
    columns: normalizedColumns,
    selectionMode: normalizeTableGridMode(questionConfig),
  };

  if (!props.question.correctAnswerData || typeof props.question.correctAnswerData !== 'object') {
    props.question.correctAnswerData = {};
  }
  if (!props.question.correctAnswerData.answers || typeof props.question.correctAnswerData.answers !== 'object') {
    props.question.correctAnswerData.answers = normalizeTableGridAnswerMap(props.question, props.question.correctAnswerData);
  }
  if (!props.question.correctAnswerData.cells || typeof props.question.correctAnswerData.cells !== 'object') {
    props.question.correctAnswerData.cells = normalizeTableGridTextCellMap(props.question, props.question.correctAnswerData);
  }
}

function ensureStableIds(items, prefix) {
  const usedIds = new Set();

  items.forEach((item, index) => {
    const currentId = String(item.id || '').trim();
    if (!currentId || usedIds.has(currentId)) {
      item.id = nextItemId(items, prefix, index + 1, usedIds);
    } else {
      item.id = currentId;
    }
    usedIds.add(item.id);
  });
}

function nextItemId(items, prefix, startAt = 1, reservedIds = new Set()) {
  const existingIds = new Set(items.map((item) => String(item.id || '').trim()).filter(Boolean));
  let nextIndex = startAt;

  while (existingIds.has(`${prefix}${nextIndex}`) || reservedIds.has(`${prefix}${nextIndex}`)) {
    nextIndex += 1;
  }

  return `${prefix}${nextIndex}`;
}

function answerCells() {
  if (!props.question.correctAnswerData || typeof props.question.correctAnswerData !== 'object') {
    props.question.correctAnswerData = {};
  }
  if (!props.question.correctAnswerData.answers || typeof props.question.correctAnswerData.answers !== 'object') {
    props.question.correctAnswerData.answers = normalizeTableGridAnswerMap(props.question, props.question.correctAnswerData);
  }

  return props.question.correctAnswerData.answers;
}

function textCells() {
  if (!props.question.correctAnswerData || typeof props.question.correctAnswerData !== 'object') {
    props.question.correctAnswerData = {};
  }
  if (!props.question.correctAnswerData.cells || typeof props.question.correctAnswerData.cells !== 'object') {
    props.question.correctAnswerData.cells = normalizeTableGridTextCellMap(props.question, props.question.correctAnswerData);
  }
  return props.question.correctAnswerData.cells;
}

function cellKey(rowId, columnId) {
  return `${rowId}.${columnId}`;
}

function selectedColumns(rowId) {
  const cells = answerCells();
  const selected = Array.isArray(cells[rowId])
    ? cells[rowId]
    : String(cells[rowId] || '').split(/[;,|]/);

  const normalized = selected.filter((columnId) => columnItems.value.some((column) => column.id === columnId));
  if (normalized.length) {
    return normalized;
  }

  // Support legacy row.column boolean answers.
  const legacyColumn = columnItems.value.find((column) => cells[cellKey(rowId, column.id)]);
  return legacyColumn ? [legacyColumn.id] : [];
}

function isCorrectColumn(rowId, columnId) {
  return selectedColumns(rowId).includes(columnId);
}

function setCorrectColumn(rowId, columnId, checked = true) {
  if (props.readonly) {
    return;
  }

  const cells = { ...answerCells() };
  const current = selectedColumns(rowId);

  Object.keys(cells)
    .filter((key) => key === rowId || key.startsWith(`${rowId}.`))
    .forEach((key) => delete cells[key]);

  if (selectionMode.value === TABLE_GRID_MULTI_MODE) {
    const next = checked
      ? [...current.filter((id) => id !== columnId), columnId]
      : current.filter((id) => id !== columnId);
    if (next.length) {
      cells[rowId] = next;
    }
  } else if (columnId) {
    cells[rowId] = [columnId];
  }

  props.question.correctAnswerData.answers = cells;
  emitChange();
}

function updateSelectionMode(mode) {
  if (props.readonly) {
    return;
  }

  const nextMode = [TABLE_GRID_MULTI_MODE, TABLE_GRID_TEXT_MODE].includes(mode) ? mode : TABLE_GRID_SINGLE_MODE;
  props.question.questionConfig = {
    ...(props.question.questionConfig || {}),
    selectionMode: nextMode,
  };

  if (nextMode === TABLE_GRID_SINGLE_MODE) {
    const cells = { ...answerCells() };
    Object.entries(cells).forEach(([rowId, columnIds]) => {
      const firstColumn = Array.isArray(columnIds) ? columnIds[0] : columnIds;
      if (firstColumn) {
        cells[rowId] = [firstColumn];
      }
    });
    props.question.correctAnswerData.answers = cells;
  }
  emitChange();
}

function textCellKey(rowId, columnId) {
  return `${rowId}.${columnId}`;
}

function textCellValue(rowId, columnId) {
  return textCells()[textCellKey(rowId, columnId)] || '';
}

function setCorrectTextCell(rowId, columnId, value) {
  if (props.readonly) {
    return;
  }
  const cells = { ...textCells() };
  const key = textCellKey(rowId, columnId);
  if (String(value || '').trim()) {
    cells[key] = value;
  } else {
    delete cells[key];
  }
  props.question.correctAnswerData.cells = cells;
  emitChange();
}

function addRow() {
  if (props.readonly) {
    return;
  }

  const rows = props.question.questionConfig.rows;
  rows.push({ id: nextItemId(rows, 'row', rows.length + 1), label: `Row ${rows.length + 1}` });
  emitChange();
}

function removeRow(index) {
  if (props.readonly) {
    return;
  }

  const [removed] = props.question.questionConfig.rows.splice(index, 1);
  removeRowAnswers(removed?.id);
  emitChange();
}

function addColumn() {
  if (props.readonly) {
    return;
  }

  const columns = props.question.questionConfig.columns;
  columns.push({ id: nextItemId(columns, 'col', columns.length + 1), label: `Column ${columns.length + 1}` });
  emitChange();
}

function removeColumn(index) {
  if (props.readonly) {
    return;
  }

  const [removed] = props.question.questionConfig.columns.splice(index, 1);
  removeColumnAnswers(removed?.id);
  emitChange();
}

function removeRowAnswers(rowId) {
  if (!rowId) {
    return;
  }

  const cells = answerCells();
  Object.keys(cells).forEach((key) => {
    if (key === rowId || key.startsWith(`${rowId}.`)) {
      delete cells[key];
    }
  });
}

function removeColumnAnswers(columnId) {
  if (!columnId) {
    return;
  }

  const cells = answerCells();
  Object.keys(cells).forEach((key) => {
    const value = cells[key];
    const columnIds = Array.isArray(value) ? value : [value];
    if (key.endsWith(`.${columnId}`) || columnIds.includes(columnId)) {
      delete cells[key];
    }
  });
}

function emitChange() {
  emit('patch', {
    questionConfig: props.question.questionConfig,
    correctAnswerData: props.question.correctAnswerData,
  });
  emit('dirty');
}
</script>

<template>
  <div class="type-editor-panel table-grid-editor">
    <div class="table-grid-intro">
      <strong>Build a table grid question</strong>
      <p>Define row prompts, column choices, then mark the correct answer cells.</p>
    </div>
    <ol class="table-grid-steps" aria-label="Table grid setup steps">
      <li>
        <span>1</span>
        <strong>Choose mode</strong>
      </li>
      <li>
        <span>2</span>
        <strong>Add columns</strong>
      </li>
      <li>
        <span>3</span>
        <strong>Add rows</strong>
      </li>
      <li>
        <span>4</span>
        <strong>Mark correct cells</strong>
      </li>
    </ol>
    <ul v-if="validationIssues.length" class="table-grid-warning-list">
      <li v-for="issue in validationIssues" :key="issue">{{ issue }}</li>
    </ul>

    <section class="table-grid-section">
      <div class="subsection-title">
        <div>
          <strong>Interaction Mode</strong>
          <p class="section-note">Choose how students answer each row.</p>
        </div>
      </div>
      <div class="table-grid-mode-row">
        <label class="table-grid-mode-card" :class="{ 'is-active': selectionMode === 'single' }">
          <input type="radio" value="single" :checked="selectionMode === 'single'" :disabled="readonly" @change="updateSelectionMode('single')" />
          <span>
            <strong>One choice per row</strong>
            <small>Example: each number is either Even or Odd.</small>
          </span>
        </label>
        <label class="table-grid-mode-card" :class="{ 'is-active': selectionMode === 'multi' }">
          <input type="radio" value="multi" :checked="selectionMode === 'multi'" :disabled="readonly" @change="updateSelectionMode('multi')" />
          <span>
            <strong>Multiple choices per row</strong>
            <small>Example: a statement may match several properties.</small>
          </span>
        </label>
        <label class="table-grid-mode-card" :class="{ 'is-active': selectionMode === 'text' }">
          <input type="radio" value="text" :checked="selectionMode === 'text'" :disabled="readonly" @change="updateSelectionMode('text')" />
          <span>
            <strong>Table fill blank</strong>
            <small>Example: students type values into table cells.</small>
          </span>
        </label>
      </div>
    </section>

    <div class="table-grid-setup-grid">
      <section class="table-grid-section">
        <div class="subsection-title">
          <div>
            <strong>Answer Columns</strong>
            <p class="section-note">Choices shown across the top of the table.</p>
          </div>
        </div>
        <div class="table-grid-item-list">
          <div v-for="(column, index) in columnItems" :key="`${column.id}-${index}`" class="table-grid-item-row">
            <span class="table-grid-item-index">{{ index + 1 }}</span>
            <input v-model="column.label" class="form-input" placeholder="Column text shown to students" :disabled="readonly" @input="emitChange" />
            <button class="table-grid-remove-button" type="button" :disabled="readonly" aria-label="Remove column" @click="removeColumn(index)">&times;</button>
          </div>
        </div>
        <button class="table-grid-add-row-button" type="button" :disabled="readonly" @click="addColumn">
          <span aria-hidden="true">+</span>
          Add another column
        </button>
      </section>

      <section class="table-grid-section">
        <div class="subsection-title">
          <div>
            <strong>Question Rows</strong>
            <p class="section-note">Prompts students answer by choosing a column.</p>
          </div>
        </div>
        <div class="table-grid-item-list">
          <div v-for="(row, index) in rowItems" :key="`${row.id}-${index}`" class="table-grid-item-row">
            <span class="table-grid-item-index">{{ index + 1 }}</span>
            <input v-model="row.label" class="form-input" placeholder="Row text shown to students" :disabled="readonly" @input="emitChange" />
            <button class="table-grid-remove-button" type="button" :disabled="readonly" aria-label="Remove row" @click="removeRow(index)">&times;</button>
          </div>
        </div>
        <button class="table-grid-add-row-button" type="button" :disabled="readonly" @click="addRow">
          <span aria-hidden="true">+</span>
          Add another row
        </button>
      </section>
    </div>

    <section class="table-grid-section">
      <div class="subsection-title">
        <div>
          <strong>Correct Answers</strong>
          <p class="section-note">
            {{ selectionMode === 'text' ? 'Enter the exact correct value for each cell.' : (selectionMode === 'multi' ? 'Select every correct cell.' : 'Select one correct column for each row.') }}
          </p>
        </div>
      </div>
      <div class="table-grid-guidance">
        <strong>How to use this section</strong>
        <p>
          {{ selectionMode === 'text' ? 'Type the expected answer into each correct cell. Empty cells are ignored.' : 'Click a cell to mark it as correct. In one-choice mode, each row can only have one correct column.' }}
        </p>
      </div>
      <p v-if="columnItems.length > 2" class="table-grid-scroll-hint">On narrow screens, scroll the table horizontally to see every column.</p>
      <div class="answer-table table-grid-matrix" :class="{ 'has-many-columns': columnItems.length > 2 }">
        <table>
          <thead>
            <tr>
              <th>Row Item</th>
              <th v-for="column in columnItems" :key="column.id">{{ column.label || 'Untitled column' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in rowItems" :key="`${row.id}-${rowIndex}`">
              <th>{{ row.label || 'Untitled row' }}</th>
              <td v-for="column in columnItems" :key="column.id">
                <input
                  v-if="selectionMode === 'text'"
                  class="form-input table-grid-cell-input"
                  :value="textCellValue(row.id, column.id)"
                  :disabled="readonly"
                  :aria-label="`Correct answer for ${row.label || 'row'}: ${column.label || 'column'}`"
                  placeholder="Answer"
                  @input="setCorrectTextCell(row.id, column.id, $event.target.value)"
                />
                <label v-else class="table-grid-radio table-grid-radio--icon-only" :class="{ 'table-grid-radio--selected': isCorrectColumn(row.id, column.id) }">
                  <input
                    :type="selectionMode === 'multi' ? 'checkbox' : 'radio'"
                    :aria-label="`Correct answer for ${row.label || 'row'}: ${column.label || 'column'}`"
                    :name="`table-grid-${question.localId || question.questionId || question.questionNumber}-${row.id}`"
                    :value="column.id"
                    :checked="isCorrectColumn(row.id, column.id)"
                    :disabled="readonly"
                    @change="setCorrectColumn(row.id, column.id, $event.target.checked)"
                  />
                  <span aria-hidden="true"></span>
                  <em v-if="isCorrectColumn(row.id, column.id)">Correct</em>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="table-grid-section table-grid-section--preview">
      <div class="subsection-title">
        <div>
          <strong>Student Preview</strong>
          <p class="section-note">Read-only preview of the answer area students will see in the exam.</p>
        </div>
        <span class="table-grid-preview-badge">Read-only</span>
      </div>
      <p v-if="columnItems.length > 2" class="table-grid-scroll-hint">On narrow screens, scroll the table horizontally to see every column.</p>
      <div class="answer-table table-grid-preview" :class="{ 'has-many-columns': columnItems.length > 2 }">
        <table>
          <thead>
            <tr>
              <th>Row Item</th>
              <th v-for="column in columnItems" :key="column.id">{{ column.label || 'Untitled column' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in rowItems" :key="`${row.id}-${rowIndex}`">
              <th>{{ row.label || 'Untitled row' }}</th>
              <td v-for="column in columnItems" :key="column.id">
                <input v-if="selectionMode === 'text'" class="form-input table-grid-cell-input" placeholder="Student types here" disabled />
                <label v-else class="table-grid-radio table-grid-radio--preview">
                  <input
                    :type="selectionMode === 'multi' ? 'checkbox' : 'radio'"
                    :aria-label="`Preview choice for ${row.label || 'row'}: ${column.label || 'column'}`"
                    :name="`table-grid-preview-${question.localId || question.questionId || question.questionNumber}-${row.id}`"
                    :value="column.id"
                    disabled
                  />
                  <span aria-hidden="true"></span>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.type-editor-panel,
.table-grid-section {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.table-grid-editor {
  gap: 12px;
}

.table-grid-intro {
  padding: 12px 14px;
  border: 1px solid rgba(47, 111, 237, 0.16);
  border-radius: 12px;
  background: rgba(47, 111, 237, 0.06);
}

.table-grid-intro strong {
  display: block;
  color: #24314a;
  font-size: 14px;
}

.table-grid-intro p {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 13px;
}

.table-grid-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.table-grid-steps li {
  display: flex;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(47, 111, 237, 0.14);
  border-radius: 12px;
  padding: 9px 10px;
  color: #31415f;
  background: #ffffff;
  font-size: 12px;
}

.table-grid-steps span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--color-primary);
  background: rgba(47, 111, 237, 0.1);
  font-weight: 800;
}

.table-grid-section {
  border: 1px solid rgba(31, 75, 135, 0.12);
  border-radius: 12px;
  padding: 12px;
  background: #ffffff;
}

.table-grid-section--preview {
  background: #fbfcfe;
}

.subsection-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.subsection-title > div {
  display: grid;
  gap: 3px;
}

.subsection-title p {
  margin: 0;
}

.table-grid-mode-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.table-grid-mode-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 12px;
  background: #ffffff;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}

.table-grid-mode-card.is-active {
  border-color: rgba(47, 111, 237, 0.45);
  background: rgba(47, 111, 237, 0.06);
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.08);
}

.table-grid-mode-card span {
  display: grid;
  gap: 3px;
}

.table-grid-mode-card small {
  color: var(--color-muted);
}

.table-grid-setup-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.table-grid-item-list {
  display: grid;
  gap: 8px;
}

.table-grid-item-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 28px;
  gap: 8px;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 11px;
  padding: 8px;
  background: #fbfdff;
}

.table-grid-item-index {
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

.table-grid-action-button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  border: 1px solid rgba(47, 111, 237, 0.32);
  border-radius: 999px;
  padding: 0 12px;
  color: #ffffff;
  background: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.table-grid-add-row-button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  border: 1px dashed rgba(47, 111, 237, 0.32);
  border-radius: 12px;
  padding: 0 12px;
  color: var(--color-primary);
  background: #f7faff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.table-grid-add-row-button span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 999px;
  color: #ffffff;
  background: var(--color-primary);
  line-height: 1;
}

.table-grid-add-row-button:hover:not(:disabled) {
  border-style: solid;
  background: rgba(47, 111, 237, 0.08);
}

.table-grid-action-button span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 999px;
  color: var(--color-primary);
  background: #ffffff;
  line-height: 1;
}

.table-grid-action-button:hover:not(:disabled) {
  background: var(--color-primary-strong);
}

.table-grid-remove-button {
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

.table-grid-remove-button:hover:not(:disabled) {
  background: #fff4f5;
}

.table-grid-action-button:disabled,
.table-grid-add-row-button:disabled,
.table-grid-remove-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.table-grid-guidance {
  display: grid;
  gap: 3px;
  border: 1px solid rgba(47, 111, 237, 0.14);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(47, 111, 237, 0.05);
}

.table-grid-guidance strong {
  color: #24314a;
  font-size: 13px;
}

.table-grid-guidance p {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}

.table-grid-scroll-hint {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
}

.answer-table {
  max-width: 100%;
  min-width: 0;
  overflow-x: auto;
}

.answer-table table {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
  background: #ffffff;
}

.answer-table th,
.answer-table td {
  border: 1px solid rgba(148, 163, 184, 0.25);
  padding: 9px;
  text-align: center;
}

.answer-table thead th { text-align: center; }
.answer-table tbody th:first-child { text-align: left; }

.table-grid-warning-list {
  display: grid;
  gap: 4px;
  margin: 0;
  border: 1px solid rgba(199, 55, 71, 0.22);
  border-radius: var(--paper-radius-sm);
  padding: 8px 10px 8px 24px;
  color: var(--color-danger);
  background: #fff6f7;
  font-size: 12px;
}

.table-grid-matrix th {
  background: #f8fafc;
}

.table-grid-matrix thead th,
.table-grid-preview thead th {
  color: #51607a;
  font-size: 12px;
  font-weight: 800;
}

.table-grid-matrix tbody th,
.table-grid-preview tbody th {
  min-width: 160px;
  color: var(--color-text);
  font-weight: 800;
  text-align: left;
}

.table-grid-radio {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-sm);
  color: var(--color-muted);
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.table-grid-radio input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.table-grid-radio span {
  flex: 0 0 auto;
  display: inline-flex;
  width: 14px;
  height: 14px;
  border: 1px solid rgba(148, 163, 184, 0.46);
  border-radius: 999px;
  background: #ffffff;
}

.table-grid-radio em {
  color: var(--color-primary);
  font-size: 11px;
  font-style: normal;
}

.table-grid-radio--icon-only,
.table-grid-radio--preview {
  min-height: 30px;
}

.table-grid-radio--preview {
  cursor: default;
  background: #f8fafc;
}

.table-grid-preview-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 999px;
  padding: 0 10px;
  color: var(--color-muted);
  background: #ffffff;
  font-size: 12px;
  font-weight: 800;
}

.table-grid-radio--selected {
  border-color: rgba(47, 111, 237, 0.45);
  color: var(--color-primary);
  background: rgba(47, 111, 237, 0.08);
}

.table-grid-radio--selected span {
  border-color: var(--color-primary);
  background: radial-gradient(circle, var(--color-primary) 0 42%, #ffffff 46%);
}

.table-grid-cell-input {
  min-width: 110px;
  text-align: center;
}

@media (max-width: 760px) {
  .table-grid-mode-row,
  .table-grid-setup-grid,
  .table-grid-steps {
    grid-template-columns: 1fr;
  }

  .table-grid-matrix table,
  .table-grid-preview table {
    min-width: 100%;
    table-layout: fixed;
  }

  .table-grid-matrix.has-many-columns table,
  .table-grid-preview.has-many-columns table {
    min-width: 330px;
    table-layout: auto;
  }

  .table-grid-matrix tbody th,
  .table-grid-preview tbody th {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .table-grid-radio em {
    display: none;
  }

  .table-grid-cell-input {
    min-width: 0;
    width: 100%;
  }
}
</style>
