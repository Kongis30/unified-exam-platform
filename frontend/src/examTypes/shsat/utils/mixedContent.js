import { FORMULA_CONTENT_PART_TYPES, parseFormulaContent } from './formulaContent.js';

export const MIXED_CONTENT_PART_TYPES = Object.freeze({
  TEXT: 'text',
  INLINE_MATH: 'inline-math',
  BLOCK_MATH: 'block-math',
  IMAGE: 'image',
});

export const STEM_IMAGE_MARKER_NAME = 'STEM_IMAGE';
export const MATERIAL_IMAGE_MARKER_NAME = 'MATERIAL_IMAGE';
export const STEM_MIXED_CONTENT_IMAGE_MARKER_NAMES = Object.freeze([
  STEM_IMAGE_MARKER_NAME,
  MATERIAL_IMAGE_MARKER_NAME,
]);
export const STEM_IMAGE_MARKER_PATTERN = /\[\[(STEM_IMAGE|MATERIAL_IMAGE):([^\]\r\n]+)\]\]/g;

export function createStemImageMarker(src) {
  const normalizedSrc = String(src ?? '').trim();

  return normalizedSrc ? `[[${STEM_IMAGE_MARKER_NAME}:${normalizedSrc}]]` : '';
}

export function buildStemMixedContentDisplayModel(content) {
  const items = parseStemMixedContent(content);

  return {
    items,
    hasContent: items.some((item) => item.type === MIXED_CONTENT_PART_TYPES.IMAGE || item.content.trim()),
  };
}

export function parseStemMixedContent(content) {
  return parseMixedContent(content, {
    imageAlt: 'Stem image',
    markerPattern: createStemImageMarkerPattern(),
  });
}

export function parseMixedContent(content, options = {}) {
  const source = normalizeMixedContentNewlines(content);
  const imageAlt = options.imageAlt || 'Content image';
  const markerPattern = options.markerPattern || createStemImageMarkerPattern();
  const parts = [];
  let sourceCursor = 0;
  let itemIndex = 0;

  parseFormulaContent(source).forEach((formulaPart) => {
    const sourceStart = sourceCursor;
    const sourceEnd = sourceStart + formulaPartSourceLength(formulaPart);

    if (formulaPart.type === FORMULA_CONTENT_PART_TYPES.TEXT) {
      splitTextPartByImages({
        parts,
        text: formulaPart.content,
        sourceStart,
        imageAlt,
        markerPattern: cloneGlobalPattern(markerPattern),
        nextIndex: () => itemIndex++,
      });
    } else {
      parts.push(createMathPart({
        formulaPart,
        index: itemIndex++,
        sourceStart,
        sourceEnd,
      }));
    }

    sourceCursor = sourceEnd;
  });

  return mergeAdjacentTextParts(parts);
}

export function normalizeMixedContentNewlines(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

export function isSupportedMixedContentImageSrc(src) {
  const normalizedSrc = String(src ?? '').trim();

  return /^\/uploads\/paper-materials\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(normalizedSrc);
}

function splitTextPartByImages({ parts, text, sourceStart, imageAlt, markerPattern, nextIndex }) {
  let cursor = 0;
  let match = markerPattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      parts.push(createTextPart({
        content: text.slice(cursor, match.index),
        index: nextIndex(),
        sourceStart: sourceStart + cursor,
        sourceEnd: sourceStart + match.index,
      }));
    }

    const marker = match[0];
    const src = match[2].trim();
    if (isSupportedMixedContentImageSrc(src)) {
      parts.push(createImagePart({
        alt: imageAlt,
        index: nextIndex(),
        marker,
        src,
        sourceStart: sourceStart + match.index,
        sourceEnd: sourceStart + match.index + marker.length,
      }));
    } else {
      parts.push(createTextPart({
        content: marker,
        index: nextIndex(),
        sourceStart: sourceStart + match.index,
        sourceEnd: sourceStart + match.index + marker.length,
      }));
    }

    cursor = match.index + marker.length;
    match = markerPattern.exec(text);
  }

  if (cursor < text.length) {
    parts.push(createTextPart({
      content: text.slice(cursor),
      index: nextIndex(),
      sourceStart: sourceStart + cursor,
      sourceEnd: sourceStart + text.length,
    }));
  }
}

function createTextPart({ content, index, sourceStart, sourceEnd }) {
  return {
    type: MIXED_CONTENT_PART_TYPES.TEXT,
    key: `mixed-text-${index}-${sourceStart}`,
    content,
    sourceStart,
    sourceEnd,
  };
}

function createMathPart({ formulaPart, index, sourceStart, sourceEnd }) {
  return {
    type: formulaPart.type,
    key: `mixed-math-${index}-${sourceStart}`,
    content: formulaPart.content,
    sourceStart,
    sourceEnd,
  };
}

function createImagePart({ alt, index, marker, src, sourceStart, sourceEnd }) {
  return {
    type: MIXED_CONTENT_PART_TYPES.IMAGE,
    key: `mixed-image-${index}-${sourceStart}`,
    alt,
    marker,
    src,
    sourceStart,
    sourceEnd,
  };
}

function mergeAdjacentTextParts(parts) {
  const mergedParts = [];

  parts.forEach((part) => {
    const previousPart = mergedParts[mergedParts.length - 1];
    if (
      previousPart?.type === MIXED_CONTENT_PART_TYPES.TEXT
      && part.type === MIXED_CONTENT_PART_TYPES.TEXT
      && previousPart.sourceEnd === part.sourceStart
    ) {
      previousPart.content += part.content;
      previousPart.sourceEnd = part.sourceEnd;
      previousPart.key = `${previousPart.key}-${part.sourceEnd}`;
      return;
    }

    mergedParts.push({ ...part });
  });

  return mergedParts;
}

function formulaPartSourceLength(part) {
  if (part.type === FORMULA_CONTENT_PART_TYPES.INLINE_MATH) {
    return part.content.length + 2;
  }

  if (part.type === FORMULA_CONTENT_PART_TYPES.BLOCK_MATH) {
    return part.content.length + 4;
  }

  return part.content.length;
}

function createStemImageMarkerPattern() {
  return new RegExp(STEM_IMAGE_MARKER_PATTERN.source, 'g');
}

function cloneGlobalPattern(pattern) {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}
