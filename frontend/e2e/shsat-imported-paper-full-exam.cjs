const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const sourcePaperId = Number(process.env.E2E_IMPORTED_PAPER_ID || 244);
const expectedQuestionTypesByPaper = {
  244: [
    'MULTIPLE_CHOICE', 'MULTI_SELECT', 'DRAG_AND_DROP', 'HOT_TEXT', 'TABLE_GRID',
    'FILL_IN_BLANK', 'EQUATION_EDITOR', 'INLINE_CHOICE', 'MULTI_SELECT_FIXED', 'SOLUTION_SET',
  ],
  248: [
    'MULTIPLE_CHOICE', 'DRAG_AND_DROP', 'EQUATION_EDITOR', 'FILL_IN_BLANK',
    'GRAPH_QUESTION', 'INLINE_CHOICE', 'MULTI_SELECT_FIXED', 'SOLUTION_SET',
  ],
};
const expectedQuestionTypes = expectedQuestionTypesByPaper[sourcePaperId];

if (!expectedQuestionTypes) {
  throw new Error(`Paper ${sourcePaperId} is not configured for the imported-paper full exam test.`);
}

if (!adminUsername || !adminPassword) {
  throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');
}

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
  const username = `shsat_imported_${stamp}`;
  const password = `Imported${stamp}!`;
  const title = `Imported SHSAT Full Exam ${stamp}`;
  const screenshotPrefix = `/tmp/shsat-imported-paper-${sourcePaperId}-${stamp}`;
  let userId;
  let classId;
  let examId;
  let attemptId;
  let paperId = sourcePaperId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Imported SHSAT ${stamp}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);

    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Imported SHSAT ${stamp}`, description: 'Temporary imported-paper full exam test', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const sourcePaper = await api(admin, `/api/admin/papers/${sourcePaperId}`);
    if (sourcePaper.summary.status === 'DRAFT') {
      const version = await api(admin, `/api/admin/papers/${sourcePaperId}/versions`, 'POST');
      paperId = Number(version.summary.id);
      await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');
    }

    const paper = await api(admin, `/api/admin/papers/${paperId}`);
    assert.equal(paper.summary.status, 'READY');
    assert.equal(paper.summary.questionCount, 100);
    const questions = flattenSections(paper.sections);
    assert.equal(questions.length, 100);
    assert.deepEqual([...new Set(questions.map(question => question.questionTypeCode))].sort(), [...expectedQuestionTypes].sort());
    const realGraphQuestion = questions.find(question => question.questionTypeCode === 'GRAPH_QUESTION');
    const realGraphQuestionNumber = Number(realGraphQuestion?.displayNumber) || null;
    if (sourcePaperId === 248) {
      assert.ok(realGraphQuestion, 'source paper 248 retains its authentic imported Graph Question');
      assert.match(realGraphQuestion.stem, /When a student buys 4 notebooks/,
        'the source Graph Question keeps its original prompt');
    }

    const release = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary imported-paper 100-question exam test',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      durationSeconds: 10_800, attemptLimit: 1, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const card = student.locator('.student-exam-list article.paper-row').filter({ hasText: title });
    await card.getByRole('button', { name: /Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();

    const attemptRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const attempt = await (await attemptRequest).json();
    attemptId = Number(attempt.id || attempt.attemptId);
    assert.ok(attemptId > 0, 'starting the published exam creates one student attempt');
    await student.locator('.exam-transition-card__button').click();

    const questionByNumber = new Map(questions.map(question => [Number(question.displayNumber), question]));
    for (let questionNumber = 1; questionNumber <= 100; questionNumber += 1) {
      await expectQuestion(student, questionNumber);
      const question = questionByNumber.get(questionNumber);
      await answerQuestion(student, question);
      if ([2, 56, 87].includes(questionNumber) || question.questionTypeCode === 'GRAPH_QUESTION') {
        if (question.questionTypeCode === 'GRAPH_QUESTION') {
          const graph = student.locator('.graph-plot__svg');
          await graph.scrollIntoViewIfNeeded();
          await graph.screenshot({ path: `${screenshotPrefix}-question-${questionNumber}-graph.png` });
        }
        await student.screenshot({
          path: `${screenshotPrefix}-question-${questionNumber}.png`,
        });
      }

      if (questionNumber === 50) {
        await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
        await student.getByRole('dialog').getByRole('button', { name: 'Submit Section', exact: true }).click();
        await student.waitForFunction(() => document.querySelector('.exam-transition-card__button'));
        await student.locator('.exam-transition-card__button').click();
      } else if (questionNumber < 100) {
        await student.waitForFunction(() => document.querySelector('button[aria-label="Next"]')?.disabled === false);
        await student.getByRole('button', { name: 'Next', exact: true }).click();
      }
    }

    await student.getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();
    const report = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    assert.equal(report.questions.length, 100);
    assert.equal(report.correctCount, 100, 'all imported answer structures grade against their current answer keys');
    assert.equal(report.wrongCount, 0);
    assert.equal(report.unansweredCount, 0);
    assert.equal(report.totalScore, 100);
    assert.equal(report.compositeScore, 720);
    assert.equal(report.elaRawScore, 50);
    assert.equal(report.mathRawScore, 50);
    const reportImageCount = report.questions.filter(question => question.assetUrl).length;
    if (sourcePaperId === 248) {
      assert.ok(reportImageCount > 0, 'linked imported image materials are returned with student report questions');
      await student.locator('.question-preview__image').evaluateAll(images => {
        images.forEach(image => { image.loading = 'eager'; });
      });
      await student.waitForFunction(() => Array.from(document.querySelectorAll('.question-preview__image'))
        .some(image => image.complete && image.naturalWidth > 0));

      const equationQuestion = questions.find(question => question.questionTypeCode === 'EQUATION_EDITOR');
      assert.ok(equationQuestion, 'the imported paper includes its original Equation Editor question');
      const equationRow = student.locator('.question-table tbody tr').filter({
        hasText: `Question ${equationQuestion.displayNumber}`,
      });
      const submittedEquation = await equationRow.locator('.question-table__answer-component').first().innerText();
      assert.doesNotMatch(submittedEquation, /\\(?:frac|sqrt|left|right)/,
        'the report renders an equation answer without exposing raw LaTeX commands');

      const graphResult = report.questions.find(question => question.questionType === 'GRAPH_QUESTION');
      assert.ok(graphResult, 'the admin report includes the source Graph Question result');
      assert.equal(graphResult.correct, true, 'the real graph response is scored as correct');
      assert.equal(graphResult.score, graphResult.maxScore, 'the graph result receives the full item score');
      assert.deepEqual(JSON.parse(graphResult.answerData).selectedPointIds.sort(),
        ['p2', 'p6'], 'the student saves the two correct source point IDs');
    }

    await student.screenshot({ path: `${screenshotPrefix}-report-desktop.png`, fullPage: true });
    await student.evaluate(() => {
      window.__shsatPrintRequested = false;
      window.print = () => { window.__shsatPrintRequested = true; };
    });
    await student.getByRole('button', { name: 'Print Report', exact: true }).click();
    assert.equal(await student.evaluate(() => window.__shsatPrintRequested), true,
      'the imported full-exam report opens the browser print flow');
    const reportPdf = await student.pdf({ format: 'Letter', printBackground: true });
    assert.equal(reportPdf.subarray(0, 5).toString(), '%PDF-', 'the full-exam report produces a PDF document');
    assert.ok(reportPdf.byteLength > 30_000,
      `the full-exam report PDF contains all question details (${reportPdf.byteLength} bytes)`);
    const reportPdfPath = `/tmp/shsat-imported-paper-report-${stamp}.pdf`;
    await fs.writeFile(reportPdfPath, reportPdf);

    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, `the report fits a 390px viewport: ${JSON.stringify(mobileSize)}`);
    await student.screenshot({ path: `${screenshotPrefix}-report-mobile.png`, fullPage: true });
    assert.deepEqual(pageErrors, [], 'the imported exam and report have no browser errors');

    console.log(JSON.stringify({
      result: 'PASS', attemptId, correct: report.correctCount, total: report.questions.length,
      sourcePaperId, questionTypes: expectedQuestionTypes, mobileSize, pageErrors: pageErrors.length,
      reportImageCount,
      temporaryPaperId: paperId === sourcePaperId ? null : paperId,
      reportPdf: reportPdfPath, reportPdfBytes: reportPdf.byteLength,
      screenshots: [
        `${screenshotPrefix}-question-2.png`, `${screenshotPrefix}-question-56.png`,
        `${screenshotPrefix}-question-87.png`,
        ...(realGraphQuestionNumber ? [`${screenshotPrefix}-question-${realGraphQuestionNumber}-graph.png`] : []),
        `${screenshotPrefix}-report-desktop.png`, `${screenshotPrefix}-report-mobile.png`,
      ],
    }));
  } finally {
    const cleanupErrors = [];
    const removeTestRecord = async (path) => {
      try {
        await api(admin, path, 'DELETE');
      } catch (error) {
        cleanupErrors.push(`${path}: ${error.message}`);
      }
    };
    if (examId) await removeTestRecord(`/api/admin/exams/${examId}`);
    if (paperId !== sourcePaperId) await removeTestRecord(`/api/admin/papers/${paperId}`);
    if (classId && userId) await removeTestRecord(`/api/admin/classes/${classId}/students/${userId}`);
    if (classId) await removeTestRecord(`/api/admin/classes/${classId}?examTypeCodes=SHSAT`);
    if (userId) await removeTestRecord(`/api/admin/users/${userId}`);
    await studentContext.close();
    await adminContext.close();
    await browser.close();
    assert.deepEqual(cleanupErrors, [], 'all temporary imported-exam records are removed');
  }
}

// 题目按导入卷原始键作答；完整流程由考生 UI 驱动，提交后再用管理员报告核对判分。
async function answerQuestion(page, question) {
  assert.ok(question, 'the paper contains the current question');
  const answerKey = question.answerKey || {};
  const options = question.render?.options || [];
  const config = question.render?.questionConfig || {};

  if (['MULTIPLE_CHOICE', 'MULTI_SELECT', 'MULTI_SELECT_FIXED'].includes(question.questionTypeCode)) {
    const selectedKeys = answerKey.answers || [];
    const answerOptions = page.locator('.choice-answer__option');
    for (const key of selectedKeys) {
      const index = options.findIndex(option => String(option.key) === String(key));
      assert.ok(index >= 0, `question ${question.displayNumber} has answer option ${key}`);
      await answerOptions.nth(index).click();
    }
    return;
  }

  if (question.questionTypeCode === 'TABLE_GRID') {
    const rows = config.rows || [];
    const columns = config.columns || [];
    const correctAnswers = answerKey.answers || answerKey.cells || {};
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const rowAnswer = correctAnswers[rows[rowIndex].id];
      const columnId = Array.isArray(rowAnswer) ? rowAnswer[0] : rowAnswer;
      const columnIndex = columns.findIndex(column => column.id === columnId);
      assert.ok(columnIndex >= 0, `question ${question.displayNumber} has a correct column for each row`);
      await page.locator('.table-grid-answer tbody tr').nth(rowIndex)
        .locator('.table-grid-answer__choice').nth(columnIndex).click();
    }
    return;
  }

  if (question.questionTypeCode === 'DRAG_AND_DROP') {
    const placements = answerKey.placements || {};
    const inlineGapParts = (config.contentParts || []).filter(part => part.type === 'gap');
    for (const [targetId, choiceIds] of Object.entries(placements)) {
      const targetIndex = (config.targets || []).findIndex(target => target.id === targetId);
      assert.ok(targetIndex >= 0, `question ${question.displayNumber} has target ${targetId}`);
      const inlineGapIndex = inlineGapParts.findIndex(part => part.id === targetId);
      const target = config.mode === 'inline_gap_match'
        ? page.locator('.drag-answer__gap').nth(inlineGapIndex)
        : page.locator('.drag-answer__target').nth(targetIndex);
      assert.ok(config.mode !== 'inline_gap_match' || inlineGapIndex >= 0,
        `question ${question.displayNumber} renders inline target ${targetId}`);
      for (const choiceId of choiceIds) {
        const choice = (config.choices || []).find(item => item.id === choiceId);
        assert.ok(choice, `question ${question.displayNumber} has choice ${choiceId}`);
        await page.locator('.drag-answer__choice').getByText(choice.text.trim(), { exact: true }).click();
        if (config.mode === 'inline_gap_match') await target.click();
        else await target.locator('.drag-answer__target-label').click();
        const placedChoice = config.mode === 'inline_gap_match'
          ? target.filter({ hasText: choice.text.trim() })
          : target.locator('.drag-answer__placed-choice').filter({ hasText: choice.text.trim() });
        await placedChoice.waitFor();
      }
    }
    return;
  }

  if (question.questionTypeCode === 'HOT_TEXT') {
    const segmentId = answerKey.selectedSegmentIds?.[0];
    const segment = (config.contentParts || []).find(part => part.id === segmentId);
    assert.ok(segment, `question ${question.displayNumber} has the correct selectable segment`);
    await page.locator('.hot-text-answer__segment').filter({ hasText: segment.text.trim() }).click();
    return;
  }

  if (question.questionTypeCode === 'EQUATION_EDITOR') {
    const acceptedAnswer = answerKey.acceptedAnswers?.[0]?.value;
    assert.ok(acceptedAnswer, `question ${question.displayNumber} has an accepted equation`);
    await page.locator('math-field').evaluate((field, value) => {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, acceptedAnswer);
    return;
  }

  if (question.questionTypeCode === 'INLINE_CHOICE') {
    const correctAnswers = answerKey.answers || {};
    const blanks = config.blanks || [];
    const selects = page.locator('.inline-choice-answer .rich-select__trigger');
    for (let index = 0; index < blanks.length; index += 1) {
      const blank = blanks[index];
      const optionIndex = blank.options.findIndex(option => option.key === correctAnswers[blank.id]);
      assert.ok(optionIndex >= 0, `question ${question.displayNumber} has an option for ${blank.id}`);
      await selects.nth(index).click();
      await page.getByRole('option').nth(optionIndex).click();
    }
    return;
  }

  if (question.questionTypeCode === 'FILL_IN_BLANK') {
    await page.locator('.fill-blank-input').first().fill(String(answerKey.answers?.[0]));
    return;
  }

  if (question.questionTypeCode === 'SOLUTION_SET') {
    const solution = answerKey.solution;
    const rayName = `${solution.endpointIncluded ? 'Closed' : 'Open'} ${solution.direction} ray`;
    await page.locator('.solution-answer__ray-button').filter({ hasText: rayName }).click();
    await page.locator('.solution-line__tick')
      .filter({ hasText: new RegExp(`^${solution.endpoint}$`) }).locator('.solution-line__hit').click();
    return;
  }

  if (question.questionTypeCode === 'GRAPH_QUESTION') {
    const correctPointIds = answerKey.selectedPointIds || [];
    const graphPoints = config.points || [];
    for (const pointId of correctPointIds) {
      const pointIndex = graphPoints.findIndex(point => String(point.id) === String(pointId));
      assert.ok(pointIndex >= 0, `question ${question.displayNumber} has candidate point ${pointId}`);
      const candidate = page.locator('.graph-plot__point').nth(pointIndex);
      await candidate.click();
      await candidate.waitFor({ state: 'visible' });
      assert.equal(await candidate.getAttribute('aria-pressed'), 'true',
        `question ${question.displayNumber} selects candidate point ${pointId}`);
    }
    return;
  }

  throw new Error(`Unsupported imported question type ${question.questionTypeCode}`);
}

// 自动处理分段过渡界面，只在预期题号真正显示时返回。
async function expectQuestion(page, questionNumber) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const labels = await page.locator('.question-number').evaluateAll(elements => elements
      .filter(element => element.getClientRects().length)
      .map(element => element.textContent.trim()));
    if (labels.some(label => Number(label.match(/^Question\s+(\d+)\b/)?.[1]) === questionNumber)) return;

    const transition = page.locator('.exam-transition-page .exam-transition-card__button');
    if (await transition.isVisible().catch(() => false)) await transition.click();
    else await page.waitForTimeout(250);
  }
  const labels = await page.locator('.question-number').allTextContents().catch(() => []);
  throw new Error(`Expected Question ${questionNumber}; current labels: ${JSON.stringify(labels)}`);
}

function flattenSections(sections = []) {
  return sections.flatMap(section => [...(section.questions || []), ...flattenSections(section.children || [])]);
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

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
