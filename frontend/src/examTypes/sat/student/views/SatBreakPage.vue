<template>
  <div class="break-page">
    <div class="left">
      <div class="timer-box">
        <div class="label">Remaining Break Time:</div>
        <div class="time">{{ formattedTime }}</div>
      </div>
      <button class="resume-btn" @click="resume">Resume Testing</button>
    </div>
    <div class="right">
      <h2 class="title">Practice Test Break</h2>
      <p class="subtitle">You can resume this practice test as soon as you’re ready to move on. On test day, you’ll wait until the clock counts down. Read below to see how breaks work on test day.</p>

      <h3 class="rules-title">Take a Break: Do Not Close Your Device</h3>
      <p class="rules-desc">After the break, a <strong>Resume Testing Now</strong> button will appear and you’ll start the next section.</p>

      <ul class="rules">
        <li>Do not disturb students who are still testing.</li>
        <li>Do not exit the app or close your laptop.</li>
        <li>Do not access phones, smartwatches, textbooks, notes, or the internet.</li>
        <li>Do not eat or drink near any testing device.</li>
        <li>Do not speak in the testing room; outside the room, do not discuss the exam with anyone.</li>
      </ul>

      <div class="user">{{ studentName }}</div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useExamFlowStore } from '../stores/examFlow.js'
import { examApi } from '../api/exam.js'
import { authState } from '@/auth'

export default {
  name: 'Break',
  setup() {
    const flow = useExamFlowStore()
    const route = useRoute()
    const router = useRouter()
    const studentName = computed(() => authState.user?.realName?.trim() || authState.user?.username || 'Student')

    const totalSeconds = ref(flow.restTimeSeconds || 600)
    const remaining = ref(totalSeconds.value)
    let timer = null

    const formattedTime = computed(() => {
      const m = Math.floor(remaining.value / 60)
      const s = String(remaining.value % 60).padStart(2, '0')
      return `${m}:${s}`
    })

    const tick = () => {
      if (remaining.value > 0) remaining.value--
    }

    const resume = async () => {
      const next = await flow.resumeAfterBreak()
      router.push(next.nextRoute)
    }

    onMounted(async () => {
      if (!flow.recordId && route.query.recordId) {
        const recordId = Number(route.query.recordId)
        const snapshot = await examApi.getProgress(recordId)
        await flow.initFromProgress(snapshot.paperId, recordId, snapshot)
      }
      if (!flow.recordId || !flow.awaitingBreak) {
        if (flow.examId) {
          router.replace({ path: '/student/sat/exams/' + flow.examId, query: { recordId: flow.recordId } })
        } else {
          router.replace({ name: 'exam-type', params: { code: 'SAT' } })
        }
        return
      }
      totalSeconds.value = flow.restTimeSeconds || 600
      remaining.value = totalSeconds.value
      timer = setInterval(tick, 1000)
    })
    onUnmounted(() => {
      if (timer) clearInterval(timer)
    })

    return { formattedTime, resume, studentName }
  }
}
</script>

<style scoped>
.break-page {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 100vh;
  background: #111;
  color: #fff;
  padding: 40px;
}
.left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.timer-box {
  background: #1f1f1f;
  padding: 24px 32px;
  border-radius: 10px;
  text-align: center;
  margin-bottom: 24px;
}
.label {
  color: #d0d0d0;
  margin-bottom: 8px;
}
.time {
  font-size: 48px;
  font-weight: 700;
}
.resume-btn {
  background: #f5c400;
  border: none;
  color: #111;
  padding: 12px 20px;
  border-radius: 24px;
  font-weight: 600;
  cursor: pointer;
}
.right {
  max-width: 520px;
  margin-left: 40px;
  display: flex;
  flex-direction: column;
  justify-content: center; /* 垂直居中右侧文字区域 */
}
.title { font-size: 28px; margin-bottom: 16px; }
.subtitle { color: #c8c8c8; line-height: 1.6; margin-bottom: 24px; }
.rules-title { font-size: 20px; margin-top: 12px; margin-bottom: 6px; }
.rules-desc { color: #c8c8c8; margin-bottom: 12px; }
.rules { color: #ddd; line-height: 1.8; }
.rules li { margin-bottom: 8px; }
.user { position: fixed; bottom: 24px; left: 24px; color: #bbb; font-size: 12px; }

@media (max-width: 680px) {
  .break-page {
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: 32px;
    height: 100%;
    min-height: 100vh;
    overflow-y: auto;
    padding: 28px 20px 32px;
  }

  .left { gap: 14px; }
  .timer-box { width: min(100%, 280px); margin-bottom: 0; padding: 20px 24px; }
  .time { font-size: 40px; }
  .resume-btn { min-height: 46px; }
  .right { max-width: none; margin: 0; }
  .title { font-size: 24px; }
  .rules-title { font-size: 18px; }
  .user { position: static; margin-top: 26px; color: #aeb8c7; }
}
</style>
