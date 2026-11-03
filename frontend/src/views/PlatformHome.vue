<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import AppCard from '@/components/AppCard.vue'
import { getExamTypes } from '@/api/platform'
import { authState } from '@/auth'
import { groupExamTypesIntoWorkspaces } from '@/examTypes/workspaces'

const examTypes = ref([])
const workspaces = computed(() => groupExamTypesIntoWorkspaces(examTypes.value))
const isLoading = ref(true)
const loadError = ref('')

// 首页信息来自模块注册表，新增考试类型后可直接从这里进入对应工作区。
async function loadPlatformOverview() {
  try {
    examTypes.value = await getExamTypes()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Unable to connect to the platform API.'
  } finally {
    isLoading.value = false
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
          <RouterLink class="type-card__link" :to="['ADMIN', 'TEACHER'].includes(authState.user?.roleCode) && ['SHSAT', 'SAT', 'PSAT'].includes(workspace.code)
            ? { name: `${workspace.code.toLowerCase()}-admin` }
            : { name: 'exam-type', params: { code: workspace.code } }">
            Open workspace <span aria-hidden="true">↗</span>
          </RouterLink>
        </AppCard>
      </div>
      <AppCard v-else-if="isLoading" title="Loading exam systems">
        <p class="status-note">Connecting to the platform API…</p>
      </AppCard>
      <AppCard v-else-if="loadError" title="Unable to load exam systems">
        <p class="error-text">{{ loadError }}</p>
      </AppCard>
      <AppCard v-else title="No exam systems are available">
        <p class="status-note">Register an exam type module and enable it in the catalog.</p>
      </AppCard>
    </section>
  </main>
</template>
