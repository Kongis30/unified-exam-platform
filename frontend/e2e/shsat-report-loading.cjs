const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 管理员和学生使用各自的报告接口；受限内容与错误重试保持原样。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const scenario of ['staff', 'student-visible', 'student-hidden', 'student-retry']) {
      const page = await browser.newPage()
      page.setDefaultTimeout(8000)
      let requests = 0
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: scenario, roleCode: scenario === 'staff' ? 'ADMIN' : 'STUDENT' } })
        if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'PSAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code })) })
        if (/\/attempts\/10\/(result|report)$/.test(url.pathname)) {
          requests++
          assert.equal(url.pathname.startsWith('/api/admin/'), scenario === 'staff')
          if (scenario === 'student-retry' && requests === 1) return route.fulfill({ status: 403, json: { message: 'Report unavailable' } })
          const visible = scenario !== 'student-hidden'
          return route.fulfill({ json: { studentName: 'Report Student', examTitle: 'Report Exam', scoreVisible: visible, answersVisible: visible, questions: visible ? [{ questionNumber: 1, questionType: 'MULTIPLE_CHOICE', correctAnswer: 'A', status: 'CORRECT' }] : [] } })
        }
        return route.fulfill({ json: [] })
      })
      await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}/shsat/student/attempts/10/report${scenario === 'staff' ? '?adminReport=1' : ''}`)
      if (scenario === 'student-retry') {
        await page.getByText('Report unavailable').waitFor()
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
      }
      await page.getByText('Report Exam', { exact: true }).waitFor()
      if (scenario === 'student-hidden') assert.equal(await page.getByRole('button', { name: 'Question 1', exact: true }).count(), 0)
      else await page.getByRole('button', { name: 'Question 1', exact: true }).waitFor()
      assert.equal(requests, scenario === 'student-retry' ? 2 : 1)
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log('SHSAT report role-specific loading, visibility and retry passed')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
