<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import { authState } from './auth'
import { getExamTypes, logout } from './api/platform'
import AccountMenu from './components/AccountMenu.vue'
import { groupExamTypesIntoWorkspaces } from './examTypes/workspaces'

const router = useRouter()
const route = useRoute()
const examTypes = ref([])
const workspaces = computed(() => groupExamTypesIntoWorkspaces(examTypes.value))
const isExamRoute = computed(() => [
  'student-exam', 'shsat-student-exam', 'sat-student-exam', 'sat-exam-break',
  'sat-module-wait', 'sat-report-wait',
].includes(route.name))
const isStaffReportRoute = computed(() => ['ADMIN', 'TEACHER'].includes(authState.user?.roleCode)
  && ['sat-student-scores', 'sat-exam-results', 'sat-report'].includes(route.name))
const hasOwnAdminLayout = computed(() => route.name?.startsWith('admin-')
  || ['shsat-admin', 'sat-admin', 'sat-paper-edit', 'sat-admin-exam-monitor', 'sat-student-scores',
    'sat-exam-results', 'student-attempt-report'].includes(route.name)
  || isStaffReportRoute.value)

function workspaceRoute(code) {
  if (['ADMIN', 'TEACHER'].includes(authState.user?.roleCode)) {
    return { name: code === 'SHSAT' ? 'shsat-admin' : 'sat-admin' }
  }
  return { name: 'student-workspace', params: { code } }
}

// 主导航按注册表声明的工作区归并项目，新增系统后无需再改写导航。
onMounted(async () => {
  try {
    examTypes.value = await getExamTypes()
  } catch {
    examTypes.value = []
  }
})

async function signOut() {
  try {
    await logout()
  } finally {
    authState.user = null
    authState.loaded = true
    router.push({ name: 'login' })
  }
}
</script>

<template>
  <RouterView v-if="$route.name === 'login'" />
  <RouterView v-else-if="hasOwnAdminLayout" />
  <div v-else class="main-layout" :class="{ 'main-layout--exam': isExamRoute }">
    <header v-if="!isExamRoute" class="main-layout__header">
      <RouterLink class="main-layout__brand" to="/" aria-label="Unified Exam Platform home">
        <span class="main-layout__mark"><img src="/logo.png" alt="" /></span>
        <span>
          <strong>Unified Exam</strong>
          <small>Assessment Platform</small>
        </span>
      </RouterLink>

      <nav class="main-layout__nav" aria-label="Main navigation">
        <RouterLink :to="authState.user?.roleCode === 'STUDENT' ? { name: 'student-systems' } : { name: 'home' }">
          {{ authState.user?.roleCode === 'STUDENT' ? 'Systems' : 'Overview' }}
        </RouterLink>
        <RouterLink v-if="authState.user?.roleCode === 'ADMIN'" to="/users">Accounts</RouterLink>
        <RouterLink
          v-for="workspace in workspaces"
          :key="workspace.code"
          :to="workspaceRoute(workspace.code)"
        >
          {{ workspace.displayName }}
        </RouterLink>
      </nav>

      <div class="main-layout__user">
        <AccountMenu @sign-out="signOut" />
      </div>
    </header>

    <main class="main-layout__content">
      <RouterView />
    </main>
  </div>
</template>
