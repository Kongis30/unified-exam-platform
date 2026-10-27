<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import { adminApi } from '@shsat/admin/services/adminApi';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const errorMessage = ref('');
const attempts = ref([]);
const trendChartElement = ref(null);
const trendScoreMode = ref('RAW');
const historySort = ref({ key: null, direction: 'desc' });
let trendChart = null;
let echartsModulePromise = null;
let pageIsMounted = false;
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

  try {
    const records = unwrapResponse(
      await adminApi.getStudentAttemptHistory(studentId.value),
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
  const value = hasScaledScoring(attempt)
    ? Number(attempt.compositeScore ?? attempt.totalScaledScore)
    : Number(attempt.rawTotalScore ?? attempt.totalScore);
  return Number.isFinite(value) ? value : null;
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

const trendSeries = computed(() => {
  const useScaled = trendScoreMode.value === 'SCALED';
  const score = (attempt, section) => {
    if (section === 'TOTAL') {
      return useScaled ? getScaledScore(attempt) : numberOrNull(attempt.rawTotalScore ?? attempt.totalScore);
    }

    const value = section === 'ELA'
      ? (useScaled ? attempt.elaScaledScore ?? attempt.section1ScaledScore : attempt.elaRawScore ?? attempt.section1Score)
      : (useScaled ? attempt.mathScaledScore ?? attempt.section2ScaledScore : attempt.mathRawScore ?? attempt.section2Score);
    return numberOrNull(value);
  };

  return completedAttempts.value
    .map((attempt) => ({
      attempt,
      date: attempt.submittedAt || attempt.startedAt,
      title: attempt.examTitle || 'Exam',
      total: score(attempt, 'TOTAL'),
      ela: score(attempt, 'ELA'),
      math: score(attempt, 'MATH'),
    }))
    .filter((item) => item.date)
    .sort((left, right) => getTimeValue(left.date) - getTimeValue(right.date));
});

const hasTrendScores = computed(() => trendSeries.value.some((item) => item.total !== null || item.ela !== null || item.math !== null));

function getTimeValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function escapeTooltipText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
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
  return value === null || value === undefined || value === '' ? '-' : Number(value).toString();
}

// 依据当前成绩跨度选取易读的纵轴刻度，避免单次记录时出现长小数标签。
function getScoreAxisBounds(minimum, maximum) {
  const range = Math.max(maximum - minimum, 1);
  const roughInterval = range / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughInterval));
  const normalizedInterval = roughInterval / magnitude;
  const intervalFactor = normalizedInterval <= 1 ? 1 : normalizedInterval <= 2 ? 2 : normalizedInterval <= 5 ? 5 : 10;
  const interval = intervalFactor * magnitude;

  return {
    interval,
    min: Math.max(0, Math.floor(minimum / interval) * interval),
    max: Math.ceil(maximum / interval) * interval,
  };
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

async function renderTrendChart() {
  if (!trendChartElement.value || !hasTrendScores.value) {
    trendChart?.dispose();
    trendChart = null;
    return;
  }

  echartsModulePromise ||= Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]).then(([core, charts, components, renderers]) => {
    core.use([
      charts.LineChart,
      components.TitleComponent,
      components.TooltipComponent,
      components.LegendComponent,
      components.GridComponent,
      renderers.CanvasRenderer,
    ]);
    return core;
  });
  const echartsCore = await echartsModulePromise;
  if (!pageIsMounted || !trendChartElement.value || !hasTrendScores.value) return;
  if (!trendChart) trendChart = echartsCore.init(trendChartElement.value);

  const rows = trendSeries.value;
  const scaled = trendScoreMode.value === 'SCALED';
  const chartScores = rows
    .flatMap((row) => [row.total, row.ela, row.math])
    .filter((score) => score !== null && Number.isFinite(Number(score)))
    .map(Number);
  const scoreMin = Math.min(...chartScores);
  const scoreMax = Math.max(...chartScores);
  const scorePadding = Math.max(1, (scoreMax - scoreMin) * 0.08, Math.abs(scoreMin) * 0.02);
  const scoreAxis = getScoreAxisBounds(Math.max(0, scoreMin - scorePadding), scoreMax + scorePadding);
  trendChart.setOption({
    title: {
      text: 'Score Trend Over Time',
      left: 'center',
      textStyle: { fontSize: 16, fontWeight: 'normal', color: '#303133' },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter(items) {
        const row = rows[items[0]?.dataIndex];
        const date = row ? formatDateTime(row.date) : '';
        const details = items
          .filter((item) => item.value !== null && item.value !== undefined)
          .map((item) => `${item.marker} ${item.seriesName}: <strong>${item.value}</strong>`);
        return [`<strong>${escapeTooltipText(row?.title || 'Exam')}</strong>`, escapeTooltipText(date), ...details].join('<br>');
      },
    },
    legend: { data: ['Total Score', 'ELA', 'Math'], top: 30 },
    grid: { left: '5%', right: '5%', bottom: '8%', top: '22%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: rows.map((item) => formatShortDate(item.date)),
      axisLabel: { rotate: 45, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      name: trendChart.getWidth() < 480 ? '' : scaled ? 'Scaled Score' : 'Raw Score',
      min: scoreAxis.min,
      max: scoreAxis.max,
      interval: scoreAxis.interval,
      axisLabel: {
        formatter: (value) => Number.isInteger(value) ? String(value) : Number(value.toFixed(1)).toString(),
      },
    },
    series: [
      { name: 'Total Score', type: 'line', data: rows.map((item) => item.total), itemStyle: { color: '#409EFF' }, lineStyle: { width: 3 }, symbol: 'circle', symbolSize: rows.length === 1 ? 10 : 7, showSymbol: true, label: { show: rows.length === 1, position: 'top', color: '#409EFF', fontWeight: 600 }, connectNulls: false },
      { name: 'ELA', type: 'line', data: rows.map((item) => item.ela), itemStyle: { color: '#67C23A' }, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: rows.length === 1 ? 9 : 6, showSymbol: true, label: { show: rows.length === 1, position: 'top', color: '#67C23A', fontWeight: 600 }, connectNulls: false },
      { name: 'Math', type: 'line', data: rows.map((item) => item.math), itemStyle: { color: '#E6A23C' }, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: rows.length === 1 ? 9 : 6, showSymbol: true, label: { show: rows.length === 1, position: 'top', color: '#E6A23C', fontWeight: 600 }, connectNulls: false },
    ],
  }, true);
}

function resizeTrendChart() {
  trendChart?.resize();
  void renderTrendChart();
}

watch([attempts, trendScoreMode], async () => {
  await nextTick();
  await renderTrendChart();
}, { deep: true });

onMounted(async () => {
  pageIsMounted = true;
  await loadHistory();
  await nextTick();
  await renderTrendChart();
  window.addEventListener('resize', resizeTrendChart);
});

onBeforeUnmount(() => {
  pageIsMounted = false;
  window.removeEventListener('resize', resizeTrendChart);
  trendChart?.dispose();
  trendChart = null;
});
</script>

<template>
  <AdminLayout>
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

        <AppCard title="Score Trend" subtitle="Performance over time across all exams.">
          <div class="trend-chart-toolbar" role="group" aria-label="Score type">
            <span>Score type</span>
            <div class="trend-chart-toggle">
              <button
                type="button"
                :class="{ 'is-active': trendScoreMode === 'RAW' }"
                :aria-pressed="trendScoreMode === 'RAW'"
                @click="trendScoreMode = 'RAW'"
              >Raw</button>
              <button
                type="button"
                :class="{ 'is-active': trendScoreMode === 'SCALED' }"
                :aria-pressed="trendScoreMode === 'SCALED'"
                @click="trendScoreMode = 'SCALED'"
              >Scaled</button>
            </div>
          </div>
          <div v-if="!hasTrendScores" class="student-detail__empty">
            {{ trendScoreMode === 'SCALED' ? 'No scaled scores are available for completed attempts yet.' : 'No completed attempts to chart yet.' }}
          </div>
          <div v-else ref="trendChartElement" class="score-chart"></div>
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
                      <span v-else class="history-score-unavailable">Not available</span>
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
  </AdminLayout>
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

.trend-chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin: -2px 0 10px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}

.trend-chart-toggle {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 3px;
  background: #f7faff;
}

.trend-chart-toggle button {
  border: 0;
  border-radius: 6px;
  padding: 5px 10px;
  color: var(--color-muted);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.trend-chart-toggle button.is-active {
  color: var(--color-primary-strong);
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(23, 32, 51, 0.12);
}

.score-chart {
  width: 100%;
  height: 400px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: #ffffff;
}

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

  .score-chart { height: 300px; }
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
