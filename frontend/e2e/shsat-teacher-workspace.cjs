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
  const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  const teacher = await teacherContext.newPage();
  const student = await studentContext.newPage();
  const errors = [];
  [admin, teacher, student].forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const stamp = Date.now();
  const teacherUsername = `shsat_teacher_${stamp}`;
  const teacherPassword = `Teacher${stamp}!`;
  const studentUsername = `shsat_student_${stamp}`;
  const studentPassword = `Student${stamp}!`;
  const className = `SHSAT Teacher Check ${String(stamp).slice(-6)}`;
  const examTitle = `SHSAT Teacher Release ${String(stamp).slice(-6)}`;
  let teacherId;
  let studentId;
  let classId;
  let examId;
  let emptyEndedExamId;

  try {
    await login(admin, adminUsername, adminPassword);
    const teacherAccount = await api(admin, '/api/admin/users', 'POST', {
      username: teacherUsername, password: teacherPassword, realName: `Teacher ${stamp}`,
      roleCode: 'TEACHER', email: null, phone: null,
    });
    teacherId = Number(teacherAccount.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: className, description: 'Temporary teacher workspace verification', sortOrder: 999, active: true,
    });
    classId = Number(classroom.classId || classroom.id);
    const studentAccount = await api(admin, '/api/admin/users', 'POST', {
      username: studentUsername, password: studentPassword, realName: `Student ${stamp}`,
      roleCode: 'STUDENT', email: null, phone: null,
    });
    studentId = Number(studentAccount.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: studentId });

    await login(teacher, teacherUsername, teacherPassword);
    await teacher.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await teacher.getByRole('tab', { name: 'Classes', exact: true }).waitFor();
    assert.equal(await teacher.getByRole('tab', { name: 'Paper Management', exact: true }).count(), 0,
      'teachers do not receive paper editing controls');
    for (const label of ['Exam Release', 'Review Assignments', 'Classes']) {
      assert.equal(await teacher.getByRole('tab', { name: label, exact: true }).count(), 1,
        `teachers can access ${label}`);
    }
    const classes = await api(teacher, '/api/admin/classes?examTypeCodes=SHSAT');
    assert.ok(classes.some(item => Number(item.classId || item.id) === classId),
      'teachers can view every SHSAT class');
    assert.equal((await raw(teacher, '/api/admin/users')).status, 403,
      'teachers cannot access the platform account directory');
    assert.equal((await raw(teacher, '/api/admin/papers/247')).status, 403,
      'teachers cannot read answer-bearing paper details');
    const safeStatsResponse = await raw(teacher, '/api/admin/papers/247/structure-stats');
    assert.equal(safeStatsResponse.status, 200,
      'teachers can read the question counts needed to create an exam release');
    const safeStats = JSON.parse(safeStatsResponse.text);
    assert.deepEqual(Object.keys(safeStats).sort(), ['ela', 'math', 'total'],
      'the teacher-safe response contains counts only, without question or answer data');
    assert.ok(Number(safeStats.total) > 0 && Number(safeStats.ela) > 0 && Number(safeStats.math) > 0,
      'the teacher-safe response reports the selected paper structure counts');
    assert.ok(Number(safeStats.total) >= Number(safeStats.ela) + Number(safeStats.math),
      'the total count includes at least the scored ELA and Math questions');
    assert.equal((await raw(teacher, '/api/admin/papers/247/structure', 'PUT', { sections: [] })).status, 403,
      'teachers cannot modify SHSAT paper structure through the API');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-classes-${stamp}.png` });

    await teacher.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    await teacher.getByRole('button', { name: 'Create Exam', exact: true }).click();
    const modal = teacher.locator('.exam-release-modal');
    await modal.waitFor();
    const papers = await api(teacher, '/api/admin/exam-types/SHSAT/papers');
    const paper = papers.find(item => Number(item.id) === 247 && item.status === 'READY');
    assert.ok(paper, 'the official SHSAT paper is available to select');
    await modal.locator('.exam-paper-select').selectOption(String(paper.id));
    await modal.getByLabel('Exam Title').fill(examTitle);
    await modal.locator('input[aria-label="Start time"]').fill(formatLocalDateTime(new Date(Date.now() - 60_000)));
    await modal.locator('input[aria-label="End time"]').fill(formatLocalDateTime(new Date(Date.now() + 2 * 60 * 60_000)));
    await modal.getByRole('radio', { name: /Specific classes/ }).check();
    const classOption = modal.locator('.exam-class-option').filter({ hasText: className });
    await classOption.locator('input[type="checkbox"]').check();
    await teacher.screenshot({ path: `/tmp/shsat-teacher-release-form-${stamp}.png` });
    await modal.getByRole('button', { name: 'Create Release', exact: true }).click();
    const structureWarning = teacher.locator('.publish-confirm-modal').filter({ hasText: 'Create this exam release?' });
    if (await structureWarning.isVisible().catch(() => false)) {
      await structureWarning.getByRole('button', { name: 'Create Release', exact: true }).click();
    }
    await modal.waitFor({ state: 'detached' });
    const created = (await api(teacher, '/api/admin/exam-types/SHSAT/exams')).find(item => item.title === examTitle);
    assert.ok(created, 'a teacher can create an exam release for a selected class');
    examId = Number(created.id);

    const row = teacher.locator('.exam-release-table tbody tr').filter({ hasText: examTitle });
    await row.waitFor();
    await row.getByRole('button', { name: `Actions for ${examTitle}` }).click();
    await teacher.getByRole('menuitem', { name: 'Publish', exact: true }).click();
    const publishResponse = teacher.waitForResponse(response => response.url().endsWith(`/api/admin/exams/${examId}/publish`)
      && response.request().method() === 'POST');
    await teacher.getByRole('button', { name: 'Publish Exam', exact: true }).click();
    const publishResult = await publishResponse;
    assert.equal(publishResult.status(), 200, `a teacher can publish a valid exam release: ${await publishResult.text()}`);
    const published = (await api(teacher, '/api/admin/exam-types/SHSAT/exams')).find(item => Number(item.id) === examId);
    assert.equal(published.status, 'PUBLISHED', 'the release is persisted as published');
    await row.getByRole('button', { name: `Actions for ${examTitle}` }).click();
    await teacher.getByRole('menuitem', { name: 'Unpublish', exact: true }).waitFor();
    assert.equal(await teacher.getByRole('menuitem', { name: 'Delete', exact: true }).count(), 0,
      'teachers are not offered the destructive release action');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-release-published-${stamp}.png` });

    await teacher.getByRole('menuitem', { name: 'Monitor', exact: true }).click();
    await teacher.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/exams/${examId}/monitor`);
    assert.equal((await raw(teacher, `/api/admin/reports/exams/${examId}/monitor/live`)).status, 200,
      'teachers can load SHSAT live monitoring data');
    assert.equal((await raw(teacher, `/api/admin/reports/exams/${examId}/monitor/analytics`)).status, 200,
      'teachers can load SHSAT monitoring analytics');
    await teacher.getByRole('heading', { name: 'Current Question Distribution' }).waitFor();
    await teacher.getByText('No students are currently taking this exam.', { exact: true }).waitFor();
    await teacher.getByText('No response-time data has been recorded for this exam yet.').waitFor();
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-${stamp}.png` });

    await login(student, studentUsername, studentPassword);
    const started = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    const attemptId = Number(started.id);
    const attempt = await api(student, `/api/student/attempts/${attemptId}`);
    const firstQuestion = (attempt.questions || []).find(question => Number(question.displayNumber) === 1);
    assert.ok(firstQuestion, 'the published SHSAT exam gives the student a first question');
    await api(student, `/api/student/attempts/${attemptId}/presence`, 'POST', { questionNumber: 1 });
    const paperDetails = await api(admin, '/api/admin/papers/247');
    const paperQuestions = [];
    const collectQuestions = section => {
      paperQuestions.push(...(section.questions || []));
      (section.children || []).forEach(collectQuestions);
    };
    (paperDetails.sections || []).forEach(collectQuestions);
    const firstQuestionDetails = paperQuestions.find(question =>
      Number(question.paperItemId) === Number(firstQuestion.paperItemId));
    assert.ok(firstQuestionDetails?.answerKey?.answers?.[0], 'the administrator paper detail exposes the answer key for the test question');
    await api(student, `/api/student/attempts/${attemptId}/answers/${firstQuestion.paperItemId}`, 'PUT', {
      answer: { answers: [firstQuestionDetails.answerKey.answers[0]] }, timeSpentSeconds: 38,
    });

    const liveMonitor = await api(teacher, `/api/admin/reports/exams/${examId}/monitor/live`);
    assert.ok(liveMonitor.currentQuestionDistribution.some(item =>
      Number(item.questionNumber) === 1 && Number(item.students) === 1),
    'live monitoring places the active student at question 1');
    const analytics = await api(teacher, `/api/admin/reports/exams/${examId}/monitor/analytics`);
    const questionOneAnalytics = analytics.questionAnalytics.find(item => Number(item.questionNumber) === 1);
    assert.equal(Number(questionOneAnalytics?.attemptedCount), 1, 'monitor analytics counts the saved answer');
    assert.equal(Number(questionOneAnalytics?.averageTimeSpent), 38, 'monitor analytics reports the saved response time');
    assert.equal(questionOneAnalytics?.accuracy, null, 'an unsubmitted answer remains pending rather than affecting accuracy');

    await teacher.reload();
    await teacher.getByRole('heading', { name: 'Current Question Distribution' }).waitFor();
    await teacher.locator('.chart-bar--blue title').filter({ hasText: 'Question 1: 1 students' }).waitFor({ state: 'attached' });
    await teacher.locator('.chart-bar--orange title').filter({ hasText: 'Question 1: 38s' }).waitFor({ state: 'attached' });
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-live-${stamp}.png` });

    await teacher.waitForTimeout(31_000);
    const staleLiveMonitor = await api(teacher, `/api/admin/reports/exams/${examId}/monitor/live`);
    assert.equal(Number(staleLiveMonitor.summary?.inProgressStudents), 1,
      'an unfinished attempt remains in progress while its student is away');
    assert.equal(staleLiveMonitor.currentQuestionDistribution.length, 0,
      'a stale presence does not leave a student on the live question chart');
    await teacher.reload();
    await teacher.getByText('No live question positions are available. In-progress students may be away from the exam.', { exact: true }).waitFor();
    await teacher.locator('.chart-bar--orange title').filter({ hasText: 'Question 1: 38s' }).waitFor({ state: 'attached' });
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-stale-presence-${stamp}.png` });

    const submittedAttempt = await api(student, `/api/student/attempts/${attemptId}/submit`, 'POST');
    assert.equal(submittedAttempt.status, 'SUBMITTED', 'submitting the attempt finalizes the saved answer for scoring');
    const submittedReport = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    const firstQuestionResult = submittedReport.questions.find(question => Number(question.questionNumber) === 1);
    assert.equal(firstQuestionResult?.correct, true, 'the control report confirms the saved answer is correct');
    const scoredAnalytics = await api(teacher, `/api/admin/reports/exams/${examId}/monitor/analytics`);
    const scoredQuestionOne = scoredAnalytics.questionAnalytics.find(item => Number(item.questionNumber) === 1);
    assert.equal(Number(scoredQuestionOne?.accuracy), 100, 'monitor analytics updates accuracy after the answer is scored');
    assert.equal(Number(scoredQuestionOne?.pendingCount), 0, 'a scored answer is removed from the pending count');

    await teacher.reload();
    await teacher.getByRole('heading', { name: 'Accuracy Heatmap' }).waitFor();
    await teacher.getByText('No students are currently taking this exam.', { exact: true }).waitFor();
    const scoredTile = teacher.getByRole('button', { name: 'Open question 1 details' });
    await scoredTile.waitFor();
    assert.equal((await scoredTile.locator('span').innerText()).trim(), '100%', 'the heatmap displays the scored accuracy');
    assert.ok((await scoredTile.getAttribute('class')).includes('accuracy-tile--high'),
      'the heatmap uses the high-accuracy color for a correct response');
    await scoredTile.scrollIntoViewIfNeeded();
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-accuracy-${stamp}.png` });
    await teacher.setViewportSize({ width: 390, height: 844 });
    await scoredTile.scrollIntoViewIfNeeded();
    const accuracyMobileSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(accuracyMobileSize.page <= accuracyMobileSize.viewport, 'the scored accuracy heatmap fits the 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-accuracy-mobile-${stamp}.png` });
    await teacher.setViewportSize({ width: 1440, height: 900 });
    await teacher.evaluate(() => window.scrollTo(0, 0));

    const firstQuestionTile = teacher.getByRole('button', { name: 'Open question 1 details' });
    await firstQuestionTile.waitFor();
    const previewAssetUrl = '/uploads/paper-materials/611-3cba11d3-9ce9-40bc-8191-b923c3704736.png';
    const imageResponse = await teacher.request.get(`${baseUrl}${previewAssetUrl}`);
    assert.equal(imageResponse.status(), 200, 'the monitor image preview fixture is available');
    await teacher.route(`**/api/admin/reports/exams/${examId}/monitor/questions/1`, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          question: {
            id: 1,
            questionNumber: 1,
            questionType: 'MULTIPLE_CHOICE',
            stem: 'Monitor image preview check',
            options: { A: 'First choice', B: 'Second choice' },
            correctAnswer: 'A',
            correctAnswerData: { correctAnswer: 'A' },
          },
          material: { assetUrl: previewAssetUrl },
        },
      }),
    }));
    const questionDetailsResponse = teacher.waitForResponse(response =>
      response.url().endsWith(`/api/admin/reports/exams/${examId}/monitor/questions/1`));
    await firstQuestionTile.click();
    assert.equal((await questionDetailsResponse).status(), 200, 'teachers can open question details from the accuracy heatmap');
    const questionDrawer = teacher.getByRole('dialog', { name: 'Question details' });
    await questionDrawer.waitFor();
    await questionDrawer.locator('.monitor-question-detail').waitFor();
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-question-${stamp}.png` });
    await questionDrawer.getByRole('button', { name: 'Question material' }).click();
    const imagePreview = teacher.locator('.question-image-preview');
    await imagePreview.waitFor();
    assert.equal(await questionDrawer.getByRole('button', { name: 'Close question details' }).count(), 0,
      'the drawer close control is hidden while the image preview is open');
    const previewImage = imagePreview.locator('img');
    await previewImage.waitFor({ state: 'visible' });
    await previewImage.evaluate(image => image.decode());
    assert.equal(await previewImage.getAttribute('src'), previewAssetUrl,
      'the enlarged monitor image uses the selected material asset');
    const desktopImageBox = await previewImage.boundingBox();
    assert.ok(desktopImageBox && desktopImageBox.width > 0 && desktopImageBox.height > 0,
      'the desktop preview renders a non-empty enlarged image');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-image-preview-${stamp}.png` });
    await imagePreview.click({ position: { x: 8, y: 8 } });
    await imagePreview.waitFor({ state: 'detached' });
    await teacher.locator('.question-detail-backdrop').click({ position: { x: 5, y: 5 } });
    await questionDrawer.waitFor({ state: 'detached' });
    await teacher.setViewportSize({ width: 390, height: 844 });
    await teacher.evaluate(() => window.scrollTo(0, 0));
    const monitorMobileSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(monitorMobileSize.page <= monitorMobileSize.viewport, 'teacher monitor fits a 390px viewport');
    const mobileChartScroll = await teacher.locator('.monitor-chart-scroll').first().evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      maxScrollLeft: element.scrollWidth - element.clientWidth,
    }));
    assert.ok(mobileChartScroll.maxScrollLeft > 0, 'mobile charts preserve a readable width inside their own horizontal scroller');
    assert.equal(await teacher.locator('.chart-axis-title--question').first().evaluate(element => getComputedStyle(element).display),
      'none', 'the mobile chart does not clip its centered horizontal axis title');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-live-mobile-${stamp}.png` });
    await teacher.locator('.monitor-chart-scroll').first().evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-live-mobile-end-${stamp}.png` });
    await teacher.locator('.monitor-chart-scroll').first().evaluate(element => { element.scrollLeft = 0; });
    await teacher.getByRole('button', { name: 'Open question 1 details' }).click();
    await questionDrawer.waitFor();
    await questionDrawer.locator('.monitor-question-detail').waitFor();
    const mobileDrawerSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileDrawerSize.page <= mobileDrawerSize.viewport, 'question details drawer fits a 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-question-mobile-${stamp}.png` });
    await questionDrawer.getByRole('button', { name: 'Question material' }).click();
    await imagePreview.waitFor();
    assert.equal(await questionDrawer.getByRole('button', { name: 'Close question details' }).count(), 0,
      'the mobile image preview has one close control without overlap');
    await previewImage.evaluate(image => image.decode());
    const mobileImageBox = await previewImage.boundingBox();
    assert.ok(mobileImageBox && mobileImageBox.x >= 0 && mobileImageBox.x + mobileImageBox.width <= 390,
      'the enlarged monitor image fits the mobile viewport');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-image-preview-mobile-${stamp}.png` });
    await imagePreview.getByRole('button', { name: 'Close image preview' }).click();
    await imagePreview.waitFor({ state: 'detached' });
    await teacher.getByRole('button', { name: 'Close question details' }).click();
    await questionDrawer.waitFor({ state: 'detached' });

    const questionApiPattern = `**/api/admin/reports/exams/${examId}/monitor/questions/1`;
    const missingAssetUrl = '/uploads/paper-materials/missing-monitor-image.png';
    await teacher.unroute(questionApiPattern);
    await teacher.route(questionApiPattern, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          question: { id: 1, questionNumber: 1, questionType: 'MULTIPLE_CHOICE', stem: 'Missing image check', options: { A: 'First choice' } },
          material: { assetUrl: missingAssetUrl },
        },
      }),
    }));
    await teacher.route(`**${missingAssetUrl}`, route => route.fulfill({ status: 404, contentType: 'text/plain', body: '' }));
    await teacher.getByRole('button', { name: 'Open question 1 details' }).click();
    await questionDrawer.waitFor();
    await questionDrawer.getByText('Question image is unavailable.', { exact: true }).waitFor();
    assert.equal(await questionDrawer.locator('.monitor-question-image-button').count(), 0,
      'an unavailable source image is not offered as an enlargeable broken image');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-image-unavailable-mobile-${stamp}.png` });
    await questionDrawer.getByRole('button', { name: 'Close question details' }).click();
    await questionDrawer.waitFor({ state: 'detached' });
    await teacher.locator('.monitor-back-button').click();
    await teacher.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
    await teacher.getByRole('tab', { name: 'Exam Release', exact: true }).waitFor();
    await teacher.setViewportSize({ width: 1440, height: 900 });
    await teacher.getByRole('tab', { name: 'Exam Release', exact: true }).click();

    const forbiddenDelete = await raw(teacher, `/api/admin/exams/${examId}`, 'DELETE');
    assert.equal(forbiddenDelete.status, 403, 'the backend also denies teacher release deletion');
    await row.getByRole('button', { name: `Actions for ${examTitle}` }).click();
    await teacher.getByRole('menuitem', { name: 'Unpublish', exact: true }).click();
    const unpublishResponse = teacher.waitForResponse(response =>
      response.url().endsWith(`/api/admin/exams/${examId}/unpublish`) && response.request().method() === 'POST');
    await teacher.getByRole('button', { name: 'Unpublish Exam', exact: true }).click();
    const unpublishResult = await unpublishResponse;
    assert.equal(unpublishResult.status(), 200, `teacher unpublish succeeds: ${await unpublishResult.text()}`);
    const unpublished = await api(teacher, '/api/admin/exam-types/SHSAT/exams');
    assert.equal(unpublished.find(item => Number(item.id) === examId)?.status, 'DRAFT',
      'a teacher can unpublish a release');

    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');
    const closedExam = await api(admin, `/api/admin/exams/${examId}/close`, 'POST');
    assert.equal(closedExam.summary?.status, 'CLOSED', 'an administrator can end a published exam');
    const endedRelease = (await api(admin, '/api/admin/exam-types/SHSAT/exams'))
      .find(item => Number(item.id) === examId);
    assert.equal(endedRelease.status, 'CLOSED', 'the ended state is persisted in the release list');
    const endedLiveMonitor = await api(teacher, `/api/admin/reports/exams/${examId}/monitor/live`);
    assert.equal(Number(endedLiveMonitor.summary?.completedStudents), 1,
      'completed student totals remain available after the exam ends');
    assert.equal(Number(endedLiveMonitor.summary?.inProgressStudents), 0,
      'a submitted attempt is not counted as in progress after the exam ends');
    const endedAnalytics = await api(teacher, `/api/admin/reports/exams/${examId}/monitor/analytics`);
    const endedQuestionOne = endedAnalytics.questionAnalytics.find(item => Number(item.questionNumber) === 1);
    assert.equal(Number(endedQuestionOne?.accuracy), 100,
      'scored question accuracy remains available after the exam ends');
    await teacher.goto(`${baseUrl}/exam-types/SHSAT/admin/exams/${examId}/monitor`);
    await teacher.getByRole('heading', { name: 'Accuracy Heatmap' }).waitFor();
    await teacher.getByText('No students are currently taking this exam.', { exact: true }).waitFor();
    await teacher.getByRole('button', { name: 'Open question 1 details' }).waitFor();
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-ended-${stamp}.png` });
    await teacher.setViewportSize({ width: 390, height: 844 });
    const endedMonitorSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(endedMonitorSize.page <= endedMonitorSize.viewport, 'ended monitor fits a 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-ended-mobile-${stamp}.png` });

    const readyPapers = await api(admin, '/api/admin/exam-types/SHSAT/papers');
    const emptyStatePaper = readyPapers.find(item => item.status === 'READY');
    assert.ok(emptyStatePaper, 'a ready SHSAT paper is available for the empty ended-state check');
    const emptyEndedExam = await api(admin, `/api/admin/papers/${emptyStatePaper.id}/exams`, 'POST', {
      title: `SHSAT Empty Ended Monitor ${String(stamp).slice(-6)}`,
      description: 'Temporary monitor empty-state verification',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    emptyEndedExamId = Number(emptyEndedExam.summary.id);
    await api(admin, `/api/admin/exams/${emptyEndedExamId}/targets`, 'PUT', {
      classIds: [classId], studentUserIds: [],
    });
    await api(admin, `/api/admin/exams/${emptyEndedExamId}/publish`, 'POST');
    const closedEmptyExam = await api(admin, `/api/admin/exams/${emptyEndedExamId}/close`, 'POST');
    assert.equal(closedEmptyExam.summary?.status, 'CLOSED', 'an unanswered exam can be closed');
    const emptyEndedLive = await api(teacher, `/api/admin/reports/exams/${emptyEndedExamId}/monitor/live`);
    assert.equal(Number(emptyEndedLive.summary?.completedStudents), 0,
      'an ended exam without submissions has no completed students');
    assert.equal(Number(emptyEndedLive.summary?.inProgressStudents), 0,
      'an ended exam without attempts has no in-progress students');
    const emptyEndedAnalytics = await api(teacher, `/api/admin/reports/exams/${emptyEndedExamId}/monitor/analytics`);
    assert.ok(emptyEndedAnalytics.questionAnalytics.every(item => item.accuracy == null),
      'an ended exam without answers does not invent question accuracy');
    await teacher.goto(`${baseUrl}/exam-types/SHSAT/admin/exams/${emptyEndedExamId}/monitor`);
    await teacher.getByRole('heading', { name: 'Accuracy Heatmap' }).waitFor();
    await teacher.getByText('No students are currently taking this exam.', { exact: true }).waitFor();
    await teacher.getByText('No response-time data has been recorded for this exam yet.').waitFor();
    assert.ok(await teacher.getByText('No answers yet', { exact: true }).count() > 0,
      'the heatmap marks questions without answers');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-ended-empty-${stamp}.png` });
    await teacher.setViewportSize({ width: 390, height: 844 });
    const emptyEndedSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(emptyEndedSize.page <= emptyEndedSize.viewport, 'the unanswered ended monitor fits a 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-ended-empty-mobile-${stamp}.png` });

    await teacher.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await teacher.getByRole('tab', { name: 'Exam Release', exact: true }).waitFor();
    await teacher.setViewportSize({ width: 390, height: 844 });
    await teacher.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    await teacher.evaluate(() => window.scrollTo(0, 0));
    await teacher.waitForTimeout(200);
    const mobileSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'teacher exam release fits a 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-release-mobile-${stamp}.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['teacher SHSAT tab access', 'shared all-class directory', 'account directory denied',
        'paper answer details and editing API denied to teachers',
        'create, publish and unpublish release', 'empty and populated monitoring charts from a real student attempt',
        'in-progress attempt with stale presence has an accurate empty chart state',
        'monitor accuracy updates after a scored response', 'ended exam preserves completed totals and accuracy analytics',
        'monitor analytics and return path',
        'heatmap question details drawer and backdrop close', 'desktop/mobile monitor image preview and close controls',
        'unavailable source image gets a readable fallback',
        'unanswered ended exam shows accurate chart empty states',
        'delete hidden in UI and forbidden by API', '390px layout'],
      mobileSize,
      monitorMobileSize,
      mobileChartScroll,
      mobileDrawerSize,
      accuracyMobileSize,
      endedMonitorSize,
      emptyEndedSize,
      pageErrors: errors.length,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (emptyEndedExamId) await api(admin, `/api/admin/exams/${emptyEndedExamId}`, 'DELETE').catch(() => {});
    if (studentId) await api(admin, `/api/admin/users/${studentId}`, 'DELETE').catch(() => {});
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (teacherId) await api(admin, `/api/admin/users/${teacherId}`, 'DELETE').catch(() => {});
    if (teacherId || studentId || classId) {
      const [users, classes] = await Promise.all([
        api(admin, '/api/admin/users').catch(() => []),
        api(admin, '/api/admin/classes?examTypeCodes=SHSAT').catch(() => []),
      ]);
      assert.ok(!users.some(user => [teacherId, studentId].includes(Number(user.id))), 'temporary accounts are removed');
      assert.ok(!classes.some(item => Number(item.classId || item.id) === classId), 'the temporary class is removed');
    }
    await teacherContext.close();
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

function formatLocalDateTime(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

async function api(page, path, method = 'GET', body) {
  const result = await raw(page, path, method, body);
  if (result.status < 200 || result.status >= 300) throw new Error(`${method} ${path}: ${result.status} ${result.text}`);
  return result.text ? JSON.parse(result.text) : null;
}

async function raw(page, path, method = 'GET', body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  return page.evaluate(async ({ path, method, body, token }) => {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-XSRF-TOKEN': token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, text: await response.text() };
  }, { path, method, body, token });
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
