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
  const username = `shsat_complete_${stamp}`;
  const password = `Complete${stamp}!`;
  const title = `Completion Check ${suffix}`;
  let userId;
  let classId;
  let paperId;
  let examId;
  let taskId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Completion Student ${suffix}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Completion ${suffix}`, description: 'Temporary real review completion verification', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const paper = await api(admin, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `REVIEW_COMPLETE_${stamp}`, title, description: 'One-question review completion test',
      groupId: null, defaultDurationSeconds: 600,
    });
    paperId = Number(paper.summary.id);
    await api(admin, `/api/admin/papers/${paperId}/structure`, 'PUT', {
      sections: [{
        sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0,
        instructions: null, settings: {},
        questions: [],
        children: [{
          sectionCode: 'ELA_REVIEW', sectionKind: 'SUBTYPE', title: 'Reading and Writing', sortOrder: 0,
          instructions: null, settings: {},
          questions: [{
            questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
            stem: 'Which choice is correct?',
            render: {
              options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Incorrect answer' }],
              questionConfig: { shsatSkillTag: { skillCode: 'ELA_REVISING_CLARITY', domainCode: 'ELA_REVISING_EDITING', subjectCode: 'ELA' } },
              validationRules: {},
            },
            answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is the correct answer.',
            categoryId: null, sortOrder: 0, displayNumber: 1, maxPoints: 1, scoringSectionCode: 'ELA',
          }],
          children: [],
        }],
      }],
    });
    await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');

    const exam = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary review completion flow',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(), durationSeconds: 600,
      attemptLimit: 1, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(exam.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    const sourceAttempt = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    const sourceItem = sourceAttempt.items?.[0] || sourceAttempt.questions?.[0];
    assert.ok(sourceItem, 'the one-question paper is included in the source attempt');
    const paperItemId = Number(sourceItem.paperItemId || sourceItem.id);
    await api(student, `/api/student/attempts/${sourceAttempt.id}/answers/${paperItemId}`, 'PUT', {
      answer: { value: 'B' }, timeSpentSeconds: 5,
    });
    await api(student, `/api/student/attempts/${sourceAttempt.id}/submit`, 'POST');

    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60_000);
    const formatLocal = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
    const task = await api(admin, '/api/admin/wrong-answer-tasks', 'POST', {
      examId, classId, title: `Review ${suffix}`, description: 'Clear the incorrect answer.',
      startAt: formatLocal(new Date(now.getTime() - 60_000)), endAt: formatLocal(end),
    });
    taskId = Number(task.taskId);
    const taskDetail = await api(admin, `/api/admin/wrong-answer-tasks/${taskId}`);
    assert.equal(taskDetail.assignments.length, 1);
    assert.equal(taskDetail.assignments[0].totalQuestions, 1, 'only the incorrect question is assigned');
    assert.equal(taskDetail.assignments[0].status, 'NOT_STARTED');

    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const taskCard = student.locator('.student-review-list article.paper-row').filter({ hasText: `Review ${suffix}` });
    await installFullscreenMock(student);
    await taskCard.getByRole('button', { name: 'Start review' }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}` && url.searchParams.has('practiceAttemptId'));
    const practiceAttemptId = Number(new URL(student.url()).searchParams.get('practiceAttemptId'));
    const fullscreenOverlay = student.locator('.fullscreen-required-overlay');
    await fullscreenOverlay.waitFor({ state: 'visible' });
    await fullscreenOverlay.locator('.fullscreen-required-dialog__button').click();
    await fullscreenOverlay.waitFor({ state: 'detached' });
    await continueExamDirections(student);
    const practiceAttempt = await api(student, `/api/student/attempts/${practiceAttemptId}`);
    const practiceItem = practiceAttempt.items?.[0] || practiceAttempt.questions?.[0];
    assert.ok(practiceItem, 'the review attempt contains its assigned question');

    await student.locator('.choice-answer__option').first().click();
    await student.locator('.choice-answer__option input:checked').waitFor({ state: 'attached' });
    assert.equal(await student.locator('.choice-answer__option input:checked').count(), 1,
      'the student selected the correct choice');
    await student.getByRole('button', { name: /Submit Exam|Submit/ }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${practiceAttemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();

    const completed = await api(student, '/api/student/wrong-answer-tasks')
      .then(rows => rows.find(row => row.assignmentId === taskDetail.assignments[0].assignmentId));
    assert.equal(completed.status, 'COMPLETED', 'answering the assigned question correctly completes the real assignment');
    assert.equal(completed.clearedQuestionCount, 1);
    assert.equal(completed.remainingQuestionCount, 0);
    const completedDetail = await api(admin, `/api/admin/wrong-answer-tasks/${taskId}`);
    assert.equal(completedDetail.assignments[0].status, 'COMPLETED');
    assert.equal(completedDetail.assignments[0].clearedQuestionCount, 1);
    assert.equal(completedDetail.assignments[0].practiceAttemptId, practiceAttemptId);

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await admin.getByRole('tab', { name: 'Review Assignments', exact: true }).click();
    const taskRow = admin.locator('.wrong-task-table tbody tr').filter({ hasText: `Review ${suffix}` });
    await taskRow.getByRole('button', { name: `Actions for Review ${suffix}` }).click();
    await admin.getByRole('menuitem', { name: 'View Progress', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/wrong-answer-tasks/${taskId}`));
    const progressRow = admin.locator('.task-table tbody tr').filter({ hasText: `Completion Student ${suffix}` });
    await progressRow.getByText('Completed', { exact: true }).waitFor();
    await progressRow.getByRole('button', { name: 'View Report', exact: true }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-review-completion-admin-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    await progressRow.scrollIntoViewIfNeeded();
    const adminMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(adminMobileSize.page <= adminMobileSize.viewport, 'completed assignment progress fits a 390px viewport');
    await admin.screenshot({ path: `/tmp/shsat-review-completion-admin-mobile-${stamp}.png` });

    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByRole('tab', { name: /Review Task History/ }).click();
    const historyRow = student.locator('.shsat-history-row').filter({ hasText: `Review ${suffix}` });
    await historyRow.getByText('1 / 1 questions cleared').waitFor();
    await student.screenshot({ path: `/tmp/shsat-review-completion-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    await student.evaluate(() => window.scrollTo(0, 0));
    await historyRow.scrollIntoViewIfNeeded();
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'completed review history fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-review-completion-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, [], 'the real completion flow has no browser errors');

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['temporary paper creation and seal', 'student submits an incorrect formal answer', 'review task snapshots that question', 'student starts review and submits the correct answer', 'real backend marks assignment COMPLETED', 'admin progress page reports completion and links the report', 'student history reports 1/1 questions cleared', 'desktop and 390px layout for both roles'],
      examId, taskId, practiceAttemptId, mobileSize, adminMobileSize, pageErrors: pageErrors.length,
      screenshots: [`/tmp/shsat-review-completion-admin-${stamp}.png`, `/tmp/shsat-review-completion-admin-mobile-${stamp}.png`, `/tmp/shsat-review-completion-${stamp}.png`, `/tmp/shsat-review-completion-mobile-${stamp}.png`],
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
    const continueButton = page.locator('.exam-transition-card__button');
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click();
      continue;
    }
    if (await page.locator('.question-number').isVisible().catch(() => false)) return;
    break;
  }
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
