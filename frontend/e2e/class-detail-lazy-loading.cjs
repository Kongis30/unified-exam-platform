const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 班级首屏不请求操作弹窗专用目录；弹窗失败后可以重试并选择正确数据。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const type of ['SAT', 'PSAT', 'SHSAT']) {
      const page = await browser.newPage()
      page.setDefaultTimeout(8000)
      const errors = []
      const reads = { directory: 0, classes: 0, trend: 0 }
      let trendBeforeClass = false
      let classFinished = false
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: 'admin', roleCode: 'ADMIN' } })
        if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'PSAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code })) })
        if (url.pathname === '/api/admin/classes/available-students') {
          reads.directory++
          return reads.directory === 1 ? route.fulfill({ status: 500, json: { message: 'Directory unavailable' } }) : route.fulfill({ json: [{ id: 2, realName: 'Candidate Student', username: 'candidate' }] })
        }
        if (url.pathname === '/api/admin/classes') {
          reads.classes++
          return reads.classes === 1 ? route.fulfill({ status: 500, json: { message: 'Classes unavailable' } }) : route.fulfill({ json: [{ id: 1, name: 'Class One', status: 'ACTIVE' }, { id: 2, name: 'Class Two', status: 'ACTIVE' }] })
        }
        if (url.pathname === '/api/admin/classes/1/score-trend') { reads.trend++; trendBeforeClass ||= !classFinished; return route.fulfill({ json: [{ examDate: '2026-01-01', averageScaledScore: 500 }] }) }
        if (url.pathname === '/api/admin/classes/1') { await new Promise(resolve => setTimeout(resolve, 300)); classFinished = true; return route.fulfill({ json: { id: 1, name: 'Class One', status: 'ACTIVE' } }) }
        if (url.pathname === '/api/admin/classes/1/students') return route.fulfill({ json: [{ id: 1, realName: 'Existing Student', username: 'existing' }] })
        return route.fulfill({ json: [] })
      })
      await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}/${type.toLowerCase()}/admin/classes/1`)
      await page.getByText('Existing Student', { exact: true }).first().waitFor()
      await page.locator('.class-exam-score-trend').getByText('500', { exact: true }).first().waitFor()
      assert.deepEqual(reads, { directory: 0, classes: 0, trend: 1 }, `${type} loads the class without directories or duplicated trend requests`)
      assert.equal(trendBeforeClass, true, `${type} requests trend while class details load`)
      if (type === 'SHSAT') {
        await page.getByRole('row', { name: /Existing Student/ }).getByRole('button', { name: 'Edit', exact: true }).click()
        await page.getByText('Classes unavailable').waitFor()
        await page.getByRole('button', { name: 'Retry loading classes' }).click()
        await page.getByLabel('Class', { exact: true }).selectOption('2')
        assert.equal(reads.classes, 2)
        await page.getByRole('button', { name: 'Close student dialog' }).click()
        await page.getByRole('button', { name: 'Refresh class detail' }).click()
        await page.locator('.class-exam-score-trend').getByText('500', { exact: true }).first().waitFor()
        assert.equal(reads.trend, 2, 'manual refresh reloads the trend')
      } else {
        await page.getByRole('button', { name: 'Add student', exact: true }).click()
        await page.getByText('Directory unavailable').waitFor()
        await page.getByRole('button', { name: 'Retry', exact: true }).click()
        await page.getByText('Candidate Student', { exact: true }).waitFor()
        await page.getByRole('checkbox', { name: 'Select Candidate Student' }).check()
        assert.equal(await page.getByRole('button', { name: 'Add 1 student' }).isEnabled(), true)
        assert.equal(reads.directory, 2)
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
    console.log('Class detail lazy directory loading and retry passed for SAT, PSAT and SHSAT')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
