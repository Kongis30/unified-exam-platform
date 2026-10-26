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
  const username = `shsat_clear_${stamp}`;
  const password = `Clear${stamp}!`;
  const examTitle = `SHSAT Clear Answer ${stamp}`;
  let userId;
  let examId;
  let attemptId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: 'Clear Answer Check', roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const created = await api(admin, '/api/admin/papers/247/exams', 'POST', {
      title: examTitle,
      description: 'Temporary clear-answer persistence check',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    examId = Number(created.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [], studentUserIds: [userId] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    const attempt = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    attemptId = Number(attempt.attemptId || attempt.id);
    assert.ok(attemptId, 'the temporary student has an active ELA attempt');
    const attemptDetails = await api(student, `/api/student/attempts/${attemptId}`);
    const firstQuestion = attemptDetails.questions.find(question => Number(question.displayNumber) === 1);
    assert.ok(firstQuestion?.paperItemId, 'Question 1 is included in the temporary attempt');
    const paperItemId = firstQuestion.paperItemId;
    await api(student, `/api/student/attempts/${attemptId}/answers/${paperItemId}`, 'PUT', {
      answer: { answers: ['A'] }, timeSpentSeconds: 0,
    });
    await student.goto(`${baseUrl}/student/shsat/exams/${examId}`);
    await installFullscreenMock(student);
    await student.getByRole('button', { name: 'Enter Fullscreen' }).click();
    await continueExamDirections(student);

    const questionNumber = student.locator('.question-number');
    await questionNumber.filter({ hasText: 'Question 1' }).waitFor();
    const choices = student.locator('.choice-answer__option');
    assert.ok(await choices.count() >= 2, 'Question 1 renders the multiple-choice answer control');
    assert.equal(await choices.first().locator('input[type="radio"]').isChecked(), true,
      'the persisted answer is restored when opening the active attempt');

    let failFirstClearSave = true;
    await student.route(`**/api/student/attempts/${attemptId}/answers/**`, async route => {
      if (failFirstClearSave && route.request().method() === 'PUT') {
        failFirstClearSave = false;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary save failure' }) });
        return;
      }
      await route.continue();
    });
    const failedClearSave = student.waitForResponse(response => response.request().method() === 'PUT'
      && response.url().includes(`/api/student/attempts/${attemptId}/answers/`), { timeout: 5000 });
    await student.getByRole('button', { name: 'Clear Answer', exact: true }).click();
    assert.equal((await failedClearSave).status(), 500, 'the initial clear can fail without restoring the local answer');
    assert.equal(await student.locator('.choice-answer__option input[type="radio"]:checked').count(), 0,
      'the local answer stays cleared after a save failure');
    await student.locator('.student-exam__alert--error').getByText(/Failed to save Question 1/).waitFor();

    const retriedClearSave = student.waitForResponse(response => response.request().method() === 'PUT'
      && response.url().includes(`/api/student/attempts/${attemptId}/answers/`), { timeout: 5000 });
    await student.getByRole('button', { name: 'Clear Answer', exact: true }).click();
    assert.equal((await retriedClearSave).status(), 200, 'retry persists the cleared answer');

    await student.reload();
    await installFullscreenMock(student);
    await student.getByRole('button', { name: 'Enter Fullscreen' }).click();
    await continueExamDirections(student);
    await questionNumber.filter({ hasText: 'Question 1' }).waitFor();
    assert.equal(await student.locator('.choice-answer__option input[type="radio"]:checked').count(), 0,
      'cleared answer remains empty after refreshing the active attempt');

    await student.screenshot({ path: `/tmp/shsat-clear-answer-desktop-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const dimensions = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'the exam page has no root overflow at 390px');
    await student.screenshot({ path: `/tmp/shsat-clear-answer-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', checks: ['formal exam start through student UI', 'multiple-choice answer save and restore', 'clear answer remains local after a failed save and persists on retry', 'cleared answer survives refresh', '390px layout'], dimensions, pageErrors: pageErrors.length }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
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

async function continueExamDirections(page) {
  const questionNumber = page.locator('.question-number');
  for (let step = 0; step < 6; step += 1) {
    const continueButton = page.locator('.exam-transition-card__button');
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click();
      continue;
    }
    if (await questionNumber.isVisible().catch(() => false)) return;
    break;
  }
}

async function installFullscreenMock(page) {
  await page.evaluate(() => {
    let activeElement = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => activeElement });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    document.documentElement.requestFullscreen = async function () {
      activeElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    document.exitFullscreen = async () => {
      activeElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
}

async function api(page, path, method = 'GET', body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  const response = await page.evaluate(async ({ path, method, body, token }) => {
    const result = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-XSRF-TOKEN': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: result.status, text: await result.text() };
  }, { path, method, body, token });
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
