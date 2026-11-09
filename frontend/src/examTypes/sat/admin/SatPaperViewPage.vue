<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiRequest } from '@/api/platform'
import { answerDisplayText } from '@/utils/answerDisplay.js'
import { renderMarkdown } from '../utils/markdown.js'

const route = useRoute()
const isExport = computed(() => ['sat-paper-export', 'psat-paper-export'].includes(route.name))
const paper = ref(null)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const selectedSection = ref('ALL')
const documentMode = ref('STUDENT')
const selectedModule = ref('')
const questionIndex = ref(0)
const answers = ref({})
const previousTitle = document.title
const returnLocation = computed(() => typeof route.query.returnTo === 'string' && /^\/exam-types\/(SAT|PSAT)\/admin(?:[/?]|$)/.test(route.query.returnTo)
  ? route.query.returnTo : { name: route.name.startsWith('psat-') ? 'psat-admin' : 'sat-admin', query: { tab: 'papers' } })

// SAT 的不同难度模块都属于试卷内容，预览和打印均保留各个分支。
const modules = computed(() => (paper.value?.stages || []).flatMap((stage) =>
  (stage.modules || []).flatMap((module) => [module, ...(module.adaptiveOptions || [])].map((item) => ({
    ...item, section: String(stage.stageCode || '').toUpperCase().startsWith('RW') ? 'RW' : 'MATH',
  }))),
))
const visibleModules = computed(() => modules.value.filter((module) => selectedSection.value === 'ALL' || module.section === selectedSection.value))
const currentModule = computed(() => modules.value.find((module) => String(module.moduleId) === selectedModule.value))
const currentQuestions = computed(() => currentModule.value?.questions || [])
const currentQuestion = computed(() => currentQuestions.value[questionIndex.value])
const sectionNames = { RW: 'Reading and Writing', MATH: 'Math' }
const correctAnswerText = (question) => answerDisplayText(question?.correctAnswer, '—')

// 编辑接口返回的选项可能是对象、JSON 字符串或历史数组格式。
function questionOptions(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(value)) return value.map((option, index) => {
      const label = String.fromCharCode(65 + index)
      if (typeof option === 'string') return { label, text: option.replace(/^[A-Z][)\.]\s*/, '') }
      return { label: option?.id || option?.label || label, text: option?.text || option?.value || '' }
    }).filter((option) => option.text)
    return value && typeof value === 'object'
      ? Object.entries(value).filter(([, text]) => text != null && String(text).trim()).map(([label, text]) => ({ label, text: String(text) }))
      : []
  } catch {
    return []
  }
}

function imageUrl(value) {
  if (!value) return ''
  const url = String(value)
  const base = import.meta.env.VITE_API_BASE_URL || ''
  if (url.startsWith('/uploads/')) return `${base}${url}`
  if (url.startsWith('uploads/')) return `${base}/${url}`
  return url
}

async function loadPaper() {
  loading.value = true
  error.value = ''
  try {
    paper.value = await apiRequest(`/api/admin/sat/papers/${encodeURIComponent(route.params.paperId)}/editor/structure`)
    if (!paper.value?.paperId) throw new Error('Paper data is unavailable.')
    selectedModule.value = String(modules.value[0]?.moduleId || '')
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load this paper.'
  } finally {
    loading.value = false
  }
}

// 等待字体加载后调用浏览器打印；提示尚未加载或不可用的图片。
async function printPaper() {
  notice.value = ''
  await document.fonts?.ready
  const images = [...document.querySelectorAll('.sat-paper-document img')]
  if (images.some((image) => !image.complete || !image.naturalWidth)) {
    notice.value = 'Some images are missing or still loading. They may be blank in the PDF.'
  }
  window.print()
}

watch(selectedModule, () => { questionIndex.value = 0 })
watch([paper, documentMode, selectedSection, isExport], () => {
  if (isExport.value && paper.value) {
    const section = selectedSection.value === 'ALL' ? 'Whole Paper' : sectionNames[selectedSection.value]
    document.title = `${paper.value.paperTitle} - ${section} - ${documentMode.value === 'ANSWER' ? 'Solutions' : 'Student Paper'}`
  }
})
onMounted(loadPaper)
onBeforeUnmount(() => { document.title = previousTitle })
</script>

<template>
  <main class="sat-paper-view">
    <div class="sat-paper-toolbar no-print">
      <RouterLink :to="returnLocation">Back to Paper Management</RouterLink>
      <h1>{{ isExport ? 'Print setup' : 'Paper Preview' }}</h1>
      <template v-if="paper && isExport">
        <div class="sat-paper-controls">
          <label>Document <select v-model="documentMode"><option value="STUDENT">Student Paper</option><option value="ANSWER">Answer Key</option></select></label>
          <label>Section <select v-model="selectedSection"><option value="ALL">All Sections</option><option value="RW">Reading and Writing</option><option value="MATH">Math</option></select></label>
          <button type="button" @click="printPaper">Print / Save PDF</button>
        </div>
        <p>Use your browser's print dialog to save as PDF.</p>
      </template>
      <p v-if="notice" role="alert">{{ notice }}</p>
    </div>
    <div v-if="loading" class="sat-paper-state">Loading paper...</div>
    <div v-else-if="error" class="sat-paper-state" role="alert">{{ error }} <button type="button" @click="loadPaper">Retry</button></div>
    <template v-else-if="paper">
      <div v-if="!isExport" class="sat-preview">
        <header><h2>{{ paper.paperTitle }}</h2><label>Module <select v-model="selectedModule"><option v-for="module in modules" :key="module.moduleId" :value="String(module.moduleId)">{{ sectionNames[module.section] }} — {{ module.moduleName }}</option></select></label></header>
        <template v-if="currentQuestion">
          <p>Question {{ questionIndex + 1 }} of {{ currentQuestions.length }}</p>
          <div class="sat-preview__question">
            <div v-if="currentQuestion.material?.content" v-math class="sat-rich-text" v-html="renderMarkdown(currentQuestion.material.content)"></div>
            <img v-if="currentQuestion.material?.fileUrl" :src="imageUrl(currentQuestion.material.fileUrl)" alt="Question material">
            <div v-math class="sat-rich-text" v-html="renderMarkdown(currentQuestion.content)"></div>
            <div v-if="questionOptions(currentQuestion.options).length" class="sat-preview__options">
              <label v-for="option in questionOptions(currentQuestion.options)" :key="option.label"><input v-model="answers[currentQuestion.questionId]" type="radio" :name="`question-${currentQuestion.questionId}`" :value="option.label"><strong>{{ option.label }}.</strong><span v-math class="sat-rich-text" v-html="renderMarkdown(option.text)"></span></label>
            </div>
            <input v-else v-model="answers[currentQuestion.questionId]" type="text" aria-label="Your answer" placeholder="Type your answer here">
          </div>
          <nav class="sat-preview__navigation"><button type="button" :disabled="questionIndex === 0" @click="questionIndex--">Previous</button><button type="button" :disabled="questionIndex >= currentQuestions.length - 1" @click="questionIndex++">Next</button></nav>
        </template>
        <p v-else>No questions in this module.</p>
      </div>
      <div v-else class="sat-paper-document">
        <h1>{{ paper.paperTitle }}</h1>
        <p>{{ documentMode === 'ANSWER' ? 'Answer Key and Solutions' : 'Student Paper' }}</p>
        <section v-for="module in visibleModules" :key="module.moduleId" class="sat-print-module">
          <h2>{{ sectionNames[module.section] }} — {{ module.moduleName }}</h2>
          <p v-if="!module.questions?.length">No questions in this module.</p>
          <article v-for="(question, index) in module.questions" :key="`${module.moduleId}-${question.questionId}-${index}`" class="sat-print-question">
            <strong>Question {{ index + 1 }}</strong>
            <template v-if="documentMode === 'STUDENT'">
              <div v-if="question.material?.content" v-math class="sat-rich-text sat-print-material" v-html="renderMarkdown(question.material.content)"></div>
              <img v-if="question.material?.fileUrl" :src="imageUrl(question.material.fileUrl)" alt="Question material">
              <div v-math class="sat-rich-text" v-html="renderMarkdown(question.content)"></div>
              <div v-for="option in questionOptions(question.options)" :key="option.label" class="sat-print-option"><strong>{{ option.label }}.</strong><div v-math class="sat-rich-text" v-html="renderMarkdown(option.text)"></div></div>
              <p v-if="!questionOptions(question.options).length">Answer: __________________________</p>
            </template>
            <template v-else>
              <p>Answer: {{ correctAnswerText(question) }}</p>
              <div v-if="question.analysis" v-math class="sat-rich-text" v-html="renderMarkdown(question.analysis)"></div>
            </template>
          </article>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
.sat-paper-view { min-height: 100vh; padding: 24px; color: #202938; background: #eef2f7; }
.sat-paper-toolbar, .sat-paper-state, .sat-preview { max-width: 1000px; margin: 0 auto 18px; padding: 20px; border: 1px solid #dbe5f4; border-radius: 12px; background: white; }
.sat-paper-toolbar a { color: #315fba; font-weight: 600; }
.sat-paper-toolbar h1 { font-size: 20px; }
.sat-paper-controls, .sat-preview header, .sat-preview__navigation { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.sat-paper-controls label, .sat-preview header label { display: grid; gap: 6px; font-weight: 600; }
.sat-paper-view select, .sat-paper-view button, .sat-preview input[type="text"] { min-height: 38px; padding: 7px 12px; border: 1px solid #cbd8eb; border-radius: 7px; background: white; font: inherit; }
.sat-paper-view button { cursor: pointer; color: #2453a4; font-weight: 600; }
.sat-paper-view button:disabled { opacity: .5; cursor: default; }
.sat-preview header { justify-content: space-between; }
.sat-preview__question { min-height: 260px; padding: 16px 0; }
.sat-preview__question img, .sat-paper-document img { max-width: 100%; height: auto; }
.sat-preview__options { display: grid; gap: 8px; margin: 16px 0; }
.sat-preview__options label { display: flex; gap: 12px; align-items: baseline; padding: 10px; border: 1px solid #dbe5f4; border-radius: 8px; }
.sat-preview__navigation { justify-content: space-between; }
.sat-paper-document { box-sizing: border-box; width: min(100%, 8.5in); margin: auto; padding: .7in; background: white; font-family: Georgia, serif; }
.sat-paper-document > h1, .sat-paper-document > p { text-align: center; }
.sat-print-module { margin-top: 32px; }
.sat-print-question { margin: 22px 0; break-inside: avoid; }
.sat-print-option { display: flex; gap: 10px; align-items: baseline; }
.sat-print-material { font-size: 17px; line-height: 1.6; white-space: pre-wrap; }
.sat-rich-text :deep(img) { max-width: 100%; height: auto; }
.sat-rich-text :deep(table) { border-collapse: collapse; }
.sat-rich-text :deep(th), .sat-rich-text :deep(td) { border: 1px solid #aaa; padding: 4px; }
@media print {
  .sat-paper-view { padding: 0; background: white; }
  .no-print { display: none !important; }
  /* 缩小页眉页脚区域以阻止浏览器注入日期和网址，并在每一页保留正文留白。 */
  .sat-paper-document { width: auto; padding: .52in 0; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .sat-print-module + .sat-print-module { break-before: page; }
  @page { size: letter; margin: .18in .7in; }
}
</style>
