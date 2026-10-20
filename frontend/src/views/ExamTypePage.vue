<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

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
import ClassesPage from '@/views/ClassesPage.vue'
import {
  createExam, createPaper, createPaperGroup, createPaperVersion, deleteExam, deletePaper, deletePaperGroup,
  apiRequest, getExamTypes, getPaper, listAvailableStudents, listClasses, listExams, listPaperGroups, listPapers,
  listStudentExams, movePaperToGroup, publishExam, reorderWorkspacePaperGroups, saveExamTargets, startStudentAttempt, unpublishExam,
  savePaperStructure, sealPaper, setPaperArchived, updatePaper, updatePaperGroup,
} from '@/api/platform'
import { authState } from '@/auth'

const props = defineProps({ code: { type: String, required: true } })
const router = useRouter()
const examTypes = ref([])
const papers = ref([])
const paperFolderRecords = ref([])
const exams = ref([])
const studentExams = ref([])
const studentReviewTasks = ref([])
const startingReviewTaskId = ref(null)
const classes = ref([])
const students = ref([])
const selectedPaper = ref(null)
const isLoading = ref(true)
const isSaving = ref(false)
const examActionId = ref(null)
const examPublicationTarget = ref(null)
const examPublicationError = ref('')
const examDeleteTarget = ref(null)
const examDeleteCooldown = ref(0)
const notification = reactive({ open: false, title: '', message: '', variant: 'info' })
const startingExamId = ref(null)
const error = ref('')
const notice = ref('')
const activeTab = ref(router.currentRoute.value.query.tab === 'classes' ? 'classes' : 'papers')
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
const paperFolderExpanded = reactive({})
const draggingPaperFolderKey = ref('')
const paperFolderDragMoved = ref(false)
const isReorderingPaperFolders = ref(false)
const paperFilters = reactive({ groupId: '', keyword: '' })
const appliedPaperKeyword = ref('')
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
const EXAM_DELETE_COOLDOWN_SECONDS = 5
const examKeyword = ref('')
const examTableScroll = ref(null)
const visibleExamCount = ref(25)
const EXAM_RELEASE_BATCH_SIZE = 25
const editorOpen = ref(false)
const releaseOpen = ref(false)
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
const visibleExams = computed(() => filteredExams.value.slice(0, visibleExamCount.value))
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

const paperForm = reactive({ examTypeCode: '', title: '', description: '', defaultDurationMinutes: 134 })
const releaseForm = reactive({
  paperId: '', title: '', description: '', opensAt: '', closesAt: '', durationMinutes: '', attemptLimit: 1,
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
      const [classRows, studentRows] = await Promise.all([listClasses(), listAvailableStudents()])
      await Promise.all([loadWorkspacePapers(), loadWorkspaceExams()])
      classes.value = classRows
      students.value = studentRows
    } else {
      await loadStudentExams()
    }
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load this exam workspace.'
  } finally {
    isLoading.value = false
  }
}

async function loadStudentExams() {
  const workspaceCodes = new Set(workspaceTypes.value.map((item) => item.code))
  studentExams.value = (await listStudentExams())
    .filter((exam) => workspaceCodes.has(exam.examTypeCode))
  studentReviewTasks.value = props.code === 'SHSAT'
    ? await apiRequest('/api/student/wrong-answer-tasks')
    : []
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
  visibleExamCount.value = EXAM_RELEASE_BATCH_SIZE
  await nextTick()
  if (examTableScroll.value) examTableScroll.value.scrollTop = 0
}

function loadMoreExamRowsOnScroll(event) {
  const container = event.currentTarget
  if (container.scrollTop + container.clientHeight >= container.scrollHeight - 80
      && visibleExamCount.value < filteredExams.value.length) {
    visibleExamCount.value = Math.min(visibleExamCount.value + EXAM_RELEASE_BATCH_SIZE, filteredExams.value.length)
  }
}

watch(examKeyword, async () => {
  visibleExamCount.value = EXAM_RELEASE_BATCH_SIZE
  await nextTick()
  if (examTableScroll.value) examTableScroll.value.scrollTop = 0
})

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
})

function getExamActions(exam) {
  const actions = []
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
        await router.push({ name: 'sat-paper-edit', params: { paperId: selectedPaper.value.summary.id } })
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
      await router.push({ name: 'sat-paper-edit', params: { paperId: editablePaper.id } })
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
  selectedClassIds.value = []; selectedStudentIds.value = []
  const firstPaper = readyPapers.value[0]
  releaseForm.paperId = firstPaper?.id || ''
  releaseForm.title = ''; releaseForm.description = ''
  releaseForm.opensAt = localDateTime(1); releaseForm.closesAt = localDateTime(25)
  releaseForm.durationMinutes = firstPaper ? defaultReleaseDurationMinutes(firstPaper) : defaultPaperDurationMinutes(props.code)
  releaseForm.attemptLimit = 1
  releaseOpen.value = true
}

watch(() => releaseForm.paperId, (paperId) => {
  if (!releaseOpen.value || !paperId) return
  const paper = readyPapers.value.find((item) => String(item.id) === String(paperId))
  if (paper) releaseForm.durationMinutes = defaultReleaseDurationMinutes(paper)
})

function closeRelease() {
  if (isSaving.value) return
  releaseOpen.value = false
}

async function saveAndPublishExam() {
  error.value = ''; notice.value = ''; isSaving.value = true
  try {
    if (!releaseForm.title.trim()) throw new Error('Enter an exam title.')
    if (!releaseForm.opensAt || !releaseForm.closesAt) throw new Error('Choose an opening and closing time.')
    if (new Date(releaseForm.closesAt) <= new Date(releaseForm.opensAt)) throw new Error('The closing time must be after the opening time.')
    if (!draftExamId.value) {
      const created = await createExam(releaseForm.paperId, {
        title: releaseForm.title, description: releaseForm.description || null,
        opensAt: new Date(releaseForm.opensAt).toISOString(), closesAt: new Date(releaseForm.closesAt).toISOString(),
        durationSeconds: releaseForm.durationMinutes ? Number(releaseForm.durationMinutes) * 60 : null,
        attemptLimit: Number(releaseForm.attemptLimit), targetScope: 'SELECTED',
      })
      draftExamId.value = created.summary.id
    }
    await saveExamTargets(draftExamId.value, {
      classIds: selectedClassIds.value.map(Number), studentUserIds: selectedStudentIds.value.map(Number),
    })
    await publishExam(draftExamId.value)
    await loadWorkspaceExams()
    releaseOpen.value = false
    notice.value = 'Exam published. Students who join a target class while the exam is open will be added automatically.'
  } catch (requestError) { error.value = requestError.message || 'Unable to publish this exam.' }
  finally { isSaving.value = false }
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

function viewAttempt(attemptId) {
  router.push({ name: 'student-attempt', params: { attemptId } })
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
})
watch(() => props.code, (code) => {
  availableExamsCollapsed.value = localStorage.getItem(`admin.available-exams-collapsed.${code}`) === 'true'
  loadPage()
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
      <AppCard class="sat-available-exams" title="Available Exams" :subtitle="availableExamSubtitle">
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
        <AdminTabs v-model="activeTab" :tabs="adminTabs" aria-label="Admin Features" />
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
          v-else-if="exams.length && filteredExams.length"
          ref="examTableScroll"
          class="table-wrap sat-exam-release-table-wrap"
          role="region"
          aria-label="Exam releases"
          tabindex="0"
          @scroll.passive="loadMoreExamRowsOnScroll"
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
            <thead><tr><th>Exam</th><th>Paper</th><th>Type</th><th>Exam Window</th><th>Status</th><th class="action-column-header">Actions</th></tr></thead>
            <tbody>
              <tr v-for="exam in visibleExams" :key="exam.id">
                <td class="sat-exam-release-table__title-cell"><strong :title="exam.title">{{ exam.title }}</strong></td>
                <td class="sat-exam-release-table__paper-cell" :title="exam.paperTitle || '—'"><span>{{ exam.paperTitle || '—' }}</span></td>
                <td class="sat-exam-release-table__type-cell"><span class="program-badge">{{ exam.examTypeCode }}</span></td>
                <td class="sat-exam-release-table__availability-cell" :title="`Opens ${formatExamDate(exam.opensAt)} · Closes ${formatExamDate(exam.closesAt)}`">
                  <span class="exam-window-line"><small>Opens</small><time>{{ formatExamDate(exam.opensAt) }}</time></span>
                  <span class="exam-window-line"><small>Closes</small><time>{{ formatExamDate(exam.closesAt) }}</time></span>
                </td>
                <td class="sat-exam-release-table__status-cell"><span class="status-pill" :class="exam.status === 'PUBLISHED' ? 'is-active' : ''">{{ exam.status === 'CLOSED' ? 'Unpublished' : exam.status }}</span></td>
                <td class="action-column-cell">
                  <ResponsiveActionGroup v-if="getExamActions(exam).length" align="center" :actions="getExamActions(exam)" :label="`Actions for ${exam.title}`" />
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </AdminDataTable>
          <p v-if="visibleExams.length < filteredExams.length" class="exam-release-load-more" aria-live="polite">
            Showing {{ visibleExams.length }} of {{ filteredExams.length }} releases · Scroll down to load more
          </p>
        </div>
        <p v-else class="admin-state">{{ exams.length ? 'No releases match your search.' : 'No exam releases yet. Seal a paper before creating an exam.' }}</p>
        </template>
      </AppCard>

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
        <p v-if="examPublicationError && props.code !== 'SAT'" class="error-text exam-publication-error" role="alert">{{ examPublicationError }}</p>
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
        title="Create Exam"
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
                <select v-model="releaseForm.paperId" class="form-input" required>
                  <option value="" disabled>Select a ready paper</option>
                  <option v-for="paper in readyPapers" :key="paper.id" :value="paper.id">{{ paper.title }} · v{{ paper.versionNo }}</option>
                </select>
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
          <p v-if="error && props.code !== 'SAT'" class="error-text exam-release-form-error" role="alert">{{ error }}</p>
          <AppButton type="button" variant="secondary" :disabled="isSaving" @click="closeRelease">Cancel</AppButton>
          <AppButton type="submit" form="create-exam-release-form" :disabled="isSaving || !releaseForm.paperId">
            {{ isSaving ? 'Publishing…' : 'Create Exam' }}
          </AppButton>
        </template>
      </AppModal>
        </AdminTabPanels>
        </AdminSection>
      </div>
    </template>

    <template v-else-if="selectedType">
      <AppCard v-if="props.code === 'SHSAT' && studentReviewTasks.length" class="management-card student-review-list">
        <div class="card-heading"><div><span class="eyebrow">SHSAT REVIEW</span><h2>Review assignments</h2></div></div>
        <article v-for="task in studentReviewTasks" :key="task.assignmentId" class="paper-row">
          <div class="paper-mark">↻</div>
          <div class="paper-copy">
            <strong>{{ task.title }}</strong>
            <small>{{ task.examTitle }} · {{ task.remainingQuestionCount }} questions remaining<span v-if="task.endAt"> · Due {{ formatExamDate(task.endAt) }}</span></small>
          </div>
          <span class="status-pill" :class="task.status === 'COMPLETED' ? 'is-active' : ''">{{ task.status.replaceAll('_', ' ') }}</span>
          <button class="secondary-button compact-button" :disabled="!task.canStart || startingReviewTaskId === task.assignmentId" @click="startReviewTask(task)">
            {{ startingReviewTaskId === task.assignmentId ? 'Starting…' : task.status === 'IN_PROGRESS' ? 'Continue' : task.status === 'RETRY_REQUIRED' ? 'Try again' : 'Start review' }}<span v-if="startingReviewTaskId !== task.assignmentId">↗</span>
          </button>
        </article>
      </AppCard>
      <AppCard class="management-card student-exam-list">
        <div class="card-heading"><div><span class="eyebrow">{{ selectedType.code }} EXAMS</span><h2>Your exams</h2></div></div>
        <article v-for="exam in studentExams" :key="exam.id" class="paper-row">
          <div class="paper-mark">{{ examAvailability(exam) === 'Upcoming' ? '↗' : '•' }}</div>
          <div class="paper-copy"><strong>{{ exam.title }}</strong><small><span v-if="props.code === 'SAT'">{{ exam.examTypeCode }} · </span>{{ exam.paperTitle }} · {{ formatExamDate(exam.opensAt) }} — {{ formatExamDate(exam.closesAt) }}</small></div>
          <span class="status-pill is-active">{{ exam.activeAttemptId ? 'In progress' : examAvailability(exam) === 'Closed' && exam.attemptsUsed ? 'Submitted' : examAvailability(exam) }}</span>
          <button v-if="exam.activeAttemptId || (examAvailability(exam) === 'Available' && exam.attemptsUsed < exam.attemptLimit)" class="secondary-button compact-button" :disabled="startingExamId === exam.id" @click="openStudentExam(exam)">{{ startingExamId === exam.id ? 'Starting…' : exam.activeAttemptId ? 'Continue' : 'Start exam' }}<span v-if="startingExamId !== exam.id">↗</span></button>
          <button v-if="exam.attemptsUsed && exam.latestAttemptId" class="text-button" @click="viewAttempt(exam.latestAttemptId)">View attempt</button>
        </article>
        <p v-if="!studentExams.length && !isLoading" class="table-empty">No exams have been assigned to you yet.</p>
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
  .exam-release-create-section__heading { align-items: flex-start; }
  .exam-release-clear-selection { font-size: 12px; }
  .exam-release-form-error { flex-basis: 100%; }
}
</style>
