<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { getExamTypes } from '@/api/platform'

const props = defineProps({
  code: { type: String, required: true },
})

const examTypes = ref([])
const loadError = ref('')
const isLoading = ref(true)
const selectedType = computed(() => examTypes.value.find((item) => item.code === props.code))

onMounted(async () => {
  try {
    examTypes.value = await getExamTypes()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '暂时无法连接后端服务'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="page-content type-page-content">
    <RouterLink class="back-link" to="/">← 返回类型目录</RouterLink>
    <section v-if="selectedType" class="module-intro">
      <div class="eyebrow"><span class="eyebrow-line"></span>REGISTERED EXAM MODULE</div>
      <span class="module-code">{{ selectedType.code }}</span>
      <h1>{{ selectedType.displayName }}</h1>
      <p>{{ selectedType.summary }}</p>
      <div class="module-notice">
        <span class="notice-mark">01</span>
        <div>
          <strong>类型模块已注册</strong>
          <p>此阶段已建立类型路由和目录契约。试卷编辑、考试发布与学生考试流程会按实施计划逐步接入。</p>
        </div>
      </div>
    </section>
    <section v-else class="module-intro">
      <div class="eyebrow"><span class="eyebrow-line"></span>EXAM MODULE</div>
      <h1>{{ isLoading ? '正在读取类型目录' : loadError ? '暂时无法读取类型目录' : '类型未注册' }}</h1>
      <p>{{ isLoading ? '正在连接平台 API…' : loadError || `后端当前没有注册 ${code} 类型。` }}</p>
      <RouterLink class="primary-link" to="/">返回工作空间</RouterLink>
    </section>
  </div>
</template>
