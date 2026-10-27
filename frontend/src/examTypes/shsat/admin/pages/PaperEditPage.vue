<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import { readEditorSelection, writeEditorSelection } from '@/utils/editorSelectionStorage';
import MixedContent from '@shsat/components/MixedContent.vue';
import MonitorQuestionDetail from '@shsat/components/MonitorQuestionDetail.vue';
import SafeMarkdownText from '@shsat/components/SafeMarkdownText.vue';
import { getQuestionTypeDefinition } from '@shsat/questionTypes';
import {
  getQuestionTypeLabel,
  isMultiSelectType,
  normalizeAnswerList,
  normalizeQuestionType,
} from '@shsat/questionTypes/utils';
import { adminApi } from '@shsat/admin/services/adminApi';
import { buildStemMixedContentDisplayModel, createStemImageMarker, MIXED_CONTENT_PART_TYPES } from '@shsat/utils/mixedContent';
import {
  applyShsatSkillTagToConfig,
  extractShsatSkillTag,
  normalizeShsatSkillTag,
  normalizeTypeCode,
  shsatSkillTagByCode,
  shsatSkillTagLabel,
  shsatTagDomainByCode,
  shsatTagSubjectByCode,
  shsatTagSubjectOptions,
} from '@shsat/utils/shsatSkillTags';
import {
  buildMaterialDisplayLines,
  composeStructuredMaterialContent,
  createMaterialImageMarker,
  parseStructuredMaterialContent,
} from '@shsat/utils/textMaterial';

const route = useRoute();
const router = useRouter();

const paperId = computed(() => route.params.paperId);
const loadedPaperId = ref(null);

const paper = ref(null);
const scoringProfileCode = ref('SHSAT_2026_100');
const scoringRuleOptions = [
  { value: 'SHSAT_2026_100', label: '2026 SHSAT · 100 Questions' },
  { value: 'SHSAT_LEGACY_114', label: '2025 SHSAT · 114 Questions' },
];
const questions = ref([]);
const parts = ref([]);
const subTypes = ref([]);
const officialShsatTypes = ref([]);
const materials = ref([]);
const selectedQuestionId = ref(null);
const recentlyImportedQuestionIds = ref(new Set());
const questionListElement = ref(null);
const loading = ref(false);
const saving = ref(false);
const showPartsModal = ref(false);
const showTypesModal = ref(false);
const showLeaveConfirmModal = ref(false);
const showImportQuestionsModal = ref(false);
const loadingImportExams = ref(false);
const loadingImportAnalytics = ref(false);
const loadingImportDetail = ref(false);
const importingQuestions = ref(false);
const importExams = ref([]);
const importPaperNames = ref({});
const importExamId = ref('');
const importAnalytics = ref([]);
const importAnalyticsFilter = ref('all');
const importQuestionTypeFilter = ref('all');
const collapsedImportGroupCodes = ref(new Set());
const selectedImportQuestionNumbers = ref([]);
const previewImportQuestionNumber = ref(null);
const previewImportQuestion = ref(null);
const importQuestionsError = ref('');
const questionPendingDeletion = ref(null);
const deletingQuestion = ref(false);
const errorMessage = ref('');
const noticeMessage = ref('');
const noticeType = ref('success');
const uploadingImageQuestionId = ref(null);
const modifiedQuestionIds = ref(new Set());
const modifiedStructureKeys = ref(new Set());
const textMaterialPreviewOpen = ref(true);
const officialStructureKeys = ref({
  partIds: new Set(),
  subTypeIds: new Set(),
});
const questionOrderDirty = ref(false);
const draggedQuestionId = ref(null);
const dragOverQuestionId = ref(null);
const dragOverPosition = ref('after');
const materialContentTextarea = ref(null);
const materialBodyImageInput = ref(null);
const materialScreenshotPasteZone = ref(null);
const stemTextarea = ref(null);
const skillTagMenuRoot = ref(null);
const uploadingMaterialBodyImage = ref(false);
const uploadingStemImage = ref(false);
const pendingMaterialBodyImageInsertion = ref(null);
const pendingStemImageInsertion = ref(null);
const showMaterialScreenshotPasteModal = ref(false);
const screenshotInsertTarget = ref('material');
const materialScreenshotPasteMessage = ref('');
const materialScreenshotPasteMessageType = ref('info');
const editorImagePreview = ref({
  open: false,
  src: '',
  title: '',
  zoom: 1,
  originX: 50,
  originY: 50,
  panX: 0,
  panY: 0,
});
const skillTagMenuOpen = ref(false);
const skillTagMenuDraft = reactive({
  subjectCode: '',
  domainCode: '',
});
const EDITOR_IMAGE_PREVIEW_MAX_ZOOM = 4;
const EDITOR_IMAGE_PREVIEW_ZOOM_STEP = 1.6;
let editorImagePreviewPanState = null;
let noticeTimer = null;

const QUESTION_TYPES = [
  'MULTIPLE_CHOICE',
  'MULTI_SELECT',
  'MULTI_SELECT_FIXED',
  'FILL_IN_BLANK',
  'INLINE_CHOICE',
  'DRAG_AND_DROP',
  'HOT_TEXT',
  'HOT_SPOT',
  'TABLE_GRID',
  'GRAPH_QUESTION',
  'EQUATION_EDITOR',
  'SOLUTION_SET',
].map((value) => ({ value, label: getQuestionTypeLabel(value) }));

const CUSTOM_LABEL_VALUE = 'custom';
const OFFICIAL_VALUE_PREFIX = 'official:';
const EXISTING_PART_PREFIX = 'part:';
const EXISTING_SUB_TYPE_PREFIX = 'subType:';
const PASSAGE_SET_REORDER_MESSAGE = 'Keep passage sets together.';
const SECTION_REORDER_MESSAGE = 'Move questions within the same section.';
const SUBJECT_PART_CODES = ['ELA', 'MATH'];
const DEFAULT_SUB_TYPE_BY_PART = {
  ELA: 'REVISING_EDITING_PART_A',
  MATH: 'MATH_MULTIPLE_CHOICE',
};
const PASSAGE_SET_SUB_TYPE_CODE = 'READING_COMPREHENSION';

const newPart = reactive({
  partCode: '',
  partName: '',
  partIntro: '',
  questionRange: '',
  questionCount: 0,
});

const newSubType = reactive({
  partId: '',
  subTypeCode: '',
  subTypeName: '',
  subTypeIntro: '',
  questionRange: '',
  questionCount: 0,
});

const sortedQuestions = computed(() => {
  return [...questions.value].sort((left, right) => {
    return Number(left.displayOrder || left.questionNumber || 0) - Number(right.displayOrder || right.questionNumber || 0);
  });
});

function importSectionCode(row) {
  const code = String(row.shsatSubjectCode || '').trim().toUpperCase();
  if (code === 'MATH') return 'MATH';
  if (code === 'ELA') return 'ELA';
  return 'OTHER';
}

const sortedImportAnalytics = computed(() => [...importAnalytics.value].sort((left, right) => {
  const sectionOrder = { ELA: 0, MATH: 1, OTHER: 2 };
  const sectionDifference = sectionOrder[importSectionCode(left)] - sectionOrder[importSectionCode(right)];
  if (sectionDifference !== 0) return sectionDifference;
  return Number(left.questionNumber) - Number(right.questionNumber);
}));

const importQuestionTypes = computed(() => [...new Set(importAnalytics.value.map((row) => row.questionType).filter(Boolean))]);

const visibleImportAnalytics = computed(() => sortedImportAnalytics.value.filter((row) => {
  const accuracy = row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy);
  if (importQuestionTypeFilter.value !== 'all' && row.questionType !== importQuestionTypeFilter.value) return false;
  if (importAnalyticsFilter.value === 'no-data') return accuracy === null;
  if (accuracy === null) return importAnalyticsFilter.value === 'all';
  if (importAnalyticsFilter.value === 'low') return accuracy < 50;
  if (importAnalyticsFilter.value === 'medium') return accuracy >= 50 && accuracy < 75;
  if (importAnalyticsFilter.value === 'high') return accuracy >= 75;
  return true;
}));
const visibleImportAnalyticsGroups = computed(() => [
  { code: 'ELA', label: 'ELA' },
  { code: 'MATH', label: 'Math' },
  { code: 'OTHER', label: 'Untagged' },
].map((group) => {
  const questions = visibleImportAnalytics.value.filter((row) => importSectionCode(row) === group.code);
  const entriesByKey = new Map();
  questions.forEach((row) => {
    const materialId = row.materialId === null || row.materialId === undefined ? null : String(row.materialId);
    const key = materialId === null ? `question-${row.questionNumber}` : `material-${materialId}`;
    if (!entriesByKey.has(key)) {
      entriesByKey.set(key, materialId === null
        ? { key, material: false, questions: [row], firstQuestionNumber: Number(row.questionNumber) }
        : {
          key,
          material: true,
          title: String(row.materialTitle || '').trim() || 'Reading material',
          questions: [],
          firstQuestionNumber: Number(row.questionNumber),
        });
    }
    const entry = entriesByKey.get(key);
    if (materialId !== null) {
      entry.questions.push(row);
      entry.firstQuestionNumber = Math.min(entry.firstQuestionNumber, Number(row.questionNumber));
    }
  });
  return {
    ...group,
    questions,
    entries: [...entriesByKey.values()].sort((left, right) => left.firstQuestionNumber - right.firstQuestionNumber),
  };
}).filter((group) => group.questions.length > 0));

const selectedVisibleImportQuestionCount = computed(() => visibleImportAnalytics.value.reduce((count, row) => (
  selectedImportQuestionNumbers.value.includes(Number(row.questionNumber)) ? count + 1 : count
), 0));
const allVisibleImportQuestionsSelected = computed(() => (
  visibleImportAnalytics.value.length > 0
  && selectedVisibleImportQuestionCount.value === visibleImportAnalytics.value.length
));
const selectedImportQuestionCount = computed(() => selectedImportQuestionNumbers.value.length);
const selectedImportExam = computed(() => importExams.value.find((exam) => String(exam.examId) === String(importExamId.value)) || null);

function toggleImportQuestionGroup(groupCode) {
  const nextCollapsedGroups = new Set(collapsedImportGroupCodes.value);
  if (nextCollapsedGroups.has(groupCode)) {
    nextCollapsedGroups.delete(groupCode);
  } else {
    nextCollapsedGroups.add(groupCode);
  }
  collapsedImportGroupCodes.value = nextCollapsedGroups;
}

const questionSidebarGroups = computed(() => {
  const officialGroups = SUBJECT_PART_CODES.map((code) => {
    const officialPart = officialPartByCode(code);
    const existingPart = findPartByCode(code);
    return createQuestionSidebarGroup({
      key: `official-${code}`,
      code,
      name: officialPart?.name || code,
      part: existingPart,
    });
  });
  const officialPartIds = new Set(officialGroups.map((group) => String(group.part?.partId || '')).filter(Boolean));
  const customGroups = parts.value
    .filter((part) => !officialPartIds.has(String(part.partId)) && !SUBJECT_PART_CODES.includes(partCode(part)))
    .sort((left, right) => Number(left.displayOrder || left.partNumber || 0) - Number(right.displayOrder || right.partNumber || 0))
    .map((part) => createQuestionSidebarGroup({
      key: `part-${part.partId}`,
      code: partCode(part),
      name: part.partName || `Part ${part.partNumber || part.partId}`,
      part,
    }));
  const groupedPartIds = new Set([...officialGroups, ...customGroups].map((group) => String(group.part?.partId || '')).filter(Boolean));
  const unassignedQuestions = sortedQuestions.value.filter((question) => {
    return !question.partId || !groupedPartIds.has(String(question.partId));
  });
  const unassignedGroup = unassignedQuestions.length > 0
    ? [createQuestionSidebarGroup({
      key: 'unassigned',
      code: '',
      name: 'Unassigned',
      part: null,
      questions: unassignedQuestions,
    })]
    : [];

  return [...officialGroups, ...customGroups, ...unassignedGroup];
});

const currentQuestion = computed(() => {
  return questions.value.find((question) => question.localId === selectedQuestionId.value) || null;
});

const skillTagMenuDomains = computed(() => {
  return shsatTagSubjectByCode(skillTagMenuDraft.subjectCode)?.domains || [];
});

const skillTagMenuSkills = computed(() => {
  return shsatTagDomainByCode(skillTagMenuDraft.domainCode).domain?.skills || [];
});

const currentShsatSkillTagLabel = computed(() => {
  return shsatSkillTagLabel(currentQuestion.value?.shsatSkillTag, { includeSubject: true });
});

const currentTextMaterialFields = computed(() => {
  if (!currentQuestion.value || currentQuestion.value.materialType !== 'text') {
    return parseStructuredMaterialContent('');
  }

  return parseStructuredMaterialContent(currentQuestion.value.materialContent);
});

const currentTextMaterialPreview = computed(() => {
  return buildMaterialDisplayLines(currentTextMaterialFields.value);
});

const textMaterialPreviewToggleLabel = computed(() => {
  return textMaterialPreviewOpen.value ? 'Collapse Preview' : 'Expand Preview';
});

const currentStemMixedContentPreview = computed(() => {
  return buildStemMixedContentDisplayModel(currentQuestion.value?.stem || '');
});

const currentStemMixedContentBlocks = computed(() => {
  const blocks = [];
  let textItems = [];

  currentStemMixedContentPreview.value.items.forEach((item) => {
    if (item.type === MIXED_CONTENT_PART_TYPES.IMAGE) {
      if (textItems.length > 0) {
        blocks.push(createStemTextPreviewBlock(textItems));
        textItems = [];
      }
      blocks.push({
        key: item.key,
        type: MIXED_CONTENT_PART_TYPES.IMAGE,
        item,
        items: [],
      });
      return;
    }

    textItems.push(item);
  });

  if (textItems.length > 0) {
    blocks.push(createStemTextPreviewBlock(textItems));
  }

  return blocks;
});

const screenshotPasteDescription = computed(() => {
  return screenshotInsertTarget.value === 'stem'
    ? 'Copy a screenshot from your system, then paste it here. The image will be uploaded and inserted at the Stem cursor.'
    : 'Copy a screenshot from your system, then paste it here. The image will be uploaded and inserted at the Body cursor.';
});

const screenshotPasteUploading = computed(() => {
  return screenshotInsertTarget.value === 'stem' ? uploadingStemImage.value : uploadingMaterialBodyImage.value;
});

const currentQuestionIndex = computed(() => {
  if (!currentQuestion.value) {
    return -1;
  }

  return sortedQuestions.value.findIndex((question) => question.localId === currentQuestion.value.localId);
});

const currentQuestionTypeEditor = computed(() => {
  return currentQuestion.value
    ? getQuestionTypeDefinition(currentQuestion.value.questionType).components.editor
    : null;
});

const currentQuestionEditorTitle = computed(() => {
  if (!currentQuestion.value) {
    return '';
  }
  return `Question ${currentQuestion.value.questionNumber || '-'} · ${getQuestionTypeLabel(currentQuestion.value.questionType)}`;
});

const currentQuestionEditorSubtitle = computed(() => {
  if (!currentQuestion.value) {
    return '';
  }
  return [getPartName(currentQuestion.value.partId), getSubTypeName(currentQuestion.value.subTypeId)]
    .filter((value) => value && value !== 'No Type')
    .join(' / ') || 'No Part';
});

const textMaterials = computed(() => {
  return materials.value.filter((material) => getMaterialDraftType(material) === 'text');
});

const imageMaterials = computed(() => {
  return materials.value.filter((material) => getMaterialDraftType(material) === 'image');
});

const hasQuestionOrStructureChanges = computed(() => {
  return questionOrderDirty.value || modifiedQuestionIds.value.size > 0 || modifiedStructureKeys.value.size > 0;
});

const hasChanges = computed(() => {
  return hasQuestionOrStructureChanges.value
    || scoringProfileCode.value !== (paper.value?.scoringProfileCode || 'SHSAT_2026_100');
});

function createStemTextPreviewBlock(items) {
  const firstItem = items[0];
  const lastItem = items[items.length - 1];

  return {
    key: `stem-text-${firstItem?.sourceStart ?? 0}-${lastItem?.sourceEnd ?? 0}`,
    type: MIXED_CONTENT_PART_TYPES.TEXT,
    item: null,
    items,
  };
}

function unwrapResponse(response) {
  if (response?.success === false) {
    throw new Error(response.message || 'Request failed');
  }

  return response?.data ?? response;
}

function normalizeOfficialShsatTemplate(template) {
  return (template?.parts || [])
    .map((part) => ({
      code: normalizeTypeCode(part.code),
      name: String(part.name || '').trim(),
      intro: part.intro || '',
      subTypes: (part.subTypes || [])
        .map((subType) => ({
          code: normalizeTypeCode(subType.code),
          name: String(subType.name || '').trim(),
          intro: subType.intro || '',
        }))
        .filter((subType) => subType.code && subType.name),
    }))
    .filter((part) => part.code && part.name);
}

function sameId(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function officialPrimaryCodeFromText(value) {
  const normalized = normalizeTypeCode(value);
  if (!normalized) {
    return '';
  }
  const officialType = officialShsatTypes.value.find((type) => {
    return type.code === normalized || normalizeTypeCode(type.name) === normalized;
  });
  return officialType?.code || '';
}

function partCode(part) {
  return officialPrimaryCodeFromText(part?.partCode)
    || officialPrimaryCodeFromText(part?.partName)
    || normalizeTypeCode(part?.partCode || part?.partName);
}

function subTypeCode(subType) {
  return normalizeTypeCode(subType?.subTypeCode || subType?.subTypeName);
}

function officialPartByCode(code) {
  const normalizedCode = normalizeTypeCode(code);
  return officialShsatTypes.value.find((type) => type.code === normalizedCode) || null;
}

function officialSubTypeByCode(partCodeValue, subTypeCodeValue) {
  const officialPart = officialPartByCode(partCodeValue);
  const normalizedSubTypeCode = normalizeTypeCode(subTypeCodeValue);
  return officialPart?.subTypes.find((type) => type.code === normalizedSubTypeCode) || null;
}

function officialSubTypesForPartId(partId) {
  const selectedPart = parts.value.find((part) => sameId(part.partId, partId));
  return officialPartByCode(partCode(selectedPart))?.subTypes || [];
}

function structureKey(value) {
  return String(value ?? '');
}

function officialPartForItem(part) {
  return officialPartByCode(partCode(part));
}

function officialSubTypeForItem(subType) {
  const selectedPart = parts.value.find((part) => sameId(part.partId, subType?.partId));
  return officialSubTypeByCode(partCode(selectedPart), subTypeCode(subType));
}

function isOfficialPart(part) {
  return Boolean(
    officialStructureKeys.value.partIds.has(structureKey(part?.partId))
    || officialPartForItem(part)
  );
}

function isOfficialSubType(subType) {
  return Boolean(
    officialStructureKeys.value.subTypeIds.has(structureKey(subType?.subTypeId))
    || officialSubTypeForItem(subType)
  );
}

function officialDeleteBlockMessage(kind) {
  return kind === 'part'
    ? 'Official SHSAT primary types are required and cannot be deleted.'
    : 'Official SHSAT secondary types are required and cannot be deleted.';
}

function captureOfficialStructureKeys() {
  officialStructureKeys.value = {
    partIds: new Set(parts.value.filter(officialPartForItem).map((part) => structureKey(part.partId))),
    subTypeIds: new Set(subTypes.value.filter(officialSubTypeForItem).map((subType) => structureKey(subType.subTypeId))),
  };
}

function officialPartForSubTypeCode(code) {
  const normalizedCode = normalizeTypeCode(code);
  return officialShsatTypes.value.find((type) => {
    return type.subTypes.some((subType) => subType.code === normalizedCode);
  }) || null;
}

function handleShsatTagSubjectChange(question, subjectCode) {
  if (!question) {
    return;
  }
  const subject = shsatTagSubjectByCode(subjectCode);
  question.shsatSkillTag = {
    subjectCode: subject?.code || '',
    domainCode: '',
    skillCode: '',
  };
  markQuestionDirty(question);
}

function handleShsatTagSkillChange(question, skillCode) {
  if (!question) {
    return;
  }
  const { subject, domain, skill } = shsatSkillTagByCode(skillCode);
  question.shsatSkillTag = {
    subjectCode: subject?.code || question.shsatSkillTag?.subjectCode || '',
    domainCode: domain?.code || question.shsatSkillTag?.domainCode || '',
    skillCode: skill?.code || '',
  };
  markQuestionDirty(question);
}

function syncSkillTagMenuDraft(question = currentQuestion.value) {
  const tag = normalizeShsatSkillTag(question?.shsatSkillTag);
  skillTagMenuDraft.subjectCode = tag.subjectCode;
  skillTagMenuDraft.domainCode = tag.domainCode;
}

function openShsatSkillTagMenu(question = currentQuestion.value) {
  if (!question) {
    return;
  }
  syncSkillTagMenuDraft(question);
  skillTagMenuOpen.value = true;
}

function closeShsatSkillTagMenu() {
  skillTagMenuOpen.value = false;
}

function toggleShsatSkillTagMenu(question = currentQuestion.value) {
  if (skillTagMenuOpen.value) {
    closeShsatSkillTagMenu();
    return;
  }
  openShsatSkillTagMenu(question);
}

function previewShsatTagSubject(subject) {
  if (!subject) {
    return;
  }

  if (skillTagMenuDraft.subjectCode !== subject.code) {
    skillTagMenuDraft.subjectCode = subject.code;
    skillTagMenuDraft.domainCode = '';
  }
}

function previewShsatTagDomain(domain) {
  if (!domain) {
    return;
  }
  const { subject } = shsatTagDomainByCode(domain.code);
  skillTagMenuDraft.subjectCode = subject?.code || skillTagMenuDraft.subjectCode;
  skillTagMenuDraft.domainCode = domain.code;
}

function handleShsatTagSkillSelect(question, skillCode) {
  handleShsatTagSkillChange(question, skillCode);
  syncSkillTagMenuDraft(question);
  closeShsatSkillTagMenu();
}

function clearShsatSkillTag(question) {
  handleShsatTagSubjectChange(question, '');
  syncSkillTagMenuDraft(question);
  closeShsatSkillTagMenu();
}

function handleDocumentPointerDown(event) {
  if (!skillTagMenuOpen.value) {
    return;
  }
  if (skillTagMenuRoot.value?.contains(event.target)) {
    return;
  }
  closeShsatSkillTagMenu();
}

function findPartByCode(code) {
  const normalizedCode = normalizeTypeCode(code);
  return parts.value.find((part) => partCode(part) === normalizedCode) || null;
}

function findSubTypeByCode(partId, code) {
  const normalizedCode = normalizeTypeCode(code);
  return subTypes.value.find((subType) => sameId(subType.partId, partId) && subTypeCode(subType) === normalizedCode) || null;
}

function createQuestionSidebarGroup({ key, code, name, part, questions: groupQuestions = null }) {
  const partQuestions = groupQuestions || sortedQuestions.value.filter((question) => sameId(question.partId, part?.partId));
  return {
    key,
    code,
    name,
    part,
    partId: part?.partId || null,
    questions: partQuestions,
    items: createQuestionSidebarItems(code, partQuestions),
  };
}

function createQuestionSidebarItems(code, partQuestions) {
  if (code !== 'ELA') {
    return partQuestions.map((question) => ({
      key: `question-${question.localId}`,
      kind: 'standalone',
      question,
      questions: [question],
    }));
  }

  const items = [];
  let currentPassageSet = null;

  partQuestions.forEach((question, index) => {
    if (!question.materialId) {
      currentPassageSet = null;
      items.push({
        key: `question-${question.localId}`,
        kind: 'standalone',
        question,
        questions: [question],
      });
      return;
    }

    const materialKey = String(question.materialId);
    const previousQuestion = partQuestions[index - 1];
    const continuesPreviousSet = Boolean(
      currentPassageSet
      && previousQuestion
      && sameId(previousQuestion.materialId, question.materialId)
    );

    if (!continuesPreviousSet) {
      currentPassageSet = {
        key: `material-${materialKey}-${question.localId}`,
        kind: 'passageSet',
        materialId: question.materialId,
        material: materials.value.find((material) => sameId(material.materialId, question.materialId)) || null,
        questions: [],
      };
      items.push(currentPassageSet);
    }
    currentPassageSet.questions.push(question);
  });

  return items;
}

function questionRangeLabel(item) {
  const numbers = item.questions
    .map((question) => Number(question.questionNumber))
    .filter((questionNumber) => Number.isFinite(questionNumber) && questionNumber > 0)
    .sort((left, right) => left - right);
  if (numbers.length === 0) {
    return 'No questions';
  }
  if (numbers.length === 1) {
    return `Q${numbers[0]}`;
  }
  return `Q${numbers[0]}-Q${numbers[numbers.length - 1]}`;
}

function passageSetTitle(item) {
  return item.material?.materialTitle || `Passage Set ${questionRangeLabel(item)}`;
}

function preferredSubTypeCodeForScope(partCodeValue, scope = {}) {
  const normalizedPartCode = normalizeTypeCode(partCodeValue);
  const officialSubTypes = officialPartByCode(normalizedPartCode)?.subTypes || [];
  const sourceSubType = subTypes.value.find((subType) => sameId(subType.subTypeId, scope.sourceQuestion?.subTypeId));
  const sourceSubTypeCode = sourceSubType ? subTypeCode(sourceSubType) : '';

  if (scope.materialId && normalizedPartCode === 'ELA' && officialSubTypes.some((subType) => subType.code === PASSAGE_SET_SUB_TYPE_CODE)) {
    return PASSAGE_SET_SUB_TYPE_CODE;
  }
  if (sourceSubTypeCode && officialSubTypes.some((subType) => subType.code === sourceSubTypeCode)) {
    return sourceSubTypeCode;
  }
  if (DEFAULT_SUB_TYPE_BY_PART[normalizedPartCode] && officialSubTypes.some((subType) => subType.code === DEFAULT_SUB_TYPE_BY_PART[normalizedPartCode])) {
    return DEFAULT_SUB_TYPE_BY_PART[normalizedPartCode];
  }

  return officialSubTypes[0]?.code || '';
}

function isSubTypeValidForPart(partId, subTypeId) {
  if (!subTypeId) {
    return true;
  }

  const selectedPart = parts.value.find((part) => sameId(part.partId, partId));
  const selectedSubType = subTypes.value.find((subType) => sameId(subType.subTypeId, subTypeId));
  if (!selectedPart || !selectedSubType || !sameId(selectedSubType.partId, selectedPart.partId)) {
    return false;
  }

  const selectedOfficialPart = officialPartByCode(partCode(selectedPart));
  if (!selectedOfficialPart) {
    return true;
  }

  const selectedSubTypeCode = subTypeCode(selectedSubType);
  const officialOwner = officialPartForSubTypeCode(selectedSubTypeCode);
  return !officialOwner || officialOwner.code === selectedOfficialPart.code;
}

function firstLabelConsistencyIssue() {
  for (const question of sortedQuestions.value) {
    if (!question.subTypeId) {
      continue;
    }

    const questionLabel = `Q${question.questionNumber || '-'}`;
    const selectedPart = parts.value.find((part) => sameId(part.partId, question.partId));
    const selectedSubType = subTypes.value.find((subType) => sameId(subType.subTypeId, question.subTypeId));
    if (!selectedPart) {
      return `${questionLabel} has a secondary type but no valid primary type.`;
    }
    if (!selectedSubType) {
      return `${questionLabel} uses a secondary type that is no longer available.`;
    }
    if (!sameId(selectedSubType.partId, selectedPart.partId)) {
      return `${questionLabel} uses a secondary type that does not belong to the selected primary type.`;
    }

    const officialOwner = officialPartForSubTypeCode(subTypeCode(selectedSubType));
    const selectedOfficialPart = officialPartByCode(partCode(selectedPart));
    if (officialOwner && selectedOfficialPart && officialOwner.code !== selectedOfficialPart.code) {
      return `${questionLabel} uses "${getSubTypeName(question.subTypeId)}" under "${getPartName(question.partId)}", but that official secondary type belongs under "${officialOwner.name}".`;
    }
  }

  return '';
}

function primaryTypeOptions() {
  const officialOptions = officialShsatTypes.value.map((type) => {
    const existing = findPartByCode(type.code);
    return existing
      ? { value: `${EXISTING_PART_PREFIX}${existing.partId}`, label: type.name }
      : { value: `${OFFICIAL_VALUE_PREFIX}${type.code}`, label: type.name };
  });
  const existingOptions = parts.value
    .filter((part) => !officialPartByCode(partCode(part)))
    .map((part) => ({
      value: `${EXISTING_PART_PREFIX}${part.partId}`,
      label: part.partName || `Part ${part.partNumber}`,
    }));
  return [
    ...officialOptions,
    ...existingOptions,
    { value: CUSTOM_LABEL_VALUE, label: 'Create custom label...' },
  ];
}

function secondaryTypeOptions(question) {
  if (!question?.partId) {
    return [{ value: '', label: 'Select primary type first' }];
  }

  const selectedPart = parts.value.find((part) => sameId(part.partId, question.partId));
  const selectedPartCode = partCode(selectedPart);
  const officialDefinitions = officialPartByCode(selectedPartCode)?.subTypes || [];
  const officialOptions = officialDefinitions.map((type) => {
    const existing = findSubTypeByCode(question.partId, type.code);
    return existing
      ? { value: `${EXISTING_SUB_TYPE_PREFIX}${existing.subTypeId}`, label: type.name }
      : { value: `${OFFICIAL_VALUE_PREFIX}${type.code}`, label: type.name };
  });
  const existingOptions = subTypes.value
    .filter((subType) => sameId(subType.partId, question.partId))
    .filter((subType) => !officialDefinitions.some((type) => type.code === subTypeCode(subType)))
    .map((subType) => ({
      value: `${EXISTING_SUB_TYPE_PREFIX}${subType.subTypeId}`,
      label: subType.subTypeName || `Type ${subType.subTypeId}`,
    }));
  return [
    ...officialOptions,
    ...existingOptions,
    { value: CUSTOM_LABEL_VALUE, label: 'Create custom label...' },
  ];
}

function selectedPrimaryTypeValue(question) {
  return question?.partId ? `${EXISTING_PART_PREFIX}${question.partId}` : '';
}

function selectedSecondaryTypeValue(question) {
  return question?.subTypeId ? `${EXISTING_SUB_TYPE_PREFIX}${question.subTypeId}` : '';
}

function getMaterialQuestionNumbers(materialId) {
  if (!materialId) {
    return [];
  }

  return sortedQuestions.value
    .filter((question) => sameId(question.materialId, materialId))
    .map((question) => Number(question.questionNumber))
    .filter((questionNumber) => Number.isFinite(questionNumber) && questionNumber > 0)
    .sort((left, right) => left - right);
}

function formatQuestionNumberList(questionNumbers) {
  return questionNumbers.map((questionNumber) => `Q${questionNumber}`).join(', ');
}

function materialUsageLabel(materialId) {
  const questionNumbers = getMaterialQuestionNumbers(materialId);
  return questionNumbers.length > 0
    ? `Used by ${formatQuestionNumberList(questionNumbers)}`
    : 'Not linked yet';
}

function currentMaterialUsageText(question = currentQuestion.value) {
  if (!question?.materialId) {
    return '';
  }

  const questionNumbers = getMaterialQuestionNumbers(question.materialId);
  if (questionNumbers.length <= 1) {
    return 'This material is currently linked only to this question.';
  }

  return `Shared material: editing it here updates ${formatQuestionNumberList(questionNumbers)}. Keep these questions adjacent to form one reading group.`;
}

function parseOptions(rawOptions) {
  const parsed = parseJson(rawOptions);

  if (Array.isArray(parsed)) {
    return parsed.map((option, index) => normalizeOption(option, index));
  }

  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed).map(([key, value], index) => normalizeOption({ key, value }, index));
  }

  if (typeof rawOptions === 'string' && rawOptions.trim()) {
    return rawOptions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => normalizeOption(line, index));
  }

  return [];
}

function parseJson(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function answerTokens(value, { keepBlank = false } = {}) {
  const addAnswer = (answers, item) => {
    const answer = String(item ?? '').trim();
    if (answer || keepBlank) {
      answers.push(answer);
    }
  };

  if (Array.isArray(value)) {
    return value.reduce((answers, item) => {
      addAnswer(answers, item);
      return answers;
    }, []);
  }

  if (value && typeof value === 'object') {
    if (Array.isArray(value.answers)) {
      return answerTokens(value.answers, { keepBlank });
    }
    if (value.value !== undefined) {
      return answerTokens([value.value], { keepBlank });
    }
    return [];
  }

  if (typeof value === 'string') {
    const parsedValue = parseJson(value);
    if (parsedValue !== null && parsedValue !== value) {
      return answerTokens(parsedValue, { keepBlank });
    }
  }

  return String(value ?? '')
    .split(/[;,|]/)
    .reduce((answers, item) => {
      addAnswer(answers, item);
      return answers;
    }, []);
}

function isFillInBlankType(questionType) {
  return normalizeQuestionType(questionType, '') === 'FILL_IN_BLANK';
}

function fillBlankCorrectAnswerData(rawData, fallbackCorrectAnswer = '', { keepBlank = true } = {}) {
  const parsedData = parseJson(rawData);
  const answers = answerTokens(parsedData, { keepBlank });
  const nonBlankAnswers = answerTokens(parsedData, { keepBlank: false });
  const fallbackAnswers = nonBlankAnswers.length > 0
    ? answers
    : answerTokens(fallbackCorrectAnswer, { keepBlank: false });

  return { answers: fallbackAnswers.length > 0 || !keepBlank ? fallbackAnswers : [''] };
}

function normalizeOption(option, index) {
  const fallbackKey = String.fromCharCode(65 + index);

  if (typeof option === 'string') {
    return { key: fallbackKey, text: option };
  }

  return {
    key: String(option.key || option.label || option.option || fallbackKey),
    text: String(option.text || option.content || option.title || option.value || ''),
  };
}

function getMaterialDraftType(material) {
  const type = String(material?.materialType || material?.type || '').toUpperCase();

  if (type === 'TEXT' || type === 'TEXT_MATERIAL') {
    return 'text';
  }
  if (type === 'IMAGE' || type === 'IMAGE_MATERIAL') {
    return 'image';
  }

  return 'none';
}

function getMaterialContent(material) {
  const type = getMaterialDraftType(material);
  if (type === 'image') {
    return material?.assetUrl || material?.imageUrl || material?.materialContent || material?.content || '';
  }

  return material?.materialContent || material?.assetUrl || material?.imageUrl || material?.content || '';
}

function createMaterialDraft(question) {
  const linkedMaterial = materials.value.find((material) => sameId(material.materialId, question.materialId));
  const explicitType = String(question.materialType || '').toLowerCase();
  const draftType = ['text', 'image', 'none'].includes(explicitType) ? explicitType : getMaterialDraftType(linkedMaterial);
  const draftContent = getMaterialContent(linkedMaterial);

  return {
    materialType: draftType,
    materialTitle: linkedMaterial?.materialTitle || question.materialTitle || '',
    materialCategory: linkedMaterial?.materialCategory || question.materialCategory || 'Reading Passage',
    materialContent: draftType === 'text' ? draftContent || question.materialContent || question.passage || question.passageText || '' : '',
    imageUrl: draftType === 'image' ? draftContent || question.imageUrl || '' : '',
    imageUploadName: '',
    material: linkedMaterial || question.material || null,
  };
}

function normalizeQuestion(question) {
  const questionId = question.questionId || question.id || `number-${question.questionNumber || question.displayOrder || Date.now()}`;
  const materialDraft = createMaterialDraft(question);

  const questionType = normalizeQuestionType(question.questionType || question.type, 'MULTIPLE_CHOICE');
  const definition = getQuestionTypeDefinition(questionType);
  const parsedAnswerData = parseJson(question.correctAnswerData);
  const parsedCorrectAnswerData = parsedAnswerData === null || parsedAnswerData === undefined || parsedAnswerData === ''
    ? legacyCorrectAnswerData(question.correctAnswer, questionType)
    : parsedAnswerData;
  const correctAnswerData = isFillInBlankType(questionType)
    ? fillBlankCorrectAnswerData(parsedCorrectAnswerData, question.correctAnswer, { keepBlank: true })
    : parsedCorrectAnswerData;
  const questionConfig = parseJson(question.questionConfig) || defaultQuestionConfig(questionType);
  const scoringRules = parseJson(question.scoringRules) || {};

  // The legacy editor uses questionText/type/section; the new paper detail uses stem/questionType/partId.
  const normalizedQuestion = {
    ...question,
    localId: String(questionId),
    questionId: question.questionId || question.id || null,
    partId: question.partId || question.section || null,
    subTypeId: question.subTypeId || null,
    materialId: question.materialId || null,
    questionNumber: Number(question.questionNumber || question.displayOrder || 0),
    questionType,
    stem: question.stem || question.questionText || question.question || '',
    options: parseOptions(question.options),
    correctAnswerData,
    questionConfig,
    validationRules: parseJson(question.validationRules) || {},
    scoringRules,
    difficulty: question.difficulty || question.difficultyLevel || '',
    shsatSkillTag: normalizeShsatSkillTag(question.shsatSkillTag || extractShsatSkillTag(questionConfig)),
    ...materialDraft,
  };

  return definition.normalizeQuestion(normalizedQuestion);
}

function legacyCorrectAnswerData(correctAnswer, questionType) {
  const answers = String(correctAnswer || '')
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return isMultiSelectType(questionType) || isFillInBlankType(questionType)
    ? { answers }
    : { answers: answers.slice(0, 1) };
}

function defaultQuestionConfig(questionType) {
  const definition = getQuestionTypeDefinition(questionType);
  if (definition.migrated) {
    return definition.createDefaultConfig({ questionType });
  }

  if (questionType === 'INLINE_CHOICE') {
    return { blanks: [{ id: 'blank1', label: 'Blank 1', options: defaultOptionKeys() }] };
  }
  if (questionType === 'DRAG_AND_DROP') {
    return { items: [{ id: 'item1', text: 'Item 1' }], zones: [{ id: 'zone1', label: 'Zone 1' }] };
  }
  if (questionType === 'HOT_TEXT') {
    return { segments: [{ id: 'seg1', text: 'Selectable text' }] };
  }
  if (questionType === 'HOT_SPOT') {
    return { regions: [{ id: 'region1', label: 'Region 1' }] };
  }
  if (questionType === 'GRAPH_QUESTION') {
    return { graph: { xLabel: 'x', yLabel: 'y' } };
  }
  return {};
}

function defaultCorrectAnswerData(questionType) {
  const definition = getQuestionTypeDefinition(questionType);
  if (definition.migrated) {
    return definition.createDefaultCorrectAnswerData({ questionType });
  }

  if (questionType === 'INLINE_CHOICE') {
    return { answers: { blank1: '' } };
  }
  if (questionType === 'DRAG_AND_DROP') {
    return { matches: { item1: 'zone1' } };
  }
  if (questionType === 'HOT_TEXT') {
    return { selectedIds: [] };
  }
  if (questionType === 'HOT_SPOT') {
    return { regions: [] };
  }
  if (questionType === 'GRAPH_QUESTION') {
    return { points: [{ x: 0, y: 0 }], tolerance: 0 };
  }
  if (questionType === 'EQUATION_EDITOR' || questionType === 'FILL_IN_BLANK') {
    return { answers: [''] };
  }
  return { answers: [] };
}

function defaultOptionKeys() {
  return [
    { key: 'A', text: 'Option A' },
    { key: 'B', text: 'Option B' },
  ];
}

function handleQuestionTypeChange(question = currentQuestion.value) {
  if (!question) {
    return;
  }
  const previousShsatSkillTag = normalizeShsatSkillTag(question.shsatSkillTag);
  question.questionType = normalizeQuestionType(question.questionType, 'MULTIPLE_CHOICE');
  const definition = getQuestionTypeDefinition(question.questionType);
  question.questionConfig = definition.migrated
    ? definition.createDefaultConfig({ question })
    : defaultQuestionConfig(question.questionType);
  question.questionConfig = applyShsatSkillTagToConfig(question.questionConfig, previousShsatSkillTag);
  question.shsatSkillTag = previousShsatSkillTag;
  question.correctAnswerData = definition.migrated
    ? definition.createDefaultCorrectAnswerData({ question, questionType: question.questionType })
    : defaultCorrectAnswerData(question.questionType);
  if (definition.usesGlobalOptions && question.options.length === 0) {
    question.options = defaultOptionKeys();
  } else if (!definition.usesGlobalOptions) {
    question.options = [];
  }
  markQuestionDirty(question);
}

function applyQuestionTypePatch(patch, question = currentQuestion.value) {
  if (!question || !patch || typeof patch !== 'object') {
    return;
  }

  Object.entries(patch).forEach(([key, value]) => {
    question[key] = value;
  });
  markQuestionDirty(question);
}

function isFixedMultiSelect(question) {
  return question?.questionType === 'MULTI_SELECT_FIXED';
}

function isFillInBlankQuestion(question) {
  return isFillInBlankType(question?.questionType);
}

function isDragAndDrop(question) {
  return question?.questionType === 'DRAG_AND_DROP';
}

function isHotText(question) {
  return question?.questionType === 'HOT_TEXT';
}

function isHotSpot(question) {
  return question?.questionType === 'HOT_SPOT';
}

function isGraphQuestion(question) {
  return question?.questionType === 'GRAPH_QUESTION';
}

function isSolutionSetQuestion(question) {
  return question?.questionType === 'SOLUTION_SET';
}

function answerArray(question) {
  if (!question) {
    return [];
  }

  if (isFillInBlankType(question.questionType)) {
    return fillBlankCorrectAnswerData(question.correctAnswerData, '', { keepBlank: true }).answers;
  }

  return Array.isArray(question.correctAnswerData?.answers) ? question.correctAnswerData.answers : [];
}

function ensureAnswerArray(question) {
  if (!question) {
    return [];
  }

  if (isFillInBlankType(question.questionType)) {
    question.correctAnswerData = fillBlankCorrectAnswerData(question.correctAnswerData, '', { keepBlank: true });
    return question.correctAnswerData.answers;
  }

  if (!question.correctAnswerData || typeof question.correctAnswerData !== 'object' || Array.isArray(question.correctAnswerData)) {
    question.correctAnswerData = { answers: [] };
  } else if (!Array.isArray(question.correctAnswerData.answers)) {
    question.correctAnswerData = {
      ...question.correctAnswerData,
      answers: [],
    };
  }

  return question.correctAnswerData.answers;
}

function fillBlankAnswers(question) {
  return isFillInBlankQuestion(question) ? answerArray(question) : [];
}

function acceptedAnswerRows(question) {
  return answerArray(question);
}

function selectionLimit(question) {
  if (isFixedMultiSelect(question)) {
    return answerArray(question).length;
  }

  return Number(question.questionConfig?.selectionLimit || question.scoringRules?.selectionLimit || 0);
}

function setAcceptedAnswer(question, index, value) {
  const answers = ensureAnswerArray(question);
  answers.splice(index, 1, value);
  markQuestionDirty(question);
}

function addAcceptedAnswer(question) {
  ensureAnswerArray(question).push('');
  markQuestionDirty(question);
}

function removeAcceptedAnswer(question, index) {
  const answers = ensureAnswerArray(question);
  answers.splice(index, 1);
  if (isFillInBlankQuestion(question) && answers.length === 0) {
    answers.push('');
  }
  markQuestionDirty(question);
}

function duplicateFillBlankAnswerSet(question) {
  if (!isFillInBlankQuestion(question)) {
    return new Set();
  }

  const seenAnswers = new Set();
  const duplicateAnswers = new Set();
  fillBlankAnswers(question).forEach((answer) => {
    const normalizedAnswer = String(answer ?? '').trim().toLowerCase();
    if (!normalizedAnswer) {
      return;
    }
    if (seenAnswers.has(normalizedAnswer)) {
      duplicateAnswers.add(normalizedAnswer);
    }
    seenAnswers.add(normalizedAnswer);
  });
  return duplicateAnswers;
}

function isDuplicateFillBlankAnswer(question, answer) {
  const normalizedAnswer = String(answer ?? '').trim().toLowerCase();
  return normalizedAnswer ? duplicateFillBlankAnswerSet(question).has(normalizedAnswer) : false;
}

function configList(question, fieldName, fallbackItem) {
  if (!Array.isArray(question.questionConfig?.[fieldName])) {
    question.questionConfig = {
      ...question.questionConfig,
      [fieldName]: [fallbackItem],
    };
  }

  return question.questionConfig[fieldName];
}

function dragItems(question) {
  return configList(question, 'items', { id: 'item1', text: 'Item 1' });
}

function dropZones(question) {
  return configList(question, 'zones', { id: 'zone1', label: 'Zone 1' });
}

function addDragItem(question) {
  const items = dragItems(question);
  const nextId = `item${items.length + 1}`;
  items.push({ id: nextId, text: `Item ${items.length + 1}` });
  question.correctAnswerData.matches = {
    ...(question.correctAnswerData.matches || {}),
    [nextId]: '',
  };
  markQuestionDirty(question);
}

function removeDragItem(question, index) {
  const [removed] = dragItems(question).splice(index, 1);
  if (removed?.id && question.correctAnswerData.matches) {
    delete question.correctAnswerData.matches[removed.id];
  }
  markQuestionDirty(question);
}

function addDropZone(question) {
  const zones = dropZones(question);
  zones.push({ id: `zone${zones.length + 1}`, label: `Zone ${zones.length + 1}` });
  markQuestionDirty(question);
}

function removeDropZone(question, index) {
  dropZones(question).splice(index, 1);
  markQuestionDirty(question);
}

function setDragMatch(question, itemId, zoneId) {
  question.correctAnswerData.matches = {
    ...(question.correctAnswerData.matches || {}),
    [itemId]: zoneId,
  };
  markQuestionDirty(question);
}

function hotSegments(question) {
  return configList(question, 'segments', { id: 'seg1', text: 'Selectable text' });
}

function addHotSegment(question) {
  const segments = hotSegments(question);
  segments.push({ id: `seg${segments.length + 1}`, text: 'Selectable text' });
  markQuestionDirty(question);
}

function removeHotSegment(question, index) {
  const [removed] = hotSegments(question).splice(index, 1);
  question.correctAnswerData.selectedIds = (question.correctAnswerData.selectedIds || []).filter((id) => id !== removed?.id);
  markQuestionDirty(question);
}

function toggleHotTextAnswer(question, id) {
  const selectedIds = question.correctAnswerData.selectedIds || [];
  question.correctAnswerData.selectedIds = selectedIds.includes(id)
    ? selectedIds.filter((item) => item !== id)
    : [...selectedIds, id];
  markQuestionDirty(question);
}

function hotRegions(question) {
  return configList(question, 'regions', { id: 'region1', label: 'Region 1' });
}

function addHotRegion(question) {
  const regions = hotRegions(question);
  regions.push({ id: `region${regions.length + 1}`, label: `Region ${regions.length + 1}` });
  markQuestionDirty(question);
}

function removeHotRegion(question, index) {
  const [removed] = hotRegions(question).splice(index, 1);
  question.correctAnswerData.regions = (question.correctAnswerData.regions || []).filter((id) => id !== removed?.id);
  markQuestionDirty(question);
}

function toggleHotRegionAnswer(question, id) {
  const regions = question.correctAnswerData.regions || [];
  question.correctAnswerData.regions = regions.includes(id)
    ? regions.filter((item) => item !== id)
    : [...regions, id];
  markQuestionDirty(question);
}

function questionValidationIssues(question) {
  const definition = getQuestionTypeDefinition(question?.questionType);
  const issues = definition.validateQuestion(question, { definition });
  const normalizedIssues = Array.isArray(issues) ? issues.filter(Boolean) : [];

  if (definition.type === 'MULTIPLE_CHOICE') {
    const options = Array.isArray(question?.options) ? question.options : [];
    const optionKeys = options.map((option) => String(option?.key ?? '').trim());
    const normalizedOptionKeys = optionKeys.map((key) => key.toUpperCase());
    const validOptionKeys = new Set(normalizedOptionKeys.filter(Boolean));
    const hasEmptyOptionKey = optionKeys.some((key) => !key);
    const hasDuplicateOptionKey = normalizedOptionKeys.some((key, index) => (
      key && normalizedOptionKeys.indexOf(key) !== index
    ));
    const answerKeys = normalizeAnswerList(question?.correctAnswerData);
    const hasInvalidAnswerKey = answerKeys.some((answer) => (
      !validOptionKeys.has(String(answer).trim().toUpperCase())
    ));

    if (hasEmptyOptionKey) {
      normalizedIssues.push('Option keys cannot be blank.');
    }
    if (hasDuplicateOptionKey) {
      normalizedIssues.push('Option keys must be unique.');
    }
    if (hasInvalidAnswerKey) {
      normalizedIssues.push('Correct answers must reference existing option keys.');
    }
    if (!isMultiSelectType(question?.questionType) && answerKeys.length > 1) {
      normalizedIssues.push('Single-choice questions can have only one correct answer.');
    }
  }

  if (isFillInBlankType(question?.questionType)) {
    const answers = fillBlankCorrectAnswerData(question.correctAnswerData, '', { keepBlank: false }).answers;
    if (answers.length === 0) {
      normalizedIssues.push('Add at least one accepted answer.');
    }
    if (duplicateFillBlankAnswerSet(question).size > 0) {
      normalizedIssues.push('Remove duplicate accepted answers.');
    }
  }

  return normalizedIssues;
}

function questionValidationMessage(question) {
  const issues = questionValidationIssues(question);
  if (issues.length === 0) {
    return '';
  }

  const definition = getQuestionTypeDefinition(question?.questionType);
  const prefix = `${definition.label || definition.type} Q${question.questionNumber || '-'}: `;
  const visibleIssues = issues.slice(0, 4).join(' ');
  return issues.length > 4 ? `${prefix}${visibleIssues} Plus ${issues.length - 4} more.` : `${prefix}${visibleIssues}`;
}

function firstInvalidQuestion() {
  for (const localId of modifiedQuestionIds.value) {
    const question = questions.value.find((item) => item.localId === localId);
    if (question && questionValidationIssues(question).length > 0) {
      return question;
    }
  }

  return null;
}

async function resolveScopedQuestionLabels(scope = {}) {
  const scopedPart = scope.partId
    ? parts.value.find((part) => sameId(part.partId, scope.partId))
    : null;
  const scopedPartCode = normalizeTypeCode(scope.partCode || partCode(scopedPart) || 'ELA');
  const part = scopedPart || await createPartFromOfficial(scopedPartCode);
  const preferredSubTypeCode = preferredSubTypeCodeForScope(partCode(part), scope);
  const subType = preferredSubTypeCode
    ? await createSubTypeFromOfficial(part.partId, preferredSubTypeCode)
    : subTypes.value.find((item) => sameId(item.partId, part.partId)) || null;

  return {
    partId: part.partId,
    subTypeId: subType?.subTypeId || null,
  };
}

function scopedQuestionInsertIndex(scope = {}, partId = null) {
  const ordered = sortedQuestions.value;
  if (scope.afterQuestions?.length > 0) {
    const questionIds = new Set(scope.afterQuestions.map((question) => question.localId));
    const lastSetIndex = ordered.reduce((lastIndex, question, index) => {
      return questionIds.has(question.localId) ? index : lastIndex;
    }, -1);
    return lastSetIndex >= 0 ? lastSetIndex + 1 : ordered.length;
  }
  if (scope.sourceQuestion) {
    const sourceIndex = ordered.findIndex((question) => question.localId === scope.sourceQuestion.localId);
    return sourceIndex >= 0 ? sourceIndex + 1 : ordered.length;
  }
  if (partId) {
    const lastPartQuestionIndex = ordered.reduce((lastIndex, question, index) => {
      return sameId(question.partId, partId) ? index : lastIndex;
    }, -1);
    if (lastPartQuestionIndex >= 0) {
      return lastPartQuestionIndex + 1;
    }
  }
  if (normalizeTypeCode(scope.partCode) === 'ELA') {
    const mathPart = findPartByCode('MATH');
    const firstMathQuestionIndex = ordered.findIndex((question) => sameId(question.partId, mathPart?.partId));
    return firstMathQuestionIndex >= 0 ? firstMathQuestionIndex : ordered.length;
  }

  return ordered.length;
}

async function addQuestion(scope = {}) {
  try {
    const labels = await resolveScopedQuestionLabels(scope);
    const ordered = [...sortedQuestions.value];
    const insertIndex = scopedQuestionInsertIndex(scope, labels.partId);
    const nextNumber = insertIndex + 1;
    const question = normalizeQuestion({
      questionId: null,
      partId: labels.partId,
      subTypeId: labels.subTypeId,
      materialId: scope.materialId || null,
      questionNumber: nextNumber,
      displayOrder: nextNumber,
      questionType: 'MULTIPLE_CHOICE',
      stem: '',
      options: defaultOptionKeys(),
      correctAnswerData: defaultCorrectAnswerData('MULTIPLE_CHOICE'),
      questionConfig: defaultQuestionConfig('MULTIPLE_CHOICE'),
      shsatSkillTag: normalizeShsatSkillTag(),
    });
    question.localId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ordered.splice(insertIndex, 0, question);
    ordered.forEach((item, index) => {
      item.questionNumber = index + 1;
      item.displayOrder = index + 1;
    });

    questions.value = ordered;
    selectedQuestionId.value = question.localId;
    markQuestionDirty(question);
    if (insertIndex < ordered.length - 1) {
      questionOrderDirty.value = true;
    }
  } catch (error) {
    showNotice(error.message || 'Failed to add question.', 'error');
  }
}

function requestDeleteQuestion(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  questionPendingDeletion.value = question;
}

function cancelDeleteQuestion() {
  questionPendingDeletion.value = null;
}

// Renumber the surviving questions to a gap-free 1..N and keep a neighbor selected.
function removeQuestionLocally(question) {
  const removedIndex = sortedQuestions.value.findIndex((item) => item.localId === question.localId);
  const remaining = sortedQuestions.value.filter((item) => item.localId !== question.localId);
  remaining.forEach((item, index) => {
    item.questionNumber = index + 1;
    item.displayOrder = index + 1;
  });

  questions.value = remaining;

  const nextModified = new Set(modifiedQuestionIds.value);
  nextModified.delete(question.localId);
  modifiedQuestionIds.value = nextModified;

  if (selectedQuestionId.value === question.localId) {
    const fallbackIndex = Math.min(Math.max(removedIndex, 0), remaining.length - 1);
    selectedQuestionId.value = remaining[fallbackIndex]?.localId || null;
  }

  // Persisted neighbors shift numbers, so the paper order must be re-synced on save.
  if (remaining.some((item) => item.questionId)) {
    questionOrderDirty.value = true;
  }
}

async function confirmDeleteQuestion() {
  const question = questionPendingDeletion.value;
  if (!question || deletingQuestion.value) {
    return;
  }

  deletingQuestion.value = true;

  try {
    // The unified API saves the complete draft structure in one transaction.
    if (question.questionId) {
      markStructureDirty('question-delete', question.questionId);
    }
    removeQuestionLocally(question);
    questionPendingDeletion.value = null;
    showNotice('Question deleted.');
  } catch (error) {
    showNotice(error.message || 'Failed to delete question.', 'error');
  } finally {
    deletingQuestion.value = false;
  }
}

function showNotice(message, type = 'success') {
  if (noticeTimer) {
    window.clearTimeout(noticeTimer);
    noticeTimer = null;
  }

  noticeMessage.value = message;
  noticeType.value = type;

  noticeTimer = window.setTimeout(closeNotice, type === 'error' ? 6000 : 2600);
}

function closeNotice() {
  if (noticeTimer) {
    window.clearTimeout(noticeTimer);
    noticeTimer = null;
  }

  noticeMessage.value = '';
}

function markQuestionDirty(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  const next = new Set(modifiedQuestionIds.value);
  next.add(question.localId);
  modifiedQuestionIds.value = next;
}

function markStructureDirty(kind, id) {
  const next = new Set(modifiedStructureKeys.value);
  next.add(`${kind}:${id || 'new'}`);
  modifiedStructureKeys.value = next;
}

function buildPartPayload(part) {
  return {
    partNumber: Number(part.partNumber || parts.value.length + 1),
    partCode: part.partCode || null,
    partName: part.partName || '',
    partIntro: part.partIntro || null,
    questionRange: part.questionRange || null,
    questionCount: Number(part.questionCount || 0),
    displayOrder: Number(part.displayOrder || part.partNumber || parts.value.length + 1),
  };
}

function buildSubTypePayload(subType) {
  return {
    partId: subType.partId || null,
    subTypeCode: subType.subTypeCode || null,
    subTypeName: subType.subTypeName || '',
    subTypeIntro: subType.subTypeIntro || null,
    questionRange: subType.questionRange || null,
    questionCount: Number(subType.questionCount || 0),
    displayOrder: Number(subType.displayOrder || subTypes.value.length + 1),
  };
}

async function createPartFromOfficial(typeCode) {
  const officialType = officialPartByCode(typeCode);
  if (!officialType) {
    throw new Error('Official primary type was not found.');
  }
  const existing = findPartByCode(officialType.code);
  if (existing) {
    return existing;
  }

  const saved = await savePart({
    partId: null,
    partNumber: parts.value.length + 1,
    partCode: officialType.code,
    partName: officialType.name,
    partIntro: officialType.intro,
    questionRange: '',
    questionCount: 0,
    displayOrder: parts.value.length + 1,
  });
  return saved;
}

async function createSubTypeFromOfficial(partId, typeCode) {
  const selectedPart = parts.value.find((part) => sameId(part.partId, partId));
  const officialType = officialSubTypeByCode(partCode(selectedPart), typeCode);
  if (!officialType) {
    throw new Error('Official secondary type was not found.');
  }
  const existing = findSubTypeByCode(partId, officialType.code);
  if (existing) {
    return existing;
  }

  const saved = await saveSubType({
    subTypeId: null,
    partId,
    subTypeCode: officialType.code,
    subTypeName: officialType.name,
    subTypeIntro: officialType.intro,
    questionRange: '',
    questionCount: 0,
    displayOrder: subTypes.value.length + 1,
  });
  return saved;
}

async function handlePrimaryTypeChange(event, question) {
  const value = event.target.value;
  if (!question) {
    return;
  }
  if (value === CUSTOM_LABEL_VALUE) {
    showPartsModal.value = true;
    return;
  }

  try {
    let selectedPartId = null;
    if (value.startsWith(EXISTING_PART_PREFIX)) {
      selectedPartId = value.slice(EXISTING_PART_PREFIX.length);
    } else if (value.startsWith(OFFICIAL_VALUE_PREFIX)) {
      const saved = await createPartFromOfficial(value.slice(OFFICIAL_VALUE_PREFIX.length));
      selectedPartId = saved.partId;
    }

    const previousSubTypeId = question.subTypeId;
    question.partId = selectedPartId || null;
    if (!isSubTypeValidForPart(question.partId, question.subTypeId)) {
      question.subTypeId = null;
    }
    markQuestionDirty(question);
    if (previousSubTypeId && !question.subTypeId) {
      showNotice('Secondary type was cleared because it does not belong to the selected primary type.', 'info');
    }
  } catch (error) {
    showNotice(error.message || 'Failed to set primary type.', 'error');
  }
}

async function handleSecondaryTypeChange(event, question) {
  const value = event.target.value;
  if (!question) {
    return;
  }
  if (value === CUSTOM_LABEL_VALUE) {
    newSubType.partId = question.partId || '';
    showTypesModal.value = true;
    return;
  }

  try {
    let selectedSubTypeId = null;
    if (value.startsWith(EXISTING_SUB_TYPE_PREFIX)) {
      selectedSubTypeId = value.slice(EXISTING_SUB_TYPE_PREFIX.length);
    } else if (value.startsWith(OFFICIAL_VALUE_PREFIX)) {
      const saved = await createSubTypeFromOfficial(question.partId, value.slice(OFFICIAL_VALUE_PREFIX.length));
      selectedSubTypeId = saved.subTypeId;
    }

    question.subTypeId = selectedSubTypeId || null;
    markQuestionDirty(question);
  } catch (error) {
    showNotice(error.message || 'Failed to set secondary type.', 'error');
  }
}

function questionDragKey(question) {
  return question?.localId || '';
}

function isQuestionDragging(question) {
  return draggedQuestionId.value === questionDragKey(question);
}

function questionDropClass(question) {
  if (!draggedQuestionId.value || dragOverQuestionId.value !== questionDragKey(question)) {
    return '';
  }

  return dragOverPosition.value === 'before' ? 'question-item--drop-before' : 'question-item--drop-after';
}

function reorderQuestionsPreview(sourceId, targetId, position) {
  const ordered = [...sortedQuestions.value];
  const sourceIndex = ordered.findIndex((question) => questionDragKey(question) === sourceId);
  const targetIndex = ordered.findIndex((question) => questionDragKey(question) === targetId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return null;
  }

  const [movedQuestion] = ordered.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = ordered.findIndex((question) => questionDragKey(question) === targetId);
  const insertIndex = position === 'before' ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;
  ordered.splice(insertIndex, 0, movedQuestion);
  return { ordered, movedQuestion };
}

function isElaMaterialQuestion(question) {
  if (!question?.materialId) {
    return false;
  }

  const selectedPart = parts.value.find((part) => sameId(part.partId, question.partId));
  return partCode(selectedPart) === 'ELA';
}

function readingSetKeyForQuestion(targetQuestion) {
  if (!isElaMaterialQuestion(targetQuestion)) {
    return '';
  }

  let segmentIndex = 0;
  let previousMaterialId = null;
  for (const question of sortedQuestions.value) {
    if (!isElaMaterialQuestion(question)) {
      previousMaterialId = null;
      continue;
    }

    if (!sameId(previousMaterialId, question.materialId)) {
      segmentIndex += 1;
      previousMaterialId = question.materialId;
    }

    if (questionDragKey(question) === questionDragKey(targetQuestion)) {
      return `passage:${question.materialId}:${segmentIndex}`;
    }
  }

  return '';
}

function reorderScopeKey(question) {
  return isElaMaterialQuestion(question)
    ? readingSetKeyForQuestion(question)
    : 'standalone';
}

function questionReorderIssue(sourceId, targetId, position) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return '';
  }

  const sourceQuestion = sortedQuestions.value.find((question) => questionDragKey(question) === sourceId);
  const targetQuestion = sortedQuestions.value.find((question) => questionDragKey(question) === targetId);
  if (!sourceQuestion || !targetQuestion) {
    return '';
  }
  if (!sameId(sourceQuestion.partId, targetQuestion.partId)) {
    return SECTION_REORDER_MESSAGE;
  }
  if (reorderScopeKey(sourceQuestion) !== reorderScopeKey(targetQuestion)) {
    return PASSAGE_SET_REORDER_MESSAGE;
  }

  return '';
}

function startQuestionDrag(event, question) {
  draggedQuestionId.value = questionDragKey(question);
  dragOverQuestionId.value = draggedQuestionId.value;
  dragOverPosition.value = 'after';
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedQuestionId.value);
}

function updateQuestionDragTarget(event, question) {
  if (!draggedQuestionId.value || draggedQuestionId.value === questionDragKey(question)) {
    return;
  }

  event.preventDefault();
  const bounds = event.currentTarget.getBoundingClientRect();
  const midpoint = bounds.top + bounds.height / 2;
  const nextPosition = event.clientY < midpoint ? 'before' : 'after';
  dragOverQuestionId.value = questionDragKey(question);
  dragOverPosition.value = nextPosition;
  event.dataTransfer.dropEffect = questionReorderIssue(draggedQuestionId.value, questionDragKey(question), nextPosition) ? 'none' : 'move';
}

function dropQuestion(event, targetQuestion) {
  event.preventDefault();
  const sourceId = draggedQuestionId.value || event.dataTransfer.getData('text/plain');
  const targetId = questionDragKey(targetQuestion);
  const position = dragOverPosition.value;
  clearQuestionDragState();

  if (!sourceId || !targetId || sourceId === targetId) {
    return;
  }

  const reorderIssue = questionReorderIssue(sourceId, targetId, position);
  if (reorderIssue) {
    showNotice(reorderIssue, 'error');
    return;
  }

  reorderQuestionLocally(sourceId, targetId, position);
}

function clearQuestionDragState() {
  draggedQuestionId.value = null;
  dragOverQuestionId.value = null;
  dragOverPosition.value = 'after';
}

function reorderQuestionLocally(sourceId, targetId, position) {
  const reorderIssue = questionReorderIssue(sourceId, targetId, position);
  if (reorderIssue) {
    showNotice(reorderIssue, 'error');
    return;
  }

  const preview = reorderQuestionsPreview(sourceId, targetId, position);
  if (!preview) {
    return;
  }

  const { ordered, movedQuestion } = preview;

  ordered.forEach((question, index) => {
    question.questionNumber = index + 1;
    question.displayOrder = index + 1;
  });
  questions.value = ordered;
  selectedQuestionId.value = movedQuestion.localId;
  questionOrderDirty.value = true;
}

async function loadPaper() {
  loading.value = true;
  errorMessage.value = '';
  noticeMessage.value = '';

  try {
    const [templateResponse, paperResponse] = await Promise.all([
      adminApi.getOfficialShsatLabelTemplate(),
      adminApi.getPaper(paperId.value),
    ]);
    officialShsatTypes.value = normalizeOfficialShsatTemplate(unwrapResponse(templateResponse));
    const detail = unwrapResponse(paperResponse);
    paper.value = detail;
    scoringProfileCode.value = detail.scoringProfileCode || 'SHSAT_2026_100';
    parts.value = (detail.parts || []).map((part) => ({ ...part }));
    subTypes.value = (detail.subTypes || []).map((subType) => ({ ...subType }));
    captureOfficialStructureKeys();
    materials.value = (detail.materials || []).map((material) => ({ ...material }));
    questions.value = (detail.questions || []).map(normalizeQuestion);
    const savedSelection = readEditorSelection('shsat', paperId.value);
    const restoredQuestion = questions.value.find((question) => {
      return (savedSelection?.questionId && sameId(question.questionId, savedSelection.questionId))
        || (savedSelection?.localId && sameId(question.localId, savedSelection.localId));
    }) || questions.value.find((question) => {
      return savedSelection?.questionNumber
        && Number(question.questionNumber) === Number(savedSelection.questionNumber);
    });
    selectedQuestionId.value = restoredQuestion?.localId || questions.value[0]?.localId || null;
    loadedPaperId.value = String(paperId.value);
    if (restoredQuestion) {
      nextTick(() => scrollQuestionListTo(restoredQuestion.questionId || restoredQuestion.localId));
    }
    questionOrderDirty.value = false;
    modifiedQuestionIds.value = new Set();
    modifiedStructureKeys.value = new Set();
  } catch (error) {
    errorMessage.value = error.message || 'Failed to load paper details';
    paper.value = null;
  } finally {
    loading.value = false;
  }
}

async function saveChanges() {
  if (!hasChanges.value) {
    return;
  }

  if (hasQuestionOrStructureChanges.value) {
    const invalidQuestion = firstInvalidQuestion();
    if (invalidQuestion) {
      showNotice(questionValidationMessage(invalidQuestion), 'error');
      return;
    }

    const labelConsistencyIssue = firstLabelConsistencyIssue();
    if (labelConsistencyIssue) {
      showNotice(labelConsistencyIssue, 'error');
      return;
    }
  }

  saving.value = true;

  try {
    if (hasQuestionOrStructureChanges.value) {
      const selectedNumber = currentQuestion.value?.questionNumber;
      const saved = unwrapResponse(await adminApi.savePaperStructure(paperId.value, {
        parts: parts.value,
        subTypes: subTypes.value,
        materials: materials.value,
        questions: sortedQuestions.value,
      }));
      paper.value = saved;
      parts.value = saved.parts || [];
      subTypes.value = saved.subTypes || [];
      materials.value = saved.materials || [];
      questions.value = (saved.questions || []).map(normalizeQuestion);
      selectedQuestionId.value = questions.value.find((question) => Number(question.questionNumber) === Number(selectedNumber))?.localId
        || questions.value[0]?.localId
        || null;
      modifiedQuestionIds.value = new Set();
      modifiedStructureKeys.value = new Set();
      questionOrderDirty.value = false;
    }
    if (scoringProfileCode.value !== (paper.value?.scoringProfileCode || 'SHSAT_2026_100')) {
      const updatedPaper = unwrapResponse(await adminApi.updatePaperScoringProfile(paperId.value, scoringProfileCode.value));
      paper.value = { ...paper.value, scoringProfileCode: updatedPaper.scoringProfileCode };
    }
  } catch (error) {
    showNotice(error.message || 'Failed to save changes.', 'error');
    saving.value = false;
    return;
  }

  showNotice('All changes saved.');
  saving.value = false;
}

async function savePart(part) {
  const saved = { ...part, ...buildPartPayload(part), partId: part.partId || `local-part-${Date.now()}` };
  const index = parts.value.findIndex((item) => sameId(item.partId, part.partId));
  if (index >= 0) {
    parts.value.splice(index, 1, saved);
  } else {
    parts.value.push(saved);
  }
  markStructureDirty('part', saved.partId);
  return saved;
}

async function saveSubType(subType) {
  const saved = { ...subType, ...buildSubTypePayload(subType), subTypeId: subType.subTypeId || `local-subtype-${Date.now()}` };
  const index = subTypes.value.findIndex((item) => sameId(item.subTypeId, subType.subTypeId));
  if (index >= 0) {
    subTypes.value.splice(index, 1, saved);
  } else {
    subTypes.value.push(saved);
  }
  markStructureDirty('subType', saved.subTypeId);
  return saved;
}

function goBack() {
  if (hasChanges.value) {
    showLeaveConfirmModal.value = true;
    return;
  }

  router.push({ name: 'shsat-admin', query: { tab: 'papers' } });
}

function previewPaper() {
  if (hasChanges.value) {
    showNotice('Save your changes before opening the student preview.', 'error');
    return;
  }

  router.push({
    name: 'admin-paper-preview',
    params: { paperId: paperId.value },
  });
}

function discardChangesAndGoBack() {
  showLeaveConfirmModal.value = false;
  router.push({ name: 'shsat-admin', query: { tab: 'papers' } });
}

function selectQuestion(question) {
  selectedQuestionId.value = question.localId;
}

function scrollQuestionListTo(questionId) {
  const container = questionListElement.value;
  if (!container || questionId === null || questionId === undefined) return;

  const questionElement = [...container.querySelectorAll('[data-question-id]')]
    .find((element) => element.dataset.questionId === String(questionId));
  if (!questionElement) return;

  const containerRect = container.getBoundingClientRect();
  const questionRect = questionElement.getBoundingClientRect();
  const centeredOffset = questionRect.top - containerRect.top
    - (container.clientHeight - questionRect.height) / 2;
  container.scrollTo({
    top: container.scrollTop + centeredOffset,
    behavior: 'smooth',
  });
}

// 摘题窗口只读取统计列表和当前选中的题目详情，确认加入时才调用事务式复制接口。
async function openImportQuestions() {
  showImportQuestionsModal.value = true;
  loadingImportExams.value = true;
  importQuestionsError.value = '';
  importExamId.value = '';
  importAnalytics.value = [];
  collapsedImportGroupCodes.value = new Set();
  selectedImportQuestionNumbers.value = [];
  previewImportQuestionNumber.value = null;
  previewImportQuestion.value = null;

  try {
    const [examResponse, paperResponse] = await Promise.all([adminApi.getExams(), adminApi.getPapers()]);
    importExams.value = (unwrapResponse(examResponse) || [])
      .filter((exam) => exam.published)
      .sort((left, right) => new Date(right.publishedAt || right.startTime || 0) - new Date(left.publishedAt || left.startTime || 0));
    importPaperNames.value = Object.fromEntries((unwrapResponse(paperResponse) || []).map((item) => [item.paperId, item.paperName]));
    const firstExam = importExams.value[0];
    if (firstExam) await selectImportSourceExam(firstExam.examId);
  } catch (error) {
    importQuestionsError.value = error.message || 'Failed to load published exams.';
  } finally {
    loadingImportExams.value = false;
  }
}

async function selectImportSourceExam(examId) {
  importExamId.value = String(examId || '');
  importAnalytics.value = [];
  importAnalyticsFilter.value = 'all';
  importQuestionTypeFilter.value = 'all';
  collapsedImportGroupCodes.value = new Set();
  selectedImportQuestionNumbers.value = [];
  previewImportQuestionNumber.value = null;
  previewImportQuestion.value = null;
  importQuestionsError.value = '';
  if (!importExamId.value) return;

  loadingImportAnalytics.value = true;
  try {
    const response = await adminApi.getExamMonitorAnalytics(importExamId.value);
    const payload = unwrapResponse(response);
    importAnalytics.value = payload?.questionAnalytics || [];
    const firstQuestion = sortedImportAnalytics.value[0];
    if (firstQuestion) await previewImportQuestionDetails(firstQuestion.questionNumber);
  } catch (error) {
    importQuestionsError.value = error.message || 'Failed to load question performance.';
  } finally {
    loadingImportAnalytics.value = false;
  }
}

async function previewImportQuestionDetails(questionNumber) {
  previewImportQuestionNumber.value = Number(questionNumber);
  previewImportQuestion.value = null;
  loadingImportDetail.value = true;
  importQuestionsError.value = '';
  try {
    const response = await adminApi.getExamMonitorQuestion(importExamId.value, questionNumber);
    const payload = unwrapResponse(response);
    previewImportQuestion.value = {
      ...(payload.question || {}),
      material: payload.material || null,
    };
  } catch (error) {
    importQuestionsError.value = error.message || 'Failed to load this question.';
  } finally {
    loadingImportDetail.value = false;
  }
}

function previewImportedImage(src) {
  editorImagePreview.value = {
    open: true,
    src,
    title: 'Source Question Image',
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
  editorImagePreviewPanState = null;
}

function toggleImportQuestion(questionNumber) {
  const normalizedNumber = Number(questionNumber);
  selectedImportQuestionNumbers.value = selectedImportQuestionNumbers.value.includes(normalizedNumber)
    ? selectedImportQuestionNumbers.value.filter((number) => number !== normalizedNumber)
    : [...selectedImportQuestionNumbers.value, normalizedNumber];
}

function toggleAllVisibleImportQuestions() {
  const visibleNumbers = visibleImportAnalytics.value.map((row) => Number(row.questionNumber));
  const selectedNumbers = new Set(selectedImportQuestionNumbers.value);

  if (allVisibleImportQuestionsSelected.value) {
    visibleNumbers.forEach((number) => selectedNumbers.delete(number));
  } else {
    visibleNumbers.forEach((number) => selectedNumbers.add(number));
  }

  selectedImportQuestionNumbers.value = [...selectedNumbers];
}

async function confirmImportQuestions() {
  if (importingQuestions.value || selectedImportQuestionNumbers.value.length === 0 || !selectedImportExam.value) return;

  importingQuestions.value = true;
  importQuestionsError.value = '';
  try {
    if (hasChanges.value) {
      await saveChanges();
      if (hasChanges.value) {
        importQuestionsError.value = 'Save the current edits first. Close this window, fix any highlighted fields, then import again.';
        return;
      }
    }

    const response = await adminApi.importQuestionsFromExam(paperId.value, {
      sourceExamId: Number(importExamId.value),
      questionNumbers: selectedImportQuestionNumbers.value,
    });
    const importedQuestions = unwrapResponse(response) || [];
    const firstImportedQuestionId = importedQuestions[0]?.questionId;
    recentlyImportedQuestionIds.value = new Set([
      ...recentlyImportedQuestionIds.value,
      ...importedQuestions
        .map((question) => question.questionId)
        .filter((questionId) => questionId !== null && questionId !== undefined)
        .map(String),
    ]);
    showImportQuestionsModal.value = false;
    await loadPaper();
    const addedQuestion = questions.value.find((question) => sameId(question.questionId, firstImportedQuestionId));
    if (addedQuestion) {
      selectedQuestionId.value = addedQuestion.localId;
      await nextTick();
      scrollQuestionListTo(addedQuestion.questionId);
    }
    showNotice(`${importedQuestions.length} questions added from ${selectedImportExam.value?.examTitle || 'the selected exam'}.`);
  } catch (error) {
    importQuestionsError.value = error.message || 'Failed to add selected questions.';
  } finally {
    importingQuestions.value = false;
  }
}

function formatImportExamDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function formatImportAccuracy(value) {
  return value === null || value === undefined ? 'No answers' : `${Number(value).toFixed(1)}% correct`;
}

function formatImportDuration(seconds) {
  if (seconds === null || seconds === undefined) return 'No timing data';
  const totalSeconds = Math.max(0, Math.round(Number(seconds)));
  if (totalSeconds < 60) return `${totalSeconds}s avg`;
  return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, '0')}s avg`;
}

function previousQuestion() {
  if (currentQuestionIndex.value <= 0) {
    return;
  }

  selectedQuestionId.value = sortedQuestions.value[currentQuestionIndex.value - 1].localId;
}

function nextQuestion() {
  if (currentQuestionIndex.value >= sortedQuestions.value.length - 1) {
    return;
  }

  selectedQuestionId.value = sortedQuestions.value[currentQuestionIndex.value + 1].localId;
}

function materialOptionsForType(materialType) {
  if (materialType === 'text') {
    return textMaterials.value;
  }
  if (materialType === 'image') {
    return imageMaterials.value;
  }

  return [];
}

function clearMaterialDraft(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  question.materialId = null;
  question.material = null;
  question.materialTitle = '';
  question.materialCategory = 'Reading Passage';
  question.materialContent = '';
  question.imageUrl = '';
}

function handleMaterialTypeChange(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  if (question.materialType === 'none') {
    clearMaterialDraft(question);
    markQuestionDirty(question);
    return;
  }

  const linkedMaterial = materials.value.find((material) => sameId(material.materialId, question.materialId));
  const linkedType = getMaterialDraftType(linkedMaterial);

  if (!linkedMaterial || linkedType !== question.materialType) {
    // Keep the editing intent after switching type, but do not reuse an incompatible material link.
    clearMaterialDraft(question);
  } else {
    applyMaterialToQuestion(linkedMaterial, question);
  }

  markQuestionDirty(question);
}

function applyMaterialToQuestion(material, question = currentQuestion.value) {
  if (!material || !question) {
    return;
  }

  const materialType = getMaterialDraftType(material);
  const materialContent = getMaterialContent(material);

  question.materialId = material.materialId;
  question.material = material;
  question.materialType = materialType;
  question.materialTitle = material.materialTitle || '';
  question.materialCategory = material.materialCategory || 'Reading Passage';
  question.materialContent = materialType === 'text' ? materialContent : '';
  question.imageUrl = materialType === 'image' ? materialContent : '';
}

function handleMaterialSelection(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  if (!question.materialId) {
    question.materialType = 'none';
    clearMaterialDraft(question);
    markQuestionDirty(question);
    return;
  }

  const material = materials.value.find((item) => sameId(item.materialId, question.materialId));
  if (material) {
    applyMaterialToQuestion(material, question);
  }

  markQuestionDirty(question);
}

function startNewMaterialDraft(question = currentQuestion.value) {
  if (!question || question.materialType === 'none') {
    return;
  }

  const materialType = question.materialType;
  clearMaterialDraft(question);
  question.materialType = materialType;
  markQuestionDirty(question);
}

function clearCurrentMaterial(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  question.materialType = 'none';
  clearMaterialDraft(question);
  markQuestionDirty(question);
}

function updateMaterialDraft(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  const materialUpdate = {
    ...(question.material || {}),
    materialId: question.materialId,
    materialType: question.materialType === 'image' ? 'IMAGE' : 'TEXT',
    materialTitle: question.materialTitle,
    materialCategory: question.materialCategory,
    materialContent: question.materialType === 'image' ? null : question.materialContent,
    assetUrl: question.materialType === 'image' ? question.imageUrl : question.material?.assetUrl,
  };

  if (question.materialId) {
    // 共享材料存于各题的试卷结构中，编辑一题时同步所有同 ID 关联题，避免保存后内容分叉。
    questions.value
      .filter((item) => sameId(item.materialId, question.materialId))
      .forEach((item) => {
        item.materialTitle = question.materialTitle;
        item.materialCategory = question.materialCategory;
        item.materialContent = question.materialContent;
        item.imageUrl = question.imageUrl;
        item.material = materialUpdate;
      });

    materials.value = materials.value.map((material) => sameId(material.materialId, question.materialId)
      ? { ...material, ...materialUpdate, partId: material.partId, subTypeId: material.subTypeId, displayOrder: material.displayOrder }
      : material);
  } else {
    question.material = materialUpdate;
  }

  markQuestionDirty(question);
}

function updateTextMaterialField(question = currentQuestion.value, fieldName, value) {
  if (!question || question.materialType !== 'text') {
    return;
  }

  const fields = parseStructuredMaterialContent(question.materialContent);
  question.materialContent = composeStructuredMaterialContent({
    ...fields,
    [fieldName]: value,
  });
  updateMaterialDraft(question);
}

function insertFormulaIntoField(question, fieldName, mode, textareaRef, onChange) {
  if (!question) {
    return;
  }

  const textarea = textareaRef?.value || null;
  const source = String(question[fieldName] ?? '');
  const hasFocusedTextarea = textarea && document.activeElement === textarea;
  const start = hasFocusedTextarea ? textarea.selectionStart : source.length;
  const end = hasFocusedTextarea ? textarea.selectionEnd : source.length;
  const selectedText = source.slice(start, end);
  const insertion = createFormulaInsertion(source, start, end, selectedText, mode);

  question[fieldName] = insertion.value;
  onChange(question);

  nextTick(() => {
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(insertion.selectionStart, insertion.selectionEnd);
  });
}

function createFormulaInsertion(source, start, end, selectedText, mode) {
  const formulaBody = selectedText || 'x^2';

  if (mode === 'block') {
    const prefix = start > 0 && source[start - 1] !== '\n' ? '\n$$\n' : '$$\n';
    const suffix = end < source.length && source[end] !== '\n' ? '\n$$\n' : '\n$$';
    const value = `${source.slice(0, start)}${prefix}${formulaBody}${suffix}${source.slice(end)}`;
    const selectionStart = start + prefix.length;
    return {
      value,
      selectionStart,
      selectionEnd: selectionStart + formulaBody.length,
    };
  }

  const prefix = '$';
  const suffix = '$';
  const value = `${source.slice(0, start)}${prefix}${formulaBody}${suffix}${source.slice(end)}`;
  const selectionStart = start + prefix.length;
  return {
    value,
    selectionStart,
    selectionEnd: selectionStart + formulaBody.length,
  };
}

function insertStemFormula(question = currentQuestion.value, mode = 'inline') {
  insertFormulaIntoField(question, 'stem', mode, stemTextarea, markQuestionDirty);
}

function openStemImageInsert(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  const textarea = stemTextarea.value || null;
  const source = String(question.stem ?? '');
  const start = getTextareaSelectionPosition(textarea, 'selectionStart', source.length);
  const end = getTextareaSelectionPosition(textarea, 'selectionEnd', start);

  pendingStemImageInsertion.value = {
    questionLocalId: question.localId,
    start: clampTextOffset(start, source.length),
    end: clampTextOffset(end, source.length),
  };

  screenshotInsertTarget.value = 'stem';
  showMaterialScreenshotPasteModal.value = true;
  setMaterialScreenshotPasteMessage('Copy a screenshot, focus the paste area, then press Command+V or Ctrl+V.', 'info');
  nextTick(() => {
    materialScreenshotPasteZone.value?.focus();
  });
}

function insertMaterialFormula(question = currentQuestion.value, mode = 'inline') {
  if (!question || question.materialType !== 'text') {
    return;
  }

  const textarea = materialContentTextarea.value || null;
  const fields = parseStructuredMaterialContent(question.materialContent);
  const source = String(fields.body ?? '');
  const hasFocusedTextarea = textarea && document.activeElement === textarea;
  const start = hasFocusedTextarea ? textarea.selectionStart : source.length;
  const end = hasFocusedTextarea ? textarea.selectionEnd : source.length;
  const selectedText = source.slice(start, end);
  const insertion = createFormulaInsertion(source, start, end, selectedText, mode);

  // Formula insertion targets Body while materialContent stays the only saved field.
  question.materialContent = composeStructuredMaterialContent({
    ...fields,
    body: insertion.value,
  });
  updateMaterialDraft(question);

  nextTick(() => {
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(insertion.selectionStart, insertion.selectionEnd);
  });
}

function openTextMaterialImageInsert(question = currentQuestion.value) {
  if (!question || question.materialType !== 'text') {
    return;
  }

  const textarea = materialContentTextarea.value || null;
  const fields = parseStructuredMaterialContent(question.materialContent);
  const source = String(fields.body ?? '');
  const start = getTextareaSelectionPosition(textarea, 'selectionStart', source.length);
  const end = getTextareaSelectionPosition(textarea, 'selectionEnd', start);

  pendingMaterialBodyImageInsertion.value = {
    questionLocalId: question.localId,
    start: clampTextOffset(start, source.length),
    end: clampTextOffset(end, source.length),
  };

  screenshotInsertTarget.value = 'material';
  showMaterialScreenshotPasteModal.value = true;
  setMaterialScreenshotPasteMessage('Copy a screenshot, focus the paste area, then press Command+V or Ctrl+V.', 'info');
  nextTick(() => {
    materialScreenshotPasteZone.value?.focus();
  });
}

async function uploadTextMaterialBodyImage(event, question = currentQuestion.value) {
  const file = event.target.files?.[0];
  event.target.value = '';

  if (!file) {
    return;
  }

  await insertScreenshotImageFile(file, question);
}

async function handleTextMaterialScreenshotPaste(event) {
  event.preventDefault();

  if (!event.clipboardData) {
    setMaterialScreenshotPasteMessage('Clipboard data is not available in this browser. Choose an image file instead.', 'error');
    return;
  }

  const file = getImageFileFromPasteEvent(event);
  if (!file) {
    setMaterialScreenshotPasteMessage('No image was found in the pasted content. Copy a screenshot or choose an image file instead.', 'error');
    return;
  }

  await insertScreenshotImageFile(file, currentQuestion.value);
}

function triggerMaterialBodyImageFilePicker() {
  materialBodyImageInput.value?.click();
}

async function insertScreenshotImageFile(file, question = currentQuestion.value) {
  if (screenshotInsertTarget.value === 'stem') {
    await insertStemImageFile(file, question);
    return;
  }

  await insertTextMaterialBodyImageFile(file, question);
}

async function insertStemImageFile(file, question = currentQuestion.value) {
  if (!question) {
    setMaterialScreenshotPasteMessage('Select a question before inserting an image.', 'error');
    return;
  }

  if (!isImageFile(file)) {
    setMaterialScreenshotPasteMessage('The selected or pasted file is not an image. Use a JPG, PNG, WebP, or GIF file.', 'error');
    return;
  }

  uploadingStemImage.value = true;
  setMaterialScreenshotPasteMessage('Uploading image...', 'info');

  try {
    const uploadFile = normalizeMaterialImageUploadFile(file);
    const saved = unwrapResponse(await adminApi.uploadQuestionImage(paperId.value, uploadFile));
    const imagePath = saved.assetUrl || saved.url || saved.path || '';
    const marker = createStemImageMarker(imagePath);

    if (!marker) {
      throw new Error('The uploaded image did not return a usable path.');
    }

    insertStemImageMarker(question, marker);
    closeTextMaterialScreenshotPasteModal();
    showNotice('Image inserted into the stem. Save changes to keep it.', 'success');
  } catch (error) {
    setMaterialScreenshotPasteMessage(error.message || 'Failed to insert stem image.', 'error');
    showNotice(error.message || 'Failed to insert stem image.', 'error');
  } finally {
    uploadingStemImage.value = false;
  }
}

function insertStemImageMarker(question, marker) {
  const source = String(question.stem ?? '');
  const pendingInsertion = pendingStemImageInsertion.value;
  const usesPendingInsertion = pendingInsertion?.questionLocalId === question.localId;
  const start = usesPendingInsertion ? clampTextOffset(pendingInsertion.start, source.length) : source.length;
  const end = usesPendingInsertion ? clampTextOffset(pendingInsertion.end, source.length) : start;
  const leadingBreak = start > 0 && source[start - 1] !== '\n' ? '\n' : '';
  const trailingBreak = end < source.length && source[end] !== '\n' ? '\n' : '';

  question.stem = `${source.slice(0, start)}${leadingBreak}${marker}${trailingBreak}${source.slice(end)}`;
  markQuestionDirty(question);

  nextTick(() => {
    const textarea = stemTextarea.value || null;
    if (!textarea) {
      return;
    }

    const cursor = start + leadingBreak.length + marker.length + trailingBreak.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  });
}

async function insertTextMaterialBodyImageFile(file, question = currentQuestion.value) {
  if (!question || question.materialType !== 'text') {
    setMaterialScreenshotPasteMessage('Select a text material before inserting an image.', 'error');
    return;
  }

  if (!isImageFile(file)) {
    setMaterialScreenshotPasteMessage('The selected or pasted file is not an image. Use a JPG, PNG, WebP, or GIF file.', 'error');
    return;
  }

  uploadingMaterialBodyImage.value = true;
  setMaterialScreenshotPasteMessage('Uploading image...', 'info');

  try {
    const uploadFile = normalizeMaterialImageUploadFile(file);
    const saved = unwrapResponse(await adminApi.uploadQuestionImage(paperId.value, uploadFile));
    const imagePath = saved.assetUrl || saved.url || saved.path || '';
    const marker = createMaterialImageMarker(imagePath);

    if (!marker) {
      throw new Error('The uploaded image did not return a usable path.');
    }

    insertTextMaterialBodyMarker(question, marker);
    closeTextMaterialScreenshotPasteModal();
    showNotice('Image inserted into the material body. Save changes to keep it.', 'success');
  } catch (error) {
    setMaterialScreenshotPasteMessage(error.message || 'Failed to insert material image.', 'error');
    showNotice(error.message || 'Failed to insert material image.', 'error');
  } finally {
    uploadingMaterialBodyImage.value = false;
  }
}

function insertTextMaterialBodyMarker(question, marker) {
  const fields = parseStructuredMaterialContent(question.materialContent);
  const source = String(fields.body ?? '');
  const pendingInsertion = pendingMaterialBodyImageInsertion.value;
  const usesPendingInsertion = pendingInsertion?.questionLocalId === question.localId;
  const start = usesPendingInsertion ? clampTextOffset(pendingInsertion.start, source.length) : source.length;
  const end = usesPendingInsertion ? clampTextOffset(pendingInsertion.end, source.length) : start;
  const leadingBreak = start > 0 && source[start - 1] !== '\n' ? '\n' : '';
  const trailingBreak = end < source.length && source[end] !== '\n' ? '\n' : '';
  const body = `${source.slice(0, start)}${leadingBreak}${marker}${trailingBreak}${source.slice(end)}`;

  question.materialContent = composeStructuredMaterialContent({
    ...fields,
    body,
  });
  updateMaterialDraft(question);

  nextTick(() => {
    const textarea = materialContentTextarea.value || null;
    if (!textarea) {
      return;
    }

    const cursor = start + leadingBreak.length + marker.length + trailingBreak.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  });
}

function getImageFileFromPasteEvent(event) {
  const clipboardData = event.clipboardData;
  const fileFromFiles = Array.from(clipboardData.files || []).find(isImageFile);
  if (fileFromFiles) {
    return fileFromFiles;
  }

  for (const item of Array.from(clipboardData.items || [])) {
    if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
      return item.getAsFile();
    }
  }

  return null;
}

function isImageFile(file) {
  return Boolean(file && String(file.type || '').startsWith('image/'));
}

function normalizeMaterialImageUploadFile(file) {
  if (!file || String(file.name || '').trim()) {
    return file;
  }

  const extension = imageExtensionFromMimeType(file.type);
  // Pasted screenshots can arrive without a filename; Spring treats that as a
  // malformed multipart part, so provide a stable browser-side name.
  return new File([file], `screenshot${extension}`, {
    type: file.type || 'image/png',
    lastModified: file.lastModified || Date.now(),
  });
}

function imageExtensionFromMimeType(type) {
  switch (String(type || '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '.png';
  }
}

function setMaterialScreenshotPasteMessage(message, type = 'info') {
  materialScreenshotPasteMessage.value = message;
  materialScreenshotPasteMessageType.value = type;
}

function closeTextMaterialScreenshotPasteModal() {
  showMaterialScreenshotPasteModal.value = false;
  materialScreenshotPasteMessage.value = '';
  pendingMaterialBodyImageInsertion.value = null;
  pendingStemImageInsertion.value = null;
  screenshotInsertTarget.value = 'material';
}

function removeTextMaterialImageBlock(question = currentQuestion.value, item) {
  if (!question || question.materialType !== 'text' || !item?.marker) {
    return;
  }

  const fields = parseStructuredMaterialContent(question.materialContent);
  const body = removeBodyMarkerAtDisplayItem(fields.body, item);

  question.materialContent = composeStructuredMaterialContent({
    ...fields,
    body,
  });
  updateMaterialDraft(question);
}

function removeStemImageBlock(question = currentQuestion.value, item) {
  if (!question || !item?.marker) {
    return;
  }

  question.stem = removeBodyMarkerAtDisplayItem(question.stem, item);
  markQuestionDirty(question);
}

function removeBodyMarkerAtDisplayItem(body, item) {
  const source = String(body ?? '');
  let start = Number(item.sourceStart);
  let end = Number(item.sourceEnd);

  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end <= start
    || source.slice(start, end) !== item.marker
  ) {
    return source.replace(item.marker, '');
  }

  if (start > 0 && source[start - 1] === '\n' && source[end] === '\n') {
    end += 1;
  } else if (start === 0 && source[end] === '\n') {
    end += 1;
  } else if (start > 0 && source[start - 1] === '\n' && end === source.length) {
    start -= 1;
  }

  return `${source.slice(0, start)}${source.slice(end)}`;
}

function openTextMaterialImagePreview(item) {
  if (!item?.src) {
    return;
  }

  editorImagePreview.value = {
    open: true,
    src: item.src,
    title: 'Material Image',
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
  editorImagePreviewPanState = null;
}

function openStemImagePreview(item) {
  if (!item?.src) {
    return;
  }

  editorImagePreview.value = {
    open: true,
    src: item.src,
    title: 'Stem Image',
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
  editorImagePreviewPanState = null;
}

function getTextareaSelectionPosition(textarea, fieldName, fallback) {
  const value = textarea?.[fieldName];
  return Number.isInteger(value) ? value : fallback;
}

function clampTextOffset(value, length) {
  return Math.min(Math.max(Number(value) || 0, 0), length);
}

async function uploadImageMaterial(event, question = currentQuestion.value) {
  const file = event.target.files?.[0];
  event.target.value = '';

  if (!file || !question) {
    return;
  }

  uploadingImageQuestionId.value = question.localId;

  try {
    const saved = unwrapResponse(await adminApi.uploadMaterialImage(paperId.value, file, {
      materialId: question.materialId || null,
      partId: question.partId || null,
      subTypeId: question.subTypeId || null,
      materialTitle: question.materialTitle || file.name,
      materialCategory: question.materialCategory || 'Reading Passage',
      displayOrder: Number(question.displayOrder || question.questionNumber || 0),
    }));

    question.imageUploadName = file.name;
    applyMaterialToQuestion(saved, question);
    markQuestionDirty(question);
    showNotice('Image uploaded. Save changes to attach it to this question.', 'success');
  } catch (error) {
    showNotice(error.message || 'Failed to upload material image.', 'error');
  } finally {
    uploadingImageQuestionId.value = null;
  }
}

function clearImageDraft(question = currentQuestion.value) {
  if (!question) {
    return;
  }

  question.imageUrl = '';
  question.imageUploadName = '';
  updateMaterialDraft(question);
}

function openEditorImagePreview(question = currentQuestion.value) {
  if (!question?.imageUrl) {
    return;
  }

  editorImagePreview.value = {
    open: true,
    src: question.imageUrl,
    title: 'Image Preview',
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
  editorImagePreviewPanState = null;
}

function closeEditorImagePreview() {
  editorImagePreviewPanState = null;
  editorImagePreview.value = {
    open: false,
    src: '',
    title: '',
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
}

function zoomEditorImagePreview(event) {
  if (editorImagePreviewPanState?.moved) {
    editorImagePreviewPanState = null;
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  increaseEditorImagePreviewZoom(
    ((event.clientX - rect.left) / rect.width) * 100,
    ((event.clientY - rect.top) / rect.height) * 100
  );
}

function increaseEditorImagePreviewZoom(originX = editorImagePreview.value.originX, originY = editorImagePreview.value.originY) {
  const nextZoom = Math.min(
    EDITOR_IMAGE_PREVIEW_MAX_ZOOM,
    Number((editorImagePreview.value.zoom * EDITOR_IMAGE_PREVIEW_ZOOM_STEP).toFixed(2))
  );

  editorImagePreview.value = {
    ...editorImagePreview.value,
    zoom: nextZoom,
    originX: Math.min(100, Math.max(0, originX)),
    originY: Math.min(100, Math.max(0, originY)),
  };
}

function resetEditorImagePreviewZoom() {
  editorImagePreviewPanState = null;
  editorImagePreview.value = {
    ...editorImagePreview.value,
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
}

function editorImagePreviewTransformStyle() {
  return {
    transform: `translate3d(${editorImagePreview.value.panX || 0}px, ${editorImagePreview.value.panY || 0}px, 0) scale(${editorImagePreview.value.zoom})`,
    transformOrigin: `${editorImagePreview.value.originX}% ${editorImagePreview.value.originY}%`,
  };
}

function startEditorImagePreviewPan(event) {
  if (editorImagePreview.value.zoom <= 1) {
    return;
  }

  event.currentTarget.setPointerCapture?.(event.pointerId);
  editorImagePreviewPanState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: editorImagePreview.value.panX || 0,
    baseY: editorImagePreview.value.panY || 0,
    moved: false,
  };
}

function moveEditorImagePreviewPan(event) {
  if (!editorImagePreviewPanState || editorImagePreviewPanState.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - editorImagePreviewPanState.startX;
  const deltaY = event.clientY - editorImagePreviewPanState.startY;
  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
    editorImagePreviewPanState.moved = true;
  }

  editorImagePreview.value = {
    ...editorImagePreview.value,
    panX: editorImagePreviewPanState.baseX + deltaX,
    panY: editorImagePreviewPanState.baseY + deltaY,
  };
}

function endEditorImagePreviewPan(event) {
  if (!editorImagePreviewPanState || editorImagePreviewPanState.pointerId !== event.pointerId) {
    return;
  }

  event.currentTarget.releasePointerCapture?.(event.pointerId);
}

function getPartName(partId) {
  if (!partId) {
    return 'No Part';
  }

  const part = parts.value.find((item) => sameId(item.partId, partId));
  const officialPart = officialPartByCode(partCode(part));
  if (officialPart) {
    return officialPart.name;
  }
  return part?.partName || `Part ${part?.partNumber || partId}`;
}

function getSubTypeName(subTypeId) {
  if (!subTypeId) {
    return 'No Type';
  }

  const subType = subTypes.value.find((item) => sameId(item.subTypeId, subTypeId));
  const part = parts.value.find((item) => sameId(item.partId, subType?.partId));
  const officialSubType = officialSubTypeByCode(partCode(part), subTypeCode(subType));
  if (officialSubType) {
    return officialSubType.name;
  }
  return subType?.subTypeName || `Type ${subTypeId}`;
}

function getQuestionPreview(question) {
  const text = question.stem || 'No stem';
  return text.length > 70 ? `${text.slice(0, 70)}...` : text;
}

function getQuestionMetaTags(question) {
  const subTypeName = getSubTypeName(question.subTypeId);
  return [
    subTypeName !== 'No Type' ? subTypeName : '',
    question.scoringSectionCode === 'ELA' ? 'ELA scoring' : question.scoringSectionCode === 'MATH' ? 'Math scoring' : '',
    shsatSkillTagLabel(question?.shsatSkillTag),
    getQuestionTypeLabel(question.questionType),
  ].filter(Boolean);
}

function isQuestionModified(question) {
  return modifiedQuestionIds.value.has(question.localId);
}

async function updatePart(part) {
  try {
    const saved = await savePart(part);
    Object.assign(part, saved);
    showNotice('Primary type updated.');
  } catch (error) {
    showNotice(error.message || 'Failed to update primary type.', 'error');
  }
}

function applyOfficialPartTemplate(code, target) {
  const officialType = officialPartByCode(code);
  if (!officialType || !target) {
    return;
  }
  target.partCode = officialType.code;
  target.partName = officialType.name;
  target.partIntro = officialType.intro;
}

async function createPart() {
  try {
    const saved = await savePart({
      ...newPart,
      partId: null,
      partNumber: parts.value.length + 1,
      displayOrder: parts.value.length + 1,
    });
    Object.assign(newPart, {
      partCode: '',
      partName: '',
      partIntro: '',
      questionRange: '',
      questionCount: 0,
    });
    showNotice(`Primary type "${saved.partName}" created.`);
  } catch (error) {
    showNotice(error.message || 'Failed to create primary type.', 'error');
  }
}

function applyOfficialSubTypeTemplate(code, target) {
  const selectedPart = parts.value.find((part) => sameId(part.partId, target?.partId));
  const officialType = officialSubTypeByCode(partCode(selectedPart), code);
  if (!officialType || !target) {
    return;
  }
  target.subTypeCode = officialType.code;
  target.subTypeName = officialType.name;
  target.subTypeIntro = officialType.intro;
}

async function deletePart(part) {
  if (isOfficialPart(part)) {
    showNotice(officialDeleteBlockMessage('part'), 'error');
    return;
  }
  const partSubTypeIds = new Set(subTypes.value
    .filter((subType) => sameId(subType.partId, part.partId))
    .map((subType) => String(subType.subTypeId)));
  const isInUse = questions.value.some((question) => sameId(question.partId, part.partId)
    || partSubTypeIds.has(String(question.subTypeId)))
    || materials.value.some((material) => sameId(material.partId, part.partId)
      || partSubTypeIds.has(String(material.subTypeId)))
    || subTypes.value.some((subType) => sameId(subType.partId, part.partId));
  if (isInUse) {
    showNotice('Move or delete this type’s questions, materials, and secondary types before deleting it.', 'error');
    return;
  }

  try {
    parts.value = parts.value.filter((item) => !sameId(item.partId, part.partId));
    subTypes.value = subTypes.value.filter((item) => !sameId(item.partId, part.partId));
    markStructureDirty('part', part.partId);
    showNotice('Primary type deleted.');
  } catch (error) {
    showNotice(error.message || 'Failed to delete primary type.', 'error');
  }
}

async function updateSubType(subType) {
  try {
    const saved = await saveSubType(subType);
    Object.assign(subType, saved);
    showNotice('Secondary type updated.');
  } catch (error) {
    showNotice(error.message || 'Failed to update secondary type.', 'error');
  }
}

async function createSubType() {
  try {
    const saved = await saveSubType({
      ...newSubType,
      subTypeId: null,
      displayOrder: subTypes.value.length + 1,
    });
    Object.assign(newSubType, {
      partId: '',
      subTypeCode: '',
      subTypeName: '',
      subTypeIntro: '',
      questionRange: '',
      questionCount: 0,
    });
    showNotice(`Secondary type "${saved.subTypeName}" created.`);
  } catch (error) {
    showNotice(error.message || 'Failed to create secondary type.', 'error');
  }
}

async function deleteSubType(subType) {
  if (isOfficialSubType(subType)) {
    showNotice(officialDeleteBlockMessage('subType'), 'error');
    return;
  }
  const isInUse = questions.value.some((question) => sameId(question.subTypeId, subType.subTypeId))
    || materials.value.some((material) => sameId(material.subTypeId, subType.subTypeId));
  if (isInUse) {
    showNotice('Move or delete this type’s questions and materials before deleting it.', 'error');
    return;
  }

  try {
    subTypes.value = subTypes.value.filter((item) => !sameId(item.subTypeId, subType.subTypeId));
    markStructureDirty('subType', subType.subTypeId);
    showNotice('Secondary type deleted.');
  } catch (error) {
    showNotice(error.message || 'Failed to delete secondary type.', 'error');
  }
}

watch(paperId, (nextPaperId, previousPaperId) => {
  if (nextPaperId && nextPaperId !== previousPaperId) {
    loadedPaperId.value = null;
    recentlyImportedQuestionIds.value = new Set();
    loadPaper();
  }
});

watch(selectedQuestionId, () => {
  if (loadedPaperId.value !== String(paperId.value)) return;
  const question = currentQuestion.value;
  writeEditorSelection('shsat', paperId.value, question ? {
    questionId: question.questionId ? String(question.questionId) : null,
    localId: question.localId,
    questionNumber: question.questionNumber,
  } : null);
});

watch(
  () => [selectedQuestionId.value, currentQuestion.value?.materialType],
  () => {
    syncSkillTagMenuDraft();
    closeShsatSkillTagMenu();
    if (currentQuestion.value?.materialType === 'text') {
      textMaterialPreviewOpen.value = true;
    }
  }
);

onMounted(() => {
  loadPaper();
  document.addEventListener('pointerdown', handleDocumentPointerDown, true);
});
onBeforeUnmount(() => {
  closeNotice();
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
});
</script>

<template>
  <AdminLayout>
    <section class="paper-edit page-shell">
      <Teleport to="body">
        <div v-if="noticeMessage" class="notice" :class="`notice--${noticeType}`" role="status" aria-live="polite">
          <div>
            <strong>{{ noticeType === 'success' ? 'Saved' : 'Notice' }}</strong>
            <p>{{ noticeMessage }}</p>
          </div>
          <button type="button" aria-label="Close notification" @click="closeNotice">&times;</button>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="showImportQuestionsModal" class="import-questions-backdrop" @click.self="!importingQuestions && (showImportQuestionsModal = false)">
          <section class="import-questions-dialog" role="dialog" aria-modal="true" aria-labelledby="import-questions-title">
            <header class="import-questions-header">
              <div>
                <p class="import-questions-eyebrow">BUILD FROM EXAM DATA</p>
                <h2 id="import-questions-title">Import questions</h2>
                <p>Choose questions using student performance, then add them to {{ paper?.paperName }}.</p>
              </div>
              <button class="modal-card__close" type="button" aria-label="Close" :disabled="importingQuestions" @click="showImportQuestionsModal = false">&times;</button>
            </header>

            <div class="import-source-toolbar">
              <label class="import-source-select">
                <span>Published exam</span>
                <select :value="importExamId" :disabled="loadingImportExams || loadingImportAnalytics || importingQuestions" @change="selectImportSourceExam($event.target.value)">
                  <option value="">Choose an exam</option>
                  <option v-for="exam in importExams" :key="exam.examId" :value="exam.examId">
                    {{ exam.examTitle }} · {{ importPaperNames[exam.paperId] || 'Paper' }} · {{ formatImportExamDate(exam.publishedAt || exam.startTime) }}
                  </option>
                </select>
              </label>
              <label class="import-type-select">
                <span>Question type</span>
                <select v-model="importQuestionTypeFilter" :disabled="loadingImportAnalytics || importQuestionTypes.length === 0">
                  <option value="all">All types</option>
                  <option v-for="type in importQuestionTypes" :key="type" :value="type">{{ getQuestionTypeLabel(type) }}</option>
                </select>
              </label>
            </div>

            <div class="import-questions-filters" role="group" aria-label="Filter questions by accuracy">
              <button v-for="filter in [
                { id: 'all', label: 'All questions' },
                { id: 'low', label: 'Below 50%' },
                { id: 'medium', label: '50% to <75%' },
                { id: 'high', label: '75%+' },
                { id: 'no-data', label: 'No answers' },
              ]" :key="filter.id" type="button" :class="{ active: importAnalyticsFilter === filter.id }" @click="importAnalyticsFilter = filter.id">
                {{ filter.label }}
              </button>
            </div>

            <p v-if="importQuestionsError" class="import-questions-error" role="alert">{{ importQuestionsError }}</p>

            <div v-if="loadingImportExams || loadingImportAnalytics" class="import-questions-loading">Loading exam questions...</div>
            <div v-else-if="importExams.length === 0" class="import-questions-empty">No published exams are available.</div>
            <div v-else-if="importAnalytics.length === 0" class="import-questions-empty">This exam has no question performance data.</div>
            <div v-else class="import-questions-workspace">
              <section class="import-question-list" aria-label="Questions from selected exam">
                <label v-if="visibleImportAnalytics.length > 0" class="import-question-list__select-all">
                  <input
                    type="checkbox"
                    :checked="allVisibleImportQuestionsSelected"
                    :indeterminate="selectedVisibleImportQuestionCount > 0 && !allVisibleImportQuestionsSelected"
                    :disabled="importingQuestions"
                    aria-label="Select all visible questions"
                    @change="toggleAllVisibleImportQuestions"
                  />
                  <span>Select all visible ({{ visibleImportAnalytics.length }})</span>
                </label>
                <section v-for="group in visibleImportAnalyticsGroups" :key="group.code" class="import-question-group">
                  <button
                    class="import-question-group__heading"
                    type="button"
                    :aria-expanded="!collapsedImportGroupCodes.has(group.code)"
                    :aria-controls="`import-question-group-rows-${group.code}`"
                    @click="toggleImportQuestionGroup(group.code)"
                  >
                    <strong>{{ group.label }}</strong>
                    <span class="import-question-group__count">{{ group.questions.length }}</span>
                    <span class="import-question-group__chevron" aria-hidden="true"></span>
                  </button>
                  <div
                    :id="`import-question-group-rows-${group.code}`"
                    v-show="!collapsedImportGroupCodes.has(group.code)"
                  >
                    <template v-for="entry in group.entries" :key="entry.key">
                      <div v-if="entry.material" class="import-material-group__heading">
                        <span>{{ entry.title }}</span>
                        <small>{{ entry.questions.length }} questions</small>
                      </div>
                      <article
                        v-for="row in entry.questions"
                        :key="row.questionNumber"
                        class="import-question-row"
                        :class="{ selected: previewImportQuestionNumber === Number(row.questionNumber), checked: selectedImportQuestionNumbers.includes(Number(row.questionNumber)) }"
                      >
                        <label class="import-question-select">
                          <input
                            type="checkbox"
                            :checked="selectedImportQuestionNumbers.includes(Number(row.questionNumber))"
                            :aria-label="`Select question ${row.questionNumber}`"
                            @change="toggleImportQuestion(row.questionNumber)"
                          />
                        </label>
                        <button class="import-question-row__preview" type="button" @click="previewImportQuestionDetails(row.questionNumber)">
                          <span class="import-question-row__main">
                            <strong>Q{{ row.questionNumber }} <small>{{ getQuestionTypeLabel(row.questionType) }}</small></strong>
                            <span>{{ row.correctCount || 0 }} / {{ row.attemptedCount || 0 }} answered · {{ row.wrongCount || 0 }} incorrect</span>
                            <span>{{ formatImportDuration(row.averageTimeSpent) }}</span>
                          </span>
                          <span class="import-accuracy" :class="{
                            'import-accuracy--low': row.accuracy !== null && row.accuracy !== undefined && Number(row.accuracy) < 50,
                            'import-accuracy--medium': row.accuracy !== null && row.accuracy !== undefined && Number(row.accuracy) >= 50 && Number(row.accuracy) < 75,
                            'import-accuracy--high': row.accuracy !== null && row.accuracy !== undefined && Number(row.accuracy) >= 75,
                          }">{{ formatImportAccuracy(row.accuracy) }}</span>
                        </button>
                      </article>
                    </template>
                  </div>
                </section>
                <p v-if="visibleImportAnalytics.length === 0" class="import-questions-empty">No questions match this filter.</p>
              </section>

              <section class="import-question-preview" aria-label="Question preview">
                <div v-if="loadingImportDetail" class="import-questions-loading">Loading question preview...</div>
                <div v-else-if="previewImportQuestion" class="import-question-preview__content">
                  <div class="import-question-preview__heading">
                    <strong>Question {{ previewImportQuestionNumber }}</strong>
                    <span>{{ getQuestionTypeLabel(previewImportQuestion.questionType) }}</span>
                  </div>
                  <MonitorQuestionDetail
                    :question="previewImportQuestion"
                    :question-number="Number(previewImportQuestionNumber)"
                    @preview-image="previewImportedImage"
                  />
                </div>
                <div v-else class="import-questions-empty">Select a question to preview it.</div>
              </section>
            </div>

            <footer class="import-questions-footer">
              <p>{{ selectedImportQuestionCount }} selected<span v-if="selectedImportExam"> · {{ selectedImportExam.examTitle }}</span></p>
              <div>
                <AppButton variant="ghost" :disabled="importingQuestions" @click="showImportQuestionsModal = false">Cancel</AppButton>
                <AppButton :disabled="importingQuestions || selectedImportQuestionCount === 0 || loadingImportExams || loadingImportAnalytics" @click="confirmImportQuestions">
                  {{ importingQuestions ? 'Adding questions...' : `Add ${selectedImportQuestionCount} questions` }}
                </AppButton>
              </div>
            </footer>
          </section>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="showLeaveConfirmModal" class="modal-backdrop" @click.self="showLeaveConfirmModal = false">
          <section class="modal-card">
            <header class="modal-card__header">
              <div>
                <h3>Leave Paper Editor?</h3>
                <p>You have unsaved changes. Leaving now will discard them.</p>
              </div>
              <button class="modal-card__close" type="button" @click="showLeaveConfirmModal = false">&times;</button>
            </header>
            <div class="modal-actions">
              <AppButton variant="ghost" @click="showLeaveConfirmModal = false">Stay</AppButton>
              <AppButton variant="secondary" @click="discardChangesAndGoBack">Leave Without Saving</AppButton>
            </div>
          </section>
        </div>

        <div v-if="questionPendingDeletion" class="modal-backdrop" @click.self="cancelDeleteQuestion">
          <section class="modal-card">
            <header class="modal-card__header">
              <div>
                <h3>Delete Question?</h3>
                <p>
                  Q{{ questionPendingDeletion.questionNumber || '-' }} will be removed and the remaining
                  questions will be renumbered. This cannot be undone.
                </p>
              </div>
              <button class="modal-card__close" type="button" @click="cancelDeleteQuestion">&times;</button>
            </header>
            <div class="modal-actions">
              <AppButton variant="ghost" :disabled="deletingQuestion" @click="cancelDeleteQuestion">Cancel</AppButton>
              <AppButton variant="secondary" :disabled="deletingQuestion" @click="confirmDeleteQuestion">
                {{ deletingQuestion ? 'Deleting...' : 'Delete Question' }}
              </AppButton>
            </div>
          </section>
        </div>

        <div v-if="showMaterialScreenshotPasteModal" class="modal-backdrop" @click.self="closeTextMaterialScreenshotPasteModal">
          <section class="modal-card material-screenshot-modal" role="dialog" aria-modal="true" aria-labelledby="material-screenshot-title">
            <header class="modal-card__header">
              <div>
                <h3 id="material-screenshot-title">Insert Screenshot</h3>
                <p>{{ screenshotPasteDescription }}</p>
              </div>
              <button class="modal-card__close" type="button" aria-label="Close screenshot insert" @click="closeTextMaterialScreenshotPasteModal">&times;</button>
            </header>

            <div
              ref="materialScreenshotPasteZone"
              class="material-screenshot-paste-zone"
              tabindex="0"
              aria-label="Paste screenshot here"
              @paste="handleTextMaterialScreenshotPaste"
            >
              <strong>{{ screenshotPasteUploading ? 'Uploading image...' : 'Paste Screenshot Here' }}</strong>
              <span>Press Command+V or Ctrl+V after copying a screenshot.</span>
            </div>

            <p
              v-if="materialScreenshotPasteMessage"
              class="material-screenshot-message"
              :class="`material-screenshot-message--${materialScreenshotPasteMessageType}`"
              :role="materialScreenshotPasteMessageType === 'error' ? 'alert' : 'status'"
            >
              {{ materialScreenshotPasteMessage }}
            </p>

            <div class="modal-actions material-screenshot-actions">
              <input
                ref="materialBodyImageInput"
                class="material-body-image-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                @change="uploadTextMaterialBodyImage($event, currentQuestion)"
              />
              <button class="text-button" type="button" :disabled="screenshotPasteUploading" @click="triggerMaterialBodyImageFilePicker">
                Choose Image File
              </button>
              <button class="text-button" type="button" :disabled="screenshotPasteUploading" @click="closeTextMaterialScreenshotPasteModal">
                Cancel
              </button>
            </div>
          </section>
        </div>

        <div
          v-if="editorImagePreview.open"
          class="editor-image-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          @click.self="closeEditorImagePreview"
        >
          <section class="editor-image-preview-dialog">
            <header class="editor-image-preview-dialog__header">
              <div>
                <strong>{{ editorImagePreview.title }}</strong>
                <span>Click the image to zoom into that area.</span>
              </div>
              <div class="editor-image-preview-dialog__actions">
                <button type="button" @click="increaseEditorImagePreviewZoom()">Zoom In</button>
                <button type="button" @click="resetEditorImagePreviewZoom">Reset</button>
                <button type="button" aria-label="Close image preview" @click="closeEditorImagePreview">Close</button>
              </div>
            </header>
            <div class="editor-image-preview-dialog__viewport">
              <img
                :class="{ zoomed: editorImagePreview.zoom > 1, 'is-panning': editorImagePreviewPanState?.moved }"
                :src="editorImagePreview.src"
                :alt="editorImagePreview.title"
                :style="editorImagePreviewTransformStyle()"
                @pointerdown="startEditorImagePreviewPan"
                @pointermove="moveEditorImagePreviewPan"
                @pointerup="endEditorImagePreviewPan"
                @pointercancel="endEditorImagePreviewPan"
                @click.stop="zoomEditorImagePreview"
              />
            </div>
          </section>
        </div>
      </Teleport>

      <header class="edit-header">
        <div class="edit-header__main">
          <AppButton variant="ghost" @click="goBack">← Back to Paper Management</AppButton>
          <div class="edit-header__identity">
            <p class="page-subtitle">Paper Editor</p>
            <h1 class="page-title">{{ paper?.paperName || 'Paper Editor' }}</h1>
            <label class="scoring-rule-field">
              <span>Scoring rule</span>
              <select v-model="scoringProfileCode" :disabled="saving">
                <option v-for="rule in scoringRuleOptions" :key="rule.value" :value="rule.value">
                  {{ rule.label }}
                </option>
              </select>
            </label>
          </div>
        </div>
        <div class="edit-header__actions">
          <AppButton variant="secondary" :disabled="!paper" @click="previewPaper">
            Preview
          </AppButton>
          <AppButton :disabled="!hasChanges || saving" @click="saveChanges">
            {{ saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes' }}
          </AppButton>
        </div>
      </header>

      <div v-if="loading" class="state-card">Loading paper data...</div>
      <div v-else-if="errorMessage" class="state-card state-card--error">
        <p>{{ errorMessage }}</p>
        <AppButton variant="secondary" @click="loadPaper">Retry</AppButton>
      </div>

      <template v-else-if="paper">
        <div class="workspace">
          <aside class="question-sidebar">
            <div class="sidebar-header">
              <div>
                <h2>Questions ({{ questions.length }})</h2>
                <p>{{ parts.length }} parts · {{ subTypes.length }} types</p>
              </div>
              <div class="sidebar-actions">
                <AppButton variant="secondary" @click="openImportQuestions">Import from Exam</AppButton>
                <AppButton variant="secondary" @click="showPartsModal = true">Parts</AppButton>
                <AppButton variant="secondary" @click="showTypesModal = true">Types</AppButton>
              </div>
            </div>

            <div ref="questionListElement" class="question-list">
              <p class="question-list-hint">
                Drag within a section. Passage sets stay together.
              </p>
              <section v-for="group in questionSidebarGroups" :key="group.key" class="subject-group">
                <header class="subject-group__header">
                  <div>
                    <h3>{{ group.name }}</h3>
                    <p>{{ group.questions.length }} questions</p>
                  </div>
                  <button
                    v-if="group.code"
                    class="scoped-add-button"
                    type="button"
                    @click="addQuestion({ partCode: group.code, partId: group.partId })"
                  >
                    Add Question
                  </button>
                </header>

                <template v-for="item in group.items" :key="item.key">
                  <article v-if="item.kind === 'passageSet'" class="passage-set">
                    <header class="passage-set__header">
                      <div>
                        <strong>{{ passageSetTitle(item) }}</strong>
                        <small>{{ questionRangeLabel(item) }} · {{ item.questions.length }} questions</small>
                      </div>
                      <button
                        class="scoped-add-button scoped-add-button--compact"
                        type="button"
                        @click="addQuestion({ partCode: group.code, partId: group.partId, materialId: item.materialId, afterQuestions: item.questions })"
                      >
                        Add Question
                      </button>
                    </header>
                    <button
                      v-for="question in item.questions"
                      :key="question.localId"
                      class="question-item question-item--nested"
                      :data-question-id="question.questionId"
                      :class="[
                        {
                          'question-item--active': question.localId === selectedQuestionId,
                          'question-item--dirty': isQuestionModified(question) || questionOrderDirty,
                          'question-item--dragging': isQuestionDragging(question),
                          'question-item--recently-imported': recentlyImportedQuestionIds.has(String(question.questionId)),
                        },
                        questionDropClass(question),
                      ]"
                      type="button"
                      draggable="true"
                      @click="selectQuestion(question)"
                      @dragstart="startQuestionDrag($event, question)"
                      @dragover="updateQuestionDragTarget($event, question)"
                      @dragleave="dragOverQuestionId === question.localId && (dragOverQuestionId = null)"
                      @drop="dropQuestion($event, question)"
                      @dragend="clearQuestionDragState"
                    >
                      <span
                        v-if="recentlyImportedQuestionIds.has(String(question.questionId))"
                        class="question-import-indicator"
                        role="img"
                        aria-label="Recently imported"
                        title="Recently imported"
                      ></span>
                      <span class="question-drag-handle" aria-hidden="true">⋮⋮</span>
                      <strong>Q{{ question.questionNumber || '-' }}</strong>
                      <span>{{ getQuestionPreview(question) }}</span>
                      <small>
                        <span v-for="tag in getQuestionMetaTags(question)" :key="tag" class="question-meta-tag">{{ tag }}</span>
                      </small>
                    </button>
                  </article>

                  <div v-else class="standalone-item">
                    <button
                      class="question-item"
                      :data-question-id="item.question.questionId"
                      :class="[
                        {
                          'question-item--active': item.question.localId === selectedQuestionId,
                          'question-item--dirty': isQuestionModified(item.question) || questionOrderDirty,
                          'question-item--dragging': isQuestionDragging(item.question),
                          'question-item--recently-imported': recentlyImportedQuestionIds.has(String(item.question.questionId)),
                        },
                        questionDropClass(item.question),
                      ]"
                      type="button"
                      draggable="true"
                      @click="selectQuestion(item.question)"
                      @dragstart="startQuestionDrag($event, item.question)"
                      @dragover="updateQuestionDragTarget($event, item.question)"
                      @dragleave="dragOverQuestionId === item.question.localId && (dragOverQuestionId = null)"
                      @drop="dropQuestion($event, item.question)"
                      @dragend="clearQuestionDragState"
                    >
                      <span
                        v-if="recentlyImportedQuestionIds.has(String(item.question.questionId))"
                        class="question-import-indicator"
                        role="img"
                        aria-label="Recently imported"
                        title="Recently imported"
                      ></span>
                      <span class="question-drag-handle" aria-hidden="true">⋮⋮</span>
                      <strong>Q{{ item.question.questionNumber || '-' }}</strong>
                      <span>{{ getQuestionPreview(item.question) }}</span>
                      <small>
                        <span v-for="tag in getQuestionMetaTags(item.question)" :key="tag" class="question-meta-tag">{{ tag }}</span>
                      </small>
                    </button>
                    <button
                      v-if="group.code"
                      class="scoped-add-button scoped-add-button--inline"
                      type="button"
                      title="Add question after this item"
                      aria-label="Add question after this item"
                      @click="addQuestion({ partCode: group.code, partId: group.partId, sourceQuestion: item.question })"
                    >
                      +
                    </button>
                  </div>
                </template>

                <p v-if="group.items.length === 0" class="empty-inline">No questions in this section.</p>
              </section>
            </div>
          </aside>

          <main class="question-editor">
            <AppCard v-if="currentQuestion" :title="currentQuestionEditorTitle" :subtitle="currentQuestionEditorSubtitle">
              <div class="semantic-editor-body">
              <div class="meta-toolbar" aria-label="Question metadata">
                <label class="meta-field meta-field--type">
                  <span>Question Type</span>
                  <select v-model="currentQuestion.questionType" class="meta-control" @change="handleQuestionTypeChange(currentQuestion)">
                    <option v-for="type in QUESTION_TYPES" :key="type.value" :value="type.value">
                      {{ type.label }}
                    </option>
                  </select>
                </label>
                <label class="meta-field">
                  <span>Primary Type</span>
                  <select :value="selectedPrimaryTypeValue(currentQuestion)" class="meta-control" @change="handlePrimaryTypeChange($event, currentQuestion)">
                    <option value="">No Primary Type</option>
                    <option v-for="option in primaryTypeOptions()" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="meta-field">
                  <span>Secondary Type</span>
                  <select
                    :value="selectedSecondaryTypeValue(currentQuestion)"
                    class="meta-control"
                    :disabled="!currentQuestion.partId"
                    @change="handleSecondaryTypeChange($event, currentQuestion)"
                  >
                    <option value="">No Secondary Type</option>
                    <option v-for="option in secondaryTypeOptions(currentQuestion)" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
                <label class="meta-field meta-field--small">
                  <span>Difficulty</span>
                  <select v-model="currentQuestion.difficulty" class="meta-control" @change="markQuestionDirty()">
                    <option value="">No Difficulty</option>
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                  </select>
                </label>
              </div>

              <div ref="skillTagMenuRoot" class="skill-tag-editor" aria-label="SHSAT knowledge tag">
                <div class="skill-tag-editor__header">
                  <div>
                    <h3>SHSAT Tag</h3>
                    <p>Assign the official skill tested by this question.</p>
                  </div>
                  <button
                    v-if="currentQuestion.shsatSkillTag?.skillCode"
                    class="skill-tag-editor__clear"
                    type="button"
                    @click="clearShsatSkillTag(currentQuestion)"
                  >
                    Clear
                  </button>
                </div>
                <div class="skill-tag-cascade">
                  <button
                    class="skill-tag-trigger"
                    :class="{ 'skill-tag-trigger--empty': !currentShsatSkillTagLabel }"
                    type="button"
                    aria-haspopup="menu"
                    :aria-expanded="skillTagMenuOpen"
                    @click.stop="toggleShsatSkillTagMenu(currentQuestion)"
                  >
                    <span>{{ currentShsatSkillTagLabel || 'Select SHSAT tag' }}</span>
                    <span class="skill-tag-trigger__caret" aria-hidden="true">⌄</span>
                  </button>

                  <div v-if="skillTagMenuOpen" class="skill-tag-menu" role="menu">
                    <div class="skill-tag-menu__column">
                      <button
                        v-for="subject in shsatTagSubjectOptions()"
                        :key="subject.code"
                        class="skill-tag-menu__item"
                        :class="{ 'skill-tag-menu__item--active': skillTagMenuDraft.subjectCode === subject.code }"
                        type="button"
                        role="menuitem"
                        @mouseenter="previewShsatTagSubject(subject)"
                        @focus="previewShsatTagSubject(subject)"
                        @click="previewShsatTagSubject(subject)"
                      >
                        <span>{{ subject.name }}</span>
                        <span class="skill-tag-menu__arrow" aria-hidden="true">&rsaquo;</span>
                      </button>
                    </div>
                    <div class="skill-tag-menu__column">
                      <button
                        v-for="domain in skillTagMenuDomains"
                        :key="domain.code"
                        class="skill-tag-menu__item"
                        :class="{ 'skill-tag-menu__item--active': skillTagMenuDraft.domainCode === domain.code }"
                        type="button"
                        role="menuitem"
                        @mouseenter="previewShsatTagDomain(domain)"
                        @focus="previewShsatTagDomain(domain)"
                        @click="previewShsatTagDomain(domain)"
                      >
                        <span>{{ domain.name }}</span>
                        <span class="skill-tag-menu__arrow" aria-hidden="true">&rsaquo;</span>
                      </button>
                    </div>
                    <div class="skill-tag-menu__column">
                      <button
                        v-for="skill in skillTagMenuSkills"
                        :key="skill.code"
                        class="skill-tag-menu__item"
                        :class="{ 'skill-tag-menu__item--selected': currentQuestion.shsatSkillTag?.skillCode === skill.code }"
                        type="button"
                        role="menuitem"
                        @click="handleShsatTagSkillSelect(currentQuestion, skill.code)"
                      >
                        <span class="skill-tag-menu__check" aria-hidden="true">
                          {{ currentQuestion.shsatSkillTag?.skillCode === skill.code ? '✓' : '' }}
                        </span>
                        <span>{{ skill.name }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <section
                class="question-edit-block material-editor"
                :class="{
                  'material-editor--empty': currentQuestion.materialType === 'none',
                  'material-editor--compact': isSolutionSetQuestion(currentQuestion),
                }"
              >
                <div class="section-title">
                  <div>
                    <h3>Material</h3>
                    <p class="section-note">
                      {{ isSolutionSetQuestion(currentQuestion)
                        ? 'Optional support material. Keep the number line editor as the primary workspace.'
                        : 'Attach optional text or image material. Reusing the same material across adjacent questions creates a reading group.' }}
                    </p>
                  </div>
                  <label class="material-type">
                    <span>Material Type</span>
                    <select v-model="currentQuestion.materialType" class="meta-control" @change="handleMaterialTypeChange(currentQuestion)">
                      <option value="none">None</option>
                      <option value="text">Text Material</option>
                      <option value="image">Image Material</option>
                    </select>
                  </label>
                </div>

                <p v-if="currentQuestion.materialType === 'none'" class="empty-inline">
                  No material linked. Choose Text Material or Image Material only when this question needs a shared passage or image.
                </p>

                <template v-else>
                  <div class="material-topline">
                    <label class="form-field">
                      <span class="form-label">Select Material</span>
                      <select v-model="currentQuestion.materialId" class="form-input" @change="handleMaterialSelection(currentQuestion)">
                        <option :value="null">No Material</option>
                        <option v-for="material in materialOptionsForType(currentQuestion.materialType)" :key="material.materialId" :value="material.materialId">
                          {{ material.materialTitle || `Material ${material.materialId}` }} · {{ materialUsageLabel(material.materialId) }}
                        </option>
                      </select>
                      <span v-if="currentQuestion.materialId" class="material-usage-note">
                        {{ currentMaterialUsageText(currentQuestion) }}
                      </span>
                    </label>
                    <div class="material-actions">
                      <button class="text-button" type="button" @click="startNewMaterialDraft(currentQuestion)">New</button>
                      <button class="text-button text-button--danger" type="button" @click="clearCurrentMaterial(currentQuestion)">Clear</button>
                    </div>
                  </div>

                  <div class="material-form-grid">
                    <label class="form-field">
                      <span class="form-label">Material Title</span>
                      <input v-model="currentQuestion.materialTitle" class="form-input" placeholder="Untitled material" @input="updateMaterialDraft(currentQuestion)" />
                    </label>
                    <label class="form-field">
                      <span class="form-label">Material Category</span>
                      <input v-model="currentQuestion.materialCategory" class="form-input" placeholder="Reading Passage" @input="updateMaterialDraft(currentQuestion)" />
                    </label>
                  </div>

                  <div v-if="currentQuestion.materialType === 'text'" class="structured-material-editor" aria-label="Text material editor">
                    <div class="structured-material-editor__header">
                      <span class="form-label">Passage Content</span>
                      <p>Enter the text students will see in the material area.</p>
                    </div>
                    <label class="form-field form-field--wide">
                      <span class="form-label">Introduction</span>
                      <textarea
                        class="form-input"
                        rows="3"
                        :value="currentTextMaterialFields.introduction"
                        placeholder="Enter introductory instructions or context"
                        @input="updateTextMaterialField(currentQuestion, 'introduction', $event.target.value)"
                      ></textarea>
                    </label>
                    <label class="form-field">
                      <span class="form-label">Passage Title</span>
                      <input
                        class="form-input"
                        :value="currentTextMaterialFields.passageTitle"
                        placeholder="Enter passage title"
                        @input="updateTextMaterialField(currentQuestion, 'passageTitle', $event.target.value)"
                      />
                    </label>
                    <label class="form-field">
                      <span class="form-label">Author</span>
                      <input
                        class="form-input"
                        :value="currentTextMaterialFields.author"
                        placeholder="Enter author"
                        @input="updateTextMaterialField(currentQuestion, 'author', $event.target.value)"
                      />
                    </label>
                    <div class="form-field form-field--wide formula-editor">
                      <span class="formula-editor__header">
                        <span class="form-label">Body</span>
                        <span class="formula-editor__actions">
                          <button class="formula-insert-button" type="button" @click.prevent="insertMaterialFormula(currentQuestion, 'inline')">Insert Formula</button>
                          <button class="formula-insert-button" type="button" @click.prevent="insertMaterialFormula(currentQuestion, 'block')">Insert Block</button>
                          <button
                            class="formula-insert-button"
                            type="button"
                            :disabled="uploadingMaterialBodyImage"
                            @click.prevent="openTextMaterialImageInsert(currentQuestion)"
                          >
                            {{ uploadingMaterialBodyImage ? 'Uploading...' : 'Insert Screenshot' }}
                          </button>
                        </span>
                      </span>
                      <textarea
                        ref="materialContentTextarea"
                        class="form-input"
                        rows="8"
                        :value="currentTextMaterialFields.body"
                        placeholder="Enter passage body here..."
                        @input="updateTextMaterialField(currentQuestion, 'body', $event.target.value)"
                      ></textarea>
                    </div>
                    <div class="structured-material-preview" aria-label="Material content preview">
                      <div class="structured-material-preview__topline">
                        <span class="formula-preview__label">Preview</span>
                        <button
                          class="text-button"
                          type="button"
                          :aria-expanded="textMaterialPreviewOpen"
                          aria-controls="text-material-preview-content"
                          @click="textMaterialPreviewOpen = !textMaterialPreviewOpen"
                        >
                          {{ textMaterialPreviewToggleLabel }}
                        </button>
                      </div>
                      <div v-if="textMaterialPreviewOpen" id="text-material-preview-content" class="structured-material-preview__content">
                        <template v-if="currentTextMaterialPreview.hasIntroduction || currentTextMaterialPreview.hasHeader || currentTextMaterialPreview.hasBody">
                          <div v-if="currentTextMaterialPreview.hasIntroduction" class="structured-material-preview__introduction">
                            <SafeMarkdownText :content="currentTextMaterialPreview.introduction" />
                          </div>
                          <div v-if="currentTextMaterialPreview.hasHeader" class="structured-material-preview__header">
                            <p
                              v-for="line in currentTextMaterialPreview.headerLines"
                              :key="line.key"
                              :class="`structured-material-preview__${line.role}`"
                            >
                              {{ line.text }}
                            </p>
                          </div>
                          <div v-if="currentTextMaterialPreview.bodyItems.length" class="structured-material-preview__body">
                            <div
                              v-for="item in currentTextMaterialPreview.bodyItems"
                              :key="item.key"
                              class="structured-material-preview__body-line"
                              :class="{
                                'structured-material-preview__body-line--empty': item.type === 'text' && item.isEmpty,
                                'structured-material-preview__body-line--image': item.type === 'image',
                              }"
                            >
                              <template v-if="item.type === 'image'">
                                <div class="structured-material-preview__image-block">
                                  <button
                                    class="structured-material-preview__image-button"
                                    type="button"
                                    title="View material image"
                                    @click="openTextMaterialImagePreview(item)"
                                  >
                                    <img :src="item.src" :alt="item.alt" />
                                  </button>
                                  <div class="structured-material-preview__image-actions">
                                    <span>Image block</span>
                                    <button
                                      class="text-button text-button--danger"
                                      type="button"
                                      @click="removeTextMaterialImageBlock(currentQuestion, item)"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              </template>
                              <template v-else>
                                <SafeMarkdownText v-if="!item.isEmpty" :content="item.text" />
                                <span v-else aria-hidden="true">&nbsp;</span>
                              </template>
                            </div>
                          </div>
                        </template>
                        <span v-else class="formula-preview__empty">Nothing to preview.</span>
                      </div>
                    </div>
                  </div>

                  <template v-else-if="currentQuestion.materialType === 'image'">
                      <div class="image-upload-panel">
                        <div>
                          <span class="form-label">Material Image</span>
                        <p>Upload JPG, PNG, WebP, or GIF. The server stores the file and saves its path in the material record.</p>
                        </div>
                        <label class="image-upload-button">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            :disabled="uploadingImageQuestionId === currentQuestion.localId"
                            @change="uploadImageMaterial($event, currentQuestion)"
                          />
                          <span>{{ uploadingImageQuestionId === currentQuestion.localId ? 'Uploading...' : 'Upload Image' }}</span>
                        </label>
                        <span v-if="currentQuestion.imageUploadName" class="image-upload-name">{{ currentQuestion.imageUploadName }}</span>
                      </div>
                      <div class="image-preview-panel" :class="{ 'image-preview-panel--compact': isSolutionSetQuestion(currentQuestion) }">
                        <div class="image-preview-panel__header">
                          <span>Image Preview</span>
                          <button v-if="currentQuestion.imageUrl" class="text-button text-button--danger" type="button" @click="clearImageDraft(currentQuestion)">
                            Clear Image
                          </button>
                        </div>
                        <button
                          v-if="currentQuestion.imageUrl"
                          class="image-preview-button"
                          type="button"
                          title="Click to enlarge image"
                          @click="openEditorImagePreview(currentQuestion)"
                        >
                          <img :src="currentQuestion.imageUrl" alt="Material preview" />
                        </button>
                        <p v-else class="empty-inline">No image uploaded yet.</p>
                      </div>
                  </template>
                </template>
              </section>

              <section class="question-edit-block">
                <div class="section-title">
                  <div>
                    <h3>Stem</h3>
                    <p class="section-note">Write the prompt shown before the answer area.</p>
                  </div>
                  <div class="formula-editor__actions">
                    <button class="formula-insert-button" type="button" @click="insertStemFormula(currentQuestion, 'inline')">Insert Formula</button>
                    <button class="formula-insert-button" type="button" @click="insertStemFormula(currentQuestion, 'block')">Insert Block</button>
                    <button
                      class="formula-insert-button"
                      type="button"
                      :disabled="uploadingStemImage"
                      @click.prevent="openStemImageInsert(currentQuestion)"
                    >
                      {{ uploadingStemImage ? 'Uploading...' : 'Insert Screenshot' }}
                    </button>
                  </div>
                </div>
                <div class="form-field form-field--wide formula-editor">
                  <textarea ref="stemTextarea" v-model="currentQuestion.stem" class="form-input stem-input" rows="3" @input="markQuestionDirty()"></textarea>
                  <p class="stem-format-hint">
                    Use <code>**bold text**</code> for bold and <code>++underlined text++</code> for underlined text.
                  </p>
                  <div class="formula-preview stem-preview" aria-label="Stem preview">
                    <span class="formula-preview__label">Preview</span>
                    <div v-if="currentStemMixedContentPreview.hasContent" class="stem-preview__content">
                      <template v-for="block in currentStemMixedContentBlocks" :key="block.key">
                        <div v-if="block.type === MIXED_CONTENT_PART_TYPES.IMAGE" class="structured-material-preview__image-block stem-preview__image-block">
                          <button
                            class="structured-material-preview__image-button"
                            type="button"
                            title="View stem image"
                            @click="openStemImagePreview(block.item)"
                          >
                            <img :src="block.item.src" :alt="block.item.alt" />
                          </button>
                          <div class="structured-material-preview__image-actions">
                            <span>Image block</span>
                            <button
                              class="text-button text-button--danger"
                              type="button"
                              @click="removeStemImageBlock(currentQuestion, block.item)"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        <MixedContent v-else :items="block.items" text-mode="markdown" />
                      </template>
                    </div>
                    <span v-else class="formula-preview__empty">Nothing to preview.</span>
                  </div>
                </div>
              </section>

              <section class="question-edit-block editor-section">
                <div class="section-title">
                  <div>
                    <h3>Options / Answer Editor</h3>
                    <p class="section-note">Configure answer choices, interactions, and correct answers without writing JSON.</p>
                  </div>
                </div>

                <component
                  :is="currentQuestionTypeEditor"
                  v-if="currentQuestionTypeEditor"
                  :key="currentQuestion.localId"
                  :question="currentQuestion"
                  :paper-id="paperId"
                  @patch="applyQuestionTypePatch($event, currentQuestion)"
                  @dirty="markQuestionDirty(currentQuestion)"
                />

                <div v-else-if="isFillInBlankQuestion(currentQuestion)" class="type-editor-panel fill-blank-answer-editor">
                  <div class="subsection-title">
                    <div>
                      <strong>Accepted Answers</strong>
                      <p class="section-note">Students only enter one response. Any saved answer below will be accepted.</p>
                    </div>
                    <button class="text-button fill-blank-answer-editor__add" type="button" @click="addAcceptedAnswer(currentQuestion)">
                      <span aria-hidden="true">+</span>
                      Add Answer
                    </button>
                  </div>
                  <div class="fill-blank-answer-editor__list">
                    <div
                      v-for="(answer, index) in fillBlankAnswers(currentQuestion)"
                      :key="index"
                      class="fill-blank-answer-editor__row"
                    >
                      <label class="fill-blank-answer-editor__label" :for="`fill-answer-${currentQuestion.localId}-${index}`">
                        Answer {{ index + 1 }}
                      </label>
                      <input
                        :id="`fill-answer-${currentQuestion.localId}-${index}`"
                        class="form-input"
                        :class="{ 'form-input--warning': isDuplicateFillBlankAnswer(currentQuestion, answer) }"
                        :value="answer"
                        placeholder="Accepted answer"
                        @input="setAcceptedAnswer(currentQuestion, index, $event.target.value)"
                      />
                      <button class="icon-button" type="button" @click="removeAcceptedAnswer(currentQuestion, index)">Remove</button>
                      <p v-if="isDuplicateFillBlankAnswer(currentQuestion, answer)" class="field-warning">
                        Duplicate answers must be removed before saving.
                      </p>
                    </div>
                  </div>
                  <p class="section-note">Blank rows are ignored when saving. At least one non-empty accepted answer is required.</p>
                </div>

                <div v-else-if="currentQuestion.questionType === 'EQUATION_EDITOR'" class="type-editor-panel">
                  <div v-for="(answer, index) in acceptedAnswerRows(currentQuestion)" :key="index" class="inline-edit-row">
                    <input
                      class="form-input"
                      :value="answer"
                      placeholder="x=2"
                      @input="setAcceptedAnswer(currentQuestion, index, $event.target.value)"
                    />
                    <button class="icon-button" type="button" @click="removeAcceptedAnswer(currentQuestion, index)">Remove</button>
                  </div>
                  <button class="text-button" type="button" @click="addAcceptedAnswer(currentQuestion)">Add Accepted Answer</button>
                </div>

                <div v-else-if="isDragAndDrop(currentQuestion)" class="type-editor-panel">
                  <div class="dual-editor-grid">
                    <div>
                      <div class="subsection-title">
                        <strong>Items</strong>
                        <button class="text-button" type="button" @click="addDragItem(currentQuestion)">Add Item</button>
                      </div>
                      <div v-for="(item, index) in dragItems(currentQuestion)" :key="item.id" class="inline-edit-row">
                        <input v-model="item.id" class="form-input compact-input" placeholder="item1" @input="markQuestionDirty()" />
                        <input v-model="item.text" class="form-input" placeholder="Draggable item" @input="markQuestionDirty()" />
                        <button class="icon-button" type="button" @click="removeDragItem(currentQuestion, index)">Remove</button>
                      </div>
                    </div>
                    <div>
                      <div class="subsection-title">
                        <strong>Drop Zones</strong>
                        <button class="text-button" type="button" @click="addDropZone(currentQuestion)">Add Zone</button>
                      </div>
                      <div v-for="(zone, index) in dropZones(currentQuestion)" :key="zone.id" class="inline-edit-row">
                        <input v-model="zone.id" class="form-input compact-input" placeholder="zone1" @input="markQuestionDirty()" />
                        <input v-model="zone.label" class="form-input" placeholder="Zone label" @input="markQuestionDirty()" />
                        <button class="icon-button" type="button" @click="removeDropZone(currentQuestion, index)">Remove</button>
                      </div>
                    </div>
                  </div>
                  <div class="match-editor">
                    <strong>Correct Matching</strong>
                    <label v-for="item in dragItems(currentQuestion)" :key="`match-${item.id}`" class="inline-edit-row">
                      <span>{{ item.text || item.id }}</span>
                      <select class="form-input" :value="currentQuestion.correctAnswerData.matches?.[item.id] || ''" @change="setDragMatch(currentQuestion, item.id, $event.target.value)">
                        <option value="">Select target zone</option>
                        <option v-for="zone in dropZones(currentQuestion)" :key="zone.id" :value="zone.id">{{ zone.label || zone.id }}</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div v-else-if="isHotText(currentQuestion)" class="type-editor-panel">
                  <div v-for="(segment, index) in hotSegments(currentQuestion)" :key="segment.id" class="inline-edit-row">
                    <input v-model="segment.id" class="form-input compact-input" placeholder="seg1" @input="markQuestionDirty()" />
                    <input v-model="segment.text" class="form-input" placeholder="Selectable text" @input="markQuestionDirty()" />
                    <label class="checkbox-label">
                      <input type="checkbox" :checked="currentQuestion.correctAnswerData.selectedIds?.includes(segment.id)" @change="toggleHotTextAnswer(currentQuestion, segment.id)" />
                      Correct
                    </label>
                    <button class="icon-button" type="button" @click="removeHotSegment(currentQuestion, index)">Remove</button>
                  </div>
                  <button class="text-button" type="button" @click="addHotSegment(currentQuestion)">Add Segment</button>
                </div>

                <div v-else-if="isHotSpot(currentQuestion)" class="type-editor-panel">
                  <p class="section-note">Use image material above, then define the named clickable regions here.</p>
                  <div v-for="(region, index) in hotRegions(currentQuestion)" :key="region.id" class="inline-edit-row">
                    <input v-model="region.id" class="form-input compact-input" placeholder="region1" @input="markQuestionDirty()" />
                    <input v-model="region.label" class="form-input" placeholder="Region label" @input="markQuestionDirty()" />
                    <label class="checkbox-label">
                      <input type="checkbox" :checked="currentQuestion.correctAnswerData.regions?.includes(region.id)" @change="toggleHotRegionAnswer(currentQuestion, region.id)" />
                      Correct
                    </label>
                    <button class="icon-button" type="button" @click="removeHotRegion(currentQuestion, index)">Remove</button>
                  </div>
                  <button class="text-button" type="button" @click="addHotRegion(currentQuestion)">Add Region</button>
                </div>

              </section>
              </div>

              <div class="question-navigation">
                <AppButton variant="secondary" :disabled="currentQuestionIndex <= 0" @click="previousQuestion">← Previous</AppButton>
                <span>{{ currentQuestionIndex + 1 }} / {{ sortedQuestions.length }}</span>
                <AppButton variant="secondary" :disabled="currentQuestionIndex >= sortedQuestions.length - 1" @click="nextQuestion">Next →</AppButton>
                <button
                  class="delete-question-button"
                  type="button"
                  title="Delete this question"
                  @click="requestDeleteQuestion(currentQuestion)"
                >
                  Delete Question
                </button>
              </div>

              <p v-if="isQuestionModified(currentQuestion)" class="api-gap">
                Question changes are pending. Save Changes will persist the material and question schema.
              </p>
            </AppCard>

            <AppCard v-else title="No Question Selected" subtitle="Select a question from the left list to edit core fields.">
              <p class="status-note">This paper has no questions returned by the detail API.</p>
            </AppCard>
          </main>
        </div>
      </template>

      <Teleport to="body">
        <div v-if="showPartsModal" class="modal-backdrop" @click.self="showPartsModal = false">
          <section class="modal-card modal-card--wide">
            <header class="modal-card__header">
              <div>
                <h3>Manage Primary Types</h3>
                <p>Use official SHSAT labels or define custom names for reporting.</p>
              </div>
              <button class="modal-card__close" type="button" @click="showPartsModal = false">&times;</button>
            </header>

            <div class="structure-list">
              <article v-for="part in parts" :key="part.partId" class="structure-item">
                <div class="structure-item__header">
                  <div>
                    <strong>{{ part.partName || `Part ${part.partNumber}` }}</strong>
                    <p v-if="isOfficialPart(part)">Required for SHSAT publishing. Delete is blocked.</p>
                    <p v-else>Custom primary type.</p>
                  </div>
                  <span v-if="isOfficialPart(part)" class="structure-badge">Official SHSAT</span>
                </div>
                <label class="form-field">
                  <span class="form-label">Official Label</span>
                  <select class="form-input" :value="part.partCode || ''" @change="applyOfficialPartTemplate($event.target.value, part); markStructureDirty('part', part.partId)">
                    <option value="">Custom</option>
                    <option v-for="type in officialShsatTypes" :key="type.code" :value="type.code">
                      {{ type.name }}
                    </option>
                  </select>
                </label>
                <label class="form-field">
                  <span class="form-label">Code</span>
                  <input v-model="part.partCode" class="form-input" @input="markStructureDirty('part', part.partId)" />
                </label>
                <label class="form-field">
                  <span class="form-label">Part Name</span>
                  <input v-model="part.partName" class="form-input" @input="markStructureDirty('part', part.partId)" />
                </label>
                <label class="form-field">
                  <span class="form-label">Introduction</span>
                  <input v-model="part.partIntro" class="form-input" @input="markStructureDirty('part', part.partId)" />
                </label>
                <label class="form-field">
                  <span class="form-label">Question Range</span>
                  <input v-model="part.questionRange" class="form-input" @input="markStructureDirty('part', part.partId)" />
                </label>
                <label class="form-field">
                  <span class="form-label">Question Count</span>
                  <input v-model.number="part.questionCount" class="form-input" type="number" min="0" @input="markStructureDirty('part', part.partId)" />
                </label>
                <div class="structure-actions">
                  <AppButton variant="secondary" @click="updatePart(part)">Update</AppButton>
                  <AppButton
                    variant="ghost"
                    :disabled="isOfficialPart(part)"
                    :title="isOfficialPart(part) ? officialDeleteBlockMessage('part') : 'Delete primary type'"
                    @click="deletePart(part)"
                  >
                    Delete
                  </AppButton>
                </div>
              </article>
            </div>

            <div class="new-structure">
              <h4>Add Primary Type</h4>
              <div class="paper-form-grid">
                <select class="form-input" :value="newPart.partCode" @change="applyOfficialPartTemplate($event.target.value, newPart)">
                  <option value="">Custom primary type</option>
                  <option v-for="type in officialShsatTypes" :key="type.code" :value="type.code">
                    {{ type.name }}
                  </option>
                </select>
                <input v-model="newPart.partCode" class="form-input" placeholder="Code, e.g. ELA" />
                <input v-model="newPart.partName" class="form-input" placeholder="Part name" />
                <input v-model="newPart.partIntro" class="form-input" placeholder="Introduction" />
                <input v-model="newPart.questionRange" class="form-input" placeholder="Question range" />
                <input v-model.number="newPart.questionCount" class="form-input" type="number" min="0" placeholder="Count" />
              </div>
              <AppButton variant="secondary" @click="createPart">Add Primary Type</AppButton>
            </div>
          </section>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="showTypesModal" class="modal-backdrop" @click.self="showTypesModal = false">
          <section class="modal-card modal-card--wide">
            <header class="modal-card__header">
              <div>
                <h3>Manage Secondary Types</h3>
                <p>Secondary labels sit under a primary type and drive type-level statistics.</p>
              </div>
              <button class="modal-card__close" type="button" @click="showTypesModal = false">&times;</button>
            </header>

            <div class="structure-list">
              <article v-for="subType in subTypes" :key="subType.subTypeId" class="structure-item">
                <div class="structure-item__header">
                  <div>
                    <strong>{{ subType.subTypeName || `Type ${subType.subTypeId}` }}</strong>
                    <p v-if="isOfficialSubType(subType)">Required for SHSAT publishing. Delete is blocked.</p>
                    <p v-else>Custom secondary type.</p>
                  </div>
                  <span v-if="isOfficialSubType(subType)" class="structure-badge">Official SHSAT</span>
                </div>
                <label class="form-field">
                  <span class="form-label">Part</span>
                  <select v-model="subType.partId" class="form-input" @change="markStructureDirty('subType', subType.subTypeId)">
                    <option v-for="part in parts" :key="part.partId" :value="part.partId">
                      {{ part.partName || `Part ${part.partNumber}` }}
                    </option>
                  </select>
                </label>
                <label class="form-field">
                  <span class="form-label">Official Label</span>
                  <select class="form-input" :value="subType.subTypeCode || ''" @change="applyOfficialSubTypeTemplate($event.target.value, subType); markStructureDirty('subType', subType.subTypeId)">
                    <option value="">Custom</option>
                    <option v-for="type in officialSubTypesForPartId(subType.partId)" :key="type.code" :value="type.code">
                      {{ type.name }}
                    </option>
                  </select>
                </label>
                <label class="form-field">
                  <span class="form-label">Code</span>
                  <input v-model="subType.subTypeCode" class="form-input" @input="markStructureDirty('subType', subType.subTypeId)" />
                </label>
                <label class="form-field">
                  <span class="form-label">Type Name</span>
                  <input v-model="subType.subTypeName" class="form-input" @input="markStructureDirty('subType', subType.subTypeId)" />
                </label>
                <label class="form-field">
                  <span class="form-label">Introduction</span>
                  <input v-model="subType.subTypeIntro" class="form-input" @input="markStructureDirty('subType', subType.subTypeId)" />
                </label>
                <label class="form-field">
                  <span class="form-label">Question Range</span>
                  <input v-model="subType.questionRange" class="form-input" @input="markStructureDirty('subType', subType.subTypeId)" />
                </label>
                <label class="form-field">
                  <span class="form-label">Question Count</span>
                  <input v-model.number="subType.questionCount" class="form-input" type="number" min="0" @input="markStructureDirty('subType', subType.subTypeId)" />
                </label>
                <div class="structure-actions">
                  <AppButton variant="secondary" @click="updateSubType(subType)">Update</AppButton>
                  <AppButton
                    variant="ghost"
                    :disabled="isOfficialSubType(subType)"
                    :title="isOfficialSubType(subType) ? officialDeleteBlockMessage('subType') : 'Delete secondary type'"
                    @click="deleteSubType(subType)"
                  >
                    Delete
                  </AppButton>
                </div>
              </article>
            </div>

            <div class="new-structure">
              <h4>Add Secondary Type (Advanced)</h4>
              <p class="new-structure__note">Use custom secondary types only when the official SHSAT labels do not fit.</p>
              <div class="paper-form-grid">
                <select v-model="newSubType.partId" class="form-input">
                  <option value="">Select a part</option>
                  <option v-for="part in parts" :key="part.partId" :value="part.partId">
                    {{ part.partName || `Part ${part.partNumber}` }}
                  </option>
                </select>
                <select class="form-input" :value="newSubType.subTypeCode" @change="applyOfficialSubTypeTemplate($event.target.value, newSubType)">
                  <option value="">Custom secondary type</option>
                  <option v-for="type in officialSubTypesForPartId(newSubType.partId)" :key="type.code" :value="type.code">
                    {{ type.name }}
                  </option>
                </select>
                <input v-model="newSubType.subTypeCode" class="form-input" placeholder="Code, e.g. CUSTOM_READING" />
                <input v-model="newSubType.subTypeName" class="form-input" placeholder="Type name" />
                <input v-model="newSubType.subTypeIntro" class="form-input" placeholder="Introduction" />
                <input v-model="newSubType.questionRange" class="form-input" placeholder="Question range" />
                <input v-model.number="newSubType.questionCount" class="form-input" type="number" min="0" placeholder="Count" />
              </div>
              <AppButton variant="secondary" @click="createSubType">Add Secondary Type</AppButton>
            </div>
          </section>
        </div>
      </Teleport>
    </section>
  </AdminLayout>
</template>

<style scoped>
.paper-edit {
  --paper-radius-sm: 6px;
  --paper-radius-md: 10px;
  --paper-radius-lg: 14px;
  --paper-shadow-card: 0 8px 24px rgba(31, 75, 135, 0.06);
  display: grid;
  gap: 10px;
  width: min(var(--page-container-width, 1320px), 100%);
  min-width: 0;
  margin-inline: auto;
  padding-top: 10px;
  padding-bottom: 12px;
}

.paper-edit :deep(.app-button),
.modal-card :deep(.app-button) {
  min-height: 30px;
  border-radius: var(--paper-radius-sm);
  padding: 0 10px;
  font-size: 12px;
  font-weight: 700;
  box-shadow: none;
}

.paper-edit :deep(.app-button--primary),
.modal-card :deep(.app-button--primary) {
  box-shadow: 0 6px 14px rgba(47, 111, 237, 0.16);
}

.paper-edit :deep(.app-button--primary:hover:not(:disabled)),
.modal-card :deep(.app-button--primary:hover:not(:disabled)) {
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.2);
}

.paper-edit :deep(.app-card) {
  border-radius: var(--paper-radius-lg);
  padding: 12px;
  box-shadow: var(--paper-shadow-card);
}

.paper-edit :deep(.app-card__header) {
  margin-bottom: 10px;
}

.paper-edit :deep(.app-card__title) {
  font-size: 17px;
  line-height: 1.25;
}

.paper-edit :deep(.app-card__subtitle) {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
}

.paper-edit .page-title {
  margin: 0;
  font-size: clamp(17px, 1.5vw, 21px);
  line-height: 1.22;
  letter-spacing: -0.015em;
}

.paper-edit .page-subtitle {
  margin: 0 0 2px;
  font-size: 11px;
  line-height: 1.2;
}

.edit-header,
.edit-header__main,
.edit-header__actions,
.sidebar-header,
.sidebar-actions,
.card-actions,
.section-title,
.question-navigation,
.structure-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.edit-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-md);
  min-height: 48px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: var(--paper-shadow-card);
}

.edit-header__main {
  min-width: 0;
  align-items: center;
}

.edit-header__identity {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
  align-items: center;
  gap: 2px 16px;
}

.edit-header__identity .page-title {
  overflow-wrap: anywhere;
}

.edit-header__identity .page-subtitle,
.edit-header__identity .page-title {
  grid-column: 1;
}

.scoring-rule-field {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: grid;
  gap: 4px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.scoring-rule-field select {
  min-width: 220px;
  height: 34px;
  padding: 0 28px 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: #fff;
  color: var(--color-text);
  font: inherit;
  font-size: 12px;
}

.scoring-rule-field select:focus-visible {
  outline: 2px solid var(--color-primary, #356df3);
  outline-offset: 1px;
}

.edit-header__actions {
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 10px;
  white-space: nowrap;
}

.state-card,
.api-gap {
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-md);
  padding: 10px 12px;
  background: #ffffff;
  font-size: 13px;
}

.notice {
  position: fixed;
  top: auto;
  right: 24px;
  bottom: 24px;
  z-index: 1200;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: min(360px, calc(100vw - 32px));
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 14px 14px 14px 16px;
  color: #172033;
  background: #ffffff;
  box-shadow: 0 18px 45px rgba(18, 36, 64, 0.16);
}

.notice strong {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
}

.notice p {
  margin: 0;
  color: #5c6b82;
  font-size: 13px;
  line-height: 1.45;
}

.notice button {
  flex: 0 0 auto;
  margin-left: auto;
  border: 0;
  border-radius: 999px;
  width: 24px;
  height: 24px;
  color: #64748b;
  background: #f4f7fb;
  cursor: pointer;
}

.notice--success {
  border-color: #bbf7d0;
}

.notice--error,
.state-card--error,
.api-gap {
  color: var(--color-danger);
  border-color: rgba(199, 55, 71, 0.28);
  background: #fff6f7;
}

.notice--error p {
  color: #7f1d1d;
}

.paper-form-grid,
.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.form-field--wide {
  grid-column: 1 / -1;
}

.check-line {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.card-actions {
  justify-content: flex-end;
  margin-top: 12px;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(720px, 1fr);
  gap: 14px;
  align-items: start;
}

.question-sidebar {
  position: sticky;
  top: 96px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-lg);
  background: #ffffff;
  box-shadow: var(--paper-shadow-card);
}

.sidebar-header {
  align-items: stretch;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--color-border);
  padding: 12px;
}

.sidebar-header h2,
.sidebar-header p,
.part-group h3,
.type-group h4,
.section-title h3,
.new-structure h4 {
  margin: 0;
}

.sidebar-header p,
.type-group h4,
  .empty-inline {
  color: var(--color-muted);
  font-size: 12px;
}

.sidebar-header h2 {
  font-size: 17px;
  line-height: 1.25;
}

.part-group h3,
.section-title h3,
.new-structure h4 {
  font-size: 15px;
  line-height: 1.3;
}

.type-group h4 {
  font-size: 12px;
}

.sidebar-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
}

.sidebar-actions :deep(.app-button) {
  min-width: 0;
  padding-right: 8px;
  padding-left: 8px;
  white-space: nowrap;
}

.question-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  max-height: calc(100vh - 176px);
  overflow: auto;
  padding: 10px;
}

.question-list-hint {
  margin: 0 0 2px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.4;
}

.subject-group {
  display: grid;
  min-width: 0;
  gap: 8px;
  border: 1px solid #e5ebf5;
  border-radius: var(--paper-radius-md);
  padding: 9px;
  background: linear-gradient(180deg, #f9fbff 0%, #f5f8fd 100%);
}

.subject-group__header,
.passage-set__header,
.standalone-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.subject-group__header,
.passage-set__header {
  justify-content: space-between;
  min-width: 0;
}

.subject-group__header > div,
.passage-set__header > div {
  flex: 1 1 auto;
  min-width: 0;
}

.subject-group__header h3,
.subject-group__header p,
.passage-set__header strong,
.passage-set__header small {
  margin: 0;
}

.subject-group__header h3 {
  color: #172033;
  font-size: 14px;
  line-height: 1.25;
}

.subject-group__header p,
.passage-set__header small {
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.35;
}

.passage-set {
  display: grid;
  min-width: 0;
  gap: 6px;
  border: 1px solid #d8e3f2;
  border-radius: var(--paper-radius-md);
  padding: 7px;
  background: #ffffff;
}

.passage-set__header strong {
  display: block;
  overflow-wrap: anywhere;
  color: #24344d;
  font-size: 12px;
  line-height: 1.35;
}

.standalone-item {
  position: relative;
  align-items: stretch;
}

.standalone-item .question-item {
  flex: 1 1 auto;
  min-width: 0;
  padding-right: 34px;
}

.scoped-add-button {
  flex: 0 0 auto;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  min-height: 26px;
  padding: 0 9px;
  color: var(--color-primary);
  background: #ffffff;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.scoped-add-button:disabled {
  color: #9aa7ba;
  background: #f4f7fb;
  cursor: not-allowed;
}

.scoped-add-button--compact,
.scoped-add-button--inline {
  min-height: 24px;
  padding: 0 8px;
  font-size: 10px;
}

.scoped-add-button--inline {
  position: absolute;
  top: 50%;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  min-width: 22px;
  height: 22px;
  min-height: 22px;
  border-color: #bcd4ff;
  padding: 0;
  color: var(--color-primary);
  background: #ffffff;
  font-size: 15px;
  line-height: 1;
  opacity: 0;
  transform: translateY(-50%) scale(0.92);
  transition: opacity 140ms ease, transform 140ms ease, border-color 140ms ease, background-color 140ms ease;
}

.standalone-item:hover .scoped-add-button--inline,
.standalone-item:focus-within .scoped-add-button--inline {
  opacity: 1;
  transform: translateY(-50%) scale(1);
}

.scoped-add-button--inline:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.part-group {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.type-group {
  display: grid;
  gap: 6px;
}

.question-item {
  position: relative;
  display: grid;
  grid-template-columns: 18px 42px minmax(0, 1fr);
  align-items: center;
  gap: 3px 8px;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-md);
  min-height: 58px;
  padding: 8px 10px;
  color: var(--color-text);
  text-align: left;
  background: #ffffff;
  cursor: grab;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease, transform 140ms ease;
}

.question-item--nested {
  background: #ffffff;
}

.question-item--recently-imported:not(:hover):not(.question-item--active) {
  border-color: #b6e4ce;
  background: #fbfefc;
}

.question-import-indicator {
  position: absolute;
  top: 9px;
  right: 9px;
  z-index: 1;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #18a874;
  box-shadow: 0 0 0 2px #e7f6ef;
}

.question-item:hover,
.question-item--active {
  border-color: var(--color-primary);
  background: #f7faff;
}

.question-item--active {
  box-shadow: inset 3px 0 0 var(--color-primary), 0 8px 18px rgba(47, 111, 237, 0.1);
}

.question-item:active {
  cursor: grabbing;
}

.question-item--dirty {
  box-shadow: inset 3px 0 0 #f0a528;
}

.question-item--active.question-item--dirty {
  box-shadow:
    inset 3px 0 0 var(--color-primary),
    inset 6px 0 0 #f0a528,
    0 8px 18px rgba(47, 111, 237, 0.1);
}

.question-item--dragging {
  opacity: 0.48;
  transform: scale(0.99);
}

.question-item--drop-before,
.question-item--drop-after {
  border-color: var(--color-primary);
  background: #ffffff;
  box-shadow: 0 8px 22px rgba(47, 111, 237, 0.12);
}

.question-item--drop-before::before,
.question-item--drop-after::after {
  content: '';
  position: absolute;
  right: 10px;
  left: 10px;
  height: 3px;
  border-radius: 999px;
  background: var(--color-primary);
}

.question-item--drop-before::before {
  top: -6px;
}

.question-item--drop-after::after {
  bottom: -6px;
}

.question-drag-handle {
  grid-column: 1;
  grid-row: 1 / 3;
  align-self: stretch;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #9aa7ba;
  font-size: 13px;
  letter-spacing: -3px;
}

.question-item strong {
  grid-column: 2;
  justify-self: start;
  border-radius: 999px;
  padding: 2px 7px;
  color: #1f3f73;
  background: #eef5ff;
  font-weight: 800;
}

.question-item > span:not(.question-drag-handle) {
  grid-column: 3;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: #172033;
  font-weight: 650;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.question-item small {
  grid-column: 2 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.2;
}

.question-meta-tag {
  display: inline-flex;
  align-items: center;
  border: 1px solid #e0e7f3;
  border-radius: 999px;
  max-width: 100%;
  padding: 2px 6px;
  color: #64748b;
  background: #f8fafc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.question-item strong,
.question-item span {
  font-size: 13px;
  line-height: 1.35;
}

.question-editor {
  min-width: 720px;
}

.meta-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: end;
  margin-bottom: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-md);
  padding: 8px;
  background: #fbfdff;
}

.skill-tag-editor {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
  border: 1px solid #dce7f6;
  border-radius: var(--paper-radius-md);
  padding: 10px;
  background: #ffffff;
}

.skill-tag-editor__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.skill-tag-editor__header h3,
.skill-tag-editor__header p {
  margin: 0;
}

.skill-tag-editor__header h3 {
  color: #172033;
  font-size: 14px;
  line-height: 1.3;
}

.skill-tag-editor__header p {
  margin-top: 2px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.35;
}

.skill-tag-editor__clear {
  flex: 0 0 auto;
  border: 1px solid #d5e1f1;
  border-radius: var(--paper-radius-sm);
  min-height: 28px;
  padding: 4px 9px;
  color: #52627a;
  background: #f8fafc;
  font-size: 12px;
  font-weight: 750;
  cursor: pointer;
}

.skill-tag-editor__clear:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.skill-tag-cascade {
  position: relative;
}

.skill-tag-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 38px;
  border: 1px solid #c9d8ee;
  border-radius: var(--paper-radius-sm);
  padding: 8px 10px;
  color: #172033;
  background: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}

.skill-tag-trigger:hover,
.skill-tag-trigger:focus-visible {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.1);
  outline: none;
}

.skill-tag-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.skill-tag-trigger--empty {
  color: #7b8aa2;
  font-weight: 650;
}

.skill-tag-trigger__caret {
  flex: 0 0 auto;
  color: #6b7d96;
  font-size: 17px;
  line-height: 1;
}

.skill-tag-menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 8px);
  left: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(190px, 1fr));
  width: min(760px, calc(100vw - 48px));
  min-height: 220px;
  overflow: hidden;
  border: 1px solid #d7e1ee;
  border-radius: var(--paper-radius-md);
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(23, 32, 51, 0.14);
}

.skill-tag-menu__column {
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  padding: 8px 0;
  border-right: 1px solid #e5edf7;
}

.skill-tag-menu__column:last-child {
  border-right: 0;
}

.skill-tag-menu__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 38px;
  border: 0;
  padding: 8px 13px;
  color: #536071;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.25;
  text-align: left;
  cursor: pointer;
}

.skill-tag-menu__item span:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.skill-tag-menu__item:hover,
.skill-tag-menu__item:focus-visible,
.skill-tag-menu__item--active {
  color: var(--color-primary);
  background: #f1f7ff;
  outline: none;
}

.skill-tag-menu__item--selected {
  color: var(--color-primary);
  font-weight: 800;
}

.skill-tag-menu__arrow {
  color: currentColor;
  font-size: 22px;
  font-weight: 500;
  line-height: 1;
}

.skill-tag-menu__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 800;
}

.skill-tag-menu__column:last-child .skill-tag-menu__item {
  grid-template-columns: 16px minmax(0, 1fr);
}

.meta-field,
.material-type {
  display: grid;
  gap: 4px;
  min-width: 136px;
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.meta-field--type {
  flex: 1 1 180px;
}

.meta-field--small {
  min-width: 112px;
}

.meta-control {
  min-height: 30px;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-sm);
  padding: 6px 8px;
  color: var(--color-text);
  background: #ffffff;
  font-size: 12px;
  line-height: 1.3;
}

.question-edit-block,
.material-editor,
.editor-section {
  display: grid;
  gap: 10px;
  margin: 14px 0;
}

.question-edit-block {
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-md);
  padding: 10px;
  background: var(--color-surface-soft);
}

.material-editor--empty {
  gap: 6px;
  padding: 9px 10px;
  background: #ffffff;
}

.material-editor--empty .section-note {
  display: none;
}

.material-editor--empty .empty-inline {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
}

.material-editor--compact {
  gap: 8px;
  padding: 9px 10px;
  background: #ffffff;
}

.material-editor--compact .section-title {
  align-items: center;
}

.material-editor--compact .section-note {
  max-width: 560px;
}

.section-note {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
}

.material-usage-note {
  color: var(--color-primary-strong);
  font-size: 12px;
  line-height: 1.35;
}

.section-title {
  justify-content: space-between;
}

.material-topline,
.material-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
}

.material-form-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}

.material-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 34px;
}

.structured-material-editor {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  border: 1px solid rgba(31, 75, 135, 0.12);
  border-radius: var(--paper-radius-sm);
  padding: 10px;
  background: #ffffff;
}

.structured-material-editor__header {
  display: grid;
  grid-column: 1 / -1;
  gap: 3px;
}

.structured-material-editor__header p {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.35;
}

.material-body-image-input {
  display: none;
}

.material-screenshot-modal {
  display: grid;
  gap: 12px;
}

.material-screenshot-paste-zone {
  display: grid;
  place-items: center;
  gap: 6px;
  min-height: 180px;
  border: 2px dashed rgba(47, 111, 237, 0.34);
  border-radius: var(--paper-radius-md);
  padding: 24px;
  color: #1f4b87;
  background: #f8fbff;
  text-align: center;
  outline: none;
}

.material-screenshot-paste-zone:focus {
  border-color: rgba(47, 111, 237, 0.72);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.14);
}

.material-screenshot-paste-zone strong {
  color: #172033;
  font-size: 15px;
}

.material-screenshot-paste-zone span {
  color: var(--color-muted);
  font-size: 12px;
}

.material-screenshot-message {
  margin: 0;
  border-radius: var(--paper-radius-sm);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.4;
}

.material-screenshot-message--info {
  color: #1f4b87;
  background: #eef5ff;
}

.material-screenshot-message--error {
  color: var(--color-danger);
  background: #fff1f2;
}

.material-screenshot-actions {
  align-items: center;
}

.structured-material-preview {
  display: grid;
  grid-column: 1 / -1;
  gap: 8px;
  border: 1px dashed rgba(31, 75, 135, 0.16);
  border-radius: var(--paper-radius-sm);
  padding: 10px 12px;
  color: var(--color-text);
  background: #fbfdff;
  font-size: 12px;
  line-height: 1.55;
}

.structured-material-preview__topline {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.structured-material-preview__topline .text-button {
  padding: 4px 9px;
  font-size: 11px;
}

.structured-material-preview__content {
  display: grid;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
  padding-right: 4px;
}

.structured-material-preview__introduction {
  color: #253247;
  white-space: pre-wrap;
}

.structured-material-preview__header {
  display: grid;
  gap: 3px;
  padding-bottom: 2px;
  text-align: center;
}

.structured-material-preview__header p {
  margin: 0;
}

.structured-material-preview__title {
  color: #172033;
  font-weight: 800;
}

.structured-material-preview__author {
  color: #40516b;
  font-style: italic;
}

.structured-material-preview__body {
  display: grid;
  gap: 2px;
}

.structured-material-preview__body-line {
  min-height: 20px;
}

.structured-material-preview__body-line--empty {
  min-height: 14px;
}

.structured-material-preview__body-line--image {
  display: block;
  min-height: 0;
}

.structured-material-preview__image-block {
  display: grid;
  gap: 6px;
  border: 1px solid rgba(31, 75, 135, 0.14);
  border-radius: var(--paper-radius-sm);
  padding: 8px;
  background: #ffffff;
}

.structured-material-preview__image-button {
  display: block;
  overflow: hidden;
  border: 1px solid rgba(31, 75, 135, 0.12);
  border-radius: var(--paper-radius-sm);
  padding: 0;
  background: #f8fafc;
  cursor: zoom-in;
}

.structured-material-preview__image-button img {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: contain;
}

.structured-material-preview__image-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
}

.text-button {
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-sm);
  padding: 6px 10px;
  color: var(--color-primary);
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.text-button--danger {
  color: var(--color-danger);
  border-color: rgba(199, 55, 71, 0.25);
  background: #fffafb;
}

.image-upload-panel {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  align-items: center;
  border: 1px dashed rgba(47, 111, 237, 0.28);
  border-radius: var(--paper-radius-sm);
  padding: 10px;
  background: #ffffff;
}

.image-upload-panel p {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.35;
}

.image-upload-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  border: 1px solid rgba(47, 111, 237, 0.32);
  border-radius: var(--paper-radius-sm);
  padding: 0 12px;
  color: var(--color-primary);
  background: #f4f8ff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.image-upload-button input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.image-upload-button:has(input:disabled) {
  cursor: wait;
  opacity: 0.7;
}

.image-upload-name {
  grid-column: 1 / -1;
  color: var(--color-muted);
  font-size: 12px;
}

.image-preview-panel {
  display: grid;
  gap: 8px;
  grid-column: 1 / -1;
  justify-items: stretch;
  max-height: 240px;
  overflow: hidden;
  border: 1px dashed var(--color-border);
  border-radius: var(--paper-radius-sm);
  padding: 8px;
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.07) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.07) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.07) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.07) 75%);
  background-color: #ffffff;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.image-preview-panel__header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}

.image-preview-button {
  display: block;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: zoom-in;
}

.image-preview-panel img {
  display: block;
  width: 100%;
  max-height: 170px;
  border-radius: var(--paper-radius-sm);
  object-fit: contain;
}

.image-preview-panel--compact {
  max-height: 150px;
  grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
  align-items: center;
}

.image-preview-panel--compact .image-preview-panel__header {
  grid-column: 1 / -1;
}

.image-preview-panel--compact img {
  width: 180px;
  max-width: 100%;
  max-height: 82px;
  justify-self: start;
}

.editor-image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(16, 24, 40, 0.72);
}

.editor-image-preview-dialog {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: min(1100px, 96vw);
  max-height: 92vh;
  overflow: hidden;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
}

.editor-image-preview-dialog__header {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: #ffffff;
}

.editor-image-preview-dialog__header div:first-child {
  display: grid;
  gap: 2px;
}

.editor-image-preview-dialog__header span {
  color: var(--color-muted);
  font-size: 0.85rem;
}

.editor-image-preview-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.editor-image-preview-dialog__actions button {
  min-width: 72px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-text);
  background: var(--color-surface-muted);
  cursor: pointer;
  font-weight: 700;
}

.editor-image-preview-dialog__viewport {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #111827;
}

.editor-image-preview-dialog img {
  display: block;
  max-width: 100%;
  max-height: calc(92vh - 59px);
  margin: 0 auto;
  object-fit: contain;
  cursor: zoom-in;
  transition: transform 160ms ease;
  touch-action: none;
}

.editor-image-preview-dialog img.zoomed {
  cursor: grab;
}

.editor-image-preview-dialog img.is-panning {
  cursor: grabbing;
}

.formula-editor {
  display: grid;
  gap: 6px;
}

.formula-editor__header,
.formula-editor__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.formula-editor__header {
  justify-content: space-between;
}

.formula-editor__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.formula-insert-button {
  border: 1px solid rgba(31, 75, 135, 0.16);
  border-radius: 999px;
  padding: 4px 8px;
  color: #1f4b87;
  background: #f8fbff;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.formula-insert-button:hover {
  border-color: rgba(47, 111, 237, 0.34);
  background: #eef5ff;
}

.formula-preview {
  display: grid;
  gap: 5px;
  border: 1px dashed rgba(31, 75, 135, 0.16);
  border-radius: var(--paper-radius-sm);
  padding: 8px 9px;
  color: var(--color-text);
  background: #fbfdff;
  font-size: 12px;
  line-height: 1.5;
}

.formula-preview__label {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.formula-preview__empty {
  color: var(--color-muted);
}

.stem-preview__content {
  display: grid;
  gap: 6px;
}

.stem-preview__image-block {
  max-width: 100%;
}

.stem-preview__image-block img {
  max-height: 220px;
  object-fit: contain;
}

.stem-input {
  min-height: 88px;
}

.stem-format-hint {
  margin: -6px 0 0;
  color: var(--paper-muted);
  font-size: 0.82rem;
  line-height: 1.4;
}

.stem-format-hint code {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(31, 75, 135, 0.08);
  color: var(--paper-ink);
  font-size: 0.8rem;
}

.answer-config-section {
  display: grid;
  gap: 8px;
  border: 1px solid rgba(31, 75, 135, 0.12);
  border-radius: var(--paper-radius-sm);
  padding: 10px;
  background: #ffffff;
}

.answer-config-section .subsection-title {
  margin-bottom: 0;
}

.answer-config-section .subsection-title > div {
  display: grid;
  gap: 3px;
}

.answer-config-section .subsection-title p {
  margin: 0;
}

.schema-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.monospace-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
}

.type-editor-panel {
  display: grid;
  gap: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-md);
  padding: 12px;
  background: #fbfdff;
}

.fill-blank-answer-editor__list {
  display: grid;
  gap: 10px;
}

.fill-blank-answer-editor__row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
}

.fill-blank-answer-editor__label {
  padding-top: 9px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.fill-blank-answer-editor__add {
  justify-self: end;
}

.form-input--warning {
  border-color: #d97706;
  background: #fffaf0;
}

.field-warning {
  grid-column: 2 / 4;
  margin: -4px 0 0;
  color: #b45309;
  font-size: 12px;
  line-height: 1.4;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
  font-size: 13px;
}

.inline-edit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.structured-card {
  display: grid;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-sm);
  padding: 10px;
  background: #ffffff;
}

.dual-editor-grid,
.graph-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.graph-editor-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.subsection-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.compact-input {
  max-width: 110px;
}

.match-editor {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--color-border);
  padding-top: 12px;
}

.icon-button {
  border: 1px solid rgba(199, 55, 71, 0.28);
  border-radius: var(--paper-radius-sm);
  padding: 7px 10px;
  color: var(--color-danger);
  background: #fff6f7;
  cursor: pointer;
  font-size: 13px;
}

.question-navigation {
  justify-content: space-between;
  margin-top: 14px;
  font-size: 13px;
}

.delete-question-button {
  margin-left: auto;
  border: 1px solid rgba(199, 55, 71, 0.28);
  border-radius: var(--paper-radius-sm);
  padding: 7px 12px;
  color: var(--color-danger);
  background: #fff6f7;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.delete-question-button:hover:not(:disabled) {
  background: #ffe9ec;
}

.delete-question-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.modal-backdrop {
  --paper-radius-sm: 6px;
  --paper-radius-md: 10px;
  --paper-radius-lg: 14px;

  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(23, 32, 51, 0.36);
}

.modal-card {
  width: min(720px, 100%);
  max-height: min(760px, calc(100vh - 32px));
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-lg);
  padding: 16px;
  background: #ffffff;
  box-shadow: 0 16px 48px rgba(23, 32, 51, 0.16);
}

.modal-card--wide {
  width: min(980px, 100%);
}

.modal-card__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.modal-card__header h3,
.modal-card__header p {
  margin: 0;
}

.modal-card__header p {
  color: var(--color-muted);
  font-size: 12px;
}

.modal-card__header h3 {
  font-size: 17px;
  line-height: 1.25;
}

.modal-card__close {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  color: var(--color-muted);
  background: var(--color-surface-soft);
  cursor: pointer;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.structure-list {
  display: grid;
  gap: 10px;
}

.structure-item {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: end;
  border: 1px solid var(--color-border);
  border-radius: var(--paper-radius-md);
  padding: 10px;
  background: #fbfdff;
}

.structure-item__header {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.structure-item__header strong {
  display: block;
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.35;
}

.structure-item__header p,
.new-structure__note {
  margin: 2px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.4;
}

.structure-badge {
  flex: 0 0 auto;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
}

.structure-actions {
  justify-content: flex-end;
}

.new-structure {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  border-top: 1px solid var(--color-border);
  padding-top: 14px;
}

/* Local overrides keep the editor and modals compact for dense workflows. */
.form-field {
  gap: 5px;
}

.form-label {
  font-size: 12px;
  line-height: 1.3;
}

.form-input {
  min-height: 30px;
  border-radius: var(--paper-radius-sm);
  padding: 6px 9px;
  font-size: 12px;
  line-height: 1.4;
}

textarea.form-input {
  min-height: auto;
  resize: vertical;
}

.question-edit-block :deep(.form-field) {
  gap: 4px;
}

.question-edit-block :deep(.form-label) {
  font-size: 12px;
  line-height: 1.25;
}

.question-edit-block :deep(.form-input) {
  min-height: 30px;
  padding: 6px 9px;
  border-radius: 8px;
  font-size: 12px;
}

.question-edit-block :deep(textarea.form-input) {
  min-height: 92px;
}

select.form-input {
  padding-right: 28px;
}

.form-input:focus {
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.1);
}

.import-questions-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(18, 31, 52, 0.48);
}

.import-questions-dialog {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  width: min(1380px, 96vw);
  height: min(900px, 94vh);
  overflow: hidden;
  border: 1px solid #d9e3f0;
  border-radius: 12px;
  background: #f7f9fc;
  box-shadow: 0 24px 72px rgba(18, 31, 52, 0.28);
}

.import-questions-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 26px 18px;
  background: #fff;
  border-bottom: 1px solid #e1e8f1;
}

.import-questions-header h2,
.import-questions-header p {
  margin: 0;
}

.import-questions-header h2 {
  color: #17253b;
  font-size: 23px;
}

.import-questions-header > div > p:last-child {
  margin-top: 5px;
  color: #68778c;
  font-size: 13px;
}

.import-questions-eyebrow {
  margin-bottom: 5px !important;
  color: #3d6fc2;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
}

.import-source-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(200px, 280px);
  gap: 14px;
  padding: 16px 26px 12px;
  background: #fff;
}

.import-source-select,
.import-type-select {
  display: grid;
  gap: 6px;
  color: #4c5b71;
  font-size: 11px;
  font-weight: 700;
}

.import-source-select select,
.import-type-select select {
  width: 100%;
  min-height: 40px;
  border: 1px solid #d3deec;
  border-radius: 7px;
  padding: 0 12px;
  color: #17253b;
  background: #fff;
  font: inherit;
  font-size: 13px;
}

.import-questions-filters {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  padding: 0 26px 14px;
  background: #fff;
}

.import-questions-filters button {
  flex: 0 0 auto;
  min-height: 30px;
  border: 1px solid #d9e2ef;
  border-radius: 6px;
  padding: 0 10px;
  color: #53647c;
  background: #fff;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.import-questions-filters button.active {
  border-color: #366fe0;
  color: #245cc7;
  background: #edf3ff;
}

.import-questions-error {
  margin: 0;
  border-top: 1px solid #f3d2d6;
  padding: 10px 26px;
  color: #a32938;
  background: #fff7f7;
  font-size: 12px;
}

.import-questions-workspace {
  display: grid;
  grid-template-columns: minmax(310px, 0.82fr) minmax(0, 1.45fr);
  gap: 14px;
  min-height: 0;
  padding: 16px 20px;
}

.import-question-list,
.import-question-preview {
  min-height: 0;
  overflow: auto;
  border: 1px solid #dce5f0;
  border-radius: 8px;
  background: #fff;
}

.import-question-list {
  display: grid;
  align-content: start;
  gap: 0;
}

.import-question-list__select-all {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  border-bottom: 1px solid #dce5f0;
  padding: 0 12px;
  color: #33445d;
  background: #fff;
  font-size: 11px;
  font-weight: 750;
  cursor: pointer;
}

.import-question-list__select-all input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #3474e6;
}

.import-question-group__heading {
  position: sticky;
  top: 42px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  border-bottom: 1px solid #e4eaf2;
  padding: 0 12px;
  color: #344760;
  background: #f5f8fc;
  font-size: 11px;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
  width: 100%;
  border: 0;
}

.import-question-group__count {
  color: #718097;
  font-size: 10px;
  font-weight: 700;
}

.import-question-group__chevron {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  transition: transform 140ms ease;
}

.import-question-group__heading[aria-expanded="false"] .import-question-group__chevron {
  transform: rotate(-135deg);
}

.import-question-group__heading:focus-visible {
  outline: 2px solid #3474e6;
  outline-offset: -2px;
}

.import-material-group__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 30px;
  border-bottom: 1px solid #e7edf5;
  padding: 0 14px 0 48px;
  color: #405570;
  background: #f9fbfe;
  font-size: 11px;
  font-weight: 750;
}

.import-material-group__heading small {
  color: #8290a4;
  font-size: 10px;
  font-weight: 600;
}

.import-question-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 0;
  min-height: 76px;
  border: 0;
  border-bottom: 1px solid #edf1f6;
  padding: 10px 12px;
  color: #26364d;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.import-question-row:last-child {
  border-bottom: 0;
}

.import-question-row:hover,
.import-question-row.selected {
  background: #f5f8fd;
}

.import-question-row.checked {
  box-shadow: inset 3px 0 #3474e6;
}

.import-question-select {
  display: grid;
  height: 100%;
  place-items: center;
  cursor: pointer;
}

.import-question-select input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #3474e6;
}

.import-question-row__preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 100%;
  border: 0;
  padding: 10px 12px 10px 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.import-question-row__main {
  display: grid;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
}

.import-question-row__main strong {
  color: #18273e;
  font-size: 12px;
}

.import-question-row__main small {
  margin-left: 4px;
  color: #718097;
  font-size: 10px;
  font-weight: 600;
}

.import-question-row__main > span {
  overflow: hidden;
  color: #718097;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-accuracy {
  max-width: 88px;
  border-radius: 999px;
  padding: 5px 7px;
  color: #69788d;
  background: #edf1f6;
  font-size: 10px;
  font-weight: 800;
  text-align: center;
}

.import-accuracy--low { color: #a73843; background: #fdebed; }
.import-accuracy--medium { color: #8a6500; background: #fff3cf; }
.import-accuracy--high { color: #167451; background: #e4f5ee; }

.import-question-preview {
  padding: 18px;
}

.import-question-preview__content {
  display: grid;
  gap: 14px;
}

.import-question-preview__heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5ebf2;
  padding-bottom: 10px;
  color: #1c2a40;
  font-size: 13px;
}

.import-question-preview__heading span {
  color: #6c7b91;
  font-size: 11px;
}

.import-question-preview :deep(.monitor-question-detail) {
  display: grid;
  gap: 12px;
}

.import-questions-loading,
.import-questions-empty {
  display: grid;
  min-height: 150px;
  place-items: center;
  padding: 24px;
  color: #738198;
  font-size: 13px;
  text-align: center;
}

.import-questions-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid #dce5f0;
  padding: 12px 20px;
  background: #fff;
}

.import-questions-footer p {
  overflow: hidden;
  margin: 0;
  color: #64748a;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-questions-footer > div {
  display: flex;
  gap: 8px;
}

@media (max-width: 900px) {
  .edit-header {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .edit-header__main {
    align-items: center;
  }

  .edit-header__actions {
    width: 100%;
    justify-content: flex-end;
  }

  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .question-sidebar {
    position: static;
  }

  .question-editor {
    min-width: 0;
  }

  .skill-tag-menu {
    position: static;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    margin-top: 8px;
    min-height: 0;
  }

  .skill-tag-menu__column {
    border-right: 0;
    border-bottom: 1px solid #e5edf7;
  }

  .skill-tag-menu__column:last-child {
    border-bottom: 0;
  }

  .import-questions-backdrop {
    padding: 8px;
  }

  .import-questions-dialog {
    width: 100%;
    height: 96vh;
  }

  .import-questions-workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(220px, 0.75fr) minmax(280px, 1fr);
    overflow-y: auto;
  }
}

@media (max-width: 560px) {
  .notice {
    right: 12px;
    bottom: 12px;
    width: min(360px, calc(100vw - 24px));
  }

  .edit-header__main {
    align-items: stretch;
    flex-direction: column;
  }

  .edit-header__identity {
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
  }

  .scoring-rule-field {
    grid-column: 1;
    grid-row: auto;
  }

  .scoring-rule-field select { min-width: 0; width: 100%; }
  .edit-header__actions > * { flex: 1 1 0; }
  .question-navigation {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }
  .question-navigation > .app-button {
    padding-inline: 8px;
    white-space: nowrap;
  }
  .question-navigation .delete-question-button {
    grid-column: 1 / -1;
    width: 100%;
    white-space: nowrap;
  }
  .fill-blank-answer-editor__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .fill-blank-answer-editor__label {
    grid-column: 1 / -1;
    padding-top: 0;
  }
  .fill-blank-answer-editor__row .form-input {
    min-width: 0;
  }
  .fill-blank-answer-editor__row .field-warning {
    grid-column: 1 / -1;
  }
  .import-questions-header { padding: 16px; }
  .import-source-toolbar { grid-template-columns: minmax(0, 1fr); padding: 12px 16px 10px; }
  .import-questions-filters { padding: 0 16px 12px; }
  .import-questions-workspace { padding: 10px; }
  .import-question-preview { padding: 12px; }
  .import-questions-footer { align-items: flex-start; flex-direction: column; padding: 10px 12px; }
  .import-questions-footer > div { width: 100%; justify-content: flex-end; }
}

</style>
