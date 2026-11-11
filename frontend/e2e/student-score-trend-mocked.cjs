// 学生首页 Score Trend 卡片（mock API，不写数据库）。
//
// 覆盖规范中的口径与边界：
//  - 默认显示量表分，切换 raw 后统计条与曲线同步更新
//  - 只有 raw 可用时隐藏切换控件并给出说明
//  - 有作答但分数未开放 / 未判完时不画曲线，并说明排除数量
//  - raw 满分随试卷变化时给出提示
//  - 单点不画折线
//  - 请求失败显示 Retry，不白屏
//  - 1440px 与 390px 无横向溢出
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const base = process.env.E2E_BASE_URL || 'http://localhost:5175'

const point = (attemptId, submittedAt, score, scoreMax) => ({
  attemptId, examId: attemptId, examTitle: `Exam ${attemptId}`, attemptNumber: 1,
  submittedAt, score, scoreMax,
})

const series = (overrides = {}) => ({
  available: true,
  unit: 'SCALED',
  scoreMax: 720,
  average: 0,
  highest: 0,
  points: [],
  ...overrides,
})

// 截图里那种「从 304 爬到 460」的成长曲线。
const SHSAT_TREND = {
  examTypeCode: 'SHSAT',
  statistics: { totalAttempts: 5, completedAttempts: 4 },
  scaled: series({
    average: 375,
    highest: 460,
    points: [
      point(1, '2026-09-12T10:00:00Z', 304, 720),
      point(2, '2026-09-19T10:00:00Z', 337, 720),
      point(3, '2026-10-18T10:00:00Z', 406, 720),
      point(4, '2026-10-31T10:00:00Z', 460, 720),
    ],
  }),
  raw: series({
    unit: 'POINTS',
    scoreMax: 100,
    average: 43,
    highest: 61,
    points: [
      point(1, '2026-09-12T10:00:00Z', 32, 100),
      point(2, '2026-09-19T10:00:00Z', 39, 100),
      point(3, '2026-10-18T10:00:00Z', 32, 100),
      point(4, '2026-10-31T10:00:00Z', 61, 100),
    ],
  }),
  excluded: { notScored: 0, notVisible: 1 },
}

// SHSAT 无量表换算表：只有 raw 可画。
const RAW_ONLY_TREND = {
  examTypeCode: 'SHSAT',
  statistics: { totalAttempts: 2, completedAttempts: 2 },
  scaled: series({ available: false, average: null, highest: null, points: [], scoreMax: null }),
  raw: series({
    unit: 'POINTS',
    scoreMax: 100,
    average: 44,
    highest: 48,
    points: [
      point(1, '2026-09-12T10:00:00Z', 40, 100),
      point(2, '2026-09-19T10:00:00Z', 48, 100),
    ],
  }),
  excluded: { notScored: 0, notVisible: 0 },
}

// SAT 原始分满分随试卷题数变化，但量纲固定，按原值直接展示、不额外提示。
const SAT_VARYING_RAW = {
  examTypeCode: 'SAT',
  statistics: { totalAttempts: 2, completedAttempts: 2 },
  scaled: series({
    scoreMax: 1600,
    average: 1200,
    highest: 1240,
    points: [
      point(1, '2026-09-12T10:00:00Z', 1160, 1600),
      point(2, '2026-09-19T10:00:00Z', 1240, 1600),
    ],
  }),
  raw: series({
    unit: 'CORRECT',
    scoreMax: 66,
    average: 43,
    highest: 44,
    points: [
      point(1, '2026-09-12T10:00:00Z', 40, 54),
      point(2, '2026-09-19T10:00:00Z', 44, 66),
    ],
  }),
  excluded: { notScored: 0, notVisible: 0 },
}

// 有作答但成绩尚未开放：不应显示空图。
const NOT_VISIBLE = {
  examTypeCode: 'SHSAT',
  statistics: { totalAttempts: 3, completedAttempts: 3 },
  scaled: series({ available: false, average: null, highest: null, points: [], scoreMax: null }),
  raw: series({ available: false, unit: 'POINTS', average: null, highest: null, points: [], scoreMax: null }),
  excluded: { notScored: 0, notVisible: 3 },
}

const NO_ATTEMPTS = {
  examTypeCode: 'SHSAT',
  statistics: { totalAttempts: 0, completedAttempts: 0 },
  scaled: series({ available: false, average: null, highest: null, points: [], scoreMax: null }),
  raw: series({ available: false, unit: 'POINTS', average: null, highest: null, points: [], scoreMax: null }),
  excluded: { notScored: 0, notVisible: 0 },
}

const card = page => page.locator('.score-trend-card')
const statsValues = page => card(page).locator('.score-trend-stat dd').allInnerTexts()
const switchers = page => card(page).locator('.score-trend-switch')
const chartPoints = page => card(page).locator('.score-trend-chart__point-group')

async function openHome(page, { trend, trendError, workspace = 'SHSAT', viewport } = {}) {
  if (viewport) await page.setViewportSize(viewport)
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const method = route.request().method()
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ json: { username: 'student-check', roleCode: 'STUDENT', realName: 'Student Check' } })
    }
    if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'test' } })
    if (url.pathname === '/api/exam-types') {
      return route.fulfill({ json: [{ code: workspace, displayName: workspace, workspaceCode: workspace, workspaceName: workspace }] })
    }
    if (url.pathname === '/api/student/score-trend') {
      if (trendError) return route.fulfill({ status: 500, json: { message: trendError } })
      return route.fulfill({ json: trend })
    }
    if (method === 'GET') return route.fulfill({ json: [] })
    return route.fulfill({ json: {} })
  })
  await page.goto(`${base}/student/systems/${workspace}`)
  await card(page).locator('.app-card__title').waitFor()
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const errors = []
  try {
    // 1. 默认量表分：统计条与曲线来自 scaled，切换控件可见。
    const trend = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
    trend.on('pageerror', error => errors.push(`trend: ${error.message}`))
    trend.setDefaultTimeout(10_000)
    await openHome(trend, { trend: SHSAT_TREND })

    await card(trend).getByRole('heading', { name: 'Score Trend', exact: true }).waitFor()
    assert.deepEqual(await statsValues(trend), ['5', '4', '375', '460'],
      'statistics reflect totals plus the active series average and highest')
    assert.equal(await switchers(trend).count(), 2, 'both score modes are switchable')
    assert.equal(await switchers(trend).first().getAttribute('aria-pressed'), 'true',
      'scaled score is the default mode')
    assert.equal(await chartPoints(trend).count(), 4, 'every visible point is plotted')
    // 排除说明：1 次成绩尚未开放。
    await card(trend).getByText('1 attempt not shown yet because the score has not been opened.',
      { exact: false }).waitFor()

    // 曲线按提交时间从早到晚：值标签顺序即成长顺序。
    const labels = await card(trend).locator('.score-trend-chart__value').allTextContents()
    assert.deepEqual(labels.map(text => text.trim()), ['304', '337', '406', '460'],
      'points are ordered earliest to latest')

    // 2. 切到 raw：统计条与曲线同步，且不发新请求。
    let scoreTrendRequests = 0
    trend.on('request', request => {
      if (new URL(request.url()).pathname === '/api/student/score-trend') scoreTrendRequests += 1
    })
    await switchers(trend).nth(1).click()
    await card(trend).getByText('Raw score', { exact: true }).first().waitFor()
    assert.deepEqual(await statsValues(trend), ['5', '4', '43', '61'],
      'switching to raw updates average and highest without a new request')
    const rawLabels = await card(trend).locator('.score-trend-chart__value').allTextContents()
    assert.deepEqual(rawLabels.map(text => text.trim()), ['32', '39', '32', '61'])
    assert.equal(scoreTrendRequests, 0, 'raw/scaled switching is local and requests nothing')

    const desktop = await trend.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
    }))
    assert.ok(desktop.pageWidth <= desktop.viewportWidth, 'the card does not overflow at 1440px')
    await trend.screenshot({ path: '/tmp/student-score-trend-desktop.png' })

    // 3. 只有 raw 可用：隐藏切换控件并说明原因。
    const rawOnly = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
    rawOnly.on('pageerror', error => errors.push(`rawOnly: ${error.message}`))
    rawOnly.setDefaultTimeout(10_000)
    await openHome(rawOnly, { trend: RAW_ONLY_TREND })
    assert.equal(await switchers(rawOnly).count(), 0,
      'a single available mode hides the switcher entirely')
    assert.equal(await chartPoints(rawOnly).count(), 2, 'the raw curve still renders')
    await card(rawOnly).getByText('does not use a scaled score table', { exact: false }).waitFor()

    // 4. raw 满分随题数变化：按原值直接展示，不归一、也不出现跨卷比较的提示。
    const varying = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
    varying.on('pageerror', error => errors.push(`varying: ${error.message}`))
    varying.setDefaultTimeout(10_000)
    await openHome(varying, { trend: SAT_VARYING_RAW, workspace: 'SAT' })
    await switchers(varying).nth(1).click()
    assert.deepEqual(await statsValues(varying), ['2', '2', '43', '44'],
      'raw statistics use the raw values as stored, without normalising by question count')
    assert.equal(await card(varying).getByText('differ between papers', { exact: false }).count(), 0,
      'no cross-paper comparison note is shown for differing raw maxima')
    const varyingLabels = (await card(varying).locator('.score-trend-chart__value').allTextContents())
      .map(text => text.trim())
    assert.deepEqual(varyingLabels, ['40', '44'], 'raw points are plotted as absolute values')

    // 5. 有作答但成绩未开放：不画图，给出明确说明。
    const hidden = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
    hidden.on('pageerror', error => errors.push(`hidden: ${error.message}`))
    hidden.setDefaultTimeout(10_000)
    await openHome(hidden, { trend: NOT_VISIBLE })
    await card(hidden).getByText('Your scores are not available yet.', { exact: false }).waitFor()
    assert.equal(await chartPoints(hidden).count(), 0, 'no points are drawn when scores are hidden')
    assert.equal(await switchers(hidden).count(), 0, 'no switcher when neither mode has points')
    assert.deepEqual(await statsValues(hidden), ['3', '3', '—', '—'],
      'statistics still count attempts but show a dash instead of zero')

    // 6. 完全无考试。
    const none = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
    none.on('pageerror', error => errors.push(`none: ${error.message}`))
    none.setDefaultTimeout(10_000)
    await openHome(none, { trend: NO_ATTEMPTS })
    await card(none).getByText('No completed exams to chart yet.', { exact: true }).waitFor()

    // 7. 单点：只画点不画线。
    const single = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
    single.on('pageerror', error => errors.push(`single: ${error.message}`))
    single.setDefaultTimeout(10_000)
    await openHome(single, {
      trend: {
        ...SHSAT_TREND,
        statistics: { totalAttempts: 1, completedAttempts: 1 },
        excluded: { notScored: 0, notVisible: 0 },
        scaled: series({ average: 406, highest: 406, points: [point(1, '2026-10-18T10:00:00Z', 406, 720)] }),
        raw: series({
          unit: 'POINTS', scoreMax: 100, average: 32, highest: 32,
          points: [point(1, '2026-10-18T10:00:00Z', 32, 100)],
        }),
      },
    })
    assert.equal(await chartPoints(single).count(), 1, 'a single attempt renders one point')
    assert.equal(await card(single).locator('.score-trend-chart__line').count(), 0,
      'a single point draws no connecting line')

    // 8. 请求失败：显示错误与重试，不白屏。
    const failed = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
    failed.on('pageerror', error => errors.push(`failed: ${error.message}`))
    failed.setDefaultTimeout(10_000)
    await openHome(failed, { trendError: 'Score service unavailable' })
    await card(failed).getByRole('alert').waitFor()
    await card(failed).getByRole('button', { name: 'Retry' }).waitFor()
    await failed.getByRole('heading', { name: 'My Exams', exact: true }).waitFor()
    await failed.getByRole('heading', { name: 'Assigned Review', exact: true }).waitFor()

    // 9. 卡片位于 My Exams 与 Assigned Review 之间。
    const order = await trend.evaluate(() => Array.from(
      document.querySelectorAll('.student-home > .app-card'))
      .map(node => node.querySelector('.app-card__title')?.textContent?.trim()))
    assert.deepEqual(order, ['My Exams', 'Score Trend', 'Assigned Review', 'Score History and Explanations'],
      'the trend card sits between My Exams and Assigned Review')

    // 10. 390px：无横向溢出，图表可横向滚动。
    await trend.setViewportSize({ width: 390, height: 844 })
    await trend.waitForTimeout(300)
    const mobile = await trend.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      chartScrollable: (() => {
        const scroll = document.querySelector('.score-trend-chart__scroll')
        return scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : false
      })(),
    }))
    assert.ok(mobile.pageWidth <= mobile.viewportWidth, 'the card fits the 390px viewport')
    assert.ok(mobile.chartScrollable, 'a wide chart scrolls inside its own container')
    await card(trend).getByText('Swipe horizontally to view all scores.', { exact: true }).waitFor()
    await trend.screenshot({ path: '/tmp/student-score-trend-mobile.png' })

    assert.deepEqual(errors, [])
    console.log(JSON.stringify({
      result: 'PASS',
      checks: [
        'defaults to scaled score and shows totals plus average/highest',
        'switching to raw updates statistics and curve without a new request',
        'points are ordered from earliest to latest',
        'a single available mode hides the switcher and explains why',
        'differing raw maxima are plotted as absolute values without any comparison note',
        'hidden or ungraded scores show a message instead of an empty chart',
        'no attempts shows the empty state',
        'a single attempt draws a point but no line',
        'a failed request shows the error with Retry and keeps other cards',
        'the card sits between My Exams and Assigned Review',
        'fits 1440px and 390px; the chart scrolls horizontally on mobile',
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
