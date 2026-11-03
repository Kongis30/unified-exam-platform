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
  const username = `shsat_hotspot_${stamp}`;
  const password = `HotSpot${stamp}!`;
  const title = `Hot Spot Flow ${suffix}`;
  let userId;
  let classId;
  let paperId;
  let examId;
  let attemptId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Hot Spot Student ${suffix}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Hot Spot ${suffix}`, description: 'Temporary Hot Spot question flow test', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const paper = await api(admin, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `HOT_SPOT_FLOW_${stamp}`, title, description: 'Temporary Hot Spot interaction and scoring test',
      groupId: null, defaultDurationSeconds: 600,
    });
    paperId = Number(paper.summary.id);
    await api(admin, `/api/admin/papers/${paperId}/structure`, 'PUT', { sections: makeSections() });
    await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');

    const release = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary Hot Spot question flow test',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 600, attemptLimit: 1, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await installFullscreenMock(student);
    const card = student.locator('.student-exam-list article.paper-row').filter({ hasText: title });
    await card.getByRole('button', { name: /Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
    const startRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const startResponse = await startRequest;
    assert.equal(startResponse.status(), 200);
    const started = await startResponse.json();
    attemptId = Number(started.id || started.attemptId);

    await student.locator('.exam-transition-card__button').click();
    await student.getByText('Choose the correct language answer.', { exact: true }).waitFor();
    await verifyToolbarKeyboardTraversal(student);
    const toolbarScreenshots = await verifyExamToolbar(student, stamp);
    await student.locator('.choice-answer__option').first().click();
    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.waitForFunction(() => document.querySelector('.exam-transition-card__button'));
    await student.locator('.exam-transition-card__button').click();
    await student.getByText('Click the correct area in the image.', { exact: true }).waitFor();
    await student.locator('.hot-spot-answer__stage img').waitFor({ state: 'visible' });
    await student.waitForFunction(() => {
      const image = document.querySelector('.hot-spot-answer__stage img');
      return image?.complete && image.naturalWidth === 320;
    });
    await student.locator('.material-display__image-button').click();
    const materialImageDialog = student.getByRole('dialog', { name: 'Material image preview' });
    await materialImageDialog.waitFor();
    const materialPreviewImage = materialImageDialog.locator('img');
    const imagePreviewDesktopScreenshot = `/tmp/shsat-student-image-preview-${stamp}.png`;
    await student.screenshot({ path: imagePreviewDesktopScreenshot });
    await student.setViewportSize({ width: 390, height: 844 });
    const imagePreviewMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(imagePreviewMobileSize.page <= imagePreviewMobileSize.viewport,
      `the student image preview fits a 390px viewport: ${JSON.stringify(imagePreviewMobileSize)}`);
    const imagePreviewDialogWidth = await materialImageDialog.evaluate(element => element.getBoundingClientRect().width);
    assert.ok(imagePreviewDialogWidth <= 390, 'the student image preview dialog fits a 390px viewport');
    const imagePreviewMobileScreenshot = `/tmp/shsat-student-image-preview-mobile-${stamp}.png`;
    await student.screenshot({ path: imagePreviewMobileScreenshot });
    await student.setViewportSize({ width: 1440, height: 900 });
    await materialImageDialog.getByRole('button', { name: 'Zoom In', exact: true }).click();
    assert.match(await materialPreviewImage.getAttribute('style'), /scale\(1\.6\)/,
      'the student exam image preview can be enlarged');
    const materialPreviewBounds = await materialPreviewImage.boundingBox();
    assert.ok(materialPreviewBounds, 'the enlarged student material image can be dragged');
    await student.mouse.move(materialPreviewBounds.x + 35, materialPreviewBounds.y + 30);
    await student.mouse.down();
    await student.mouse.move(materialPreviewBounds.x + 75, materialPreviewBounds.y + 65, { steps: 3 });
    await student.mouse.up();
    const pannedMaterialImageStyle = await materialPreviewImage.getAttribute('style');
    assert.match(pannedMaterialImageStyle, /translate3d\((?!0px, 0px)[^)]+\) scale\(1\.6\)/,
      `dragging pans the student material image without zooming it again: ${pannedMaterialImageStyle}`);
    await materialImageDialog.getByRole('button', { name: 'Reset', exact: true }).click();
    assert.match(await materialPreviewImage.getAttribute('style'), /translate3d\(0px, 0px, 0px\) scale\(1\)/,
      'Reset restores the student image position and zoom');
    await materialImageDialog.getByRole('button', { name: 'Close image preview', exact: true }).click();
    await materialImageDialog.waitFor({ state: 'detached' });
    await verifyDrawingTool(student);

    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the Hot Spot exam fits a 390px viewport');
    const target = student.getByRole('button', { name: 'Target area', exact: true });
    await target.click();
    assert.equal(await target.getAttribute('aria-pressed'), 'true', 'the target area can be selected on mobile');
    await student.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await target.getAttribute('aria-pressed'), 'false', 'Clear removes a Hot Spot selection');
    await target.click();
    await student.screenshot({ path: `/tmp/shsat-hotspot-active-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 900 });
    await student.screenshot({ path: `/tmp/shsat-hotspot-active-${stamp}.png` });

    const attempt = await api(student, `/api/student/attempts/${attemptId}`);
    const hotspotItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'HOT_SPOT');
    assert.ok(hotspotItem, 'the active attempt contains the configured Hot Spot item');
    const answerSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${hotspotItem.paperItemId || hotspotItem.id}`)
      && response.request().method() === 'PUT');
    await student.getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    assert.equal((await answerSave).status(), 200, 'the selected region is saved before final submission');
    await student.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);

    const report = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    assert.equal(report.totalScore, 2, 'ELA choice and Hot Spot each receive one point');
    assert.deepEqual(report.questions.map(question => [question.questionType, question.correct]), [
      ['MULTIPLE_CHOICE', true], ['HOT_SPOT', true],
    ]);
    const answer = report.questions.find(question => question.questionType === 'HOT_SPOT');
    assert.deepEqual(JSON.parse(answer.answerData).selectedRegionIds, ['target-region']);

    await api(admin, `/api/admin/exams/${examId}/close`, 'POST');
    const studentReport = await api(student, `/api/student/attempts/${attemptId}/report`);
    assert.equal(studentReport.answersVisible, true);
    assert.equal(studentReport.questions.find(question => question.questionType === 'HOT_SPOT').correct, true);
    await student.reload();
    await student.getByText('Result Summary', { exact: true }).waitFor();
    const hotspotReportRow = student.locator('.question-table tbody tr').filter({ hasText: 'Hot Spot' });
    await hotspotReportRow.waitFor();
    await hotspotReportRow.getByText('Target area', { exact: true }).first().waitFor();
    await student.screenshot({ path: `/tmp/shsat-hotspot-report-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const reportMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(reportMobileSize.page <= reportMobileSize.viewport, 'the Hot Spot report fits a 390px viewport');
    await hotspotReportRow.scrollIntoViewIfNeeded();
    await student.screenshot({ path: `/tmp/shsat-hotspot-report-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, [], 'the Hot Spot exam and report have no browser errors');

    console.log(JSON.stringify({
      result: 'PASS', score: report.totalScore, mobileSize, reportMobileSize, pageErrors: pageErrors.length,
      screenshots: [imagePreviewDesktopScreenshot, imagePreviewMobileScreenshot, ...toolbarScreenshots,
        `/tmp/shsat-hotspot-active-${stamp}.png`, `/tmp/shsat-hotspot-active-mobile-${stamp}.png`,
        `/tmp/shsat-hotspot-report-${stamp}.png`, `/tmp/shsat-hotspot-report-mobile-${stamp}.png`],
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

// 键盘 Tab 顺序按页面上的可操作控件顺序逐一检查，避免只测脚本 focus。
async function verifyToolbarKeyboardTraversal(page) {
  const toolbarButtons = page.locator('.toolbar-tools button');
  const buttonNames = await toolbarButtons.evaluateAll(buttons => buttons
    .filter(button => !button.disabled && button.getClientRects().length > 0)
    .map(button => button.getAttribute('aria-label') || button.title || button.innerText.trim()));
  assert.ok(buttonNames.length > 0, 'the exam toolbar has keyboard-accessible controls');

  await page.getByRole('button', { name: buttonNames[0], exact: true }).focus();
  for (const expectedName of buttonNames.slice(1)) {
    await page.keyboard.press('Tab');
    const focusedName = await page.evaluate(() => {
      const button = document.activeElement;
      return button?.getAttribute('aria-label') || button?.title || button?.innerText?.trim() || '';
    });
    assert.equal(focusedName, expectedName,
      `Tab reaches the next enabled exam tool: expected ${expectedName}, got ${focusedName}`);
  }
}

// SHSAT 考试工具栏回归：确认工具切换只影响显示/标记，不会改写当前答案。
async function verifyExamToolbar(page, stamp) {
  const fullscreen = page.getByRole('button', { name: 'Fullscreen', exact: true });
  assert.equal(await fullscreen.isDisabled(), true, 'Fullscreen cannot be exited from the toolbar during an active exam');
  assert.equal(await fullscreen.getAttribute('title'), 'Fullscreen is required during the exam',
    'the disabled Fullscreen control explains why fullscreen must remain active');

  const bookmark = page.getByRole('button', { name: 'Bookmark', exact: true });
  await bookmark.click();
  assert.match(await bookmark.getAttribute('class'), /active/, 'Bookmark marks the current question');
  await bookmark.focus();
  await bookmark.press('Space');
  assert.doesNotMatch(await bookmark.getAttribute('class'), /active/, 'Space removes the current bookmark');
  await bookmark.press('Enter');
  assert.match(await bookmark.getAttribute('class'), /active/, 'Enter marks the current question again');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Bookmarks', exact: false }).waitFor();
  const bookmarkedQuestion = page.locator('.question-list .question-item').filter({ hasText: 'Question 1' });
  await bookmarkedQuestion.waitFor();
  assert.match(await bookmarkedQuestion.getAttribute('class'), /marked/, 'Review lists the bookmarked question');
  await page.getByRole('button', { name: 'Review', exact: true }).click();

  await page.getByRole('button', { name: 'Notepad', exact: true }).click();
  const notes = page.getByRole('dialog', { name: 'Notes' });
  await notes.locator('textarea').fill('Temporary toolbar note');
  await notes.getByRole('button', { name: 'Close Notes' }).click();
  await notes.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Answer Eliminator', exact: true }).click();
  const incorrectOption = page.locator('.choice-answer__option').filter({ hasText: 'Incorrect answer' });
  await incorrectOption.getByRole('button', { name: 'Cross out this option' }).click();
  assert.match(await incorrectOption.getAttribute('class'), /eliminated/, 'Answer Eliminator crosses out a choice');
  await incorrectOption.getByRole('button', { name: 'Restore this option' }).click();
  assert.doesNotMatch(await incorrectOption.getAttribute('class'), /eliminated/, 'a crossed-out choice can be restored');

  await page.getByRole('button', { name: 'Highlighter', exact: true }).click();
  const questionText = page.locator('.question-text');
  await questionText.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.includes('correct language')) {
        const start = node.textContent.indexOf('correct language');
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 'correct language'.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      }
    }
    throw new Error('Could not locate text for the highlighter check.');
  });
  await page.getByRole('dialog', { name: 'Choose highlight color' }).getByRole('button', { name: 'Highlight Yellow' }).click();
  await questionText.locator('mark.exam-highlight').waitFor();
  await questionText.locator('mark.exam-highlight').click();
  await questionText.locator('mark.exam-highlight').waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Line Reader', exact: true }).click();
  await page.locator('.line-reader__strip').waitFor();
  await page.getByRole('button', { name: 'Line Reader', exact: true }).click();
  await page.locator('.line-reader__strip').waitFor({ state: 'detached' });

  const examShell = page.locator('.exam-question-shell');
  const fontOptions = [['1.0x', '1'], ['1.15x', '1.15'], ['1.3x', '1.3'], ['1.45x', '1.45'], ['1.6x', '1.6']];
  for (const [label, scale] of fontOptions) {
    await page.getByRole('button', { name: 'Font Size', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    assert.equal(await examShell.evaluate(element => getComputedStyle(element).getPropertyValue('--exam-font-scale').trim()),
      scale, `Font Size ${label} applies the expected scale`);
  }

  const widthOptions = [['Normal', 'normal'], ['Wide', 'wide'], ['Extra Wide', 'ultra-wide']];
  for (const [label, mode] of widthOptions) {
    await page.getByRole('button', { name: 'Page Width', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    assert.match(await page.locator('.student-exam').getAttribute('class'), new RegExp(`student-exam--${mode}`),
      `Page Width ${label} applies the expected layout`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Font Size', exact: true }).click();
  const fontMenu = page.locator('.font-selector .tool-dropdown');
  await fontMenu.waitFor();
  assert.deepEqual(await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth })),
    { page: 390, viewport: 390 }, 'the open font menu does not cause mobile page overflow');
  assert.ok(await fontMenu.isVisible(), 'the font menu is visibly rendered on mobile');
  const fontMenuLayout = await fontMenu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const topLeft = document.elementFromPoint(rect.left + 8, rect.top + 8);
    return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility,
      hit: topLeft ? `${topLeft.tagName}.${topLeft.className}` : null,
      visible: rect.width >= 120 && rect.height >= 150
      && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      && (topLeft === element || element.contains(topLeft)) };
  });
  assert.ok(fontMenuLayout.visible, `the complete font menu stays within the mobile viewport: ${JSON.stringify(fontMenuLayout)}`);
  const fontMenuScreenshot = `/tmp/shsat-hotspot-font-menu-mobile-${stamp}.png`;
  await page.screenshot({ path: fontMenuScreenshot });
  await page.getByRole('button', { name: '1.3x', exact: true }).click();

  await page.getByRole('button', { name: 'Page Width', exact: true }).click();
  const widthMenu = page.locator('.width-selector .tool-dropdown');
  await widthMenu.waitFor();
  assert.ok(await widthMenu.isVisible(), 'the page-width menu is visibly rendered on mobile');
  const widthMenuLayout = await widthMenu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const topLeft = document.elementFromPoint(rect.left + 8, rect.top + 8);
    return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      display: getComputedStyle(element).display, visibility: getComputedStyle(element).visibility,
      hit: topLeft ? `${topLeft.tagName}.${topLeft.className}` : null,
      visible: rect.width >= 120 && rect.height >= 90
      && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
      && (topLeft === element || element.contains(topLeft)) };
  });
  assert.ok(widthMenuLayout.visible, `the complete page-width menu stays within the mobile viewport: ${JSON.stringify(widthMenuLayout)}`);
  const widthMenuScreenshot = `/tmp/shsat-hotspot-width-menu-mobile-${stamp}.png`;
  await page.screenshot({ path: widthMenuScreenshot });
  await page.getByRole('button', { name: 'Normal', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.match(await page.locator('.student-exam').getAttribute('class'), /student-exam--normal/);
  return [fontMenuScreenshot, widthMenuScreenshot];
}

// 图片题提供实际绘图层；验证画线、切换笔色及清除都只改变本题批注。
async function verifyDrawingTool(page) {
  await page.getByRole('button', { name: 'Drawing Pen', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Drawing Pen', exact: true });
  assert.match(await pen.getAttribute('class'), /active/, 'Drawing Pen activates the drawing mode');
  const drawingLayer = page.locator('.drawing-layer');
  const bounds = await drawingLayer.boundingBox();
  assert.ok(bounds, 'the passage material exposes a drawing layer');
  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 90, { steps: 3 });
  await page.mouse.up();
  await drawingLayer.locator('.drawing-stroke').waitFor();
  await page.getByRole('button', { name: 'Pen Color', exact: true }).click();
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await page.getByRole('button', { name: 'Pen Color', exact: true }).click();
  await page.getByRole('button', { name: 'Clear Drawing', exact: true }).click();
  await drawingLayer.locator('.drawing-stroke').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Pointer', exact: true }).click();
  assert.doesNotMatch(await pen.getAttribute('class'), /active/, 'Pointer returns the toolbar to normal interaction');
}

function makeSections() {
  const passageImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#eef4ff"/><text x="20" y="86" font-size="22" fill="#1e293b">Material image preview</text></svg>')}`;
  return [
    {
      sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0,
      instructions: null, settings: {}, questions: [],
      children: [{
        sectionCode: 'ELA_REVIEW', sectionKind: 'SUBTYPE', title: 'Reading and Writing', sortOrder: 0,
        instructions: null, settings: {}, children: [],
        questions: [{
          questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
          stem: 'Choose the correct language answer.',
          render: { options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Incorrect answer' }], questionConfig: {}, validationRules: {} },
          answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is correct.', categoryId: null,
          sortOrder: 0, displayNumber: 1, maxPoints: 1, scoringSectionCode: 'ELA',
        }],
      }],
    },
    {
      sectionCode: 'MATH', sectionKind: 'PART', title: 'Mathematics', sortOrder: 1,
      instructions: null, settings: {}, questions: [],
      children: [{
        sectionCode: 'MATH_GEOMETRY', sectionKind: 'SUBTYPE', title: 'Geometry', sortOrder: 0,
        instructions: null, settings: {}, children: [],
        questions: [{
          questionTypeCode: 'HOT_SPOT', payloadSchemaVersion: 1,
          stem: 'Select the shaded target area.',
          render: { material: { title: 'Drawing Passage', category: 'Reading Passage', content: `Drawing Passage\n\nA short passage for testing the drawing tool.\n[[MATERIAL_IMAGE:${passageImage}]]` }, questionConfig: {
            selectionMode: 'single',
            imageUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#eef4ff"/><text x="20" y="40" font-size="20" fill="#1e293b">Select the blue square</text><rect x="96" y="96" width="64" height="64" rx="8" fill="#3275f6"/></svg>')}`,
            regions: [{ id: 'target-region', label: 'Target area', shape: 'rect', x: 0.3, y: 0.4, width: 0.2, height: 0.27 }],
          }, validationRules: {} },
          answerKey: { selectedRegionIds: ['target-region'] }, grading: {}, explanation: 'The blue square is the target area.', categoryId: null,
          sortOrder: 0, displayNumber: 58, maxPoints: 1, scoringSectionCode: 'MATH',
        }],
      }],
    },
  ];
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
