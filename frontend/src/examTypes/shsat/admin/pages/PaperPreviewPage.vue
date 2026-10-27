<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import MixedContent from '@shsat/components/MixedContent.vue';
import SafeMarkdownText from '@shsat/components/SafeMarkdownText.vue';
import { normalizeRestoredAnswerValue } from '@shsat/questionTypes/answerRestore';
import { getQuestionTypeDefinition, getQuestionTypeLabel, isMultiSelectType, normalizeQuestionType } from '@shsat/questionTypes';
import { adminApi } from '@shsat/admin/services/adminApi';
import { studentApi } from '@shsat/admin/services/studentApi';
import { getUserRole } from '@shsat/admin/authBridge';
import { buildExamQuestionGroups, buildQuestionAccessState } from '@shsat/utils/examQuestionGroups';
import {
  buildAvailableSectionOrder,
  getNextAvailableSectionCode,
  resolveActiveSectionCode,
} from '@shsat/utils/examSectionFlow';
import { getQuestionCompletionIssue, isQuestionComplete as hasCompleteQuestionAnswer } from '@shsat/utils/questionCompletion';
import { examFlowLogger } from '@shsat/utils/examFlowLogger';
import { buildMaterialDisplayLines } from '@shsat/utils/textMaterial';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const paperLoading = ref(false);
const submitLoading = ref(false);
const navigationLoading = ref(false);
const errorMessage = ref('');
const paperWarning = ref('');
const saveMessage = ref('');
const attempt = ref(null);
const paper = ref(null);
const examSummary = ref(null);
const result = ref(null);
const currentIndex = ref(0);
const answers = ref({});
const savedQuestionNumbers = ref(new Set());
const savingQuestionNumber = ref(null);
const timeSpentByQuestion = ref({});
const remainingSeconds = ref(0);
const countdownTimer = ref(null);
const presenceTimer = ref(null);
let presenceRequestInFlight = false;
const autoSubmitStarted = ref(false);
const reviewPanelOpen = ref(false);
const currentFilter = ref('all');
const markedQuestionNumbers = ref(new Set());
const sectionChoiceOpen = ref(false);
const sectionChoiceLoading = ref(false);
const localAccessBoundary = ref(null);
const preAttemptIntroPending = ref(false);
const acknowledgedTransitionKeys = ref(new Set());
const notesOpen = ref(false);
const notesContent = ref('');
const notesPanelRef = ref(null);
const notesPosition = ref({ left: null, top: 72 });
const notesDragging = ref(false);
const widthMode = ref('normal');
const widthMenuOpen = ref(false);
const fontMenuOpen = ref(false);
const fontScale = ref(1.15);
const isFullscreen = ref(false);
const fullscreenError = ref('');
const fullscreenRequiredOverlay = ref(false);
const focusViolationCount = ref(0);
const focusViolationModalOpen = ref(false);
const focusViolationModalCount = ref(0);
const legitFullscreenExit = ref(false);
const VIOLATION_MONITORING_GRACE_MS = 1500;
// 切屏需要持续一段时间才算违规，避免系统通知、权限弹窗等瞬时失焦被误判。
const PAGE_HIDDEN_VIOLATION_DELAY_MS = 1200;
// 浏览器进出全屏会瞬时触发 fullscreenchange(null)，延迟确认是否真的退出全屏再计违规。
const FULLSCREEN_EXIT_CONFIRM_MS = 800;
const SCREEN_DIAGNOSTIC_MAX_FULLSCREEN_ATTEMPTS = 10;
const SCREEN_DIAGNOSTIC_MAX_STATE_CHANGES = 20;
const SCREEN_DIAGNOSTIC_MAX_VIEWPORT_CHANGES = 20;
const SCREEN_DIAGNOSTIC_MAX_FOCUS_CHANGES = 6;
const SCREEN_DIAGNOSTIC_MAX_VISIBILITY_CHANGES = 20;
const SCREEN_DIAGNOSTIC_RESIZE_DELAY_MS = 350;
const SCREEN_DIAGNOSTIC_MIN_SIZE_CHANGE_PX = 80;
let pageHiddenViolationTimer = 0;
let fullscreenExitConfirmTimer = 0;
let screenResizeTimer = 0;
let screenDiagnosticsStarted = false;
let loggedFullscreenAttempts = 0;
let loggedFullscreenChanges = 0;
let loggedViewportChanges = 0;
let loggedFocusChanges = 0;
let loggedVisibilityChanges = 0;
let loggedAccessibilityShortcuts = 0;
let loggedDuplicateFullscreenRequests = 0;
let lastScreenMetrics = null;
let screenDiagnosticStartedAt = 0;
let fullscreenRequestCount = 0;
let fullscreenRequestInFlight = null;
let hadExamFullscreen = false;
let selectedFirstSection = '';
// Official student tools: highlighter, drawing pen, answer eliminator, and line reader mask.
const highlightColors = [
  { label: 'Yellow', value: '#fff36d' },
  { label: 'Pink', value: '#ffb3d1' },
  { label: 'Blue', value: '#9fd3ff' },
  { label: 'Green', value: '#b8f2a0' },
];
const penColors = [
  { label: 'Black', value: '#1f1f1f' },
  { label: 'Blue', value: '#2266c7' },
  { label: 'Red', value: '#c62828' },
  { label: 'Green', value: '#2e7d32' },
];
const highlighterOn = ref(false);
const highlightMenuOpen = ref(false);
const selectedHighlightColor = ref(highlightColors[0].value);
const pendingHighlightRange = ref(null);
const highlightPopoverPosition = ref({ left: 0, top: 0 });
const drawingOn = ref(false);
const drawingMenuOpen = ref(false);
const selectedPenColor = ref(penColors[0].value);
const drawingStrokesByKey = ref({});
const activeDrawingStroke = ref(null);
const eliminateModeOn = ref(false);
const eliminatedByQuestion = ref({});
const lineReaderOn = ref(false);
const lineReaderTop = ref(220);
const lineReaderDragging = ref(false);
const imagePreview = ref({
  open: false,
  src: '',
  title: '',
  zoom: 1,
  originX: 50,
  originY: 50,
  panX: 0,
  panY: 0,
});
const IMAGE_PREVIEW_MAX_ZOOM = 4;
const IMAGE_PREVIEW_ZOOM_STEP = 1.6;
let lineReaderDragOffset = 0;
let imagePreviewPanState = null;
let violationMonitoringReadyAt = 0;
const activeFocusLossReasons = new Set();
const confirmDialog = ref({
  open: false,
  title: '',
  message: '',
  confirmText: 'Continue',
  cancelText: 'Cancel',
  destructive: false,
});
const TRANSITION_VIEW_TYPES = Object.freeze({
  PRE_ATTEMPT_INTRO: 'pre-attempt-intro',
  SUBJECT_PART_INTRO: 'subject-part-intro',
  READING_PASSAGE_SET_INTRO: 'reading-passage-set-intro',
});
const DEFAULT_SUBJECT_INTROS = Object.freeze({
  ELA: 'Read each question carefully. Some questions belong to a reading passage set and may be answered within that set.',
  MATH: 'Solve each problem carefully. You may move forward through the open mathematics section as allowed by the exam.',
});

// Material/question split layout (material on the left, question on the right).
const DEFAULT_MATERIAL_WIDTH_PERCENT = 50;
const materialWidth = ref(DEFAULT_MATERIAL_WIDTH_PERCENT);
const isDragging = ref(false);
let activeQuestionEnteredAt = null;
let dragContainer = null;

const examId = computed(() => route.params.examId);
const attemptId = computed(() => attempt.value?.attemptId);
const isReviewMode = computed(() => route.query.review === '1');
const isPreviewMode = computed(() => route.name === 'admin-paper-preview');
const isAdminReviewMode = computed(() => isReviewMode.value && route.query.adminReport === '1');
const returnTo = computed(() => {
  return typeof route.query.returnTo === 'string' ? route.query.returnTo : '';
});

const questionSource = computed(() => {
  const resultQuestions = isReviewMode.value ? result.value?.questions || [] : [];
  const attemptQuestions = attempt.value?.questions || [];
  const paperQuestions = paper.value?.questions || [];

  if (resultQuestions.length > 0) {
    return mergeReviewQuestions(resultQuestions, paperQuestions);
  }

  if (attemptQuestions.length > 0) {
    return attemptQuestions;
  }

  return paperQuestions;
});

const questions = computed(() => {
  const sectionOrder = getSelectedSectionOrder();
  const sectionRank = new Map(sectionOrder.map((section, index) => [section, index]));

  return questionSource.value
    .map(normalizeQuestion)
    .sort((left, right) => {
      const leftSection = getQuestionSectionCode(left);
      const rightSection = getQuestionSectionCode(right);
      const leftRank = sectionRank.has(leftSection) ? sectionRank.get(leftSection) : sectionOrder.length;
      const rightRank = sectionRank.has(rightSection) ? sectionRank.get(rightSection) : sectionOrder.length;

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.questionNumber - right.questionNumber;
    });
});

const activeAccessBoundary = computed(() => {
  return localAccessBoundary.value
    || attempt.value?.accessBoundary
    || (attempt.value?.progressState ? progressStateToBoundary(attempt.value.progressState) : null);
});
const availableSectionOrder = computed(() => {
  return buildAvailableSectionOrder(questions.value, getSelectedSectionOrder(), getQuestionSectionCode);
});
const effectiveAccessBoundary = computed(() => buildEffectiveAccessBoundary(activeAccessBoundary.value));
const questionAccessState = computed(() => {
  return buildQuestionAccessState(questions.value, {
    accessBoundary: effectiveAccessBoundary.value,
    resolveSection: getQuestionSectionCode,
  });
});
const questionGroupWarnings = computed(() => questionAccessState.value.warnings);
const questionAccessByNumber = computed(() => questionAccessState.value.questionAccessByNumber);
const currentQuestion = computed(() => questions.value[currentIndex.value] || null);
const currentMaterialDisplay = computed(() => {
  const material = currentQuestion.value?.material;
  if (!material || isImageMaterial(material)) {
    return null;
  }

  return buildMaterialDisplayLines(material.materialContent || '');
});
const currentQuestionTypeAnswer = computed(() => {
  if (!currentQuestion.value) {
    return null;
  }

  return getQuestionTypeDefinition(currentQuestion.value.questionType).components.answer;
});
const currentQuestionAccess = computed(() => {
  if (!currentQuestion.value) {
    return null;
  }

  return questionAccessByNumber.value.get(currentQuestion.value.questionNumber) || null;
});
const currentGroup = computed(() => currentQuestion.value ? getQuestionGroup(currentQuestion.value.questionNumber) : null);
const currentSectionCode = computed(() => effectiveAccessBoundary.value?.currentSection || getQuestionSectionCode(currentQuestion.value));

function summarizeQuestion(question) {
  if (!question) {
    return null;
  }

  return {
    questionNumber: question.questionNumber,
    questionType: question.questionType,
    section: getQuestionSectionCode(question),
  };
}

function summarizeGroup(group) {
  if (!group) {
    return null;
  }

  return {
    groupKey: group.id,
    type: group.type,
    section: group.section,
    materialId: group.materialId || null,
    questionNumbers: [...(group.questionNumbers || [])],
  };
}

function summarizeBoundary(boundary) {
  if (!boundary) {
    return null;
  }

  return {
    currentSection: boundary.currentSection || null,
    selectedSectionOrder: [...(boundary.selectedSectionOrder || [])],
    completedSections: [...(boundary.completedSections || [])],
    currentOpenGroup: boundary.currentOpenGroup
      ? {
        groupKey: boundary.currentOpenGroup.groupKey,
        section: boundary.currentOpenGroup.section,
        questionNumbers: [...(boundary.currentOpenGroup.questionNumbers || [])],
      }
      : null,
    lockedGroupCount: (boundary.lockedGroups || []).length,
    lockedQuestionCount: (boundary.lockedQuestions || []).length,
  };
}

function examFlowContext(extra = {}) {
  return {
    attemptId: attemptId.value || null,
    currentIndex: currentIndex.value,
    questionCount: questions.value.length,
    currentQuestion: summarizeQuestion(currentQuestion.value),
    currentGroup: summarizeGroup(currentGroup.value),
    currentSection: currentSectionCode.value || null,
    accessBoundary: summarizeBoundary(effectiveAccessBoundary.value),
    ...extra,
  };
}

function summarizeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || 'Unknown error',
    code: error?.code || null,
    status: error?.status || null,
    method: error?.method || null,
    requestPath: error?.requestPath || null,
  };
}

const currentSectionQuestions = computed(() => {
  return questions.value.filter((question) => getQuestionSectionCode(question) === currentSectionCode.value);
});
const currentSectionAnsweredCount = computed(() => {
  return currentSectionQuestions.value.filter((question) => hasAnswer(question.questionNumber)).length;
});
const isCurrentQuestionReadOnly = computed(() => {
  return isReadOnlyMode.value || Boolean(currentQuestionAccess.value?.locked);
});
const canGoPrevious = computed(() => {
  if (activeTransitionViewModel.value || navigationLoading.value) {
    return false;
  }
  const previousQuestion = questions.value[currentIndex.value - 1];
  return Boolean(previousQuestion && canVisitQuestion(previousQuestion));
});
const canGoNext = computed(() => {
  if (activeTransitionViewModel.value || navigationLoading.value) {
    return false;
  }
  const nextQuestion = questions.value[currentIndex.value + 1];
  return Boolean(nextQuestion) && !savingQuestionNumber.value;
});
const answeredCount = computed(() => {
  return reviewQuestions.value.filter((question) => hasAnswer(question.questionNumber)).length;
});
const notAnsweredCount = computed(() => {
  return Math.max(reviewQuestions.value.length - answeredCount.value, 0);
});
const markedCount = computed(() => {
  return reviewQuestions.value.filter((question) => isMarked(question.questionNumber)).length;
});
const reviewQuestions = computed(() => {
  if (isReadOnlyMode.value || canUseFreeQuestionNavigation.value) {
    return questions.value;
  }

  return questions.value.filter((question) => {
    const access = getQuestionAccess(question.questionNumber);
    return access.accessible || access.locked || getQuestionSectionCode(question) === currentSectionCode.value;
  });
});
const filteredQuestions = computed(() => {
  const sourceQuestions = reviewQuestions.value;
  if (currentFilter.value === 'notAnswered') {
    return sourceQuestions.filter((question) => !hasAnswer(question.questionNumber));
  }
  if (currentFilter.value === 'marked') {
    return sourceQuestions.filter((question) => isMarked(question.questionNumber));
  }

  return sourceQuestions;
});
const currentQuestionPosition = computed(() => {
  if (questions.value.length === 0) {
    return '0 / 0';
  }

  return `${currentIndex.value + 1} / ${questions.value.length}`;
});
const currentSectionLabel = computed(() => getSectionLabel(currentQuestion.value));
const submitSectionText = computed(() => {
  if (submitLoading.value) {
    return 'Submitting...';
  }
  return 'Submit Section';
});
const currentTrailLabel = computed(() => {
  if (!currentQuestion.value) {
    return 'ITEM';
  }

  const groupLabel = getQuestionGroupLabel(currentQuestion.value.questionNumber);
  return groupLabel || `ITEM ${currentIndex.value + 1} OF ${questions.value.length}`;
});
const currentDrawingKey = computed(() => {
  if (!currentQuestion.value) {
    return '';
  }

  const materialId = currentQuestion.value.materialId || currentQuestion.value.material?.materialId;
  return materialId ? `material:${materialId}` : `question:${currentQuestion.value.questionNumber}`;
});
const currentDrawingStrokes = computed(() => {
  return drawingStrokesByKey.value[currentDrawingKey.value] || [];
});
const examDisplayTitle = computed(() => {
  const title = attempt.value?.examTitle || paper.value?.paperName || examSummary.value?.title || 'Exam';
  return isPreviewMode.value ? `${title} · Preview` : title;
});
const isPracticeAttempt = computed(() => attempt.value?.practice === true);
const isSubmitted = computed(() => {
  return result.value || ['COMPLETED', 'SUBMITTED', 'EXPIRED'].includes(attempt.value?.status);
});
const isReadOnlyMode = computed(() => isReviewMode.value || Boolean(isSubmitted.value));
const isExamSessionActive = computed(() => {
  return Boolean(attempt.value && !isReadOnlyMode.value && !isPreviewMode.value);
});
const isExamFullscreenRequired = computed(() => isExamSessionActive.value);
const canUseFreeQuestionNavigation = computed(() => {
  const role = getUserRole();
  // 管理员预览和错题练习使用自由导航，正式学生考试保留分段边界。
  return !isReadOnlyMode.value && (
    isPreviewMode.value
    || isPracticeAttempt.value
    || ['admin', 'administrator', 'teacher'].includes(role)
  );
});
const shouldSkipTransitionPages = computed(() => {
  return isPreviewMode.value || isReviewMode.value || isPracticeAttempt.value || Boolean(isSubmitted.value);
});
const transitionViewModels = computed(() => buildPendingTransitionViewModels());
const activeTransitionViewModel = computed(() => transitionViewModels.value[0] || null);
const activeTransitionContextItems = computed(() => activeTransitionViewModel.value?.contextItems || []);
const activePreAttemptIntroViewModel = computed(() => {
  return activeTransitionViewModel.value?.type === TRANSITION_VIEW_TYPES.PRE_ATTEMPT_INTRO
    ? activeTransitionViewModel.value
    : null;
});
const areAnswersVisible = computed(() => result.value?.answersVisible === true);
const countdownText = computed(() => formatRemainingTime(remainingSeconds.value));
const notesPanelStyle = computed(() => {
  const style = {
    top: `${notesPosition.value.top}px`,
  };

  if (notesPosition.value.left === null) {
    return {
      ...style,
      right: '24px',
    };
  }

  return {
    ...style,
    left: `${notesPosition.value.left}px`,
  };
});
const highlightPopoverStyle = computed(() => ({
  left: `${highlightPopoverPosition.value.left}px`,
  top: `${highlightPopoverPosition.value.top}px`,
}));

let notesDragOffset = { x: 0, y: 0 };
let confirmDialogResolver = null;

function unwrapResponse(response, fallbackMessage) {
  if (response?.success === false) {
    const error = new Error(response.message || fallbackMessage);
    error.code = response.errorCode || response.code || null;
    error.status = response.status || null;
    throw error;
  }

  return response?.data ?? response;
}

function normalizeQuestion(question) {
  const options = parseOptions(question.options);
  const questionConfig = parseJsonObject(question.questionConfig);
  const scoringRules = parseJsonObject(question.scoringRules);
  const normalizedType = normalizeQuestionType(question.questionType, 'TEXT');
  const materialId = question.materialId ?? question.material_id ?? null;

  const normalizedQuestion = {
    ...question,
    questionId: question.questionId,
    materialId,
    questionNumber: Number(question.questionNumber || question.displayOrder || 0),
    questionType: normalizedType,
    sectionCode: resolveQuestionSectionCode(question),
    stem: question.stem || 'Question stem is not available',
    score: question.score ?? null,
    options,
    questionConfig,
    scoringRules,
    selectionLimit: resolveSelectionLimit(question, questionConfig, scoringRules),
    inlineChoices: normalizeInlineChoices(questionConfig, options),
    dragItems: normalizeConfigList(questionConfig.items || questionConfig.dragItems, 'item'),
    dropZones: normalizeConfigList(questionConfig.zones || questionConfig.dropZones, 'zone'),
    hotTextSegments: normalizeConfigList(questionConfig.segments || questionConfig.hotTextSegments || options, 'segment'),
    hotSpotRegions: normalizeConfigList(questionConfig.regions || questionConfig.hotSpotRegions, 'region'),
    tableRows: normalizeConfigList(questionConfig.rows, 'row'),
    tableColumns: normalizeConfigList(questionConfig.columns, 'column'),
    graphConfig: questionConfig.graph || questionConfig,
    material: findMaterial(question),
  };

  const definition = getQuestionTypeDefinition(normalizedQuestion.questionType);
  return definition.migrated
    ? definition.normalizeQuestion(normalizedQuestion)
    : normalizedQuestion;
}

function mergeReviewQuestions(resultQuestions, paperQuestions) {
  const paperByNumber = new Map(paperQuestions.map((question) => [Number(question.questionNumber || question.displayOrder || 0), question]));
  const paperById = new Map(
    paperQuestions
      .filter((question) => question.questionId !== null && question.questionId !== undefined)
      .map((question) => [String(question.questionId), question])
  );

  return resultQuestions.map((question) => {
    const paperQuestion = (question.questionId === null || question.questionId === undefined ? null : paperById.get(String(question.questionId)))
      || paperByNumber.get(Number(question.questionNumber || 0))
      || {};

    // Keep result fields authoritative while borrowing paper configuration for structured review rendering.
    return {
      ...paperQuestion,
      ...question,
      questionConfig: question.questionConfig ?? paperQuestion.questionConfig,
      scoringRules: question.scoringRules ?? paperQuestion.scoringRules,
      materialId: question.materialId ?? paperQuestion.materialId,
      material_id: question.material_id ?? paperQuestion.material_id,
    };
  });
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

function parseJsonObject(value) {
  const parsed = parseJson(value);
  return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
}

function normalizeOption(option, index) {
  const fallbackKey = String.fromCharCode(65 + index);

  if (typeof option === 'string') {
    return { key: fallbackKey, text: option };
  }

  const key = option.key || option.label || option.value || option.option || fallbackKey;
  const text = option.text || option.content || option.title || option.value || option.label || key;

  return {
    key: String(key),
    text: String(text),
  };
}

function normalizeConfigList(list, prefix) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `${prefix}${index + 1}`, key: `${prefix}${index + 1}`, text: item, label: item };
    }

    const id = String(item.id || item.key || item.value || `${prefix}${index + 1}`);
    return {
      ...item,
      id,
      key: String(item.key || id),
      text: String(item.text || item.label || item.title || item.value || id),
      label: String(item.label || item.text || item.title || item.value || id),
    };
  });
}

function normalizeInlineChoices(questionConfig, options) {
  const blanks = questionConfig.blanks || questionConfig.inlineChoices;
  if (Array.isArray(blanks)) {
    return blanks.map((blank, index) => ({
      id: String(blank.id || blank.key || `blank${index + 1}`),
      label: String(blank.label || blank.text || `Blank ${index + 1}`),
      options: parseOptions(blank.options || []),
    }));
  }

  return options.length ? [{ id: 'blank1', label: 'Blank 1', options }] : [];
}

function findMaterial(question) {
  const materials = attempt.value?.materials?.length
    ? attempt.value.materials
    : paper.value?.materials || [];
  const materialId = question.materialId ?? question.material_id;
  return materials.find((item) => String(item.materialId) === String(materialId)) || null;
}

function isImageMaterial(material) {
  return Boolean(material?.assetUrl);
}

function openMaterialImagePreview(material) {
  if (drawingOn.value || !isImageMaterial(material)) {
    return;
  }

  imagePreviewPanState = null;
  imagePreview.value = {
    open: true,
    src: material.assetUrl,
    title: 'Image Preview',
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
}

function openMaterialBodyImagePreview(item) {
  if (drawingOn.value || !item?.src) {
    return;
  }

  imagePreviewPanState = null;
  imagePreview.value = {
    open: true,
    src: item.src,
    title: 'Material Image',
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
}

function openStemImagePreview(item) {
  if (drawingOn.value || !item?.src) {
    return;
  }

  imagePreviewPanState = null;
  imagePreview.value = {
    open: true,
    src: item.src,
    title: item.alt || 'Stem Image',
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
}

function closeMaterialImagePreview() {
  imagePreviewPanState = null;
  imagePreview.value = {
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

function zoomMaterialImagePreview(event) {
  if (imagePreviewPanState?.moved) {
    imagePreviewPanState = null;
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  increaseMaterialImagePreviewZoom(
    ((event.clientX - rect.left) / rect.width) * 100,
    ((event.clientY - rect.top) / rect.height) * 100
  );
}

function increaseMaterialImagePreviewZoom(originX = imagePreview.value.originX, originY = imagePreview.value.originY) {
  const nextZoom = Math.min(
    IMAGE_PREVIEW_MAX_ZOOM,
    Number((imagePreview.value.zoom * IMAGE_PREVIEW_ZOOM_STEP).toFixed(2))
  );

  imagePreview.value = {
    ...imagePreview.value,
    zoom: nextZoom,
    originX: Math.min(100, Math.max(0, originX)),
    originY: Math.min(100, Math.max(0, originY)),
  };
}

function resetMaterialImagePreviewZoom() {
  imagePreviewPanState = null;
  imagePreview.value = {
    ...imagePreview.value,
    zoom: 1,
    originX: 50,
    originY: 50,
    panX: 0,
    panY: 0,
  };
}

function imagePreviewTransformStyle() {
  return {
    transform: `translate3d(${imagePreview.value.panX || 0}px, ${imagePreview.value.panY || 0}px, 0) scale(${imagePreview.value.zoom})`,
    transformOrigin: `${imagePreview.value.originX}% ${imagePreview.value.originY}%`,
  };
}

function startImagePreviewPan(event) {
  if (imagePreview.value.zoom <= 1) {
    return;
  }

  event.currentTarget.setPointerCapture?.(event.pointerId);
  imagePreviewPanState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: imagePreview.value.panX || 0,
    baseY: imagePreview.value.panY || 0,
    moved: false,
  };
}

function moveImagePreviewPan(event) {
  if (!imagePreviewPanState || imagePreviewPanState.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - imagePreviewPanState.startX;
  const deltaY = event.clientY - imagePreviewPanState.startY;
  if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
    imagePreviewPanState.moved = true;
  }

  imagePreview.value = {
    ...imagePreview.value,
    panX: imagePreviewPanState.baseX + deltaX,
    panY: imagePreviewPanState.baseY + deltaY,
  };
}

function endImagePreviewPan(event) {
  if (!imagePreviewPanState || imagePreviewPanState.pointerId !== event.pointerId) {
    return;
  }

  event.currentTarget.releasePointerCapture?.(event.pointerId);
  // Keep the moved flag until the following click event so dragging does not also zoom.
}

function getAvailableParts() {
  return attempt.value?.parts?.length ? attempt.value.parts : paper.value?.parts || [];
}

function resolveQuestionSectionCode(question) {
  const part = getAvailableParts().find((item) => String(item.partId) === String(question?.partId));
  const candidates = [
    question?.sectionCode,
    question?.section,
    question?.sectionName,
    question?.subject,
    question?.paperSection,
    question?.primaryType,
    part?.partCode,
    part?.partName,
  ];

  for (const candidate of candidates) {
    const sectionCode = normalizeSectionCandidate(candidate);
    if (sectionCode) {
      return sectionCode;
    }
  }

  const splitPoint = Math.ceil(questionSource.value.length / 2);
  const questionNumber = Number(question?.questionNumber || question?.displayOrder || 0);
  return questionNumber > splitPoint ? 'MATH' : 'ELA';
}

function normalizeSectionCandidate(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) {
    return '';
  }
  if (normalized.includes('MATH')) {
    return 'MATH';
  }
  if (normalized.includes('ELA') || normalized.includes('ENGLISH') || normalized.includes('READ')) {
    return 'ELA';
  }
  return '';
}

function getQuestionSectionCode(question) {
  return normalizeSectionCandidate(question?.sectionCode) || resolveQuestionSectionCode(question);
}

function getSelectedSectionOrder() {
  const boundaryOrder = activeAccessBoundary.value?.selectedSectionOrder || attempt.value?.progressState?.selectedSectionOrder || [];
  const normalizedOrder = boundaryOrder.map((section) => String(section || '').trim().toUpperCase()).filter(Boolean);
  if (normalizedOrder.length > 0) {
    return normalizedOrder;
  }
  return ['ELA', 'MATH'];
}

function progressStateToBoundary(progressState) {
  if (!progressState) {
    return null;
  }

  return {
    freeNavigation: false,
    selectedSectionOrder: progressState.selectedSectionOrder || [],
    currentSection: progressState.currentSection || null,
    completedSections: progressState.completedSections || [],
    currentOpenGroup: progressState.currentOpenGroup || null,
    lockedGroups: progressState.lockedGroups || [],
    lockedQuestions: progressState.lockedQuestions || [],
  };
}

function buildEffectiveAccessBoundary(boundary) {
  if (!boundary) {
    return null;
  }

  const selectedSectionOrder = getSelectedSectionOrder();
  const currentSection = resolveActiveSectionCode({
    boundarySection: boundary.currentSection,
    currentQuestion: currentQuestion.value,
    questions: questions.value,
    selectedSectionOrder,
    resolveSection: getQuestionSectionCode,
  });
  const normalizedSectionOrder = availableSectionOrder.value.length ? availableSectionOrder.value : selectedSectionOrder;
  const normalizedBoundary = {
    ...boundary,
    selectedSectionOrder: normalizedSectionOrder,
    currentSection,
  };

  if (!currentSection || boundaryOpenGroupMatchesSection(boundary, currentSection)) {
    return normalizedBoundary;
  }

  const groups = buildExamQuestionGroups(questions.value, { resolveSection: getQuestionSectionCode }).groups;
  const currentQuestionGroup = currentQuestion.value
    ? groups.find((group) => group.section === currentSection && group.questionNumbers.includes(currentQuestion.value.questionNumber))
    : null;
  const firstSectionGroup = groups.find((group) => group.section === currentSection) || null;

  return {
    ...normalizedBoundary,
    currentOpenGroup: toOpenGroup(currentQuestionGroup || firstSectionGroup),
  };
}

function boundaryOpenGroupMatchesSection(boundary, sectionCode) {
  const questionNumbers = boundary?.currentOpenGroup?.questionNumbers || [];
  if (questionNumbers.length === 0) {
    return false;
  }

  return questionNumbers.some((questionNumber) => {
    const question = findQuestionByNumber(questionNumber);
    return question && getQuestionSectionCode(question) === sectionCode;
  });
}

function applyProgressUpdate(update) {
  const progressState = update?.progressState || null;
  const accessBoundary = update?.accessBoundary || progressStateToBoundary(progressState);

  if (progressState) {
    attempt.value = {
      ...attempt.value,
      progressState,
      accessBoundary,
    };
  }
  localAccessBoundary.value = accessBoundary;
}

function isChoiceQuestion(question) {
  const type = question?.questionType || '';
  return question?.options?.length > 0
    && !type.includes('TEXT')
    && !type.includes('ESSAY')
    && !isComplexQuestion(question);
}

function isMultiSelectQuestion(question) {
  return isMultiSelectType(question?.questionType || '');
}

function isComplexQuestion(question) {
  const type = question?.questionType || '';
  return ['INLINE_CHOICE', 'DRAG_AND_DROP', 'HOT_TEXT', 'HOT_SPOT', 'TABLE_GRID', 'GRAPH_QUESTION', 'EQUATION_EDITOR']
    .some((candidate) => type.includes(candidate));
}

function isTextQuestion(question) {
  const type = question?.questionType || '';
  return type.includes('FILL') || type.includes('BLANK') || type === 'TEXT' || type.includes('SHORT');
}

function isDragDropQuestion(question) {
  return (question?.questionType || '').includes('DRAG_AND_DROP');
}

function isHotTextQuestion(question) {
  return (question?.questionType || '').includes('HOT_TEXT');
}

function isHotSpotQuestion(question) {
  return (question?.questionType || '').includes('HOT_SPOT');
}

function isGraphQuestion(question) {
  return (question?.questionType || '').includes('GRAPH');
}

function isEquationQuestion(question) {
  return (question?.questionType || '').includes('EQUATION');
}

function resolveSelectionLimit(question, questionConfig = {}, scoringRules = {}) {
  const candidates = [
    questionConfig.selectionLimit,
    questionConfig.maxSelections,
    questionConfig.requiredSelections,
    questionConfig.exactSelections,
    questionConfig.selectCount,
    questionConfig.selectionCount,
    questionConfig.maxSelected,
    questionConfig.x,
    scoringRules.selectionLimit,
    scoringRules.maxSelections,
    scoringRules.requiredSelections,
    scoringRules.exactSelections,
    scoringRules.selectCount,
    scoringRules.selectionCount,
    scoringRules.maxSelected,
    scoringRules.x,
  ];
  const limit = candidates.map((value) => Number(value)).find((value) => Number.isInteger(value) && value > 0);

  return limit || null;
}

function getAnswerList(questionNumber) {
  const value = getAnswer(questionNumber);

  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    return value.answers || value.selectedAnswers || value.selectedIds || value.regions || [];
  }

  return String(value || '').split(',').filter(Boolean);
}

function getAnswer(questionNumber) {
  return answers.value[questionNumber] ?? '';
}

function setAnswer(questionNumber, value) {
  if (isQuestionReadOnly(questionNumber)) {
    return;
  }

  answers.value = {
    ...answers.value,
    [questionNumber]: value,
  };
  const nextSaved = new Set(savedQuestionNumbers.value);
  nextSaved.delete(questionNumber);
  savedQuestionNumbers.value = nextSaved;
  saveMessage.value = '';
}

function setAnswerField(questionNumber, fieldName, value) {
  const current = getStructuredAnswer(questionNumber);
  setAnswer(questionNumber, {
    ...current,
    [fieldName]: value,
  });
}

function getStructuredAnswer(questionNumber) {
  const value = getAnswer(questionNumber);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function removeOptionFromAnswerValue(answerValue, optionKey) {
  if (Array.isArray(answerValue)) {
    return answerValue.filter((value) => value !== optionKey);
  }

  if (answerValue && typeof answerValue === 'object') {
    const normalizedAnswers = [
      'answers',
      'selectedAnswers',
      'selectedIds',
      'regions',
      'selectedRegionIds',
      'selectedSegmentIds',
    ].reduce((result, fieldName) => {
      if (Array.isArray(answerValue[fieldName])) {
        result[fieldName] = answerValue[fieldName].filter((value) => value !== optionKey);
      }
      return result;
    }, { ...answerValue });

    if (normalizedAnswers.value === optionKey) {
      normalizedAnswers.value = '';
    }

    return normalizedAnswers;
  }

  return answerValue === optionKey ? '' : answerValue;
}

function hasMeaningfulAnswerValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasMeaningfulAnswerValue);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasMeaningfulAnswerValue);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  return String(value).trim().length > 0;
}

function findQuestionByNumber(questionNumber) {
  return questions.value.find((question) => question.questionNumber === questionNumber) || null;
}

function isQuestionComplete(questionOrNumber) {
  const question = typeof questionOrNumber === 'object' ? questionOrNumber : findQuestionByNumber(questionOrNumber);
  return Boolean(question && hasCompleteQuestionAnswer(question, getAnswer(question.questionNumber)));
}

function hasAnswer(questionNumber) {
  return isQuestionComplete(questionNumber);
}

function isQuestionSaved(questionNumber) {
  return savedQuestionNumbers.value.has(questionNumber);
}

function isMarked(questionNumber) {
  return markedQuestionNumbers.value.has(questionNumber);
}

function getQuestionGroup(questionNumber) {
  return questionAccessByNumber.value.get(questionNumber)?.group || null;
}

function getQuestionAccess(questionNumber) {
  return questionAccessByNumber.value.get(questionNumber) || { accessible: true, locked: false };
}

function isQuestionLocked(questionNumber) {
  return !isReadOnlyMode.value
    && !canUseFreeQuestionNavigation.value
    && Boolean(getQuestionAccess(questionNumber).locked);
}

function isQuestionReadOnly(questionNumber) {
  return isReadOnlyMode.value || isQuestionLocked(questionNumber);
}

function canVisitQuestion(question) {
  return Boolean(question)
    && (isReadOnlyMode.value
      || canUseFreeQuestionNavigation.value
      || getQuestionAccess(question.questionNumber).accessible);
}

function getSectionLabel(question) {
  if (!question) {
    return 'SECTION';
  }

  const sectionCode = getQuestionSectionCode(question);
  if (sectionCode === 'MATH') {
    return 'MATHEMATICS';
  }
  if (sectionCode === 'ELA') {
    return 'ELA';
  }

  return sectionCode || 'SECTION';
}

// 宽松口径（与服务端评分/报告一致）：答案里有任意有效内容即视为"已作答"。
function isQuestionAttempted(question) {
  return Boolean(question && hasMeaningfulAnswerValue(getAnswer(question.questionNumber)));
}

// "未作答" = 完全没有有效答案，与报告中的 unansweredCount 口径一致。
function getUnansweredQuestionNumbers(targetQuestions = questions.value) {
  return targetQuestions
    .filter((question) => !isQuestionAttempted(question))
    .map((question) => question.questionNumber);
}

// 严格口径：整题全部完成才算"未遗漏"，用于分节提交门禁与阅读组导航提示。
function getIncompleteQuestionNumbers(targetQuestions = questions.value) {
  return targetQuestions
    .filter((question) => !isQuestionComplete(question))
    .map((question) => question.questionNumber);
}

function formatQuestionNumbers(questionNumbers, limit = 24) {
  if (questionNumbers.length <= limit) {
    return questionNumbers.join(', ');
  }
  const visibleNumbers = questionNumbers.slice(0, limit).join(', ');
  return `${visibleNumbers}, and ${questionNumbers.length - limit} more`;
}

function currentReadingGroupUnansweredNumbers() {
  const currentGroup = currentQuestion.value ? getQuestionGroup(currentQuestion.value.questionNumber) : null;
  if (currentGroup?.type !== 'reading') {
    return [];
  }
  return getUnansweredQuestionNumbers(currentGroup.questions);
}

function readingGroupIncompleteMessage(missingNumbers) {
  const currentGroup = currentQuestion.value ? getQuestionGroup(currentQuestion.value.questionNumber) : null;
  const label = currentGroup?.label || 'this reading group';
  const verb = label.startsWith('Questions') ? 'have' : 'has';
  return `${label} ${verb} incomplete questions: ${formatQuestionNumbers(missingNumbers)}.`;
}

function submissionIncompleteMessage(unansweredNumbers) {
  return `There are ${unansweredNumbers.length} incomplete questions: ${formatQuestionNumbers(unansweredNumbers)}.`;
}

function requestConfirmation({
  title,
  message,
  confirmText = 'Continue',
  cancelText = 'Cancel',
  destructive = false,
}) {
  if (confirmDialogResolver) {
    confirmDialogResolver(false);
  }

  confirmDialog.value = {
    open: true,
    title,
    message,
    confirmText,
    cancelText,
    destructive,
  };

  return new Promise((resolve) => {
    confirmDialogResolver = resolve;
  });
}

function resolveConfirmation(confirmed) {
  const resolver = confirmDialogResolver;
  confirmDialogResolver = null;
  confirmDialog.value = {
    ...confirmDialog.value,
    open: false,
  };

  if (resolver) {
    resolver(confirmed);
  }
}

function clearErrorMessage() {
  errorMessage.value = '';
}

function buildPendingTransitionViewModels() {
  if (shouldSkipTransitionPages.value) {
    return [];
  }

  const preAttemptIntro = buildPreAttemptIntroViewModel();
  if (preAttemptIntro) {
    return [preAttemptIntro];
  }

  if (!attempt.value || !currentQuestion.value) {
    return [];
  }

  return [
    buildSubjectPartTransitionViewModel(currentQuestion.value),
    buildReadingPassageSetTransitionViewModel(currentQuestion.value, currentGroup.value),
  ].filter((viewModel) => viewModel && !hasTransitionBeenAcknowledged(viewModel.key));
}

function buildPreAttemptIntroViewModel() {
  if (!preAttemptIntroPending.value || attempt.value || sectionChoiceOpen.value || isReviewMode.value) {
    return null;
  }

  return {
    key: 'pre-attempt:intro',
    type: TRANSITION_VIEW_TYPES.PRE_ATTEMPT_INTRO,
    title: `${examDisplayTitle.value} Instructions`,
    body: 'Review the exam directions before choosing your starting section.',
    contextItems: ['Before the exam'],
    actionLabel: 'Start',
  };
}

function buildSubjectPartTransitionViewModel(question) {
  const sectionCode = getQuestionSectionCode(question);
  const group = getQuestionGroup(question.questionNumber);
  if (!sectionCode || !isSubjectEntryQuestion(question, group)) {
    return null;
  }

  const subjectLabel = getSectionLabel({ sectionCode });
  const part = getPartForSectionCode(sectionCode);
  const body = normalizeTransitionText(part?.partIntro || part?.intro)
    || DEFAULT_SUBJECT_INTROS[sectionCode]
    || 'Read the directions for this section before continuing.';

  return {
    key: `subject:${sectionCode}`,
    type: TRANSITION_VIEW_TYPES.SUBJECT_PART_INTRO,
    title: `${subjectLabel} Instructions`,
    body,
    contextItems: [subjectLabel],
    actionLabel: 'Continue',
  };
}

function buildReadingPassageSetTransitionViewModel(question, group) {
  const sectionCode = getQuestionSectionCode(question);
  if (sectionCode !== 'ELA' || !group || group.type !== 'reading' || !isGroupEntryQuestion(question, group)) {
    return null;
  }

  const material = question.material || findMaterial(question);
  const materialCategory = normalizeTransitionText(material?.materialCategory || material?.category) || 'Reading Passage';
  const subType = getSubTypeForQuestion(question);
  const subTypeName = normalizeTransitionText(subType?.subTypeName || subType?.name || question?.subTypeName);
  const subTypeIntro = normalizeTransitionText(subType?.subTypeIntro || subType?.intro);
  const title = `${materialCategory} Set`;
  const body = subTypeIntro
    || `Read this ${materialCategory.toLowerCase()} and answer the questions in this set.`;
  const contextItems = [
    group.label,
    materialCategory,
    subTypeName,
  ].filter(Boolean);

  return {
    key: `reading-set:${group.id}`,
    type: TRANSITION_VIEW_TYPES.READING_PASSAGE_SET_INTRO,
    title,
    body,
    contextItems,
    actionLabel: 'Continue',
  };
}

function acknowledgeTransitionViewModel(viewModel = activeTransitionViewModel.value) {
  if (!viewModel?.key) {
    return;
  }

  acknowledgedTransitionKeys.value = new Set([...acknowledgedTransitionKeys.value, viewModel.key]);
}

function continueTransitionViewModel(viewModel = activeTransitionViewModel.value) {
  if (!viewModel) {
    return;
  }

  if (viewModel.type === TRANSITION_VIEW_TYPES.PRE_ATTEMPT_INTRO) {
    startPreAttemptIntro();
    return;
  }

  acknowledgeTransitionViewModel(viewModel);
  reviewPanelOpen.value = false;
  saveMessage.value = '';
}

function getTransitionEyebrow(viewModel) {
  if (viewModel?.type === TRANSITION_VIEW_TYPES.READING_PASSAGE_SET_INTRO) {
    return 'Reading Set';
  }
  if (viewModel?.type === TRANSITION_VIEW_TYPES.PRE_ATTEMPT_INTRO) {
    return 'Start';
  }
  return 'Section';
}

function hasTransitionBeenAcknowledged(key) {
  return acknowledgedTransitionKeys.value.has(key);
}

function isSubjectEntryQuestion(question, group) {
  if (!isGroupEntryQuestion(question, group)) {
    return false;
  }

  const sectionGroups = questionAccessState.value.groups.filter((candidate) => candidate.section === getQuestionSectionCode(question));
  const firstGroup = sectionGroups[0] || null;
  return Boolean(firstGroup && group && firstGroup.id === group.id);
}

function isGroupEntryQuestion(question, group) {
  return Boolean(question && group && Number(question.questionNumber) === Number(group.startQuestionNumber));
}

function getPartForSectionCode(sectionCode) {
  return getAvailableParts().find((part) => {
    const partSectionCode = normalizeTransitionSectionCode(part?.partCode || part?.partName || part?.subject);
    return partSectionCode === sectionCode;
  }) || null;
}

function getAvailableSubTypes() {
  return attempt.value?.subTypes?.length ? attempt.value.subTypes : paper.value?.subTypes || [];
}

function getSubTypeForQuestion(question) {
  const subTypeId = question?.subTypeId ?? question?.sub_type_id;
  if (subTypeId === null || subTypeId === undefined) {
    return null;
  }

  return getAvailableSubTypes().find((subType) => String(subType.subTypeId) === String(subTypeId)) || null;
}

function normalizeTransitionSectionCode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized.includes('MATH')) {
    return 'MATH';
  }
  if (normalized.includes('ELA') || normalized.includes('ENGLISH') || normalized.includes('READ')) {
    return 'ELA';
  }
  return normalized;
}

function normalizeTransitionText(value) {
  return String(value || '').trim();
}

function isSameGroup(leftGroup, rightGroup) {
  return Boolean(leftGroup?.id && rightGroup?.id && leftGroup.id === rightGroup.id);
}

function isGroupAnswered(group) {
  return Boolean(group) && group.questions.every((question) => isQuestionComplete(question));
}

function isSectionAnswered(sectionCode = currentSectionCode.value) {
  const sectionQuestions = questions.value.filter((question) => getQuestionSectionCode(question) === sectionCode);
  return sectionQuestions.length > 0 && sectionQuestions.every((question) => isQuestionComplete(question));
}

function getNextSectionCode() {
  return getNextAvailableSectionCode(currentSectionCode.value, availableSectionOrder.value);
}

function hasNextSection() {
  return Boolean(getNextSectionCode());
}

function getFirstQuestionInSection(sectionCode) {
  return questions.value.find((question) => getQuestionSectionCode(question) === sectionCode) || null;
}

function isImmediateNextGroup(targetGroup) {
  const sourceGroup = currentGroup.value;
  if (!sourceGroup || !targetGroup) {
    return false;
  }

  const groups = questionAccessState.value.groups;
  const sourceIndex = groups.findIndex((group) => group.id === sourceGroup.id);
  const targetIndex = groups.findIndex((group) => group.id === targetGroup.id);
  return sourceIndex >= 0 && targetIndex === sourceIndex + 1;
}

function canAdvanceToQuestion(targetQuestion) {
  if (!targetQuestion) {
    return false;
  }
  if (isReadOnlyMode.value || canUseFreeQuestionNavigation.value) {
    return true;
  }

  const sourceGroup = currentGroup.value;
  const targetGroup = getQuestionGroup(targetQuestion.questionNumber);
  if (sourceGroup && targetGroup && isSameGroup(sourceGroup, targetGroup)) {
    return true;
  }
  if (!sourceGroup || !targetGroup || !isImmediateNextGroup(targetGroup)) {
    return false;
  }

  if (sourceGroup.type === 'single' && !isQuestionComplete(currentQuestion.value)) {
    return false;
  }

  if (sourceGroup.type === 'reading' && !isGroupAnswered(sourceGroup)) {
    return false;
  }

  return getQuestionSectionCode(targetQuestion) === currentSectionCode.value;
}

function canAttemptAdvanceToQuestion(targetQuestion) {
  if (!targetQuestion) {
    return false;
  }
  if (isReadOnlyMode.value || canVisitQuestion(targetQuestion)) {
    return true;
  }

  const sourceGroup = currentGroup.value;
  const targetGroup = getQuestionGroup(targetQuestion.questionNumber);
  return Boolean(
    sourceGroup
    && targetGroup
    && !isSameGroup(sourceGroup, targetGroup)
    && isImmediateNextGroup(targetGroup)
    && getQuestionSectionCode(targetQuestion) === currentSectionCode.value
  );
}

function getAdvanceBlockedMessage(targetQuestion) {
  const sourceGroup = currentGroup.value;
  const targetGroup = targetQuestion ? getQuestionGroup(targetQuestion.questionNumber) : null;

  if (!sourceGroup || !targetGroup) {
    return 'This question is not open yet.';
  }
  if (sourceGroup.type === 'reading' && !isGroupAnswered(sourceGroup)) {
    return readingGroupIncompleteMessage(getIncompleteQuestionNumbers(sourceGroup.questions));
  }
  if (sourceGroup.type === 'single' && !isQuestionComplete(currentQuestion.value)) {
    return getQuestionCompletionIssue(currentQuestion.value, getAnswer(currentQuestion.value.questionNumber));
  }
  if (getQuestionSectionCode(targetQuestion) !== currentSectionCode.value) {
    return 'Submit the current section before moving to the next section.';
  }
  return 'This question is not open yet.';
}

async function saveQuestions(targetQuestions) {
  const dirtyQuestions = targetQuestions.filter((question) => {
    return hasMeaningfulAnswerValue(getAnswer(question.questionNumber)) && !isQuestionSaved(question.questionNumber);
  });

  for (const question of dirtyQuestions) {
    await saveAnswer(question);
  }
}

async function saveCurrentAnswerForFreeNavigation() {
  if (!currentQuestion.value || !attemptId.value || isQuestionSaved(currentQuestion.value.questionNumber)) {
    return;
  }
  if (!hasMeaningfulAnswerValue(getAnswer(currentQuestion.value.questionNumber))) {
    return;
  }

  try {
    await saveAnswer(currentQuestion.value);
  } catch (error) {
    examFlowLogger.error('answer-save.free-navigation-failed', examFlowContext({
      error: summarizeError(error),
    }));
    // Staff navigation is intentionally ungated; the local answer remains available for retry or final submit.
  }
}

async function confirmLeaveCurrentQuestion(targetQuestion) {
  if (!targetQuestion || isReadOnlyMode.value || canUseFreeQuestionNavigation.value) {
    return true;
  }

  if (!canAdvanceToQuestion(targetQuestion)) {
    const confirmed = await requestConfirmation({
      title: 'Complete Current Question',
      message: getAdvanceBlockedMessage(targetQuestion),
      confirmText: 'Stay Here',
      cancelText: 'Close',
    });
    if (!confirmed) {
      errorMessage.value = getAdvanceBlockedMessage(targetQuestion);
    }
    return false;
  }

  return true;
}

function getQuestionGroupLabel(questionNumber) {
  const group = getQuestionGroup(questionNumber);
  if (!group || group.type !== 'reading') {
    return '';
  }

  return group.isDiscontinuousMaterial
    ? `Reading material ${group.materialId}, segment ${group.segmentIndex + 1}`
    : `Reading group ${group.label}`;
}

function getAnswerText(questionNumber) {
  const value = getAnswer(questionNumber);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const answerArray = value.answers || value.selectedAnswers || value.selectedIds || value.regions;
    if (Array.isArray(answerArray)) {
      return answerArray.join(',');
    }
    if (typeof value.value === 'string') {
      return value.value.trim();
    }
    return JSON.stringify(value);
  }
  return Array.isArray(value) ? value.join(',') : String(value || '').trim();
}

function buildAnswerPayload(question) {
  recordCurrentQuestionTime();
  const answerValue = getAnswer(question.questionNumber);
  const answerText = getAnswerText(question.questionNumber);
  const choiceQuestion = isChoiceQuestion(question);
  const answerData = buildAnswerData(question, answerValue, answerText);

  return {
    questionId: question.questionId,
    questionNumber: question.questionNumber,
    questionType: question.questionType,
    answerData: JSON.stringify(answerData),
    selectedAnswer: choiceQuestion ? answerText : '',
    timeSpent: timeSpentByQuestion.value[question.questionNumber] || 0,
    bookmarked: false,
    marked: isMarked(question.questionNumber),
    answerNotes: '',
  };
}

function buildAnswerData(question, answerValue, answerText) {
  const definition = getQuestionTypeDefinition(question.questionType);
  if (definition.migrated) {
    return definition.normalizeAnswerData(answerValue, { question, questionType: question.questionType });
  }

  if (isChoiceQuestion(question)) {
    return {
      answers: isMultiSelectQuestion(question) ? getAnswerList(question.questionNumber) : [answerText].filter(Boolean),
    };
  }
  if (isTextQuestion(question) || isEquationQuestion(question)) {
    return { value: answerText };
  }
  if (answerValue && typeof answerValue === 'object' && !Array.isArray(answerValue)) {
    return answerValue;
  }
  return { value: answerText };
}

function startQuestionTimer() {
  activeQuestionEnteredAt = Date.now();
}

async function syncAttemptPresence() {
  // 考试页切题和定时心跳共用这个入口；失败只记日志，不阻塞学生答题。
  if (isReviewMode.value || isReadOnlyMode.value || !attemptId.value || !currentQuestion.value || presenceRequestInFlight) {
    return;
  }

  presenceRequestInFlight = true;
  try {
    await studentApi.updateAttemptPresence(attemptId.value, {
      questionNumber: currentQuestion.value.questionNumber,
    });
  } catch (error) {
    examFlowLogger.error('presence-update.failed', examFlowContext({
      question: summarizeQuestion(currentQuestion.value),
      error: summarizeError(error),
    }));
  } finally {
    presenceRequestInFlight = false;
  }
}

function startPresenceTracking() {
  stopPresenceTracking();
  syncAttemptPresence();
  presenceTimer.value = window.setInterval(syncAttemptPresence, 10000);
}

function stopPresenceTracking() {
  if (!presenceTimer.value) {
    return;
  }
  window.clearInterval(presenceTimer.value);
  presenceTimer.value = null;
}

function recordCurrentQuestionTime() {
  if (isReadOnlyMode.value || !currentQuestion.value || !activeQuestionEnteredAt) {
    return;
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - activeQuestionEnteredAt) / 1000));
  if (elapsedSeconds <= 0) {
    return;
  }

  const questionNumber = currentQuestion.value.questionNumber;
  timeSpentByQuestion.value = {
    ...timeSpentByQuestion.value,
    [questionNumber]: (timeSpentByQuestion.value[questionNumber] || 0) + elapsedSeconds,
  };
  activeQuestionEnteredAt = Date.now();
}

function updateDragDrop(question, itemId, zoneId) {
  setAnswerField(question.questionNumber, 'matches', {
    ...(getStructuredAnswer(question.questionNumber).matches || {}),
    [itemId]: zoneId,
  });
}

function toggleStructuredId(question, fieldName, id) {
  const current = getStructuredAnswer(question.questionNumber);
  const selected = Array.isArray(current[fieldName]) ? current[fieldName] : [];
  const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  setAnswerField(question.questionNumber, fieldName, next);
}

function updateGraphPoint(question, axis, value) {
  const current = getStructuredAnswer(question.questionNumber);
  const point = current.points?.[0] || { x: '', y: '' };
  const nextValue = String(value ?? '').trim();
  setAnswerField(question.questionNumber, 'points', [{ ...point, [axis]: nextValue === '' ? '' : Number(nextValue) }]);
}

async function goQuestion(index) {
  if (navigationLoading.value) {
    return;
  }

  navigationLoading.value = true;
  try {
    await goQuestionInternal(index);
  } catch (error) {
    examFlowLogger.error('navigation.failed', examFlowContext({ targetIndex: index, error: summarizeError(error) }));
    throw error;
  } finally {
    navigationLoading.value = false;
  }
}

async function goQuestionInternal(index) {
  if (index < 0 || index >= questions.value.length) {
    return;
  }
  if (activeTransitionViewModel.value && index !== currentIndex.value) {
    return;
  }

  const targetQuestion = questions.value[index];
  const sourceGroup = currentGroup.value;
  const targetGroup = getQuestionGroup(targetQuestion.questionNumber);
  const isFreeNavigation = canUseFreeQuestionNavigation.value;
  const isAdvancingGroup = !isReadOnlyMode.value
    && !isFreeNavigation
    && sourceGroup
    && targetGroup
    && !isSameGroup(sourceGroup, targetGroup)
    && isImmediateNextGroup(targetGroup)
    && getQuestionSectionCode(targetQuestion) === currentSectionCode.value;

  if (!isReadOnlyMode.value && index !== currentIndex.value) {
    recordCurrentQuestionTime();
    if (!(await confirmLeaveCurrentQuestion(targetQuestion))) {
      startQuestionTimer();
      return;
    }

    try {
      if (isFreeNavigation) {
        await saveCurrentAnswerForFreeNavigation();
      } else if (isAdvancingGroup && sourceGroup) {
        await saveQuestions(sourceGroup.questions);
      } else if (!(await saveCurrentAnswer())) {
        startQuestionTimer();
        return;
      }
    } catch {
      startQuestionTimer();
      return;
    }

  }

  currentIndex.value = index;
  persistLastViewedQuestion();
  startQuestionTimer();
  syncAttemptPresence();
  saveMessage.value = '';
  reviewPanelOpen.value = false;
}

function toOpenGroup(group) {
  if (!group) {
    return null;
  }

  return {
    groupKey: group.id,
    section: group.section,
    materialId: group.materialId ? Number(group.materialId) : null,
    questionNumbers: [...group.questionNumbers],
  };
}

async function submitSection() {
  if (isReadOnlyMode.value || submitLoading.value || navigationLoading.value || activeTransitionViewModel.value) {
    return;
  }

  if (!currentQuestion.value) {
    return;
  }

  reviewPanelOpen.value = false;
  widthMenuOpen.value = false;
  fontMenuOpen.value = false;
  highlightMenuOpen.value = false;
  drawingMenuOpen.value = false;

  try {
    if (currentGroup.value) {
      await saveQuestions(currentGroup.value.questions);
    }
  } catch {
    return;
  }

  if (isPracticeAttempt.value) {
    await submitExam();
    return;
  }

  // Admin and teacher use the live page for preview/proctoring, so they may submit a section
  // even when questions are unanswered; the student completion gate stays in place for students.
  if (!canUseFreeQuestionNavigation.value && !isSectionAnswered(currentSectionCode.value)) {
    const incompleteNumbers = getIncompleteQuestionNumbers(currentSectionQuestions.value);
    errorMessage.value = `Complete this section before submitting. Incomplete questions: ${formatQuestionNumbers(incompleteNumbers)}.`;
    return;
  }

  const nextSection = getNextSectionCode();
  if (!nextSection) {
    await submitExam();
    return;
  }

  const firstQuestion = getFirstQuestionInSection(nextSection);
  const targetGroup = firstQuestion ? getQuestionGroup(firstQuestion.questionNumber) : null;
  if (!firstQuestion || !targetGroup) {
    errorMessage.value = 'The next section is not available.';
    return;
  }

  const confirmed = await requestConfirmation({
    title: 'Submit Section?',
    message: 'You will not be able to return to this section after continuing.',
    confirmText: 'Submit Section',
    cancelText: 'Keep Working',
    destructive: true,
  });
  if (!confirmed) {
    return;
  }

  submitLoading.value = true;
  try {
    const progressUpdate = unwrapResponse(
      await studentApi.submitSection(attemptId.value, currentSectionCode.value),
      'Failed to submit this section'
    );
    applyProgressUpdate(progressUpdate);

    const openQuestionNumber = progressUpdate?.progressState?.currentOpenGroup?.questionNumbers?.[0]
      || firstQuestion.questionNumber;
    const openQuestionIndex = questions.value.findIndex((question) => question.questionNumber === openQuestionNumber);
    currentIndex.value = openQuestionIndex >= 0
      ? openQuestionIndex
      : questions.value.findIndex((question) => question.questionNumber === firstQuestion.questionNumber);
    startQuestionTimer();
    syncAttemptPresence();
    reviewPanelOpen.value = false;
    saveMessage.value = `${getSectionLabel({ sectionCode: currentSectionCode.value })} section is open`;
  } catch (error) {
    examFlowLogger.error('section-submit.failed', examFlowContext({ nextSection, error: summarizeError(error) }));
    errorMessage.value = error.message || 'Failed to submit this section. Please try again.';
  } finally {
    submitLoading.value = false;
  }
}

async function goBack() {
  if (isPreviewMode.value) {
    const previousRoute = router.options.history.state.back;
    if (typeof previousRoute === 'string' && previousRoute !== route.fullPath) {
      router.back();
      return;
    }

    router.push({ name: 'shsat-admin', query: { tab: 'papers' } });
    return;
  }

  if (!isReadOnlyMode.value && currentQuestion.value) {
    if (hasAnswer(currentQuestion.value.questionNumber)) {
      const saved = await saveCurrentAnswer();
      if (!saved) {
        return;
      }
    } else {
      const confirmed = await requestConfirmation({
        title: 'Leave Exam Page',
        message: 'The current question has no response. Do you want to leave the exam page?',
        confirmText: 'Leave',
        cancelText: 'Stay Here',
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
    }
  }

  if (returnTo.value) {
    router.push(returnTo.value);
    return;
  }

  router.push({ name: 'student' });
}

async function goQuestionByNumber(questionNumber) {
  const index = questions.value.findIndex((question) => question.questionNumber === questionNumber);
  await goQuestion(index);
}

function toggleReviewPanel() {
  reviewPanelOpen.value = !reviewPanelOpen.value;
  widthMenuOpen.value = false;
}

function setReviewFilter(filter) {
  currentFilter.value = filter;
}

function canNavigateFromReviewPanel(question) {
  if (!question || navigationLoading.value) {
    return false;
  }
  if (activeTransitionViewModel.value) {
    return question.questionNumber === currentQuestion.value?.questionNumber;
  }

  if (question.questionNumber === currentQuestion.value?.questionNumber) {
    return true;
  }

  return canAttemptAdvanceToQuestion(question);
}

async function handleReviewQuestionClick(question) {
  if (!canNavigateFromReviewPanel(question)) {
    return;
  }

  await goQuestionByNumber(question.questionNumber);
}

function toggleMark() {
  if (!currentQuestion.value || isCurrentQuestionReadOnly.value) {
    return;
  }

  const questionNumber = currentQuestion.value.questionNumber;
  const nextMarked = new Set(markedQuestionNumbers.value);
  if (nextMarked.has(questionNumber)) {
    nextMarked.delete(questionNumber);
  } else {
    nextMarked.add(questionNumber);
  }
  markedQuestionNumbers.value = nextMarked;
}

function clearCurrentAnswer() {
  if (!currentQuestion.value || isCurrentQuestionReadOnly.value) {
    return;
  }

  setAnswer(currentQuestion.value.questionNumber, '');
}

function toggleNotes() {
  notesOpen.value = !notesOpen.value;
  widthMenuOpen.value = false;
  fontMenuOpen.value = false;
  highlightMenuOpen.value = false;
  drawingMenuOpen.value = false;
  reviewPanelOpen.value = false;
}

function toggleWidthMenu() {
  widthMenuOpen.value = !widthMenuOpen.value;
  fontMenuOpen.value = false;
  highlightMenuOpen.value = false;
  drawingMenuOpen.value = false;
  reviewPanelOpen.value = false;
}

function setWidthMode(mode) {
  widthMode.value = mode;
  widthMenuOpen.value = false;
}

function getWidthLabel(mode) {
  const labels = {
    normal: 'Normal',
    wide: 'Wide',
    'ultra-wide': 'Extra Wide',
  };
  return labels[mode] || labels.normal;
}

function toggleFontMenu() {
  fontMenuOpen.value = !fontMenuOpen.value;
  widthMenuOpen.value = false;
  highlightMenuOpen.value = false;
  drawingMenuOpen.value = false;
  reviewPanelOpen.value = false;
}

function setFontScale(scale) {
  fontScale.value = scale;
  fontMenuOpen.value = false;
}

const fontScaleStyle = computed(() => ({ '--exam-font-scale': fontScale.value }));

// ==================== 防作弊：全屏 + 切屏检测 ====================
// 同一次切出可能触发多个浏览器事件，用 activeFocusLossReasons 按"连续离开状态"只计一次。
function captureExamScreenMetrics() {
  const visualViewport = window.visualViewport;
  return {
    fullscreen: Boolean(document.fullscreenElement),
    fullscreenEnabled: document.fullscreenEnabled !== false,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    screenWidth: window.screen?.width ?? null,
    screenHeight: window.screen?.height ?? null,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    visualViewportWidth: visualViewport ? Math.round(visualViewport.width) : null,
    visualViewportHeight: visualViewport ? Math.round(visualViewport.height) : null,
    visualViewportScale: visualViewport?.scale ?? null,
    devicePixelRatio: window.devicePixelRatio,
    userActivationActive: navigator.userActivation?.isActive ?? null,
    chromeOs: /CrOS/.test(navigator.userAgent),
  };
}

// 只记录考试窗口状态；ChromeOS 放大镜开关本身不向普通网页开放。
function logExamScreenDiagnostic(event, details = {}) {
  if (!screenDiagnosticsStarted) {
    return;
  }
  const metrics = captureExamScreenMetrics();
  const diagnostic = {
    ...metrics,
    elapsedMs: screenDiagnosticStartedAt ? Date.now() - screenDiagnosticStartedAt : null,
    examElapsedMs: attempt.value?.duration != null && Number.isFinite(Number(remainingSeconds.value))
      ? Math.max(0, Number(attempt.value.duration) * 60 - Number(remainingSeconds.value)) * 1000
      : null,
    ...details,
  };
  examFlowLogger.diagnostic(event, {
    examId: examId.value || null,
    attemptId: attemptId.value || null,
    ...diagnostic,
    // 兼容线上尚未重启的日志服务：旧接口会保留 reason，但不会输出新增的结构化字段。
    reason: JSON.stringify(diagnostic),
  });
}

function handleExamScreenResize() {
  if (!screenDiagnosticsStarted || loggedViewportChanges >= SCREEN_DIAGNOSTIC_MAX_VIEWPORT_CHANGES) {
    return;
  }
  window.clearTimeout(screenResizeTimer);
  screenResizeTimer = window.setTimeout(() => {
    const current = captureExamScreenMetrics();
    const previous = lastScreenMetrics;
    if (!screenDiagnosticsStarted || !previous) {
      return;
    }
    const changed = ['viewportWidth', 'viewportHeight', 'visualViewportWidth', 'visualViewportHeight']
      .some((key) => current[key] !== null && previous[key] !== null
        && Math.abs(current[key] - previous[key]) >= SCREEN_DIAGNOSTIC_MIN_SIZE_CHANGE_PX);
    if (changed || Math.abs((current.visualViewportScale ?? 1) - (previous.visualViewportScale ?? 1)) >= 0.1) {
      loggedViewportChanges += 1;
      logExamScreenDiagnostic('exam-screen.viewport-change', {
        previousViewportWidth: previous.viewportWidth,
        previousViewportHeight: previous.viewportHeight,
      });
      lastScreenMetrics = current;
    }
  }, SCREEN_DIAGNOSTIC_RESIZE_DELAY_MS);
}

function isFullscreenSupported() {
  return typeof document.documentElement.requestFullscreen === 'function'
    && document.fullscreenEnabled !== false;
}

function startScreenDiagnostics() {
  if (screenDiagnosticsStarted) {
    return;
  }
  screenDiagnosticsStarted = true;
  screenDiagnosticStartedAt = Date.now();
  loggedFullscreenAttempts = 0;
  loggedFullscreenChanges = 0;
  loggedViewportChanges = 0;
  loggedFocusChanges = 0;
  loggedVisibilityChanges = 0;
  loggedAccessibilityShortcuts = 0;
  loggedDuplicateFullscreenRequests = 0;
  lastScreenMetrics = captureExamScreenMetrics();
  logExamScreenDiagnostic('exam-screen.session-start');
}

function clearFocusLossIfRecovered() {
  if (document.visibilityState === 'visible' && document.fullscreenElement) {
    activeFocusLossReasons.clear();
  }
}

function enterExamFullscreen(source = 'unknown') {
  if (fullscreenRequestInFlight) {
    if (loggedDuplicateFullscreenRequests < 3) {
      loggedDuplicateFullscreenRequests += 1;
      logExamScreenDiagnostic('exam-screen.fullscreen-duplicate', { source, requestCount: fullscreenRequestCount });
    }
    return fullscreenRequestInFlight;
  }
  if (document.fullscreenElement) {
    window.clearTimeout(fullscreenExitConfirmTimer);
    isFullscreen.value = true;
    hadExamFullscreen = true;
    fullscreenRequiredOverlay.value = false;
    fullscreenError.value = '';
    clearFocusLossIfRecovered();
    return Promise.resolve(true);
  }
  if (!isFullscreenSupported()) {
    logExamScreenDiagnostic('exam-screen.fullscreen-result', { source, result: 'unsupported' });
    fullscreenError.value = 'Fullscreen is not supported by this browser. Please use a supported desktop browser.';
    return Promise.resolve(false);
  }
  fullscreenRequestCount += 1;
  const logAttempt = loggedFullscreenAttempts < SCREEN_DIAGNOSTIC_MAX_FULLSCREEN_ATTEMPTS;
  if (logAttempt) {
    loggedFullscreenAttempts += 1;
    logExamScreenDiagnostic('exam-screen.fullscreen-request', { source, requestCount: fullscreenRequestCount });
  }
  let request;
  try {
    // 必须在点击处理器同步执行 requestFullscreen，不能先等待创建考试或加载试卷。
    request = document.documentElement.requestFullscreen();
  } catch (error) {
    request = Promise.reject(error);
  }
  fullscreenRequestInFlight = Promise.resolve(request).then(() => {
    if (!document.fullscreenElement) {
      fullscreenError.value = 'Fullscreen ended before the exam could continue. Click Retry Fullscreen.';
      if (isExamSessionActive.value) {
        fullscreenRequiredOverlay.value = true;
      }
      logExamScreenDiagnostic('exam-screen.fullscreen-result', {
        source,
        result: 'exited-before-confirmation',
        requestCount: fullscreenRequestCount,
      });
      return false;
    }
    window.clearTimeout(fullscreenExitConfirmTimer);
    isFullscreen.value = true;
    hadExamFullscreen = true;
    violationMonitoringReadyAt = Date.now() + VIOLATION_MONITORING_GRACE_MS;
    fullscreenRequiredOverlay.value = false;
    fullscreenError.value = '';
    clearFocusLossIfRecovered();
    if (logAttempt) {
      logExamScreenDiagnostic('exam-screen.fullscreen-result', { source, result: 'entered', requestCount: fullscreenRequestCount });
    }
    return true;
  }, (error) => {
    logExamScreenDiagnostic('exam-screen.fullscreen-result', {
      source,
      result: 'rejected',
      requestCount: fullscreenRequestCount,
      errorName: error?.name || 'Error',
      errorMessage: error?.message || 'Unknown error',
    });
    examFlowLogger.error('fullscreen.enter-failed', examFlowContext({ source, error: summarizeError(error) }));
    isFullscreen.value = false;
    fullscreenError.value = 'Fullscreen could not start. Check browser permissions, then click Retry Fullscreen.';
    if (isExamSessionActive.value) {
      fullscreenRequiredOverlay.value = true;
    }
    return false;
  }).finally(() => {
    fullscreenRequestInFlight = null;
  });
  return fullscreenRequestInFlight;
}

// 交卷/离开等正常流程退出全屏，不应计入切屏违规。
function exitExamFullscreen(source = 'leave-exam') {
  hadExamFullscreen = false;
  window.clearTimeout(fullscreenExitConfirmTimer);
  if (document.fullscreenElement && document.exitFullscreen) {
    legitFullscreenExit.value = true;
    try {
      Promise.resolve(document.exitFullscreen()).catch((error) => {
        logExamScreenDiagnostic('exam-screen.fullscreen-exit-failed', {
          source,
          errorName: error?.name || 'Error',
          errorMessage: error?.message || 'Unknown error',
        });
        legitFullscreenExit.value = false;
        isFullscreen.value = Boolean(document.fullscreenElement);
      });
    } catch (error) {
      logExamScreenDiagnostic('exam-screen.fullscreen-exit-failed', {
        source,
        errorName: error?.name || 'Error',
        errorMessage: error?.message || 'Unknown error',
      });
      legitFullscreenExit.value = false;
      isFullscreen.value = Boolean(document.fullscreenElement);
      return;
    }
  }
  isFullscreen.value = false;
}

function handleFullscreenChange() {
  const fullscreenActive = Boolean(document.fullscreenElement);
  isFullscreen.value = fullscreenActive;
  if (screenDiagnosticsStarted && loggedFullscreenChanges < SCREEN_DIAGNOSTIC_MAX_STATE_CHANGES) {
    loggedFullscreenChanges += 1;
    logExamScreenDiagnostic('exam-screen.fullscreen-change', {
      reason: legitFullscreenExit.value ? 'expected-exit' : 'browser-event',
    });
  }
  if (fullscreenActive) {
    window.clearTimeout(fullscreenExitConfirmTimer);
    if (isExamSessionActive.value) {
      hadExamFullscreen = true;
    }
    fullscreenRequiredOverlay.value = false;
    clearFocusLossIfRecovered();
    fullscreenError.value = '';
    return;
  }
  // 正常流程（交卷/离开）触发的退全屏不计违规。
  if (legitFullscreenExit.value) {
    legitFullscreenExit.value = false;
    return;
  }
  if (!hadExamFullscreen || !isExamSessionActive.value) {
    return;
  }
  // 浏览器进出全屏会瞬时触发 fullscreenchange(null)，延迟确认是否真的退出全屏，避免误判弹遮罩。
  window.clearTimeout(fullscreenExitConfirmTimer);
  fullscreenExitConfirmTimer = window.setTimeout(() => {
    if (document.fullscreenElement || !isExamSessionActive.value) {
      return;
    }
    hadExamFullscreen = false;
    // 考试中途退出全屏：按宽限规则计一次切出；即使处于宽限期，也必须重新进入全屏。
    registerExamFocusViolation('fullscreen-exit');
    fullscreenRequiredOverlay.value = true;
  }, FULLSCREEN_EXIT_CONFIRM_MS);
}

function handleFullscreenError(event) {
  logExamScreenDiagnostic('exam-screen.fullscreen-error', { eventType: event.type });
  if (isExamSessionActive.value && !document.fullscreenElement) {
    fullscreenError.value = 'Fullscreen could not start. Check browser permissions, then click Retry Fullscreen.';
    fullscreenRequiredOverlay.value = true;
  }
}

function handleExamWindowFocus(event) {
  if (!screenDiagnosticsStarted || loggedFocusChanges >= SCREEN_DIAGNOSTIC_MAX_FOCUS_CHANGES) {
    return;
  }
  loggedFocusChanges += 1;
  logExamScreenDiagnostic('exam-screen.window-focus', { eventType: event.type });
}

function handleExamKeydown(event) {
  const key = event.key?.toLowerCase();
  if (screenDiagnosticsStarted && loggedAccessibilityShortcuts < 2
    && event.ctrlKey && event.metaKey && ['d', 'h'].includes(key)) {
    loggedAccessibilityShortcuts += 1;
    logExamScreenDiagnostic('exam-screen.accessibility-shortcut-observed', {
      shortcut: `Ctrl+Search+${key.toUpperCase()}`,
    });
  }
}

// 每次切出（切窗口/切标签页/退出全屏）只统计一次并弹窗提醒，即时上报服务端；不自动交卷。
// 返回是否真正登记了本次切出（被去重/宽限期拦截时返回 false）。
function registerExamFocusViolation(reason) {
  if (!isExamSessionActive.value || autoSubmitStarted.value || submitLoading.value) {
    return false;
  }
  if (Date.now() < violationMonitoringReadyAt || activeFocusLossReasons.size > 0) {
    return false;
  }
  activeFocusLossReasons.add(reason);

  focusViolationCount.value += 1;
  examFlowLogger.error('exam-focus.violation', examFlowContext({
    reason,
    violationNumber: focusViolationCount.value,
    visibilityState: document.visibilityState,
    fullscreen: Boolean(document.fullscreenElement),
  }));

  void recordFocusViolationOnServer();
  focusViolationModalCount.value = focusViolationCount.value;
  focusViolationModalOpen.value = true;
  return true;
}

// 即时把切出次数上报到服务端累加，报告以服务端计数为准，避免页面重载导致前端计数丢失。
async function recordFocusViolationOnServer() {
  if (!attemptId.value || autoSubmitStarted.value || submitLoading.value) {
    return;
  }
  try {
    const count = unwrapResponse(
      await studentApi.recordFocusViolation(attemptId.value),
      'Failed to record focus violation'
    );
    const numericCount = Number(count);
    if (Number.isFinite(numericCount) && numericCount > focusViolationCount.value) {
      focusViolationCount.value = numericCount;
    }
  } catch (error) {
    examFlowLogger.error('exam-focus.record-failed', examFlowContext({ error: summarizeError(error) }));
  }
}

async function dismissFocusViolationModal() {
  // 点击确认后先恢复全屏，成功才关闭警告窗继续考试。
  const entered = await enterExamFullscreen('violation-dialog-click');
  if (!entered) {
    return;
  }
  focusViolationModalOpen.value = false;
}

function handleExamVisibilityChange() {
  // 只有页面真正进入 hidden 才算离开，普通控件焦点变化不会触发切屏记录。
  if (document.visibilityState === 'hidden') {
    if (loggedVisibilityChanges < SCREEN_DIAGNOSTIC_MAX_VISIBILITY_CHANGES) {
      loggedVisibilityChanges += 1;
      logExamScreenDiagnostic('exam-screen.visibility-change', { state: 'hidden' });
    }
    stopPresenceTracking();
    // 系统通知、权限弹窗等会瞬时把页面置为 hidden；持续一段时间才计违规，避免误报。
    window.clearTimeout(pageHiddenViolationTimer);
    pageHiddenViolationTimer = window.setTimeout(() => {
      if (document.visibilityState === 'hidden') {
        registerExamFocusViolation('page-hidden');
      }
    }, PAGE_HIDDEN_VIOLATION_DELAY_MS);
    return;
  }
  window.clearTimeout(pageHiddenViolationTimer);
  pageHiddenViolationTimer = 0;
  if (loggedVisibilityChanges < SCREEN_DIAGNOSTIC_MAX_VISIBILITY_CHANGES) {
    loggedVisibilityChanges += 1;
    logExamScreenDiagnostic('exam-screen.visibility-change', { state: 'visible' });
  }
  clearFocusLossIfRecovered();
  if (attempt.value?.status === 'IN_PROGRESS' && !isReviewMode.value && !isPreviewMode.value) {
    startPresenceTracking();
  }
}

async function toggleFullscreen() {
  if (isExamSessionActive.value) {
    await enterExamFullscreen('toolbar-click');
    return;
  }

  if (!document.fullscreenElement) {
    await enterExamFullscreen('toolbar-click');
    return;
  }

  exitExamFullscreen('toolbar-click');
}

function activatePointerTool() {
  highlighterOn.value = false;
  highlightMenuOpen.value = false;
  closeHighlightPopover();
  drawingOn.value = false;
  drawingMenuOpen.value = false;
  eliminateModeOn.value = false;
}

// Highlighter (R-22): wrap the current text selection in a highlight span within exam content.
function toggleHighlighter() {
  highlighterOn.value = !highlighterOn.value;
  if (!highlighterOn.value) {
    closeHighlightPopover();
    return;
  }

  if (highlighterOn.value) {
    drawingOn.value = false;
    drawingMenuOpen.value = false;
    eliminateModeOn.value = false;
  }
}

function setHighlightColor(color) {
  selectedHighlightColor.value = color;
  highlighterOn.value = true;
  highlightMenuOpen.value = false;
  drawingOn.value = false;
  eliminateModeOn.value = false;

  if (pendingHighlightRange.value) {
    applyPendingHighlight(color);
  }
}

function applyHighlightToSelection() {
  if (!highlighterOn.value || isReadOnlyMode.value) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const host = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
  // Only highlight inside highlightable exam regions (passage and question stem).
  if (!host || !host.closest('.exam-highlightable')) {
    return;
  }

  pendingHighlightRange.value = range.cloneRange();
  const rect = range.getBoundingClientRect();
  highlightPopoverPosition.value = {
    left: Math.max(12, Math.min(rect.left + rect.width / 2 - 92, window.innerWidth - 196)),
    top: Math.max(58, rect.top - 48),
  };
}

function applyPendingHighlight(color = selectedHighlightColor.value) {
  const range = pendingHighlightRange.value;
  if (!range) {
    return;
  }

  try {
    const mark = document.createElement('mark');
    mark.className = 'exam-highlight';
    mark.style.backgroundColor = color;
    range.surroundContents(mark);
  } catch {
    // surroundContents throws when the selection crosses element boundaries; ignore such partial selections.
  } finally {
    closeHighlightPopover();
  }
}

function closeHighlightPopover() {
  pendingHighlightRange.value = null;
  window.getSelection()?.removeAllRanges();
}

function clearHighlightSpan(event) {
  // Clicking an existing highlight removes it, mirroring the official toggle behavior.
  if (isReadOnlyMode.value) {
    return;
  }
  const mark = event.target.closest?.('.exam-highlight');
  if (!mark) {
    return;
  }
  const parent = mark.parentNode;
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  parent.normalize();
}

function toggleDrawing() {
  if (isReadOnlyMode.value) {
    return;
  }

  drawingOn.value = !drawingOn.value;
  if (drawingOn.value) {
    highlighterOn.value = false;
    highlightMenuOpen.value = false;
    eliminateModeOn.value = false;
  }
}

function toggleDrawingMenu() {
  drawingMenuOpen.value = !drawingMenuOpen.value;
  widthMenuOpen.value = false;
  fontMenuOpen.value = false;
  highlightMenuOpen.value = false;
  reviewPanelOpen.value = false;
}

function setPenColor(color) {
  selectedPenColor.value = color;
  drawingOn.value = true;
  drawingMenuOpen.value = false;
  highlighterOn.value = false;
  eliminateModeOn.value = false;
}

function getDrawingPoint(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.round((event.clientX - rect.left) * 10) / 10,
    y: Math.round((event.clientY - rect.top) * 10) / 10,
  };
}

function appendDrawingStroke(stroke) {
  if (!currentDrawingKey.value) {
    return;
  }

  drawingStrokesByKey.value = {
    ...drawingStrokesByKey.value,
    [currentDrawingKey.value]: [...currentDrawingStrokes.value, stroke],
  };
}

function updateActiveDrawingStroke(stroke) {
  if (!currentDrawingKey.value) {
    return;
  }

  const existing = currentDrawingStrokes.value;
  drawingStrokesByKey.value = {
    ...drawingStrokesByKey.value,
    [currentDrawingKey.value]: [...existing.slice(0, -1), stroke],
  };
}

function startDrawing(event) {
  if (!drawingOn.value || isReadOnlyMode.value) {
    return;
  }

  event.currentTarget.setPointerCapture?.(event.pointerId);
  const point = getDrawingPoint(event);
  const stroke = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    color: selectedPenColor.value,
    width: 3,
    points: [point],
  };
  activeDrawingStroke.value = stroke;
  appendDrawingStroke(stroke);
}

function moveDrawing(event) {
  if (!drawingOn.value || !activeDrawingStroke.value) {
    return;
  }

  if (event.cancelable) {
    event.preventDefault();
  }

  const nextStroke = {
    ...activeDrawingStroke.value,
    points: [...activeDrawingStroke.value.points, getDrawingPoint(event)],
  };
  activeDrawingStroke.value = nextStroke;
  updateActiveDrawingStroke(nextStroke);
}

function stopDrawing(event) {
  if (!activeDrawingStroke.value) {
    return;
  }

  try {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  } catch {
    // The pointer may already be released when it leaves the drawing layer.
  }
  activeDrawingStroke.value = null;
}

function drawingPath(points = []) {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.1} ${points[0].y + 0.1}`;
  }

  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function clearCurrentDrawing() {
  if (!currentDrawingKey.value || isReadOnlyMode.value) {
    return;
  }

  const next = { ...drawingStrokesByKey.value };
  delete next[currentDrawingKey.value];
  drawingStrokesByKey.value = next;
  activeDrawingStroke.value = null;
}

// Answer Eliminator (R-23): per-question set of struck-out option keys, kept local to this attempt.
function toggleEliminateMode() {
  eliminateModeOn.value = !eliminateModeOn.value;
  if (eliminateModeOn.value) {
    highlighterOn.value = false;
    highlightMenuOpen.value = false;
    drawingOn.value = false;
    drawingMenuOpen.value = false;
  }
}

function eliminatedKeysFor(questionNumber) {
  return eliminatedByQuestion.value[questionNumber] || [];
}

function toggleEliminatedKey(questionNumber, optionKey) {
  const current = eliminatedKeysFor(questionNumber);
  const isEliminating = !current.includes(optionKey);
  const next = isEliminating
    ? [...current, optionKey]
    : current.filter((key) => key !== optionKey);
  eliminatedByQuestion.value = {
    ...eliminatedByQuestion.value,
    [questionNumber]: next,
  };

  if (!isEliminating) {
    return;
  }

  const nextAnswerValue = removeOptionFromAnswerValue(getAnswer(questionNumber), optionKey);
  if (JSON.stringify(nextAnswerValue) !== JSON.stringify(getAnswer(questionNumber))) {
    setAnswer(questionNumber, nextAnswerValue);
  }
}

// Line Reader Mask (R-25): a draggable focus strip that dims the rest of the page.
function toggleLineReader() {
  lineReaderOn.value = !lineReaderOn.value;
}

function startLineReaderDrag(event) {
  lineReaderDragging.value = true;
  lineReaderDragOffset = getPointer(event).y - lineReaderTop.value;
  document.body.classList.add('exam-notes-dragging');
  window.addEventListener('mousemove', onLineReaderDrag);
  window.addEventListener('mouseup', stopLineReaderDrag);
  window.addEventListener('touchmove', onLineReaderDrag, { passive: false });
  window.addEventListener('touchend', stopLineReaderDrag);
}

function onLineReaderDrag(event) {
  if (!lineReaderDragging.value) {
    return;
  }
  if (event.cancelable) {
    event.preventDefault();
  }
  const top = getPointer(event).y - lineReaderDragOffset;
  lineReaderTop.value = Math.min(Math.max(top, 48), window.innerHeight - 60);
}

function stopLineReaderDrag() {
  lineReaderDragging.value = false;
  document.body.classList.remove('exam-notes-dragging');
  window.removeEventListener('mousemove', onLineReaderDrag);
  window.removeEventListener('mouseup', stopLineReaderDrag);
  window.removeEventListener('touchmove', onLineReaderDrag);
  window.removeEventListener('touchend', stopLineReaderDrag);
}

function startDrag(event) {
  isDragging.value = true;
  dragContainer = event.currentTarget.parentElement;
  document.body.classList.add('exam-resizing');
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('touchmove', onDrag, { passive: false });
  window.addEventListener('touchend', stopDrag);
}

function onDrag(event) {
  if (!isDragging.value || !dragContainer) {
    return;
  }

  if (event.cancelable) {
    event.preventDefault();
  }

  const rect = dragContainer.getBoundingClientRect();
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const ratio = ((clientX - rect.left) / rect.width) * 100;
  materialWidth.value = Math.min(90, Math.max(10, ratio));
}

function stopDrag() {
  isDragging.value = false;
  dragContainer = null;
  document.body.classList.remove('exam-resizing');
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', stopDrag);
  window.removeEventListener('touchmove', onDrag);
  window.removeEventListener('touchend', stopDrag);
}

function getPointer(event) {
  const point = event.touches ? event.touches[0] : event;
  return {
    x: point.clientX,
    y: point.clientY,
  };
}

function clampNotesPosition(left, top) {
  const panel = notesPanelRef.value;
  const width = panel?.offsetWidth || 360;
  const height = panel?.offsetHeight || 260;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const safeGap = 8;
  const minVisible = 80;
  const minLeft = width <= viewportWidth - safeGap * 2 ? safeGap : safeGap - width + minVisible;
  const maxLeft = width <= viewportWidth - safeGap * 2
    ? viewportWidth - width - safeGap
    : viewportWidth - minVisible;
  const minTop = safeGap;
  const maxTop = height <= viewportHeight - safeGap * 2
    ? viewportHeight - height - safeGap
    : viewportHeight - minVisible;

  return {
    left: Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft)),
    top: Math.min(Math.max(top, minTop), Math.max(minTop, maxTop)),
  };
}

function keepNotesInViewport() {
  if (!notesPanelRef.value) {
    return;
  }

  const rect = notesPanelRef.value.getBoundingClientRect();
  notesPosition.value = clampNotesPosition(rect.left, rect.top);
}

function startNotesDrag(event) {
  if (!notesPanelRef.value) {
    return;
  }

  const pointer = getPointer(event);
  const rect = notesPanelRef.value.getBoundingClientRect();
  notesDragOffset = {
    x: pointer.x - rect.left,
    y: pointer.y - rect.top,
  };
  notesPosition.value = clampNotesPosition(rect.left, rect.top);
  notesDragging.value = true;
  document.body.classList.add('exam-notes-dragging');
  window.addEventListener('mousemove', onNotesDrag);
  window.addEventListener('mouseup', stopNotesDrag);
  window.addEventListener('touchmove', onNotesDrag, { passive: false });
  window.addEventListener('touchend', stopNotesDrag);
}

function onNotesDrag(event) {
  if (!notesDragging.value) {
    return;
  }

  if (event.cancelable) {
    event.preventDefault();
  }

  const pointer = getPointer(event);
  notesPosition.value = clampNotesPosition(
    pointer.x - notesDragOffset.x,
    pointer.y - notesDragOffset.y
  );
}

function stopNotesDrag() {
  notesDragging.value = false;
  document.body.classList.remove('exam-notes-dragging');
  window.removeEventListener('mousemove', onNotesDrag);
  window.removeEventListener('mouseup', stopNotesDrag);
  window.removeEventListener('touchmove', onNotesDrag);
  window.removeEventListener('touchend', stopNotesDrag);
}

async function loadExam() {
  loading.value = true;
  errorMessage.value = '';
  paperWarning.value = '';
  sectionChoiceOpen.value = false;
  preAttemptIntroPending.value = false;

  try {
    if (isPreviewMode.value) {
      await loadPaperPreview();
      return;
    }

    if (isReviewMode.value && route.query.attemptId) {
      await loadReviewAttempt();
      return;
    }

    if (route.query.practiceAttemptId) {
      await loadPracticeAttempt();
      return;
    }

    if (await shouldResumeExistingAttempt()) {
      await startAttempt();
      return;
    }

    preAttemptIntroPending.value = true;
  } catch (error) {
    examFlowLogger.error('exam-load.failed', {
      examId: examId.value || null,
      reviewMode: isReviewMode.value,
      error: summarizeError(error),
    });
    errorMessage.value = error.message || 'Failed to start the exam. Please try again later.';
  } finally {
    loading.value = false;
  }
}

async function loadPaperPreview() {
  const previewPaperId = route.params.paperId;
  const previewPaper = unwrapResponse(
    await adminApi.getPaper(previewPaperId),
    'Failed to load paper preview'
  );

  paper.value = previewPaper;
  examSummary.value = { title: previewPaper.paperName || 'Paper Preview' };
  attempt.value = {
    paperId: previewPaper.paperId || previewPaperId,
    examTitle: previewPaper.paperName || 'Paper Preview',
    status: 'IN_PROGRESS',
    questions: previewPaper.questions || [],
    materials: previewPaper.materials || [],
    parts: previewPaper.parts || [],
    subTypes: previewPaper.subTypes || [],
  };
  localAccessBoundary.value = {
    freeNavigation: true,
    selectedSectionOrder: ['ELA', 'MATH'],
    currentSection: null,
    completedSections: [],
    currentOpenGroup: null,
    lockedGroups: [],
    lockedQuestions: [],
  };
  preAttemptIntroPending.value = false;
  sectionChoiceOpen.value = false;
  acknowledgedTransitionKeys.value = new Set();
  initializeAnswers(attempt.value);
  setInitialQuestion();
}

async function shouldResumeExistingAttempt() {
  try {
    const payload = unwrapResponse(await studentApi.getExams(), 'Failed to load exams');
    const records = Array.isArray(payload) ? payload : payload?.items || payload?.records || payload?.list || payload?.content || [];
    const targetExam = records.find((item) => String(item.examId || item.id || item.releaseId) === String(examId.value));
    examSummary.value = normalizeExamSummary(targetExam);
    const status = String(targetExam?.attemptStatus || targetExam?.status || '').trim().toUpperCase();
    const canStart = targetExam?.canStart === true || String(targetExam?.canStart).toLowerCase() === 'true';
    const remainingAttempts = Number(targetExam?.remainingAttempts ?? targetExam?.leftAttempts);
    return status === 'IN_PROGRESS' || (canStart && Number.isFinite(remainingAttempts) && remainingAttempts <= 0);
  } catch (error) {
    examFlowLogger.error('resume-check.failed', {
      examId: examId.value || null,
      error: summarizeError(error),
    });
    return false;
  }
}

function normalizeExamSummary(examRecord) {
  if (!examRecord) {
    return null;
  }

  return {
    title: examRecord.examTitle
      || examRecord.title
      || examRecord.examName
      || examRecord.paperName
      || '',
  };
}

function startPreAttemptIntro() {
  preAttemptIntroPending.value = false;
  sectionChoiceOpen.value = true;
  errorMessage.value = '';
}

async function chooseFirstSection(firstSection) {
  if (sectionChoiceLoading.value) {
    return;
  }
  selectedFirstSection = firstSection;
  sectionChoiceLoading.value = true;
  errorMessage.value = '';
  startScreenDiagnostics();

  try {
    if (!await enterExamFullscreen('start-section-click')) {
      return;
    }
    await startAttempt(firstSection);
    sectionChoiceOpen.value = false;
  } catch (error) {
    errorMessage.value = error.message || 'Failed to start the exam. Please try again later.';
    if (!attempt.value) {
      exitExamFullscreen('initialization-failed');
    } else {
      sectionChoiceOpen.value = false;
      fullscreenRequiredOverlay.value = !document.fullscreenElement;
    }
  } finally {
    sectionChoiceLoading.value = false;
  }
}

async function startAttempt(firstSection = '') {
  const payload = firstSection ? { firstSection } : undefined;
  let startedAttempt;
  try {
    startedAttempt = unwrapResponse(
      await studentApi.startExam(examId.value, payload),
      'Failed to start the exam'
    );
  } catch (error) {
    examFlowLogger.error('attempt-start.request-failed', {
      examId: examId.value || null,
      firstSection: firstSection || null,
      error: summarizeError(error),
    });
    throw error;
  }
  await activateAttempt(startedAttempt);
}

async function loadPracticeAttempt() {
  const startedAttempt = unwrapResponse(
    await studentApi.getAttempt(route.query.practiceAttemptId),
    'Failed to load practice attempt'
  );
  await activateAttempt(startedAttempt);
}

async function activateAttempt(startedAttempt) {
  await hydrateAttempt(startedAttempt);

  if (startedAttempt.status === 'IN_PROGRESS') {
    startScreenDiagnostics();
  }

  // 恢复服务端计数；自动恢复来自异步加载，必须由学生再次点击才能请求全屏。
  focusViolationCount.value = Math.max(focusViolationCount.value, Number(startedAttempt.focusViolationCount) || 0);
  violationMonitoringReadyAt = Date.now() + VIOLATION_MONITORING_GRACE_MS;

  if (['COMPLETED', 'SUBMITTED', 'EXPIRED'].includes(startedAttempt.status)) {
    await loadResult(startedAttempt.attemptId);
    if (!isReviewMode.value) {
      router.replace({
        name: 'student-attempt-report',
        params: { attemptId: startedAttempt.attemptId },
      });
    }
  } else {
    fullscreenRequiredOverlay.value = !document.fullscreenElement;
    if (fullscreenRequiredOverlay.value) {
      fullscreenError.value = 'Click Enter Fullscreen to resume the exam.';
    }
    startCountdown();
    startPresenceTracking();
  }
}

async function hydrateAttempt(startedAttempt) {
  autoSubmitStarted.value = false;
  localAccessBoundary.value = null;
  preAttemptIntroPending.value = false;
  acknowledgedTransitionKeys.value = new Set();
  attempt.value = startedAttempt;
  initializeAnswers(startedAttempt);
  remainingSeconds.value = Number(startedAttempt.remainingSeconds || 0);

  if ((startedAttempt.questions || []).length === 0 && startedAttempt.paperId) {
    await loadPaper(startedAttempt.paperId);
  }
  setInitialQuestion();
}

async function loadReviewAttempt() {
  const reviewResult = await loadResult(route.query.attemptId);
  preAttemptIntroPending.value = false;
  acknowledgedTransitionKeys.value = new Set();
  attempt.value = {
    attemptId: reviewResult.attemptId,
    examId: reviewResult.examId,
    paperId: reviewResult.paperId,
    examTitle: reviewResult.examTitle,
    status: reviewResult.status,
    submittedAt: reviewResult.submittedAt,
    timeUsed: reviewResult.timeUsed,
    answers: [],
    questions: reviewResult.questions || [],
  };
  if (reviewResult.paperId) {
    await loadPaper(reviewResult.paperId);
  }
  initializeAnswersFromResult(reviewResult);
  setInitialQuestion();
}

async function loadPaper(paperId) {
  paperLoading.value = true;

  try {
    paper.value = unwrapResponse(
      await studentApi.getPaperDetail(paperId),
      'Failed to load paper details'
    );
  } catch (error) {
    examFlowLogger.error('paper-load.failed', examFlowContext({ paperId, error: summarizeError(error) }));
    paperWarning.value = error.message || 'Failed to load paper details. Continuing with exam questions.';
  } finally {
    paperLoading.value = false;
  }
}

async function loadResult(id) {
  clearCountdown();
  stopPresenceTracking();
  const api = isAdminReviewMode.value ? adminApi : studentApi;
  try {
    result.value = unwrapResponse(
      await api.getAttemptResult(id),
      'Failed to load results'
    );
  } catch (error) {
    examFlowLogger.error('result-load.failed', {
      attemptId: id || null,
      error: summarizeError(error),
    });
    throw error;
  }
  return result.value;
}

function initializeAnswers(attemptData) {
  const nextAnswers = {};
  const nextSaved = new Set();
  const nextMarked = new Set();
  const savedAnswers = attemptData.answers || [];

  (attemptData.questions || []).forEach((question) => {
    nextAnswers[question.questionNumber] = '';
  });
  savedAnswers.forEach((answer) => {
    nextAnswers[answer.questionNumber] = normalizeRestoredAnswerValue(
      findQuestionByNumber(answer.questionNumber),
      parseJson(answer.answerData) ?? answer.selectedAnswer ?? ''
    );
    nextSaved.add(answer.questionNumber);

    if (answer.marked) {
      nextMarked.add(answer.questionNumber);
    }
  });

  answers.value = nextAnswers;
  savedQuestionNumbers.value = nextSaved;
  markedQuestionNumbers.value = nextMarked;
}

function initializeAnswersFromResult(resultData) {
  const nextAnswers = {};
  const nextSaved = new Set();

  (resultData.questions || []).forEach((question) => {
    nextAnswers[question.questionNumber] = normalizeRestoredAnswerValue(
      findQuestionByNumber(question.questionNumber) || question,
      parseJson(question.answerData) ?? parseJson(question.selectedAnswer) ?? question.selectedAnswer ?? ''
    );
    nextSaved.add(question.questionNumber);
  });

  answers.value = nextAnswers;
  savedQuestionNumbers.value = nextSaved;
  markedQuestionNumbers.value = new Set();
}

// 记录上次浏览的题目，刷新/恢复考试时回到该题，而不是跳回第一题或阅读组开头。
function lastViewedQuestionStorageKey() {
  return attemptId.value ? `shsat-exam:last-question:${attemptId.value}` : '';
}

function persistLastViewedQuestion() {
  const key = lastViewedQuestionStorageKey();
  if (!key || !currentQuestion.value) {
    return;
  }
  try {
    localStorage.setItem(key, String(currentQuestion.value.questionNumber));
  } catch {
    // 存储不可用时静默忽略，不影响考试。
  }
}

function setInitialQuestion() {
  const questionNumber = Number(route.query.questionNumber);
  let index = questions.value.findIndex((question) => question.questionNumber === questionNumber);

  if (index >= 0) {
    currentIndex.value = index;
    persistLastViewedQuestion();
    startQuestionTimer();
    return;
  }

  // 刷新/恢复时优先回到上次浏览的题目（同一浏览器），仅当该题当前仍可访问时使用。
  const savedNumber = Number(localStorage.getItem(lastViewedQuestionStorageKey()));
  index = questions.value.findIndex((question) => question.questionNumber === savedNumber);
  if (index >= 0 && getQuestionAccess(savedNumber).accessible) {
    currentIndex.value = index;
    startQuestionTimer();
    return;
  }

  const openQuestionNumber = activeAccessBoundary.value?.currentOpenGroup?.questionNumbers?.[0];
  const openIndex = questions.value.findIndex((question) => question.questionNumber === openQuestionNumber);
  if (openIndex >= 0) {
    currentIndex.value = openIndex;
    startQuestionTimer();
    return;
  }

  if (questions.value.length > 0) {
    currentIndex.value = 0;
    startQuestionTimer();
  }
}

async function saveCurrentAnswer() {
  if (!currentQuestion.value || !attemptId.value || isReadOnlyMode.value) {
    return true;
  }
  if (isQuestionLocked(currentQuestion.value.questionNumber)) {
    errorMessage.value = 'This question is locked for the current attempt.';
    return false;
  }
  if (isQuestionSaved(currentQuestion.value.questionNumber)) {
    return true;
  }

  try {
    await saveAnswer(currentQuestion.value);
    return true;
  } catch {
    return false;
  }
}

async function saveAnswer(question) {
  savingQuestionNumber.value = question.questionNumber;
  saveMessage.value = '';
  errorMessage.value = '';

  try {
    const response = unwrapResponse(
      await studentApi.submitAnswer(attemptId.value, buildAnswerPayload(question)),
      `Failed to save Question ${question.questionNumber}`
    );
    if (response?.progressState || response?.accessBoundary) {
      applyProgressUpdate(response);
    }
    savedQuestionNumbers.value = new Set([...savedQuestionNumbers.value, question.questionNumber]);
    saveMessage.value = `Question ${question.questionNumber} saved`;
  } catch (error) {
    examFlowLogger.error('answer-save.failed', examFlowContext({
      question: summarizeQuestion(question),
      error: summarizeError(error),
    }));
    const detail = error.message ? ` ${error.message}` : '';
    errorMessage.value = `Failed to save Question ${question.questionNumber}.${detail} Your local answer is kept on this page; please retry before leaving or submitting.`;
    throw new Error(errorMessage.value);
  } finally {
    savingQuestionNumber.value = null;
  }
}

function buildCurrentAnswerPayload() {
  if (!currentQuestion.value || isReadOnlyMode.value || isQuestionLocked(currentQuestion.value.questionNumber)) {
    return null;
  }
  if (!hasMeaningfulAnswerValue(getAnswer(currentQuestion.value.questionNumber))) {
    return null;
  }
  return buildAnswerPayload(currentQuestion.value);
}

async function submitExam({ autoSubmitted = false, skipConfirm = false } = {}) {
  if (!attemptId.value || submitLoading.value || navigationLoading.value) {
    return;
  }

  recordCurrentQuestionTime();
  errorMessage.value = '';
  saveMessage.value = '';

  try {
    if (!autoSubmitted) {
      const unansweredNumbers = getUnansweredQuestionNumbers();
      if (unansweredNumbers.length > 0) {
        const groupMissingNumbers = currentReadingGroupUnansweredNumbers();
        const warningMessage = groupMissingNumbers.length > 0
          ? `${readingGroupIncompleteMessage(groupMissingNumbers)} ${submissionIncompleteMessage(unansweredNumbers)}`
          : submissionIncompleteMessage(unansweredNumbers);
        const confirmedUnansweredSubmit = await requestConfirmation({
          title: 'Submit With Unanswered Questions?',
          message: `${warningMessage} You can submit now or return to finish more questions.`,
          confirmText: 'Submit Anyway',
          cancelText: 'Keep Working',
          destructive: true,
        });
        if (!confirmedUnansweredSubmit) {
          errorMessage.value = warningMessage;
          return;
        }
      }
    }

    // Save before opening confirmation, then again immediately before final submit.
    if (!autoSubmitted && !(await saveCurrentAnswer())) {
      return;
    }

    if (!skipConfirm) {
      const confirmed = await requestConfirmation({
        title: 'Submit Exam?',
        message: 'You will not be able to change answers after submission.',
        confirmText: 'Submit Exam',
        cancelText: 'Cancel',
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
    }

    submitLoading.value = true;
    if (!autoSubmitted && !(await saveCurrentAnswer())) {
      return;
    }

    result.value = unwrapResponse(
      await studentApi.completeAttempt(attemptId.value, {
        autoSubmitted,
        currentAnswer: buildCurrentAnswerPayload(),
        focusViolationCount: focusViolationCount.value,
      }),
      'Failed to submit the exam'
    );
    attempt.value = {
      ...attempt.value,
      status: result.value.status,
      submittedAt: result.value.submittedAt,
      timeUsed: result.value.timeUsed,
    };
    clearCountdown();
    router.push({
      name: 'student-attempt-report',
      params: { attemptId: result.value.attemptId || attemptId.value },
    });
  } catch (error) {
    examFlowLogger.error('exam-submit.failed', examFlowContext({ autoSubmitted, error: summarizeError(error) }));
    errorMessage.value = error.message || 'Failed to submit the exam. Please try again later.';
  } finally {
    submitLoading.value = false;
  }
}

function startCountdown() {
  clearCountdown();

  if (!Number.isFinite(Number(remainingSeconds.value)) || remainingSeconds.value <= 0) {
    handleTimeExpired();
    return;
  }

  countdownTimer.value = window.setInterval(() => {
    remainingSeconds.value = Math.max(Number(remainingSeconds.value) - 1, 0);
    if (remainingSeconds.value === 0) {
      handleTimeExpired();
    }
  }, 1000);
}

function clearCountdown() {
  if (!countdownTimer.value) {
    return;
  }

  window.clearInterval(countdownTimer.value);
  countdownTimer.value = null;
}

async function handleTimeExpired() {
  clearCountdown();

  if (isSubmitted.value || autoSubmitStarted.value) {
    return;
  }

  if (!attempt.value?.autoSubmit) {
    errorMessage.value = 'Time is up. Auto-submit is disabled for this exam; please contact your teacher.';
    return;
  }

  autoSubmitStarted.value = true;
  await submitExam({ autoSubmitted: true, skipConfirm: true });
}

function formatRemainingTime(seconds) {
  const totalSeconds = Math.max(Number(seconds) || 0, 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const restSeconds = totalSeconds % 60;
  const parts = hours > 0 ? [hours, minutes, restSeconds] : [minutes, restSeconds];

  return parts.map((part) => String(part).padStart(2, '0')).join(':');
}

onMounted(() => {
  loadExam();
  window.addEventListener('resize', keepNotesInViewport);
  window.addEventListener('resize', handleExamScreenResize);
  window.visualViewport?.addEventListener('resize', handleExamScreenResize);
  document.addEventListener('visibilitychange', handleExamVisibilityChange);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('fullscreenerror', handleFullscreenError);
  window.addEventListener('focus', handleExamWindowFocus);
  window.addEventListener('blur', handleExamWindowFocus);
  window.addEventListener('keydown', handleExamKeydown);
  handleFullscreenChange();
});
onBeforeUnmount(() => {
  resolveConfirmation(false);
  clearCountdown();
  stopPresenceTracking();
  stopDrag();
  stopNotesDrag();
  stopLineReaderDrag();
  window.clearTimeout(pageHiddenViolationTimer);
  window.clearTimeout(fullscreenExitConfirmTimer);
  window.clearTimeout(screenResizeTimer);
  screenDiagnosticsStarted = false;
  // 正常离开页面时退出全屏，不计入切屏违规。
  exitExamFullscreen();
  window.removeEventListener('resize', keepNotesInViewport);
  window.removeEventListener('resize', handleExamScreenResize);
  window.visualViewport?.removeEventListener('resize', handleExamScreenResize);
  document.removeEventListener('visibilitychange', handleExamVisibilityChange);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.removeEventListener('fullscreenerror', handleFullscreenError);
  window.removeEventListener('focus', handleExamWindowFocus);
  window.removeEventListener('blur', handleExamWindowFocus);
  window.removeEventListener('keydown', handleExamKeydown);
});
</script>

<template>
  <section class="student-exam" :class="`student-exam--${widthMode}`">
    <AppCard v-if="loading" title="Loading Exam">
      <div class="student-exam__state">
        <span class="student-exam__spinner" aria-hidden="true"></span>
        <p class="status-note">Loading exam details...</p>
      </div>
    </AppCard>

    <AppCard v-else-if="errorMessage && !attempt" title="Unable to Start">
      <div class="student-exam__state student-exam__state--error">
        <p class="error-text">{{ errorMessage }}</p>
        <AppButton variant="secondary" @click="loadExam">Retry</AppButton>
      </div>
    </AppCard>

    <section
      v-else-if="activePreAttemptIntroViewModel"
      class="exam-transition-page exam-transition-page--pre-attempt"
      :style="fontScaleStyle"
      aria-labelledby="pre-attempt-intro-title"
    >
      <section class="exam-transition-card">
        <p class="exam-transition-card__eyebrow">{{ getTransitionEyebrow(activePreAttemptIntroViewModel) }}</p>
        <h1 id="pre-attempt-intro-title">{{ activePreAttemptIntroViewModel.title }}</h1>
        <p class="exam-transition-card__body">{{ activePreAttemptIntroViewModel.body }}</p>
        <ul class="exam-transition-card__list" aria-label="Exam start rules">
          <li>The timer starts after you choose a section.</li>
          <li>You may begin with ELA or Math.</li>
          <li>Submit the current section to open the next one.</li>
        </ul>
        <div class="exam-transition-card__context" aria-label="Exam context">
          <span
            v-for="item in activeTransitionContextItems"
            :key="item"
          >{{ item }}</span>
        </div>
        <button
          type="button"
          class="exam-transition-card__button"
          @click="continueTransitionViewModel(activePreAttemptIntroViewModel)"
        >
          {{ activePreAttemptIntroViewModel.actionLabel }}
        </button>
      </section>
    </section>

    <AppCard v-else-if="sectionChoiceOpen" title="Choose Starting Section">
      <div class="section-choice">
        <p class="section-choice__intro">Select the section you want to take first. The other section will open after you submit this section.</p>
        <div class="section-choice__actions">
          <button
            type="button"
            class="section-choice__button"
            :disabled="sectionChoiceLoading"
            @click="chooseFirstSection('ELA')"
          >
            <span>ELA</span>
            <small>Reading and language questions first</small>
          </button>
          <button
            type="button"
            class="section-choice__button"
            :disabled="sectionChoiceLoading"
            @click="chooseFirstSection('MATH')"
          >
            <span>Math</span>
            <small>Mathematics questions first</small>
          </button>
        </div>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <p v-if="fullscreenError" class="error-text">{{ fullscreenError }}</p>
        <AppButton
          v-if="fullscreenError"
          variant="secondary"
          :disabled="sectionChoiceLoading"
          @click="chooseFirstSection(selectedFirstSection)"
        >Retry Fullscreen</AppButton>
      </div>
    </AppCard>

    <template v-else>
      <header class="exam-toolbar">
        <div class="toolbar-left">
          <div class="nav-buttons-group" aria-label="Question navigation">
            <button
              class="nav-button nav-button--previous"
              type="button"
              title="Previous"
              aria-label="Previous"
              :disabled="!canGoPrevious"
              @click="goQuestion(currentIndex - 1)"
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              class="nav-button nav-button--next"
              type="button"
              title="Next"
              aria-label="Next"
              :disabled="!canGoNext"
              @click="goQuestion(currentIndex + 1)"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>

          <div class="review-menu">
            <button
              class="review-button"
              type="button"
              title="Review"
              aria-label="Review"
              :disabled="Boolean(activeTransitionViewModel)"
              @click="toggleReviewPanel"
            >
              <span>Review</span>
              <span class="review-button__icon" aria-hidden="true">☰</span>
            </button>
            <div v-if="reviewPanelOpen" class="review-panel dropdown">
              <div class="review-header">
                <div class="question-stats" role="tablist" aria-label="Review filters">
                  <button
                    class="stat-item"
                    :class="{ active: currentFilter === 'all' }"
                    type="button"
                    @click="setReviewFilter('all')"
                  >
                    <span class="stat-number">{{ reviewQuestions.length }}</span>
                    <span class="stat-label">Current Range</span>
                  </button>
                  <button
                    class="stat-item"
                    :class="{ active: currentFilter === 'notAnswered' }"
                    type="button"
                    @click="setReviewFilter('notAnswered')"
                  >
                    <span class="stat-number">{{ notAnsweredCount }}</span>
                    <span class="stat-label">Not Answered</span>
                  </button>
                  <button
                    class="stat-item"
                    :class="{ active: currentFilter === 'marked' }"
                    type="button"
                    @click="setReviewFilter('marked')"
                  >
                    <span class="stat-number">{{ markedCount }}</span>
                    <span class="stat-label">Bookmarks</span>
                  </button>
                </div>
              </div>
              <div class="question-list">
                <button
                  v-for="question in filteredQuestions"
                  :key="question.questionNumber"
                  class="question-item"
                  :class="{
                    current: question.questionNumber === currentQuestion?.questionNumber,
                    answered: hasAnswer(question.questionNumber),
                    marked: isMarked(question.questionNumber),
                    saved: isQuestionSaved(question.questionNumber),
                    locked: !canNavigateFromReviewPanel(question),
                  }"
                  type="button"
                  :disabled="navigationLoading || !canNavigateFromReviewPanel(question)"
                  :title="canNavigateFromReviewPanel(question) ? `Question ${question.questionNumber}` : getQuestionAccess(question.questionNumber).reason"
                  @click="handleReviewQuestionClick(question)"
                >
                  <span>Question {{ question.questionNumber }}</span>
                  <span v-if="!canUseFreeQuestionNavigation && getQuestionAccess(question.questionNumber).locked" class="lock-dot">Locked</span>
                  <span v-if="isMarked(question.questionNumber)" class="saved-dot">Bookmark</span>
                </button>
              </div>
            </div>
          </div>

          <button
            v-if="!isReadOnlyMode && !isPreviewMode && !isPracticeAttempt"
            class="submit-section-button"
            type="button"
            :disabled="submitLoading || navigationLoading || Boolean(activeTransitionViewModel)"
            @click="submitSection"
          >
            {{ submitSectionText }}
          </button>
          <button
            v-if="!isReadOnlyMode && !isPreviewMode"
            class="submit-exam-button"
            type="button"
            :disabled="submitLoading || navigationLoading || Boolean(activeTransitionViewModel)"
            @click="submitExam()"
          >
            Submit Exam
          </button>

          <button
            class="mark-button"
            :class="{ active: currentQuestion && isMarked(currentQuestion.questionNumber) }"
            type="button"
            title="Bookmark"
            aria-label="Bookmark"
            :disabled="!currentQuestion || isCurrentQuestionReadOnly"
            @click="toggleMark"
          >
            <span class="bookmark-icon" aria-hidden="true"></span>
            <span>Bookmark</span>
          </button>
        </div>

        <div class="toolbar-center">
          <div class="toolbar-tools">
            <button
              class="tool-button pointer-tool"
              :class="{ active: !highlighterOn && !drawingOn && !eliminateModeOn }"
              type="button"
              title="Pointer"
              aria-label="Pointer"
              @click="activatePointerTool"
            >↖</button>
            <button
              v-if="!isReadOnlyMode"
              class="tool-button"
              :class="{ active: eliminateModeOn }"
              type="button"
              title="Answer Eliminator"
              aria-label="Answer Eliminator"
              @click="toggleEliminateMode"
            >×</button>
            <button
              class="tool-button"
              :class="{ active: notesOpen }"
              type="button"
              title="Notepad"
              aria-label="Notepad"
              @click="toggleNotes"
            >▤</button>
            <button
              v-if="!isReadOnlyMode"
              class="tool-button"
              :class="{ active: highlighterOn }"
              type="button"
              title="Highlighter"
              aria-label="Highlighter"
              @click="toggleHighlighter"
            >
              <span class="tool-icon tool-icon--highlight" :style="{ '--highlight-color': selectedHighlightColor }" aria-hidden="true"></span>
            </button>
            <div v-if="!isReadOnlyMode" class="tool-selector">
              <button
                class="tool-button"
                :class="{ active: drawingOn }"
                type="button"
                title="Drawing Pen"
                aria-label="Drawing Pen"
                @click="toggleDrawing"
              >
                <span class="tool-icon tool-icon--pen" :style="{ '--pen-color': selectedPenColor }" aria-hidden="true"></span>
              </button>
              <button
                class="tool-button tool-split-button"
                type="button"
                title="Pen Color"
                aria-label="Pen Color"
                @click="toggleDrawingMenu"
              >▾</button>
              <div v-if="drawingMenuOpen" class="tool-dropdown tool-color-menu">
                <button
                  v-for="color in penColors"
                  :key="color.value"
                  class="tool-color-option"
                  :class="{ active: selectedPenColor === color.value }"
                  type="button"
                  @click="setPenColor(color.value)"
                >
                  <span class="tool-color-swatch" :style="{ backgroundColor: color.value }"></span>
                  <span>{{ color.label }}</span>
                </button>
                <button class="tool-color-option tool-color-option--danger" type="button" @click="clearCurrentDrawing">
                  Clear Drawing
                </button>
              </div>
            </div>
            <button
              class="tool-button"
              :class="{ active: lineReaderOn }"
              type="button"
              title="Line Reader"
              aria-label="Line Reader"
              @click="toggleLineReader"
            >▭</button>
            <button
              class="tool-button"
              type="button"
              :disabled="!currentQuestion || isCurrentQuestionReadOnly"
              title="Clear Answer"
              aria-label="Clear Answer"
              @click="clearCurrentAnswer"
            >⌫</button>
            <button
              class="tool-button fullscreen-button"
              :class="{ active: isFullscreen }"
              :disabled="isExamFullscreenRequired && isFullscreen"
              type="button"
              :title="isExamFullscreenRequired ? 'Fullscreen is required during the exam' : 'Fullscreen'"
              aria-label="Fullscreen"
              @click="toggleFullscreen"
            >⛶</button>
            <div class="font-selector">
              <button class="tool-button font-button" type="button" title="Font Size" aria-label="Font Size" @click="toggleFontMenu">A</button>
              <div v-if="fontMenuOpen" class="tool-dropdown">
                <button class="tool-option" :class="{ active: fontScale === 1 }" type="button" @click="setFontScale(1)">1.0x</button>
                <button class="tool-option" :class="{ active: fontScale === 1.15 }" type="button" @click="setFontScale(1.15)">1.15x</button>
                <button class="tool-option" :class="{ active: fontScale === 1.3 }" type="button" @click="setFontScale(1.3)">1.3x</button>
                <button class="tool-option" :class="{ active: fontScale === 1.45 }" type="button" @click="setFontScale(1.45)">1.45x</button>
                <button class="tool-option" :class="{ active: fontScale === 1.6 }" type="button" @click="setFontScale(1.6)">1.6x</button>
              </div>
            </div>
            <div class="width-selector">
              <button
                class="tool-button width-button"
                type="button"
                :title="`Page Width: ${getWidthLabel(widthMode)}`"
                aria-label="Page Width"
                @click="toggleWidthMenu"
              >↔</button>
              <div v-if="widthMenuOpen" class="tool-dropdown">
                <button class="tool-option" :class="{ active: widthMode === 'normal' }" type="button" @click="setWidthMode('normal')">Normal</button>
                <button class="tool-option" :class="{ active: widthMode === 'wide' }" type="button" @click="setWidthMode('wide')">Wide</button>
                <button class="tool-option" :class="{ active: widthMode === 'ultra-wide' }" type="button" @click="setWidthMode('ultra-wide')">Extra Wide</button>
              </div>
            </div>
          </div>
        </div>

        <div class="toolbar-right">
          <span v-if="focusViolationCount > 0" class="focus-violation-counter" title="Times the exam page was left during the attempt">
            Left exam page: {{ focusViolationCount }}
          </span>
          <span v-if="!isReadOnlyMode && !isPreviewMode" class="timer-display">{{ countdownText }}</span>
          <span v-else-if="isPreviewMode" class="timer-display">Preview Mode</span>
          <span v-else-if="isReviewMode" class="timer-display">Review Mode</span>
          <button
            class="user-menu-button"
            type="button"
            :aria-label="isPreviewMode ? 'Back' : 'Leave exam page'"
            @click="goBack"
          >
            <span>{{ isPreviewMode ? 'Back' : 'Student' }}</span>
            <span class="user-menu-icon" aria-hidden="true">{{ isPreviewMode ? '‹' : '▾' }}</span>
          </button>
        </div>
      </header>

      <div class="exam-path-bar" :title="examDisplayTitle">
        <span>SHSAT STUDENT READINESS TOOL</span>
        <span aria-hidden="true">/</span>
        <span>{{ currentSectionLabel }}</span>
        <span aria-hidden="true">/</span>
        <span>{{ currentTrailLabel }}</span>
        <span class="battery-indicator" aria-hidden="true"></span>
      </div>

      <div v-if="pendingHighlightRange" class="highlight-popover" :style="highlightPopoverStyle" role="dialog" aria-label="Choose highlight color">
        <button
          v-for="color in highlightColors"
          :key="color.value"
          class="highlight-popover__color"
          type="button"
          :title="color.label"
          :aria-label="`Highlight ${color.label}`"
          :style="{ backgroundColor: color.value }"
          @click="setHighlightColor(color.value)"
        ></button>
        <button class="highlight-popover__close" type="button" aria-label="Cancel highlight" @click="closeHighlightPopover">×</button>
      </div>

      <div v-if="paperWarning" class="student-exam__alert student-exam__alert--closable">
        <span>{{ paperWarning }}</span>
        <button type="button" class="student-exam__alert-close" aria-label="Close message" @click="paperWarning = ''">×</button>
      </div>

      <div v-if="errorMessage" class="student-exam__alert student-exam__alert--error student-exam__alert--closable">
        <span>{{ errorMessage }}</span>
        <button type="button" class="student-exam__alert-close" aria-label="Close message" @click="clearErrorMessage">×</button>
      </div>

      <div v-if="focusViolationModalOpen" class="exam-confirm focus-violation-modal" role="presentation">
        <div class="exam-confirm__panel" role="dialog" aria-modal="true" aria-labelledby="focus-violation-title">
          <div class="exam-confirm__icon">!</div>
          <div class="exam-confirm__content">
            <h2 id="focus-violation-title">Warning</h2>
            <p>
              You left the exam page. This is the {{ focusViolationModalCount }} time and has been recorded
              in your exam report. Please stay on the exam page. The exam timer keeps running while you are away.
            </p>
            <p v-if="fullscreenError" class="focus-violation-modal__error">{{ fullscreenError }}</p>
          </div>
          <div class="exam-confirm__actions">
            <button
              type="button"
              class="exam-confirm__button exam-confirm__button--primary"
              @click="dismissFocusViolationModal"
            >
              OK, Continue
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="fullscreenRequiredOverlay && !isReviewMode && !isPreviewMode"
        class="fullscreen-required-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fullscreen-required-title"
      >
        <div class="fullscreen-required-dialog">
          <span class="fullscreen-required-dialog__icon" aria-hidden="true">⛶</span>
          <h2 id="fullscreen-required-title">Fullscreen Required</h2>
          <p>{{ fullscreenError || 'Enter fullscreen to begin or continue the exam.' }}</p>
          <button type="button" class="fullscreen-required-dialog__button" @click="enterExamFullscreen('overlay-click')">
            {{ fullscreenError?.startsWith('Fullscreen could not') ? 'Retry Fullscreen' : 'Enter Fullscreen' }}
          </button>
        </div>
      </div>

      <div
        v-for="warning in questionGroupWarnings"
        :key="`${warning.code}-${warning.materialId}`"
        class="student-exam__alert student-exam__alert--warning"
      >
        {{ warning.message }}
      </div>

      <div v-if="confirmDialog.open" class="exam-confirm" role="presentation">
        <div class="exam-confirm__panel" role="dialog" aria-modal="true" :aria-labelledby="'exam-confirm-title'">
          <button
            type="button"
            class="exam-confirm__close"
            aria-label="Close confirmation"
            @click="resolveConfirmation(false)"
          >×</button>
          <div class="exam-confirm__icon" :class="{ 'exam-confirm__icon--danger': confirmDialog.destructive }">!</div>
          <div class="exam-confirm__content">
            <h2 id="exam-confirm-title">{{ confirmDialog.title }}</h2>
            <p>{{ confirmDialog.message }}</p>
          </div>
          <div class="exam-confirm__actions">
            <button type="button" class="exam-confirm__button exam-confirm__button--secondary" @click="resolveConfirmation(false)">
              {{ confirmDialog.cancelText }}
            </button>
            <button
              type="button"
              class="exam-confirm__button exam-confirm__button--primary"
              :class="{ 'exam-confirm__button--danger': confirmDialog.destructive }"
              @click="resolveConfirmation(true)"
            >
              {{ confirmDialog.confirmText }}
            </button>
          </div>
        </div>
      </div>

      <aside
        v-if="notesOpen"
        ref="notesPanelRef"
        class="notes-panel"
        :class="{ dragging: notesDragging }"
        :style="notesPanelStyle"
        role="dialog"
        aria-label="Notes"
      >
        <div
          class="notes-panel__head"
          title="Drag Notes"
          @mousedown="startNotesDrag"
          @touchstart="startNotesDrag"
        >
          <strong>Notes</strong>
          <button type="button" title="Close Notes" aria-label="Close Notes" @mousedown.stop @touchstart.stop @click="toggleNotes">×</button>
        </div>
        <textarea v-model="notesContent" class="form-input" rows="4" placeholder="Temporary notes for this attempt"></textarea>
      </aside>

      <div v-if="lineReaderOn" class="line-reader" aria-hidden="true">
        <div class="line-reader__mask line-reader__mask--top" :style="{ height: `${lineReaderTop}px` }"></div>
        <div
          class="line-reader__strip"
          :class="{ dragging: lineReaderDragging }"
          :style="{ top: `${lineReaderTop}px` }"
          title="Drag to move the reading line"
          @mousedown="startLineReaderDrag"
          @touchstart="startLineReaderDrag"
        ></div>
        <div class="line-reader__mask line-reader__mask--bottom" :style="{ top: `${lineReaderTop + 48}px` }"></div>
      </div>

      <div
        v-if="imagePreview.open"
        class="image-preview-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Material image preview"
        @click.self="closeMaterialImagePreview"
      >
        <div class="image-preview-dialog">
          <div class="image-preview-dialog__header">
            <div>
              <strong>{{ imagePreview.title }}</strong>
              <span>Click to zoom. Drag the image after zooming to move around.</span>
            </div>
            <div class="image-preview-dialog__actions">
              <button type="button" @click="increaseMaterialImagePreviewZoom()">Zoom In</button>
              <button type="button" @click="resetMaterialImagePreviewZoom">Reset</button>
              <button type="button" aria-label="Close image preview" @click="closeMaterialImagePreview">Close</button>
            </div>
          </div>
          <div class="image-preview-dialog__viewport">
            <img
              :class="{ zoomed: imagePreview.zoom > 1 }"
              :src="imagePreview.src"
              :alt="imagePreview.title"
              :style="imagePreviewTransformStyle()"
              @pointerdown="startImagePreviewPan"
              @pointermove="moveImagePreviewPan"
              @pointerup="endImagePreviewPan"
              @pointercancel="endImagePreviewPan"
              @lostpointercapture="endImagePreviewPan"
              @click.stop="zoomMaterialImagePreview"
            />
          </div>
        </div>
      </div>

      <section v-if="isReviewMode" class="student-exam__summary">
        <AppCard title="Read-only Review" subtitle="This page shows the submitted answer. Editing and saving are disabled.">
          <div class="review-mode-actions">
            <p class="status-note">Question {{ currentQuestion?.questionNumber || '-' }} of {{ questions.length }}</p>
            <AppButton variant="secondary" @click="goBack">Back to Report</AppButton>
          </div>
        </AppCard>
      </section>

      <section v-if="!result || isReviewMode" class="student-exam__workspace">
        <section
          v-if="activeTransitionViewModel"
          class="exam-transition-page"
          :style="fontScaleStyle"
          aria-labelledby="active-transition-title"
        >
          <article class="exam-transition-card">
            <p class="exam-transition-card__eyebrow">{{ getTransitionEyebrow(activeTransitionViewModel) }}</p>
            <h1 id="active-transition-title">{{ activeTransitionViewModel.title }}</h1>
            <p class="exam-transition-card__body">{{ activeTransitionViewModel.body }}</p>
            <div class="exam-transition-card__context" aria-label="Transition context">
              <span
                v-for="item in activeTransitionContextItems"
                :key="item"
              >{{ item }}</span>
            </div>
            <button
              type="button"
              class="exam-transition-card__button"
              @click="continueTransitionViewModel()"
            >
              {{ activeTransitionViewModel.actionLabel }}
            </button>
          </article>
        </section>

        <section v-else-if="currentQuestion" class="exam-question-shell" :style="fontScaleStyle">
            <div class="question-header">
              <div class="section-info">
                <span class="section-name">{{ getQuestionTypeLabel(currentQuestion.questionType) }}</span>
                <span class="question-number">Question {{ currentQuestion.questionNumber }}</span>
                <span v-if="getQuestionGroupLabel(currentQuestion.questionNumber)" class="group-label">
                  {{ getQuestionGroupLabel(currentQuestion.questionNumber) }}
                </span>
                <span class="progress">{{ currentQuestionPosition }}</span>
              </div>
            </div>

            <div class="question-content">
              <div
                v-if="currentQuestion.material"
                class="material-section"
                :style="{ width: `${materialWidth}%` }"
              >
                <div class="material-content scrollable">
                  <div class="material-canvas" :class="{ 'drawing-active': drawingOn }">
                    <div
                      class="material-text exam-highlightable"
                      :class="{ 'highlighter-active': highlighterOn }"
                      @mouseup="applyHighlightToSelection"
                      @click="clearHighlightSpan"
                    >
                      <button
                        v-if="isImageMaterial(currentQuestion.material)"
                        class="material-image-button"
                        type="button"
                        :disabled="drawingOn"
                        title="Click to enlarge image"
                        @click.stop="openMaterialImagePreview(currentQuestion.material)"
                      >
                        <img
                          class="material-image"
                          :src="currentQuestion.material.assetUrl"
                          alt="Question material image"
                        />
                      </button>
                      <div v-else class="material-display">
                        <div v-if="currentMaterialDisplay?.hasIntroduction" class="material-display__introduction">
                          <SafeMarkdownText :content="currentMaterialDisplay.introduction" />
                        </div>

                        <header v-if="currentMaterialDisplay?.hasHeader" class="material-display__header">
                          <div
                            v-for="line in currentMaterialDisplay.headerLines"
                            :key="line.key"
                            class="material-display__header-line"
                            :class="`material-display__header-line--${line.role}`"
                          >
                            {{ line.text }}
                          </div>
                        </header>

                        <div v-if="currentMaterialDisplay?.hasBody" class="material-display__body" aria-label="Reading passage">
                          <div
                            v-for="item in currentMaterialDisplay.bodyItems"
                            :key="item.key"
                            class="material-display__body-line"
                            :class="{
                              'material-display__body-line--empty': item.type === 'text' && item.isEmpty,
                              'material-display__body-line--image': item.type === 'image',
                            }"
                          >
                            <template v-if="item.type === 'image'">
                              <button
                                class="material-display__image-button"
                                type="button"
                                :disabled="drawingOn"
                                title="Click to enlarge image"
                                @click.stop="openMaterialBodyImagePreview(item)"
                              >
                                <img class="material-display__image" :src="item.src" :alt="item.alt" />
                              </button>
                            </template>
                            <template v-else>
                              <div class="material-display__line-text">
                                <SafeMarkdownText :content="item.text" />
                              </div>
                            </template>
                          </div>
                        </div>
                      </div>
                    </div>
                    <svg
                      class="drawing-layer"
                      :class="{ active: drawingOn }"
                      @pointerdown="startDrawing"
                      @pointermove="moveDrawing"
                      @pointerup="stopDrawing"
                      @pointerleave="stopDrawing"
                      @pointercancel="stopDrawing"
                    >
                      <path
                        v-for="stroke in currentDrawingStrokes"
                        :key="stroke.id"
                        class="drawing-stroke"
                        :d="drawingPath(stroke.points)"
                        :stroke="stroke.color"
                        :stroke-width="stroke.width"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <div
                v-if="currentQuestion.material"
                class="resize-divider"
                @mousedown="startDrag"
                @touchstart="startDrag"
              ></div>

              <div
                class="question-section"
                :class="{ 'with-material': currentQuestion.material, 'full-width': !currentQuestion.material }"
                :style="currentQuestion.material ? { width: `${100 - materialWidth}%` } : {}"
              >
                <section class="question-prompt-card" aria-label="Question prompt">
                  <div class="question-card-label">Question</div>
                  <div
                    class="question-text exam-highlightable"
                    :class="{ 'highlighter-active': highlighterOn }"
                    @mouseup="applyHighlightToSelection"
                    @click="clearHighlightSpan"
                  >
                    <MixedContent
                      :key="currentQuestion.questionNumber"
                      :content="currentQuestion.stem"
                      text-mode="markdown"
                      @image-click="openStemImagePreview"
                    />
                  </div>
                </section>

                <section class="answer-area-card" aria-label="Answer area">
                  <div class="answer-card-label">Answer</div>

                  <component
                    :is="currentQuestionTypeAnswer"
                    v-if="currentQuestionTypeAnswer"
                    :key="currentQuestion.questionNumber"
                    :question="currentQuestion"
                    :model-value="getAnswer(currentQuestion.questionNumber)"
                    :readonly="isQuestionReadOnly(currentQuestion.questionNumber)"
                    :review-mode="isReviewMode"
                    :answers-visible="areAnswersVisible"
                    :correct-answer-data="currentQuestion.correctAnswerData || currentQuestion.correctAnswer"
                    :eliminate-mode="eliminateModeOn"
                    :eliminated-keys="eliminatedKeysFor(currentQuestion.questionNumber)"
                    @update:model-value="setAnswer(currentQuestion.questionNumber, $event)"
                    @toggle-eliminate="toggleEliminatedKey(currentQuestion.questionNumber, $event)"
                  />

                  <div v-else-if="isDragDropQuestion(currentQuestion)" class="structured-answer">
                    <div v-for="item in currentQuestion.dragItems" :key="item.id" class="drag-match-row">
                      <span>{{ item.text }}</span>
                      <select
                        class="form-input"
                        :disabled="isQuestionReadOnly(currentQuestion.questionNumber)"
                        :value="getStructuredAnswer(currentQuestion.questionNumber).matches?.[item.id] || ''"
                        @change="updateDragDrop(currentQuestion, item.id, $event.target.value)"
                      >
                        <option value="">Drop zone</option>
                        <option v-for="zone in currentQuestion.dropZones" :key="zone.id" :value="zone.id">
                          {{ zone.label }}
                        </option>
                      </select>
                    </div>
                  </div>

                  <div v-else-if="isHotTextQuestion(currentQuestion)" class="structured-answer hot-text-list">
                    <button
                      v-for="segment in currentQuestion.hotTextSegments"
                      :key="segment.id"
                      type="button"
                      class="hot-text-segment"
                      :class="{ selected: getStructuredAnswer(currentQuestion.questionNumber).selectedIds?.includes(segment.id) }"
                      :disabled="isQuestionReadOnly(currentQuestion.questionNumber)"
                      @click="toggleStructuredId(currentQuestion, 'selectedIds', segment.id)"
                    >
                      {{ segment.text }}
                    </button>
                  </div>

                  <div v-else-if="isHotSpotQuestion(currentQuestion)" class="structured-answer">
                    <div class="hot-spot-material">
                      <img v-if="currentQuestion.material?.assetUrl" :src="currentQuestion.material.assetUrl" alt="Hot spot material" />
                      <p v-else class="status-note">Select the matching region below.</p>
                    </div>
                    <div class="hot-spot-regions">
                      <button
                        v-for="region in currentQuestion.hotSpotRegions"
                        :key="region.id"
                        type="button"
                        class="hot-spot-region"
                        :class="{ selected: getStructuredAnswer(currentQuestion.questionNumber).regions?.includes(region.id) }"
                        :disabled="isQuestionReadOnly(currentQuestion.questionNumber)"
                        @click="toggleStructuredId(currentQuestion, 'regions', region.id)"
                      >
                        {{ region.label }}
                      </button>
                    </div>
                  </div>

                  <div v-else-if="isGraphQuestion(currentQuestion)" class="structured-answer graph-answer">
                    <p class="fill-blank-hint">Enter the point or coordinate requested by the question.</p>
                    <label class="form-field">
                      <span class="form-label">x</span>
                      <input
                        class="form-input"
                        type="number"
                        step="any"
                        :disabled="isQuestionReadOnly(currentQuestion.questionNumber)"
                        :value="getStructuredAnswer(currentQuestion.questionNumber).points?.[0]?.x ?? ''"
                        @input="updateGraphPoint(currentQuestion, 'x', $event.target.value)"
                      />
                    </label>
                    <label class="form-field">
                      <span class="form-label">y</span>
                      <input
                        class="form-input"
                        type="number"
                        step="any"
                        :disabled="isQuestionReadOnly(currentQuestion.questionNumber)"
                        :value="getStructuredAnswer(currentQuestion.questionNumber).points?.[0]?.y ?? ''"
                        @input="updateGraphPoint(currentQuestion, 'y', $event.target.value)"
                      />
                    </label>
                  </div>

                  <div v-else class="fill-blank-container">
                    <div class="fill-blank-label">Your Answer:</div>
                    <textarea
                      class="fill-blank-input"
                      :class="{ readonly: isQuestionReadOnly(currentQuestion.questionNumber) }"
                      rows="3"
                      placeholder="Enter your answer here..."
                      :value="getAnswer(currentQuestion.questionNumber)"
                      :disabled="isQuestionReadOnly(currentQuestion.questionNumber)"
                      @input="setAnswer(currentQuestion.questionNumber, $event.target.value)"
                    ></textarea>
                    <div v-if="isReadOnlyMode" class="readonly-notice">
                      <strong>Review Mode:</strong> This is your submitted answer. Changes are not allowed.
                    </div>
                    <div v-else class="fill-blank-hint">Please write your answer clearly in the space above.</div>
                  </div>
                </section>
              </div>
            </div>
          </section>

          <AppCard v-else title="No Questions">
            <p class="status-note">No answerable questions were returned. Please ask your teacher to check the paper setup.</p>
          </AppCard>
        </section>

      <AppCard v-else-if="!isReviewMode" title="Opening Report">
        <p class="status-note">The attempt has been submitted. Opening the report page...</p>
      </AppCard>
    </template>
  </section>
</template>

<style scoped>
.student-exam {
  --exam-content-width: 1600px;
  display: grid;
  gap: 0;
  width: 100%;
  min-height: 100vh;
  margin: 0;
  padding-bottom: 0;
  background: #ffffff;
  box-shadow: none;
}

.student-exam--wide {
  --exam-content-width: 1760px;
}

.student-exam--ultra-wide {
  --exam-content-width: 1920px;
}

.student-exam > .app-card,
.student-exam__alert,
.student-exam__summary,
.student-exam__workspace {
  width: min(var(--exam-content-width), 100%);
  margin-right: auto;
  margin-left: auto;
}

.student-exam > .app-card {
  width: calc(100% - 32px);
  margin-top: 16px;
}

.student-exam__summary {
  display: flex;
  gap: 12px;
  width: calc(100% - 32px);
  padding-top: 16px;
}

.student-exam__summary {
  align-items: stretch;
}

.student-exam__summary > * {
  flex: 1;
}

.student-exam__state {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 32px;
  text-align: center;
}

.student-exam__state--error {
  justify-items: start;
  text-align: left;
}

.student-exam__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-primary-soft);
  border-top-color: var(--color-primary);
  border-radius: 999px;
  animation: spin 800ms linear infinite;
}

.student-exam__alert {
  width: calc(100% - 32px);
  margin-top: 12px;
  border: 1px solid #cfe0ff;
  border-radius: var(--radius-md);
  padding: 12px 14px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
}

.student-exam__alert--closable {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.student-exam__alert-close {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  color: currentColor;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.72;
}

.student-exam__alert-close:hover {
  background: rgba(0, 0, 0, 0.06);
  opacity: 1;
}

.student-exam__alert--error {
  border-color: rgba(199, 55, 71, 0.24);
  color: var(--color-danger);
  background: #fff1f3;
}

.student-exam__alert--warning {
  border-color: rgba(189, 119, 9, 0.24);
  color: #8a5a08;
  background: #fff8e8;
}

.exam-confirm {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(17, 24, 39, 0.38);
}

.focus-violation-modal {
  z-index: 6500;
}

.focus-violation-modal__error {
  margin: 8px 0 0;
  color: #b42318;
  font-size: 13px;
}

.fullscreen-required-overlay {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(17, 24, 39, 0.38);
}

.fullscreen-required-dialog {
  display: grid;
  justify-items: center;
  gap: 12px;
  width: min(420px, 100%);
  padding: 32px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 12px;
  color: #ffffff;
  background: #1f2937;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
  text-align: center;
}

.fullscreen-required-dialog__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 50%;
  font-size: 25px;
}

.fullscreen-required-dialog h2,
.fullscreen-required-dialog p {
  margin: 0;
}

.fullscreen-required-dialog p {
  color: #d1d5db;
}

.fullscreen-required-dialog__button {
  min-height: 42px;
  margin-top: 8px;
  padding: 0 20px;
  border: 0;
  border-radius: 6px;
  color: #102a43;
  background: #ffffff;
  cursor: pointer;
  font-weight: 700;
}

.fullscreen-required-dialog__button:hover {
  background: #e5e7eb;
}

.exam-confirm__panel {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 14px;
  width: min(440px, 100%);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  padding: 22px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.22);
}

.exam-confirm__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  color: #667085;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.exam-confirm__close:hover {
  background: #f2f4f7;
  color: #344054;
}

.exam-confirm__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  color: #8a5a08;
  background: #fff3cd;
  font-weight: 800;
}

.exam-confirm__icon--danger {
  color: #b42318;
  background: #fee4e2;
}

.exam-confirm__content {
  min-width: 0;
  padding-right: 22px;
}

.exam-confirm__content h2 {
  margin: 0 0 8px;
  color: #101828;
  font-size: 18px;
  line-height: 1.3;
}

.exam-confirm__content p {
  margin: 0;
  color: #475467;
  font-size: 14px;
  line-height: 1.55;
}

.exam-confirm__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.exam-confirm__button {
  min-width: 96px;
  border: 1px solid #d0d5dd;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.exam-confirm__button--secondary {
  color: #344054;
  background: #ffffff;
}

.exam-confirm__button--secondary:hover {
  background: #f9fafb;
}

.exam-confirm__button--primary {
  border-color: #1d4ed8;
  color: #ffffff;
  background: #2563eb;
}

.exam-confirm__button--primary:hover {
  background: #1d4ed8;
}

.exam-confirm__button--danger {
  border-color: #b42318;
  background: #d92d20;
}

.exam-confirm__button--danger:hover {
  background: #b42318;
}

.exam-toolbar {
  position: sticky;
  top: 0;
  z-index: 220;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  margin: 0;
  border-bottom: 1px solid #c5c5c5;
  overflow-y: visible;
  padding: 5px 9px;
  color: #232323;
  background: linear-gradient(180deg, #fbfbfb 0%, #eeeeee 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}

.toolbar-left,
.toolbar-center,
.toolbar-right,
.nav-buttons-group,
.toolbar-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  min-width: 0;
  white-space: nowrap;
}

.toolbar-left,
.toolbar-right {
  flex: 0 0 auto;
}

.toolbar-left {
  justify-content: flex-start;
}

.toolbar-center {
  flex: 1 1 auto;
  justify-content: flex-start;
  overflow: visible;
}

.toolbar-right {
  margin-left: auto;
  justify-content: flex-end;
}

.toolbar-tools {
  gap: 4px;
  border: 0;
  border-radius: 0;
  overflow: visible;
  background: transparent;
}

.nav-button,
.review-button,
.mark-button,
.submit-section-button,
.submit-exam-button,
.user-menu-button,
.tool-button {
  border: 1px solid #a8a8a8;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease;
}

.nav-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  width: 38px;
  height: 32px;
  color: #ffffff;
  background: linear-gradient(180deg, #2d74d8 0%, #0f4fb4 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32);
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}

.nav-button:hover:not(:disabled) {
  background: linear-gradient(180deg, #3a83eb 0%, #155abd 100%);
}

.nav-button:disabled,
.review-button:disabled,
.mark-button:disabled,
.submit-section-button:disabled,
.submit-exam-button:disabled,
.user-menu-button:disabled,
.tool-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.review-menu,
.width-selector,
.font-selector,
.tool-selector {
  position: relative;
}

.font-button {
  font-weight: 800;
}

.review-button,
.mark-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  border-radius: 4px;
  padding: 0 11px;
  color: #222222;
  background: linear-gradient(180deg, #ffffff 0%, #e7e7e7 100%);
  font-size: 14px;
  font-weight: 600;
}

.review-button:hover,
.mark-button:hover {
  background: linear-gradient(180deg, #ffffff 0%, #dcdcdc 100%);
}

.mark-button {
  min-width: 108px;
}

.mark-button.active {
  background: linear-gradient(180deg, #fff8df 0%, #f5cf70 100%);
  border-color: #8d6d1e;
}

.submit-section-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  flex: 0 0 auto;
  border-color: #8f1d1d;
  border-radius: 4px;
  padding: 0 12px;
  color: #ffffff;
  background: linear-gradient(180deg, #d43a32 0%, #9f1f1f 100%);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}

.submit-section-button:hover:not(:disabled) {
  background: linear-gradient(180deg, #e14c44 0%, #aa2424 100%);
}

.submit-exam-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  flex: 0 0 auto;
  border-color: #6f1515;
  border-radius: 4px;
  padding: 0 12px;
  color: #ffffff;
  background: linear-gradient(180deg, #b82727 0%, #7f1414 100%);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}

.submit-exam-button:hover:not(:disabled) {
  background: linear-gradient(180deg, #c93636 0%, #8f1919 100%);
}

.bookmark-icon {
  width: 14px;
  height: 18px;
  border: 2px solid currentColor;
  border-bottom: 0;
  border-radius: 2px 2px 0 0;
}

.bookmark-icon::after {
  content: '';
  display: block;
  width: 8px;
  height: 8px;
  margin: 9px auto 0;
  background: #f7f7f7;
  transform: rotate(45deg);
}

.tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-width: 1px;
  border-color: #b5b5b5;
  border-radius: 3px;
  width: 34px;
  height: 32px;
  color: #2d2d2d;
  background: linear-gradient(180deg, #ffffff 0%, #ededed 100%);
  font-size: 15px;
  font-weight: 700;
}

.tool-button:hover,
.tool-button.active {
  color: #ffffff;
  border-color: #343434;
  background: linear-gradient(180deg, #4a4a4a 0%, #262626 100%);
}

.tool-icon {
  position: relative;
  display: inline-block;
  width: 18px;
  height: 18px;
  color: currentColor;
}

.tool-icon::before,
.tool-icon::after {
  content: '';
  position: absolute;
  display: block;
  box-sizing: border-box;
}

.tool-icon--highlight::before {
  left: 4px;
  top: 2px;
  width: 8px;
  height: 12px;
  border: 2px solid currentColor;
  border-radius: 2px;
  background: var(--highlight-color);
  transform: rotate(28deg);
}

.tool-icon--highlight::after {
  left: 3px;
  bottom: 1px;
  width: 13px;
  height: 3px;
  border-radius: 1px;
  background: var(--highlight-color);
  box-shadow: 0 0 0 1px currentColor;
}

.tool-icon--pen::before {
  left: 7px;
  top: 1px;
  width: 5px;
  height: 14px;
  border: 1px solid currentColor;
  border-radius: 2px;
  background: var(--pen-color);
  transform: rotate(36deg);
}

.tool-icon--pen::after {
  left: 2px;
  bottom: 2px;
  width: 10px;
  height: 2px;
  background: currentColor;
  transform: rotate(-12deg);
}

.tool-selector {
  display: inline-flex;
  gap: 1px;
}

.tool-selector .tool-button {
  flex: 0 0 auto;
}

.tool-split-button {
  width: 20px;
  font-size: 11px;
}

.tool-color-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  min-height: 16px;
  border-radius: 2px;
}

.tool-color-menu {
  display: grid;
  min-width: 150px;
  border-color: #9f9f9f;
  border-radius: 2px;
  padding: 4px;
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.28);
}

.tool-color-option {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 2px;
  padding: 8px;
  color: #222222;
  background: #ffffff;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.tool-color-option:hover,
.tool-color-option.active {
  background: #e8eef8;
}

.tool-color-option--danger {
  justify-content: center;
  border-top: 1px solid #dddddd;
  margin-top: 4px;
  color: #9b1c1c;
  font-weight: 700;
}

.tool-color-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid #777777;
  border-radius: 2px;
}

.highlight-popover {
  position: fixed;
  z-index: 320;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #8f8f8f;
  border-radius: 4px;
  padding: 6px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.26);
}

.highlight-popover::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 10px;
  height: 10px;
  border-right: 1px solid #8f8f8f;
  border-bottom: 1px solid #8f8f8f;
  background: #ffffff;
  transform: translateX(-50%) rotate(45deg);
}

.highlight-popover__color,
.highlight-popover__close {
  position: relative;
  z-index: 1;
  width: 26px;
  height: 24px;
  border: 1px solid #777777;
  border-radius: 3px;
  cursor: pointer;
}

.highlight-popover__color:hover,
.highlight-popover__close:hover {
  box-shadow: 0 0 0 2px rgba(34, 102, 199, 0.22);
}

.highlight-popover__close {
  color: #333333;
  background: linear-gradient(180deg, #ffffff 0%, #eeeeee 100%);
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}

.timer-display {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 1px solid #a8a8a8;
  border-radius: 4px;
  padding: 0 12px;
  color: #222222;
  background: #ffffff;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.focus-violation-counter {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 1px solid #fecaca;
  border-radius: 4px;
  padding: 0 12px;
  color: #b42318;
  background: #fff5f5;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.user-menu-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  border-radius: 4px;
  padding: 0 12px;
  color: #222222;
  background: linear-gradient(180deg, #ffffff 0%, #e8e8e8 100%);
  font-size: 13px;
  font-weight: 700;
}

.exam-path-bar {
  position: sticky;
  top: 48px;
  z-index: 210;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 31px;
  padding: 0 16px;
  color: #ffffff;
  background: linear-gradient(180deg, #454545 0%, #242424 100%);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.28);
}

.battery-indicator {
  margin-left: auto;
  width: 28px;
  height: 13px;
  border: 2px solid #f5f5f5;
  border-radius: 2px;
}

.battery-indicator::before {
  content: '';
  display: block;
  width: 18px;
  height: 7px;
  margin: 1px;
  background: #f5f5f5;
}

.battery-indicator::after {
  content: '';
  position: absolute;
  width: 3px;
  height: 7px;
  margin-top: -10px;
  margin-left: 26px;
  border-radius: 0 2px 2px 0;
  background: #f5f5f5;
}

.student-exam__workspace {
  display: block;
  background:
    radial-gradient(circle at top left, rgba(0, 0, 0, 0.04), transparent 260px),
    #e9e9e9;
}

.exam-transition-page {
  display: grid;
  place-items: center;
  min-height: calc(100vh - 79px);
  padding: 48px 16px;
}

.exam-transition-page--pre-attempt {
  min-height: calc(100vh - 32px);
  background:
    radial-gradient(circle at top left, rgba(0, 0, 0, 0.04), transparent 260px),
    #e9e9e9;
}

.exam-transition-card {
  width: min(680px, 100%);
  border: 1px solid #b9b9b9;
  border-radius: 3px;
  padding: 34px 38px;
  color: #202020;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
}

.exam-transition-card__eyebrow {
  margin: 0 0 10px;
  color: #4d4d4d;
  font-size: calc(12px * var(--exam-font-scale));
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.exam-transition-card h1 {
  margin: 0;
  color: #111111;
  font-size: calc(28px * var(--exam-font-scale));
  line-height: 1.2;
}

.exam-transition-card__body {
  margin: 18px 0 0;
  color: #333333;
  font-size: calc(17px * var(--exam-font-scale));
  line-height: 1.55;
}

.exam-transition-card__list {
  display: grid;
  gap: 10px;
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  color: #333333;
  font-size: calc(15px * var(--exam-font-scale));
  line-height: 1.45;
}

.exam-transition-card__list li {
  position: relative;
  padding-left: 18px;
}

.exam-transition-card__list li::before {
  position: absolute;
  top: 0.6em;
  left: 0;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #1f66c2;
  content: '';
}

.exam-transition-card__context {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
}

.exam-transition-card__context span {
  border: 1px solid #c6c6c6;
  border-radius: 999px;
  padding: 6px 11px;
  color: #303030;
  background: #f5f5f5;
  font-size: calc(13px * var(--exam-font-scale));
  font-weight: 700;
}

.exam-transition-card__button {
  min-width: 132px;
  margin-top: 28px;
  border: 1px solid #0f4fb4;
  border-radius: 4px;
  padding: 11px 20px;
  color: #ffffff;
  background: linear-gradient(180deg, #2d74d8 0%, #0f4fb4 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32);
  font-size: calc(15px * var(--exam-font-scale));
  font-weight: 800;
  cursor: pointer;
}

.exam-transition-card__button:hover {
  background: linear-gradient(180deg, #3a83eb 0%, #155abd 100%);
}

.review-panel.dropdown,
.tool-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  z-index: 80;
  border: 1px solid var(--color-border);
  background: #ffffff;
  box-shadow: 0 14px 34px rgba(31, 75, 135, 0.16);
}

.review-panel.dropdown {
  display: flex;
  flex-direction: column;
  top: calc(100% + 6px);
  left: 0;
  z-index: 260;
  overflow: hidden;
  border-color: #9f9f9f;
  border-radius: 2px;
  width: 390px;
  max-height: min(520px, calc(100vh - 72px));
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.32);
}

.review-header {
  border-bottom: 1px solid #c8c8c8;
  padding: 0;
  background: #f3f3f3;
}

.question-stats {
  display: flex;
  gap: 0;
}

.stat-item {
  flex: 1;
  border: 0;
  border-right: 1px solid #c8c8c8;
  border-radius: 0;
  padding: 10px 8px;
  color: #333333;
  background: #f5f5f5;
  cursor: pointer;
}

.stat-item:last-child {
  border-right: 0;
}

.stat-item.active {
  color: #111111;
  background: #ffffff;
  box-shadow: inset 0 -3px 0 #2266c7;
}

.stat-number,
.stat-label {
  display: block;
}

.stat-number {
  font-size: 18px;
  font-weight: 700;
}

.stat-label {
  font-size: 11px;
}

.question-list {
  display: grid;
  gap: 0;
  overflow-y: auto;
  padding: 0;
}

.question-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 0;
  border-bottom: 1px solid #dddddd;
  border-radius: 0;
  padding: 12px 14px;
  color: #202020;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
}

.question-item:hover {
  background: #eeeeee;
}

.question-item:disabled {
  cursor: not-allowed;
}

.question-item.current {
  color: #ffffff;
  background: #3f3f3f;
}

.question-item.answered {
  background: #f8fbff;
}

.question-item.answered.current {
  color: #ffffff;
  background: #3f3f3f;
}

.question-item.marked {
  box-shadow: inset 4px 0 0 #f0b400;
}

.question-item.saved {
  border-right: 0;
}

.question-item.locked {
  color: #7b8799;
  background: #f4f7fb;
  opacity: 0.78;
}

.saved-dot {
  font-size: 11px;
  font-weight: 700;
}

.lock-dot {
  font-size: 11px;
  font-weight: 700;
}

.tool-dropdown {
  right: 0;
  z-index: 260;
  overflow: hidden;
  border-radius: 10px;
  min-width: 120px;
}

.tool-option {
  display: block;
  border: 0;
  width: 100%;
  padding: 10px 12px;
  color: #1e2a3f;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
}

.tool-option:hover,
.tool-option.active {
  color: #ffffff;
  background: var(--color-primary);
}

.notes-panel {
  position: fixed;
  z-index: 90;
  display: grid;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  width: min(420px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  padding: 12px;
  background: #ffffff;
  box-shadow: 0 18px 44px rgba(31, 75, 135, 0.2);
}

.notes-panel__head,
.question-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.notes-panel__head {
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.notes-panel.dragging .notes-panel__head,
:global(body.exam-notes-dragging) {
  cursor: grabbing;
}

.notes-panel__head button {
  border: 0;
  border-radius: 999px;
  width: 28px;
  height: 28px;
  color: #ffffff;
  background: var(--color-primary);
  cursor: pointer;
}

.notes-panel textarea {
  min-height: 140px;
  resize: vertical;
}

/* Highlighter (R-22) */
.exam-highlightable.highlighter-active {
  cursor: text;
}

.exam-question-shell :deep(.exam-highlight) {
  background: #fff3a3;
  border-radius: 2px;
  cursor: pointer;
}

/* Line Reader Mask (R-25) */
.line-reader {
  position: fixed;
  inset: 0;
  z-index: 70;
  pointer-events: none;
}

.line-reader__mask {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(17, 24, 39, 0.45);
}

.line-reader__mask--top {
  top: 0;
}

.line-reader__mask--bottom {
  bottom: 0;
}

.line-reader__strip {
  position: absolute;
  left: 0;
  right: 0;
  height: 48px;
  border-top: 2px solid rgba(47, 111, 237, 0.9);
  border-bottom: 2px solid rgba(47, 111, 237, 0.9);
  background: transparent;
  cursor: grab;
  pointer-events: auto;
  touch-action: none;
}

.line-reader__strip.dragging {
  cursor: grabbing;
}

.progress-card {
  display: grid;
  gap: 12px;
}

.progress-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.progress-card__bar {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-surface-soft);
}

.progress-card__bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(135deg, var(--color-primary), #73a4ff);
  transition: width 180ms ease;
}

.exam-question-shell {
  /* Font scale lets the toolbar font-size control resize all exam text. */
  --exam-font-scale: 1.15;
  --exam-stem-size: calc(17px * var(--exam-font-scale));
  --exam-answer-size: calc(15px * var(--exam-font-scale));
  --exam-caption-size: calc(12px * var(--exam-font-scale));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: calc(100vh - 88px);
  border: 0;
  border-radius: 0;
  background: transparent;
}

.question-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 0;
  padding: 16px 22px 0;
  background: transparent;
}

.section-info {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #363636;
  font-size: 13px;
  font-weight: 700;
}

.section-info span {
  display: inline-flex;
  align-items: center;
  border-radius: 3px;
  padding: 4px 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
}

.section-info .question-number {
  color: #111111;
}

.section-info .group-label {
  color: #2d2d2d;
}

.section-info .progress {
  color: #ffffff;
  background: #3f3f3f;
}

/* Material on the left, divider, then question on the right. */
.question-content {
  display: flex;
  align-items: stretch;
  gap: 16px;
  flex: 1;
  padding: 18px 22px 28px;
  min-height: calc(100vh - 138px);
}

.material-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  flex-shrink: 0;
  border: 1px solid #c9c9c9;
  border-radius: 4px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
}

.material-content {
  flex: 1;
  overflow-y: auto;
  padding: 22px;
}

.material-content.scrollable {
  max-height: calc(100vh - 178px);
}

.material-image-button {
  display: block;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: zoom-in;
}

.material-image-button:disabled {
  cursor: crosshair;
}

.material-image {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.material-canvas {
  position: relative;
  min-height: 100%;
}

.material-canvas.drawing-active {
  cursor: crosshair;
}

.material-text {
  position: relative;
  z-index: 1;
  color: #333333;
  font-size: calc(16px * var(--exam-font-scale));
  line-height: 1.6;
  white-space: pre-wrap;
}

.material-display {
  display: flex;
  flex-direction: column;
  gap: 18px;
  white-space: normal;
}

.material-display__introduction {
  color: #333333;
  white-space: pre-wrap;
}

.material-display__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 2px 0 6px;
  text-align: center;
}

.material-display__header-line {
  color: #222222;
}

.material-display__header-line--title {
  font-weight: 700;
}

.material-display__header-line--author {
  font-weight: 500;
}

.material-display__body {
  display: flex;
  flex-direction: column;
}

.material-display__body-line {
  min-height: 1.6em;
}

.material-display__body-line--empty {
  min-height: 1.4em;
}

.material-display__body-line--image {
  display: block;
  min-height: 0;
  margin: 10px 0;
}

.material-display__line-text {
  min-width: 0;
}

.material-display__image-button {
  display: block;
  width: 100%;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 0;
  background: #ffffff;
  cursor: zoom-in;
}

.material-display__image-button:disabled {
  cursor: crosshair;
}

.material-display__image {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
}

.drawing-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  min-height: 100%;
  pointer-events: none;
  touch-action: none;
}

.drawing-layer.active {
  pointer-events: auto;
}

.drawing-stroke {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(16, 24, 40, 0.72);
}

.image-preview-dialog {
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

.image-preview-dialog__header {
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

.image-preview-dialog__header div:first-child {
  display: grid;
  gap: 2px;
}

.image-preview-dialog__header span {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.image-preview-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.image-preview-dialog__actions button {
  min-width: 72px;
  height: 34px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-text);
  background: var(--color-surface-muted);
  cursor: pointer;
  font-weight: 700;
}

.image-preview-dialog__viewport {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #111827;
}

.image-preview-dialog img {
  display: block;
  max-width: 100%;
  max-height: calc(92vh - 59px);
  margin: 0 auto;
  object-fit: contain;
  cursor: zoom-in;
  transition: transform 160ms ease;
}

.image-preview-dialog img.zoomed {
  cursor: grab;
  touch-action: none;
}

.image-preview-dialog img.zoomed:active {
  cursor: grabbing;
}

.resize-divider {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  margin: 0 -13px;
  cursor: col-resize;
  user-select: none;
}

.resize-divider::before {
  content: '';
  width: 4px;
  height: 64px;
  border-radius: 999px;
  background: #777777;
  transition: background-color 160ms ease;
}

.resize-divider:hover::before {
  background: #225cae;
}

.question-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.question-section.full-width {
  width: 100%;
}

.question-section.with-material {
  box-sizing: border-box;
  flex-shrink: 0;
  min-width: 0;
}

.question-prompt-card,
.answer-area-card {
  border: 1px solid #c9c9c9;
  border-radius: 4px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
}

.question-prompt-card {
  overflow: hidden;
}

.answer-area-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  background: #ffffff;
}

.question-card-label,
.answer-card-label {
  color: #333333;
  font-size: var(--exam-caption-size);
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.question-card-label {
  border-bottom: 1px solid #d4d4d4;
  padding: 10px 16px;
  background: linear-gradient(180deg, #f8f8f8 0%, #e6e6e6 100%);
}

.answer-card-label {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
}

.question-text {
  min-width: 0;
  overflow-x: hidden;
  padding: 22px;
  color: #1f1f1f;
  font-size: var(--exam-stem-size);
  line-height: 1.65;
  white-space: pre-wrap;
}

.question-text :deep(.mixed-content) {
  min-width: 0;
  max-width: 100%;
}

.question-text :deep(.mixed-content__image-block) {
  width: 100%;
  max-width: 100%;
  text-align: center;
}

.question-text :deep(.mixed-content__image) {
  width: auto;
  min-width: 50%;
  max-width: 66.666%;
  margin: 0 auto;
}

.exam-question-shell :deep(.form-input) {
  min-height: 36px;
  padding: 8px 10px;
  font-size: var(--exam-answer-size);
}

.fill-blank-container {
  display: grid;
  gap: 8px;
  border: 1px solid #c9c9c9;
  border-radius: 4px;
  padding: 14px;
  background: #ffffff;
}

.fill-blank-label {
  color: #24314a;
  font-size: var(--exam-answer-size);
  font-weight: 700;
}

.fill-blank-input {
  width: 100%;
  min-height: 82px;
  resize: vertical;
  border: 1px solid #9f9f9f;
  border-radius: 3px;
  padding: 10px 12px;
  color: var(--color-text);
  background: #ffffff;
  font-size: var(--exam-answer-size);
  line-height: 1.55;
}

.fill-blank-input:focus {
  border-color: #2266c7;
  outline: none;
  box-shadow: 0 0 0 3px rgba(34, 102, 199, 0.18);
}

.fill-blank-input.readonly {
  cursor: not-allowed;
  background: var(--color-surface-soft);
}

.fill-blank-hint {
  color: var(--color-muted);
  font-size: var(--exam-caption-size);
  font-style: italic;
}

.structured-answer {
  display: grid;
  gap: 10px;
  border: 1px solid #c9c9c9;
  border-radius: 4px;
  padding: 14px;
  background: #ffffff;
  font-size: var(--exam-answer-size);
}

.drag-match-row,
.graph-answer {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(180px, 1fr);
  align-items: center;
  gap: 12px;
}

.hot-text-list,
.hot-spot-regions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hot-text-segment,
.hot-spot-region {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
  color: var(--color-text);
  background: #ffffff;
  cursor: pointer;
}

.hot-text-segment.selected,
.hot-spot-region.selected {
  color: #ffffff;
  border-color: var(--color-primary);
  background: var(--color-primary);
}

.hot-text-segment:disabled,
.hot-spot-region:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.hot-spot-material img {
  display: block;
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.readonly-notice {
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  font-size: 13px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .student-exam__summary {
    display: grid;
    grid-template-columns: 1fr;
  }

  .exam-toolbar {
    gap: 8px;
    padding: 8px 10px;
    overflow-x: auto;
  }

  .toolbar-center {
    flex: 0 0 auto;
    justify-content: flex-start;
    gap: 8px;
  }

  .toolbar-left,
  .toolbar-right {
    justify-content: flex-start;
  }

  .toolbar-left {
    flex: 0 0 auto;
  }

  .exam-title {
    max-width: 220px;
  }

  .review-panel.dropdown {
    position: fixed;
    top: auto;
    right: 16px;
    left: 16px;
    width: auto;
    max-height: min(460px, calc(100vh - 96px));
  }

  /* Stack material above question on narrow screens; ignore inline widths. */
  .question-content {
    flex-direction: column;
  }

  .material-section,
  .question-section.with-material {
    width: 100% !important;
  }

  .material-content.scrollable {
    max-height: none;
  }

  .resize-divider {
    display: none;
  }
}
</style>
