<template>
  <div class="exam-container" :class="{ 'highlight-mode': highlightMode, 'review-mode': isReviewMode, 'preview-mode': isPreviewMode }">
    <div v-if="!isReviewMode && !isPreviewMode && !isOnline" class="exam-network-alert" role="status" aria-live="polite">
      You are offline. Your progress will sync when your connection is restored.
    </div>
    <div v-if="isPreviewMode && (previewLoading || previewError)" class="preview-load-state" role="status">
      <span v-if="previewLoading">Loading paper preview…</span>
      <template v-else>
        <span>{{ previewError }}</span>
        <button type="button" @click="loadPaperPreview">Retry</button>
      </template>
    </div>
    <template v-if="!isPreviewMode || (!previewLoading && !previewError)">
    <!-- 顶部导航栏 -->
    <ExamHeader 
      :exam-title="examTitle"
      :module-name="examTitle"
      :preview-mode="isPreviewMode"
      :preview-modules="previewModules"
      :selected-preview-module="selectedPreviewModule"
      :current-question="currentQuestion"
      :total-questions="totalQuestions"
      :time-remaining="timeRemaining"
      :highlight-mode="highlightMode"
      :review-mode="isReviewMode"
      @toggle-highlight-mode="handleToggleHighlightMode"
      @show-help="handleShowHelp"
      @exit-exam="handleExitExam"
      @open-calculator="handleOpenCalculator"
      :font-scale="fontScale"
      @change-font-scale="handleChangeFontScale"
      @select-preview-module="selectPreviewModule"
    />
    
    <!-- 主要内容区域：支持左右面板拖拽分割 -->
    <div class="exam-content" ref="containerRef" :style="{ '--exam-font-scale': fontScale }">
      <!-- 左侧材料（仅在有材料时显示） -->
      <div v-if="hasPassage" class="pane left-pane" :style="leftStyle">
        <QuestionContent 
          :question="currentQuestionData"
          :question-number="currentQuestion"
          :highlight-mode="highlightMode"
          :show-question-text="false"
          :saved-passage-html="passageHighlights[currentQuestion] || ''"
          :saved-question-html="questionHighlights[currentQuestion] || ''"
          @toggle-highlight="handleToggleHighlight"
          @add-note="handleAddNote"
          @toggle-mark-review="handleToggleMarkReview"
          @save-highlight="handleSaveHighlight"
          @preview-image="openImagePreview"
        />
      </div>

      <!-- 中间分割线，可拖拽 -->
      <div 
        v-if="hasPassage"
        class="divider" 
        :class="{ dragging: isDragging }"
        @mousedown="startDrag"
      ></div>

      <!-- 右侧选项 -->
      <div class="pane right-pane" :style="rightStyle">
        <AnswerOptions 
          :key="currentQuestion"
          :question="currentQuestionData"
          :selected-answer="selectedAnswers[currentQuestion - 1]"
          :highlight-mode="highlightMode"
          :question-number="currentQuestion"
          :is-reviewed="questionStatus[currentQuestion - 1]?.reviewed || false"
          :constrain-width="!hasPassage"
          :saved-question-html="questionHighlights[currentQuestion] || ''"
          :read-only="isReviewMode"
          :correct-answer="reviewAnswerMap[currentQuestionData.id]?.correct || ''"
          @answer-selected="handleAnswerSelected"
          @toggle-mark-review="handleToggleMarkReview"
          @save-highlight="handleSaveHighlight"
          @preview-image="openImagePreview"
        />
      </div>
    </div>
    
    <!-- 底部导航 -->
    <ExamNavigation 
      :current-question="currentQuestion"
      :total-questions="totalQuestions"
      :question-status="questionStatus"
      :review-mode="isReviewMode"
      :preview-mode="isPreviewMode"
      @question-navigate="navigateToQuestion"
      @previous-question="previousQuestion"
      @next-question="nextQuestion"
      @submit-exam="openSubmitModal"
      @close-review="isPreviewMode ? returnToPaperManagement() : returnToReport()"
    />

    <!-- 可拖拽的 Desmos 计算器 -->
    <DesmosCalculator
      :visible="showCalculator"
      @close="showCalculator = false"
    />
    
    <!-- 防作弊：切屏违规提示弹窗（需点击确认才消失） -->
    <div v-if="showViolationModal && !isReviewMode && !isPreviewMode" class="modal-overlay violation-modal-overlay">
      <div class="modal-content violation-dialog" @click.stop>
        <div class="modal-header">
          <h3>You Left the Exam Page</h3>
        </div>
        <div class="modal-body">
          <p>{{ violationMessage }}</p>
        </div>
        <div class="modal-actions">
          <button class="confirm-btn" @click="confirmViolationModal">OK</button>
        </div>
      </div>
    </div>

    <!-- 防作弊：全屏强制遮罩 -->
    <div v-if="fullscreenRequiredOverlay && !isReviewMode && !isPreviewMode" class="fullscreen-overlay">
      <div class="fullscreen-dialog">
        <span class="fullscreen-dialog__icon">⛶</span>
        <h3>Fullscreen Required</h3>
        <p>{{ fullscreenError || 'Enter fullscreen to begin or continue the exam.' }}</p>
        <button type="button" class="fullscreen-dialog__button" @click="enterExamFullscreen">
          Enter Fullscreen
        </button>
      </div>
    </div>

    <!-- 帮助弹窗 -->
    <div v-if="showHelpModal" class="modal-overlay" @click="closeHelpModal">
      <div class="help-modal" @click.stop>
        <div class="modal-header">
          <h3>Help</h3>
          <button class="close-btn" @click="closeHelpModal">×</button>
        </div>
        <div class="modal-content">
          <p>This is the SAT exam interface. Here are some tips:</p>
          <ul>
            <li>Use the Highlights & Notes feature to mark important text</li>
            <li>Click "Mark for Review" to flag questions for later review</li>
            <li>Use the question navigation panel to jump between questions</li>
            <li>Your progress is automatically saved</li>
          </ul>
        </div>
      </div>
    </div>
    
    <!-- 退出确认弹窗 -->
    <div v-if="showExitModal" class="modal-overlay" @click="closeExitModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>Leave Exam</h3>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to leave this exam?</p>
          <p>Your progress is saved automatically. You can return anytime to continue where you left off.</p>
          <div class="modal-actions">
            <button class="cancel-btn" @click="closeExitModal">Cancel</button>
            <button class="confirm-btn" @click="confirmExitExam">Leave</button>
          </div>
        </div>
      </div>
    </div>
    <!-- 提交确认弹窗 -->
    <div v-if="showSubmitModal" class="modal-overlay" @click="closeSubmitModal">
      <div class="submit-modal" @click.stop>
        <div class="modal-header">
          <h3>Submit Section</h3>
          <button class="close-btn" @click="closeSubmitModal">×</button>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to submit this section?</p>
          <p>You will proceed to the preparation page.</p>
          <p v-if="submissionError" class="submit-error" role="alert">{{ submissionError }}</p>
          <div class="modal-actions">
            <button class="cancel-btn" @click="closeSubmitModal">Cancel</button>
            <button class="confirm-btn" :disabled="isSubmitting" @click="confirmSubmitSection">
              {{ isSubmitting ? 'Submitting…' : 'Submit' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="imagePreview.visible" class="image-preview-overlay" @click="closeImagePreview">
      <button class="image-preview-close" type="button" aria-label="Close image preview" @click.stop="closeImagePreview">×</button>
      <img class="image-preview-img" :src="imagePreview.src" alt="Preview" @click.stop />
    </div>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useExamFlowStore } from '../stores/examFlow.js'
import { examApi } from '../api/exam.js'
import { apiRequest } from '@/api/platform'
import ExamHeader from '../components/exam/ExamHeader.vue'
import QuestionContent from '../components/exam/QuestionContent.vue'
import AnswerOptions from '../components/exam/AnswerOptions.vue'
import ExamNavigation from '../components/exam/ExamNavigation.vue'
import DesmosCalculator from '../components/exam/DesmosCalculator.vue'

export default {
  name: 'Exam',
  components: {
    ExamHeader,
    QuestionContent,
    AnswerOptions,
    ExamNavigation,
    DesmosCalculator
  },
  setup() {
    const router = useRouter()
    const flow = useExamFlowStore()
    // 响应式数据
    const examTitle = computed(() => flow.currentTitle)
    const isPreviewMode = computed(() => ['sat-paper-preview', 'psat-paper-preview'].includes(router.currentRoute.value.name)
      || router.currentRoute.value.query.preview === '1')
    const previewModules = computed(() => flow.order.map((id) => ({ id, title: flow.modulesMeta[id]?.title || 'SAT Module' })))
    const selectedPreviewModule = computed(() => flow.currentModuleId)
    const previewLoading = ref(false)
    const previewError = ref('')
    const currentQuestion = ref(1)
    const totalQuestions = ref(0)
    const timeRemaining = ref(flow.currentDurationMinutes * 60)
    const isOnline = ref(typeof navigator === 'undefined' || navigator.onLine)
    const selectedAnswers = ref([])
    const questionStatus = ref([])
    const isReviewMode = computed(() => router.currentRoute.value.query.review === '1')
    const reviewAnswerMap = ref({})
    const highlightMode = ref(false)
    const showHelpModal = ref(false)
    const showExitModal = ref(false)
    const showSubmitModal = ref(false)
    const showCalculator = ref(false)
    const fontScale = ref(1.15)
    const imagePreview = ref({
      visible: false,
      src: ''
    })
    // 高亮持久化（仅在当前模块内）
    const passageHighlights = ref({})
    const questionHighlights = ref({})
    const questionSpendSeconds = ref([])
    let questionTimingStartedAt = null
    let timer = null
    // 分割布局状态
    const splitPercent = ref(50) // 左侧面板宽度百分比
    const isDragging = ref(false)
    const containerRef = ref(null)
    const clamp = (val, min, max) => Math.min(Math.max(val, min), max)
    const hasPassage = computed(() => {
      const q = (flow.currentQuestions || [])[currentQuestion.value - 1] || {}
      const p = q?.passage
      const t = q?.material?.content
      const img = q?.materialFileUrl || q?.material?.fileUrl || q?.fileUrl
      const hasText = !!((p && String(p).trim()) || (t && String(t).trim()))
      const hasImage = !!img
      // 仅当存在文本或图片时显示材料区域；两者都为空则省略左侧区域
      return hasText || hasImage
    })
    const leftStyle = computed(() => ({ width: splitPercent.value + '%' }))
    const rightStyle = computed(() => ({ width: hasPassage.value ? (100 - splitPercent.value) + '%' : '100%' }))
    const startDrag = () => {
      isDragging.value = true
      window.addEventListener('mousemove', onDrag)
      window.addEventListener('mouseup', stopDrag)
    }
    const onDrag = (e) => {
      if (!containerRef.value || !isDragging.value) return
      const rect = containerRef.value.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percent = (x / rect.width) * 100
      splitPercent.value = Math.round(clamp(percent, 25, 75))
    }
    const stopDrag = () => {
      isDragging.value = false
      window.removeEventListener('mousemove', onDrag)
      window.removeEventListener('mouseup', stopDrag)
    }
    
    // 动态题目数据由examFlow提供
    
    // 计算属性
    const currentQuestionData = computed(() => {
      return (flow.currentQuestions || [])[currentQuestion.value - 1] || {}
    })

    const flushCurrentQuestionTiming = () => {
      if (isReviewMode.value || !questionTimingStartedAt) return
      const index = currentQuestion.value - 1
      if (index < 0 || index >= totalQuestions.value) return
      const now = Date.now()
      const elapsed = Math.max(0, Math.floor((now - questionTimingStartedAt) / 1000))
      if (elapsed > 0) {
        questionSpendSeconds.value[index] = (questionSpendSeconds.value[index] || 0) + elapsed
        questionTimingStartedAt = now
      }
    }

    const startCurrentQuestionTiming = () => {
      if (isReviewMode.value) return
      questionTimingStartedAt = Date.now()
    }

    const resetQuestionTiming = () => {
      questionSpendSeconds.value = Array(totalQuestions.value).fill(0)
      questionTimingStartedAt = null
      startCurrentQuestionTiming()
    }

    // ==================== 断点续考与自动保存 ====================

    // 当前题目位置本地持久化（按 recordId 区分，刷新后恢复定位）
    const positionStorageKey = () => {
      const rid = flow.recordId || router.currentRoute.value.query.recordId
      return rid ? `sat:exam:pos:${rid}` : null
    }
    const savePosition = () => {
      const key = positionStorageKey()
      if (!key) return
      try { localStorage.setItem(key, String(currentQuestion.value)) } catch (e) {}
    }
    const restorePosition = () => {
      const key = positionStorageKey()
      if (!key) return null
      try {
        const v = Number(localStorage.getItem(key))
        return Number.isFinite(v) && v > 0 ? v : null
      } catch (e) { return null }
    }
    const clearPosition = () => {
      const key = positionStorageKey()
      if (!key) return
      try { localStorage.removeItem(key) } catch (e) {}
    }

    const canAutosave = computed(() => !isReviewMode.value && !!flow.recordId && totalQuestions.value > 0)
    const canSyncPresence = computed(() => !isReviewMode.value && !!flow.examId && !!flow.recordId && !!currentQuestionData.value?.id)
    let presenceTimer = null
    let presenceRequestInFlight = false

    // 实时监控心跳只写入独立快照表；切题立即同步，定时心跳用于识别仍在线的学生。
    const syncExamPresence = async () => {
      if (!canSyncPresence.value || presenceRequestInFlight) return
      presenceRequestInFlight = true
      try {
        await examApi.updatePresence(flow.examId, flow.recordId, currentQuestion.value)
      } catch (e) {
        // 监控不可用不能阻断学生考试，下一次心跳会自动重试。
        console.warn('[Exam] presence heartbeat failed:', e?.message || e)
      } finally {
        presenceRequestInFlight = false
      }
    }

    const startPresenceHeartbeat = () => {
      if (!canSyncPresence.value || presenceTimer) return
      syncExamPresence()
      presenceTimer = window.setInterval(syncExamPresence, 10000)
    }

    const stopPresenceHeartbeat = () => {
      if (!presenceTimer) return
      window.clearInterval(presenceTimer)
      presenceTimer = null
    }

    // 提交进行中标记：防止草稿保存覆盖已判分的模块答案（is_correct 被置回 NULL）
    const isSubmitting = ref(false)
    const submissionError = ref('')

    // ==================== 防作弊：全屏 + 切屏检测 ====================
    const isFullscreenActive = ref(false)
    const fullscreenError = ref('')
    const fullscreenRequiredOverlay = ref(false)
    const focusViolationCount = ref(0)
    // 切屏违规弹窗（需学生点击确认才消失）
    const showViolationModal = ref(false)
    const violationMessage = ref('')
    const VIOLATION_MONITORING_GRACE_MS = 1500
    const activeFocusLossReasons = new Set()
    const legitFullscreenExit = ref(false)
    let violationMonitoringReadyAt = 0

    // 组装当前模块答题载荷（含标记）
    const buildAnswerPayload = () => {
      const questions = flow.currentQuestions || []
      return questions.map((question, idx) => ({
        questionId: question?.id,
        answer: selectedAnswers.value[idx] != null ? selectedAnswers.value[idx] : null,
        spendSeconds: Math.max(0, Math.round(questionSpendSeconds.value[idx] || 0)),
        isMarked: !!(questionStatus.value[idx]?.reviewed)
      }))
    }

    // 保存当前模块进度（不判分）
    const doSaveProgress = async () => {
      if (!canAutosave.value || isSubmitting.value) return
      const modId = flow.currentModuleId
      const payload = {
        answers: buildAnswerPayload(),
        timeSpentSeconds: Math.max(0, Math.round((flow.currentDurationMinutes * 60) - timeRemaining.value)),
        abnormalCount: focusViolationCount.value
      }
      try {
        await examApi.saveModule(flow.examId, flow.recordId, modId, payload)
      } catch (e) {
        console.warn('[Exam] autosave failed:', e)
      }
    }

    let autosaveTimer = null
    const scheduleAutosave = () => {
      if (!canAutosave.value) return
      if (autosaveTimer) clearTimeout(autosaveTimer)
      autosaveTimer = setTimeout(() => {
        autosaveTimer = null
        doSaveProgress()
      }, 1000)
    }

    const handleNetworkOnline = () => {
      isOnline.value = true
      scheduleAutosave()
    }
    const handleNetworkOffline = () => { isOnline.value = false }

    // 页面关闭/切走前 fire-and-forget 保存
    const handleBeforeUnload = () => {
      if (isReviewMode.value) return
      flushCurrentQuestionTiming()
      doSaveProgress()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && !isReviewMode.value) {
        flushCurrentQuestionTiming()
        doSaveProgress()
      }
    }

    // ---- 防作弊：全屏控制 ----
    const fullscreenSupported = () => {
      return typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false
    }

    const enterExamFullscreen = async () => {
      if (document.fullscreenElement) {
        isFullscreenActive.value = true
        fullscreenRequiredOverlay.value = false
        fullscreenError.value = ''
        return true
      }
      if (typeof document.documentElement.requestFullscreen !== 'function') {
        fullscreenError.value = 'Fullscreen is not supported by this browser.'
        return false
      }
      // 进入全屏后短暂等待，避免浏览器切换全屏状态时产生的连续事件被误判。
      violationMonitoringReadyAt = Date.now() + VIOLATION_MONITORING_GRACE_MS
      activeFocusLossReasons.clear()
      try {
        await document.documentElement.requestFullscreen()
        isFullscreenActive.value = true
        fullscreenRequiredOverlay.value = false
        fullscreenError.value = ''
        return true
      } catch (e) {
        fullscreenError.value = 'Please allow fullscreen to continue the exam.'
        return false
      }
    }

    const exitExamFullscreen = () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        legitFullscreenExit.value = true
        try {
          document.exitFullscreen()
        } catch (e) {
          legitFullscreenExit.value = false
        }
      }
      isFullscreenActive.value = false
    }

    // 考试进行中（非复习模式且有记录）
    const isExamSessionActive = computed(() => !isReviewMode.value && !!flow.recordId)

    // ---- 防作弊：切屏检测与计数（仅统计并警告，不自动交卷） ----
    const registerExamFocusViolation = (reason) => {
      if (!isExamSessionActive.value || isSubmitting.value) return
      // 同一次切出可能触发多个浏览器事件，按连续离开状态只计一次；进入后有短暂宽限期
      if (Date.now() < violationMonitoringReadyAt || activeFocusLossReasons.size > 0) return
      activeFocusLossReasons.add(reason)
      focusViolationCount.value++
      console.warn('[Exam] focus violation:', reason, focusViolationCount.value)
      persistViolationCount()
      // 每次切出都弹窗警告，需点击确认才消失；次数会记录到考试报告
      violationMessage.value =
        `You left the exam page. This has been recorded and will appear in your exam report. ` +
        `Times you left the exam page: ${focusViolationCount.value}. ` +
        'Please stay on the exam page. The exam timer continues running.'
      showViolationModal.value = true
    }

    const confirmViolationModal = () => {
      showViolationModal.value = false
    }

    const handleExamVisibilityChange = () => {
      // 只有页面真正进入 hidden 才算离开；计算器 iframe 内部焦点变化不会触发这里。
      if (document.visibilityState === 'hidden') {
        registerExamFocusViolation('page-hidden')
        return
      }
      activeFocusLossReasons.delete('page-hidden')
    }

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      isFullscreenActive.value = active
      if (active) {
        fullscreenRequiredOverlay.value = false
        activeFocusLossReasons.delete('fullscreen-exit')
        fullscreenError.value = ''
        return
      }
      // 交卷/退出等正常流程触发的退全屏不计违规
      if (legitFullscreenExit.value) {
        legitFullscreenExit.value = false
        isFullscreenActive.value = false
        return
      }
      // 离开全屏视为一次违规，并强制返回全屏
      if (!isReviewMode.value && isExamSessionActive.value) {
        registerExamFocusViolation('fullscreen-exit')
        fullscreenRequiredOverlay.value = true
      }
    }

    // 持久化违规计数到服务端（exam_record.abnormal_count），刷新无法清零
    const persistViolationCount = async () => {
      if (!flow.recordId || isReviewMode.value) return
      const payload = { answers: [], timeSpentSeconds: 0, abnormalCount: focusViolationCount.value }
      try {
        await examApi.saveModule(flow.examId, flow.recordId, flow.currentModuleId, payload)
      } catch (e) {
        console.warn('[Exam] persist violation count failed:', e)
      }
    }

    // Debug: 打印当前题目数据的关键字段，定位材料图片为何未显示
    watchEffect(() => {
      const q = currentQuestionData.value || {}
      try {
        console.log('[Exam] currentQuestionData', {
          id: q?.id,
          passageExists: !!(q?.passage && String(q.passage).trim()),
          materialFileUrl: q?.materialFileUrl,
          materialObj: q?.material || null,
          fileUrl: q?.fileUrl
        })
      } catch (e) {}
    })
    
    // 方法
    const handleAnswerSelected = (answer) => {
      if (isReviewMode.value) return
      selectedAnswers.value[currentQuestion.value - 1] = answer
      updateQuestionStatus()
      scheduleAutosave()
    }
    
    const handleToggleHighlight = (data) => {
      console.log('Toggle highlight:', data)
    }
    const handleSaveHighlight = (payload) => {
      const { type, questionNumber, html } = payload || {}
      if (!questionNumber) return
      if (type === 'passage') {
        passageHighlights.value[questionNumber] = html
      } else if (type === 'question') {
        questionHighlights.value[questionNumber] = html
      }
    }
    
    const handleAddNote = (data) => {
      console.log('Add note:', data)
    }
    
    const handleToggleMarkReview = () => {
      if (isReviewMode.value) return
      const index = currentQuestion.value - 1
      questionStatus.value[index].reviewed = !questionStatus.value[index].reviewed
      scheduleAutosave()
    }
    
    const navigateToQuestion = (questionNumber) => {
      if (questionNumber >= 1 && questionNumber <= totalQuestions.value) {
        flushCurrentQuestionTiming()
        currentQuestion.value = questionNumber
        startCurrentQuestionTiming()
        updateQuestionStatus()
        savePosition()
        syncExamPresence()
        doSaveProgress()
      }
    }
    
    const previousQuestion = () => {
      if (currentQuestion.value > 1) {
        flushCurrentQuestionTiming()
        currentQuestion.value--
        startCurrentQuestionTiming()
        updateQuestionStatus()
        savePosition()
        syncExamPresence()
        doSaveProgress()
      }
    }
    
    const nextQuestion = () => {
      if (currentQuestion.value < totalQuestions.value) {
        flushCurrentQuestionTiming()
        currentQuestion.value++
        startCurrentQuestionTiming()
        updateQuestionStatus()
        savePosition()
        syncExamPresence()
        doSaveProgress()
      }
    }
    
    const updateQuestionStatus = () => {
      questionStatus.value = questionStatus.value.map((status, index) => ({
        ...status,
        current: index === currentQuestion.value - 1,
        answered: selectedAnswers.value[index] !== null && selectedAnswers.value[index] !== undefined
      }))
    }
    
    const initializeQuestionStatus = () => {
      questionStatus.value = Array(totalQuestions.value).fill(null).map((_, index) => ({
        current: index === 0,
        answered: selectedAnswers.value[index] !== null && selectedAnswers.value[index] !== undefined,
        reviewed: false
      }))
    }
    
    const startTimer = () => {
      if (timer) clearInterval(timer)
      timer = setInterval(() => {
        if (timeRemaining.value > 0) {
          timeRemaining.value--
        } else {
          clearInterval(timer)
          timer = null
          handleTimeExpired()
        }
      }, 1000)
    }

    // 倒计时归零：取消挂起的自动保存，立即提交当前模块（保留已答内容）
    const handleTimeExpired = () => {
      console.log('Time up! Auto submit.')
      if (isReviewMode.value) return
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
      confirmSubmitSection()
    }
    
    // 新功能方法
    const handleToggleHighlightMode = (isActive) => {
      if (isReviewMode.value) return
      highlightMode.value = isActive
      console.log('Highlight mode:', isActive ? 'activated' : 'deactivated')
    }
    
    const handleShowHelp = () => {
      showHelpModal.value = true
    }
    
    const handleExitExam = () => {
      if (isPreviewMode.value) {
        returnToPaperManagement()
        return
      }
      if (isReviewMode.value) {
        returnToReport()
        return
      }
      showExitModal.value = true
    }
    const handleOpenCalculator = () => {
      showCalculator.value = true
    }

    const handleChangeFontScale = (scale) => {
      if (Number.isFinite(scale) && scale >= 1 && scale <= 1.6) {
        fontScale.value = scale
      }
    }

    const openImagePreview = (src) => {
      if (!src) return
      imagePreview.value = {
        visible: true,
        src
      }
    }

    const closeImagePreview = () => {
      imagePreview.value = {
        visible: false,
        src: ''
      }
    }

    const handlePreviewKeydown = (event) => {
      if (event.key === 'Escape' && imagePreview.value.visible) {
        closeImagePreview()
      }
    }
    
    const closeHelpModal = () => {
      showHelpModal.value = false
    }
    
    const closeExitModal = () => {
      showExitModal.value = false
    }
    
    const confirmExitExam = async () => {
      // 退出考试：保存当前进度后返回首页（可随时回来继续）
      flushCurrentQuestionTiming()
      try { await doSaveProgress() } catch (e) {}
      showExitModal.value = false
      
      exitExamFullscreen()
      
      router.push({ name: 'exam-type', params: { code: sessionStorage.getItem('sat:workspace') === 'PSAT' ? 'PSAT' : 'SAT' } })
    }

    // 提交确认逻辑
    const openSubmitModal = () => {
      if (isReviewMode.value) return
      submissionError.value = ''
      showSubmitModal.value = true
    }
    const closeSubmitModal = () => {
      if (isSubmitting.value) return
      showSubmitModal.value = false
    }
    // 模块提交请求失败时，以服务端进度为准，区分“未提交”和“提交成功但响应丢失”。
    const recoverAfterSubmissionError = async (submittedModuleId) => {
      const attemptId = flow.recordId
      const paperId = flow.paperId
      if (!attemptId || !paperId) return false

      await flow.initFromProgress(paperId, attemptId)
      if (flow.resume.status !== 'ongoing') {
        showSubmitModal.value = false
        redirectToReport(flow.examId || flow.paperId, attemptId)
        return true
      }

      const moduleAdvanced = Number(flow.currentModuleId) !== Number(submittedModuleId)
      if (!moduleAdvanced && !flow.awaitingBreak) return false

      passageHighlights.value = {}
      questionHighlights.value = {}
      clearPosition()
      showSubmitModal.value = false
      await router.replace({
        path: flow.awaitingBreak ? '/student/sat/break' : '/student/sat/module-wait',
        query: { examId: flow.examId, recordId: attemptId },
      })
      return true
    }

    const confirmSubmitSection = async () => {
      if (isReviewMode.value) return
      submissionError.value = ''
      isSubmitting.value = true
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
      flushCurrentQuestionTiming()
      // 组装当前模块答题与用时
      const modId = flow.currentModuleId
      const questions = flow.currentQuestions || []
      const answers = questions.map((q, idx) => ({
        questionId: q.id,
        answer: selectedAnswers.value[idx] || null,
        spendSeconds: Math.max(0, Math.round(questionSpendSeconds.value[idx] || 0)),
        isMarked: !!(questionStatus.value[idx]?.reviewed)
      }))
      try {
        const submitted = await examApi.submitModule(flow.examId, flow.recordId, modId, { answers })
        passageHighlights.value = {}
        questionHighlights.value = {}
        clearPosition()
        if (submitted.status === 'finished') {
          exitExamFullscreen()
          await router.push({ path: '/student/sat/report', query: { examId: flow.examId, recordId: flow.recordId } })
          return
        }
        const next = flow.advance()
        if (!next.finished) {
          await router.push({
            path: next.nextRoute,
            query: { examId: flow.examId, recordId: flow.recordId },
          })
          return
        }
        exitExamFullscreen()
        await examApi.finishExam(flow.examId, flow.recordId)
        await router.push({ path: '/student/sat/report', query: { examId: flow.examId, recordId: flow.recordId } })
      } catch (submitError) {
        console.error('Module submission failed:', submitError)
        try {
          if (await recoverAfterSubmissionError(modId)) return
        } catch (recoveryError) {
          console.error('Unable to reconcile SAT module progress:', recoveryError)
        }
        submissionError.value = submitError.message || 'Unable to submit this module. Your answers are still available; please try again.'
        showSubmitModal.value = true
      } finally {
        isSubmitting.value = false
      }
    }
    
    const returnToReport = async () => {
      exitExamFullscreen()
      const q = router.currentRoute.value.query || {}
      router.push({
        path: '/student/sat/report',
        query: {
          examId: q.examId || q.paperId,
          recordId: q.recordId
        }
      })
    }

    // 管理员预览走编辑器结构接口，避免误用仅允许已完成考试复查的学生接口。
    const loadPaperPreview = async () => {
      const route = router.currentRoute.value
      const paperId = Number(route.query.paperId || route.params.paperId)
      if (!paperId) {
        previewError.value = 'Paper ID is missing.'
        return
      }
      previewLoading.value = true
      previewError.value = ''
      try {
        const paper = await apiRequest(`/api/admin/sat/papers/${paperId}/editor/structure`)
        const modules = (paper.stages || []).flatMap((stage) => (stage.modules || [])
          .flatMap((module) => [module, ...(module.adaptiveOptions || [])]))
        if (!modules.length) throw new Error('This paper has no modules to preview.')

        flow.reset()
        flow.paperId = paper.paperId
        flow.reviewMode = true
        flow.order = modules.map((module) => module.moduleId)
        flow.index = 0
        flow.modulesMeta = Object.fromEntries(modules.map((module) => [module.moduleId, {
          id: module.moduleId,
          title: module.moduleName,
          durationSeconds: Number(module.duration || 0) * 60,
          subject: module.subjectCode === 2 ? 'MATH' : 'RW',
          sortOrder: module.sortOrder,
          moduleType: module.moduleNumber,
          questionCount: module.questionCount,
        }]))
        flow.moduleQuestions = Object.fromEntries(modules.map((module) => [module.moduleId,
          (module.questions || []).map((question) => ({
            id: question.questionId,
            question: question.content || '',
            type: question.typeName,
            passage: question.material?.content || '',
            options: question.options,
            materialFileUrl: question.material?.fileUrl || '',
            fileUrl: question.material?.fileUrl || '',
            material: question.material ? {
              content: question.material.content || '',
              fileUrl: question.material.fileUrl || '',
            } : null,
          }))]))
        totalQuestions.value = flow.currentQuestions.length
        selectedAnswers.value = Array(totalQuestions.value).fill(null)
        questionStatus.value = Array(totalQuestions.value).fill(null).map((_, index) => ({
          current: index === 0,
          answered: false,
          reviewed: false,
        }))
        timeRemaining.value = flow.currentDurationMinutes * 60
      } catch (error) {
        previewError.value = error.message || 'Unable to load this paper preview.'
      } finally {
        previewLoading.value = false
      }
    }

    // 预览只切换本地模块状态，不创建答题记录。
    const selectPreviewModule = (moduleId) => {
      const index = flow.order.findIndex((id) => String(id) === String(moduleId))
      if (index < 0 || index === flow.index) return
      flow.index = index
      currentQuestion.value = 1
      totalQuestions.value = flow.currentQuestions.length
      selectedAnswers.value = Array(totalQuestions.value).fill(null)
      questionStatus.value = Array(totalQuestions.value).fill(null).map((_, questionIndex) => ({
        current: questionIndex === 0,
        answered: false,
        reviewed: false
      }))
    }

    const returnToPaperManagement = () => {
      const currentRoute = router.currentRoute.value
      const fallback = {
        name: currentRoute.name === 'psat-paper-preview' ? 'psat-admin' : 'sat-admin',
        query: { tab: 'papers' }
      }
      const returnTo = typeof currentRoute.query.returnTo === 'string'
        && /^\/(?:sat|psat|exam-types\/(?:SAT|PSAT)\/admin)(?:[/?]|$)/.test(currentRoute.query.returnTo)
        ? currentRoute.query.returnTo : fallback
      router.push(returnTo)
    }

    const initializeReviewMode = async () => {
      const q = router.currentRoute.value.query || {}
      const paperId = q.paperId ? Number(q.paperId) : null
      const recordId = q.recordId ? Number(q.recordId) : null
      const examId = q.examId ? Number(q.examId) : paperId
      const targetQuestionId = q.questionId ? Number(q.questionId) : null
      if (!paperId || !recordId || !targetQuestionId) {
        router.replace({ name: 'exam-type', params: { code: sessionStorage.getItem('sat:workspace') === 'PSAT' ? 'PSAT' : 'SAT' } })
        return
      }

      const reportRes = await examApi.getReport(examId, recordId)
      const report = reportRes?.data || reportRes || {}
      const answerRows = Array.isArray(report.answers) ? report.answers : []
      const answerMap = {}
      answerRows.forEach(row => {
        const qid = Number(row?.questionId || row?.qid)
        if (qid) answerMap[qid] = row
      })
      reviewAnswerMap.value = answerMap

      await flow.initReviewMode(paperId)
      let targetModuleId = q.moduleId ? Number(q.moduleId) : null
      if (!targetModuleId) {
        targetModuleId = Number(answerMap[targetQuestionId]?.moduleId || 0) || null
      }
      const moduleIndex = flow.order.findIndex(id => String(id) === String(targetModuleId))
      flow.index = moduleIndex >= 0 ? moduleIndex : 0

      await flow.loadQuestionsForCurrentModule()
      if (flow.awaitingBreak && !isReviewMode.value) {
        router.replace({ path: '/student/sat/break', query: { examId: flow.examId, recordId: flow.recordId } })
        return
      }
      totalQuestions.value = flow.currentQuestions.length
      selectedAnswers.value = flow.currentQuestions.map(question => {
        const row = answerMap[Number(question?.id)]
        return row?.chosen ?? null
      })
      const targetIndex = flow.currentQuestions.findIndex(question => Number(question?.id) === targetQuestionId)
      currentQuestion.value = targetIndex >= 0 ? targetIndex + 1 : 1
      timeRemaining.value = 0
      initializeQuestionStatus()
      updateQuestionStatus()
    }

    // 跳转报告页（已交卷 / 完成）：退出全屏
    const redirectToReport = (examIdParam, recordIdParam) => {
      exitExamFullscreen()
      router.replace({
        path: '/student/sat/report',
        query: {
          examId: flow.resume?.mode === 'practice' ? flow.examId : examIdParam || flow.examId || flow.paperId,
          recordId: recordIdParam || flow.recordId
        }
      })
    }

    // 仅凭 recordId 从服务端恢复进度（硬刷新 / 过渡页无 examId 时）
    const resumeFromRecord = async (recordIdParam, mode) => {
      try {
        const res = await examApi.getProgress(recordIdParam)
        const data = res?.data || res || {}
        const paperId = data.paperId ? Number(data.paperId) : null
        if (!paperId) {
          console.warn('[Exam] resume failed: no paperId for record', recordIdParam)
          router.replace({ name: 'exam-type', params: { code: sessionStorage.getItem('sat:workspace') === 'PSAT' ? 'PSAT' : 'SAT' } })
          return
        }
        await flow.initFromProgress(paperId, recordIdParam, data)
      } catch (e) {
        console.error('[Exam] resumeFromRecord failed:', e)
        router.replace({ name: 'exam-type', params: { code: sessionStorage.getItem('sat:workspace') === 'PSAT' ? 'PSAT' : 'SAT' } })
      }
    }

    // 从 localStorage 读取最近一次考试上下文（过渡页硬刷新后兜底恢复）
    const readLastRecordContext = () => {
      try {
        const raw = localStorage.getItem('sat:exam:last')
        if (!raw) return null
        const ctx = JSON.parse(raw)
        return ctx && ctx.recordId ? ctx : null
      } catch (e) { return null }
    }

    // 生命周期钩子
    onMounted(async () => {
      window.addEventListener('keydown', handlePreviewKeydown)
      window.addEventListener('beforeunload', handleBeforeUnload)
      window.addEventListener('online', handleNetworkOnline)
      window.addEventListener('offline', handleNetworkOffline)
      document.addEventListener('visibilitychange', handleVisibilityChange)
      document.addEventListener('visibilitychange', handleExamVisibilityChange)
      document.addEventListener('fullscreenchange', handleFullscreenChange)
      if (isReviewMode.value) {
        await initializeReviewMode()
        return
      }
      const q = router.currentRoute.value.query
      if (isPreviewMode.value) {
        await loadPaperPreview()
        return
      }
      const mode = q.mode || 'exam'
      const examIdParam = q.examId ? Number(q.examId) : Number(router.currentRoute.value.params.examId) || null
      const recordIdParam = q.recordId ? Number(q.recordId) : null

      if (recordIdParam) {
        // 优先按 recordId 恢复（刷新/过渡页场景）
        await resumeFromRecord(recordIdParam, mode)
      } else if (examIdParam) {
        // 正常进入：start 接口即续考，返回续考快照
        await flow.init(examIdParam, mode)
      } else if (flow.recordId) {
        // 无参数但 store 中仍有记录（SPA 过渡页跳转）：按 recordId 恢复
        await resumeFromRecord(flow.recordId, mode)
      } else {
        // 兜底：从 localStorage 恢复最近一次考试上下文
        const lastCtx = readLastRecordContext()
        if (lastCtx) {
          await resumeFromRecord(Number(lastCtx.recordId), lastCtx.mode || mode)
        }
      }

      await flow.loadQuestionsForCurrentModule()
      if (flow.awaitingBreak && !isReviewMode.value) {
        router.replace({ path: '/student/sat/break', query: { examId: flow.examId, recordId: flow.recordId } })
        return
      }
      totalQuestions.value = flow.currentQuestions.length

      const resume = flow.resume || {}
      if (resume.status && resume.status !== 'ongoing') {
        // 已交卷：直接跳转报告页
        redirectToReport(q.examId || flow.examId || flow.paperId, recordIdParam || flow.recordId)
        return
      }

      // 初始化本地答题状态
      selectedAnswers.value = Array(totalQuestions.value).fill(null)
      questionSpendSeconds.value = Array(totalQuestions.value).fill(0)
      questionStatus.value = Array(totalQuestions.value).fill(null).map((_, index) => ({
        current: index === 0,
        answered: false,
        reviewed: false
      }))
      resetQuestionTiming()
      initializeQuestionStatus()

      // 水合已保存答案（含标记）
      const answerMap = {}
      ;(resume.savedAnswers || []).forEach(a => {
        const qid = Number(a.questionId)
        if (qid) answerMap[qid] = a
      })
      ;(flow.currentQuestions || []).forEach((question, idx) => {
        const row = answerMap[Number(question?.id)]
        if (row) {
          selectedAnswers.value[idx] = row.answer != null ? row.answer : null
          questionSpendSeconds.value[idx] = Number(row.spendSeconds) || 0
          if (row.isMarked) {
            questionStatus.value[idx].reviewed = true
          }
        }
      })

      // 剩余时间：优先使用服务端计算的 remainingSeconds
      const rem = resume.remainingSeconds != null && resume.remainingSeconds !== undefined
        ? Number(resume.remainingSeconds) : null
      timeRemaining.value = rem !== null ? Math.max(0, rem) : (flow.currentDurationMinutes * 60)

      // 恢复题目位置
      const savedPos = restorePosition()
      if (savedPos && savedPos >= 1 && savedPos <= totalQuestions.value) {
        currentQuestion.value = savedPos
      }

      updateQuestionStatus()
      startTimer()
      startPresenceHeartbeat()

      // 防作弊：恢复服务端持久化的切屏计数，进入全屏（失败则显示强制遮罩等待点击）
      focusViolationCount.value = Math.max(0, Number(resume.abnormalCount) || 0)
      violationMonitoringReadyAt = Date.now() + VIOLATION_MONITORING_GRACE_MS
      activeFocusLossReasons.clear()
      if (fullscreenSupported()) {
        const entered = await enterExamFullscreen()
        if (!entered) {
          fullscreenRequiredOverlay.value = true
        }
      }
    })
    
    onUnmounted(() => {
      flushCurrentQuestionTiming()
      if (timer) {
        clearInterval(timer)
      }
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
      }
      stopPresenceHeartbeat()
      window.removeEventListener('mousemove', onDrag)
      window.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('keydown', handlePreviewKeydown)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('online', handleNetworkOnline)
      window.removeEventListener('offline', handleNetworkOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleExamVisibilityChange)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    })
    
    return {
      examTitle,
      isPreviewMode,
      previewModules,
      selectedPreviewModule,
      previewLoading,
      previewError,
      loadPaperPreview,
      currentQuestion,
      isOnline,
      isReviewMode,
      totalQuestions,
      timeRemaining,
      selectedAnswers,
      reviewAnswerMap,
      questionStatus,
      currentQuestionData,
      hasPassage,
      containerRef,
      leftStyle,
      rightStyle,
      isDragging,
      startDrag,
      highlightMode,
      showHelpModal,
      showExitModal,
      showSubmitModal,
      showCalculator,
      imagePreview,
      handleAnswerSelected,
      handleToggleHighlight,
      handleSaveHighlight,
      handleAddNote,
      handleToggleMarkReview,
      navigateToQuestion,
      previousQuestion,
      nextQuestion,
      handleToggleHighlightMode,
      handleShowHelp,
      handleExitExam,
      handleOpenCalculator,
      fontScale,
      handleChangeFontScale,
      selectPreviewModule,
      openImagePreview,
      closeImagePreview,
      closeHelpModal,
      closeExitModal,
      confirmExitExam,
      openSubmitModal,
      returnToReport,
      closeSubmitModal,
      confirmSubmitSection,
      isSubmitting,
      submissionError,
      passageHighlights,
      questionHighlights,
      fullscreenRequiredOverlay,
      fullscreenError,
      showViolationModal,
      violationMessage,
      confirmViolationModal,
      enterExamFullscreen
    }
  }
}
</script>

<style scoped>
.exam-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

.exam-network-alert {
  position: relative;
  z-index: 10;
  flex: 0 0 auto;
  padding: 9px 16px;
  color: #704d08;
  background: #fff3cd;
  border-bottom: 1px solid #f0d98f;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}

.preview-load-state {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: #334155;
  background: #fff;
  font-size: 16px;
}

.preview-load-state button {
  border: 1px solid #cbd8eb;
  border-radius: 6px;
  padding: 8px 14px;
  color: #2453a4;
  background: #fff;
  cursor: pointer;
  font: inherit;
}

.exam-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  --exam-font-scale: 1.15;
}

/* 分割布局样式 */
.pane {
  height: 100%;
  overflow-y: auto; /* 改为垂直滚动 */
  overflow-x: hidden; /* 隐藏水平滚动条 */
  background-color: #fff; /* 面板白色背景占满高度 */
  display: flex;
  flex-direction: column;
}

.left-pane {
  border-right: 1px solid #e0e0e0;
}

.right-pane {
  border-left: 1px solid #e0e0e0;
}

.divider {
  flex: 0 0 4px; /* 更窄的拖动条 */
  cursor: col-resize;
  background: #ffffff; /* 纯白色 */
  border-left: 1px solid #e6e6e6;
  border-right: 1px solid #e6e6e6;
}

.divider:hover,
.divider.dragging {
  background: #ffffff; /* 保持白色，避免与主题冲突 */
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

/* 防作弊：切屏违规提示弹窗（置于全屏强制遮罩之上） */
.violation-modal-overlay {
  z-index: 3200;
}
.violation-dialog {
  max-width: 480px;
}

/* 防作弊：全屏强制遮罩 */
.fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.fullscreen-dialog {
  background: #fff;
  border-radius: 12px;
  padding: 40px 48px;
  max-width: 420px;
  width: 100%;
  text-align: center;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
}
.fullscreen-dialog__icon {
  display: block;
  font-size: 42px;
  margin-bottom: 12px;
}
.fullscreen-dialog h3 {
  margin: 0 0 12px;
  font-size: 20px;
  color: #111827;
}
.fullscreen-dialog p {
  margin: 0 0 20px;
  font-size: 14px;
  color: #6b7280;
  line-height: 1.5;
}
.fullscreen-dialog__button {
  padding: 10px 28px;
  border: none;
  border-radius: 6px;
  background: #007bff;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}
.fullscreen-dialog__button:hover {
  background: #0056b3;
}

.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(17, 24, 39, 0.78);
}

.image-preview-img {
  max-width: min(96vw, 1200px);
  max-height: 92vh;
  object-fit: contain;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.32);
}

.image-preview-close {
  position: fixed;
  top: 18px;
  right: 22px;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #111827;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.image-preview-close:hover {
  background: #fff;
}

.modal-content {
  background: white;
  border-radius: 8px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

/* 提交弹窗特定样式，保持与退出/帮助弹窗一致 */
.submit-modal {
  background: white;
  border-radius: 8px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}
.submit-modal .modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}
.submit-modal .modal-body p {
  color: #666;
  line-height: 1.5;
  margin: 6px 0;
}
.submit-modal .modal-body .submit-error {
  color: #b42318;
  background: #fef3f2;
  border: 1px solid #fecdca;
  border-radius: 6px;
  padding: 10px 12px;
}
.submit-modal .close-btn {
  background: none;
  border: none;
  color: #666;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.submit-modal .close-btn:hover {
  background-color: #f0f0f0;
  color: #333;
}

/* 统一动作按钮区域样式 */
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

/* 统一按钮视觉样式（与已有modal按钮风格一致） */
.cancel-btn,
.confirm-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}
.cancel-btn {
  background-color: #f5f5f5;
  color: #666;
}
.cancel-btn:hover {
  background-color: #e8e8e8;
}
.confirm-btn {
  background-color: #007bff;
  color: white;
}
.confirm-btn:hover {
  background-color: #0056b3;
}
.confirm-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #666;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  color: #333;
}

.modal-body {
  margin-bottom: 20px;
  color: #666;
  line-height: 1.5;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.modal-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.modal-btn-secondary {
  background-color: #f5f5f5;
  color: #666;
}

.modal-btn-secondary:hover {
  background-color: #e8e8e8;
}

.modal-btn-primary {
  background-color: #007bff;
  color: white;
}

.modal-btn-primary:hover {
  background-color: #0056b3;
}

.modal-btn-danger {
  background-color: #dc3545;
  color: white;
}

.modal-btn-danger:hover {
  background-color: #c82333;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .exam-content {
    flex-direction: column;
  }
  
  .modal-content {
    margin: 20px;
    width: calc(100% - 40px);
  }
}
</style>
