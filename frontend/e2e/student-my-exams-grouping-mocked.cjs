// My Exams 分组渲染的前端校验（mock API，不写数据库）。
// 覆盖：两个子区域、数量徽标、各自空状态、主标题保留、整班/个人考试归属、
// 后端缺 assignmentKind 时全部落到 1on1、1440px 与 390px 布局。
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const base = process.env.E2E_BASE_URL || 'http://localhost:5175'

const EXAMS = [
  { id: 101, examTypeCode: 'SHSAT', title: 'Class Group Exam', paperTitle: 'Paper A',
    opensAt: '2026-11-01T09:00:00Z', closesAt: '2030-11-01T12:00:00Z',
    durationSeconds: 7200, attemptLimit: 1, attemptsUsed: 0, activeAttemptId: null,
    latestAttemptId: null, assignmentKind: 'GROUP' },
  { id: 102, examTypeCode: 'SHSAT', title: 'Solo One on One Exam', paperTitle: 'Paper B',
    opensAt: '2026-11-01T09:00:00Z', closesAt: '2030-11-01T12:00:00Z',
    durationSeconds: 7200, attemptLimit: 1, attemptsUsed: 0, activeAttemptId: null,
    latestAttemptId: null, assignmentKind: 'ONE_ON_ONE' },
]

async function openStudentHome(page, exams, options = {}) {
  const { error, reviewTasks = [], onExamsRequest } = options
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const method = route.request().method()
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ json: { username: 'student-check', roleCode: 'STUDENT', realName: 'Student Check' } })
    }
    if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
    if (url.pathname === '/api/exam-types') {
      return route.fulfill({ json: [{ code: 'SHSAT', displayName: 'SHSAT', workspaceCode: 'SHSAT', workspaceName: 'SHSAT' }] })
    }
    if (url.pathname === '/api/student/exams') {
      if (onExamsRequest) return onExamsRequest(route)
      if (error) return route.fulfill({ status: 500, json: { message: error } })
      return route.fulfill({ json: exams })
    }
    if (url.pathname === '/api/student/wrong-answer-tasks') return route.fulfill({ json: reviewTasks })
    if (method === 'GET') return route.fulfill({ json: [] })
    return route.fulfill({ json: {} })
  })
  await page.goto(`${base}/student/systems/SHSAT`)
  await page.locator('.student-home-subsection').first().waitFor()
}

// Assigned Review 卡片的分页元素。
const reviewCard = page => page.locator('.student-home-section').filter({ hasText: 'Assigned Review' })
const reviewCards = page => reviewCard(page).locator('.student-home-review-card')
const reviewPager = page => reviewCard(page).locator('.student-home-pagination')

// 生成 n 条未完成（ENDED 之外的活跃）复习任务。
const makeReviewTasks = (n, overrides = {}) => Array.from({ length: n }, (_, index) => ({
  assignmentId: 1000 + index,
  id: 1000 + index,
  title: `Review Task ${index + 1}`,
  examTitle: `Exam ${index + 1}`,
  description: null,
  status: 'NOT_STARTED',
  remainingQuestionCount: 10,
  totalQuestions: 20,
  accuracy: null,
  startAt: '2026-11-01T00:00:00Z',
  endAt: '2030-11-01T00:00:00Z',
  canStart: true,
  ...overrides,
}))

const sections = page => page.locator('.student-home-subsection')
const groupSection = page => sections(page).filter({ hasText: 'Group Exams' })
const oneOnOneSection = page => sections(page).filter({ hasText: '1on1 Exams' })
// 数量徽标必须与实际卡片数一致，否则分组就不可信。
const assertBadgeMatchesCards = async (page, label) => {
  for (const section of [groupSection(page), oneOnOneSection(page)]) {
    const badge = Number(await section.locator('.student-home-subsection__count').innerText())
    const cards = await section.locator('.student-home-exam-card').count()
    assert.equal(badge, cards, `${label}: the count badge matches the rendered card count`)
  }
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const errors = []
  try {
    // 1. 两类考试都有：主标题保留，各自归到对应子区域。
    const both = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    both.on('pageerror', error => errors.push(`both: ${error.message}`))
    both.setDefaultTimeout(10_000)
    await openStudentHome(both, EXAMS)

    await both.getByRole('heading', { name: 'My Exams', exact: true }).waitFor()
    assert.equal(await sections(both).count(), 2, 'My Exams renders exactly two subsections')
    await groupSection(both).getByText('Class Group Exam', { exact: true }).waitFor()
    await oneOnOneSection(both).getByText('Solo One on One Exam', { exact: true }).waitFor()
    assert.equal(await groupSection(both).locator('.student-home-exam-card').count(), 1,
      'a GROUP exam renders only under Group Exams')
    assert.equal(await oneOnOneSection(both).locator('.student-home-exam-card').count(), 1,
      'a ONE_ON_ONE exam renders only under 1on1 Exams')
    assert.equal(await groupSection(both).locator('.student-home-subsection__count').innerText(), '1')
    assert.equal(await oneOnOneSection(both).locator('.student-home-subsection__count').innerText(), '1')
    // 分组后卡片原有信息完整。
    const card = groupSection(both).locator('.student-home-exam-card').first()
    await card.getByText('Time Window', { exact: true }).waitFor()
    await card.getByText('Duration', { exact: true }).waitFor()
    await card.getByRole('button', { name: /^Start exam/ }).waitFor()
    const desktop = await both.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
    }))
    assert.ok(desktop.pageWidth <= desktop.viewportWidth, 'grouped card has no desktop overflow')
    await both.screenshot({ path: '/tmp/my-exams-grouping-mocked-desktop.png' })

    // 2. 只有整班考试：1on1 子区域显示自己的空状态，两个标题都在。
    const onlyGroup = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    onlyGroup.on('pageerror', error => errors.push(`onlyGroup: ${error.message}`))
    onlyGroup.setDefaultTimeout(10_000)
    await openStudentHome(onlyGroup, [EXAMS[0]])
    assert.equal(await sections(onlyGroup).count(), 2, 'both subsections render with only one exam kind')
    assert.equal(await oneOnOneSection(onlyGroup).locator('.student-home-exam-card').count(), 0)
    await oneOnOneSection(onlyGroup).getByText('No 1on1 exams assigned yet.', { exact: true }).waitFor()

    // 3. 只有个人考试：Group 子区域显示自己的空状态。
    const onlySolo = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    onlySolo.on('pageerror', error => errors.push(`onlySolo: ${error.message}`))
    onlySolo.setDefaultTimeout(10_000)
    await openStudentHome(onlySolo, [EXAMS[1]])
    assert.equal(await groupSection(onlySolo).locator('.student-home-exam-card').count(), 0)
    await groupSection(onlySolo).getByText('No group exams assigned yet.', { exact: true }).waitFor()

    // 4. 完全无考试：两个子区域各自空态，不再出现旧的整卡提示。
    const none = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    none.on('pageerror', error => errors.push(`none: ${error.message}`))
    none.setDefaultTimeout(10_000)
    await openStudentHome(none, [])
    assert.equal(await sections(none).count(), 2, 'both subsections render for a student with no exams')
    await groupSection(none).getByText('No group exams assigned yet.', { exact: true }).waitFor()
    await oneOnOneSection(none).getByText('No 1on1 exams assigned yet.', { exact: true }).waitFor()

    // 5. 后端未返回 assignmentKind（升级窗口期）：全部落到 1on1，页面不空白。
    const legacy = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    legacy.on('pageerror', error => errors.push(`legacy: ${error.message}`))
    legacy.setDefaultTimeout(10_000)
    await openStudentHome(legacy, EXAMS.map(({ assignmentKind, ...exam }) => exam))
    assert.equal(await sections(legacy).count(), 2, 'legacy payload still renders both subsections')
    await oneOnOneSection(legacy).getByText('Class Group Exam', { exact: true }).waitFor()
    await oneOnOneSection(legacy).getByText('Solo One on One Exam', { exact: true }).waitFor()

    // 6. 未知 assignmentKind（后端将来新增派发方式）：不能丢考试，落到 1on1。
    const unknownKind = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    unknownKind.on('pageerror', error => errors.push(`unknownKind: ${error.message}`))
    unknownKind.setDefaultTimeout(10_000)
    await openStudentHome(unknownKind, [{ ...EXAMS[0], title: 'Future Kind Exam', assignmentKind: 'FUTURE_KIND' }])
    await oneOnOneSection(unknownKind).getByText('Future Kind Exam', { exact: true }).waitFor()
    assert.equal(await groupSection(unknownKind).locator('.student-home-exam-card').count(), 0,
      'an unknown assignmentKind is not shown under Group Exams')
    await assertBadgeMatchesCards(unknownKind, 'unknown kind')

    // 7. 多个同类考试：全部落在同一子区域，徽标与卡片数量一致。
    const many = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    many.on('pageerror', error => errors.push(`many: ${error.message}`))
    many.setDefaultTimeout(10_000)
    await openStudentHome(many, [
      { ...EXAMS[0], id: 201, title: 'Group A' },
      { ...EXAMS[0], id: 202, title: 'Group B' },
      { ...EXAMS[0], id: 203, title: 'Group C' },
      { ...EXAMS[1], id: 204, title: '1on1 A' },
    ])
    assert.equal(await groupSection(many).locator('.student-home-exam-card').count(), 3,
      'every GROUP exam renders under Group Exams')
    assert.equal(await oneOnOneSection(many).locator('.student-home-exam-card').count(), 1,
      'every ONE_ON_ONE exam renders under 1on1 Exams')
    assert.equal(await groupSection(many).locator('.student-home-subsection__count').innerText(), '3')
    await assertBadgeMatchesCards(many, 'many exams')

    // 8. 加载中：不先渲染空状态，避免学生看到"没有考试"的误导提示。
    // 这里不能复用 openStudentHome —— 它先等子区域出现，会等到加载结束后才返回。
    const loading = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    loading.on('pageerror', error => errors.push(`loading: ${error.message}`))
    loading.setDefaultTimeout(20_000)
    await loading.route('**/*', route => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/auth/me') {
        return route.fulfill({ json: { username: 'student-check', roleCode: 'STUDENT', realName: 'Student Check' } })
      }
      if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
      if (url.pathname === '/api/exam-types') {
        return route.fulfill({ json: [{ code: 'SHSAT', displayName: 'SHSAT', workspaceCode: 'SHSAT', workspaceName: 'SHSAT' }] })
      }
      if (url.pathname === '/api/student/exams') {
        return new Promise(resolve => setTimeout(() => resolve(route.fulfill({ json: EXAMS })), 3000))
      }
      if (route.request().method() === 'GET') return route.fulfill({ json: [] })
      return route.fulfill({ json: {} })
    })
    await loading.goto(`${base}/student/systems/SHSAT`)
    await loading.getByText('Loading exams...', { exact: true }).waitFor()
    assert.equal(await sections(loading).count(), 0,
      'empty subsections are not rendered before the request resolves')
    assert.equal(await loading.getByText('No group exams assigned yet.', { exact: true }).count(), 0,
      'the empty state is not shown while still loading')
    await sections(loading).first().waitFor()
    await groupSection(loading).getByText('Class Group Exam', { exact: true }).waitFor()
    await assertBadgeMatchesCards(loading, 'after loading')

    // 9. 请求失败：显示错误，而不是两个空状态。
    const failed = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    failed.on('pageerror', error => errors.push(`failed: ${error.message}`))
    failed.setDefaultTimeout(10_000)
    await failed.route('**/*', route => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/auth/me') {
        return route.fulfill({ json: { username: 'student-check', roleCode: 'STUDENT', realName: 'Student Check' } })
      }
      if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
      if (url.pathname === '/api/exam-types') {
        return route.fulfill({ json: [{ code: 'SHSAT', displayName: 'SHSAT', workspaceCode: 'SHSAT', workspaceName: 'SHSAT' }] })
      }
      if (url.pathname === '/api/student/exams') {
        return route.fulfill({ status: 500, json: { message: 'Exam service unavailable' } })
      }
      if (route.request().method() === 'GET') return route.fulfill({ json: [] })
      return route.fulfill({ json: {} })
    })
    await failed.goto(`${base}/student/systems/SHSAT`)
    await failed.getByRole('alert').first().waitFor()
    assert.equal(await sections(failed).count(), 0,
      'a failed request shows the error instead of two empty subsections')
    await failed.getByRole('heading', { name: 'My Exams', exact: true }).waitFor()

    // 10. 刷新按钮：重新拉取后分组随之更新，徽标保持同步。
    let refreshExams = [EXAMS[0]]
    const refresh = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    refresh.on('pageerror', error => errors.push(`refresh: ${error.message}`))
    refresh.setDefaultTimeout(10_000)
    await refresh.route('**/*', route => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/auth/me') {
        return route.fulfill({ json: { username: 'student-check', roleCode: 'STUDENT', realName: 'Student Check' } })
      }
      if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
      if (url.pathname === '/api/exam-types') {
        return route.fulfill({ json: [{ code: 'SHSAT', displayName: 'SHSAT', workspaceCode: 'SHSAT', workspaceName: 'SHSAT' }] })
      }
      if (url.pathname === '/api/student/exams') return route.fulfill({ json: refreshExams })
      if (route.request().method() === 'GET') return route.fulfill({ json: [] })
      return route.fulfill({ json: {} })
    })
    await refresh.goto(`${base}/student/systems/SHSAT`)
    await groupSection(refresh).getByText('Class Group Exam', { exact: true }).waitFor()
    assert.equal(await oneOnOneSection(refresh).locator('.student-home-exam-card').count(), 0)
    refreshExams = EXAMS
    await refresh.getByRole('button', { name: 'Refresh exams' }).click()
    await oneOnOneSection(refresh).getByText('Solo One on One Exam', { exact: true }).waitFor()
    assert.equal(await groupSection(refresh).locator('.student-home-exam-card').count(), 1)
    assert.equal(await oneOnOneSection(refresh).locator('.student-home-exam-card').count(), 1)
    await assertBadgeMatchesCards(refresh, 'after refresh')

    // 10b. Assigned Review 分页：任务多时按两排分页，容器高度不再随数量无限拉伸。
    const paged = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    paged.on('pageerror', error => errors.push(`paged: ${error.message}`))
    paged.setDefaultTimeout(10_000)
    await openStudentHome(paged, EXAMS, { reviewTasks: makeReviewTasks(8) })
    await reviewCards(paged).first().waitFor()

    // 列数由布局决定，每页固定两排；断言实际渲染数 = 列数 × 2 且小于总数。
    const pagerInfo = await reviewCard(paged).evaluate(card => {
      const grid = card.querySelector('.student-home-review-grid')
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
      return { columns, rendered: card.querySelectorAll('.student-home-review-card').length }
    })
    assert.ok(pagerInfo.columns >= 1, 'the review grid reports at least one column')
    assert.equal(pagerInfo.rendered, pagerInfo.columns * 2,
      'the first page renders exactly two rows of review cards')
    assert.ok(pagerInfo.rendered < 8, 'not every task is rendered at once when paging is active')
    await reviewPager(paged).getByText('Page 1 of', { exact: false }).waitFor()
    assert.equal(await reviewPager(paged).getByRole('button', { name: 'Previous' }).isDisabled(), true,
      'Previous is disabled on the first page')

    // 翻到最后一页，剩余任务全部可见且不重复。
    const pageCount = Number((await reviewPager(paged).locator('span').innerText()).match(/of (\d+)/)[1])
    assert.ok(pageCount > 1, `8 tasks across ${pagerInfo.columns} columns must span more than one page`)
    for (let page = 2; page <= pageCount; page += 1) {
      await reviewPager(paged).getByRole('button', { name: 'Next' }).click()
      await reviewPager(paged).getByText(`Page ${page} of ${pageCount}`, { exact: false }).waitFor()
    }
    assert.equal(await reviewPager(paged).getByRole('button', { name: 'Next' }).isDisabled(), true,
      'Next is disabled on the last page')

    // 分页容器高度稳定：末页即使不足两排，高度也由最小高度撑起，
    // 不会出现翻页时高度大幅跳变（允许 1px 级舍入误差）。
    const heightAfterPaging = await reviewCard(paged).locator('.student-home-review-grid').evaluate(el => el.getBoundingClientRect().height)
    await reviewPager(paged).getByRole('button', { name: 'Previous' }).click()
    await reviewPager(paged).getByText('Page 1 of', { exact: false }).waitFor()
    const heightFirstPage = await reviewCard(paged).locator('.student-home-review-grid').evaluate(el => el.getBoundingClientRect().height)
    assert.ok(Math.abs(heightFirstPage - heightAfterPaging) <= 8,
      `the review grid keeps a stable height between pages (${heightFirstPage} vs ${heightAfterPaging})`)
    assert.ok(heightFirstPage >= 338 * 2,
      'the review grid reserves at least two card heights')

    // 任务只有 2 条时不显示分页控件。
    const noPager = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    noPager.on('pageerror', error => errors.push(`noPager: ${error.message}`))
    noPager.setDefaultTimeout(10_000)
    await openStudentHome(noPager, EXAMS, { reviewTasks: makeReviewTasks(2) })
    await reviewCards(noPager).first().waitFor()
    assert.equal(await reviewCards(noPager).count(), 2, 'two tasks are both rendered')
    assert.equal(await reviewPager(noPager).count(), 0, 'a single page needs no pagination controls')

    // 11. 390px 布局无横向溢出，两个子区域都在。
    await both.setViewportSize({ width: 390, height: 844 })
    assert.equal(await sections(both).count(), 2, 'both subsections remain at 390px')
    const mobile = await both.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
    }))
    assert.ok(mobile.pageWidth <= mobile.viewportWidth, 'grouped card fits the 390px viewport')
    await both.screenshot({ path: '/tmp/my-exams-grouping-mocked-mobile.png' })

    // 12. 并发重复点击刷新：不应出现重复卡片或错位分组。
    await refresh.getByRole('button', { name: 'Refresh exams' }).click()
    await refresh.getByRole('button', { name: 'Refresh exams' }).click({ force: true })
    await groupSection(refresh).locator('.student-home-exam-card').first().waitFor()
    assert.equal(await groupSection(refresh).locator('.student-home-exam-card').count(), 1,
      'repeated refreshes do not duplicate Group Exams cards')
    assert.equal(await oneOnOneSection(refresh).locator('.student-home-exam-card').count(), 1,
      'repeated refreshes do not duplicate 1on1 Exams cards')

    assert.deepEqual(errors, [])
    console.log(JSON.stringify({
      result: 'PASS',
      checks: [
        'My Exams keeps its title and renders Group Exams / 1on1 Exams subsections',
        'GROUP and ONE_ON_ONE exams each land in their own subsection',
        'count badges match card counts',
        'each subsection renders its own empty state, including the all-empty case',
        'a payload without assignmentKind falls back to 1on1 instead of rendering blank',
        'an unknown assignmentKind is shown under 1on1 instead of disappearing',
        'multiple exams per kind keep the badge and card counts in sync',
        'a slow request shows loading and no premature empty state',
        'a failed request shows the error instead of two empty subsections',
        'refreshing re-groups the list and keeps badges in sync',
        'repeated refreshes do not duplicate cards',
        'Assigned Review pages two rows at a time with stable height and disabled edge buttons',
        'exam card details and start action survive the grouping',
        'grouped layout fits 1440px and 390px viewports',
      ],
      desktop,
      mobile,
      errors: errors.length,
    }))
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error.stack || error)
  process.exit(1)
})
