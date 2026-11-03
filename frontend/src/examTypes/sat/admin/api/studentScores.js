import { apiRequest } from '@/api/platform'

export function getSatStudentScores(studentId, classId, examType, options = {}) {
  const params = new URLSearchParams({ classId: String(classId), examType })
  return apiRequest(`/api/admin/sat/students/${studentId}/scores?${params}`, options)
}

export function deleteSatStudentAttempt(studentId, attemptId, options = {}) {
  return apiRequest(`/api/admin/sat/students/${studentId}/attempts/${attemptId}`, {
    ...options,
    method: 'DELETE',
  })
}

export function getSatAttemptReport(attemptId, options = {}) {
  return apiRequest(`/api/admin/sat/attempts/${attemptId}/report`, options)
}
