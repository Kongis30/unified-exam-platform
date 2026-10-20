export const FORMULA_CONTENT_PART_TYPES = Object.freeze({
  TEXT: 'text',
  INLINE_MATH: 'inline-math',
  BLOCK_MATH: 'block-math',
});

export function parseFormulaContent(value) {
  const source = String(value ?? '');
  const parts = [];
  let cursor = 0;
  let textStart = 0;

  function pushText(end) {
    if (end > textStart) {
      // Keep the escape sequence (\$) intact. Unescaping here would leave a bare
      // dollar sign that a downstream parser (FormulaText) re-pairs as math.
      parts.push({
        type: FORMULA_CONTENT_PART_TYPES.TEXT,
        content: source.slice(textStart, end),
      });
    }
  }

  while (cursor < source.length) {
    // An escaped dollar sign (\$) is a literal "$" in the text, never a formula delimiter.
    if (source[cursor] === '\\' && source[cursor + 1] === '$') {
      cursor += 2;
      continue;
    }

    if (source[cursor] !== '$') {
      cursor += 1;
      continue;
    }

    if (source.startsWith('$$', cursor)) {
      const closingCursor = findBlockMathClosingCursor(source, cursor + 2);
      if (closingCursor === -1) {
        break;
      }

      pushText(cursor);
      parts.push({
        type: FORMULA_CONTENT_PART_TYPES.BLOCK_MATH,
        content: source.slice(cursor + 2, closingCursor),
      });
      cursor = closingCursor + 2;
      textStart = cursor;
      continue;
    }

    const closingCursor = findInlineMathClosingCursor(source, cursor + 1);
    if (closingCursor === -1) {
      break;
    }

    pushText(cursor);
    parts.push({
      type: FORMULA_CONTENT_PART_TYPES.INLINE_MATH,
      content: source.slice(cursor + 1, closingCursor),
    });
    cursor = closingCursor + 1;
    textStart = cursor;
  }

  // Any malformed or unclosed delimiter remains plain text.
  pushText(source.length);

  return parts;
}

function findInlineMathClosingCursor(source, startCursor) {
  for (let cursor = startCursor; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\' && source[cursor + 1] === '$') {
      cursor += 1;
      continue;
    }

    if (source[cursor] !== '$') {
      continue;
    }

    if (source[cursor + 1] === '$') {
      cursor += 1;
      continue;
    }

    return cursor;
  }

  return -1;
}

function findBlockMathClosingCursor(source, startCursor) {
  for (let cursor = startCursor; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\' && source[cursor + 1] === '$') {
      cursor += 1;
      continue;
    }

    if (source.startsWith('$$', cursor)) {
      return cursor;
    }
  }

  return -1;
}

// Convert an escaped dollar sign (\$) back into a literal "$" for plain text output.
// Parses keep the escape intact so it survives to the final rendering layer;
// this unescape is applied only where plain text is actually rendered.
export function unescapeDollar(text) {
  return text.replace(/\\\$/g, '$');
}
