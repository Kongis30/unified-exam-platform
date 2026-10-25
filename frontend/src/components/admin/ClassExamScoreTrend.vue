<script setup>
import { computed, ref, watch } from 'vue'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import { listClassExamScoreTrend } from '@/api/platform'

const props = defineProps({
  classId: { type: [String, Number], required: true },
  examTypeCodes: { type: Array, required: true },
})

const loading = ref(false)
const error = ref('')
const rows = ref([])
const hoveredPoint = ref(null)
const scoreMetric = ref('scaled')

const chart = computed(() => {
  const width = 760
  const height = 320
  const padding = { top: 28, right: 24, bottom: 48, left: 54 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const points = [...rows.value]
    .map((row) => {
      const score = scoreMetric.value === 'scaled' ? row.averageScaledScore : row.averageRawScore
      return { ...row, averageScore: score == null ? Number.NaN : Number(score), timestamp: new Date(row.examDate).getTime() }
    })
    .filter((row) => Number.isFinite(row.averageScore) && Number.isFinite(row.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp)

  const lowestScore = points.reduce((score, point) => Math.min(score, point.averageScore), points[0]?.averageScore ?? 0)
  const highestScore = points.reduce((score, point) => Math.max(score, point.averageScore), points[0]?.averageScore ?? 0)
  const dataRange = highestScore - lowestScore
  const scorePadding = dataRange === 0 ? (scoreMetric.value === 'scaled' ? 10 : 1) : dataRange * 0.12
  const step = niceStep((dataRange + scorePadding * 2) / 5)
  const min = Math.max(scoreMetric.value === 'raw' ? 0 : -Infinity,
    Math.floor((lowestScore - scorePadding) / step) * step)
  const max = Math.ceil((highestScore + scorePadding) / step) * step
  const range = max - min
  const yTicks = Array.from({ length: Math.round(range / step) + 1 }, (_, index) => {
    const value = min + step * index
    return { value, y: padding.top + plotHeight - ((value - min) / range) * plotHeight }
  })
  const plottedPoints = points.map((point, index) => ({
    ...point,
    x: padding.left + (points.length > 1 ? (plotWidth / (points.length - 1)) * index : plotWidth / 2),
    y: padding.top + plotHeight - ((point.averageScore - min) / range) * plotHeight,
  }))

  return {
    width, height, padding, yTicks, points: plottedPoints,
    baselineY: padding.top + plotHeight,
    linePath: plottedPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
  }
})

function niceStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const fraction = value / magnitude
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude
}

// 由图表容器负责加载：切换班级或考试模块时重新请求对应的成绩序列。
async function loadTrend() {
  loading.value = true
  error.value = ''
  hoveredPoint.value = null
  try {
    const response = await listClassExamScoreTrend(props.classId, props.examTypeCodes)
    rows.value = Array.isArray(response) ? response : response?.items || response?.records || []
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load class score trend.'
  } finally {
    loading.value = false
  }
}

function tooltipStyle(point) {
  const side = point.x <= chart.value.width * 0.25 ? 'left'
    : point.x >= chart.value.width * 0.75 ? 'right' : 'center'
  const left = side === 'right' ? 'calc(100% - 12px)' : `${(point.x / chart.value.width) * 100}%`
  const translateX = side === 'left' ? '12px' : side === 'right' ? 'calc(-100% - 12px)' : '-50%'
  const top = `${(point.y / chart.value.height) * 100}%`
  const translateY = point.y < 100 ? '8px' : 'calc(-100% - 10px)'
  return { left, top, transform: `translate(${translateX}, ${translateY})` }
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '')
}

function formatAxisNumber(value) {
  return Number(value).toFixed(1).replace(/\.0$/, '')
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric' }).format(date)
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

watch(() => `${props.classId}:${props.examTypeCodes.join(',')}`, loadTrend, { immediate: true })
watch(scoreMetric, () => { hoveredPoint.value = null })
</script>

<template>
  <AppCard title="Class Exam Score Trend" subtitle="Compare class averages for completed SAT and PSAT exams.">
    <div v-if="loading" class="admin-state">Loading score trend...</div>
    <div v-else-if="error" class="admin-state admin-state--error">
      <p class="error-text">{{ error }}</p>
      <AppButton variant="secondary" @click="loadTrend">Retry</AppButton>
    </div>
    <div v-else>
      <div v-if="rows.length" class="score-trend-toolbar">
        <label for="class-score-metric">Score shown</label>
        <select id="class-score-metric" v-model="scoreMetric">
          <option value="scaled">Scaled score</option>
          <option value="raw">Raw score</option>
        </select>
        <span>{{ scoreMetric === 'scaled' ? 'SAT 400–1600 · PSAT 320–1520' : 'Raw score is the number of correct answers' }}</span>
      </div>
      <div v-if="chart.points.length" class="class-score-chart-wrap">
        <svg
          class="class-score-chart"
          :viewBox="`0 0 ${chart.width} ${chart.height}`"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Class average exam scores over time"
        >
          <g class="class-score-chart__grid">
            <line
              v-for="tick in chart.yTicks"
              :key="`grid-${tick.value}`"
              :x1="chart.padding.left" :y1="tick.y"
              :x2="chart.width - chart.padding.right" :y2="tick.y"
            />
          </g>
          <g class="class-score-chart__axis-label">
            <text
              v-for="tick in chart.yTicks"
              :key="`y-${tick.value}`"
              :x="chart.padding.left - 10" :y="tick.y"
              text-anchor="end" dominant-baseline="middle"
            >{{ formatAxisNumber(tick.value) }}</text>
          </g>
          <path v-if="chart.points.length > 1" class="class-score-chart__line" :d="chart.linePath" />
          <g
            v-for="point in chart.points"
            :key="point.examId"
            tabindex="0" role="img"
            :aria-label="`${point.examTypeCode}, ${point.examTitle}, average ${scoreMetric} score ${formatNumber(point.averageScore)}, exam date ${formatDateTime(point.examDate)}`"
            @mouseenter="hoveredPoint = point" @mouseleave="hoveredPoint = null"
            @focus="hoveredPoint = point" @blur="hoveredPoint = null"
          >
            <circle class="class-score-chart__point" :cx="point.x" :cy="point.y" r="5" />
            <text class="class-score-chart__value" :x="point.x" :y="point.y - 12" text-anchor="middle">{{ formatNumber(point.averageScore) }}</text>
            <text class="class-score-chart__axis-label" :x="point.x" :y="chart.baselineY + 18" text-anchor="middle">{{ formatDate(point.examDate) }}</text>
          </g>
        </svg>
        <div v-if="hoveredPoint" class="class-score-chart__tooltip" :style="tooltipStyle(hoveredPoint)" role="status">
          <strong><span class="score-type-badge">{{ hoveredPoint.examTypeCode }}</span>{{ hoveredPoint.examTitle }}</strong>
          <span>Average {{ scoreMetric }} score: {{ formatNumber(hoveredPoint.averageScore) }}</span>
          <span>Exam date: {{ formatDateTime(hoveredPoint.examDate) }}</span>
          <span>Completed students: {{ hoveredPoint.studentCount }}</span>
        </div>
      </div>
      <p v-else class="admin-state">
        {{ rows.length ? `No ${scoreMetric} score data is available for these completed exams.` : 'No completed exam scores to chart yet.' }}
      </p>
    </div>
  </AppCard>
</template>

<style scoped>
.class-score-chart-wrap { position: relative; }
.score-trend-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  color: var(--color-muted);
  font-size: 13px;
}
.score-trend-toolbar label { color: var(--color-text); font-weight: 600; }
.score-trend-toolbar select {
  min-height: 34px;
  padding: 0 30px 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  background: #fff;
  font: inherit;
}
.class-score-chart {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: #fbfdff;
}
.class-score-chart__grid line { stroke: var(--color-border); stroke-width: 1; }
.class-score-chart__axis-label { fill: var(--color-muted); font-size: 11px; }
.class-score-chart__line {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 3;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.class-score-chart__point { fill: var(--color-primary); stroke: #fff; stroke-width: 2; cursor: pointer; }
.class-score-chart__value { fill: var(--color-text); font-size: 12px; font-weight: 700; }
.class-score-chart__tooltip {
  position: absolute;
  z-index: 2;
  display: grid;
  gap: 4px;
  width: max-content;
  max-width: min(320px, calc(100% - 24px));
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  background: #fff;
  box-shadow: 0 8px 24px rgba(21, 41, 74, .16);
  font-size: 13px;
  line-height: 1.4;
  pointer-events: none;
}
.class-score-chart__tooltip strong { color: var(--color-primary-strong); }
.score-type-badge {
  display: inline-flex;
  margin-right: 7px;
  padding: 2px 6px;
  border-radius: 999px;
  color: var(--color-primary-strong);
  background: #edf3ff;
  font-size: 10px;
  letter-spacing: .04em;
  vertical-align: 1px;
}
@media (max-width: 560px) {
  .score-trend-toolbar { flex-wrap: wrap; gap: 8px; }
  .score-trend-toolbar span { flex-basis: 100%; }
  .class-score-chart__axis-label { font-size: 22px; }
  .class-score-chart__value { font-size: 26px; }
}
</style>
