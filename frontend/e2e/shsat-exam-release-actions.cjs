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
  const admin = await adminContext.newPage();
  const errors = [];
  admin.on('pageerror', error => errors.push(error.message));
  let studentContext;
  let student;
  let raceContext;
  let raceAdmin;
  let targetRaceStudentContext;
  let targetRaceStudent;
  let targetRaceOriginalStudentContext;
  let targetRaceOriginalStudent;
  let studentId;
  let targetRaceStudentId;
  let classId;
  let targetRaceClassId;
  let examId;
  const extraExamIds = [];
  const stamp = Date.now();
  const examTitle = `SHSAT release action check ${stamp}`;

  try {
    await login(admin, adminUsername, adminPassword);
    const papers = await api(admin, '/api/admin/exam-types/SHSAT/papers');
    const readyPaper = papers.find(paper => paper.status === 'READY');
    assert.ok(readyPaper, 'an existing READY SHSAT paper is available');

    const createdStudent = await api(admin, '/api/admin/users', 'POST', {
      username: `shsat_release_${stamp}`,
      password: `Release${stamp}!`,
      realName: `Release Check ${stamp}`,
      roleCode: 'STUDENT',
      email: null,
      phone: null,
    });
    studentId = Number(createdStudent.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Release Class ${stamp}`, description: 'Temporary class-to-monitor release check', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: studentId });

    const now = Date.now();
    const createdExam = await api(admin, `/api/admin/papers/${readyPaper.id}/exams`, 'POST', {
      title: examTitle,
      description: 'Temporary exam release action verification',
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 30 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    examId = Number(createdExam.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    for (let index = 0; index < 10; index += 1) {
      const fixture = await api(admin, `/api/admin/papers/${readyPaper.id}/exams`, 'POST', {
        title: `Release pagination fixture ${stamp} ${index}`,
        description: 'Temporary release pagination test fixture.',
        opensAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        closesAt: new Date(Date.now() + 120 * 60_000).toISOString(),
        durationSeconds: 10_800,
        attemptLimit: 1,
        targetScope: 'ALL_STUDENTS',
        autoSubmit: true,
        allowReview: true,
      });
      extraExamIds.push(Number(fixture.summary.id));
    }

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await admin.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    const search = admin.locator('.release-search-input');
    await search.fill(examTitle);
    const row = admin.locator('.exam-release-table tbody tr').filter({ hasText: examTitle });
    await row.waitFor();

    const actionTrigger = row.getByRole('button', { name: `Actions for ${examTitle}` });
    assert.equal(await actionTrigger.count(), 1, 'release row actions are available from a single menu');
    await actionTrigger.click();
    const publishMenuItem = admin.getByRole('menuitem', { name: 'Publish', exact: true });
    await publishMenuItem.waitFor();
    await admin.keyboard.press('Escape');
    await publishMenuItem.waitFor({ state: 'detached' });
    await actionTrigger.click();
    await publishMenuItem.waitFor();
    await admin.locator('.exam-releases-card .app-card__title').click();
    await publishMenuItem.waitFor({ state: 'detached' });

    await openActions(row, examTitle, 'Publish');
    await admin.getByRole('heading', { name: 'Publish this exam?' }).waitFor();
    const publishFailureMessage = 'The release changed before it could be published. Please review and try again.';
    await admin.route(`**/api/admin/exams/${examId}/publish`, route => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message: publishFailureMessage }),
    }), { times: 1 });
    const failedPublish = admin.waitForResponse(response => (
      response.url().includes(`/api/admin/exams/${examId}/publish`)
      && response.request().method() === 'POST'
    ));
    await admin.getByRole('button', { name: 'Publish Exam', exact: true }).click();
    assert.equal((await failedPublish).status(), 409, 'the conflict path receives an HTTP 409');
    await admin.locator('.publish-confirm-error').getByText(publishFailureMessage, { exact: true }).waitFor();
    assert.equal(await admin.getByText(publishFailureMessage, { exact: true }).count(), 1,
      'a publish conflict is reported once rather than duplicated in both release tables');
    assert.equal((await api(admin, `/api/admin/exams/${examId}`)).summary.status, 'DRAFT',
      'a rejected publish does not change release visibility');
    await admin.screenshot({ path: `/tmp/shsat-exam-release-publish-conflict-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    const mobileConflictDialog = await admin.locator('.publish-confirm-modal').evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewport: innerHeight,
        scrollHeight: dialog.scrollHeight,
        clientHeight: dialog.clientHeight,
      };
    });
    assert.ok(mobileConflictDialog.left >= 0 && mobileConflictDialog.right <= 390,
      `publish conflict dialog fits the mobile width: ${JSON.stringify(mobileConflictDialog)}`);
    assert.ok(mobileConflictDialog.bottom <= mobileConflictDialog.viewport,
      `publish conflict dialog stays within the mobile viewport: ${JSON.stringify(mobileConflictDialog)}`);
    assert.ok(mobileConflictDialog.scrollHeight > mobileConflictDialog.clientHeight,
      'the long mobile publish dialog scrolls internally to keep all actions reachable');
    await admin.screenshot({ path: `/tmp/shsat-exam-release-publish-conflict-mobile-${stamp}.png` });
    const mobileDialogFooter = admin.locator('.publish-confirm-modal .modal-card__footer');
    await mobileDialogFooter.scrollIntoViewIfNeeded();
    assert.ok(await admin.getByRole('button', { name: 'Publish Exam', exact: true }).isVisible(),
      'the publish action is reachable after scrolling the mobile dialog');
    await admin.screenshot({ path: `/tmp/shsat-exam-release-publish-conflict-mobile-actions-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 900 });
    await admin.unroute(`**/api/admin/exams/${examId}/publish`);
    let publishRequestCount = 0;
    await admin.route(`**/api/admin/exams/${examId}/publish`, async route => {
      publishRequestCount += 1;
      await route.continue();
    });
    const successfulPublish = admin.waitForResponse(response => (
      response.url().includes(`/api/admin/exams/${examId}/publish`)
      && response.request().method() === 'POST'
    ));
    await admin.locator('.publish-confirm-modal .modal-card__footer button').last().evaluate(button => {
      button.click();
      button.click();
    });
    assert.equal((await successfulPublish).status(), 200, 'the first rapid publish request succeeds');
    await admin.waitForTimeout(250);
    assert.equal(publishRequestCount, 1, 'rapidly activating Publish twice sends only one request');
    await admin.unroute(`**/api/admin/exams/${examId}/publish`);
    await row.locator('.access-pill--open').waitFor();
    const concurrentExam = await api(admin, `/api/admin/papers/${readyPaper.id}/exams`, 'POST', {
      title: `Concurrent release check ${stamp}`,
      description: 'Temporary concurrent publish verification',
      opensAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      closesAt: new Date(Date.now() + 120 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    const concurrentExamId = Number(concurrentExam.summary.id);
    extraExamIds.push(concurrentExamId);
    await api(admin, `/api/admin/exams/${concurrentExamId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    const concurrentExamTitle = `Concurrent release check ${stamp}`;
    await admin.getByRole('button', { name: 'Refresh releases' }).click();
    await admin.locator('.release-search-input').fill(concurrentExamTitle);
    const adminRaceRow = admin.locator('.exam-release-table tbody tr').filter({ hasText: concurrentExamTitle });
    await adminRaceRow.waitFor();
    await openActions(adminRaceRow, concurrentExamTitle, 'Publish');
    await admin.getByRole('heading', { name: 'Publish this exam?' }).waitFor();

    raceContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    raceAdmin = await raceContext.newPage();
    raceAdmin.on('pageerror', error => errors.push(error.message));
    await login(raceAdmin, adminUsername, adminPassword);
    await raceAdmin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await raceAdmin.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    await raceAdmin.locator('.release-search-input').fill(concurrentExamTitle);
    const secondAdminRaceRow = raceAdmin.locator('.exam-release-table tbody tr').filter({ hasText: concurrentExamTitle });
    await secondAdminRaceRow.waitFor();
    await openActions(secondAdminRaceRow, concurrentExamTitle, 'Publish');
    await raceAdmin.getByRole('heading', { name: 'Publish this exam?' }).waitFor();

    let concurrentPublishRequestCount = 0;
    let releaseConcurrentRequests;
    const concurrentRequestsReady = new Promise(resolve => { releaseConcurrentRequests = resolve; });
    const waitForBothPublishRequests = async route => {
      concurrentPublishRequestCount += 1;
      if (concurrentPublishRequestCount === 2) releaseConcurrentRequests();
      await concurrentRequestsReady;
      await route.continue();
    };
    const publishRoute = `**/api/admin/exams/${concurrentExamId}/publish`;
    await Promise.all([
      admin.route(publishRoute, waitForBothPublishRequests),
      raceAdmin.route(publishRoute, waitForBothPublishRequests),
    ]);
    const firstAdminResponse = admin.waitForResponse(response => response.url().includes(`/api/admin/exams/${concurrentExamId}/publish`));
    const secondAdminResponse = raceAdmin.waitForResponse(response => response.url().includes(`/api/admin/exams/${concurrentExamId}/publish`));
    await Promise.all([
      admin.getByRole('button', { name: 'Publish Exam', exact: true }).click(),
      raceAdmin.getByRole('button', { name: 'Publish Exam', exact: true }).click(),
    ]);
    const concurrentPublishResponses = await Promise.all([firstAdminResponse, secondAdminResponse]);
    assert.deepEqual(concurrentPublishResponses.map(response => response.status()).sort(), [200, 409],
      'two separately authenticated admins publishing at once receive one success and one conflict');
    const losingAdmin = concurrentPublishResponses[0].status() === 409 ? admin : raceAdmin;
    const winningAdmin = losingAdmin === admin ? raceAdmin : admin;
    await losingAdmin.locator('.publish-confirm-error').getByText('Only draft exams can be published.', { exact: true }).waitFor();
    await winningAdmin.locator('.publish-confirm-modal').waitFor({ state: 'detached' });
    await losingAdmin.screenshot({ path: `/tmp/shsat-exam-release-cross-session-conflict-${stamp}.png` });
    assert.equal(concurrentPublishRequestCount, 2, 'both isolated sessions reached the publish endpoint before either continued');
    assert.equal((await api(admin, `/api/admin/exams/${concurrentExamId}`)).summary.status, 'PUBLISHED',
      'cross-session concurrency leaves one consistent published release');
    await Promise.all([
      admin.unroute(publishRoute),
      raceAdmin.unroute(publishRoute),
      losingAdmin.getByRole('button', { name: 'Cancel', exact: true }).click(),
    ]);
    await api(admin, `/api/admin/exams/${concurrentExamId}/unpublish`, 'POST');

    const targetRaceStudentRecord = await api(admin, '/api/admin/users', 'POST', {
      username: `shsat_target_race_${stamp}`,
      password: `TargetRace${stamp}!`,
      realName: `Target Race ${stamp}`,
      roleCode: 'STUDENT',
      email: null,
      phone: null,
    });
    targetRaceStudentId = Number(targetRaceStudentRecord.id);
    const targetRaceClass = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Release Target Race ${stamp}`, description: 'Temporary target publication race check', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    targetRaceClassId = Number(targetRaceClass.id);
    await api(admin, `/api/admin/classes/${targetRaceClassId}/students`, 'POST', { studentUserId: targetRaceStudentId });
    const targetRaceTitle = `Target mutation race ${stamp}`;
    const targetRaceExam = await api(admin, `/api/admin/papers/${readyPaper.id}/exams`, 'POST', {
      title: targetRaceTitle,
      description: 'Temporary target and publication concurrency verification',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    const targetRaceExamId = Number(targetRaceExam.summary.id);
    extraExamIds.push(targetRaceExamId);
    await api(admin, `/api/admin/exams/${targetRaceExamId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    const targetMutationPath = `/api/admin/exams/${targetRaceExamId}/targets`;
    const publishTargetRacePath = `/api/admin/exams/${targetRaceExamId}/publish`;
    let targetRaceRequestsReached = 0;
    let releaseTargetRaceRequests;
    const targetRaceRequestBarrier = new Promise(resolve => { releaseTargetRaceRequests = resolve; });
    const waitForTargetRaceRequests = async route => {
      targetRaceRequestsReached += 1;
      if (targetRaceRequestsReached === 2) releaseTargetRaceRequests();
      await targetRaceRequestBarrier;
      await route.continue();
    };
    await Promise.all([
      raceAdmin.route(`**${targetMutationPath}`, waitForTargetRaceRequests),
      admin.route(`**${publishTargetRacePath}`, waitForTargetRaceRequests),
    ]);
    const [targetMutation, targetRacePublish] = await Promise.all([
      raw(raceAdmin, targetMutationPath, 'PUT', { classIds: [targetRaceClassId], studentUserIds: [] }),
      raw(admin, publishTargetRacePath, 'POST'),
    ]);
    await Promise.all([
      raceAdmin.unroute(`**${targetMutationPath}`),
      admin.unroute(`**${publishTargetRacePath}`),
    ]);
    assert.equal(targetRaceRequestsReached, 2, 'the target edit and publish requests reached the server concurrently');
    assert.equal(targetRacePublish.status, 200, `publishing a release while targets change succeeds: ${targetRacePublish.text}`);
    assert.ok([200, 409].includes(targetMutation.status),
      `concurrent audience edits either finish before publish or conflict after it: ${targetMutation.status} ${targetMutation.text}`);
    const targetRaceDetails = await api(admin, `/api/admin/exams/${targetRaceExamId}`);
    const targetRaceWon = targetMutation.status === 200;
    assert.deepEqual(targetRaceDetails.classIds, [targetRaceWon ? targetRaceClassId : classId],
      'published target IDs match the serialized audience edit result');

    targetRaceStudentContext = await browser.newContext();
    targetRaceStudent = await targetRaceStudentContext.newPage();
    await login(targetRaceStudent, `shsat_target_race_${stamp}`, `TargetRace${stamp}!`);
    targetRaceOriginalStudentContext = await browser.newContext();
    targetRaceOriginalStudent = await targetRaceOriginalStudentContext.newPage();
    await login(targetRaceOriginalStudent, `shsat_release_${stamp}`, `Release${stamp}!`);
    const originalTargetExams = await api(targetRaceOriginalStudent, '/api/student/exams');
    const changedTargetExams = await api(targetRaceStudent, '/api/student/exams');
    assert.equal(originalTargetExams.some(exam => Number(exam.id) === targetRaceExamId), !targetRaceWon,
      `the original target student access matches the serialized target result: status=${targetMutation.status}, targets=${JSON.stringify(targetRaceDetails.classIds)}, exams=${JSON.stringify(originalTargetExams.map(exam => exam.id))}`);
    assert.equal(changedTargetExams.some(exam => Number(exam.id) === targetRaceExamId), targetRaceWon,
      `the edited target student access matches the serialized target result: status=${targetMutation.status}, targets=${JSON.stringify(targetRaceDetails.classIds)}, exams=${JSON.stringify(changedTargetExams.map(exam => exam.id))}`);
    await api(admin, `/api/admin/exams/${targetRaceExamId}`, 'DELETE');
    extraExamIds.splice(extraExamIds.indexOf(targetRaceExamId), 1);
    await admin.getByRole('button', { name: 'Refresh releases' }).click();
    await admin.locator('.release-search-input').fill(examTitle);
    assert.ok((await row.locator('.exam-release-table__target-cell').innerText()).includes(`Classes: Release Class ${stamp}`),
      'the Assigned To column identifies the selected class');
    await row.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await admin.screenshot({ path: `/tmp/shsat-exam-release-published-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    const activeReleaseTableWrap = admin.locator('.exam-releases-card .exam-release-table-wrap').first();
    await admin.getByText('Swipe horizontally to view all columns.', { exact: true }).first().waitFor();
    const activeReleaseScroll = await activeReleaseTableWrap.evaluate(element => {
      element.scrollLeft = element.scrollWidth;
      return { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollLeft: element.scrollLeft };
    });
    assert.ok(activeReleaseScroll.scrollWidth > activeReleaseScroll.clientWidth,
      'the active release table preserves all columns on mobile');
    assert.ok(activeReleaseScroll.scrollLeft > 0, 'the active release table can scroll to the Actions column');
    await activeReleaseTableWrap.evaluate(element => { element.scrollLeft = 0; });
    const mobilePageWidth = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobilePageWidth.page <= mobilePageWidth.viewport, 'the mobile release page has no horizontal overflow');
    assert.equal(await overlaps(
      admin.locator('.exam-releases-card .app-card__title'),
      admin.locator('.exam-releases-card > .card-top-actions'),
    ), false, 'the mobile Create Exam and refresh controls do not overlap the card title');
    await admin.screenshot({ path: `/tmp/shsat-exam-release-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 900 });
    const visibilityFilter = admin.getByRole('combobox', { name: 'Visibility filter' });
    await visibilityFilter.selectOption('published');
    await row.waitFor();
    await visibilityFilter.selectOption('unpublished');
    await row.waitFor({ state: 'detached' });
    await visibilityFilter.selectOption('');
    await row.waitFor();
    const timeFilter = admin.getByRole('combobox', { name: 'Time status' });
    await timeFilter.selectOption('live');
    await row.waitFor();
    await timeFilter.selectOption('upcoming');
    await row.waitFor({ state: 'detached' });
    await timeFilter.selectOption('');
    await row.waitFor();
    const audienceFilter = admin.getByRole('combobox', { name: 'Target type' });
    await audienceFilter.selectOption('SPECIFIC_CLASSES');
    await row.waitFor();
    await audienceFilter.selectOption('SPECIFIC_STUDENTS');
    await row.waitFor({ state: 'detached' });
    await audienceFilter.selectOption('');
    await row.waitFor();
    await admin.getByRole('button', { name: 'Refresh releases' }).click();
    await row.waitFor();
    await admin.getByRole('button', { name: 'Collapse exam releases' }).click();
    await row.waitFor({ state: 'detached' });
    await admin.getByRole('button', { name: 'Expand exam releases' }).click();
    await row.waitFor();
    await search.fill('');
    await row.waitFor({ state: 'detached' });
    const rowsPerPage = admin.getByLabel('Rows per page', { exact: true });
    await rowsPerPage.selectOption('5');
    assert.equal(await admin.locator('.exam-releases-card .exam-release-table tbody tr').count(), 5,
      'the release table respects the selected five-row page size');
    const pagination = admin.locator('.exam-releases-card .table-pagination');
    await pagination.getByRole('button', { name: 'Next', exact: true }).click();
    await admin.waitForFunction(() => document.querySelector('.exam-releases-card .table-pagination__actions > span')
      ?.textContent.trim().startsWith('Page 2 /'));
    assert.equal(await admin.locator('.exam-releases-card .exam-release-table tbody tr').count(), 5,
      'Next shows the next release page without changing page size');
    await pagination.getByRole('button', { name: 'Prev', exact: true }).click();
    await admin.waitForFunction(() => document.querySelector('.exam-releases-card .table-pagination__actions > span')
      ?.textContent.trim().startsWith('Page 1 /'));
    await search.fill(examTitle);
    await row.waitFor();
    const publishedExam = await api(admin, `/api/admin/exams/${examId}`);
    assert.equal(publishedExam.summary.status, 'PUBLISHED', 'publish updates the release status');

    studentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    student = await studentContext.newPage();
    student.on('pageerror', error => errors.push(error.message));
    await login(student, `shsat_release_${stamp}`, `Release${stamp}!`);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByText(examTitle, { exact: true }).waitFor();
    const releaseActionCard = student.getByRole('article').filter({ hasText: examTitle });
    await releaseActionCard.getByRole('button', { name: /^Start exam/ }).waitFor();
    await student.getByText(examTitle, { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await student.screenshot({ path: `/tmp/shsat-exam-release-student-mobile-${stamp}.png` });
    const studentWidth = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(studentWidth.page <= studentWidth.viewport, 'the published exam card fits a 390px page');

    await openActions(row, examTitle, 'Unpublish');
    await admin.getByRole('heading', { name: 'Unpublish this exam?' }).waitFor();
    await admin.getByRole('button', { name: 'Unpublish Exam', exact: true }).click();
    await row.locator('.access-pill--hidden').waitFor();
    assert.equal((await api(admin, `/api/admin/exams/${examId}`)).summary.status, 'DRAFT',
      'unpublish returns a release with no attempts to draft');
    await student.reload();
    await student.getByRole('heading', { name: 'Your exams' }).waitFor();
    await student.getByText('No exams have been assigned to you yet.', { exact: true }).waitFor();
    assert.equal(await student.getByText(examTitle, { exact: true }).count(), 0,
      'unpublished exam is removed from the student workspace before an attempt starts');

    await openActions(row, examTitle, 'Publish');
    await admin.getByRole('heading', { name: 'Publish this exam?' }).waitFor();
    await admin.getByRole('button', { name: 'Publish Exam', exact: true }).click();
    await row.locator('.access-pill--open').waitFor();
    await student.reload();
    await student.getByText(examTitle, { exact: true }).waitFor();

    await releaseActionCard.getByRole('button', { name: /^Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
    const startRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const startResponse = await startRequest;
    assert.equal(startResponse.status(), 200, 'the class member can start the published SHSAT exam');
    const startedAttempt = await startResponse.json();
    await student.locator('.exam-transition-page .exam-transition-card__button').click();
    await student.locator('.student-exam__workspace').waitFor();
    const attemptId = Number(startedAttempt.id || startedAttempt.attemptId);
    assert.ok(attemptId, 'the start response includes an attempt identifier');
    const attemptDetail = await api(student, `/api/student/attempts/${attemptId}`);
    const firstQuestion = attemptDetail.questions.find(question => Number(question.displayNumber) === 1);
    assert.ok(firstQuestion?.paperItemId, 'the live attempt exposes question identifiers for monitoring');
    await api(student, `/api/student/attempts/${attemptId}/answers/${firstQuestion.paperItemId}`, 'PUT', {
      answer: { answers: ['A'] }, timeSpentSeconds: 38,
    });

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${classId}`);
    const classExamRow = admin.locator('.class-exam-table tbody tr').filter({ hasText: examTitle });
    await classExamRow.waitFor();
    await classExamRow.getByText('Live', { exact: true }).waitFor();
    await classExamRow.getByRole('button', { name: 'View Results', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/classes/${classId}/exams/${examId}/results`));
    await admin.getByRole('heading', { name: examTitle }).waitFor();
    await admin.getByRole('button', { name: 'Back to Class Detail', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/admin/classes/${classId}`));
    await classExamRow.getByRole('button', { name: 'Monitor', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/exams/${examId}/monitor`));
    await admin.getByRole('heading', { name: examTitle }).waitFor();
    const monitorAnalytics = await api(admin, `/api/admin/reports/exams/${examId}/monitor/analytics`);
    const firstQuestionAnalytics = monitorAnalytics.questionAnalytics.find(row => Number(row.questionNumber) === 1);
    assert.ok(Number(firstQuestionAnalytics.averageTimeSpent) > 0,
      'monitor analytics include response time from a saved student answer');
    assert.ok(await admin.locator('svg[aria-label="Average time per question"] .chart-bar--orange').count() > 0,
      'the average-time chart renders bars when saved response-time data exists');
    await admin.screenshot({ path: `/tmp/shsat-exam-release-monitor-with-data-${stamp}.png` });
    await admin.getByRole('button', { name: 'Back' }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/admin/classes/${classId}`));
    await classExamRow.waitFor();
    assert.equal(await admin.locator('.class-exam-table tbody tr').filter({ hasText: examTitle }).count(), 1,
      'the published exam remains listed for its class after returning from Monitor');

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await admin.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    await admin.getByLabel('Visibility filter').selectOption('published');
    await admin.getByLabel('Time status').selectOption('live');
    await admin.getByLabel('Target type').selectOption('SPECIFIC_CLASSES');
    await admin.getByLabel('Rows per page', { exact: true }).selectOption('5');
    await admin.locator('.release-search-input').fill(examTitle);
    await row.waitFor();
    await admin.evaluate(() => window.scrollTo(0, 260));
    await row.getByRole('button', { name: `Actions for ${examTitle}` }).click();
    const releaseScrollY = await admin.evaluate(() => window.scrollY);
    await admin.getByRole('menuitem', { name: 'Monitor', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/exams/${examId}/monitor`));
    await admin.getByRole('heading', { name: examTitle }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-exam-release-monitor-${stamp}.png` });
    await admin.getByRole('button', { name: 'Back' }).click();
    await admin.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
    await admin.getByRole('tab', { name: 'Exam Release', exact: true }).waitFor();
    assert.equal(await admin.getByRole('tab', { name: 'Exam Release', exact: true }).getAttribute('aria-selected'), 'true',
      'returning from Monitor preserves the Exam Release tab');
    assert.equal(await admin.locator('.release-search-input').inputValue(), examTitle,
      'returning from Monitor preserves the release search');
    assert.equal(await admin.getByLabel('Visibility filter').inputValue(), 'published',
      'returning from Monitor preserves the visibility filter');
    assert.equal(await admin.getByLabel('Time status').inputValue(), 'live',
      'returning from Monitor preserves the time-window filter');
    assert.equal(await admin.getByLabel('Target type').inputValue(), 'SPECIFIC_CLASSES',
      'returning from Monitor preserves the audience filter');
    assert.equal(await admin.getByLabel('Rows per page', { exact: true }).inputValue(), '5',
      'returning from Monitor preserves the selected page size');
    await admin.waitForFunction(expected => Math.abs(window.scrollY - expected) <= 2, releaseScrollY);
    const returnedReleaseScrollY = await admin.evaluate(() => window.scrollY);
    assert.ok(Math.abs(returnedReleaseScrollY - releaseScrollY) <= 2,
      `returning from Monitor preserves the release page scroll position (${releaseScrollY} -> ${returnedReleaseScrollY}; ${admin.url()})`);
    await admin.getByLabel('Visibility filter').selectOption('');
    await admin.getByLabel('Time status').selectOption('');
    await admin.getByLabel('Target type').selectOption('');
    await admin.getByLabel('Rows per page', { exact: true }).selectOption('10');
    await row.waitFor();
    await admin.getByRole('button', { name: 'Refresh releases' }).click();
    await row.waitFor();
    assert.equal((await api(admin, `/api/admin/exams/${examId}`)).summary.hasStudentAttempts, true,
      'the release records that a student has started an attempt');

    await openActions(row, examTitle, 'Unpublish');
    const unpublishDialog = admin.getByRole('dialog', { name: 'Unpublish this exam?' });
    await unpublishDialog.getByText(/active attempt can continue, and existing results will be kept/).waitFor();
    await unpublishDialog.getByRole('button', { name: 'Unpublish Exam', exact: true }).click();
    await row.locator('.access-pill--hidden').waitFor();
    assert.equal((await api(admin, `/api/admin/exams/${examId}`)).summary.status, 'DRAFT',
      'unpublishing after a student starts preserves the release as a draft');

    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const studentExamRowsAfterUnpublish = await api(student, '/api/student/exams');
    assert.ok(studentExamRowsAfterUnpublish.some(item => Number(item.id) === examId),
      `an active student attempt remains in the exam list after unpublishing: ${JSON.stringify(studentExamRowsAfterUnpublish)}`);
    await student.screenshot({ path: `/tmp/shsat-unpublished-active-student-${stamp}.png` });
    const activeExamCard = student.locator('.student-exam-list .paper-row').filter({ hasText: examTitle });
    const continueButton = activeExamCard.getByRole('button', { name: /^Continue/ });
    await continueButton.waitFor({ timeout: 5000 });
    await continueButton.click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.student-exam__workspace').waitFor();
    const resumedAttempt = await api(student, `/api/student/attempts/${startedAttempt.id}`);
    assert.equal(resumedAttempt.id, startedAttempt.id, 'the student resumes the same attempt after unpublishing');
    assert.equal(resumedAttempt.status, 'IN_PROGRESS', 'the active attempt remains available after unpublishing');
    const submittedAfterUnpublish = await api(student, `/api/student/attempts/${startedAttempt.id}/submit`, 'POST');
    assert.ok(['SUBMITTED', 'COMPLETED'].includes(submittedAfterUnpublish.status),
      'the resumed attempt can be submitted after its exam is unpublished');
    const retainedHistory = await api(student, '/api/student/attempts/history');
    assert.ok(retainedHistory.some(item => Number(item.attemptId) === Number(startedAttempt.id)),
      'the submitted attempt remains in student history after unpublishing');
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByRole('tab', { name: 'Exam History', exact: true }).click();
    const retainedHistoryRow = student.locator('.shsat-history-row').filter({ hasText: examTitle });
    await retainedHistoryRow.getByRole('button', { name: 'View report', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${startedAttempt.id}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();
    assert.equal(await api(student, `/api/student/attempts/${startedAttempt.id}/report`).then(report => report.attemptId),
      Number(startedAttempt.id), 'the report API remains available for the submitted attempt');
    const submittedReportDesktop = `/tmp/shsat-unpublished-submitted-report-${stamp}.png`;
    await student.setViewportSize({ width: 1440, height: 900 });
    await student.screenshot({ path: submittedReportDesktop });
    await student.setViewportSize({ width: 390, height: 844 });
    const submittedReportMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(submittedReportMobileSize.page <= submittedReportMobileSize.viewport,
      'the retained report fits a 390px viewport after unpublishing');
    const submittedReportMobile = `/tmp/shsat-unpublished-submitted-report-mobile-${stamp}.png`;
    await student.screenshot({ path: submittedReportMobile });

    await openActions(row, examTitle, 'Delete');
    const deleteDialog = admin.getByRole('heading', { name: 'Delete this exam release?' });
    await deleteDialog.waitFor();
    assert.ok((await admin.locator('.publish-confirm-details').innerText()).includes(`Classes: Release Class ${stamp}`),
      'the delete confirmation identifies the affected class');
    const cancelDelete = admin.getByRole('button', { name: 'Cancel', exact: true });
    const deleteButton = admin.getByRole('button', { name: /^Delete Exam \(/ });
    await deleteButton.waitFor();
    assert.equal(await deleteButton.isDisabled(), true, 'the 5-second delete cooldown disables confirmation');
    await admin.screenshot({ path: `/tmp/shsat-exam-release-delete-cooldown-${stamp}.png` });
    await cancelDelete.click();
    assert.equal((await api(admin, `/api/admin/exams/${examId}`)).summary.id, examId, 'cancel leaves the release intact');

    await openActions(row, examTitle, 'Delete');
    const permanentDelete = admin.getByRole('button', { name: 'Delete Exam Permanently', exact: true });
    await permanentDelete.waitFor({ state: 'visible', timeout: 8_000 });
    await permanentDelete.click();
    await row.waitFor({ state: 'detached' });
    const deletedExam = await raw(admin, `/api/admin/exams/${examId}`);
    assert.equal(deletedExam.status, 404, 'confirmed deletion removes the release');
    examId = undefined;

    const deletedStudent = await api(admin, `/api/admin/users/${studentId}`, 'DELETE').then(() => true);
    assert.equal(deletedStudent, true);
    studentId = undefined;
    await api(admin, `/api/admin/classes/${classId}`, 'DELETE');
    classId = undefined;
    await student.reload();
    await student.waitForURL(url => url.pathname.endsWith('/login'));
    await admin.reload();
    await admin.getByRole('tab', { name: 'Exam Release', exact: true }).waitFor();
    await admin.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    const missingPaperTitle = `Release pagination fixture ${stamp} 0`;
    await search.fill(missingPaperTitle);
    const missingPaperRow = admin.locator('.exam-release-table tbody tr').filter({ hasText: missingPaperTitle });
    await missingPaperRow.waitFor();
    await admin.route('**/api/admin/exam-types/SHSAT/papers', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: [],
      });
    });
    await admin.locator('button[aria-label="Refresh admin data"]').click();
    await missingPaperRow.getByText('The linked paper was deleted.', { exact: true }).waitFor();
    assert.equal(await missingPaperRow.getByText('The linked paper was deleted.', { exact: true }).count(), 1,
      'a release with a missing paper displays a clear inline warning under its exam title');
    await missingPaperRow.scrollIntoViewIfNeeded();
    const missingPaperScreenshot = `/tmp/shsat-exam-release-missing-paper-${stamp}.png`;
    await admin.screenshot({ path: missingPaperScreenshot });
    await admin.setViewportSize({ width: 390, height: 844 });
    const missingPaperMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(missingPaperMobileSize.page <= missingPaperMobileSize.viewport,
      'the missing-paper warning does not introduce horizontal overflow on a narrow screen');
    await missingPaperRow.scrollIntoViewIfNeeded();
    const missingPaperMobileScreenshot = `/tmp/shsat-exam-release-missing-paper-mobile-${stamp}.png`;
    await admin.screenshot({ path: missingPaperMobileScreenshot });
    await admin.setViewportSize({ width: 1440, height: 900 });
    await search.fill(`no active release ${stamp}`);
    const historicalTable = admin.locator('.exam-release-table--history tbody');
    const missingHistoricalPaperRow = historicalTable.locator('tr').first();
    await missingHistoricalPaperRow.getByText('The linked paper was deleted.', { exact: true }).waitFor();
    assert.ok(await historicalTable.getByText('The linked paper was deleted.', { exact: true }).count() > 0,
      'historical releases with a missing paper also display the warning');
    assert.notEqual(await missingHistoricalPaperRow.locator('td:first-child strong').innerText(), 'Exam release',
      'a numeric exam title is preserved when its paper title is unavailable');
    await missingHistoricalPaperRow.scrollIntoViewIfNeeded();
    const missingHistoricalPaperScreenshot = `/tmp/shsat-historical-exam-missing-paper-${stamp}.png`;
    await admin.screenshot({ path: missingHistoricalPaperScreenshot });
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.locator('.exam-history-card .mobile-table-scroll-hint').waitFor();
    const missingHistoricalPaperMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(missingHistoricalPaperMobileSize.page <= missingHistoricalPaperMobileSize.viewport,
      'the historical missing-paper warning does not introduce horizontal overflow on a narrow screen');
    await admin.locator('.exam-history-card .mobile-table-scroll-hint').scrollIntoViewIfNeeded();
    await missingHistoricalPaperRow.scrollIntoViewIfNeeded();
    const missingHistoricalPaperMobileScreenshot = `/tmp/shsat-historical-exam-missing-paper-mobile-${stamp}.png`;
    await admin.screenshot({ path: missingHistoricalPaperMobileScreenshot });
    await admin.setViewportSize({ width: 1440, height: 900 });
    await admin.unroute('**/api/admin/exam-types/SHSAT/papers');
    await admin.locator('button[aria-label="Refresh admin data"]').click();
    await missingPaperRow.getByText('The linked paper was deleted.', { exact: true }).waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['Escape and outside-click menu dismissal', 'visibility/time-window/audience filters',
        'release refresh, collapse/expand, page size and next/previous pagination',
        'publish conflict displays an English error and retry succeeds',
        'rapid repeated Publish submits only once',
        'simultaneous publish requests from isolated admin sessions serialize to one success and one conflict',
        'concurrent target edits and publish serialize without mismatched student access',
        'publish/unpublish/republish synchronize student access',
        'active attempt continues after unpublishing', 'submitted history and report stay available after unpublishing',
        'student exam, class list/results and monitor synchronize',
        'delete cancel and 5-second cooldown'],
      studentWidth,
      mobileConflictDialog,
      submittedReportMobileSize,
      submittedReportScreenshots: [submittedReportDesktop, submittedReportMobile],
      missingPaperMobileSize,
      missingPaperScreenshots: [missingPaperScreenshot, missingPaperMobileScreenshot],
      missingHistoricalPaperMobileSize,
      missingHistoricalPaperScreenshots: [missingHistoricalPaperScreenshot, missingHistoricalPaperMobileScreenshot],
      pageErrors: errors.length,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    await Promise.all(extraExamIds.map(id => api(admin, `/api/admin/exams/${id}`, 'DELETE').catch(() => {})));
    if (studentId) await api(admin, `/api/admin/users/${studentId}`, 'DELETE').catch(() => {});
    if (targetRaceStudentId) await api(admin, `/api/admin/users/${targetRaceStudentId}`, 'DELETE').catch(() => {});
    for (const id of [classId, targetRaceClassId].filter(Boolean)) {
      await api(admin, `/api/admin/classes/${id}`, 'DELETE').catch(() => {});
      const remainingClass = await api(admin, `/api/admin/classes/${id}`).then(() => '', error => error.message);
      assert.match(remainingClass, /404/, 'the temporary class is removed after its student membership is deleted');
    }
    await studentContext?.close();
    await targetRaceStudentContext?.close();
    await targetRaceOriginalStudentContext?.close();
    await raceContext?.close();
    await adminContext.close();
    await browser.close();
  }
}

async function openActions(row, title, label) {
  const trigger = row.getByRole('button', { name: `Actions for ${title}` });
  if (await trigger.count()) {
    await trigger.click();
    await row.page().getByRole('menuitem', { name: label, exact: true }).click();
    return;
  }
  await row.getByRole('button', { name: label, exact: true }).click();
}

async function login(page, username, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

async function api(page, path, method = 'GET', body) {
  const response = await raw(page, path, method, body);
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

async function raw(page, path, method = 'GET', body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  return page.evaluate(async ({ path, method, body, token }) => {
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
}

async function overlaps(first, second) {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  return firstBox && secondBox
    && firstBox.x < secondBox.x + secondBox.width
    && firstBox.x + firstBox.width > secondBox.x
    && firstBox.y < secondBox.y + secondBox.height
    && firstBox.y + firstBox.height > secondBox.y;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
