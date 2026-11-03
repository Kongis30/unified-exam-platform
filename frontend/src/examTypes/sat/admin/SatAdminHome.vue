<script setup>
import ExamTypePage from '@/views/ExamTypePage.vue'
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const code = computed(() => route.name === 'psat-admin' ? 'PSAT' : 'SAT')
</script>

<template>
  <ExamTypePage :key="code" :code="code" />
</template>
