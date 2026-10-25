import { apiRequest } from '@/api/platform'

export function getSatExamResults(examId, options = {}) {
  return apiRequest(`/api/admin/sat/exams/${examId}/results`, options)
}
