const assert = require('node:assert/strict')
const { chromium } = require('playwright')

// 从真实学生入口验证不同材料格式；接口数据由测试提供，不写入数据库。
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const versioned = fields => `[[TEXT_MATERIAL_FORMAT:2]]\n${JSON.stringify({ version: 2, introduction: '', passageTitle: '', author: '', body: '', ...fields })}`
  const question = (id, material) => ({ paperItemId: id, displayNumber: id, maxPoints: 1, stem: `Question stem ${id}`, questionTypeCode: 'MULTIPLE_CHOICE', display: { material, options: ['First', 'Second'] } })
  const questions = [
    question(1, { content: versioned({ introduction: 'Read **carefully**.', passageTitle: 'A Passage', author: 'The Author', body: 'First paragraph\n\nSecond paragraph with $x^2$ and $$y=2$$.\n[[MATERIAL_IMAGE:/test/inline.svg]]\nAfter image' }) }),
    question(2, { content: 'Legacy title\nLegacy author\nLegacy first line\nLegacy second line' }),
    question(3, { content: '\n\nBody only, with *emphasis* and ++underline++.' }),
    question(4, { type: 'IMAGE', title: 'Whole material', assetUrl: '/test/whole.svg' }),
    question(5, { content: versioned({ body: 'Before\n[[MATERIAL_IMAGE:/test/missing.svg]]\nAfter' }) }),
    question(6, { content: '[[TEXT_MATERIAL_FORMAT:2]]\n{broken' }),
    question(7, { content: versioned({ body: '<img src=x onerror="window.injected=true">\n<script>window.injected=true</script>' }) }),
    question(8, null),
    question(9, { content: 'Single legacy line' }),
    question(10, { content: '[[TEXT_MATERIAL_FORMAT:99]]\n{"version":99,"body":"future"}' }),
    question(11, { type: 'IMAGE', assetUrl: '/test/missing.svg' }),
  ]
  const requests = []
  try {
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/test/missing.svg') return route.fulfill({ status: 404, body: 'missing' })
      if (url.pathname.startsWith('/test/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>' })
      if (!url.pathname.startsWith('/api/')) return route.continue()
      requests.push(`${route.request().method()} ${url.pathname}`)
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { username: 'student', roleCode: 'STUDENT' } })
      if (url.pathname === '/api/exam-types') return route.fulfill({ json: ['SAT', 'SHSAT'].map(code => ({ code, displayName: code, workspaceCode: code })) })
      if (url.pathname === '/api/student/exams') return route.fulfill({ json: [{ id: 9, title: 'SHSAT SAMPLE', examTypeCode: 'SHSAT', paperTitle: 'Sample paper', opensAt: '2020-01-01T00:00:00Z', closesAt: '2030-01-01T00:00:00Z', attemptsUsed: 1, attemptLimit: 1, latestAttemptId: 7 }] })
      if (url.pathname === '/api/student/attempts/7') return route.fulfill({ json: { id: 7, examTitle: 'SHSAT SAMPLE', examTypeCode: 'SHSAT', status: 'SUBMITTED', questions, result: { totalPoints: 29, maxPoints: 100, gradedAt: '2026-10-10T12:06:58Z' } } })
      if (url.pathname === '/api/student/attempts/8') return route.fulfill({ json: { id: 8, examTitle: 'Limited exam', examTypeCode: 'SHSAT', status: 'SUBMITTED', questions: [], result: null } })
      if (url.pathname === '/api/student/attempts/9') return route.fulfill({ json: { id: 9, examTitle: 'SAT exam', examTypeCode: 'SAT', status: 'SUBMITTED', questions: [question(1, { content: 'Ordinary SAT material\nkeeps its text.' })] } })
      return route.fulfill({ json: [] })
    })
    await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}/shsat`)
    await page.getByRole('button', { name: 'View attempt', exact: true }).click()
    await page.waitForURL('**/shsat/student/attempts/7')
    const cards = page.locator('.student-question')
    await cards.nth(0).getByText('A Passage', { exact: true }).waitFor()
    assert.equal(await cards.count(), 11)
    await cards.nth(0).getByText('The Author', { exact: true }).waitFor()
    assert.equal(await cards.nth(0).locator('.safe-markdown-text__segment--bold').innerText(), 'carefully')
    assert.equal(await cards.nth(0).locator('math-span').count(), 1)
    assert.equal(await cards.nth(0).locator('math-div').count(), 1)
    assert.equal(await cards.nth(0).locator('img[src="/test/inline.svg"]').evaluate(el => el.complete && el.naturalWidth > 0), true)
    assert.match(await cards.nth(0).innerText(), /First paragraph[\s\S]*Second paragraph[\s\S]*After image/)
    assert.match(await cards.nth(1).innerText(), /Legacy title[\s\S]*Legacy author[\s\S]*Legacy first line[\s\S]*Legacy second line/)
    assert.equal(await cards.nth(2).locator('.safe-markdown-text__segment--italic').innerText(), 'emphasis')
    assert.equal(await cards.nth(2).locator('.safe-markdown-text__segment--underline').innerText(), 'underline')
    assert.equal(await cards.nth(3).locator('img[src="/test/whole.svg"]').evaluate(el => el.complete && el.naturalWidth > 0), true)
    await cards.nth(4).getByText('Material image is unavailable.').waitFor()
    assert.match(await cards.nth(4).innerText(), /Before[\s\S]*After/)
    await cards.nth(5).getByText('This material cannot be displayed. Please contact your teacher.').waitFor()
    await cards.nth(9).getByText('This material cannot be displayed. Please contact your teacher.').waitFor()
    await cards.nth(10).getByText('Material image is unavailable.').waitFor()
    assert.match(await cards.nth(6).innerText(), /<script>window.injected=true<\/script>/)
    assert.equal(await page.evaluate(() => window.injected), undefined)
    assert.equal(await cards.nth(7).locator('.student-question-material').count(), 0)
    await cards.nth(8).getByText('Single legacy line', { exact: true }).waitFor()
    assert.doesNotMatch(await page.locator('.student-attempt').innerText(), /\[\[(?:TEXT_MATERIAL_FORMAT|MATERIAL_IMAGE):/)
    assert.equal(await page.locator('.attempt-result').innerText().then(value => value.includes('29 / 100')), true)
    assert.equal(await cards.nth(0).locator('input').first().isDisabled(), true)
    assert.equal(requests.some(request => /^(POST|PUT|PATCH|DELETE) /.test(request)), false)
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'materials fit a mobile viewport')
    await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}/shsat/student/attempts/8`)
    await page.getByRole('heading', { name: 'Limited exam' }).waitFor()
    assert.equal(await page.locator('.attempt-result').count(), 0)
    assert.equal(await page.locator('.student-question').count(), 0)
    await page.goto(`${process.env.E2E_BASE_URL || 'http://127.0.0.1:5175'}/shsat/student/attempts/9`)
    await page.getByText('Ordinary SAT material keeps its text.').waitFor()
    assert.equal(await page.locator('.student-question-material p').innerText(), 'Ordinary SAT material\nkeeps its text.')
    assert.deepEqual(errors, [])
    console.log('SHSAT attempt material formats, images, formulas, safety and visibility passed')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
