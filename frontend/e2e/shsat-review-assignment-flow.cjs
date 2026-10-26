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
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const errors = [];
  [admin, student].forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const stamp = Date.now();
  const displayStamp = String(stamp).slice(-6);
  const username = `shsat_review_${stamp}`;
  const password = `Review${stamp}!`;
  const className = `Review Check ${displayStamp}`;
  const examTitle = `SHSAT Review ${displayStamp}`;
  const taskTitle = `Assigned Review ${displayStamp}`;
  let userId;
  let classId;
  let examId;
  let taskId;
  let attemptId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Review Student ${displayStamp}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: className, description: 'Temporary review assignment verification', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const sourcePaperId = 247;
    const createdExam = await api(admin, `/api/admin/papers/${sourcePaperId}/exams`, 'POST', {
      title: examTitle,
      description: 'Temporary source attempt for review assignment verification',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    examId = Number(createdExam.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    const attempt = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    attemptId = Number(attempt.id);
    const submittedAttempt = await api(student, `/api/student/attempts/${attemptId}/submit`, 'POST');
    assert.ok(['SUBMITTED', 'COMPLETED'].includes(submittedAttempt.status), 'the student source attempt is submitted');

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await admin.getByRole('tab', { name: 'Review Assignments', exact: true }).click();
    await admin.getByRole('button', { name: 'Create Assignment', exact: true }).click();
    const modal = admin.locator('.wrong-task-modal');
    await modal.waitFor();
    await modal.getByLabel('Exam').click();
    await modal.getByRole('option', { name: new RegExp(examTitle) }).click();
    await modal.getByLabel('Class').selectOption(String(classId));
    await modal.getByLabel('Assignment Title').fill(taskTitle);
    await modal.getByLabel('Description (optional)').fill('Review incorrect and unanswered questions.');

    const startAt = modal.getByRole('textbox', { name: 'Start time' });
    const endAt = modal.getByRole('textbox', { name: 'End time' });
    const { startValue, endValue } = await admin.evaluate(() => {
      const format = date => {
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      };
      return {
        startValue: format(new Date(Date.now() - 60_000)),
        endValue: format(new Date(Date.now() + 60 * 60_000)),
      };
    });
    await startAt.fill(startValue);
    await endAt.fill(startValue);
    await modal.getByRole('button', { name: 'Create Assignment', exact: true }).click();
    await modal.getByText('The end time must be later than the start time.', { exact: true }).waitFor();
    await endAt.fill(endValue);
    await modal.getByText('The end time must be later than the start time.', { exact: true }).waitFor({ state: 'detached' });

    await admin.screenshot({ path: `/tmp/shsat-review-assignment-create-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.waitForTimeout(250);
    const mobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the assignment form fits a 390px viewport');
    await admin.screenshot({ path: `/tmp/shsat-review-assignment-create-mobile-${stamp}.png` });
    const modalScroll = await modal.evaluate(element => ({ height: element.clientHeight, contentHeight: element.scrollHeight }));
    if (modalScroll.contentHeight > modalScroll.height) {
      await modal.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await modal.getByRole('button', { name: 'Create Assignment', exact: true }).scrollIntoViewIfNeeded();
      const footerBounds = await modal.getByRole('button', { name: 'Create Assignment', exact: true }).boundingBox();
      assert.ok(footerBounds && footerBounds.y + footerBounds.height <= 844, 'the mobile modal footer can be scrolled into view');
      await admin.screenshot({ path: `/tmp/shsat-review-assignment-create-mobile-footer-${stamp}.png` });
      await modal.evaluate(element => { element.scrollTop = 0; });
    }
    await admin.setViewportSize({ width: 1440, height: 1000 });

    await modal.getByRole('button', { name: 'Create Assignment', exact: true }).click();
    await modal.waitFor({ state: 'detached' });
    const assignments = await api(admin, '/api/admin/wrong-answer-tasks');
    const createdTask = assignments.find(task => task.title === taskTitle);
    assert.ok(createdTask, 'the assignment is persisted');
    taskId = Number(createdTask.taskId);
    assert.equal(createdTask.examId, examId);
    assert.equal(createdTask.classId, classId);
    assert.equal(createdTask.assignedCount, 1);
    assert.equal(createdTask.eligibleCount, 1);
    assert.equal(createdTask.noSourceAttemptCount, 0);
    assert.equal(createdTask.noWrongAnswerCount, 0);
    assert.equal(createdTask.notStartedCount, 1);
    assert.equal(createdTask.startAt.slice(0, 16), startValue, 'the task start time is stored without a timezone shift');
    assert.equal(createdTask.endAt.slice(0, 16), endValue, 'the task end time is stored without a timezone shift');

    const details = await api(admin, `/api/admin/wrong-answer-tasks/${taskId}`);
    assert.equal(details.assignments.length, 1);
    assert.equal(details.assignments[0].sourceAttemptId, attemptId);
    assert.ok(details.assignments[0].totalQuestions > 0, 'unanswered source questions are assigned for review');

    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const studentTasks = await api(student, '/api/student/wrong-answer-tasks');
    const studentTask = studentTasks.find(item => item.assignmentId === details.assignments[0].assignmentId);
    assert.ok(studentTask, 'the student receives the assignment');
    assert.equal(studentTask.canStart, true, 'the task is available inside its configured time window');
    assert.equal(studentTask.startAt.slice(0, 16), startValue);
    assert.equal(studentTask.endAt.slice(0, 16), endValue);
    const taskCard = student.locator('.student-review-list article.paper-row').filter({ hasText: taskTitle });
    await taskCard.waitFor();
    const startReview = taskCard.getByRole('button', { name: 'Start review' });
    await startReview.waitFor();
    assert.equal(await startReview.isEnabled(), true, 'the student can start the available task');
    await student.screenshot({ path: `/tmp/shsat-review-assignment-student-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    await student.waitForTimeout(250);
    const studentMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(studentMobileSize.page <= studentMobileSize.viewport, 'the student task card fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-review-assignment-student-mobile-${stamp}.png` });
    await startReview.click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}` && Boolean(url.searchParams.get('practiceAttemptId')));
    const practiceAttemptId = Number(new URL(student.url()).searchParams.get('practiceAttemptId'));
    const taskAfterStart = await api(admin, `/api/admin/wrong-answer-tasks/${taskId}`);
    assert.equal(taskAfterStart.assignments[0].status, 'IN_PROGRESS');
    assert.equal(taskAfterStart.assignments[0].practiceAttemptId, practiceAttemptId);

    await admin.getByRole('tab', { name: 'Review Assignments', exact: true }).click();
    let row = admin.locator('.wrong-task-table tbody tr').filter({ hasText: taskTitle });
    await row.waitFor();
    await row.getByRole('button', { name: `Actions for ${taskTitle}` }).click();
    await admin.getByRole('menuitem', { name: 'View Progress', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/wrong-answer-tasks/${taskId}`));
    await admin.getByRole('heading', { name: taskTitle, exact: true }).waitFor();
    const progressRow = admin.locator('.task-table tbody tr').filter({ hasText: `Review Student ${displayStamp}` });
    await progressRow.waitFor();
    await progressRow.getByText('In Progress', { exact: true }).waitFor();
    await progressRow.getByRole('button', { name: 'View Report', exact: true }).click();
    await admin.waitForURL(url => url.pathname === `/student/attempts/${practiceAttemptId}/report`);
    await admin.getByText('Result Summary', { exact: true }).waitFor();
    assert.equal(await admin.locator('.attempt-report__state--error').count(), 0,
      'View Report opens the assigned student attempt report');
    await admin.screenshot({ path: `/tmp/shsat-review-assignment-report-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.evaluate(() => window.scrollTo(0, 0));
    await admin.waitForTimeout(250);
    assert.equal(await admin.locator('.admin-layout__header').count(), 1,
      'the mobile report has a single platform navigation header');
    const reportMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(reportMobileSize.page <= reportMobileSize.viewport, 'the assigned attempt report fits a 390px viewport');
    await admin.screenshot({ path: `/tmp/shsat-review-assignment-report-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.getByRole('button', { name: 'Back to Review Assignment', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/wrong-answer-tasks/${taskId}`));
    await admin.locator('.task-table tbody tr').filter({ hasText: `Review Student ${displayStamp}` })
      .getByText('In Progress', { exact: true }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-review-assignment-progress-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.waitForTimeout(250);
    const progressMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(progressMobileSize.page <= progressMobileSize.viewport, 'the progress page fits a 390px viewport');
    await admin.screenshot({ path: `/tmp/shsat-review-assignment-progress-mobile-${stamp}.png` });
    await progressRow.scrollIntoViewIfNeeded();
    const progressRowBounds = await progressRow.boundingBox();
    assert.ok(progressRowBounds && progressRowBounds.y >= 0 && progressRowBounds.y + progressRowBounds.height <= 844,
      'the student progress row fits within the mobile viewport when brought into view');
    await admin.screenshot({ path: `/tmp/shsat-review-assignment-progress-row-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.getByRole('button', { name: 'Back to Review Assignments', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith('/exam-types/SHSAT/admin') && url.searchParams.get('tab') === 'wrong-answer-tasks');
    row = admin.locator('.wrong-task-table tbody tr').filter({ hasText: taskTitle });
    await row.waitFor();
    await row.getByRole('button', { name: `Actions for ${taskTitle}` }).click();
    const canceledEnd = admin.waitForEvent('dialog').then(dialog => dialog.dismiss());
    await admin.getByRole('menuitem', { name: 'End', exact: true }).click();
    await canceledEnd;
    const stillActive = await api(admin, '/api/admin/wrong-answer-tasks').then(rows => rows.find(item => item.taskId === taskId));
    assert.equal(stillActive.status, 'PUBLISHED', 'cancel leaves the assignment published');
    await row.getByRole('button', { name: `Actions for ${taskTitle}` }).click();
    const acceptedEnd = admin.waitForEvent('dialog').then(dialog => {
      assert.match(dialog.message(), new RegExp(`End \\"${taskTitle}\\"`));
      return dialog.accept();
    });
    await admin.getByRole('menuitem', { name: 'End', exact: true }).click();
    await acceptedEnd;
    const ended = await api(admin, '/api/admin/wrong-answer-tasks').then(rows => rows.find(item => item.taskId === taskId));
    assert.equal(ended.status, 'ENDED');
    const endedDetails = await api(admin, `/api/admin/wrong-answer-tasks/${taskId}`);
    assert.equal(endedDetails.assignments[0].status, 'IN_PROGRESS', 'ending a task keeps an in-progress student attempt intact');
    const studentTaskAfterEnd = await api(student, '/api/student/wrong-answer-tasks')
      .then(rows => rows.find(item => item.assignmentId === details.assignments[0].assignmentId));
    assert.equal(studentTaskAfterEnd.status, 'IN_PROGRESS');
    assert.equal(studentTaskAfterEnd.canStart, true, 'a student can continue an existing attempt after the task is ended');
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const continueReview = student.locator('.student-review-list article.paper-row').filter({ hasText: taskTitle });
    await continueReview.getByRole('button', { name: 'Continue' }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}` && Number(url.searchParams.get('practiceAttemptId')) === practiceAttemptId);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['student submitted source attempt', 'assignment validation and creation', 'eligible question snapshot', 'student start and progress state', 'admin progress detail and return context', 'View Report opens and returns from the in-progress report', 'mobile progress row is visible and readable', 'end cancel and in-progress preservation', 'student can continue after administrator ends assignment'],
      assignedQuestions: details.assignments[0].totalQuestions,
      mobileSize,
      modalScroll,
      studentMobileSize,
      progressMobileSize,
      reportMobileSize,
      pageErrors: errors.length,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
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
