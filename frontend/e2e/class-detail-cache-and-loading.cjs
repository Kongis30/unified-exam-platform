const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 检查各模块的班级返回缓存，以及慢考试列表不会阻塞班级资料与学生列表。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const type of ['SAT', 'PSAT', 'SHSAT']) {
      const page = await browser.newPage()
      const counts = { detail: 0, students: 0, exams: 0, trend: 0 }
      let examsReturned = false
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: 'admin', roleCode: 'ADMIN' } })
        if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'PSAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code })) })
        if (url.pathname === '/api/admin/classes/1') { counts.detail++; return route.fulfill({ json: { id: 1, name: 'Class One', status: 'ACTIVE' } }) }
        if (url.pathname === '/api/admin/classes/1/students') { counts.students++; return route.fulfill({ json: [{ id: 9, realName: 'Test Student', username: 'student', active: true }] }) }
        if (url.pathname === '/api/admin/classes/1/exams') { counts.exams++; await new Promise(resolve => setTimeout(resolve, 1200)); examsReturned = true; return route.fulfill({ json: [] }) }
        if (url.pathname === '/api/admin/classes/1/score-trend') { counts.trend++; return route.fulfill({ json: [] }) }
        if (url.pathname.includes('/scores')) return route.fulfill({ json: { student: { name: 'Test Student' }, scores: [], statistics: {} } })
        return route.fulfill({ json: [] })
      })
      const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'
      const root = `/${type.toLowerCase()}/admin/classes/1`
      await page.goto(`${base}${root}`)
      await page.getByText('Test Student', { exact: true }).first().waitFor()
      assert.equal(examsReturned, false, `${type}: student list renders before the slow exam response`)
      await page.waitForResponse(response => response.url().includes('/classes/1/exams'))
      const navigate = path => page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(value), path)
      await navigate(type === 'SHSAT' ? `${root}/students/9` : `${root}/students/9/scores`)
      await navigate(root)
      await page.getByText('Test Student', { exact: true }).first().waitFor()
      assert.deepEqual(counts, { detail: 1, students: 1, exams: 1, trend: 1 }, `${type}: return reuses class requests`)
      await page.close()
    }
    console.log('Class detail cache and independent loading passed for SAT, PSAT and SHSAT')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
