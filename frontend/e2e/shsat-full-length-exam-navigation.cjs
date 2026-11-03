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
    const paperDetail = await api(admin, `/api/admin/papers/${paper.id}`);
    const paperMaterialQuestion = flattenSections(paperDetail.sections)
      .flatMap(section => section.questions || [])
      .find(question => question.render?.material);
    assert.ok(paperMaterialQuestion, 'paper detail restores separately stored SHSAT material for editor and preview');
    assert.ok(paperMaterialQuestion.render.material.content || paperMaterialQuestion.render.material.assetUrl,
      'restored paper material includes readable text or an image URL');

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
    const attemptDetails = await api(student, `/api/student/attempts/${attemptId}`);
    const materialQuestion = attemptDetails.questions?.find(question => question.display?.material);
    assert.ok(materialQuestion, 'SHSAT material details are included in the student attempt');
    assert.ok(materialQuestion.display.material.content || materialQuestion.display.material.assetUrl,
      'the attached SHSAT material includes visible text or an image URL');
    const secondSection = firstSection === 'ELA' ? 'Math' : 'ELA';
    const secondRange = sectionRange(secondSection);
    await expectQuestion(student, firstRange.start);
    assert.equal(await student.getByRole('button', { name: 'Previous', exact: true }).isEnabled(), false,
      'Previous is disabled at the first question of a section');
    const firstGroupLabel = await student.locator('.group-label').textContent().catch(() => '');
    const firstGroupRange = firstGroupLabel.match(/Questions\s+(\d+)\s*[-–]\s*(\d+)/i);
    const firstGroupBoundary = firstGroupRange ? Number(firstGroupRange[2]) + 1 : firstRange.start + 1;
    let lockedGroupVerified = false;
    let drawingVerified = false;
    let drawingMobileSize;
    let drawingScreenshots = [];
    const verifyDrawingOnQuestion = async questionNumber => {
      if (!lockedGroupVerified && questionNumber === firstGroupBoundary) {
        assert.equal(await student.getByRole('button', { name: 'Previous', exact: true }).isEnabled(), false,
          'Previous cannot return to a completed earlier group');
        await student.getByRole('button', { name: 'Review', exact: true }).click();
        assert.equal(await reviewQuestion(student.locator('.review-panel'), firstRange.start).isDisabled(), true,
          'Review locks questions after the exam advances to a later group');
        await student.getByRole('button', { name: 'Review', exact: true }).click();
        lockedGroupVerified = true;
      }
      if (!drawingVerified && questionNumber === Number(materialQuestion.displayNumber)) {
        const drawingResult = await verifyDrawing(student, stamp);
        drawingMobileSize = drawingResult.mobileSize;
        drawingScreenshots = drawingResult.screenshots;
        drawingVerified = true;
      }
    };
    const bookmarkSave = student.waitForResponse(response => response.url().includes(`/api/student/attempts/${attemptId}/bookmarks/`)
      && response.request().method() === 'PUT');
    await student.getByRole('button', { name: 'Bookmark', exact: true }).click();
    assert.equal((await bookmarkSave).status(), 200, 'bookmark action saves through its dedicated endpoint');
    const savedBookmark = await api(student, `/api/student/attempts/${attemptId}`);
    const bookmarkedQuestion = savedBookmark.questions.find(question => Number(question.displayNumber) === firstRange.start);
    assert.equal(bookmarkedQuestion?.marked, true, 'bookmark state is saved on the server');
    assert.equal(bookmarkedQuestion?.answer, null, 'bookmarking an unanswered question does not create an answer record');
    const unansweredSection = await student.evaluate(async ({ id, sectionCode }) => {
      const csrf = await (await fetch('/api/auth/csrf')).json();
      const response = await fetch(`/api/student/attempts/${id}/sections/submit`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-XSRF-TOKEN': csrf.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionCode }),
      });
      return { status: response.status, body: await response.text() };
    }, { id: attemptId, sectionCode: firstSection });
    assert.equal(unansweredSection.status, 409, 'a bookmark alone cannot satisfy the section completion gate');
    const conflictMessage = JSON.parse(unansweredSection.body).message;
    const unansweredList = conflictMessage.match(/Unanswered questions: ([\d, ]+)\./);
    const reportedQuestions = unansweredList ? unansweredList[1].split(',').map(value => value.trim()) : [];
    assert.ok(reportedQuestions.includes(String(firstRange.start)),
      `the section conflict identifies the unanswered question; response=${unansweredSection.body}`);
    await student.reload();
    await installFullscreenMock(student);
    await student.getByRole('button', { name: 'Enter Fullscreen' }).click();
    await student.locator('.exam-transition-card__button').click();
    await expectQuestion(student, firstRange.start);
    await student.getByRole('button', { name: 'Review', exact: true }).click();
    const resumedReviewPanel = student.locator('.review-panel');
    await assertReviewCount(resumedReviewPanel, 'Current Range', 50);
    await assertReviewCount(resumedReviewPanel, 'Not Answered', 50);
    await assertReviewCount(resumedReviewPanel, 'Bookmarks', 1);
    const unopenedSectionQuestion = reviewQuestion(resumedReviewPanel, secondRange.start);
    if (await unopenedSectionQuestion.count()) {
      assert.equal(await unopenedSectionQuestion.isDisabled(), true,
        'Review may list an unopened section question only as locked');
    }
    await resumedReviewPanel.locator('.stat-item').filter({ hasText: 'Bookmarks' }).click();
    assert.equal(await resumedReviewPanel.locator('.question-item').count(), 1,
      'the bookmark filter only shows the marked unanswered question');
    await reviewQuestion(resumedReviewPanel, firstRange.start).waitFor();
    await resumedReviewPanel.locator('.stat-item').filter({ hasText: 'Not Answered' }).click();
    assert.equal(await resumedReviewPanel.locator('.question-item').count(), 50,
      'the unanswered filter includes questions independently of bookmarks');
    await resumedReviewPanel.locator('.stat-item').filter({ hasText: 'Current Range' }).click();
    await student.getByRole('button', { name: 'Review', exact: true }).click();
    await answerCurrentQuestion(student);
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await expectQuestion(student, firstRange.start + 1);
    const currentGroupLabel = await student.locator('.group-label').textContent().catch(() => '');
    const currentGroupRange = currentGroupLabel.match(/Questions\s+(\d+)\s*[-–]\s*(\d+)/i);
    const canReturnWithinFirstGroup = Boolean(currentGroupRange
      && firstRange.start >= Number(currentGroupRange[1])
      && firstRange.start + 1 <= Number(currentGroupRange[2]));
    assert.equal(await student.getByRole('button', { name: 'Previous', exact: true }).isEnabled(), canReturnWithinFirstGroup,
      'Previous follows the standalone SHSAT access rule for the current question group');
    await student.getByRole('button', { name: 'Review', exact: true }).click();
    const jumpReviewPanel = student.locator('.review-panel');
    await jumpReviewPanel.getByRole('button', { name: /Bookmarks/ }).click();
    const earlierBookmarkedQuestion = reviewQuestion(jumpReviewPanel, firstRange.start);
    assert.equal(await earlierBookmarkedQuestion.isDisabled(), !canReturnWithinFirstGroup,
      'Review navigation matches whether the bookmarked question is inside the current group');
    if (canReturnWithinFirstGroup) {
      await earlierBookmarkedQuestion.click();
      await expectQuestion(student, firstRange.start);
    }
    await student.getByRole('button', { name: 'Review', exact: true }).click();
    if (canReturnWithinFirstGroup) {
      await student.getByRole('button', { name: 'Next', exact: true }).click();
      await expectQuestion(student, firstRange.start + 1);
    }
    await advanceQuestions(student, firstRange.start + 1, firstRange.end, verifyDrawingOnQuestion);
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    const sectionBoundaryDialog = student.getByRole('dialog');
    await sectionBoundaryDialog.getByText('Submit the current section before moving to the next section.', { exact: true }).waitFor();
    await sectionBoundaryDialog.getByRole('button', { name: 'Stay Here', exact: true }).click();
    await expectQuestion(student, firstRange.end);

    await student.getByRole('button', { name: 'Review', exact: true }).click();
    const firstSectionReview = student.locator('.review-panel');
    await assertReviewCount(firstSectionReview, 'Not Answered', 0);
    const unopenedQuestion = reviewQuestion(firstSectionReview, secondRange.start);
    if (await unopenedQuestion.count()) {
      assert.equal(await unopenedQuestion.isDisabled(), true,
        `Review may list an unopened section question only as locked; current=${await student.locator('.question-number').innerText()}, section=${await student.locator('.section-name').innerText()}, item=${await unopenedQuestion.innerText()}`);
    }
    await student.getByRole('button', { name: 'Review', exact: true }).click();

    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.waitForFunction(() => document.querySelector('.exam-transition-card__button'));
    const staleSectionSubmit = await student.evaluate(async ({ id, sectionCode }) => {
      const csrf = await (await fetch('/api/auth/csrf')).json();
      const response = await fetch(`/api/student/attempts/${id}/sections/submit`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'X-XSRF-TOKEN': csrf.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionCode }),
      });
      return { status: response.status, body: await response.text() };
    }, { id: attemptId, sectionCode: firstSection });
    assert.equal(staleSectionSubmit.status, 409, 'retrying the previous section submission cannot submit the next section');
    const activeAttempt = await api(student, `/api/student/attempts/${attemptId}`);
    assert.equal(activeAttempt.progressState.currentSection, secondSection.toUpperCase(),
      'the stale retry leaves the attempt in the next section');
    const firstSectionAnswer = activeAttempt.questions.find(question => Number(question.displayNumber) === firstRange.start);
    const staleAnswerWrite = await student.evaluate(async ({ id, itemId }) => {
      const csrf = await (await fetch('/api/auth/csrf')).json();
      const response = await fetch(`/api/student/attempts/${id}/answers/${itemId}`, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'X-XSRF-TOKEN': csrf.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: { value: '__stale_section_write__' }, timeSpentSeconds: 0 }),
      });
      return { status: response.status, body: await response.text() };
    }, { id: attemptId, itemId: firstSectionAnswer.paperItemId });
    assert.equal(staleAnswerWrite.status, 409, 'the API rejects answer changes after a section is submitted');
    const afterStaleWrite = await api(student, `/api/student/attempts/${attemptId}`);
    assert.deepEqual(afterStaleWrite.questions.find(question => Number(question.displayNumber) === firstRange.start).answer,
      firstSectionAnswer.answer, 'a rejected write preserves the submitted section answer');
    await student.locator('.exam-transition-card__button').click();
    await expectQuestion(student, secondRange.start);
    await student.getByRole('button', { name: 'Review', exact: true }).click();
    const reviewPanel = student.locator('.review-panel');
    await assertReviewCount(reviewPanel, 'Current Range', 100);
    await assertReviewCount(reviewPanel, 'Not Answered', 50);
    await reviewPanel.locator('.stat-item').filter({ hasText: 'Not Answered' }).click();
    assert.equal(await reviewQuestion(reviewPanel, secondRange.start).isDisabled(), false,
      'the first question in the newly opened section is selectable from the unanswered filter');
    await reviewPanel.getByRole('button', { name: /Bookmarks/ }).click();
    await reviewQuestion(reviewPanel, firstRange.start).waitFor();
    assert.equal(await reviewPanel.locator('.question-item').count(), 1,
      'the bookmark filter excludes unmarked questions in the current section');
    await student.screenshot({ path: `/tmp/shsat-bookmark-review-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const mobileReviewSize = await student.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.ok(mobileReviewSize.pageWidth <= mobileReviewSize.viewportWidth,
      `the mobile Review panel has no horizontal overflow: ${JSON.stringify(mobileReviewSize)}`);
    await student.screenshot({ path: `/tmp/shsat-bookmark-review-mobile-${stamp}.png` });
    const mobileToolbar = student.locator('.exam-toolbar');
    const maxToolbarScroll = await mobileToolbar.evaluate(element => element.scrollWidth - element.clientWidth);
    assert.ok(maxToolbarScroll > 0, 'the narrow-screen exam toolbar exposes horizontal scrolling when needed');
    const submitButton = student.locator('.submit-exam-button');
    await mobileToolbar.evaluate(element => {
      const button = element.querySelector('.submit-exam-button');
      const buttonRect = button.getBoundingClientRect();
      const toolbarRect = element.getBoundingClientRect();
      element.scrollLeft += Math.max(0, buttonRect.right - toolbarRect.right + 4);
    });
    const submitBounds = await submitButton.boundingBox();
    const toolbarBounds = await mobileToolbar.boundingBox();
    assert.ok(submitBounds && toolbarBounds
      && submitBounds.x >= toolbarBounds.x - 1
      && submitBounds.x + submitBounds.width <= toolbarBounds.x + toolbarBounds.width + 1,
    `the final exam action becomes visible inside the mobile toolbar after horizontal scrolling: ${JSON.stringify({ submitBounds, toolbarBounds, maxToolbarScroll })}`);
    await student.screenshot({ path: `/tmp/shsat-exam-toolbar-mobile-actions-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 900 });
    await reviewPanel.getByRole('button', { name: /Current Range/ }).click();
    await student.getByRole('button', { name: 'Review', exact: true }).click();
    await advanceQuestions(student, secondRange.start, secondRange.end, verifyDrawingOnQuestion);
    if (firstGroupBoundary !== null) assert.ok(lockedGroupVerified, 'earlier question groups stay locked after advancing');
    assert.ok(drawingVerified, 'the drawing tools were tested on an actual SHSAT material question');

    await student.getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();
    const report = await api(student, `/api/student/attempts/${attemptId}/report`);
    const submittedAttempt = await api(student, `/api/student/attempts/${attemptId}`);
    const adminReport = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    const duplicateSubmission = await student.evaluate(async id => {
      const csrf = await (await fetch('/api/auth/csrf')).json();
      const response = await fetch(`/api/student/attempts/${id}/submit`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-XSRF-TOKEN': csrf.token },
      });
      return { status: response.status, body: await response.text() };
    }, attemptId);
    assert.equal(duplicateSubmission.status, 200, 'retrying final submission returns the saved attempt result');
    const repeatedAttempt = JSON.parse(duplicateSubmission.body);
    assert.equal(repeatedAttempt.status, 'SUBMITTED', 'a repeated submit does not reopen or duplicate the attempt');
    assert.equal(repeatedAttempt.submittedAt, submittedAttempt.submittedAt,
      'repeated submission preserves the original submission timestamp');
    assert.equal(repeatedAttempt.result.totalPoints, submittedAttempt.result.totalPoints,
      'repeated submission preserves the saved score');
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
        `${secondSection} submit and final report`, 'stale section submit and answer writes are rejected',
        'repeated final submission is idempotent', 'bookmark filters and locked Review navigation',
        'question navigation respects section boundaries', 'keyboard Next/Previous navigation and drawing retention within the active session',
        'drawing pen color, real stroke rendering, and clearing',
        '100 question results and 50/50 section maxima', 'student/admin report answer counts reconcile', '390px report layout'],
      firstSection, attemptId, correctCount: adminReport.correctCount, wrongCount: adminReport.wrongCount, mobileSize, drawingMobileSize,
      pageErrors: pageErrors.length,
      screenshots: drawingScreenshots,
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

function flattenSections(sections = []) {
  return sections.flatMap(section => [section, ...flattenSections(section.children || [])]);
}

async function advanceQuestions(page, firstQuestion, lastQuestion, beforeAnswer = async () => {}) {
  for (let questionNumber = firstQuestion; questionNumber < lastQuestion; questionNumber += 1) {
    await beforeAnswer(questionNumber);
    await answerCurrentQuestion(page);
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await page.waitForFunction(() => document.querySelector('button[aria-label="Next"]')?.disabled === false);
    assert.equal(await next.isEnabled(), true, `Next is enabled on question ${questionNumber}`);
    await next.click();
    await expectQuestion(page, questionNumber + 1);
  }
  await beforeAnswer(lastQuestion);
  await answerCurrentQuestion(page);
}

async function verifyDrawing(page, stamp) {
  await page.getByRole('button', { name: 'Pen Color', exact: true }).click();
  await page.locator('.tool-color-menu').getByRole('button', { name: 'Blue', exact: true }).click();
  const drawingLayer = page.locator('.drawing-layer');
  await drawingLayer.waitFor();
  const drawingBounds = await drawingLayer.boundingBox();
  assert.ok(drawingBounds && drawingBounds.width > 20 && drawingBounds.height > 20,
    'the drawing layer covers the material workspace');
  await page.mouse.move(drawingBounds.x + 20, drawingBounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(drawingBounds.x + 60, drawingBounds.y + 40, { steps: 3 });
  await page.mouse.up();
  const drawingStroke = page.locator('.drawing-stroke');
  await drawingStroke.waitFor();
  assert.equal(await drawingStroke.getAttribute('stroke'), '#2266c7', 'the selected pen color is used for the real drawing stroke');
  assert.match(await drawingStroke.getAttribute('d'), /L/, 'the drawing stores a visible line path');
  const desktopScreenshot = `/tmp/shsat-exam-drawing-desktop-${stamp}.png`;
  const mobileScreenshot = `/tmp/shsat-exam-drawing-mobile-${stamp}.png`;
  await page.screenshot({ path: desktopScreenshot });
  await page.setViewportSize({ width: 390, height: 844 });
  const viewport = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(viewport.page <= viewport.width, 'the exam drawing interface fits a 390px viewport');
  await page.screenshot({ path: mobileScreenshot });
  await page.setViewportSize({ width: 1440, height: 900 });
  const questionNumber = Number((await page.locator('.question-number').innerText()).match(/\d+/)?.[0]);
  const nextButton = page.getByRole('button', { name: 'Next', exact: true });
  await nextButton.focus();
  await page.keyboard.press('Enter');
  await expectQuestion(page, questionNumber + 1);
  const previousButton = page.getByRole('button', { name: 'Previous', exact: true });
  await previousButton.focus();
  await page.keyboard.press('Enter');
  await expectQuestion(page, questionNumber);
  assert.ok(await drawingStroke.count() > 0,
    'keyboard navigation returns to the material question without dropping its in-session drawing');
  await page.getByRole('button', { name: 'Pen Color', exact: true }).click();
  await page.locator('.tool-color-menu').getByRole('button', { name: 'Clear Drawing', exact: true }).click();
  assert.equal(await page.locator('.drawing-stroke').count(), 0, 'Clear Drawing removes the current question strokes');
  return { mobileSize: viewport, screenshots: [desktopScreenshot, mobileScreenshot] };
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

async function assertReviewCount(panel, label, expected) {
  const stat = panel.locator('.stat-item').filter({ hasText: label });
  await stat.waitFor();
  assert.equal((await stat.locator('.stat-number').innerText()).trim(), String(expected),
    `${label} review count matches the saved attempt state`);
}

function reviewQuestion(panel, questionNumber) {
  return panel.locator('.question-item').filter({ hasText: new RegExp(`^Question ${questionNumber}(?!\\d)`) });
}

async function expectQuestion(page, questionNumber) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const currentQuestionNumbers = await page.locator('.question-number').evaluateAll(elements => elements
      .filter(element => element.getClientRects().length)
      .map(element => element.textContent.trim()));
    if (currentQuestionNumbers.some(label => Number(label.match(/^Question\s+(\d+)\b/)?.[1]) === Number(questionNumber))) return;

    const transitionButton = page.locator('.exam-transition-page .exam-transition-card__button');
    if (await transitionButton.isVisible().catch(() => false)) {
      await transitionButton.click();
    } else {
      await page.waitForTimeout(250);
    }
  }
  const currentQuestion = await page.locator('.question-number').allTextContents().catch(() => []);
  const visibleText = (await page.locator('body').innerText()).slice(-1000);
  throw new Error(`Expected Question ${questionNumber}, current is ${JSON.stringify(currentQuestion)}; ${visibleText}`);
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
