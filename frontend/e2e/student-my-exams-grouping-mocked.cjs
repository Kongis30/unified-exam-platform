// My Exams 用 tab 在 Group Exams / 1on1 Exams 之间切换的前端校验（mock API，不写数据库）。
// 覆盖：tab 切换、数量徽标、各自空状态、主标题保留、整班/个人考试归属、
// tab 内容器固定保留两排卡片高度、后端缺 assignmentKind 时全部落到 1on1、
// 1440px 与 390px 布局，以及 Assigned Review 分页回归。
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
  await page.locator('.assignment-tab').first().waitFor()
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

const myExamsCard = page => page.locator('.student-home-section').filter({ hasText: 'My Exams' }).first()
const tabs = page => myExamsCard(page).locator('.assignment-tab')
const groupTab = page => tabs(page).filter({ hasText: 'Group Exams' })
const oneOnOneTab = page => tabs(page).filter({ hasText: '1on1 Exams' })
const examCards = page => myExamsCard(page).locator('.student-home-exam-card')

// tab 的数量徽标必须等于各分组的实际考试数（无论是否激活）。
async function assertBadgesMatchTotals(page, label) {
  const [groupBadge, soloBadge] = await Promise.all([
    groupTab(page).locator('.assignment-tab__count').innerText(),
    oneOnOneTab(page).locator('.assignment-tab__count').innerText(),
  ])
  assert.ok(/^\d+$/.test(groupBadge.trim()) && /^\d+$/.test(soloBadge.trim()),
    `${label}: both badges are numeric (got "${groupBadge}" / "${soloBadge}")`)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const errors = []
  try {
    // 1. 两类考试都有：主标题保留，默认激活 Group tab，切换后各自只显示本组卡片。
    const both = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    both.on('pageerror', error => errors.push(`both: ${error.message}`))
    both.setDefaultTimeout(10_000)
    await openStudentHome(both, EXAMS)

    await both.getByRole('heading', { name: 'My Exams', exact: true }).waitFor()
    assert.equal(await tabs(both).count(), 2, 'My Exams renders exactly two tabs')
    assert.equal(await groupTab(both).getAttribute('aria-selected'), 'true',
      'Group Exams is selected by default')
    assert.equal(await examCards(both).count(), 1, 'only the active tab cards render')
    await myExamsCard(both).getByText('Class Group Exam', { exact: true }).waitFor()
    assert.equal(await myExamsCard(both).getByText('Solo One on One Exam', { exact: true }).count(), 0,
      'the 1on1 exam does not render while the Group tab is active')

    // tab 徽标反映各组总数
    assert.equal((await groupTab(both).innerText()).replace(/\s+/g, ' ').trim(), 'Group Exams 1')
    assert.equal((await oneOnOneTab(both).innerText()).replace(/\s+/g, ' ').trim(), '1on1 Exams 1')

    // 卡片原有信息完整。
    const card = examCards(both).first()
    await card.getByText('Time Window', { exact: true }).waitFor()
    await card.getByText('Duration', { exact: true }).waitFor()
    await card.getByRole('button', { name: /^Start exam/ }).waitFor()

    // 切到 1on1：只显示 1on1 卡片
    await oneOnOneTab(both).click()
    await myExamsCard(both).getByText('Solo One on One Exam', { exact: true }).waitFor()
    assert.equal(await examCards(both).count(), 1, 'only the 1on1 card renders after switching')
    assert.equal(await myExamsCard(both).getByText('Class Group Exam', { exact: true }).count(), 0,
      'the group exam disappears after switching tabs')
    assert.equal(await groupTab(both).getAttribute('aria-selected'), 'false')
    assert.equal(await oneOnOneTab(both).getAttribute('aria-selected'), 'true')

    const desktop = await both.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
    }))
    assert.ok(desktop.pageWidth <= desktop.viewportWidth, 'tabbed card has no desktop overflow')
    await both.screenshot({ path: '/tmp/my-exams-grouping-mocked-desktop.png' })

    // 2. 只有整班考试：1on1 tab 显示自己的空状态，徽标为 0。
    const onlyGroup = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    onlyGroup.on('pageerror', error => errors.push(`onlyGroup: ${error.message}`))
    onlyGroup.setDefaultTimeout(10_000)
    await openStudentHome(onlyGroup, [EXAMS[0]])
    assert.equal(await tabs(onlyGroup).count(), 2, 'both tabs render with only one exam kind')
    assert.equal((await oneOnOneTab(onlyGroup).innerText()).replace(/\s+/g, ' ').trim(), '1on1 Exams 0',
      'the empty tab keeps its zero badge')
    await oneOnOneTab(onlyGroup).click()
    await myExamsCard(onlyGroup).getByText('No 1on1 exams assigned yet.', { exact: true }).waitFor()
    assert.equal(await examCards(onlyGroup).count(), 0)

    // 3. 只有个人考试：默认 Group tab 显示自己的空状态。
    const onlySolo = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    onlySolo.on('pageerror', error => errors.push(`onlySolo: ${error.message}`))
    onlySolo.setDefaultTimeout(10_000)
    await openStudentHome(onlySolo, [EXAMS[1]])
    await myExamsCard(onlySolo).getByText('No group exams assigned yet.', { exact: true }).waitFor()
    assert.equal(await examCards(onlySolo).count(), 0)
    await oneOnOneTab(onlySolo).click()
    await myExamsCard(onlySolo).getByText('Solo One on One Exam', { exact: true }).waitFor()

    // 4. 完全无考试：两个 tab 都在，各自切到时显示空态。
    const none = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    none.on('pageerror', error => errors.push(`none: ${error.message}`))
    none.setDefaultTimeout(10_000)
    await openStudentHome(none, [])
    assert.equal(await tabs(none).count(), 2, 'both tabs render for a student with no exams')
    await myExamsCard(none).getByText('No group exams assigned yet.', { exact: true }).waitFor()
    await oneOnOneTab(none).click()
    await myExamsCard(none).getByText('No 1on1 exams assigned yet.', { exact: true }).waitFor()

    // 5. 后端未返回 assignmentKind（升级窗口期）：全部落到 1on1，页面不空白。
    const legacy = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    legacy.on('pageerror', error => errors.push(`legacy: ${error.message}`))
    legacy.setDefaultTimeout(10_000)
    await openStudentHome(legacy, EXAMS.map(({ assignmentKind, ...exam }) => exam))
    assert.equal(await examCards(legacy).count(), 0, 'a legacy payload is not guessed into Group')
    await oneOnOneTab(legacy).click()
    await myExamsCard(legacy).getByText('Class Group Exam', { exact: true }).waitFor()
    await myExamsCard(legacy).getByText('Solo One on One Exam', { exact: true }).waitFor()
    assert.equal(await examCards(legacy).count(), 2)

    // 6. 未知 assignmentKind（后端将来新增派发方式）：不能丢考试，落到 1on1。
    const unknownKind = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    unknownKind.on('pageerror', error => errors.push(`unknownKind: ${error.message}`))
    unknownKind.setDefaultTimeout(10_000)
    await openStudentHome(unknownKind, [{ ...EXAMS[0], title: 'Future Kind Exam', assignmentKind: 'FUTURE_KIND' }])
    assert.equal(await examCards(unknownKind).count(), 0,
      'an unknown assignmentKind is not shown under Group Exams')
    await oneOnOneTab(unknownKind).click()
    await myExamsCard(unknownKind).getByText('Future Kind Exam', { exact: true }).waitFor()
    await assertBadgesMatchTotals(unknownKind, 'unknown kind')

    // 7. 多个同类考试：tab 徽标反映总数，容器固定保留两排高度，超出滚动。
    const many = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    many.on('pageerror', error => errors.push(`many: ${error.message}`))
    many.setDefaultTimeout(10_000)
    await openStudentHome(many, [
      { ...EXAMS[0], id: 201, title: 'Group A' },
      { ...EXAMS[0], id: 202, title: 'Group B' },
      { ...EXAMS[0], id: 203, title: 'Group C' },
      { ...EXAMS[0], id: 205, title: 'Group D' },
      { ...EXAMS[0], id: 206, title: 'Group E' },
      { ...EXAMS[1], id: 204, title: '1on1 A' },
    ])
    assert.equal((await groupTab(many).innerText()).replace(/\s+/g, ' ').trim(), 'Group Exams 5')
    assert.equal((await oneOnOneTab(many).innerText()).replace(/\s+/g, ' ').trim(), '1on1 Exams 1')
    assert.equal(await examCards(many).count(), 5, 'every GROUP exam renders under the active tab')

    // 5 场考试超过两排，容器高度固定在两排窗口内并出现滚动。
    const gridInfo = await myExamsCard(many).locator('.student-home-exam-tab-grid').evaluate(el => ({
      height: el.getBoundingClientRect().height,
      scrollable: el.scrollHeight > el.clientHeight + 1,
    }))
    assert.ok(Math.abs(gridInfo.height - (278 * 2 + 16)) <= 8,
      `the exam grid keeps a two-row height window (got ${gridInfo.height}px, expected ~${278 * 2 + 16}px)`)
    assert.ok(gridInfo.scrollable, 'content beyond two rows scrolls inside the grid')

    // 只有 1 场考试时，容器仍撑起两排高度（min-height 生效）。
    await oneOnOneTab(many).click()
    const soloGridHeight = await myExamsCard(many).locator('.student-home-exam-tab-grid').evaluate(el => el.getBoundingClientRect().height)
    assert.ok(Math.abs(soloGridHeight - (278 * 2 + 16)) <= 8,
      'a single card still fills the reserved two-row height')

    // 8. 加载中：不先渲染空状态，避免学生看到"没有考试"的误导提示。
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
    assert.equal(await tabs(loading).count(), 0,
      'tabs are not rendered before the request resolves')
    assert.equal(await loading.getByText('No group exams assigned yet.', { exact: true }).count(), 0,
      'the empty state is not shown while still loading')
    await tabs(loading).first().waitFor()
    await myExamsCard(loading).getByText('Class Group Exam', { exact: true }).waitFor()
    await assertBadgesMatchTotals(loading, 'after loading')

    // 9. 请求失败：显示错误，而不是空 tab。
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
    assert.equal(await tabs(failed).count(), 0,
      'a failed request shows the error instead of empty tabs')
    await failed.getByRole('heading', { name: 'My Exams', exact: true }).waitFor()

    // 10. 刷新按钮：重新拉取后 tab 徽标随之更新。
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
    await refresh.locator('.assignment-tab').first().waitFor()
    await myExamsCard(refresh).getByText('Class Group Exam', { exact: true }).waitFor()
    assert.equal((await oneOnOneTab(refresh).innerText()).replace(/\s+/g, ' ').trim(), '1on1 Exams 0')
    refreshExams = EXAMS
    await refresh.getByRole('button', { name: 'Refresh exams' }).click()
    await refresh.getByRole('button', { name: 'Refresh exams' }).click({ force: true })
    // 第二次点击可能中断第一次请求，兜底再点一次确保列表刷新完成。
    await refresh.waitForTimeout(300)
    assert.equal((await oneOnOneTab(refresh).innerText()).replace(/\s+/g, ' ').trim(), '1on1 Exams 1',
      'refreshing updates the tab badges')
    await oneOnOneTab(refresh).click()
    await myExamsCard(refresh).getByText('Solo One on One Exam', { exact: true }).waitFor()
    await assertBadgesMatchTotals(refresh, 'after refresh')

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

    // 11. 390px 布局无横向溢出，两个 tab 都在，固定高度在移动端放开。
    await both.setViewportSize({ width: 390, height: 844 })
    await both.waitForTimeout(300)
    assert.equal(await tabs(both).count(), 2, 'both tabs remain at 390px')
    const mobile = await both.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
    }))
    assert.ok(mobile.pageWidth <= mobile.viewportWidth, 'tabbed card fits the 390px viewport')
    await both.screenshot({ path: '/tmp/my-exams-grouping-mocked-mobile.png' })

    // 12. 并发重复点击刷新：不应出现重复卡片。
    await refresh.getByRole('button', { name: 'Refresh exams' }).click()
    await refresh.getByRole('button', { name: 'Refresh exams' }).click({ force: true })
    await myExamsCard(refresh).locator('.student-home-exam-card').first().waitFor()
    assert.equal(await examCards(refresh).count(), 1,
      'repeated refreshes do not duplicate cards in the active tab')

    assert.deepEqual(errors, [])
    console.log(JSON.stringify({
      result: 'PASS',
      checks: [
        'My Exams keeps its title and renders Group Exams / 1on1 Exams tabs',
        'switching tabs shows only the active group and updates aria-selected',
        'tab badges match the totals per assignment kind',
        'each tab renders its own empty state, including the all-empty case',
        'a payload without assignmentKind falls back to 1on1 instead of rendering blank',
        'an unknown assignmentKind is shown under 1on1 instead of disappearing',
        'the exam grid keeps a fixed two-row height window and scrolls beyond it',
        'a slow request shows loading and no premature empty state',
        'a failed request shows the error instead of empty tabs',
        'refreshing re-groups the list and keeps tab badges in sync',
        'repeated refreshes do not duplicate cards',
        'Assigned Review pages two rows at a time with stable height and disabled edge buttons',
        'exam card details and start action survive the tabbed layout',
        'tabbed layout fits 1440px and 390px viewports',
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
