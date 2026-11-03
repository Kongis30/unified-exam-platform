<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import MonitorQuestionDetail from '@shsat/components/MonitorQuestionDetail.vue';
import { adminApi } from '@shsat/admin/services/adminApi';
import { satAdminMonitorApi } from '@/examTypes/sat/admin/api/monitor';

const LIVE_POLL_INTERVAL_MS = 5000;
const ANALYTICS_POLL_INTERVAL_MS = 20000;
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 360;
const PLOT = { top: 48, right: 24, bottom: 76, left: 64 };
const plotWidth = CHART_WIDTH - PLOT.left - PLOT.right;
const plotHeight = CHART_HEIGHT - PLOT.top - PLOT.bottom;

const route = useRoute();
const router = useRouter();
const isSatMonitor = computed(() => ['sat-admin-exam-monitor', 'psat-admin-exam-monitor'].includes(route.name));
const monitorApi = computed(() => isSatMonitor.value ? satAdminMonitorApi : {
  getLive: (examId, options) => adminApi.getExamMonitorLive(examId, options),
  getAnalytics: (examId, options) => adminApi.getExamMonitorAnalytics(examId, options),
  getQuestion: (examId, questionNumber) => adminApi.getExamMonitorQuestion(examId, questionNumber),
});
const monitor = shallowRef(null);
const loading = ref(true);
const liveErrorMessage = ref('');
const analyticsErrorMessage = ref('');
const hasLiveData = ref(false);
const hasAnalyticsData = ref(false);
let liveRefreshTimer = null;
let analyticsRefreshTimer = null;
let liveRequestInFlight = false;
let analyticsRequestInFlight = false;
let liveRequestController = null;
let analyticsRequestController = null;
const selectedQuestionNumber = ref(null);
const questionDetail = ref(null);
const questionDetailLoading = ref(false);
const questionDetailError = ref('');
const previewImageUrl = ref('');
const unavailableSatOptionImages = ref(new Set());
let questionDetailRequestId = 0;

const questionRows = computed(() => monitor.value?.questionAnalytics || []);
const questionCount = computed(() => {
  const largestQuestionNumber = questionRows.value.reduce(
    (largest, row) => Math.max(largest, Number(row.questionNumber) || 0),
    0,
  );
  return Math.max(largestQuestionNumber, questionRows.value.length, 1);
});
const questionByNumber = computed(() => new Map(
  questionRows.value
    .filter((row) => Number.isInteger(Number(row.questionNumber)))
    .map((row) => [Number(row.questionNumber), row]),
));

const liveCounts = computed(() => {
  const counts = Array.from({ length: questionCount.value }, () => 0);
  for (const row of monitor.value?.currentQuestionDistribution || []) {
    const questionNumber = Number(row.questionNumber);
    if (questionNumber >= 1 && questionNumber <= questionCount.value) {
      counts[questionNumber - 1] = Number(row.students) || 0;
    }
  }
  return counts;
});
const hasCurrentDistribution = computed(() => liveCounts.value.some((count) => count > 0));
const currentDistributionEmptyMessage = computed(() => Number(monitor.value?.summary?.inProgressStudents || 0) > 0
  ? 'No live question positions are available. In-progress students may be away from the exam.'
  : 'No students are currently taking this exam.');

const averageTimes = computed(() => Array.from({ length: questionCount.value }, (_, index) => {
  const value = questionByNumber.value.get(index + 1)?.averageTimeSpent;
  return value === null || value === undefined ? 0 : Math.max(Number(value), 0);
}));
const hasAverageTimeData = computed(() => averageTimes.value.some((seconds) => seconds > 0));

function unwrap(response) {
  if (response?.success === false) {
    throw new Error(response.message || 'Failed to load exam monitor');
  }
  return response?.data ?? response;
}

function niceAxisStep(value, integer = false) {
  if (value <= 0) return 1;
  if (integer) return Math.max(1, Math.ceil(value / 5));

  const rawStep = value / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function buildChart(values, formatValue, { integerAxis = false } = {}) {
  // 将当前试卷的题目统一映射到同一坐标系，实时快照更新时只替换柱高。
  const rawMax = Math.max(...values, 0);
  const axisStep = niceAxisStep(rawMax, integerAxis);
  const axisMax = Math.max(axisStep, Math.ceil(rawMax / axisStep) * axisStep);
  const questionTotal = values.length;
  const step = plotWidth / questionTotal;
  const barWidth = Math.max(2.5, step * 0.58);
  const tickCount = Math.round(axisMax / axisStep);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = axisStep * index;
    return {
      value,
      label: formatValue(value),
      y: PLOT.top + plotHeight - (plotHeight * index) / tickCount,
    };
  });
  const bars = values.map((value, index) => {
    const height = axisMax > 0 ? (value / axisMax) * plotHeight : 0;
    return {
      questionNumber: index + 1,
      value,
      x: PLOT.left + index * step + (step - barWidth) / 2,
      y: PLOT.top + plotHeight - height,
      width: barWidth,
      height,
    };
  });
  const tickInterval = questionTotal > 60 ? 10 : questionTotal > 30 ? 5 : 3;
  const xTickValues = Array.from({ length: Math.ceil(questionTotal / tickInterval) }, (_, index) => 1 + index * tickInterval)
    .filter((value) => value <= questionTotal);
  if (xTickValues.at(-1) !== questionTotal) xTickValues.push(questionTotal);
  const xTicks = xTickValues.map((value) => ({
    value,
    x: PLOT.left + (value - 0.5) * step,
  }));
  return { axisMax, ticks, bars, xTicks };
}

const currentQuestionChart = computed(() => buildChart(liveCounts.value, formatCount, { integerAxis: true }));
const averageTimeChart = computed(() => buildChart(averageTimes.value, formatDuration));

const accuracyTiles = computed(() => Array.from({ length: questionCount.value }, (_, index) => {
  const questionNumber = index + 1;
  const row = questionByNumber.value.get(questionNumber);
  const accuracy = row?.accuracy;
  return {
    questionNumber,
    accuracy: accuracy === null || accuracy === undefined ? null : Number(accuracy),
    pendingCount: Number(row?.pendingCount) || 0,
  };
}));

const totalStudents = computed(() => monitor.value?.summary?.totalStudents ?? monitor.value?.summary?.startedAttempts ?? 0);

function mergeMonitorPayload(payload) {
  monitor.value = {
    ...monitor.value,
    ...payload,
    exam: { ...monitor.value?.exam, ...payload?.exam },
    summary: { ...monitor.value?.summary, ...payload?.summary },
    currentQuestionDistribution: payload?.currentQuestionDistribution
      ?? monitor.value?.currentQuestionDistribution
      ?? [],
    questionAnalytics: payload?.questionAnalytics ?? monitor.value?.questionAnalytics ?? [],
  };
}

async function loadLiveMonitor() {
  if (liveRequestInFlight) return;
  liveRequestInFlight = true;
  const controller = new AbortController();
  liveRequestController = controller;
  try {
    const payload = unwrap(await monitorApi.value.getLive(route.params.examId, { signal: controller.signal }));
    mergeMonitorPayload(payload);
    hasLiveData.value = true;
    liveErrorMessage.value = '';
  } catch (error) {
    if (error?.name !== 'AbortError' && error?.code !== 'ERR_CANCELED') {
      liveErrorMessage.value = 'Live progress could not be refreshed.';
    }
  } finally {
    if (liveRequestController === controller) {
      liveRequestController = null;
      liveRequestInFlight = false;
    }
    loading.value = false;
  }
}

async function loadAnalyticsMonitor() {
  if (analyticsRequestInFlight) return;
  analyticsRequestInFlight = true;
  const controller = new AbortController();
  analyticsRequestController = controller;
  try {
    const payload = unwrap(await monitorApi.value.getAnalytics(route.params.examId, { signal: controller.signal }));
    mergeMonitorPayload(payload);
    hasAnalyticsData.value = true;
    analyticsErrorMessage.value = '';
  } catch (error) {
    if (error?.name !== 'AbortError' && error?.code !== 'ERR_CANCELED') {
      analyticsErrorMessage.value = 'Question analytics could not be refreshed.';
    }
  } finally {
    if (analyticsRequestController === controller) {
      analyticsRequestController = null;
      analyticsRequestInFlight = false;
    }
  }
}

function scheduleLiveRefresh() {
  if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
  liveRefreshTimer = window.setTimeout(async () => {
    await loadLiveMonitor();
    scheduleLiveRefresh();
  }, LIVE_POLL_INTERVAL_MS);
}

function scheduleAnalyticsRefresh() {
  if (analyticsRefreshTimer) window.clearTimeout(analyticsRefreshTimer);
  analyticsRefreshTimer = window.setTimeout(async () => {
    await loadAnalyticsMonitor();
    scheduleAnalyticsRefresh();
  }, ANALYTICS_POLL_INTERVAL_MS);
}

function cancelMonitorRequests() {
  liveRequestController?.abort();
  analyticsRequestController?.abort();
  liveRequestController = null;
  analyticsRequestController = null;
  liveRequestInFlight = false;
  analyticsRequestInFlight = false;
}

async function openQuestionDetail(questionNumber) {
  const normalizedQuestionNumber = Number(questionNumber);
  if (!Number.isInteger(normalizedQuestionNumber) || normalizedQuestionNumber < 1) {
    return;
  }

  selectedQuestionNumber.value = normalizedQuestionNumber;
  questionDetail.value = null;
  questionDetailError.value = '';
  questionDetailLoading.value = true;
  const requestId = ++questionDetailRequestId;

  try {
    const response = await monitorApi.value.getQuestion(route.params.examId, normalizedQuestionNumber);
    if (requestId !== questionDetailRequestId) return;
    const payload = unwrap(response);
    questionDetail.value = {
      ...(payload.question || {}),
      material: payload.material || null,
    };
  } catch (error) {
    if (requestId !== questionDetailRequestId) return;
    questionDetailError.value = error.message || 'Failed to load question details';
  } finally {
    if (requestId === questionDetailRequestId) {
      questionDetailLoading.value = false;
    }
  }
}

function closeQuestionDetail() {
  questionDetailRequestId += 1;
  selectedQuestionNumber.value = null;
  questionDetail.value = null;
  questionDetailError.value = '';
  questionDetailLoading.value = false;
}

function openImagePreview(url) {
  if (url) previewImageUrl.value = url;
}

function closeImagePreview() {
  previewImageUrl.value = '';
}

function formatCount(value) {
  return String(Math.round(value));
}

function formatDuration(value) {
  const totalSeconds = Math.max(Number(value) || 0, 0);
  if (totalSeconds < 10) return `${Number(totalSeconds.toFixed(1))}s`;

  const seconds = Math.round(totalSeconds);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}

function formatExamDuration(value) {
  const totalMinutes = Math.max(Math.floor(Number(value) || 0), 0);
  if (!totalMinutes) return '—';

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes) parts.push(`${minutes} min`);
  return parts.join(' ');
}

function formatAccuracy(value, pendingCount = 0) {
  if (value !== null) return `${Math.round(value)}%`;
  return pendingCount > 0 ? 'Pending' : '—';
}

function accuracyAriaLabel(tile) {
  if (tile.pendingCount > 0) {
    return `Open question ${tile.questionNumber} details; ${tile.pendingCount} response${tile.pendingCount === 1 ? '' : 's'} awaiting score`;
  }
  return `Open question ${tile.questionNumber} details`;
}

function goBack() {
  const returnTo = route.query.returnTo;
  if (typeof returnTo === 'string'
    && (/^\/(sat|psat|shsat)(?:[/?#]|$)/.test(returnTo) || returnTo.startsWith('/exam-types/SAT/admin') || returnTo.startsWith('/exam-types/PSAT/admin') || returnTo.startsWith('/exam-types/SHSAT/admin'))) {
    router.push(returnTo);
    return;
  }

  const previousRoute = window.history.state?.back;

  if (previousRoute && previousRoute !== '/login') {
    router.back();
    return;
  }

  if (isSatMonitor.value) {
    router.push({ name: 'exam-type', params: { code: 'SAT' }, query: { tab: 'exams' } });
    return;
  }
  router.push({ name: 'shsat-admin', query: { tab: 'exams' } });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function getSatOptionParts(value) {
  const content = String(value ?? '');
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = imagePattern.exec(content))) {
    if (match.index > lastIndex) parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    parts.push({ type: 'image', alt: match[1] || 'Answer choice image', src: match[2] });
    lastIndex = imagePattern.lastIndex;
  }

  if (lastIndex < content.length || parts.length === 0) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }
  return parts;
}

function markSatOptionImageUnavailable(src) {
  unavailableSatOptionImages.value = new Set([...unavailableSatOptionImages.value, src]);
}

function accuracyClass(value, pendingCount = 0) {
  if (value === null) return pendingCount > 0 ? 'accuracy-tile--pending' : 'accuracy-tile--empty';
  if (value >= 75) return 'accuracy-tile--high';
  if (value > 50) return 'accuracy-tile--medium';
  return 'accuracy-tile--low';
}

watch(() => [route.name, route.params.examId], async () => {
  if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
  if (analyticsRefreshTimer) window.clearTimeout(analyticsRefreshTimer);
  cancelMonitorRequests();
  closeQuestionDetail();
  monitor.value = null;
  hasLiveData.value = false;
  hasAnalyticsData.value = false;
  liveErrorMessage.value = '';
  analyticsErrorMessage.value = '';
  loading.value = true;
  await Promise.all([loadLiveMonitor(), loadAnalyticsMonitor()]);
  scheduleLiveRefresh();
  scheduleAnalyticsRefresh();
}, { immediate: true });

onBeforeUnmount(() => {
  if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
  if (analyticsRefreshTimer) window.clearTimeout(analyticsRefreshTimer);
  cancelMonitorRequests();
});
</script>

<template>

    <section class="exam-monitor page-shell" aria-label="Exam monitor">
      <button type="button" class="monitor-back-button" @click="goBack">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>Back</span>
      </button>

      <div v-if="loading && !monitor" class="monitor-loading" aria-label="Loading">
        <span></span>
      </div>

      <template v-else>
        <p v-if="liveErrorMessage" class="monitor-refresh-alert" role="status">
          {{ hasLiveData ? `${liveErrorMessage} Showing the last update while we retry automatically.` : `${liveErrorMessage} Retrying automatically.` }}
        </p>

        <section class="exam-info-panel" aria-label="Exam information">
          <div class="exam-info-details">
            <h1>{{ monitor.exam?.title || 'Exam' }}</h1>
            <div class="exam-info-meta">
              <span>{{ formatDateTime(monitor.exam?.startTime) }} - {{ formatDateTime(monitor.exam?.endTime) }}</span>
              <span>{{ formatExamDuration(monitor.exam?.duration) }}</span>
            </div>
          </div>
          <div class="monitor-summary-grid" aria-label="Exam progress summary">
            <div class="monitor-summary-item">
              <strong>{{ monitor.summary?.inProgressStudents ?? monitor.summary?.inProgressAttempts ?? 0 }}</strong>
              <span>In progress</span>
            </div>
            <div class="monitor-summary-item">
              <strong>{{ monitor.summary?.incompleteStudents ?? Math.max(0, totalStudents - (monitor.summary?.completedStudents ?? monitor.summary?.finishedAttempts ?? 0)) }}</strong>
              <span>Incomplete students</span>
            </div>
            <div class="monitor-summary-item">
              <strong>{{ monitor.summary?.completedStudents ?? monitor.summary?.finishedAttempts ?? 0 }}</strong>
              <span>Completed students</span>
            </div>
            <div class="monitor-summary-item">
              <strong>{{ totalStudents }}</strong>
              <span>Total students</span>
            </div>
          </div>
        </section>

        <p v-if="analyticsErrorMessage" class="monitor-refresh-alert" role="status">
          {{ hasAnalyticsData ? `${analyticsErrorMessage} Showing the last update while we retry automatically.` : `${analyticsErrorMessage} Retrying automatically.` }}
        </p>

        <section class="monitor-chart-grid">
          <article class="monitor-panel">
            <h1>Current Question Distribution</h1>
            <div v-if="!hasCurrentDistribution" class="monitor-chart-empty">
              {{ currentDistributionEmptyMessage }}
            </div>
            <div v-else class="monitor-chart-scroll">
              <svg class="monitor-chart" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="Current question distribution">
                <g v-for="tick in currentQuestionChart.ticks" :key="`current-${tick.value}`">
                  <line class="chart-grid-line" :x1="PLOT.left" :x2="CHART_WIDTH - PLOT.right" :y1="tick.y" :y2="tick.y" />
                  <text class="chart-y-label" :x="PLOT.left - 12" :y="tick.y + 5" text-anchor="end">{{ tick.label }}</text>
                </g>
                <line class="chart-axis" :x1="PLOT.left" :x2="PLOT.left" :y1="PLOT.top" :y2="PLOT.top + plotHeight" />
                <line class="chart-axis" :x1="PLOT.left" :x2="CHART_WIDTH - PLOT.right" :y1="PLOT.top + plotHeight" :y2="PLOT.top + plotHeight" />
                <text class="chart-axis-title" :x="18" :y="PLOT.top + plotHeight / 2" :transform="`rotate(-90 18 ${PLOT.top + plotHeight / 2})`" text-anchor="middle">Students</text>
                <g v-for="bar in currentQuestionChart.bars" :key="`current-bar-${bar.questionNumber}`">
                  <rect class="chart-bar chart-bar--blue" :x="bar.x" :y="bar.y" :width="bar.width" :height="bar.height" rx="1">
                    <title>Question {{ bar.questionNumber }}: {{ bar.value }} students</title>
                  </rect>
                </g>
                <g v-for="tick in currentQuestionChart.xTicks" :key="`current-x-${tick.value}`">
                  <text class="chart-x-label" :x="tick.x" :y="PLOT.top + plotHeight + 22" text-anchor="middle">{{ tick.value }}</text>
                </g>
                <text class="chart-axis-title chart-axis-title--question" :x="CHART_WIDTH / 2" :y="CHART_HEIGHT - 10" text-anchor="middle">Question Number</text>
              </svg>
            </div>
            <p v-if="hasCurrentDistribution" class="monitor-chart-hint">Swipe horizontally to view all questions.</p>
          </article>

          <article class="monitor-panel">
            <h1>Average Time per Question</h1>
            <div v-if="!hasAverageTimeData" class="monitor-chart-empty">
              No response-time data has been recorded for this exam yet.
            </div>
            <div v-else class="monitor-chart-scroll">
              <svg class="monitor-chart" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="Average time per question">
                <g v-for="tick in averageTimeChart.ticks" :key="`time-${tick.value}`">
                  <line class="chart-grid-line" :x1="PLOT.left" :x2="CHART_WIDTH - PLOT.right" :y1="tick.y" :y2="tick.y" />
                  <text class="chart-y-label" :x="PLOT.left - 12" :y="tick.y + 5" text-anchor="end">{{ tick.label }}</text>
                </g>
                <line class="chart-axis" :x1="PLOT.left" :x2="PLOT.left" :y1="PLOT.top" :y2="PLOT.top + plotHeight" />
                <line class="chart-axis" :x1="PLOT.left" :x2="CHART_WIDTH - PLOT.right" :y1="PLOT.top + plotHeight" :y2="PLOT.top + plotHeight" />
                <text class="chart-axis-title" :x="18" :y="PLOT.top + plotHeight / 2" :transform="`rotate(-90 18 ${PLOT.top + plotHeight / 2})`" text-anchor="middle">Avg Time</text>
                <g v-for="bar in averageTimeChart.bars" :key="`time-bar-${bar.questionNumber}`">
                  <rect class="chart-bar chart-bar--orange" :x="bar.x" :y="bar.y" :width="bar.width" :height="bar.height" rx="1">
                    <title>Question {{ bar.questionNumber }}: {{ formatDuration(bar.value) }}</title>
                  </rect>
                </g>
                <g v-for="tick in averageTimeChart.xTicks" :key="`time-x-${tick.value}`">
                  <text class="chart-x-label" :x="tick.x" :y="PLOT.top + plotHeight + 22" text-anchor="middle">{{ tick.value }}</text>
                </g>
                <text class="chart-axis-title chart-axis-title--question" :x="CHART_WIDTH / 2" :y="CHART_HEIGHT - 10" text-anchor="middle">Question Number</text>
              </svg>
            </div>
            <p v-if="hasAverageTimeData" class="monitor-chart-hint">Swipe horizontally to view all questions.</p>
          </article>
        </section>

        <section class="monitor-panel accuracy-panel">
          <h1>Accuracy Heatmap</h1>
          <div class="accuracy-legend" aria-label="Accuracy legend">
            <span
              class="accuracy-legend__item"
              tabindex="0"
              aria-label="No answers yet"
              data-tooltip="No student has answered this question yet."
            >
              <i class="legend-swatch legend-swatch--empty"></i>
              No answers yet
            </span>
            <span
              class="accuracy-legend__item"
              tabindex="0"
              aria-label="Awaiting score"
              data-tooltip="Responses are saved; scores appear after the exam is submitted."
            >
              <i class="legend-swatch legend-swatch--pending"></i>
              Awaiting score
            </span>
            <span
              class="accuracy-legend__item"
              tabindex="0"
              aria-label="High accuracy: 75% or above"
              data-tooltip="75% or above"
            >
              <i class="legend-swatch legend-swatch--high"></i>
              High accuracy (75%+)
            </span>
            <span
              class="accuracy-legend__item"
              tabindex="0"
              aria-label="Medium accuracy: above 50% and below 75%"
              data-tooltip="Above 50% and below 75%"
            >
              <i class="legend-swatch legend-swatch--medium"></i>
              Medium accuracy (&gt;50% and &lt;75%)
            </span>
            <span
              class="accuracy-legend__item"
              tabindex="0"
              aria-label="Low accuracy: 50% or below"
              data-tooltip="50% or below"
            >
              <i class="legend-swatch legend-swatch--low"></i>
              Low accuracy (50% or below)
            </span>
          </div>
          <div class="accuracy-grid-wrap">
            <div class="accuracy-grid">
              <button
                v-for="tile in accuracyTiles"
                :key="`accuracy-${tile.questionNumber}`"
                type="button"
                class="accuracy-tile"
                :class="accuracyClass(tile.accuracy, tile.pendingCount)"
                :aria-label="accuracyAriaLabel(tile)"
                @click="openQuestionDetail(tile.questionNumber)"
              >
                <strong>Q{{ tile.questionNumber }}</strong>
                <span>{{ formatAccuracy(tile.accuracy, tile.pendingCount) }}</span>
              </button>
            </div>
          </div>
        </section>
      </template>
    </section>

    <div v-if="selectedQuestionNumber" class="question-detail-backdrop" @click.self="closeQuestionDetail">
      <aside class="question-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="question-detail-title">
        <header class="question-detail-header">
          <div>
            <p class="question-detail-eyebrow">Question {{ selectedQuestionNumber }}</p>
            <h2 id="question-detail-title">Question details</h2>
          </div>
          <button v-if="!previewImageUrl" type="button" class="question-detail-close" aria-label="Close question details" @click="closeQuestionDetail">×</button>
        </header>

        <div v-if="questionDetailLoading" class="question-detail-state">Loading question...</div>
        <div v-else-if="questionDetailError" class="question-detail-state question-detail-state--error">{{ questionDetailError }}</div>
        <div v-else-if="isSatMonitor && questionDetail" class="sat-question-detail">
          <div class="sat-question-detail__meta">
            <span v-if="questionDetail.subject">{{ questionDetail.subject }}</span>
            <span>{{ questionDetail.questionType }}</span>
          </div>
          <div v-if="questionDetail.material" class="sat-question-detail__material">
            <h3>{{ questionDetail.material.title || 'Reading material' }}</h3>
            <img v-if="questionDetail.material.assetUrl" :src="questionDetail.material.assetUrl" alt="Question material" @click="openImagePreview(questionDetail.material.assetUrl)" />
            <p v-if="questionDetail.material.materialContent">{{ questionDetail.material.materialContent }}</p>
          </div>
          <div class="sat-question-detail__stem">{{ questionDetail.stem }}</div>
          <ol v-if="questionDetail.options && Object.keys(questionDetail.options).length" class="sat-question-detail__options">
            <li v-for="(value, key) in questionDetail.options" :key="key">
              <strong>{{ key }}.</strong>
              <span v-for="(part, index) in getSatOptionParts(value)" :key="`${key}-${index}`">
                <template v-if="part.type === 'text'">{{ part.value }}</template>
                <img
                  v-else-if="!unavailableSatOptionImages.has(part.src)"
                  class="sat-question-detail__option-image"
                  :src="part.src"
                  :alt="part.alt"
                  @error="markSatOptionImageUnavailable(part.src)"
                  @click="openImagePreview(part.src)"
                />
                <span v-else class="sat-question-detail__image-unavailable">Image unavailable</span>
              </span>
            </li>
          </ol>
          <div class="sat-question-detail__answer">
            <span>Correct answer</span>
            <strong>{{ questionDetail.correctAnswer || questionDetail.correctAnswerData?.correctAnswer || 'Not available' }}</strong>
          </div>
          <p v-if="questionDetail.explanation" class="sat-question-detail__explanation">{{ questionDetail.explanation }}</p>
        </div>
        <MonitorQuestionDetail
          v-else-if="questionDetail"
          :question="questionDetail"
          :question-number="selectedQuestionNumber"
          @preview-image="openImagePreview"
        />
      </aside>
    </div>

    <div v-if="previewImageUrl" class="question-image-preview" @click="closeImagePreview">
      <button type="button" class="question-image-preview__close" aria-label="Close image preview" @click.stop="closeImagePreview">×</button>
      <img :src="previewImageUrl" alt="Question material preview" @click.stop />
    </div>

</template>

<style scoped>
.exam-monitor { display: grid; width: 100%; max-width: var(--page-container-width, 1320px); gap: 28px; margin: 0 auto; padding: 28px 32px 48px; background: transparent; }
.monitor-back-button { display: inline-flex; width: fit-content; align-items: center; gap: 6px; border: 1px solid #cbd8e8; border-radius: 7px; padding: 7px 12px 7px 9px; color: #53627a; background: #fff; font: inherit; font-size: 13px; cursor: pointer; }
.monitor-back-button:hover, .monitor-back-button:focus-visible { border-color: #4c82cb; color: #2f6fed; outline: none; }
.monitor-back-button svg { width: 16px; height: 16px; }
.exam-info-panel { display: flex; align-items: center; justify-content: space-between; gap: 28px; border: 1px solid #d9e2ec; border-radius: 12px; padding: 22px 30px; background: #fff; box-shadow: 0 2px 6px rgba(37, 57, 84, 0.1); }
.exam-info-details h1 { margin: 0; color: #101b2f; font-size: 25px; line-height: 1.2; }
.exam-info-meta { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 8px; color: #6f7884; font-size: 15px; }
.monitor-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)); gap: 22px; }
.monitor-summary-item { display: grid; justify-items: end; gap: 4px; min-width: 110px; }
.monitor-summary-item strong { color: #101b2f; font-size: 30px; line-height: 1; }
.monitor-summary-item span { color: #6f7884; font-size: 13px; white-space: nowrap; }
.monitor-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; }
.monitor-panel { min-width: 0; border: 1px solid #d9e2ec; border-radius: 12px; padding: 28px 30px 22px; background: #fff; box-shadow: 0 2px 6px rgba(37, 57, 84, 0.1); }
.monitor-panel h1 { margin: 0 0 18px; color: #101b2f; font-size: 26px; line-height: 1.2; letter-spacing: 0; }
.monitor-chart-scroll { width: 100%; overflow-x: auto; }
.monitor-chart { display: block; width: 100%; height: auto; overflow: visible; }
.monitor-chart-hint { display: none; margin: 8px 0 0; color: #6f7884; font-size: 12px; line-height: 1.4; text-align: center; }
.monitor-chart-empty { display: grid; min-height: 220px; place-items: center; border: 1px dashed #d5deea; border-radius: 8px; padding: 24px; color: #748198; background: #f8faff; font-size: 15px; text-align: center; }
.chart-grid-line { stroke: #e5eaf0; stroke-width: 1; stroke-dasharray: 4 4; }
.chart-axis { stroke: #6b7480; stroke-width: 1.4; }
.chart-y-label, .chart-x-label, .chart-axis-title { fill: #6f7884; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 18px; }
.chart-axis-title { font-size: 20px; }
.chart-bar { shape-rendering: geometricPrecision; }
.chart-bar--blue { fill: #4c82cb; }
.chart-bar--orange { fill: #e98727; }
.accuracy-panel { padding-bottom: 30px; }
.accuracy-legend { display: flex; flex-wrap: wrap; gap: 22px; margin: 0 0 24px; color: #737d8a; font-size: 16px; }
.accuracy-legend__item { position: relative; display: inline-flex; align-items: center; gap: 8px; cursor: help; outline: none; }
.accuracy-legend__item::after { position: absolute; left: 50%; bottom: calc(100% + 10px); z-index: 5; width: max-content; max-width: 260px; padding: 7px 10px; border-radius: 6px; color: #fff; background: #18243a; box-shadow: 0 8px 20px rgba(24, 36, 58, 0.2); content: attr(data-tooltip); font-size: 13px; line-height: 1.35; opacity: 0; pointer-events: none; transform: translate(-50%, 4px); transition: opacity 150ms ease, transform 150ms ease; }
.accuracy-legend__item:hover::after, .accuracy-legend__item:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }
.legend-swatch { width: 18px; height: 18px; border-radius: 3px; }
.legend-swatch--empty, .accuracy-tile--empty { background: #cbd5e3; }
.legend-swatch--pending, .accuracy-tile--pending { background: #92a5c3; }
.legend-swatch--high, .accuracy-tile--high { background: #2ecb9f; }
.legend-swatch--medium, .accuracy-tile--medium { background: #f6bd1d; }
.legend-swatch--low, .accuracy-tile--low { background: #f36f73; }
.accuracy-grid-wrap { min-width: 0; padding: 5px 2px 8px; }
.accuracy-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(52px, 1fr)); gap: 8px; width: 100%; min-width: 0; padding: 2px; }
.accuracy-tile { display: grid; min-height: 78px; align-content: center; justify-items: center; gap: 4px; border: 0; border-radius: 6px; color: #101b2f; font: inherit; font-size: 17px; line-height: 1.05; cursor: pointer; transition: transform 140ms ease, box-shadow 140ms ease; }
.accuracy-tile:hover, .accuracy-tile:focus-visible { box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.24); transform: translateY(-1px); outline: none; }
.accuracy-tile strong { font-size: 16px; }
.accuracy-tile span { font-size: 17px; font-weight: 700; }
.monitor-loading { display: grid; min-height: 520px; place-items: center; }
.monitor-loading span { width: 30px; height: 30px; border: 3px solid #cbd8e8; border-top-color: #4c82cb; border-radius: 50%; animation: monitor-spin 800ms linear infinite; }
.monitor-refresh-alert { margin: 0 0 16px; border: 1px solid #f1d39b; border-radius: 8px; padding: 10px 12px; color: #765416; background: #fff8e9; font-size: 14px; line-height: 1.45; }
.question-detail-backdrop { position: fixed; inset: 0; z-index: 30; display: flex; justify-content: flex-end; background: rgba(16, 27, 47, 0.38); }
.question-detail-drawer { width: min(680px, 92vw); height: 100%; overflow-y: auto; padding: 24px; background: #ffffff; box-shadow: -10px 0 28px rgba(16, 27, 47, 0.18); }
.question-detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.question-detail-eyebrow { margin: 0 0 4px; color: #4c82cb; font-size: 13px; font-weight: 700; }
.question-detail-header h2 { margin: 0; color: #101b2f; font-size: 22px; }
.question-detail-close { width: 36px; height: 36px; border: 1px solid #d8e2ee; border-radius: 8px; color: #53627a; background: #fff; font-size: 24px; line-height: 1; cursor: pointer; }
.question-detail-close:hover, .question-detail-close:focus-visible { border-color: #4c82cb; color: #2f6fed; outline: none; }
.question-detail-state { padding: 32px 12px; color: #53627a; text-align: center; }
.question-detail-state--error { color: #a32938; }
.sat-question-detail { display: grid; gap: 18px; color: #1f2c43; }
.sat-question-detail__meta { display: flex; gap: 8px; color: #536b8e; font-size: 13px; }
.sat-question-detail__meta span { border-radius: 999px; padding: 5px 10px; background: #eef4ff; }
.sat-question-detail__material { border: 1px solid #dce6f5; border-radius: 10px; padding: 16px; background: #f8faff; }
.sat-question-detail__material h3 { margin: 0 0 10px; font-size: 15px; }
.sat-question-detail__material p, .sat-question-detail__stem, .sat-question-detail__explanation { white-space: pre-wrap; line-height: 1.65; }
.sat-question-detail__material img { display: block; max-width: 100%; max-height: 260px; object-fit: contain; cursor: zoom-in; }
.sat-question-detail__options { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; line-height: 1.5; }
.sat-question-detail__options > li > strong { margin-right: 0.35em; }
.sat-question-detail__option-image { display: block; max-width: min(100%, 360px); max-height: 180px; margin: 8px 0; object-fit: contain; cursor: zoom-in; }
.sat-question-detail__image-unavailable { display: inline-flex; margin: 6px 0; border: 1px dashed #cbd5e3; border-radius: 6px; padding: 6px 9px; color: #68778e; background: #f6f8fb; font-size: 13px; }
.sat-question-detail__answer { display: flex; justify-content: space-between; gap: 16px; border: 1px solid #cfe9db; border-radius: 10px; padding: 12px 14px; color: #176b46; background: #f0faf4; }
.sat-question-detail__explanation { margin: 0; color: #53627a; }
.question-image-preview { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 32px; background: rgba(16, 27, 47, 0.72); }
.question-image-preview img { max-width: min(92vw, 1200px); max-height: 90vh; object-fit: contain; background: #fff; }
.question-image-preview__close { position: fixed; top: 20px; right: 24px; width: 40px; height: 40px; border: 0; border-radius: 8px; color: #fff; background: rgba(0, 0, 0, 0.4); font-size: 28px; cursor: pointer; }
@keyframes monitor-spin { to { transform: rotate(360deg); } }
@media (max-width: 980px) { .monitor-chart-grid { grid-template-columns: 1fr; } }
@media (max-width: 900px) { .monitor-summary-grid { grid-template-columns: repeat(2, minmax(110px, 1fr)); } .monitor-summary-item { justify-items: start; } }
@media (max-width: 640px) { .exam-monitor { padding: 16px 12px 28px; } .exam-info-panel { align-items: flex-start; flex-direction: column; padding: 20px 16px; } .monitor-summary-grid { width: 100%; gap: 16px; } .monitor-summary-item { justify-items: start; min-width: 0; } .monitor-summary-item strong { font-size: 25px; } .monitor-summary-item span { white-space: normal; } .monitor-panel { padding: 20px 16px 16px; } .monitor-panel h1 { font-size: 21px; } .monitor-chart { width: 560px; max-width: none; } .monitor-chart-hint { display: block; } .chart-axis-title--question { display: none; } .question-detail-drawer { width: 100%; padding: 18px 14px; } }
</style>
