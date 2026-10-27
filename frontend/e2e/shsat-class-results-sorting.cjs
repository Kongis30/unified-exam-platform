const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
if (!adminUsername || !adminPassword) throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const stamp = Date.now();
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await login(page);
    const classes = unwrap(await api(page, '/api/admin/classes?examTypeCodes=SHSAT'));
    let selected = null;
    for (const classroom of classes) {
      const exams = unwrap(await api(page, `/api/admin/classes/${classroom.id || classroom.classId}/exams`));
      for (const exam of exams) {
        const classId = classroom.id || classroom.classId;
        const examId = exam.examId || exam.id;
        const scores = unwrap(await api(page, `/api/admin/reports/exams/${examId}/classes/${classId}`));
        if (scores.length >= 3 && scores.some(row => row.status === 'COMPLETED')) {
          selected = { classId, examId, scores };
          break;
        }
      }
      if (selected) break;
    }
    assert.ok(selected, 'a class exam with at least three score rows is available');

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${selected.classId}/exams/${selected.examId}/results`);
    await page.locator('.result-table tbody tr').first().waitFor();
    const sortControls = [
      { key: 'totalScore', buttonLabel: 'total score', description: 'available score', title: 'Total Score' },
      { key: 'elaScore', buttonLabel: 'ELA score', description: 'ELA section score', title: 'ELA Score' },
      { key: 'mathScore', buttonLabel: 'Math score', description: 'Math section score', title: 'Math Score' },
      { key: 'accuracy', buttonLabel: 'accuracy', description: 'accuracy', title: 'Accuracy' },
      { key: 'submittedAt', buttonLabel: 'submitted time', description: 'submitted time', title: 'Submitted' },
    ];
    for (const sort of sortControls) {
      const button = page.getByRole('button', { name: new RegExp(`Sort by ${sort.buttonLabel}`) });
      await button.click();
      const firstDirection = sort.key === 'totalScore' ? 'asc' : 'desc';
      await assertSortOrder(page, selected.scores, sort, firstDirection);
      await button.click();
      await assertSortOrder(page, selected.scores, sort, firstDirection === 'desc' ? 'asc' : 'desc');
    }

    const viewedStudent = selected.scores.find(row => row.studentId && row.studentName);
    assert.ok(viewedStudent, 'class results include a student with a detail page');
    const viewedStudentRow = page.locator('.result-table tbody tr').filter({ hasText: viewedStudent.studentName });
    await page.evaluate(() => window.scrollTo(0, 240));
    const studentDetailButton = viewedStudentRow.getByRole('button', { name: 'View', exact: true });
    await studentDetailButton.scrollIntoViewIfNeeded();
    const resultsScrollY = await page.evaluate(() => window.scrollY);
    await studentDetailButton.click();
    await page.waitForURL(url => url.pathname.endsWith(`/students/${viewedStudent.studentId}`));
    await page.getByRole('heading', { name: viewedStudent.studentName, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to Class Results', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/classes/${selected.classId}/exams/${selected.examId}/results`));
    await page.locator('.result-table tbody tr').first().waitFor();
    await page.getByText('Sorted by submitted time, oldest first.', { exact: true }).waitFor();
    await assertSortOrder(page, selected.scores, sortControls.at(-1), 'asc');
    const returnedScrollY = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(returnedScrollY - resultsScrollY) <= 2,
      `student detail return preserves class results scroll position (${resultsScrollY} -> ${returnedScrollY})`);

    const monitorButton = page.getByRole('button', { name: 'Monitor', exact: true });
    await monitorButton.scrollIntoViewIfNeeded();
    const monitorReturnScrollY = await page.evaluate(() => window.scrollY);
    await monitorButton.click();
    await page.waitForURL(url => url.pathname.endsWith(`/exams/${selected.examId}/monitor`));
    await page.getByRole('heading').first().waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/classes/${selected.classId}/exams/${selected.examId}/results`));
    await page.locator('.result-table tbody tr').first().waitFor();
    await page.getByText('Sorted by submitted time, oldest first.', { exact: true }).waitFor();
    await assertSortOrder(page, selected.scores, sortControls.at(-1), 'asc');
    const monitorReturnedScrollY = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(monitorReturnedScrollY - monitorReturnScrollY) <= 2,
      `monitor return preserves class results scroll position (${monitorReturnScrollY} -> ${monitorReturnedScrollY})`);

    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'class results page fits desktop viewport');
    await scrollBelowFixedNavigation(page, '.result-table-wrap');
    await page.screenshot({ path: `/tmp/shsat-class-results-sorting-desktop-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileDimensions.page <= mobileDimensions.viewport, 'class results page fits a 390px viewport');
    await scrollBelowFixedNavigation(page, '.result-table-wrap');
    await page.screenshot({ path: `/tmp/shsat-class-results-sorting-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', checks: ['total/ELA/Math/accuracy/submitted sort in both directions', 'data ordering matches score API', 'student detail and monitor return preserve active sort and vertical position', 'desktop and 390px fit', 'no page errors'], rows: selected.scores.length, dimensions, mobileDimensions }));
  } finally {
    await browser.close();
  }
}

// 复用真实登录态的同源 API，以班级成绩接口为排序的独立预期数据源。
async function login(page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(adminUsername);
  await page.getByLabel('Password').fill(adminPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

// 兼容列表接口直接返回数组或包装在 items/records 中的响应。
function unwrap(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.records || data?.list || data?.content || [];
}

async function api(page, path) {
  const response = await page.evaluate(async path => {
    const result = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return { status: result.status, body: await result.text() };
  }, path);
  if (response.status < 200 || response.status >= 300) throw new Error(`GET ${path}: ${response.status} ${response.body}`);
  return response.body ? JSON.parse(response.body) : null;
}

async function getVisibleStudentNames(page) {
  return page.locator('.result-table tbody .result-student-name').allTextContents();
}

async function scrollBelowFixedNavigation(page, selector) {
  await page.locator(selector).evaluate(element => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    const fixedNavigationHeight = window.innerWidth <= 600 ? 145 : 88;
    window.scrollTo(0, Math.max(0, top - fixedNavigationHeight));
  });
}

async function assertSortOrder(page, scores, sort, direction) {
  const textDirection = sort.key === 'submittedAt'
    ? (direction === 'desc' ? 'newest first' : 'oldest first')
    : (direction === 'desc' ? 'highest first' : 'lowest first');
  await page.getByText(`Sorted by ${sort.description}, ${textDirection}.`, { exact: true }).waitFor();
  const actualNames = await getVisibleStudentNames(page);
  const expectedNames = scores
    .slice()
    .sort((left, right) => compareForSort(left, right, sort.key, direction))
    .map(row => row.studentName || 'Unnamed Student');
  assert.deepEqual(actualNames, expectedNames, `${sort.title} ${direction} order matches score data`);
}

function compareForSort(left, right, key, direction) {
  const leftValue = sortValue(left, key);
  const rightValue = sortValue(right, key);
  if (leftValue == null || rightValue == null) {
    if (leftValue == null && rightValue != null) return 1;
    if (rightValue == null && leftValue != null) return -1;
  } else if (leftValue !== rightValue) {
    return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
  }
  const leftScore = scoreValue(left);
  const rightScore = scoreValue(right);
  if (leftScore != null && rightScore != null && leftScore !== rightScore) return rightScore - leftScore;
  return String(left.studentName || '').localeCompare(String(right.studentName || ''));
}

function sortValue(row, key) {
  const scaled = row.scoringMode !== 'RAW_ONLY' && (row.compositeScore ?? row.totalScaledScore) != null;
  if (key === 'totalScore') return scoreValue(row);
  if (key === 'elaScore') return numberValue(scaled ? (row.elaScaledScore ?? row.section1ScaledScore) : (row.elaRawScore ?? row.section1Score));
  if (key === 'mathScore') return numberValue(scaled ? (row.mathScaledScore ?? row.section2ScaledScore) : (row.mathRawScore ?? row.section2Score));
  if (key === 'accuracy') return numberValue(row.accuracy);
  if (key === 'submittedAt') return row.submittedAt ? new Date(row.submittedAt).getTime() : null;
  return null;
}

function scoreValue(row) {
  const scaled = row.scoringMode !== 'RAW_ONLY' && (row.compositeScore ?? row.totalScaledScore) != null;
  const value = scaled ? (row.compositeScore ?? row.totalScaledScore) : (row.rawTotalScore ?? row.totalScore);
  if (value == null || value === '') return null;
  return numberValue(value);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
