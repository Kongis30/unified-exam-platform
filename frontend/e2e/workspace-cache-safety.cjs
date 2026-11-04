const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 验证过期、强制刷新、并发修改和会话切换不会返回错误的缓存数据。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let satReads = 0
  let psatReads = 0
  let releaseFirst
  let firstStarted
  const firstGate = new Promise(resolve => { releaseFirst = resolve })
  const firstRequest = new Promise(resolve => { firstStarted = resolve })
  let releasePsat
  let psatStarted
  const psatGate = new Promise(resolve => { releasePsat = resolve })
  const psatRequest = new Promise(resolve => { psatStarted = resolve })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/auth/me') return route.fulfill({ status: 401, json: {} })
    if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
    if (url.pathname === '/api/admin/exam-types/SAT/papers') {
      satReads += 1
      if (satReads === 1) { firstStarted(); await firstGate; return route.fulfill({ json: [{ title: 'old' }] }) }
      return route.fulfill({ json: [{ title: 'new' }] })
    }
    if (url.pathname === '/api/admin/exam-types/PSAT/papers') {
      psatReads += 1
      psatStarted()
      await psatGate
      return route.fulfill({ json: [{ title: 'previous account' }] })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}/login`)
  await page.evaluate(async () => {
    window.api = await import('/src/api/platform.js')
    window.pendingRead = window.api.listPapers('SAT')
  })
  await firstRequest
  await page.evaluate(() => window.api.apiRequest('/api/admin/sat/papers/1/editor/questions', { method: 'POST', body: '{}' }))
  releaseFirst()
  assert.equal(await page.evaluate(async () => (await window.pendingRead)[0].title), 'new')
  assert.equal(satReads, 2, 'a response invalidated during a write must be fetched again')
  await page.evaluate(async () => { const rows = await window.api.listPapers('SAT'); rows[0].title = 'locally changed' })
  assert.equal(await page.evaluate(async () => (await window.api.listPapers('SAT'))[0].title), 'new')
  assert.equal(satReads, 2, 'callers cannot mutate the shared cached data')
  await page.evaluate(() => { const now = Date.now(); Date.now = () => now + 61_000 })
  await page.evaluate(() => window.api.listPapers('SAT'))
  assert.equal(satReads, 3, 'expired data is fetched again')
  await page.evaluate(() => window.api.listPapers('SAT', { force: true }))
  assert.equal(satReads, 4, 'manual refresh bypasses a fresh cache')
  await page.evaluate(() => { window.psatResult = window.api.listPapers('PSAT').then(() => 'unexpected', () => 'discarded') })
  await psatRequest
  await page.evaluate(() => window.api.logout())
  releasePsat()
  assert.equal(await page.evaluate(() => window.psatResult), 'discarded', 'pending data from the previous session is discarded')
  await page.evaluate(() => window.api.listPapers('SAT'))
  assert.equal(satReads, 5, 'logout clears cached data')
  assert.equal(psatReads, 1)
  await browser.close()
  console.log('Cache expiry, manual refresh, in-flight invalidation and session isolation passed')
})().catch(error => { console.error(error); process.exit(1) })
