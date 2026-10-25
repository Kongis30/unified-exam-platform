import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { examApi, paperApi } from '../api/exam'

/** 保留旧 SAT 页面所需的状态接口，数据由统一系统的 SAT attempt API 提供。 */
export const useExamFlowStore = defineStore('satFormalExamFlow', () => {
  const order = ref([])
  const index = ref(0)
  const awaitingBreak = ref(false)
  const examId = ref(null)
  const recordId = ref(null)
  const paperId = ref(null)
  const restTimeSeconds = ref(600)
  const modulesMeta = ref({})
  const moduleQuestions = ref({})
  const reviewMode = ref(false)
  const resumeState = ref({ status: null, currentModuleId: null, remainingSeconds: null, savedAnswers: [], mode: 'exam' })

  const currentModuleId = computed(() => order.value[index.value])
  const currentTitle = computed(() => modulesMeta.value[currentModuleId.value]?.title || 'SAT Module')
  const currentDurationMinutes = computed(() => (modulesMeta.value[currentModuleId.value]?.durationSeconds || 1800) / 60)
  const currentQuestions = computed(() => moduleQuestions.value[currentModuleId.value] || [])
  const resume = computed(() => resumeState.value)
  const needsBreakAfterCurrent = computed(() => {
    const current = modulesMeta.value[currentModuleId.value]
    const next = modulesMeta.value[order.value[index.value + 1]]
    return current?.subject === 'RW' && next?.subject === 'MATH'
  })

  function applySnapshot(snapshot) {
    recordId.value = snapshot.attemptId
    examId.value = snapshot.examId
    paperId.value = snapshot.paperId
    restTimeSeconds.value = snapshot.restTimeSeconds || 600
    order.value = snapshot.modules.map((module) => module.id)
    modulesMeta.value = Object.fromEntries(snapshot.modules.map((module) => [module.id, {
      id: module.id,
      title: module.moduleName,
      durationSeconds: module.durationSeconds,
      subject: module.subject,
      sortOrder: module.sortOrder,
      moduleType: module.moduleNumber,
      questionCount: module.questionCount,
    }]))
    const activeIndex = order.value.findIndex((id) => String(id) === String(snapshot.currentModuleId))
    if (activeIndex >= 0) index.value = activeIndex
    awaitingBreak.value = snapshot.awaitingBreak
    moduleQuestions.value = snapshot.currentModuleId == null ? {} : {
      [snapshot.currentModuleId]: snapshot.questions.map((question) => ({
        id: question.id,
        question: question.question,
        type: question.type,
        passage: question.passage,
        options: question.options,
        materialFileUrl: question.materialFileUrl,
        fileUrl: question.fileUrl,
        material: { content: question.passage, fileUrl: question.fileUrl },
      })),
    }
    resumeState.value = {
      status: snapshot.status,
      currentModuleId: snapshot.currentModuleId,
      remainingSeconds: snapshot.remainingSeconds,
      savedAnswers: snapshot.savedAnswers.map((answer) => ({
        questionId: answer.questionId,
        answer: answer.answer,
        spendSeconds: answer.spendSeconds,
        isMarked: answer.isMarked,
      })),
      mode: snapshot.practice ? 'practice' : 'exam',
      abnormalCount: snapshot.abnormalCount,
    }
    localStorage.setItem('sat:exam:last', JSON.stringify({
      recordId: recordId.value, examId: examId.value, paperId: paperId.value,
      mode: snapshot.practice ? 'practice' : 'exam',
    }))
  }

  async function init(id, mode = 'exam') {
    reset()
    reviewMode.value = false
    applySnapshot(mode === 'practice' ? await examApi.startPractice(id) : await examApi.startExam(id))
  }

  async function initFromProgress(_paperId, attemptId) {
    reset()
    reviewMode.value = false
    applySnapshot(await examApi.getProgress(attemptId))
  }

  async function loadQuestionsForCurrentModule() {
    if (reviewMode.value) {
      const questions = await paperApi.getModuleQuestions(paperId.value, currentModuleId.value)
      moduleQuestions.value[currentModuleId.value] = questions
      return
    }
    if (!recordId.value || currentModuleId.value == null) return
    applySnapshot(await examApi.getProgress(recordId.value))
  }

  async function initReviewMode(selectedPaperId) {
    reset()
    reviewMode.value = true
    paperId.value = selectedPaperId
    const modules = await paperApi.getModules(selectedPaperId)
    order.value = modules.map((module) => module.id)
    modulesMeta.value = Object.fromEntries(modules.map((module) => [module.id, {
      id: module.id, title: module.moduleName, durationSeconds: module.durationSeconds,
      subject: module.subject, sortOrder: module.sortOrder, moduleType: module.moduleNumber,
      questionCount: module.questionCount,
    }]))
  }

  async function resumeAfterBreak() {
    applySnapshot(await examApi.resumeBreak(recordId.value))
    awaitingBreak.value = false
    return { nextRoute: '/student/sat/module-wait' }
  }

  function advance() {
    if (needsBreakAfterCurrent.value) {
      awaitingBreak.value = true
      return { nextRoute: '/student/sat/break' }
    }
    if (index.value < order.value.length - 1) {
      index.value += 1
      return { nextRoute: '/student/sat/module-wait' }
    }
    return { nextRoute: '/student/sat/report-wait', finished: true }
  }

  function reset() {
    order.value = []
    index.value = 0
    awaitingBreak.value = false
    examId.value = null
    recordId.value = null
    paperId.value = null
    restTimeSeconds.value = 600
    modulesMeta.value = {}
    moduleQuestions.value = {}
    reviewMode.value = false
    resumeState.value = { status: null, currentModuleId: null, remainingSeconds: null, savedAnswers: [], mode: 'exam' }
  }

  return {
    order, index, awaitingBreak, examId, recordId, paperId, restTimeSeconds, modulesMeta, moduleQuestions,
    currentModuleId, currentTitle, currentDurationMinutes, currentQuestions, resume, needsBreakAfterCurrent,
    init, initFromProgress, initReviewMode, loadQuestionsForCurrentModule, resumeAfterBreak, advance, reset,
  }
})
