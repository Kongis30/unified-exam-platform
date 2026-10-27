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
  const username = `shsat_two_section_${stamp}`;
  const password = `TwoSection${stamp}!`;
  const title = `Two Section Check ${suffix}`;
  let userId;
  let classId;
  let paperId;
  let examId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Two Section Student ${suffix}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Two Section ${suffix}`, description: 'Temporary SHSAT two-section exam verification', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const paper = await api(admin, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `TWO_SECTION_${stamp}`, title, description: 'Two questions across ELA and Math',
      groupId: null, defaultDurationSeconds: 1_200,
    });
    paperId = Number(paper.summary.id);
    await api(admin, `/api/admin/papers/${paperId}/structure`, 'PUT', {
      sections: [
        makePart('ELA', 'English Language Arts', 0, 'ELA_REVIEW', 1, 'A', 'ELA'),
        makePart('MATH', 'Mathematics', 1, 'MATH_REVIEW', 58, 'B', 'MATH'),
      ],
    });
    await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');
    const release = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary SHSAT section transition verification',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 1_200, attemptLimit: 2, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    await installFullscreenMock(student);
    const first = await runAttempt(student, examId, 'ELA', { ELA: 'A', MATH: 'A' }, username, password);
    assert.equal(await student.locator('.summary-field').filter({ hasText: 'Left Exam Page' })
      .locator('.summary-field__value').innerText(), '1',
    'the student report displays the persisted fullscreen violation count');
    const violationReportDesktop = `/tmp/shsat-focus-violation-report-${stamp}.png`;
    await student.locator('.result-summary-card').scrollIntoViewIfNeeded();
    await student.screenshot({ path: violationReportDesktop });
    await student.setViewportSize({ width: 390, height: 844 });
    const violationReportMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(violationReportMobileSize.page <= violationReportMobileSize.viewport,
      'the report containing focus violations fits the mobile viewport');
    const focusViolationField = student.locator('.summary-field').filter({ hasText: 'Left Exam Page' });
    await focusViolationField.scrollIntoViewIfNeeded();
    const violationReportMobile = `/tmp/shsat-focus-violation-report-mobile-${stamp}.png`;
    await student.screenshot({ path: violationReportMobile });
    await student.setViewportSize({ width: 1440, height: 900 });
    const second = await runAttempt(student, examId, 'MATH', { ELA: 'B', MATH: 'B' }, username, password);
    const firstReport = await api(admin, `/api/admin/reports/attempts/${first.attemptId}/result`);
    const secondReport = await api(admin, `/api/admin/reports/attempts/${second.attemptId}/result`);
    const firstStudentReport = await api(student, `/api/student/attempts/${first.attemptId}/report`);
    assert.equal(firstReport.totalScore, 1, 'ELA-first attempt awards one raw point');
    assert.equal(firstReport.correctCount, 1);
    assert.equal(firstReport.wrongCount, 1);
    assert.equal(firstReport.unansweredCount, 0);
    assert.equal(firstReport.elaRawScore, 1);
    assert.equal(firstReport.mathRawScore, 0);
    assert.equal(secondReport.totalScore, 1, 'Math-first attempt awards one raw point');
    assert.equal(secondReport.elaRawScore, 0);
    assert.equal(secondReport.mathRawScore, 1);
    assert.deepEqual(firstReport.questions.map(question => [question.partCode, question.correct]), [['ELA', true], ['MATH', false]],
      'ELA-first results preserve ELA and Math answer ownership');
    assert.deepEqual(secondReport.questions.map(question => [question.partCode, question.correct]), [['ELA', false], ['MATH', true]],
      'Math-first attempt preserves section ownership and scores in canonical paper order');
    assert.ok(Number(firstReport.questions.find(question => question.partCode === 'MATH')?.timeSpent) >= 1,
      'time spent during the ELA-to-Math transition is included in the next section question report');
    assert.ok(Number(secondReport.questions.find(question => question.partCode === 'ELA')?.timeSpent) >= 1,
      'time spent during the Math-to-ELA transition is included in the next section question report');
    assert.equal(firstStudentReport.scoreVisible, true, 'students see the score after submitting this exam');
    assert.equal(firstStudentReport.answersVisible, false, 'answer details remain hidden before the exam closes');
    assert.equal(firstStudentReport.correctCount, null, 'correct counts remain hidden with answer details');
    assert.equal(firstStudentReport.wrongCount, null, 'wrong counts remain hidden with answer details');
    assert.equal(firstStudentReport.accuracy, null, 'accuracy remains hidden with answer details');
    assert.equal(firstStudentReport.focusViolationCount, 1,
      'a fullscreen exit is recorded once and included in the submitted report');
    assert.equal(firstReport.focusViolationCount, 1,
      'the administrator report contains the same persisted fullscreen violation count');
    await student.screenshot({ path: `/tmp/shsat-two-section-report-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the submitted SHSAT report fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-two-section-report-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, [], 'the section transitions and reports have no browser errors');

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['student starts from the SHSAT workspace', 'brief/sustained hidden-page events follow focus-warning rules; the violation count persists through section transition into both reports',
        'an interrupted answer survives refresh, fits desktop/mobile, saves after recovery, and resumes on a second device',
        'ELA then Math order and section submit transition', 'Math then ELA order and section submit transition',
        'rapidly clicking the starting section creates a single attempt',
        'admin scores and counts match both section attempts', 'student score/answer visibility follows exam policy',
        'desktop and 390px report layout'],
      attemptIds: [first.attemptId, second.attemptId], mobileSize, pageErrors: pageErrors.length,
      screenshots: [...first.recoveryScreenshots, violationReportDesktop, violationReportMobile,
        `/tmp/shsat-two-section-report-${stamp}.png`, `/tmp/shsat-two-section-report-mobile-${stamp}.png`],
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (classId && userId) await api(admin, `/api/admin/classes/${classId}/students/${userId}`, 'DELETE').catch(() => {});
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    if (paperId) await api(admin, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
    await studentContext.close();
    await adminContext.close();
    await browser.close();
  }
}

function makePart(code, title, sortOrder, subtypeCode, displayNumber, answer, scoringCode) {
  return {
    sectionCode: code, sectionKind: 'PART', title, sortOrder, instructions: null, settings: {}, questions: [],
    children: [{
      sectionCode: subtypeCode, sectionKind: 'SUBTYPE', title: 'Practice Questions', sortOrder: 0,
      instructions: null, settings: {}, children: [],
      questions: [{
        questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
        stem: `Select the correct ${code === 'ELA' ? 'language' : 'math'} answer.`,
        render: {
          options: [{ key: 'A', text: 'Option A' }, { key: 'B', text: 'Option B' }],
          questionConfig: { shsatSkillTag: { skillCode: code === 'ELA' ? 'ELA_REVISING_CLARITY' : 'MATH_ARITHMETIC_NUMBER_PROPERTIES', domainCode: code === 'ELA' ? 'ELA_REVISING_EDITING' : 'MATH_ARITHMETIC', subjectCode: code } },
          validationRules: {},
        },
        answerKey: { answers: [answer] }, grading: {}, explanation: `${answer} is correct.`, categoryId: null,
        sortOrder: 0, displayNumber, maxPoints: 1, scoringSectionCode: scoringCode,
      }],
    }],
  };
}

async function runAttempt(student, examId, firstSection, answers, username, password) {
  const recoveryScreenshots = [];
  await student.goto(`${baseUrl}/student/systems/SHSAT`);
  const card = student.locator('.student-exam-list article.paper-row').filter({ hasText: 'Two Section Check' });
  await card.getByRole('button', { name: /Start exam|Retake exam/ }).click();
  await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
  await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
  await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
  const startRequests = [];
  const trackStartRequest = request => {
    if (request.url().endsWith(`/api/student/exams/${examId}/attempts`) && request.method() === 'POST') {
      startRequests.push(request);
    }
  };
  student.on('request', trackStartRequest);
  const startRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
    && response.request().method() === 'POST');
  await student.getByRole('button', { name: firstSection === 'ELA' ? /ELA/ : /Math/ })
    .evaluate(button => { button.click(); button.click(); });
  const startResponse = await startRequest;
  await student.waitForTimeout(100);
  student.off('request', trackStartRequest);
  assert.equal(startResponse.status(), 200, 'the selected exam section starts successfully');
  assert.equal(startRequests.length, 1, 'a rapid double click creates only one attempt');
  const startedAttempt = await startResponse.json();
  await student.locator('.exam-transition-page .exam-transition-card__button').click();
  try {
    await student.locator('.question-number').waitFor({ timeout: 8000 });
  } catch (error) {
    await student.screenshot({ path: `/tmp/shsat-two-section-start-failure-${Date.now()}.png`, fullPage: true });
    throw new Error(`Attempt did not open a question. URL: ${student.url()} Body: ${(await student.locator('body').innerText()).slice(0, 1200)}; start response: ${JSON.stringify(startedAttempt)}; ${error.message}`);
  }
  const attemptId = Number(startedAttempt.id || startedAttempt.attemptId);
  assert.ok(attemptId > 0, 'starting the selected section creates a student attempt');

  if (firstSection === 'ELA') {
    await installVisibilityStateMock(student);
    await student.evaluate(() => window.__dispatchVisibilityChange('hidden'));
    await student.waitForTimeout(150);
    await student.evaluate(() => window.__dispatchVisibilityChange('visible'));
    await student.waitForTimeout(1_300);
    assert.equal(await student.locator('.focus-violation-modal').count(), 0,
      'a brief hidden/visible transition does not create a focus violation');

    const violationRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/focus-violations`)
      && response.request().method() === 'POST');
    await student.evaluate(() => window.__dispatchVisibilityChange('hidden'));
    const violationResponse = await violationRequest;
    assert.equal(violationResponse.status(), 200, 'a sustained hidden page records the focus violation');
    await student.evaluate(() => window.__dispatchVisibilityChange('visible'));
    await student.locator('.focus-violation-modal').waitFor();
    assert.match(await student.locator('.focus-violation-modal').innerText(), /This is the 1 time/i,
      'returning to the page shows the first violation warning');
    await student.getByRole('button', { name: 'OK, Continue', exact: true }).click();
    await student.locator('.focus-violation-modal').waitFor({ state: 'detached' });
    await student.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 3000 });
  }

  const firstStem = firstSection === 'ELA' ? 'Select the correct language answer.' : 'Select the correct math answer.';
  await answerCurrentQuestion(student, firstStem, answers[firstSection]);
  if (firstSection === 'ELA') {
    let failAnswerSave = true;
    const interruptAnswerSave = async route => {
      if (failAnswerSave && route.request().method() === 'PUT') {
        failAnswerSave = false;
        await route.abort('internetdisconnected');
        return;
      }
      await route.continue();
    };
    await student.route(`**/api/student/attempts/${attemptId}/answers/**`, interruptAnswerSave);
    const failedAnswerSave = student.waitForEvent('requestfailed', request =>
      request.url().includes(`/api/student/attempts/${attemptId}/answers/`));
    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
    await failedAnswerSave;
    await student.locator('.student-exam__alert--error').getByText(/Failed to save Question 1/).waitFor();
    assert.equal(await student.locator('.choice-answer__option input:checked').count(), 1,
      'the answer remains visible locally while the student is offline');
    await student.unroute(`**/api/student/attempts/${attemptId}/answers/**`, interruptAnswerSave);
    await student.reload();
    await installFullscreenMock(student);
    await student.getByRole('button', { name: 'Enter Fullscreen', exact: true }).click();
    await continueExamDirections(student);
    await student.locator('.question-number').filter({ hasText: 'Question 1' }).waitFor();
    assert.equal(await student.locator('.choice-answer__option input:checked').count(), 1,
      'the unsaved answer is restored after refreshing the page');
    const recoveredAnswerDesktop = `/tmp/shsat-offline-answer-restored-${Date.now()}.png`;
    recoveryScreenshots.push(recoveredAnswerDesktop);
    await student.screenshot({ path: recoveredAnswerDesktop });
    await student.setViewportSize({ width: 390, height: 844 });
    const recoveredAnswerMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(recoveredAnswerMobileSize.page <= recoveredAnswerMobileSize.viewport,
      'the restored active exam fits a 390px viewport');
    const recoveredAnswerMobile = `/tmp/shsat-offline-answer-restored-mobile-${Date.now()}.png`;
    recoveryScreenshots.push(recoveredAnswerMobile);
    await student.screenshot({ path: recoveredAnswerMobile });
    await student.setViewportSize({ width: 1440, height: 900 });
    const retriedAnswerSave = student.waitForResponse(response => response.url().includes(`/api/student/attempts/${attemptId}/answers/`)
      && response.request().method() === 'PUT');
    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
    assert.equal((await retriedAnswerSave).status(), 200,
      'resubmitting the section after reconnecting persists the locally retained answer');
    await verifyCrossDeviceResume(student, examId, username, password);
  }
  if (firstSection !== 'ELA') {
    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
  }
  await student.getByRole('dialog').getByRole('button', { name: 'Submit Section', exact: true }).click();
  await student.waitForFunction(() => document.querySelector('.exam-transition-card__button'));
  await student.waitForTimeout(1_200);
  await student.locator('.exam-transition-card__button').click();
  const secondCode = firstSection === 'ELA' ? 'MATH' : 'ELA';
  await student.locator('.question-number').waitFor();
  const secondStem = secondCode === 'ELA' ? 'Select the correct language answer.' : 'Select the correct math answer.';
  await answerCurrentQuestion(student, secondStem, answers[secondCode]);
  await student.getByRole('button', { name: 'Submit Exam', exact: true }).click();
  await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
  await student.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);
  await student.getByText('Result Summary', { exact: true }).waitFor();
  return { attemptId, recoveryScreenshots };
}

// 新浏览器上下文代表另一设备；只验证服务端已保存答案可以跨会话恢复。
async function verifyCrossDeviceResume(student, examId, username, password) {
  const deviceContext = await student.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const device = await deviceContext.newPage();
  try {
    await login(device, username, password);
    await installFullscreenMock(device);
    await device.goto(`${baseUrl}/student/systems/SHSAT`);
    const activeExam = device.locator('.student-exam-list article.paper-row').filter({ hasText: 'Two Section Check' });
    await activeExam.getByRole('button', { name: /Continue/ }).click();
    await device.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await device.locator('.fullscreen-required-overlay').waitFor();
    await device.getByRole('button', { name: 'Enter Fullscreen', exact: true }).click();
    await device.locator('.fullscreen-required-overlay').waitFor({ state: 'detached' });
    await continueExamDirections(device);
    await device.locator('.question-number').filter({ hasText: 'Question 1' }).waitFor({ timeout: 6000 }).catch(async error => {
      await device.screenshot({ path: `/tmp/shsat-cross-device-resume-failure-${Date.now()}.png`, fullPage: true });
      throw new Error(`Cross-device resume did not reach Question 1. URL: ${device.url()} Body: ${(await device.locator('body').innerText()).slice(0, 1000)}; ${error.message}`);
    });
    assert.equal(await device.locator('.choice-answer__option input:checked').count(), 1,
      'a second browser context restores the answer saved on the first device');
  } finally {
    await deviceContext.close();
  }
}

async function answerCurrentQuestion(page, stem, optionKey) {
  await page.getByText(stem, { exact: true }).waitFor();
  const optionIndex = optionKey === 'A' ? 0 : 1;
  await page.locator('.choice-answer__option').nth(optionIndex).click();
  await page.locator('.choice-answer__option input:checked').waitFor({ state: 'attached' });
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
    window.__isExamFullscreen = () => Boolean(activeElement);
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

async function installVisibilityStateMock(page) {
  await page.evaluate(() => {
    let visibilityState = document.visibilityState;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilityState });
    window.__dispatchVisibilityChange = state => {
      visibilityState = state;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
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
