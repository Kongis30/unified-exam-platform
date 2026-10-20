<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import AppCard from '@/components/AppCard.vue'
import { getExamTypes } from '@/api/platform'
import { groupExamTypesIntoWorkspaces } from '@/examTypes/workspaces'

const types = ref([])
const error = ref('')
const isLoading = ref(true)
const systems = computed(() => groupExamTypesIntoWorkspaces(types.value))

onMounted(async () => {
  try {
    types.value = await getExamTypes()
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load exam systems.'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <main class="page-shell student-system-select">
    <header class="student-system-select__heading">
      <span class="eyebrow">ASSESSMENT SYSTEMS</span>
      <h1>Choose your exam system</h1>
      <p>Select the system for your assigned exams.</p>
    </header>

    <section class="student-system-select__grid" aria-label="Exam systems">
      <AppCard v-for="system in systems" :key="system.code" class="student-system-card">
        <span class="student-system-card__code">{{ system.code }}</span>
        <h2>{{ system.displayName }}</h2>
        <p>{{ system.summary }}</p>
        <RouterLink class="student-system-card__link" :to="{ name: 'student-workspace', params: { code: system.code } }">
          Enter {{ system.displayName }} <span aria-hidden="true">↗</span>
        </RouterLink>
      </AppCard>
    </section>
    <p v-if="isLoading" class="loading-state"><span class="loading-rule"></span>Loading exam systems…</p>
    <p v-else-if="error" class="form-error page-message" role="alert">{{ error }}</p>
    <p v-else-if="!systems.length" class="table-empty">No exam systems are available.</p>
  </main>
</template>

<style scoped>
.student-system-select { display: grid; gap: 28px; padding-top: clamp(28px, 6vh, 72px); }
.student-system-select__heading { display: grid; gap: 8px; text-align: center; }
.student-system-select__heading h1 { margin: 0; color: var(--color-text); font-size: clamp(28px, 4vw, 40px); letter-spacing: -0.04em; }
.student-system-select__heading p { margin: 0; color: var(--color-muted); }
.student-system-select__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; max-width: 940px; width: 100%; margin: 0 auto; }
.student-system-card { display: flex; min-height: 250px; flex-direction: column; align-items: flex-start; }
.student-system-card__code { color: var(--color-primary-strong); font-size: 12px; font-weight: 800; letter-spacing: 0.14em; }
.student-system-card h2 { margin: 16px 0 4px; color: var(--color-text); font-size: 28px; letter-spacing: -0.035em; }
.student-system-card p { margin: 0 0 28px; color: var(--color-muted); }
.student-system-card__link { display: inline-flex; align-items: center; gap: 12px; margin-top: auto; border-radius: 999px; padding: 10px 15px; color: #fff; background: linear-gradient(110deg, #2f6fed, #5b86f5); box-shadow: 0 10px 22px rgba(47, 111, 237, 0.2); font-size: 14px; font-weight: 750; }
.student-system-card__link:hover { background: var(--color-primary-strong); }
@media (max-width: 650px) { .student-system-select__grid { grid-template-columns: 1fr; } .student-system-card { min-height: 210px; } }
</style>
