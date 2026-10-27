<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import AdminTabs from '@/components/admin/AdminTabs.vue';
import ResponsiveActionGroup from '@/components/admin/ResponsiveActionGroup.vue';
import AdminTabPanels from '@/components/admin/AdminTabPanels.vue';
import AdminSection from '@/components/admin/AdminSection.vue';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import AdminExamCard from '@/components/admin/AdminExamCard.vue';
import AdminDataTable from '@/components/admin/AdminDataTable.vue';
import AdminActionMenu from '@/components/admin/AdminActionMenu.vue';
import RichSelect from '@shsat/components/RichSelect.vue';
import { adminApi } from '@shsat/admin/services/adminApi';
import { studentApi } from '@shsat/admin/services/studentApi';
import { getUserRole } from '@shsat/admin/authBridge';

const router = useRouter();
const route = useRoute();

const tabs = [
  { key: 'papers', label: 'Paper Management' },
  { key: 'exams', label: 'Exam Release' },
  { key: 'wrong-answer-tasks', label: 'Review Assignments' },
  { key: 'classes', label: 'Classes' },
];
const isTeacherPortal = computed(() => getUserRole() === 'teacher');
const canAccessExamMonitor = computed(() => ['admin', 'teacher'].includes(getUserRole()));
const visibleTabs = computed(() => (isTeacherPortal.value ? tabs.filter((tab) => tab.key !== 'papers') : tabs));

const DEFAULT_FOLDER_KEY = 'default-folder';
const PAPER_DELETE_COOLDOWN_SECONDS = 10;
const EXAM_DELETE_COOLDOWN_SECONDS = 5;
const OFFICIAL_SHSAT_TOTAL_QUESTIONS = 100;
const OFFICIAL_SHSAT_SECTION_QUESTIONS = 50;
const ADMIN_TAB_STORAGE_KEY = 'shsat_admin_active_tab';

const defaultTab = getUserRole() === 'teacher' ? 'classes' : 'papers';
const storedTab = localStorage.getItem(ADMIN_TAB_STORAGE_KEY);
const requestedTab = typeof route.query.tab === 'string' ? route.query.tab : '';
const activeTab = ref(
  tabs.some((tab) => tab.key === requestedTab)
    ? requestedTab
    : (tabs.some((tab) => tab.key === storedTab) ? storedTab : defaultTab),
);
if (!visibleTabs.value.some((tab) => tab.key === activeTab.value)) {
  activeTab.value = defaultTab;
}
watch(activeTab, (tabKey) => {
  if (tabs.some((tab) => tab.key === tabKey)) {
    localStorage.setItem(ADMIN_TAB_STORAGE_KEY, tabKey);
  }
}, { immediate: true });
const paperGroups = ref([]);
const papers = ref([]);
const paperDetail = ref(null);
const exams = ref([]);
const adminExams = ref([]);
const classes = ref([]);
const wrongAnswerTasks = ref([]);
const wrongAnswerTaskLoading = ref(false);
const endingWrongAnswerTaskId = ref(null);
const wrongAnswerTaskError = ref('');
const wrongAnswerTaskModalOpen = ref(false);
const wrongAnswerTaskSubmitting = ref(false);
const wrongAnswerTaskFormError = ref('');
const wrongAnswerTaskForm = reactive({
  examId: '',
  classId: '',
  title: '',
  description: '',
  startAt: '',
  endAt: '',
});
const wrongAnswerTaskFilters = reactive({
  classId: typeof route.query.reviewClassId === 'string' ? route.query.reviewClassId : '',
  examId: typeof route.query.reviewExamId === 'string' ? route.query.reviewExamId : '',
  keyword: typeof route.query.reviewKeyword === 'string' ? route.query.reviewKeyword : '',
});
const students = ref([]);
const unassignedStudents = ref([]);
const selectedUnassignedStudentIds = ref([]);
const showBulkAssignModal = ref(false);
const bulkAssignClassId = ref('');
const bulkAssigning = ref(false);
const bulkAssignError = ref('');
const classScores = ref([]);
const classView = ref('list');
const selectedPaperId = ref('');
const selectedClassId = ref('');
const AVAILABLE_EXAMS_COLLAPSED_KEY = 'admin.available-exams-collapsed.SHSAT';
const availableExamsCollapsed = ref(localStorage.getItem(AVAILABLE_EXAMS_COLLAPSED_KEY) === 'true');
const ASSIGNED_REVIEW_COLLAPSED_KEY = 'admin.assigned-review-collapsed.SHSAT';
const assignedReviewCollapsed = ref(localStorage.getItem(ASSIGNED_REVIEW_COLLAPSED_KEY) === 'true');
const examReleasesCollapsed = ref(false);
const historicalExamsCollapsed = ref(false);
const classExamsCollapsed = ref(false);
const unassignedStudentsCollapsed = ref(false);
const showGroupModal = ref(false);
const showMoveModal = ref(false);
const showPaperCreateModal = ref(false);
const showPaperEditModal = ref(false);
const showExamReleaseModal = ref(false);
const showPaperDetailModal = ref(false);
const showClassModal = ref(false);
// The class modal is reused for create and edit; an empty editingClassId means create mode.
const editingClassId = ref('');
const openPaperActionMenuId = ref(null);
const selectedMovePaper = ref(null);
const selectedEditPaper = ref(null);
const selectedEditGroup = ref(null);
const selectedDeleteGroup = ref(null);
const selectedDeletePaper = ref(null);
const paperDeleteImpact = ref(null);
const paperDeleteCooldown = ref(0);
const selectedPublishExam = ref(null);
const selectedPublishPaperStats = ref(null);
const createExamStructureConfirm = reactive({
  open: false,
  payload: null,
  stats: null,
});
const selectedDeleteExam = ref(null);
const examDeleteCooldown = ref(0);
const selectedDeleteClass = ref(null);
const deleteClassError = ref('');
const examActionDialog = reactive({
  open: false,
  title: '',
  message: '',
  variant: 'error',
});
const actionToast = reactive({
  open: false,
  title: '',
  message: '',
  variant: 'info',
});
let actionToastTimer = null;
let paperDeleteCooldownTimer = null;
let examDeleteCooldownTimer = null;
const draggingPaperGroupId = ref('');
const draggingClassId = ref('');
const paperGroupDropTargetId = ref('');
const classDragMoved = ref(false);
const suppressNextClassClick = ref(false);
const expandedFolders = reactive({});
const paperMoveTargets = reactive({});

const loading = reactive({
  initial: false,
  adminExams: false,
  papers: false,
  paperDetail: false,
  exams: false,
  classes: false,
  students: false,
  unassignedStudents: false,
  classScores: false,
  submittingExam: false,
  submittingClass: false,
  submittingGroup: false,
  reorderingPaperGroups: false,
  reorderingClasses: false,
  checkingExamPaperStats: false,
  deletingExamId: '',
  deletingClassId: '',
  movingPaperId: '',
  sealingPaperId: '',
  deletingGroupId: '',
  paperDeleteImpactId: '',
  deletingPaperId: '',
  publishPaperStatsId: '',
});

const errors = reactive({
  initial: '',
  adminExams: '',
  papers: '',
  paperDetail: '',
  exams: '',
  classes: '',
  students: '',
  unassignedStudents: '',
  classScores: '',
  examForm: '',
  classForm: '',
  groupForm: '',
  paperDelete: '',
});

const notices = reactive({
  examForm: '',
  classForm: '',
  groupForm: '',
});

const paperFilters = reactive({
  groupId: '',
  keyword: '',
  online: '',
});
const hasAppliedPaperFilter = ref(false);

const examReleaseFilters = reactive({
  keyword: '',
  published: '',
  timeStatus: '',
  targetType: '',
  page: 1,
  pageSize: 10,
});

const historicalExamFilters = reactive({
  page: 1,
  pageSize: 10,
});

const groupForm = reactive({
  groupName: '',
  groupDesc: '',
});

const moveForm = reactive({
  paperGroupId: '',
});

const paperEditForm = reactive({
  paperGroupId: '',
  paperName: '',
  paperDescription: '',
  totalParts: 2,
  totalQuestions: 0,
  defaultDuration: 180,
  totalScore: 0,
  status: 'DRAFT',
  online: false,
  displayOrder: 0,
  metadata: '',
});

const examForm = reactive({
  paperId: '',
  examTitle: '',
  examDescription: '',
  startTime: '',
  endTime: '',
  duration: 180,
  targetType: 'ALL_STUDENTS',
  targetIdsText: '',
  targetClassIds: [],
  attemptLimit: 1,
  autoSubmit: true,
  allowReview: true,
});
const examStartTimeInput = ref(null);
const examEndTimeInput = ref(null);
const wrongAnswerTaskStartAtInput = ref(null);
const wrongAnswerTaskEndAtInput = ref(null);

const examClassFilters = reactive({
  keyword: '',
});

const classForm = reactive({
  className: '',
  classDescription: '',
  teacherName: '',
  teacherEmail: '',
  gradeLevel: '',
  academicYear: '',
  active: true,
});

const reportForm = reactive({
  examId: '',
  classId: '',
});

const classFilters = reactive({
  keyword: '',
});

const scoreFilters = reactive({
  keyword: '',
  sortBy: 'score-desc',
});

const classExamFilters = reactive({
  page: 1,
  pageSize: 10,
});

const selectedPaper = computed(() => {
  return papers.value.find((paper) => getId(paper, 'paperId') === Number(examForm.paperId));
});

const selectedExamTargetClasses = computed(() => {
  const selectedIds = new Set(examForm.targetClassIds.map((item) => String(item)));

  return assignableExamClasses.value.filter((item) => selectedIds.has(String(item.classId)));
});

const assignableExamClasses = computed(() => classes.value.filter((item) => item.isActive));

const filteredExamTargetClasses = computed(() => {
  const keyword = examClassFilters.keyword.trim().toLowerCase();

  if (!keyword) {
    return assignableExamClasses.value;
  }

  return assignableExamClasses.value.filter((item) => {
    return [
      item.className,
      item.teacherName,
      item.gradeLevel,
      item.academicYear,
    ].some((value) => String(value || '').toLowerCase().includes(keyword));
  });
});

const selectedEditPaperQuestionCount = computed(() => getActualPaperQuestionCount(selectedEditPaper.value));

const selectedClass = computed(() => {
  return classes.value.find((item) => getId(item, 'classId') === Number(selectedClassId.value));
});

function getUnassignedStudentId(student) {
  return String(student?.userId || student?.id || '');
}

const assignableClasses = computed(() => {
  return classes.value.filter((item) => item.className !== 'Unassigned Students');
});

const selectedUnassignedStudents = computed(() => {
  const selectedIds = new Set(selectedUnassignedStudentIds.value);
  return unassignedStudents.value.filter((student) => selectedIds.has(getUnassignedStudentId(student)));
});

const allUnassignedStudentsSelected = computed(() => (
  unassignedStudents.value.length > 0
  && unassignedStudents.value.every((student) => selectedUnassignedStudentIds.value.includes(getUnassignedStudentId(student)))
));

const visibleClasses = computed(() => {
  const keyword = classFilters.keyword.trim().toLowerCase();

  if (!keyword) {
    return classes.value;
  }

  return classes.value.filter((item) => {
    return [
      item.className,
      item.teacherName,
      item.teacherEmail,
      item.gradeLevel,
      item.academicYear,
    ].some((value) => String(value || '').toLowerCase().includes(keyword));
  });
});

const canReorderClasses = computed(() => {
  return !classFilters.keyword.trim() && visibleClasses.value.length > 1;
});

const relatedClassExams = computed(() => {
  const classId = Number(selectedClassId.value);
  const keyword = scoreFilters.keyword.trim().toLowerCase();

  if (!classId) {
    return [];
  }

  return exams.value
    .filter((exam) => isExamAvailableForClass(exam, classId))
    .filter((exam) => {
      if (!keyword) {
        return true;
      }

      return [
        exam.examTitle,
        exam.paperName,
        exam.targetType,
        exam.status,
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    })
    .sort((a, b) => getTimeValue(b.startTime) - getTimeValue(a.startTime));
});

const sortedClassScores = computed(() => {
  const scores = [...classScores.value];

  return scores.sort((a, b) => {
    if (scoreFilters.sortBy === 'score-asc') {
      return getScoreValue(a) - getScoreValue(b);
    }
    if (scoreFilters.sortBy === 'name-asc') {
      return String(a.studentName || '').localeCompare(String(b.studentName || ''));
    }
    if (scoreFilters.sortBy === 'submitted-desc') {
      return getTimeValue(b.submittedAt) - getTimeValue(a.submittedAt);
    }

    return getScoreValue(b) - getScoreValue(a);
  });
});

const classScoreSummary = computed(() => {
  const scores = classScores.value.map(getScoreValue).filter((value) => Number.isFinite(value));
  const participants = classScores.value.length;
  const completed = classScores.value.filter((score) => String(score.status || '').toUpperCase() === 'COMPLETED').length;

  if (scores.length === 0) {
    return {
      participants,
      completed,
      average: '-',
      highest: '-',
      lowest: '-',
    };
  }

  const total = scores.reduce((sum, score) => sum + score, 0);

  return {
    participants,
    completed,
    average: formatNumber(total / scores.length),
    highest: formatNumber(Math.max(...scores)),
    lowest: formatNumber(Math.min(...scores)),
  };
});

const classExamTotalPages = computed(() => {
  return Math.max(1, Math.ceil(relatedClassExams.value.length / Number(classExamFilters.pageSize || 10)));
});

const paginatedRelatedClassExams = computed(() => {
  const pageSize = Number(classExamFilters.pageSize || 10);
  const currentPage = Math.min(classExamFilters.page, classExamTotalPages.value);
  const start = (currentPage - 1) * pageSize;

  return relatedClassExams.value.slice(start, start + pageSize);
});

const classExamPageStart = computed(() => {
  if (relatedClassExams.value.length === 0) {
    return 0;
  }

  return (Math.min(classExamFilters.page, classExamTotalPages.value) - 1) * Number(classExamFilters.pageSize || 10) + 1;
});

const classExamPageEnd = computed(() => {
  return Math.min(
    relatedClassExams.value.length,
    classExamPageStart.value + paginatedRelatedClassExams.value.length - 1,
  );
});

const adminExamCards = computed(() => {
  const now = Date.now();
  return adminExams.value
    .map(normalizeExam)
    .filter((exam) => {
      const startsAt = getTimeValue(exam.startTime);
      const endsAt = getTimeValue(exam.endTime);
      return startsAt > 0 && endsAt > now
        && !['ended', 'draft'].includes(exam.status.key);
    })
    .sort((a, b) => getTimeValue(a.startTime) - getTimeValue(b.startTime));
});

/** 判断复习任务是否已结束；服务端会在截止时间到达时动态返回 ENDED。 */
function isReviewAssignmentEnded(task) {
  const status = String(task?.status || '').toUpperCase();
  const endAt = getTimeValue(task?.endAt);
  return status === 'CLOSED' || status === 'ENDED' || (endAt > 0 && endAt <= Date.now());
}

/** 首页复习任务卡片：只展示仍可开始或继续的错题复习任务。 */
const dashboardReviewAssignments = computed(() => {
  return wrongAnswerTasks.value
    .filter((task) => !isReviewAssignmentEnded(task))
    .sort((left, right) => getTimeValue(right.createdAt) - getTimeValue(left.createdAt));
});

function reviewAssignmentStatusLabel(task) {
  if (isReviewAssignmentEnded(task)) {
    return 'Ended';
  }

  return getTimeValue(task?.startAt) > Date.now() ? 'Scheduled' : 'Active';
}

const filteredExamReleases = computed(() => {
  const keyword = examReleaseFilters.keyword.trim().toLowerCase();

  return exams.value
    .filter((exam) => {
      if (getExamTimeStatus(exam).key === 'ended') {
        return false;
      }
      if (examReleaseFilters.published === 'published' && !exam.published) {
        return false;
      }
      if (examReleaseFilters.published === 'unpublished' && exam.published) {
        return false;
      }
      if (examReleaseFilters.timeStatus && getExamTimeStatus(exam).key !== examReleaseFilters.timeStatus) {
        return false;
      }
      if (examReleaseFilters.targetType && !matchesExamTargetType(exam, examReleaseFilters.targetType)) {
        return false;
      }
      if (!keyword) {
        return true;
      }

      return [
        exam.examTitle,
        getExamPaperName(exam.paperId),
        exam.targetType,
        formatExamTarget(exam),
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    })
    .sort((a, b) => getTimeValue(b.createdAt || b.startTime) - getTimeValue(a.createdAt || a.startTime));
});

const examReleaseTotalPages = computed(() => {
  return Math.max(1, Math.ceil(filteredExamReleases.value.length / Number(examReleaseFilters.pageSize || 10)));
});

const paginatedExamReleases = computed(() => {
  const pageSize = Number(examReleaseFilters.pageSize || 10);
  const currentPage = Math.min(examReleaseFilters.page, examReleaseTotalPages.value);
  const start = (currentPage - 1) * pageSize;

  return filteredExamReleases.value.slice(start, start + pageSize);
});

const examReleasePageStart = computed(() => {
  if (filteredExamReleases.value.length === 0) {
    return 0;
  }

  return (Math.min(examReleaseFilters.page, examReleaseTotalPages.value) - 1) * Number(examReleaseFilters.pageSize || 10) + 1;
});

const examReleasePageEnd = computed(() => {
  return Math.min(
    filteredExamReleases.value.length,
    examReleasePageStart.value + paginatedExamReleases.value.length - 1,
  );
});

const historicalExamReleases = computed(() => {
  return exams.value
    .filter((exam) => getExamTimeStatus(exam).key === 'ended')
    .sort((a, b) => getTimeValue(b.endTime || b.startTime) - getTimeValue(a.endTime || a.startTime));
});

const historicalExamTotalPages = computed(() => {
  return Math.max(1, Math.ceil(historicalExamReleases.value.length / Number(historicalExamFilters.pageSize || 10)));
});

const paginatedHistoricalExamReleases = computed(() => {
  const pageSize = Number(historicalExamFilters.pageSize || 10);
  const currentPage = Math.min(historicalExamFilters.page, historicalExamTotalPages.value);
  const start = (currentPage - 1) * pageSize;

  return historicalExamReleases.value.slice(start, start + pageSize);
});

const historicalExamPageStart = computed(() => {
  if (historicalExamReleases.value.length === 0) {
    return 0;
  }

  return (Math.min(historicalExamFilters.page, historicalExamTotalPages.value) - 1) * Number(historicalExamFilters.pageSize || 10) + 1;
});

const historicalExamPageEnd = computed(() => {
  return Math.min(
    historicalExamReleases.value.length,
    historicalExamPageStart.value + paginatedHistoricalExamReleases.value.length - 1,
  );
});

const filteredWrongAnswerTasks = computed(() => {
  const selectedClassId = String(wrongAnswerTaskFilters.classId || '');
  const selectedExamId = String(wrongAnswerTaskFilters.examId || '');
  const keyword = wrongAnswerTaskFilters.keyword.trim().toLowerCase();
  return wrongAnswerTasks.value.filter((task) => {
    const matchesFilters = (!selectedClassId || String(task.classId) === selectedClassId)
      && (!selectedExamId || String(task.examId) === selectedExamId);
    const matchesKeyword = !keyword || [task.title, task.examTitle, task.className]
      .some((value) => String(value || '').toLowerCase().includes(keyword));
    return matchesFilters && matchesKeyword;
  });
});

const wrongAnswerTaskExams = computed(() => {
  return [...exams.value].sort((a, b) => {
    const publishedAtDifference = getTimeValue(b.publishedAt) - getTimeValue(a.publishedAt);
    if (publishedAtDifference !== 0) {
      return publishedAtDifference;
    }
    return getTimeValue(b.startTime) - getTimeValue(a.startTime);
  });
});

const wrongAnswerTaskExamOptions = computed(() => wrongAnswerTaskExams.value.map((exam) => ({
  key: String(exam.examId),
  text: exam.examTitle,
  badge: `Published ${formatDateTime(exam.publishedAt)}`,
})));

const selectablePaperGroups = computed(() => {
  return paperGroups.value.filter((group) => !isDefaultPaperGroup(group));
});

// 保留空文件夹卡片，让用户在筛选到空组时仍能展开或管理该文件夹。
const selectedEmptyPaperGroup = computed(() => {
  if (!paperFilters.groupId || paperFilters.groupId === DEFAULT_FOLDER_KEY
      || paperFilters.online || paperFilters.keyword.trim()) return false;
  const selected = selectablePaperGroups.value.find(group => String(group.paperGroupId) === String(paperFilters.groupId));
  return selected && Number(selected.paperCount || 0) === 0;
});

const canReorderPaperGroups = computed(() => {
  return !paperFilters.groupId && selectablePaperGroups.value.length > 1;
});

// 保存 SHSAT 可用考试区的折叠状态，刷新后继续沿用用户选择。
function toggleAvailableExams() {
  availableExamsCollapsed.value = !availableExamsCollapsed.value;
  localStorage.setItem(AVAILABLE_EXAMS_COLLAPSED_KEY, String(availableExamsCollapsed.value));
}

// 保存 Assigned Review 折叠状态，刷新页面后继续沿用用户选择。
function toggleAssignedReview() {
  assignedReviewCollapsed.value = !assignedReviewCollapsed.value;
  localStorage.setItem(ASSIGNED_REVIEW_COLLAPSED_KEY, String(assignedReviewCollapsed.value));
}

const visiblePapers = computed(() => {
  if (paperFilters.groupId === DEFAULT_FOLDER_KEY) {
    return papers.value.filter((paper) => isDefaultPaperGroupId(paper.paperGroupId));
  }

  return papers.value;
});

const groupedPapers = computed(() => {
  const groups = new Map();

  if (paperFilters.groupId === DEFAULT_FOLDER_KEY || !paperFilters.groupId) {
    groups.set(DEFAULT_FOLDER_KEY, {
      key: DEFAULT_FOLDER_KEY,
      groupId: null,
      groupName: 'Default Folder',
      papers: [],
    });
  }

  selectablePaperGroups.value.forEach((group) => {
    const key = String(group.paperGroupId);
    if (!paperFilters.groupId || String(paperFilters.groupId) === key) {
      groups.set(key, {
        key,
        groupId: group.paperGroupId,
        groupName: group.groupName,
          displayOrder: Number(group.displayOrder || 0),
        papers: [],
      });
    }
  });

  visiblePapers.value.forEach((paper) => {
    const groupId = isDefaultPaperGroupId(paper.paperGroupId) ? null : paper.paperGroupId;
    const key = groupId ? String(groupId) : DEFAULT_FOLDER_KEY;
    const fallbackName = groupId ? getPaperGroupName(groupId) : 'Default Folder';

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        groupId,
        groupName: paper.paperGroupName || fallbackName,
          displayOrder: Number(paper.displayOrder || 0),
        papers: [],
      });
    }

    groups.get(key).papers.push(paper);
  });

  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === DEFAULT_FOLDER_KEY) {
      return -1;
    }
    if (b.key === DEFAULT_FOLDER_KEY) {
      return 1;
    }
      return Number(a.displayOrder || 0) - Number(b.displayOrder || 0) || a.groupName.localeCompare(b.groupName);
  });
});

// Create Exam 使用独立分组快照，避免复用 Paper Management 的筛选状态导致可选试卷缺失。
const examPaperGroups = computed(() => {
  const groups = new Map();

  paperGroups.value.forEach((group) => {
    const isDefault = isDefaultPaperGroup(group);
    const key = isDefault ? DEFAULT_FOLDER_KEY : String(group.paperGroupId);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        groupName: isDefault ? 'Default Folder' : group.groupName,
        displayOrder: isDefault ? -1 : Number(group.displayOrder || 0),
        papers: [],
      });
    }
  });

  papers.value.forEach((paper) => {
    const groupId = isDefaultPaperGroupId(paper.paperGroupId) ? null : paper.paperGroupId;
    const key = groupId ? String(groupId) : DEFAULT_FOLDER_KEY;
    const group = groups.get(key) || {
      key,
      groupName: groupId ? (paper.paperGroupName || 'Ungrouped') : 'Default Folder',
      displayOrder: groupId ? Number(paper.displayOrder || 0) : -1,
      papers: [],
    };

    group.papers.push(paper);
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .filter((group) => group.papers.length > 0)
    .map((group) => ({
      ...group,
      papers: [...group.papers].sort((a, b) => (
        Number(a.displayOrder || 0) - Number(b.displayOrder || 0)
        || String(a.paperName || '').localeCompare(String(b.paperName || ''))
      )),
    }))
    .sort((a, b) => (
      Number(a.displayOrder || 0) - Number(b.displayOrder || 0)
      || String(a.groupName || '').localeCompare(String(b.groupName || ''))
    ));
});

const paperDeleteImpactRows = computed(() => {
  const impact = paperDeleteImpact.value || {};

  return [
    {
      key: 'exams',
      label: 'Scheduled Exams',
      value: getImpactCount(impact, ['examCount', 'examsCount', 'publishedExamCount']),
      description: 'Exam schedules created from this paper.',
      help: 'The number of exams created from this paper.',
    },
    {
      key: 'attempts',
      label: 'Student Submissions',
      value: getImpactCount(impact, ['attemptCount', 'attemptsCount']),
      description: 'Student answers and reports that will be removed.',
      help: 'The number of student test records created from those exams.',
    },
  ];
});

const canConfirmPaperDelete = computed(() => {
  return Boolean(
    selectedDeletePaper.value?.paperId
      && paperDeleteImpact.value
      && !errors.paperDelete
      && !loading.paperDeleteImpactId
      && !loading.deletingPaperId
      && paperDeleteCooldown.value <= 0,
  );
});

function unwrapResponse(response) {
  if (response?.success === false) {
    throw new Error(response.message || 'Request failed');
  }

  return response?.data ?? response;
}

function unwrapListResponse(response) {
  const payload = unwrapResponse(response);

  if (Array.isArray(payload)) {
    return payload;
  }

  return payload?.items || payload?.records || payload?.list || payload?.content || [];
}

function getId(item, key = 'id') {
  return Number(item?.[key] || item?.id || 0);
}

function getTimeValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function formatDateTime(value) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).replace('T', ' ');
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function formatExamReleaseTime(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ');
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

function getExamReleaseTimeDetail(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).format(date);
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '-';
  }

  return `${(number * 100).toFixed(1)}%`;
}

function formatNumber(value) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }

  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1).replace(/\.0$/, '') : String(value);
}

function getOnlineText(value) {
  if (value === true) {
    return 'Online';
  }

  if (value === false) {
    return 'Offline';
  }

  return 'All';
}

function getPaperGroupName(groupId) {
  return paperGroups.value.find((group) => group.paperGroupId === groupId)?.groupName || 'Ungrouped';
}

function isDefaultPaperGroup(group) {
  const name = String(group?.groupName || '').trim().toLowerCase();
  return ['default', 'default folder', 'ungrouped'].includes(name);
}

function isDefaultPaperGroupId(groupId) {
  if (!groupId) {
    return true;
  }

  const group = paperGroups.value.find((item) => String(item.paperGroupId) === String(groupId));
  return isDefaultPaperGroup(group);
}

function getNumber(...values) {
  const value = values.find((item) => item !== undefined && item !== null && item !== '');
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJsonObject(value, fallbackValue = {}) {
  if (!value || typeof value !== 'string') {
    return value && !Array.isArray(value) && typeof value === 'object' ? value : fallbackValue;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function isScoredQuestion(question) {
  const scoringRules = parseJsonObject(question?.scoringRules);
  const isScored = scoringRules.isScored;

  return !(isScored === false || String(isScored).toLowerCase() === 'false');
}

function getOfficialPartSubject(part) {
  const label = `${part?.partCode || ''} ${part?.partName || ''}`.toUpperCase();

  if (/\bELA\b|ENGLISH|READING|LANGUAGE/.test(label)) {
    return 'ELA';
  }
  if (/\bMATH\b|MATHEMATICS/.test(label)) {
    return 'MATH';
  }

  return '';
}

function buildPaperStructureStats(paper) {
  const questions = Array.isArray(paper?.questions) ? paper.questions : [];
  const partSubjectById = new Map(
    (paper?.parts || [])
      .map((part) => [String(part.partId), getOfficialPartSubject(part)])
      .filter(([, subject]) => subject),
  );

  const total = Array.isArray(paper?.questions) ? questions.length : Number(paper?.totalQuestions || 0);

  return questions.reduce((stats, question) => {
    if (!isScoredQuestion(question)) {
      return stats;
    }

    const subject = partSubjectById.get(String(question.partId));
    if (subject === 'ELA') {
      stats.ela += 1;
    } else if (subject === 'MATH') {
      stats.math += 1;
    }

    return stats;
  }, {
    total,
    ela: 0,
    math: 0,
  });
}

function hasPublishStructureRisk(stats) {
  if (!stats) {
    return false;
  }

  return stats.total !== OFFICIAL_SHSAT_TOTAL_QUESTIONS
    || stats.ela !== OFFICIAL_SHSAT_SECTION_QUESTIONS
    || stats.math !== OFFICIAL_SHSAT_SECTION_QUESTIONS;
}

function getImpactCount(impact, keys) {
  const sources = [impact, impact?.summary, impact?.counts].filter(Boolean);

  for (const source of sources) {
    for (const key of keys) {
      const value = Number(source[key]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  return 0;
}

function getPaperDeleteName() {
  const impact = paperDeleteImpact.value || {};

  return impact.paperName
    || impact.name
    || impact.paper?.paperName
    || selectedDeletePaper.value?.paperName
    || 'Selected paper';
}

function normalizeExamStatus(exam, remainingAttempts) {
  const now = Date.now();
  const startTime = getTimeValue(exam.startTime);
  const endTime = getTimeValue(exam.endTime);
  const rawStatus = String(exam.status || exam.attemptStatus || '').toUpperCase();
  const canStart = exam.canStart === true || String(exam.canStart).toLowerCase() === 'true';

  if (rawStatus === 'IN_PROGRESS') {
    return { key: 'active', label: 'Open', disabled: false, actionText: 'Start Exam' };
  }
  if (rawStatus === 'COMPLETED') {
    return { key: 'completed', label: 'Completed', disabled: true, actionText: 'Completed' };
  }
  if (rawStatus === 'EXPIRED' || rawStatus === 'ENDED') {
    return { key: 'ended', label: 'Ended', disabled: true, actionText: 'Ended' };
  }
  if (exam.published === false || exam.isPublished === false) {
    return { key: 'draft', label: 'Unpublished', disabled: true, actionText: 'Unavailable' };
  }
  if (startTime && now < startTime) {
    return { key: 'pending', label: 'Scheduled', disabled: true, actionText: 'Not Started' };
  }
  if (canStart) {
    const actionText = remainingAttempts !== null && remainingAttempts <= 0 ? 'Continue Exam' : 'Start Exam';
    return { key: 'active', label: 'Open', disabled: false, actionText };
  }
  if (endTime && now > endTime) {
    return { key: 'ended', label: 'Ended', disabled: true, actionText: 'Ended' };
  }
  if (remainingAttempts !== null && remainingAttempts <= 0) {
    return { key: 'exhausted', label: 'Submitted', disabled: true, actionText: 'Submitted' };
  }

  return { key: 'active', label: 'Open', disabled: false, actionText: 'Start Exam' };
}

function normalizeExam(exam) {
  const attemptLimit = getNumber(exam.attemptLimit, exam.maxAttempts, 1);
  const usedAttempts = getNumber(exam.usedAttempts, exam.attemptCount, exam.completedAttempts, 0);
  const explicitRemaining = getNumber(exam.remainingAttempts, exam.leftAttempts);
  const remainingAttempts = explicitRemaining ?? (
    attemptLimit === null ? null : Math.max(attemptLimit - (usedAttempts || 0), 0)
  );

  return {
    ...exam,
    id: exam.examId || exam.id || exam.releaseId,
    title: exam.examTitle || exam.title || 'Untitled Exam',
    description: exam.examDescription || exam.description || '',
    startTime: exam.startTime || exam.availableFrom,
    endTime: exam.endTime || exam.availableTo,
    duration: getNumber(exam.duration, exam.timeLimit),
    attemptLimit,
    remainingAttempts,
    status: normalizeExamStatus(exam, remainingAttempts),
  };
}

function getAttemptText(exam) {
  return exam.remainingAttempts === 0 ? 'Final result recorded' : 'One final submission';
}

function getClassActiveState(item) {
  return item?.isActive ?? item?.active ?? true;
}

function getClassStudentCount(item) {
  const count = Number(item?.studentCount ?? item?.studentsCount ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function canDeleteClass(item) {
  return item?.deletable === true || item?.canDelete === true;
}

function getClassAverage(item) {
  return item?.averageScore ?? item?.avgScore;
}

function getScoreValue(score) {
  const value = getNumber(score.totalScaledScore, score.totalScore);
  return value ?? 0;
}

function getExamTargetIds(exam) {
  const rawIds = exam?.target_ids || exam?.targetIds || exam?.targetClassIds || [];

  if (Array.isArray(rawIds)) {
    return rawIds.map(Number).filter((value) => Number.isFinite(value));
  }

  if (typeof rawIds === 'string') {
    return rawIds
      .split(/[\s,]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value));
  }

  return [];
}

function isExamAvailableForClass(exam, classId) {
  const targetType = String(exam?.targetType || '').toUpperCase();

  if (!targetType || targetType === 'ALL_STUDENTS') {
    return true;
  }

  if (targetType === 'SPECIFIC_CLASSES') {
    return getExamTargetIds(exam).includes(Number(classId));
  }

  // Student-specific releases can still contain attempts from this class, so keep them queryable.
  return targetType === 'SPECIFIC_STUDENTS';
}

function formatExamTarget(exam) {
  if (exam?.targetSummary) {
    return exam.targetSummary;
  }

  const targetType = String(exam?.targetType || 'ALL_STUDENTS');
  const ids = getExamTargetIds(exam);

  if (targetType === 'ALL_STUDENTS') {
    return 'All students';
  }

  if (targetType === 'SPECIFIC_CLASSES') {
    return ids.length ? `Classes: ${ids.join(', ')}` : 'Specific classes';
  }

  if (targetType === 'SPECIFIC_STUDENTS') {
    return ids.length ? `Students: ${ids.join(', ')}` : 'Specific students';
  }

  return targetType;
}

function matchesExamTargetType(exam, selectedType) {
  const targetType = String(exam?.targetType || '').toUpperCase();
  if (selectedType === 'ALL_STUDENTS') {
    return targetType === 'ALL_STUDENTS';
  }
  if (targetType === selectedType) {
    return true;
  }

  const targetSummary = String(exam?.targetSummary || '');
  if (selectedType === 'SPECIFIC_CLASSES') {
    return targetSummary.includes('Classes:');
  }
  if (selectedType === 'SPECIFIC_STUDENTS') {
    return targetSummary.includes('Students:');
  }
  return false;
}

function getExamPaperName(paperId) {
  return papers.value.find((paper) => String(paper.paperId) === String(paperId))?.paperName || '';
}

function isExamPaperMissing(exam) {
  return Boolean(exam?.paperId) && !getExamPaperName(exam.paperId);
}

function getExamReleaseIdentity(exam) {
  const releaseTitle = String(exam?.examTitle || '').trim();
  const paperName = getExamPaperName(exam?.paperId);
  const titleIsNumeric = /^\d+$/.test(releaseTitle);
  const detail = [
    !titleIsNumeric && paperName !== releaseTitle ? paperName : '',
    exam?.examDescription?.trim(),
  ].filter(Boolean).join(' · ');

  return {
    title: titleIsNumeric ? (paperName || 'Exam release') : (releaseTitle || paperName || 'Exam release'),
    detail,
  };
}

function getExamReleaseActions(exam, historical = false) {
  const actions = [];
  if (!historical && exam.status === 'DRAFT') {
    actions.push({
      label: isPublishStructureCheckLoading(exam) ? 'Checking...' : 'Publish',
      disabled: loading.exams || isPublishStructureCheckLoading(exam) || loading.deletingExamId === String(exam.examId),
      title: getPublishActionHint(exam),
      onSelect: () => openPublishConfirm(exam),
    });
  } else if (!historical && exam.status === 'PUBLISHED') {
    actions.push({
      label: 'Unpublish',
      disabled: loading.exams || loading.deletingExamId === String(exam.examId),
      title: getPublishActionHint(exam),
      onSelect: () => openPublishConfirm(exam),
    });
  }
  if (canAccessExamMonitor.value) {
    actions.push({ label: 'Monitor', onSelect: () => openExamMonitor(exam) });
  }
  if (!isTeacherPortal.value) {
    actions.push({
      label: loading.deletingExamId === String(exam.examId) ? 'Deleting...' : 'Delete',
      disabled: loading.deletingExamId === String(exam.examId),
      danger: true,
      onSelect: () => openDeleteExamConfirm(exam),
    });
  }
  return actions;
}

function getWrongAnswerTaskActions(task) {
  const actions = [{ label: 'View Progress', onSelect: () => openWrongAnswerTaskProgress(task) }];
  if (!isReviewAssignmentEnded(task)) {
    actions.push({
      label: endingWrongAnswerTaskId.value === task.taskId ? 'Ending...' : 'End',
      disabled: endingWrongAnswerTaskId.value !== null,
      onSelect: () => endWrongAnswerTask(task),
    });
  }
  return actions;
}

function getExamTimeStatus(exam) {
  const now = Date.now();
  const startTime = getTimeValue(exam?.startTime);
  const endTime = getTimeValue(exam?.endTime);

  if (endTime && now > endTime) {
    return { key: 'ended', label: 'Ended' };
  }
  if (startTime && now < startTime) {
    return { key: 'upcoming', label: 'Upcoming' };
  }

  return { key: 'live', label: 'Live' };
}

function getExamReleaseAccessState(exam) {
  const timeStatus = getExamTimeStatus(exam);

  if (!exam.published) {
    return {
      label: 'Not published',
      detail: 'Students cannot see or start this release.',
      className: 'access-pill--hidden',
    };
  }
  if (timeStatus.key === 'upcoming') {
    return {
      label: 'Scheduled',
      detail: 'Visible to students, but not open yet.',
      className: 'access-pill--scheduled',
    };
  }
  if (timeStatus.key === 'ended') {
    return {
      label: 'Closed',
      detail: 'The exam window has ended.',
      className: 'access-pill--closed',
    };
  }

  return {
    label: 'Open',
    detail: 'Students can see and start this release.',
    className: 'access-pill--open',
  };
}

function resetExamReleasePage() {
  examReleaseFilters.page = 1;
}

function goExamReleasePage(page) {
  examReleaseFilters.page = Math.min(Math.max(1, page), examReleaseTotalPages.value);
}

function resetHistoricalExamPage() {
  historicalExamFilters.page = 1;
}

function goHistoricalExamPage(page) {
  historicalExamFilters.page = Math.min(Math.max(1, page), historicalExamTotalPages.value);
}

function resetClassExamPage() {
  classExamFilters.page = 1;
}

function goClassExamPage(page) {
  classExamFilters.page = Math.min(Math.max(1, page), classExamTotalPages.value);
}

function clearObject(target, values) {
  Object.entries(values).forEach(([key, value]) => {
    target[key] = value;
  });
}

function setNowWindow() {
  const start = new Date();
  start.setMinutes(start.getMinutes() - start.getTimezoneOffset() + 10);
  const end = new Date(start);
  end.setHours(end.getHours() + 2);

  examForm.startTime = start.toISOString().slice(0, 16);
  examForm.endTime = end.toISOString().slice(0, 16);
}

function openDateTimePicker(inputRef) {
  const input = typeof inputRef?.focus === 'function' ? inputRef : inputRef?.value;
  if (!input) {
    return;
  }

  input.focus();
  if (typeof input.showPicker !== 'function') {
    return;
  }

  try {
    input.showPicker();
  } catch {
    // Some browsers only allow showPicker from specific activation paths.
  }
}

function buildPaperQuery() {
  return {
    groupId: paperFilters.groupId === DEFAULT_FOLDER_KEY ? '' : paperFilters.groupId,
    keyword: paperFilters.keyword.trim(),
    online: paperFilters.online,
  };
}

function getPaperPayloadFromPaper(paper, overrides = {}) {
  return {
    paperGroupId: paper.paperGroupId || null,
    paperName: paper.paperName,
    paperDescription: paper.paperDescription || '',
    totalParts: Number(paper.totalParts || 0),
    totalQuestions: Number(paper.totalQuestions || 0),
    defaultDuration: Number(paper.defaultDuration || 90),
    totalScore: Number(paper.totalScore || 0),
    status: paper.status || 'READY',
    online: paper.online !== false,
    displayOrder: Number(paper.displayOrder || 0),
    metadata: paper.metadata || '',
    ...overrides,
  };
}

function getActualPaperQuestionCount(paper) {
  if (!paper) {
    return 0;
  }
  if (Array.isArray(paper.questions)) {
    return paper.questions.length;
  }
  return Number(paper.totalQuestions || 0);
}

function hasDuplicatePaperName(paperName, currentPaperId = null) {
  const normalizedName = String(paperName || '').trim().toLowerCase();
  if (!normalizedName) {
    return false;
  }

  return papers.value.some((paper) => {
    return String(paper.paperName || '').trim().toLowerCase() === normalizedName
      && String(paper.paperId || '') !== String(currentPaperId || '');
  });
}

function createBlankPaperPayload(overrides = {}) {
  return {
    paperGroupId: paperFilters.groupId && paperFilters.groupId !== DEFAULT_FOLDER_KEY ? Number(paperFilters.groupId) : '',
    paperName: '',
    paperDescription: '',
    totalParts: 2,
    totalQuestions: 0,
    defaultDuration: 180,
    totalScore: 0,
    status: 'DRAFT',
    online: false,
    displayOrder: papers.value.length + 1,
    metadata: '',
    ...overrides,
  };
}

function buildPaperPayloadFromForm() {
  const metadata = paperEditForm.metadata.trim();

  return {
    paperGroupId: paperEditForm.paperGroupId ? Number(paperEditForm.paperGroupId) : null,
    paperName: paperEditForm.paperName.trim(),
    paperDescription: paperEditForm.paperDescription.trim(),
    totalParts: Number(paperEditForm.totalParts || 0),
    totalQuestions: Number(paperEditForm.totalQuestions || 0),
    defaultDuration: Number(paperEditForm.defaultDuration || 1),
    totalScore: Number(paperEditForm.totalScore || 0),
    status: paperEditForm.status.trim() || 'DRAFT',
    online: Boolean(paperEditForm.online),
    displayOrder: Number(paperEditForm.displayOrder || 0),
    metadata: metadata || null,
  };
}

function buildPaperCreatePayloadFromForm() {
  const payload = {
    paperGroupId: paperEditForm.paperGroupId ? Number(paperEditForm.paperGroupId) : null,
    paperName: paperEditForm.paperName.trim(),
    paperDescription: paperEditForm.paperDescription.trim(),
    displayOrder: Number(paperEditForm.displayOrder || 0),
  };
  const duration = Number(paperEditForm.defaultDuration);

  if (Number.isFinite(duration) && duration > 0) {
    payload.defaultDuration = duration;
  }

  return payload;
}

function buildPaperEditPayloadFromForm(paper) {
  return {
    ...buildPaperPayloadFromForm(),
    // Keep derived fields aligned with the current paper details instead of the home edit form.
    totalQuestions: getActualPaperQuestionCount(paper),
    totalScore: Number(paper?.totalScore || 0),
    status: String(paper?.status || 'DRAFT'),
  };
}

function syncExpandedFolders() {
  groupedPapers.value.forEach((group) => {
    if (expandedFolders[group.key] === undefined) {
      expandedFolders[group.key] = false;
    }
  });
}

function toggleFolder(groupKey) {
  expandedFolders[groupKey] = !expandedFolders[groupKey];
}

function moveById(items, idKey, sourceId, targetId) {
  const sourceIndex = items.findIndex((item) => String(item[idKey]) === String(sourceId));
  const targetIndex = items.findIndex((item) => String(item[idKey]) === String(targetId));

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(sourceIndex, 1);
  nextItems.splice(targetIndex, 0, movedItem);

  return nextItems.map((item, index) => ({
    ...item,
    displayOrder: index + 1,
  }));
}

function getPaperGroupOrderIds() {
  // 默认分组固定在首位且不可拖动，但后端要求提交全部分组，故一并发送，避免校验失败导致顺序无法保存。
  const defaultGroups = paperGroups.value.filter((group) => isDefaultPaperGroup(group));
  return [...defaultGroups, ...selectablePaperGroups.value]
    .map((group) => group.paperGroupId)
    .filter(Boolean);
}

function getClassOrderIds() {
  return classes.value.map((item) => item.classId).filter(Boolean);
}

function startPaperGroupDrag(group, event) {
  if (!canReorderPaperGroups.value || !group.groupId) {
    event.preventDefault();
    return;
  }

  draggingPaperGroupId.value = String(group.groupId);
  paperGroupDropTargetId.value = '';
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingPaperGroupId.value);
}

function dragOverPaperGroup(group, event) {
  if (!draggingPaperGroupId.value || !group.groupId || !canReorderPaperGroups.value) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function dropPaperGroup(group, event) {
  event.preventDefault();
  if (!draggingPaperGroupId.value || !group.groupId || String(group.groupId) === draggingPaperGroupId.value) {
    return;
  }

  paperGroupDropTargetId.value = String(group.groupId);
}

async function finishPaperGroupDrag() {
  if (!draggingPaperGroupId.value) {
    return;
  }

  const sourceId = draggingPaperGroupId.value;
  const targetId = paperGroupDropTargetId.value;
  draggingPaperGroupId.value = '';
  paperGroupDropTargetId.value = '';

  if (!sourceId || !targetId || sourceId === targetId) {
    return;
  }

  paperGroups.value = moveById(paperGroups.value, 'paperGroupId', sourceId, targetId);
  loading.reorderingPaperGroups = true;
  errors.papers = '';

  try {
    paperGroups.value = unwrapListResponse(await adminApi.reorderPaperGroups(getPaperGroupOrderIds()));
    syncExpandedFolders();
  } catch (error) {
    errors.papers = error.message || 'Failed to update folder order';
    await loadPapers();
  } finally {
    loading.reorderingPaperGroups = false;
  }
}

function startClassDrag(item, event) {
  if (!canReorderClasses.value || !item.classId) {
    event.preventDefault();
    return;
  }

  draggingClassId.value = String(item.classId);
  classDragMoved.value = false;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggingClassId.value);
}

function dragOverClass(item, event) {
  if (!draggingClassId.value || !item.classId || !canReorderClasses.value) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

function dropClass(item, event) {
  event.preventDefault();
  if (!draggingClassId.value || !item.classId || String(item.classId) === draggingClassId.value) {
    return;
  }

  classes.value = moveById(classes.value, 'classId', draggingClassId.value, item.classId);
  classDragMoved.value = true;
}

async function finishClassDrag() {
  if (!draggingClassId.value) {
    return;
  }

  const shouldSave = classDragMoved.value;
  suppressNextClassClick.value = shouldSave;
  draggingClassId.value = '';
  classDragMoved.value = false;

  if (!shouldSave) {
    return;
  }

  loading.reorderingClasses = true;
  errors.classes = '';

  try {
    classes.value = unwrapListResponse(await adminApi.reorderClasses(getClassOrderIds()));
  } catch (error) {
    errors.classes = error.message || 'Failed to update class order';
    await loadClasses();
  } finally {
    loading.reorderingClasses = false;
  }
}

function openClassCard(item) {
  if (suppressNextClassClick.value || classDragMoved.value || draggingClassId.value) {
    suppressNextClassClick.value = false;
    return;
  }

  openClassDetail(item);
}

function handleClassCardKeydown(item, event) {
  if (event.target !== event.currentTarget) {
    return;
  }

  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  event.preventDefault();
  openClassCard(item);
}

function buildExamPayload() {
  const targetIds = examForm.targetType === 'SPECIFIC_CLASSES'
    ? examForm.targetClassIds.map(Number).filter((item) => Number.isFinite(item) && item > 0)
    : [];

  // The backend uses target_ids; keep release audience IDs normalized as numbers.
  return {
    paperId: Number(examForm.paperId),
    examTitle: examForm.examTitle.trim(),
    examDescription: examForm.examDescription.trim(),
    startTime: examForm.startTime,
    endTime: examForm.endTime,
    duration: Number(examForm.duration),
    targetType: examForm.targetType,
    target_ids: targetIds,
    attemptLimit: 1,
    autoSubmit: examForm.autoSubmit,
    allowReview: examForm.allowReview,
  };
}

function validateExamPayload(payload) {
  if (!payload.paperId || !payload.examTitle || !payload.startTime || !payload.endTime) {
    return 'Select a paper and enter the title, start time, and end time.';
  }

  const opensAt = new Date(payload.startTime).getTime();
  const closesAt = new Date(payload.endTime).getTime();
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt) || closesAt <= opensAt) {
    return 'The end time must be after the start time.';
  }

  if (!payload.duration || payload.duration < 1) {
    return 'Duration must be greater than 0.';
  }

  if (payload.targetType === 'SPECIFIC_CLASSES' && payload.target_ids.length === 0) {
    return 'Select at least one class for this release.';
  }

  return '';
}

async function loadPapers() {
  loading.papers = true;
  errors.papers = '';
  hasAppliedPaperFilter.value = Boolean(
    paperFilters.groupId || paperFilters.online || paperFilters.keyword.trim(),
  );

  try {
    const [groupResponse, paperResponse] = await Promise.all([
      adminApi.getPaperGroups(),
      adminApi.getPapers(buildPaperQuery()),
    ]);
    paperGroups.value = unwrapListResponse(groupResponse);
    papers.value = unwrapListResponse(paperResponse);
    papers.value.forEach((paper) => {
      paperMoveTargets[paper.paperId] = paper.paperGroupId || '';
    });
    syncExpandedFolders();
  } catch (error) {
    errors.papers = error.message || 'Failed to load papers';
    papers.value = [];
  } finally {
    loading.papers = false;
  }
}

async function loadAdminExams() {
  loading.adminExams = true;
  errors.adminExams = '';

  try {
    adminExams.value = unwrapListResponse(await studentApi.getExams());
  } catch (error) {
    errors.adminExams = error.message || 'Failed to load exams for participation';
    adminExams.value = [];
  } finally {
    loading.adminExams = false;
  }
}

async function submitGroup() {
  errors.groupForm = '';
  notices.groupForm = '';

  if (!groupForm.groupName.trim()) {
    errors.groupForm = 'Folder name is required.';
    return;
  }

  loading.submittingGroup = true;

  try {
    const payload = {
      groupName: groupForm.groupName.trim(),
      groupDesc: groupForm.groupDesc.trim(),
    };
    const groupId = selectedEditGroup.value?.groupId || selectedEditGroup.value?.paperGroupId;
    const response = unwrapResponse(groupId
      ? await adminApi.updatePaperGroup(groupId, payload)
      : await adminApi.createPaperGroup(payload));
    notices.groupForm = groupId
      ? `Renamed folder: ${response.groupName || groupForm.groupName}`
      : `Created folder: ${response.groupName || groupForm.groupName}`;
    clearObject(groupForm, { groupName: '', groupDesc: '' });
    selectedEditGroup.value = null;
    showGroupModal.value = false;
    if (response.paperGroupId) {
      paperFilters.groupId = String(response.paperGroupId);
    }
    await loadPapers();
  } catch (error) {
    errors.groupForm = error.message || 'Failed to create folder';
  } finally {
    loading.submittingGroup = false;
  }
}

function openGroupModal(group = null) {
  errors.groupForm = '';
  notices.groupForm = '';
  selectedEditGroup.value = group;
  clearObject(groupForm, {
    groupName: group?.groupName || '',
    groupDesc: group?.groupDesc || '',
  });
  showGroupModal.value = true;
}

function closeGroupModal() {
  if (loading.submittingGroup) {
    return;
  }
  errors.groupForm = '';
  selectedEditGroup.value = null;
  clearObject(groupForm, { groupName: '', groupDesc: '' });
  showGroupModal.value = false;
}

async function deleteEmptyGroup(group) {
  if (!group?.groupId || group.papers.length > 0 || loading.deletingGroupId) {
    return;
  }
  selectedDeleteGroup.value = group;
}

function closeDeleteGroupConfirm() {
  if (loading.deletingGroupId) {
    return;
  }
  selectedDeleteGroup.value = null;
}

async function confirmDeleteEmptyGroup() {
  const group = selectedDeleteGroup.value;
  if (!group?.groupId || group.papers.length > 0 || loading.deletingGroupId) {
    return;
  }

  loading.deletingGroupId = String(group.groupId);
  errors.papers = '';
  notices.groupForm = '';

  try {
    await adminApi.deletePaperGroup(group.groupId);
    notices.groupForm = `Deleted folder: ${group.groupName}`;
    if (String(paperFilters.groupId) === String(group.groupId)) {
      paperFilters.groupId = '';
    }
    delete expandedFolders[group.key];
    selectedDeleteGroup.value = null;
    await loadPapers();
  } catch (error) {
    errors.papers = error.message || 'Failed to delete folder';
  } finally {
    loading.deletingGroupId = '';
  }
}

function clearPaperDeleteCooldown() {
  if (paperDeleteCooldownTimer) {
    clearInterval(paperDeleteCooldownTimer);
    paperDeleteCooldownTimer = null;
  }
}

function startPaperDeleteCooldown() {
  clearPaperDeleteCooldown();
  paperDeleteCooldown.value = PAPER_DELETE_COOLDOWN_SECONDS;
  paperDeleteCooldownTimer = window.setInterval(() => {
    paperDeleteCooldown.value = Math.max(paperDeleteCooldown.value - 1, 0);

    if (paperDeleteCooldown.value <= 0) {
      clearPaperDeleteCooldown();
    }
  }, 1000);
}

async function openPaperDeleteConfirm(paper) {
  const paperId = paper?.paperId;
  if (!paperId || loading.paperDeleteImpactId || loading.deletingPaperId) {
    return;
  }

  closeActionToast();
  selectedDeletePaper.value = paper;
  paperDeleteImpact.value = null;
  errors.paperDelete = '';
  loading.paperDeleteImpactId = String(paperId);
  startPaperDeleteCooldown();

  try {
    const impact = unwrapResponse(await adminApi.getPaperDeleteImpact(paperId));
    if (String(selectedDeletePaper.value?.paperId) === String(paperId)) {
      paperDeleteImpact.value = impact || {};
    }
  } catch (error) {
    if (String(selectedDeletePaper.value?.paperId) === String(paperId)) {
      errors.paperDelete = error.message || 'Failed to load paper deletion impact.';
    }
  } finally {
    if (loading.paperDeleteImpactId === String(paperId)) {
      loading.paperDeleteImpactId = '';
    }
  }
}

function closePaperDeleteConfirm() {
  if (loading.deletingPaperId) {
    return;
  }

  clearPaperDeleteCooldown();
  selectedDeletePaper.value = null;
  paperDeleteImpact.value = null;
  paperDeleteCooldown.value = 0;
  loading.paperDeleteImpactId = '';
  errors.paperDelete = '';
}

function closeDeletedPaperContexts(paperId) {
  const paperIdText = String(paperId);
  const deletedExamIds = new Set(
    exams.value
      .filter((exam) => String(exam.paperId) === paperIdText)
      .map((exam) => String(exam.examId || exam.id))
      .filter(Boolean),
  );

  if (String(selectedPaperId.value) === paperIdText) {
    selectedPaperId.value = '';
  }
  if (String(paperDetail.value?.paperId) === paperIdText) {
    paperDetail.value = null;
    showPaperDetailModal.value = false;
  }
  if (String(selectedEditPaper.value?.paperId) === paperIdText) {
    selectedEditPaper.value = null;
    showPaperEditModal.value = false;
  }
  if (String(selectedMovePaper.value?.paperId) === paperIdText) {
    selectedMovePaper.value = null;
    showMoveModal.value = false;
  }
  if (String(examForm.paperId) === paperIdText) {
    examForm.paperId = '';
    showExamReleaseModal.value = false;
  }
  if (String(selectedPublishExam.value?.paperId) === paperIdText) {
    selectedPublishExam.value = null;
  }
  if (String(selectedDeleteExam.value?.paperId) === paperIdText) {
    selectedDeleteExam.value = null;
  }
  if (deletedExamIds.has(String(reportForm.examId))) {
    reportForm.examId = '';
    classScores.value = [];
    errors.classScores = '';
  }

  papers.value = papers.value.filter((paper) => String(paper.paperId) !== paperIdText);
  exams.value = exams.value.filter((exam) => String(exam.paperId) !== paperIdText);
  adminExams.value = adminExams.value.filter((exam) => {
    return String(exam.paperId) !== paperIdText && !deletedExamIds.has(String(exam.examId || exam.id || exam.releaseId));
  });
}

async function confirmDeletePaper() {
  const paper = selectedDeletePaper.value;
  const paperId = paper?.paperId;
  if (!paperId || !canConfirmPaperDelete.value) {
    return;
  }

  loading.deletingPaperId = String(paperId);
  errors.paperDelete = '';

  try {
    await adminApi.deletePaper(paperId);
  } catch (error) {
    errors.paperDelete = error.message || 'Failed to delete paper.';
    loading.deletingPaperId = '';
    return;
  }

  closeDeletedPaperContexts(paperId);
  loading.deletingPaperId = '';
  closePaperDeleteConfirm();
  await Promise.all([loadPapers(), loadExams(), loadAdminExams()]);
  showActionToast({
    title: 'Paper Deleted',
    message: `"${paper.paperName || 'Selected paper'}" and its related exams, attempts, and reports were removed.`,
    variant: 'success',
  });
}

async function movePaperToGroup(paper) {
  const paperId = paper.paperId;
  const nextGroupId = moveForm.paperGroupId || null;

  if ((paper.paperGroupId || '') === (nextGroupId || '')) {
    closeMoveModal();
    return;
  }

  loading.movingPaperId = paperId;
  errors.papers = '';

  try {
    await adminApi.movePaperToGroup(paperId, nextGroupId ? Number(nextGroupId) : null);
    closeMoveModal();
    await loadPapers();
  } catch (error) {
    errors.papers = error.message || 'Failed to move paper';
  } finally {
    loading.movingPaperId = '';
  }
}

function openMoveModal(paper, currentGroupId = paper.paperGroupId) {
  selectedMovePaper.value = { ...paper, paperGroupId: currentGroupId || null };
  moveForm.paperGroupId = currentGroupId || '';
  errors.papers = '';
  showMoveModal.value = true;
}

function closeMoveModal() {
  selectedMovePaper.value = null;
  moveForm.paperGroupId = '';
  showMoveModal.value = false;
}

async function openPaperEditModal(paper) {
  if (!paper?.paperId) {
    return;
  }

  errors.papers = '';
  loading.paperDetail = true;

  try {
    const detail = unwrapResponse(await adminApi.getPaper(paper.paperId));
    const editablePaper = {
      ...paper,
      ...detail,
      // The home list can lag behind; the detail payload has the current question count.
      totalQuestions: Array.isArray(detail?.questions) ? detail.questions.length : (detail?.totalQuestions ?? paper.totalQuestions),
    };
    selectedEditPaper.value = editablePaper;
    clearObject(paperEditForm, getPaperPayloadFromPaper(editablePaper, {
      paperGroupId: editablePaper.paperGroupId || '',
    }));
    showPaperEditModal.value = true;
  } catch (error) {
    errors.papers = error.message || 'Failed to load paper detail';
  } finally {
    loading.paperDetail = false;
  }
}

function closePaperEditModal() {
  selectedEditPaper.value = null;
  showPaperEditModal.value = false;
}

function openPaperCreateModal() {
  selectedEditPaper.value = null;
  errors.papers = '';
  clearObject(paperEditForm, createBlankPaperPayload());
  showPaperCreateModal.value = true;
}

function closePaperCreateModal() {
  if (loading.papers) {
    return;
  }
  showPaperCreateModal.value = false;
}

async function submitPaperCreate() {
  if (!paperEditForm.paperName.trim()) {
    errors.papers = 'Paper name is required.';
    return;
  }
  if (hasDuplicatePaperName(paperEditForm.paperName)) {
    errors.papers = 'Paper name already exists.';
    return;
  }

  loading.papers = true;
  errors.papers = '';

  try {
    const created = unwrapResponse(await adminApi.createPaper(buildPaperCreatePayloadFromForm()));
    showPaperCreateModal.value = false;
    await loadPapers();
    if (created?.paperId) {
      router.push({
        name: 'admin-paper-edit',
        params: { paperId: created.paperId },
      });
    }
  } catch (error) {
    errors.papers = error.message || 'Failed to create paper';
  } finally {
    loading.papers = false;
  }
}

async function submitPaperEdit() {
  const paper = selectedEditPaper.value;
  if (!paper?.paperId) {
    return;
  }

  if (!paperEditForm.paperName.trim()) {
    errors.papers = 'Paper name is required.';
    return;
  }
  if (hasDuplicatePaperName(paperEditForm.paperName, paper.paperId)) {
    errors.papers = 'Paper name already exists.';
    return;
  }

  loading.papers = true;
  errors.papers = '';

  try {
    await adminApi.updatePaper(paper.paperId, buildPaperEditPayloadFromForm(paper));
    closePaperEditModal();
    await loadPapers();
  } catch (error) {
    errors.papers = error.message || 'Failed to update paper';
  } finally {
    loading.papers = false;
  }
}

async function loadPaperDetail(paperId) {
  if (!paperId) {
    return;
  }

  selectedPaperId.value = paperId;
  showPaperDetailModal.value = true;
  loading.paperDetail = true;
  errors.paperDetail = '';

  try {
    paperDetail.value = unwrapResponse(await adminApi.getPaper(paperId));
  } catch (error) {
    paperDetail.value = null;
    errors.paperDetail = error.message || 'Failed to load paper details';
  } finally {
    loading.paperDetail = false;
  }
}

function closePaperDetailModal() {
  if (loading.paperDetail) {
    return;
  }
  showPaperDetailModal.value = false;
}

function getPaperPartQuestionCount(partId) {
  return (paperDetail.value?.questions || []).filter((question) => String(question.partId) === String(partId)).length;
}

async function loadExams() {
  loading.exams = true;
  errors.exams = '';

  try {
    exams.value = unwrapListResponse(await adminApi.getExams());
  } catch (error) {
    errors.exams = error.message || 'Failed to load exams';
    exams.value = [];
  } finally {
    loading.exams = false;
  }
}

/** 首页复习任务卡片与 Review Assignments tab 共用同一个汇总接口，各自支持手动刷新。 */
async function loadWrongAnswerTasks() {
  wrongAnswerTaskLoading.value = true;
  wrongAnswerTaskError.value = '';
  try {
    wrongAnswerTasks.value = unwrapListResponse(await adminApi.getWrongAnswerTasks());
  } catch (error) {
    wrongAnswerTasks.value = [];
    wrongAnswerTaskError.value = error.message || 'Failed to load wrong-answer tasks.';
  } finally {
    wrongAnswerTaskLoading.value = false;
  }
}

async function endWrongAnswerTask(task) {
  if (!task?.taskId || endingWrongAnswerTaskId.value !== null) {
    return;
  }
  const confirmed = window.confirm(
    `End "${task.title}"? Students who have not started will no longer be able to begin it. Students already in progress can continue.`
  );
  if (!confirmed) {
    return;
  }

  endingWrongAnswerTaskId.value = task.taskId;
  try {
    unwrapResponse(await adminApi.endWrongAnswerTask(task.taskId));
    await loadWrongAnswerTasks();
    showActionToast({
      title: 'Assignment ended',
      message: 'New attempts are closed. Students already in progress can continue.',
      variant: 'success',
    });
  } catch (error) {
    showActionToast({
      title: 'Could not end assignment',
      message: error.message || 'Please try again.',
      variant: 'error',
    });
  } finally {
    endingWrongAnswerTaskId.value = null;
  }
}

function openWrongAnswerTaskModal() {
  wrongAnswerTaskForm.examId = wrongAnswerTaskExams.value[0]?.examId
    ? String(wrongAnswerTaskExams.value[0].examId)
    : '';
  wrongAnswerTaskForm.classId = classes.value[0]?.classId ? String(classes.value[0].classId) : '';
  wrongAnswerTaskForm.title = wrongAnswerTaskForm.examId
    ? `${wrongAnswerTaskExams.value.find((exam) => String(exam.examId) === wrongAnswerTaskForm.examId)?.examTitle || 'Exam'} Wrong Answer Review`
    : '';
  wrongAnswerTaskForm.description = '';
  setWrongAnswerTaskWindow();
  wrongAnswerTaskFormError.value = '';
  wrongAnswerTaskModalOpen.value = true;
}

function setWrongAnswerTaskWindow() {
  const start = new Date();
  start.setMinutes(start.getMinutes() - start.getTimezoneOffset() + 10);
  const end = new Date(start);
  end.setHours(end.getHours() + 2);
  wrongAnswerTaskForm.startAt = start.toISOString().slice(0, 16);
  wrongAnswerTaskForm.endAt = end.toISOString().slice(0, 16);
}

function closeWrongAnswerTaskModal() {
  if (!wrongAnswerTaskSubmitting.value) {
    wrongAnswerTaskModalOpen.value = false;
    wrongAnswerTaskFormError.value = '';
  }
}

function updateWrongAnswerTaskTitle() {
  const exam = exams.value.find((item) => String(item.examId) === String(wrongAnswerTaskForm.examId));
  wrongAnswerTaskForm.title = exam ? `${exam.examTitle} Wrong Answer Review` : '';
}

async function publishWrongAnswerTask() {
  wrongAnswerTaskFormError.value = '';
  if (!wrongAnswerTaskForm.examId || !wrongAnswerTaskForm.classId || !wrongAnswerTaskForm.title.trim()) {
    wrongAnswerTaskFormError.value = 'Choose an exam and class, then enter a task title.';
    return;
  }
  if (!wrongAnswerTaskForm.startAt || !wrongAnswerTaskForm.endAt) {
    wrongAnswerTaskFormError.value = 'Choose both a start time and an end time.';
    return;
  }
  if (new Date(wrongAnswerTaskForm.endAt) <= new Date(wrongAnswerTaskForm.startAt)) {
    wrongAnswerTaskFormError.value = 'The end time must be later than the start time.';
    return;
  }

  wrongAnswerTaskSubmitting.value = true;
  try {
    unwrapResponse(await adminApi.createWrongAnswerTask({
      examId: Number(wrongAnswerTaskForm.examId),
      classId: Number(wrongAnswerTaskForm.classId),
      title: wrongAnswerTaskForm.title.trim(),
      description: wrongAnswerTaskForm.description.trim() || null,
      startAt: wrongAnswerTaskForm.startAt,
      endAt: wrongAnswerTaskForm.endAt,
    }));
    wrongAnswerTaskModalOpen.value = false;
    await loadWrongAnswerTasks();
  } catch (error) {
    wrongAnswerTaskFormError.value = error.message || 'Failed to publish the task.';
  } finally {
    wrongAnswerTaskSubmitting.value = false;
  }
}

function openWrongAnswerTaskProgress(task) {
  // 返回地址携带列表筛选，详情页返回后恢复原来的任务列表上下文。
  const returnTo = router.resolve({
    name: 'shsat-admin',
    query: {
      tab: 'wrong-answer-tasks',
      reviewKeyword: wrongAnswerTaskFilters.keyword || undefined,
      reviewExamId: wrongAnswerTaskFilters.examId || undefined,
      reviewClassId: wrongAnswerTaskFilters.classId || undefined,
    },
  }).fullPath;

  router.push({
    name: 'admin-wrong-answer-task',
    params: {
      classId: task.classId,
      examId: task.examId,
      taskId: task.taskId,
    },
    query: {
      returnTo,
      returnLabel: 'Back to Review Assignments',
    },
  });
}

async function loadPaperStructureStats(paperId) {
  const detail = unwrapResponse(await adminApi.getPaper(paperId));
  return buildPaperStructureStats(detail);
}

async function createExamRelease(payload) {
  if (loading.submittingExam) {
    return;
  }

  loading.submittingExam = true;

  try {
    unwrapResponse(await adminApi.createExam(payload));
    notices.examForm = 'Exam release created. You can publish the same paper multiple times.';
    clearObject(examForm, {
      ...examForm,
      examTitle: '',
      examDescription: '',
      targetIdsText: '',
      targetClassIds: [],
      attemptLimit: 1,
    });
    examClassFilters.keyword = '';
    showExamReleaseModal.value = false;
    closeCreateExamStructureConfirm({ force: true });
    await Promise.all([loadExams(), loadAdminExams()]);
  } catch (error) {
    errors.examForm = error.message || 'Failed to create exam';
    closeCreateExamStructureConfirm({ force: true });
  } finally {
    loading.submittingExam = false;
  }
}

async function submitExam() {
  if (loading.submittingExam || loading.checkingExamPaperStats) {
    return;
  }

  const payload = buildExamPayload();
  const validation = validateExamPayload(payload);
  notices.examForm = '';
  errors.examForm = validation;

  if (validation) {
    return;
  }

  loading.checkingExamPaperStats = true;

  try {
    const stats = await loadPaperStructureStats(payload.paperId);
    if (hasPublishStructureRisk(stats)) {
      createExamStructureConfirm.open = true;
      createExamStructureConfirm.payload = payload;
      createExamStructureConfirm.stats = stats;
      return;
    }

    await createExamRelease(payload);
  } catch (error) {
    errors.examForm = error.message || 'Failed to check paper structure.';
  } finally {
    loading.checkingExamPaperStats = false;
  }
}

function closeCreateExamStructureConfirm({ force = false } = {}) {
  if (loading.submittingExam && !force) {
    return;
  }

  createExamStructureConfirm.open = false;
  createExamStructureConfirm.payload = null;
  createExamStructureConfirm.stats = null;
}

async function confirmCreateExamStructureRisk() {
  if (loading.submittingExam) {
    return;
  }

  const payload = createExamStructureConfirm.payload;
  if (!payload) {
    return;
  }

  await createExamRelease(payload);
}

function openExamReleaseModal() {
  errors.examForm = '';
  notices.examForm = '';
  examClassFilters.keyword = '';
  if (isTeacherPortal.value) {
    examForm.targetType = 'SPECIFIC_CLASSES';
    examForm.targetClassIds = [];
  }
  showExamReleaseModal.value = true;
}

function closeExamReleaseModal() {
  if (loading.submittingExam || loading.checkingExamPaperStats) {
    return;
  }
  errors.examForm = '';
  examClassFilters.keyword = '';
  closeCreateExamStructureConfirm();
  showExamReleaseModal.value = false;
}

function getPublishActionHint(exam) {
  if (exam.published) {
    return 'Unpublish: hide this release from students and prevent new starts until it is published again.';
  }

  return 'Publish: make this release visible to its target students within the configured time window.';
}

function getPublishConfirmTitle(exam) {
  return exam?.published ? 'Unpublish this exam?' : 'Publish this exam?';
}

function getPublishConfirmActionText(exam) {
  return exam?.published ? 'Unpublish Exam' : 'Publish Exam';
}

function getPublishConfirmNote(exam) {
  if (!exam?.published) {
    return 'Students in the selected audience will see this release when the time window allows access.';
  }
  if (exam.hasStudentAttempts) {
    return 'No new attempts can start after unpublishing. Students with an active attempt can continue, and existing results will be kept.';
  }
  return 'Students will no longer be able to start attempts after this exam is unpublished.';
}

function isPublishStructureCheckLoading(exam) {
  return loading.publishPaperStatsId === String(exam?.examId || '');
}

async function loadPublishPaperStats(exam) {
  return loadPaperStructureStats(exam.paperId);
}

async function openPublishConfirm(exam) {
  if (!exam?.examId) {
    return;
  }

  errors.exams = '';
  selectedPublishPaperStats.value = null;

  if (exam.published) {
    selectedPublishExam.value = exam;
    return;
  }

  const loadingId = String(exam.examId);
  loading.publishPaperStatsId = loadingId;

  try {
    const stats = await loadPublishPaperStats(exam);
    if (loading.publishPaperStatsId === loadingId) {
      selectedPublishPaperStats.value = stats;
      selectedPublishExam.value = exam;
    }
  } catch (error) {
    errors.exams = error.message || 'Failed to check paper structure.';
  } finally {
    if (loading.publishPaperStatsId === loadingId) {
      loading.publishPaperStatsId = '';
    }
  }
}

function closePublishConfirm() {
  if (loading.exams) {
    return;
  }

  selectedPublishExam.value = null;
  selectedPublishPaperStats.value = null;
}

function openExamActionDialog({ title, message, variant = 'error' }) {
  examActionDialog.title = title;
  examActionDialog.message = message;
  examActionDialog.variant = variant;
  examActionDialog.open = true;
}

function closeExamActionDialog() {
  examActionDialog.open = false;
  examActionDialog.title = '';
  examActionDialog.message = '';
  examActionDialog.variant = 'error';
}

function closeActionToast() {
  if (actionToastTimer) {
    clearTimeout(actionToastTimer);
    actionToastTimer = null;
  }

  actionToast.open = false;
  actionToast.title = '';
  actionToast.message = '';
  actionToast.variant = 'info';
}

function showActionToast({ title, message, variant = 'info', duration = 3600 }) {
  closeActionToast();
  actionToast.title = title;
  actionToast.message = message;
  actionToast.variant = variant;
  actionToast.open = true;

  if (duration > 0) {
    actionToastTimer = window.setTimeout(closeActionToast, duration);
  }
}

function openDeleteExamConfirm(exam) {
  if (!exam?.examId || loading.deletingExamId) {
    return;
  }

  closeExamActionDialog();
  selectedDeleteExam.value = exam;
  startExamDeleteCooldown();
}

function clearExamDeleteCooldown() {
  if (examDeleteCooldownTimer) {
    clearInterval(examDeleteCooldownTimer);
    examDeleteCooldownTimer = null;
  }
}

function startExamDeleteCooldown() {
  clearExamDeleteCooldown();
  examDeleteCooldown.value = EXAM_DELETE_COOLDOWN_SECONDS;
  examDeleteCooldownTimer = window.setInterval(() => {
    examDeleteCooldown.value = Math.max(examDeleteCooldown.value - 1, 0);
    if (examDeleteCooldown.value === 0) clearExamDeleteCooldown();
  }, 1000);
}

function closeDeleteExamConfirm() {
  if (loading.deletingExamId) {
    return;
  }

  selectedDeleteExam.value = null;
  clearExamDeleteCooldown();
  examDeleteCooldown.value = 0;
}

async function confirmPublishChange() {
  const exam = selectedPublishExam.value;
  const examId = exam?.examId;
  if (!examId || loading.exams) {
    return;
  }

  loading.exams = true;
  errors.exams = '';

  try {
    if (exam.published) {
      unwrapResponse(await adminApi.unpublishExam(examId));
    } else {
      unwrapResponse(await adminApi.publishExam(examId));
    }
    await Promise.all([loadExams(), loadAdminExams()]);
    selectedPublishExam.value = null;
    selectedPublishPaperStats.value = null;
  } catch (error) {
    errors.exams = error.message || 'Publish status update failed.';
    loading.exams = false;
  }
}

async function confirmDeleteExam() {
  const exam = selectedDeleteExam.value;
  const examId = exam?.examId;
  if (!examId || examDeleteCooldown.value > 0 || loading.deletingExamId) {
    return;
  }

  loading.deletingExamId = String(examId);
  errors.exams = '';
  notices.examForm = '';

  try {
    await adminApi.deleteExam(examId);
    notices.examForm = `Exam release "${exam.examTitle}" and its student attempts were permanently deleted.`;
    selectedDeleteExam.value = null;
    clearExamDeleteCooldown();
    examDeleteCooldown.value = 0;
    await Promise.all([loadExams(), loadAdminExams()]);
  } catch (error) {
    selectedDeleteExam.value = null;
    clearExamDeleteCooldown();
    examDeleteCooldown.value = 0;
    openExamActionDialog({
      title: 'Unable to Delete Exam',
      message: error.message || 'This exam release could not be deleted.',
      variant: 'error',
    });
  } finally {
    loading.deletingExamId = '';
  }
}

async function loadClasses() {
  loading.classes = true;
  errors.classes = '';

  try {
    classes.value = unwrapListResponse(await adminApi.getClasses());
    if (!selectedClassId.value && classes.value.length > 0) {
      selectedClassId.value = String(classes.value[0].classId);
      reportForm.classId = selectedClassId.value;
    }
  } catch (error) {
    errors.classes = error.message || 'Failed to load classes';
    classes.value = [];
  } finally {
    loading.classes = false;
  }
}

async function loadStudents(classId = selectedClassId.value) {
  if (!classId) {
    students.value = [];
    return;
  }

  selectedClassId.value = String(classId);
  reportForm.classId = String(classId);
  loading.students = true;
  errors.students = '';

  try {
    students.value = unwrapListResponse(await adminApi.getClassStudents(classId));
  } catch (error) {
    errors.students = error.message || 'Failed to load students';
    students.value = [];
  } finally {
    loading.students = false;
  }
}

async function loadUnassignedStudents() {
  loading.unassignedStudents = true;
  errors.unassignedStudents = '';

  try {
    unassignedStudents.value = unwrapListResponse(await adminApi.getUnassignedStudentAccounts());
    const availableIds = new Set(unassignedStudents.value.map(getUnassignedStudentId));
    selectedUnassignedStudentIds.value = selectedUnassignedStudentIds.value.filter((userId) => availableIds.has(userId));
  } catch (error) {
    errors.unassignedStudents = error.message || 'Failed to load unassigned students';
    unassignedStudents.value = [];
    selectedUnassignedStudentIds.value = [];
  } finally {
    loading.unassignedStudents = false;
  }
}

function toggleUnassignedStudent(student, checked) {
  const userId = getUnassignedStudentId(student);
  if (!userId) return;

  selectedUnassignedStudentIds.value = checked
    ? [...new Set([...selectedUnassignedStudentIds.value, userId])]
    : selectedUnassignedStudentIds.value.filter((selectedId) => selectedId !== userId);
}

function toggleAllUnassignedStudents(checked) {
  selectedUnassignedStudentIds.value = checked
    ? unassignedStudents.value.map(getUnassignedStudentId)
    : [];
}

function openBulkAssignModal() {
  if (selectedUnassignedStudents.value.length === 0 || assignableClasses.value.length === 0) return;

  bulkAssignClassId.value = '';
  bulkAssignError.value = '';
  showBulkAssignModal.value = true;
}

function closeBulkAssignModal() {
  if (bulkAssigning.value) return;

  showBulkAssignModal.value = false;
  bulkAssignError.value = '';
}

// 批量分配入口：逐个调用现有分配 API，成功项从未分配名单移除，失败项保留便于重试。
async function submitBulkAssign() {
  const classId = Number(bulkAssignClassId.value);
  const selectedStudents = selectedUnassignedStudents.value;
  if (!classId || selectedStudents.length === 0 || bulkAssigning.value) return;

  bulkAssigning.value = true;
  bulkAssignError.value = '';
  const results = await Promise.allSettled(
    selectedStudents.map((student) => adminApi.assignStudentAccountToClass(student.userId || student.id, classId)),
  );
  const failedIds = new Set(
    results.flatMap((result, index) => (result.status === 'rejected'
      ? [getUnassignedStudentId(selectedStudents[index])]
      : [])),
  );

  await Promise.all([
    loadUnassignedStudents(),
    loadClasses(),
    String(classId) === String(selectedClassId.value) ? loadStudents(classId) : Promise.resolve(),
  ]);

  if (failedIds.size > 0) {
    selectedUnassignedStudentIds.value = selectedUnassignedStudentIds.value.filter((userId) => failedIds.has(userId));
    const firstFailure = results.find((result) => result.status === 'rejected');
    const reason = firstFailure?.reason?.message;
    bulkAssignError.value = `${selectedStudents.length - failedIds.size} of ${selectedStudents.length} students were assigned. ${reason || 'Some students could not be assigned. Select them and try again.'}`;
  } else {
    showBulkAssignModal.value = false;
    selectedUnassignedStudentIds.value = [];
    showActionToast({
      title: 'Students Assigned',
      message: `${selectedStudents.length} students were added to ${assignableClasses.value.find((item) => String(item.classId) === String(classId))?.className || 'the selected class'}.`,
      variant: 'success',
    });
  }

  bulkAssigning.value = false;
}

function openDeleteClassConfirm(item) {
  if (!item?.classId || !canDeleteClass(item) || loading.deletingClassId) {
    return;
  }

  errors.classes = '';
  deleteClassError.value = '';
  selectedDeleteClass.value = item;
}

function closeDeleteClassConfirm() {
  if (loading.deletingClassId) {
    return;
  }

  selectedDeleteClass.value = null;
  deleteClassError.value = '';
}

async function confirmDeleteClass() {
  const target = selectedDeleteClass.value;
  const classId = target?.classId;
  if (!classId || !canDeleteClass(target) || loading.deletingClassId) {
    return;
  }

  loading.deletingClassId = String(classId);
  deleteClassError.value = '';

  try {
    await adminApi.deleteClass(classId);
    if (String(selectedClassId.value) === String(classId)) {
      selectedClassId.value = '';
      reportForm.classId = '';
      students.value = [];
      classScores.value = [];
    }
    selectedDeleteClass.value = null;
    await loadClasses();
    showActionToast({
      title: 'Class Deleted',
      message: `"${target.className}" was deleted.`,
      variant: 'success',
    });
  } catch (error) {
    deleteClassError.value = error.message || 'Failed to delete class';
  } finally {
    loading.deletingClassId = '';
  }
}

function openClassDetail(item) {
  const classId = getId(item, 'classId');

  if (!classId) {
    return;
  }

  router.push({
    name: 'admin-class-detail',
    params: { classId: String(classId) },
  });
}

function returnToClassList() {
  classView.value = 'list';
  reportForm.examId = '';
  classScores.value = [];
  errors.classScores = '';
}

function openStudentDetail(student) {
  const studentDetailId = student.studentId || student.id;

  if (!studentDetailId || !selectedClassId.value) {
    return;
  }

  router.push({
    name: 'admin-student-detail',
    params: { classId: selectedClassId.value, studentId: String(studentDetailId) },
    query: {
      studentName: student.studentName || student.name || '',
      studentNumber: student.studentNumber || '',
      className: selectedClass.value?.className || '',
    },
  });
}

function selectAdminTab(tabKey) {
  activeTab.value = tabKey;

  if (tabKey === 'classes') {
    returnToClassList();
  }
  if (tabKey === 'wrong-answer-tasks') {
    loadWrongAnswerTasks();
  }
}

function openClassModal() {
  editingClassId.value = '';
  errors.classForm = '';
  notices.classForm = '';
  clearObject(classForm, {
    className: '',
    classDescription: '',
    teacherName: '',
    teacherEmail: '',
    gradeLevel: '',
    academicYear: '',
    active: true,
  });
  showClassModal.value = true;
}

// Edit mode pre-fills the form and submits through update instead of create.
function openEditClassModal() {
  const target = selectedClass.value;
  if (!target) {
    return;
  }

  editingClassId.value = String(target.classId);
  errors.classForm = '';
  notices.classForm = '';
  clearObject(classForm, {
    className: target.className || '',
    classDescription: target.classDescription || '',
    teacherName: target.teacherName || '',
    teacherEmail: target.teacherEmail || '',
    gradeLevel: target.gradeLevel || '',
    academicYear: target.academicYear || '',
    active: target.isActive !== false && target.active !== false,
  });
  showClassModal.value = true;
}

function closeClassModal() {
  showClassModal.value = false;
  editingClassId.value = '';
  errors.classForm = '';
  notices.classForm = '';
}

async function submitClass() {
  errors.classForm = '';
  notices.classForm = '';

  if (!classForm.className.trim()) {
    errors.classForm = 'Class name is required.';
    return;
  }

  loading.submittingClass = true;

  try {
    if (editingClassId.value) {
      const response = unwrapResponse(await adminApi.updateClass(editingClassId.value, { ...classForm }));
      await loadClasses();
      closeClassModal();
      // Stay on the detail page after editing and refresh the displayed data.
      await openClassDetail(response);
    } else {
      const response = unwrapResponse(await adminApi.createClass({ ...classForm }));
      await loadClasses();
      closeClassModal();
      await openClassDetail(response);
    }
  } catch (error) {
    errors.classForm = error.message || 'Failed to save class';
  } finally {
    loading.submittingClass = false;
  }
}

async function loadClassScores() {
  errors.classScores = '';
  classScores.value = [];

  if (!reportForm.classId && selectedClassId.value) {
    reportForm.classId = selectedClassId.value;
  }

  if (!reportForm.examId || !reportForm.classId) {
    errors.classScores = 'Select an exam and a class.';
    return;
  }

  loading.classScores = true;

  try {
    classScores.value = unwrapListResponse(
      await adminApi.getClassExamScores(reportForm.examId, reportForm.classId),
    );
  } catch (error) {
    errors.classScores = error.message || 'Failed to load class results';
  } finally {
    loading.classScores = false;
  }
}

async function viewClassExamScores(exam) {
  if (!selectedClassId.value || !exam?.examId) {
    return;
  }

  router.push({
    name: 'admin-class-exam-results',
    params: {
      classId: selectedClassId.value,
      examId: exam.examId,
    },
  });
}

function choosePaperForExam(paper) {
  examForm.paperId = String(paper.paperId);
  examForm.duration = paper.defaultDuration || examForm.duration || 90;
  examForm.examTitle = `${paper.paperName} Release`;
  activeTab.value = 'exams';
}

function setPaperActionMenuOpen(paperId, isOpen) {
  openPaperActionMenuId.value = isOpen ? paperId : null;
}

function closePaperActionMenu() {
  openPaperActionMenuId.value = null;
}

function handlePaperAction(action) {
  closePaperActionMenu();
  action();
}

async function sealPaper(paper) {
  if (!paper?.paperId || loading.sealingPaperId) return;

  loading.sealingPaperId = String(paper.paperId);
  try {
    await adminApi.sealPaper(paper.paperId);
    await loadPapers();
    showActionToast({
      title: 'Paper ready',
      message: 'Paper sealed and ready for exam releases.',
      variant: 'success',
    });
  } catch (error) {
    showActionToast({
      title: 'Unable to seal paper',
      message: error.message || 'Review the paper before sealing it.',
      variant: 'error',
    });
  } finally {
    loading.sealingPaperId = '';
  }
}

function openPaperEditor(paper) {
  if (!paper?.paperId) {
    return;
  }

  router.push({
    name: 'admin-paper-edit',
    params: { paperId: paper.paperId },
  });
}

function openPaperPreview(paper) {
  if (!paper?.paperId) {
    return;
  }

  router.push({
    name: 'admin-paper-preview',
    params: { paperId: paper.paperId },
  });
}

function openPaperExport(paper) {
  if (!paper?.paperId) {
    return;
  }

  router.push({
    name: 'admin-paper-export',
    params: { paperId: paper.paperId },
  });
}

function enterAdminExam(exam) {
  if (exam.status.disabled || !exam.id) {
    return;
  }

  router.push({
    name: 'student-exam',
    params: { examId: exam.id },
    query: { returnTo: route.fullPath },
  });
}

function openExamMonitor(exam) {
  const examId = exam?.id || exam?.examId;

  if (!canAccessExamMonitor.value || !examId) {
    return;
  }
  router.push({
    name: 'admin-exam-monitor',
    params: { examId: String(examId) },
  });
}

async function refreshAdminData() {
  loading.initial = true;

  try {
    if (isTeacherPortal.value) {
      await Promise.all([loadAdminExams(), loadPapers(), loadExams(), loadClasses(), loadWrongAnswerTasks()]);
    } else {
      await Promise.all([loadAdminExams(), loadPapers(), loadExams(), loadClasses(), loadUnassignedStudents(), loadWrongAnswerTasks()]);
    }
    await loadStudents();
  } catch (error) {
    errors.initial = error.message || 'Failed to initialize the admin workspace';
  } finally {
    loading.initial = false;
  }
}

watch(
  () => [
    examReleaseFilters.keyword,
    examReleaseFilters.published,
    examReleaseFilters.timeStatus,
    examReleaseFilters.targetType,
    examReleaseFilters.pageSize,
  ],
  resetExamReleasePage,
);

watch(examReleaseTotalPages, (totalPages) => {
  if (examReleaseFilters.page > totalPages) {
    examReleaseFilters.page = totalPages;
  }
});

watch(
  () => historicalExamFilters.pageSize,
  resetHistoricalExamPage,
);

watch(historicalExamTotalPages, (totalPages) => {
  if (historicalExamFilters.page > totalPages) {
    historicalExamFilters.page = totalPages;
  }
});

watch(
  () => [
    selectedClassId.value,
    scoreFilters.keyword,
    classExamFilters.pageSize,
  ],
  resetClassExamPage,
);

watch(classExamTotalPages, (totalPages) => {
  if (classExamFilters.page > totalPages) {
    classExamFilters.page = totalPages;
  }
});

onMounted(async () => {
  document.addEventListener('click', closePaperActionMenu);
  setNowWindow();
  await refreshAdminData();
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closePaperActionMenu);
  clearPaperDeleteCooldown();
  clearExamDeleteCooldown();
  closeActionToast();
});
</script>

<template>
  <AdminLayout>
    <section class="page-shell admin-home">
        <Teleport to="body">
          <div
            v-if="actionToast.open"
            class="action-toast"
            :class="`action-toast--${actionToast.variant}`"
            role="status"
            aria-live="polite"
          >
            <div>
              <strong>{{ actionToast.title }}</strong>
              <p>{{ actionToast.message }}</p>
            </div>
            <button type="button" aria-label="Close notification" @click="closeActionToast">&times;</button>
          </div>
        </Teleport>

        <p v-if="errors.initial" class="error-text">{{ errors.initial }}</p>

        <AppCard class="available-exams-card" title="Available Exams" subtitle="Start a practice attempt for a published exam from this dashboard.">
        <button
          class="collapse-arrow-button"
          type="button"
          :aria-expanded="!availableExamsCollapsed"
          :title="availableExamsCollapsed ? 'Expand available exams' : 'Collapse available exams'"
          @click="toggleAvailableExams"
        >
          <svg
            class="collapse-arrow-button__icon"
            :class="{ 'collapse-arrow-button__icon--collapsed': availableExamsCollapsed }"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          class="admin-refresh-button"
          :class="{ 'admin-refresh-button--loading': loading.initial }"
          type="button"
          :disabled="loading.initial"
          aria-label="Refresh admin data"
          title="Refresh admin data"
          @click="refreshAdminData"
        >
          <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M17.7 6.3A8 8 0 0 0 4.6 9.4M18 4v4.5h-4.5M6.3 17.7a8 8 0 0 0 13.1-3.1M6 20v-4.5h4.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <template v-if="!availableExamsCollapsed">
          <div v-if="loading.adminExams" class="admin-state">Loading exams...</div>
          <div v-else-if="errors.adminExams" class="admin-state admin-state--error">{{ errors.adminExams }}</div>
          <div v-else-if="adminExamCards.length === 0" class="admin-state">No available exams right now.</div>
          <div v-else class="admin-exam-grid">
          <AdminExamCard
            v-for="exam in adminExamCards"
            :key="exam.id"
            :title="exam.title"
            :status-label="exam.status.label"
            :status-tone="exam.status.key"
            :description="exam.description"
            :metadata="[
              { label: 'Available', value: `${formatDateTime(exam.startTime)} - ${formatDateTime(exam.endTime)}`, wide: true },
              { label: 'Submission', value: getAttemptText(exam) },
              { label: 'Duration', value: exam.duration ? `${exam.duration} min` : 'Not set' },
            ]"
          >
            <template #actions>
              <AppButton class="admin-exam-card__action" :disabled="exam.status.disabled" @click="enterAdminExam(exam)">
                {{ exam.status.actionText }}
              </AppButton>
            </template>
          </AdminExamCard>
          </div>
        </template>
      </AppCard>

      <AppCard class="dashboard-review-card" title="Assigned Review" subtitle="Wrong-answer review assignments you published to your classes. Open one to track student progress.">
        <button
          class="collapse-arrow-button"
          type="button"
          :aria-expanded="!assignedReviewCollapsed"
          :title="assignedReviewCollapsed ? 'Expand assigned review' : 'Collapse assigned review'"
          @click="toggleAssignedReview"
        >
          <svg
            class="collapse-arrow-button__icon"
            :class="{ 'collapse-arrow-button__icon--collapsed': assignedReviewCollapsed }"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          class="admin-refresh-button dashboard-review-refresh-button"
          :class="{ 'admin-refresh-button--loading': wrongAnswerTaskLoading }"
          type="button"
          :disabled="wrongAnswerTaskLoading"
          aria-label="Refresh review assignments"
          title="Refresh review assignments"
          @click="loadWrongAnswerTasks"
        >
          <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17.7 6.3A8 8 0 0 0 4.6 9.4M18 4v4.5h-4.5M6.3 17.7a8 8 0 0 0 13.1-3.1M6 20v-4.5h4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <template v-if="!assignedReviewCollapsed">
        <div v-if="wrongAnswerTaskLoading" class="admin-state">Loading review assignments...</div>
        <div v-else-if="wrongAnswerTaskError" class="admin-state admin-state--error">
          <p>{{ wrongAnswerTaskError }}</p>
          <AppButton variant="secondary" @click="loadWrongAnswerTasks">Retry</AppButton>
        </div>
        <div v-else-if="dashboardReviewAssignments.length === 0" class="admin-state">
          Publish a review assignment from the Review Assignments tab to see it here.
        </div>
        <div v-else class="dashboard-review-grid">
          <article v-for="task in dashboardReviewAssignments" :key="task.taskId" class="dashboard-review-task">
            <header class="dashboard-review-task__header">
              <div class="dashboard-review-task__heading">
                <span class="dashboard-review-task__eyebrow">Exam Review Assignment</span>
                <h3>{{ task.title }}</h3>
              </div>
              <span
                class="dashboard-review-task__status"
                :class="{ 'dashboard-review-task__status--ended': isReviewAssignmentEnded(task) }"
              >
                {{ reviewAssignmentStatusLabel(task) }}
              </span>
            </header>
            <p class="dashboard-review-task__exam">
              {{ task.examTitle || `Exam #${task.examId}` }} · {{ task.className || `Class #${task.classId}` }}
            </p>
            <dl class="dashboard-review-task__details">
              <div>
                <dt>Completed / eligible</dt>
                <dd>{{ task.completedCount || 0 }} / {{ task.eligibleCount || 0 }}</dd>
              </div>
              <div>
                <dt>Assigned students</dt>
                <dd>{{ task.assignedCount || 0 }}</dd>
              </div>
            </dl>
            <p class="dashboard-review-task__availability">
              {{ task.startAt ? formatDateTime(task.startAt) : 'Available now' }}<span v-if="task.endAt"> – {{ formatDateTime(task.endAt) }}</span>
            </p>
            <AppButton class="dashboard-review-task__action" @click="openWrongAnswerTaskProgress(task)">
              View Progress
            </AppButton>
          </article>
        </div>
        </template>
      </AppCard>

      <AdminTabs
        :model-value="activeTab"
        :tabs="visibleTabs"
        aria-label="Admin Features"
        @update:model-value="selectAdminTab"
      />

      <AdminTabPanels :active-key="activeTab">
      <AdminSection v-if="!isTeacherPortal" v-show="activeTab === 'papers'">

        <AppCard class="paper-list-card" title="Paper List" subtitle="View paper summaries, inspect structure, and use a paper for exam publishing.">
          <div class="admin-toolbar">
            <div class="admin-toolbar__filters">
              <select v-model="paperFilters.groupId" class="form-input form-input--compact" aria-label="Folder">
                <option value="">All folders</option>
                <option :value="DEFAULT_FOLDER_KEY">Default Folder</option>
                <option
                  v-for="group in selectablePaperGroups"
                  :key="group.paperGroupId"
                  :value="group.paperGroupId"
                >
                  {{ group.groupName }} ({{ group.paperCount || 0 }})
                </option>
              </select>

              <select v-model="paperFilters.online" class="form-input form-input--compact" aria-label="Online Status">
                <option value="">All</option>
                <option value="true">Online</option>
                <option value="false">Offline</option>
              </select>

              <input v-model="paperFilters.keyword" class="form-input paper-search-input" placeholder="Paper name" />
            </div>

            <div class="admin-toolbar__actions">
              <AppButton variant="secondary" :disabled="loading.papers" @click="loadPapers">
                {{ loading.papers ? 'Searching...' : 'Search' }}
              </AppButton>
              <AppButton variant="secondary" @click="openGroupModal()">Create Folder</AppButton>
              <AppButton @click="openPaperCreateModal">Create Paper</AppButton>
            </div>
          </div>

          <p v-if="notices.groupForm" class="success-text admin-toolbar__message">{{ notices.groupForm }}</p>

          <div v-if="loading.papers" class="admin-state">Loading papers...</div>
          <div v-else-if="errors.papers" class="admin-state admin-state--error">{{ errors.papers }}</div>
          <div v-else-if="hasAppliedPaperFilter && papers.length === 0 && !selectedEmptyPaperGroup" class="admin-state">
            No papers found. Try changing or clearing the filters.
          </div>
          <div v-else-if="groupedPapers.length === 0" class="admin-state">No papers found.</div>

            <div v-else class="folder-list" :class="{ 'folder-list--reorderable': canReorderPaperGroups }">
              <section
                v-for="group in groupedPapers"
                :key="group.key"
                class="folder-panel"
                :class="{
                  'folder-panel--draggable': canReorderPaperGroups && group.groupId,
                  'folder-panel--dragging': draggingPaperGroupId === String(group.groupId),
                }"
                :draggable="canReorderPaperGroups && Boolean(group.groupId)"
                @dragstart="startPaperGroupDrag(group, $event)"
                @dragover="dragOverPaperGroup(group, $event)"
                @drop="dropPaperGroup(group, $event)"
                @dragend="finishPaperGroupDrag"
              >
              <div
                class="folder-panel__header"
                :class="{ 'folder-panel__header--open': expandedFolders[group.key] }"
              >
                <button class="folder-panel__main-button" type="button" @click="toggleFolder(group.key)">
                  <span class="folder-panel__toggle" aria-hidden="true"></span>
                  <span class="folder-panel__title">
                    <strong>{{ group.groupName }}</strong>
                  </span>
                  <small>{{ group.papers.length }} {{ group.papers.length === 1 ? 'paper' : 'papers' }}</small>
                  </button>
                <div v-if="group.groupId" class="folder-panel__actions" @click.stop @mousedown.stop>
                  <button
                    class="folder-panel__icon-button"
                    type="button"
                    title="Rename folder"
                    aria-label="Rename folder"
                    @click="openGroupModal(group)"
                  >
                    ✎
                  </button>
                  <button
                    v-if="group.papers.length === 0"
                    class="folder-panel__icon-button folder-panel__icon-button--danger"
                    type="button"
                    title="Delete empty folder"
                    aria-label="Delete empty folder"
                    :disabled="loading.deletingGroupId === String(group.groupId)"
                    @click="deleteEmptyGroup(group)"
                  >
                    {{ loading.deletingGroupId === String(group.groupId) ? '…' : '×' }}
                  </button>
                </div>
              </div>

                <div v-if="expandedFolders[group.key] && group.papers.length === 0" class="folder-panel__empty">
                  No papers in this folder yet.
                </div>

                <div v-if="expandedFolders[group.key] && group.papers.length > 0" class="table-wrap">
                  <AdminDataTable class="paper-table">
                    <thead>
                        <tr>
                          <th>Paper</th>
                        <th>Questions</th>
                        <th>Duration</th>
                        <th>Score</th>
                        <th>Status</th>
                        <th class="paper-actions-header">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="paper in group.papers"
                        :key="paper.paperId"
                        :class="{ 'paper-table__row--active': selectedPaperId === paper.paperId }"
                      >
                        <td>
                          <strong>{{ paper.paperName }}</strong>
                        </td>
                        <td>{{ paper.totalQuestions || 0 }}</td>
                        <td>{{ paper.defaultDuration || '-' }} min</td>
                        <td>{{ formatNumber(paper.totalScore) }}</td>
                        <td>{{ paper.status || '-' }} / {{ getOnlineText(paper.online) }}</td>
                        <td class="paper-actions-cell">
                          <AdminActionMenu
                            label="Paper actions"
                            :open="openPaperActionMenuId === paper.paperId"
                            @update:open="setPaperActionMenuOpen(paper.paperId, $event)"
                          >
                            <button type="button" @click="handlePaperAction(() => openMoveModal(paper, group.groupId))">Move</button>
                            <button type="button" @click="handlePaperAction(() => loadPaperDetail(paper.paperId))">Detail</button>
                            <button type="button" @click="handlePaperAction(() => openPaperEditModal(paper))">Edit Info</button>
                            <button type="button" @click="handlePaperAction(() => openPaperEditor(paper))">Edit Paper</button>
                            <button
                              v-if="paper.status === 'DRAFT'"
                              type="button"
                              :disabled="loading.sealingPaperId === String(paper.paperId)"
                              @click="handlePaperAction(() => sealPaper(paper))"
                            >
                              {{ loading.sealingPaperId === String(paper.paperId) ? 'Sealing...' : 'Seal' }}
                            </button>
                            <button type="button" @click="handlePaperAction(() => openPaperPreview(paper))">Preview</button>
                            <button type="button" @click="handlePaperAction(() => openPaperExport(paper))">Export PDF</button>
                            <button
                              class="admin-action-menu__danger"
                              type="button"
                              :disabled="loading.paperDeleteImpactId === String(paper.paperId)"
                              @click="handlePaperAction(() => openPaperDeleteConfirm(paper))"
                            >
                              {{ loading.paperDeleteImpactId === String(paper.paperId) ? 'Loading...' : 'Delete' }}
                            </button>
                          </AdminActionMenu>
                        </td>
                      </tr>
                    </tbody>
                  </AdminDataTable>
                </div>
              </section>
          </div>
        </AppCard>

      </AdminSection>

        <Teleport to="body">
          <div v-if="showPaperDetailModal" class="modal-backdrop" @click.self="closePaperDetailModal">
            <section class="modal-card modal-card--wide">
              <header class="modal-card__header">
                <div>
                  <h3>Paper Details</h3>
                  <p>View parts, questions, and answer PDF summaries from the detail API.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close paper details dialog"
                  @click="closePaperDetailModal"
                >
                  &times;
                  </button>
              </header>

              <div v-if="loading.paperDetail" class="admin-state">Loading details...</div>
              <div v-else-if="errors.paperDetail" class="admin-state admin-state--error">{{ errors.paperDetail }}</div>
              <div v-else-if="!paperDetail" class="admin-state">No paper detail loaded.</div>
              <div v-else class="detail-panel">
                  <div>
                    <span class="admin-eyebrow">Paper Details</span>
                  <h3>{{ paperDetail.paperName }}</h3>
                  <p>{{ paperDetail.paperDescription || 'No description' }}</p>
                </div>
                <dl class="meta-grid meta-grid--wide">
                  <div>
                    <dt>Part</dt>
                    <dd>{{ paperDetail.totalParts || paperDetail.parts?.length || 0 }}</dd>
                  </div>
                  <div>
                    <dt>Questions</dt>
                    <dd>{{ paperDetail.totalQuestions || paperDetail.questions?.length || 0 }}</dd>
                  </div>
                  <div>
                    <dt>Materials</dt>
                    <dd>{{ paperDetail.materials?.length || 0 }}</dd>
                  </div>
                  <div>
                    <dt>Answer PDF</dt>
                    <dd>{{ paperDetail.solutions?.length || 0 }}</dd>
                  </div>
                </dl>
                <div v-if="paperDetail.parts?.length" class="tag-list">
                  <span v-for="part in paperDetail.parts" :key="part.partId" class="soft-tag">
                    {{ part.partName || `Part ${part.partNumber}` }}: {{ getPaperPartQuestionCount(part.partId) }}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="selectedDeletePaper" class="modal-backdrop" @click.self="closePaperDeleteConfirm">
            <section
              class="modal-card publish-confirm-modal paper-delete-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="paper-delete-confirm-title"
            >
              <header class="modal-card__header">
                <div>
                  <span class="admin-eyebrow">Permanent Delete</span>
                  <h3 id="paper-delete-confirm-title">Delete this paper?</h3>
                  <p>This removes the paper and all release data owned by it.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close paper delete confirmation"
                  :disabled="Boolean(loading.deletingPaperId)"
                  @click="closePaperDeleteConfirm"
                >
                  &times;
                </button>
              </header>

              <div class="publish-confirm-summary">
                <strong>{{ getPaperDeleteName() }}</strong>
              </div>

              <div v-if="loading.paperDeleteImpactId" class="admin-state">Loading deletion impact...</div>
              <template v-else>
                <dl v-if="paperDeleteImpact" class="publish-confirm-details paper-delete-impact-grid">
                  <div v-for="row in paperDeleteImpactRows" :key="row.key">
                      <dt>
                        <span>{{ row.label }}</span>
                        <span
                          class="paper-delete-impact-help"
                          tabindex="0"
                          :aria-describedby="`paper-delete-impact-help-${row.key}`"
                        >
                          ?
                          <span
                            :id="`paper-delete-impact-help-${row.key}`"
                            class="paper-delete-impact-tooltip"
                            role="tooltip"
                        >
                            {{ row.help }}
                        </span>
                        </span>
                      </dt>
                      <dd>{{ row.value }}</dd>
                      <small>{{ row.description }}</small>
                  </div>
                </dl>

                <p class="publish-confirm-note publish-confirm-note--danger">
                    This cannot be undone. The selected paper, its scheduled exams, student submissions, and reports will be permanently deleted.
                </p>

                <p class="publish-confirm-note">
                    Other versions of this paper will not be deleted.
                </p>
              </template>

              <p v-if="paperDeleteCooldown > 0" class="paper-delete-confirm__cooldown">
                You can delete this paper in {{ paperDeleteCooldown }} {{ paperDeleteCooldown === 1 ? 'second' : 'seconds' }}.
              </p>
              <p v-else class="paper-delete-confirm__cooldown paper-delete-confirm__cooldown--ready">
                Cooldown complete. Review the impact before deleting.
              </p>

              <p v-if="errors.paperDelete" class="error-text">{{ errors.paperDelete }}</p>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" :disabled="Boolean(loading.deletingPaperId)" @click="closePaperDeleteConfirm">Cancel</AppButton>
                <AppButton
                  class="paper-delete-confirm__delete"
                  type="button"
                  :disabled="!canConfirmPaperDelete"
                  @click="confirmDeletePaper"
                >
                  {{ loading.deletingPaperId ? 'Deleting...' : 'Delete Paper Permanently' }}
                </AppButton>
              </footer>
            </section>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="showGroupModal" class="modal-backdrop" @click.self="closeGroupModal">
            <form class="modal-card" novalidate @submit.prevent="submitGroup">
              <header class="modal-card__header">
                <div>
                  <h3>{{ selectedEditGroup ? 'Rename Folder' : 'Create Folder' }}</h3>
                  <p>{{ selectedEditGroup ? 'Update the folder name shown in Paper Management.' : 'Use folders to organize papers for exam publishing.' }}</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close folder dialog"
                  @click="closeGroupModal"
                >
                    &times;
                  </button>
              </header>

              <label class="form-field">
                <span class="form-label">Folder Name</span>
                <input v-model="groupForm.groupName" class="form-input" placeholder="e.g. 2025 Practice Tests" />
              </label>

              <label class="form-field">
                <span class="form-label">Description</span>
                <input v-model="groupForm.groupDesc" class="form-input" placeholder="Optional" />
              </label>

              <p v-if="errors.groupForm" class="error-text">{{ errors.groupForm }}</p>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" @click="closeGroupModal">Cancel</AppButton>
                <AppButton type="submit" :disabled="loading.submittingGroup">
                  {{ loading.submittingGroup ? (selectedEditGroup ? 'Saving...' : 'Creating...') : (selectedEditGroup ? 'Save Changes' : 'Create Folder') }}
                </AppButton>
              </footer>
            </form>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="selectedDeleteGroup" class="modal-backdrop" @click.self="closeDeleteGroupConfirm">
            <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-group-confirm-title">
              <header class="modal-card__header">
                <div>
                  <h3 id="delete-group-confirm-title">Delete empty folder?</h3>
                  <p>This will remove the folder from Paper Management.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close delete folder confirmation"
                  @click="closeDeleteGroupConfirm"
                >
                    &times;
                </button>
              </header>

              <div class="publish-confirm-summary">
                <strong>{{ selectedDeleteGroup.groupName }}</strong>
                <span>This folder contains no papers.</span>
              </div>

              <p class="publish-confirm-note publish-confirm-note--danger">
                This action cannot be undone.
              </p>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" @click="closeDeleteGroupConfirm">Cancel</AppButton>
                <AppButton type="button" :disabled="Boolean(loading.deletingGroupId)" @click="confirmDeleteEmptyGroup">
                  {{ loading.deletingGroupId ? 'Deleting...' : 'Delete Folder' }}
                </AppButton>
              </footer>
            </section>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="showMoveModal" class="modal-backdrop" @click.self="closeMoveModal">
            <form class="modal-card" novalidate @submit.prevent="movePaperToGroup(selectedMovePaper)">
              <header class="modal-card__header">
                <div>
                  <h3>Move Paper</h3>
                  <p>{{ selectedMovePaper?.paperName }}</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close move dialog"
                  @click="closeMoveModal"
                >
                  &times;
                </button>
              </header>

              <label class="form-field">
                <span class="form-label">Folder</span>
                <select v-model="moveForm.paperGroupId" class="form-input">
                  <option value="">Default Folder</option>
                  <option
                    v-for="group in selectablePaperGroups"
                    :key="group.paperGroupId"
                    :value="group.paperGroupId"
                  >
                    {{ group.groupName }}
                  </option>
                </select>
              </label>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" @click="closeMoveModal">Cancel</AppButton>
                <AppButton type="submit" :disabled="loading.movingPaperId === selectedMovePaper?.paperId">
                  {{ loading.movingPaperId === selectedMovePaper?.paperId ? 'Moving...' : 'Move Paper' }}
                </AppButton>
              </footer>
            </form>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="showPaperCreateModal" class="modal-backdrop" @click.self="closePaperCreateModal">
            <form class="modal-card modal-card--wide modal-card--paper-create" novalidate @submit.prevent="submitPaperCreate">
              <header class="modal-card__header">
                <div>
                  <h3>Create Paper</h3>
                  <p>Create an SHSAT paper with the official ELA and Math structure.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close create paper dialog"
                  @click="closePaperCreateModal"
                >
                  &times;
                </button>
              </header>

              <div class="paper-structure-note">
                <strong>Official structure included</strong>
                <span>The paper editor will open with ELA, Math, and official question types ready.</span>
              </div>

              <div class="modal-form-grid">
                <label class="form-field form-field--wide">
                  <span class="form-label">Paper Name</span>
                  <input v-model="paperEditForm.paperName" class="form-input" placeholder="e.g. SHSAT Practice Test 1" @input="errors.papers = ''" />
                </label>

                <label class="form-field form-field--wide">
                  <span class="form-label">Description</span>
                  <textarea v-model="paperEditForm.paperDescription" class="form-input" rows="2" placeholder="Optional note shown in paper lists"></textarea>
                </label>

                <label class="form-field">
                  <span class="form-label">Folder</span>
                  <select v-model="paperEditForm.paperGroupId" class="form-input">
                    <option value="">Default Folder</option>
                    <option
                      v-for="group in selectablePaperGroups"
                      :key="group.paperGroupId"
                      :value="group.paperGroupId"
                    >
                      {{ group.groupName }}
                    </option>
                  </select>
                </label>

                <label class="form-field">
                  <span class="form-label">Duration (minutes)</span>
                  <input v-model.number="paperEditForm.defaultDuration" class="form-input" type="number" min="1" />
                </label>
              </div>

              <p class="form-hint">New papers are saved as offline drafts.</p>
              <p v-if="errors.papers" class="error-text">{{ errors.papers }}</p>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" @click="closePaperCreateModal">Cancel</AppButton>
                <AppButton type="submit" :disabled="loading.papers">
                  {{ loading.papers ? 'Creating...' : 'Create and Edit' }}
                </AppButton>
              </footer>
            </form>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="showPaperEditModal" class="modal-backdrop" @click.self="closePaperEditModal">
            <form class="modal-card modal-card--wide modal-card--paper-settings" novalidate @submit.prevent="submitPaperEdit">
              <header class="modal-card__header">
                <div>
                  <h3>Edit Info</h3>
                  <p>Update basic information, folder, timing, and availability.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close edit dialog"
                  @click="closePaperEditModal"
                >
                  &times;
                </button>
              </header>

              <div class="modal-form-grid">
                <label class="form-field form-field--wide">
                  <span class="form-label">Paper Name</span>
                  <input v-model="paperEditForm.paperName" class="form-input" />
                </label>

                <label class="form-field form-field--wide">
                  <span class="form-label">Description</span>
                  <textarea v-model="paperEditForm.paperDescription" class="form-input" rows="3"></textarea>
                </label>

                <label class="form-field">
                  <span class="form-label">Folder</span>
                  <select v-model="paperEditForm.paperGroupId" class="form-input">
                    <option value="">Default Folder</option>
                    <option
                      v-for="group in selectablePaperGroups"
                      :key="group.paperGroupId"
                      :value="group.paperGroupId"
                    >
                      {{ group.groupName }}
                    </option>
                  </select>
                </label>

                <label class="form-field">
                  <span class="form-label">Duration (minutes)</span>
                  <input v-model.number="paperEditForm.defaultDuration" class="form-input" type="number" min="1" />
                </label>

                <div class="form-field">
                  <span class="form-label">Questions</span>
                  <p class="form-readonly-value">
                    {{ selectedEditPaperQuestionCount }}
                  </p>
                  <p class="form-hint">Question count is calculated from the questions currently added to this paper.</p>
                </div>

                <label class="check-line">
                  <input v-model="paperEditForm.online" type="checkbox" />
                  Online
                </label>
              </div>

              <p v-if="errors.papers" class="error-text">{{ errors.papers }}</p>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" @click="closePaperEditModal">Cancel</AppButton>
                <AppButton type="submit" :disabled="loading.papers">
                  {{ loading.papers ? 'Saving...' : 'Save Changes' }}
                </AppButton>
              </footer>
            </form>
          </div>
        </Teleport>

      <AdminSection v-show="activeTab === 'exams'">
        <AppCard class="exam-releases-card" title="Exam Releases" subtitle="Find a release, check its audience and window, then publish or unpublish it.">
            <div class="card-top-actions">
              <AppButton class="card-top-actions__primary" @click="openExamReleaseModal">Create Exam</AppButton>
              <button
                class="admin-refresh-button"
                :class="{ 'admin-refresh-button--loading': loading.exams }"
                type="button"
                :disabled="loading.exams"
                aria-label="Refresh releases"
                title="Refresh releases"
                @click="loadExams"
              >
                <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" />
                </svg>
              </button>
              <button
                class="collapse-arrow-button"
                type="button"
                :aria-label="examReleasesCollapsed ? 'Expand exam releases' : 'Collapse exam releases'"
                :title="examReleasesCollapsed ? 'Expand' : 'Collapse'"
                @click="examReleasesCollapsed = !examReleasesCollapsed"
              >
                <svg
                  class="collapse-arrow-button__icon"
                  :class="{ 'collapse-arrow-button__icon--collapsed': examReleasesCollapsed }"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path fill="currentColor" d="m7.4 14.6 4.6-4.6 4.6 4.6L18 13.2l-6-6-6 6 1.4 1.4Z" />
                </svg>
              </button>
            </div>
            <template v-if="!examReleasesCollapsed">
          <div class="admin-toolbar release-toolbar">
            <div class="admin-toolbar__filters">
              <input
                v-model="examReleaseFilters.keyword"
                class="form-input release-search-input"
                placeholder="Search title, paper, target"
              />
              <select v-model="examReleaseFilters.published" class="form-input form-input--compact" aria-label="Visibility filter">
                <option value="">All visibility</option>
                <option value="published">Published releases</option>
                <option value="unpublished">Unpublished releases</option>
              </select>
              <select v-model="examReleaseFilters.timeStatus" class="form-input form-input--compact" aria-label="Time status">
                <option value="">All time windows</option>
                <option value="upcoming">Upcoming</option>
                <option value="live">Live</option>
              </select>
              <select v-model="examReleaseFilters.targetType" class="form-input form-input--compact" aria-label="Target type">
                <option value="">All audiences</option>
                <option value="ALL_STUDENTS">All students</option>
                <option value="SPECIFIC_CLASSES">Specific classes</option>
                <option value="SPECIFIC_STUDENTS">Specific students</option>
              </select>
            </div>
          </div>

          <p v-if="notices.examForm" class="success-text admin-toolbar__message">{{ notices.examForm }}</p>
          <div v-if="loading.exams" class="admin-state">Loading exams...</div>
          <div v-else-if="errors.exams && !selectedPublishExam" class="admin-state admin-state--error">{{ errors.exams }}</div>
          <div v-else-if="exams.length === 0" class="admin-state">No exam releases yet.</div>
          <div v-else-if="filteredExamReleases.length === 0" class="admin-state">No active or upcoming releases match the current filters.</div>
          <div v-else class="table-wrap exam-release-table-wrap">
            <AdminDataTable class="exam-release-table">
              <colgroup>
                <col class="exam-release-table__title-column" />
                <col class="exam-release-table__time-column" />
                <col class="exam-release-table__target-column" />
                <col class="exam-release-table__submission-column" />
                <col class="exam-release-table__access-column" />
                <col class="exam-release-table__actions-column" />
              </colgroup>
              <thead>
                <tr>
                  <th>Exam / Paper</th>
                  <th>Time Window</th>
                  <th>Assigned To</th>
                  <th>Submission</th>
                  <th>Student Access</th>
                  <th class="action-column-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="exam in paginatedExamReleases" :key="exam.examId">
                  <td class="exam-release-table__title-cell">
                    <strong :title="getExamReleaseIdentity(exam).title">{{ getExamReleaseIdentity(exam).title }}</strong>
                    <small v-if="getExamReleaseIdentity(exam).detail" :title="getExamReleaseIdentity(exam).detail">{{ getExamReleaseIdentity(exam).detail }}</small>
                    <small v-if="isExamPaperMissing(exam)" class="exam-release-table__missing-paper">The linked paper was deleted.</small>
                  </td>
                  <td class="exam-release-table__time-cell" :title="`${getExamReleaseTimeDetail(exam.startTime)} – ${getExamReleaseTimeDetail(exam.endTime)}`">
                    <span>{{ formatExamReleaseTime(exam.startTime) }}</span><span>{{ formatExamReleaseTime(exam.endTime) }}</span>
                  </td>
                  <td class="exam-release-table__target-cell" :title="formatExamTarget(exam)"><span>{{ formatExamTarget(exam) }}</span></td>
                  <td class="exam-release-table__submission-cell">One result</td>
                  <td class="admin-table__access-cell">
                    <span
                      class="access-pill"
                      :class="getExamReleaseAccessState(exam).className"
                      :title="getExamReleaseAccessState(exam).detail"
                      :aria-label="getExamReleaseAccessState(exam).detail"
                    >
                      {{ getExamReleaseAccessState(exam).label }}
                    </span>
                  </td>
                  <td class="exam-release-table__actions-cell action-column-cell">
                    <ResponsiveActionGroup align="center" :actions="getExamReleaseActions(exam)" :label="`Actions for ${exam.examTitle}`" />
                  </td>
                </tr>
              </tbody>
            </AdminDataTable>
            <div class="table-pagination">
              <span>
                Showing {{ examReleasePageStart }}-{{ examReleasePageEnd }} of {{ filteredExamReleases.length }}
              </span>
              <div class="table-pagination__actions">
                <label class="table-pagination__page-size">
                  <span>Rows</span>
                  <select v-model.number="examReleaseFilters.pageSize" class="form-input form-input--compact" aria-label="Rows per page">
                    <option :value="5">5</option>
                    <option :value="10">10</option>
                    <option :value="20">20</option>
                  </select>
                </label>
                <button
                  type="button"
                  :disabled="examReleaseFilters.page <= 1"
                  @click="goExamReleasePage(examReleaseFilters.page - 1)"
                >
                  Prev
                </button>
                <span>Page {{ examReleaseFilters.page }} / {{ examReleaseTotalPages }}</span>
                <button
                  type="button"
                  :disabled="examReleaseFilters.page >= examReleaseTotalPages"
                  @click="goExamReleasePage(examReleaseFilters.page + 1)"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
            </template>
        </AppCard>

        <AppCard class="exam-history-card" title="Historical Exams" subtitle="Ended exam releases are listed here for review.">
          <div class="card-top-actions">
            <button
              class="collapse-arrow-button"
              type="button"
              :aria-label="historicalExamsCollapsed ? 'Expand historical exams' : 'Collapse historical exams'"
              :title="historicalExamsCollapsed ? 'Expand' : 'Collapse'"
              @click="historicalExamsCollapsed = !historicalExamsCollapsed"
            >
              <svg
                class="collapse-arrow-button__icon"
                :class="{ 'collapse-arrow-button__icon--collapsed': historicalExamsCollapsed }"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path fill="currentColor" d="m7.4 14.6 4.6-4.6 4.6 4.6L18 13.2l-6-6-6 6 1.4 1.4Z" />
              </svg>
            </button>
          </div>

          <template v-if="!historicalExamsCollapsed">
          <div v-if="loading.exams" class="admin-state">Loading historical exams...</div>
          <div v-else-if="historicalExamReleases.length === 0" class="admin-state">No ended exams yet.</div>
          <div v-else class="table-wrap exam-release-table-wrap">
            <AdminDataTable class="exam-release-table exam-release-table--history">
              <colgroup>
                <col class="exam-release-table__title-column" />
                <col class="exam-release-table__time-column" />
                <col class="exam-release-table__target-column" />
                <col class="exam-release-table__submission-column" />
                <col class="exam-release-table__access-column" />
                <col class="exam-release-table__actions-column" />
              </colgroup>
              <thead>
                <tr>
                  <th>Exam / Paper</th>
                  <th>Ended At</th>
                  <th>Assigned To</th>
                  <th>Submission</th>
                  <th>Visibility</th>
                  <th class="action-column-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="exam in paginatedHistoricalExamReleases" :key="`history-${exam.examId}`">
                  <td class="exam-release-table__title-cell">
                    <strong :title="getExamReleaseIdentity(exam).title">{{ getExamReleaseIdentity(exam).title }}</strong>
                    <small v-if="getExamReleaseIdentity(exam).detail" :title="getExamReleaseIdentity(exam).detail">{{ getExamReleaseIdentity(exam).detail }}</small>
                    <small v-if="isExamPaperMissing(exam)" class="exam-release-table__missing-paper">The linked paper was deleted.</small>
                  </td>
                  <td class="exam-release-table__time-cell" :title="getExamReleaseTimeDetail(exam.endTime)">{{ formatExamReleaseTime(exam.endTime) }}</td>
                  <td class="exam-release-table__target-cell" :title="formatExamTarget(exam)"><span>{{ formatExamTarget(exam) }}</span></td>
                  <td class="exam-release-table__submission-cell">One result</td>
                  <td>
                    <span class="access-pill" :class="exam.published ? 'access-pill--scheduled' : 'access-pill--hidden'">
                      {{ exam.published ? 'Published' : 'Unpublished' }}
                    </span>
                  </td>
                  <td class="exam-release-table__actions-cell action-column-cell">
                    <ResponsiveActionGroup align="center" :actions="getExamReleaseActions(exam, true)" :label="`Actions for ${exam.examTitle}`" />
                  </td>
                </tr>
              </tbody>
            </AdminDataTable>
            <div class="table-pagination">
              <span>
                Showing {{ historicalExamPageStart }}-{{ historicalExamPageEnd }} of {{ historicalExamReleases.length }}
              </span>
              <div class="table-pagination__actions">
                <label class="table-pagination__page-size">
                  <span>Rows</span>
                  <select v-model.number="historicalExamFilters.pageSize" class="form-input form-input--compact" aria-label="Historical rows per page">
                    <option :value="5">5</option>
                    <option :value="10">10</option>
                    <option :value="20">20</option>
                  </select>
                </label>
                <button
                  type="button"
                  :disabled="historicalExamFilters.page <= 1"
                  @click="goHistoricalExamPage(historicalExamFilters.page - 1)"
                >
                  Prev
                </button>
                <span>Page {{ historicalExamFilters.page }} / {{ historicalExamTotalPages }}</span>
                <button
                  type="button"
                  :disabled="historicalExamFilters.page >= historicalExamTotalPages"
                  @click="goHistoricalExamPage(historicalExamFilters.page + 1)"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          </template>
        </AppCard>

        <Teleport to="body">
          <div v-if="selectedPublishExam" class="modal-backdrop" @click.self="closePublishConfirm">
            <section class="modal-card publish-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="publish-confirm-title">
              <header class="modal-card__header">
                <div>
                  <span class="admin-eyebrow">Confirm Action</span>
                  <h3 id="publish-confirm-title">{{ getPublishConfirmTitle(selectedPublishExam) }}</h3>
                  <p>{{ getPublishActionHint(selectedPublishExam) }}</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close publish confirmation"
                  :disabled="loading.exams"
                  @click="closePublishConfirm"
                >
                  &times;
                </button>
              </header>

              <div class="publish-confirm-summary">
                <strong>{{ selectedPublishExam.examTitle }}</strong>
                <span
                  class="access-pill"
                  :class="getExamReleaseAccessState(selectedPublishExam).className"
                >
                  {{ getExamReleaseAccessState(selectedPublishExam).label }}
                </span>
              </div>

              <dl class="publish-confirm-details">
                <div>
                  <dt>Paper</dt>
                  <dd>{{ getExamPaperName(selectedPublishExam.paperId) || 'Unknown paper' }}</dd>
                </div>
                <div>
                  <dt>Time Window</dt>
                  <dd>{{ formatDateTime(selectedPublishExam.startTime) }} - {{ formatDateTime(selectedPublishExam.endTime) }}</dd>
                </div>
                <div>
                  <dt>Audience</dt>
                  <dd>{{ formatExamTarget(selectedPublishExam) }}</dd>
                </div>
              </dl>

              <div
                v-if="!selectedPublishExam.published && hasPublishStructureRisk(selectedPublishPaperStats)"
                class="publish-structure-warning"
                role="alert"
              >
                <strong>Structure Warning</strong>
                <p>This paper does not match the official 100-question SHSAT structure.</p>
                <dl class="publish-structure-warning__counts">
                  <div>
                    <dt>Total Questions</dt>
                    <dd>{{ selectedPublishPaperStats.total }}</dd>
                  </div>
                  <div>
                    <dt>ELA Scored Questions</dt>
                    <dd>{{ selectedPublishPaperStats.ela }}</dd>
                  </div>
                  <div>
                    <dt>MATH Scored Questions</dt>
                    <dd>{{ selectedPublishPaperStats.math }}</dd>
                  </div>
                </dl>
                <p>Review this structure before publishing. Click Publish Exam to continue anyway.</p>
              </div>

              <p class="publish-confirm-note">
                {{ getPublishConfirmNote(selectedPublishExam) }}
              </p>
              <p v-if="errors.exams" class="publish-confirm-error" role="alert">{{ errors.exams }}</p>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" :disabled="loading.exams" @click="closePublishConfirm">Cancel</AppButton>
                <AppButton type="button" :disabled="loading.exams" @click="confirmPublishChange">
                  {{ loading.exams ? 'Updating...' : getPublishConfirmActionText(selectedPublishExam) }}
                </AppButton>
              </footer>
            </section>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="selectedDeleteExam" class="modal-backdrop" @click.self="closeDeleteExamConfirm">
            <section class="modal-card publish-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-exam-confirm-title">
              <header class="modal-card__header">
                <div>
                  <span class="admin-eyebrow">Delete Release</span>
                  <h3 id="delete-exam-confirm-title">Delete this exam release?</h3>
                  <p>The exam release and all related student records will be permanently deleted.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close delete confirmation"
                  :disabled="Boolean(loading.deletingExamId)"
                  @click="closeDeleteExamConfirm"
                >
                  &times;
                </button>
              </header>

              <div class="publish-confirm-summary">
                <strong>{{ selectedDeleteExam.examTitle }}</strong>
                <span
                  class="access-pill"
                  :class="getExamReleaseAccessState(selectedDeleteExam).className"
                >
                  {{ getExamReleaseAccessState(selectedDeleteExam).label }}
                </span>
              </div>

              <dl class="publish-confirm-details">
                <div>
                  <dt>Paper</dt>
                  <dd>{{ getExamPaperName(selectedDeleteExam.paperId) || 'Unknown paper' }}</dd>
                </div>
                <div>
                  <dt>Time Window</dt>
                  <dd>{{ formatDateTime(selectedDeleteExam.startTime) }} - {{ formatDateTime(selectedDeleteExam.endTime) }}</dd>
                </div>
                <div>
                  <dt>Audience</dt>
                  <dd>{{ formatExamTarget(selectedDeleteExam) }}</dd>
                </div>
              </dl>

              <p class="publish-confirm-note publish-confirm-note--danger">
                This permanently deletes every student attempt, answer, score, report, and linked review assignment. This cannot be undone.
              </p>

              <p v-if="examDeleteCooldown > 0" class="paper-delete-confirm__cooldown">
                You can confirm deletion in {{ examDeleteCooldown }} {{ examDeleteCooldown === 1 ? 'second' : 'seconds' }}.
              </p>
              <p v-else class="paper-delete-confirm__cooldown paper-delete-confirm__cooldown--ready">
                You can now confirm permanent deletion.
              </p>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" :disabled="Boolean(loading.deletingExamId)" @click="closeDeleteExamConfirm">Cancel</AppButton>
                <AppButton type="button" :disabled="Boolean(loading.deletingExamId) || examDeleteCooldown > 0" @click="confirmDeleteExam">
                  {{ loading.deletingExamId ? 'Deleting...' : examDeleteCooldown > 0 ? `Delete Exam (${examDeleteCooldown})` : 'Delete Exam Permanently' }}
                </AppButton>
              </footer>
            </section>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="examActionDialog.open" class="modal-backdrop" @click.self="closeExamActionDialog">
            <section
              class="modal-card exam-action-dialog"
              :class="`exam-action-dialog--${examActionDialog.variant}`"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="exam-action-dialog-title"
              aria-describedby="exam-action-dialog-message"
            >
              <header class="modal-card__header">
                <div>
                  <span class="admin-eyebrow">Action Notice</span>
                  <h3 id="exam-action-dialog-title">{{ examActionDialog.title }}</h3>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close exam action notice"
                  @click="closeExamActionDialog"
                >
                  &times;
                </button>
              </header>

              <p id="exam-action-dialog-message" class="exam-action-dialog__message">
                {{ examActionDialog.message }}
              </p>

              <footer class="modal-card__footer">
                <AppButton type="button" @click="closeExamActionDialog">OK</AppButton>
              </footer>
            </section>
          </div>
        </Teleport>

        <Teleport to="body">
          <div v-if="showExamReleaseModal" class="modal-backdrop" @click.self="closeExamReleaseModal">
            <form class="modal-card modal-card--wide exam-release-modal" novalidate @submit.prevent="submitExam">
              <header class="modal-card__header">
                <div>
                  <h3>Create Exam</h3>
                  <p>Configure the paper, access window, attempt time limit, and audience.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close exam release dialog"
                  :disabled="loading.submittingExam || loading.checkingExamPaperStats"
                  @click="closeExamReleaseModal"
                >
                  &times;
                </button>
              </header>

              <div class="exam-release-form">
                <section class="exam-release-section">
                  <div class="exam-release-section__header">
                    <span class="admin-eyebrow">Paper</span>
                    <p>Choose the paper students will take.</p>
                  </div>
                  <div class="modal-form-grid">
                    <label class="form-field form-field--wide">
                      <span class="form-label">Paper</span>
                      <select v-model="examForm.paperId" class="form-input exam-paper-select">
                        <option value="">Select a paper</option>
                        <optgroup
                          v-for="group in examPaperGroups"
                          :key="group.key"
                          :label="`${group.groupName} (${group.papers.length})`"
                        >
                          <option v-for="paper in group.papers" :key="paper.paperId" :value="paper.paperId">
                            {{ paper.paperName }}
                          </option>
                        </optgroup>
                      </select>
                    </label>
                    <label class="form-field form-field--wide">
                      <span class="form-label">Exam Title</span>
                      <input v-model="examForm.examTitle" class="form-input" placeholder="e.g. Spring 2026 Mock Exam A" />
                    </label>
                    <label class="form-field form-field--wide">
                      <span class="form-label">Exam Description</span>
                      <textarea v-model="examForm.examDescription" class="form-input" rows="2" placeholder="Optional note shown in admin context"></textarea>
                    </label>
                  </div>
                  <p v-if="selectedPaper" class="form-hint">
                    Selected paper default duration: {{ selectedPaper.defaultDuration || '-' }} minutes.
                  </p>
                </section>

                <section class="exam-release-section">
                  <div class="exam-release-section__header">
                    <span class="admin-eyebrow">Access Window</span>
                    <p>Start and end time control when students are allowed to start a new attempt.</p>
                  </div>
                  <div class="modal-form-grid">
                    <label class="form-field">
                      <span class="form-label">Start Time</span>
                      <span class="datetime-picker-field">
                        <input
                          ref="examStartTimeInput"
                          v-model="examForm.startTime"
                          class="form-input datetime-picker-field__input"
                          type="datetime-local"
                          title="Select start date and time"
                          aria-label="Start time"
                          @click="openDateTimePicker($event.currentTarget)"
                        />
                        <button
                          class="datetime-picker-field__button"
                          type="button"
                          title="Open start time picker"
                          aria-label="Open start time picker"
                          @click.prevent="openDateTimePicker(examStartTimeInput)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 3v3M17 3v3M4.5 9.5h15M6.5 5.5h11A2.5 2.5 0 0 1 20 8v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18V8a2.5 2.5 0 0 1 2.5-2.5Z" />
                          </svg>
                        </button>
                      </span>
                    </label>
                    <label class="form-field">
                      <span class="form-label">End Time</span>
                      <span class="datetime-picker-field">
                        <input
                          ref="examEndTimeInput"
                          v-model="examForm.endTime"
                          class="form-input datetime-picker-field__input"
                          type="datetime-local"
                          title="Select end date and time"
                          aria-label="End time"
                          @click="openDateTimePicker($event.currentTarget)"
                        />
                        <button
                          class="datetime-picker-field__button"
                          type="button"
                          title="Open end time picker"
                          aria-label="Open end time picker"
                          @click.prevent="openDateTimePicker(examEndTimeInput)"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 3v3M17 3v3M4.5 9.5h15M6.5 5.5h11A2.5 2.5 0 0 1 20 8v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18V8a2.5 2.5 0 0 1 2.5-2.5Z" />
                          </svg>
                        </button>
                      </span>
                    </label>
                  </div>
                </section>

                <section class="exam-release-section">
                  <div class="exam-release-section__header">
                    <span class="admin-eyebrow">Attempt Settings</span>
                    <p>Attempt duration is the countdown for each student after the attempt starts.</p>
                  </div>
                  <div class="modal-form-grid">
                    <label class="form-field">
                      <span class="form-label">Attempt Duration (minutes)</span>
                      <input v-model.number="examForm.duration" class="form-input" type="number" min="1" />
                    </label>
                  </div>
                </section>

                <section class="exam-release-section">
                  <div class="exam-release-section__header">
                    <span class="admin-eyebrow">Audience</span>
                    <p>Decide who can see this release after it is published.</p>
                  </div>
                  <div class="exam-target-toggle" role="radiogroup" aria-label="Exam audience">
                    <label v-if="!isTeacherPortal" :class="{ 'exam-target-option--active': examForm.targetType === 'ALL_STUDENTS' }" class="exam-target-option">
                      <input v-model="examForm.targetType" type="radio" value="ALL_STUDENTS" />
                      <span>All students</span>
                      <small>Available to every student account.</small>
                    </label>
                    <label :class="{ 'exam-target-option--active': examForm.targetType === 'SPECIFIC_CLASSES' }" class="exam-target-option">
                      <input v-model="examForm.targetType" type="radio" value="SPECIFIC_CLASSES" />
                      <span>Specific classes</span>
                      <small>{{ isTeacherPortal ? 'Only classes assigned to you are available.' : 'Choose one or more classes below.' }}</small>
                    </label>
                  </div>

                  <div v-if="examForm.targetType === 'SPECIFIC_CLASSES'" class="exam-class-picker">
                    <div class="exam-class-picker__header">
                      <span class="form-label">Classes</span>
                      <small>{{ selectedExamTargetClasses.length }} selected</small>
                    </div>
                    <input
                      v-model="examClassFilters.keyword"
                      class="form-input exam-class-search"
                      placeholder="Search class, teacher, grade"
                    />
                    <div v-if="filteredExamTargetClasses.length > 0" class="exam-class-picker__grid">
                      <label
                        v-for="item in filteredExamTargetClasses"
                        :key="item.classId"
                        class="exam-class-option"
                        :class="{ 'exam-class-option--selected': examForm.targetClassIds.map(String).includes(String(item.classId)) }"
                      >
                        <input v-model="examForm.targetClassIds" type="checkbox" :value="item.classId" />
                        <span class="exam-class-option__main">
                            <strong>{{ item.className }}</strong>
                            <small>{{ item.studentCount || 0 }} students · {{ item.teacherName || '-' }}</small>
                        </span>
                      </label>
                    </div>
                    <p v-if="assignableExamClasses.length > 0 && filteredExamTargetClasses.length === 0" class="form-hint">
                      No classes match the current search.
                    </p>
                    <p v-else-if="assignableExamClasses.length === 0" class="form-hint">Activate a class before creating an exam for specific classes.</p>
                  </div>
                </section>

                <section class="exam-release-section">
                  <div class="exam-release-section__header">
                    <span class="admin-eyebrow">Options</span>
                    <p>Use the standard exam behavior unless you need an exception.</p>
                  </div>
                  <div class="exam-option-list">
                    <label class="exam-option-line">
                      <input v-model="examForm.autoSubmit" type="checkbox" />
                      <span>
                        <strong>Auto-submit when time expires</strong>
                        <small>Prevents unfinished attempts from staying open after the timer ends.</small>
                      </span>
                    </label>
                    <label class="exam-option-line">
                      <input v-model="examForm.allowReview" type="checkbox" />
                      <span>
                        <strong>Allow review</strong>
                        <small>Students can review according to the score and answer visibility settings.</small>
                      </span>
                    </label>
                  </div>
                </section>
              </div>
              <p v-if="errors.examForm" class="error-text">{{ errors.examForm }}</p>

              <footer class="modal-card__footer">
                <AppButton
                  variant="secondary"
                  type="button"
                  :disabled="loading.submittingExam || loading.checkingExamPaperStats"
                  @click="closeExamReleaseModal"
                >
                  Cancel
                </AppButton>
                <AppButton type="submit" :disabled="loading.submittingExam || loading.checkingExamPaperStats">
                  {{ loading.checkingExamPaperStats ? 'Checking paper...' : (loading.submittingExam ? 'Creating...' : 'Create Release') }}
                </AppButton>
              </footer>
            </form>
          </div>
        </Teleport>

        <Teleport to="body">
          <div
            v-if="createExamStructureConfirm.open && createExamStructureConfirm.stats"
            class="modal-backdrop"
            @click.self="closeCreateExamStructureConfirm"
          >
            <section
              class="modal-card publish-confirm-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="create-exam-structure-confirm-title"
            >
              <header class="modal-card__header">
                <div>
                  <span class="admin-eyebrow">Structure Warning</span>
                  <h3 id="create-exam-structure-confirm-title">Create this exam release?</h3>
                  <p>Review the selected paper structure before creating the release.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close create exam structure warning"
                  :disabled="loading.submittingExam"
                  @click="closeCreateExamStructureConfirm"
                >
                  &times;
                </button>
              </header>

              <div class="publish-structure-warning" role="alert">
                <strong>This paper does not match the official 100-question SHSAT structure.</strong>
                <dl class="publish-structure-warning__counts">
                  <div>
                    <dt>Total Questions</dt>
                    <dd>{{ createExamStructureConfirm.stats.total }}</dd>
                  </div>
                  <div>
                    <dt>ELA Scored Questions</dt>
                    <dd>{{ createExamStructureConfirm.stats.ela }}</dd>
                  </div>
                  <div>
                    <dt>MATH Scored Questions</dt>
                    <dd>{{ createExamStructureConfirm.stats.math }}</dd>
                  </div>
                </dl>
                <p>Click Create Release to continue anyway, or cancel to return to the form without creating a release.</p>
              </div>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" :disabled="loading.submittingExam" @click="closeCreateExamStructureConfirm">
                  Cancel
                </AppButton>
                <AppButton type="button" :disabled="loading.submittingExam" @click="confirmCreateExamStructureRisk">
                  {{ loading.submittingExam ? 'Creating...' : 'Create Release' }}
                </AppButton>
              </footer>
            </section>
          </div>
        </Teleport>
      </AdminSection>

      <AdminSection v-show="activeTab === 'wrong-answer-tasks'">
        <AppCard title="Review Assignments" subtitle="Create and track assignments for wrong and unanswered questions.">
          <div class="admin-toolbar wrong-task-toolbar">
            <div class="admin-toolbar__filters">
              <input
                v-model="wrongAnswerTaskFilters.keyword"
                class="form-input wrong-task-search"
                placeholder="Search assignment, exam, or class"
                aria-label="Search review assignments"
              />
              <select v-model="wrongAnswerTaskFilters.examId" class="form-input form-input--compact" aria-label="Filter tasks by exam">
                <option value="">All exams</option>
                <option v-for="exam in exams" :key="exam.examId" :value="String(exam.examId)">
                  {{ exam.examTitle }}
                </option>
              </select>
              <select v-model="wrongAnswerTaskFilters.classId" class="form-input form-input--compact" aria-label="Filter tasks by class">
                <option value="">All classes</option>
                <option v-for="classRoom in classes" :key="classRoom.classId" :value="String(classRoom.classId)">
                  {{ classRoom.className }}
                </option>
              </select>
            </div>
            <div class="admin-toolbar__actions">
              <AppButton variant="secondary" :disabled="wrongAnswerTaskLoading" @click="loadWrongAnswerTasks">
                {{ wrongAnswerTaskLoading ? 'Loading...' : 'Refresh' }}
              </AppButton>
              <AppButton :disabled="!exams.length || !classes.length" @click="openWrongAnswerTaskModal">
                Create Assignment
              </AppButton>
            </div>
          </div>

          <div v-if="wrongAnswerTaskLoading" class="admin-state">Loading review assignments...</div>
          <div v-else-if="wrongAnswerTaskError" class="admin-state admin-state--error">
            <p>{{ wrongAnswerTaskError }}</p>
            <AppButton variant="secondary" @click="loadWrongAnswerTasks">Retry</AppButton>
          </div>
          <div v-else-if="filteredWrongAnswerTasks.length === 0" class="admin-state">
            {{ wrongAnswerTasks.length ? 'No assignments match these filters.' : 'No review assignments have been created yet.' }}
          </div>
          <div v-else class="table-wrap">
            <AdminDataTable class="wrong-task-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Exam</th>
                  <th>Class</th>
                  <th>Published</th>
                  <th>Availability Window</th>
                  <th>Completion</th>
                  <th>Assignment Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="task in filteredWrongAnswerTasks" :key="task.taskId">
                  <td>
                    <strong>{{ task.title }}</strong>
                    <small v-if="task.description">{{ task.description }}</small>
                  </td>
                  <td>{{ task.examTitle || `Exam #${task.examId}` }}</td>
                  <td>{{ task.className || `Class #${task.classId}` }}</td>
                  <td>{{ formatDateTime(task.createdAt) }}</td>
                  <td>{{ task.startAt ? formatDateTime(task.startAt) : 'Available now' }} - {{ formatDateTime(task.endAt) }}</td>
                  <td>
                    <strong>{{ task.completedCount || 0 }} / {{ task.eligibleCount || 0 }}</strong>
                    <small>completed / eligible</small>
                  </td>
                  <td>
                    <small>{{ task.inProgressCount || 0 }} in progress</small>
                    <small>{{ task.notStartedCount || 0 }} not started</small>
                    <small v-if="task.retryRequiredCount">{{ task.retryRequiredCount }} need more practice</small>
                    <small v-if="task.endedCount">{{ task.endedCount }} ended with questions left</small>
                    <small v-if="task.noSourceAttemptCount">{{ task.noSourceAttemptCount }} without source attempt</small>
                    <small v-if="task.noWrongAnswerCount">{{ task.noWrongAnswerCount }} with no review questions</small>
                  </td>
                  <td class="wrong-task-table__actions-cell">
                    <ResponsiveActionGroup :actions="getWrongAnswerTaskActions(task)" :label="`Actions for ${task.title}`" />
                  </td>
                </tr>
              </tbody>
            </AdminDataTable>
          </div>
        </AppCard>

        <Teleport to="body">
          <div v-if="wrongAnswerTaskModalOpen" class="modal-backdrop" @click.self="closeWrongAnswerTaskModal">
            <form class="modal-card wrong-task-modal" novalidate @submit.prevent="publishWrongAnswerTask">
              <header class="modal-card__header">
                <div>
                  <span class="admin-eyebrow">Class Assignment</span>
                  <h3>Create Review Assignment</h3>
                  <p>Each student receives incorrect and unanswered questions from their latest formal attempt.</p>
                </div>
                <button class="modal-card__close" type="button" aria-label="Close task dialog" @click="closeWrongAnswerTaskModal">
                  &times;
                </button>
              </header>
              <div class="modal-form-grid">
                <label class="form-field">
                  <span class="form-label">Exam</span>
                  <RichSelect
                    v-model="wrongAnswerTaskForm.examId"
                    class="wrong-task-exam-select"
                    :options="wrongAnswerTaskExamOptions"
                    placeholder="Select an exam"
                    aria-label="Exam"
                    @change="updateWrongAnswerTaskTitle"
                  />
                </label>
                <label class="form-field">
                  <span class="form-label">Class</span>
                  <select v-model="wrongAnswerTaskForm.classId" class="form-input">
                    <option value="" disabled>Select a class</option>
                    <option v-for="classRoom in classes" :key="classRoom.classId" :value="String(classRoom.classId)">
                      {{ classRoom.className }}
                    </option>
                  </select>
                </label>
                <label class="form-field form-field--wide">
                  <span class="form-label">Assignment Title</span>
                  <input v-model="wrongAnswerTaskForm.title" class="form-input" maxlength="200" required />
                </label>
                <label class="form-field form-field--wide">
                  <span class="form-label">Description <small>(optional)</small></span>
                  <textarea v-model="wrongAnswerTaskForm.description" class="form-input" rows="3" maxlength="1000"></textarea>
                </label>
                <label class="form-field">
                  <span class="form-label">Start Time</span>
                  <span class="datetime-picker-field">
                    <input
                      ref="wrongAnswerTaskStartAtInput"
                      v-model="wrongAnswerTaskForm.startAt"
                      class="form-input datetime-picker-field__input"
                      type="datetime-local"
                      title="Select start date and time"
                      aria-label="Start time"
                      @click="openDateTimePicker($event.currentTarget)"
                    />
                    <button
                      class="datetime-picker-field__button"
                      type="button"
                      title="Open start time picker"
                      aria-label="Open start time picker"
                      @click.prevent="openDateTimePicker(wrongAnswerTaskStartAtInput)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 3v3M17 3v3M4.5 9.5h15M6.5 5.5h11A2.5 2.5 0 0 1 20 8v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18V8a2.5 2.5 0 0 1 2.5-2.5Z" />
                      </svg>
                    </button>
                  </span>
                </label>
                <label class="form-field">
                  <span class="form-label">End Time</span>
                  <span class="datetime-picker-field">
                    <input
                      ref="wrongAnswerTaskEndAtInput"
                      v-model="wrongAnswerTaskForm.endAt"
                      class="form-input datetime-picker-field__input"
                      type="datetime-local"
                      title="Select end date and time"
                      aria-label="End time"
                      @input="wrongAnswerTaskFormError = ''"
                      @click="openDateTimePicker($event.currentTarget)"
                    />
                    <button
                      class="datetime-picker-field__button"
                      type="button"
                      title="Open end time picker"
                      aria-label="Open end time picker"
                      @click.prevent="openDateTimePicker(wrongAnswerTaskEndAtInput)"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 3v3M17 3v3M4.5 9.5h15M6.5 5.5h11A2.5 2.5 0 0 1 20 8v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18V8a2.5 2.5 0 0 1 2.5-2.5Z" />
                      </svg>
                    </button>
                  </span>
                </label>
              </div>
              <p v-if="wrongAnswerTaskFormError" class="error-text">{{ wrongAnswerTaskFormError }}</p>
              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" :disabled="wrongAnswerTaskSubmitting" @click="closeWrongAnswerTaskModal">Cancel</AppButton>
                <AppButton type="submit" :disabled="wrongAnswerTaskSubmitting || !exams.length || !classes.length">
                  {{ wrongAnswerTaskSubmitting ? 'Creating...' : 'Create Assignment' }}
                </AppButton>
              </footer>
            </form>
          </div>
        </Teleport>
      </AdminSection>

      <AdminSection v-show="activeTab === 'classes'">
        <AppCard title="Classes" subtitle="Open a class to manage students and review class-level exam results.">
            <div class="admin-toolbar">
              <div class="admin-toolbar__filters">
                <input v-model="classFilters.keyword" class="form-input class-search-input" placeholder="Search class, teacher, grade" />
              </div>
              <div class="admin-toolbar__actions">
                <AppButton @click="openClassModal">Create Class</AppButton>
                  <button
                    class="admin-refresh-button"
                    :class="{ 'admin-refresh-button--loading': loading.classes }"
                    type="button"
                    :disabled="loading.classes"
                    aria-label="Refresh classes"
                    title="Refresh classes"
                    @click="loadClasses"
                  >
                    <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" />
                    </svg>
                  </button>
              </div>
            </div>

            <div v-if="loading.classes" class="admin-state">Loading classes...</div>
            <div v-else-if="errors.classes" class="admin-state admin-state--error">{{ errors.classes }}</div>
            <div v-else-if="visibleClasses.length === 0" class="admin-state">No classes found.</div>
              <div v-else class="class-grid" :class="{ 'class-grid--reorderable': canReorderClasses }">
                <article
                  v-for="item in visibleClasses"
                  :key="item.classId"
                  class="class-card"
                  :class="{
                    'class-card--draggable': canReorderClasses,
                    'class-card--dragging': draggingClassId === String(item.classId),
                  }"
                  role="button"
                  tabindex="0"
                  :draggable="canReorderClasses"
                  @click="openClassCard(item)"
                  @keydown="handleClassCardKeydown(item, $event)"
                  @dragstart="startClassDrag(item, $event)"
                  @dragover="dragOverClass(item, $event)"
                  @drop="dropClass(item, $event)"
                  @dragend="finishClassDrag"
                >
                  <div class="class-card__header">
                    <div>
                      <span class="admin-eyebrow">Class #{{ item.classId }}</span>
                      <h3>{{ item.className }}</h3>
                    </div>
                    <div class="class-card__actions">
                      <span class="status-pill" :class="{ 'status-pill--on': getClassActiveState(item) }">
                        {{ getClassActiveState(item) ? 'Active' : 'Inactive' }}
                      </span>
                      <button
                        v-if="canDeleteClass(item)"
                        class="class-card__delete"
                        type="button"
                        :disabled="Boolean(loading.deletingClassId)"
                        title="Delete empty class"
                        @click.stop="openDeleteClassConfirm(item)"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p>{{ item.classDescription || 'No description' }}</p>
                  <dl class="class-card__meta">
                    <div>
                      <dt>Students</dt>
                      <dd>{{ getClassStudentCount(item) }}</dd>
                    </div>
                    <div>
                      <dt>Exams</dt>
                      <dd>{{ item.examCount || item.participatedExamCount || 0 }}</dd>
                    </div>
                    <div>
                      <dt>Average</dt>
                      <dd>{{ formatNumber(getClassAverage(item)) }}</dd>
                    </div>
                    <div>
                      <dt>Teacher</dt>
                      <dd>{{ item.teacherName || '-' }}</dd>
                    </div>
                  </dl>
                </article>
              </div>
          </AppCard>

          <AppCard class="unassigned-students-card" title="Unassigned Students" subtitle="Select students, then add them to a class in one step.">
            <template #actions>
              <AppButton
                variant="primary"
                :disabled="selectedUnassignedStudents.length === 0 || assignableClasses.length === 0 || bulkAssigning"
                @click="openBulkAssignModal"
              >
                Assign selected <span v-if="selectedUnassignedStudents.length">({{ selectedUnassignedStudents.length }})</span>
              </AppButton>
              <button
                class="collapse-arrow-button"
                type="button"
                :aria-expanded="!unassignedStudentsCollapsed"
                :title="unassignedStudentsCollapsed ? 'Expand unassigned students' : 'Collapse unassigned students'"
                @click="unassignedStudentsCollapsed = !unassignedStudentsCollapsed"
              >
                <svg
                  class="collapse-arrow-button__icon"
                  :class="{ 'collapse-arrow-button__icon--collapsed': unassignedStudentsCollapsed }"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </template>
            <template v-if="!unassignedStudentsCollapsed">
              <div class="admin-toolbar">
                <p class="form-hint">{{ selectedUnassignedStudents.length }} selected · {{ unassignedStudents.length }} unassigned students</p>
                <button
                  class="admin-refresh-button"
                  :class="{ 'admin-refresh-button--loading': loading.unassignedStudents }"
                  type="button"
                  :disabled="loading.unassignedStudents"
                  aria-label="Refresh unassigned students"
                  title="Refresh unassigned students"
                  @click="loadUnassignedStudents"
                >
                  <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" />
                  </svg>
                  </button>
              </div>

              <div v-if="loading.unassignedStudents" class="admin-state">Loading unassigned students...</div>
              <div v-else-if="errors.unassignedStudents" class="admin-state admin-state--error">{{ errors.unassignedStudents }}</div>
              <div v-else-if="unassignedStudents.length === 0" class="admin-state">No unassigned student accounts.</div>
              <div v-else class="table-wrap unassigned-students-scroll">
                <AdminDataTable class="unassigned-students-table">
                  <thead>
                    <tr>
                      <th class="unassigned-students-select-column">
                        <input
                          type="checkbox"
                          aria-label="Select all unassigned students"
                          :checked="allUnassignedStudentsSelected"
                          :indeterminate="selectedUnassignedStudents.length > 0 && !allUnassignedStudentsSelected"
                          @change="toggleAllUnassignedStudents($event.target.checked)"
                        />
                      </th>
                      <th>Name</th>
                      <th class="unassigned-students-secondary-column">Username</th>
                      <th class="unassigned-students-secondary-column">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="student in unassignedStudents" :key="student.userId || student.id">
                      <td class="unassigned-students-select-column">
                        <input
                          type="checkbox"
                          :aria-label="`Select ${student.realName || student.username}`"
                          :checked="selectedUnassignedStudentIds.includes(getUnassignedStudentId(student))"
                          @change="toggleUnassignedStudent(student, $event.target.checked)"
                        />
                      </td>
                      <td>{{ student.realName }}</td>
                      <td class="unassigned-students-secondary-column">{{ student.username }}</td>
                      <td class="unassigned-students-secondary-column">{{ student.email || '-' }}</td>
                    </tr>
                  </tbody>
                </AdminDataTable>
              </div>
            </template>
        </AppCard>

        <Teleport to="body">
          <div v-if="showBulkAssignModal" class="modal-backdrop" @click.self="closeBulkAssignModal">
            <form class="modal-card bulk-assign-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-assign-title" novalidate @submit.prevent="submitBulkAssign">
              <header class="modal-card__header">
                <div>
                  <h3 id="bulk-assign-title">Assign Students to a Class</h3>
                  <p>Choose one class for all selected students.</p>
                </div>
                <button class="modal-card__close" type="button" aria-label="Close assign students dialog" @click="closeBulkAssignModal">&times;</button>
              </header>
              <label class="form-field">
                <span class="form-label">Class</span>
                <select v-model="bulkAssignClassId" class="form-input" required :disabled="bulkAssigning">
                  <option value="">Select a class</option>
                  <option v-for="item in assignableClasses" :key="item.classId" :value="String(item.classId)">
                    {{ item.className }}
                  </option>
                </select>
              </label>
              <div class="bulk-assign-summary">
                <strong>{{ selectedUnassignedStudents.length }} students selected</strong>
                <span>{{ selectedUnassignedStudents.slice(0, 5).map((student) => student.realName || student.username).join(', ') }}<template v-if="selectedUnassignedStudents.length > 5"> and {{ selectedUnassignedStudents.length - 5 }} more</template></span>
              </div>
              <p v-if="bulkAssignError" class="bulk-assign-error" role="alert">{{ bulkAssignError }}</p>
              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" :disabled="bulkAssigning" @click="closeBulkAssignModal">Cancel</AppButton>
                <AppButton type="submit" :disabled="!bulkAssignClassId || selectedUnassignedStudents.length === 0 || bulkAssigning">
                  {{ bulkAssigning ? 'Assigning...' : 'Assign Students' }}
                </AppButton>
              </footer>
            </form>
          </div>
        </Teleport>

        <!-- Class create/edit modal. -->
        <Teleport to="body">
          <div v-if="showClassModal" class="modal-backdrop" @click.self="closeClassModal">
            <form class="modal-card modal-card--wide" novalidate @submit.prevent="submitClass">
              <header class="modal-card__header">
                <div>
                  <h3>{{ editingClassId ? 'Edit Class' : 'Create Class' }}</h3>
                  <p>Add a class, then open its detail page to manage students and results.</p>
                </div>
                <button
                  class="modal-card__close"
                  type="button"
                  aria-label="Close class dialog"
                  @click="closeClassModal"
                >
                  &times;
                </button>
              </header>

              <div class="modal-form-grid">
                <label class="form-field">
                  <span class="form-label">Class Name</span>
                  <input v-model="classForm.className" class="form-input" placeholder="e.g. Grade 8 Class A" />
                </label>
                <label class="form-field">
                  <span class="form-label">Teacher</span>
                  <input v-model="classForm.teacherName" class="form-input" placeholder="Optional" />
                </label>
                <label class="form-field">
                  <span class="form-label">Teacher Email</span>
                  <input v-model="classForm.teacherEmail" class="form-input" placeholder="Optional" />
                </label>
                <label class="form-field">
                  <span class="form-label">Grade</span>
                  <input v-model="classForm.gradeLevel" class="form-input" placeholder="e.g. Grade 8" />
                </label>
                <label class="form-field">
                  <span class="form-label">Academic Year</span>
                  <input v-model="classForm.academicYear" class="form-input" placeholder="e.g. 2025-2026" />
                </label>
                <label class="form-field form-field--wide">
                  <span class="form-label">Description</span>
                  <textarea v-model="classForm.classDescription" class="form-input" rows="3"></textarea>
                </label>
                <label class="check-line"><input v-model="classForm.active" type="checkbox" /> Active class</label>
              </div>

              <p v-if="errors.classForm" class="error-text">{{ errors.classForm }}</p>
              <p v-if="notices.classForm" class="success-text">{{ notices.classForm }}</p>

              <footer class="modal-card__footer">
                <AppButton variant="secondary" type="button" @click="closeClassModal">Cancel</AppButton>
                <AppButton type="submit" :disabled="loading.submittingClass">
                  {{ loading.submittingClass ? 'Saving...' : (editingClassId ? 'Save Changes' : 'Create Class') }}
                </AppButton>
              </footer>
            </form>
          </div>
        </Teleport>

          <Teleport to="body">
            <div v-if="selectedDeleteClass" class="modal-backdrop" @click.self="closeDeleteClassConfirm">
              <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-class-confirm-title">
                <header class="modal-card__header">
                  <div>
                    <h3 id="delete-class-confirm-title">Delete empty class?</h3>
                    <p>This permanently deletes the class and removes its release targeting. Exams, student accounts, and attempt records remain.</p>
                  </div>
                  <button
                    class="modal-card__close"
                    type="button"
                    aria-label="Close delete class confirmation"
                    @click="closeDeleteClassConfirm"
                  >
                    &times;
                  </button>
                </header>
                <div class="publish-confirm-summary">
                  <span class="admin-eyebrow">Class</span>
                  <strong>{{ selectedDeleteClass.className }}</strong>
                  <small>{{ getClassStudentCount(selectedDeleteClass) }} students</small>
                </div>
                <p class="publish-confirm-note publish-confirm-note--danger">
                  Only classes without students can be deleted. This cannot be undone.
                </p>
                <p v-if="deleteClassError" class="error-text" role="alert">{{ deleteClassError }}</p>
                <footer class="modal-card__footer">
                  <AppButton variant="secondary" type="button" :disabled="Boolean(loading.deletingClassId)" @click="closeDeleteClassConfirm">Cancel</AppButton>
                  <AppButton type="button" :disabled="Boolean(loading.deletingClassId)" @click="confirmDeleteClass">
                    {{ loading.deletingClassId ? 'Deleting...' : 'Delete Class' }}
                  </AppButton>
                </footer>
              </section>
            </div>
          </Teleport>

      </AdminSection>

      </AdminTabPanels>
    </section>
  </AdminLayout>
</template>

<style scoped>
.admin-home {
  display: grid;
  min-width: 0;
  gap: 24px;
}

.available-exams-card,
.dashboard-review-card,
.exam-releases-card,
.exam-history-card,
.unassigned-students-card {
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.exam-history-card {
  margin-top: 16px;
}

.dashboard-review-card {
  margin-top: 16px;
}

.available-exams-card > .admin-refresh-button {
  position: absolute;
  top: 22px;
  right: calc(clamp(20px, 3vw, 28px) + 42px);
}

.available-exams-card > .collapse-arrow-button,
.dashboard-review-card > .collapse-arrow-button {
  position: absolute;
  top: 22px;
  right: clamp(20px, 3vw, 28px);
}

.dashboard-review-card > .dashboard-review-refresh-button {
  position: absolute;
  top: 22px;
  right: calc(clamp(20px, 3vw, 28px) + 42px);
}

.card-top-actions {
  position: absolute;
  top: 22px;
  right: clamp(20px, 3vw, 28px);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.card-top-actions__primary {
  min-height: 34px;
  padding: 0 14px;
  font-size: 13px;
}

.admin-refresh-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  cursor: pointer;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.admin-refresh-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.14);
}

.admin-refresh-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.admin-refresh-button__icon {
  width: 17px;
  height: 17px;
}

.admin-refresh-button--loading .admin-refresh-button__icon {
  animation: admin-refresh-spin 900ms linear infinite;
}

@keyframes admin-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}


.admin-columns {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.4fr);
  gap: 20px;
}

.action-row,
.check-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
}

.wrong-task-search {
  min-width: 220px;
}

.wrong-task-table {
  min-width: 1120px;
}

.wrong-task-table__actions-cell { min-width: 190px; }

.class-search-input {
  width: min(360px, 100%);
  min-width: 220px;
}

.admin-toolbar__message {
  margin: -4px 0 14px;
}

.release-toolbar {
  align-items: center;
}

.release-search-input {
  width: 240px;
  min-width: 220px;
}

.admin-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.admin-form--single {
  grid-template-columns: 1fr;
}

.form-field--wide {
  grid-column: 1 / -1;
}

.form-readonly-value {
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  color: var(--color-text);
  background: #f8fafc;
  font-weight: 700;
}

.form-label--with-help {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.field-help {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: 1px solid #c7d4e8;
  border-radius: 999px;
  color: #64748b;
  background: #f8fbff;
  font-size: 10px;
  font-weight: 800;
  cursor: help;
}

.field-help::after {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 20;
  width: max-content;
  max-width: 220px;
  border-radius: 8px;
  padding: 7px 9px;
  color: #ffffff;
  background: #1f2937;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
  content: attr(data-tooltip);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 4px);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.field-help:hover::after,
.field-help:focus::after {
  opacity: 1;
  transform: translate(-50%, 0);
}

.form-hint,
.success-text {
  margin: 0;
  color: var(--color-success);
  font-size: 14px;
}

.form-hint {
  color: var(--color-muted);
}

.paper-structure-note {
  display: grid;
  gap: 4px;
  border: 1px solid #cfe0ff;
  border-radius: var(--radius-md);
  padding: 12px 14px;
  color: #33415c;
  background: #f5f8ff;
  font-size: 13px;
}

.paper-structure-note strong {
  color: var(--color-primary-strong);
  font-size: 14px;
}

.action-toast {
  position: fixed;
  top: 76px;
  right: 24px;
  z-index: 1200;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: min(360px, calc(100vw - 32px));
  border: 1px solid #cfe0ff;
  border-radius: 16px;
  padding: 14px 14px 14px 16px;
  color: #172033;
  background: #ffffff;
  box-shadow: 0 18px 45px rgba(18, 36, 64, 0.16);
}

.action-toast strong {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
}

.action-toast p {
  margin: 0;
  color: #5c6b82;
  font-size: 13px;
  line-height: 1.45;
}

.action-toast button {
  margin-left: auto;
  border: 0;
  border-radius: 999px;
  width: 24px;
  height: 24px;
  color: #64748b;
  background: #f4f7fb;
  cursor: pointer;
}

.action-toast--success {
  border-color: #bbf7d0;
}

.action-toast--warning {
  border-color: #fed7aa;
}

.action-toast--error {
  border-color: #fecaca;
}

@media (max-width: 600px) {
  .action-toast {
    top: auto;
    right: 12px;
    bottom: 12px;
    width: min(360px, calc(100vw - 24px));
  }

  .exam-releases-card > .card-top-actions,
  .exam-history-card > .card-top-actions {
    position: static;
    width: 100%;
    justify-content: flex-end;
    margin: -4px 0 12px;
  }
}

.check-row,
.check-line {
  color: var(--color-muted);
  font-size: 14px;
}

.check-row {
  grid-column: 1 / -1;
}

.admin-state {
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: 18px;
  color: var(--color-muted);
  background: var(--color-surface-soft);
}

.admin-state--error {
  color: var(--color-danger);
  background: #fff5f6;
}

.dashboard-review-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  align-items: stretch;
  gap: 16px;
  min-width: 0;
}

.dashboard-review-task {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 250px;
  gap: 12px;
  border: 1px solid #d9e6f7;
  border-radius: var(--radius-md);
  padding: 18px;
  background: linear-gradient(145deg, #ffffff, #f7faff);
  box-shadow: 0 10px 24px rgba(31, 75, 135, 0.06);
}

.dashboard-review-task__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.dashboard-review-task__heading {
  min-width: 0;
}

.dashboard-review-task__eyebrow {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.dashboard-review-task__header h3 {
  display: -webkit-box;
  min-width: 0;
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 18px;
  line-height: 1.25;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.dashboard-review-task__status {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 4px 9px;
  color: #16794c;
  background: #e8f7f1;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.dashboard-review-task__status--ended {
  color: var(--color-muted);
  background: var(--color-surface-muted, #eef2f8);
}

.dashboard-review-task__exam {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.dashboard-review-task__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: auto 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
}

.dashboard-review-task__details div {
  min-width: 0;
}

.dashboard-review-task__details dt {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
}

.dashboard-review-task__details dd {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 800;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.dashboard-review-task__availability {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.45;
}

.dashboard-review-task__action {
  width: 100%;
  margin-top: auto;
}

.collapsible-card-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--color-muted);
  font-size: 13px;
}

.class-exams-card {
  position: relative;
}

.class-exams-card .collapse-arrow-button {
  position: absolute;
  top: 22px;
  right: clamp(20px, 3vw, 28px);
}

.collapse-arrow-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  cursor: pointer;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.collapse-arrow-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.14);
}

.collapse-arrow-button__icon {
  width: 18px;
  height: 18px;
  transition: transform 160ms ease;
}

.collapse-arrow-button__icon--collapsed {
  transform: rotate(180deg);
}

.admin-eyebrow {
  display: inline-block;
  margin-bottom: 6px;
  color: var(--color-primary-strong);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.paper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.paper-card,
.detail-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 18px;
  background: #ffffff;
}

.paper-card {
  display: grid;
  gap: 16px;
}

.paper-card--active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(47, 111, 237, 0.1);
}

.paper-card h3,
.detail-panel h3 {
  margin: 0;
}

.paper-card p,
.detail-panel p {
  margin: 8px 0 0;
  color: var(--color-muted);
}

.class-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
  align-content: start;
  max-height: min(70vh, 720px);
  overflow-y: auto;
  padding-right: 6px;
  overscroll-behavior: contain;
}

.class-grid::-webkit-scrollbar {
  width: 10px;
}

.class-grid::-webkit-scrollbar-track {
  border-radius: 999px;
  background: #f3f6fb;
}

.class-grid::-webkit-scrollbar-thumb {
  border: 2px solid #f3f6fb;
  border-radius: 999px;
  background: #c8d4e6;
}

.class-grid::-webkit-scrollbar-thumb:hover {
  background: #aebcd2;
}

.class-grid--reorderable .class-card {
  cursor: grab;
}

.class-card {
  display: grid;
  gap: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 16px;
  color: var(--color-text);
  text-align: left;
  background: #ffffff;
  cursor: pointer;
  box-shadow: 0 10px 26px rgba(31, 75, 135, 0.06);
  transition:
    transform 140ms ease,
    box-shadow 140ms ease,
    border-color 140ms ease,
    background 140ms ease,
    opacity 140ms ease;
}

.class-card:hover {
  border-color: var(--color-primary);
  background: #fbfdff;
}

.class-card:focus-visible {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(47, 111, 237, 0.1);
}

.class-card--draggable:active {
  cursor: grabbing;
}

.class-card--dragging {
  opacity: 0.55;
  transform: scale(0.985);
  box-shadow: 0 6px 18px rgba(31, 75, 135, 0.08);
}

.class-card__header,
.class-exam-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.class-card__header { flex-wrap: wrap; }
.class-card__header > div:first-child { min-width: 0; flex: 1 1 120px; }

.class-card__actions {
  display: inline-flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.class-card__delete {
  border: 1px solid #fecaca;
  border-radius: 999px;
  padding: 5px 10px;
  color: #b42318;
  font-size: 14px;
  font-weight: 700;
  background: #fff5f5;
  cursor: pointer;
}

.class-card__delete:hover:not(:disabled) {
  border-color: #fca5a5;
  background: #fee2e2;
}

.class-card__delete:disabled {
  color: #94a3b8;
  border-color: #dbe4f0;
  background: #f8fafc;
  cursor: not-allowed;
}

.class-card h3,
.class-card p {
  margin: 0;
}

.class-card p {
  color: var(--color-muted);
}

.class-card__meta,
.result-summary {
  display: grid;
  gap: 10px;
  margin: 0;
}

.class-card__meta {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.class-card__meta div,
.result-summary div {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 10px 12px;
  background: #fbfdff;
}

.class-card__meta dt,
.result-summary span {
  color: var(--color-muted);
  font-size: 13px;
}

.class-card__meta dd,
.result-summary strong {
  margin: 3px 0 0;
  font-weight: 700;
}

.class-back-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 34px;
  width: auto;
  height: 34px;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  padding: 0 12px 0 9px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease;
}

.class-back-button:hover {
  transform: translateX(-1px);
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.14);
}

.class-back-button svg {
  width: 20px;
  height: 20px;
}

.class-detail-hero {
  display: grid;
  gap: 16px;
  border: 1px solid #cfe0ff;
  border-radius: 18px;
  padding: 18px;
  background:
    linear-gradient(135deg, rgba(47, 111, 237, 0.08), rgba(255, 255, 255, 0) 42%),
    #ffffff;
  box-shadow: 0 14px 34px rgba(31, 75, 135, 0.08);
}

.class-detail-hero__top,
.class-detail-hero__main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.class-detail-hero__main {
  align-items: center;
}

.class-detail-hero h2,
.class-detail-hero p {
  margin: 0;
}

.class-detail-hero h2 {
  margin-top: 4px;
  color: var(--color-text);
  font-size: 26px;
  line-height: 1.15;
}

.class-detail-hero p {
  margin-top: 8px;
  max-width: 720px;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.45;
}

.class-detail-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.class-detail-summary div {
  border: 1px solid var(--color-border);
  border-radius: 13px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.78);
}

.class-detail-summary dt {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.class-detail-summary dd {
  margin: 3px 0 0;
  color: var(--color-text);
  font-weight: 800;
}

.class-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.8fr);
  gap: 20px;
}

.class-exam-list {
  display: grid;
  gap: 10px;
}

.class-exam-card {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  color: var(--color-text);
  text-align: left;
  background: #ffffff;
  cursor: pointer;
}

.class-exam-card:hover,
.class-exam-card--active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.class-exam-card strong,
.class-exam-card small {
  display: block;
}

.class-exam-card small,
.class-exam-card > span {
  color: var(--color-muted);
  font-size: 12px;
}

.result-summary {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-bottom: 14px;
}

.class-results-panel {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  border-top: 1px solid var(--color-border);
  padding-top: 18px;
}

.result-summary strong {
  display: block;
  font-size: 22px;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.meta-grid--wide {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 16px;
}

.meta-grid dt {
  color: var(--color-muted);
  font-size: 12px;
}

.meta-grid dd {
  margin: 2px 0 0;
  font-weight: 700;
}

.paper-table__row--active {
  background: rgba(47, 111, 237, 0.05);
}

.folder-list--reorderable .folder-panel--draggable {
  cursor: grab;
}

.folder-panel--draggable:active {
  cursor: grabbing;
}

.folder-panel--dragging {
  border-color: var(--color-primary);
  opacity: 0.55;
  transform: scale(0.992);
  box-shadow: 0 8px 20px rgba(31, 75, 135, 0.08);
}

.folder-list,
.folder-panel,
.folder-panel__header,
.folder-panel__title {
  min-width: 0;
}

.folder-panel {
  max-width: 100%;
}

.folder-panel__title {
  flex: 1 1 auto;
  overflow: hidden;
}

.folder-panel__main-button small {
  flex: 0 0 auto;
  white-space: nowrap;
}

.form-note {
  display: block;
  margin-top: 6px;
  color: var(--color-muted);
  font-size: 12px;
}

.form-input[multiple] {
  height: auto;
  min-height: 116px;
  padding: 8px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.28);
}

.modal-card {
  display: grid;
  width: min(460px, 100%);
  gap: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 22px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 37, 77, 0.18);
}

.modal-card--wide {
  width: min(680px, 100%);
}

.wrong-task-modal {
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
}

.wrong-task-modal .form-input {
  font: inherit;
}

.wrong-task-exam-select {
  display: flex;
  width: 100%;
}

.wrong-task-exam-select :deep(.rich-select__list) {
  max-width: min(520px, calc(100vw - 48px));
}

.publish-confirm-modal {
  width: min(540px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  gap: 14px;
  padding: 20px;
}

.paper-delete-confirm {
  width: min(620px, 100%);
}

.publish-confirm-summary {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 14px 16px;
  background: #fbfdff;
}

.publish-confirm-summary strong {
  display: block;
  color: var(--color-text);
  font-size: 17px;
  line-height: 1.35;
}

.paper-delete-impact-grid {
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.publish-confirm-details.paper-delete-impact-grid > div {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 9px;
  min-height: 132px;
  border: 1px solid #d5e3fb;
  border-bottom: 1px solid #d5e3fb;
  border-radius: 16px;
  padding: 16px;
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.09), transparent 38%),
    #fbfdff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.publish-confirm-details.paper-delete-impact-grid dt {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  color: #52627a;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.publish-confirm-details.paper-delete-impact-grid dd {
  margin: 0;
  color: #12264a;
  font-size: 34px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.03em;
}

.publish-confirm-details.paper-delete-impact-grid small {
  max-width: 240px;
  color: #65758f;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
}

.paper-delete-impact-help {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  width: 18px;
  height: 18px;
  color: #1d4ed8;
  background: #eff6ff;
  font-size: 12px;
  font-weight: 900;
  cursor: help;
}

.paper-delete-impact-help:focus {
  outline: 2px solid rgba(37, 99, 235, 0.32);
  outline-offset: 2px;
}

.paper-delete-impact-tooltip {
  position: absolute;
  bottom: calc(100% + 9px);
  left: 50%;
  z-index: 5200;
  visibility: hidden;
  width: max-content;
  max-width: 260px;
  border: 1px solid #bfd3ee;
  border-radius: 10px;
  padding: 8px 10px;
  color: #172033;
  background: #ffffff;
  box-shadow: 0 12px 28px rgba(18, 36, 64, 0.18);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
  opacity: 0;
  pointer-events: none;
  text-align: left;
  transform: translate(-50%, 4px);
  transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
}

.paper-delete-impact-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  width: 8px;
  height: 8px;
  border-right: 1px solid #bfd3ee;
  border-bottom: 1px solid #bfd3ee;
  background: #ffffff;
  transform: translate(-50%, -4px) rotate(45deg);
}

.paper-delete-impact-help:hover .paper-delete-impact-tooltip,
.paper-delete-impact-help:focus .paper-delete-impact-tooltip {
  visibility: visible;
  opacity: 1;
  transform: translate(-50%, 0);
}

.paper-delete-confirm__cooldown {
  margin: 0;
  color: #92400e;
  font-size: 13px;
  font-weight: 800;
  text-align: right;
}

.paper-delete-confirm__cooldown--ready {
  color: #166534;
}

.paper-delete-confirm__delete:disabled {
  color: #ffffff;
  background: #9cb9f8;
  opacity: 0.74;
}

@media (max-width: 600px) {
  .paper-delete-confirm .modal-card__footer {
    flex-wrap: nowrap;
    gap: 8px;
  }

  .paper-delete-confirm .modal-card__footer .app-button {
    flex: 0 0 auto;
    padding: 0 10px;
    font-size: 13px;
    white-space: nowrap;
  }
}

.publish-confirm-details {
  display: grid;
  gap: 8px;
  margin: 0;
}

.publish-confirm-details div {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 12px;
  border-bottom: 1px solid var(--color-border);
  padding: 8px 0;
}

.publish-confirm-details dt {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.publish-confirm-details dd {
  margin: 0;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 700;
}

.publish-confirm-note {
  margin: 0;
  border-radius: 12px;
  padding: 10px 12px;
  color: #33415c;
  background: #f5f8ff;
  font-size: 13px;
  line-height: 1.45;
}

.publish-confirm-note--danger {
  color: #8a1f11;
  background: #fff1ed;
}

.publish-confirm-error {
  margin: 0;
  border: 1px solid rgba(199, 55, 71, 0.28);
  border-radius: 12px;
  padding: 10px 12px;
  color: #8a1f11;
  background: #fff1f2;
  font-size: 13px;
  line-height: 1.45;
}

.publish-structure-warning {
  display: grid;
  gap: 10px;
  border: 1px solid #fed7aa;
  border-radius: 14px;
  padding: 14px;
  color: #7c2d12;
  background: #fff7ed;
}

.publish-structure-warning strong {
  font-size: 14px;
  font-weight: 900;
}

.publish-structure-warning p {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
}

.publish-structure-warning__counts {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
}

.publish-structure-warning__counts div {
  border: 1px solid #fdba74;
  border-radius: 12px;
  padding: 10px;
  background: #ffffff;
}

.publish-structure-warning__counts dt {
  color: #9a3412;
  font-size: 11px;
  font-weight: 850;
  line-height: 1.25;
}

.publish-structure-warning__counts dd {
  margin: 4px 0 0;
  color: #7c2d12;
  font-size: 22px;
  font-weight: 900;
  line-height: 1;
}

.exam-action-dialog {
  width: min(420px, 100%);
  gap: 14px;
  padding: 20px;
}

.exam-action-dialog--error {
  border-color: #fecaca;
}

.exam-action-dialog__message {
  margin: 0;
  border-radius: 14px;
  padding: 12px 14px;
  color: #7f1d1d;
  background: #fff1f2;
  font-size: 14px;
  line-height: 1.55;
}

.exam-release-table { min-width: 960px; table-layout: fixed; }
.exam-release-table-wrap { overflow: visible; }
.exam-release-table__title-column { width: 30%; }
.exam-release-table__time-column { width: 23%; }
.exam-release-table__target-column { width: 11%; }
.exam-release-table__submission-column { width: 9%; }
.exam-release-table__access-column { width: 13%; }
.exam-release-table__actions-column { width: 14%; }
.exam-release-table :deep(th),
.exam-release-table :deep(td) { text-align: center; }
.exam-release-table :deep(td:first-child) { text-align: left; }
.exam-releases-card :deep(.exam-release-table th:last-child),
.exam-releases-card :deep(.exam-release-table td:last-child) { padding-inline: 8px; text-align: center; }
.exam-release-table__title-cell :deep(strong),
.exam-release-table__title-cell :deep(small),
.exam-release-table__target-cell :deep(span) {
  display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  line-height: 1.45; overflow-wrap: anywhere;
}
.exam-release-table__title-cell :deep(small) { color: var(--color-muted); font-size: 13px; }
.exam-release-table__title-cell :deep(.exam-release-table__missing-paper) { color: #b54708; font-weight: 600; }
.exam-release-table__time-cell { font-size: 13px !important; }
.exam-release-table__time-cell :deep(span) { display: block; }
.exam-release-table__target-cell { font-size: 14px !important; }
.exam-release-table__submission-cell,
.exam-release-table__access-cell { white-space: nowrap; }
@media (max-width: 980px) {
  .exam-release-table-wrap { overflow-x: auto; }
}

.modal-card--paper-settings {
  width: min(560px, 100%);
  gap: 12px;
  padding: 18px;
}

.modal-card--paper-settings .modal-form-grid {
  gap: 10px 12px;
}

.modal-card--paper-settings .form-field {
  gap: 5px;
}

.modal-card--paper-settings .form-label {
  font-size: 12px;
}

.modal-card--paper-settings .form-input {
  min-height: 34px;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
}

.modal-card--paper-settings textarea.form-input {
  min-height: 66px;
  resize: vertical;
}

.modal-card--paper-settings .form-readonly-value {
  min-height: 34px;
  display: flex;
  align-items: center;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
}

.modal-card--paper-settings .form-hint {
  font-size: 12px;
  line-height: 1.35;
}

.modal-card--paper-settings .check-line {
  min-height: 34px;
  align-self: end;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 7px 10px;
  background: #fbfdff;
}

.modal-card--paper-create {
  width: min(620px, 100%);
  max-height: calc(100vh - 32px);
  gap: 12px;
  overflow-y: auto;
  padding: 18px;
}

.modal-card--paper-create .modal-form-grid {
  gap: 10px 12px;
}

.modal-card--paper-create .form-input {
  min-height: 36px;
}

.modal-card--paper-create textarea.form-input {
  min-height: 62px;
}

.modal-card--paper-create .modal-card__footer {
  position: sticky;
  bottom: -18px;
  margin: 0 -18px -18px;
  border-top: 1px solid var(--color-border);
  padding: 12px 18px;
  background: #ffffff;
}

.exam-release-modal {
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  gap: 14px;
  overflow-y: auto;
  padding: 18px;
}

.exam-release-form {
  display: grid;
  gap: 12px;
}

.exam-release-section {
  display: grid;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 12px;
  background: #fbfdff;
}

.exam-release-section__header {
  display: grid;
  gap: 3px;
}

.exam-release-section__header p {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}

.exam-release-modal .modal-form-grid {
  gap: 10px 12px;
}

.exam-release-modal .form-field {
  gap: 5px;
}

.exam-release-modal .form-input {
  min-height: 36px;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
}

.exam-paper-select {
  min-height: 40px;
}

.exam-paper-select optgroup {
  color: var(--color-primary-strong);
  font-weight: 800;
}

.exam-paper-select option {
  color: var(--color-text);
  font-weight: 600;
}

.exam-release-modal textarea.form-input {
  min-height: 58px;
  resize: vertical;
}

.datetime-picker-field {
  position: relative;
  display: block;
}

.datetime-picker-field__input {
  width: 100%;
  padding-right: 42px;
}

.datetime-picker-field__input::-webkit-calendar-picker-indicator {
  opacity: 0;
  pointer-events: none;
}

.datetime-picker-field__button {
  position: absolute;
  top: 50%;
  right: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(47, 111, 237, 0.18);
  border-radius: 7px;
  color: var(--color-primary-strong);
  background: #ffffff;
  cursor: pointer;
  transform: translateY(-50%);
}

.datetime-picker-field__button:hover {
  border-color: rgba(47, 111, 237, 0.38);
  background: var(--color-primary-soft);
}

.datetime-picker-field__button svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.exam-target-toggle {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.exam-target-option,
.exam-class-option,
.exam-option-line {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--color-text);
  background: #ffffff;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    background 140ms ease;
}

.exam-target-option:hover,
.exam-class-option:hover,
.exam-option-line:hover {
  border-color: #cfe0ff;
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.08);
}

.exam-target-option--active,
.exam-class-option--selected {
  border-color: var(--color-primary);
  background: #f4f8ff;
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.1);
}

.exam-target-option input,
.exam-class-option input,
.exam-option-line input {
  margin-top: 2px;
}

.exam-target-option span,
.exam-option-line strong,
.exam-class-option strong {
  display: block;
  font-size: 13px;
  font-weight: 800;
}

.exam-target-option small,
.exam-option-line small,
.exam-class-option small,
.exam-class-picker__header small {
  display: block;
  margin-top: 2px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.35;
}

.exam-class-picker {
  display: grid;
  gap: 8px;
}

.exam-class-search {
  width: 100%;
}

.exam-class-picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.exam-class-picker__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  max-height: 210px;
  overflow-y: auto;
  padding-right: 2px;
}

.exam-class-option__main {
  min-width: 0;
}

.exam-option-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.exam-release-modal .modal-card__footer {
  position: sticky;
  bottom: -18px;
  margin: 0 -18px -18px;
  border-top: 1px solid var(--color-border);
  padding: 12px 18px;
  background: #ffffff;
}

.modal-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.modal-card__header,
.modal-card__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.modal-card__header h3,
.modal-card__header p {
  margin: 0;
}

.modal-card__header p {
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 14px;
}

.modal-card__close {
  border: 0;
  border-radius: 999px;
  width: 30px;
  height: 30px;
  color: var(--color-muted);
  background: #f5f8fd;
  cursor: pointer;
}

.modal-card__footer {
  justify-content: flex-end;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.soft-tag,
.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
}

.soft-tag {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
}

.status-pill {
  color: var(--color-muted);
  background: #edf2f8;
  font-size: 13px;
}

.status-pill--on {
  color: var(--color-success);
  background: #e8f7f1;
}

.status-pill--info {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
}

.access-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}

.access-pill::before {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  content: '';
}

.access-pill--open {
  border-color: #bfe9d8;
  color: #16794c;
  background: #f0fbf6;
}

.access-pill--scheduled {
  border-color: #cfe0ff;
  color: var(--color-primary-strong);
  background: #f5f8ff;
}

.access-pill--hidden,
.access-pill--closed {
  border-color: #d9e1ec;
  color: #64748b;
  background: #f8fafc;
}

.release-time-pill {
  display: inline-flex;
  margin-left: 6px;
  border-radius: 999px;
  padding: 5px 9px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  font-size: 12px;
  font-weight: 700;
}

.table-wrap {
  overflow-x: auto;
}

.unassigned-students-scroll {
  max-height: 800px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.unassigned-students-scroll :deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 1;
}

.unassigned-students-select-column {
  width: 52px;
  text-align: center !important;
}

.unassigned-students-select-column input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-primary);
  vertical-align: middle;
}

@media (max-width: 600px) {
  .unassigned-students-scroll { overflow-x: hidden; }
  .unassigned-students-scroll :deep(.unassigned-students-table) {
    min-width: 0;
    table-layout: fixed;
  }
  .unassigned-students-scroll :deep(.unassigned-students-select-column) { width: 44px; }
  .unassigned-students-scroll :deep(.unassigned-students-secondary-column) { display: none; }
  .unassigned-students-scroll :deep(tbody td:nth-child(2)) {
    overflow-wrap: anywhere;
    text-align: left;
  }
}

.bulk-assign-modal .form-field {
  display: grid;
  gap: 6px;
}

.bulk-assign-summary {
  display: grid;
  gap: 5px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--color-surface-soft);
}

.bulk-assign-summary span {
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.5;
}

.bulk-assign-error {
  margin: 0;
  color: var(--color-danger, #b42318);
  font-size: 14px;
  line-height: 1.45;
}

.table-wrap--compact {
  margin-top: 18px;
}

.admin-table__access-cell {
  white-space: nowrap;
}

.admin-table__row--clickable {
  cursor: pointer;
  transition: background-color 160ms ease;
}

.admin-table__row--clickable:hover {
  background: var(--color-primary-soft);
}

.table-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 4px 0;
  color: var(--color-muted);
  font-size: 13px;
}

.table-pagination__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 600px) {
  .table-pagination__actions {
    flex-wrap: wrap;
    max-width: 100%;
    justify-content: flex-start;
  }
}

.table-pagination__page-size {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-muted);
  font-weight: 700;
}

.table-pagination__page-size .form-input {
  min-height: 32px;
  padding: 5px 28px 5px 10px;
}

.table-pagination__actions button {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 6px 12px;
  color: var(--color-text);
  background: #ffffff;
  font-size: 14px;
  cursor: pointer;
}

.table-pagination__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.list-panel {
  display: grid;
  gap: 10px;
  margin-top: 22px;
}

.class-item {
  display: grid;
  gap: 4px;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  text-align: left;
  background: #ffffff;
  cursor: pointer;
}

.class-item span {
  font-weight: 700;
}

.class-item small {
  color: var(--color-muted);
}

.class-item--active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

@media (max-width: 780px) {
  .dashboard-review-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-columns,
  .admin-form,
  .class-detail-grid,
  .modal-form-grid {
    grid-template-columns: 1fr;
  }

  .admin-toolbar__filters input[placeholder="Paper name"],
  .class-search-input {
    width: 100%;
    min-width: 0;
  }

  .admin-toolbar__filters input[placeholder="Paper name"] {
    height: 34px;
    flex: 0 0 auto;
  }

  .class-detail-hero__top,
  .class-detail-hero__main,
  .class-exam-card {
    align-items: stretch;
    flex-direction: column;
  }

  .modal-card {
    padding: 18px;
  }

  .class-detail-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .meta-grid--wide,
  .result-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
