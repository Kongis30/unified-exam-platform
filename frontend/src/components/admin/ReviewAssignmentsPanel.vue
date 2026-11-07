<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppModal from '@/components/AppModal.vue'
import AdminDataTable from '@/components/admin/AdminDataTable.vue'
import { reviewAssignments } from '@/api/reviewAssignments'

const props = defineProps({ examTypeCode: { type: String, required: true } })
const router = useRouter()
const tasks = ref([])
const classes = ref([])
const exams = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const modalError = ref('')
const createOpen = ref(false)
const detail = ref(null)
const endTarget = ref(null)
const keyword = ref('')
const classFilter = ref('')
const examFilter = ref('')
const form = reactive({ classId: '', examId: '', title: '', description: '', startAt: '', endAt: '' })
let classRequest = 0
const filteredTasks = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return tasks.value.filter(task => (!classFilter.value || String(task.classId) === classFilter.value)
    && (!examFilter.value || String(task.examId) === examFilter.value)
    && (!query || [task.title, task.examTitle, task.className].some(value => String(value || '').toLowerCase().includes(query))))
})
const filterClasses = computed(() => [...new Map(tasks.value.map(task => [task.classId, task.className])).entries()])
const filterExams = computed(() => [...new Map(tasks.value.map(task => [task.examId, task.examTitle])).entries()])

function localInput(date) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function dateLabel(value) { return value ? new Date(value).toLocaleString('en-US') : '—' }

async function load(force = false) {
  loading.value = true
  error.value = ''
  try { tasks.value = await reviewAssignments.list(props.examTypeCode, { force }) }
  catch (e) { error.value = e.message || 'Unable to load review assignments.' }
  finally { loading.value = false }
}

async function openCreate() {
  classRequest++
  modalError.value = ''
  exams.value = []
  const now = new Date()
  Object.assign(form, { classId: '', examId: '', title: '', description: '', startAt: localInput(now), endAt: localInput(new Date(now.getTime() + 86400000)) })
  createOpen.value = true
  try { classes.value = (await reviewAssignments.classes(props.examTypeCode)).filter(item => item.status === 'ACTIVE') }
  catch (e) { modalError.value = e.message || 'Unable to load classes.' }
}

async function selectClass() {
  const request = ++classRequest
  form.examId = ''
  exams.value = []
  modalError.value = ''
  if (!form.classId) return
  try {
    const result = await reviewAssignments.exams(props.examTypeCode, form.classId)
    if (request === classRequest) exams.value = result.filter(item => ['PUBLISHED', 'CLOSED'].includes(item.status))
  } catch (e) { if (request === classRequest) modalError.value = e.message || 'Unable to load class exams.' }
}

function selectExam() {
  const exam = exams.value.find(item => String(item.examId) === String(form.examId))
  if (exam && !form.title.trim()) form.title = `${exam.examTitle} Wrong Answer Review`
}

async function create() {
  modalError.value = ''
  if (!form.classId || !form.examId || !form.title.trim() || !form.startAt || !form.endAt || new Date(form.endAt) <= new Date(form.startAt)) {
    modalError.value = 'Choose a class and exam, enter a title, and select a valid time window.'
    return
  }
  busy.value = true
  try {
    await reviewAssignments.create(props.examTypeCode, { classId: Number(form.classId), examId: Number(form.examId), title: form.title.trim(), description: form.description.trim() || null, startAt: form.startAt, endAt: form.endAt })
    createOpen.value = false
    await load(true)
  } catch (e) { modalError.value = e.message || 'Unable to create review assignment.' }
  finally { busy.value = false }
}

async function openDetail(task) {
  error.value = ''
  try { detail.value = await reviewAssignments.detail(props.examTypeCode, task.id) }
  catch (e) { error.value = e.message || 'Unable to load assignment progress.' }
}

function openReport(student) {
  const examId = detail.value.task.examId
  detail.value = null
  router.push({ name: 'sat-report', query: { examId, recordId: student.latestAttemptId,
    reviewAssignmentId: student.id, reviewType: props.examTypeCode, returnTo: `/${props.examTypeCode.toLowerCase()}?tab=reviews` } })
}

async function endTask() {
  busy.value = true
  modalError.value = ''
  try { await reviewAssignments.end(props.examTypeCode, endTarget.value.id); endTarget.value = null; await load(true) }
  catch (e) { modalError.value = e.message || 'Unable to end the assignment.' }
  finally { busy.value = false }
}

watch(() => props.examTypeCode, () => { tasks.value = []; load() })
onMounted(() => load())
</script>

<template>
  <AppCard title="Review Assignments" subtitle="Create and track assignments for wrong and unanswered questions.">
    <div class="review-toolbar">
      <div class="review-filters"><input v-model="keyword" class="form-input" type="search" placeholder="Search assignment, exam, or class" aria-label="Search review assignments" />
        <select v-model="examFilter" class="form-input" aria-label="Filter tasks by exam"><option value="">All exams</option><option v-for="[id, name] in filterExams" :key="id" :value="String(id)">{{ name }}</option></select>
        <select v-model="classFilter" class="form-input" aria-label="Filter tasks by class"><option value="">All classes</option><option v-for="[id, name] in filterClasses" :key="id" :value="String(id)">{{ name }}</option></select></div>
      <div class="review-actions"><AppButton variant="secondary" :disabled="loading" @click="load(true)">Refresh</AppButton><AppButton @click="openCreate">Create Assignment</AppButton></div>
    </div>
    <p v-if="error" class="error-text" role="alert">{{ error }} <AppButton variant="secondary" @click="load(true)">Retry</AppButton></p>
    <p v-if="loading && !tasks.length" class="review-state">Loading review assignments...</p>
    <p v-else-if="!filteredTasks.length" class="review-state">{{ tasks.length ? 'No assignments match your search.' : 'No review assignments have been created yet.' }}</p>
    <div v-else class="review-table-wrap">
      <AdminDataTable>
        <thead><tr><th>Task</th><th>Exam</th><th>Class</th><th>Availability Window</th><th>Completion</th><th>Assignment Status</th><th>Actions</th></tr></thead>
        <tbody><tr v-for="task in filteredTasks" :key="task.id">
          <td><strong>{{ task.title }}</strong></td><td>{{ task.examTitle }}</td><td>{{ task.className }}</td>
          <td>{{ dateLabel(task.startAt) }} – {{ dateLabel(task.endAt) }}</td>
          <td>{{ task.completedCount }} / {{ task.eligibleCount }}<br /><small>completed / eligible</small></td>
          <td><small>{{ task.inProgressCount }} in progress<br />{{ task.notStartedCount }} not started<br /><template v-if="task.retryRequiredCount">{{ task.retryRequiredCount }} need more practice<br /></template><template v-if="task.endedCount">{{ task.endedCount }} ended<br /></template><template v-if="task.noSourceAttemptCount">{{ task.noSourceAttemptCount }} without source attempt<br /></template><template v-if="task.noWrongAnswerCount">{{ task.noWrongAnswerCount }} with no review questions</template></small></td>
          <td><div class="review-actions"><AppButton variant="secondary" @click="openDetail(task)">View Progress</AppButton><AppButton v-if="task.status !== 'ENDED'" variant="secondary" @click="endTarget = task; modalError = ''">End</AppButton></div></td>
        </tr></tbody>
      </AdminDataTable>
    </div>
  </AppCard>

  <AppModal v-if="createOpen" title="Create Review Assignment" description="Choose a class and an exam to assign each student their wrong and unanswered questions." width="720px" :busy="busy" @close="createOpen = false">
    <div class="review-form">
      <label>Class<select v-model="form.classId" class="form-input" @change="selectClass"><option value="">Choose a class</option><option v-for="item in classes" :key="item.id" :value="String(item.id)">{{ item.name }}</option></select></label>
      <label>Exam<select v-model="form.examId" class="form-input" :disabled="!form.classId" @change="selectExam"><option value="">Choose an exam</option><option v-for="exam in exams" :key="exam.examId" :value="String(exam.examId)">{{ exam.examTitle }}</option></select></label>
      <label class="review-form-wide">Title<input v-model="form.title" class="form-input" maxlength="200" /></label>
      <label class="review-form-wide">Description<textarea v-model="form.description" class="form-input" maxlength="1000" rows="2"></textarea></label>
      <label>Start time<input v-model="form.startAt" class="form-input" type="datetime-local" /></label>
      <label>End time<input v-model="form.endAt" class="form-input" type="datetime-local" /></label>
    </div>
    <p v-if="modalError" class="error-text" role="alert">{{ modalError }}</p>
    <template #footer><AppButton variant="secondary" :disabled="busy" @click="createOpen = false">Cancel</AppButton><AppButton :disabled="busy" @click="create">{{ busy ? 'Creating...' : 'Create Assignment' }}</AppButton></template>
  </AppModal>

  <AppModal v-if="detail" :title="detail.task.title" description="Student review progress" width="840px" @close="detail = null">
    <div class="review-table-wrap"><AdminDataTable><thead><tr><th>Student</th><th>Status</th><th>Questions</th><th>Cleared</th><th>Remaining</th><th>Report</th></tr></thead>
      <tbody><tr v-for="student in detail.assignments" :key="student.id"><td>{{ student.studentName }}</td><td>{{ student.status.replaceAll('_', ' ') }}</td><td>{{ student.questionCount }}</td><td>{{ student.clearedCount }}</td><td>{{ student.remainingCount }}</td><td><AppButton v-if="student.latestAttemptId" variant="secondary" @click="openReport(student)">View Report</AppButton><span v-else>—</span></td></tr></tbody></AdminDataTable></div>
    <p v-if="!detail.assignments.length" class="review-state">No active students in this class.</p>
  </AppModal>

  <AppModal v-if="endTarget" title="End Review Assignment" :busy="busy" @close="endTarget = null">
    <p>End {{ endTarget.title }}? Students can finish a practice round already in progress.</p>
    <p v-if="modalError" class="error-text" role="alert">{{ modalError }}</p>
    <template #footer><AppButton variant="secondary" :disabled="busy" @click="endTarget = null">Cancel</AppButton><AppButton variant="danger" :disabled="busy" @click="endTask">End Assignment</AppButton></template>
  </AppModal>
</template>

<style scoped>
.review-toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
.review-filters { display:flex; flex-wrap:wrap; flex:1 1 320px; gap:8px; }
.review-filters input { flex:1 1 240px; max-width:380px; }
.review-filters select { width:auto; max-width:220px; }
.review-actions { display:flex; flex-wrap:wrap; gap:8px; }
.review-table-wrap { overflow-x:auto; }
.review-state { padding:20px 0; color:var(--color-muted); }
.review-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.review-form label { display:grid; gap:6px; color:var(--color-text); font-weight:650; }
.review-form-wide { grid-column:1 / -1; }
@media (max-width:600px) { .review-form { grid-template-columns:1fr; } .review-form-wide { grid-column:auto; } }
</style>
