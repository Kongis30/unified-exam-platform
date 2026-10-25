<template>
  <div class="transition-page">
    <h1 class="title">This Module Is Over</h1>
    <p class="text">All your work has been saved.</p>
    <p class="text">You'll move on automatically in just a moment.</p>
    <p class="text">Do not refresh this page or quit the app.</p>
    <div class="spinner" aria-label="loading"></div>
  </div>
</template>

<script>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useExamFlowStore } from '../stores/examFlow.js'
import { examApi } from '../api/exam.js'
export default {
  name: 'ModuleTransition',
  setup() {
    const router = useRouter()
    const route = useRoute()
    const flow = useExamFlowStore()
    onMounted(async () => {
      try {
        if (!flow.recordId && route.query.recordId) {
          const recordId = Number(route.query.recordId)
          const snapshot = await examApi.getProgress(recordId)
          await flow.initFromProgress(snapshot.paperId, recordId, snapshot)
        }
      } catch (error) {
        console.error('Unable to restore SAT exam progress:', error)
        router.replace({ name: 'exam-type', params: { code: 'SAT' } })
        return
      }
      if (!flow.recordId) {
        router.replace({ name: 'exam-type', params: { code: 'SAT' } })
        return
      }
      setTimeout(() => {
        // 携带考试上下文跳转，保证硬刷新后仍可断点续考
        const query = { recordId: flow.recordId }
        if (flow.examId) query.examId = flow.examId
        if (flow.paperId) query.mode = flow.resume?.mode === 'practice' ? 'practice' : 'exam'
        router.push({ path: '/student/sat/exams/' + (flow.examId || route.query.examId), query })
      }, 1500)
    })
    return {}
  }
}
</script>

<style scoped>
.transition-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #f7f8fa;
  color: #2c3e50;
  text-align: center;
}

.title {
  color: #3666f2;
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 16px;
}

.text {
  font-size: 14px;
  color: #4a4a4a;
  margin: 6px 0;
}

.spinner {
  margin-top: 24px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid rgba(0,0,0,0.1);
  border-top-color: #3666f2;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
