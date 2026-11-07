import { apiRequest, cachedResource, listClasses, listClassExams } from '@/api/platform'

// 任务窗口在接口中使用 UTC，展示时由浏览器转换到用户本地时区。
const localizeWindow = task => ({ ...task, startAt: task.startAt ? `${task.startAt}Z` : null, endAt: task.endAt ? `${task.endAt}Z` : null })
const utcWindow = payload => ({ ...payload, startAt: new Date(payload.startAt).toISOString().slice(0, 19), endAt: new Date(payload.endAt).toISOString().slice(0, 19) })

// 复习任务按模块缓存；作答和任务写入会使相关缓存失效。
export const reviewAssignments = {
  list: async (type, options = {}) => (await cachedResource(`/api/admin/review-assignments/${type}`, [`review:${type}`, 'student'], 30_000, options)).map(localizeWindow),
  detail: (type, id) => apiRequest(`/api/admin/review-assignments/${type}/${id}`),
  create: (type, payload) => apiRequest(`/api/admin/review-assignments/${type}`, { method: 'POST', body: JSON.stringify(utcWindow(payload)) }),
  end: (type, id) => apiRequest(`/api/admin/review-assignments/${type}/${id}/end`, { method: 'POST', body: '{}' }),
  classes: (type) => listClasses([type]),
  exams: (type, classId) => listClassExams(classId, [type]),
  studentList: async (type, options = {}) => (await cachedResource(`/api/student/review-assignments/${type}`, [`review:${type}`, 'student'], 30_000, options)).map(localizeWindow),
  start: (type, id) => apiRequest(`/api/student/review-assignments/${type}/${id}/start`, { method: 'POST', body: '{}' }),
}
