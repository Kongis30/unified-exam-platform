const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const username = process.env.E2E_ADMIN_USERNAME;
const password = process.env.E2E_ADMIN_PASSWORD;
if (!username || !password) throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const stamp = Date.now();

  try {
    await login(page);
    const classes = await api(page, '/api/admin/classes?examTypeCodes=SHSAT');
    let target;
    for (const classroom of classes) {
      const classId = Number(classroom.classId || classroom.id);
      const exams = unwrap(await api(page, `/api/admin/classes/${classId}/exams?examTypeCodes=SHSAT`));
      if (exams.length) {
        target = { classId, examId: Number(exams[0].examId) };
        break;
      }
    }
    assert.ok(target?.classId && target?.examId, 'an existing SHSAT class release is available for read-only recovery verification');

    let failOnce = true;
    const scoresUrl = `**/api/admin/reports/exams/${target.examId}/classes/${target.classId}`;
    const interruptScores = async route => {
      if (failOnce && route.request().method() === 'GET') {
        failOnce = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(scoresUrl, interruptScores);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${target.classId}/exams/${target.examId}/results`);
    await page.getByText('Class Exam Results', { exact: true }).waitFor();
    await page.locator('.admin-state--error').first().waitFor();
    await page.unroute(scoresUrl, interruptScores);

    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('.admin-state')]
      .some(element => element.textContent.includes('Loading')));
    assert.equal(await page.locator('.admin-state--error').count(), 0, 'Retry clears the transient error after recovery');
    await page.getByText('Result Summary', { exact: true }).waitFor();
    const showsResults = await page.locator('.result-table-panel').count();
    const showsEmptyState = await page.getByText('No submissions are available for this class and exam.', { exact: true }).count();
    assert.ok(showsResults || showsEmptyState,
      `Retry reloads the result table or its accurate empty state (table=${showsResults}, empty=${showsEmptyState}): ${await page.locator('body').innerText()}`);
    await page.screenshot({ path: `/tmp/shsat-class-results-retry-${stamp}.png`, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.admin-layout__header').count(), 1, 'the mobile page renders one platform navigation header');
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'class results has no root overflow at 390px');
    await page.screenshot({ path: `/tmp/shsat-class-results-retry-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', target, checks: ['temporary results request failure state', 'Retry recovers summary and results/empty state', '390px layout'], dimensions, pageErrors: pageErrors.length }));
  } finally {
    await browser.close();
  }
}

async function login(page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

async function api(page, path) {
  const response = await page.evaluate(async path => {
    const result = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return { status: result.status, text: await result.text() };
  }, path);
  if (response.status < 200 || response.status >= 300) throw new Error(`GET ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

function unwrap(response) {
  return response?.data ?? response?.items ?? response ?? [];
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
