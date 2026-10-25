import { apiRequest } from '@/api/platform'

export function getSatStudentScores(studentId, options = {}) {
  return apiRequest(`/api/admin/sat/students/${studentId}/scores`, options)
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
