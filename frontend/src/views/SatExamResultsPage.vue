<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppCard from '@/components/AppCard.vue'
import AdminDataTable from '@/components/admin/AdminDataTable.vue'
import AdminLayout from '@/components/admin/AdminLayout.vue'
import { authState } from '@/auth'
import { getSatExamResults } from '@/examTypes/sat/admin/api/results'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref('')
const exam = ref(null)
const summary = ref(null)
const participants = ref([])
const keyword = ref(typeof route.query.studentSearch === 'string' ? route.query.studentSearch : '')
const isAdmin = computed(() => authState.user?.roleCode === 'ADMIN')

const filteredParticipants = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  if (!query) return participants.value
  return participants.value.filter((student) => `${student.studentName} ${student.username}`.toLocaleLowerCase().includes(query))
})

watch(keyword, (value) => {
  const query = { ...route.query, studentSearch: value.trim() || undefined }
  if (JSON.stringify(query) !== JSON.stringify(route.query)) {
    router.replace({ name: 'sat-exam-results', params: { examId: route.params.examId }, query })
  }
})

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function score(value, max = null) {
  if (value === null || value === undefined || value === '') return '—'
  return max ? `${value} / ${max}` : value
}

function backToExamReleases() {
  const returnTo = route.query.returnTo
  if (typeof returnTo === 'string' && returnTo.startsWith('/exam-types/SAT/admin')) {
    router.push(returnTo)
    return
  }
  router.push({ name: 'sat-admin', query: { tab: 'exams' } })
}

function openMonitor() {
  router.push({
    name: 'sat-admin-exam-monitor',
    params: { examId: route.params.examId },
    query: { returnTo: route.fullPath },
  })
}

function openReport(student) {
  if (!student.attemptId || student.status !== 'COMPLETED') return
  router.push({
    name: 'sat-report',
    query: {
      examId: route.params.examId,
      recordId: student.attemptId,
      source: 'admin',
      returnTo: route.fullPath,
    },
  })
}

async function loadResults() {
  loading.value = true
  error.value = ''
  try {
    const result = await getSatExamResults(route.params.examId)
    exam.value = result.exam
    summary.value = result.summary
    participants.value = result.participants || []
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load exam results.'
  } finally {
    loading.value = false
  }
}

onMounted(loadResults)
</script>

<template>
  <AdminLayout>
    <main class="sat-exam-results-page">
      <button type="button" class="sat-exam-results-back" @click="backToExamReleases">← Back to Exam Releases</button>
      <header class="sat-exam-results-heading">
        <div><p class="sat-exam-results-eyebrow">{{ exam?.examTypeCode || 'SAT' }} RESULTS</p><h1>{{ exam?.title || 'Exam results' }}</h1><p>{{ exam?.paperTitle || 'Paper unavailable' }}</p></div>
        <div class="sat-exam-results-heading-actions">
          <button v-if="isAdmin" type="button" class="sat-exam-results-monitor" @click="openMonitor">Monitor</button>
          <span v-if="exam" class="sat-exam-results-type">{{ exam.examTypeCode }}</span>
        </div>
      </header>

      <section v-if="exam" class="sat-exam-results-exam-info" aria-label="Exam information">
        <div><span>Availability</span><strong>{{ formatDate(exam.opensAt) }} – {{ formatDate(exam.closesAt) }}</strong></div>
        <div><span>Duration</span><strong>{{ Math.round((exam.durationSeconds || 0) / 60) }} min</strong></div>
        <div class="sat-exam-results-exam-info__modules"><span>Modules</span><div><strong v-for="module in exam.modules || []" :key="module">{{ module }}</strong><em v-if="!exam.modules?.length">Unavailable</em></div></div>
      </section>

      <p v-if="error" class="sat-exam-results-error" role="alert">{{ error }}</p>
      <div v-if="loading" class="sat-exam-results-empty">Loading exam results…</div>
      <template v-else-if="summary">
        <section class="sat-exam-results-summary" aria-label="Exam participation summary">
          <article><span>Assigned students</span><strong>{{ summary.participants }}</strong></article>
          <article><span>Completed</span><strong>{{ summary.completed }}</strong></article>
          <article><span>In progress</span><strong>{{ summary.inProgress }}</strong></article>
          <article><span>Not started</span><strong>{{ summary.notStarted }}</strong></article>
          <article><span>Average raw score</span><strong>{{ score(summary.averageRawScore) }}</strong><small>Range {{ score(summary.lowestRawScore) }} – {{ score(summary.highestRawScore) }}</small></article>
          <article><span>Average scaled score</span><strong>{{ score(summary.averageScaledScore) }}</strong><small>Range {{ score(summary.lowestScaledScore) }} – {{ score(summary.highestScaledScore) }}</small></article>
        </section>

        <section class="sat-exam-results-module-averages" aria-label="Average module raw scores">
          <header><h2>Module averages</h2><span>Raw points · completed attempts</span></header>
          <div class="sat-exam-results-module-averages__grid">
            <article><span>R&amp;W Module 1</span><strong>{{ score(summary.averageRw1RawScore) }}</strong></article>
            <article><span>R&amp;W Module 2</span><strong>{{ score(summary.averageRw2RawScore) }}</strong></article>
            <article><span>Math Module 1</span><strong>{{ score(summary.averageMath1RawScore) }}</strong></article>
            <article><span>Math Module 2</span><strong>{{ score(summary.averageMath2RawScore) }}</strong></article>
            <article><span>R&amp;W total</span><strong>{{ score(summary.averageRwRawScore) }}</strong></article>
            <article><span>Math total</span><strong>{{ score(summary.averageMathRawScore) }}</strong></article>
          </div>
        </section>

        <AppCard title="Student Results" subtitle="Latest attempt for each assigned student. Raw scores count correct answers; scaled scores use the exam’s SAT or PSAT table.">
          <div class="sat-exam-results-toolbar"><input v-model="keyword" type="search" placeholder="Search student or username" aria-label="Search students" /><span>{{ filteredParticipants.length }} students</span><button type="button" aria-label="Refresh results" @click="loadResults">Refresh</button></div>
          <p class="sat-exam-results-scroll-hint">Swipe horizontally to view all score details.</p>
          <div class="sat-exam-results-table-wrap" role="region" aria-label="Student result scores" tabindex="0">
            <AdminDataTable class="sat-exam-results-table">
              <thead><tr><th>Student</th><th>Attempt</th><th>Raw score</th><th>Scaled score</th><th>R&amp;W</th><th>Math</th><th>Module raw scores</th><th>Status</th><th>Submitted</th><th>Report</th></tr></thead>
              <tbody>
                <tr v-for="student in filteredParticipants" :key="student.studentId">
                  <td class="sat-exam-results-student"><strong>{{ student.studentName || 'Unnamed student' }}</strong><small>{{ student.username }}</small></td>
                  <td>{{ student.attemptNumber ? `#${student.attemptNumber}` : '—' }}</td>
                  <td>{{ score(student.rawTotalScore, student.rawMaxScore) }}</td>
                  <td>{{ score(student.totalScaledScore, student.scaledMaxScore) }}</td>
                  <td>{{ score(student.rwRawScore) }} <span class="sat-exam-results-score-separator">/</span> {{ score(student.rwScaledScore) }}</td>
                  <td>{{ score(student.mathRawScore) }} <span class="sat-exam-results-score-separator">/</span> {{ score(student.mathScaledScore) }}</td>
                  <td class="sat-exam-results-module-scores">
                    <span><small>RW1</small>{{ score(student.rw1RawScore) }}</span>
                    <span><small>RW2</small>{{ score(student.rw2RawScore) }}</span>
                    <span><small>Math1</small>{{ score(student.math1RawScore) }}</span>
                    <span><small>Math2</small>{{ score(student.math2RawScore) }}</span>
                  </td>
                  <td><span class="sat-exam-results-status" :class="`is-${student.status.toLowerCase().replaceAll('_', '-')}`">{{ student.status.replaceAll('_', ' ') }}</span></td>
                  <td>{{ formatDate(student.submittedAt) }}</td>
                  <td><button v-if="student.status === 'COMPLETED'" class="sat-exam-results-report" type="button" @click="openReport(student)">View report</button><span v-else>—</span></td>
                </tr>
                <tr v-if="filteredParticipants.length === 0"><td colspan="10" class="sat-exam-results-no-rows">{{ participants.length ? 'No students match this search.' : 'No students are assigned to this exam yet.' }}</td></tr>
              </tbody>
            </AdminDataTable>
          </div>
        </AppCard>
      </template>
    </main>
  </AdminLayout>
</template>

<style scoped>
.sat-exam-results-page { display: grid; gap: 18px; width: min(100%, 1180px); margin: 0 auto; padding: 8px 0 48px; }
.sat-exam-results-back { justify-self: start; border: 0; padding: 4px 0; color: var(--color-muted); background: transparent; font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
.sat-exam-results-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 6px 0; }
.sat-exam-results-heading-actions { display: flex; align-items: center; gap: 10px; }
.sat-exam-results-heading h1 { margin: 5px 0; color: var(--color-text); font-size: clamp(24px, 3vw, 32px); letter-spacing: -.03em; }
.sat-exam-results-exam-info { display: grid; grid-template-columns: minmax(260px, 1.4fr) minmax(100px, .45fr) minmax(280px, 1.5fr); gap: 18px; align-items: center; padding: 14px 18px; border: 1px solid var(--color-border); border-radius: 14px; background: #f8faff; }
.sat-exam-results-exam-info > div { display: grid; gap: 5px; min-width: 0; }
.sat-exam-results-exam-info span { color: var(--color-muted); font-size: 12px; font-weight: 700; }
.sat-exam-results-exam-info strong { color: var(--color-text); font-size: 13px; font-weight: 650; }
.sat-exam-results-exam-info__modules > div { display: flex; flex-wrap: wrap; gap: 6px; }
.sat-exam-results-exam-info__modules strong { padding: 4px 8px; border: 1px solid var(--color-border); border-radius: 999px; background: white; white-space: nowrap; }
.sat-exam-results-exam-info__modules em { color: var(--color-muted); font-size: 13px; font-style: normal; }
.sat-exam-results-heading p:last-child { margin: 0; color: var(--color-muted); font-size: 14px; }
.sat-exam-results-eyebrow { margin: 0; color: var(--color-primary); font-size: 12px; font-weight: 800; letter-spacing: .12em; }
.sat-exam-results-type { border: 1px solid var(--color-border); border-radius: 999px; padding: 7px 12px; color: var(--color-primary-strong); background: var(--color-primary-soft); font-size: 12px; font-weight: 750; }
.sat-exam-results-monitor { border: 1px solid var(--color-border); border-radius: 999px; padding: 8px 13px; color: var(--color-primary-strong); background: #fff; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.sat-exam-results-monitor:hover { background: var(--color-primary-soft); }
.sat-exam-results-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.sat-exam-results-summary article { display: grid; gap: 7px; border: 1px solid var(--color-border); border-radius: 14px; padding: 15px 17px; background: rgba(255,255,255,.88); box-shadow: 0 6px 20px rgba(33,65,110,.04); }
.sat-exam-results-summary span { color: var(--color-muted); font-size: 13px; font-weight: 650; }
.sat-exam-results-summary strong { color: var(--color-text); font-size: 25px; }
.sat-exam-results-summary small { color: var(--color-muted); font-size: 12px; }
.sat-exam-results-module-averages { display: grid; gap: 12px; border: 1px solid var(--color-border); border-radius: 16px; padding: 16px 18px; background: rgba(255,255,255,.78); }
.sat-exam-results-module-averages header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.sat-exam-results-module-averages h2 { margin: 0; color: var(--color-text); font-size: 16px; }
.sat-exam-results-module-averages header > span { color: var(--color-muted); font-size: 12px; }
.sat-exam-results-module-averages__grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.sat-exam-results-module-averages__grid article { display: grid; gap: 5px; border-radius: 10px; padding: 10px 12px; background: #f4f7fc; }
.sat-exam-results-module-averages__grid article span { color: var(--color-muted); font-size: 12px; font-weight: 650; }
.sat-exam-results-module-averages__grid article strong { color: var(--color-text); font-size: 18px; font-variant-numeric: tabular-nums; }
.sat-exam-results-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; color: var(--color-muted); font-size: 13px; }
.sat-exam-results-toolbar input { width: min(100%, 320px); min-height: 38px; border: 1px solid var(--color-border); border-radius: 9px; padding: 0 12px; color: var(--color-text); background: #fbfdff; font: inherit; }
.sat-exam-results-toolbar span { margin-left: auto; }
.sat-exam-results-toolbar button, .sat-exam-results-report { border: 1px solid var(--color-border); border-radius: 999px; padding: 8px 10px; color: var(--color-primary-strong); background: #fff; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; white-space: nowrap; }
.sat-exam-results-toolbar button:hover, .sat-exam-results-report:hover { background: var(--color-primary-soft); }
.sat-exam-results-table-wrap { overflow-x: auto; }
.sat-exam-results-scroll-hint { display: none; margin: 0 0 8px; color: var(--color-muted); font-size: 12px; }
.sat-exam-results-table { width: 100%; min-width: 1110px; table-layout: fixed; }
.sat-exam-results-table :deep(th), .sat-exam-results-table :deep(td) { padding: 12px 10px; text-align: center; white-space: nowrap; }
.sat-exam-results-table :deep(th:first-child), .sat-exam-results-table :deep(td:first-child) { text-align: left; }
.sat-exam-results-table :deep(th:nth-child(1)), .sat-exam-results-table :deep(td:nth-child(1)) { width: 120px; }
.sat-exam-results-table :deep(th:nth-child(2)), .sat-exam-results-table :deep(td:nth-child(2)) { width: 70px; }
.sat-exam-results-table :deep(th:nth-child(3)), .sat-exam-results-table :deep(td:nth-child(3)) { width: 90px; }
.sat-exam-results-table :deep(th:nth-child(4)), .sat-exam-results-table :deep(td:nth-child(4)) { width: 120px; }
.sat-exam-results-table :deep(th:nth-child(5)), .sat-exam-results-table :deep(td:nth-child(5)), .sat-exam-results-table :deep(th:nth-child(6)), .sat-exam-results-table :deep(td:nth-child(6)) { width: 92px; }
.sat-exam-results-table :deep(th:nth-child(7)), .sat-exam-results-table :deep(td:nth-child(7)) { width: 170px; }
.sat-exam-results-table :deep(th:nth-child(8)), .sat-exam-results-table :deep(td:nth-child(8)) { width: 125px; }
.sat-exam-results-table :deep(th:nth-child(9)), .sat-exam-results-table :deep(td:nth-child(9)) { width: 142px; white-space: normal; }
.sat-exam-results-table :deep(th:nth-child(10)), .sat-exam-results-table :deep(td:nth-child(10)) { width: 100px; }
.sat-exam-results-table :deep(.sat-exam-results-student) { white-space: normal; }
.sat-exam-results-table :deep(.sat-exam-results-student small) { margin-top: 2px; color: #91a0b5; font-size: 13px; }
.sat-exam-results-score-separator { color: #91a0b5; }
.sat-exam-results-module-scores { display: grid; grid-template-columns: repeat(2, 65px); justify-content: center; gap: 4px 12px; }
.sat-exam-results-module-scores span { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--color-text); font-variant-numeric: tabular-nums; }
.sat-exam-results-module-scores small { color: var(--color-muted); font-size: 11px; font-weight: 700; }
.sat-exam-results-status { display: inline-flex; border: 1px solid #dae2ed; border-radius: 999px; padding: 4px 9px; color: #5e6d84; background: #f5f7fa; font-size: 12px; font-weight: 700; }
.sat-exam-results-status.is-completed { border-color: #bfe9d5; color: #148052; background: #effaf4; }
.sat-exam-results-status.is-in-progress { border-color: #f2dfaa; color: #936815; background: #fff9e8; }
.sat-exam-results-no-rows { padding: 34px 12px !important; color: var(--color-muted); text-align: center !important; }
.sat-exam-results-empty, .sat-exam-results-error { border: 1px dashed var(--color-border); border-radius: 12px; padding: 25px; color: var(--color-muted); background: #fff; text-align: center; }
.sat-exam-results-error { border-style: solid; border-color: #f0c3c7; color: #9c303c; background: #fff5f5; }
@media (max-width: 900px) { .sat-exam-results-module-averages__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px) { .sat-exam-results-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sat-exam-results-module-averages__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sat-exam-results-heading { align-items: start; } .sat-exam-results-exam-info { grid-template-columns: 1fr 1fr; gap: 12px; } .sat-exam-results-exam-info__modules { grid-column: 1 / -1; } .sat-exam-results-toolbar { flex-wrap: wrap; } .sat-exam-results-scroll-hint { display: block; } }
</style>
