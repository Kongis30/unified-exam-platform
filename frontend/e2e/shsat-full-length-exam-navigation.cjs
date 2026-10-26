const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const firstSection = process.env.E2E_START_SECTION || 'ELA';
if (!['ELA', 'Math'].includes(firstSection)) throw new Error('E2E_START_SECTION must be ELA or Math.');
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
  const username = `shsat_full_length_${stamp}`;
  const password = `FullLength${stamp}!`;
  const title = `SHSAT 100 Question Check ${stamp}`;
  let userId;
  let classId;
  let examId;
  let attemptId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: 'SHSAT Full Length Check', roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `SHSAT Full Length ${stamp}`, description: 'Temporary full length navigation check', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });
    const papers = await api(admin, '/api/admin/exam-types/SHSAT/papers');
    const paper = papers.find(item => Number(item.id) === 244 && item.status === 'READY');
    assert.ok(paper, 'the 100-question SHSAT reference paper is available');

    const release = await api(admin, `/api/admin/papers/${paper.id}/exams`, 'POST', {
      title, description: 'Temporary full length SHSAT navigation and report check',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      durationSeconds: 10_800, attemptLimit: 1, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    await installFullscreenMock(student);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const studentExams = unwrap(await api(student, '/api/student/exams'));
    assert.ok(studentExams.some(item => Number(item.examId || item.id) === examId),
      `the eligible student's exam API contains the published exam; returned: ${JSON.stringify(studentExams).slice(0, 1200)}`);
    const card = student.locator('.student-exam-list article.paper-row').filter({ hasText: title });
    await card.getByRole('button', { name: /Start exam|Retake exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
    const attemptResponse = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: new RegExp(firstSection) }).click();
    const createdAttempt = await (await attemptResponse).json();
    attemptId = Number(createdAttempt.id || createdAttempt.attemptId);
    assert.ok(attemptId > 0, 'starting the released exam creates one attempt');
    await student.locator('.exam-transition-page .exam-transition-card__button').click();
    const firstRange = sectionRange(firstSection);
    const secondSection = firstSection === 'ELA' ? 'Math' : 'ELA';
    const secondRange = sectionRange(secondSection);
    await expectQuestion(student, firstRange.start);
    await advanceQuestions(student, firstRange.start, firstRange.end);

    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.waitForFunction(() => document.querySelector('.exam-transition-card__button'));
    await student.locator('.exam-transition-card__button').click();
    await expectQuestion(student, secondRange.start);
    await advanceQuestions(student, secondRange.start, secondRange.end);

    await student.getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();
    const report = await api(student, `/api/student/attempts/${attemptId}/report`);
    const adminReport = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    assert.equal(report.questions.length, 100, 'the final report contains all 100 questions');
    assert.equal(report.totalMaxScore, 100, 'the final report uses the 100-point raw total');
    assert.equal(report.elaRawMaxScore, 50, 'ELA raw score is out of 50');
    assert.equal(report.mathRawMaxScore, 50, 'Math raw score is out of 50');
    assert.equal(report.unansweredCount, 0, 'all 100 questions have saved answers');
    assert.equal(report.scoreVisible, true, 'score is visible after submission');
    assert.equal(adminReport.questions.length, 100, 'administrator report returns the same 100 questions');
    assert.equal(adminReport.unansweredCount, 0, 'administrator report agrees that no question is unanswered');
    assert.equal(adminReport.correctCount + adminReport.wrongCount, 100,
      'administrator correct and wrong totals account for every answered question');

    await student.screenshot({ path: `/tmp/shsat-full-length-report-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the 100-question report fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-full-length-report-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, [], 'the complete two-section workflow has no browser errors');
    console.log(JSON.stringify({
      result: 'PASS',
      checks: [`100-question UI navigation starting with ${firstSection}`, `${firstSection} submit and ${secondSection} transition`,
        `${secondSection} submit and final report`,
        '100 question results and 50/50 section maxima', 'student/admin report answer counts reconcile', '390px report layout'],
      firstSection, attemptId, correctCount: adminReport.correctCount, wrongCount: adminReport.wrongCount, mobileSize,
      pageErrors: pageErrors.length,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (classId && userId) await api(admin, `/api/admin/classes/${classId}/students/${userId}`, 'DELETE').catch(() => {});
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    await studentContext.close();
    await adminContext.close();
    await browser.close();
  }
}

function sectionRange(section) {
  return section === 'ELA' ? { start: 1, end: 50 } : { start: 51, end: 100 };
}

async function advanceQuestions(page, firstQuestion, lastQuestion) {
  for (let questionNumber = firstQuestion; questionNumber < lastQuestion; questionNumber += 1) {
    await answerCurrentQuestion(page);
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await page.waitForFunction(() => document.querySelector('button[aria-label="Next"]')?.disabled === false);
    assert.equal(await next.isEnabled(), true, `Next is enabled on question ${questionNumber}`);
    await next.click();
    await expectQuestion(page, questionNumber + 1);
  }
  await answerCurrentQuestion(page);
}

async function answerCurrentQuestion(page) {
  const draggableChoices = page.locator('.drag-answer__choice');
  const dropTargets = page.locator('.drag-answer__target');
  if (await draggableChoices.count() && await dropTargets.count()) {
    const choiceCount = await draggableChoices.count();
    const targetCount = await dropTargets.count();
    const questionText = await page.locator('.exam-question-shell').innerText();
    const placementsNeeded = targetCount === 1 && /move the correct answer/i.test(questionText) ? 1 : choiceCount;
    for (let index = 0; index < placementsNeeded; index += 1) {
      const choice = page.locator('.drag-answer__choice').first();
      const target = dropTargets.nth(index % targetCount);
      await choice.dragTo(target);
      if ((await target.innerText()).includes('Drop choice here')) {
        await page.screenshot({ path: `/tmp/shsat-full-length-drag-failure-${Date.now()}.png` });
        throw new Error(`Dragging the choice did not place it in the target: ${await target.innerText()}`);
      }
    }
    return;
  }

  const inlineGaps = page.locator('.drag-answer__gap');
  if (await draggableChoices.count() && await inlineGaps.count()) {
    await draggableChoices.first().dragTo(inlineGaps.first());
    return;
  }

  const choices = page.locator('.choice-answer__option');
  if (await choices.count()) {
    const prompt = await page.locator('body').innerText();
    const requiredAnswers = Number(prompt.match(/Select exactly (\d+) answers/i)?.[1] || 1);
    for (let index = 0; index < Math.min(requiredAnswers, await choices.count()); index += 1) {
      await choices.nth(index).click();
    }
    return;
  }

  const hotTextSegments = page.locator('.hot-text-answer__segment');
  if (await hotTextSegments.count()) {
    await hotTextSegments.first().click();
    return;
  }

  const tableGrid = page.locator('.table-grid-answer');
  if (await tableGrid.count()) {
    const textCells = tableGrid.locator('.table-grid-answer__text-input');
    if (await textCells.count()) {
      for (const cell of await textCells.all()) await cell.fill('1');
      return;
    }
    for (const row of await tableGrid.locator('tbody tr').all()) {
      await row.locator('label.table-grid-answer__choice').first().click();
    }
    return;
  }

  const fillBlank = page.locator('.fill-blank-input').first();
  if (await fillBlank.count()) {
    await fillBlank.fill('1');
    return;
  }

  const selects = page.locator('.inline-choice-answer select');
  if (await selects.count()) {
    for (const select of await selects.all()) {
      const values = await select.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      if (values.length) await select.selectOption(values[0]);
    }
    return;
  }

  const richSelects = page.locator('.inline-choice-answer .rich-select__trigger');
  if (await richSelects.count()) {
    const count = await richSelects.count();
    for (let index = 0; index < count; index += 1) {
      await richSelects.nth(index).click();
      await page.getByRole('option').first().click();
    }
    return;
  }

  const mathField = page.locator('.equation-answer__math-field');
  if (await mathField.count()) {
    await mathField.evaluate(element => {
      element.value = '1';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return;
  }

  const solutionRay = page.locator('.solution-answer__ray-button');
  if (await solutionRay.count()) {
    await solutionRay.first().click();
    await page.locator('.solution-line__tick').first().click();
    return;
  }

  throw new Error(`No generic answer control found for ${await page.locator('.section-name').textContent()}: ${await page.locator('body').innerText().then(text => text.slice(-500))}`);
}

async function expectQuestion(page, questionNumber) {
  try {
    await page.waitForFunction(expected =>
      document.querySelector('.question-number')?.textContent.trim() === `Question ${expected}`, questionNumber, { timeout: 6000 });
  } catch (error) {
    const currentQuestion = await page.locator('.question-number').textContent().catch(() => 'missing');
    const visibleText = (await page.locator('body').innerText()).slice(-1000);
    throw new Error(`Expected Question ${questionNumber}, current is ${currentQuestion}; ${visibleText}; ${error.message}`);
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

async function login(page, loginUsername, loginPassword) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(loginUsername);
  await page.getByLabel('Password').fill(loginPassword);
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

function unwrap(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.records || data?.list || data?.content || [];
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
