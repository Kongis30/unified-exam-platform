<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppCard from '@/components/AppCard.vue'
import AdminDataTable from '@/components/admin/AdminDataTable.vue'
import AdminActionMenu from '@/components/admin/AdminActionMenu.vue'
import AdminLayout from '@/components/admin/AdminLayout.vue'
import AppButton from '@/components/AppButton.vue'
import AppModal from '@/components/AppModal.vue'
import { authState } from '@/auth'
import { deleteSatStudentAttempt, getSatStudentScores } from '@/examTypes/sat/admin/api/studentScores'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref('')
const student = ref(null)
const scores = ref([])
const statistics = ref(null)
const scoreMode = ref(route.query.scoreMode === 'RAW' ? 'RAW' : 'SCALED')
const scoreTypeFilter = ref(['SAT', 'PSAT'].includes(route.query.scoreType) ? route.query.scoreType : 'SAT')
const deleteTarget = ref(null)
const deleteError = ref('')
const deletingAttemptId = ref(null)
const openActionMenuId = ref(null)
const notification = ref(null)
let notificationTimer = null
const isAdmin = computed(() => authState.user?.roleCode === 'ADMIN')

const completedScores = computed(() => scores.value.filter((row) => row.status === 'COMPLETED'))
const availableScoreTypes = computed(() => [...new Set(completedScores.value.map((row) => row.examTypeCode))])
const hasScaledScores = computed(() => completedScores.value
  .filter((row) => row.examTypeCode === scoreTypeFilter.value)
  .some((row) => row.totalScaledScore !== null && row.totalScaledScore !== undefined && Number.isFinite(Number(row.totalScaledScore))))
const chartRows = computed(() => completedScores.value
  .filter((row) => row.examTypeCode === scoreTypeFilter.value)
  .map((row) => ({ ...row, value: Number(scoreMode.value === 'SCALED' ? row.totalScaledScore : row.rawTotalScore) }))
  .filter((row) => (scoreMode.value === 'SCALED' ? row.totalScaledScore : row.rawTotalScore) !== null
    && (scoreMode.value === 'SCALED' ? row.totalScaledScore : row.rawTotalScore) !== undefined
    && Number.isFinite(row.value))
  .sort((left, right) => new Date(left.submittedAt || left.examDate) - new Date(right.submittedAt || right.examDate)))
const chartGeometry = computed(() => {
  const width = 1000
  const height = 280
  const pad = { left: 64, right: 28, top: 24, bottom: 52 }
  const values = chartRows.value.map((row) => row.value)
  const rawMin = values.length ? Math.min(...values) : 0
  const rawMax = values.length ? Math.max(...values) : 1
  const spread = Math.max(rawMax - rawMin, rawMax * 0.08, 10)
  const min = Math.max(0, rawMin - spread * 0.18)
  const max = rawMax + spread * 0.18
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const points = chartRows.value.map((row, index) => ({
    ...row,
    x: pad.left + (chartRows.value.length < 2 ? plotWidth / 2 : index * plotWidth / (chartRows.value.length - 1)),
    y: pad.top + (max - row.value) * plotHeight / (max - min || 1),
  }))
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = max - ((max - min) * index / 4)
    return { value: Math.round(value), y: pad.top + plotHeight * index / 4 }
  })
  return { width, height, pad, points, ticks, line: points.map((point) => `${point.x},${point.y}`).join(' ') }
})

function formatDate(value, withTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', withTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function displayScore(value, max = null) {
  if (value === null || value === undefined || value === '') return '—'
  const formatted = Number.isInteger(Number(value)) ? String(Number(value)) : Number(value).toFixed(1)
  return max ? `${formatted} / ${max}` : formatted
}

function goBack() {
  router.push({
    name: 'sat-class-detail',
    params: { classId: route.params.classId },
    query: typeof route.query.returnTo === 'string' ? { returnTo: route.query.returnTo } : {},
  })
}

function openReport(row) {
  router.push({
    name: 'sat-report',
    query: {
      examId: row.examId,
      recordId: row.attemptId,
      source: 'admin',
      returnTo: route.fullPath,
    },
  })
}

watch([scoreMode, scoreTypeFilter], () => {
  const query = {
    ...route.query,
    scoreMode: scoreMode.value === 'SCALED' ? undefined : scoreMode.value,
    scoreType: scoreTypeFilter.value === 'SAT' ? undefined : scoreTypeFilter.value,
  }
  if (JSON.stringify(query) !== JSON.stringify(route.query)) {
    router.replace({ name: 'sat-student-scores', params: route.params, query })
  }
})

function requestDeleteAttempt(row) {
  openActionMenuId.value = null
  deleteError.value = ''
  deleteTarget.value = row
}

function dismissNotification() {
  if (notificationTimer) window.clearTimeout(notificationTimer)
  notificationTimer = null
  notification.value = null
}

function showNotification(message, variant = 'success') {
  dismissNotification()
  notification.value = { message, variant }
  notificationTimer = window.setTimeout(dismissNotification, 4500)
}

async function deleteAttempt() {
  if (!deleteTarget.value || deletingAttemptId.value) return
  const attemptId = deleteTarget.value.attemptId
  deletingAttemptId.value = attemptId
  deleteError.value = ''
  try {
    await deleteSatStudentAttempt(route.params.studentId, attemptId)
    deleteTarget.value = null
    await loadScores()
    showNotification('Exam attempt and its answers were deleted.')
  } catch (requestError) {
    deleteError.value = requestError.message || 'Unable to delete this exam attempt.'
  } finally {
    deletingAttemptId.value = null
  }
}

async function loadScores() {
  loading.value = true
  error.value = ''
  try {
    const result = await getSatStudentScores(route.params.studentId)
    student.value = result.student
    scores.value = result.scores || []
    statistics.value = result.statistics || null
    if (!availableScoreTypes.value.includes(scoreTypeFilter.value)) {
      scoreTypeFilter.value = availableScoreTypes.value[0] || 'SAT'
    }
    if (!hasScaledScores.value) scoreMode.value = 'RAW'
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load this student’s score history.'
  } finally {
    loading.value = false
  }
}

watch(() => route.params.studentId, loadScores, { immediate: true })
onBeforeUnmount(dismissNotification)
</script>

<template>
  <AdminLayout>
    <main class="sat-student-scores-page">
      <Teleport to="body">
        <Transition name="sat-score-notification">
          <div v-if="notification" class="sat-score-notification" :class="`is-${notification.variant}`" role="status" aria-live="polite">
            <span aria-hidden="true">{{ notification.variant === 'success' ? '✓' : '!' }}</span>
            <p>{{ notification.message }}</p>
            <button type="button" aria-label="Dismiss notification" @click="dismissNotification">×</button>
          </div>
        </Transition>
      </Teleport>
      <button type="button" class="sat-student-scores-back" @click="goBack">← Back to {{ route.query.className || 'class' }}</button>

      <header class="sat-student-scores-heading">
        <div>
          <p class="sat-student-scores-eyebrow">STUDENT SCORE HISTORY</p>
          <h1>{{ student?.name || 'Student' }}</h1>
          <p class="sat-student-scores-subtitle">{{ student?.username || '' }}<span v-if="student?.classes"> · {{ student.classes }}</span></p>
        </div>
      </header>

      <p v-if="error" class="sat-student-scores-error" role="alert">{{ error }}</p>
      <div v-if="loading" class="sat-student-scores-loading">Loading score history…</div>
      <template v-else-if="statistics">
        <AppCard title="Score Statistics" subtitle="Completed attempts are summarized separately because SAT and PSAT use different score ranges.">
          <p class="sat-score-total">Completed attempts <strong>{{ statistics.totalAttempts }}</strong></p>
          <div class="sat-score-stat-types">
            <section v-for="type in ['SAT', 'PSAT']" :key="type" class="sat-score-stat-type">
              <h3>{{ type }}</h3>
              <div v-if="statistics[type.toLowerCase()]?.attempts" class="sat-score-stat-grid">
                <div><span>Attempts</span><strong>{{ statistics[type.toLowerCase()]?.attempts ?? 0 }}</strong></div>
                <div><span>Average raw</span><strong>{{ displayScore(statistics[type.toLowerCase()]?.averageRawScore) }}</strong></div>
                <div><span>Highest raw</span><strong>{{ displayScore(statistics[type.toLowerCase()]?.highestRawScore) }}</strong></div>
                <div><span>Lowest raw</span><strong>{{ displayScore(statistics[type.toLowerCase()]?.lowestRawScore) }}</strong></div>
                <div><span>Average scaled</span><strong>{{ displayScore(statistics[type.toLowerCase()]?.averageScaledScore) }}</strong></div>
                <div><span>Highest scaled</span><strong>{{ displayScore(statistics[type.toLowerCase()]?.highestScaledScore) }}</strong></div>
                <div><span>Lowest scaled</span><strong>{{ displayScore(statistics[type.toLowerCase()]?.lowestScaledScore) }}</strong></div>
                <div><span>Average R&amp;W scaled</span><strong>{{ displayScore(statistics[type.toLowerCase()]?.averageRwScaledScore) }}</strong></div>
                <div><span>Average Math scaled</span><strong>{{ displayScore(statistics[type.toLowerCase()]?.averageMathScaledScore) }}</strong></div>
              </div>
              <p v-else class="sat-score-stat-empty">No completed {{ type }} scores yet.</p>
            </section>
          </div>
        </AppCard>

        <AppCard title="Score Trend" subtitle="Scores shown from oldest to newest. Compare one exam type and score scale at a time.">
          <div class="sat-score-chart-toolbar">
            <label v-if="availableScoreTypes.length > 1" class="sat-score-type-select">Exam type
              <select v-model="scoreTypeFilter" aria-label="Score trend exam type">
                <option v-for="type in availableScoreTypes" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <div role="group" aria-label="Score trend scale">
            <button type="button" :class="{ active: scoreMode === 'SCALED' }" :disabled="!hasScaledScores" @click="scoreMode = 'SCALED'">Scaled score</button>
            <button type="button" :class="{ active: scoreMode === 'RAW' }" @click="scoreMode = 'RAW'">Raw score</button>
            </div>
          </div>
          <p v-if="chartGeometry.points.length" class="sat-score-chart-hint">Swipe horizontally to view all exam scores.</p>
          <div v-if="chartGeometry.points.length" class="sat-score-chart-wrap" tabindex="0" aria-label="Score trend chart. Scroll horizontally to view all exam scores.">
            <svg class="sat-score-chart" :viewBox="`0 0 ${chartGeometry.width} ${chartGeometry.height}`" role="img" :aria-label="`${scoreMode.toLowerCase()} score trend`">
              <g v-for="tick in chartGeometry.ticks" :key="tick.y">
                <line class="sat-score-chart__grid" :x1="chartGeometry.pad.left" :x2="chartGeometry.width - chartGeometry.pad.right" :y1="tick.y" :y2="tick.y" />
                <text class="sat-score-chart__label" :x="chartGeometry.pad.left - 12" :y="tick.y + 5" text-anchor="end">{{ tick.value }}</text>
              </g>
              <polyline v-if="chartGeometry.points.length > 1" class="sat-score-chart__line" :points="chartGeometry.line" />
              <g v-for="point in chartGeometry.points" :key="point.attemptId">
                <circle class="sat-score-chart__point" :cx="point.x" :cy="point.y" r="6"><title>{{ point.examTitle }}: {{ point.value }} · {{ formatDate(point.submittedAt || point.examDate) }}</title></circle>
                <text class="sat-score-chart__point-label" :x="point.x" :y="point.y - 12" text-anchor="middle">{{ point.value }}</text>
                <text class="sat-score-chart__label" :x="point.x" :y="chartGeometry.height - 16" text-anchor="middle">{{ formatDate(point.submittedAt || point.examDate).replace(/, \d{4}/, '') }}</text>
              </g>
            </svg>
          </div>
          <p v-else class="sat-score-empty">No completed score data is available yet.</p>
        </AppCard>

        <AppCard title="Score History" subtitle="Raw scores count correct answers. Scaled scores use the paper’s SAT or PSAT scoring table.">
          <div v-if="scores.length" class="sat-score-table-scroll" tabindex="0" aria-label="Score history table. Scroll horizontally to view all columns.">
            <p class="sat-score-table-hint">Swipe horizontally to view all score details.</p>
            <AdminDataTable class="sat-score-history-table">
              <thead><tr><th>Exam / Paper</th><th>Type</th><th>Status</th><th>Total Raw</th><th>Total Scaled</th><th>R&amp;W Raw / Scaled</th><th>Math Raw / Scaled</th><th>Module Scaled</th><th>Submitted</th><th>Actions</th></tr></thead>
              <tbody>
                <tr v-for="row in scores" :key="row.attemptId">
                  <td class="sat-score-history-table__exam"><strong>{{ row.examTitle }}</strong><small>{{ row.paperTitle }}</small></td>
                  <td><span class="sat-score-type">{{ row.examTypeCode }}</span></td>
                  <td><span class="sat-score-status" :class="{ 'is-complete': row.status === 'COMPLETED' }">{{ row.status === 'COMPLETED' ? 'Completed' : 'In progress' }}</span></td>
                  <td>{{ displayScore(row.rawTotalScore, row.rawMaxScore) }}</td>
                  <td>{{ displayScore(row.totalScaledScore, row.scaledMaxScore) }}</td>
                  <td>{{ displayScore(row.rwRawScore) }} <small>/</small> {{ displayScore(row.rwScaledScore) }}</td>
                  <td>{{ displayScore(row.mathRawScore) }} <small>/</small> {{ displayScore(row.mathScaledScore) }}</td>
                  <td><div class="sat-score-module-grid"><span><small>RW1</small>{{ displayScore(row.rw1ScaledScore) }}</span><span><small>RW2</small>{{ displayScore(row.rw2ScaledScore) }}</span><span><small>M1</small>{{ displayScore(row.math1ScaledScore) }}</span><span><small>M2</small>{{ displayScore(row.math2ScaledScore) }}</span></div></td>
                  <td>{{ formatDate(row.submittedAt, true) }}</td>
                  <td>
                    <div class="sat-score-actions">
                      <button v-if="row.status === 'COMPLETED'" type="button" class="sat-score-report-button" @click="openReport(row)">View report</button>
                      <AdminActionMenu
                        v-if="isAdmin"
                        :open="openActionMenuId === row.attemptId"
                        :label="`Actions for ${row.examTitle}`"
                        @update:open="openActionMenuId = $event ? row.attemptId : null"
                      >
                        <button type="button" class="admin-action-menu__danger" @click="requestDeleteAttempt(row)">Delete attempt</button>
                      </AdminActionMenu>
                      <span v-if="row.status !== 'COMPLETED' && !isAdmin">—</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </AdminDataTable>
          </div>
          <p v-else class="sat-score-empty">No SAT or PSAT attempts have been recorded for this student.</p>
        </AppCard>
      </template>
    </main>
    <AppModal
      v-if="deleteTarget"
      title="Delete exam attempt?"
      description="This permanently removes the selected SAT/PSAT attempt and its associated answers, score, and report. It also frees one attempt for the student."
      eyebrow="STUDENT SCORE HISTORY"
      width="520px"
      :busy="Boolean(deletingAttemptId)"
      @close="deleteTarget = null"
    >
      <div class="sat-score-delete-summary">
        <strong>{{ deleteTarget.examTitle }}</strong>
        <span>{{ deleteTarget.paperTitle }} · Attempt {{ deleteTarget.attemptNumber }}</span>
      </div>
      <p v-if="deleteError" class="sat-score-delete-error" role="alert">{{ deleteError }}</p>
      <template #footer>
        <AppButton variant="secondary" :disabled="Boolean(deletingAttemptId)" @click="deleteTarget = null">Cancel</AppButton>
        <AppButton variant="danger" :disabled="Boolean(deletingAttemptId)" @click="deleteAttempt">
          {{ deletingAttemptId ? 'Deleting…' : 'Delete attempt' }}
        </AppButton>
      </template>
    </AppModal>
  </AdminLayout>
</template>

<style scoped>
.sat-student-scores-page { display: grid; gap: 18px; width: min(100%, 1180px); margin: 0 auto; padding: 8px 0 48px; }
.sat-student-scores-back { justify-self: start; border: 0; padding: 4px 0; color: var(--color-muted); background: transparent; font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
.sat-student-scores-back:hover { color: var(--color-primary-strong); }
.sat-student-scores-heading { display: flex; align-items: end; justify-content: space-between; padding: 8px 0 4px; }
.sat-student-scores-heading h1 { margin: 4px 0 0; color: var(--color-text); font-size: clamp(26px, 4vw, 34px); letter-spacing: -.03em; }
.sat-student-scores-eyebrow { margin: 0; color: var(--color-primary); font-size: 12px; font-weight: 800; letter-spacing: .12em; }
.sat-student-scores-subtitle { margin: 8px 0 0; color: var(--color-muted); font-size: 14px; }
.sat-student-scores-error { margin: 0; border: 1px solid #f0c3c7; border-radius: 12px; padding: 12px 16px; color: #9c303c; background: #fff5f5; }
.sat-student-scores-loading, .sat-score-empty { margin: 0; border: 1px dashed var(--color-border); border-radius: 12px; padding: 32px 16px; color: var(--color-muted); background: rgba(255,255,255,.65); text-align: center; }
.sat-score-total { display: flex; align-items: center; justify-content: space-between; margin: 0 0 12px; color: var(--color-muted); font-size: 14px; }
.sat-score-total strong { color: var(--color-text); font-size: 18px; }
.sat-score-stat-types { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.sat-score-stat-type { min-width: 0; border: 1px solid var(--color-border); border-radius: 12px; padding: 14px; background: #fbfdff; }
.sat-score-stat-type h3 { margin: 0 0 12px; color: var(--color-text); font-size: 15px; }
.sat-score-stat-empty { margin: 0; border: 1px dashed var(--color-border); border-radius: 10px; padding: 20px 14px; color: var(--color-muted); background: #fff; font-size: 13px; text-align: center; }
.sat-score-stat-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.sat-score-stat-grid > div { display: grid; gap: 8px; min-height: 82px; align-content: center; border: 1px solid var(--color-border); border-radius: 12px; padding: 12px 14px; background: #fbfdff; }
.sat-score-stat-grid span { color: var(--color-muted); font-size: 13px; font-weight: 650; }
.sat-score-stat-grid strong { color: var(--color-text); font-size: 23px; line-height: 1.1; }
.sat-score-chart-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin: -4px 0 12px; }
.sat-score-chart-toolbar > div { display: flex; gap: 4px; }
.sat-score-type-select { display: flex; align-items: center; gap: 8px; color: var(--color-muted); font-size: 13px; font-weight: 650; }
.sat-score-type-select select { min-height: 34px; border: 1px solid var(--color-border); border-radius: 9px; padding: 0 28px 0 10px; color: var(--color-text); background: #fff; font: inherit; }
.sat-score-chart-toolbar button { border: 1px solid var(--color-border); border-radius: 999px; padding: 7px 12px; color: var(--color-muted); background: white; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
.sat-score-chart-toolbar button.active { border-color: transparent; color: var(--color-primary-strong); background: var(--color-primary-soft); }
.sat-score-chart-toolbar button:disabled { opacity: .45; cursor: not-allowed; }
.sat-score-chart-hint { display: none; }
.sat-score-chart-wrap { overflow-x: auto; border: 1px solid var(--color-border); border-radius: 12px; padding: 12px 14px 4px; background: #fbfdff; }
.sat-score-chart { display: block; width: 100%; min-width: 620px; height: auto; }
.sat-score-chart__grid { stroke: #dce6f5; stroke-width: 1; }
.sat-score-chart__label { fill: #657795; font: 13px Inter, ui-sans-serif, system-ui, sans-serif; }
.sat-score-chart__line { fill: none; stroke: var(--color-primary); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.sat-score-chart__point { fill: var(--color-primary); stroke: white; stroke-width: 3; }
.sat-score-chart__point-label { fill: #1d2b43; font: 700 14px Inter, ui-sans-serif, system-ui, sans-serif; }
.sat-score-table-scroll { overflow-x: auto; }
.sat-score-table-hint { display: none; }
.sat-score-history-table { width: 100%; min-width: 1100px; table-layout: fixed; }
.sat-score-history-table :deep(th:nth-child(1)) { width: 15%; }
.sat-score-history-table :deep(th:nth-child(2)) { width: 5.5%; }
.sat-score-history-table :deep(th:nth-child(3)) { width: 7.5%; }
.sat-score-history-table :deep(th:nth-child(4)) { width: 7.5%; }
.sat-score-history-table :deep(th:nth-child(5)) { width: 8%; }
.sat-score-history-table :deep(th:nth-child(6)), .sat-score-history-table :deep(th:nth-child(7)) { width: 8%; }
.sat-score-history-table :deep(th:nth-child(8)) { width: 14%; }
.sat-score-history-table :deep(th:nth-child(9)) { width: 10%; }
.sat-score-history-table :deep(th:nth-child(10)) { width: 16.5%; }
.sat-score-module-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 6px; min-width: 110px; font-variant-numeric: tabular-nums; }
.sat-score-module-grid span { display: grid; justify-items: center; gap: 2px; border-radius: 6px; padding: 4px 3px; color: var(--color-text); background: #f5f8fd; font-weight: 700; line-height: 1.1; }
.sat-score-module-grid small { color: var(--color-muted); font-size: 10px; font-weight: 700; }
.sat-score-history-table :deep(th), .sat-score-history-table :deep(td) { padding: 12px 10px; text-align: center; }
.sat-score-history-table :deep(th:first-child), .sat-score-history-table :deep(td:first-child) { text-align: left; }
.sat-score-history-table__exam { min-width: 0; }
.sat-score-history-table__exam small { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sat-score-history-table td small { display: inline; color: #91a0b5; }
.sat-score-actions { display: flex; align-items: center; justify-content: center; gap: 8px; }
.sat-score-report-button { border: 1px solid var(--color-border); border-radius: 999px; padding: 7px 11px; color: var(--color-primary-strong); background: #fff; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; white-space: nowrap; }
.sat-score-report-button:hover { border-color: var(--color-primary); background: var(--color-primary-soft); }
.sat-score-delete-summary { display: grid; gap: 5px; border: 1px solid var(--color-border); border-radius: 12px; padding: 14px 16px; background: #f8faff; }
.sat-score-delete-summary strong { color: var(--color-text); font-size: 15px; }
.sat-score-delete-summary span { color: var(--color-muted); font-size: 13px; }
.sat-score-delete-error { margin: 12px 0 0; color: #b42318; font-size: 13px; }
.sat-score-notification { position: fixed; z-index: 1200; top: 82px; right: 24px; display: flex; width: min(380px, calc(100vw - 32px)); align-items: center; gap: 12px; border: 1px solid var(--color-border); border-radius: 14px; padding: 13px 12px 13px 14px; background: #fff; color: var(--color-text); box-shadow: 0 16px 40px rgb(18 36 64 / 16%); }
.sat-score-notification.is-success { border-color: #bbf7d0; }
.sat-score-notification.is-error { border-color: #fecaca; }
.sat-score-notification > span { display: grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #e9f8ef; color: #16804a; font-size: 16px; font-weight: 800; }
.sat-score-notification.is-error > span { background: #fff1f1; color: #b42318; }
.sat-score-notification p { margin: 0; color: var(--color-text); font-size: 14px; line-height: 1.45; }
.sat-score-notification button { width: 28px; height: 28px; flex: 0 0 auto; margin-left: auto; border: 0; border-radius: 50%; background: transparent; color: var(--color-muted); cursor: pointer; font-size: 20px; line-height: 1; }
.sat-score-notification button:hover { background: #f1f5f9; color: var(--color-text); }
.sat-score-notification-enter-active, .sat-score-notification-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.sat-score-notification-enter-from, .sat-score-notification-leave-to { opacity: 0; transform: translateY(-8px); }
.sat-score-type, .sat-score-status { display: inline-flex; align-items: center; border: 1px solid #d9e5fa; border-radius: 999px; padding: 4px 9px; color: #315a9a; background: #f2f7ff; font-size: 12px; font-weight: 700; }
.sat-score-status { border-color: #dce3ed; color: #6a7890; background: #f6f8fb; }
.sat-score-status.is-complete { border-color: #bfe9d5; color: #148052; background: #effaf4; }
@media (max-width: 1100px) { .sat-score-table-hint { display: block; margin: 0 0 8px; color: var(--color-muted); font-size: 12px; text-align: right; } .sat-score-table-scroll { scrollbar-color: #b9c9e2 #edf3fb; scrollbar-width: thin; } }
@media (max-width: 1000px) { .sat-score-stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) { .sat-student-scores-page { padding-top: 0; } .sat-score-stat-types { grid-template-columns: 1fr; } .sat-score-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sat-score-stat-grid strong { font-size: 20px; } .sat-score-chart-toolbar { justify-content: space-between; } .sat-score-chart-hint { display: block; margin: -4px 0 8px; color: var(--color-muted); font-size: 12px; text-align: right; } .sat-score-chart-wrap { scrollbar-color: #b9c9e2 #edf3fb; scrollbar-width: thin; } }
@media (max-width: 640px) { .sat-score-notification { top: 74px; right: 12px; } }
</style>
