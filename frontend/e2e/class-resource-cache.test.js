import test from 'node:test'
import assert from 'node:assert/strict'
import { clearSessionCache, getClass, listClassExams, listClassStudents, apiRequest } from '../src/api/platform.js'

test('class requests coalesce, isolate workspaces and refresh after writes or session changes', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const originalStorage = globalThis.localStorage
  const calls = []
  globalThis.window = { location: { pathname: '/sat' } }
  globalThis.localStorage = { setItem() {} }
  globalThis.fetch = async (path, options = {}) => {
    calls.push([path, options.method || 'GET'])
    await new Promise((resolve) => setTimeout(resolve, 5))
    return new Response(JSON.stringify(path === '/api/auth/csrf' ? { token: 'test' } : { path }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    clearSessionCache()
    await Promise.all([getClass(1, ['SAT']), getClass(1, ['SAT'], { force: true })])
    assert.equal(calls.filter(([path]) => path === '/api/admin/classes/1?examTypeCodes=SAT').length, 1)
    await getClass(1, ['SAT'])
    await getClass(1, ['PSAT'])
    await listClassStudents(1, ['SAT'])
    await listClassExams(1, ['SAT'])
    assert.equal(calls.length, 4)
    await getClass(1, ['SAT'], { force: true })
    assert.equal(calls.length, 5)
    await apiRequest('/api/admin/classes/1', { method: 'PATCH', body: '{}' })
    await getClass(1, ['SAT'])
    await listClassStudents(1, ['SAT'])
    await listClassExams(1, ['SAT'])
    assert.equal(calls.length, 10)
    clearSessionCache()
    await getClass(1, ['SAT'])
    assert.equal(calls.length, 11)
  } finally {
    clearSessionCache()
    globalThis.fetch = originalFetch
    globalThis.window = originalWindow
    globalThis.localStorage = originalStorage
  }
})
