import { apiRequest } from '@/api/platform'

const base = '/api/student/sat-attempts'

export const examApi = {
  startExam: (examId) => apiRequest(`/api/student/exams/${examId}/sat-attempt`, { method: 'POST' }),
  listPracticePapers: (code) => apiRequest(`/api/student/sat-practice-papers?examTypeCode=${encodeURIComponent(code)}`),
  listPracticeHistory: (page = 1, size = 10, code = 'SAT') => apiRequest(`/api/student/sat-practice-attempts?page=${page}&size=${size}&examTypeCode=${encodeURIComponent(code)}`),
  startPractice: (paperId) => apiRequest(`/api/student/sat-practice-papers/${paperId}/attempts`, { method: 'POST' }),
  getProgress: (attemptId) => apiRequest(`${base}/${attemptId}`),
  resumeBreak: (attemptId) => apiRequest(`${base}/${attemptId}/resume-break`, { method: 'POST' }),
  getReport: (examId, attemptId) => apiRequest(`${base}/${attemptId}/report?examId=${examId}`),
  isReportReady: async (_examId, attemptId) => ({ ready: (await apiRequest(`${base}/${attemptId}`)).status === 'finished' }),
  saveModule: (examId, attemptId, moduleId, payload) => apiRequest(`${base}/${attemptId}/modules/${moduleId}/save`, {
    method: 'PUT', body: JSON.stringify(payload),
  }),
  submitModule: (examId, attemptId, moduleId, payload) => apiRequest(`${base}/${attemptId}/modules/${moduleId}/submit`, {
    method: 'POST', body: JSON.stringify(payload),
  }),
  finishExam: (_examId, attemptId) => apiRequest(`${base}/${attemptId}/finish`, { method: 'POST' }),
  updatePresence: (_examId, attemptId, questionNumber) => apiRequest(`${base}/${attemptId}/presence`, {
    method: 'POST', body: JSON.stringify({ questionNumber }),
  }),
}

export const paperApi = {
  getModules: (paperId) => apiRequest(`/api/student/sat-papers/${paperId}/modules`),
  getModuleQuestions: (paperId, moduleId) => apiRequest(`/api/student/sat-papers/${paperId}/modules/${moduleId}/questions`),
}

export const paperEditApi = {
  getQuestionDetail: (questionId) => apiRequest(`/api/student/sat-questions/${questionId}`),
}
