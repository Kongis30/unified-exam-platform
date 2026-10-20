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

const chart = computed(() => {
  const width = 760
  const height = 320
  const padding = { top: 28, right: 24, bottom: 48, left: 54 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const points = [...rows.value]
    .map((row) => ({
      ...row,
      averageScore: Number(row.averageScore),
      timestamp: new Date(row.examDate).getTime(),
    }))
    .filter((row) => Number.isFinite(row.averageScore))
    .sort((left, right) => left.timestamp - right.timestamp)

  const lowestScore = points.reduce((score, point) => Math.min(score, point.averageScore), points[0]?.averageScore ?? 0)
  const highestScore = points.reduce((score, point) => Math.max(score, point.averageScore), points[0]?.averageScore ?? 0)
  const min = lowestScore === highestScore ? Math.max(0, lowestScore - 1) : lowestScore
  const max = lowestScore === highestScore ? highestScore + 1 : highestScore
  const range = max - min
  const yTicks = Array.from({ length: 6 }, (_, index) => {
    const value = min + (range / 5) * index
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
  const left = side === 'left' ? '12px'
    : side === 'right' ? 'calc(100% - 12px)' : `${(point.x / chart.value.width) * 100}%`
  const translateX = side === 'left' ? '0' : side === 'right' ? '-100%' : '-50%'
  const top = `${(point.y / chart.value.height) * 100}%`
  const translateY = point.y < 100 ? '8px' : 'calc(-100% - 10px)'
  return { left, top, transform: `translate(${translateX}, ${translateY})` }
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '')
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
</script>

<template>
  <AppCard title="Class Exam Score Trend" subtitle="Average score for each completed exam, ordered from earliest to latest.">
    <div v-if="loading" class="admin-state">Loading score trend...</div>
    <div v-else-if="error" class="admin-state admin-state--error">
      <p class="error-text">{{ error }}</p>
      <AppButton variant="secondary" @click="loadTrend">Retry</AppButton>
    </div>
    <div v-else-if="chart.points.length === 0" class="admin-state">No completed exam scores to chart yet.</div>
    <div v-else class="class-score-chart-wrap">
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
          >{{ formatNumber(tick.value) }}</text>
        </g>
        <path v-if="chart.points.length > 1" class="class-score-chart__line" :d="chart.linePath" />
        <g
          v-for="point in chart.points"
          :key="point.examId"
          tabindex="0" role="img"
          :aria-label="`${point.examTitle}, average score ${formatNumber(point.averageScore)}, exam date ${formatDateTime(point.examDate)}`"
          @mouseenter="hoveredPoint = point" @mouseleave="hoveredPoint = null"
          @focus="hoveredPoint = point" @blur="hoveredPoint = null"
        >
          <circle class="class-score-chart__point" :cx="point.x" :cy="point.y" r="5" />
          <text class="class-score-chart__value" :x="point.x" :y="point.y - 12" text-anchor="middle">{{ formatNumber(point.averageScore) }}</text>
          <text class="class-score-chart__axis-label" :x="point.x" :y="chart.baselineY + 18" text-anchor="middle">{{ formatDate(point.examDate) }}</text>
        </g>
      </svg>
      <div v-if="hoveredPoint" class="class-score-chart__tooltip" :style="tooltipStyle(hoveredPoint)" role="status">
        <strong>{{ hoveredPoint.examTitle }}</strong>
        <span>Average score: {{ formatNumber(hoveredPoint.averageScore) }}</span>
        <span>Exam date: {{ formatDateTime(hoveredPoint.examDate) }}</span>
        <span>Completed students: {{ hoveredPoint.studentCount }}</span>
      </div>
    </div>
  </AppCard>
</template>

<style scoped>
.class-score-chart-wrap { position: relative; }
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
</style>
