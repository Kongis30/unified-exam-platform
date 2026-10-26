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
  const timerExamTitle = `SHSAT Auto Submit ${stamp}`;
  const manualExamTitle = `SHSAT Manual Submit ${stamp}`;
  let userId;
  let examId;
  let attemptId;
  let timerExamId;
  let manualExamId;

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
    assert.equal(attempt.autoSubmit, true, 'the active attempt response includes the release auto-submit setting');
    const attemptDetails = await api(student, `/api/student/attempts/${attemptId}`);
    const firstQuestion = attemptDetails.questions.find(question => Number(question.displayNumber) === 1);
    assert.ok(firstQuestion?.paperItemId, 'Question 1 is included in the temporary attempt');
    const paperItemId = firstQuestion.paperItemId;
    await api(student, `/api/student/attempts/${attemptId}/answers/${paperItemId}`, 'PUT', {
      answer: { answers: ['A'] }, timeSpentSeconds: 0,
    });
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const homeExam = (await api(student, '/api/student/exams')).find(item => Number(item.id) === examId);
    assert.ok(homeExam, 'the in-progress exam remains on the student home page');
    assert.equal(Number(homeExam.activeAttemptId), attemptId, 'the student exam list identifies the active attempt');
    const examCard = student.locator('.student-exam-list article.paper-row').filter({ hasText: examTitle });
    const continueButton = examCard.getByRole('button', { name: /^Continue/ });
    await continueButton.waitFor();
    await continueButton.click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await installFullscreenMock(student);
    await student.getByRole('button', { name: 'Enter Fullscreen' }).click();
    await continueExamDirections(student);

    const questionNumber = student.locator('.question-number');
    await questionNumber.filter({ hasText: 'Question 1' }).waitFor();
    const timerAtQuestionStart = parseTimer(await student.locator('.timer-display').innerText());
    const choices = student.locator('.choice-answer__option');
    assert.ok(await choices.count() >= 2, 'Question 1 renders the multiple-choice answer control');
    assert.equal(await choices.first().locator('input[type="radio"]').isChecked(), true,
      'the persisted answer is restored when opening the active attempt');
    await choices.nth(1).click();
    assert.equal(await choices.nth(1).locator('input[type="radio"]').isChecked(), true,
      'the student can change a saved answer locally before saving it again');

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

    await student.waitForTimeout(1_200);
    await student.reload();
    await installFullscreenMock(student);
    await student.getByRole('button', { name: 'Enter Fullscreen' }).click();
    await continueExamDirections(student);
    await questionNumber.filter({ hasText: 'Question 1' }).waitFor();
    const timerAfterReload = parseTimer(await student.locator('.timer-display').innerText());
    assert.ok(timerAfterReload < timerAtQuestionStart,
      'refresh resumes from the server deadline instead of resetting the exam timer');
    assert.equal(await student.locator('.choice-answer__option input[type="radio"]:checked').count(), 0,
      'cleared answer remains empty after refreshing the active attempt');

    await student.screenshot({ path: `/tmp/shsat-clear-answer-desktop-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const dimensions = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'the exam page has no root overflow at 390px');
    await student.screenshot({ path: `/tmp/shsat-clear-answer-mobile-${stamp}.png` });
    const toolbar = student.locator('.exam-toolbar');
    const toolbarMetrics = await toolbar.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    assert.ok(toolbarMetrics.scrollWidth > toolbarMetrics.clientWidth,
      'the narrow exam toolbar exposes its overflow as a horizontal scroll area');
    const submitExam = student.getByRole('button', { name: 'Submit Exam', exact: true });
    await submitExam.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const submitBounds = await submitExam.boundingBox();
    assert.ok(submitBounds && submitBounds.x >= 0 && submitBounds.x + submitBounds.width <= dimensions.viewport + 1,
      `the student can scroll the toolbar until Submit Exam is fully visible; bounds=${JSON.stringify(submitBounds)}, toolbar=${JSON.stringify(toolbarMetrics)}, scrollLeft=${await toolbar.evaluate(element => element.scrollLeft)}`);
    await student.screenshot({ path: `/tmp/shsat-clear-answer-mobile-toolbar-${stamp}.png` });

    timerExamId = await createTimedExam(admin, userId, timerExamTitle, 20, true);

    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await installFullscreenMock(student);
    const timerCard = student.locator('.student-exam-list article.paper-row').filter({ hasText: timerExamTitle });
    await timerCard.getByRole('button', { name: /^Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${timerExamId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    const timerAttemptResponse = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${timerExamId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const timerAttempt = await (await timerAttemptResponse).json();
    const timerAttemptId = Number(timerAttempt.id || timerAttempt.attemptId);
    assert.ok(timerAttemptId > 0, 'the short exam creates an active attempt');
    assert.equal(timerAttempt.autoSubmit, true, 'the timed attempt reports auto-submit enabled');
    await student.locator('.exam-transition-page .exam-transition-card__button').click();
    await student.locator('.question-number').filter({ hasText: 'Question 1' }).waitFor();
    const shortTimerStart = parseTimer(await student.locator('.timer-display').innerText());
    assert.ok(shortTimerStart > 0 && shortTimerStart <= 20, 'the exam shows its configured countdown');
    await student.setViewportSize({ width: 1440, height: 900 });
    await student.screenshot({ path: `/tmp/shsat-exam-timer-desktop-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const timerMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(timerMobileSize.page <= timerMobileSize.viewport, 'the active timed exam fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-exam-timer-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 900 });
    try {
      await student.waitForURL(url => url.pathname === `/student/attempts/${timerAttemptId}/report`, { timeout: 30_000 });
    } catch (error) {
      const failureState = await student.evaluate(() => ({
        url: location.href,
        timer: document.querySelector('.timer-display')?.textContent,
        errors: [...document.querySelectorAll('.error-text, .student-exam__alert--error')].map(item => item.textContent.trim()),
        pageText: document.body.innerText.slice(-800),
      }));
      const attemptState = await api(student, `/api/student/attempts/${timerAttemptId}`)
        .then(({ status, autoSubmit, expiresAt, submittedAt }) => ({ status, autoSubmit, expiresAt, submittedAt }))
        .catch(requestError => requestError.message);
      console.error('Timed exam did not auto-submit:', JSON.stringify({ failureState, attemptState }));
      await student.screenshot({ path: `/tmp/shsat-exam-timer-timeout-${stamp}.png` });
      throw error;
    }
    const timedReport = await api(student, `/api/student/attempts/${timerAttemptId}/report`);
    assert.equal(timedReport.status, 'COMPLETED', 'the countdown submits the unanswered exam automatically');
    assert.ok(timedReport.submittedAt, 'automatic submission records a submission time');
    await student.setViewportSize({ width: 1440, height: 900 });
    await student.getByText('Result Summary', { exact: true }).waitFor();
    await student.screenshot({ path: `/tmp/shsat-exam-timer-report-${stamp}.png` });

    manualExamId = await createTimedExam(admin, userId, manualExamTitle, 8, false);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await installFullscreenMock(student);
    const manualCard = student.locator('.student-exam-list article.paper-row').filter({ hasText: manualExamTitle });
    await manualCard.getByRole('button', { name: /^Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${manualExamId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    const manualAttemptResponse = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${manualExamId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const manualAttempt = await (await manualAttemptResponse).json();
    const manualAttemptId = Number(manualAttempt.id || manualAttempt.attemptId);
    assert.equal(manualAttempt.autoSubmit, false, 'the attempt response preserves auto-submit disabled');
    await student.locator('.exam-transition-page .exam-transition-card__button').click();
    await student.locator('.question-number').filter({ hasText: 'Question 1' }).waitFor();
    await student.locator('.student-exam__alert--error').getByText(
      'Time is up. Auto-submit is disabled for this exam; please contact your teacher.', { exact: true },
    ).waitFor({ timeout: 15_000 });
    const manualAttemptState = await api(student, `/api/student/attempts/${manualAttemptId}`);
    assert.equal(manualAttemptState.status, 'IN_PROGRESS', 'a non-auto-submit exam remains available for manual completion');
    await student.screenshot({ path: `/tmp/shsat-exam-timer-manual-submit-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', checks: ['in-progress exam exposes Continue on student home',
      'Continue restores the active attempt and saved answer', 'change an existing answer then clear it',
      'clear answer remains local after a failed save and persists on retry', 'cleared answer survives refresh',
      'refresh resumes the remaining server-backed timer', 'countdown auto-submits when time expires',
      'auto-submit disabled shows the English time-up message', '390px active exam layout',
      'horizontal exam toolbar reveals Submit Exam on demand'], dimensions, toolbarMetrics, pageErrors: pageErrors.length }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (timerExamId) await api(admin, `/api/admin/exams/${timerExamId}`, 'DELETE').catch(() => {});
    if (manualExamId) await api(admin, `/api/admin/exams/${manualExamId}`, 'DELETE').catch(() => {});
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    await studentContext.close();
    await adminContext.close();
    await browser.close();
  }
}

// 为临时学生创建短时发布，覆盖自动交卷开启/关闭两条考试到期分支。
async function createTimedExam(admin, studentId, title, durationSeconds, autoSubmit) {
  const release = await api(admin, '/api/admin/papers/247/exams', 'POST', {
    title,
    description: 'Temporary SHSAT countdown verification',
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    durationSeconds,
    attemptLimit: 1,
    targetScope: 'SELECTED',
    autoSubmit,
    allowReview: true,
  });
  const examId = Number(release.summary.id);
  await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [], studentUserIds: [studentId] });
  await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');
  return examId;
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

function parseTimer(text) {
  return text.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
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
