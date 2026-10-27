<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import { adminApi } from '@shsat/admin/services/adminApi';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const errorMessage = ref('');
const classInfo = ref(null);
const examInfo = ref(null);
const scores = ref([]);
const resultTableWrap = ref(null);
const resultTableScrollLeft = ref(0);
const resultTableScrollMax = ref(0);
let resultTableResizeObserver = null;
const SHSAT_SECTION_RAW_MAX = 50;
const SHSAT_TOTAL_RAW_MAX = SHSAT_SECTION_RAW_MAX * 2;
const sortState = ref({
  key: 'totalScore',
  direction: 'desc',
});

const sortLabels = {
  totalScore: 'available score',
  elaScore: 'ELA section score',
  mathScore: 'Math section score',
  accuracy: 'accuracy',
  submittedAt: 'submitted time',
};

const classId = computed(() => route.params.classId);
const examId = computed(() => route.params.examId);

const sortedScores = computed(() => {
  return [...scores.value].sort((left, right) => {
    const primaryComparison = compareSortValues(
      getSortValue(left, sortState.value.key),
      getSortValue(right, sortState.value.key),
      sortState.value.direction
    );

    if (primaryComparison !== 0) {
      return primaryComparison;
    }

    const fallbackScoreComparison = compareSortValues(getScoreValue(left), getScoreValue(right), 'desc');
    if (fallbackScoreComparison !== 0) {
      return fallbackScoreComparison;
    }

    return String(left.studentName || '').localeCompare(String(right.studentName || ''));
  });
});

const sortDescription = computed(() => {
  const label = sortLabels[sortState.value.key] || 'total score';

  if (sortState.value.key === 'submittedAt') {
    return sortState.value.direction === 'desc'
      ? `Sorted by ${label}, newest first.`
      : `Sorted by ${label}, oldest first.`;
  }

  return sortState.value.direction === 'desc'
    ? `Sorted by ${label}, highest first.`
    : `Sorted by ${label}, lowest first.`;
});

const summary = computed(() => {
  // 平均/最高/最低分仅统计已完成(COMPLETED)的考试记录；进行中(IN_PROGRESS)、过期等未完成记录不计入。
  const completedRows = scores.value.filter(
    (score) => String(score.status || '').toUpperCase() === 'COMPLETED',
  );
  const numericScores = completedRows
    .map(getScoreValue)
    .filter((value) => Number.isFinite(value));
  const completed = completedRows.length;
  const participants = scores.value.length;
  const completionRate = participants > 0 ? `${Math.round((completed / participants) * 100)}%` : '-';

  if (numericScores.length === 0) {
    return {
      participants,
      completed,
      completionRate,
      average: '-',
      highest: '-',
      lowest: '-',
    };
  }

  const total = numericScores.reduce((sum, value) => sum + value, 0);

  return {
    participants,
    completed,
    completionRate,
    average: formatNumber(total / numericScores.length),
    highest: formatNumber(Math.max(...numericScores)),
    lowest: formatNumber(Math.min(...numericScores)),
  };
});

const resultContextItems = computed(() => [
  {
    label: 'Class',
    value: classInfo.value?.className || '-',
  },
  {
    label: 'Paper',
      value: examInfo.value?.paperName || 'Paper unavailable',
  },
  {
    label: 'Time Window',
    value: `${formatDateTime(examInfo.value?.startTime)} - ${formatDateTime(examInfo.value?.endTime)}`,
  },
]);

function unwrapResponse(response, fallbackMessage) {
  if (response?.success === false) {
    throw new Error(response.message || fallbackMessage);
  }

  return response?.data ?? response;
}

function unwrapListResponse(response, fallbackMessage) {
  const payload = unwrapResponse(response, fallbackMessage);

  if (Array.isArray(payload)) {
    return payload;
  }

  return payload?.items || payload?.records || payload?.list || payload?.content || [];
}

async function loadPage() {
  loading.value = true;
  errorMessage.value = '';

  try {
    const [classResponse, examResponse, scoreResponse] = await Promise.all([
      adminApi.getClass(classId.value),
      adminApi.getExam(examId.value),
      adminApi.getClassExamScores(examId.value, classId.value),
    ]);

    classInfo.value = unwrapResponse(classResponse, 'Failed to load class details');
    examInfo.value = unwrapResponse(examResponse, 'Failed to load exam details');
    scores.value = unwrapListResponse(scoreResponse, 'Failed to load class results');
  } catch (error) {
    errorMessage.value = error.message || 'Failed to load class exam results. Please try again later.';
  } finally {
    loading.value = false;
    await nextTick();
    syncResultTableScrollMetrics();
  }
}

function syncResultTableScrollMetrics() {
  const element = resultTableWrap.value;
  if (!element) {
    resultTableScrollMax.value = 0;
    resultTableScrollLeft.value = 0;
    return;
  }

  resultTableScrollMax.value = Math.max(0, element.scrollWidth - element.clientWidth);
  resultTableScrollLeft.value = Math.min(element.scrollLeft, resultTableScrollMax.value);
}

function handleResultTableScroll() {
  resultTableScrollLeft.value = resultTableWrap.value?.scrollLeft || 0;
}

function handleResultTableScrollbarInput(event) {
  const nextScrollLeft = Number(event.target.value) || 0;
  if (resultTableWrap.value) {
    resultTableWrap.value.scrollLeft = nextScrollLeft;
  }
  resultTableScrollLeft.value = nextScrollLeft;
}

function goBack() {
  router.push({
    name: 'admin-class-detail',
    params: { classId: classId.value },
  });
}

function openExamMonitor() {
  if (!examId.value) {
    return;
  }

  router.push({
    name: 'admin-exam-monitor',
    params: { examId: examId.value },
  });
}

function openStudentDetail(score) {
  if (!score?.studentId) {
    return;
  }

  router.push({
    name: 'admin-student-detail',
    params: {
      classId: classId.value,
      studentId: score.studentId,
    },
    query: {
      studentName: score.studentName || '',
      studentNumber: score.studentNumber || '',
      className: classInfo.value?.className || '',
      returnTo: route.fullPath,
      returnLabel: 'Back to Class Results',
    },
  });
}

function getScoreValue(score) {
  const rawValue = hasScaledScoring(score)
    ? (score?.compositeScore ?? score?.totalScaledScore)
    : (score?.rawTotalScore ?? score?.totalScore);
  // 未参加考试/未开始的学生成绩字段为 null，必须返回 null，避免 Number(null)=0 被计入平均分。
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return null;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function getSortValue(score, key) {
  if (key === 'elaScore') {
    return hasScaledScoring(score)
      ? getNumericValue(score?.elaScaledScore ?? score?.section1ScaledScore)
      : getNumericValue(score?.elaRawScore ?? score?.section1Score);
  }

  if (key === 'mathScore') {
    return hasScaledScoring(score)
      ? getNumericValue(score?.mathScaledScore ?? score?.section2ScaledScore)
      : getNumericValue(score?.mathRawScore ?? score?.section2Score);
  }

  if (key === 'accuracy') {
    return getNumericValue(score?.accuracy);
  }

  if (key === 'submittedAt') {
    return getDateValue(score?.submittedAt);
  }

  return getScoreValue(score);
}

function getNumericValue(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getDateValue(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareSortValues(left, right, direction = 'desc') {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;

  if (leftMissing && rightMissing) {
    return 0;
  }

  if (leftMissing) {
    return 1;
  }

  if (rightMissing) {
    return -1;
  }

  if (left === right) {
    return 0;
  }

  return direction === 'asc' ? left - right : right - left;
}

function toggleSort(key) {
  if (sortState.value.key === key) {
    sortState.value.direction = sortState.value.direction === 'desc' ? 'asc' : 'desc';
    return;
  }

  sortState.value = {
    key,
    direction: 'desc',
  };
}

function isSortActive(key) {
  return sortState.value.key === key;
}

function getSortButtonLabel(label, key) {
  if (!isSortActive(key)) {
    return `Sort by ${label}`;
  }

  return sortState.value.direction === 'desc'
    ? `Sort by ${label}, currently descending`
    : `Sort by ${label}, currently ascending`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return '-';
  }

  return Number(value).toFixed(2).replace(/\.00$/, '');
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return '-';
  }

  return `${Number(value).toFixed(2)}%`;
}

function getStatusMeta(status) {
  const normalizedStatus = String(status || '').trim().toUpperCase();

  if (normalizedStatus === 'COMPLETED') {
    return { label: 'Completed', className: 'result-status--completed' };
  }

  if (normalizedStatus === 'IN_PROGRESS') {
    return { label: 'In Progress', className: 'result-status--progress' };
  }

  if (normalizedStatus === 'EXPIRED') {
    return { label: 'Expired', className: 'result-status--expired' };
  }

  return { label: 'Not Started', className: 'result-status--muted' };
}

function hasSubmission(score) {
  return Boolean(score?.attemptId || score?.submittedAt || String(score?.status || '').trim());
}

function formatResultNumber(value, fallback = 'No result') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return fallback;
  }

  return formatNumber(value);
}

function formatResultPercent(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return 'No result';
  }

  return formatPercent(value);
}

function formatCompositeScore(score) {
  if (!hasScaledScoring(score)) {
    return formatRawTotal(score);
  }

  const composite = score?.compositeScore ?? score?.totalScaledScore;
  const maxScore = score?.compositeMaxScore;
  return maxScore ? formatScoreWithMax(composite, maxScore) : formatResultNumber(composite);
}

function formatSectionScore(score, sectionCode) {
  if (hasScaledScoring(score)) {
    const scaledScore = sectionCode === 'ELA'
      ? score?.elaScaledScore ?? score?.section1ScaledScore
      : score?.mathScaledScore ?? score?.section2ScaledScore;
    return formatResultNumber(scaledScore);
  }

  return formatRawSection(score, sectionCode);
}

function formatSectionDetail(score, sectionCode) {
  return hasScaledScoring(score)
    ? `Raw ${formatRawSection(score, sectionCode)}`
    : 'Raw score';
}

function formatRawTotal(score) {
  return formatScoreWithMax(score?.rawTotalScore ?? score?.totalScore,
    score?.rawTotalMaxScore ?? score?.totalRawMaxScore ?? SHSAT_TOTAL_RAW_MAX);
}

function formatRawSection(score, sectionCode) {
  const value = sectionCode === 'ELA'
    ? score?.elaRawScore ?? score?.section1Score
    : score?.mathRawScore ?? score?.section2Score;
  const maxScore = sectionCode === 'ELA'
    ? score?.elaRawMaxScore ?? SHSAT_SECTION_RAW_MAX
    : score?.mathRawMaxScore ?? SHSAT_SECTION_RAW_MAX;
  return formatScoreWithMax(value, maxScore);
}

function formatScoreWithMax(value, maxScore) {
  const formattedValue = formatResultNumber(value);
  if (formattedValue === 'No result') {
    return formattedValue;
  }

  return `${formattedValue} / ${formatNumber(maxScore)}`;
}

function isRawOnly(score) {
  return score?.scoringMode === 'RAW_ONLY';
}

function hasScaledScoring(score) {
  return !isRawOnly(score) && (score?.compositeScore ?? score?.totalScaledScore) !== null
    && (score?.compositeScore ?? score?.totalScaledScore) !== undefined;
}

function getScoringBadge(score) {
  if (score?.estimated) {
    return 'Estimated';
  }

  if (isRawOnly(score)) {
    return 'Raw-only';
  }

  return '';
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function formatDatePart(value) {
  if (!value) {
    return 'Not submitted';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatTimePart(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

onMounted(async () => {
  await loadPage();
  if (typeof ResizeObserver !== 'undefined' && resultTableWrap.value) {
    resultTableResizeObserver = new ResizeObserver(syncResultTableScrollMetrics);
    resultTableResizeObserver.observe(resultTableWrap.value);
  }
});

onBeforeUnmount(() => {
  resultTableResizeObserver?.disconnect();
});
</script>

<template>
  <AdminLayout>
    <section class="page-shell class-results-page">
      <section class="class-results-hero">
        <button class="class-results-back-button" type="button" @click="goBack">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 18 9 12l6-6"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>Back to Class Detail</span>
        </button>

        <div class="class-results-hero__main">
          <div class="class-results-hero__copy">
            <p class="page-subtitle">Class Exam Results</p>
            <h1 class="page-title">{{ examInfo?.examTitle || `Exam #${examId}` }}</h1>
            <p class="class-results-page__subtitle">
              {{ classInfo?.className || `Class #${classId}` }}
            </p>
          </div>
          <div class="class-results-hero__paper">
            <span>Paper</span>
              <strong>{{ examInfo?.paperName || 'Paper unavailable' }}</strong>
          </div>
          <div class="class-results-hero__actions">
            <AppButton variant="primary" @click="openExamMonitor">Monitor</AppButton>
          </div>
        </div>
      </section>

      <AppCard title="Result Summary" subtitle="This page shows one class and one exam release in context.">
        <div v-if="loading" class="admin-state">Loading class exam results...</div>
        <div v-else-if="errorMessage" class="admin-state admin-state--error">
          <p class="error-text">{{ errorMessage }}</p>
          <AppButton variant="secondary" @click="loadPage">Retry</AppButton>
        </div>
        <template v-else>
          <dl class="class-results-page__meta">
            <div v-for="item in resultContextItems" :key="item.label">
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>

          <div class="result-summary">
            <div class="result-summary__hero">
              <div class="result-summary__hero-copy">
                <span>Average Score</span>
                <strong>{{ summary.average }}</strong>
                <small>Across {{ summary.completed }} completed students in this class release</small>
              </div>
              <div class="result-summary__hero-pill">
                <span>Completion</span>
                <strong>{{ summary.completionRate }}</strong>
              </div>
            </div>
            <div class="result-summary__item">
              <span>Participants</span>
              <strong>{{ summary.participants }}</strong>
              <small>{{ summary.completed }} submitted results</small>
            </div>
            <div class="result-summary__item">
              <span>Highest Score</span>
              <strong>{{ summary.highest }}</strong>
              <small>Top score in this release</small>
            </div>
            <div class="result-summary__item">
              <span>Lowest Score</span>
              <strong>{{ summary.lowest }}</strong>
              <small>Lowest submitted score</small>
            </div>
            <div class="result-summary__item">
              <span>Score Spread</span>
              <strong>
                {{
                  summary.highest !== '-' && summary.lowest !== '-'
                    ? formatNumber(Number(summary.highest) - Number(summary.lowest))
                    : '-'
                }}
              </strong>
              <small>Difference between highest and lowest</small>
            </div>
          </div>
        </template>
      </AppCard>

      <AppCard title="Student Results" subtitle="Open a student to review their exam history and score trend.">
        <div v-if="loading" class="admin-state">Loading results...</div>
        <div v-else-if="errorMessage" class="admin-state admin-state--error">{{ errorMessage }}</div>
        <div v-else-if="scores.length === 0" class="admin-state">No submissions are available for this class and exam.</div>
        <div v-else class="result-table-panel">
          <div class="result-table-panel__header">
              <p class="result-table-panel__title">Student score comparison</p>
              <p class="result-table-panel__subtitle">{{ sortDescription }}</p>
          </div>

          <div ref="resultTableWrap" class="table-wrap result-table-wrap" @scroll="handleResultTableScroll">
            <table class="admin-table result-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Status</th>
                    <th>
                      <button
                        class="result-table__sort-button"
                        :class="{ 'result-table__sort-button--active': isSortActive('totalScore') }"
                        type="button"
                        :aria-label="getSortButtonLabel('total score', 'totalScore')"
                        @click="toggleSort('totalScore')"
                      >
                        <span>Total Score</span>
                        <span
                          class="result-table__sort-indicator"
                          :class="`result-table__sort-indicator--${isSortActive('totalScore') ? sortState.direction : 'idle'}`"
                          aria-hidden="true"
                        >
                          <span></span>
                          <span></span>
                        </span>
                      </button>
                    </th>
                    <th>
                      <span class="result-table__th-group">
                        <button
                          class="result-table__sort-button"
                          :class="{ 'result-table__sort-button--active': isSortActive('elaScore') }"
                          type="button"
                          :aria-label="getSortButtonLabel('ELA score', 'elaScore')"
                          @click="toggleSort('elaScore')"
                        >
                          <span>ELA Score</span>
                          <span
                            class="result-table__sort-indicator"
                            :class="`result-table__sort-indicator--${isSortActive('elaScore') ? sortState.direction : 'idle'}`"
                            aria-hidden="true"
                          >
                            <span></span>
                            <span></span>
                          </span>
                        </button>
                        <span
                          class="result-table__th-help"
                          tabindex="0"
                          data-tooltip="Main number uses the scaled score when available; the raw score is shown otherwise."
                          aria-label="Main number uses the scaled score when available; the raw score is shown otherwise."
                        >
                          ?
                        </span>
                      </span>
                    </th>
                    <th>
                      <span class="result-table__th-group">
                        <button
                          class="result-table__sort-button"
                          :class="{ 'result-table__sort-button--active': isSortActive('mathScore') }"
                          type="button"
                          :aria-label="getSortButtonLabel('Math score', 'mathScore')"
                          @click="toggleSort('mathScore')"
                        >
                          <span>Math Score</span>
                          <span
                            class="result-table__sort-indicator"
                            :class="`result-table__sort-indicator--${isSortActive('mathScore') ? sortState.direction : 'idle'}`"
                            aria-hidden="true"
                          >
                            <span></span>
                            <span></span>
                          </span>
                        </button>
                        <span
                          class="result-table__th-help"
                          tabindex="0"
                          data-tooltip="Main number uses the scaled score when available; the raw score is shown otherwise."
                          aria-label="Main number uses the scaled score when available; the raw score is shown otherwise."
                        >
                          ?
                        </span>
                      </span>
                    </th>
                    <th>
                      <span class="result-table__th-group">
                        Answered
                        <span
                          class="result-table__th-help"
                          tabindex="0"
                          data-tooltip="Large number = correct answers. Small text below = wrong answers and unanswered questions."
                          aria-label="Large number is correct answers. Small text below is wrong answers and unanswered questions."
                        >
                          ?
                        </span>
                      </span>
                    </th>
                    <th>Completion</th>
                    <th>
                      <button
                        class="result-table__sort-button"
                        :class="{ 'result-table__sort-button--active': isSortActive('accuracy') }"
                        type="button"
                        :aria-label="getSortButtonLabel('accuracy', 'accuracy')"
                        @click="toggleSort('accuracy')"
                      >
                        <span>Accuracy</span>
                        <span
                          class="result-table__sort-indicator"
                          :class="`result-table__sort-indicator--${isSortActive('accuracy') ? sortState.direction : 'idle'}`"
                          aria-hidden="true"
                        >
                          <span></span>
                          <span></span>
                        </span>
                      </button>
                    </th>
                    <th>
                      <button
                        class="result-table__sort-button"
                        :class="{ 'result-table__sort-button--active': isSortActive('submittedAt') }"
                        type="button"
                        :aria-label="getSortButtonLabel('submitted time', 'submittedAt')"
                        @click="toggleSort('submittedAt')"
                      >
                        <span>Submitted</span>
                        <span
                          class="result-table__sort-indicator"
                          :class="`result-table__sort-indicator--${isSortActive('submittedAt') ? sortState.direction : 'idle'}`"
                          aria-hidden="true"
                        >
                          <span></span>
                          <span></span>
                        </span>
                      </button>
                    </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="score in sortedScores"
                  :key="`${score.studentId}-${score.attemptId || 'empty'}`"
                  :class="{ 'result-table__row--pending': !hasSubmission(score) }"
                >
                  <td class="result-table__student-cell">
                    <span class="result-student-name">{{ score.studentName || 'Unnamed Student' }}</span>
                    <small v-if="score.studentNumber" class="result-student-meta">{{ score.studentNumber }}</small>
                    <small class="result-student-meta">
                      {{ score.attemptNumber ? `Attempt #${score.attemptNumber}` : 'No attempt' }}
                    </small>
                  </td>
                  <td>
                    <span class="result-status" :class="getStatusMeta(score.status).className">
                      {{ getStatusMeta(score.status).label }}
                    </span>
                  </td>
                  <td>
                    <strong v-if="hasSubmission(score)" class="result-score">{{ formatCompositeScore(score) }}</strong>
                    <small v-if="hasSubmission(score) && getScoringBadge(score)" class="result-badge">
                      {{ getScoringBadge(score) }}
                    </small>
                    <span v-else-if="!hasSubmission(score)" class="result-muted">No result</span>
                  </td>
                  <td>
                    <div v-if="hasSubmission(score)" class="result-section-cell">
                      <strong class="result-score">{{ formatSectionScore(score, 'ELA') }}</strong>
                      <small class="result-score-detail">
                        {{ formatSectionDetail(score, 'ELA') }}
                      </small>
                    </div>
                    <span v-else class="result-muted">No result</span>
                  </td>
                  <td>
                    <div v-if="hasSubmission(score)" class="result-section-cell">
                      <strong class="result-score">{{ formatSectionScore(score, 'MATH') }}</strong>
                      <small class="result-score-detail">
                        {{ formatSectionDetail(score, 'MATH') }}
                      </small>
                    </div>
                    <span v-else class="result-muted">No result</span>
                  </td>
                  <td>
                    <div v-if="hasSubmission(score)" class="result-answer-summary">
                      <strong>{{ score.correctCount || 0 }}</strong>
                      <small>{{ score.wrongCount || 0 }} wrong, {{ score.unansweredCount || 0 }} blank</small>
                    </div>
                    <span v-else class="result-muted">No result</span>
                  </td>
                  <td>
                    <strong v-if="hasSubmission(score)" class="result-percent">
                      {{ formatResultPercent(score.completionRate) }}
                    </strong>
                    <span v-else class="result-muted">No result</span>
                  </td>
                  <td>
                    <strong v-if="hasSubmission(score)" class="result-accuracy">{{ formatResultPercent(score.accuracy) }}</strong>
                    <span v-else class="result-muted">No result</span>
                  </td>
                  <td>
                    <span class="result-submitted-date">{{ formatDatePart(score.submittedAt) }}</span>
                    <small v-if="formatTimePart(score.submittedAt)" class="result-submitted-time">
                      {{ formatTimePart(score.submittedAt) }}
                    </small>
                  </td>
                  <td class="result-table__actions">
                    <AppButton class="result-view-button" variant="secondary" @click="openStudentDetail(score)">View</AppButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="resultTableScrollMax > 0" class="result-table-scrollbar" aria-label="Student results horizontal scroll">
            <input
              type="range"
              min="0"
              :max="resultTableScrollMax"
              step="1"
              :value="resultTableScrollLeft"
              aria-label="Scroll Student Results horizontally"
              @input="handleResultTableScrollbarInput"
            />
          </div>
        </div>
      </AppCard>

    </section>
  </AdminLayout>
</template>

<style scoped>
.class-results-page {
  display: grid;
  gap: 22px;
  max-width: var(--page-container-width, 1320px);
}

.class-results-hero {
  display: grid;
  gap: 12px;
  border: 1px solid rgba(207, 224, 255, 0.9);
  border-radius: 18px;
  padding: 16px 18px;
  background:
    linear-gradient(135deg, rgba(47, 111, 237, 0.08), rgba(255, 255, 255, 0) 44%),
    #ffffff;
  box-shadow: 0 16px 38px rgba(31, 75, 135, 0.08);
}

.class-results-back-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
  gap: 8px;
  min-height: 34px;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  padding: 0 12px 0 9px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.class-results-back-button svg {
  width: 18px;
  height: 18px;
}

.class-results-hero__main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.class-results-hero__copy {
  min-width: 0;
}

.class-results-hero .page-subtitle {
  margin-bottom: 6px;
}

.class-results-hero .page-title {
  display: -webkit-box;
  max-width: 760px;
  overflow: hidden;
  font-size: clamp(20px, 2.2vw, 26px);
  line-height: 1.18;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.class-results-page__subtitle {
  margin: 8px 0 0;
  color: var(--color-muted);
  font-size: 14px;
}

.class-results-hero__paper {
  flex: 0 0 150px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.84);
}

.class-results-hero__paper span {
  display: block;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.class-results-hero__paper strong {
  display: -webkit-box;
  margin-top: 4px;
  overflow: hidden;
  color: var(--color-text);
  font-size: 13px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.class-results-hero__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
}

.class-results-page__meta,
.result-summary {
  display: grid;
  gap: 14px;
  margin: 0;
}

.class-results-page__meta {
  grid-template-columns: 1.1fr 1fr 1.4fr;
  margin-bottom: 14px;
}

.class-results-page__meta div {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 12px;
  background: #fbfdff;
}

.class-results-page__meta div:first-child {
  background: linear-gradient(180deg, #f8fbff, #fbfdff);
}

.result-summary__item {
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 16px;
  background: #ffffff;
}

.result-summary__hero {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 16px;
  border: 1px solid #cfe0ff;
  border-radius: 18px;
  padding: 18px;
  background: linear-gradient(135deg, #f2f7ff, #ffffff 62%);
}

.result-summary__hero-copy {
  min-width: 0;
}

.result-summary__hero-pill {
  display: grid;
  min-width: 126px;
  align-content: center;
  justify-items: center;
  border: 1px solid rgba(47, 111, 237, 0.14);
  border-radius: 16px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.88);
}

.class-results-page__meta dt,
.result-summary span,
.result-summary__hero span {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.class-results-page__meta dd,
.result-summary strong,
.result-summary__hero strong {
  display: block;
  margin: 4px 0 0;
  font-weight: 800;
}

.class-results-page__meta dd {
  display: -webkit-box;
  overflow: hidden;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.result-summary {
  grid-template-columns: 1.6fr repeat(4, minmax(0, 1fr));
}

.result-summary strong,
.result-summary__hero-pill strong {
  color: var(--color-text);
  font-size: 22px;
  line-height: 1.1;
}

.result-summary__hero-copy strong {
  color: var(--color-primary-strong);
  font-size: 30px;
}

.result-summary small,
.result-summary__hero small {
  display: block;
  margin-top: 5px;
  color: var(--color-muted);
  font-size: 12px;
}

.admin-state {
  display: grid;
  min-height: 120px;
  place-items: center;
  gap: 12px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: 20px;
  color: var(--color-muted);
  background: rgba(247, 250, 255, 0.72);
  text-align: center;
}

.admin-state--error {
  color: var(--color-danger);
  border-color: rgba(199, 55, 71, 0.22);
  background: rgba(199, 55, 71, 0.04);
}

.table-wrap {
  overflow-x: auto;
}

.result-table-panel {
  display: grid;
  gap: 14px;
}

.result-table-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.result-table-panel__title {
  margin: 0;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 800;
}

.result-table-panel__subtitle {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  text-align: right;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
}

.admin-table th,
.admin-table td {
  border-bottom: 1px solid var(--color-border);
  padding: 12px 10px;
  text-align: center;
  vertical-align: top;
}

.admin-table th:first-child,
.admin-table td:first-child { text-align: left; }

.admin-table th {
  text-align: center;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.result-table-wrap {
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: #ffffff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
  scrollbar-color: #9aaac0 #edf2f8;
  scrollbar-width: auto;
}

.result-table-wrap::-webkit-scrollbar {
  height: 12px;
}

.result-table-wrap::-webkit-scrollbar-track {
  border-radius: 6px;
  background: #edf2f8;
}

.result-table-wrap::-webkit-scrollbar-thumb {
  border: 2px solid #edf2f8;
  border-radius: 6px;
  background: #9aaac0;
}

.result-table-wrap::-webkit-scrollbar-thumb:hover {
  background: #7287a4;
}

.result-table-scrollbar {
  display: flex;
  align-items: center;
  min-height: 24px;
  padding: 0 4px;
}

.result-table-scrollbar input {
  width: 100%;
  height: 18px;
  margin: 0;
  accent-color: var(--color-primary-strong);
  cursor: ew-resize;
}

.result-table {
  min-width: 1080px;
}

.result-table th {
  padding: 10px 12px;
  background: #f7faff;
  letter-spacing: 0.02em;
}

.result-table__th-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.result-table__sort-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  padding: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.result-table__sort-button:hover,
.result-table__sort-button:focus-visible,
.result-table__sort-button--active {
  color: var(--color-text);
}

.result-table__sort-indicator {
  display: grid;
  gap: 2px;
  width: 8px;
}

.result-table__sort-indicator span {
  display: block;
  width: 0;
  height: 0;
  border-right: 4px solid transparent;
  border-left: 4px solid transparent;
  opacity: 0.28;
}

.result-table__sort-indicator span:first-child {
  border-bottom: 5px solid #94a3b8;
}

.result-table__sort-indicator span:last-child {
  border-top: 5px solid #94a3b8;
}

.result-table__sort-indicator--asc span:first-child,
.result-table__sort-indicator--desc span:last-child {
  opacity: 1;
}

.result-table__sort-indicator--asc span:first-child {
  border-bottom-color: var(--color-primary-strong);
}

.result-table__sort-indicator--desc span:last-child {
  border-top-color: var(--color-primary-strong);
}

.result-table__th-help {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: 1px solid #c7d4e8;
  border-radius: 999px;
  color: #64748b;
  background: #f8fbff;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  cursor: help;
}

.result-table__th-help::after {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 20;
  width: max-content;
  max-width: 220px;
  border-radius: 8px;
  padding: 7px 9px;
  color: #ffffff;
  background: #1f2937;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
  content: attr(data-tooltip);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  text-transform: none;
  letter-spacing: normal;
  white-space: normal;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -4px);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.result-table__th-help:hover::after,
.result-table__th-help:focus::after {
  opacity: 1;
  transform: translate(-50%, 0);
}

.result-table td {
  padding: 12px;
  vertical-align: middle;
}

.result-table tbody tr {
  transition:
    background 140ms ease,
    box-shadow 140ms ease;
}

.result-table tbody tr:hover {
  background: #f8fbff;
  box-shadow: inset 3px 0 0 rgba(47, 111, 237, 0.24);
}

.result-table__row--pending {
  color: #667085;
  background: #fcfdff;
}

.result-table__student-cell {
  min-width: 180px;
}

.result-student-name,
.result-submitted-date {
  display: block;
  color: var(--color-text);
  font-weight: 800;
  line-height: 1.3;
}

.result-student-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-student-meta,
.result-submitted-time {
  display: block;
  margin-top: 3px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
}

.result-badge {
  display: block;
  margin-top: 3px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.result-muted {
  color: #8a97aa;
  font-size: 13px;
  font-weight: 700;
}

.result-percent {
  color: var(--color-text);
  font-size: 14px;
  font-weight: 800;
}

.result-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 800;
}

.result-status--completed {
  color: #166534;
  background: #dcfce7;
}

.result-status--progress {
  color: #1d4ed8;
  background: #dbeafe;
}

.result-status--expired {
  color: #9a3412;
  background: #ffedd5;
}

.result-status--muted {
  color: #64748b;
  background: #eef2f7;
}

.result-score,
.result-accuracy {
  color: var(--color-text);
  font-size: 16px;
  font-weight: 900;
}

.result-accuracy {
  color: var(--color-primary-strong);
}

.result-section-cell,
.result-answer-summary {
  display: grid;
  gap: 2px;
}

.result-score-detail,
.result-answer-summary small {
  color: #52627a;
  font-size: 12px;
  font-weight: 700;
}

.result-answer-summary strong {
  color: var(--color-text);
  font-size: 15px;
  font-weight: 900;
}

.result-table__actions {
  text-align: right;
}

.result-view-button {
  min-height: 36px;
  padding: 0 20px;
  font-size: 13px;
}

.class-results-hero__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 900px) {
  .class-results-hero__main {
    align-items: flex-start;
    flex-direction: column;
  }

  .class-results-hero__paper {
    width: 100%;
    flex-basis: auto;
  }

  .class-results-hero__actions {
    width: 100%;
  }

  .class-results-hero__actions :deep(button) {
    width: 100%;
  }

  .class-results-page__meta,
  .result-summary {
    grid-template-columns: 1fr;
  }

  .result-summary__hero,
  .result-table-panel__header {
    flex-direction: column;
  }

  .result-summary__hero-pill {
    justify-items: start;
  }

  .result-table-panel__subtitle {
    text-align: left;
  }

}
</style>
