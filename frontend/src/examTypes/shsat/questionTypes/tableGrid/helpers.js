import { normalizeAnswerToken, parseJson } from '../utils';

export const TABLE_GRID_SINGLE_MODE = 'single';
export const TABLE_GRID_MULTI_MODE = 'multi';
export const TABLE_GRID_TEXT_MODE = 'text';

export function normalizeTableGridItems(list, prefix) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list.map((item, index) => {
    if (typeof item === 'string') {
      const id = `${prefix}${index + 1}`;
      return { id, key: id, text: item, label: item };
    }

    const id = String(item?.id || item?.key || item?.value || `${prefix}${index + 1}`);
    return {
      ...item,
      id,
      key: String(item?.key || id),
      text: String(item?.text || item?.label || item?.title || item?.value || id),
      label: String(item?.label || item?.text || item?.title || item?.value || id),
    };
  });
}

function validIdSet(items) {
  return new Set(items.map((item) => String(item.id || '').trim()).filter(Boolean));
}

export function normalizeTableGridColumnIds(value, columns = []) {
  const validColumns = validIdSet(columns);
  const rawValues = Array.isArray(value) ? value : String(value ?? '').split(/[;,|]/);

  return rawValues
    .map(normalizeAnswerToken)
    .filter((columnId) => columnId && (!validColumns.size || validColumns.has(columnId)));
}

export function normalizeTableGridMode(config = {}) {
  const mode = String(config.selectionMode || config.mode || '').trim().toLowerCase();
  if (mode === TABLE_GRID_MULTI_MODE || mode === 'multiple') {
    return TABLE_GRID_MULTI_MODE;
  }
  if (mode === TABLE_GRID_TEXT_MODE || mode === 'input') {
    return TABLE_GRID_TEXT_MODE;
  }

  return TABLE_GRID_SINGLE_MODE;
}

function itemLabelById(items, id) {
  const item = items.find((candidate) => candidate.id === id);
  return item?.label || item?.text || id;
}

function normalizeDirectAnswerMap(rawMap, rows, columns) {
  if (!rawMap || Array.isArray(rawMap) || typeof rawMap !== 'object') {
    return {};
  }

  const validRows = validIdSet(rows);
  return Object.entries(rawMap).reduce((result, [rowId, columnId]) => {
    const normalizedRowId = normalizeAnswerToken(rowId);
    const normalizedColumnIds = normalizeTableGridColumnIds(columnId, columns);
    if (normalizedRowId && normalizedColumnIds.length > 0 && (!validRows.size || validRows.has(normalizedRowId))) {
      result[normalizedRowId] = Array.isArray(columnId) || normalizedColumnIds.length > 1
        ? normalizedColumnIds
        : normalizedColumnIds[0];
    }
    return result;
  }, {});
}

function selectedCellValues(value) {
  return ['true', '1', 'yes', 'y', 'on', 'selected', 'checked'].includes(String(value).toLowerCase());
}

function parseTextCellKey(cellId, rows, columns) {
  const key = String(cellId || '');
  const separators = ['.', '_', '-'];
  for (const row of [...rows].sort((left, right) => right.id.length - left.id.length)) {
    for (const separator of separators) {
      const prefix = `${row.id}${separator}`;
      if (!key.startsWith(prefix)) continue;
      const columnId = key.slice(prefix.length);
      if (columns.some((column) => column.id === columnId)) {
        return { rowId: row.id, columnId };
      }
    }
  }
  return null;
}

function normalizeLegacyCells(rawCells, rows, columns) {
  if (!rawCells || Array.isArray(rawCells) || typeof rawCells !== 'object') {
    return {};
  }

  const normalizedCells = normalizeDirectAnswerMap(rawCells, rows, columns);
  if (Object.keys(normalizedCells).length > 0) {
    return normalizedCells;
  }

  return rows.reduce((result, row) => {
    const selectedColumns = columns.filter((column) => {
      const legacyKeys = [
        `${row.id}.${column.id}`,
        `${row.id}-${column.id}`,
        `${row.id}_${column.id}`,
      ];
      return legacyKeys.some((key) => {
        const value = normalizeAnswerToken(rawCells[key]);
        return value && (selectedCellValues(value) || value === column.id);
      });
    });

    if (selectedColumns.length > 0) {
      result[row.id] = selectedColumns.length === 1
        ? selectedColumns[0].id
        : selectedColumns.map((column) => column.id);
    }
    return result;
  }, {});
}

export function normalizeTableGridAnswerMap(question = {}, rawData) {
  const data = parseJson(rawData, rawData);
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    return {};
  }

  const rows = question.tableRows || normalizeTableGridItems(question.questionConfig?.rows, 'row');
  const columns = question.tableColumns || normalizeTableGridItems(question.questionConfig?.columns, 'column');
  const fieldNames = ['answers', 'selections', 'rowSelections', 'selectedColumns', 'matches'];

  for (const fieldName of fieldNames) {
    const normalized = normalizeDirectAnswerMap(data[fieldName], rows, columns);
    if (Object.keys(normalized).length > 0) {
      return normalized;
    }
  }

  return normalizeLegacyCells(data.cells, rows, columns);
}

export function normalizeTableGridTextCellMap(question = {}, rawData) {
  const data = parseJson(rawData, rawData);
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    return {};
  }

  const rows = question.tableRows || normalizeTableGridItems(question.questionConfig?.rows, 'row');
  const columns = question.tableColumns || normalizeTableGridItems(question.questionConfig?.columns, 'column');
  const validRows = validIdSet(rows);
  const validColumns = validIdSet(columns);
  const rawCells = data.cells || data.answers || data.values || data.textAnswers;

  if (!rawCells || Array.isArray(rawCells) || typeof rawCells !== 'object') {
    return {};
  }

  return Object.entries(rawCells).reduce((result, [cellId, value]) => {
    const parsedCell = parseTextCellKey(cellId, rows, columns);
    const normalizedValue = normalizeAnswerToken(value);
    if (!parsedCell) return result;
    const { rowId, columnId } = parsedCell;
    if (
      normalizedValue
      && (!validRows.size || validRows.has(rowId))
      && (!validColumns.size || validColumns.has(columnId))
    ) {
      result[`${rowId}.${columnId}`] = normalizedValue;
    }
    return result;
  }, {});
}

export function formatTableGridAnswerMap(answerMap, emptyText, question = {}) {
  const entries = Object.entries(answerMap);
  if (entries.length === 0) {
    return emptyText;
  }

  const rows = question.tableRows || normalizeTableGridItems(question.questionConfig?.rows, 'row');
  const columns = question.tableColumns || normalizeTableGridItems(question.questionConfig?.columns, 'column');

  return entries
    .map(([rowId, columnIds]) => {
      const ids = Array.isArray(columnIds) ? columnIds : [columnIds];
      const labels = ids.map((columnId) => itemLabelById(columns, columnId)).join(', ');
      return `${itemLabelById(rows, rowId)}: ${labels}`;
    })
    .join('; ');
}

export function formatTableGridTextCellMap(cellMap, emptyText, question = {}) {
  const entries = Object.entries(cellMap);
  if (entries.length === 0) {
    return emptyText;
  }

  const rows = question.tableRows || normalizeTableGridItems(question.questionConfig?.rows, 'row');
  const columns = question.tableColumns || normalizeTableGridItems(question.questionConfig?.columns, 'column');

  return entries
    .map(([cellId, value]) => {
      const parsedCell = parseTextCellKey(cellId, rows, columns);
      if (!parsedCell) return null;
      return `${itemLabelById(rows, parsedCell.rowId)} / ${itemLabelById(columns, parsedCell.columnId)}: ${value}`;
    })
    .filter(Boolean)
    .join('; ');
}

export function getTableGridValidationIssues(question = {}) {
  const rows = question.tableRows || normalizeTableGridItems(question.questionConfig?.rows, 'row');
  const columns = question.tableColumns || normalizeTableGridItems(question.questionConfig?.columns, 'column');
  const answerMap = normalizeTableGridAnswerMap(question, question.correctAnswerData);
  const issues = [];

  if (rows.length === 0) {
    issues.push('Add at least one row.');
  }
  if (columns.length === 0) {
    issues.push('Add at least one column.');
  }

  rows.forEach((row, index) => {
    if (!String(row.label || '').trim()) {
      issues.push(`Row ${index + 1} needs display text.`);
    }
  });

  columns.forEach((column, index) => {
    if (!String(column.label || '').trim()) {
      issues.push(`Column ${index + 1} needs display text.`);
    }
  });

  rows.forEach((row) => {
    const selectedColumns = normalizeTableGridColumnIds(answerMap[row.id], columns);
    if (row.id && selectedColumns.length === 0) {
      issues.push(`${row.label || row.id} needs a correct column.`);
    }
  });

  return issues;
}

export function formatTableGridValidationMessage(question = {}) {
  const issues = getTableGridValidationIssues(question);
  if (issues.length === 0) {
    return '';
  }

  const prefix = `Table Grid Q${question.questionNumber || '-'}: `;
  const visibleIssues = issues.slice(0, 4).join(' ');
  return issues.length > 4 ? `${prefix}${visibleIssues} Plus ${issues.length - 4} more.` : `${prefix}${visibleIssues}`;
}
