export function normalizeExamSectionCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized.includes('MATH')) {
    return 'MATH';
  }
  if (normalized.includes('ELA') || normalized.includes('ENGLISH') || normalized.includes('READ')) {
    return 'ELA';
  }
  return normalized;
}

export function buildAvailableSectionOrder(questions = [], selectedSectionOrder = [], resolveSection = defaultResolveSection) {
  const presentSections = [];
  questions.forEach((question) => {
    const section = normalizeExamSectionCode(resolveSection(question));
    if (section && !presentSections.includes(section)) {
      presentSections.push(section);
    }
  });

  const selectedSections = selectedSectionOrder
    .map(normalizeExamSectionCode)
    .filter((section, index, source) => section && source.indexOf(section) === index);
  const selectedPresentSections = selectedSections.filter((section) => presentSections.includes(section));
  const unlistedPresentSections = presentSections.filter((section) => !selectedPresentSections.includes(section));

  return [...selectedPresentSections, ...unlistedPresentSections];
}

export function resolveActiveSectionCode({
  boundarySection,
  currentQuestion,
  questions = [],
  selectedSectionOrder = [],
  resolveSection = defaultResolveSection,
} = {}) {
  const availableSections = buildAvailableSectionOrder(questions, selectedSectionOrder, resolveSection);
  const boundaryCode = normalizeExamSectionCode(boundarySection);
  if (boundaryCode && availableSections.includes(boundaryCode)) {
    return boundaryCode;
  }

  const currentQuestionCode = normalizeExamSectionCode(resolveSection(currentQuestion));
  if (currentQuestionCode && availableSections.includes(currentQuestionCode)) {
    return currentQuestionCode;
  }

  return availableSections[0] || boundaryCode || currentQuestionCode || '';
}

export function getNextAvailableSectionCode(currentSectionCode, availableSectionOrder = []) {
  const currentCode = normalizeExamSectionCode(currentSectionCode);
  const normalizedOrder = availableSectionOrder.map(normalizeExamSectionCode).filter(Boolean);
  const currentIndex = normalizedOrder.indexOf(currentCode);

  if (currentIndex < 0) {
    return normalizedOrder[0] || '';
  }

  return currentIndex + 1 < normalizedOrder.length ? normalizedOrder[currentIndex + 1] : '';
}

function defaultResolveSection(question) {
  return question?.sectionCode || question?.section || question?.partName || '';
}
