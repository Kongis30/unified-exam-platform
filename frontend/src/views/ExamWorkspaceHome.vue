<script setup>
import { computed, defineAsyncComponent, nextTick, onActivated } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { authState } from '@/auth'

const props = defineProps({ code: { type: String, required: true } })
const ExamTypePage = defineAsyncComponent(() => import('@/views/ExamTypePage.vue'))
const ShsatAdminHome = defineAsyncComponent(() => import('@shsat/admin/pages/AdminHome.vue'))
const SatAdminHome = defineAsyncComponent(() => import('@/examTypes/sat/admin/SatAdminHome.vue'))
const isStudent = computed(() => authState.user?.roleCode === 'STUDENT')
const route = useRoute()
const router = useRouter()
let savedScrollY = 0
let visited = false

// 只缓存模块首页；再次进入时恢复位置，不缓存正式考试页面。
onBeforeRouteLeave(() => { savedScrollY = window.scrollY })
onActivated(async () => {
  if (!visited) { visited = true; return }
  const scrollKey = route.query.historyScrollY !== undefined ? 'historyScrollY'
    : route.query.releaseScrollY !== undefined ? 'releaseScrollY' : ''
  const requestedScroll = scrollKey ? Number(route.query[scrollKey]) : savedScrollY
  const scrollY = Number.isFinite(requestedScroll) && requestedScroll >= 0 ? requestedScroll : savedScrollY
  await nextTick()
  window.requestAnimationFrame(() => window.scrollTo(window.scrollX, scrollY))
  if (scrollKey) {
    const query = { ...route.query }
    delete query[scrollKey]
    router.replace({ query, hash: route.hash })
  }
})
</script>

<template>
  <ExamTypePage v-if="isStudent" :key="code" :code="props.code" />
  <ShsatAdminHome v-else-if="code === 'SHSAT'" />
  <SatAdminHome v-else :code="props.code" />
</template>
