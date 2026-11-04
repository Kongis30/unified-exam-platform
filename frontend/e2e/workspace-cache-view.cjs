const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 返回模块时保留页面和位置；在详情页修改数据后只刷新受影响的模块。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(6000)
  const reads = { SAT: 0, PSAT: 0 }
  let satTitle = 'SAT Paper One'
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: 'admin', roleCode: 'ADMIN' } })
    if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
    if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'PSAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code, workspaceName: code })) })
    const match = url.pathname.match(/^\/api\/admin\/exam-types\/(SAT|PSAT)\/papers$/)
    if (match) {
      const code = match[1]
      reads[code] += 1
      return route.fulfill({ json: [{ id: code === 'SAT' ? 1 : 2, title: code === 'SAT' ? satTitle : 'PSAT Paper One', examTypeCode: code, paperCode: 'test', versionNo: 1, status: 'DRAFT', updatedAt: '2026-01-01T00:00:00Z' }] })
    }
    if (method === 'PATCH' && url.pathname === '/api/admin/papers/1') { satTitle = 'SAT Paper Updated'; return route.fulfill({ json: {} }) }
    return route.fulfill({ json: [] })
  })
  const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'
  await page.goto(`${base}/sat`)
  await page.getByRole('button', { name: /Default Folder/ }).click()
  await page.getByText('SAT Paper One', { exact: true }).waitFor()
  await page.addStyleTag({ content: '.type-page-content, .admin-home { min-height: 3000px; }' })
  await page.evaluate(() => { window.originalWorkspace = document.querySelector('.type-page-content'); window.scrollTo(0, 600) })
  await page.waitForFunction(() => Math.abs(window.scrollY - 600) < 2)
  await page.locator('.admin-layout__nav').getByRole('link', { name: 'PSAT', exact: true }).click()
  await page.waitForURL('**/psat')
  await page.getByRole('button', { name: /Default Folder/ }).click()
  await page.getByText('PSAT Paper One', { exact: true }).waitFor()
  await page.locator('.admin-layout__nav').getByRole('link', { name: 'SAT', exact: true }).click()
  await page.waitForURL('**/sat')
  await page.waitForFunction(() => Math.abs(window.scrollY - 600) < 2, null, { timeout: 6000 }).catch(async error => {
    console.error('Restored scroll:', await page.evaluate(() => window.scrollY))
    throw error
  })
  assert.equal(await page.evaluate(() => document.querySelector('.type-page-content') === window.originalWorkspace), true)
  assert.deepEqual(reads, { SAT: 1, PSAT: 1 })

  const refreshResponse = page.waitForResponse(response => response.url().includes('/api/admin/exam-types/SAT/papers'))
  await page.evaluate(() => {
    window.originalNow = Date.now
    const time = Date.now()
    Date.now = () => time + 61_000
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await refreshResponse
  assert.equal(reads.SAT, 2, 'returning to a visible tab revalidates expired data')
  await page.evaluate(() => { Date.now = window.originalNow })

  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => /\/src\/api\/platform\.js(?:\?|$)/.test(url))
    const { apiRequest } = await import(moduleUrl)
    await apiRequest('/api/admin/papers/1', { method: 'PATCH', body: '{}' })
  })
  await page.locator('.admin-layout__nav').getByRole('link', { name: 'PSAT', exact: true }).click()
  await page.waitForURL('**/psat')
  await page.locator('.admin-layout__nav').getByRole('link', { name: 'SAT', exact: true }).click()
  await page.waitForURL('**/sat')
  await page.getByText('SAT Paper Updated', { exact: true }).waitFor()
  assert.deepEqual(reads, { SAT: 3, PSAT: 1 })
  await page.locator('.admin-layout__nav').getByRole('link', { name: 'SHSAT', exact: true }).click()
  await page.waitForURL('**/shsat')
  await page.getByRole('tab', { name: 'Exam Release' }).waitFor()
  await page.locator('.admin-layout__nav').getByRole('link', { name: 'SAT', exact: true }).click()
  await page.waitForURL('**/sat')
  await page.evaluate(() => {
    history.pushState(history.state, '', '/shsat?tab=exams&releaseScrollY=450')
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  })
  await page.waitForFunction(() => Math.abs(window.scrollY - 450) < 2).catch(async error => {
    console.error('SHSAT scroll:', await page.evaluate(() => ({ y: window.scrollY, url: location.href })))
    throw error
  })
  await page.waitForURL(url => url.pathname === '/shsat' && !url.searchParams.has('releaseScrollY'))
  assert.deepEqual(errors, [])
  const student = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  await student.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: 'student', roleCode: 'STUDENT' } })
    if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code, workspaceName: code })) })
    return route.fulfill({ json: [] })
  })
  await student.goto(`${base}/shsat`)
  await student.getByRole('heading', { name: 'Your exams' }).waitFor()
  await student.addStyleTag({ content: '.type-page-content { min-height: 3000px; }' })
  await student.locator('.main-layout__nav').getByRole('link', { name: 'SAT', exact: true }).click()
  await student.waitForURL('**/sat')
  await student.evaluate(() => {
    history.pushState(history.state, '', '/shsat?historyScrollY=470')
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  })
  await student.waitForFunction(() => Math.abs(window.scrollY - 470) < 2, null, { timeout: 6000 })
  await student.waitForURL(url => url.pathname === '/shsat' && !url.searchParams.has('historyScrollY'))
  await browser.close()
  console.log('Workspace component, scroll position and targeted background refresh passed')
})().catch(error => { console.error(error); process.exit(1) })
