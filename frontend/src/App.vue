<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

import { authState } from './auth'
import { clearSessionCache, getExamTypes, logout, SESSION_CHANGE_KEY } from './api/platform'
import AccountMenu from './components/AccountMenu.vue'
import AdminLayout from './components/admin/AdminLayout.vue'
import { groupExamTypesIntoWorkspaces } from './examTypes/workspaces'

const router = useRouter()
const route = useRoute()
const examTypes = ref([])
const workspaces = computed(() => groupExamTypesIntoWorkspaces(examTypes.value))
const isExamRoute = computed(() => [
  'student-exam', 'shsat-student-exam', 'sat-student-exam', 'sat-exam-break',
  'sat-module-wait', 'sat-report-wait',
].includes(route.name))
const isStaff = computed(() => ['ADMIN', 'TEACHER'].includes(authState.user?.roleCode))
const isPaperView = computed(() => ['sat-paper-preview', 'psat-paper-preview', 'sat-paper-export',
  'psat-paper-export', 'admin-paper-preview', 'admin-paper-export'].includes(route.name))
const isWorkspaceHome = (viewRoute) => ['sat-admin', 'psat-admin', 'shsat-admin'].includes(viewRoute.name)
const workspaceKey = (viewRoute) => `${authState.user?.username}:${authState.user?.roleCode}:${viewRoute.name}`

function workspaceRoute(code) {
  if (['ADMIN', 'TEACHER'].includes(authState.user?.roleCode)) {
    return ['SHSAT', 'SAT', 'PSAT'].includes(code)
      ? { name: `${code.toLowerCase()}-admin` }
      : { name: 'exam-type', params: { code } }
  }
  return { name: 'student-workspace', params: { code } }
}

// 主导航按注册表声明的工作区归并项目，新增系统后无需再改写导航。
watch([() => authState.user?.username, () => route.fullPath], async ([username], previous) => {
  if (previous?.[0] !== username) examTypes.value = []
  if (!username || isStaff.value) return
  try {
    const types = await getExamTypes()
    if (authState.user?.username === username) examTypes.value = types
  } catch {
    if (authState.user?.username === username) examTypes.value = []
  }
}, { immediate: true })

async function signOut() {
  try {
    await logout()
  } finally {
    authState.user = null
    authState.loaded = true
    router.push({ name: 'login' })
  }
}

function handleSessionChange(event) {
  if (event.key !== SESSION_CHANGE_KEY) return
  clearSessionCache()
  authState.user = null
  authState.loaded = false
  router.replace({ name: 'login' })
}
onMounted(() => window.addEventListener('storage', handleSessionChange))
onBeforeUnmount(() => window.removeEventListener('storage', handleSessionChange))
</script>

<template>
  <RouterView v-if="$route.name === 'login'" />
  <RouterView v-else-if="isPaperView" />
  <AdminLayout v-else-if="isStaff && !isExamRoute">
    <RouterView v-slot="{ Component, route: viewRoute }">
      <KeepAlive :max="3"><component :is="Component" v-if="isWorkspaceHome(viewRoute)" :key="workspaceKey(viewRoute)" /></KeepAlive>
      <component :is="Component" v-if="!isWorkspaceHome(viewRoute)" />
    </RouterView>
  </AdminLayout>
  <div v-else class="main-layout" :class="{ 'main-layout--exam': isExamRoute }">
    <header v-if="!isExamRoute" class="main-layout__header">
      <RouterLink class="main-layout__brand" to="/" aria-label="Jin Exam System home">
        <span class="main-layout__mark"><img src="/logo.png" alt="" /></span>
        <span>
          <strong>Jin Exam System</strong>
          <small>Assessment Platform</small>
        </span>
      </RouterLink>

      <nav class="main-layout__nav" aria-label="Main navigation">
        <RouterLink :to="{ name: 'home' }">
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
      <RouterView v-slot="{ Component, route: viewRoute }">
        <KeepAlive :max="3"><component :is="Component" v-if="isWorkspaceHome(viewRoute)" :key="workspaceKey(viewRoute)" /></KeepAlive>
        <component :is="Component" v-if="!isWorkspaceHome(viewRoute)" />
      </RouterView>
    </main>
  </div>
</template>
