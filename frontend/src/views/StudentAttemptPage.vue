<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppModal from '@/components/AppModal.vue'
import { getStudentAttempt, saveStudentAnswer, submitStudentAttempt } from '@/api/platform'

const ShsatTextMaterial = defineAsyncComponent(() => import('@shsat/components/TextMaterial.vue'))

const props = defineProps({ attemptId: { type: String, required: true } })
const router = useRouter()
const attempt = ref(null)
const answers = reactive({})
const saving = reactive({})
const saveAgain = reactive({})
const questionEnteredAt = reactive({})
const error = ref('')
const notice = ref('')
const isLoading = ref(true)
const isSubmitting = ref(false)
const submitConfirmOpen = ref(false)
const unavailableMaterialImages = ref(new Set())
const now = ref(Date.now())
let clockId

const remainingSeconds = computed(() => {
  if (!attempt.value?.expiresAt) return null
  return Math.max(0, Math.ceil((new Date(attempt.value.expiresAt).getTime() - now.value) / 1000))
})
const timeLabel = computed(() => {
  if (remainingSeconds.value === null) return 'No time limit'
  const minutes = Math.floor(remainingSeconds.value / 60).toString().padStart(2, '0')
  const seconds = (remainingSeconds.value % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
})
const isSubmitted = computed(() => attempt.value?.status === 'SUBMITTED')
const hasPendingSave = computed(() => Object.values(saving).some(Boolean))
const workspaceCode = computed(() => attempt.value?.examTypeCode === 'PSAT' ? 'SAT' : attempt.value?.examTypeCode || 'SHSAT')

function optionsFor(question) {
  const options = question.display?.options
  if (Array.isArray(options)) return options.map((option, index) => typeof option === 'string'
    ? { key: String.fromCharCode(65 + index), text: option }
    : { key: String(option.key ?? option.value ?? index), text: String(option.text ?? option.label ?? option.value ?? option.key ?? '') })
  if (options && typeof options === 'object') {
    return Object.entries(options).map(([key, text]) => ({ key, text: String(text ?? '') }))
  }
  return []
}

function initialAnswer(question) {
  const saved = question.answer
  if (saved && typeof saved === 'object' && 'value' in saved) {
    if (Array.isArray(saved.value)) return saved.value.map(String)
    return String(saved.value ?? '')
  }
  if (saved == null) return isMultipleSelection(question) ? [] : ''
  return typeof saved === 'string' ? saved : JSON.stringify(saved)
}

function isMultipleSelection(question) {
  return /MULTI.?SELECT|MULTIPLE.?RESPONSE|MULTIPLE.?ANSWER|CHECKBOX/i.test(question.questionTypeCode)
}

function isSelected(question, key) {
  const value = answers[question.paperItemId]
  return Array.isArray(value) ? value.includes(key) : value === key
}

function markMaterialImageUnavailable(src) {
  unavailableMaterialImages.value = new Set([...unavailableMaterialImages.value, src])
}

async function loadAttempt() {
  isLoading.value = true
  error.value = ''
  try {
    attempt.value = await getStudentAttempt(props.attemptId)
    const enteredAt = Date.now()
    for (const question of attempt.value.questions) {
      answers[question.paperItemId] = initialAnswer(question)
      questionEnteredAt[question.paperItemId] = enteredAt
    }
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load this exam.'
  } finally {
    isLoading.value = false
  }
}

async function save(question) {
  if (isSubmitted.value) return
  const itemId = question.paperItemId
  if (saving[itemId]) {
    saveAgain[itemId] = true
    return
  }
  saving[itemId] = true
  error.value = ''
  try {
    let savedValue
    do {
      saveAgain[itemId] = false
      const currentValue = answers[itemId] ?? ''
      savedValue = Array.isArray(currentValue) ? [...currentValue] : currentValue
      const now = Date.now()
      const timeSpentSeconds = Math.max(0, Math.floor((now - (questionEnteredAt[itemId] || now)) / 1000))
      await saveStudentAnswer(attempt.value.id, itemId, { value: savedValue }, timeSpentSeconds)
      questionEnteredAt[itemId] = Date.now()
    } while (saveAgain[itemId] || JSON.stringify(savedValue) !== JSON.stringify(answers[itemId] ?? ''))
    notice.value = 'Answer saved.'
  } catch (requestError) {
    error.value = requestError.message || 'Unable to save your answer.'
  } finally {
    saving[itemId] = false
  }
}

async function submit() {
  if (isSubmitted.value || isSubmitting.value) return
  isSubmitting.value = true
  error.value = ''
  try {
    attempt.value = await submitStudentAttempt(attempt.value.id)
    notice.value = 'Your exam has been submitted.'
    submitConfirmOpen.value = false
  } catch (requestError) {
    error.value = requestError.message || 'Unable to submit this exam.'
  } finally {
    isSubmitting.value = false
  }
}

onMounted(async () => {
  await loadAttempt()
  clockId = window.setInterval(() => {
    now.value = Date.now()
    if (remainingSeconds.value === 0) submit()
  }, 1000)
})
onBeforeUnmount(() => window.clearInterval(clockId))
</script>

<template>
  <div class="page-content student-attempt-page">
    <RouterLink class="back-link" :to="{ name: 'exam-type', params: { code: workspaceCode } }">← Back to {{ workspaceCode }} exams</RouterLink>
    <div v-if="isLoading" class="loading-state"><span class="loading-rule"></span>Loading exam…</div>
    <section v-else-if="attempt" class="student-attempt">
      <header class="attempt-heading">
        <div><span class="eyebrow">{{ attempt.examTypeCode }} EXAM</span><h1>{{ attempt.examTitle }}</h1><p>Read each question carefully and save your answer as you go.</p></div>
        <div class="attempt-clock" :class="{ 'clock-ended': remainingSeconds === 0 }"><small>{{ isSubmitted ? 'STATUS' : 'TIME REMAINING' }}</small><strong>{{ isSubmitted ? 'SUBMITTED' : timeLabel }}</strong></div>
      </header>
      <p v-if="error" class="form-error page-message">{{ error }}</p>
      <p v-if="notice" class="form-success page-message">{{ notice }}</p>
      <div v-if="attempt.result" class="attempt-result"><span>RESULT</span><strong>{{ attempt.result.totalPoints }} / {{ attempt.result.maxPoints }}</strong><small>Graded {{ new Date(attempt.result.gradedAt).toLocaleString('en-US') }}</small></div>
      <article v-for="(question, index) in attempt.questions" :key="question.paperItemId" class="student-question">
        <div class="student-question-heading"><span>QUESTION {{ question.displayNumber || index + 1 }}</span><small>{{ question.maxPoints }} points</small></div>
        <div v-if="question.display?.material" class="student-question-material">
          <ShsatTextMaterial v-if="attempt.examTypeCode === 'SHSAT' && question.display.material.content" :content="question.display.material.content" />
          <p v-else-if="question.display.material.content">{{ question.display.material.content }}</p>
          <template v-if="question.display.material.assetUrl">
            <img v-if="!unavailableMaterialImages.has(question.display.material.assetUrl)" :src="question.display.material.assetUrl" :alt="question.display.material.title || 'Question material'" @error="markMaterialImageUnavailable(question.display.material.assetUrl)" />
            <p v-else role="status">Material image is unavailable.</p>
          </template>
        </div>
        <p class="student-question-stem">{{ question.stem }}</p>
        <div v-if="optionsFor(question).length" class="student-options">
          <label v-for="option in optionsFor(question)" :key="option.key" class="student-option" :class="{ 'option-selected': isSelected(question, option.key) }">
            <input v-model="answers[question.paperItemId]" :type="isMultipleSelection(question) ? 'checkbox' : 'radio'" :name="`question-${question.paperItemId}`" :value="option.key" :disabled="isSubmitted" @change="save(question)" />
            <span class="option-key">{{ option.key }}</span><span>{{ option.text }}</span>
          </label>
        </div>
        <div v-else class="student-text-answer">
          <label :for="`answer-${question.paperItemId}`">Your answer</label>
          <textarea :id="`answer-${question.paperItemId}`" v-model="answers[question.paperItemId]" :disabled="isSubmitted" rows="3" @blur="save(question)"></textarea>
          <button v-if="!isSubmitted" class="text-button" :disabled="saving[question.paperItemId]" @click="save(question)">{{ saving[question.paperItemId] ? 'Saving…' : 'Save answer' }}</button>
        </div>
        <small v-if="saving[question.paperItemId]" class="answer-save-state">Saving answer…</small>
      </article>
      <footer class="attempt-footer">
        <p v-if="isSubmitted" class="form-success">Your answers are locked. Results will be available according to the exam settings.</p>
        <template v-else><span>Answers save when you select an option or leave a text field.</span><button class="primary-button" :disabled="isSubmitting || hasPendingSave" @click="submitConfirmOpen = true">Submit exam <span>↗</span></button></template>
      </footer>
      <RouterLink v-if="isSubmitted" class="secondary-button attempt-back-button" :to="{ name: 'exam-type', params: { code: workspaceCode } }">Return to your exams <span>↗</span></RouterLink>
    </section>
    <p v-else class="form-error">{{ error || 'This exam attempt is unavailable.' }}</p>

    <AppModal
      v-if="submitConfirmOpen"
      title="Submit this exam?"
      description="Your answers will be locked after submission. You will not be able to make changes."
      :busy="isSubmitting"
      @close="submitConfirmOpen = false"
    >
      <p class="attempt-submit-confirmation">Confirm that you are ready to submit your answers.</p>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <template #footer>
        <AppButton variant="secondary" :disabled="isSubmitting" @click="submitConfirmOpen = false">Continue working</AppButton>
        <AppButton :disabled="isSubmitting || hasPendingSave" @click="submit()">{{ isSubmitting ? 'Submitting…' : 'Submit exam' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
