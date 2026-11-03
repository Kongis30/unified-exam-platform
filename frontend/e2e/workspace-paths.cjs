const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 验证新模块入口、旧链接和 SAT/PSAT 共用页面的路径转换。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) return route.continue()
    if (path === '/api/auth/me') return route.fulfill({ status: 401, json: { message: 'Not authenticated' } })
    return route.fulfill({ json: [] })
  })
  await page.goto(`${process.env.E2E_BASE_URL || 'http://localhost:5173'}/sat`)
  await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('redirect') === '/sat')
  const results = await page.evaluate(async () => {
    const { router } = await import('/src/router.js')
    const { authState } = await import('/src/auth.js')
    authState.loaded = true
    authState.user = { username: 'test', roleCode: 'ADMIN' }
    const paths = []
    for (const path of ['/exam-types/SAT/admin', '/exam-types/PSAT/admin/classes/9?tab=exams', '/exam-types/SHSAT/admin/classes/4']) {
      await router.push(path)
      paths.push(router.currentRoute.value.fullPath)
    }
    authState.user = { username: 'test', roleCode: 'STUDENT' }
    await router.push('/student/systems/PSAT')
    paths.push(router.currentRoute.value.fullPath)
    sessionStorage.setItem('sat:workspace', 'PSAT')
    await router.push('/student/sat/exams/123')
    paths.push(router.currentRoute.value.fullPath)
    await router.push('/student/sat/break?recordId=3')
    paths.push(router.currentRoute.value.fullPath)
    await router.push('/student/systems/SHSAT')
    paths.push(router.currentRoute.value.fullPath)
    await router.push('/student/shsat/exams/123')
    paths.push(router.currentRoute.value.fullPath)
    return paths
  })
  assert.deepEqual(results, ['/sat', '/psat/admin/classes/9?tab=exams', '/shsat/admin/classes/4',
    '/psat', '/psat/student/exams/123', '/psat/student/break?recordId=3', '/shsat', '/shsat/student/exams/123'])
  await browser.close()
  console.log('Workspace paths, login return, old links and PSAT exam navigation passed')
})().catch(error => { console.error(error); process.exit(1) })
