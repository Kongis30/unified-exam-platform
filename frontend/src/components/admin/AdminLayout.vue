<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AccountMenu from '@/components/AccountMenu.vue'
import { authState } from '@/auth'
import { getExamTypes, logout } from '@/api/platform'
import { groupExamTypesIntoWorkspaces } from '@/examTypes/workspaces'

const route = useRoute()
const router = useRouter()
const examTypes = ref([])
const signingOut = ref(false)
const showSignOutConfirm = ref(false)
const workspaces = computed(() => groupExamTypesIntoWorkspaces(examTypes.value))
const isAdmin = computed(() => authState.user?.roleCode === 'ADMIN')
const workspaceQueries = reactive({ SAT: {}, PSAT: {} })
const currentModuleCode = computed(() => (route.path.match(/^\/(sat|psat|shsat)(?:\/|$)/i)?.[1]
  || route.path.match(/^\/exam-types\/([^/]+)\/admin(?:\/|$)/)?.[1] || '').toUpperCase())

watch([() => authState.user?.username, () => route.fullPath], async ([username], previous) => {
  if (previous && previous[0] !== username) { workspaceQueries.SAT = {}; workspaceQueries.PSAT = {} }
  if (!username) { examTypes.value = []; return }
  const code = route.name === 'sat-admin' ? 'SAT' : route.name === 'psat-admin' ? 'PSAT' : ''
  if (code) workspaceQueries[code] = { ...route.query }
  try {
    const types = await getExamTypes()
    if (authState.user?.username === username) examTypes.value = types
  } catch {
    // 临时网络错误不清空已有导航；下次路由变化会再次尝试。
  }
}, { immediate: true })

function workspaceRoute(code) {
  if (code === 'SHSAT') return { name: 'shsat-admin' }
  if (code === 'SAT') return { name: 'sat-admin', query: workspaceQueries.SAT }
  if (code === 'PSAT') return { name: 'psat-admin', query: workspaceQueries.PSAT }
  return { name: 'exam-type', params: { code } }
}

// 统一后台退出流程：确认后清除服务端会话，再返回登录页。
async function signOut() {
  if (signingOut.value) return
  signingOut.value = true
  try {
    await logout()
  } finally {
    authState.user = null
    authState.loaded = true
    await router.replace({ name: 'login' })
  }
}
</script>

<template>
  <div class="admin-layout">
    <header class="admin-layout__header">
      <RouterLink class="admin-layout__brand" to="/" exact-active-class="router-link-active">
        <span class="admin-layout__mark"><img src="/logo.png" alt="" /></span>
        <span><strong>Jin Exam System</strong><small>Assessment Platform</small></span>
      </RouterLink>

      <nav class="admin-layout__nav" aria-label="Main navigation">
        <RouterLink to="/" exact-active-class="router-link-active">System Select</RouterLink>
        <RouterLink v-if="isAdmin" to="/users" exact-active-class="router-link-active">Accounts</RouterLink>
        <RouterLink
          v-for="workspace in workspaces"
          :key="workspace.code"
          :to="workspaceRoute(workspace.code)"
          :class="{ 'router-link-active': currentModuleCode === workspace.code }"
        >
          {{ ['SHSAT', 'SAT'].includes(workspace.code) ? workspace.code : workspace.displayName }}
        </RouterLink>
      </nav>

      <div class="admin-layout__user">
        <AccountMenu @sign-out="showSignOutConfirm = true" />
      </div>
    </header>

    <main class="admin-layout__content"><slot /></main>

    <Teleport to="body">
      <div v-if="showSignOutConfirm" class="admin-layout__modal" @click.self="showSignOutConfirm = false">
        <section class="admin-layout__modal-card" role="dialog" aria-modal="true" aria-labelledby="admin-signout-title">
          <h2 id="admin-signout-title">Confirm Sign Out</h2>
          <p>You will need to sign in again to continue.</p>
          <footer>
            <AppButton variant="secondary" type="button" @click="showSignOutConfirm = false">Cancel</AppButton>
            <AppButton type="button" :disabled="signingOut" @click="signOut">
              {{ signingOut ? 'Signing Out...' : 'Sign Out' }}
            </AppButton>
          </footer>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-layout { min-height: 100vh; }
.admin-layout__header {
  position: sticky; top: 0; z-index: 10; display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; gap: 24px; border-bottom: 1px solid rgba(219, 230, 247, .86);
  padding: 14px var(--space-page); background: rgba(255, 255, 255, .88); backdrop-filter: blur(16px);
}
.admin-layout__brand { display: inline-flex; align-items: center; gap: 12px; }
.admin-layout__brand strong, .admin-layout__brand small { display: block; }
.admin-layout__brand strong { color: var(--color-text); font-size: 14px; letter-spacing: -.02em; }
.admin-layout__brand small { color: var(--color-muted); font-size: 12px; }
.admin-layout__mark {
  display: inline-grid; width: 42px; height: 42px; place-items: center; overflow: hidden;
  border: 1px solid rgba(219, 230, 247, .9); border-radius: 14px; background: #fff;
  box-shadow: 0 12px 24px rgba(47, 111, 237, .16);
}
.admin-layout__mark img { width: 100%; height: 100%; object-fit: contain; }
.admin-layout__nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.admin-layout__nav a {
  border-radius: 999px; padding: 8px 14px; color: var(--color-muted); font-size: 14px; font-weight: 700;
  transition: color 160ms ease, background 160ms ease;
}
.admin-layout__nav a:hover, .admin-layout__nav a.router-link-active { color: var(--color-primary-strong); background: var(--color-primary-soft); }
.admin-layout__user { display: flex; align-items: center; gap: 8px; color: var(--color-muted); font-size: 14px; }
.admin-layout__user-name { padding-inline: 6px; }
.admin-layout__content { min-width: 0; overflow-x: clip; padding: var(--space-page); }
.admin-layout__modal {
  position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 24px;
  background: rgba(12, 24, 44, .45);
}
.admin-layout__modal-card {
  width: min(380px, 100%); border: 1px solid rgba(219, 230, 247, .9); border-radius: 22px;
  padding: 24px; background: #fff; box-shadow: 0 24px 60px rgba(12, 24, 44, .22);
}
.admin-layout__modal-card h2, .admin-layout__modal-card p { margin: 0; }
.admin-layout__modal-card h2 { font-size: 20px; }
.admin-layout__modal-card p { margin-top: 6px; color: var(--color-muted); font-size: 14px; }
.admin-layout__modal-card footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
@media (max-width: 900px) {
  .admin-layout__header { grid-template-columns: 1fr auto; }
  .admin-layout__nav {
    grid-column: 1 / -1; grid-row: 2; justify-content: flex-start; flex-wrap: nowrap;
    min-width: 0; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .admin-layout__nav::-webkit-scrollbar { display: none; }
  .admin-layout__nav a { flex: 0 0 auto; white-space: nowrap; }
}
@media (max-width: 480px) {
  .admin-layout__nav { gap: 4px; }
  .admin-layout__nav a { padding: 7px 9px; font-size: 13px; }
}
@media print {
  .admin-layout__header { display: none; }
  .admin-layout__content { overflow: visible; padding: 0; }
}
</style>
