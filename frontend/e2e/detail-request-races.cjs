const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 慢请求晚于路由切换返回时，不能覆盖当前班级、学生或报告。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const mode of ['sat-class', 'shsat-class', 'sat-student', 'shsat-student', 'sat-report', 'shsat-report']) {
      const page = await browser.newPage()
      page.setDefaultTimeout(8000)
      const errors = []
      let oldStarted
      const oldRequest = new Promise(resolve => { oldStarted = resolve })
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: 'admin', roleCode: 'ADMIN' } })
        if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'PSAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code })) })
        let id
        let payload
        if (mode.endsWith('class') && /^\/api\/admin\/classes\/\d+$/.test(url.pathname)) {
          id = url.pathname.split('/').pop(); payload = { id: Number(id), name: `Class ${id}`, status: 'ACTIVE' }
        } else if (mode === 'sat-student' && url.pathname.endsWith('/scores')) {
          id = url.searchParams.get('classId'); payload = { student: { name: `Class ${id} Student` }, scores: [], statistics: {} }
        } else if (mode === 'shsat-student' && url.pathname.includes('/reports/students/')) {
          id = url.searchParams.get('classId'); payload = [{ attemptId: Number(id), examTitle: `Class ${id} Exam`, status: 'COMPLETED' }]
        } else if (mode === 'sat-report' && /^\/api\/admin\/sat\/attempts\/\d+\/report$/.test(url.pathname)) {
          id = url.pathname.split('/')[5]; payload = { userName: `Report ${id}`, summary: {}, answers: [] }
        } else if (mode === 'shsat-report' && /^\/api\/admin\/reports\/attempts\/\d+\/result$/.test(url.pathname)) {
          id = url.pathname.split('/')[5]; payload = { studentName: `Report ${id}`, questions: [], scoreVisible: true }
        }
        if (id) {
          if (id === '1') { oldStarted(); await new Promise(resolve => setTimeout(resolve, 900)) }
          return route.fulfill({ json: payload }).catch(() => {})
        }
        return route.fulfill({ json: [] })
      })
      const paths = {
        'sat-class': id => `/sat/admin/classes/${id}`,
        'shsat-class': id => `/shsat/admin/classes/${id}`,
        'sat-student': id => `/sat/admin/classes/${id}/students/9/scores`,
        'shsat-student': id => `/shsat/admin/classes/${id}/students/9`,
        'sat-report': id => `/sat/student/report?examId=1&recordId=${id}&source=admin`,
        'shsat-report': id => `/shsat/student/attempts/${id}/report?adminReport=1`,
      }
      await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}${paths[mode](1)}`, { waitUntil: 'domcontentloaded' })
      await oldRequest
      await page.evaluate(path => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path), paths[mode](2))
      const expected = mode.endsWith('report') ? 'Report 2' : mode === 'sat-student' ? 'Class 2 Student' : mode === 'shsat-student' ? 'Class 2 Exam' : 'Class 2'
      await page.getByText(expected, { exact: mode !== 'sat-report' }).first().waitFor()
      await page.waitForTimeout(1100)
      assert.equal(await page.getByText(expected, { exact: mode !== 'sat-report' }).first().isVisible(), true, `${mode}: late response was ignored`)
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log('Late responses cannot overwrite current class, student or report')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
