let csrfToken
let examTypesCache = null
let examTypesRequest = null
let examTypesGeneration = 0
const EXAM_TYPES_CACHE_MS = 60_000
const resourceCache = new Map()
let cacheSession = 0
export const SESSION_CHANGE_KEY = 'unified-exam-session-change'

// 缓存仅存在于当前登录会话；退出或权限变化时清空所有已加载数据。
function clearExamTypesCache() {
  csrfToken = undefined
  examTypesGeneration += 1
  examTypesCache = null
  examTypesRequest = null
  cacheSession += 1
  resourceCache.clear()
}

export function clearSessionCache() {
  clearExamTypesCache()
}

// 同一浏览器的其他标签页共享登录 Cookie，切换账号时通知它们丢弃旧会话数据。
function notifySessionChange() {
  try { localStorage.setItem(SESSION_CHANGE_KEY, `${Date.now()}-${Math.random()}`) } catch { /* 不影响登录 */ }
}

function invalidateResources(...tags) {
  for (const [key, entry] of resourceCache) {
    if (tags.some((tag) => entry.tags.includes(tag))) resourceCache.delete(key)
  }
}

// 只复用明确列出的列表请求；过期和手动刷新会重新请求服务端。
export function cachedResource(path, tags, maxAge = 30_000, { force = false } = {}) {
  const previous = resourceCache.get(path)
  if (!force && previous && (previous.pending || previous.expiresAt > Date.now())) {
    return previous.promise.then((data) => structuredClone(data))
  }
  const session = cacheSession
  const entry = { tags, pending: true, expiresAt: 0, promise: null }
  entry.promise = apiRequest(path).then((data) => {
    if (session !== cacheSession) throw new Error('Session changed while loading data.')
    // 写操作发生在请求期间时，重新获取而不把旧响应交给页面。
    if (resourceCache.get(path) !== entry) return cachedResource(path, tags, maxAge)
    entry.pending = false
    entry.expiresAt = Date.now() + maxAge
    return data
  }).catch((error) => {
    if (resourceCache.get(path) === entry) resourceCache.delete(path)
    throw error
  })
  resourceCache.set(path, entry)
  return entry.promise.then((data) => structuredClone(data))
}

// 写操作只失效可能受影响的数据；未知模块的管理修改保守地失效同类缓存。
function invalidateAfterWrite(path) {
  const match = path.match(/\/exam-types\/(SAT|PSAT|SHSAT)\//i)
    || path.match(/\/workspaces\/(SAT|PSAT|SHSAT)\//i)
    || window.location.pathname.match(/^\/(sat|psat|shsat)(?:\/|$)/i)
  const code = match?.[1]?.toUpperCase()
  const scoped = (category) => code ? [`${category}:${code}`] : ['SAT', 'PSAT', 'SHSAT'].map((item) => `${category}:${item}`)
  if (/\/api\/admin\/users(?:\/|$)/.test(path)) {
    clearExamTypesCache()
  } else if (/\/wrong-answer-tasks(?:\/|$)/.test(path)) {
    invalidateResources('review:SHSAT', 'student')
  } else if (/\/api\/admin\/(?:sat\/students\/[^/]+\/attempts|reports\/attempts)(?:\/|$)/.test(path)) {
    invalidateResources('student', 'class:SAT', 'class:PSAT', 'class:SHSAT')
  } else if (/\/api\/admin\/classes(?:\/|$)/.test(path)) {
    invalidateResources('class:SAT', 'class:PSAT', 'class:SHSAT', 'student')
  } else if (/\/api\/admin\/exams(?:\/|$)/.test(path) || /\/api\/admin\/papers\/[^/]+\/exams(?:\/|$)/.test(path)) {
    invalidateResources(...scoped('exam'), ...scoped('paper'), 'student', 'class:SAT', 'class:PSAT', 'class:SHSAT')
  } else if (/\/api\/admin\/(?:sat\/)?(?:papers|paper-groups|questions)(?:\/|$)/.test(path)
      || /\/api\/admin\/(?:exam-types|workspaces)\/[^/]+\/(?:papers|paper-groups)(?:\/|$)/.test(path)) {
    invalidateResources(...scoped('paper'), 'student')
  } else if (/\/api\/student\//.test(path) && !/\/(?:presence|answers|bookmarks|save|focus-violations)(?:\/|$)/.test(path)) {
    invalidateResources('student', ...scoped('exam'), 'class:SAT', 'class:PSAT', 'class:SHSAT')
  }
}

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
  if (response.status === 401) clearExamTypesCache()
  const data = await readResponse(response)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) invalidateAfterWrite(path)
  return data
}

export function getExamTypes() {
  if (examTypesCache && examTypesCache.expiresAt > Date.now()) return Promise.resolve(examTypesCache.data)
  if (examTypesRequest) return examTypesRequest
  const generation = examTypesGeneration
  const request = apiRequest('/api/exam-types').then((data) => {
    if (generation === examTypesGeneration) examTypesCache = { data, expiresAt: Date.now() + EXAM_TYPES_CACHE_MS }
    return data
  }).finally(() => {
    if (examTypesRequest === request) examTypesRequest = null
  })
  examTypesRequest = request
  return request
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
  clearExamTypesCache()
  await ensureCsrfToken()
  const user = await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) })
  notifySessionChange()
  return user
}

export async function logout() {
  clearExamTypesCache()
  try { return await apiRequest('/api/auth/logout', { method: 'POST' }) } finally { notifySessionChange() }
}

export function listUsers() {
  return apiRequest('/api/admin/users')
}

export function listAccountWorkspaces() {
  return apiRequest('/api/admin/users/workspaces')
}

export function updateUserWorkspaces(userId, workspaceCodes) {
  clearExamTypesCache()
  return apiRequest(`/api/admin/users/${userId}/workspaces`, {
    method: 'PUT', body: JSON.stringify({ workspaceCodes }),
  })
}

export function updateUser(userId, details) {
  return apiRequest(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(details) })
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

export function listClasses(examTypeCodes = [], { force = false } = {}) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  const tags = (examTypeCodes.length ? examTypeCodes : ['SAT', 'PSAT', 'SHSAT']).map((code) => `class:${code}`)
  return cachedResource(`/api/admin/classes${query}`, tags, 60_000, { force })
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

export function listClassStudents(classId, examTypeCodes = [], { force = false } = {}) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  const tags = (examTypeCodes.length ? examTypeCodes : ['SAT', 'PSAT', 'SHSAT']).map((code) => `class:${code}`)
  return cachedResource(`/api/admin/classes/${classId}/students${query}`, tags, 30_000, { force })
}

export function listClassExams(classId, examTypeCodes = []) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  return apiRequest(`/api/admin/classes/${classId}/exams${query}`)
}

export function listClassExamScoreTrend(classId, examTypeCodes = [], options = {}) {
  const params = new URLSearchParams()
  examTypeCodes.forEach((code) => params.append('examTypeCodes', code))
  const query = params.size ? `?${params.toString()}` : ''
  const tags = (examTypeCodes.length ? examTypeCodes : ['SAT', 'PSAT', 'SHSAT']).map((code) => `class:${code}`)
  return cachedResource(`/api/admin/classes/${classId}/score-trend${query}`, [...tags, 'student'], 30_000, options)
}

export function listAvailableStudents({ examTypeCode, force = false } = {}) {
  const params = new URLSearchParams({ examTypeCode })
  return cachedResource(`/api/admin/classes/available-students?${params}`, [`class:${examTypeCode}`], 30_000, { force })
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

export function listPapers(examTypeCode, { force = false } = {}) {
  return cachedResource(`/api/admin/exam-types/${examTypeCode}/papers`, [`paper:${examTypeCode}`], 60_000, { force })
}

export function listPaperGroups(examTypeCode, { force = false } = {}) {
  return cachedResource(`/api/admin/exam-types/${examTypeCode}/paper-groups`, [`paper:${examTypeCode}`], 60_000, { force })
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

export function listExams(examTypeCode, { force = false } = {}) {
  return cachedResource(`/api/admin/exam-types/${examTypeCode}/exams`, [`exam:${examTypeCode}`], 15_000, { force })
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

export function hideExamRelease(examId) {
  return apiRequest(`/api/admin/exams/${examId}`, { method: 'DELETE' })
}

export function deleteClassExam(classId, examId) {
  return apiRequest(`/api/admin/classes/${classId}/exams/${examId}`, { method: 'DELETE' })
}

export function listStudentExams({ force = false } = {}) {
  return cachedResource('/api/student/exams', ['student'], 15_000, { force })
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
