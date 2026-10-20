function toQuestionNumber(question) {
  return Number(question?.questionNumber || question?.displayOrder || 0);
}

function normalizeMaterialId(question) {
  const value = question?.materialId ?? question?.material_id;
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function toRangeLabel(questionNumbers) {
  if (questionNumbers.length === 1) {
    return `Question ${questionNumbers[0]}`;
  }

  return `Questions ${questionNumbers[0]}-${questionNumbers[questionNumbers.length - 1]}`;
}

function normalizeSectionCode(section) {
  const value = String(section || '').trim().toUpperCase();
  if (value.includes('MATH')) {
    return 'MATH';
  }
  if (value.includes('ELA') || value.includes('ENGLISH') || value.includes('READ')) {
    return 'ELA';
  }
  return value;
}

function buildGroup({ questions, startIndex, endIndex, materialId, segmentIndex = 0, section = '' }) {
  const groupQuestions = questions.slice(startIndex, endIndex + 1);
  const questionNumbers = groupQuestions.map(toQuestionNumber);
  const firstQuestionNumber = questionNumbers[0] ?? 0;
  const lastQuestionNumber = questionNumbers[questionNumbers.length - 1] ?? firstQuestionNumber;
  const isReadingGroup = Boolean(materialId);
  const normalizedSection = normalizeSectionCode(section);

  return {
    id: isReadingGroup
      ? `MATERIAL:${materialId}`
      : `QUESTION:${firstQuestionNumber}`,
    type: isReadingGroup ? 'reading' : 'single',
    section: normalizedSection,
    materialId,
    segmentIndex,
    startIndex,
    endIndex,
    startQuestionNumber: firstQuestionNumber,
    endQuestionNumber: lastQuestionNumber,
    questionNumbers,
    questions: groupQuestions,
    label: toRangeLabel(questionNumbers),
  };
}

export function buildExamQuestionGroups(questions = [], options = {}) {
  const resolveSection = typeof options.resolveSection === 'function'
    ? options.resolveSection
    : (question) => question?.sectionCode || question?.section || question?.partName || '';
  const orderedQuestions = [...questions];
  const groups = [];
  const materialSegments = new Map();

  let startIndex = 0;
  while (startIndex < orderedQuestions.length) {
    const materialId = normalizeMaterialId(orderedQuestions[startIndex]);
    const section = normalizeSectionCode(resolveSection(orderedQuestions[startIndex]));
    let endIndex = startIndex;

    // Only adjacent questions with the same non-empty materialId share reading-group freedom.
    while (
      endIndex + 1 < orderedQuestions.length
      && materialId
      && normalizeMaterialId(orderedQuestions[endIndex + 1]) === materialId
      && normalizeSectionCode(resolveSection(orderedQuestions[endIndex + 1])) === section
    ) {
      endIndex += 1;
    }

    const existingSegments = materialId ? materialSegments.get(materialId) || [] : [];
    const group = buildGroup({
      questions: orderedQuestions,
      startIndex,
      endIndex,
      materialId,
      segmentIndex: existingSegments.length,
      section,
    });
    groups.push(group);

    if (materialId) {
      materialSegments.set(materialId, [...existingSegments, group]);
    }

    startIndex = endIndex + 1;
  }

  const warnings = [];
  materialSegments.forEach((segments, materialId) => {
    if (segments.length <= 1) {
      return;
    }

    segments.forEach((segment) => {
      segment.isDiscontinuousMaterial = true;
      segment.materialSegmentCount = segments.length;
    });

    warnings.push({
      code: 'DISCONTINUOUS_MATERIAL_GROUP',
      materialId,
      message: `Material ${materialId} appears in non-contiguous question ranges: ${segments.map((segment) => segment.label).join(', ')}. Cross-range reading navigation is kept disabled for this material.`,
      ranges: segments.map((segment) => ({
        startQuestionNumber: segment.startQuestionNumber,
        endQuestionNumber: segment.endQuestionNumber,
      })),
    });
  });

  return {
    groups,
    warnings,
    groupByQuestionNumber: buildGroupByQuestionNumber(groups),
  };
}

export function buildGroupByQuestionNumber(groups = []) {
  return groups.reduce((map, group) => {
    group.questionNumbers.forEach((questionNumber) => {
      map.set(questionNumber, group);
    });
    return map;
  }, new Map());
}

export function buildQuestionAccessState(questions = [], options = {}) {
  const { groups, warnings, groupByQuestionNumber } = buildExamQuestionGroups(questions, options);
  const boundary = options.accessBoundary || null;
  const currentOpenNumbers = new Set(boundary?.currentOpenGroup?.questionNumbers || []);
  const lockedQuestions = new Set(boundary?.lockedQuestions || []);
  const lockedGroups = new Set(boundary?.lockedGroups || []);
  const completedSections = new Set((boundary?.completedSections || []).map(normalizeSectionCode));
  const freeNavigation = boundary?.freeNavigation !== false;

  const questionAccessByNumber = new Map();
  questions.forEach((question) => {
    const questionNumber = toQuestionNumber(question);
    const group = groupByQuestionNumber.get(questionNumber) || null;
    const section = normalizeSectionCode(group?.section || options.resolveSection?.(question));
    const sectionLocked = section && completedSections.has(section);
    const groupLocked = group && lockedGroups.has(group.id);
    const locked = lockedQuestions.has(questionNumber) || groupLocked || sectionLocked;
    const accessible = freeNavigation || currentOpenNumbers.has(questionNumber);

    questionAccessByNumber.set(questionNumber, {
      accessible,
      locked,
      group,
      reason: locked ? 'Locked' : (accessible ? '' : 'Not open'),
    });
  });

  return {
    groups,
    warnings,
    questionAccessByNumber,
  };
}
