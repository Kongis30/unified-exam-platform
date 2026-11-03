const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

if (!adminUsername || !adminPassword) {
  throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const outsiderContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const outsider = await outsiderContext.newPage();
  const pageErrors = [];
  [admin, student, outsider].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  const stamp = Date.now();
  const password = `shsat-state-${stamp}`;
  const eligibleUsername = `shsat_state_${stamp}`;
  const outsiderUsername = `shsat_outsider_${stamp}`;
  const examIds = [];
  const userIds = [];

  try {
    await login(admin, adminUsername, adminPassword);
    const eligible = await api(admin, '/api/admin/users', 'POST', {
      username: eligibleUsername,
      password,
      realName: 'SHSAT State Check',
      roleCode: 'STUDENT',
      email: null,
      phone: null,
    });
    userIds.push(eligible.id);
    const ineligible = await api(admin, '/api/admin/users', 'POST', {
      username: outsiderUsername,
      password,
      realName: 'SHSAT State Check Outsider',
      roleCode: 'STUDENT',
      email: null,
      phone: null,
    });
    userIds.push(ineligible.id);

    const papers = await api(admin, '/api/admin/exam-types/SHSAT/papers');
    const paper = papers.find(item => item.id === 247 && item.status === 'READY');
    assert.ok(paper, 'the 100-question SHSAT CRASH COURSE TEST 4 paper is available');

    const upcoming = await createPublishedExam(admin, paper.id, eligible.id, 'Upcoming', 20);
    examIds.push(upcoming.id);
    const available = await createPublishedExam(admin, paper.id, eligible.id, 'Available', -5);
    examIds.push(available.id);
    const retake = await createPublishedExam(admin, paper.id, eligible.id, 'Retake', -5, 3);
    examIds.push(retake.id);
    const closingExam = await createPublishedExam(admin, paper.id, eligible.id, 'Closing Soon', -5, 1, 5 * 60_000);
    examIds.push(closingExam.id);

    await login(student, eligibleUsername, password);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByRole('heading', { name: 'SHSAT', exact: true }).waitFor();
    await student.reload();
    await student.getByRole('heading', { name: 'SHSAT', exact: true }).waitFor();
    const rows = student.locator('.student-exam-list .paper-row');
    const upcomingRow = rows.filter({ hasText: upcoming.title });
    const availableRow = rows.filter({ hasText: available.title });
    const closingRow = rows.filter({ hasText: closingExam.title });
    await upcomingRow.waitFor();
    await availableRow.waitFor();
    await closingRow.getByText('Available', { exact: true }).waitFor();
    const initialClosingExam = (await api(student, '/api/student/exams'))
      .find(exam => Number(exam.examId || exam.id) === closingExam.id);
    assert.equal(await closingRow.getByRole('button', { name: /^Start exam/ }).count(), 1,
      `a newly available exam must expose Start exam; api=${JSON.stringify(initialClosingExam)}, card=${await closingRow.innerText()}`);

    assert.match(await upcomingRow.innerText(), /Upcoming/);
    assert.equal(await upcomingRow.getByRole('button', { name: 'Start exam' }).count(), 0,
      'upcoming exams cannot be started early');
    assert.match(await availableRow.innerText(), /Available/);
    assert.equal(await availableRow.getByRole('button', { name: 'Start exam' }).count(), 1,
      'available exams provide a Start exam action');
    assert.equal(await availableRow.getByRole('button', { name: 'Start exam' }).isEnabled(), true);
    await student.screenshot({ path: `/tmp/shsat-student-exam-states-${stamp}.png` });

    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.ok(mobileSize.pageWidth <= mobileSize.viewportWidth, 'SHSAT student home has no mobile overflow');
    await student.screenshot({ path: `/tmp/shsat-student-exam-states-mobile-${stamp}.png` });

    const retakeAttempts = [];
    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      const attempt = await api(student, `/api/student/exams/${retake.id}/attempts`, 'POST', { firstSection: 'ELA' });
      retakeAttempts.push(Number(attempt.id));
      const submitted = await api(student, `/api/student/attempts/${attempt.id}/submit`, 'POST');
      assert.ok(['SUBMITTED', 'COMPLETED'].includes(submitted.status), `retake ${attemptNumber} is submitted`);
    }
    const history = await api(student, '/api/student/attempts/history');
    const retakeHistory = history.filter(item => Number(item.examId) === retake.id);
    assert.deepEqual(retakeHistory.map(item => Number(item.attemptNumber)), [3, 2, 1],
      'student history sorts repeated attempts latest first');
    assert.deepEqual(retakeHistory.map(item => Number(item.attemptId)), [...retakeAttempts].reverse(),
      'student history exposes the expected attempts for this exam');
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const retakeCard = student.locator('.student-exam-list article.paper-row').filter({ hasText: retake.title });
    await retakeCard.getByText('Submitted', { exact: true }).waitFor();
    assert.equal(await retakeCard.getByRole('button', { name: /^Start exam/ }).count(), 0,
      'the exam cannot be started after all allowed attempts are used');
    const viewAttemptButton = retakeCard.getByRole('button', { name: 'View attempt', exact: true });
    await viewAttemptButton.waitFor();
    await viewAttemptButton.click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${retakeAttempts[2]}`);
    await student.getByRole('heading', { name: retake.title, exact: true }).waitFor();
    await student.getByText('Your answers are locked. Results will be available according to the exam settings.',
      { exact: true }).waitFor();
    await student.getByRole('link', { name: /Return to your exams/ }).waitFor();
    await student.screenshot({ path: `/tmp/shsat-student-view-attempt-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const attemptMobileSize = await student.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.ok(attemptMobileSize.pageWidth <= attemptMobileSize.viewportWidth,
      'the submitted attempt detail fits the 390px viewport');
    const statusBounds = await student.locator('.attempt-clock').boundingBox();
    assert.ok(statusBounds && statusBounds.x >= 0
      && statusBounds.x + statusBounds.width <= attemptMobileSize.viewportWidth + 1,
    'the submitted attempt status card stays within the mobile content area');
    await student.screenshot({ path: `/tmp/shsat-student-view-attempt-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 900 });
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByRole('tab', { name: 'Exam History', exact: true }).click();
    const retakeRows = student.locator('.shsat-history-row').filter({ hasText: retake.title });
    assert.equal(await retakeRows.count(), 3, 'the student sees all three retakes in Exam History');
    assert.equal(await retakeRows.getByRole('button', { name: /delete/i }).count(), 0,
      'SHSAT completed exam reports cannot be deleted by a student');
    await retakeRows.nth(0).getByText('Attempt #3', { exact: false }).waitFor();
    await retakeRows.nth(1).getByText('Attempt #2', { exact: false }).waitFor();
    await retakeRows.nth(2).getByText('Attempt #1', { exact: false }).waitFor();
    await student.screenshot({ path: `/tmp/shsat-student-retake-history-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const historyMobileSize = await student.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.ok(historyMobileSize.pageWidth <= historyMobileSize.viewportWidth,
      'repeated attempts fit within the 390px history view');
    await student.screenshot({ path: `/tmp/shsat-student-retake-history-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 1000 });
    const historyRefresh = student.locator('.shsat-student-history').getByRole('button', { name: 'Refresh', exact: true });
    const refreshedHistory = student.waitForResponse(response => response.url().endsWith('/api/student/attempts/history'));
    await historyRefresh.click();
    assert.equal((await refreshedHistory).status(), 200, 'history refresh reloads completed attempts successfully');
    assert.equal(await retakeRows.count(), 3, 'refresh preserves all attempts in latest-first history');
    await student.evaluate(() => window.scrollTo(0, 420));
    const historyScrollY = await student.evaluate(() => window.scrollY);
    const historyPageBeforeReport = await student.evaluate(() => ({
      pageHeight: document.documentElement.scrollHeight,
      examRows: document.querySelectorAll('.student-exam-list .paper-row').length,
      attemptRows: document.querySelectorAll('.shsat-history-row').length,
    }));
    await api(admin, `/api/admin/exams/${retake.id}/close`, 'POST');
    await retakeRows.nth(0).getByRole('button', { name: 'View report', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${retakeAttempts[2]}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();
    const reportQuestion = student.locator('.question-link').first();
    await reportQuestion.waitFor();
    const reviewedQuestionNumber = (await reportQuestion.innerText()).match(/\d+/)?.[0];
    await reportQuestion.click();
    await student.waitForURL(url => url.pathname === `/student/exams/${retake.id}`
      && url.searchParams.get('review') === '1'
      && url.searchParams.get('questionNumber') === reviewedQuestionNumber);
    assert.equal(await student.getByText('This exam paper is unavailable. Please contact your teacher.', { exact: true }).count(), 0,
      'read-only report review uses the submitted question snapshot without a misleading paper-unavailable warning');
    await student.getByRole('button', { name: 'Back to Report', exact: true }).waitFor();
    await student.screenshot({ path: `/tmp/shsat-student-report-question-review-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const questionReviewMobileSize = await student.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.ok(questionReviewMobileSize.pageWidth <= questionReviewMobileSize.viewportWidth,
      'read-only question review from a report fits the 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-student-report-question-review-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 1000 });
    await student.getByRole('button', { name: 'Back to Report', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${retakeAttempts[2]}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();
    await student.evaluate(() => window.scrollTo(0, 0));
    await student.screenshot({ path: `/tmp/shsat-student-history-report-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    await student.evaluate(() => window.scrollTo(0, 0));
    const historyReportMobileSize = await student.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.ok(historyReportMobileSize.pageWidth <= historyReportMobileSize.viewportWidth,
      'the report opened from history fits the 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-student-history-report-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 1000 });
    await student.getByRole('button', { name: 'Back to SHSAT', exact: true }).click();
    await student.waitForURL(url => url.pathname === '/student/systems/SHSAT');
    await student.getByRole('tab', { name: 'Exam History', exact: true }).waitFor();
    assert.equal(await student.getByRole('tab', { name: 'Exam History', exact: true }).getAttribute('aria-selected'), 'true',
      'returning from the report preserves the selected history tab');
    await student.screenshot({ path: `/tmp/shsat-student-history-return-${stamp}.png` });
    const returnedHistoryPosition = await student.evaluate(() => ({
      scrollY: window.scrollY,
      pageHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      attemptRows: document.querySelectorAll('.shsat-history-row').length,
      examRows: document.querySelectorAll('.student-exam-list .paper-row').length,
    }));
    assert.equal(returnedHistoryPosition.scrollY, historyScrollY,
      `returning from a report preserves the history list position (${JSON.stringify({ historyScrollY, historyPageBeforeReport, ...returnedHistoryPosition })})`);

    await outsider.goto(`${baseUrl}/login`);
    await outsider.getByLabel('Username').fill('');
    await outsider.getByLabel('Password').fill('');
    await outsider.locator('button[type="submit"]').click();
    await outsider.getByText('Please enter your username.', { exact: true }).waitFor();
    await outsider.getByText('Please enter your password.', { exact: true }).waitFor();
    await outsider.getByLabel('Username').fill(outsiderUsername);
    await outsider.getByLabel('Password').fill(`${password}-wrong`);
    await outsider.locator('button[type="submit"]').click();
    await outsider.getByText('Invalid username or password.', { exact: true }).waitFor();
    await api(admin, `/api/admin/users/${ineligible.id}/status`, 'PATCH', { status: 'DISABLED' });
    await outsider.getByLabel('Password').fill(password);
    await outsider.locator('button[type="submit"]').click();
    await outsider.getByText('Invalid username or password.', { exact: true }).waitFor();
    await api(admin, `/api/admin/users/${ineligible.id}/status`, 'PATCH', { status: 'ACTIVE' });
    await login(outsider, outsiderUsername, password);
    const foreignReportStatus = await outsider.evaluate(async attemptId =>
      (await fetch(`/api/student/attempts/${attemptId}/report`)).status, retakeAttempts[2]);
    assert.ok([403, 404].includes(foreignReportStatus),
      'another student cannot read a report outside their own account');
    await outsider.goto(`${baseUrl}/student/systems/SHSAT`);
    await outsider.getByRole('heading', { name: 'SHSAT', exact: true }).waitFor();
    assert.equal(await outsider.getByText(upcoming.title, { exact: true }).count(), 0,
      'a student outside the target audience cannot see an upcoming release');
    assert.equal(await outsider.getByText(available.title, { exact: true }).count(), 0,
      'a student outside the target audience cannot see an available release');

    await student.addInitScript(endedAt => { Date.now = () => endedAt; }, Date.parse(closingExam.closesAt) + 1);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const expiredRow = student.locator('.student-exam-list article.paper-row').filter({ hasText: closingExam.title });
    await expiredRow.getByText('Closed', { exact: true }).waitFor();
    assert.ok(await expiredRow.locator('.status-pill.is-closed').isVisible(),
      'the closed state uses a neutral status style rather than the available green style');
    assert.equal(await expiredRow.getByRole('button', { name: /^Start exam/ }).count(), 0,
      'a closed exam cannot be started after its availability window ends');
    assert.equal(await api(student, '/api/student/exams').then(exams =>
      exams.some(exam => Number(exam.examId || exam.id) === closingExam.id)), true,
    'the student can still see the closed release and its final status');
    await student.screenshot({ path: `/tmp/shsat-student-exam-closed-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const closedMobileSize = await student.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
    assert.ok(closedMobileSize.pageWidth <= closedMobileSize.viewportWidth, 'the closed exam card fits the mobile viewport');
    await expiredRow.getByText('Closed', { exact: true }).waitFor();
    await expiredRow.scrollIntoViewIfNeeded();
    await student.screenshot({ path: `/tmp/shsat-student-exam-closed-mobile-${stamp}.png`, fullPage: true });
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['Upcoming status and disabled start', 'Available status and start action',
        'target eligibility isolation', 'View attempt opens the latest submitted read-only attempt',
        'repeated attempts and latest-first history',
        'history refresh, report-to-question-to-report route, tab/scroll return, and 390px layout',
        'required login fields, invalid password, disabled account and refresh session',
        'student report access remains private', 'availability closure disables Start exam', '390px layout'],
      mobileSize,
      historyMobileSize,
      historyReportMobileSize,
      closedMobileSize,
      pageErrors: pageErrors.length,
    }));
  } finally {
    for (const examId of examIds) {
      await api(admin, `/api/admin/exams/${examId}`, 'DELETE');
    }
    for (const userId of userIds) {
      await api(admin, `/api/admin/users/${userId}`, 'DELETE');
    }
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

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  }
  return response.text ? JSON.parse(response.text) : null;
}

async function createPublishedExam(admin, paperId, studentId, state, startOffsetMinutes, attemptLimit = 1,
                                   closesInMilliseconds = 45 * 60_000) {
  const now = Date.now();
  const created = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
    title: `SHSAT ${state} state ${Date.now()}`,
    description: 'Temporary student status verification',
    opensAt: new Date(now + startOffsetMinutes * 60_000).toISOString(),
    closesAt: new Date(now + closesInMilliseconds).toISOString(),
    durationSeconds: 10_800,
    attemptLimit,
    targetScope: 'SELECTED',
    allowReview: true,
  });
  const examId = created.summary.id;
  await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', {
    classIds: [],
    studentUserIds: [studentId],
  });
  await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');
  return { id: examId, title: created.summary.title, closesAt: created.summary.closesAt };
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
