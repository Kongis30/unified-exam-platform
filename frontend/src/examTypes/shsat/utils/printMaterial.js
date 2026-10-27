// 仅在打印显示层按明确的列分隔重建表格，不改材料原文。
export function formatMaterialBodyForPrint(items = []) {
  const result = [];
  let paragraphLines = [];
  let index = 0;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    result.push({
      type: 'text',
      key: `print-paragraph-${index++}`,
      text: paragraphLines.join(' '),
      isEmpty: false,
    });
    paragraphLines = [];
  };

  for (let cursor = 0; cursor < items.length;) {
    const item = items[cursor];
    if (item.type === 'image') {
      flushParagraph();
      result.push(item);
      cursor += 1;
      continue;
    }

    if (!item.text.trim()) {
      flushParagraph();
      cursor += 1;
      continue;
    }

    if (/\$\$/.test(item.text)) {
      flushParagraph();
      result.push(item);
      cursor += 1;
      continue;
    }

    const table = readAlignedTable(items, cursor);
    if (table) {
      flushParagraph();
      result.push({
        type: 'table',
        key: `print-table-${index++}`,
        rows: table.rows,
        hasHeader: hasTableHeader(table.rows, table.delimiter),
      });
      cursor = table.end;
      continue;
    }

    paragraphLines.push(item.text.trim());
    cursor += 1;
  }

  flushParagraph();
  return result;
}

// 从当前位置读取连续且列数一致的对齐文本行，并返回表格结束位置。
function readAlignedTable(items, start) {
  const rows = [];
  let delimiter = '';
  let end = start;

  for (; end < items.length; end += 1) {
    const item = items[end];
    if (item.type !== 'text' || !item.text.trim() || /\$\$/.test(item.text)) break;

    const parsed = parseTableRow(item.text);
    if (!parsed || (delimiter && parsed.delimiter !== delimiter)) break;
    if (rows.length && parsed.cells.length !== rows[0].length) break;

    delimiter ||= parsed.delimiter;
    if (!parsed.isDivider) rows.push(parsed.cells);
  }

  return rows.length >= 2 ? { rows, delimiter, end } : null;
}

// 识别 Markdown、制表符或连续空格分隔的表格行。
function parseTableRow(value) {
  const line = String(value || '').trim();
  if (line.startsWith('|') && line.endsWith('|')) {
    const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
    if (cells.length < 2) return null;
    return { cells, delimiter: 'pipe', isDivider: cells.every(isMarkdownDivider) };
  }

  if (line.includes('\t')) {
    const cells = line.split(/\t+/).map((cell) => cell.trim());
    if (cells.length < 2) return null;
    return { cells, delimiter: 'tab', isDivider: false };
  }

  const cells = line.split(/ {2,}/).map((cell) => cell.trim()).filter(Boolean);
  if (cells.length < 2) return null;
  return { cells, delimiter: 'spaces', isDivider: false };
}

function isMarkdownDivider(value) {
  return /^:?-{3,}:?$/.test(value);
}

// Markdown 表格固定首行为表头；普通对齐文本仅在内容特征明显时推断表头。
function hasTableHeader(rows, delimiter) {
  if (delimiter === 'pipe') return true;
  return rows[0].every((cell) => !/\d/.test(cell))
    && rows.slice(1).some((row) => row.some((cell) => /\d/.test(cell)));
}
