const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 学生报告直接请求数据；刚交卷尚未就绪时重试，权限和开放时间错误直接显示。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const scenario of ['ready', 'pending', 'hidden', 'staff']) {
      const page = await browser.newPage()
      page.setDefaultTimeout(8000)
      let reports = 0
      let progress = 0
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: scenario, roleCode: scenario === 'staff' ? 'ADMIN' : 'STUDENT' } })
        if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'PSAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code })) })
        if (url.pathname === '/api/student/sat-attempts/10') { progress++; return route.fulfill({ json: { status: 'finished' } }) }
        if (url.pathname.endsWith('/10/report')) {
          reports++
          assert.equal(url.pathname.startsWith('/api/admin/'), scenario === 'staff')
          if (scenario === 'pending' && reports === 1) return route.fulfill({ status: 409, json: { message: 'The exam report is not ready yet.' } })
          if (scenario === 'hidden') return route.fulfill({ status: 409, json: { message: 'The score report is not available yet.' } })
          return route.fulfill({ json: { userName: 'Report Student', examName: 'Report Exam', paperName: 'Test Paper', summary: {}, answers: [] } })
        }
        return route.fulfill({ json: [] })
      })
      await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}/sat/student/report?examId=1&recordId=10${scenario === 'staff' ? '&source=admin' : ''}`)
      if (scenario === 'hidden') await page.getByText('The score report is not available yet.').waitFor()
      else await page.getByText('Student Name: Report Student').waitFor()
      assert.equal(progress, 0, `${scenario}: no redundant readiness request`)
      assert.equal(reports, scenario === 'pending' ? 2 : 1, `${scenario}: report request count`)
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log('SAT/PSAT report direct loading, submission retry and visibility errors passed')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
