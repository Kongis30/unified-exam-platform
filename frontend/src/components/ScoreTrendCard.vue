<script setup>
import { computed, ref, watch } from 'vue'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ScoreTrendChart from '@/components/ScoreTrendChart.vue'
import { listStudentScoreTrend } from '@/api/platform'

/**
 * 学生首页的分数趋势卡片。
 *
 * 只展示学生本人的考试里程，因此后端只按 student_user_id 取数，
 * 卡片不出现班级平均、排名或任何横向对比。
 *
 * 一次请求拿到 scaled 与 raw 两条序列，切换纯本地完成。
 */
const props = defineProps({
  examTypeCode: { type: String, required: true },
  // 是否折叠卡身（仅保留标题）；由父组件持久化
  collapsed: { type: Boolean, default: false },
})

// 通知父组件切换折叠状态
const emit = defineEmits(['toggle-collapse'])

const loading = ref(false)
const error = ref('')
const trend = ref(null)
const metric = ref('SCALED')
let request = 0

const scaledSeries = computed(() => trend.value?.scaled ?? null)
const rawSeries = computed(() => trend.value?.raw ?? null)

// 默认量表分；无量表分（如 SHSAT 的 RAW_ONLY 档案）时退到原始分。
const availableMetrics = computed(() => ['SCALED', 'RAW'].filter((key) => seriesOf(key)?.available))

const activeSeries = computed(() => seriesOf(metric.value))

const statistics = computed(() => trend.value?.statistics ?? { totalAttempts: 0, completedAttempts: 0 })

const hasAnyAttempts = computed(() => Number(statistics.value.totalAttempts) > 0)

const showSwitcher = computed(() => availableMetrics.value.length > 1)

const scoreUnavailable = computed(() => hasAnyAttempts.value && availableMetrics.value.length === 0)
const excludedNote = computed(() => {
  const excluded = trend.value?.excluded
  if (!excluded) return ''
  const notes = []
  if (Number(excluded.notVisible) > 0) {
    notes.push(`${excluded.notVisible} attempt${Number(excluded.notVisible) === 1 ? '' : 's'} `
      + 'not shown yet because the score has not been opened.')
  }
  if (Number(excluded.notScored) > 0) {
    notes.push(`${excluded.notScored} attempt${Number(excluded.notScored) === 1 ? '' : 's'} `
      + 'not shown because grading is not finished.')
  }
  return notes.join(' ')
})

const rawOnlyNote = computed(() => (metric.value === 'RAW' && !scaledSeries.value?.available && hasAnyAttempts.value
  ? 'This exam system does not use a scaled score table, so raw scores are shown.'
  : ''))

const subtitle = computed(() => (metric.value === 'SCALED'
  ? 'Your scaled score over time, earliest to latest. Only your own formal exams are included.'
  : 'Your raw score over time, earliest to latest. Only your own formal exams are included.'))

function seriesOf(key) {
  return key === 'RAW' ? rawSeries.value : scaledSeries.value
}

function metricLabel(key) {
  return key === 'RAW' ? 'Raw score' : 'Scaled score'
}

function formatStat(value) {
  return value === null || value === undefined ? '—' : String(Math.round(Number(value)))
}

async function load({ force = false } = {}) {
  const current = ++request
  loading.value = true
  error.value = ''
  try {
    const response = await listStudentScoreTrend(props.examTypeCode, { force })
    if (current !== request) return
    trend.value = response
    // 量表分不可用时自动切到原始分，避免停在一条空曲线上。
    const available = ['SCALED', 'RAW'].filter((key) => (key === 'RAW' ? response?.raw : response?.scaled)?.available)
    metric.value = available.includes(metric.value) ? metric.value : (available[0] || 'SCALED')
  } catch (requestError) {
    if (current !== request) return
    error.value = requestError.message || 'Unable to load your score trend.'
    trend.value = null
  } finally {
    if (current === request) loading.value = false
  }
}

watch(() => props.examTypeCode, () => load(), { immediate: true })
</script>

<template>
  <AppCard class="score-trend-card" title="Score Trend" :subtitle="subtitle">
    <template #actions>
      <button class="score-trend-card__refresh" type="button" aria-label="Refresh score trend"
        title="Refresh score trend" :disabled="loading" @click="load({ force: true })">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor"
            d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a6.98 6.98 0 0 0 6.32-4Z" />
        </svg>
      </button>
      <button class="collapse-arrow-button" type="button"
        :aria-label="collapsed ? 'Expand score trend' : 'Collapse score trend'" :aria-expanded="!collapsed"
        :title="collapsed ? 'Expand' : 'Collapse'" @click="emit('toggle-collapse')">
        <svg class="collapse-arrow-button__icon" :class="{ 'collapse-arrow-button__icon--collapsed': collapsed }"
          viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="m7.4 14.6 4.6-4.6 4.6 4.6L18 13.2l-6-6-6 6 1.4 1.4Z" />
        </svg>
      </button>
    </template>

    <template v-if="!collapsed">
    <p v-if="loading && !trend" class="score-trend-card__state">Loading score trend...</p>
    <div v-else-if="error" class="score-trend-card__state score-trend-card__state--error">
      <p class="error-text" role="alert">{{ error }}</p>
      <AppButton variant="secondary" @click="load({ force: true })">Retry</AppButton>
    </div>

    <template v-else>
      <dl class="score-trend-card__stats">
        <div class="score-trend-stat">
          <dt>Total attempts</dt>
          <dd>{{ formatStat(statistics.totalAttempts) }}</dd>
        </div>
        <div class="score-trend-stat">
          <dt>Completed</dt>
          <dd>{{ formatStat(statistics.completedAttempts) }}</dd>
        </div>
        <div class="score-trend-stat">
          <dt>Average score</dt>
          <dd>{{ formatStat(activeSeries?.average) }}</dd>
        </div>
        <div class="score-trend-stat">
          <dt>Highest score</dt>
          <dd>{{ formatStat(activeSeries?.highest) }}</dd>
        </div>
      </dl>

      <div v-if="showSwitcher" class="score-trend-card__switcher" role="group" aria-label="Score type">
        <button v-for="key in availableMetrics" :key="key" type="button" class="score-trend-switch"
          :class="{ 'score-trend-switch--active': metric === key }" :aria-pressed="metric === key"
          @click="metric = key">{{ metricLabel(key) }}</button>
      </div>

      <ScoreTrendChart v-if="activeSeries?.points?.length" :points="activeSeries.points"
        :unit="activeSeries.unit" />

      <p v-else-if="scoreUnavailable" class="score-trend-card__state">
        Your scores are not available yet. Check back after your teacher opens them.
      </p>
      <p v-else-if="!hasAnyAttempts" class="score-trend-card__state">No completed exams to chart yet.</p>
      <p v-else class="score-trend-card__state">
        No {{ metric === 'RAW' ? 'raw' : 'scaled' }} scores to chart yet.
      </p>

      <p v-if="rawOnlyNote" class="score-trend-card__note">{{ rawOnlyNote }}</p>
      <p v-if="excludedNote" class="score-trend-card__note">{{ excludedNote }}</p>
    </template>
    </template>
  </AppCard>
</template>

<style scoped>
.score-trend-card__refresh {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid #d4e2ff;
  border-radius: 50%;
  background: #edf3ff;
  color: #2563eb;
  cursor: pointer;
}
.score-trend-card__refresh svg { width: 16px; height: 16px; }
.score-trend-card__refresh:disabled { cursor: wait; opacity: .55; }

.score-trend-card__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0 0 18px;
}
.score-trend-stat {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  background: #fff;
}
.score-trend-stat dt {
  margin: 0 0 6px;
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.score-trend-stat dd {
  margin: 0;
  color: var(--color-text);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
}

.score-trend-card__switcher {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px;
  background: var(--color-surface-soft);
}
.score-trend-switch {
  border: 0;
  border-radius: 999px;
  padding: 6px 14px;
  color: var(--color-muted);
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.score-trend-switch--active {
  color: #fff;
  background: var(--color-primary);
}

.score-trend-card__state { margin: 0; padding: 12px 2px; color: var(--color-muted); font-size: 14px; }
.score-trend-card__state--error { display: grid; justify-items: start; gap: 10px; }
.score-trend-card__note {
  margin: 10px 0 0;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .score-trend-card__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .score-trend-card__stats { grid-template-columns: minmax(0, 1fr); }
}
</style>
