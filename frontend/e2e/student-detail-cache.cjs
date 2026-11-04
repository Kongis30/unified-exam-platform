const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 同一学生在不同班级的历史必须隔离；返回页面可复用缓存，刷新及写操作后重新加载。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const type of ['SAT', 'PSAT', 'SHSAT']) {
      const page = await browser.newPage()
      page.setDefaultTimeout(8000)
      const errors = []
      const reads = { 1: 0, 2: 0 }
      let failNextHistory = true
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: 'admin', roleCode: 'ADMIN' } })
        if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
        if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'PSAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code })) })
        if (url.pathname === '/api/admin/classes/1/students' && route.request().method() === 'POST') return route.fulfill({ json: {} })
        if (url.pathname.includes('/scores') || url.pathname.includes('/reports/students/')) {
          if (url.pathname.includes('/students/10/') && failNextHistory) {
            failNextHistory = false
            return route.fulfill({ status: 500, json: { message: 'History unavailable' } })
          }
          const classId = url.searchParams.get('classId')
          reads[classId]++
          const record = { attemptId: Number(classId), examTitle: `Class ${classId} Exam`, examTypeCode: type, status: 'COMPLETED', totalScaledScore: 500, rawTotalScore: 50, submittedAt: '2026-01-01T00:00:00Z' }
          return route.fulfill({ json: type === 'SHSAT' ? [record] : { student: { name: 'Test Student' }, scores: [record], statistics: {} } })
        }
        return route.fulfill({ json: [] })
      })
      const root = type.toLowerCase()
      const path = id => type === 'SHSAT' ? `/${root}/admin/classes/${id}/students/9` : `/${root}/admin/classes/${id}/students/9/scores`
      await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}${path(1)}`)
      await page.getByText('Class 1 Exam', { exact: true }).first().waitFor()
      const navigate = target => page.evaluate(url => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(url), target)
      await navigate(path(2))
      await page.getByText('Class 2 Exam', { exact: true }).first().waitFor().catch(async e => { console.error(type, page.url(), reads, (await page.locator('body').innerText()).slice(0, 1200)); throw e })
      assert.equal(await page.getByText('Class 1 Exam', { exact: true }).count(), 0, `${type} isolates class history`)
      await navigate(path(1))
      await page.getByText('Class 1 Exam', { exact: true }).first().waitFor()
      assert.deepEqual(reads, { 1: 1, 2: 1 }, `${type} reuses history for the same class`)
      await page.evaluate(async () => { const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => /\/src\/api\/platform\.js(?:\?|$)/.test(url)); const { apiRequest } = await import(moduleUrl); await apiRequest('/api/admin/classes/1/students', { method: 'POST', body: '{}' }) })
      if (type === 'SHSAT') {
        await Promise.all([page.waitForResponse(response => response.url().includes('/reports/students/')), page.getByRole('button', { name: 'Refresh history' }).click()])
      } else {
        await navigate(path(2)); await page.getByText('Class 2 Exam', { exact: true }).first().waitFor()
        await navigate(path(1)); await page.getByText('Class 1 Exam', { exact: true }).first().waitFor()
      }
      assert.equal(reads[1], 2, `${type} reloads after write`)
      await navigate(path(1).replace('/students/9', '/students/10'))
      await page.getByText('History unavailable').waitFor()
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.getByText('Class 1 Exam', { exact: true }).first().waitFor()
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log('Student history cache, class isolation and invalidation passed for SAT, PSAT and SHSAT')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
