<script setup>
import ExamTypePage from '@/views/ExamTypePage.vue'
defineProps({ code: { type: String, required: true } })
</script>

<template>
  <ExamTypePage :key="code" :code="code" />
</template>
