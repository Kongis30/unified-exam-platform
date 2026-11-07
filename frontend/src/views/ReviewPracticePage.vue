<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppModal from '@/components/AppModal.vue'
import QuestionContent from '@/examTypes/sat/student/components/exam/QuestionContent.vue'
import AnswerOptions from '@/examTypes/sat/student/components/exam/AnswerOptions.vue'
import { reviewAssignments } from '@/api/reviewAssignments'
import { saveStudentAnswer, submitStudentAttempt } from '@/api/platform'

const props = defineProps({ examTypeCode: { type: String, required: true } })
const route = useRoute()
const router = useRouter()
const attempt = ref(null)
const progress = ref(null)
const loading = ref(true)
const submitting = ref(false)
const confirmOpen = ref(false)
const previewImage = ref('')
const error = ref('')
const questionIndex = ref(0)
const answers = reactive({})
const saving = reactive({})
const saveAgain = reactive({})
const failedSaves = reactive({})
const now = ref(Date.now())
const currentQuestion = computed(() => attempt.value?.questions?.[questionIndex.value] || null)
const pendingSave = computed(() => Object.values(saving).some(Boolean))
const hasFailedSave = computed(() => Object.values(failedSaves).some(Boolean))
const remainingSeconds = computed(() => attempt.value?.expiresAt == null ? null : Math.max(0, Math.ceil((new Date(attempt.value.expiresAt).getTime() - now.value) / 1000)))
const timeLabel = computed(() => remainingSeconds.value == null ? 'No time limit' : `${Math.floor(remainingSeconds.value / 60)}:${String(remainingSeconds.value % 60).padStart(2, '0')}`)
const questionModel = computed(() => {
  const question = currentQuestion.value
  if (!question) return null
  const material = question.display?.material || {}
  const raw = question.display?.options
  const options = Array.isArray(raw) ? raw.map((item, index) => typeof item === 'string'
    ? { id: String.fromCharCode(65 + index), text: item }
    : { id: item.id || item.key || item.label || String.fromCharCode(65 + index), text: item.text || item.value || item.label || '' }) : raw
  return { question: question.stem || '', passage: material.content || '', material: { content: material.content || '', fileUrl: material.assetUrl || '' }, options }
})
const hasMaterial = computed(() => Boolean(questionModel.value?.passage || questionModel.value?.material?.fileUrl))
let disposed = false
let clockId
let autoSubmitAttempted = false

async function loadProgress() {
  const list = await reviewAssignments.studentList(props.examTypeCode, { force: true })
  return list.find(item => String(item.id) === String(route.params.assignmentId)) || null
}

async function start() {
  loading.value = true
  error.value = ''
  try {
    const assignment = await loadProgress()
    if (disposed) return
    progress.value = assignment
    if (!assignment) throw new Error('Review assignment not found.')
    if (!assignment.canStart) return
    const data = await reviewAssignments.start(props.examTypeCode, assignment.id)
    if (disposed) return
    attempt.value = data
    autoSubmitAttempted = false
    questionIndex.value = 0
    for (const key of Object.keys(failedSaves)) delete failedSaves[key]
    for (const question of data.questions || []) answers[question.paperItemId] = String(question.answer?.value ?? '')
  } catch (e) { if (!disposed) error.value = e.message || 'Unable to start this review.' }
  finally { if (!disposed) loading.value = false }
}

async function saveAnswer(value) {
  const question = currentQuestion.value
  if (!question || !attempt.value || submitting.value) return
  const id = question.paperItemId
  answers[id] = value == null ? '' : String(value)
  if (saving[id]) { saveAgain[id] = true; return }
  saving[id] = true
  error.value = ''
  try {
    let saved
    do {
      saveAgain[id] = false
      saved = answers[id]
      await saveStudentAnswer(attempt.value.id, id, { value: saved }, 0)
    } while (saveAgain[id] || saved !== answers[id])
    failedSaves[id] = false
  } catch (e) { failedSaves[id] = true; error.value = e.message || 'Unable to save your answer.' }
  finally { saving[id] = false }
}

async function submit(automatic = false) {
  if (pendingSave.value || (!automatic && hasFailedSave.value && remainingSeconds.value !== 0) || submitting.value || !attempt.value) return
  submitting.value = true
  error.value = ''
  try {
    await submitStudentAttempt(attempt.value.id)
    confirmOpen.value = false
    attempt.value = null
    progress.value = await loadProgress()
  } catch (e) { error.value = e.message || 'Unable to submit this review.' }
  finally { submitting.value = false }
}

function openReport() {
  router.push({ name: 'sat-report', query: { examId: progress.value.examId, recordId: progress.value.latestAttemptId,
    reviewAssignmentId: progress.value.id, reviewType: props.examTypeCode } })
}

onMounted(() => {
  start()
  clockId = window.setInterval(() => {
    now.value = Date.now()
    if (attempt.value && remainingSeconds.value === 0 && !autoSubmitAttempted && !pendingSave.value) {
      autoSubmitAttempted = true
      submit(true)
    }
  }, 1000)
})
onBeforeUnmount(() => { disposed = true; window.clearInterval(clockId) })
</script>

<template>
  <main class="review-practice page-shell">
    <button type="button" class="review-back" @click="router.push({ name: examTypeCode === 'PSAT' ? 'psat-admin' : 'sat-admin' })">← Back to {{ examTypeCode }} exams</button>
    <h1>{{ progress?.title || 'Review Assignment' }}</h1>
    <p v-if="loading" role="status">Loading review...</p>
    <p v-if="error" class="error-text" role="alert">{{ error }} <AppButton v-if="!attempt" variant="secondary" @click="start">Retry</AppButton></p>
    <template v-if="!loading && attempt && currentQuestion">
      <p class="review-progress">Question {{ questionIndex + 1 }} / {{ attempt.questions.length }} · Time remaining: {{ timeLabel }} <span v-if="saving[currentQuestion.paperItemId]"> · Saving...</span></p>
      <p v-if="hasFailedSave" class="error-text" role="alert">An answer has not been saved. Return to that question and retry before submitting.</p>
      <AppButton v-if="failedSaves[currentQuestion.paperItemId]" variant="secondary" @click="saveAnswer(answers[currentQuestion.paperItemId])">Retry saving answer</AppButton>
      <div class="review-question" :class="{ 'review-question--single': !hasMaterial }">
        <QuestionContent v-if="hasMaterial" :key="currentQuestion.paperItemId" :question="questionModel" :question-number="questionIndex + 1" :show-question-text="false" @preview-image="previewImage = $event" />
        <AnswerOptions :key="`answer-${currentQuestion.paperItemId}`" :question="questionModel" :question-number="questionIndex + 1" :selected-answer="answers[currentQuestion.paperItemId] || null" @answer-selected="saveAnswer" @preview-image="previewImage = $event" />
      </div>
      <div class="review-navigation">
        <AppButton variant="secondary" :disabled="questionIndex === 0" @click="questionIndex--">Previous</AppButton>
        <AppButton variant="secondary" :disabled="questionIndex >= attempt.questions.length - 1" @click="questionIndex++">Next</AppButton>
        <AppButton :disabled="pendingSave || (hasFailedSave && remainingSeconds !== 0) || submitting" @click="confirmOpen = true">Submit Review</AppButton>
      </div>
    </template>
    <div v-else-if="!loading && progress && !error" class="review-finished">
      <p>{{ progress.status === 'COMPLETED' ? 'You have completed this review assignment.' : progress.canStart ? 'Some questions still need practice.' : 'This review assignment is not currently available.' }}</p>
      <p>{{ progress.clearedCount }} of {{ progress.questionCount }} questions cleared · {{ progress.remainingCount }} remaining</p>
      <AppButton v-if="progress.canStart" @click="start">Try again</AppButton>
      <AppButton v-if="progress.latestAttemptId" variant="secondary" @click="openReport">View latest report</AppButton>
    </div>
    <AppModal v-if="confirmOpen" title="Submit Review" :busy="submitting" @close="confirmOpen = false">
      <p>Submit this round? You can retry remaining questions while the assignment is open.</p>
      <template #footer><AppButton variant="secondary" :disabled="submitting" @click="confirmOpen = false">Cancel</AppButton><AppButton :disabled="submitting || pendingSave || (hasFailedSave && remainingSeconds !== 0)" @click="submit()">{{ submitting ? 'Submitting...' : 'Submit Review' }}</AppButton></template>
    </AppModal>
    <AppModal v-if="previewImage" title="Image preview" width="960px" @close="previewImage = ''">
      <img class="review-preview-image" :src="previewImage" alt="Question material preview" />
    </AppModal>
  </main>
</template>

<style scoped>
.review-practice { max-width:1200px; margin:0 auto; padding:24px; }
.review-back { border:0; padding:0; color:var(--color-primary-strong); background:none; cursor:pointer; font-weight:700; }
.review-progress { color:var(--color-muted); }
.review-question { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; align-items:start; }
.review-question--single { grid-template-columns:minmax(0,1fr); }
.review-question > * { min-width:0; border:1px solid var(--color-border); border-radius:12px; background:white; padding:16px; }
.review-preview-image { display:block; max-width:100%; max-height:75vh; margin:auto; object-fit:contain; }
.review-question :deep(.mark-review-btn) { display:none; }
.review-navigation { display:flex; gap:10px; justify-content:flex-end; margin-top:18px; }
.review-finished { padding:20px; border:1px solid var(--color-border); border-radius:12px; background:#fff; }
@media (max-width:768px) { .review-practice { padding:16px; } .review-question { grid-template-columns:1fr; } .review-navigation { flex-wrap:wrap; } }
</style>
