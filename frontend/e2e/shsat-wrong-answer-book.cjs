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
  const suffix = String(stamp).slice(-6);
  const username = `shsat_wrong_book_${stamp}`;
  const password = `WrongBook${stamp}!`;
  const title = `Wrong Answer Book ${suffix}`;
  let userId;
  let classId;
  let paperId;
  let examId;

  try {
    await login(admin, adminUsername, adminPassword);
    userId = Number((await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Wrong Book Student ${suffix}`, roleCode: 'STUDENT', email: null, phone: null,
    })).id);
    classId = Number((await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Wrong Book ${suffix}`, description: 'Temporary personal wrong-answer verification', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    })).id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    paperId = Number((await api(admin, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `WRONG_BOOK_${stamp}`, title, description: 'Two-question personal wrong-answer book test',
      groupId: null, defaultDurationSeconds: 600,
    })).summary.id);
    await api(admin, `/api/admin/papers/${paperId}/structure`, 'PUT', {
      sections: [{
        sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0,
        instructions: null, settings: {}, questions: [], children: [{
          sectionCode: 'ELA_WRONG_BOOK', sectionKind: 'SUBTYPE', title: 'Reading and Writing', sortOrder: 0,
          instructions: null, settings: {}, children: [],
          questions: [1, 2].map((displayNumber) => ({
            questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
            stem: `Question ${displayNumber}: select the correct answer.`,
            render: {
              options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Incorrect answer' }],
              questionConfig: {
                shsatSkillTag: { subjectCode: 'ELA', domainCode: 'ELA_READING_COMPREHENSION', skillCode: 'ELA_READING_INFERENCE' },
              },
              validationRules: {},
            },
            answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is correct.',
            categoryId: null, sortOrder: displayNumber - 1, displayNumber, maxPoints: 1, scoringSectionCode: 'ELA',
          })),
        }],
      }],
    });
    await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');
    examId = Number((await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary personal wrong-answer practice',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(), durationSeconds: 600,
      attemptLimit: 2, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    })).summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    const sourceAttempt = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    const items = sourceAttempt.items || sourceAttempt.questions || [];
    assert.equal(items.length, 2, 'the source attempt contains two questions');
    await api(student, `/api/student/attempts/${sourceAttempt.id}/answers/${items[0].paperItemId || items[0].id}`, 'PUT', {
      answer: { value: 'B' }, timeSpentSeconds: 3,
    });
    await api(student, `/api/student/attempts/${sourceAttempt.id}/submit`, 'POST');

    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByRole('tab', { name: /Wrong Answer Book/ }).click();
    const book = student.locator('.shsat-history-row').filter({ hasText: title });
    await book.waitFor();
    const viewAnswers = book.getByRole('button', { name: 'View wrong answers', exact: true });
    const practice = book.getByRole('button', { name: 'Practice', exact: true });
    const latestReport = book.getByRole('button', { name: 'Latest practice report', exact: true });
    assert.equal(await latestReport.isDisabled(), true, 'no practice report is available before the first practice');
    await book.getByText('Review locked', { exact: false }).waitFor();
    assert.equal(await viewAnswers.isDisabled(), true, 'wrong-answer details stay locked until the exam closes');
    assert.equal(await practice.isDisabled(), true, 'personal practice stays locked until the exam closes');
    const lockedPracticeStyle = await practice.evaluate(element => ({
      backgroundImage: getComputedStyle(element).backgroundImage,
      boxShadow: getComputedStyle(element).boxShadow,
    }));
    assert.equal(lockedPracticeStyle.backgroundImage, 'none', 'locked primary action is visually muted');
    assert.equal(lockedPracticeStyle.boxShadow, 'none', 'locked primary action has no active shadow');
    await student.screenshot({ path: `/tmp/shsat-wrong-book-locked-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    await book.scrollIntoViewIfNeeded();
    const lockedMobileSize = await pageSize(student);
    assert.ok(lockedMobileSize.page <= lockedMobileSize.viewport, `locked wrong-answer book fits mobile: ${JSON.stringify(lockedMobileSize)}`);
    await student.screenshot({ path: `/tmp/shsat-wrong-book-locked-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 900 });

    await api(admin, `/api/admin/exams/${examId}/close`, 'POST');
    await student.getByRole('button', { name: 'Refresh', exact: true }).click();
    await book.getByText('2 questions remaining', { exact: false }).waitFor();
    assert.equal(await viewAnswers.isEnabled(), true, 'wrong-answer details unlock after the exam closes');
    assert.equal(await practice.isEnabled(), true, 'personal practice unlocks after the exam closes');

    await viewAnswers.click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${sourceAttempt.id}/wrong-answers`);
    await student.getByRole('heading', { name: 'Question 1', exact: true }).waitFor();
    await student.getByText('Incorrect', { exact: true }).first().waitFor();
    await student.screenshot({ path: `/tmp/shsat-wrong-book-review-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const reviewMobileSize = await pageSize(student);
    assert.ok(reviewMobileSize.page <= reviewMobileSize.viewport, `wrong-answer review fits mobile: ${JSON.stringify(reviewMobileSize)}`);
    await student.screenshot({ path: `/tmp/shsat-wrong-book-review-mobile-${stamp}.png` });
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await student.getByRole('heading', { name: 'Question 2', exact: true }).waitFor();
    await student.getByText('Unanswered', { exact: true }).first().waitFor();
    await student.getByRole('button', { name: 'Previous', exact: true }).click();
    await student.getByRole('heading', { name: 'Question 1', exact: true }).waitFor();
    await student.getByRole('button', { name: 'Back to Wrong Answer Book', exact: true }).click();
    await student.waitForURL(url => url.pathname === '/student/systems/SHSAT');

    await student.getByRole('tab', { name: /Wrong Answer Book/ }).click();
    await installFullscreenMock(student);
    await practice.click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}` && url.searchParams.has('practiceAttemptId'));
    const practiceAttemptId = Number(new URL(student.url()).searchParams.get('practiceAttemptId'));
    const overlay = student.locator('.fullscreen-required-overlay');
    await overlay.waitFor({ state: 'visible' });
    await overlay.locator('.fullscreen-required-dialog__button').click();
    await continueExamDirections(student);
    const practiceAttempt = await api(student, `/api/student/attempts/${practiceAttemptId}`);
    const practiceItems = practiceAttempt.items || practiceAttempt.questions || [];
    assert.equal(practiceItems.length, 2, 'personal practice includes the incorrect and unanswered questions only');

    await student.getByRole('button', { name: 'Leave exam page' }).click();
    const leaveDialog = student.getByRole('dialog', { name: 'Leave Exam Page' });
    await leaveDialog.getByRole('button', { name: 'Stay Here', exact: true }).click();
    assert.match(student.url(), /practiceAttemptId=/, 'canceling the leave prompt keeps the active practice open');
    await student.locator('.choice-answer__option').first().click();
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await student.getByText('Question 2: select the correct answer.', { exact: true }).waitFor();
    await student.getByRole('button', { name: 'Leave exam page' }).click();
    await student.getByRole('dialog', { name: 'Leave Exam Page' }).getByRole('button', { name: 'Leave', exact: true }).click();
    await student.waitForURL(url => url.pathname === '/exam-types/SHSAT');

    const interruptedPractice = await api(student, `/api/student/attempts/${practiceAttemptId}`);
    assert.equal(interruptedPractice.status, 'IN_PROGRESS', 'leaving preserves the unfinished practice attempt');
    await student.getByRole('tab', { name: /Wrong Answer Book/ }).click();
    const refreshedBook = student.locator('.shsat-history-row').filter({ hasText: title });
    await refreshedBook.getByRole('button', { name: 'Practice', exact: true }).click();
    await student.waitForURL(url => Number(url.searchParams.get('practiceAttemptId')) === practiceAttemptId);
    const resumeOverlay = student.locator('.fullscreen-required-overlay');
    await continueExamDirections(student);
    await resumeOverlay.waitFor({ state: 'visible' });
    await resumeOverlay.locator('.fullscreen-required-dialog__button').click();
    await resumeOverlay.waitFor({ state: 'hidden' });
    const questionOne = student.getByText('Question 1: select the correct answer.', { exact: true });
    const questionTwo = student.getByText('Question 2: select the correct answer.', { exact: true });
    await student.locator('.question-number').waitFor();
    if (!(await questionOne.isVisible().catch(() => false))) {
      await questionTwo.waitFor();
      await student.getByRole('button', { name: 'Previous', exact: true }).click();
      await questionOne.waitFor();
    }
    await student.locator('.choice-answer__option input:checked').waitFor({ state: 'attached' });
    const resumedMobileSize = await pageSize(student);
    assert.ok(resumedMobileSize.page <= resumedMobileSize.viewport, `resumed practice fits mobile: ${JSON.stringify(resumedMobileSize)}`);
    await student.screenshot({ path: `/tmp/shsat-wrong-book-resumed-${stamp}.png` });
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await questionTwo.waitFor();
    await student.locator('.choice-answer__option').nth(1).click();
    await student.locator('.choice-answer__option input:checked').waitFor({ state: 'attached' });
    await student.getByRole('button', { name: /Submit Exam|Submit/ }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${practiceAttemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();

    const remainingAfterFirstPractice = await api(student, `/api/student/attempts/${sourceAttempt.id}/wrong-answer-question-numbers`);
    assert.deepEqual(remainingAfterFirstPractice, [2], 'a wrong practice answer keeps that question in the personal wrong-answer book');
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByRole('tab', { name: /Wrong Answer Book/ }).click();
    const retryBook = student.locator('.shsat-history-row').filter({ hasText: title });
    await retryBook.getByText('1 question remaining', { exact: false }).waitFor();
    const retryPractice = retryBook.getByRole('button', { name: 'Practice', exact: true });
    assert.equal(await retryPractice.isEnabled(), true, 'remaining wrong answers can be practiced again');
    await retryPractice.click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`
      && Number(url.searchParams.get('practiceAttemptId')) > 0
      && Number(url.searchParams.get('practiceAttemptId')) !== practiceAttemptId);
    const retryAttemptId = Number(new URL(student.url()).searchParams.get('practiceAttemptId'));
    const retryOverlay = student.locator('.fullscreen-required-overlay');
    await retryOverlay.waitFor({ state: 'visible' });
    await retryOverlay.locator('.fullscreen-required-dialog__button').click();
    await continueExamDirections(student);
    await student.getByText('Question 2: select the correct answer.', { exact: true }).waitFor();
    const retryQuestions = await api(student, `/api/student/attempts/${retryAttemptId}`);
    assert.equal(retryQuestions.questions.length, 1, 'a retry includes only the uncleared question');
    await student.locator('.choice-answer__option').first().click();
    await student.locator('.choice-answer__option input:checked').waitFor({ state: 'attached' });
    await student.getByRole('button', { name: /Submit Exam|Submit/ }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${retryAttemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();

    const remaining = await api(student, `/api/student/attempts/${sourceAttempt.id}/wrong-answer-question-numbers`);
    assert.deepEqual(remaining, [], 'correct retry clears the remaining question from the personal wrong-answer book');
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByRole('tab', { name: /Wrong Answer Book/ }).click();
    await retryBook.getByText('0 questions remaining', { exact: false }).waitFor();
    await viewAnswers.waitFor({ state: 'visible' });
    assert.equal(await viewAnswers.isDisabled(), true, 'cleared questions cannot be opened again');
    assert.equal(await practice.isDisabled(), true, 'cleared questions cannot start another practice');
    await latestReport.waitFor({ state: 'visible' });
    assert.equal(await latestReport.isEnabled(), true, 'latest practice report becomes available after submission');
    await latestReport.click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${retryAttemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();
    await student.setViewportSize({ width: 1440, height: 900 });
    await student.screenshot({ path: `/tmp/shsat-wrong-book-practice-report-desktop-${stamp}.png` });
    await student.screenshot({ path: `/tmp/shsat-wrong-book-practice-report-${stamp}.png` });

    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.setViewportSize({ width: 390, height: 844 });
    await student.getByRole('tab', { name: /Wrong Answer Book/ }).click();
    await book.scrollIntoViewIfNeeded();
    const clearMobileSize = await pageSize(student);
    assert.ok(clearMobileSize.page <= clearMobileSize.viewport, `cleared book fits mobile: ${JSON.stringify(clearMobileSize)}`);
    await student.screenshot({ path: `/tmp/shsat-wrong-book-cleared-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, [], 'wrong-answer book flow has no browser errors');

    console.log(JSON.stringify({
      result: 'PASS', examId, sourceAttemptId: sourceAttempt.id, practiceAttemptId, retryAttemptId,
      lockedMobileSize, reviewMobileSize, resumedMobileSize, clearMobileSize, pageErrors: pageErrors.length,
      screenshots: [
        `/tmp/shsat-wrong-book-locked-${stamp}.png`, `/tmp/shsat-wrong-book-locked-mobile-${stamp}.png`,
        `/tmp/shsat-wrong-book-review-${stamp}.png`, `/tmp/shsat-wrong-book-review-mobile-${stamp}.png`,
        `/tmp/shsat-wrong-book-resumed-${stamp}.png`,
        `/tmp/shsat-wrong-book-practice-report-desktop-${stamp}.png`,
        `/tmp/shsat-wrong-book-practice-report-${stamp}.png`, `/tmp/shsat-wrong-book-cleared-mobile-${stamp}.png`,
      ],
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (paperId) await api(admin, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
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

async function continueExamDirections(page) {
  for (let step = 0; step < 6; step += 1) {
    const button = page.locator('.exam-transition-card__button');
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      continue;
    }
    if (await page.locator('.question-number').isVisible().catch(() => false)) return;
    break;
  }
}

async function pageSize(page) {
  return page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
}

async function api(page, path, method = 'GET', body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  const response = await page.evaluate(async ({ path, method, body, token }) => {
    const result = await fetch(path, {
      method, credentials: 'same-origin',
      headers: {
        Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
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
