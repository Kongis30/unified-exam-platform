<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import { adminApi } from '@shsat/admin/services/adminApi';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const errorMessage = ref('');
const attempts = ref([]);
const hoveredTrendPoint = ref(null);
const historySort = ref({ key: null, direction: 'desc' });
const SHSAT_SECTION_RAW_MAX = 50;
const SHSAT_TOTAL_RAW_MAX = SHSAT_SECTION_RAW_MAX * 2;

const classId = computed(() => route.params.classId);
const studentId = computed(() => route.params.studentId);

// Basic student info is passed through the route query from the class detail list.
const studentInfo = computed(() => ({
  studentName: route.query.studentName || `Student #${studentId.value}`,
  studentNumber: route.query.studentNumber || '',
  className: route.query.className || '',
}));

const backLabel = computed(() => route.query.returnLabel || 'Back to Class Detail');

function unwrapResponse(response, fallbackMessage) {
  if (response?.success === false) {
    throw new Error(response.message || fallbackMessage);
  }

  const payload = response?.data ?? response;

  if (Array.isArray(payload)) {
    return payload;
  }

  return payload?.items || payload?.records || payload?.list || payload?.content || [];
}

async function loadHistory() {
  loading.value = true;
  errorMessage.value = '';
  hoveredTrendPoint.value = null;

  try {
    const records = unwrapResponse(
      await adminApi.getStudentAttemptHistory(studentId.value, classId.value),
      'Failed to load student exam history'
    );
    attempts.value = [...records].sort((left, right) => {
      return getTimeValue(right.submittedAt) - getTimeValue(left.submittedAt);
    });
  } catch (error) {
    errorMessage.value = error.message || 'Failed to load student exam history. Please try again later.';
  } finally {
    loading.value = false;
  }
}

function goBack() {
  if (typeof route.query.returnTo === 'string' && route.query.returnTo) {
    router.push(route.query.returnTo);
    return;
  }

  router.push({
    name: 'admin-class-detail',
    params: { classId: classId.value },
  });
}

function isCompleted(attempt) {
  return String(attempt.status || '').toUpperCase() === 'COMPLETED';
}

function canOpenAttemptReport(attempt) {
  if (!attempt?.attemptId) {
    return false;
  }

  return attempt.reportVisible === true
    || attempt.scoreVisible === true
    || attempt.answersVisible === true
    || isCompleted(attempt);
}

function getAttemptReportUnavailableReason(attempt) {
  if (!attempt?.attemptId) {
    return 'Report is unavailable for this attempt.';
  }

  if (!isCompleted(attempt)) {
    return 'Report is available after the attempt is completed.';
  }

  return 'Report is unavailable for this attempt.';
}

function openAttemptReport(attempt) {
  if (!canOpenAttemptReport(attempt)) {
    return;
  }

  router.push({
    name: 'student-attempt-report',
    params: { attemptId: attempt.attemptId },
    query: {
      adminReport: '1',
      returnTo: route.fullPath,
      returnLabel: 'Back to Student Detail',
    },
  });
}

function getAvailableScore(attempt) {
  return numberOrNull(hasScaledScoring(attempt)
    ? attempt.compositeScore ?? attempt.totalScaledScore
    : attempt.rawTotalScore ?? attempt.totalScore);
}

function getAvailableScoreMax(attempt) {
  const value = hasScaledScoring(attempt)
    ? Number(attempt.compositeMaxScore)
    : Number(attempt.rawTotalMaxScore ?? attempt.totalRawMaxScore ?? SHSAT_TOTAL_RAW_MAX);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const completedAttempts = computed(() => attempts.value.filter(isCompleted));

const displayedAttempts = computed(() => {
  const { key, direction } = historySort.value;
  if (!key) return attempts.value;

  return [...attempts.value].sort((left, right) => {
    const leftScore = getSortableScore(left, key);
    const rightScore = getSortableScore(right, key);
    if (leftScore === null && rightScore !== null) return 1;
    if (leftScore !== null && rightScore === null) return -1;
    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) {
      return direction === 'asc' ? leftScore - rightScore : rightScore - leftScore;
    }
    return getTimeValue(right.submittedAt) - getTimeValue(left.submittedAt);
  });
});

const stats = computed(() => {
  const scores = completedAttempts.value
    .map(getAvailableScore)
    .filter((value) => value !== null);

  if (scores.length === 0) {
    return {
      total: attempts.value.length,
      completed: completedAttempts.value.length,
      average: '-',
      highest: '-',
    };
  }

  const total = scores.reduce((sum, score) => sum + score, 0);

  return {
    total: attempts.value.length,
    completed: completedAttempts.value.length,
    average: Math.round(total / scores.length),
    highest: Math.max(...scores),
  };
});

// 按原 SHSAT 图表的口径展示可用总分，并以实际最小值和最大值确定纵轴范围。
const chart = computed(() => {
  const rows = completedAttempts.value
    .map((attempt) => ({
      id: attempt.attemptId,
      score: getAvailableScore(attempt),
      scoreMax: getAvailableScoreMax(attempt),
      scoreLabel: hasScaledScoring(attempt) ? 'Scaled score' : 'Raw score',
      date: attempt.submittedAt || attempt.startedAt,
      title: attempt.examTitle || 'Exam',
    }))
    .filter((item) => item.score !== null && item.date && getTimeValue(item.date))
    .sort((left, right) => getTimeValue(left.date) - getTimeValue(right.date));
  const width = Math.max(760, 72 * (rows.length - 1) + 72);
  const height = 320;
  const padding = { top: 28, right: 24, bottom: 48, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  let min = Math.floor(Math.min(...rows.map((row) => row.score)));
  let max = Math.ceil(Math.max(...rows.map((row) => row.score)));
  if (!rows.length) min = max = 0;
  if (min === max) {
    min = Math.max(0, min - 1);
    max += 1;
  }
  const range = max - min;
  const points = rows.map((row, index) => ({
    ...row,
    x: padding.left + (rows.length > 1 ? innerWidth * index / (rows.length - 1) : innerWidth / 2),
    y: padding.top + innerHeight - (row.score - min) / range * innerHeight,
  }));
  const tickCount = Math.min(6, range + 1);
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const value = Math.round(min + range * index / (tickCount - 1));
    return { value, y: padding.top + innerHeight - (value - min) / range * innerHeight };
  });
  return {
    width, height, padding, points, ticks,
    baseline: padding.top + innerHeight,
    line: points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
  };
});

function getTimeValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDateTime(value) {
  if (!value) {
    return 'Not submitted';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).replace('T', ' ');
  }

  return new Intl.DateTimeFormat('en-US', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatScore(value) {
  return value === null || value === undefined || value === '' || value === '-' ? '-' : Number(value).toString();
}

function getScaledScore(attempt) {
  if (!hasScaledScoring(attempt)) {
    return null;
  }

  const value = Number(attempt.compositeScore ?? attempt.totalScaledScore);
  return Number.isFinite(value) ? value : null;
}

function formatScaledScore(attempt) {
  const score = getScaledScore(attempt);
  if (score === null) {
    return '—';
  }

  const maxScore = getAvailableScoreMax(attempt);
  return maxScore ? `${formatScore(score)} / ${formatScore(maxScore)}` : formatScore(score);
}

function formatRawScore(attempt) {
  return formatScoreWithMax(attempt.rawTotalScore ?? attempt.totalScore,
    attempt.rawTotalMaxScore ?? attempt.totalRawMaxScore ?? SHSAT_TOTAL_RAW_MAX);
}

function getSectionRawScore(attempt, sectionCode) {
  const value = sectionCode === 'ELA'
    ? attempt.elaRawScore ?? attempt.section1Score
    : attempt.mathRawScore ?? attempt.section2Score;
  const maxScore = sectionCode === 'ELA'
    ? attempt.elaRawMaxScore ?? SHSAT_SECTION_RAW_MAX
    : attempt.mathRawMaxScore ?? SHSAT_SECTION_RAW_MAX;
  return formatScoreWithMax(value, maxScore);
}

function getSectionScaledScore(attempt, sectionCode) {
  const value = sectionCode === 'ELA'
    ? attempt.elaScaledScore ?? attempt.section1ScaledScore
    : attempt.mathScaledScore ?? attempt.section2ScaledScore;
  return value === null || value === undefined || value === '' ? null : formatScore(value);
}

function hasScaledScores(attempt) {
  return getScaledScore(attempt) !== null
    || getSectionScaledScore(attempt, 'ELA') !== null
    || getSectionScaledScore(attempt, 'MATH') !== null;
}

function formatSectionBreakdown(attempt, mode) {
  const getValue = mode === 'SCALED'
    ? (section) => getSectionScaledScore(attempt, section) ?? '—'
    : (section) => getSectionRawScore(attempt, section);
  return `ELA ${getValue('ELA')} · Math ${getValue('MATH')}`;
}

function formatScoreWithMax(value, maxScore) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  return `${formatScore(value)} / ${formatScore(maxScore)}`;
}

function formatAttemptMeta(attempt) {
  const parts = [];

  if (attempt.attemptNumber !== null && attempt.attemptNumber !== undefined && attempt.attemptNumber !== '') {
    parts.push(`Attempt #${attempt.attemptNumber}`);
  }

  if (isLatestAttempt(attempt)) {
    parts.push('Latest');
  }

  return parts;
}

function isLatestAttempt(attempt) {
  return attempt?.attemptId != null
    && String(attempt.attemptId) === String(attempts.value[0]?.attemptId);
}

function getSortableScore(attempt, key) {
  return key === 'raw'
    ? numberOrNull(attempt.rawTotalScore ?? attempt.totalScore)
    : getScaledScore(attempt);
}

function toggleHistorySort(key) {
  if (historySort.value.key === key) {
    historySort.value.direction = historySort.value.direction === 'desc' ? 'asc' : 'desc';
    return;
  }

  historySort.value = { key, direction: 'desc' };
}

function getSortDirection(key) {
  return historySort.value.key === key ? historySort.value.direction : 'none';
}

function getSortIndicator(key) {
  if (historySort.value.key !== key) return '↕';
  return historySort.value.direction === 'asc' ? '↑' : '↓';
}

function needsAttention(attempt) {
  return isCompleted(attempt) && Number(attempt.accuracy) === 0;
}

function isRawOnly(attempt) {
  return attempt?.scoringMode === 'RAW_ONLY';
}

function hasScaledScoring(attempt) {
  return !isRawOnly(attempt) && (attempt?.compositeScore ?? attempt?.totalScaledScore) !== null
    && (attempt?.compositeScore ?? attempt?.totalScaledScore) !== undefined;
}

function formatStatus(status) {
  const text = String(status || '').toUpperCase();
  const labels = {
    COMPLETED: 'Completed',
    SUBMITTED: 'Submitted',
    IN_PROGRESS: 'In Progress',
    EXPIRED: 'Expired',
  };
  return labels[text] || status || '-';
}

onMounted(loadHistory);
</script>

<template>

    <section class="page-shell student-detail">
      <div class="student-detail__hero">
        <div>
          <p class="student-detail__eyebrow">Student Detail</p>
          <h1 class="page-title">{{ studentInfo.studentName }}</h1>
          <p class="page-subtitle">
            <span v-if="studentInfo.className">Class: {{ studentInfo.className }}</span>
            <span v-if="studentInfo.studentNumber"> · No. {{ studentInfo.studentNumber }}</span>
          </p>
        </div>
        <div class="student-detail__actions">
          <button
            class="icon-refresh-button"
            :class="{ 'icon-refresh-button--loading': loading }"
            type="button"
            :disabled="loading"
            aria-label="Refresh history"
            title="Refresh history"
            @click="loadHistory"
          >
            <svg class="icon-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" />
            </svg>
          </button>
          <AppButton variant="ghost" @click="goBack">{{ backLabel }}</AppButton>
        </div>
      </div>

      <AppCard v-if="loading" title="Loading History">
        <div class="student-detail__state">
          <span class="student-detail__spinner" aria-hidden="true"></span>
          <p class="status-note">Loading the student's exam history...</p>
        </div>
      </AppCard>

      <AppCard v-else-if="errorMessage" title="Unable to Load History">
        <div class="student-detail__state student-detail__state--error">
          <p class="error-text">{{ errorMessage }}</p>
          <AppButton variant="secondary" @click="loadHistory">Retry</AppButton>
        </div>
      </AppCard>

      <template v-else>
        <AppCard title="Score Statistics" subtitle="Attempt counts include all statuses; score metrics use completed attempts only.">
          <dl class="summary-grid">
            <div>
              <dt>Total Attempts</dt>
              <dd>{{ stats.total }}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{{ stats.completed }}</dd>
            </div>
            <div>
              <dt>Average Score</dt>
              <dd>{{ formatScore(stats.average) }}</dd>
            </div>
            <div>
              <dt>Highest Score</dt>
              <dd>{{ formatScore(stats.highest) }}</dd>
            </div>
          </dl>
        </AppCard>

        <AppCard title="Score Trend" subtitle="Available score over time, ordered from earliest to latest.">
          <div v-if="!chart.points.length" class="student-detail__empty">No completed attempts to chart yet.</div>
          <template v-else>
          <p class="score-chart-scroll-hint">Swipe horizontally to view all scores.</p>
          <div class="score-chart-scroll" tabindex="0" aria-label="Score trend chart">
            <div class="score-chart-frame" :style="{ minWidth: `${chart.width}px` }">
              <svg class="score-chart" :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" aria-label="Score trend over time">
                <g class="chart-grid">
                  <line v-for="tick in chart.ticks" :key="`line-${tick.value}`" :x1="chart.padding.left" :x2="chart.width - chart.padding.right" :y1="tick.y" :y2="tick.y" />
                  <text v-for="tick in chart.ticks" :key="`tick-${tick.value}`" class="chart-axis-label" :x="chart.padding.left - 10" :y="tick.y" text-anchor="end" dominant-baseline="middle">{{ tick.value }}</text>
                </g>
                <path v-if="chart.points.length > 1" class="chart-line" :d="chart.line" />
                <g v-for="point in chart.points" :key="point.id" class="chart-point-group" tabindex="0" role="img"
                  :aria-label="`${point.title}, ${formatDateTime(point.date)}, ${point.scoreLabel} ${formatScore(point.score)}`"
                  @mouseenter="hoveredTrendPoint = point" @mouseleave="hoveredTrendPoint = null"
                  @focus="hoveredTrendPoint = point" @blur="hoveredTrendPoint = null">
                  <circle :cx="point.x" :cy="point.y" r="12" class="chart-point-hit" />
                  <circle :cx="point.x" :cy="point.y" r="5" class="chart-point" />
                  <text class="chart-point-value" :x="point.x" :y="point.y - 12" text-anchor="middle">{{ formatScore(point.score) }}</text>
                  <text class="chart-axis-label" :x="point.x" :y="chart.baseline + 18" text-anchor="middle">{{ formatShortDate(point.date) }}</text>
                </g>
              </svg>
              <div v-if="hoveredTrendPoint" class="score-chart-tooltip" role="tooltip"
                :class="{ 'is-below': hoveredTrendPoint.y < 75, 'is-left': hoveredTrendPoint.x > chart.width * 0.75, 'is-right': hoveredTrendPoint.x < chart.width * 0.25 }"
                :style="{ left: `${hoveredTrendPoint.x / chart.width * 100}%`, top: `${hoveredTrendPoint.y / chart.height * 100}%` }">
                <strong>{{ hoveredTrendPoint.title }}</strong>
                <span>{{ formatDateTime(hoveredTrendPoint.date) }}</span>
                <span>{{ hoveredTrendPoint.scoreLabel }}: {{ formatScore(hoveredTrendPoint.score) }}<template v-if="hoveredTrendPoint.scoreMax"> / {{ formatScore(hoveredTrendPoint.scoreMax) }}</template></span>
              </div>
            </div>
          </div>
          </template>
        </AppCard>

        <AppCard title="Score History" subtitle="All exam attempts, latest first.">
          <div v-if="attempts.length === 0" class="student-detail__empty">
            This student has no exam attempts yet.
          </div>
          <div v-else class="history-panel">
            <div class="table-wrap history-table-wrap">
              <table class="history-table">
                <colgroup>
                  <col class="history-column--exam">
                  <col class="history-column--status">
                  <col class="history-column--raw">
                  <col class="history-column--scaled">
                  <col class="history-column--submitted">
                  <col class="history-column--actions">
                </colgroup>
                <thead>
                  <tr>
                    <th>Exam</th>
                    <th>Status</th>
                    <th :aria-sort="getSortDirection('raw')">
                      <button class="history-sort-button" type="button" @click="toggleHistorySort('raw')">
                        Raw Score <span aria-hidden="true">{{ getSortIndicator('raw') }}</span>
                      </button>
                    </th>
                    <th :aria-sort="getSortDirection('scaled')">
                      <button class="history-sort-button" type="button" @click="toggleHistorySort('scaled')">
                        Scaled Score <span aria-hidden="true">{{ getSortIndicator('scaled') }}</span>
                      </button>
                    </th>
                    <th>Submitted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="attempt in displayedAttempts"
                    :key="attempt.attemptId"
                    :class="{
                      'history-table__row--latest': isLatestAttempt(attempt),
                      'history-table__row--attention': needsAttention(attempt),
                    }"
                  >
                    <td class="history-table__exam-cell" data-label="Exam">
                      <span class="history-exam">{{ attempt.examTitle || 'Exam' }}</span>
                      <span v-if="attempt.paperName" class="history-paper">{{ attempt.paperName }}</span>
                      <div class="history-meta">
                        <span
                          v-for="item in formatAttemptMeta(attempt)"
                          :key="`${attempt.attemptId}-${item}`"
                          class="history-meta__item"
                          :class="{ 'history-meta__item--latest': item === 'Latest' }"
                        >
                          {{ item }}
                        </span>
                      </div>
                    </td>
                    <td data-label="Status">
                      <span
                        class="status-pill"
                        :class="{ 'status-pill--done': isCompleted(attempt) }"
                      >
                        {{ formatStatus(attempt.status) }}
                      </span>
                    </td>
                    <td data-label="Raw score">
                      <div class="history-score-summary">
                        <strong>{{ formatRawScore(attempt) }}</strong>
                        <span>{{ formatSectionBreakdown(attempt, 'RAW') }}</span>
                      </div>
                    </td>
                    <td data-label="Scaled score">
                      <div v-if="hasScaledScores(attempt)" class="history-score-summary">
                        <strong>{{ getScaledScore(attempt) === null ? 'Total unavailable' : formatScaledScore(attempt) }}</strong>
                        <span>{{ formatSectionBreakdown(attempt, 'SCALED') }}</span>
                      </div>
                      <span v-else class="history-score-unavailable">—</span>
                    </td>
                    <td data-label="Submitted">
                      <span class="history-submitted">{{ formatDateTime(attempt.submittedAt) }}</span>
                    </td>
                    <td class="history-table__actions-cell" data-label="Actions">
                      <AppButton
                        v-if="canOpenAttemptReport(attempt)"
                        class="history-report-button"
                        variant="secondary"
                        :title="`View report for ${attempt.examTitle || 'this exam'}`"
                        @click="openAttemptReport(attempt)"
                      >
                        View Report
                      </AppButton>
                      <span
                        v-else
                        class="history-report-unavailable"
                        :title="getAttemptReportUnavailableReason(attempt)"
                      >
                        {{ getAttemptReportUnavailableReason(attempt) }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </AppCard>
      </template>
    </section>

</template>

<style scoped>
.student-detail {
  display: grid;
  max-width: 1120px;
  gap: 18px;
}

.student-detail :deep(.app-card) { padding: 22px; }
.student-detail :deep(.app-card__header) { margin-bottom: 14px; }

.student-detail__hero,
.student-detail__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.student-detail__actions {
  flex: 0 0 auto;
  gap: 8px;
}

.icon-refresh-button {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid #cfe0ff;
  border-radius: 50%;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  cursor: pointer;
}

.icon-refresh-button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.icon-refresh-button__icon {
  width: 18px;
  height: 18px;
}

.icon-refresh-button--loading .icon-refresh-button__icon {
  animation: spin 900ms linear infinite;
}

.student-detail__eyebrow {
  margin: 0 0 8px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.student-detail__state {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 32px;
  text-align: center;
}

.student-detail__state--error {
  justify-items: start;
  text-align: left;
}

.student-detail__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-primary-soft);
  border-top-color: var(--color-primary);
  border-radius: 999px;
  animation: spin 800ms linear infinite;
}

.student-detail__empty {
  padding: 24px;
  color: var(--color-muted);
  text-align: center;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.summary-grid div {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 11px 14px;
  background: #ffffff;
}

.summary-grid dt {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.summary-grid dd {
  margin: 6px 0 0;
  color: var(--color-text);
  font-size: 20px;
  font-weight: 700;
}

.score-chart-scroll-hint { display: none; margin: 0 0 8px; color: var(--color-muted); font-size: 12px; }
.score-chart-scroll { max-width: 100%; overflow-x: auto; }
.score-chart-frame { position: relative; width: 100%; }
.score-chart { display: block; width: 100%; height: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: #fbfdff; }
.chart-grid line { stroke: var(--color-border); stroke-width: 1; }
.chart-axis-label { fill: var(--color-muted); font-size: 11px; }
.chart-line { fill: none; stroke: var(--color-primary); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
.chart-point-hit { fill: transparent; cursor: pointer; }
.chart-point { fill: var(--color-primary); stroke: #fff; stroke-width: 2; pointer-events: none; }
.chart-point-value { fill: var(--color-text); font-size: 12px; font-weight: 700; pointer-events: none; }
.chart-point-group:focus { outline: none; }
.chart-point-group:focus-visible .chart-point { stroke: #173f91; stroke-width: 3; }
.score-chart-tooltip { position: absolute; z-index: 2; display: grid; gap: 4px; min-width: 150px; max-width: 240px; border: 1px solid var(--color-border); border-radius: 8px; padding: 9px 11px; color: var(--color-text); background: #fff; box-shadow: 0 8px 24px rgba(23, 32, 51, .14); font-size: 12px; line-height: 1.4; pointer-events: none; transform: translate(-50%, calc(-100% - 10px)); }
.score-chart-tooltip span { color: var(--color-muted); }
.score-chart-tooltip.is-below { transform: translate(-50%, 12px); }
.score-chart-tooltip.is-left { transform: translate(calc(-100% + 10px), calc(-100% - 10px)); }
.score-chart-tooltip.is-right { transform: translate(-10px, calc(-100% - 10px)); }
.score-chart-tooltip.is-left.is-below { transform: translate(calc(-100% + 10px), 12px); }
.score-chart-tooltip.is-right.is-below { transform: translate(-10px, 12px); }

.table-wrap {
  overflow-x: auto;
}

.history-panel {
  min-width: 0;
}

.history-table-wrap {
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: #ffffff;
}

.history-table {
  width: 100%;
  min-width: 940px;
  border-collapse: collapse;
  table-layout: fixed;
}

.history-column--exam { width: 29%; }
.history-column--status { width: 10%; }
.history-column--raw { width: 21%; }
.history-column--scaled { width: 17%; }
.history-column--submitted { width: 12%; }
.history-column--actions { width: 11%; }

.history-table th,
.history-table td {
  border-bottom: 1px solid var(--color-border);
  padding: 12px 10px;
  text-align: center;
  vertical-align: middle;
}

.history-table td:first-child { text-align: left; }

.history-table th {
  text-align: center;
  color: var(--color-muted);
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: #f7faff;
}

.history-sort-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.history-sort-button:hover,
.history-sort-button:focus-visible {
  color: var(--color-primary-strong);
}

.history-sort-button span {
  min-width: 10px;
  font-size: 13px;
}

.history-table tbody tr {
  transition:
    background 140ms ease,
    box-shadow 140ms ease;
}

.history-table tbody tr:hover {
  background: #f8fbff;
}

.history-table__row--latest {
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.05), rgba(47, 111, 237, 0.01));
}

.history-table__row--latest:hover {
  background: linear-gradient(180deg, rgba(47, 111, 237, 0.07), rgba(47, 111, 237, 0.02));
}

.history-table__row--attention {
  box-shadow: inset 3px 0 0 rgba(217, 119, 6, 0.34);
}

.history-table__exam-cell { min-width: 0; }

.history-report-button {
  min-height: 34px;
  padding-inline: 10px;
  font-size: 12px;
  white-space: nowrap;
}

.history-report-unavailable {
  display: inline-block;
  max-width: 160px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

.history-exam {
  display: block;
  color: var(--color-text);
  font-weight: 700;
  line-height: 1.45;
}

.history-paper {
  display: block;
  margin-top: 3px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.35;
}

.history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.history-meta__item {
  border-radius: 999px;
  padding: 3px 8px;
  color: #52627a;
  background: #eef3f8;
  font-size: 12px;
  font-weight: 700;
}

.history-meta__item--latest {
  color: var(--color-primary-strong);
  background: rgba(47, 111, 237, 0.1);
}

.history-score-summary {
  display: grid;
  justify-items: center;
  gap: 3px;
  text-align: center;
}

.history-score-summary strong {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 800;
}

.history-score-summary span,
.history-score-unavailable {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  white-space: nowrap;
}

.history-score-unavailable {
  display: inline-block;
  font-weight: 600;
}

.status-pill {
  display: inline-flex;
  border-radius: 999px;
  padding: 4px 9px;
  color: var(--color-muted);
  background: #eef3f8;
  font-size: 12px;
  font-weight: 700;
}

.status-pill--done {
  color: var(--color-success);
  background: rgba(20, 135, 101, 0.1);
}

.history-submitted {
  color: #52627a;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
  white-space: nowrap;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 780px) {
  .score-chart-scroll-hint { display: block; }
  .student-detail :deep(.app-card) { padding: 20px; }

  .student-detail__hero {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .student-detail__actions {
    justify-content: flex-end;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

}

@media (max-width: 420px) {
  .summary-grid { grid-template-columns: 1fr; }
  .student-detail :deep(.app-card) { padding: 16px; }
}

@media (max-width: 640px) {
  .history-table,
  .history-table tbody {
    display: block;
    min-width: 0;
  }

  .history-table colgroup,
  .history-table thead {
    display: none;
  }

  .history-table tbody {
    display: grid;
    gap: 10px;
    padding: 10px;
  }

  .history-table tbody tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 12px;
  }

  .history-table td,
  .history-table td:first-child {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    align-items: start;
    justify-content: initial;
    gap: 4px;
    padding: 10px;
    text-align: left;
  }

  .history-table td::before {
    color: var(--color-muted);
    content: attr(data-label);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-align: left;
    text-transform: uppercase;
  }

  .history-table .history-table__exam-cell {
    display: block;
    grid-column: 1 / -1;
    text-align: left;
  }

  .history-table .history-table__exam-cell::before {
    display: block;
    margin-bottom: 6px;
  }

  .history-score-summary {
    justify-items: start;
    min-width: 0;
    text-align: left;
  }

  .history-score-summary span {
    white-space: normal;
  }

  .history-submitted {
    white-space: normal;
  }

  .history-table__actions-cell {
    display: flex !important;
    grid-column: 1 / -1;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
