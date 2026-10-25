import { apiRequest } from '@/api/platform'

const base = '/api/admin/sat/reports/exams'

export const satAdminMonitorApi = {
  getLive(examId, options = {}) {
    return apiRequest(`${base}/${examId}/monitor/live`, options)
  },
  getAnalytics(examId, options = {}) {
    return apiRequest(`${base}/${examId}/monitor/analytics`, options)
  },
  getQuestion(examId, questionNumber, options = {}) {
    return apiRequest(`${base}/${examId}/monitor/questions/${questionNumber}`, options)
  },
}
