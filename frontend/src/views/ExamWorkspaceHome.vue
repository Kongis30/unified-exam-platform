<script setup>
import { computed, defineAsyncComponent } from 'vue'
import { authState } from '@/auth'

const props = defineProps({ code: { type: String, required: true } })
const ExamTypePage = defineAsyncComponent(() => import('@/views/ExamTypePage.vue'))
const ShsatAdminHome = defineAsyncComponent(() => import('@shsat/admin/pages/AdminHome.vue'))
const SatAdminHome = defineAsyncComponent(() => import('@/examTypes/sat/admin/SatAdminHome.vue'))
const isStudent = computed(() => authState.user?.roleCode === 'STUDENT')
</script>

<template>
  <ExamTypePage v-if="isStudent" :key="code" :code="props.code" />
  <ShsatAdminHome v-else-if="code === 'SHSAT'" />
  <SatAdminHome v-else />
</template>
