<template>
  <component :is="isStaff ? AdminLayout : 'div'" class="report-page" :class="{ 'report-page--admin': isStaff }">
    <header v-if="!isStaff" class="topbar">
      <div class="brand">JIN SAT&amp;PSAT System</div>
      <nav class="actions">
        <button class="print-btn" @click="handlePrint" :disabled="loading || exportingPdf">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19,8H5A3,3 0 0,0 2,11V17H6V21H18V17H22V11A3,3 0 0,0 19,8M16,19H8V14H16V19M19,12A1,1 0 0,1 18,11A1,1 0 0,1 19,10A1,1 0 0,1 20,11A1,1 0 0,1 19,12M18,3H6V7H18V3Z"/>
          </svg>
          Print
        </button>
        <button class="export-pdf-btn" @click="exportToPDF" :disabled="loading || exportingPdf">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
          </svg>
          Export PDF
        </button>
          <a v-if="isStaff" class="home" href="/">Return to Home</a>
          <RouterLink v-else class="home" :to="{ name: 'student-workspace', params: { code: 'SAT' } }">Back to SAT exams</RouterLink>
      </nav>
    </header>

    <main class="content">
      <div class="header-section">
        <div v-if="isStaff" class="report-heading-actions">
          <button
            v-if="staffReturnPath"
            type="button"
            class="staff-report-back"
            @click="returnToStaffPage"
          >← Back to results</button>
          <div class="report-export-actions">
            <button class="print-btn" type="button" @click="handlePrint" :disabled="loading || exportingPdf">Print</button>
            <button class="export-pdf-btn" type="button" @click="exportToPDF" :disabled="loading || exportingPdf">
              {{ exportingPdf ? 'Exporting...' : 'Export PDF' }}
            </button>
          </div>
        </div>
        <h1 class="page-title">Score Report</h1>
        <div class="report-info" v-if="!loading && !errorMessage">
          <p class="user-info">Student Name: {{ showValue(reportData.userName) }}</p>
          <p class="exam-info">Exam Name: {{ showValue(reportData.examName) }}</p>
          <p class="paper-info">
            Paper Name: {{ showValue(reportData.paperName) }}
            <span class="scoring-badge">{{ reportData.scoringType }} Scoring</span>
            <span v-if="reportData.mode === 'practice'" class="mode-badge">Practice</span>
          </p>
          <p class="proctor-info" :class="{ 'proctor-warning': reportData.abnormalCount > 0 }">
            Times Left Exam Page: {{ reportData.abnormalCount }}
          </p>
        </div>
        <p class="page-subtitle">{{ isStaff ? 'Student performance overview and detailed answers' : 'Your performance overview and detailed answers' }}</p>
      </div>

      <section class="card" v-if="loading">
        <div class="loading">Loading report...</div>
      </section>

      <section class="card error-card" v-else-if="errorMessage">
        <h2 class="card-title">Report Unavailable</h2>
        <p class="error-text">{{ errorMessage }}</p>
        <div class="error-actions">
          <button class="retry-btn" @click="retryReport">Retry</button>
          <a class="login-link" href="/login">Sign in again</a>
        </div>
      </section>

      <section class="card" v-else>
        <h2 class="card-title">Summary</h2>
        <div class="summary-grid">
          <div class="summary-item">
            <div class="label">RW Module 1</div>
            <div class="value">Raw: {{ summary.rw1Raw }} | Time: {{ formatSeconds(summary.rw1Spend) }}</div>
          </div>
          <div class="summary-item">
            <div class="label">RW Module 2</div>
            <div class="value">Raw: {{ summary.rw2Raw }} | Time: {{ formatSeconds(summary.rw2Spend) }}</div>
          </div>
          <div class="summary-item">
            <div class="label">Math Module 1</div>
            <div class="value">Raw: {{ summary.math1Raw }} | Time: {{ formatSeconds(summary.math1Spend) }}</div>
          </div>
          <div class="summary-item">
            <div class="label">Math Module 2</div>
            <div class="value">Raw: {{ summary.math2Raw }} | Time: {{ formatSeconds(summary.math2Spend) }}</div>
          </div>
          <div class="summary-total">
            <div class="label">Total Raw</div>
            <div class="value">{{ summary.totalRaw }}</div>
          </div>
          <div class="summary-scores">
            <div class="label">Scaled Scores</div>
            <div class="scores">
              <div>EBRW: {{ showValue(summary.ebrwScaled) }}</div>
              <div>Math: {{ showValue(summary.mathScaled) }}</div>
              <div>Total: {{ showValue(summary.totalScaled) }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="analytics-grid" v-if="!loading && !errorMessage">
        <div class="card analytics-card skills-card">
          <div class="card-heading">
            <div>
              <h2 class="card-title">Knowledge and Skills</h2>
              <p class="card-subtitle">Performance across tagged SAT content domains and question types.</p>
            </div>
            <span class="muted">{{ knowledgeBreakdown.length }} skill areas</span>
          </div>
          <div v-if="!reportData.answersVisible" class="empty-state">
            Question-level analysis is currently hidden for this exam.
          </div>
          <div v-else-if="knowledgeBreakdown.length === 0" class="empty-state">No tagged questions available.</div>
          <div v-else class="skills-layout">
            <section v-for="section in knowledgeSections" :key="section.key" class="skill-section">
              <h3 class="skill-section-title">{{ section.title }}</h3>
              <div v-if="section.items.length === 0" class="skill-section-empty">No tagged questions</div>
              <article v-for="item in section.items" :key="knowledgeKey(item.item)" class="skill-item">
                <div class="skill-item-header">
                  <div>
                    <h4 class="skill-title">{{ item.title }}</h4>
                    <p class="skill-meta">
                      {{ item.detail }}
                      <span v-if="item.detail"> · </span>
                      {{ item.total }} questions, {{ item.correct }} correct
                    </p>
                  </div>
                  <span :class="['skill-percent', accuracyClass(item.accuracy)]">{{ formatPercent(item.accuracy) }}</span>
                </div>
                <div class="skill-meter" :aria-label="`${item.title} ${formatPercent(item.accuracy)}`">
                  <span
                    v-for="segment in skillSegments"
                    :key="segment"
                    :class="['skill-segment', { filled: segment <= item.filledSegments }]"
                  ></span>
                </div>
                <div class="skill-foot">
                  <span>{{ item.wrong }} wrong, {{ item.unanswered }} unanswered</span>
                  <span class="questions-cell" :title="item.questionsTitle">
                    {{ item.questionsPreview }}
                    <span v-if="item.hiddenQuestionCount > 0" class="questions-more">+{{ item.hiddenQuestionCount }} more</span>
                  </span>
                </div>
              </article>
            </section>
          </div>
        </div>

        <div class="card analytics-card">
          <div class="card-heading">
            <h2 class="card-title">Time Analysis</h2>
            <span class="muted">{{ timeAnalysis.hasQuestionTiming ? 'Question timing tracked' : 'Module timing only' }}</span>
          </div>
          <div class="time-table-wrapper">
            <table class="time-table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Total Time</th>
                  <th>Avg / Question</th>
                  <th>Correct</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                <tr class="summary-row">
                  <td>Total</td>
                  <td>{{ formatSeconds(timeAnalysis.totalSpendSeconds) }}</td>
                  <td>{{ formatSeconds(timeAnalysis.avgPerQuestionSeconds) }}</td>
                  <td>{{ totalCorrect }}/{{ totalQuestions }}</td>
                  <td>{{ formatPercent(totalAccuracy) }}</td>
                </tr>
                <tr v-for="module in timeAnalysis.byModule" :key="module.module">
                  <td>{{ moduleLabel(module.module) }}</td>
                  <td>{{ formatSeconds(module.spendSeconds) }}</td>
                  <td>{{ formatSeconds(module.avgSeconds) }}</td>
                  <td>{{ module.correct }}/{{ module.questionCount }}</td>
                  <td>{{ formatPercent(module.accuracy) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card" v-if="!loading && !errorMessage">
        <h2 class="card-title">Answer Details</h2>
        <div v-if="!reportData.answersVisible" class="empty-state">
          Answer details and explanations are currently hidden for this exam.
        </div>
        <div v-else-if="answers.length === 0" class="empty-state">No answer details are available for this attempt.</div>
        <div v-else class="table-wrapper">
          <table class="answers-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Module</th>
                <th>Skill</th>
                <th>Time</th>
                <th>Chosen</th>
                <th>Correct</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(a, idx) in answers" :key="idx" :class="[a.isCorrect === 1 ? 'row-ok' : (a.isCorrect === 0 ? 'row-bad' : 'row-unknown'), { 'row-clickable': !isStaff }]" @click="openQuestion(a)">
                <td>{{ idx + 1 }}</td>
                <td>{{ a.module }}</td>
                <td>{{ a.tagLabel || 'Uncategorized' }}</td>
                <td>{{ formatQuestionTime(a.spendSeconds) }}</td>
                <td>{{ a.chosen ?? '-' }}</td>
                <td>{{ a.correct }}</td>
                <td>
                  <span :class="a.isCorrect === 1 ? 'ok' : (a.isCorrect === 0 ? 'bad' : 'unknown')">
                    {{ a.isCorrect === 1 ? 'Correct' : (a.isCorrect === 0 ? 'Incorrect' : 'N/A') }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

    </main>
  </component>
</template>

<script>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { authState } from '@/auth'
import AdminLayout from '@/components/admin/AdminLayout.vue'

export default {
  name: 'Report',
  setup() {
    const router = useRouter()
    const loading = ref(true)
    const exportingPdf = ref(false)
    const errorMessage = ref('')
    const summary = ref({ rw1Raw: 0, rw2Raw: 0, math1Raw: 0, math2Raw: 0, rw1Spend: 0, rw2Spend: 0, math1Spend: 0, math2Spend: 0, totalRaw: 0 })
    const answers = ref([])
    const knowledgeBreakdown = ref([])
    const timeAnalysis = ref({
      totalSpendSeconds: 0,
      avgPerQuestionSeconds: 0,
      correctAvgSeconds: 0,
      incorrectAvgSeconds: 0,
      hasQuestionTiming: false,
      byModule: [],
      byQuestion: []
    })
    const reportData = ref({ userName: '', examName: '', paperName: '', paperId: null, scoringType: 'SAT', mode: '', abnormalCount: 0, answersVisible: true })
    const reportQuery = ref({ examId: null, recordId: null })
    const isStaff = computed(() => ['ADMIN', 'TEACHER'].includes(authState.user?.roleCode))
    const staffReturnPath = computed(() => {
      const path = router.currentRoute.value.query.returnTo
      return typeof path === 'string' && path.startsWith('/exam-types/SAT/admin/') ? path : ''
    })

    const returnToStaffPage = () => {
      if (staffReturnPath.value) router.push(staffReturnPath.value)
    }

    const formatSeconds = (s) => {
      const sec = Number(s || 0)
      const m = Math.floor(sec / 60)
      const r = sec % 60
      return `${m}m ${r}s`
    }

    const reportErrorMessage = (error) => {
      const status = error?.status || error?.response?.status
      if (status === 401 || status === 403) return 'Your session does not have permission to view this report. Please sign in again.'
      return error?.message || error?.msg || 'Report data could not be loaded. Please try again.'
    }

    const fetchReport = async (examId, recordId) => {
      loading.value = true
      errorMessage.value = ''
      try {
        let res
        if (isStaff.value) {
          const { getSatAttemptReport } = await import('../../admin/api/studentScores.js')
          res = await getSatAttemptReport(recordId)
        } else {
          const { examApi } = await import('../api/exam.js')
          try {
            const readyRes = await examApi.isReportReady(examId, recordId)
            const ready = !!(readyRes?.data?.ready || readyRes?.ready)
            if (!ready) await new Promise(r => setTimeout(r, 400))
          } catch (readyError) {
            console.warn('Report readiness check failed; loading report directly:', readyError)
          }
          res = await examApi.getReport(examId, recordId)
        }
        const data = res?.data || res || {}
        summary.value = data.summary || summary.value
        answers.value = Array.isArray(data.answers) ? data.answers : []
        knowledgeBreakdown.value = Array.isArray(data.knowledgeBreakdown) ? data.knowledgeBreakdown : []
        timeAnalysis.value = {
          ...timeAnalysis.value,
          ...(data.timeAnalysis || {}),
          byModule: Array.isArray(data.timeAnalysis?.byModule) ? data.timeAnalysis.byModule : [],
          byQuestion: Array.isArray(data.timeAnalysis?.byQuestion) ? data.timeAnalysis.byQuestion : []
        }
        // 更新报告数据
        reportData.value = {
          userName: data.userName || '',
          examName: data.examName || '',
          paperName: data.paperName || '',
          paperId: data.paperId || null,
          scoringType: data.scoringType === 'PSAT' || Number(data.totalScore) === 1520 ? 'PSAT' : 'SAT',
          mode: data.mode || '',
          abnormalCount: Number(data.abnormalCount) || 0,
          answersVisible: data.answersVisible === true
        }
      } catch (error) {
        console.error('Load report failed:', error)
        errorMessage.value = reportErrorMessage(error)
      } finally {
        loading.value = false
      }
    }

    const openQuestion = (row) => {
      if (isStaff.value) return
      const qid = row?.questionId || row?.qid
      if (!qid || !reportData.value.paperId || !reportQuery.value.recordId) return
      router.push({
        path: '/student/sat/exams/' + reportQuery.value.examId,
        query: {
          review: '1',
          examId: reportQuery.value.examId,
          recordId: reportQuery.value.recordId,
          paperId: reportData.value.paperId,
          moduleId: row?.moduleId || '',
          questionId: qid
        }
      })
    }

    const handlePrint = () => {
      window.print()
    }

    const exportToPDF = async () => {
      if (loading.value || exportingPdf.value) return
      exportingPdf.value = true
      const exportButtons = document.querySelectorAll('.report-export-actions, .actions')
      const hiddenElements = []
      try {
        const html2pdf = (await import('html2pdf.js')).default
        const element = document.querySelector('.content')
        if (!element) throw new Error('Report content is unavailable')
        for (const item of exportButtons) {
          hiddenElements.push([item, item.style.display])
          item.style.display = 'none'
        }
        const staffBack = element.querySelector('.staff-report-back')
        if (staffBack) {
          hiddenElements.push([staffBack, staffBack.style.display])
          staffBack.style.display = 'none'
        }
        const options = {
          margin: 1,
          filename: `${reportData.value.userName || 'Student'}_${reportData.value.examName || 'Exam'}_Report.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { 
            scale: 2,
            useCORS: true,
            letterRendering: true
          },
          jsPDF: { 
            unit: 'in', 
            format: 'a4', 
            orientation: 'portrait' 
          }
        }
        
        await html2pdf().set(options).from(element).save()
      } catch (error) {
        console.error('PDF export failed:', error)
        alert('PDF export failed. Please try again.')
      } finally {
        for (const [element, display] of hiddenElements) element.style.display = display
        exportingPdf.value = false
      }
    }

    onMounted(async () => {
      const q = router.currentRoute.value.query || {}
      const examId = q.examId ? Number(q.examId) : null
      const recordId = q.recordId ? Number(q.recordId) : null
      if (!examId || !recordId) {
        router.replace('/')
        return
      }
      reportQuery.value = { examId, recordId }
      await fetchReport(examId, recordId)
      if (q.autoPrint === '1' && !errorMessage.value) {
        // 等报告内容完成渲染后再打开浏览器打印对话框。
        await nextTick()
        window.setTimeout(() => window.print(), 300)
      }
    })

    const retryReport = () => {
      if (!reportQuery.value.examId || !reportQuery.value.recordId) return
      fetchReport(reportQuery.value.examId, reportQuery.value.recordId)
    }

    const showValue = (v) => (v !== undefined && v !== null ? v : '—')
    const strongestKnowledge = computed(() => {
      const sorted = [...knowledgeBreakdown.value].sort((a, b) => Number(b.accuracy || 0) - Number(a.accuracy || 0))
      return sorted[0]?.label || '—'
    })
    const weakestKnowledge = computed(() => {
      const sorted = [...knowledgeBreakdown.value].sort((a, b) => Number(a.accuracy || 0) - Number(b.accuracy || 0))
      return sorted[0]?.label || '—'
    })
    const formatPercent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`
    const accuracyClass = (value) => {
      const score = Number(value || 0)
      if (score >= 80) return 'strong'
      if (score >= 60) return 'medium'
      return 'weak'
    }
    const knowledgeKey = (item) => Array.isArray(item?.tagPath) && item.tagPath.length > 0
      ? item.tagPath.join('>')
      : item?.label || 'Uncategorized'
    const skillSegments = Array.from({ length: 8 }, (_, index) => index + 1)
    const normalizedTagKey = (path) => {
      const key = (Array.isArray(path) ? path.filter(Boolean) : []).join('>')
      return key || 'Uncategorized'
    }
    const summarizeQuestions = (questions, limit = 6) => {
      const list = Array.isArray(questions) ? questions : []
      const visible = list.slice(0, limit)
      return {
        questionsTitle: list.length > 0 ? list.join(', ') : '-',
        questionsPreview: visible.length > 0 ? visible.join(', ') : '-',
        hiddenQuestionCount: Math.max(0, list.length - visible.length)
      }
    }
    const subjectFromModule = (module) => String(module || '').toLowerCase().startsWith('math') ? 'Math' : 'RW'
    const sectionTitle = (subject) => subject === 'Math' ? 'Math' : 'Reading and Writing'
    const legacyPrefixLabels = new Set(['psat demo', 'sat demo'])
    const displayPartsForPath = (path, subject) => {
      const parts = Array.isArray(path) ? path.filter(Boolean) : []
      if (parts.length === 0) return { title: 'Uncategorized', detail: '' }

      const first = String(parts[0]).toLowerCase()
      const startsWithCanonicalRoot = first === 'english language arts' || first === 'mathematics' || first === 'rw' || first === 'reading and writing' || first === 'math'
      const startsWithLegacyPrefix = legacyPrefixLabels.has(first)
      const visibleParts = startsWithCanonicalRoot || startsWithLegacyPrefix ? parts.slice(1) : parts

      if (visibleParts.length === 0) return { title: sectionTitle(subject), detail: '' }
      return {
        title: visibleParts[0],
        detail: visibleParts.slice(1).join(' / ')
      }
    }
    const emptyStats = () => ({ total: 0, correct: 0, wrong: 0, unanswered: 0, questions: [] })
    const knowledgeStats = computed(() => {
      const answerStats = new Map()
      answers.value.forEach((answer, index) => {
        const key = normalizedTagKey(answer?.tagPath)
        const subject = subjectFromModule(answer?.module)
        const scopedKey = `${subject}::${key}`
        const stat = answerStats.get(scopedKey) || { ...emptyStats(), subject, tagPath: Array.isArray(answer?.tagPath) ? answer.tagPath.filter(Boolean) : [] }
        const chosen = answer?.chosen
        const isUnanswered = chosen === undefined || chosen === null || String(chosen).trim() === '' || String(chosen).trim() === '-'
        stat.total += 1
        if (Number(answer?.isCorrect) === 1) stat.correct += 1
        if (isUnanswered) {
          stat.unanswered += 1
        } else if (Number(answer?.isCorrect) !== 1) {
          stat.wrong += 1
        }
        stat.questions.push(`Q${index + 1}`)
        answerStats.set(scopedKey, stat)
      })
      return answerStats
    })

    const knowledgeSections = computed(() => {
      const sectionDefs = [
        { key: 'RW', title: 'Reading and Writing' },
        { key: 'Math', title: 'Math' }
      ]
      const bySection = new Map(sectionDefs.map(section => [section.key, { ...section, items: [] }]))
      const breakdownByPath = new Map(knowledgeBreakdown.value.map(item => [normalizedTagKey(item?.tagPath), item]))
      const sortedStats = Array.from(knowledgeStats.value.values()).sort((a, b) => {
        const aDisplay = displayPartsForPath(a.tagPath, a.subject)
        const bDisplay = displayPartsForPath(b.tagPath, b.subject)
        return [a.subject, aDisplay.title, aDisplay.detail].join('\u0000').localeCompare([b.subject, bDisplay.title, bDisplay.detail].join('\u0000'))
      })

      sortedStats.forEach(stats => {
        const item = breakdownByPath.get(normalizedTagKey(stats.tagPath)) || { tagPath: stats.tagPath, label: stats.tagPath.at(-1) || 'Uncategorized' }
        const questionSummary = summarizeQuestions(stats.questions)
        const display = displayPartsForPath(stats.tagPath, stats.subject)
        const total = Number(stats.total || item.total || 0)
        const correct = Number(stats.correct || item.correct || 0)
        const accuracy = total > 0 ? Math.round((correct * 1000) / total) / 10 : 0
        const sectionKey = stats.subject
        if (!bySection.has(sectionKey)) {
          bySection.set(sectionKey, { key: sectionKey, title: sectionTitle(sectionKey), items: [] })
        }
        bySection.get(sectionKey).items.push({
          item,
          title: display.title,
          detail: display.detail,
          total,
          correct,
          wrong: stats.wrong,
          unanswered: stats.unanswered,
          accuracy,
          filledSegments: Math.max(0, Math.min(skillSegments.length, Math.round((accuracy / 100) * skillSegments.length))),
          ...questionSummary
        })
      })
      return Array.from(bySection.values())
    })
    const moduleLabel = (module) => {
      const labels = {
        RW1: 'RW Module 1',
        RW2: 'RW Module 2',
        Math1: 'Math Module 1',
        Math2: 'Math Module 2'
      }
      return labels[module] || module || 'Module'
    }
    const totalCorrect = computed(() => (timeAnalysis.value.byModule || []).reduce((sum, item) => sum + Number(item.correct || 0), 0))
    const totalQuestions = computed(() => (timeAnalysis.value.byModule || []).reduce((sum, item) => sum + Number(item.questionCount || 0), 0))
    const totalAccuracy = computed(() => totalQuestions.value > 0 ? (totalCorrect.value / totalQuestions.value) * 100 : 0)
    const formatQuestionTime = (seconds) => Number(seconds || 0) > 0 ? formatSeconds(seconds) : '—'

    return {
      loading,
      errorMessage,
      summary,
      answers,
      knowledgeBreakdown,
      knowledgeSections,
      timeAnalysis,
      reportData,
      isStaff,
      exportingPdf,
      staffReturnPath,
      returnToStaffPage,
      strongestKnowledge,
      weakestKnowledge,
      formatSeconds,
      showValue,
      handlePrint,
      exportToPDF,
      openQuestion,
      retryReport,
      AdminLayout,
      formatPercent,
      accuracyClass,
      knowledgeKey,
      skillSegments,
      moduleLabel,
      totalCorrect,
      totalQuestions,
      totalAccuracy,
      formatQuestionTime
    }
  }
}
</script>

<style scoped>
.report-page {
  min-height: 100vh;
  background: #fff;
  color: #2c3e50;
}
.report-page--admin { min-height: auto; background: transparent; }
.report-heading-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.report-export-actions { display: flex; align-items: center; gap: 8px; }
.report-export-actions .print-btn,
.report-export-actions .export-pdf-btn { min-height: 36px; padding: 0 14px; border: 1px solid var(--color-border, #dbe6f7); border-radius: 999px; background: #fff; color: var(--color-primary-strong, #245fe8); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
.report-export-actions .export-pdf-btn { background: var(--color-primary, #3478f6); border-color: transparent; color: #fff; }
.report-export-actions button:disabled { opacity: .55; cursor: wait; }

/* Row background colors for correctness */
.answers-table tr.row-ok { background-color: #f6ffed; }       /* light green */
.answers-table tr.row-bad { background-color: #fff1f0; }      /* light red */
.answers-table tr.row-unknown { background-color: #fffbe6; }  /* light yellow */

.answers-table tr.row-clickable:hover { filter: brightness(0.98); cursor: pointer; }
.topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid #eee;
    background: #fafafa;
  }

  .brand {
    font-size: 12px;
    color: #666;
  }

  .actions {
    display: flex;
    gap: 16px;
  }

  .print-btn,
  .export-pdf-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 4px 8px;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: normal;
    cursor: pointer;
    text-decoration: none;
  }

  .print-btn {
    background: #28a745;
  }

  .print-btn:hover:not(:disabled) {
    background: #1e7e34;
  }

  .export-pdf-btn:hover:not(:disabled) {
    background: #0056b3;
  }

  .print-btn:disabled,
  .export-pdf-btn:disabled {
    background: #6c757d;
    cursor: not-allowed;
  }

  .home {
    font-size: 12px;
    color: #4a4a4a;
    text-decoration: none;
  }

  .home:hover {
    color: #000;
  }

.content {
    max-width: 960px;
    margin: 24px auto;
  }

  .header-section {
    margin-bottom: 16px;
  }

  .staff-report-back {
    display: inline-flex;
    align-items: center;
    border: 0;
    padding: 4px 0;
    color: var(--color-muted);
    background: transparent;
    font: inherit;
    font-size: 14px;
    font-weight: 650;
    cursor: pointer;
  }

  .staff-report-back:hover {
    color: var(--color-primary-strong);
  }

  .page-title {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 6px;
  }

  .report-info {
    background: #fff;
    border: 1px solid #eee;
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.06);
    padding: 16px;
    margin: 16px 0;
    text-align: left;
  }

  .report-info p {
    margin: 4px 0;
    font-size: 14px;
    color: #4a4a4a;
  }

  .user-info {
    font-weight: 600;
    color: #333;
  }

  .exam-info, .paper-info {
    color: #666;
  }
  .proctor-info {
    font-weight: 600;
    color: #2f855a;
  }
  .proctor-info.proctor-warning {
    color: #c0392b;
  }
  .scoring-badge {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 8px;
    border: 1px solid #c6e2ff;
    border-radius: 10px;
    color: #1677ff;
    background: #ecf5ff;
    font-size: 12px;
    font-weight: 600;
    vertical-align: middle;
  }
  .mode-badge {
    display: inline-block;
    margin-left: 8px;
    padding: 2px 6px;
    font-size: 12px;
    color: #8a6d3b;
    background-color: #fcf8e3;
    border: 1px solid #faebcc;
    border-radius: 10px;
    vertical-align: middle;
  }
  .options-list { display: block; }
  .option-row { display: block; margin: 4px 0; }
  .opt-label { font-weight: 600; margin-right: 6px; }
  .opt-content p { display: inline; margin: 0; }

  .page-subtitle {
    font-size: 14px;
    color: #4a4a4a;
    margin: 0;
  }

.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.06); padding: 16px; margin-bottom: 16px; }
.card-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #111827; }
.card-subtitle { margin: 6px 0 0; color: #718096; font-size: 14px; line-height: 1.4; }
.card-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.card-heading .card-title { margin-bottom: 0; }

.summary-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.summary-item, .summary-total { padding: 12px; border: 1px solid #f0f0f0; border-radius: 8px; background: #fafafa; }
.summary-total { grid-column: span 2; display: flex; justify-content: space-between; }
.summary-scores { grid-column: span 2; padding: 12px; border: 1px solid #f0f0f0; border-radius: 8px; background: #fafafa; }
.scores { display: flex; gap: 24px; font-size: 14px; font-weight: 600; color: #333; }
.label { font-size: 12px; color: #666; }
.value { font-size: 14px; color: #333; font-weight: 600; }
.muted { font-size: 12px; color: #777; white-space: nowrap; }
.empty-state { padding: 24px 0; color: #777; font-size: 13px; text-align: center; border: 1px dashed #ddd; border-radius: 8px; background: #fafafa; }
.error-card { text-align: left; }
.error-text { margin: 0 0 14px; color: #c53030; font-size: 14px; line-height: 1.5; }
.error-actions { display: flex; align-items: center; gap: 12px; }
.retry-btn,
.login-link { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border-radius: 6px; font-size: 13px; text-decoration: none; cursor: pointer; }
.retry-btn { border: 1px solid #2c3e50; background: #2c3e50; color: #fff; }
.login-link { border: 1px solid #ddd; background: #fff; color: #2c3e50; }

.analytics-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}

.analytics-card { min-width: 0; }
.skills-card { border-color: #d9e7fb; border-radius: 8px; padding: 22px 26px; box-shadow: none; }
.skills-card .card-heading { align-items: flex-start; margin-bottom: 18px; }
.skills-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px 34px;
}
.skill-section { min-width: 0; }
.skill-section-title {
  margin: 0 0 14px;
  color: #111827;
  font-size: 17px;
  font-weight: 800;
  line-height: 1.25;
}
.skill-section-empty {
  min-height: 88px;
  display: flex;
  align-items: center;
  color: #718096;
  font-size: 13px;
}
.skill-item {
  padding: 0 0 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid #eef2f7;
}
.skill-item:last-child { margin-bottom: 0; border-bottom: none; }
.skill-item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.skill-title {
  margin: 0 0 3px;
  color: #111827;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.25;
}
.skill-meta {
  margin: 0;
  color: #3f4a5f;
  font-size: 13px;
  line-height: 1.35;
}
.skill-percent {
  flex: 0 0 auto;
  min-width: 46px;
  color: #111827;
  font-size: 14px;
  font-weight: 800;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.skill-meter {
  display: grid;
  grid-template-columns: repeat(8, minmax(18px, 1fr));
  gap: 3px;
  height: 12px;
  margin-bottom: 8px;
}
.skill-segment {
  display: block;
  min-width: 0;
  border: 1px solid #111827;
  background: #fff;
}
.skill-segment.filled { background: #000; }
.skill-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.35;
}
.questions-cell {
  min-width: 0;
  max-width: 50%;
  color: #253046;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.questions-more { display: inline-block; margin-left: 4px; color: #718096; font-weight: 700; white-space: nowrap; }
.accuracy { display: inline-block; min-width: 46px; font-size: 14px; font-weight: 800; color: #111827; }
.accuracy.strong,
.accuracy.medium,
.accuracy.weak { color: #111827; }
.time-table-wrapper { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
.time-table { width: 100%; border-collapse: collapse; min-width: 640px; table-layout: fixed; }
.time-table th,
.time-table td { padding: 10px 12px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: left; }
.time-table th { background: #fafafa; color: #555; font-weight: 700; }
.time-table th:not(:first-child),
.time-table td:not(:first-child) { text-align: center; }
.time-table td { color: #2d3748; }
.time-table tr:last-child td { border-bottom: none; }
.time-table th:last-child,
.time-table td:last-child { border-right: none; }
.time-table .summary-row td { background: #fcfcfc; font-weight: 700; }

.table-wrapper { overflow-x: auto; }
.answers-table { width: 100%; border-collapse: collapse; }
.answers-table th, .answers-table td { border: 1px solid #eee; padding: 8px; font-size: 13px; }
.answers-table th { background: #fafafa; text-align: left; }
.ok { color: #67C23A; font-weight: 600; }
.bad { color: #F56C6C; font-weight: 600; }
.unknown { color: #909399; }

@media print {
  .topbar {
    display: none;
  }

  .report-heading-actions { display: none; }

  .report-page {
    min-height: auto;
    color: #000;
  }

  .content {
    max-width: none;
    margin: 0;
  }

  .report-info,
  .card {
    box-shadow: none;
    break-inside: avoid;
  }
}

@media (max-width: 820px) {
  .content {
    margin: 16px 12px;
  }

  .analytics-grid,
  .summary-grid,
  .skills-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .summary-total,
  .summary-scores {
    grid-column: auto;
  }

  .scores {
    flex-direction: column;
    gap: 6px;
  }

  .card-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
}
</style>
