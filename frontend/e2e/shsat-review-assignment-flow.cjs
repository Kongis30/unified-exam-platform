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
  const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const teacher = await teacherContext.newPage();
  const errors = [];
  [admin, student, teacher].forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const stamp = Date.now();
  const displayStamp = String(stamp).slice(-6);
  const username = `shsat_review_${stamp}`;
  const password = `Review${stamp}!`;
  const teacherUsername = `shsat_review_teacher_${stamp}`;
  const teacherPassword = `Teacher${stamp}!`;
  const className = `Review Check ${displayStamp}`;
  const examTitle = `SHSAT Review ${displayStamp}`;
  const taskTitle = `Assigned Review ${displayStamp}`;
  const expiredTaskTitle = `Expired Review ${displayStamp}`;
  let userId;
  let teacherId;
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
    const teacherAccount = await api(admin, '/api/admin/users', 'POST', {
      username: teacherUsername, password: teacherPassword, realName: `Review Teacher ${displayStamp}`,
      roleCode: 'TEACHER', email: null, phone: null,
    });
    teacherId = Number(teacherAccount.id);
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

    await login(teacher, teacherUsername, teacherPassword);
    await teacher.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await teacher.getByRole('tab', { name: 'Review Assignments', exact: true }).click();
    assert.equal(await teacher.getByRole('tab', { name: 'Paper Management', exact: true }).count(), 0,
      'teachers can manage review assignments without paper editing access');
    const teacherAccountDirectoryError = await api(teacher, '/api/admin/users').then(() => '', error => error.message);
    assert.match(teacherAccountDirectoryError, /403/, 'teachers cannot access the platform account directory');
    await teacher.getByRole('button', { name: 'Create Assignment', exact: true }).click();
    const modal = teacher.locator('.wrong-task-modal');
    await modal.waitFor();
    await modal.getByLabel('Exam').click();
    await modal.getByRole('option', { name: new RegExp(examTitle) }).click();
    await modal.getByLabel('Class').selectOption(String(classId));
    await modal.getByLabel('Assignment Title').fill(taskTitle);
    await modal.getByLabel('Description (optional)').fill('Review incorrect and unanswered questions.');

    const startAt = modal.getByRole('textbox', { name: 'Start time' });
    const endAt = modal.getByRole('textbox', { name: 'End time' });
    const { startValue, endValue } = await teacher.evaluate(() => {
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

    await teacher.screenshot({ path: `/tmp/shsat-review-assignment-create-${stamp}.png` });
    await teacher.setViewportSize({ width: 390, height: 844 });
    await teacher.waitForTimeout(250);
    const mobileSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the assignment form fits a 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-review-assignment-create-mobile-${stamp}.png` });
    const modalScroll = await modal.evaluate(element => ({ height: element.clientHeight, contentHeight: element.scrollHeight }));
    if (modalScroll.contentHeight > modalScroll.height) {
      await modal.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await modal.getByRole('button', { name: 'Create Assignment', exact: true }).scrollIntoViewIfNeeded();
      const footerBounds = await modal.getByRole('button', { name: 'Create Assignment', exact: true }).boundingBox();
      assert.ok(footerBounds && footerBounds.y + footerBounds.height <= 844, 'the mobile modal footer can be scrolled into view');
      await teacher.screenshot({ path: `/tmp/shsat-review-assignment-create-mobile-footer-${stamp}.png` });
      await modal.evaluate(element => { element.scrollTop = 0; });
    }
    await teacher.setViewportSize({ width: 1440, height: 1000 });

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

    const teacherTaskRow = teacher.locator('.wrong-task-table tbody tr').filter({ hasText: taskTitle });
    await teacherTaskRow.waitFor();
    await teacherTaskRow.getByRole('button', { name: `Actions for ${taskTitle}` }).click();
    await teacher.getByRole('menuitem', { name: 'View Progress', exact: true }).click();
    await teacher.waitForURL(url => url.pathname.endsWith(`/wrong-answer-tasks/${taskId}`));
    await teacher.getByRole('heading', { name: taskTitle, exact: true }).waitFor();
    const teacherProgressRow = teacher.locator('.task-table tbody tr').filter({ hasText: `Review Student ${displayStamp}` });
    await teacherProgressRow.getByText('Not Started', { exact: true }).waitFor();
    await teacher.screenshot({ path: `/tmp/shsat-review-assignment-teacher-progress-${stamp}.png` });
    await teacher.setViewportSize({ width: 390, height: 844 });
    await teacherProgressRow.scrollIntoViewIfNeeded();
    const teacherProgressMobileSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(teacherProgressMobileSize.page <= teacherProgressMobileSize.viewport, 'the teacher progress row fits a 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-review-assignment-teacher-progress-mobile-${stamp}.png` });
    await teacher.setViewportSize({ width: 1440, height: 1000 });
    await teacher.getByRole('button', { name: 'Back to Review Assignments', exact: true }).click();
    await teacher.waitForURL(url => url.pathname.endsWith('/exam-types/SHSAT/admin')
      && url.searchParams.get('tab') === 'wrong-answer-tasks');
    await teacher.getByRole('tab', { name: 'Review Assignments', exact: true }).waitFor();

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    const adminExamCard = admin.locator('.admin-exam-card').filter({ hasText: examTitle });
    assert.equal(await adminExamCard.locator('.admin-exam-card__status').innerText(), 'Open');
    for (const label of ['Available', 'Submission', 'Duration']) {
      await adminExamCard.locator('.admin-exam-card__meta').getByText(label, { exact: true }).waitFor();
    }
    const startAdminExamButton = adminExamCard.getByRole('button', { name: 'Start Exam', exact: true });
    assert.equal(await startAdminExamButton.isEnabled(), true);
    await startAdminExamButton.click();
    await admin.waitForURL(url => url.pathname === `/student/exams/${examId}`
      && url.searchParams.get('returnTo')?.includes('/exam-types/SHSAT/admin'));
    assert.equal(await admin.locator('.admin-layout__header').count(), 0,
      'the exam interface hides the platform navigation header');
    await admin.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await admin.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
    await installFullscreenMock(admin);
    const adminAttemptRequest = admin.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await admin.getByRole('button', { name: /^ELA/ }).click();
    const adminAttemptResponse = await adminAttemptRequest;
    assert.equal(adminAttemptResponse.status(), 200, 'the administrator can start the exam practice flow');
    const adminPracticeAttempt = await adminAttemptResponse.json();
    assert.equal(adminPracticeAttempt.practice, true, 'the administrator exam flow creates a practice attempt');
    await admin.locator('.question-number').waitFor();
    await admin.screenshot({ path: `/tmp/shsat-admin-start-exam-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.evaluate(() => window.scrollTo(0, 0));
    await admin.waitForTimeout(200);
    const adminExamMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(adminExamMobileSize.page <= adminExamMobileSize.viewport, 'the administrator exam practice fits a 390px viewport');
    await admin.screenshot({ path: `/tmp/shsat-admin-start-exam-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.getByRole('button', { name: 'Leave exam page', exact: true }).click();
    const leaveDialog = admin.getByRole('dialog', { name: 'Leave Exam Page' });
    await leaveDialog.getByRole('button', { name: 'Leave', exact: true }).click();
    await admin.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');

    const dashboardReviewCard = admin.locator('.dashboard-review-card');
    const dashboardTask = dashboardReviewCard.locator('.dashboard-review-task').filter({ hasText: taskTitle });
    await dashboardTask.waitFor();
    const dashboardCounts = dashboardTask.locator('.dashboard-review-task__details > div');
    assert.equal(await dashboardCounts.nth(0).locator('dd').innerText(), '0 / 1');
    assert.equal(await dashboardCounts.nth(1).locator('dd').innerText(), '1');
    const reviewRefreshResponse = admin.waitForResponse(response => response.url().endsWith('/api/admin/wrong-answer-tasks'));
    await dashboardReviewCard.getByRole('button', { name: 'Refresh review assignments' }).click();
    assert.equal((await reviewRefreshResponse).status(), 200, 'the dashboard refresh reloads review assignment summaries');
    await dashboardTask.getByRole('button', { name: 'View Progress', exact: true }).waitFor();
    await dashboardTask.scrollIntoViewIfNeeded();
    await admin.screenshot({ path: `/tmp/shsat-review-assignment-dashboard-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    await dashboardTask.scrollIntoViewIfNeeded();
    await admin.waitForTimeout(200);
    const dashboardMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dashboardMobileSize.page <= dashboardMobileSize.viewport, 'the dashboard review card fits a 390px viewport');
    await admin.screenshot({ path: `/tmp/shsat-review-assignment-dashboard-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    const dashboardCollapse = dashboardReviewCard.getByRole('button', { name: 'Collapse assigned review' });
    await dashboardCollapse.click();
    await admin.reload();
    await dashboardReviewCard.getByRole('button', { name: 'Expand assigned review' }).waitFor();
    assert.equal(await dashboardTask.count(), 0, 'the collapsed dashboard hides its review task cards after refresh');
    await dashboardReviewCard.getByRole('button', { name: 'Expand assigned review' }).click();
    await dashboardTask.waitFor();
    let failProgressLoadOnce = true;
    const progressUrl = `**/api/admin/wrong-answer-tasks/${taskId}`;
    await admin.route(progressUrl, async route => {
      if (route.request().method() === 'GET' && failProgressLoadOnce) {
        failProgressLoadOnce = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Progress could not be loaded. Please retry.' }) });
        return;
      }
      await route.continue();
    });
    await dashboardTask.getByRole('button', { name: 'View Progress', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/wrong-answer-tasks/${taskId}`));
    await admin.getByText('Progress could not be loaded. Please retry.', { exact: true }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-review-progress-retry-error-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    const progressErrorMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(progressErrorMobileSize.page <= progressErrorMobileSize.viewport,
      'the review progress error state fits a 390px viewport');
    await admin.screenshot({ path: `/tmp/shsat-review-progress-retry-error-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.getByRole('button', { name: 'Retry', exact: true }).click();
    await admin.getByRole('heading', { name: taskTitle, exact: true }).waitFor();
    await admin.locator('.task-table tbody tr').filter({ hasText: `Review Student ${displayStamp}` }).waitFor();
    await admin.unroute(progressUrl);
    await admin.getByRole('button', { name: 'Back to Review Assignments', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith('/exam-types/SHSAT/admin')
      && url.searchParams.get('tab') === 'wrong-answer-tasks');
    await admin.getByRole('tab', { name: 'Review Assignments', exact: true }).waitFor();

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

    await teacher.getByRole('button', { name: 'Create Assignment', exact: true }).click();
    const expiredModal = teacher.locator('.wrong-task-modal');
    await expiredModal.getByLabel('Exam').click();
    await expiredModal.getByRole('option', { name: new RegExp(examTitle) }).click();
    await expiredModal.getByLabel('Class').selectOption(String(classId));
    await expiredModal.getByLabel('Assignment Title').fill(expiredTaskTitle);
    await expiredModal.getByLabel('Description (optional)').fill('Expired review task state check.');
    const expiredTimes = await teacher.evaluate(() => {
      const format = date => {
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      };
      return { start: format(new Date(Date.now() - 2 * 60 * 60_000)), end: format(new Date(Date.now() - 60 * 60_000)) };
    });
    await expiredModal.getByRole('textbox', { name: 'Start time' }).fill(expiredTimes.start);
    await expiredModal.getByRole('textbox', { name: 'End time' }).fill(expiredTimes.end);
    await expiredModal.getByRole('button', { name: 'Create Assignment', exact: true }).click();
    await expiredModal.waitFor({ state: 'detached' });
    const expiredTask = (await api(admin, '/api/admin/wrong-answer-tasks')).find(item => item.title === expiredTaskTitle);
    assert.ok(expiredTask, 'the past-window assignment is persisted');
    assert.equal(expiredTask.status, 'ENDED',
      `an elapsed task window is reported as ended; window=${expiredTask.startAt}..${expiredTask.endAt}; local input=${expiredTimes.start}..${expiredTimes.end}`);
    const expiredStudentTask = (await api(student, '/api/student/wrong-answer-tasks'))
      .find(item => item.title === expiredTaskTitle);
    assert.equal(expiredStudentTask.status, 'ENDED', 'the student receives the expired assignment state');
    assert.equal(expiredStudentTask.canStart, false, 'an expired task cannot be started');
    const taskListRefresh = student.waitForResponse(response => response.url().endsWith('/api/student/wrong-answer-tasks'));
    await student.locator('.shsat-student-history').getByRole('button', { name: 'Refresh', exact: true }).click();
    assert.equal((await taskListRefresh).status(), 200, 'refresh loads the newly expired assignment');
    const expiredTaskCard = student.locator('.student-review-list article.paper-row').filter({ hasText: expiredTaskTitle });
    const expiredTaskButton = expiredTaskCard.getByRole('button', { name: 'Task ended', exact: true });
    await expiredTaskButton.waitFor();
    assert.equal(await expiredTaskButton.isDisabled(), true, 'the expired task displays a disabled action');
    await student.setViewportSize({ width: 1440, height: 1000 });
    await student.screenshot({ path: `/tmp/shsat-review-assignment-expired-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const expiredMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(expiredMobileSize.page <= expiredMobileSize.viewport, 'the expired task state fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-review-assignment-expired-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 1000 });

    await startReview.click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}` && Boolean(url.searchParams.get('practiceAttemptId')));
    let practiceAttemptId = Number(new URL(student.url()).searchParams.get('practiceAttemptId'));
    const taskAfterStart = await api(admin, `/api/admin/wrong-answer-tasks/${taskId}`);
    assert.equal(taskAfterStart.assignments[0].status, 'IN_PROGRESS');
    assert.equal(taskAfterStart.assignments[0].practiceAttemptId, practiceAttemptId);

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin?tab=wrong-answer-tasks`);
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
    const firstPracticeSubmission = await api(student, `/api/student/attempts/${practiceAttemptId}/submit`, 'POST');
    assert.ok(['SUBMITTED', 'COMPLETED'].includes(firstPracticeSubmission.status));
    const retryTask = await api(student, '/api/student/wrong-answer-tasks')
      .then(rows => rows.find(item => item.assignmentId === details.assignments[0].assignmentId));
    assert.equal(retryTask.status, 'RETRY_REQUIRED', 'unanswered assigned questions require another practice round');
    assert.equal(retryTask.canStart, true, 'the student can begin another round while the task is available');
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const retryReview = student.locator('.student-review-list article.paper-row').filter({ hasText: taskTitle });
    await retryReview.getByText('More Practice Needed', { exact: true }).waitFor();
    await student.setViewportSize({ width: 1440, height: 1000 });
    await student.screenshot({ path: `/tmp/shsat-review-assignment-retry-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const retryTaskMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(retryTaskMobileSize.page <= retryTaskMobileSize.viewport, 'the retry task card fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-review-assignment-retry-mobile-${stamp}.png` });
    await retryReview.waitFor({ timeout: 5000 }).catch(async () => {
      await student.screenshot({ path: `/tmp/shsat-review-assignment-retry-debug-${stamp}.png` });
      throw new Error(`Retry task card missing. Student page: ${await student.locator('body').innerText()}`);
    });
    await retryReview.getByRole('button', { name: /Try again/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`
      && Number(url.searchParams.get('practiceAttemptId')) !== practiceAttemptId);
    practiceAttemptId = Number(new URL(student.url()).searchParams.get('practiceAttemptId'));
    assert.ok(practiceAttemptId > 0, 'retry creates a new practice attempt');
    await admin.reload();
    await admin.locator('.task-table tbody tr').filter({ hasText: `Review Student ${displayStamp}` })
      .getByText('In Progress', { exact: true }).waitFor();
    const retryDetails = await api(admin, `/api/admin/wrong-answer-tasks/${taskId}`);
    assert.equal(retryDetails.assignments[0].practiceAttemptId, practiceAttemptId,
      'the assignment now points to the latest retry attempt');
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
    await teacherTaskRow.getByRole('button', { name: `Actions for ${taskTitle}` }).click();
    const acceptedEnd = teacher.waitForEvent('dialog').then(dialog => {
      assert.match(dialog.message(), new RegExp(`End \\"${taskTitle}\\"`));
      return dialog.accept();
    });
    const endRequest = teacher.waitForResponse(response => response.url().includes(`/api/admin/wrong-answer-tasks/${taskId}/end`)
      && response.request().method() === 'POST');
    await teacher.getByRole('menuitem', { name: 'End', exact: true }).click();
    await acceptedEnd;
    assert.equal((await endRequest).status(), 200, 'the task-end request succeeds');
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
    const completedAttempt = await api(student, `/api/student/attempts/${practiceAttemptId}/submit`, 'POST');
    assert.ok(['SUBMITTED', 'COMPLETED'].includes(completedAttempt.status), 'the review attempt can be submitted and reported');
    let taskListOverride = 'ENDED';
    const studentTasksForOverride = await api(student, '/api/student/wrong-answer-tasks');
    await student.route('**/api/student/wrong-answer-tasks', async route => {
      const tasks = studentTasksForOverride.map(item => ({ ...item }));
      const assignment = tasks.find(item => item.assignmentId === details.assignments[0].assignmentId);
      assignment.status = taskListOverride;
      if (taskListOverride === 'ENDED') assignment.canStart = false;
      if (taskListOverride === 'COMPLETED') {
        assignment.clearedQuestionCount = assignment.totalQuestions;
        assignment.remainingQuestionCount = 0;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tasks),
      });
    });
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const endedTaskCard = student.locator('.student-review-list article.paper-row').filter({ hasText: taskTitle });
    const endedTaskButton = endedTaskCard.getByRole('button', { name: 'Task ended', exact: true });
    await endedTaskButton.waitFor();
    assert.equal(await endedTaskButton.isDisabled(), true, 'an ended task is clearly labeled and cannot be started');
    await student.setViewportSize({ width: 1440, height: 1000 });
    await student.screenshot({ path: `/tmp/shsat-review-assignment-ended-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    await student.evaluate(() => window.scrollTo(0, 0));
    await student.waitForTimeout(200);
    const endedTaskMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(endedTaskMobileSize.page <= endedTaskMobileSize.viewport, 'the ended task card fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-review-assignment-ended-mobile-${stamp}.png` });
    taskListOverride = 'COMPLETED';
    await student.reload();
    await student.getByRole('tab', { name: /Review Task History/ }).click();
    const completedTaskRow = student.locator('.shsat-history-row').filter({ hasText: taskTitle });
    await completedTaskRow.getByText(`${details.assignments[0].totalQuestions} / ${details.assignments[0].totalQuestions} questions cleared`).waitFor();
    assert.equal(await student.locator('.student-review-list article.paper-row').filter({ hasText: taskTitle }).count(), 0,
      'completed assignments no longer appear among active review tasks');
    await student.setViewportSize({ width: 1440, height: 1000 });
    await student.screenshot({ path: `/tmp/shsat-review-assignment-completed-history-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    await student.evaluate(() => window.scrollTo(0, 0));
    await student.waitForTimeout(200);
    const completedHistoryMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(completedHistoryMobileSize.page <= completedHistoryMobileSize.viewport,
      'the completed review history fits a 390px viewport');
    await completedTaskRow.scrollIntoViewIfNeeded();
    await student.screenshot({ path: `/tmp/shsat-review-assignment-completed-history-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 1000 });
    await completedTaskRow.getByRole('button', { name: 'View report', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${practiceAttemptId}/report`);
    await Promise.race([
      student.getByText('Result Summary', { exact: true }).waitFor(),
      student.locator('.attempt-report__state--error').waitFor(),
    ]);
    await student.screenshot({ path: `/tmp/shsat-review-assignment-completed-report-${stamp}.png` });
    if (await student.locator('.attempt-report__state--error').count()) {
      throw new Error(`Completed assignment report failed: ${await student.locator('.attempt-report__state--error').innerText()}`);
    }
    assert.equal(await student.locator('.attempt-report__state--error').count(), 0,
      'a completed review assignment retains a working student report link');
    await student.screenshot({ path: `/tmp/shsat-review-assignment-completed-report-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    await student.evaluate(() => window.scrollTo(0, 0));
    await student.waitForTimeout(200);
    const completedReportMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(completedReportMobileSize.page <= completedReportMobileSize.viewport,
      'the completed review report fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-review-assignment-completed-report-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 1000 });
    await student.getByRole('button', { name: 'Back to SHSAT', exact: true }).click();
    await student.waitForURL(url => url.pathname === '/student/systems/SHSAT');
    await student.getByRole('tab', { name: /Review Task History/ }).waitFor();
    assert.equal(await student.getByRole('tab', { name: /Review Task History/ }).getAttribute('aria-selected'), 'true',
      'returning from the report preserves the selected history tab');
    await student.unroute('**/api/student/wrong-answer-tasks');
    await api(admin, `/api/admin/classes/${classId}/students/${userId}`, 'DELETE');
    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await admin.getByRole('tab', { name: 'Classes', exact: true }).click();
    await admin.getByRole('button', { name: 'Refresh classes' }).click();
    const reviewClassCard = admin.locator('.class-card').filter({ hasText: className });
    assert.equal(await reviewClassCard.getByRole('button', { name: 'Delete', exact: true }).count(), 0,
      'the UI hides class deletion while review assignments still reference the class');
    await reviewClassCard.scrollIntoViewIfNeeded();
    const reviewClassDesktop = `/tmp/shsat-review-class-linked-desktop-${stamp}.png`;
    await admin.screenshot({ path: reviewClassDesktop });
    await admin.setViewportSize({ width: 390, height: 844 });
    await reviewClassCard.scrollIntoViewIfNeeded();
    await admin.waitForTimeout(200);
    const reviewClassMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(reviewClassMobileSize.page <= reviewClassMobileSize.viewport,
      'the class list fits a 390px viewport while its review task prevents deletion');
    const reviewClassMobile = `/tmp/shsat-review-class-linked-mobile-${stamp}.png`;
    await admin.screenshot({ path: reviewClassMobile });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    const classDeleteConflict = await api(admin, `/api/admin/classes/${classId}`, 'DELETE')
      .then(() => '', error => error.message);
    assert.match(classDeleteConflict, /409.*Reassign or remove this class's SHSAT review tasks/,
      'the API explains why a class with review assignments cannot be deleted');
    const sourceExamId = examId;
    const sourceTaskIds = (await api(admin, '/api/admin/wrong-answer-tasks'))
      .filter(task => task.examId === sourceExamId)
      .map(task => Number(task.taskId));
    assert.ok(sourceTaskIds.includes(taskId), 'the source exam has its completed review task before deletion');
    await api(admin, `/api/admin/exams/${sourceExamId}`, 'DELETE');
    examId = undefined;
    const tasksAfterSourceDelete = await api(admin, '/api/admin/wrong-answer-tasks');
    assert.ok(sourceTaskIds.every(id => !tasksAfterSourceDelete.some(task => Number(task.taskId) === id)),
      'deleting a source exam removes its associated review assignments');
    const studentTasksAfterSourceDelete = await api(student, '/api/student/wrong-answer-tasks');
    assert.ok(studentTasksAfterSourceDelete.every(task => task.examId !== sourceExamId),
      'students no longer see review assignments for a deleted exam');
    await student.reload();
    assert.equal(await student.locator('.student-review-list article.paper-row').filter({ hasText: taskTitle }).count(), 0,
      'refreshing the student workspace removes the deleted source exam task');
    const deletedSourceTaskDesktop = `/tmp/shsat-review-source-delete-${stamp}.png`;
    await student.screenshot({ path: deletedSourceTaskDesktop });
    await student.setViewportSize({ width: 390, height: 844 });
    const deletedSourceTaskMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(deletedSourceTaskMobileSize.page <= deletedSourceTaskMobileSize.viewport,
      'the student workspace remains within the viewport after source task removal');
    const deletedSourceTaskMobile = `/tmp/shsat-review-source-delete-mobile-${stamp}.png`;
    await student.screenshot({ path: deletedSourceTaskMobile });
    const deletedAttemptReportError = await api(student, `/api/student/attempts/${practiceAttemptId}/report`)
      .then(() => '', error => error.message);
    assert.match(deletedAttemptReportError, /404/, 'attempt reports tied to a deleted source exam are no longer accessible');
    await admin.getByRole('button', { name: 'Refresh classes' }).click();
    const deletableReviewClass = admin.locator('.class-card').filter({ hasText: className });
    await deletableReviewClass.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteClassAfterCleanup = admin.getByRole('dialog', { name: 'Delete empty class?' });
    let simulatedDeleteConflict = false;
    const deleteClassUrl = `**/api/admin/classes/${classId}`;
    await admin.route(deleteClassUrl, async route => {
      if (route.request().method() === 'DELETE' && !simulatedDeleteConflict) {
        simulatedDeleteConflict = true;
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'This class changed. Refresh and try again.' }) });
        return;
      }
      await route.continue();
    });
    await deleteClassAfterCleanup.getByRole('button', { name: 'Delete Class', exact: true }).click();
    await deleteClassAfterCleanup.getByRole('alert').getByText('This class changed. Refresh and try again.', { exact: true }).waitFor();
    const deleteClassConflictDesktop = `/tmp/shsat-class-delete-conflict-${stamp}.png`;
    await admin.screenshot({ path: deleteClassConflictDesktop });
    await admin.setViewportSize({ width: 390, height: 844 });
    const deleteClassConflictMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(deleteClassConflictMobileSize.page <= deleteClassConflictMobileSize.viewport,
      'the class delete conflict message fits a 390px viewport');
    const deleteClassConflictMobile = `/tmp/shsat-class-delete-conflict-mobile-${stamp}.png`;
    await admin.screenshot({ path: deleteClassConflictMobile });
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.unroute(deleteClassUrl);
    await deleteClassAfterCleanup.getByRole('button', { name: 'Delete Class', exact: true }).click();
    await admin.getByText('Class Deleted', { exact: true }).waitFor();
    const deletedClassError = await api(admin, `/api/admin/classes/${classId}`)
      .then(() => '', error => error.message);
    assert.match(deletedClassError, /404/, 'the class can be deleted after its review assignments are removed');
    await student.reload();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['student submitted source attempt', 'teacher creates assignment and is denied account directory access', 'teacher views task progress and ends the assignment', 'eligible question snapshot', 'admin Start Exam launches SHSAT practice, hides platform nav, and returns to dashboard', 'admin dashboard refresh, collapse persistence, counts, progress link, and return tab', 'student start and progress state', 'elapsed end time automatically disables student task', 'admin progress detail and return context', 'View Report opens and returns from the in-progress report', 'mobile progress row is visible and readable', 'retry-required state and Try again creates a fresh attempt', 'ended task label and disabled action', 'completed assignment history and student report', 'end cancel and in-progress preservation', 'student can continue after administrator ends assignment', 'class deletion is hidden while review tasks are linked, API explains the conflict, and the class can be deleted after source cleanup', 'deleting the source exam removes student review tasks and reports'],
      sourceTaskIds,
      deletedSourceTaskMobileSize,
      reviewClassMobileSize,
      progressErrorMobileSize,
      deleteClassConflictMobileSize,
      screenshots: [reviewClassDesktop, reviewClassMobile, deleteClassConflictDesktop, deleteClassConflictMobile, deletedSourceTaskDesktop, deletedSourceTaskMobile,
        `/tmp/shsat-review-progress-retry-error-${stamp}.png`, `/tmp/shsat-review-progress-retry-error-mobile-${stamp}.png`],
      assignedQuestions: details.assignments[0].totalQuestions,
      mobileSize,
      modalScroll,
      studentMobileSize,
      teacherProgressMobileSize,
      progressMobileSize,
      reportMobileSize,
      completedHistoryMobileSize,
      completedReportMobileSize,
      endedTaskMobileSize,
      retryTaskMobileSize,
      pageErrors: errors.length,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    if (teacherId) await api(admin, `/api/admin/users/${teacherId}`, 'DELETE').catch(() => {});
    await studentContext.close();
    await teacherContext.close();
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
