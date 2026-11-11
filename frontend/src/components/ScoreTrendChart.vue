<script setup>
import { computed, ref } from 'vue'

/**
 * 单学生分数趋势折线图，纯渲染组件。
 *
 * 不取数、不计算统计、不含 raw/scaled 切换——那些由 ScoreTrendCard 负责。
 * 本组件只负责把「已排好序的分数点」画成可读的成长曲线，
 * 供学生首页与管理端学生详情共用，保证三处外观一致。
 */
const props = defineProps({
  points: { type: Array, default: () => [] },
  unit: { type: String, default: 'SCALED' },
})

const hovered = ref(null)

// 横向密度固定：点数多时撑宽容器并横向滚动，不压缩点间距。
const POINT_SPACING = 72
const WIDTH_MIN = 760
const HEIGHT = 320
const PADDING = { top: 28, right: 24, bottom: 48, left: 54 }

function scoreOf(point) {
  const value = Number(point?.score)
  return Number.isFinite(value) ? value : Number.NaN
}

const scoredPoints = computed(() => (Array.isArray(props.points) ? props.points : [])
  .filter((point) => Number.isFinite(scoreOf(point))
    && point?.submittedAt
    && Number.isFinite(new Date(point.submittedAt).getTime())))

const chart = computed(() => {
  const width = Math.max(WIDTH_MIN, POINT_SPACING * Math.max(0, scoredPoints.value.length - 1) + POINT_SPACING)
  const plotWidth = width - PADDING.left - PADDING.right
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom
  const rows = scoredPoints.value

  const scores = rows.map(scoreOf)
  let min = scores.length ? Math.floor(Math.min(...scores)) : 0
  let max = scores.length ? Math.ceil(Math.max(...scores)) : 0
  if (min === max) {
    // 所有分数相同或只有一个点时，上下各留一格，避免线贴在边框上。
    min = Math.max(0, min - 1)
    max += 1
  }
  const range = max - min
  const points = rows.map((row, index) => ({
    ...row,
    score: scoreOf(row),
    x: PADDING.left + (rows.length > 1 ? (plotWidth * index) / (rows.length - 1) : plotWidth / 2),
    y: PADDING.top + plotHeight - ((scoreOf(row) - min) / range) * plotHeight,
    // 首点向右、末点向左，避免值标签被图表边缘裁掉。
    labelAnchor: rows.length > 1 && index === 0 ? 'start'
      : rows.length > 1 && index === rows.length - 1 ? 'end' : 'middle',
    labelDx: rows.length > 1 && index === 0 ? 12 : rows.length > 1 && index === rows.length - 1 ? -12 : 0,
  }))

  const tickCount = Math.min(6, Math.max(2, range + 1))
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const value = Math.round(min + (range * index) / (tickCount - 1))
    return { value, y: PADDING.top + plotHeight - ((value - min) / range) * plotHeight }
  })

  return {
    width,
    ticks,
    points,
    baseline: PADDING.top + plotHeight,
    line: points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
  }
})

const hasLine = computed(() => chart.value.points.length > 1)

const unitLabel = computed(() => {
  if (props.unit === 'CORRECT') return 'Raw score'
  if (props.unit === 'POINTS') return 'Raw score'
  return 'Scaled score'
})

function formatScore(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : '—'
}

function formatShortDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

function pointLabel(point) {
  const max = point.scoreMax ? ` / ${formatScore(point.scoreMax)}` : ''
  return `${point.examTitle || 'Exam'}, attempt ${point.attemptNumber}, `
    + `${unitLabel.value} ${formatScore(point.score)}${max}, submitted ${formatDateTime(point.submittedAt)}`
}

// tooltip 贴在点旁并按位置避让，避免超出图表边界。
function tooltipStyle(point) {
  return {
    left: `${(point.x / chart.value.width) * 100}%`,
    top: `${(point.y / HEIGHT) * 100}%`,
  }
}

function tooltipClasses(point) {
  return {
    'is-below': point.y < 90,
    'is-left': point.x > chart.value.width * 0.75,
    'is-right': point.x < chart.value.width * 0.25,
  }
}
</script>

<template>
  <div class="score-trend-chart">
    <p class="score-trend-chart__hint">Swipe horizontally to view all scores.</p>
    <div class="score-trend-chart__scroll" tabindex="0" aria-label="Score trend chart">
      <div class="score-trend-chart__frame" :style="{ minWidth: `${chart.width}px` }">
        <svg class="score-trend-chart__svg" :viewBox="`0 0 ${chart.width} ${HEIGHT}`" role="img"
          aria-label="Score trend over time">
          <g class="score-trend-chart__grid">
            <template v-for="tick in chart.ticks" :key="`tick-${tick.value}`">
              <line :x1="PADDING.left" :x2="chart.width - PADDING.right" :y1="tick.y" :y2="tick.y" />
              <text class="score-trend-chart__axis" :x="PADDING.left - 10" :y="tick.y" text-anchor="end"
                dominant-baseline="middle">{{ tick.value }}</text>
            </template>
          </g>
          <path v-if="hasLine" class="score-trend-chart__line" :d="chart.line" />
          <g v-for="point in chart.points" :key="point.attemptId" class="score-trend-chart__point-group"
            tabindex="0" role="img" :aria-label="pointLabel(point)"
            @mouseenter="hovered = point" @mouseleave="hovered = null"
            @focus="hovered = point" @blur="hovered = null">
            <circle class="score-trend-chart__hit" :cx="point.x" :cy="point.y" r="12" />
            <circle class="score-trend-chart__dot" :cx="point.x" :cy="point.y" r="5" />
            <text class="score-trend-chart__value" :x="point.x + point.labelDx" :y="point.y - 12"
              :text-anchor="point.labelAnchor">{{ formatScore(point.score) }}</text>
            <text class="score-trend-chart__axis" :x="point.x" :y="chart.baseline + 18"
              text-anchor="middle">{{ formatShortDate(point.submittedAt) }}</text>
          </g>
        </svg>
        <div v-if="hovered" class="score-trend-chart__tooltip" :class="tooltipClasses(hovered)"
          :style="tooltipStyle(hovered)" role="tooltip">
          <strong>{{ hovered.examTitle || 'Exam' }}</strong>
          <span>{{ formatDateTime(hovered.submittedAt) }}</span>
          <span>
            Attempt {{ hovered.attemptNumber }} · {{ unitLabel }} {{ formatScore(hovered.score) }}<template
              v-if="hovered.scoreMax"> / {{ formatScore(hovered.scoreMax) }}</template>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.score-trend-chart__hint {
  display: none;
  margin: 0 0 8px;
  color: var(--color-muted);
  font-size: 12px;
}
.score-trend-chart__scroll { max-width: 100%; overflow-x: auto; }
.score-trend-chart__frame { position: relative; width: 100%; }
.score-trend-chart__svg {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: #fbfdff;
}
.score-trend-chart__grid line { stroke: var(--color-border); stroke-width: 1; }
.score-trend-chart__axis { fill: var(--color-muted); font-size: 11px; }
.score-trend-chart__line {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 3;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.score-trend-chart__hit { fill: transparent; cursor: pointer; }
.score-trend-chart__dot {
  fill: var(--color-primary);
  stroke: #fff;
  stroke-width: 2;
  pointer-events: none;
}
.score-trend-chart__value {
  fill: var(--color-text);
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
}
.score-trend-chart__point-group:focus { outline: none; }
.score-trend-chart__point-group:focus-visible .score-trend-chart__dot {
  stroke: #173f91;
  stroke-width: 3;
}
.score-trend-chart__tooltip {
  position: absolute;
  z-index: 2;
  display: grid;
  gap: 4px;
  min-width: 150px;
  max-width: 240px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 9px 11px;
  color: var(--color-text);
  background: #fff;
  box-shadow: 0 8px 24px rgba(23, 32, 51, 0.14);
  font-size: 12px;
  line-height: 1.4;
  pointer-events: none;
  transform: translate(-50%, calc(-100% - 10px));
}
.score-trend-chart__tooltip span { color: var(--color-muted); }
.score-trend-chart__tooltip.is-below { transform: translate(-50%, 12px); }
.score-trend-chart__tooltip.is-left { transform: translate(calc(-100% + 10px), calc(-100% - 10px)); }
.score-trend-chart__tooltip.is-right { transform: translate(-10px, calc(-100% - 10px)); }
.score-trend-chart__tooltip.is-left.is-below { transform: translate(calc(-100% + 10px), 12px); }
.score-trend-chart__tooltip.is-right.is-below { transform: translate(-10px, 12px); }

@media (max-width: 640px) {
  .score-trend-chart__hint { display: block; }
  .score-trend-chart__axis { font-size: 18px; }
  .score-trend-chart__value { font-size: 20px; }
}
</style>
