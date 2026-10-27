let csrfToken

async function readResponse(response) {
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || data.detail || `Request failed (${response.status}).`)
    error.status = response.status
    error.field = data.field || null
    throw error
  }
  return data
}

async function ensureCsrfToken() {
  if (!csrfToken) {
    const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' })
    csrfToken = (await readResponse(response)).token
  }
  return csrfToken
}

export async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-XSRF-TOKEN', await ensureCsrfToken())

  const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin' })
  if (response.status === 403 && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    csrfToken = undefined
  }
  return readResponse(response)
}

export function getPlatformHealth() {
  return apiRequest('/api/health')
}

export function getExamTypes() {
  return apiRequest('/api/exam-types')
}

export function getCurrentUser() {
  return apiRequest('/api/auth/me')
}

export function updateOwnProfile(profile) {
  return apiRequest('/api/auth/profile', { method: 'PUT', body: JSON.stringify(profile) })
}

export function changeOwnPassword(currentPassword, newPassword) {
  return apiRequest('/api/auth/password', {
    method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export async function login(credentials) {
  await ensureCsrfToken()
  return apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) })
}

export function logout() {
  return apiRequest('/api/auth/logout', { method: 'POST' })
}

export function listUsers() {
  return apiRequest('/api/admin/users')
}

export function createUser(user) {
  return apiRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(user) })
}

export function setUserStatus(userId, status) {
  return apiRequest(`/api/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export function updateUserRole(userId, roleCode) {
  return apiRequest(`/api/admin/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ roleCode }) })
}

export function deleteUser(userId) {
  return apiRequest(`/api/admin/users/${userId}`, { method: 'DELETE' })
}

export function resetUserPassword(userId, password) {
  return apiRequest(`/api/admin/users/${userId}/password`, { method: 'PUT', body: JSON.stringify({ password }) })
}

export function listClasses(examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes${query}`)
}

export function reorderClasses(classIds, examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes/reorder${query}`, {
    method: 'POST', body: JSON.stringify({ classIds }),
  })
}

export function getClass(classId, examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes/${classId}${query}`)
}

export function createClass(classroom, examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes${query}`, { method: 'POST', body: JSON.stringify(classroom) })
}

export function updateClass(classId, classroom, examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes/${classId}${query}`, { method: 'PATCH', body: JSON.stringify(classroom) })
}

export function setClassStatus(classId, status) {
  return apiRequest(`/api/admin/classes/${classId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export function deleteClass(classId) {
  return apiRequest(`/api/admin/classes/${classId}`, { method: 'DELETE' })
}

export function listClassStudents(classId, examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes/${classId}/students${query}`)
}

export function listClassExams(classId, examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes/${classId}/exams${query}`)
}

export function listClassExamScoreTrend(classId, examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes/${classId}/score-trend${query}`)
}

export function listAvailableStudents() {
  return apiRequest('/api/admin/classes/available-students')
}

export function addClassStudent(classId, studentUserId) {
  return apiRequest(`/api/admin/classes/${classId}/students`, {
    method: 'POST', body: JSON.stringify({ studentUserId: Number(studentUserId) }),
  })
}

export function addClassStudents(classId, studentUserIds) {
  return apiRequest(`/api/admin/classes/${classId}/students/batch`, {
    method: 'POST', body: JSON.stringify({ studentUserIds: studentUserIds.map(Number) }),
  })
}

export function removeClassStudent(classId, studentUserId) {
  return apiRequest(`/api/admin/classes/${classId}/students/${studentUserId}`, { method: 'DELETE' })
}

export function listPapers(examTypeCode) {
  return apiRequest(`/api/admin/exam-types/${examTypeCode}/papers`)
}

export function listPaperGroups(examTypeCode) {
  return apiRequest(`/api/admin/exam-types/${examTypeCode}/paper-groups`)
}

export function createPaperGroup(examTypeCode, group) {
  return apiRequest(`/api/admin/exam-types/${examTypeCode}/paper-groups`, {
    method: 'POST', body: JSON.stringify(group),
  })
}

export function updatePaperGroup(groupId, group) {
  return apiRequest(`/api/admin/paper-groups/${groupId}`, { method: 'PUT', body: JSON.stringify(group) })
}

export function deletePaperGroup(groupId) {
  return apiRequest(`/api/admin/paper-groups/${groupId}`, { method: 'DELETE' })
}

export function reorderPaperGroups(examTypeCode, paperGroupIds) {
  return apiRequest(`/api/admin/exam-types/${examTypeCode}/paper-groups/order`, {
    method: 'PUT', body: JSON.stringify({ paperGroupIds }),
  })
}

export function reorderWorkspacePaperGroups(workspaceCode, groups) {
  return apiRequest(`/api/admin/workspaces/${workspaceCode}/paper-groups/order`, {
    method: 'PUT', body: JSON.stringify({ groups }),
  })
}

export function movePaperToGroup(paperId, paperGroupId) {
  return apiRequest(`/api/admin/papers/${paperId}/group`, {
    method: 'PATCH', body: JSON.stringify({ paperGroupId }),
  })
}

export function deletePaper(paperId) {
  return apiRequest(`/api/admin/papers/${paperId}`, { method: 'DELETE' })
}

export function setPaperArchived(paperId, archived) {
  return apiRequest(`/api/admin/papers/${paperId}/archive`, {
    method: 'PATCH', body: JSON.stringify({ archived }),
  })
}

export function createPaper(examTypeCode, paper) {
  return apiRequest(`/api/admin/exam-types/${examTypeCode}/papers`, { method: 'POST', body: JSON.stringify(paper) })
}

export function getPaper(paperId) {
  return apiRequest(`/api/admin/papers/${paperId}`)
}

export function updatePaper(paperId, paper) {
  return apiRequest(`/api/admin/papers/${paperId}`, { method: 'PATCH', body: JSON.stringify(paper) })
}

export function savePaperStructure(paperId, sections) {
  return apiRequest(`/api/admin/papers/${paperId}/structure`, { method: 'PUT', body: JSON.stringify({ sections }) })
}

export function createPaperVersion(paperId) {
  return apiRequest(`/api/admin/papers/${paperId}/versions`, { method: 'POST' })
}

export function sealPaper(paperId) {
  return apiRequest(`/api/admin/papers/${paperId}/seal`, { method: 'POST' })
}

export function listExams(examTypeCode) {
  return apiRequest(`/api/admin/exam-types/${examTypeCode}/exams`)
}

export function createExam(paperId, exam) {
  return apiRequest(`/api/admin/papers/${paperId}/exams`, { method: 'POST', body: JSON.stringify(exam) })
}

export function getExam(examId) {
  return apiRequest(`/api/admin/exams/${examId}`)
}

export function updateExam(examId, exam) {
  return apiRequest(`/api/admin/exams/${examId}`, { method: 'PATCH', body: JSON.stringify(exam) })
}

export function saveExamTargets(examId, targets) {
  return apiRequest(`/api/admin/exams/${examId}/targets`, { method: 'PUT', body: JSON.stringify(targets) })
}

export function publishExam(examId) {
  return apiRequest(`/api/admin/exams/${examId}/publish`, { method: 'POST' })
}

export function unpublishExam(examId) {
  return apiRequest(`/api/admin/exams/${examId}/unpublish`, { method: 'POST' })
}

export function closeExam(examId) {
  return apiRequest(`/api/admin/exams/${examId}/close`, { method: 'POST' })
}

export function deleteExam(examId) {
  return apiRequest(`/api/admin/exams/${examId}`, { method: 'DELETE' })
}

export function listStudentExams() {
  return apiRequest('/api/student/exams')
}

export function startStudentAttempt(examId, firstSection = '') {
  return apiRequest(`/api/student/exams/${examId}/attempts`, {
    method: 'POST', body: JSON.stringify(firstSection ? { firstSection } : {}),
  })
}

export function getStudentAttempt(attemptId) {
  return apiRequest(`/api/student/attempts/${attemptId}`)
}

export function saveStudentAnswer(attemptId, paperItemId, answer, timeSpentSeconds = 0) {
  return apiRequest(`/api/student/attempts/${attemptId}/answers/${paperItemId}`, {
    method: 'PUT', body: JSON.stringify({ answer, timeSpentSeconds }),
  })
}

export function setStudentBookmark(attemptId, paperItemId, marked) {
  return apiRequest(`/api/student/attempts/${attemptId}/bookmarks/${paperItemId}`, {
    method: 'PUT', body: JSON.stringify({ marked }),
  })
}

export function submitStudentAttempt(attemptId) {
  return apiRequest(`/api/student/attempts/${attemptId}/submit`, { method: 'POST' })
}
