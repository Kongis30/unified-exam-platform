<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import AppCard from '@/components/AppCard.vue'
import { getExamTypes, getPlatformHealth } from '@/api/platform'
import { authState } from '@/auth'
import { groupExamTypesIntoWorkspaces } from '@/examTypes/workspaces'

const examTypes = ref([])
const workspaces = computed(() => groupExamTypesIntoWorkspaces(examTypes.value))
const apiStatus = ref('checking')
const loadError = ref('')

// 首页信息来自模块注册表，新增考试类型后可直接从这里进入对应工作区。
async function loadPlatformOverview() {
  try {
    const [health, types] = await Promise.all([getPlatformHealth(), getExamTypes()])
    apiStatus.value = health.status === 'UP' ? 'online' : 'degraded'
    examTypes.value = types
  } catch (error) {
    apiStatus.value = 'offline'
    loadError.value = error instanceof Error ? error.message : 'Unable to connect to the platform API.'
  }
}

onMounted(loadPlatformOverview)
</script>

<template>
  <main class="page-shell dashboard-page">
    <header class="management-heading dashboard-heading">
      <div>
        <span class="eyebrow">SHARED EXAM MANAGEMENT</span>
        <h1>Platform overview</h1>
        <p>Manage shared accounts and classes, then work with papers and releases by system and program.</p>
      </div>
      <span class="section-counter">{{ workspaces.length }} EXAM SYSTEMS</span>
    </header>

    <AppCard title="Platform status" subtitle="Shared identity and classroom services for every registered exam type.">
      <div class="platform-status">
        <span class="status-mark" :class="`status-${apiStatus}`"></span>
        <strong v-if="apiStatus === 'online'">Connected</strong>
        <strong v-else-if="apiStatus === 'checking'">Connecting</strong>
        <strong v-else-if="apiStatus === 'degraded'">Partially available</strong>
        <strong v-else>Unavailable</strong>
        <span>Unified accounts enabled</span>
      </div>
      <p v-if="loadError" class="error-text">{{ loadError }} Start the backend service and try again.</p>
    </AppCard>

    <section class="dashboard-section">
      <header class="dashboard-section__heading">
        <div>
          <h2>Exam workspaces</h2>
          <p>Each exam program keeps its own papers and releases inside its system workspace.</p>
        </div>
      </header>

      <div v-if="workspaces.length" class="type-grid" aria-label="Exam systems">
        <AppCard v-for="workspace in workspaces" :key="workspace.code" class="type-card">
          <span class="card-code">{{ workspace.programs.map((program) => program.code).join(' · ') }}</span>
          <h3>{{ workspace.displayName }}</h3>
          <p>{{ workspace.summary }}</p>
          <RouterLink class="type-card__link" :to="['ADMIN', 'TEACHER'].includes(authState.user?.roleCode) && ['SHSAT', 'SAT'].includes(workspace.code)
            ? { name: workspace.code === 'SHSAT' ? 'shsat-admin' : 'sat-admin' }
            : { name: 'exam-type', params: { code: workspace.code } }">
            Open workspace <span aria-hidden="true">↗</span>
          </RouterLink>
        </AppCard>
      </div>
      <AppCard v-else-if="apiStatus === 'online'" title="No exam systems are available">
        <p class="status-note">Register an exam type module and enable it in the catalog.</p>
      </AppCard>
      <AppCard v-else title="Loading exam types">
        <p class="status-note">Connecting to the platform API…</p>
      </AppCard>
    </section>
  </main>
</template>
