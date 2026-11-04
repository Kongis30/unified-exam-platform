const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 同一浏览器共用 Cookie，一个标签页退出时其他标签页不能继续展示旧账号的缓存页面。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  let signedIn = true
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/auth/me') return signedIn
      ? route.fulfill({ json: { username: 'admin', roleCode: 'ADMIN' } })
      : route.fulfill({ status: 401, json: {} })
    if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
    if (url.pathname === '/api/auth/logout') { signedIn = false; return route.fulfill({ json: {} }) }
    if (url.pathname === '/api/exam-types') return route.fulfill({ json: [{ code: 'SAT', displayName: 'SAT', workspaceCode: 'SAT' }] })
    if (url.pathname === '/api/admin/exam-types/SAT/papers') return route.fulfill({ json: [{ id: 1, title: 'Private paper', examTypeCode: 'SAT', paperCode: 'test', versionNo: 1, status: 'DRAFT', updatedAt: '2026-01-01T00:00:00Z' }] })
    return route.fulfill({ json: [] })
  })
  const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'
  const first = await context.newPage()
  const second = await context.newPage()
  await first.goto(`${base}/sat`)
  await first.getByRole('button', { name: /Default Folder/ }).click()
  await first.getByText('Private paper', { exact: true }).waitFor()
  await second.goto(`${base}/sat`)
  await second.getByRole('tab', { name: 'Paper Management' }).waitFor()
  await second.evaluate(async () => { const { logout } = await import('/src/api/platform.js'); await logout() })
  await first.waitForURL('**/login')
  assert.equal(await first.getByText('Private paper', { exact: true }).count(), 0)
  await context.close()

  const switchContext = await browser.newContext()
  let role = 'ADMIN'
  await switchContext.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: role.toLowerCase(), roleCode: role } })
    if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
    if (url.pathname === '/api/auth/login') { role = 'STUDENT'; return route.fulfill({ json: { username: 'student', roleCode: role } }) }
    if (url.pathname === '/api/exam-types') return route.fulfill({ json: [{ code: 'SAT', displayName: 'SAT', workspaceCode: 'SAT' }] })
    if (url.pathname === '/api/admin/exam-types/SAT/papers') return route.fulfill({ json: [{ id: 1, title: 'Private paper', examTypeCode: 'SAT', paperCode: 'test', versionNo: 1, status: 'DRAFT', updatedAt: '2026-01-01T00:00:00Z' }] })
    return route.fulfill({ json: [] })
  })
  const adminTab = await switchContext.newPage()
  const loginTab = await switchContext.newPage()
  await adminTab.goto(`${base}/sat`)
  await adminTab.getByRole('button', { name: /Default Folder/ }).click()
  await adminTab.getByText('Private paper', { exact: true }).waitFor()
  await loginTab.goto(`${base}/sat`)
  await loginTab.getByRole('tab', { name: 'Paper Management' }).waitFor()
  await loginTab.evaluate(async () => { const { login } = await import('/src/api/platform.js'); await login({ username: 'student', password: 'test' }) })
  await adminTab.waitForURL('**/student/systems')
  assert.equal(await adminTab.getByText('Private paper', { exact: true }).count(), 0)
  await browser.close()
  console.log('Cross-tab logout and account change discard the previous workspace')
})().catch(error => { console.error(error); process.exit(1) })
