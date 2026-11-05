export const TEXT_MATERIAL_FORMAT_MARKER = '[[TEXT_MATERIAL_FORMAT:2]]';
export const MATERIAL_IMAGE_MARKER_PATTERN = /\[\[MATERIAL_IMAGE:([^\]\r\n]+)\]\]/g;

export const TEXT_MATERIAL_MARKDOWN_STYLES = Object.freeze({
  BOLD: 'bold',
  ITALIC: 'italic',
  UNDERLINE: 'underline',
});

export const TEXT_MATERIAL_HEADER_ROLES = Object.freeze({
  TITLE: 'title',
  AUTHOR: 'author',
});

export function parseStructuredMaterialContent(materialContent) {
  const source = normalizeTextMaterialNewlines(materialContent);
  const versionedFields = parseVersionedMaterialContent(source);

  if (versionedFields) {
    return versionedFields;
  }

  const lines = source.split('\n');

  if (lines.length === 1 && lines[0] === '') {
    return createTextMaterialFields();
  }
  if (isLegacyMaterialImageBody(source)) {
    return createTextMaterialFields({
      body: source,
    });
  }

  return createTextMaterialFields({
    passageTitle: lines[0] ?? '',
    author: lines[1] ?? '',
    body: lines.slice(2).join('\n'),
  });
}

export function composeStructuredMaterialContent(fields = {}) {
  const introduction = normalizeTextMaterialNewlines(fields.introduction);
  const passageTitle = normalizeHeaderLine(fields.passageTitle);
  const author = normalizeHeaderLine(fields.author);
  const body = normalizeTextMaterialNewlines(fields.body);

  if (!introduction.trim() && !passageTitle && !author && !body) {
    return '';
  }
  if (introduction.trim() || hasMaterialImageMarker(body)) {
    return composeVersionedMaterialContent({
      introduction,
      passageTitle,
      author,
      body,
    });
  }
  if (!body) {
    return author ? `${passageTitle}\n${author}` : passageTitle;
  }

  // Empty header placeholders keep body-only passages from being parsed as title lines.
  return `${passageTitle}\n${author}\n${body}`;
}

export function buildMaterialDisplayLines(materialContentOrFields, { category = '', title = '' } = {}) {
  const fields = isStructuredMaterialFields(materialContentOrFields)
    ? createTextMaterialFields(materialContentOrFields)
    : parseStructuredMaterialContent(materialContentOrFields);
  const reflow = /^reading passage$/i.test(String(category).trim())
    && !/\b(poem|poetry|verse|song)\b/i.test(`${title} ${fields.passageTitle}`);
  const introductionItems = splitBodyRowsWithOffsetsPreservingBlockMath(fields.introduction)
    .map((row, index) => createBodyTextDisplayItem(row.text, index));
  const introduction = reflow
    ? reflowProseItems(introductionItems).map((item) => item.text).join('\n')
    : normalizeTextMaterialNewlines(fields.introduction);
  const headerLines = [
    createHeaderLine(TEXT_MATERIAL_HEADER_ROLES.TITLE, fields.passageTitle),
    createHeaderLine(TEXT_MATERIAL_HEADER_ROLES.AUTHOR, fields.author),
  ].filter((line) => line.text.trim());
  const rawBodyItems = buildBodyDisplayItems(fields.body);
  const bodyItems = reflow ? reflowProseItems(rawBodyItems) : rawBodyItems;
  const bodyLines = bodyItems.filter((item) => item.type === 'text');

  return {
    ...fields,
    introduction,
    headerLines,
    bodyItems,
    bodyLines,
    hasIntroduction: introduction.trim().length > 0,
    hasHeader: headerLines.length > 0,
    hasBody: bodyItems.some((item) => item.type === 'image' || !item.isEmpty),
  };
}

// 仅合并疑似固定行宽的文章续行；保留段落、列表、公式和图片的位置。
function reflowProseItems(items) {
  const result = [];
  let previousLine = '';
  for (const item of items) {
    const text = item.type === 'text' ? item.text : '';
    const structural = item.type !== 'text' || item.isEmpty
      || /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\d+\s|\[\[|\$\$|\\\[|>)/.test(text)
      || /\$\$|\\\[|\\\]/.test(text);
    const previous = result[result.length - 1];
    if (!structural && previous?.type === 'text' && previousLine.trim().length >= 60
        && !/\s{2}$/.test(previousLine)) {
      previous.text = `${previous.text.trimEnd()} ${text.trimStart()}`;
    } else {
      result.push({ ...item });
    }
    previousLine = structural && !/^\s*\d+\s/.test(text) ? '' : text;
  }
  return result;
}

export function buildBodyDisplayLines(body) {
  return buildBodyDisplayItems(body).filter((item) => item.type === 'text');
}

export function buildBodyDisplayItems(body) {
  let itemIndex = 0;

  return splitBodyRowsWithOffsetsPreservingBlockMath(body).flatMap((row) => {
    if (row.isBlockMath) {
      return [createBodyTextDisplayItem(row.text, itemIndex++)];
    }

    const rowItems = [];
    const markerPattern = createMaterialImageMarkerPattern();
    let cursor = 0;
    let match = markerPattern.exec(row.text);

    while (match) {
      if (match.index > cursor) {
        const text = row.text.slice(cursor, match.index);
        rowItems.push(createBodyTextDisplayItem(text, itemIndex++));
      }

      const marker = match[0];
      rowItems.push(createBodyImageDisplayItem({
        keyIndex: itemIndex++,
        marker,
        src: match[1].trim(),
        sourceStart: row.start + match.index,
        sourceEnd: row.start + match.index + marker.length,
      }));
      cursor = match.index + marker.length;
      match = markerPattern.exec(row.text);
    }

    if (cursor < row.text.length) {
      const text = row.text.slice(cursor);
      rowItems.push(createBodyTextDisplayItem(text, itemIndex++));
    }

    if (rowItems.length === 0) {
      rowItems.push(createBodyTextDisplayItem(row.text, itemIndex++));
    }

    return rowItems;
  });
}

export function createMaterialImageMarker(src) {
  const normalizedSrc = String(src ?? '').trim();
  return normalizedSrc ? `[[MATERIAL_IMAGE:${normalizedSrc}]]` : '';
}

export function normalizeTextMaterialNewlines(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

export function parseSafeTextMaterialMarkdown(value) {
  const source = String(value ?? '');
  const segments = parseSafeMarkdownRange(source, 0, source.length, createMarkdownStyleState());

  return mergeAdjacentMarkdownSegments(segments);
}

function parseVersionedMaterialContent(source) {
  const markerLineEnd = source.indexOf('\n');
  const firstLine = markerLineEnd === -1 ? source : source.slice(0, markerLineEnd);

  if (firstLine !== TEXT_MATERIAL_FORMAT_MARKER) {
    return null;
  }

  try {
    const payload = markerLineEnd === -1 ? '' : source.slice(markerLineEnd + 1);
    const parsed = JSON.parse(payload || '{}');

    if (!parsed || parsed.version !== 2 || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return recoverHeaderOnlyImageMarkers(createTextMaterialFields({
      introduction: normalizeTextMaterialNewlines(parsed.introduction),
      passageTitle: normalizeHeaderLine(parsed.passageTitle),
      author: normalizeHeaderLine(parsed.author),
      body: normalizeTextMaterialNewlines(parsed.body),
    }));
  } catch {
    return null;
  }
}

function recoverHeaderOnlyImageMarkers(fields) {
  if (String(fields.body || '').trim()) {
    return fields;
  }

  const headerLines = [fields.passageTitle, fields.author]
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  if (headerLines.length === 0 || !headerLines.every(isMaterialImageMarkerLine)) {
    return fields;
  }

  return createTextMaterialFields({
    ...fields,
    passageTitle: '',
    author: '',
    body: headerLines.join('\n'),
  });
}

function isLegacyMaterialImageBody(source) {
  const lines = normalizeTextMaterialNewlines(source).split('\n');
  const contentLines = lines.map((line) => line.trim()).filter(Boolean);

  return contentLines.length > 0 && contentLines.every(isMaterialImageMarkerLine);
}

function isMaterialImageMarkerLine(line) {
  const markerPattern = createMaterialImageMarkerPattern();
  let cursor = 0;
  let match = markerPattern.exec(line);

  while (match) {
    if (line.slice(cursor, match.index).trim()) {
      return false;
    }
    cursor = match.index + match[0].length;
    match = markerPattern.exec(line);
  }

  return cursor > 0 && !line.slice(cursor).trim();
}

function hasMaterialImageMarker(value) {
  return createMaterialImageMarkerPattern().test(String(value ?? ''));
}

function composeVersionedMaterialContent(fields) {
  return `${TEXT_MATERIAL_FORMAT_MARKER}\n${JSON.stringify({
    version: 2,
    introduction: fields.introduction,
    passageTitle: fields.passageTitle,
    author: fields.author,
    body: fields.body,
  })}`;
}

function createBodyTextDisplayItem(text, index) {
  const isEmpty = text.trim().length === 0;

  return {
    type: 'text',
    key: `body-text-${index}`,
    text,
    isEmpty,
  };
}

function createBodyImageDisplayItem({ keyIndex, marker, src, sourceStart, sourceEnd }) {
  return {
    type: 'image',
    key: `body-image-${keyIndex}-${sourceStart}`,
    marker,
    src,
    alt: 'Material image',
    sourceStart,
    sourceEnd,
  };
}

function createTextMaterialFields(fields = {}) {
  return {
    introduction: fields.introduction ?? '',
    passageTitle: fields.passageTitle ?? '',
    author: fields.author ?? '',
    body: fields.body ?? '',
  };
}

export const parseTextMaterialContent = parseStructuredMaterialContent;
export const buildTextMaterialContent = composeStructuredMaterialContent;
export const buildTextMaterialDisplayModel = buildMaterialDisplayLines;
export const createBodyDisplayLines = buildBodyDisplayLines;
export const createBodyDisplayItems = buildBodyDisplayItems;

function createHeaderLine(role, text) {
  return {
    key: `header-${role}`,
    role,
    text,
  };
}

function normalizeHeaderLine(value) {
  return normalizeTextMaterialNewlines(value).replace(/\n+/g, ' ').trim();
}

function isStructuredMaterialFields(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
      Object.prototype.hasOwnProperty.call(value, 'introduction')
      || Object.prototype.hasOwnProperty.call(value, 'passageTitle')
      || Object.prototype.hasOwnProperty.call(value, 'author')
      || Object.prototype.hasOwnProperty.call(value, 'body')
    )
  );
}

function splitBodyRowsPreservingBlockMath(body) {
  return splitBodyRowsWithOffsetsPreservingBlockMath(body).map((row) => row.text);
}

function splitBodyRowsWithOffsetsPreservingBlockMath(body) {
  const source = normalizeTextMaterialNewlines(body);
  const lines = source.split('\n');

  if (lines.length === 1 && lines[0] === '') {
    return [];
  }

  const rows = [];
  let blockBuffer = [];
  let blockStart = 0;
  let cursor = 0;
  let insideBlockMath = false;

  lines.forEach((line) => {
    const lineStart = cursor;
    const lineEnd = lineStart + line.length;
    const togglesBlockMath = hasOddBlockMathDelimiterCount(line);

    if (insideBlockMath) {
      blockBuffer.push(line);
      if (togglesBlockMath) {
        rows.push({
          text: blockBuffer.join('\n'),
          start: blockStart,
          end: lineEnd,
          isBlockMath: true,
        });
        blockBuffer = [];
        insideBlockMath = false;
      }
      cursor = lineEnd + 1;
      return;
    }

    if (togglesBlockMath) {
      blockBuffer = [line];
      blockStart = lineStart;
      insideBlockMath = true;
      cursor = lineEnd + 1;
      return;
    }

    rows.push({
      text: line,
      start: lineStart,
      end: lineEnd,
      isBlockMath: false,
    });
    cursor = lineEnd + 1;
  });

  if (blockBuffer.length > 0) {
    rows.push({
      text: blockBuffer.join('\n'),
      start: blockStart,
      end: source.length,
      isBlockMath: true,
    });
  }

  return rows;
}

function createMaterialImageMarkerPattern() {
  return new RegExp(MATERIAL_IMAGE_MARKER_PATTERN.source, 'g');
}

function parseSafeMarkdownRange(source, start, end, activeStyles) {
  const segments = [];
  let cursor = start;

  while (cursor < end) {
    const marker = findNextMarkdownMarker(source, cursor, end);

    if (!marker) {
      pushMarkdownTextSegment(segments, source.slice(cursor, end), activeStyles);
      break;
    }

    pushMarkdownTextSegment(segments, source.slice(cursor, marker.index), activeStyles);

    const contentStart = marker.index + marker.token.length;
    const contentEnd = findClosingMarkdownMarker(source, contentStart, end, marker.token);

    if (contentEnd === -1) {
      pushMarkdownTextSegment(segments, marker.token, activeStyles);
      cursor = contentStart;
      continue;
    }

    segments.push(...parseSafeMarkdownRange(source, contentStart, contentEnd, {
      ...activeStyles,
      [marker.style]: true,
    }));
    cursor = contentEnd + marker.token.length;
  }

  return segments;
}

function findNextMarkdownMarker(source, start, end) {
  let cursor = start;

  while (cursor < end) {
    const mathEnd = findFormulaEndCursor(source, cursor, end);

    if (mathEnd !== -1) {
      cursor = mathEnd;
      continue;
    }

    const marker = readMarkdownMarkerAt(source, cursor, end);

    if (marker) {
      return {
        ...marker,
        index: cursor,
      };
    }

    cursor += 1;
  }

  return null;
}

function findClosingMarkdownMarker(source, start, end, token) {
  let cursor = start;

  while (cursor < end) {
    const mathEnd = findFormulaEndCursor(source, cursor, end);

    if (mathEnd !== -1) {
      cursor = mathEnd;
      continue;
    }

    if (isMarkdownTokenAt(source, cursor, end, token)) {
      return cursor;
    }

    cursor += 1;
  }

  return -1;
}

function readMarkdownMarkerAt(source, cursor, end) {
  if (isMarkdownTokenAt(source, cursor, end, '**')) {
    return {
      token: '**',
      style: TEXT_MATERIAL_MARKDOWN_STYLES.BOLD,
    };
  }

  if (isMarkdownTokenAt(source, cursor, end, '++')) {
    return {
      token: '++',
      style: TEXT_MATERIAL_MARKDOWN_STYLES.UNDERLINE,
    };
  }

  if (isMarkdownTokenAt(source, cursor, end, '*')) {
    return {
      token: '*',
      style: TEXT_MATERIAL_MARKDOWN_STYLES.ITALIC,
    };
  }

  return null;
}

function isMarkdownTokenAt(source, cursor, end, token) {
  if (cursor + token.length > end || !source.startsWith(token, cursor)) {
    return false;
  }

  return token !== '*' || source[cursor + 1] !== '*';
}

function findFormulaEndCursor(source, cursor, end) {
  // An escaped dollar sign (\$) is a literal "$", never a formula delimiter.
  if (isEscapedDollar(source, cursor)) {
    return -1;
  }

  if (source.startsWith('$$', cursor)) {
    const closingCursor = findBlockMathDelimiter(source, cursor + 2, end);

    return closingCursor === -1 || closingCursor + 2 > end ? -1 : closingCursor + 2;
  }

  if (source[cursor] !== '$') {
    return -1;
  }

  for (let index = cursor + 1; index < end; index += 1) {
    if (isEscapedDollar(source, index)) {
      continue;
    }

    if (source[index] !== '$') {
      continue;
    }

    if (source[index + 1] === '$') {
      index += 1;
      continue;
    }

    return index + 1;
  }

  return -1;
}

function findBlockMathDelimiter(source, start, end) {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (isEscapedDollar(source, cursor)) {
      continue;
    }

    if (source.startsWith('$$', cursor)) {
      return cursor;
    }
  }

  return -1;
}

// A "$" preceded by an odd number of backslashes is an escaped literal dollar sign.
function isEscapedDollar(source, cursor) {
  if (source[cursor] !== '$') {
    return false;
  }

  let slashCount = 0;
  for (let index = cursor - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function pushMarkdownTextSegment(segments, text, styles) {
  if (!text) {
    return;
  }

  segments.push({
    text,
    bold: styles.bold,
    italic: styles.italic,
    underline: styles.underline,
  });
}

function mergeAdjacentMarkdownSegments(segments) {
  return segments.reduce((merged, segment) => {
    const previous = merged[merged.length - 1];

    if (
      previous
      && previous.bold === segment.bold
      && previous.italic === segment.italic
      && previous.underline === segment.underline
    ) {
      previous.text += segment.text;
      return merged;
    }

    merged.push({ ...segment });
    return merged;
  }, []);
}

function createMarkdownStyleState() {
  return {
    bold: false,
    italic: false,
    underline: false,
  };
}

function hasOddBlockMathDelimiterCount(line) {
  return countOccurrences(line, '$$') % 2 === 1;
}

function countOccurrences(value, token) {
  let count = 0;
  let cursor = 0;

  while (cursor < value.length) {
    const nextCursor = value.indexOf(token, cursor);
    if (nextCursor === -1) {
      break;
    }

    count += 1;
    cursor = nextCursor + token.length;
  }

  return count;
}
