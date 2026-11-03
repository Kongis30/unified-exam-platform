import { apiRequest } from '@/api/platform'

export function getSatExamResults(examId, classId, options = {}) {
  const query = classId ? `?classId=${encodeURIComponent(classId)}` : ''
  return apiRequest(`/api/admin/sat/exams/${examId}/results${query}`, options)
}
