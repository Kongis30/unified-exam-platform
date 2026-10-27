<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppModal from '@/components/AppModal.vue'
import AdminTabs from '@/components/admin/AdminTabs.vue'
import AdminActionMenu from '@/components/admin/AdminActionMenu.vue'
import ResponsiveActionGroup from '@/components/admin/ResponsiveActionGroup.vue'
import AdminTabPanels from '@/components/admin/AdminTabPanels.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminExamCard from '@/components/admin/AdminExamCard.vue'
import AdminDataTable from '@/components/admin/AdminDataTable.vue'
import { getStudentExamState } from '@/utils/studentExamState.js'
import { examApi as satExamApi } from '@/examTypes/sat/student/api/exam'
import ClassesPage from '@/views/ClassesPage.vue'
import {
  createExam, createPaper, createPaperGroup, createPaperVersion, deleteExam, deletePaper, deletePaperGroup,
  apiRequest, closeExam, getExam, getExamTypes, getPaper, listAvailableStudents, listClasses, listExams, listPaperGroups, listPapers,
  listStudentExams, movePaperToGroup, publishExam, reorderWorkspacePaperGroups, saveExamTargets, startStudentAttempt, unpublishExam,
  savePaperStructure, sealPaper, setPaperArchived, updateExam, updatePaper, updatePaperGroup,
} from '@/api/platform'
import { authState } from '@/auth'
import { studentApi as shsatStudentApi } from '@shsat/admin/services/studentApi'

const props = defineProps({ code: { type: String, required: true } })
const route = useRoute()
const router = useRouter()
const examTypes = ref([])
const papers = ref([])
const paperFolderRecords = ref([])
const exams = ref([])
const studentExams = ref([])
const studentPracticePapers = ref([])
const studentPracticeHistory = ref([])
const practiceHistoryPage = ref(1)
const practiceHistoryTotal = ref(0)
const practiceHistoryDeleteTarget = ref(null)
const deletingPracticeAttemptId = ref(null)
const studentReviewTasks = ref([])
const studentAttemptHistory = ref([])
const historyLoading = ref(false)
const historyError = ref('')
const studentExamError = ref('')
const activeHistoryTab = ref(localStorage.getItem('shsat.student-history-tab') || 'history')
const startingWrongAnswerAttemptId = ref(null)
const startingReviewTaskId = ref(null)
const startingPracticePaperId = ref(null)
const classes = ref([])
const students = ref([])
const selectedPaper = ref(null)
const isLoading = ref(true)
const isSaving = ref(false)
const examActionId = ref(null)
const examPublicationTarget = ref(null)
const examPublicationError = ref('')
const examCloseTarget = ref(null)
const examCloseError = ref('')
const examDeleteTarget = ref(null)
const examDeleteCooldown = ref(0)
const notification = reactive({ open: false, title: '', message: '', variant: 'info' })
const startingExamId = ref(null)
const error = ref('')
const notice = ref('')
const isAdmin = computed(() => authState.user?.roleCode === 'ADMIN')
const canManageWorkspace = computed(() => props.code !== 'SAT' || isAdmin.value)
const initialTab = route.query.tab
const initialAllowedTab = props.code === 'SAT' && !isAdmin.value
  ? 'classes' : ['papers', 'exams', 'classes'].includes(initialTab) ? initialTab : 'papers'
const activeTab = ref(initialAllowedTab)
const openPaperActionMenuId = ref(null)
const movePaperTarget = ref(null)
const movePaperGroupKey = ref('')
const editPaperTarget = ref(null)
const editPaperTitle = ref('')
const paperActionDialog = ref(null)
const paperActionDialogSaving = ref(false)
const paperActionDialogError = ref('')
const paperDetailsTarget = ref(null)
const paperDetails = ref(null)
const paperDetailsLoading = ref(false)
const paperDetailsError = ref('')
const creatingVersionPaperId = ref(null)
const deleteFolderTarget = ref(null)
const availableExamsCollapsed = ref(localStorage.getItem(`admin.available-exams-collapsed.${props.code}`) === 'true')
const examReleasesCollapsed = ref(localStorage.getItem(`admin.exam-releases-collapsed.${props.code}`) === 'true')
const historicalExamsCollapsed = ref(localStorage.getItem(`admin.historical-exams-collapsed.${props.code}`) === 'true')
const paperFolderExpanded = reactive({})
const draggingPaperFolderKey = ref('')
const paperFolderDragMoved = ref(false)
const isReorderingPaperFolders = ref(false)
const paperFilters = reactive({
  groupId: typeof route.query.paperGroup === 'string' ? route.query.paperGroup : '',
  keyword: typeof route.query.paperSearch === 'string' ? route.query.paperSearch : '',
})
const appliedPaperKeyword = ref(paperFilters.keyword)
const folderNameDraft = ref('')
const folderDialogOpen = ref(false)
const folderCreating = ref(false)
const folderDialogError = ref('')
const renameFolderDialogOpen = ref(false)
const renameFolderDraft = ref('')
const renameFolderTarget = ref(null)
const renamingFolder = ref(false)
const renameFolderError = ref('')
let examDeleteCooldownTimer = null
let notificationTimer = null
let examReleaseRefreshTimer = null
const EXAM_DELETE_COOLDOWN_SECONDS = 5
const examKeyword = ref(typeof route.query.examSearch === 'string' ? route.query.examSearch : '')
const initialExamPageSize = Number(route.query.examPageSize)
const examPageSize = ref([10, 20, 50].includes(initialExamPageSize) ? initialExamPageSize : 10)
const currentExamPage = ref(Math.max(1, Number(route.query.currentExamPage) || 1))
const historicalExamPage = ref(Math.max(1, Number(route.query.historicalExamPage) || 1))
const editorOpen = ref(false)
const releaseOpen = ref(false)
const draftListOpen = ref(false)
const draftPaperTitle = ref('')
const draftHadTargets = ref(false)
const draftExamId = ref(null)
const selectedClassIds = ref([])
const selectedStudentIds = ref([])
const isStaff = computed(() => ['ADMIN', 'TEACHER'].includes(authState.user?.roleCode))
const workspaceTypes = computed(() => examTypes.value.filter((item) => item.workspaceCode === props.code))
const availableExamSubtitle = computed(() => {
  const names = [...new Set(workspaceTypes.value.map((item) => item.displayName))]
  const programs = names.length ? names.join(' and ') : props.code
  return `Published ${programs} exams for your classes.`
})
const selectedType = computed(() => workspaceTypes.value.find((item) => item.code === props.code) || workspaceTypes.value[0])
const readyPapers = computed(() => papers.value.filter((paper) => paper.status === 'READY'))
const selectedReleasePaper = computed(() => readyPapers.value.find((paper) => String(paper.id) === String(releaseForm.paperId)))
const sortedReleaseClasses = computed(() => [...classes.value].sort((left, right) =>
  left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) || left.id - right.id))
const activeReleaseClassIds = computed(() => sortedReleaseClasses.value
  .filter((classroom) => classroom.status === 'ACTIVE').map((classroom) => String(classroom.id)))
const allReleaseClassesSelected = computed(() => activeReleaseClassIds.value.length > 0
  && activeReleaseClassIds.value.every((id) => selectedClassIds.value.map(String).includes(id)))
const filteredExams = computed(() => {
  const keyword = examKeyword.value.trim().toLocaleLowerCase()
  if (!keyword) return exams.value
  return exams.value.filter((exam) => [exam.title, exam.paperTitle, exam.examTypeCode]
    .some((value) => String(value || '').toLocaleLowerCase().includes(keyword)))
})
const draftExams = computed(() => exams.value.filter((exam) => exam.status === 'DRAFT'))
const currentExams = computed(() => filteredExams.value.filter((exam) => exam.status === 'PUBLISHED'
  && new Date(exam.closesAt).getTime() > Date.now()))
const historicalExams = computed(() => filteredExams.value.filter((exam) =>
  ['CLOSED', 'CANCELLED'].includes(exam.status)
  || (exam.status === 'PUBLISHED' && new Date(exam.closesAt).getTime() <= Date.now())))
const currentExamPageCount = computed(() => Math.max(1, Math.ceil(currentExams.value.length / examPageSize.value)))
const historicalExamPageCount = computed(() => Math.max(1, Math.ceil(historicalExams.value.length / examPageSize.value)))
const visibleExams = computed(() => currentExams.value.slice(
  (currentExamPage.value - 1) * examPageSize.value, currentExamPage.value * examPageSize.value))
const visibleHistoricalExams = computed(() => historicalExams.value.slice(
  (historicalExamPage.value - 1) * examPageSize.value, historicalExamPage.value * examPageSize.value))
const practicePaperGroups = computed(() => {
  const groups = new Map()
  for (const paper of studentPracticePapers.value) {
    const name = paper.groupName || 'Default Folder'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(paper)
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})
const paperGroups = computed(() => {
  // SAT 与 PSAT 的分组记录按考试类型隔离存储，管理页按同名文件夹合并展示。
  const groups = new Map()
  for (const group of paperFolderRecords.value) {
    const key = group.name.trim().toLocaleLowerCase()
    if (!groups.has(key)) groups.set(key, { key, name: group.name, idsByType: {}, sortOrder: group.sortOrder })
    groups.get(key).idsByType[group.examTypeCode] = group.id
  }
  return [...groups.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
})
const filteredPapers = computed(() => {
  const keyword = appliedPaperKeyword.value.toLocaleLowerCase()
  return papers.value.filter((paper) => {
    const matchesGroup = !paperFilters.groupId
      || (paperFilters.groupId === 'default' ? paper.groupId == null : paperGroups.value.some((group) =>
        group.key === paperFilters.groupId && String(group.idsByType[paper.examTypeCode]) === String(paper.groupId)))
    const matchesKeyword = !keyword || [paper.title]
      .some((value) => String(value || '').toLocaleLowerCase().includes(keyword))
    return matchesGroup && matchesKeyword
  })
})
const paperFolderSections = computed(() => {
  const sections = [
    { key: 'default', name: 'Default Folder', group: null,
      totalItems: papers.value.filter((paper) => paper.groupId == null).length,
      items: filteredPapers.value.filter((paper) => paper.groupId == null) },
    ...paperGroups.value.map((group) => ({ key: group.key, name: group.name, group,
      totalItems: papers.value.filter((paper) => String(group.idsByType[paper.examTypeCode]) === String(paper.groupId)).length,
      items: filteredPapers.value.filter((paper) => String(group.idsByType[paper.examTypeCode]) === String(paper.groupId)) })),
  ]
  return sections.filter((section) => !paperFilters.groupId || section.key === paperFilters.groupId)
})
const publishedExams = computed(() => {
  const now = Date.now()
  return exams.value.filter((exam) => {
    if (exam.status !== 'PUBLISHED') return false
    const opensAt = new Date(exam.opensAt).getTime()
    const closesAt = new Date(exam.closesAt).getTime()
    return Number.isFinite(opensAt) && Number.isFinite(closesAt) && closesAt > now
  })
})
const adminTabs = [
  { key: 'papers', label: 'Paper Management' },
  { key: 'exams', label: 'Exam Release' },
  { key: 'classes', label: 'Classes' },
]
const visibleAdminTabs = computed(() => canManageWorkspace.value
  ? adminTabs : adminTabs.filter((tab) => tab.key === 'classes'))

const paperForm = reactive({ examTypeCode: '', title: '', description: '', defaultDurationMinutes: 134 })
const releaseForm = reactive({
  paperId: '', title: '', description: '', opensAt: '', closesAt: '', durationMinutes: '', attemptLimit: 1,
  targetScope: 'SELECTED',
})

function emptySection(sectionCode = `SECTION_${Date.now()}`, sortOrder = 0) {
  return { sectionCode, sectionKind: 'PART', title: '', sortOrder, parentSectionCode: '', instructions: '',
    settingsText: '', questions: [] }
}

function emptyQuestion(sortOrder = 0) {
  return { questionTypeCode: 'MULTIPLE_CHOICE', stem: '', renderText: '{\n  "options": []\n}',
    answerKeyText: '{\n  "correct": "A"\n}', gradingText: '', explanation: '', categoryId: null,
    sortOrder, displayNumber: sortOrder + 1, maxPoints: 1, scoringSectionCode: '' }
}

function defaultPaperDurationMinutes(examTypeCode) {
  return examTypeCode === 'SHSAT' ? 180 : 134
}

function getPaperDurationSeconds() {
  const minutes = Number(paperForm.defaultDurationMinutes)
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('Enter a duration of at least 1 minute.')
  return minutes * 60
}

async function loadPage() {
  isLoading.value = true
  error.value = ''
  selectedPaper.value = null
  try {
    examTypes.value = await getExamTypes()
    if (!selectedType.value) return
    if (isStaff.value) {
      const classRowsPromise = listClasses([props.code])
      const managementDataPromise = canManageWorkspace.value
        ? Promise.all([listAvailableStudents(), loadWorkspacePapers(), loadWorkspaceExams()])
        : Promise.resolve([[], undefined, undefined])
      const [classRows, [studentRows]] = await Promise.all([classRowsPromise, managementDataPromise])
      classes.value = classRows
      students.value = studentRows
    } else {
      await loadStudentExams()
    }
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load this exam workspace.'
  } finally {
    isLoading.value = false
    await nextTick()
    restoreStudentHistoryScroll()
  }
}

// 报告页返回时恢复学生历史列表位置，并消费一次性滚动参数。
function restoreStudentHistoryScroll() {
  if (props.code !== 'SHSAT' || route.query.historyScrollY === undefined) return
  const scrollY = Number(route.query.historyScrollY)
  if (!Number.isFinite(scrollY) || scrollY < 0) return

  window.scrollTo(window.scrollX, scrollY)
  const query = { ...route.query }
  delete query.historyScrollY
  router.replace({ name: 'student-workspace', params: { code: 'SHSAT' }, query })
}

async function loadStudentExams() {
  const workspaceCodes = new Set(workspaceTypes.value.map((item) => item.code))
  const isShsatWorkspace = props.code === 'SHSAT'
  studentExamError.value = ''
  if (isShsatWorkspace) {
    historyLoading.value = true
    historyError.value = ''
  }

  try {
    try {
      studentExams.value = (await listStudentExams())
        .filter((exam) => workspaceCodes.has(exam.examTypeCode))
    } catch (requestError) {
      if (!isShsatWorkspace) throw requestError
      studentExamError.value = requestError.message || 'Unable to load your assigned exams.'
    }

    if (props.code === 'SAT') {
      const [practicePapers, practiceHistory] = await Promise.all([
        satExamApi.listPracticePapers(),
        satExamApi.listPracticeHistory(practiceHistoryPage.value, 10),
      ])
      studentPracticePapers.value = practicePapers
      studentPracticeHistory.value = practiceHistory.records || []
      practiceHistoryTotal.value = practiceHistory.total || 0
    } else {
      studentPracticePapers.value = []
      studentPracticeHistory.value = []
      practiceHistoryTotal.value = 0
    }

    if (isShsatWorkspace) {
      try {
        const [tasks, history] = await Promise.all([
          apiRequest('/api/student/wrong-answer-tasks'),
          shsatStudentApi.getAttemptHistory(),
        ])
        studentReviewTasks.value = tasks
        studentAttemptHistory.value = history
      } catch (requestError) {
        historyError.value = requestError.message || 'Unable to load exam history.'
      }
    } else {
      studentReviewTasks.value = []
      studentAttemptHistory.value = []
    }
  } catch (requestError) {
    if (isShsatWorkspace) {
      historyError.value = requestError.message || 'Unable to load exam history.'
    } else {
      throw requestError
    }
  } finally {
    if (isShsatWorkspace) {
      historyLoading.value = false
    }
  }
}

const shsatFormalHistory = computed(() => studentAttemptHistory.value.filter((item) => !item.practice))
const shsatWrongAnswerBooks = computed(() => shsatFormalHistory.value.filter((item) => Number(item.reviewCount) > 0))
const activeReviewTasks = computed(() => studentReviewTasks.value.filter((task) => task.status !== 'COMPLETED'))
const completedReviewTasks = computed(() => studentReviewTasks.value
  .filter((task) => task.status === 'COMPLETED' && task.practiceAttemptId))
const latestWrongAnswerPractice = computed(() => {
  const latest = new Map()
  for (const item of studentAttemptHistory.value) {
    if (item.practice && item.practiceSourceAttemptId && !latest.has(String(item.practiceSourceAttemptId))) {
      latest.set(String(item.practiceSourceAttemptId), item)
    }
  }
  return latest
})

function selectStudentHistoryTab(tab) {
  activeHistoryTab.value = tab
  localStorage.setItem('shsat.student-history-tab', tab)
}

function reviewTaskActionLabel(task) {
  if (startingReviewTaskId.value === task.assignmentId) return 'Starting…'
  if (task.status === 'ENDED') return 'Task ended'
  if (task.status === 'IN_PROGRESS') return 'Continue'
  if (task.status === 'RETRY_REQUIRED') return 'Try again'
  return 'Start review'
}

function reviewTaskStatusLabel(status) {
  const labels = {
    NOT_STARTED: 'Not Started',
    IN_PROGRESS: 'In Progress',
    RETRY_REQUIRED: 'More Practice Needed',
    COMPLETED: 'Completed',
    ENDED: 'Ended',
  }
  return labels[status] || 'Assigned'
}

function studentExamStatusClass(exam) {
  const status = getStudentExamState(exam).label.toLowerCase().replace(/\s+/g, '-')
  return {
    available: 'is-active',
    'in-progress': 'is-progress',
    submitted: 'is-complete',
    upcoming: 'is-upcoming',
    closed: 'is-closed',
    'no-attempts-left': 'is-disabled',
  }[status] || ''
}

function viewShsatAttempt(item) {
  router.push({ name: 'student-attempt-report', params: { attemptId: item.attemptId },
    query: {
      returnTo: `/student/systems/SHSAT?historyScrollY=${Math.round(window.scrollY)}`,
      returnLabel: 'Back to SHSAT',
    } })
}

function viewCompletedReviewReport(task) {
  if (task.practiceAttemptId) viewShsatAttempt({ attemptId: task.practiceAttemptId })
}

function viewShsatWrongAnswers(item) {
  if (!item.answersVisible || !item.remainingReviewCount) return
  router.push({ name: 'student-wrong-answer-review', params: { attemptId: item.attemptId },
    query: { returnTo: '/student/systems/SHSAT' } })
}

async function practiceShsatWrongAnswers(item) {
  if (startingWrongAnswerAttemptId.value !== null || !item.answersVisible || !item.remainingReviewCount) return
  startingWrongAnswerAttemptId.value = item.attemptId
  try {
    const attempt = await shsatStudentApi.startWrongAnswerPractice(item.attemptId)
    router.push({ name: 'shsat-student-exam', params: { examId: item.examId },
      query: { practiceAttemptId: attempt.attemptId } })
  } catch (requestError) {
    historyError.value = requestError.message || 'Unable to start wrong-answer practice.'
  } finally {
    startingWrongAnswerAttemptId.value = null
  }
}

function viewLatestShsatPractice(item) {
  const practice = latestWrongAnswerPractice.value.get(String(item.attemptId))
  if (practice) viewShsatAttempt(practice)
}

async function changePracticeHistoryPage(page) {
  practiceHistoryPage.value = page
  const result = await satExamApi.listPracticeHistory(page, 10)
  studentPracticeHistory.value = result.records || []
  practiceHistoryTotal.value = result.total || 0
}

function viewPracticeReport(record) {
  router.push({ name: 'sat-report', query: { examId: record.paperId, recordId: record.attemptId } })
}

async function deletePracticeRecord() {
  const record = practiceHistoryDeleteTarget.value
  if (!record || deletingPracticeAttemptId.value !== null) return
  deletingPracticeAttemptId.value = record.attemptId
  try {
    await satExamApi.deletePracticeAttempt(record.attemptId)
    practiceHistoryDeleteTarget.value = null
    if (studentPracticeHistory.value.length === 1 && practiceHistoryPage.value > 1) practiceHistoryPage.value -= 1
    await changePracticeHistoryPage(practiceHistoryPage.value)
    showNotification({ title: 'Practice deleted', message: 'The practice record and its answers were deleted.', variant: 'success' })
  } catch (requestError) {
    showNotification({ title: 'Unable to delete practice', message: requestError.message || 'Please try again.', variant: 'error' })
  } finally {
    deletingPracticeAttemptId.value = null
  }
}

async function startPracticePaper(paper) {
  if (startingPracticePaperId.value !== null) return
  startingPracticePaperId.value = paper.id
  error.value = ''
  try {
    await router.push({ name: 'sat-student-exam', params: { examId: paper.id }, query: { mode: 'practice' } })
  } catch (requestError) {
    error.value = requestError.message || 'Unable to start this practice test.'
  } finally {
    startingPracticePaperId.value = null
  }
}

async function startReviewTask(task) {
  if (startingReviewTaskId.value !== null) return
  startingReviewTaskId.value = task.assignmentId
  error.value = ''
  try {
    const attempt = await apiRequest(`/api/student/wrong-answer-tasks/${task.assignmentId}/start`, { method: 'POST' })
    await router.push({
      name: 'shsat-student-exam',
      params: { examId: task.examId },
      query: { practiceAttemptId: attempt.id, reviewAssignmentId: task.assignmentId },
    })
  } catch (requestError) {
    error.value = requestError.message || 'Unable to start this review assignment.'
  } finally {
    startingReviewTaskId.value = null
  }
}

async function loadWorkspacePapers() {
  const types = workspaceTypes.value
  const [lists, groups] = await Promise.all([
    Promise.all(types.map((type) => listPapers(type.code))),
    Promise.all(types.map((type) => listPaperGroups(type.code))),
  ])
  papers.value = lists.flat().sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
  paperFolderRecords.value = groups.flat().sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
}

function openFolderDialog() {
  folderNameDraft.value = ''
  folderDialogError.value = ''
  folderDialogOpen.value = true
}

async function createPaperFolder() {
  const name = folderNameDraft.value.trim()
  if (!name || folderCreating.value) return
  folderDialogError.value = ''
  folderCreating.value = true
  try {
    const existingFolder = paperGroups.value.find((group) => group.key === name.toLocaleLowerCase())
    const sortOrder = existingFolder?.sortOrder
      ?? Math.max(-1, ...paperGroups.value.map((group) => group.sortOrder)) + 1
    for (const type of workspaceTypes.value) {
      const exists = paperFolderRecords.value.some((group) => group.examTypeCode === type.code
        && group.name.toLocaleLowerCase() === name.toLocaleLowerCase())
      if (!exists) await createPaperGroup(type.code, { name, description: '', sortOrder })
    }
    folderNameDraft.value = ''
    folderDialogOpen.value = false
    await loadWorkspacePapers()
    notice.value = 'Paper folder created.'
  } catch (requestError) {
    folderDialogError.value = requestError.message || 'Unable to create this folder.'
    await loadWorkspacePapers()
  } finally {
    folderCreating.value = false
  }
}

function openRenamePaperFolder(group) {
  renameFolderTarget.value = group
  renameFolderDraft.value = group.name
  renameFolderError.value = ''
  renameFolderDialogOpen.value = true
}

async function renamePaperFolder() {
  const group = renameFolderTarget.value
  const name = renameFolderDraft.value.trim()
  if (!group || !name || renamingFolder.value) return
  if (name === group.name) {
    renameFolderDialogOpen.value = false
    return
  }
  renameFolderError.value = ''
  renamingFolder.value = true
  try {
    const records = paperFolderRecords.value.filter((item) => item.name === group.name)
    await Promise.all(records.map((item) => updatePaperGroup(item.id, {
      name, description: item.description || '', sortOrder: item.sortOrder,
    })))
    await loadWorkspacePapers()
    if (paperFilters.groupId === group.key) paperFilters.groupId = name.toLocaleLowerCase()
    renameFolderDialogOpen.value = false
    notice.value = 'Paper folder renamed.'
  } catch (requestError) {
    renameFolderError.value = requestError.message || 'Unable to rename this folder.'
    await loadWorkspacePapers()
  } finally {
    renamingFolder.value = false
  }
}

async function deletePaperFolder(group) {
  deleteFolderTarget.value = group
  paperActionDialogError.value = ''
}

async function confirmDeletePaperFolder() {
  const group = deleteFolderTarget.value
  if (!group || paperActionDialogSaving.value) return
  paperActionDialogSaving.value = true
  error.value = ''
  try {
    const records = paperFolderRecords.value.filter((item) => item.name === group.name)
    await Promise.all(records.map((item) => deletePaperGroup(item.id)))
    deleteFolderTarget.value = null
    paperFilters.groupId = ''
    await loadWorkspacePapers()
    notice.value = 'Paper folder deleted.'
  } catch (requestError) {
    paperActionDialogError.value = requestError.message || 'Move papers out of this folder before deleting it.'
    await loadWorkspacePapers()
  } finally {
    paperActionDialogSaving.value = false
  }
}

function reorderPaperFolderLocally(sourceKey, targetKey) {
  const folders = [...paperGroups.value]
  const sourceIndex = folders.findIndex((item) => item.key === sourceKey)
  const targetIndex = folders.findIndex((item) => item.key === targetKey)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false
  const [moved] = folders.splice(sourceIndex, 1)
  folders.splice(targetIndex, 0, moved)
  const order = new Map(folders.map((item, index) => [item.key, index]))
  paperFolderRecords.value = paperFolderRecords.value.map((record) => ({
    ...record,
    sortOrder: order.get(record.name.trim().toLocaleLowerCase()),
  }))
  return true
}

function startPaperFolderDrag(folder, event) {
  if (!folder.group || isReorderingPaperFolders.value) {
    event.preventDefault()
    return
  }
  draggingPaperFolderKey.value = folder.key
  paperFolderDragMoved.value = false
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', folder.key)
}

function dragOverPaperFolder(folder, event) {
  if (!draggingPaperFolderKey.value || !folder.group || isReorderingPaperFolders.value) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
}

function dropPaperFolder(folder, event) {
  if (!draggingPaperFolderKey.value || !folder.group || isReorderingPaperFolders.value) return
  event.preventDefault()
  paperFolderDragMoved.value = reorderPaperFolderLocally(draggingPaperFolderKey.value, folder.key)
}

async function finishPaperFolderDrag() {
  if (!draggingPaperFolderKey.value) return
  const shouldSave = paperFolderDragMoved.value
  draggingPaperFolderKey.value = ''
  paperFolderDragMoved.value = false
  if (!shouldSave) return

  isReorderingPaperFolders.value = true
  error.value = ''
  try {
    const groups = paperGroups.value.map((folder) => ({
      groups: Object.entries(folder.idsByType).map(([examTypeCode, groupId]) => ({
        examTypeCode, groupId: Number(groupId),
      })),
    }))
    await reorderWorkspacePaperGroups(props.code, groups)
    await loadWorkspacePapers()
  } catch (requestError) {
    error.value = requestError.message || 'Unable to reorder paper folders.'
    await loadWorkspacePapers()
  } finally {
    isReorderingPaperFolders.value = false
  }
}

function openMovePaperDialog(summary) {
  movePaperTarget.value = summary
  const currentGroup = summary.groupId == null ? null : paperGroups.value.find((group) => {
    return String(group.idsByType[summary.examTypeCode]) === String(summary.groupId)
  })
  movePaperGroupKey.value = currentGroup?.key || ''
  paperActionDialogError.value = ''
}

async function movePaper() {
  const summary = movePaperTarget.value
  if (!summary || paperActionDialogSaving.value) return
  const selected = paperGroups.value.find((group) => group.key === movePaperGroupKey.value) || null
  let groupId = selected?.idsByType[summary.examTypeCode] ?? null
  if (selected && groupId == null) {
    paperActionDialogSaving.value = true
    try {
      const created = await createPaperGroup(summary.examTypeCode, {
        name: selected.name, description: '', sortOrder: paperFolderRecords.value.length,
      })
      groupId = created.id
    } catch (requestError) {
      paperActionDialogError.value = requestError.message || 'Unable to add this folder to the paper type.'
      return
    } finally {
      paperActionDialogSaving.value = false
    }
  }
  if (String(summary.groupId || '') === String(groupId || '')) {
    movePaperTarget.value = null
    return
  }
  paperActionDialogError.value = ''
  paperActionDialogSaving.value = true
  try {
    await movePaperToGroup(summary.id, groupId)
    await loadWorkspacePapers()
    movePaperTarget.value = null
    notice.value = 'Paper moved.'
  } catch (requestError) {
    paperActionDialogError.value = requestError.message || 'Unable to move this paper.'
  } finally {
    paperActionDialogSaving.value = false
  }
}

function openEditPaperInfoDialog(summary) {
  editPaperTarget.value = summary
  editPaperTitle.value = summary.title
  paperActionDialogError.value = ''
}

async function editPaperInfo() {
  const summary = editPaperTarget.value
  const title = editPaperTitle.value.trim()
  if (!summary || !title || title === summary.title || paperActionDialogSaving.value) return
  paperActionDialogError.value = ''
  paperActionDialogSaving.value = true
  try {
    const detail = await getPaper(summary.id)
    await updatePaper(summary.id, {
      title, description: detail.description || null, groupId: detail.groupId,
      defaultDurationSeconds: summary.defaultDurationSeconds,
    })
    await loadWorkspacePapers()
    editPaperTarget.value = null
    notice.value = 'Paper information updated.'
  } catch (requestError) {
    paperActionDialogError.value = requestError.message || 'Unable to update this paper.'
  } finally {
    paperActionDialogSaving.value = false
  }
}

function openPaperActionDialog(type, summary) {
  paperActionDialog.value = { type, paper: summary }
  paperActionDialogError.value = ''
}

async function confirmPaperAction() {
  const action = paperActionDialog.value
  if (!action || paperActionDialogSaving.value) return
  paperActionDialogSaving.value = true
  paperActionDialogError.value = ''
  try {
    if (action.type === 'delete') {
      await deletePaper(action.paper.id)
      notice.value = 'Paper deleted.'
    } else {
      const archived = action.type === 'archive'
      await setPaperArchived(action.paper.id, archived)
      notice.value = archived ? 'Paper archived.' : 'Paper restored.'
    }
    paperActionDialog.value = null
    await loadWorkspacePapers()
  } catch (requestError) {
    paperActionDialogError.value = requestError.message || 'Unable to complete this paper action.'
  } finally {
    paperActionDialogSaving.value = false
  }
}

function setPaperActionMenuOpen(paperId, isOpen) {
  openPaperActionMenuId.value = isOpen ? paperId : null
}

function handlePaperAction(action) {
  openPaperActionMenuId.value = null
  return action()
}

async function showPaperDetails(summary) {
  paperDetailsTarget.value = summary
  paperDetails.value = null
  paperDetailsError.value = ''
  paperDetailsLoading.value = true
  try {
    paperDetails.value = await getPaper(summary.id)
  } catch (requestError) {
    paperDetailsError.value = requestError.message || 'Unable to load paper details.'
  } finally {
    paperDetailsLoading.value = false
  }
}

function countPaperQuestions(sections = []) {
  return sections.reduce((total, section) => total
    + (section.questions?.length || 0) + countPaperQuestions(section.children || []), 0)
}

async function loadWorkspaceExams() {
  const lists = await Promise.all(workspaceTypes.value.map((type) => listExams(type.code)))
  exams.value = lists.flat().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
  currentExamPage.value = Math.min(currentExamPage.value, currentExamPageCount.value)
  historicalExamPage.value = Math.min(historicalExamPage.value, historicalExamPageCount.value)
}

watch([examKeyword, examPageSize], () => {
  currentExamPage.value = 1
  historicalExamPage.value = 1
})

// SAT 列表状态写进路由，离开查看结果/监考后可从原筛选和页码继续操作。
watch([activeTab, examKeyword, examPageSize, currentExamPage, historicalExamPage,
  () => paperFilters.groupId, appliedPaperKeyword], () => {
  if (props.code !== 'SAT' || !isStaff.value || route.name !== 'sat-admin') return

  const query = { ...route.query, tab: activeTab.value }
  const state = {
    examSearch: examKeyword.value || undefined,
    examPageSize: examPageSize.value === 10 ? undefined : String(examPageSize.value),
    currentExamPage: currentExamPage.value === 1 ? undefined : String(currentExamPage.value),
    historicalExamPage: historicalExamPage.value === 1 ? undefined : String(historicalExamPage.value),
    paperGroup: paperFilters.groupId || undefined,
    paperSearch: appliedPaperKeyword.value || undefined,
  }
  Object.entries(state).forEach(([key, value]) => {
    if (value === undefined) delete query[key]
    else query[key] = value
  })
  if (JSON.stringify(query) !== JSON.stringify(route.query)) {
    router.replace({ name: 'sat-admin', query })
  }
}, { flush: 'post' })

function toggleExamPublication(exam) {
  if (examActionId.value !== null) return
  examPublicationError.value = ''
  examPublicationTarget.value = exam
}

function closeExamPublicationConfirm() {
  if (examActionId.value !== null) return
  examPublicationTarget.value = null
  examPublicationError.value = ''
}

function requestCloseExam(exam) {
  examCloseError.value = ''
  examCloseTarget.value = exam
}

async function confirmCloseExam() {
  const exam = examCloseTarget.value
  if (!exam || examActionId.value !== null) return
  examActionId.value = exam.id
  examCloseError.value = ''
  try {
    await closeExam(exam.id)
    examCloseTarget.value = null
    await loadWorkspaceExams()
    showNotification({
      title: 'Exam ended',
      message: 'Students can no longer start this exam. Current attempts can still be submitted.',
      variant: 'success',
    })
  } catch (requestError) {
    examCloseError.value = requestError.message || 'Unable to end this exam.'
  } finally {
    examActionId.value = null
  }
}

async function confirmExamPublication() {
  const exam = examPublicationTarget.value
  if (!exam || examActionId.value !== null) return

  const isPublished = exam.status === 'PUBLISHED'
  const action = isPublished ? 'unpublish' : 'publish'
  examPublicationError.value = ''
  notice.value = ''
  examActionId.value = exam.id
  try {
    if (isPublished) await unpublishExam(exam.id)
    else await publishExam(exam.id)
    await loadWorkspaceExams()
    examPublicationTarget.value = null
    notice.value = isPublished ? 'Exam unpublished.' : 'Exam published.'
  } catch (requestError) {
    examPublicationError.value = requestError.message || `Unable to ${action} this exam.`
  } finally {
    examActionId.value = null
  }
}

function openDeleteExamConfirm(exam) {
  if (examActionId.value !== null) return
  clearExamDeleteCooldown()
  examDeleteTarget.value = exam
  examDeleteCooldown.value = EXAM_DELETE_COOLDOWN_SECONDS
  examDeleteCooldownTimer = window.setInterval(() => {
    examDeleteCooldown.value = Math.max(examDeleteCooldown.value - 1, 0)
    if (examDeleteCooldown.value === 0) clearExamDeleteCooldown()
  }, 1000)
}

function clearExamDeleteCooldown() {
  if (!examDeleteCooldownTimer) return
  clearInterval(examDeleteCooldownTimer)
  examDeleteCooldownTimer = null
}

function dismissNotification() {
  notification.open = false
  if (notificationTimer) {
    clearTimeout(notificationTimer)
    notificationTimer = null
  }
}

function showNotification({ title, message, variant = 'info', duration = 4500 }) {
  dismissNotification()
  Object.assign(notification, { open: true, title, message, variant })
  if (duration > 0) notificationTimer = window.setTimeout(dismissNotification, duration)
}

function closeDeleteExamConfirm() {
  if (examActionId.value !== null) return
  examDeleteTarget.value = null
  examDeleteCooldown.value = 0
  clearExamDeleteCooldown()
}

async function confirmDeleteExam() {
  const exam = examDeleteTarget.value
  if (!exam || examDeleteCooldown.value > 0 || examActionId.value !== null) return
  error.value = ''
  notice.value = ''
  examActionId.value = exam.id
  try {
    await deleteExam(exam.id)
    examDeleteTarget.value = null
    examDeleteCooldown.value = 0
    clearExamDeleteCooldown()
    await loadWorkspaceExams()
    showNotification({
      title: 'Exam deleted',
      message: 'The exam and related student records were deleted.',
      variant: 'success',
    })
  } catch (requestError) {
    error.value = requestError.message || 'Unable to delete this exam.'
    examDeleteTarget.value = null
    examDeleteCooldown.value = 0
    clearExamDeleteCooldown()
  } finally {
    examActionId.value = null
  }
}

onBeforeUnmount(() => {
  clearExamDeleteCooldown()
  dismissNotification()
  if (examReleaseRefreshTimer) clearInterval(examReleaseRefreshTimer)
})

function getExamActions(exam) {
  const actions = []
  if (exam.status === 'DRAFT') {
    actions.push({ label: 'Edit draft', onSelect: () => resumeDraft(exam) })
  }
  if (props.code === 'SAT' && exam.status !== 'DRAFT') {
    actions.push({
      label: 'Results',
      onSelect: () => router.push({
        name: 'sat-exam-results',
        params: { examId: exam.id },
        query: { returnTo: route.fullPath },
      }),
    })
    if (authState.user?.roleCode === 'ADMIN') {
      actions.push({
        label: 'Monitor',
        onSelect: () => router.push({
          name: 'sat-admin-exam-monitor',
          params: { examId: exam.id },
          query: { returnTo: route.fullPath },
        }),
      })
    }
  }
  if (exam.status === 'PUBLISHED' && new Date(exam.closesAt).getTime() > Date.now()) {
    actions.push({
      label: 'End exam',
      disabled: examActionId.value === exam.id,
      onSelect: () => requestCloseExam(exam),
    })
  }
  if (exam.status === 'DRAFT' || exam.status === 'PUBLISHED') {
    const cannotUnpublish = exam.status === 'PUBLISHED' && exam.hasStudentAttempts
    actions.push({
      label: examActionId.value === exam.id ? 'Saving…' : exam.status === 'PUBLISHED' ? 'Unpublish' : 'Publish',
      disabled: examActionId.value === exam.id || cannotUnpublish,
      title: cannotUnpublish ? 'Students have started this exam. Use End exam to stop new attempts.' : undefined,
      onSelect: () => toggleExamPublication(exam),
    })
  }
  if (authState.user?.roleCode === 'ADMIN') {
    actions.push({
      label: examActionId.value === exam.id ? 'Deleting…' : 'Delete',
      disabled: examActionId.value === exam.id,
      danger: true,
      onSelect: () => openDeleteExamConfirm(exam),
    })
  }
  return actions
}

function toggleExamReleases() {
  examReleasesCollapsed.value = !examReleasesCollapsed.value
  localStorage.setItem(`admin.exam-releases-collapsed.${props.code}`, String(examReleasesCollapsed.value))
}

function toggleHistoricalExams() {
  historicalExamsCollapsed.value = !historicalExamsCollapsed.value
  localStorage.setItem(`admin.historical-exams-collapsed.${props.code}`, String(historicalExamsCollapsed.value))
}

function syncExamReleaseRefresh() {
  if (examReleaseRefreshTimer) clearInterval(examReleaseRefreshTimer)
  examReleaseRefreshTimer = null
  if (!isStaff.value || activeTab.value !== 'exams') return
  examReleaseRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') loadWorkspaceExams()
  }, 60_000)
}

function fromQuestion(question) {
  return {
    questionTypeCode: question.questionTypeCode, stem: question.stem,
    renderText: JSON.stringify(question.render ?? {}, null, 2),
    answerKeyText: JSON.stringify(question.answerKey ?? {}, null, 2),
    gradingText: question.grading ? JSON.stringify(question.grading, null, 2) : '',
    explanation: question.explanation || '', categoryId: question.categoryId,
    sortOrder: question.sortOrder, displayNumber: question.displayNumber,
    maxPoints: question.maxPoints, scoringSectionCode: question.scoringSectionCode || '',
  }
}

function flattenSections(source, parentSectionCode = '', result = []) {
  for (const section of source) {
    result.push({ sectionCode: section.sectionCode, sectionKind: section.sectionKind, title: section.title,
      sortOrder: section.sortOrder, parentSectionCode, instructions: section.instructions || '',
      settingsText: section.settings ? JSON.stringify(section.settings, null, 2) : '',
      questions: section.questions.map(fromQuestion) })
    flattenSections(section.children, section.sectionCode, result)
  }
  return result
}

function openPaperEditor(paper = null) {
  error.value = ''; notice.value = ''
  selectedPaper.value = paper
  editorOpen.value = true
  if (paper) {
    paperForm.examTypeCode = paper.summary.examTypeCode
    paperForm.title = paper.summary.title
    paperForm.description = paper.description || ''
    paperForm.defaultDurationMinutes = paper.summary.defaultDurationSeconds
      ? Math.round(paper.summary.defaultDurationSeconds / 60)
      : defaultPaperDurationMinutes(paper.summary.examTypeCode)
    paperForm.sections = flattenSections(paper.sections)
  } else {
    paperForm.examTypeCode = props.code
    paperForm.title = ''
    paperForm.description = ''
    paperForm.defaultDurationMinutes = defaultPaperDurationMinutes(props.code)
    paperForm.sections = []
  }
}

function searchPapers() {
  appliedPaperKeyword.value = paperFilters.keyword.trim()
}

function getWorkspaceReturnPath() {
  const query = {
    ...route.query,
    tab: activeTab.value,
    paperGroup: paperFilters.groupId || undefined,
    paperSearch: appliedPaperKeyword.value || undefined,
  }
  return router.resolve({ name: 'sat-admin', query }).fullPath
}

function isPaperFolderExpanded(key) {
  return paperFolderExpanded[key] === true
}

function togglePaperFolder(key) {
  paperFolderExpanded[key] = !isPaperFolderExpanded(key)
}

function parseJson(value, fieldName, allowEmpty = false) {
  if (!value.trim() && allowEmpty) return null
  try { return JSON.parse(value || '{}') }
  catch { throw new Error(`${fieldName} must contain valid JSON.`) }
}

function buildStructure() {
  const sectionRows = paperForm.sections || []
  const byCode = new Map()
  const roots = []
  for (const section of sectionRows) {
    if (!section.sectionCode.trim() || !section.title.trim()) throw new Error('Every section needs a code and a title.')
    if (byCode.has(section.sectionCode)) throw new Error('Section codes must be unique within a paper.')
    byCode.set(section.sectionCode, { sectionCode: section.sectionCode, sectionKind: section.sectionKind,
      title: section.title, sortOrder: Number(section.sortOrder) || 0, instructions: section.instructions || null,
      settings: parseJson(section.settingsText, 'Section settings', true), questions: [], children: [] })
  }
  for (const section of sectionRows) {
    const target = byCode.get(section.sectionCode)
    for (const question of section.questions) {
      target.questions.push({ questionTypeCode: question.questionTypeCode, stem: question.stem,
        render: parseJson(question.renderText, 'Question display settings', true),
        answerKey: parseJson(question.answerKeyText, 'Answer key'),
        grading: parseJson(question.gradingText, 'Grading settings', true), explanation: question.explanation || null,
        categoryId: question.categoryId || null, sortOrder: Number(question.sortOrder) || 0,
        displayNumber: question.displayNumber ? Number(question.displayNumber) : null,
        maxPoints: Number(question.maxPoints), scoringSectionCode: question.scoringSectionCode || null })
    }
    const parent = section.parentSectionCode ? byCode.get(section.parentSectionCode) : null
    if (section.parentSectionCode && !parent) throw new Error('A parent section must appear before its child section.')
    ;(parent ? parent.children : roots).push(target)
  }
  return roots
}

async function savePaper() {
  error.value = ''; notice.value = ''; isSaving.value = true
  try {
    if (!paperForm.title.trim()) throw new Error('Enter a paper title.')
    const defaultDurationSeconds = getPaperDurationSeconds()
    if (!selectedPaper.value) {
      selectedPaper.value = await createPaper(paperForm.examTypeCode || props.code, {
        title: paperForm.title, description: paperForm.description || null,
        defaultDurationSeconds,
      })
      if (props.code === 'SAT') {
        await router.push({
          name: 'sat-paper-edit',
          params: { paperId: selectedPaper.value.summary.id },
          query: { returnTo: getWorkspaceReturnPath() },
        })
        return
      }
      await loadWorkspacePapers()
      editorOpen.value = false
      notice.value = 'Draft paper created.'
      return
    }
    const updated = await updatePaper(selectedPaper.value.summary.id, {
      title: paperForm.title, description: paperForm.description || null, groupId: selectedPaper.value.groupId,
      defaultDurationSeconds,
    })
    const saved = await savePaperStructure(updated.summary.id, buildStructure())
    selectedPaper.value = saved
    await loadWorkspacePapers()
    notice.value = 'Paper draft saved.'
  } catch (requestError) { error.value = requestError.message || 'Unable to save this paper.' }
  finally { isSaving.value = false }
}

async function editPaper(summary) {
  if (props.code === 'SAT') {
    error.value = ''
    if (summary.status === 'ARCHIVED') {
      error.value = 'Restore this paper before opening it for editing.'
      return
    }
    try {
      const currentDraft = papers.value
        .filter((paper) => paper.examTypeCode === summary.examTypeCode
          && paper.paperCode === summary.paperCode && paper.status === 'DRAFT')
        .sort((left, right) => right.versionNo - left.versionNo)[0]
      const editablePaper = currentDraft || (summary.status === 'DRAFT'
        || (summary.status === 'READY' && summary.sourcePaperId != null && !summary.usedByExam)
        ? summary
        : (await createPaperVersion(summary.id)).summary)
      if (editablePaper.id !== summary.id) await loadWorkspacePapers()
      await router.push({
        name: 'sat-paper-edit',
        params: { paperId: editablePaper.id },
        query: { returnTo: getWorkspaceReturnPath() },
      })
    } catch (requestError) {
      error.value = requestError.message || 'Unable to open an editable paper version.'
    }
    return
  }
  try { openPaperEditor(await getPaper(summary.id)) }
  catch (requestError) { error.value = requestError.message }
}

function addSection(parentSectionCode = '') {
  const sections = paperForm.sections || []
  const siblingCount = sections.filter((section) => section.parentSectionCode === parentSectionCode).length
  let suffix = sections.length + 1
  while (sections.some((section) => section.sectionCode === `SECTION_${suffix}`)) suffix += 1
  const section = emptySection(`SECTION_${suffix}`, siblingCount)
  section.parentSectionCode = parentSectionCode
  paperForm.sections.push(section)
}

function removeSection(sectionCode) {
  const removed = new Set([sectionCode])
  let updated = true
  while (updated) {
    updated = false
    for (const section of paperForm.sections) {
      if (removed.has(section.parentSectionCode) && !removed.has(section.sectionCode)) {
        removed.add(section.sectionCode)
        updated = true
      }
    }
  }
  paperForm.sections = paperForm.sections.filter((section) => !removed.has(section.sectionCode))
}

async function seal(summary) {
  error.value = ''; notice.value = ''
  try { await sealPaper(summary.id); await loadWorkspacePapers(); notice.value = 'Paper sealed and ready for exam releases.' }
  catch (requestError) { error.value = requestError.message }
}

async function makeVersion(summary) {
  if (creatingVersionPaperId.value != null) return
  error.value = ''; notice.value = ''
  creatingVersionPaperId.value = summary.id
  notice.value = 'Creating a new paper version…'
  try {
    const created = await createPaperVersion(summary.id)
    await loadWorkspacePapers()
    const group = paperGroups.value.find((item) =>
      String(item.idsByType[created.summary.examTypeCode]) === String(created.summary.groupId))
    paperFolderExpanded[group?.key || 'default'] = true
    notice.value = `Version v${created.summary.versionNo} was created.`
  } catch (requestError) {
    error.value = requestError.message || 'Unable to create a new paper version.'
  } finally {
    creatingVersionPaperId.value = null
  }
}

function localDateTime(hoursFromNow) {
  const value = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset())
  return value.toISOString().slice(0, 16)
}

function defaultReleaseDurationMinutes(paper) {
  const paperMinutes = Number(paper?.defaultDurationSeconds) / 60
  return Number.isFinite(paperMinutes) && paperMinutes > 0
    ? Math.round(paperMinutes)
    : defaultPaperDurationMinutes(paper?.examTypeCode || props.code)
}

function toggleAllReleaseClasses() {
  selectedClassIds.value = allReleaseClassesSelected.value
    ? []
    : activeReleaseClassIds.value.map(Number)
}

function clearReleaseClassSelection() {
  selectedClassIds.value = []
}

function openRelease() {
  error.value = ''; notice.value = ''; draftExamId.value = null
  draftPaperTitle.value = ''; draftHadTargets.value = false
  selectedClassIds.value = []; selectedStudentIds.value = []
  const firstPaper = readyPapers.value[0]
  releaseForm.paperId = firstPaper?.id || ''
  releaseForm.title = ''; releaseForm.description = ''
  releaseForm.opensAt = localDateTime(1); releaseForm.closesAt = localDateTime(25)
  releaseForm.durationMinutes = firstPaper ? defaultReleaseDurationMinutes(firstPaper) : defaultPaperDurationMinutes(props.code)
  releaseForm.attemptLimit = 1
  releaseForm.targetScope = 'SELECTED'
  releaseOpen.value = true
}

function openDraftList() {
  error.value = ''
  draftListOpen.value = true
}

async function resumeDraft(exam) {
  error.value = ''; notice.value = ''; isSaving.value = true
  try {
    const detail = await getExam(exam.id)
    const summary = detail.summary
    draftExamId.value = summary.id
    draftPaperTitle.value = summary.paperTitle || exam.paperTitle || 'Paper unavailable'
    draftHadTargets.value = detail.classIds.length > 0 || detail.studentUserIds.length > 0
    selectedClassIds.value = detail.classIds
    selectedStudentIds.value = detail.studentUserIds
    Object.assign(releaseForm, {
      paperId: summary.paperId,
      title: summary.title,
      description: summary.description || '',
      opensAt: toLocalDateTime(summary.opensAt),
      closesAt: toLocalDateTime(summary.closesAt),
      durationMinutes: Math.round((summary.durationSeconds || 0) / 60),
      attemptLimit: summary.attemptLimit || 1,
      targetScope: summary.targetScope || 'SELECTED',
    })
    draftListOpen.value = false
    releaseOpen.value = true
  } catch (requestError) {
    error.value = requestError.message || 'Unable to open this draft.'
  } finally {
    isSaving.value = false
  }
}

function toLocalDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

watch(() => releaseForm.paperId, (paperId) => {
  if (!releaseOpen.value || !paperId) return
  const paper = readyPapers.value.find((item) => String(item.id) === String(paperId))
  if (paper) releaseForm.durationMinutes = defaultReleaseDurationMinutes(paper)
})

watch(() => releaseForm.targetScope, (scope) => {
  if (scope === 'ALL_STUDENTS') {
    selectedClassIds.value = []
    selectedStudentIds.value = []
  }
})

function closeRelease() {
  if (isSaving.value) return
  releaseOpen.value = false
}

async function saveAndPublishExam() {
  error.value = ''; notice.value = ''
  if (releaseForm.targetScope !== 'ALL_STUDENTS'
      && selectedClassIds.value.length === 0 && selectedStudentIds.value.length === 0) {
    error.value = 'Select at least one class or student, or choose all active students.'
    return
  }
  isSaving.value = true
  try {
    await persistExamDraft()
    await publishExam(draftExamId.value)
    await loadWorkspaceExams()
    releaseOpen.value = false
    showNotification({ title: 'Exam published', message: 'Students joining a target class during the exam window will be added automatically.', variant: 'success' })
  } catch (requestError) { error.value = requestError.message || 'Unable to publish this exam.' }
  finally { isSaving.value = false }
}

async function persistExamDraft() {
  if (!releaseForm.title.trim()) throw new Error('Enter an exam title.')
  if (!releaseForm.paperId) throw new Error('Select a paper.')
  if (!releaseForm.opensAt || !releaseForm.closesAt) throw new Error('Choose an opening and closing time.')
  if (new Date(releaseForm.closesAt) <= new Date(releaseForm.opensAt)) throw new Error('The closing time must be after the opening time.')
  if (releaseForm.targetScope === 'SELECTED' && draftHadTargets.value
      && selectedClassIds.value.length === 0 && selectedStudentIds.value.length === 0) {
    throw new Error('Keep at least one selected class or student, or choose all active students.')
  }
  const request = {
    title: releaseForm.title,
    description: releaseForm.description || null,
    opensAt: new Date(releaseForm.opensAt).toISOString(),
    closesAt: new Date(releaseForm.closesAt).toISOString(),
    durationSeconds: releaseForm.durationMinutes ? Number(releaseForm.durationMinutes) * 60 : null,
    attemptLimit: Number(releaseForm.attemptLimit),
    targetScope: releaseForm.targetScope,
  }

  if (!draftExamId.value) {
    const created = await createExam(releaseForm.paperId, request)
    draftExamId.value = created.summary.id
  } else {
    await updateExam(draftExamId.value, request)
  }

  if (releaseForm.targetScope === 'ALL_STUDENTS') {
    draftHadTargets.value = false
  } else if (selectedClassIds.value.length || selectedStudentIds.value.length) {
    await saveExamTargets(draftExamId.value, {
      classIds: selectedClassIds.value.map(Number),
      studentUserIds: selectedStudentIds.value.map(Number),
    })
    draftHadTargets.value = true
  }
}

async function saveExamDraft() {
  error.value = ''; notice.value = ''; isSaving.value = true
  try {
    await persistExamDraft()
    await loadWorkspaceExams()
    draftOpenSuccess()
  } catch (requestError) {
    error.value = requestError.message || 'Unable to save this draft.'
  } finally {
    isSaving.value = false
  }
}

function draftOpenSuccess() {
  releaseOpen.value = false
  showNotification({ title: 'Draft saved', message: 'You can return to this exam from the Drafts list.', variant: 'success' })
}

function examAvailability(exam) {
  const now = Date.now()
  if (new Date(exam.opensAt).getTime() > now) return 'Upcoming'
  if (new Date(exam.closesAt).getTime() <= now) return 'Closed'
  return 'Available'
}

function formatExamDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not set' : new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

function toggleAvailableExams() {
  availableExamsCollapsed.value = !availableExamsCollapsed.value
  localStorage.setItem(`admin.available-exams-collapsed.${props.code}`, String(availableExamsCollapsed.value))
}

// SHSAT 使用专属考试页；其他类型的可用练习通过统一作答 API 创建并续考。
async function openStudentExam(exam) {
  if (startingExamId.value !== null) return
  error.value = ''
  startingExamId.value = exam.id
  try {
    if (exam.examTypeCode === 'SHSAT') {
      await router.push({
        name: isStaff.value ? 'student-exam' : 'shsat-student-exam',
        params: { examId: exam.id },
        query: isStaff.value ? {} : { returnTo: route.fullPath },
      })
      return
    }

    if (!isStaff.value) {
      await router.push({ name: 'sat-student-exam', params: { examId: exam.id } })
      return
    }

    const attempt = await startStudentAttempt(exam.id)
    await router.push({ name: 'student-attempt', params: { attemptId: attempt.id } })
  } catch (requestError) {
    error.value = requestError.message || 'Unable to start this exam.'
  } finally {
    startingExamId.value = null
  }
}

function viewAttempt(exam) {
  if (['SAT', 'PSAT'].includes(exam.examTypeCode)) {
    router.push({ name: 'sat-report', query: { examId: exam.id, recordId: exam.latestAttemptId } })
    return
  }
  router.push({ name: 'student-attempt', params: { attemptId: exam.latestAttemptId } })
}

watch([error, notice], ([errorMessage, successMessage]) => {
  if (props.code !== 'SAT' && (editorOpen.value || releaseOpen.value || paperActionDialog.value)) return
  if (errorMessage) {
    showNotification({ title: 'Action failed', message: errorMessage, variant: 'error' })
  } else if (successMessage) {
    showNotification({ title: 'Changes saved', message: successMessage, variant: 'success' })
  }
})

watch([folderDialogError, renameFolderError, paperActionDialogError, examPublicationError], (messages) => {
  if (props.code !== 'SAT') return
  const message = messages.find(Boolean)
  if (message) showNotification({ title: 'Action failed', message, variant: 'error' })
})

onMounted(() => {
  loadPage()
  syncExamReleaseRefresh()
})
watch(activeTab, syncExamReleaseRefresh)
watch(() => props.code, (code) => {
  availableExamsCollapsed.value = localStorage.getItem(`admin.available-exams-collapsed.${code}`) === 'true'
  loadPage()
  syncExamReleaseRefresh()
})
</script>

<template>
  <div class="page-content type-page-content">
    <Teleport to="body">
      <Transition name="exam-notification">
        <div v-if="notification.open" class="exam-notification" :class="`exam-notification--${notification.variant}`" role="status" aria-live="polite">
          <span class="exam-notification__icon" aria-hidden="true">{{ notification.variant === 'success' ? '✓' : notification.variant === 'error' ? '!' : 'i' }}</span>
          <span class="exam-notification__copy">
            <strong>{{ notification.title }}</strong>
            <small>{{ notification.message }}</small>
          </span>
          <button type="button" aria-label="Dismiss notification" @click="dismissNotification">×</button>
        </div>
      </Transition>
    </Teleport>
    <RouterLink v-if="!(isStaff && props.code === 'SAT')" class="back-link" to="/">← Back to exam types</RouterLink>
    <section v-if="selectedType && !(isStaff && props.code === 'SAT')" class="module-intro type-workspace-intro">
      <div class="eyebrow"><span class="eyebrow-line"></span>{{ isStaff ? 'EXAM MANAGEMENT' : 'STUDENT WORKSPACE' }}</div>
      <span class="module-code">{{ selectedType.code }}</span>
      <h1>{{ selectedType.displayName }}</h1>
      <p>{{ selectedType.summary }}</p>
    </section>
    <section v-if="!selectedType && !isLoading" class="module-intro">
      <h1>Exam type not found</h1><p>This exam type is not available.</p>
    </section>

    <template v-else-if="isStaff && selectedType">
      <AppCard v-if="canManageWorkspace" class="sat-available-exams" title="Available Exams" :subtitle="availableExamSubtitle">
        <button
          class="collapse-arrow-button"
          type="button"
          :aria-expanded="!availableExamsCollapsed"
          :title="availableExamsCollapsed ? 'Expand available exams' : 'Collapse available exams'"
          @click="toggleAvailableExams"
        >
          <svg class="collapse-arrow-button__icon" :class="{ 'collapse-arrow-button__icon--collapsed': availableExamsCollapsed }" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <template v-if="!availableExamsCollapsed">
          <div v-if="isLoading" class="table-empty">Loading exams...</div>
          <div v-else-if="!publishedExams.length" class="table-empty">No available exams right now.</div>
          <div v-else class="admin-exam-grid">
            <AdminExamCard
              v-for="exam in publishedExams"
              :key="exam.id"
              :title="exam.title"
              :status-label="examAvailability(exam) === 'Upcoming' ? 'Scheduled' : exam.status"
              :status-tone="examAvailability(exam) === 'Upcoming' ? 'pending' : 'active'"
              :description="exam.description || exam.paperTitle"
              :metadata="[
                { label: 'Available', value: `${formatExamDate(exam.opensAt)} - ${formatExamDate(exam.closesAt)}`, wide: true },
                { label: 'Program', value: exam.examTypeCode || props.code },
                { label: 'Paper', value: exam.paperTitle || 'Not set' },
                { label: 'Duration', value: exam.durationSeconds ? `${Math.round(exam.durationSeconds / 60)} min` : 'Use paper default' },
              ]"
            >
              <template #actions>
                <AppButton
                  :disabled="startingExamId === exam.id || examAvailability(exam) !== 'Available'"
                  @click="openStudentExam(exam)"
                >
                  {{ startingExamId === exam.id ? 'Starting…' : examAvailability(exam) === 'Upcoming' ? 'Opens soon' : isStaff ? 'Start practice' : 'Start exam' }}
                </AppButton>
              </template>
            </AdminExamCard>
          </div>
        </template>
      </AppCard>

      <div class="sat-admin-workspace">
        <AdminTabs v-model="activeTab" :tabs="visibleAdminTabs" aria-label="Admin Features" />
        <AdminSection>
        <AdminTabPanels :active-key="activeTab">
        <ClassesPage v-if="activeTab === 'classes'" :exam-type-code="props.code" />

      <AppCard v-if="activeTab === 'papers'" class="paper-list-card" title="Paper List" subtitle="View paper summaries and manage SAT and PSAT paper versions.">
        <div class="paper-list-toolbar">
          <form class="paper-list-toolbar__search" @submit.prevent="searchPapers">
            <select v-model="paperFilters.groupId" class="form-input form-input--compact" aria-label="Folder">
              <option value="">All folders</option>
              <option value="default">Default Folder</option>
              <option v-for="group in paperGroups" :key="group.key" :value="group.key">{{ group.name }}</option>
            </select>
            <input
              v-model="paperFilters.keyword"
              class="form-input paper-search-input"
              placeholder="Paper name"
            />
            <AppButton type="submit" variant="secondary">Search</AppButton>
          </form>
          <div class="paper-list-toolbar__actions">
            <AppButton variant="secondary" @click="openFolderDialog">Create Folder</AppButton>
            <AppButton @click="openPaperEditor()">Create Paper</AppButton>
          </div>
        </div>
        <div v-if="papers.length || paperGroups.length" class="folder-list folder-list--reorderable">
          <section
            v-for="folder in paperFolderSections"
            :key="folder.key"
            class="folder-panel"
            :class="{
              'folder-panel--draggable': Boolean(folder.group),
              'folder-panel--dragging': draggingPaperFolderKey === folder.key,
            }"
            :draggable="Boolean(folder.group) && !isReorderingPaperFolders"
            @dragstart="startPaperFolderDrag(folder, $event)"
            @dragover="dragOverPaperFolder(folder, $event)"
            @drop="dropPaperFolder(folder, $event)"
            @dragend="finishPaperFolderDrag"
          >
            <div class="folder-panel__header" :class="{ 'folder-panel__header--open': isPaperFolderExpanded(folder.key) }">
              <button class="folder-panel__main-button" type="button" :aria-expanded="isPaperFolderExpanded(folder.key)" @click="togglePaperFolder(folder.key)">
                <span class="folder-panel__toggle" aria-hidden="true"></span>
                <span class="folder-panel__title"><strong>{{ folder.name }}</strong></span>
                <small>{{ folder.items.length }} {{ folder.items.length === 1 ? 'paper' : 'papers' }}</small>
              </button>
              <div v-if="folder.group" class="folder-panel__actions">
                <button class="folder-panel__icon-button" type="button" aria-label="Rename folder" title="Rename folder" @click="openRenamePaperFolder(folder.group)">✎</button>
                <button v-if="folder.totalItems === 0" class="folder-panel__icon-button folder-panel__icon-button--danger" type="button" aria-label="Delete empty folder" title="Delete empty folder" @click="deletePaperFolder(folder.group)">×</button>
              </div>
            </div>
            <div v-if="isPaperFolderExpanded(folder.key) && folder.items.length" class="table-wrap">
              <AdminDataTable class="paper-table">
                <thead><tr><th>Paper</th><th>Version</th><th>Type</th><th>Duration</th><th>Status</th><th class="paper-actions-header">Actions</th></tr></thead>
                <tbody>
                  <tr v-for="paper in folder.items" :key="paper.id">
                    <td><strong>{{ paper.title }}</strong></td>
                    <td>v{{ paper.versionNo }}</td>
                    <td><span class="program-badge">{{ paper.examTypeCode }}</span></td>
                    <td>{{ paper.defaultDurationSeconds ? `${Math.round(paper.defaultDurationSeconds / 60)} min` : 'No time limit' }}</td>
                    <td>{{ paper.status }}</td>
                    <td class="paper-actions-cell">
                      <AdminActionMenu
                        v-if="props.code === 'SAT'"
                        label="Paper actions"
                        :open="openPaperActionMenuId === paper.id"
                        @update:open="setPaperActionMenuOpen(paper.id, $event)"
                      >
                        <button type="button" @click="handlePaperAction(() => openMovePaperDialog(paper))">Move</button>
                        <button type="button" @click="handlePaperAction(() => showPaperDetails(paper))">Detail</button>
                        <button v-if="paper.status !== 'ARCHIVED'" type="button" @click="handlePaperAction(() => openEditPaperInfoDialog(paper))">Edit Info</button>
                        <button v-if="paper.status !== 'ARCHIVED'" type="button" @click="handlePaperAction(() => editPaper(paper))">Edit Paper</button>
                        <button type="button" :disabled="creatingVersionPaperId !== null" @click="handlePaperAction(() => makeVersion(paper))">{{ creatingVersionPaperId === paper.id ? 'Creating…' : 'New version' }}</button>
                        <button v-if="paper.status === 'DRAFT'" type="button" @click="handlePaperAction(() => seal(paper))">Seal</button>
                        <button v-else type="button" @click="handlePaperAction(() => openPaperActionDialog(paper.status === 'ARCHIVED' ? 'restore' : 'archive', paper))">{{ paper.status === 'ARCHIVED' ? 'Restore' : 'Archive' }}</button>
                        <button class="admin-action-menu__danger" type="button" @click="handlePaperAction(() => openPaperActionDialog('delete', paper))">Delete</button>
                      </AdminActionMenu>
                      <div v-else class="table-actions">
                        <button v-if="paper.status === 'DRAFT'" @click="editPaper(paper)">Edit</button>
                        <button v-if="paper.status === 'DRAFT'" @click="seal(paper)">Seal</button>
                        <button @click="makeVersion(paper)">New version</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </AdminDataTable>
            </div>
            <div v-else-if="isPaperFolderExpanded(folder.key)" class="folder-panel__empty">{{ appliedPaperKeyword ? 'No papers match the search.' : 'No papers in this folder yet.' }}</div>
          </section>
        </div>
        <div v-else-if="!isLoading" class="admin-state">No papers found.</div>
      </AppCard>

      <AppModal
        v-if="folderDialogOpen"
        title="Create folder"
        :busy="folderCreating"
        @close="folderDialogOpen = false"
      >
        <form id="create-paper-folder-form" class="folder-create-form" @submit.prevent="createPaperFolder">
          <label class="form-field">
            <span class="form-label">Folder name</span>
            <input v-model.trim="folderNameDraft" class="form-input" maxlength="100" autofocus required />
          </label>
          <p v-if="folderDialogError && props.code !== 'SAT'" class="error-text" role="alert">{{ folderDialogError }}</p>
        </form>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="folderCreating" @click="folderDialogOpen = false">Cancel</AppButton>
          <AppButton type="submit" form="create-paper-folder-form" :disabled="folderCreating || !folderNameDraft.trim()">{{ folderCreating ? 'Creating…' : 'Create folder' }}</AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="renameFolderDialogOpen"
        title="Rename folder"
        :busy="renamingFolder"
        @close="renameFolderDialogOpen = false"
      >
        <form id="rename-paper-folder-form" class="folder-create-form" @submit.prevent="renamePaperFolder">
          <label class="form-field">
            <span class="form-label">Folder name</span>
            <input v-model.trim="renameFolderDraft" class="form-input" maxlength="100" autofocus required />
          </label>
          <p v-if="renameFolderError && props.code !== 'SAT'" class="error-text" role="alert">{{ renameFolderError }}</p>
        </form>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="renamingFolder" @click="renameFolderDialogOpen = false">Cancel</AppButton>
          <AppButton type="submit" form="rename-paper-folder-form" :disabled="renamingFolder || !renameFolderDraft.trim()">{{ renamingFolder ? 'Saving…' : 'Save changes' }}</AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="deleteFolderTarget"
        title="Delete folder"
        :busy="paperActionDialogSaving"
        @close="deleteFolderTarget = null"
      >
        <p>Delete the empty folder “{{ deleteFolderTarget.name }}”?</p>
        <p v-if="paperActionDialogError && props.code !== 'SAT'" class="error-text" role="alert">{{ paperActionDialogError }}</p>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="paperActionDialogSaving" @click="deleteFolderTarget = null">Cancel</AppButton>
          <AppButton type="button" variant="danger" :disabled="paperActionDialogSaving" @click="confirmDeletePaperFolder">
            {{ paperActionDialogSaving ? 'Deleting…' : 'Delete folder' }}
          </AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="movePaperTarget"
        title="Move paper"
        :busy="paperActionDialogSaving"
        @close="movePaperTarget = null"
      >
        <form id="move-paper-form" class="paper-action-form" @submit.prevent="movePaper">
          <p>Select a folder for “{{ movePaperTarget.title }}”.</p>
          <label class="form-field">
            <span class="form-label">Folder</span>
            <select v-model="movePaperGroupKey" class="form-input">
              <option value="">Default Folder</option>
              <option v-for="group in paperGroups" :key="group.key" :value="group.key">{{ group.name }}</option>
            </select>
          </label>
          <p v-if="paperActionDialogError && props.code !== 'SAT'" class="error-text" role="alert">{{ paperActionDialogError }}</p>
        </form>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="paperActionDialogSaving" @click="movePaperTarget = null">Cancel</AppButton>
          <AppButton type="submit" form="move-paper-form" :disabled="paperActionDialogSaving">
            {{ paperActionDialogSaving ? 'Moving…' : 'Move paper' }}
          </AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="editPaperTarget"
        title="Edit paper information"
        :busy="paperActionDialogSaving"
        @close="editPaperTarget = null"
      >
        <form id="edit-paper-info-form" class="paper-action-form" @submit.prevent="editPaperInfo">
          <label class="form-field">
            <span class="form-label">Paper name</span>
            <input v-model.trim="editPaperTitle" class="form-input" maxlength="255" autofocus required />
          </label>
          <p v-if="paperActionDialogError && props.code !== 'SAT'" class="error-text" role="alert">{{ paperActionDialogError }}</p>
        </form>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="paperActionDialogSaving" @click="editPaperTarget = null">Cancel</AppButton>
          <AppButton type="submit" form="edit-paper-info-form" :disabled="paperActionDialogSaving || !editPaperTitle.trim() || editPaperTitle.trim() === editPaperTarget.title">
            {{ paperActionDialogSaving ? 'Saving…' : 'Save changes' }}
          </AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="paperActionDialog"
        :title="paperActionDialog.type === 'delete' ? 'Delete paper?' : paperActionDialog.type === 'archive' ? 'Archive paper?' : 'Restore paper?'"
        :busy="paperActionDialogSaving"
        @close="paperActionDialog = null"
      >
        <p v-if="paperActionDialog.type === 'delete'">
          Delete “{{ paperActionDialog.paper.title }}”? Papers used by exams or newer versions cannot be deleted.
        </p>
        <p v-else>
          {{ paperActionDialog.type === 'archive' ? 'Archive' : 'Restore' }} “{{ paperActionDialog.paper.title }}”?
        </p>
        <p v-if="paperActionDialogError && props.code !== 'SAT'" class="error-text" role="alert">{{ paperActionDialogError }}</p>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="paperActionDialogSaving" @click="paperActionDialog = null">Cancel</AppButton>
          <AppButton
            type="button"
            :variant="paperActionDialog.type === 'delete' ? 'danger' : 'primary'"
            :disabled="paperActionDialogSaving"
            @click="confirmPaperAction"
          >
            {{ paperActionDialogSaving ? 'Saving…' : paperActionDialog.type === 'delete' ? 'Delete paper' : paperActionDialog.type === 'archive' ? 'Archive paper' : 'Restore paper' }}
          </AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="paperDetailsTarget"
        title="Paper details"
        :description="paperDetailsTarget.title"
        :busy="paperDetailsLoading"
        @close="paperDetailsTarget = null"
      >
        <div v-if="paperDetailsLoading" class="admin-state">Loading paper details…</div>
        <p v-else-if="paperDetailsError" class="error-text" role="alert">{{ paperDetailsError }}</p>
        <dl v-else-if="paperDetails" class="paper-details-grid">
          <div><dt>Type</dt><dd>{{ paperDetailsTarget.examTypeCode }}</dd></div>
          <div><dt>Version</dt><dd>v{{ paperDetailsTarget.versionNo }}</dd></div>
          <div><dt>Status</dt><dd>{{ paperDetailsTarget.status }}</dd></div>
          <div><dt>Duration</dt><dd>{{ paperDetailsTarget.defaultDurationSeconds ? `${Math.round(paperDetailsTarget.defaultDurationSeconds / 60)} min` : 'No time limit' }}</dd></div>
          <div><dt>Questions</dt><dd>{{ countPaperQuestions(paperDetails.sections || []) }}</dd></div>
          <div class="paper-details-grid__description"><dt>Description</dt><dd>{{ paperDetails.description || 'No description' }}</dd></div>
        </dl>
      </AppModal>

      <AppCard v-if="activeTab === 'exams'" class="sat-exam-releases-card" title="Exam Releases" subtitle="Review exam releases and their availability windows.">
        <div class="card-top-actions">
          <AppButton variant="secondary" @click="openDraftList">Drafts <span class="draft-count">{{ draftExams.length }}</span></AppButton>
          <AppButton class="card-top-actions__primary" :disabled="!readyPapers.length" @click="openRelease">Create Exam</AppButton>
          <button class="admin-refresh-button" type="button" aria-label="Refresh releases" title="Refresh releases" @click="loadWorkspaceExams">
            <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" /></svg>
          </button>
          <button class="collapse-arrow-button" type="button" :aria-label="examReleasesCollapsed ? 'Expand exam releases' : 'Collapse exam releases'" :title="examReleasesCollapsed ? 'Expand' : 'Collapse'" @click="toggleExamReleases">
            <svg class="collapse-arrow-button__icon" :class="{ 'collapse-arrow-button__icon--collapsed': examReleasesCollapsed }" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7.4 14.6 4.6-4.6 4.6 4.6L18 13.2l-6-6-6 6 1.4 1.4Z" /></svg>
          </button>
        </div>
        <template v-if="!examReleasesCollapsed">
        <div class="admin-toolbar release-toolbar">
          <div class="admin-toolbar__filters">
            <input v-model="examKeyword" class="form-input release-search-input" placeholder="Search title or paper" />
          </div>
        </div>
        <div v-if="isLoading" class="admin-state">Loading exams...</div>
        <div
          v-else-if="currentExams.length"
          class="table-wrap sat-exam-release-table-wrap"
          role="region"
          aria-label="Exam releases"
          tabindex="0"
        >
          <AdminDataTable class="sat-exam-release-table">
            <colgroup>
              <col class="sat-exam-release-table__exam-column" />
              <col class="sat-exam-release-table__paper-column" />
              <col class="sat-exam-release-table__type-column" />
              <col class="sat-exam-release-table__availability-column" />
              <col class="sat-exam-release-table__status-column" />
              <col class="sat-exam-release-table__actions-column" />
            </colgroup>
            <thead><tr><th>Exam</th><th>Paper</th><th>Type</th><th>Exam Window</th><th>Duration</th><th class="action-column-header">Actions</th></tr></thead>
            <tbody>
              <tr v-for="exam in visibleExams" :key="exam.id">
                <td class="sat-exam-release-table__title-cell"><strong :title="exam.title">{{ exam.title }}</strong></td>
                <td class="sat-exam-release-table__paper-cell" :title="exam.paperTitle || '—'"><span>{{ exam.paperTitle || '—' }}</span></td>
                <td class="sat-exam-release-table__type-cell"><span class="program-badge">{{ exam.examTypeCode }}</span></td>
                <td class="sat-exam-release-table__availability-cell" :title="`Opens ${formatExamDate(exam.opensAt)} · Closes ${formatExamDate(exam.closesAt)}`">
                  <span class="exam-window-line"><small>Opens</small><time>{{ formatExamDate(exam.opensAt) }}</time></span>
                  <span class="exam-window-line"><small>Closes</small><time>{{ formatExamDate(exam.closesAt) }}</time></span>
                </td>
                <td class="sat-exam-release-table__status-cell">{{ exam.durationSeconds ? `${Math.round(exam.durationSeconds / 60)} min` : '—' }}</td>
                <td class="action-column-cell">
                  <ResponsiveActionGroup v-if="getExamActions(exam).length" align="center" :actions="getExamActions(exam)" :label="`Actions for ${exam.title}`" />
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </AdminDataTable>
        </div>
        <p v-else class="admin-state">{{ !exams.length ? 'No exam releases yet. Seal a paper before creating an exam.' : !filteredExams.length ? 'No releases match your search.' : 'No upcoming or active releases. Ended exams are listed below.' }}</p>
        <div v-if="!examReleasesCollapsed && currentExams.length" class="exam-list-pagination">
          <span>Showing {{ (currentExamPage - 1) * examPageSize + 1 }}–{{ Math.min(currentExamPage * examPageSize, currentExams.length) }} of {{ currentExams.length }}</span>
          <label>Rows <select v-model.number="examPageSize"><option :value="10">10</option><option :value="20">20</option><option :value="50">50</option></select></label>
          <button type="button" :disabled="currentExamPage <= 1" @click="currentExamPage--">Prev</button>
          <span>Page {{ currentExamPage }} / {{ currentExamPageCount }}</span>
          <button type="button" :disabled="currentExamPage >= currentExamPageCount" @click="currentExamPage++">Next</button>
        </div>
        </template>
      </AppCard>

      <AppCard v-if="activeTab === 'exams'" class="sat-exam-releases-card sat-historical-exams-card" title="Historical Exams" subtitle="Ended releases are kept here for results and review.">
        <div class="card-top-actions">
          <span class="historical-exam-count">{{ historicalExams.length }} {{ historicalExams.length === 1 ? 'exam' : 'exams' }}</span>
          <button class="admin-refresh-button" type="button" aria-label="Refresh historical exams" title="Refresh historical exams" @click="loadWorkspaceExams">
            <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" /></svg>
          </button>
          <button class="collapse-arrow-button" type="button" :aria-label="historicalExamsCollapsed ? 'Expand historical exams' : 'Collapse historical exams'" :title="historicalExamsCollapsed ? 'Expand' : 'Collapse'" @click="toggleHistoricalExams">
            <svg class="collapse-arrow-button__icon" :class="{ 'collapse-arrow-button__icon--collapsed': historicalExamsCollapsed }" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7.4 14.6 4.6-4.6 4.6 4.6L18 13.2l-6-6-6 6 1.4 1.4Z" /></svg>
          </button>
        </div>
        <div v-if="!historicalExamsCollapsed && !isLoading && historicalExams.length" class="table-wrap sat-exam-release-table-wrap" role="region" aria-label="Historical exams" tabindex="0">
          <AdminDataTable class="sat-exam-release-table">
            <colgroup>
              <col class="sat-exam-release-table__exam-column" />
              <col class="sat-exam-release-table__paper-column" />
              <col class="sat-exam-release-table__type-column" />
              <col class="sat-exam-release-table__availability-column" />
              <col class="sat-exam-release-table__status-column" />
              <col class="sat-exam-release-table__actions-column" />
            </colgroup>
            <thead><tr><th>Exam</th><th>Paper</th><th>Type</th><th>Ended</th><th>Status</th><th class="action-column-header">Actions</th></tr></thead>
            <tbody>
              <tr v-for="exam in visibleHistoricalExams" :key="exam.id">
                <td class="sat-exam-release-table__title-cell"><strong :title="exam.title">{{ exam.title }}</strong></td>
                <td class="sat-exam-release-table__paper-cell" :title="exam.paperTitle || '—'"><span>{{ exam.paperTitle || '—' }}</span></td>
                <td class="sat-exam-release-table__type-cell"><span class="program-badge">{{ exam.examTypeCode }}</span></td>
                <td class="sat-exam-release-table__availability-cell"><time>{{ formatExamDate(exam.updatedAt || exam.closesAt) }}</time></td>
                <td class="sat-exam-release-table__status-cell"><span class="status-pill">{{ exam.status === 'CANCELLED' ? 'Cancelled' : 'Ended' }}</span></td>
                <td class="action-column-cell"><ResponsiveActionGroup align="center" :actions="getExamActions(exam)" :label="`Actions for ${exam.title}`" /></td>
              </tr>
            </tbody>
          </AdminDataTable>
        </div>
        <div v-if="!historicalExamsCollapsed && historicalExams.length" class="exam-list-pagination">
          <span>Showing {{ (historicalExamPage - 1) * examPageSize + 1 }}–{{ Math.min(historicalExamPage * examPageSize, historicalExams.length) }} of {{ historicalExams.length }}</span>
          <label>Rows <select v-model.number="examPageSize"><option :value="10">10</option><option :value="20">20</option><option :value="50">50</option></select></label>
          <button type="button" :disabled="historicalExamPage <= 1" @click="historicalExamPage--">Prev</button>
          <span>Page {{ historicalExamPage }} / {{ historicalExamPageCount }}</span>
          <button type="button" :disabled="historicalExamPage >= historicalExamPageCount" @click="historicalExamPage++">Next</button>
        </div>
        <p v-else-if="!historicalExamsCollapsed && isLoading" class="admin-state">Loading historical exams…</p>
        <p v-else-if="!historicalExamsCollapsed" class="admin-state">{{ exams.length && !historicalExams.length ? 'No historical exams match your search.' : 'No historical exams yet.' }}</p>
      </AppCard>

      <AppModal v-if="draftListOpen" title="Exam Drafts" description="Continue editing a draft, publish it, or remove it." :busy="isSaving" @close="draftListOpen = false">
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <div v-if="draftExams.length" class="draft-list">
          <article v-for="draft in draftExams" :key="draft.id" class="draft-list__row">
            <div class="draft-list__identity">
              <strong>{{ draft.title }}</strong>
              <span>{{ draft.paperTitle || 'Paper unavailable' }}</span>
            </div>
            <div class="draft-list__meta">
              <span>Updated</span>
              <time>{{ formatExamDate(draft.updatedAt || draft.createdAt) }}</time>
            </div>
            <ResponsiveActionGroup
              align="center"
              :actions="[
                { label: 'Edit draft', onSelect: () => resumeDraft(draft) },
                { label: 'Delete', danger: true, onSelect: () => { draftListOpen = false; openDeleteExamConfirm(draft) } },
              ]"
              :label="`Actions for ${draft.title}`"
            />
          </article>
        </div>
        <p v-else class="draft-list__empty">No exam drafts yet. Save an exam as a draft to continue later.</p>
      </AppModal>

      <AppModal
        v-if="examCloseTarget"
        title="End this exam now?"
        eyebrow="End Release"
        :busy="examActionId === examCloseTarget.id"
        @close="examCloseTarget = null"
      >
        <p class="exam-delete-warning">Students will no longer be able to start this exam. Students already in progress can still submit their work.</p>
        <p v-if="examCloseError" class="error-text" role="alert">{{ examCloseError }}</p>
        <template #footer>
          <AppButton variant="secondary" :disabled="examActionId !== null" @click="examCloseTarget = null">Cancel</AppButton>
          <AppButton :disabled="examActionId !== null" @click="confirmCloseExam">{{ examActionId === examCloseTarget.id ? 'Ending…' : 'End Exam' }}</AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="examPublicationTarget"
        :title="examPublicationTarget.status === 'PUBLISHED' ? 'Unpublish this exam?' : 'Publish this exam?'"
        :description="examPublicationTarget.status === 'PUBLISHED'
          ? 'Students will no longer be able to start new attempts after this release is unpublished.'
          : 'This exam will become available to its selected students and classes during the scheduled window.'"
        :busy="examActionId === examPublicationTarget.id"
        @close="closeExamPublicationConfirm"
      >
        <dl class="paper-details-grid exam-publication-details">
          <div>
            <dt>Exam</dt>
            <dd>{{ examPublicationTarget.title }}</dd>
          </div>
          <div>
            <dt>Paper</dt>
            <dd>{{ examPublicationTarget.paperTitle || '—' }}</dd>
          </div>
          <div>
            <dt>Exam window</dt>
            <dd>{{ formatExamDate(examPublicationTarget.opensAt) }} – {{ formatExamDate(examPublicationTarget.closesAt) }}</dd>
          </div>
        </dl>
        <p v-if="examPublicationError" class="error-text exam-publication-error" role="alert">{{ examPublicationError }}</p>
        <template #footer>
          <AppButton variant="secondary" :disabled="examActionId !== null" @click="closeExamPublicationConfirm">Cancel</AppButton>
          <AppButton
            :variant="examPublicationTarget.status === 'PUBLISHED' ? 'secondary' : 'primary'"
            :disabled="examActionId !== null"
            @click="confirmExamPublication"
          >
            {{ examActionId === examPublicationTarget.id ? 'Updating…' : examPublicationTarget.status === 'PUBLISHED' ? 'Unpublish Exam' : 'Publish Exam' }}
          </AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="examDeleteTarget"
        title="Delete exam permanently?"
        eyebrow="Delete Release"
        :busy="examActionId === examDeleteTarget.id"
        @close="closeDeleteExamConfirm"
      >
        <p class="exam-delete-warning">
          This permanently deletes the exam and all related student attempts, answers, scores, reports, and review assignments. This cannot be undone.
        </p>
        <p class="exam-delete-cooldown" :class="{ 'exam-delete-cooldown--ready': examDeleteCooldown === 0 }" aria-live="polite">
          {{ examDeleteCooldown > 0 ? `You can confirm deletion in ${examDeleteCooldown} ${examDeleteCooldown === 1 ? 'second' : 'seconds'}.` : 'You can now confirm permanent deletion.' }}
        </p>
        <template #footer>
          <AppButton variant="secondary" :disabled="examActionId !== null" @click="closeDeleteExamConfirm">Cancel</AppButton>
          <AppButton :disabled="examActionId !== null || examDeleteCooldown > 0" @click="confirmDeleteExam">
            {{ examActionId !== null ? 'Deleting…' : examDeleteCooldown > 0 ? `Delete Exam (${examDeleteCooldown})` : 'Delete Exam Permanently' }}
          </AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="editorOpen"
        :title="selectedPaper ? 'Edit paper' : 'Create paper'"
        :width="selectedPaper ? '1100px' : '680px'"
        :busy="isSaving"
        @close="editorOpen = false"
      >
        <div class="account-form paper-meta-form paper-editor-fields"><label class="wide-field">Title<input v-model.trim="paperForm.title" maxlength="200" required /></label><label v-if="props.code === 'SAT'">Paper type<select v-model="paperForm.examTypeCode"><option value="SAT">SAT</option><option value="PSAT">PSAT</option></select></label><label>Default duration (minutes)<input v-model.number="paperForm.defaultDurationMinutes" type="number" min="1" step="1" required /></label><label class="wide-field">Description<textarea v-model.trim="paperForm.description" rows="2" maxlength="2000"></textarea></label></div>
        <template v-if="selectedPaper">
          <div class="structure-heading"><div><span class="eyebrow">PAPER STRUCTURE</span><p>Build sections and questions. Child sections can represent modules or parts.</p></div><button class="secondary-button" @click="addSection()">Add section <span>＋</span></button></div>
          <article v-for="(section, sectionIndex) in paperForm.sections" :key="section.sectionCode" class="section-editor">
            <div class="section-editor-heading"><span class="section-number">{{ String(sectionIndex + 1).padStart(2, '0') }}</span><strong>{{ section.title || 'New section' }}</strong><button class="text-button" @click="removeSection(section.sectionCode)">Remove section</button></div>
            <div class="account-form section-fields paper-editor-fields"><label>Section code<input v-model.trim="section.sectionCode" maxlength="60" /></label><label>Section type<select v-model="section.sectionKind"><option>SUBJECT</option><option>MODULE</option><option>PART</option><option>SUBTYPE</option></select></label><label>Title<input v-model.trim="section.title" maxlength="200" /></label><label>Parent section<select v-model="section.parentSectionCode"><option value="">Top level</option><option v-for="parent in paperForm.sections.slice(0, sectionIndex)" :key="parent.sectionCode" :value="parent.sectionCode">{{ parent.title || parent.sectionCode }}</option></select></label><label class="wide-field">Instructions<textarea v-model="section.instructions" rows="2"></textarea></label><label class="wide-field">Section settings (JSON)<textarea v-model="section.settingsText" rows="2" placeholder="Optional JSON"></textarea></label></div>
            <div class="question-editor" v-for="(question, questionIndex) in section.questions" :key="questionIndex"><div class="question-editor-heading"><strong>Question {{ questionIndex + 1 }}</strong><button class="text-button" @click="section.questions.splice(questionIndex, 1)">Remove</button></div><div class="account-form section-fields paper-editor-fields"><label>Question type<input v-model.trim="question.questionTypeCode" maxlength="50" /></label><label>Display number<input v-model.number="question.displayNumber" type="number" min="1" /></label><label>Points<input v-model.number="question.maxPoints" type="number" min="0" step="0.25" /></label><label class="wide-field">Prompt<textarea v-model="question.stem" rows="3" required></textarea></label><label>Display settings (JSON)<textarea v-model="question.renderText" rows="5" placeholder="Options and type-specific display data"></textarea></label><label>Answer key (JSON)<textarea v-model="question.answerKeyText" rows="5" placeholder="Correct answer and scoring data"></textarea></label><label>Grading settings (JSON)<textarea v-model="question.gradingText" rows="3" placeholder="Optional"></textarea></label><label>Explanation<textarea v-model="question.explanation" rows="3"></textarea></label></div></div>
            <button class="text-button add-question" @click="section.questions.push(emptyQuestion(section.questions.length))">＋ Add question to {{ section.title || 'section' }}</button>
            <button class="text-button add-question" @click="addSection(section.sectionCode)">＋ Add child section</button>
          </article>
        </template>
        <template #footer>
          <p v-if="error && props.code !== 'SAT'" class="form-error modal-form-error" role="alert">{{ error }}</p>
          <AppButton variant="secondary" :disabled="isSaving" @click="editorOpen = false">Cancel</AppButton>
          <AppButton :disabled="isSaving" @click="savePaper">{{ isSaving ? 'Saving…' : selectedPaper ? 'Save draft' : 'Create paper' }}</AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="releaseOpen"
        :title="draftExamId ? 'Edit Exam Draft' : 'Create Exam'"
        description="Choose the paper, schedule, duration, and students who can access this exam."
        width="820px"
        panel-class="app-modal--exam-release"
        :busy="isSaving"
        @close="closeRelease"
      >
        <form id="create-exam-release-form" class="exam-release-create-form" @submit.prevent="saveAndPublishExam">
          <section class="exam-release-create-section">
            <h3>Exam details</h3>
            <div class="exam-release-create-grid">
              <label class="form-field exam-release-create-grid__wide">
                <span class="form-label">Title</span>
                <input v-model.trim="releaseForm.title" class="form-input" maxlength="200" placeholder="Exam title" required />
              </label>
              <label class="form-field exam-release-create-grid__wide">
                <span class="form-label">Paper</span>
                <select v-model="releaseForm.paperId" class="form-input" :disabled="Boolean(draftExamId)" required>
                  <option value="" disabled>Select a ready paper</option>
                  <option v-for="paper in readyPapers" :key="paper.id" :value="paper.id">{{ paper.title }} · v{{ paper.versionNo }}</option>
                  <option v-if="draftExamId && !readyPapers.some((paper) => String(paper.id) === String(releaseForm.paperId))" :value="releaseForm.paperId">{{ draftPaperTitle }} · unavailable for new releases</option>
                </select>
                <small v-if="draftExamId" class="exam-release-field-hint">The paper is fixed after an exam draft is created.</small>
              </label>
              <label class="form-field">
                <span class="form-label">Duration (minutes)</span>
                <input v-model.number="releaseForm.durationMinutes" class="form-input" type="number" min="1" step="1" placeholder="Use paper default" />
                <small v-if="selectedReleasePaper" class="exam-release-field-hint">
                  {{ selectedReleasePaper.defaultDurationSeconds ? `Pre-filled from the paper default: ${Math.round(selectedReleasePaper.defaultDurationSeconds / 60)} minutes.` : 'No default duration is set for this paper.' }}
                </small>
              </label>
              <label class="form-field">
                <span class="form-label">Attempt limit</span>
                <input v-model.number="releaseForm.attemptLimit" class="form-input" type="number" min="1" step="1" required />
              </label>
              <label class="form-field exam-release-create-grid__wide">
                <span class="form-label">Description</span>
                <textarea v-model.trim="releaseForm.description" class="form-input" rows="2" maxlength="2000" placeholder="Optional description" />
              </label>
            </div>
          </section>

          <section class="exam-release-create-section">
            <h3>Schedule</h3>
            <div class="exam-release-create-grid">
              <label class="form-field">
                <span class="form-label">Start time</span>
                <input v-model="releaseForm.opensAt" class="form-input" type="datetime-local" required />
              </label>
              <label class="form-field">
                <span class="form-label">End time</span>
                <input v-model="releaseForm.closesAt" class="form-input" type="datetime-local" required />
              </label>
            </div>
          </section>

          <section class="exam-release-create-section">
            <h3>Who can take this exam?</h3>
            <div class="exam-release-audience-options">
              <label class="exam-release-audience-option">
                <input v-model="releaseForm.targetScope" type="radio" value="SELECTED" />
                <span><strong>Selected classes and students</strong><small>Choose the specific groups or accounts below.</small></span>
              </label>
              <label class="exam-release-audience-option">
                <input v-model="releaseForm.targetScope" type="radio" value="ALL_STUDENTS" />
                <span><strong>All active students</strong><small>Every active student account can access the exam.</small></span>
              </label>
            </div>
          </section>

          <section v-if="releaseForm.targetScope === 'SELECTED'" class="exam-release-create-section">
            <div class="exam-release-create-section__heading">
              <div>
                <h3>Classes</h3>
                <span>{{ selectedClassIds.length }} of {{ activeReleaseClassIds.length }} active classes selected</span>
              </div>
              <button v-if="selectedClassIds.length" class="exam-release-clear-selection" type="button" @click="clearReleaseClassSelection">Clear selection</button>
            </div>
            <label v-if="activeReleaseClassIds.length" class="exam-release-select-all-option">
              <input
                type="checkbox"
                :checked="allReleaseClassesSelected"
                :indeterminate="selectedClassIds.length > 0 && !allReleaseClassesSelected"
                aria-label="Select all active classes"
                @change="toggleAllReleaseClasses"
              />
              <span><strong>Select all classes</strong><small>Only active classes can be included.</small></span>
            </label>
            <div v-if="sortedReleaseClasses.length" class="exam-release-target-list exam-release-target-list--classes">
              <label v-for="classroom in sortedReleaseClasses" :key="classroom.id" class="exam-release-target-option" :class="{ 'is-disabled': classroom.status !== 'ACTIVE' }">
                <input v-model="selectedClassIds" type="checkbox" :value="classroom.id" :disabled="classroom.status !== 'ACTIVE'" />
                <span><strong>{{ classroom.name }}</strong><small>{{ classroom.studentCount }} students<span v-if="classroom.status !== 'ACTIVE'"> · Inactive</span></small></span>
              </label>
            </div>
            <p v-else class="exam-release-create-hint">Create a class before publishing an exam to a class.</p>
            <p class="exam-release-create-policy">Students who join a selected class while the exam is open will be added automatically.</p>
          </section>

          <details class="exam-release-individual-targets">
            <summary>Also assign individual students <span>{{ selectedStudentIds.length }} selected</span></summary>
            <div v-if="students.length" class="exam-release-target-list">
              <label v-for="student in students" :key="student.id" class="exam-release-target-option">
                <input v-model="selectedStudentIds" type="checkbox" :value="student.id" />
                <span><strong>{{ student.realName }}</strong><small>{{ student.username }}</small></span>
              </label>
            </div>
            <p v-else class="exam-release-create-hint">No student accounts are available.</p>
          </details>
        </form>
        <template #footer>
          <p v-if="error" class="error-text exam-release-form-error" role="alert">{{ error }}</p>
          <AppButton type="button" variant="secondary" :disabled="isSaving" @click="closeRelease">Cancel</AppButton>
          <AppButton type="button" variant="secondary" :disabled="isSaving" @click="saveExamDraft">
            {{ isSaving ? 'Saving…' : 'Save draft' }}
          </AppButton>
          <AppButton type="submit" form="create-exam-release-form" :disabled="isSaving || !releaseForm.paperId">
            {{ isSaving ? 'Publishing…' : 'Save & Publish' }}
          </AppButton>
        </template>
      </AppModal>
        </AdminTabPanels>
        </AdminSection>
      </div>
    </template>

    <template v-else-if="selectedType">
      <AppCard v-if="props.code === 'SAT'" class="management-card student-practice-list">
        <div class="card-heading"><div><span class="eyebrow">SAT / PSAT PRACTICE</span><h2>Practice papers</h2><p>Choose a paper to start a timed full-length practice test.</p></div></div>
        <section v-for="group in practicePaperGroups" :key="group.name" class="practice-paper-group">
          <h3>{{ group.name }}</h3>
          <article v-for="paper in group.items" :key="paper.id" class="paper-row">
            <div class="paper-mark">{{ paper.examTypeCode }}</div>
            <div class="paper-copy"><strong>{{ paper.title }}</strong><small>{{ paper.questionCount }} questions · {{ paper.durationSeconds ? `${Math.round(paper.durationSeconds / 60)} min` : 'No time limit' }}</small></div>
            <button class="secondary-button compact-button" :aria-label="`Start practice: ${paper.title}`" :disabled="startingPracticePaperId === paper.id" @click="startPracticePaper(paper)">{{ startingPracticePaperId === paper.id ? 'Opening…' : 'Start practice' }}<span v-if="startingPracticePaperId !== paper.id">↗</span></button>
          </article>
        </section>
        <p v-if="!practicePaperGroups.length && !isLoading" class="table-empty">No practice papers are available yet.</p>
      </AppCard>
      <AppCard v-if="props.code === 'SAT'" class="management-card student-practice-history" :class="{ 'student-practice-history--empty': !studentPracticeHistory.length && !isLoading }">
        <div class="card-heading"><div><span class="eyebrow">YOUR SAT / PSAT PRACTICE</span><h2>Completed practice</h2><p>{{ studentPracticeHistory.length ? 'Review results or remove a practice record from your history.' : 'Your completed SAT and PSAT practices appear here.' }}</p></div></div>
        <div v-if="studentPracticeHistory.length" class="practice-history-list">
          <article v-for="record in studentPracticeHistory" :key="record.attemptId" class="practice-history-row">
            <div class="paper-mark">{{ record.examTypeCode }}</div>
            <div class="paper-copy"><strong>{{ record.paperTitle }}</strong><small>{{ formatExamDate(record.submittedAt) }} · {{ Math.round(record.timeSpentSeconds / 60) }} min</small></div>
            <div class="practice-history-score"><strong>{{ record.rawScore ?? '—' }}<span v-if="record.rawMaximum"> / {{ record.rawMaximum }}</span></strong><small>Raw score</small></div>
            <div class="practice-history-actions">
              <button class="secondary-button compact-button" @click="viewPracticeReport(record)">View report</button>
              <button class="text-button practice-delete-button" @click="practiceHistoryDeleteTarget = record">Delete</button>
            </div>
          </article>
          <div v-if="practiceHistoryTotal > 10" class="practice-history-pagination">
            <button class="secondary-button compact-button" :disabled="practiceHistoryPage <= 1" @click="changePracticeHistoryPage(practiceHistoryPage - 1)">Previous</button>
            <span>Page {{ practiceHistoryPage }} of {{ Math.ceil(practiceHistoryTotal / 10) }}</span>
            <button class="secondary-button compact-button" :disabled="practiceHistoryPage >= Math.ceil(practiceHistoryTotal / 10)" @click="changePracticeHistoryPage(practiceHistoryPage + 1)">Next</button>
          </div>
        </div>
        <p v-else-if="!isLoading" class="table-empty">No completed practice tests yet.</p>
      </AppCard>
      <AppModal v-if="practiceHistoryDeleteTarget" title="Delete practice record" eyebrow="CONFIRM DELETION" :busy="deletingPracticeAttemptId !== null" @close="practiceHistoryDeleteTarget = null">
        <p class="practice-delete-warning">Delete this practice result and its saved answers? This cannot be undone.</p>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="deletingPracticeAttemptId !== null" @click="practiceHistoryDeleteTarget = null">Cancel</AppButton>
          <AppButton type="button" variant="danger" :disabled="deletingPracticeAttemptId !== null" @click="deletePracticeRecord">{{ deletingPracticeAttemptId !== null ? 'Deleting…' : 'Delete record' }}</AppButton>
        </template>
      </AppModal>
      <AppCard v-if="props.code === 'SHSAT' && activeReviewTasks.length" class="management-card student-review-list">
        <div class="card-heading"><div><span class="eyebrow">SHSAT REVIEW</span><h2>Review assignments</h2></div></div>
        <article v-for="task in activeReviewTasks" :key="task.assignmentId" class="paper-row">
          <div class="paper-mark">↻</div>
          <div class="paper-copy">
            <strong>{{ task.title }}</strong>
            <small>{{ task.examTitle }} · {{ task.remainingQuestionCount }} questions remaining<span v-if="task.endAt"> · Due {{ formatExamDate(task.endAt) }}</span></small>
          </div>
          <span class="status-pill" :class="task.status === 'COMPLETED' ? 'is-active' : ''">{{ reviewTaskStatusLabel(task.status) }}</span>
          <button class="secondary-button compact-button" :disabled="!task.canStart || startingReviewTaskId === task.assignmentId" @click="startReviewTask(task)">
            {{ reviewTaskActionLabel(task) }}<span v-if="task.status !== 'ENDED' && startingReviewTaskId !== task.assignmentId">↗</span>
          </button>
        </article>
      </AppCard>
      <AppCard class="management-card student-exam-list" :class="{ 'student-exam-list--empty': !studentExams.length && !isLoading }">
        <div class="card-heading"><div><span class="eyebrow">{{ selectedType.code }} EXAMS</span><h2>Your exams</h2></div></div>
        <article v-for="exam in studentExams" :key="exam.id" class="paper-row">
          <div class="paper-mark">{{ examAvailability(exam) === 'Upcoming' ? '↗' : '•' }}</div>
          <div class="paper-copy"><strong>{{ exam.title }}</strong><small><span v-if="props.code === 'SAT'">{{ exam.examTypeCode }} · </span>{{ exam.paperTitle }} · {{ formatExamDate(exam.opensAt) }} — {{ formatExamDate(exam.closesAt) }}</small></div>
          <span class="status-pill" :class="studentExamStatusClass(exam)">{{ getStudentExamState(exam).label }}</span>
          <button v-if="getStudentExamState(exam).canStart" class="secondary-button compact-button" :disabled="startingExamId === exam.id" @click="openStudentExam(exam)">{{ startingExamId === exam.id ? 'Starting…' : getStudentExamState(exam).startLabel }}<span v-if="startingExamId !== exam.id">↗</span></button>
          <button v-if="getStudentExamState(exam).canViewAttempt" class="text-button" @click="viewAttempt(exam)">View attempt</button>
        </article>
        <p v-if="studentExamError" class="error-text" role="alert">{{ studentExamError }}</p>
        <p v-if="!studentExams.length && !isLoading && !studentExamError" class="table-empty">No exams have been assigned to you yet.</p>
      </AppCard>
      <AppCard v-if="props.code === 'SHSAT'" class="management-card shsat-student-history">
        <div class="card-heading"><div><span class="eyebrow">YOUR SHSAT RECORDS</span><h2>Exam History</h2><p>Review completed exams, personal wrong answers, and assigned review tasks.</p></div>
          <button class="secondary-button compact-button" :disabled="historyLoading" @click="loadStudentExams">{{ historyLoading ? 'Refreshing…' : 'Refresh' }}</button>
        </div>
        <p v-if="historyError" class="error-text" role="alert">{{ historyError }}</p>
        <div class="history-tabs" role="tablist" aria-label="SHSAT student history">
          <button v-for="tab in [
            { key: 'history', label: 'Exam History' },
            { key: 'wrong-answers', label: 'Wrong Answer Book', count: shsatWrongAnswerBooks.length },
            { key: 'review-tasks', label: 'Review Task History', count: completedReviewTasks.length },
          ]" :key="tab.key" class="history-tab" :class="{ 'history-tab--active': activeHistoryTab === tab.key }"
            type="button" role="tab" :aria-selected="activeHistoryTab === tab.key" @click="selectStudentHistoryTab(tab.key)">
            {{ tab.label }} <span v-if="tab.count" class="history-tab__count">{{ tab.count }}</span>
          </button>
        </div>
        <div v-if="activeHistoryTab === 'history'" class="shsat-history-list">
          <article v-for="item in shsatFormalHistory" :key="item.attemptId" class="shsat-history-row">
            <div class="paper-copy"><strong>{{ item.examTitle }}</strong><small>Attempt #{{ item.attemptNumber }} · {{ formatExamDate(item.submittedAt || item.startedAt) }}</small></div>
            <div class="shsat-history-score"><strong>{{ item.scoreVisible ? (item.totalScore ?? '—') : 'Not available yet' }}</strong><small>Raw score</small></div>
            <AppButton variant="secondary" @click="viewShsatAttempt(item)">View report</AppButton>
          </article>
          <p v-if="!shsatFormalHistory.length && !historyLoading && !historyError" class="table-empty">No completed SHSAT exams yet.</p>
        </div>
        <div v-else-if="activeHistoryTab === 'wrong-answers'" class="shsat-history-list">
          <article v-for="item in shsatWrongAnswerBooks" :key="item.attemptId" class="shsat-history-row">
            <div class="paper-copy"><strong>{{ item.examTitle }}</strong><small>Attempt #{{ item.attemptNumber }} · {{ item.remainingReviewCount }} questions remaining</small></div>
            <div class="shsat-history-actions">
              <AppButton variant="secondary" :disabled="!item.answersVisible || !item.remainingReviewCount" @click="viewShsatWrongAnswers(item)">View wrong answers</AppButton>
              <AppButton variant="primary" :disabled="!item.answersVisible || !item.remainingReviewCount || startingWrongAnswerAttemptId !== null" @click="practiceShsatWrongAnswers(item)">
                {{ startingWrongAnswerAttemptId === item.attemptId ? 'Starting…' : 'Practice' }}
              </AppButton>
              <AppButton variant="ghost" :disabled="!latestWrongAnswerPractice.get(String(item.attemptId))" @click="viewLatestShsatPractice(item)">Latest practice report</AppButton>
            </div>
          </article>
          <p v-if="!shsatWrongAnswerBooks.length && !historyLoading && !historyError" class="table-empty">No wrong answers are available for review.</p>
        </div>
        <div v-else class="shsat-history-list">
          <article v-for="task in completedReviewTasks" :key="task.assignmentId" class="shsat-history-row">
            <div class="paper-copy"><strong>{{ task.title }}</strong><small>{{ task.examTitle }} · {{ task.clearedQuestionCount }} / {{ task.totalQuestions }} questions cleared</small></div>
            <span class="status-pill is-active">Completed</span>
            <AppButton variant="secondary" @click="viewCompletedReviewReport(task)">View report</AppButton>
          </article>
          <p v-if="!completedReviewTasks.length && !historyLoading && !historyError" class="table-empty">No completed review assignments yet.</p>
        </div>
      </AppCard>
    </template>
    <div v-if="isLoading" class="loading-state"><span class="loading-rule"></span>Loading…</div>
  </div>
</template>

<style scoped>
.exam-delete-warning {
  margin: 0;
  border-radius: 12px;
  padding: 14px;
  color: #8f2424;
  background: #fff1f1;
  line-height: 1.55;
}
.historical-exam-count { margin-right: 4px; color: var(--color-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.history-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 8px; border-bottom: 1px solid var(--color-border); }
.history-tab { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; padding: 0 12px; background: transparent; color: var(--color-muted); cursor: pointer; font: inherit; font-weight: 650; }
.history-tab--active { border-bottom-color: var(--color-primary); color: var(--color-primary-strong); }
.history-tab__count { display: inline-grid; min-width: 20px; height: 20px; place-items: center; border-radius: 999px; padding: 0 5px; background: #edf3ff; color: var(--color-primary-strong); font-size: 12px; }
.shsat-history-list { display: grid; }
.shsat-history-row { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(110px, auto) auto; align-items: center; gap: 18px; border-bottom: 1px solid var(--color-border); padding: 14px 2px; }
.shsat-history-row > .status-pill { justify-self: start; }
.shsat-history-row:last-child { border-bottom: 0; }
.shsat-history-score { display: grid; gap: 3px; text-align: right; font-variant-numeric: tabular-nums; }
.shsat-history-score strong { color: var(--color-text); font-size: 15px; }
.shsat-history-score small, .shsat-history-row .paper-copy small { color: var(--color-muted); font-size: 13px; }
.shsat-history-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
@media (max-width: 760px) { .shsat-history-row { grid-template-columns: minmax(0, 1fr); gap: 10px; } .shsat-history-score { text-align: left; } .shsat-history-actions { justify-content: flex-start; } }
.exam-list-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 9px; margin-top: 12px; color: var(--color-muted); font-size: 13px; }
.exam-list-pagination > span:first-child { margin-right: auto; }
.exam-list-pagination label { display: flex; align-items: center; gap: 7px; font-weight: 650; }
.exam-list-pagination select, .exam-list-pagination button { min-height: 34px; border: 1px solid var(--color-border); border-radius: 9px; padding: 0 10px; background: #fff; color: var(--color-text); font: inherit; }
.exam-list-pagination button { cursor: pointer; }
.exam-list-pagination button:disabled { cursor: not-allowed; opacity: .45; }
.practice-paper-group + .practice-paper-group { margin-top: 18px; }
.practice-paper-group h3 { margin: 0 0 8px; color: var(--color-muted); font-size: 13px; font-weight: 750; }
.student-practice-list .paper-row { min-height: 72px; gap: 16px; }
.student-practice-list .paper-copy strong { overflow: visible; font-size: 14px; line-height: 1.35; text-overflow: clip; white-space: normal; }
.student-practice-list .paper-copy small { font-size: 12px; line-height: 1.4; }
.student-practice-list .paper-row .compact-button { min-height: 40px; font-size: 13px; }
.student-exam-list .paper-row { min-height: 72px; gap: 14px; }
.student-exam-list .paper-copy strong { font-size: 14px; line-height: 1.35; }
.student-exam-list .paper-copy small { font-size: 12px; line-height: 1.4; }
.student-exam-list .status-pill.is-progress,
.student-exam-list .status-pill.is-complete { background: #eaf1ff; color: #245dd8; }
.student-exam-list .status-pill.is-upcoming { background: #f1f6ff; color: #52627a; }
.student-exam-list .status-pill.is-closed { background: #eef2f6; color: #66758d; }
.practice-history-list { border-top: 1px solid var(--color-border); }
.practice-history-row { display: grid; grid-template-columns: auto minmax(220px, 1fr) minmax(90px, auto) auto; align-items: center; gap: 16px; padding: 14px 4px; border-bottom: 1px solid var(--color-border); }
.practice-history-score { display: grid; gap: 3px; color: var(--color-text); text-align: right; font-variant-numeric: tabular-nums; }
.practice-history-score strong { font-size: 15px; }
.practice-history-score small, .practice-history-row .paper-copy small { color: var(--color-muted); font-size: 12px; }
.practice-history-actions { display: flex; align-items: center; gap: 8px; }
.practice-delete-button { color: #9b3232; }
.practice-history-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-top: 14px; color: var(--color-muted); font-size: 13px; }
.practice-delete-warning { margin: 0; color: var(--color-muted); line-height: 1.6; }
.student-practice-history--empty .card-heading, .student-exam-list--empty .card-heading { margin-bottom: 8px; }
.student-practice-history--empty .table-empty, .student-exam-list--empty .table-empty { margin: 0; padding: 10px 8px 4px; }
@media (max-width: 700px) { .practice-history-row { grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; } .practice-history-score { grid-column: 2; justify-self: start; text-align: left; } .practice-history-actions { grid-column: 2 / -1; } }
@media (max-width: 700px) { .student-practice-list .paper-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 8px 12px; padding: 12px 0; } .student-practice-list .paper-mark { grid-column: 1; grid-row: 1; } .student-practice-list .paper-copy { grid-column: 2; grid-row: 1; } .student-practice-list .paper-row .compact-button { grid-column: 2; justify-self: start; } }
@media (max-width: 700px) {
  .student-review-list .paper-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 8px 12px; padding: 12px 0; }
  .student-review-list .paper-mark { grid-column: 1; grid-row: 1 / span 3; align-self: start; }
  .student-review-list .paper-copy { grid-column: 2; grid-row: 1; }
  .student-review-list .status-pill { grid-column: 2; justify-self: start; }
  .student-review-list .paper-row .compact-button { grid-column: 2; justify-self: start; min-height: 40px; font-size: 13px; }
}
@media (max-width: 700px) {
  .student-exam-list .paper-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 8px 12px; padding: 12px 0; }
  .student-exam-list .paper-mark { grid-column: 1; grid-row: 1 / span 3; align-self: start; }
  .student-exam-list .paper-copy { grid-column: 2; grid-row: 1; }
  .student-exam-list .paper-copy strong { overflow: visible; text-overflow: clip; white-space: normal; }
  .student-exam-list .status-pill { grid-column: 2; justify-self: start; }
  .student-exam-list .paper-row .compact-button { grid-column: 2; justify-self: start; min-height: 40px; font-size: 13px; }
}
.exam-notification { position: fixed; z-index: 1200; top: 82px; right: 24px; display: flex; width: min(380px, calc(100vw - 32px)); align-items: center; gap: 12px; border: 1px solid var(--color-border); border-radius: 14px; padding: 13px 12px 13px 14px; background: #fff; color: var(--color-text); box-shadow: 0 16px 40px rgb(18 36 64 / 16%); }
.exam-notification--success { border-color: #bbf7d0; }
.exam-notification--error { border-color: #fecaca; }
.exam-notification__icon { display: grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #eff6ff; color: #2563eb; font-size: 16px; font-weight: 800; }
.exam-notification--success .exam-notification__icon { background: #e9f8ef; color: #16804a; }
.exam-notification--error .exam-notification__icon { background: #fff1f1; color: #b42318; }
.exam-notification__copy { display: grid; min-width: 0; gap: 3px; }
.exam-notification__copy strong { color: var(--color-text); font-size: 14px; font-weight: 700; }
.exam-notification__copy small { color: var(--color-muted); font-size: 12px; line-height: 1.45; }
.exam-notification button { width: 28px; height: 28px; flex: 0 0 auto; margin-left: auto; border: 0; border-radius: 50%; background: transparent; color: var(--color-muted); cursor: pointer; font-size: 20px; line-height: 1; }
.exam-notification button:hover { background: #f1f5f9; color: var(--color-text); }
.exam-notification-enter-active,
.exam-notification-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.exam-notification-enter-from,
.exam-notification-leave-to { opacity: 0; transform: translateY(-8px); }
.paper-action-form { display: grid; gap: 16px; }
.paper-action-form > p { margin: 0; color: var(--color-muted); line-height: 1.55; }
.exam-release-create-form { display: grid; gap: 20px; }
.exam-release-create-section { display: grid; gap: 12px; }
.exam-release-create-section + .exam-release-create-section,
.exam-release-individual-targets { padding-top: 20px; border-top: 1px solid var(--color-border); }
.exam-release-create-section h3 { margin: 0; color: var(--color-text); font-size: 16px; font-weight: 700; line-height: 1.35; }
.exam-release-audience-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.exam-release-audience-option { display: flex; min-width: 0; align-items: flex-start; gap: 10px; border: 1px solid var(--color-border); border-radius: 12px; padding: 12px; background: #fbfdff; cursor: pointer; }
.exam-release-audience-option:has(input:checked) { border-color: #a9c2eb; background: #f3f7ff; }
.exam-release-audience-option input { flex: 0 0 auto; margin: 2px 0 0; accent-color: var(--color-primary); }
.exam-release-audience-option span { display: grid; gap: 4px; }
.exam-release-audience-option strong { color: var(--color-text); font-size: 14px; font-weight: 650; }
.exam-release-audience-option small { color: var(--color-muted); font-size: 12px; line-height: 1.45; }
.exam-release-create-section__heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.exam-release-create-section__heading > div { display: grid; gap: 4px; }
.exam-release-create-section__heading > div > span,
.exam-release-individual-targets summary > span { color: var(--color-muted); font-size: 13px; font-weight: 500; }
.exam-release-clear-selection { flex: 0 0 auto; border: 0; padding: 6px 0 6px 8px; background: transparent; color: var(--color-primary-strong); cursor: pointer; font: inherit; font-size: 13px; font-weight: 650; }
.exam-release-clear-selection:hover { color: var(--color-primary); text-decoration: underline; }
.exam-release-select-all-option { display: flex; min-width: 0; align-items: center; gap: 12px; border: 1px solid var(--color-border); border-radius: 12px; padding: 10px 12px; background: #f7faff; color: var(--color-text); cursor: pointer; transition: border-color 140ms ease, background-color 140ms ease; }
.exam-release-select-all-option:hover { border-color: #b8cdf4; background: #f1f6ff; }
.exam-release-select-all-option:focus-within { outline: 3px solid rgb(52 112 245 / 16%); outline-offset: 2px; }
.exam-release-select-all-option input { width: 18px; height: 18px; flex: 0 0 auto; margin: 0; accent-color: var(--color-primary); cursor: pointer; }
.exam-release-select-all-option > span { display: grid; min-width: 0; gap: 3px; }
.exam-release-select-all-option strong { font-size: 14px; font-weight: 650; }
.exam-release-select-all-option small { color: var(--color-muted); font-size: 12px; line-height: 1.4; }
.exam-release-create-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px 16px; }
.exam-release-create-grid__wide { grid-column: 1 / -1; }
.exam-release-create-form .form-field { display: grid; min-width: 0; align-content: start; gap: 7px; }
.exam-release-create-form .form-label { color: #24314a; font-size: 14px; font-weight: 650; line-height: 1.4; }
.exam-release-create-form .form-input { box-sizing: border-box; width: 100%; min-height: 44px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 10px 12px; background: #fbfdff; color: var(--color-text); font-size: 14px; }
.exam-release-create-form .form-input:focus { border-color: var(--color-primary); outline: 3px solid rgb(52 112 245 / 12%); }
.exam-release-create-form textarea.form-input { min-height: 80px; resize: vertical; }
.exam-release-field-hint,
.exam-release-create-hint { color: var(--color-muted); font-size: 12px; line-height: 1.5; }
.exam-release-field-hint { margin-top: -2px; }
.exam-release-create-hint { margin: 0; }
.exam-release-target-list { display: grid; max-height: 180px; gap: 2px; overflow: auto; border: 1px solid var(--color-border); border-radius: 12px; padding: 5px; background: #fbfdff; }
.exam-release-target-list--classes { max-height: 220px; }
.exam-release-target-option { display: flex; min-width: 0; align-items: center; gap: 11px; border-radius: 8px; padding: 9px 10px; color: var(--color-text); cursor: pointer; }
.exam-release-target-option:hover { background: #f1f6ff; }
.exam-release-target-option input { flex: 0 0 auto; accent-color: var(--color-primary); }
.exam-release-target-option span { display: grid; min-width: 0; gap: 3px; }
.exam-release-target-option strong { overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.exam-release-target-option small { overflow: hidden; color: var(--color-muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.exam-release-target-option.is-disabled { cursor: not-allowed; opacity: .55; }
.exam-release-target-option.is-disabled:hover { background: transparent; }
.exam-release-individual-targets summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--color-text); cursor: pointer; font-size: 14px; font-weight: 650; list-style: none; }
.exam-release-individual-targets summary::-webkit-details-marker { display: none; }
.exam-release-individual-targets summary::after { color: var(--color-muted); content: '+'; font-size: 18px; }
.exam-release-individual-targets[open] summary::after { content: '−'; }
.exam-release-individual-targets .exam-release-target-list { margin-top: 12px; }
.exam-release-create-policy { margin: 0; border-left: 3px solid #b8cdf4; border-radius: 0 8px 8px 0; padding: 8px 11px; background: #f6f9ff; color: var(--color-muted); font-size: 12px; line-height: 1.5; }
.exam-release-form-error { min-width: 0; margin-right: auto; }
.draft-count { display: inline-grid; min-width: 20px; height: 20px; place-items: center; margin-left: 4px; border-radius: 999px; padding: 0 5px; background: #edf3ff; color: var(--color-primary-strong); font-size: 11px; font-weight: 750; }
.draft-list { display: grid; max-height: min(60vh, 520px); overflow: auto; }
.draft-list__row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(140px, auto) auto; align-items: center; gap: 16px; border-bottom: 1px solid var(--color-border); padding: 13px 4px; }
.draft-list__identity { display: grid; min-width: 0; gap: 4px; }
.draft-list__identity strong { overflow: hidden; color: var(--color-text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.draft-list__identity span, .draft-list__meta span { color: var(--color-muted); font-size: 12px; }
.draft-list__meta { display: grid; gap: 4px; }
.draft-list__meta time { color: var(--color-text); font-size: 13px; font-variant-numeric: tabular-nums; }
.draft-list__empty { margin: 0; border: 1px dashed var(--color-border); border-radius: 12px; padding: 28px 18px; color: var(--color-muted); text-align: center; }
.paper-details-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; }
.paper-details-grid > div { min-width: 0; border: 1px solid var(--color-border); border-radius: 12px; padding: 12px 14px; }
.paper-details-grid dt { color: var(--color-muted); font-size: 12px; font-weight: 700; }
.paper-details-grid dd { margin: 5px 0 0; color: var(--color-text); font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
.paper-details-grid__description { grid-column: 1 / -1; }
.exam-publication-details > div:last-child { grid-column: 1 / -1; }
.exam-publication-error { margin-top: 14px; }
.exam-delete-cooldown {
  margin: 14px 0 0;
  color: #92400e;
  font-size: 14px;
  font-weight: 700;
}
.exam-delete-cooldown--ready { color: #166534; }
@media (max-width: 560px) {
  .exam-notification { top: 72px; right: 12px; }
  .paper-details-grid { grid-template-columns: 1fr; }
  .paper-details-grid__description { grid-column: auto; }
  .exam-release-create-grid { grid-template-columns: 1fr; }
  .exam-release-create-grid__wide { grid-column: auto; }
  .exam-release-audience-options { grid-template-columns: 1fr; }
  .draft-list__row { grid-template-columns: minmax(0, 1fr) auto; }
  .draft-list__meta { grid-column: 1; grid-row: 2; }
  .draft-list__row :deep(.responsive-action-group) { grid-column: 2; grid-row: 1 / span 2; }
  .exam-release-create-section__heading { align-items: flex-start; }
  .exam-release-clear-selection { font-size: 12px; }
  .exam-release-form-error { flex-basis: 100%; }
}
</style>
