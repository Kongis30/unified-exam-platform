<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppModal from '@/components/AppModal.vue'
import CreatePaperDialog from '@/components/admin/CreatePaperDialog.vue'
import ExamReleaseDialog from '@/components/admin/ExamReleaseDialog.vue'
import AdminTabs from '@/components/admin/AdminTabs.vue'
import AdminActionMenu from '@/components/admin/AdminActionMenu.vue'
import ResponsiveActionGroup from '@/components/admin/ResponsiveActionGroup.vue'
import AdminTabPanels from '@/components/admin/AdminTabPanels.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminExamCard from '@/components/admin/AdminExamCard.vue'
import AdminDataTable from '@/components/admin/AdminDataTable.vue'
import ReviewAssignmentsPanel from '@/components/admin/ReviewAssignmentsPanel.vue'
import { reviewAssignments } from '@/api/reviewAssignments'
import { getStudentExamState } from '@/utils/studentExamState.js'
import { groupStudentExams } from '@/utils/studentExamGrouping.js'
import { examApi as satExamApi } from '@/examTypes/sat/student/api/exam'
import ClassesPage from '@/views/ClassesPage.vue'
import {
  createExam, createPaper, createPaperGroup, hideExamRelease, deletePaper, deletePaperGroup,
  apiRequest, cachedResource, closeExam, getExam, getExamTypes, getPaper, listClasses, listExams, listPaperGroups, listPapers,
  listStudentExams, movePaperToGroup, publishExam, reorderWorkspacePaperGroups, saveExamTargets, unpublishExam,
  savePaperStructure, updateExam, updatePaper, updatePaperGroup,
} from '@/api/platform'
import { authState } from '@/auth'
import { studentApi as shsatStudentApi } from '@shsat/admin/services/studentApi'

const props = defineProps({ code: { type: String, required: true } })
const isSatWorkspace = computed(() => ['SAT', 'PSAT'].includes(props.code))
const adminRouteName = computed(() => props.code === 'PSAT' ? 'psat-admin' : 'sat-admin')
const route = useRoute()
const router = useRouter()
const examTypes = ref([])
const papers = ref([])
const paperFolderRecords = ref([])
const exams = ref([])
const studentExams = ref([])
const studentPracticeHistory = ref([])
const practiceHistoryPage = ref(1)
const practiceHistoryTotal = ref(0)
const studentReviewTasks = ref([])
const studentAttemptHistory = ref([])
const historyLoading = ref(false)
const historyError = ref('')
const studentExamError = ref('')
const studentExamsLoading = ref(false)
const studentPracticeLoading = ref(false)
const studentReviewLoading = ref(false)
const studentPracticeError = ref('')
const activeHistoryTab = ref(localStorage.getItem(`student-history-tab.${props.code}`) || 'history')
const wrongAnswerBookGrid = ref(null)
const wrongAnswerBookColumns = ref(3)
const wrongAnswerBookPage = ref(1)
const reviewTaskGrid = ref(null)
let wrongAnswerBookResizeObserver = null
let reviewTaskResizeObserver = null
const startingWrongAnswerAttemptId = ref(null)
const startingReviewTaskId = ref(null)
const classes = ref([])
const selectedPaper = ref(null)
const isLoading = ref(true)
const staffPapersLoading = ref(false)
const staffExamsLoading = ref(false)
const staffClassesLoading = ref(false)
const staffClassesLoaded = ref(false)
const staffPapersLoaded = ref(false)
let pendingClasses = null
let pendingPapers = null
let staffClassesNeedRetry = false
let staffPapersNeedRetry = false
let workspaceActive = true
let workspaceVisited = false
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
const canManageWorkspace = computed(() => !isSatWorkspace.value || isAdmin.value)
const initialTab = route.query.tab
const initialAllowedTab = isSatWorkspace.value && !isAdmin.value
  ? (initialTab === 'reviews' ? 'reviews' : 'classes') : ['papers', 'exams', 'classes', 'reviews'].includes(initialTab) ? initialTab : 'papers'
const activeTab = ref(initialAllowedTab)
const openPaperActionMenuId = ref(null)
const movePaperTarget = ref(null)
const movePaperGroupKey = ref('')
const editPaperTarget = ref(null)
const editPaperTitle = ref('')
const editPaperDurationMinutes = ref('')
const paperActionDialog = ref(null)
const paperActionDialogSaving = ref(false)
const paperActionDialogError = ref('')
const paperDetailsTarget = ref(null)
const paperDetails = ref(null)
const paperDetailsLoading = ref(false)
const paperDetailsError = ref('')
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
const examReleaseFilters = reactive({
  published: typeof route.query.releasePublished === 'string' ? route.query.releasePublished : '',
  timeStatus: typeof route.query.releaseTimeStatus === 'string' ? route.query.releaseTimeStatus : '',
  targetType: typeof route.query.releaseTargetType === 'string' ? route.query.releaseTargetType : '',
})
const initialExamPageSize = Number(route.query.examPageSize)
const examPageSize = ref([10, 20, 50].includes(initialExamPageSize) ? initialExamPageSize : 10)
const currentExamPage = ref(Math.max(1, Number(route.query.currentExamPage) || 1))
const historicalExamPage = ref(Math.max(1, Number(route.query.historicalExamPage) || 1))
const editorOpen = ref(false)
const releaseOpen = ref(false)
const draftPaperTitle = ref('')
const draftHadTargets = ref(false)
const draftExamId = ref(null)
const selectedClassIds = ref([])
const selectedStudentIds = ref([])
const selectedStudentTargets = ref([])
const isStaff = computed(() => ['ADMIN', 'TEACHER'].includes(authState.user?.roleCode))
const workspaceTypes = computed(() => examTypes.value.filter((item) => item.workspaceCode === props.code))
const availableExamSubtitle = computed(() => {
  const names = [...new Set(workspaceTypes.value.map((item) => item.displayName))]
  const programs = names.length ? names.join(' and ') : props.code
  return `Published ${programs} exams for your classes.`
})
const selectedType = computed(() => workspaceTypes.value.find((item) => item.code === props.code) || workspaceTypes.value[0])
const latestPaperVersions = computed(() => {
  if (!isSatWorkspace.value) return papers.value
  const latestByCode = new Map()
  for (const paper of papers.value) {
    const key = `${paper.examTypeCode}:${paper.paperCode}`
    const current = latestByCode.get(key)
    if (!current || paper.versionNo > current.versionNo) latestByCode.set(key, paper)
  }
  return [...latestByCode.values()]
})
const availablePapers = computed(() => latestPaperVersions.value.filter((paper) => paper.status !== 'ARCHIVED'))
const filteredExams = computed(() => {
  const keyword = examKeyword.value.trim().toLocaleLowerCase()
  return exams.value.filter((exam) => {
    const published = exam.status === 'PUBLISHED'
    if (examReleaseFilters.published === 'published' && !published) return false
    if (examReleaseFilters.published === 'unpublished' && published) return false
    if (examReleaseFilters.timeStatus && getExamTimeStatus(exam).key !== examReleaseFilters.timeStatus) return false
    if (examReleaseFilters.targetType && !matchesExamTargetType(exam, examReleaseFilters.targetType)) return false
    if (!keyword) return true
    return [exam.title, exam.paperTitle, exam.targetSummary, exam.targetScope]
      .some((value) => String(value || '').toLocaleLowerCase().includes(keyword))
  })
})
const currentExams = computed(() => filteredExams.value.filter((exam) => exam.status === 'DRAFT'
  || (exam.status === 'PUBLISHED' && new Date(exam.closesAt).getTime() > Date.now())))
const historicalExams = computed(() => filteredExams.value.filter((exam) =>
  ['CLOSED', 'CANCELLED'].includes(exam.status)
  || (exam.status === 'PUBLISHED' && new Date(exam.closesAt).getTime() <= Date.now())))
const currentExamPageCount = computed(() => Math.max(1, Math.ceil(currentExams.value.length / examPageSize.value)))
const historicalExamPageCount = computed(() => Math.max(1, Math.ceil(historicalExams.value.length / examPageSize.value)))
const visibleExams = computed(() => currentExams.value.slice(
  (currentExamPage.value - 1) * examPageSize.value, currentExamPage.value * examPageSize.value))
const visibleHistoricalExams = computed(() => historicalExams.value.slice(
  (historicalExamPage.value - 1) * examPageSize.value, historicalExamPage.value * examPageSize.value))
const paperGroups = computed(() => {
  // 当前工作区只读取自身考试类型的文件夹。
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
  return latestPaperVersions.value.filter((paper) => {
    const matchesGroup = !paperFilters.groupId
      || (paperFilters.groupId === 'default' ? paper.groupId == null : paperGroups.value.some((group) =>
        group.key === paperFilters.groupId && String(group.idsByType[paper.examTypeCode]) === String(paper.groupId)))
    const matchesKeyword = !keyword || [paper.title]
      .some((value) => String(value || '').toLocaleLowerCase().includes(keyword))
    return matchesGroup && matchesKeyword
  })
})
const paperFolderSections = computed(() => {
  const sortPapersByTitle = (items) => [...items].sort((left, right) =>
    String(left.title || '').localeCompare(String(right.title || ''), undefined, { sensitivity: 'base', numeric: true }))
  const sections = [
    { key: 'default', name: 'Default Folder', group: null,
      totalItems: latestPaperVersions.value.filter((paper) => paper.groupId == null).length,
      items: sortPapersByTitle(filteredPapers.value.filter((paper) => paper.groupId == null)) },
    ...paperGroups.value.map((group) => ({ key: group.key, name: group.name, group,
      totalItems: latestPaperVersions.value.filter((paper) => String(group.idsByType[paper.examTypeCode]) === String(paper.groupId)).length,
      items: sortPapersByTitle(filteredPapers.value.filter((paper) => String(group.idsByType[paper.examTypeCode]) === String(paper.groupId))) })),
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
  { key: 'reviews', label: 'Review Assignments' },
  { key: 'classes', label: 'Classes' },
]
const visibleAdminTabs = computed(() => canManageWorkspace.value
  ? adminTabs : adminTabs.filter((tab) => ['classes', 'reviews'].includes(tab.key)))

const paperForm = reactive({ examTypeCode: '', title: '', description: '', groupId: '', defaultDurationMinutes: 134 })
const createPaperFolders = computed(() => paperFolderRecords.value
  .filter((group) => group.examTypeCode === props.code)
  .map((group) => ({ id: group.id, name: group.name })))
const releaseForm = reactive({
  paperId: '', title: '', description: '', opensAt: '', closesAt: '', durationMinutes: '', attemptLimit: 1,
  targetScope: 'SELECTED',
})

const releaseFields = { paper: 'paperId', title: 'title', description: 'description', start: 'opensAt', end: 'closesAt', duration: 'durationMinutes', attemptLimit: 'attemptLimit', scope: 'targetScope' }
const releasePaperGroups = computed(() => {
  const groups = new Map()
  for (const paper of availablePapers.value) {
    const folder = paperFolderRecords.value.find((item) => item.examTypeCode === paper.examTypeCode && String(item.id) === String(paper.groupId))
    const label = folder?.name || 'Default Folder'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push({ id: paper.id, title: `${paper.title} · v${paper.versionNo}` })
  }
  if (draftExamId.value && !availablePapers.value.some((paper) => String(paper.id) === String(releaseForm.paperId))) {
    const label = 'Unavailable papers'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push({ id: releaseForm.paperId, title: `${draftPaperTitle.value} · unavailable for new releases` })
  }
  return [...groups].map(([label, papers]) => ({ label, papers }))
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
      // 模块目录先显示；班级、试卷和考试分别完成，不让慢接口阻塞其他区域。
      isLoading.value = false
      await Promise.all([canManageWorkspace.value ? loadWorkspaceExams() : Promise.resolve(), ensureStaffTab(activeTab.value)])
    } else {
      isLoading.value = false
      await loadStudentExams()
    }
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load this exam workspace.'
  } finally {
    isLoading.value = false
    await nextTick()
    if (workspaceActive) restoreStudentHistoryScroll()
  }
}

async function ensureStaffClasses(revalidate = false) {
  if (pendingClasses) return pendingClasses
  if (staffClassesLoaded.value && !revalidate && !staffClassesNeedRetry) return
  staffClassesLoading.value = true
  const request = listClasses([props.code]).then((rows) => {
    classes.value = rows
    staffClassesLoaded.value = true
    staffClassesNeedRetry = false
  }).catch((requestError) => {
    staffClassesNeedRetry = true
    throw requestError
  }).finally(() => { staffClassesLoading.value = false; pendingClasses = null })
  pendingClasses = request
  return request
}

async function ensureStaffPapers(revalidate = false) {
  if (pendingPapers) return pendingPapers
  if (staffPapersLoaded.value && !revalidate && !staffPapersNeedRetry) return
  const request = loadWorkspacePapers().then(() => { staffPapersLoaded.value = true; staffPapersNeedRetry = false })
    .catch((requestError) => { staffPapersNeedRetry = true; throw requestError })
    .finally(() => { pendingPapers = null })
  pendingPapers = request
  return request
}

async function ensureStaffTab(tab) {
  if (tab === 'classes') return ensureStaffClasses()
  if (tab === 'papers') return ensureStaffPapers()
  if (tab === 'exams') return Promise.all([ensureStaffClasses(), ensureStaffPapers()])
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

async function loadStudentExams(force = false) {
  const workspaceCodes = new Set(workspaceTypes.value.map((item) => item.code))
  const isShsatWorkspace = props.code === 'SHSAT'
  studentExamError.value = ''
  studentPracticeError.value = ''
  if (isShsatWorkspace) { historyLoading.value = true; historyError.value = '' }

  // 已分配考试和练习、历史记录互不依赖，分别请求并保留各自的错误提示。
  const assignedExams = async () => {
    studentExamsLoading.value = true
    try {
      studentExams.value = (await listStudentExams({ force: force === true }))
        .filter((exam) => workspaceCodes.has(exam.examTypeCode) && isStudentExamVisible(exam))
    } catch (requestError) {
      studentExamError.value = requestError.message || 'Unable to load your assigned exams.'
    } finally { studentExamsLoading.value = false }
  }
  const practiceAndHistory = async () => {
    studentPracticeLoading.value = true
    try {
      if (isSatWorkspace.value) {
        const practiceHistory = await satExamApi.listPracticeHistory(practiceHistoryPage.value, 10, props.code)
        studentPracticeHistory.value = practiceHistory.records || []
        practiceHistoryTotal.value = practiceHistory.total || 0
      } else {
        studentPracticeHistory.value = []
        practiceHistoryTotal.value = 0
      }

      if (isShsatWorkspace) {
        const [tasks, history] = await Promise.all([
          cachedResource('/api/student/wrong-answer-tasks', ['student'], 30_000, { force: force === true }),
          shsatStudentApi.getAttemptHistory({ force: force === true }),
        ])
        studentReviewTasks.value = tasks
        studentAttemptHistory.value = history
      } else if (!isSatWorkspace.value) {
        studentReviewTasks.value = []
        studentAttemptHistory.value = []
      }
    } catch (requestError) {
      if (isShsatWorkspace) historyError.value = requestError.message || 'Unable to load exam history.'
      else studentPracticeError.value = requestError.message || 'Unable to load practice history.'
    } finally { studentPracticeLoading.value = false }
  }
  try {
    const reviewTasks = async () => {
      if (!isSatWorkspace.value) return
      studentReviewLoading.value = true
      try {
        const tasks = await reviewAssignments.studentList(props.code, { force: force === true })
        studentReviewTasks.value = tasks.map(task => ({
          ...task,
          assignmentId: task.id,
          remainingQuestionCount: task.remainingCount,
          totalQuestions: task.questionCount,
          clearedQuestionCount: task.clearedCount,
          practiceAttemptId: task.latestAttemptId,
        }))
      } catch (requestError) { studentPracticeError.value = requestError.message || 'Unable to load review assignments.' }
      finally { studentReviewLoading.value = false }
    }
    await Promise.all([assignedExams(), practiceAndHistory(), reviewTasks()])
  } finally {
    if (isShsatWorkspace) historyLoading.value = false
  }
}

const shsatFormalHistory = computed(() => studentAttemptHistory.value.filter((item) => !item.practice))
const shsatWrongAnswerBooks = computed(() => shsatFormalHistory.value.filter((item) => Number(item.reviewCount) > 0))
const wrongAnswerBookPageSize = computed(() => wrongAnswerBookColumns.value * 2)
const wrongAnswerBookPageCount = computed(() => Math.max(1, Math.ceil(shsatWrongAnswerBooks.value.length / wrongAnswerBookPageSize.value)))
const visibleWrongAnswerBooks = computed(() => {
  const start = (wrongAnswerBookPage.value - 1) * wrongAnswerBookPageSize.value
  return shsatWrongAnswerBooks.value.slice(start, start + wrongAnswerBookPageSize.value)
})
const activeReviewTasks = computed(() => studentReviewTasks.value.filter((task) => task.status !== 'COMPLETED'))
// Assigned Review 卡片同样按网格实际列数分页，每页固定两排，避免卡片越多容器被无限拉高。
const reviewTaskColumns = ref(3)
const reviewTaskPage = ref(1)
const reviewTaskPageSize = computed(() => reviewTaskColumns.value * 2)
const reviewTaskPageCount = computed(() => Math.max(1, Math.ceil(activeReviewTasks.value.length / reviewTaskPageSize.value)))
const visibleReviewTasks = computed(() => {
  const start = (reviewTaskPage.value - 1) * reviewTaskPageSize.value
  return activeReviewTasks.value.slice(start, start + reviewTaskPageSize.value)
})
// 学生首页按派发方式分组：整班派发为 Group Exams，其余（个人派发）归入 1on1 Exams。
// 分组规则与文案集中在 utils/studentExamGrouping.js，便于单测覆盖。
const groupedStudentExams = computed(() => groupStudentExams(studentExams.value))
const completedReviewTasks = computed(() => studentReviewTasks.value
  .filter((task) => task.status === 'COMPLETED' && task.practiceAttemptId))
const studentHomeHistoryLoading = computed(() => props.code === 'SHSAT'
  ? historyLoading.value
  : studentPracticeLoading.value || studentReviewLoading.value)
const studentHomeHistoryError = computed(() => props.code === 'SHSAT' ? historyError.value : studentPracticeError.value)
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
  localStorage.setItem(`student-history-tab.${props.code}`, tab)
}

// 按网格实际列数分页，确保宽屏或窄屏下每页都只展示两排错题卡片。
function updateWrongAnswerBookPagination() {
  const grid = wrongAnswerBookGrid.value
  if (!grid) return

  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  if (columns !== wrongAnswerBookColumns.value) {
    wrongAnswerBookColumns.value = columns
    wrongAnswerBookPage.value = 1
  }
}

async function observeWrongAnswerBookGrid() {
  await nextTick()
  wrongAnswerBookResizeObserver?.disconnect()
  wrongAnswerBookResizeObserver = null
  updateWrongAnswerBookPagination()

  if (wrongAnswerBookGrid.value && typeof ResizeObserver !== 'undefined') {
    wrongAnswerBookResizeObserver = new ResizeObserver(updateWrongAnswerBookPagination)
    wrongAnswerBookResizeObserver.observe(wrongAnswerBookGrid.value)
  }
}

function changeWrongAnswerBookPage(page) {
  wrongAnswerBookPage.value = Math.min(Math.max(page, 1), wrongAnswerBookPageCount.value)
}

// Assigned Review 与错题本使用同一套「按实际列数、每页两排」规则。
function updateReviewTaskPagination() {
  const grid = reviewTaskGrid.value
  if (!grid) return

  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
  if (columns !== reviewTaskColumns.value) {
    reviewTaskColumns.value = columns
    reviewTaskPage.value = 1
  }
}

async function observeReviewTaskGrid() {
  await nextTick()
  reviewTaskResizeObserver?.disconnect()
  reviewTaskResizeObserver = null
  updateReviewTaskPagination()

  if (reviewTaskGrid.value && typeof ResizeObserver !== 'undefined') {
    reviewTaskResizeObserver = new ResizeObserver(updateReviewTaskPagination)
    reviewTaskResizeObserver.observe(reviewTaskGrid.value)
  }
}

function changeReviewTaskPage(page) {
  reviewTaskPage.value = Math.min(Math.max(page, 1), reviewTaskPageCount.value)
}

watch([activeReviewTasks, () => props.code], observeReviewTaskGrid, { flush: 'post' })
watch(reviewTaskPageCount, (pageCount) => {
  if (reviewTaskPage.value > pageCount) reviewTaskPage.value = pageCount
})

watch([activeHistoryTab, shsatWrongAnswerBooks], observeWrongAnswerBookGrid, { flush: 'post' })
watch(wrongAnswerBookPageCount, (pageCount) => {
  if (wrongAnswerBookPage.value > pageCount) wrongAnswerBookPage.value = pageCount
})

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

// 学生考试卡片只保留未结束的考试和正在作答的考试；历史记录由成绩区展示。
function isStudentExamVisible(exam, now = Date.now()) {
  if (exam.activeAttemptId) return true

  const status = String(exam.status || '').toUpperCase()
  if (['ENDED', 'EXPIRED', 'CLOSED'].includes(status)) return false
  if (!exam.closesAt) return true

  const closesAt = new Date(exam.closesAt).getTime()
  return !Number.isFinite(closesAt) || closesAt > now
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

function studentExamStatusTone(exam) {
  const state = getStudentExamState(exam).label.toLowerCase()
  if (state === 'available' || state === 'in progress') return 'active'
  if (state === 'upcoming') return 'pending'
  if (state === 'submitted') return 'completed'
  return 'ended'
}

function viewShsatAttempt(item) {
  router.push({ name: 'student-attempt-report', params: { attemptId: item.attemptId },
    query: {
      returnTo: `/student/systems/SHSAT?historyScrollY=${Math.round(window.scrollY)}`,
      returnLabel: 'Back to SHSAT',
    } })
}

function viewCompletedReviewReport(task) {
  if (!task.practiceAttemptId) return
  if (isSatWorkspace.value) {
    startReviewTask(task)
    return
  }
  viewShsatAttempt({ attemptId: task.practiceAttemptId })
}

function viewShsatWrongAnswers(item) {
  if (!item.answersVisible || !item.remainingReviewCount) return
  router.push({ name: 'student-wrong-answer-review', params: { attemptId: item.attemptId },
    query: { returnTo: '/student/systems/SHSAT' } })
}

function wrongAnswerBookStatus(item) {
  if (!item.answersVisible) return `Attempt #${item.attemptNumber} · Review locked`
  const remaining = Number(item.remainingReviewCount) || 0
  const questionLabel = remaining === 1 ? 'question' : 'questions'
  return `Attempt #${item.attemptNumber} · ${remaining} ${questionLabel} remaining`
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
  const result = await satExamApi.listPracticeHistory(page, 10, props.code)
  studentPracticeHistory.value = result.records || []
  practiceHistoryTotal.value = result.total || 0
}

function viewPracticeReport(record) {
  sessionStorage.setItem('sat:workspace', record.examTypeCode)
  router.push({ name: 'sat-report', query: { examId: record.paperId, recordId: record.attemptId } })
}

async function startReviewTask(task) {
  if (startingReviewTaskId.value !== null) return
  startingReviewTaskId.value = task.assignmentId
  error.value = ''
  try {
    if (isSatWorkspace.value) {
      await router.push({ name: props.code === 'PSAT' ? 'psat-review-practice' : 'sat-review-practice', params: { assignmentId: task.assignmentId } })
      return
    }
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
  staffPapersLoading.value = true
  try {
    const types = workspaceTypes.value
    const [lists, groups] = await Promise.all([
      Promise.all(types.map((type) => listPapers(type.code))),
      Promise.all(types.map((type) => listPaperGroups(type.code))),
    ])
    papers.value = lists.flat().sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
    paperFolderRecords.value = groups.flat().sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
  } finally { staffPapersLoading.value = false }
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
  editPaperDurationMinutes.value = summary.defaultDurationSeconds == null ? '' : summary.defaultDurationSeconds / 60
  paperActionDialogError.value = ''
}

async function editPaperInfo() {
  const summary = editPaperTarget.value
  const title = editPaperTitle.value.trim()
  if (!summary || !title || paperActionDialogSaving.value) return
  const minutes = editPaperDurationMinutes.value
  const durationSeconds = minutes === '' ? null : Math.round(Number(minutes) * 60)
  if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds < 60)) {
    paperActionDialogError.value = 'Enter a duration of at least 1 minute.'
    return
  }
  if (title === summary.title && durationSeconds === (summary.defaultDurationSeconds ?? null)) {
    editPaperTarget.value = null
    return
  }
  paperActionDialogError.value = ''
  paperActionDialogSaving.value = true
  try {
    const detail = await getPaper(summary.id)
    await updatePaper(summary.id, {
      title, description: detail.description || null, groupId: detail.groupId,
      defaultDurationSeconds: durationSeconds,
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

function openDeletePaperDialog(summary) {
  paperActionDialog.value = summary
  paperActionDialogError.value = ''
}

async function confirmPaperAction() {
  const paper = paperActionDialog.value
  if (!paper || paperActionDialogSaving.value) return
  paperActionDialogSaving.value = true
  paperActionDialogError.value = ''
  try {
    await deletePaper(paper.id)
    notice.value = 'Paper deleted.'
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

async function loadWorkspaceExams(force = false) {
  staffExamsLoading.value = true
  try {
    const lists = await Promise.all(workspaceTypes.value.map((type) => listExams(type.code, { force: force === true })))
    exams.value = lists.flat().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    currentExamPage.value = Math.min(currentExamPage.value, currentExamPageCount.value)
    historicalExamPage.value = Math.min(historicalExamPage.value, historicalExamPageCount.value)
  } finally { staffExamsLoading.value = false }
}

watch([examKeyword, examPageSize, () => examReleaseFilters.published, () => examReleaseFilters.timeStatus,
  () => examReleaseFilters.targetType], () => {
  currentExamPage.value = 1
  historicalExamPage.value = 1
})

// SAT 列表状态写进路由，离开查看结果/监考后可从原筛选和页码继续操作。
watch([activeTab, examKeyword, examPageSize, currentExamPage, historicalExamPage,
  () => examReleaseFilters.published, () => examReleaseFilters.timeStatus, () => examReleaseFilters.targetType,
  () => paperFilters.groupId, appliedPaperKeyword], () => {
  if (!isSatWorkspace.value || !isStaff.value || route.name !== adminRouteName.value) return

  const query = { ...route.query, tab: activeTab.value }
  const state = {
    examSearch: examKeyword.value || undefined,
    releasePublished: examReleaseFilters.published || undefined,
    releaseTimeStatus: examReleaseFilters.timeStatus || undefined,
    releaseTargetType: examReleaseFilters.targetType || undefined,
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
    router.replace({ name: adminRouteName.value, query })
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
    await hideExamRelease(exam.id)
    examDeleteTarget.value = null
    examDeleteCooldown.value = 0
    clearExamDeleteCooldown()
    await loadWorkspaceExams()
    showNotification({
      title: 'Exam hidden',
      message: 'The exam is hidden from this list and students. Class records and reports are retained.',
      variant: 'success',
    })
  } catch (requestError) {
    error.value = requestError.message || 'Unable to hide this exam.'
    examDeleteTarget.value = null
    examDeleteCooldown.value = 0
    clearExamDeleteCooldown()
  } finally {
    examActionId.value = null
  }
}

onBeforeUnmount(() => {
  wrongAnswerBookResizeObserver?.disconnect()
  reviewTaskResizeObserver?.disconnect()
  clearExamDeleteCooldown()
  dismissNotification()
  document.removeEventListener('visibilitychange', refreshOnVisibility)
  if (examReleaseRefreshTimer) clearInterval(examReleaseRefreshTimer)
})

function getExamActions(exam) {
  const actions = []
  if (exam.status === 'DRAFT') {
    actions.push({ label: 'Edit draft', onSelect: () => resumeDraft(exam) })
  }
  if (isSatWorkspace.value && exam.status !== 'DRAFT') {
    actions.push({
      label: 'Results',
      onSelect: () => router.push({
        name: `${props.code.toLowerCase()}-exam-results`,
        params: { examId: exam.id },
        query: { returnTo: route.fullPath },
      }),
    })
    if (authState.user?.roleCode === 'ADMIN') {
      actions.push({
        label: 'Monitor',
        onSelect: () => router.push({
          name: `${props.code.toLowerCase()}-admin-exam-monitor`,
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
    actions.push({
      label: examActionId.value === exam.id ? 'Saving…' : exam.status === 'PUBLISHED' ? 'Unpublish' : 'Publish',
      disabled: examActionId.value === exam.id,
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
  if (!workspaceActive || !isStaff.value || activeTab.value !== 'exams') return
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
    paperForm.groupId = paperGroups.value.find((group) => group.key === paperFilters.groupId)?.idsByType[props.code] ?? ''
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
  return router.resolve({ name: adminRouteName.value, query }).fullPath
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
        groupId: paperForm.groupId ? Number(paperForm.groupId) : null,
        defaultDurationSeconds,
      })
      if (isSatWorkspace.value) {
        await router.push({
          name: `${props.code.toLowerCase()}-paper-edit`,
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
  if (isSatWorkspace.value) {
    error.value = ''
    if (summary.status === 'ARCHIVED') {
      error.value = 'Restore this paper before opening it for editing.'
      return
    }
    try {
      await router.push({
        name: `${props.code.toLowerCase()}-paper-edit`,
        params: { paperId: summary.id },
        query: { returnTo: getWorkspaceReturnPath() },
      })
    } catch (requestError) {
      error.value = requestError.message || 'Unable to open the paper for editing.'
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

function localDateTime(value) {
  const localValue = new Date(value)
  localValue.setMinutes(localValue.getMinutes() - localValue.getTimezoneOffset())
  return localValue.toISOString().slice(0, 16)
}

async function openRelease() {
  try { await ensureStaffTab('exams') } catch (requestError) { error.value = requestError.message; return }
  error.value = ''; notice.value = ''; draftExamId.value = null
  draftPaperTitle.value = ''; draftHadTargets.value = false
  selectedClassIds.value = []; selectedStudentIds.value = []; selectedStudentTargets.value = []
  const firstPaper = availablePapers.value[0]
  releaseForm.paperId = firstPaper?.id || ''
  releaseForm.title = ''; releaseForm.description = ''
  const openedAt = new Date()
  releaseForm.opensAt = localDateTime(openedAt)
  releaseForm.closesAt = localDateTime(new Date(openedAt.getTime() + 24 * 60 * 60 * 1000))
  releaseForm.durationMinutes = firstPaper ? defaultReleaseDurationMinutes(firstPaper) : defaultPaperDurationMinutes(props.code)
  releaseForm.attemptLimit = 1
  releaseForm.targetScope = 'SELECTED'
  releaseOpen.value = true
}

function defaultReleaseDurationMinutes(paper) {
  const paperMinutes = Number(paper?.defaultDurationSeconds) / 60
  return Number.isFinite(paperMinutes) && paperMinutes > 0
    ? Math.round(paperMinutes)
    : defaultPaperDurationMinutes(paper?.examTypeCode || props.code)
}

async function resumeDraft(exam) {
  error.value = ''; notice.value = ''; isSaving.value = true
  try {
    await ensureStaffTab('exams')
    const detail = await getExam(exam.id)
    const summary = detail.summary
    draftExamId.value = summary.id
    draftPaperTitle.value = summary.paperTitle || exam.paperTitle || 'Paper unavailable'
    draftHadTargets.value = detail.classIds.length > 0 || detail.studentUserIds.length > 0
    selectedClassIds.value = detail.classIds
    selectedStudentIds.value = detail.studentUserIds
    selectedStudentTargets.value = detail.studentTargets || []
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
  const paper = availablePapers.value.find((item) => String(item.id) === String(paperId))
  if (paper) releaseForm.durationMinutes = defaultReleaseDurationMinutes(paper)
})

function closeRelease() {
  if (isSaving.value) return
  releaseOpen.value = false
}

async function saveAndPublishExam() {
  error.value = ''; notice.value = ''
  if (releaseForm.targetScope !== 'ALL_STUDENTS'
      && selectedClassIds.value.length === 0 && selectedStudentIds.value.length === 0) {
    error.value = 'Select at least one class or a student within a class.'
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
    throw new Error('Keep at least one selected class or a student within a class.')
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
      studentTargets: selectedStudentTargets.value.map((target) => ({ classId: Number(target.classId), studentId: Number(target.studentId) })),
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

function getExamTimeStatus(exam) {
  const now = Date.now()
  if (new Date(exam.opensAt).getTime() > now) return { key: 'upcoming', label: 'Upcoming' }
  if (new Date(exam.closesAt).getTime() <= now) return { key: 'ended', label: 'Ended' }
  return { key: 'live', label: 'Live' }
}

function formatExamTarget(exam) {
  if (exam.targetSummary) return exam.targetSummary
  if (exam.targetScope === 'ALL_STUDENTS') return 'All students'
  return exam.targetScope === 'SPECIFIC_CLASSES' ? 'Specific classes' : 'Specific students'
}

function matchesExamTargetType(exam, selectedType) {
  if (selectedType === 'ALL_STUDENTS') return exam.targetScope === 'ALL_STUDENTS'
  const summary = String(exam.targetSummary || '')
  if (selectedType === 'SPECIFIC_CLASSES') return summary.includes('Classes:')
  if (selectedType === 'SPECIFIC_STUDENTS') return summary.includes('Students:')
  return false
}

function getExamAccessState(exam) {
  if (exam.status !== 'PUBLISHED') return { label: 'Not published', className: 'access-pill--hidden', detail: 'Students cannot see or start this release.' }
  const timeStatus = getExamTimeStatus(exam)
  if (timeStatus.key === 'upcoming') return { label: 'Scheduled', className: 'access-pill--scheduled', detail: 'Visible to students, but not open yet.' }
  if (timeStatus.key === 'ended') return { label: 'Closed', className: 'access-pill--closed', detail: 'The exam window has ended.' }
  return { label: 'Open', className: 'access-pill--open', detail: 'Students can see and start this release.' }
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

// 各考试类型使用各自的作答界面，SAT 和 PSAT 共用 SAT 考试流程。
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

    sessionStorage.setItem('sat:workspace', exam.examTypeCode)
    await router.push({ name: 'sat-student-exam', params: { examId: exam.id } })
  } catch (requestError) {
    error.value = requestError.message || 'Unable to start this exam.'
  } finally {
    startingExamId.value = null
  }
}

watch([error, notice], ([errorMessage, successMessage]) => {
  if (!isSatWorkspace.value && (editorOpen.value || releaseOpen.value || paperActionDialog.value)) return
  if (errorMessage) {
    showNotification({ title: 'Action failed', message: errorMessage, variant: 'error' })
  } else if (successMessage) {
    showNotification({ title: 'Changes saved', message: successMessage, variant: 'success' })
  }
})

watch([folderDialogError, renameFolderError, paperActionDialogError, examPublicationError], (messages) => {
  if (!isSatWorkspace.value) return
  const message = messages.find(Boolean)
  if (message) showNotification({ title: 'Action failed', message, variant: 'error' })
})

onMounted(() => {
  loadPage()
  syncExamReleaseRefresh()
})
function refreshActiveWorkspace() {
  if (!workspaceActive) return
  if (!isStaff.value) { loadStudentExams(); return }
  const requests = []
  if (canManageWorkspace.value) requests.push(loadWorkspaceExams())
  if (staffPapersLoaded.value) requests.push(ensureStaffPapers(true))
  if (staffClassesLoaded.value) requests.push(ensureStaffClasses(true))
  Promise.all(requests).catch((requestError) => { error.value = requestError.message })
}
function refreshOnVisibility() {
  if (document.visibilityState === 'visible') refreshActiveWorkspace()
}
onActivated(() => {
  workspaceActive = true
  document.addEventListener('visibilitychange', refreshOnVisibility)
  syncExamReleaseRefresh()
  if (!workspaceVisited) { workspaceVisited = true; return }
  if (['papers', 'exams', 'classes', 'reviews'].includes(route.query.tab)) activeTab.value = route.query.tab
  refreshActiveWorkspace()
})
onDeactivated(() => {
  workspaceActive = false
  document.removeEventListener('visibilitychange', refreshOnVisibility)
  if (examReleaseRefreshTimer) clearInterval(examReleaseRefreshTimer)
  examReleaseRefreshTimer = null
})
watch(activeTab, (tab) => {
  syncExamReleaseRefresh()
  if (isStaff.value && selectedType.value) ensureStaffTab(tab).catch((requestError) => { error.value = requestError.message })
})
watch(() => props.code, (code) => {
  availableExamsCollapsed.value = localStorage.getItem(`admin.available-exams-collapsed.${code}`) === 'true'
  loadPage()
  syncExamReleaseRefresh()
})
</script>

<template>
  <div class="page-content type-page-content" :class="{ 'type-page-content--compact-student': !isStaff, 'student-dashboard-workspace': !isStaff }">
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
    <RouterLink v-if="isStaff && !isSatWorkspace" class="back-link" to="/">← Back to exam types</RouterLink>
    <section v-if="selectedType && isStaff && !isSatWorkspace" class="module-intro type-workspace-intro">
      <div v-if="isStaff" class="eyebrow"><span class="eyebrow-line"></span>EXAM MANAGEMENT</div>
      <span v-if="isStaff" class="module-code">{{ selectedType.code }}</span>
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
          <div v-if="staffExamsLoading && !exams.length" class="table-empty">Loading exams...</div>
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
        <KeepAlive>
          <ClassesPage v-if="activeTab === 'classes' && staffClassesLoaded" :exam-type-code="props.code"
            :initial-classes="error ? null : classes" @classes-updated="classes = $event" />
        </KeepAlive>
        <p v-if="activeTab === 'classes' && staffClassesLoading && !staffClassesLoaded" class="admin-state">Loading classes...</p>
        <ReviewAssignmentsPanel v-if="activeTab === 'reviews'" :exam-type-code="props.code" />

      <AppCard v-if="activeTab === 'papers'" class="paper-list-card" title="Paper List" :subtitle="`Manage the latest ${props.code} paper versions.`">
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
        <div v-if="staffPapersLoading && !papers.length && !paperGroups.length" class="admin-state">Loading papers...</div>
        <div v-else-if="papers.length || paperGroups.length" class="folder-list folder-list--reorderable">
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
                <thead><tr><th>Paper</th><th>Questions</th><th>Duration</th><th title="Maximum raw points">Score</th><th>Status</th><th class="paper-actions-header">Actions</th></tr></thead>
                <tbody>
                  <tr v-for="paper in folder.items" :key="paper.id">
                    <td><strong>{{ paper.title }}</strong></td>
                    <td>{{ paper.questionCount ?? '—' }}</td>
                    <td>{{ paper.defaultDurationSeconds ? `${Math.round(paper.defaultDurationSeconds / 60)} min` : 'No time limit' }}</td>
                    <td>{{ paper.totalScore == null ? '—' : Number(paper.totalScore) }}</td>
                    <td>{{ paper.status }}</td>
                    <td class="paper-actions-cell">
                      <AdminActionMenu
                        v-if="isSatWorkspace"
                        label="Paper actions"
                        :open="openPaperActionMenuId === paper.id"
                        @update:open="setPaperActionMenuOpen(paper.id, $event)"
                      >
                        <button type="button" @click="handlePaperAction(() => openMovePaperDialog(paper))">Move</button>
                        <button type="button" @click="handlePaperAction(() => showPaperDetails(paper))">Detail</button>
                        <button v-if="paper.status !== 'ARCHIVED'" type="button" @click="handlePaperAction(() => openEditPaperInfoDialog(paper))">Edit Info</button>
                        <button v-if="paper.status !== 'ARCHIVED'" type="button" @click="handlePaperAction(() => editPaper(paper))">Edit Paper</button>
                        <button type="button" @click="handlePaperAction(() => router.push({ name: `${props.code.toLowerCase()}-paper-preview`, params: { paperId: paper.id }, query: { returnTo: getWorkspaceReturnPath() } }))">Preview</button>
                        <button type="button" @click="handlePaperAction(() => router.push({ name: `${props.code.toLowerCase()}-paper-export`, params: { paperId: paper.id }, query: { returnTo: getWorkspaceReturnPath() } }))">Export PDF</button>
                        <button class="admin-action-menu__danger" type="button" @click="handlePaperAction(() => openDeletePaperDialog(paper))">Delete</button>
                      </AdminActionMenu>
                      <div v-else class="table-actions">
                        <button v-if="paper.status === 'DRAFT'" @click="editPaper(paper)">Edit</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </AdminDataTable>
            </div>
            <div v-else-if="isPaperFolderExpanded(folder.key)" class="folder-panel__empty">{{ appliedPaperKeyword ? 'No papers match the search.' : 'No papers in this folder yet.' }}</div>
          </section>
        </div>
        <div v-else-if="!staffPapersLoading" class="admin-state">No papers found.</div>
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
          <p v-if="folderDialogError && !isSatWorkspace" class="error-text" role="alert">{{ folderDialogError }}</p>
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
          <p v-if="renameFolderError && !isSatWorkspace" class="error-text" role="alert">{{ renameFolderError }}</p>
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
        <p v-if="paperActionDialogError && !isSatWorkspace" class="error-text" role="alert">{{ paperActionDialogError }}</p>
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
          <p v-if="paperActionDialogError && !isSatWorkspace" class="error-text" role="alert">{{ paperActionDialogError }}</p>
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
          <label class="form-field">
            <span class="form-label">Default duration (minutes)</span>
            <input v-model.number="editPaperDurationMinutes" class="form-input" type="number" min="1" step="any" placeholder="No time limit" />
          </label>
          <p v-if="paperActionDialogError && !isSatWorkspace" class="error-text" role="alert">{{ paperActionDialogError }}</p>
        </form>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="paperActionDialogSaving" @click="editPaperTarget = null">Cancel</AppButton>
          <AppButton type="submit" form="edit-paper-info-form" :disabled="paperActionDialogSaving || !editPaperTitle.trim()">
            {{ paperActionDialogSaving ? 'Saving…' : 'Save changes' }}
          </AppButton>
        </template>
      </AppModal>

      <AppModal
        v-if="paperActionDialog"
        title="Delete paper?"
        :busy="paperActionDialogSaving"
        @close="paperActionDialog = null"
      >
        <p>Delete “{{ paperActionDialog.title }}”? Papers used by exams or newer versions cannot be deleted.</p>
        <p v-if="paperActionDialogError && !isSatWorkspace" class="error-text" role="alert">{{ paperActionDialogError }}</p>
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="paperActionDialogSaving" @click="paperActionDialog = null">Cancel</AppButton>
          <AppButton
            type="button"
            variant="danger"
            :disabled="paperActionDialogSaving"
            @click="confirmPaperAction"
          >
            {{ paperActionDialogSaving ? 'Deleting…' : 'Delete paper' }}
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

      <AppCard v-if="activeTab === 'exams'" class="sat-exam-releases-card exam-releases-card" title="Exam Releases" subtitle="Find a release, check its audience and window, then publish or unpublish it.">
        <div class="card-top-actions">
          <AppButton class="card-top-actions__primary" :disabled="!availablePapers.length" @click="openRelease">Create Exam</AppButton>
          <button class="admin-refresh-button" :class="{ 'admin-refresh-button--loading': staffExamsLoading }" type="button" :disabled="staffExamsLoading" aria-label="Refresh releases" title="Refresh releases" @click="loadWorkspaceExams(true)">
            <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" /></svg>
          </button>
          <button class="collapse-arrow-button" type="button" :aria-label="examReleasesCollapsed ? 'Expand exam releases' : 'Collapse exam releases'" :title="examReleasesCollapsed ? 'Expand' : 'Collapse'" @click="toggleExamReleases">
            <svg class="collapse-arrow-button__icon" :class="{ 'collapse-arrow-button__icon--collapsed': examReleasesCollapsed }" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7.4 14.6 4.6-4.6 4.6 4.6L18 13.2l-6-6-6 6 1.4 1.4Z" /></svg>
          </button>
        </div>
        <template v-if="!examReleasesCollapsed">
        <div class="admin-toolbar release-toolbar">
          <div class="admin-toolbar__filters">
            <input v-model="examKeyword" class="form-input release-search-input" placeholder="Search title, paper, target" />
            <select v-model="examReleaseFilters.published" class="form-input form-input--compact" aria-label="Visibility filter">
              <option value="">All visibility</option><option value="published">Published releases</option><option value="unpublished">Unpublished releases</option>
            </select>
            <select v-model="examReleaseFilters.timeStatus" class="form-input form-input--compact" aria-label="Time status">
              <option value="">All time windows</option><option value="upcoming">Upcoming</option><option value="live">Live</option>
            </select>
            <select v-model="examReleaseFilters.targetType" class="form-input form-input--compact" aria-label="Target type">
              <option value="">All audiences</option><option value="ALL_STUDENTS">All students</option><option value="SPECIFIC_CLASSES">Specific classes</option><option value="SPECIFIC_STUDENTS">Specific students</option>
            </select>
          </div>
        </div>
        <div v-if="staffExamsLoading && !exams.length" class="admin-state">Loading exams...</div>
        <div
          v-else-if="currentExams.length"
          class="table-wrap sat-exam-release-table-wrap"
          role="region"
          aria-label="Exam releases"
          tabindex="0"
        >
          <p class="mobile-table-scroll-hint">Swipe horizontally to view all columns.</p>
          <AdminDataTable class="exam-release-table">
            <colgroup>
              <col class="exam-release-table__title-column" />
              <col class="exam-release-table__time-column" />
              <col class="exam-release-table__target-column" />
              <col class="exam-release-table__submission-column" />
              <col class="exam-release-table__access-column" />
              <col class="exam-release-table__actions-column" />
            </colgroup>
            <thead><tr><th>Exam / Paper</th><th>Time Window</th><th>Assigned To</th><th>Submission</th><th>Student Access</th><th class="action-column-header">Actions</th></tr></thead>
            <tbody>
              <tr v-for="exam in visibleExams" :key="exam.id">
                <td class="exam-release-table__title-cell">
                  <strong :title="exam.title">{{ exam.title }}</strong>
                  <small :title="exam.paperTitle">{{ exam.paperTitle }}</small>
                  <small v-if="exam.description">{{ exam.description }}</small>
                </td>
                <td class="exam-release-table__time-cell" :title="`${formatExamDate(exam.opensAt)} – ${formatExamDate(exam.closesAt)}`">
                  <span>{{ formatExamDate(exam.opensAt) }}</span><span>{{ formatExamDate(exam.closesAt) }}</span>
                </td>
                <td class="exam-release-table__target-cell" :title="formatExamTarget(exam)"><span>{{ formatExamTarget(exam) }}</span></td>
                <td class="exam-release-table__submission-cell">{{ exam.attemptLimit === 1 ? 'One result' : `${exam.attemptLimit} attempts` }}</td>
                <td class="exam-release-table__access-cell">
                  <span class="access-pill" :class="getExamAccessState(exam).className" :title="getExamAccessState(exam).detail">{{ getExamAccessState(exam).label }}</span>
                </td>
                <td class="exam-release-table__actions-cell action-column-cell">
                  <ResponsiveActionGroup align="center" :actions="getExamActions(exam)" :label="`Actions for ${exam.title}`" />
                </td>
              </tr>
            </tbody>
          </AdminDataTable>
        </div>
        <p v-else class="admin-state">{{ !exams.length ? 'No exam releases yet. Create an exam to get started.' : !filteredExams.length ? 'No releases match your search.' : 'No upcoming or active releases. Ended exams are listed below.' }}</p>
        <div v-if="!examReleasesCollapsed && currentExams.length" class="table-pagination sat-exam-pagination">
          <span>Showing {{ (currentExamPage - 1) * examPageSize + 1 }}-{{ Math.min(currentExamPage * examPageSize, currentExams.length) }} of {{ currentExams.length }}</span>
          <div class="table-pagination__actions">
            <label class="table-pagination__page-size"><span>Rows</span><select v-model.number="examPageSize" class="form-input form-input--compact" aria-label="Rows per page"><option :value="5">5</option><option :value="10">10</option><option :value="20">20</option></select></label>
            <button type="button" :disabled="currentExamPage <= 1" @click="currentExamPage--">Prev</button>
            <span>Page {{ currentExamPage }} / {{ currentExamPageCount }}</span>
            <button type="button" :disabled="currentExamPage >= currentExamPageCount" @click="currentExamPage++">Next</button>
          </div>
        </div>
        </template>
      </AppCard>

      <AppCard v-if="activeTab === 'exams'" class="sat-exam-releases-card sat-historical-exams-card" title="Historical Exams" subtitle="Ended releases are kept here for results and review.">
        <div class="card-top-actions">
          <span class="historical-exam-count">{{ historicalExams.length }} {{ historicalExams.length === 1 ? 'exam' : 'exams' }}</span>
          <button class="admin-refresh-button" type="button" aria-label="Refresh historical exams" title="Refresh historical exams" @click="loadWorkspaceExams(true)">
            <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" /></svg>
          </button>
          <button class="collapse-arrow-button" type="button" :aria-label="historicalExamsCollapsed ? 'Expand historical exams' : 'Collapse historical exams'" :title="historicalExamsCollapsed ? 'Expand' : 'Collapse'" @click="toggleHistoricalExams">
            <svg class="collapse-arrow-button__icon" :class="{ 'collapse-arrow-button__icon--collapsed': historicalExamsCollapsed }" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7.4 14.6 4.6-4.6 4.6 4.6L18 13.2l-6-6-6 6 1.4 1.4Z" /></svg>
          </button>
        </div>
        <div v-if="!historicalExamsCollapsed && (!staffExamsLoading || exams.length) && historicalExams.length" class="table-wrap sat-exam-release-table-wrap exam-release-table-wrap" role="region" aria-label="Historical exams" tabindex="0">
          <p class="mobile-table-scroll-hint">Swipe horizontally to view all columns.</p>
          <AdminDataTable class="exam-release-table exam-release-table--history">
            <colgroup>
              <col class="exam-release-table__title-column" />
              <col class="exam-release-table__time-column" />
              <col class="exam-release-table__target-column" />
              <col class="exam-release-table__submission-column" />
              <col class="exam-release-table__access-column" />
              <col class="exam-release-table__actions-column" />
            </colgroup>
            <thead><tr><th>Exam / Paper</th><th>Ended At</th><th>Assigned To</th><th>Submission</th><th>Visibility</th><th class="action-column-header">Actions</th></tr></thead>
            <tbody>
              <tr v-for="exam in visibleHistoricalExams" :key="exam.id">
                <td class="exam-release-table__title-cell">
                  <strong :title="exam.title">{{ exam.title }}</strong>
                  <small :title="exam.paperTitle">{{ exam.paperTitle || 'Paper unavailable' }}</small>
                  <small v-if="exam.description">{{ exam.description }}</small>
                </td>
                <td class="exam-release-table__time-cell" :title="formatExamDate(exam.closesAt)">{{ formatExamDate(exam.closesAt) }}</td>
                <td class="exam-release-table__target-cell" :title="formatExamTarget(exam)"><span>{{ formatExamTarget(exam) }}</span></td>
                <td class="exam-release-table__submission-cell">{{ exam.attemptLimit === 1 ? 'One result' : `${exam.attemptLimit} attempts` }}</td>
                <td class="exam-release-table__access-cell">
                  <span class="access-pill" :class="exam.status === 'PUBLISHED' ? 'access-pill--scheduled' : 'access-pill--hidden'">
                    {{ exam.status === 'PUBLISHED' ? 'Published' : 'Unpublished' }}
                  </span>
                </td>
                <td class="exam-release-table__actions-cell action-column-cell"><ResponsiveActionGroup align="center" :actions="getExamActions(exam)" :label="`Actions for ${exam.title}`" /></td>
              </tr>
            </tbody>
          </AdminDataTable>
        </div>
        <div v-if="!historicalExamsCollapsed && historicalExams.length" class="table-pagination sat-exam-pagination">
          <span>Showing {{ (historicalExamPage - 1) * examPageSize + 1 }}-{{ Math.min(historicalExamPage * examPageSize, historicalExams.length) }} of {{ historicalExams.length }}</span>
          <div class="table-pagination__actions">
            <label class="table-pagination__page-size"><span>Rows</span><select v-model.number="examPageSize" class="form-input form-input--compact" aria-label="Rows per page"><option :value="5">5</option><option :value="10">10</option><option :value="20">20</option></select></label>
            <button type="button" :disabled="historicalExamPage <= 1" @click="historicalExamPage--">Prev</button>
            <span>Page {{ historicalExamPage }} / {{ historicalExamPageCount }}</span>
            <button type="button" :disabled="historicalExamPage >= historicalExamPageCount" @click="historicalExamPage++">Next</button>
          </div>
        </div>
        <p v-else-if="!historicalExamsCollapsed && staffExamsLoading && !exams.length" class="admin-state">Loading historical exams…</p>
        <p v-else-if="!historicalExamsCollapsed" class="admin-state">{{ exams.length && !historicalExams.length ? 'No historical exams match your search.' : 'No historical exams yet.' }}</p>
      </AppCard>

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
        title="Hide this exam?"
        eyebrow="Delete Release"
        :busy="examActionId === examDeleteTarget.id"
        @close="closeDeleteExamConfirm"
      >
        <p class="exam-delete-warning">
          This hides the exam from the release list and students. Class records and reports will be retained.
        </p>
        <p class="exam-delete-cooldown" :class="{ 'exam-delete-cooldown--ready': examDeleteCooldown === 0 }" aria-live="polite">
          {{ examDeleteCooldown > 0 ? `You can confirm in ${examDeleteCooldown} ${examDeleteCooldown === 1 ? 'second' : 'seconds'}.` : 'You can now confirm.' }}
        </p>
        <template #footer>
          <AppButton variant="secondary" :disabled="examActionId !== null" @click="closeDeleteExamConfirm">Cancel</AppButton>
          <AppButton :disabled="examActionId !== null || examDeleteCooldown > 0" @click="confirmDeleteExam">
            {{ examActionId !== null ? 'Hiding…' : examDeleteCooldown > 0 ? `Hide Exam (${examDeleteCooldown})` : 'Hide Exam' }}
          </AppButton>
        </template>
      </AppModal>

      <CreatePaperDialog
        v-if="editorOpen && !selectedPaper"
        v-model:name="paperForm.title"
        v-model:description="paperForm.description"
        v-model:group-id="paperForm.groupId"
        v-model:duration="paperForm.defaultDurationMinutes"
        :exam-type="props.code"
        :groups="createPaperFolders"
        :busy="isSaving"
        :error="error"
        @close="editorOpen = false"
        @clear-error="error = ''"
        @submit="savePaper"
      />

      <AppModal
        v-if="editorOpen && selectedPaper"
        :title="selectedPaper ? 'Edit paper' : 'Create paper'"
        :width="selectedPaper ? '1100px' : '680px'"
        :busy="isSaving"
        @close="editorOpen = false"
      >
        <div class="account-form paper-meta-form paper-editor-fields"><label class="wide-field">Title<input v-model.trim="paperForm.title" maxlength="200" required /></label><label>Default duration (minutes)<input v-model.number="paperForm.defaultDurationMinutes" type="number" min="1" step="1" required /></label><label class="wide-field">Description<textarea v-model.trim="paperForm.description" rows="2" maxlength="2000"></textarea></label></div>
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
          <p v-if="error && !isSatWorkspace" class="form-error modal-form-error" role="alert">{{ error }}</p>
          <AppButton variant="secondary" :disabled="isSaving" @click="editorOpen = false">Cancel</AppButton>
          <AppButton :disabled="isSaving" @click="savePaper">{{ isSaving ? 'Saving…' : selectedPaper ? 'Save draft' : 'Create paper' }}</AppButton>
        </template>
      </AppModal>

      <ExamReleaseDialog
        v-if="releaseOpen"
        v-model:class-ids="selectedClassIds"
        v-model:student-ids="selectedStudentIds"
        v-model:student-targets="selectedStudentTargets"
        :form="releaseForm"
        :fields="releaseFields"
        :paper-groups="releasePaperGroups"
        :classes="classes"
        :exam-type="props.code"
        :allow-all-students="false"
        :title="draftExamId ? 'Edit Exam Draft' : 'Create Exam'"
        :paper-locked="Boolean(draftExamId)"
        :busy="isSaving"
        :error="error"
        @close="closeRelease"
        @submit="saveAndPublishExam"
      >
        <template #footer>
          <AppButton type="button" variant="secondary" :disabled="isSaving" @click="closeRelease">Cancel</AppButton>
          <AppButton type="button" variant="secondary" :disabled="isSaving" @click="saveExamDraft">{{ isSaving ? 'Saving…' : 'Save draft' }}</AppButton>
          <AppButton type="submit" form="create-exam-release-form" :disabled="isSaving || !releaseForm.paperId">{{ isSaving ? 'Publishing…' : 'Save & Publish' }}</AppButton>
        </template>
      </ExamReleaseDialog>
        </AdminTabPanels>
        </AdminSection>
      </div>
    </template>

    <template v-else-if="selectedType">
        <div class="student-home">
          <AppCard class="management-card student-home-section" title="My Exams" subtitle="Only exams published to your account are shown.">
            <button class="student-home-refresh" type="button" aria-label="Refresh exams" title="Refresh exams" :disabled="studentExamsLoading" @click="loadStudentExams(true)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a6.98 6.98 0 0 0 6.32-4Z" /></svg>
            </button>
            <div v-if="studentExamsLoading && !studentExams.length" class="student-home-state">Loading exams...</div>
            <p v-else-if="studentExamError" class="error-text" role="alert">{{ studentExamError }}</p>
            <template v-else>
              <section v-for="group in groupedStudentExams" :key="group.key" class="student-home-subsection">
                <h3 class="student-home-subsection__title">{{ group.title }} <span class="student-home-subsection__count">{{ group.exams.length }}</span></h3>
                <div v-if="group.exams.length" class="student-home-grid">
                  <article v-for="exam in group.exams" :key="exam.id" class="student-home-exam-card">
                    <header class="student-home-exam-card__header">
                      <div><span class="student-home-eyebrow">Exam #{{ exam.id }}</span><h3>{{ exam.title }}</h3></div>
                      <span class="student-home-status" :class="`student-home-status--${studentExamStatusClass(exam)}`">{{ getStudentExamState(exam).canViewAttempt && !getStudentExamState(exam).canStart ? 'Completed' : getStudentExamState(exam).label }}</span>
                    </header>
                    <p class="student-home-exam-card__description">{{ exam.paperTitle || 'Assigned exam' }}</p>
                    <dl class="student-home-meta">
                      <div class="student-home-meta__wide"><dt>Time Window</dt><dd>{{ formatExamDate(exam.opensAt) }} – {{ formatExamDate(exam.closesAt) }}</dd></div>
                      <div><dt>Submission</dt><dd>{{ getStudentExamState(exam).canViewAttempt ? 'Final result recorded' : getStudentExamState(exam).label }}</dd></div>
                      <div><dt>Duration</dt><dd>{{ exam.durationSeconds ? `${Math.round(exam.durationSeconds / 60)} min` : 'Use paper default' }}</dd></div>
                    </dl>
                    <AppButton v-if="getStudentExamState(exam).canStart" class="student-home-card-action" :disabled="startingExamId === exam.id" @click="openStudentExam(exam)">
                      {{ startingExamId === exam.id ? 'Starting…' : getStudentExamState(exam).startLabel }}
                    </AppButton>
                    <AppButton v-else class="student-home-card-action" disabled>{{ getStudentExamState(exam).canViewAttempt ? 'Completed' : getStudentExamState(exam).label }}</AppButton>
                  </article>
                </div>
                <p v-else class="student-home-state">{{ group.empty }}</p>
              </section>
            </template>
          </AppCard>

          <AppCard class="management-card student-home-section" title="Assigned Review" subtitle="Redo incorrect and unanswered questions assigned by your teacher. Your original exam result stays unchanged.">
            <button class="student-home-refresh" type="button" aria-label="Refresh assigned reviews" title="Refresh assigned reviews" :disabled="studentHomeHistoryLoading" @click="loadStudentExams(true)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a6.98 6.98 0 0 0 6.32-4Z" /></svg>
            </button>
            <p v-if="studentHomeHistoryError" class="error-text" role="alert">{{ studentHomeHistoryError }}</p>
            <p v-else-if="(props.code === 'SHSAT' ? historyLoading : studentReviewLoading) && !studentReviewTasks.length" class="student-home-state">Loading assigned reviews...</p>
            <p v-else-if="!activeReviewTasks.length" class="student-home-state">No review assignments to complete.</p>
            <template v-else>
              <div ref="reviewTaskGrid" class="student-home-grid student-home-review-grid">
                <article v-for="task in visibleReviewTasks" :key="task.assignmentId" class="student-home-review-card">
                  <header class="student-home-exam-card__header">
                    <div><span class="student-home-eyebrow">Exam Review Practice</span><h3>{{ task.title }}</h3></div>
                    <span class="student-home-status">{{ reviewTaskStatusLabel(task.status) }}</span>
                  </header>
                  <p class="student-home-review-card__exam">{{ task.examTitle }}</p>
                  <p v-if="task.description" class="student-home-review-card__description">{{ task.description }}</p>
                  <dl class="student-home-review-meta">
                    <div><dt>Questions remaining</dt><dd><strong>{{ task.remainingQuestionCount }}</strong><small>Original review set: {{ task.totalQuestions }} questions</small></dd></div>
                    <div><dt>Latest accuracy</dt><dd>{{ task.accuracy == null ? '—' : `${Math.round(Number(task.accuracy))}%` }}</dd></div>
                  </dl>
                  <p v-if="task.startAt || task.endAt" class="student-home-review-card__availability">Available {{ task.startAt ? formatExamDate(task.startAt) : 'now' }}<span v-if="task.endAt"> – {{ formatExamDate(task.endAt) }}</span></p>
                  <AppButton class="student-home-card-action" :disabled="!task.canStart && task.status !== 'IN_PROGRESS' || startingReviewTaskId === task.assignmentId" @click="startReviewTask(task)">
                    {{ reviewTaskActionLabel(task) }}
                  </AppButton>
                </article>
              </div>
              <div v-if="reviewTaskPageCount > 1" class="student-home-pagination" aria-label="Assigned review pages">
                <button type="button" :disabled="reviewTaskPage <= 1" @click="changeReviewTaskPage(reviewTaskPage - 1)">Previous</button>
                <span>Page {{ reviewTaskPage }} of {{ reviewTaskPageCount }}</span>
                <button type="button" :disabled="reviewTaskPage >= reviewTaskPageCount" @click="changeReviewTaskPage(reviewTaskPage + 1)">Next</button>
              </div>
            </template>
          </AppCard>

          <AppCard class="management-card student-home-section" title="Score History and Explanations" subtitle="Scores and answers follow the visibility policy set by your teacher.">
            <button class="student-home-refresh" type="button" aria-label="Refresh score history" title="Refresh score history" :disabled="studentHomeHistoryLoading" @click="loadStudentExams(true)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a6.98 6.98 0 0 0 6.32-4Z" /></svg>
            </button>
            <p class="student-home-history-note">Completed attempts appear here when scores or explanations are available.</p>
            <p v-if="studentHomeHistoryError" class="error-text" role="alert">{{ studentHomeHistoryError }}</p>
            <p v-else-if="studentHomeHistoryLoading && !(props.code === 'SHSAT' ? studentAttemptHistory.length : studentPracticeHistory.length)" class="student-home-state">Loading score history...</p>
            <div v-else>
              <div class="history-tabs" role="tablist" aria-label="Student history views">
                <button class="history-tab" :class="{ 'history-tab--active': activeHistoryTab === 'history' }" type="button" role="tab" :aria-selected="activeHistoryTab === 'history'" @click="selectStudentHistoryTab('history')">Exam History</button>
                <button v-if="props.code === 'SHSAT'" class="history-tab" :class="{ 'history-tab--active': activeHistoryTab === 'wrong-answers' }" type="button" role="tab" :aria-selected="activeHistoryTab === 'wrong-answers'" @click="selectStudentHistoryTab('wrong-answers')">Wrong Answer Book <span v-if="shsatWrongAnswerBooks.length" class="history-tab__count">{{ shsatWrongAnswerBooks.length }}</span></button>
                <button class="history-tab" :class="{ 'history-tab--active': activeHistoryTab === 'review-tasks' }" type="button" role="tab" :aria-selected="activeHistoryTab === 'review-tasks'" @click="selectStudentHistoryTab('review-tasks')">Review Task History <span v-if="completedReviewTasks.length" class="history-tab__count">{{ completedReviewTasks.length }}</span></button>
              </div>
              <div v-if="activeHistoryTab === 'history' && props.code === 'SHSAT'" class="shsat-history-list">
                <article v-for="item in shsatFormalHistory" :key="item.attemptId" class="shsat-history-row">
                  <div class="paper-copy"><strong>{{ item.examTitle }}</strong><small>Attempt #{{ item.attemptNumber }} · {{ formatExamDate(item.submittedAt || item.startedAt) }}</small></div>
                  <div class="shsat-history-score"><strong>{{ item.scoreVisible ? (item.totalScore ?? '—') : 'Not available yet' }}</strong><small>Raw score</small></div>
                  <AppButton variant="secondary" @click="viewShsatAttempt(item)">View report</AppButton>
                </article>
                <p v-if="!shsatFormalHistory.length" class="table-empty">No completed SHSAT exams yet.</p>
              </div>
              <div v-else-if="activeHistoryTab === 'history'" class="shsat-history-list">
                <article v-for="record in studentPracticeHistory" :key="record.attemptId" class="shsat-history-row">
                  <div class="paper-copy"><strong>{{ record.paperTitle }}</strong><small>{{ formatExamDate(record.submittedAt) }} · {{ Math.round(record.timeSpentSeconds / 60) }} min</small></div>
                  <div class="shsat-history-score"><strong>{{ record.rawScore ?? '—' }}<span v-if="record.rawMaximum"> / {{ record.rawMaximum }}</span></strong><small>Raw score</small></div>
                  <AppButton variant="secondary" @click="viewPracticeReport(record)">View report</AppButton>
                </article>
                <div v-if="practiceHistoryTotal > 10" class="practice-history-pagination">
                  <button class="secondary-button compact-button" :disabled="practiceHistoryPage <= 1" @click="changePracticeHistoryPage(practiceHistoryPage - 1)">Previous</button>
                  <span>Page {{ practiceHistoryPage }} of {{ Math.ceil(practiceHistoryTotal / 10) }}</span>
                  <button class="secondary-button compact-button" :disabled="practiceHistoryPage >= Math.ceil(practiceHistoryTotal / 10)" @click="changePracticeHistoryPage(practiceHistoryPage + 1)">Next</button>
                </div>
                <p v-if="!studentPracticeHistory.length" class="table-empty">No completed practice tests yet.</p>
              </div>
              <div v-else-if="activeHistoryTab === 'review-tasks'" class="shsat-history-list">
                <article v-for="task in completedReviewTasks" :key="task.assignmentId" class="shsat-history-row">
                  <div class="paper-copy"><strong>{{ task.title }}</strong><small>{{ task.examTitle }} · {{ task.clearedQuestionCount }} / {{ task.totalQuestions }} questions cleared</small></div>
                  <span class="status-pill is-active">Completed</span>
                  <AppButton variant="secondary" @click="viewCompletedReviewReport(task)">View report</AppButton>
                </article>
                <p v-if="!completedReviewTasks.length" class="table-empty">No completed review assignments yet.</p>
              </div>
              <template v-else-if="props.code === 'SHSAT'">
                <div v-if="shsatWrongAnswerBooks.length" ref="wrongAnswerBookGrid" class="student-home-wrong-answer-grid">
                  <article v-for="item in visibleWrongAnswerBooks" :key="item.attemptId" class="student-home-wrong-book">
                    <div class="student-home-wrong-book__cover">
                      <span class="student-home-eyebrow">Wrong Answer Book</span>
                      <h3>{{ item.examTitle }}</h3>
                      <div class="student-home-wrong-book__count"><strong>{{ item.answersVisible ? item.remainingReviewCount : '—' }}</strong><span>{{ item.answersVisible ? 'questions remaining' : 'review locked' }}</span></div>
                      <small>Exam {{ item.examId }} · Attempt {{ item.attemptNumber }}</small>
                    </div>
                    <div class="student-home-wrong-book__body">
                      <div class="student-home-wrong-book__meta">
                        <span>{{ formatExamDate(item.submittedAt || item.startedAt) }}</span>
                        <span class="student-home-wrong-book__status">{{ !item.answersVisible ? 'Review disabled' : item.remainingReviewCount ? 'Ready to review' : 'Cleared' }}</span>
                      </div>
                      <p>{{ item.answersVisible ? 'Review the questions you missed in this exam.' : 'Review is disabled for this exam.' }}</p>
                      <AppButton variant="secondary" :disabled="!item.answersVisible || !item.remainingReviewCount" @click="viewShsatWrongAnswers(item)">View wrong answers</AppButton>
                      <AppButton :disabled="!item.answersVisible || !item.remainingReviewCount || startingWrongAnswerAttemptId !== null" @click="practiceShsatWrongAnswers(item)">{{ startingWrongAnswerAttemptId === item.attemptId ? 'Starting…' : 'Practice' }}</AppButton>
                      <AppButton variant="ghost" :disabled="!latestWrongAnswerPractice.get(String(item.attemptId))" @click="viewLatestShsatPractice(item)">Latest practice report</AppButton>
                    </div>
                  </article>
                </div>
                <div v-if="wrongAnswerBookPageCount > 1" class="wrong-answer-book-pagination" aria-label="Wrong answer book pages">
                  <button type="button" :disabled="wrongAnswerBookPage <= 1" @click="changeWrongAnswerBookPage(wrongAnswerBookPage - 1)">Previous</button>
                  <span>Page {{ wrongAnswerBookPage }} of {{ wrongAnswerBookPageCount }}</span>
                  <button type="button" :disabled="wrongAnswerBookPage >= wrongAnswerBookPageCount" @click="changeWrongAnswerBookPage(wrongAnswerBookPage + 1)">Next</button>
                </div>
                <p v-if="!shsatWrongAnswerBooks.length" class="table-empty">No wrong answers are available for review.</p>
              </template>
              <p v-else class="table-empty">No completed review assignments yet.</p>
            </div>
          </AppCard>
        </div>
    </template>
    <div v-if="isLoading" class="loading-state"><span class="loading-rule"></span>Loading…</div>
  </div>
</template>

<style scoped>
.student-dashboard-workspace { max-width: 1200px; padding-top: 36px; }
.student-home { display: grid; gap: 22px; }
.student-home-section { position: relative; margin: 0; }
.student-home-section :deep(.app-card__header) { margin-bottom: 20px; }
.student-home-section :deep(.app-card__title) { color: #202b40; font-size: 20px; font-weight: 700; }
.student-home-section :deep(.app-card__subtitle) { color: #667b9e; line-height: 1.5; }
.student-home-refresh { position: absolute; top: 20px; right: 22px; display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid #d4e2ff; border-radius: 50%; background: #edf3ff; color: #2563eb; cursor: pointer; }
.student-home-refresh svg { width: 16px; height: 16px; }
.student-home-refresh:disabled { cursor: wait; opacity: .55; }
.student-home-state { margin: 0; padding: 12px 2px; color: #667b9e; font-size: 14px; }
.student-home-subsection + .student-home-subsection { margin-top: 24px; }
.student-home-subsection__title { margin: 0 0 14px; color: #202b40; font-size: 15px; font-weight: 700; }
.student-home-subsection__count { display: inline-flex; margin-left: 6px; border-radius: 999px; padding: 2px 8px; background: #edf3ff; color: #2563eb; font-size: 11px; font-weight: 750; vertical-align: middle; }
.student-home-history-note { margin: 0; color: #667b9e; font-size: 13px; }
.student-home-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 340px)); align-items: stretch; gap: 16px; padding: 0 4px 2px; }
.student-home-exam-card, .student-home-review-card { display: flex; min-width: 0; flex-direction: column; gap: 12px; border: 1px solid #d7e4fb; border-radius: 16px; padding: 14px; background: #fff; box-shadow: 0 10px 26px rgb(31 75 135 / 6%); }
.student-home-exam-card { min-height: 278px; }
.student-home-exam-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.student-home-exam-card__header > div { min-width: 0; }
.student-home-eyebrow { color: #687d9e; font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.student-home-exam-card h3, .student-home-review-card h3 { margin: 6px 0 0; color: #1c2940; font-size: 15px; line-height: 1.3; overflow-wrap: anywhere; }
.student-home-status { flex: 0 0 auto; max-width: 115px; border-radius: 999px; padding: 5px 9px; background: #edf3f8; color: #63758f; font-size: 11px; font-weight: 750; line-height: 1.2; text-align: center; }
.student-home-status--is-active, .student-home-status--is-progress { background: #eaf1ff; color: #245dd8; }
.student-home-status--is-upcoming { background: #f1f6ff; color: #52627a; }
.student-home-exam-card__description { min-height: 34px; margin: 0; color: #667b9e; font-size: 13px; line-height: 1.4; }
.student-home-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin: 0; }
.student-home-meta > div { min-width: 0; border: 1px solid #d7e4fb; border-radius: 12px; padding: 8px; background: #fbfdff; }
.student-home-meta__wide { grid-column: 1 / -1; }
.student-home-meta dt, .student-home-review-meta dt { color: #687d9e; font-size: 11px; }
.student-home-meta dd { margin: 2px 0 0; color: #1c2940; font-size: 12px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.student-home-card-action { width: 100%; min-height: 40px; margin-top: auto; }
.student-home-card-action:deep(.app-button) { width: 100%; }
.student-home-review-card { min-height: 338px; padding: 16px; background: linear-gradient(145deg, #fff, #f7faff); }
/* Assigned Review 分页后固定展示两排：容器最小高度按两张卡片高度预留，
   不再随任务数量无限拉高，翻页时高度保持稳定。 */
.student-home-review-grid { min-height: calc(338px * 2 + 16px); align-content: start; }
.student-home-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-top: 14px; color: #667b9e; font-size: 13px; }
.student-home-pagination button { min-height: 34px; border: 1px solid #d4e2ff; border-radius: 999px; padding: 0 14px; background: #f5f8ff; color: #245dd8; cursor: pointer; font: inherit; font-weight: 650; }
.student-home-pagination button:hover:not(:disabled) { background: #eaf1ff; }
.student-home-pagination button:disabled { cursor: default; opacity: .45; }
.student-home-review-card__exam, .student-home-review-card__description, .student-home-review-card__availability { margin: 0; color: #667b9e; font-size: 12px; line-height: 1.45; }
.student-home-review-card__exam { color: #245dd8; font-weight: 750; }
.student-home-review-card__description { min-height: 34px; }
.student-home-review-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: auto 0 0; border-top: 1px solid #d7e4fb; padding-top: 12px; }
.student-home-review-meta dd { display: flex; flex-direction: column; gap: 2px; margin: 4px 0 0; color: #1c2940; font-size: 14px; font-weight: 750; }
.student-home-review-meta dd strong { font-size: 16px; }
.student-home-review-meta dd small { color: #687d9e; font-size: 10px; font-weight: 500; }
.student-home-history-note + .history-tabs { margin-top: 12px; }
.student-home-wrong-answer-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 340px)); align-content: start; gap: 16px; min-height: 420px; max-height: min(1000px, calc(100vh - 240px)); overflow-y: auto; padding: 8px 0 2px; }
.wrong-answer-book-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-top: 14px; color: #667b9e; font-size: 13px; }
.wrong-answer-book-pagination button { min-height: 34px; border: 1px solid #d4e2ff; border-radius: 999px; padding: 0 14px; background: #f5f8ff; color: #245dd8; cursor: pointer; font: inherit; font-weight: 650; }
.wrong-answer-book-pagination button:hover:not(:disabled) { background: #eaf1ff; }
.wrong-answer-book-pagination button:disabled { cursor: default; opacity: .45; }
.student-home-wrong-book { overflow: hidden; border: 1px solid #f0ddc7; border-radius: 12px; background: #fff; box-shadow: 0 10px 24px rgb(99 62 24 / 7%); }
.student-home-wrong-book__cover { display: grid; gap: 10px; min-height: 220px; border-left: 6px solid #f27a19; padding: 18px; background: #fff7ec; }
.student-home-wrong-book__cover h3 { margin: 8px 0 0; color: #233452; font-family: Georgia, serif; font-size: 20px; line-height: 1.25; overflow-wrap: anywhere; }
.student-home-wrong-book__count { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; color: #6b7d99; font-size: 11px; font-weight: 650; }
.student-home-wrong-book__count strong { color: #e86611; font-size: 21px; }
.student-home-wrong-book__cover > small { color: #687d9e; font-size: 11px; }
.student-home-wrong-book__body { display: grid; gap: 9px; padding: 14px 16px 16px; }
.student-home-wrong-book__meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #687d9e; font-size: 11px; }
.student-home-wrong-book__body p { min-height: 32px; margin: 0; color: #667b9e; font-size: 12px; line-height: 1.45; }
.student-home-wrong-book__status { color: #16804a; font-size: 11px; font-weight: 750; }
.student-home-wrong-book__body :deep(.app-button) { width: 100%; min-height: 38px; }
@media (max-width: 700px) {
  .student-dashboard-workspace { padding-top: 18px; }
  .student-home-refresh { top: 16px; right: 16px; }
  .student-home-section :deep(.app-card__header) { padding-right: 40px; }
  .student-home-grid, .student-home-wrong-answer-grid { grid-template-columns: minmax(0, 1fr); }
  .student-home-wrong-answer-grid { min-height: 420px; max-height: min(1000px, calc(100vh - 220px)); }
  .student-home-exam-card, .student-home-review-card { min-height: 0; }
  /* 窄屏为单列，最小高度按两排卡片计算，保持分页后的稳定高度。 */
  .student-home-review-grid { min-height: calc(310px * 2 + 16px); }
}
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
.shsat-history-row { grid-template-columns: minmax(220px, 1fr) minmax(100px, auto) auto; }
@media (max-width: 760px) { .shsat-history-row { grid-template-columns: minmax(0, 1fr); gap: 10px; } .shsat-history-score { text-align: left; } }
.practice-history-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-top: 14px; color: var(--color-muted); font-size: 13px; }
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
  .draft-list__row { grid-template-columns: minmax(0, 1fr) auto; }
  .draft-list__meta { grid-column: 1; grid-row: 2; }
  .draft-list__row :deep(.responsive-action-group) { grid-column: 2; grid-row: 1 / span 2; }
}
</style>
