<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import AppCard from '@/components/AppCard.vue'
import AppButton from '@/components/AppButton.vue'
import AppModal from '@/components/AppModal.vue'
import { getExamTypes } from '@/api/platform'
import { authState } from '@/auth'
import { getExamSystemCards } from '@/examTypes/workspaces'

const examTypes = ref([])
const systems = computed(() => getExamSystemCards(examTypes.value))
const isLoading = ref(true)
const loadError = ref('')
const selectedSystem = ref(null)

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
        <span class="eyebrow">EXAM SYSTEMS</span>
        <h1>Choose an exam system</h1>
        <p>Select a system to continue. Your account permissions determine which systems you can open.</p>
      </div>
      <span class="section-counter">{{ systems.length }} EXAM SYSTEMS</span>
    </header>

    <section class="dashboard-section">
      <header class="dashboard-section__heading">
        <div>
          <h2>Available systems</h2>
          <p>Explore the exam programs offered by Jin Exam System.</p>
        </div>
      </header>

      <AppCard v-if="isLoading" title="Loading exam systems">
        <p class="status-note">Connecting to the platform API…</p>
      </AppCard>
      <AppCard v-else-if="loadError" title="Unable to load exam systems">
        <p class="error-text">{{ loadError }}</p>
      </AppCard>
      <div v-else-if="systems.length" class="type-grid" aria-label="Exam systems">
        <AppCard v-for="system in systems" :key="system.code" class="type-card">
          <h3>{{ system.displayName }}</h3>
          <p>{{ system.summary }}</p>
          <RouterLink
            v-if="system.available"
            class="type-card__link"
            :to="['ADMIN', 'TEACHER'].includes(authState.user?.roleCode) && ['SHSAT', 'SAT', 'PSAT'].includes(system.code)
              ? { name: `${system.code.toLowerCase()}-admin` }
              : ['ADMIN', 'TEACHER'].includes(authState.user?.roleCode)
                ? { name: 'exam-type', params: { code: system.code } }
                : { name: 'student-workspace', params: { code: system.code } }">
            Open workspace <span aria-hidden="true">↗</span>
          </RouterLink>
          <button
            v-else
            class="type-card__link type-card__link--restricted"
            type="button"
            aria-haspopup="dialog"
            @click="selectedSystem = system">
            Select system <span aria-hidden="true">↗</span>
          </button>
        </AppCard>
      </div>
      <AppCard v-else title="No exam systems are available">
        <p class="status-note">Register an exam type module and enable it in the catalog.</p>
      </AppCard>
    </section>

    <AppModal
      v-if="selectedSystem"
      title="Access unavailable"
      :description="`You do not have permission to access the ${selectedSystem.displayName} exam system. Please contact your administrator if you need access.`"
      @close="selectedSystem = null">
      <template #footer>
        <AppButton variant="primary" @click="selectedSystem = null">Close</AppButton>
      </template>
    </AppModal>
  </main>
</template>

<style scoped>
.type-card__link--restricted {
  border: 0;
  padding: 18px 0 0;
  color: var(--color-primary-strong);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  text-align: left;
}
</style>
