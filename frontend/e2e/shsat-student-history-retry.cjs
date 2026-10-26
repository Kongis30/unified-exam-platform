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
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const pageErrors = [];
  [admin, student].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  const stamp = Date.now();
  const username = `shsat_history_retry_${stamp}`;
  const password = `History${stamp}!`;
  let userId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username,
      password,
      realName: 'SHSAT History Retry Check',
      roleCode: 'STUDENT',
      email: null,
      phone: null,
    });
    userId = Number(user.id);

    let examListRequestCount = 0;
    await student.route('**/api/student/exams', async route => {
      examListRequestCount += 1;
      if ([1, 3].includes(examListRequestCount)) {
        await new Promise(resolve => setTimeout(resolve, 300));
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Temporary exam list failure.' }),
        });
        return;
      }
      await route.continue();
    });
    let reviewTaskRequestCount = 0;
    await student.route('**/api/student/wrong-answer-tasks', async route => {
      reviewTaskRequestCount += 1;
      if (reviewTaskRequestCount === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Temporary review task failure.' }),
        });
        return;
      }
      await route.continue();
    });

    await login(student, username, password);
    const initialFailure = student.waitForResponse(response => response.url().endsWith('/api/student/exams'), { timeout: 5000 });
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const examCard = student.locator('.student-exam-list');
    const historyCard = student.locator('.shsat-student-history');
    await historyCard.getByRole('heading', { name: 'Exam History', exact: true }).waitFor();
    const refreshButton = historyCard.getByRole('button', { name: 'Refresh', exact: true });
    assert.equal(await historyCard.locator('.card-heading button').isDisabled(), true,
      'Refresh is disabled while the initial load is in flight');
    assert.equal((await initialFailure).status(), 503, 'the test injects an initial service error');
    await examCard.getByRole('alert').getByText(/Temporary exam list failure/).waitFor();
    await historyCard.getByRole('alert').getByText(/Temporary review task failure/).waitFor();
    await historyCard.getByRole('tab', { name: 'Review Task History' }).click();
    assert.equal(await historyCard.getByText('No review tasks have been assigned.', { exact: true }).count(), 0,
      'an empty task state is not shown while task history could not be loaded');
    assert.equal(await student.getByText('No exams have been assigned to you yet.', { exact: true }).count(), 0,
      'an empty assignment state is not shown while the exam list could not be loaded');

    const recoveredInitialLoad = student.waitForResponse(response => response.url().endsWith('/api/student/exams'), { timeout: 5000 });
    await refreshButton.click();
    assert.equal((await recoveredInitialLoad).status(), 200, 'refresh recovers from the initial load error');
    await examCard.getByRole('alert').waitFor({ state: 'detached' });
    await historyCard.getByRole('alert').waitFor({ state: 'detached' });
    await historyCard.getByRole('tab', { name: 'Exam History' }).click();
    await examCard.getByText('No exams have been assigned to you yet.', { exact: true }).waitFor();

    const failedRequest = student.waitForResponse(response => response.url().endsWith('/api/student/exams'), { timeout: 5000 });
    await refreshButton.click();
    assert.equal(await historyCard.locator('.card-heading button').isDisabled(), true,
      'Refresh is disabled while the request is in flight');
    assert.equal((await failedRequest).status(), 503, 'the test injects a refresh service error');
    await student.getByRole('alert').getByText(/Temporary exam list failure/).waitFor();
    await student.waitForFunction(() => {
      const button = document.querySelector('.shsat-student-history .card-heading button');
      return button && !button.disabled;
    });
    assert.equal(await examCard.getByText('No exams have been assigned to you yet.', { exact: true }).count(), 0,
      'an empty assignment state is not shown while the exam list could not be loaded');
    await student.screenshot({ path: `/tmp/shsat-student-history-error-${stamp}.png` });

    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
      headerCount: document.querySelectorAll('.main-layout__header').length,
    }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the error state fits a 390px viewport');
    assert.equal(mobileSize.headerCount, 1, 'the narrow layout renders one platform navigation bar');
    await student.screenshot({ path: `/tmp/shsat-student-history-error-mobile-${stamp}.png` });

    const recoveredRefresh = student.waitForResponse(response => response.url().endsWith('/api/student/exams'), { timeout: 5000 });
    await refreshButton.click();
    assert.equal((await recoveredRefresh).status(), 200, 'refresh recovers from a temporary refresh error');
    await student.getByRole('alert').waitFor({ state: 'detached' });
    await examCard.getByText('No exams have been assigned to you yet.', { exact: true }).waitFor();

    assert.deepEqual(pageErrors, [], 'the failed request is handled without an unhandled page error');

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['initial exam-list and SHSAT history failures show English errors', 'initial load recovers both endpoints via Refresh', 'Refresh disables during request', 'refresh failure can be retried successfully', '390px error-state layout'],
      mobileSize,
      pageErrors: pageErrors.length,
      screenshots: [`/tmp/shsat-student-history-error-${stamp}.png`, `/tmp/shsat-student-history-error-mobile-${stamp}.png`],
    }));
  } finally {
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    await studentContext.close();
    await adminContext.close();
    await browser.close();
  }
}

async function login(page, username, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

async function api(page, path, method = 'GET', body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  const response = await page.evaluate(async ({ path, method, body, token }) => {
    const result = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-XSRF-TOKEN': token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: result.status, text: await result.text() };
  }, { path, method, body, token });
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
