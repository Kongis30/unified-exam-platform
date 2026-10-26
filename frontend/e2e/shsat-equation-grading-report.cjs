const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
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
  const username = `shsat_equation_${stamp}`;
  const password = `Equation${stamp}!`;
  const title = `Equation Grade ${suffix}`;
  let userId;
  let classId;
  let paperId;
  let examId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Equation Student ${suffix}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Equation ${suffix}`, description: 'Temporary equation grading report test', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const paper = await api(admin, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `EQUATION_GRADE_${stamp}`, title, description: 'Equation notation parity scoring test',
      groupId: null, defaultDurationSeconds: 1_200,
    });
    paperId = Number(paper.summary.id);
    await api(admin, `/api/admin/papers/${paperId}/structure`, 'PUT', {
      sections: [
        makeChoicePart(),
        {
          sectionCode: 'MATH', sectionKind: 'PART', title: 'Mathematics', sortOrder: 1,
          instructions: null, settings: {}, questions: [],
          children: [{
            sectionCode: 'MATH_EQUATIONS', sectionKind: 'SUBTYPE', title: 'Equations', sortOrder: 0,
            instructions: null, settings: {}, children: [],
            questions: [{
              questionTypeCode: 'EQUATION_EDITOR', payloadSchemaVersion: 1,
              stem: 'Solve the inequality: 8x + 35 ≤ 95.',
              render: { questionConfig: { normalization: { ignoreWhitespace: true, normalizeOperators: true, caseInsensitive: true } }, validationRules: {} },
              answerKey: { acceptedAnswers: [{ value: '8x+35\\le95' }] }, grading: {},
              explanation: 'Subtract 35 and divide by 8.', categoryId: null, sortOrder: 0,
              displayNumber: 58, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'GRAPH_QUESTION', payloadSchemaVersion: 1,
              stem: 'Plot the point (2, 3).',
              render: { questionConfig: {
                graphMode: 'point_graph', showCandidatePoints: false,
                graph: { xMin: -5, xMax: 5, xStep: 1, yMin: -5, yMax: 5, yStep: 1 },
                interaction: { snapToGrid: true },
              }, validationRules: {} },
              answerKey: { points: [{ x: 2, y: 3 }] }, grading: {}, explanation: 'The point is (2, 3).',
              categoryId: null, sortOrder: 1, displayNumber: 59, maxPoints: 1, scoringSectionCode: 'MATH',
            }, {
              questionTypeCode: 'TABLE_GRID', payloadSchemaVersion: 1,
              stem: 'Select the correct value for the item.',
              render: { questionConfig: {
                selectionMode: 'single',
                rows: [{ id: 'item-1', label: 'Item 1' }],
                columns: [{ id: 'no', label: 'No' }, { id: 'yes', label: 'Yes' }],
              }, validationRules: {} },
              answerKey: { answers: { 'item-1': 'yes' } }, grading: {}, explanation: 'Yes is correct.',
              categoryId: null, sortOrder: 2, displayNumber: 60, maxPoints: 1, scoringSectionCode: 'MATH',
            }],
          }],
        },
      ],
    });
    await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');
    const release = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary equation notation parity scoring test',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 1_200, attemptLimit: 1, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
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
    const startRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const startResponse = await startRequest;
    assert.equal(startResponse.status(), 200);
    const started = await startResponse.json();
    const attemptId = Number(started.id || started.attemptId);
    await student.locator('.exam-transition-page .exam-transition-card__button').click();
    await student.getByText('Choose the correct language answer.', { exact: true }).waitFor();
    await student.locator('.choice-answer__option').first().click();
    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.waitForFunction(() => document.querySelector('.exam-transition-card__button'));
    await student.locator('.exam-transition-card__button').click();
    await student.getByText('Solve the inequality: 8x + 35 ≤ 95.', { exact: true }).waitFor();

    const attempt = await api(student, `/api/student/attempts/${attemptId}`);
    const mathItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'EQUATION_EDITOR');
    assert.ok(mathItem, 'the Math equation item is included in the active student attempt');
    const paperItemId = Number(mathItem.paperItemId || mathItem.id);
    await student.locator('math-field').evaluate(field => {
      field.value = '8*x + 35 \\le 95';
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: field.value }));
    });
    const answerSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${paperItemId}`)
      && response.request().method() === 'PUT');
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await answerSave).status(), 200, 'the MathLive equation answer saves before moving to the next question');
    await student.getByText('Plot the point (2, 3).', { exact: true }).waitFor();
    const graphItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'GRAPH_QUESTION');
    assert.ok(graphItem, 'the point graph item is included in the active student attempt');
    const graphItemId = Number(graphItem.paperItemId || graphItem.id);
    const graphSave = student.waitForResponse(response => response.url().endsWith(`/api/student/attempts/${attemptId}/answers/${graphItemId}`)
      && response.request().method() === 'PUT');
    const plot = await student.locator('.graph-plot__svg').boundingBox();
    assert.ok(plot, 'the coordinate graph is rendered for the student');
    await student.locator('.graph-plot__svg').click({
      position: { x: plot.width * (474 / 680), y: plot.height * (112 / 420) },
    });
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal((await graphSave).status(), 200, 'the plotted point is saved before moving to the table grid');
    await student.getByText('Select the correct value for the item.', { exact: true }).waitFor();
    const tableItem = (attempt.items || attempt.questions || []).find(item => item.questionTypeCode === 'TABLE_GRID');
    assert.ok(tableItem, 'the table grid item is included in the active student attempt');
    const correctTableCell = student.locator('.table-grid-answer__cell').filter({ has: student.getByRole('radio', { name: 'Item 1: Yes' }) });
    await correctTableCell.locator('label.table-grid-answer__choice').click();
    assert.equal(await student.getByRole('radio', { name: 'Item 1: Yes' }).isChecked(), true,
      'the visible table-grid choice records the selected answer');
    await student.getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();

    const result = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    assert.equal(result.totalScore, 4, `the ELA choice, Math equation, plotted coordinate, and table-grid answer receive credit; report=${JSON.stringify(result)}`);
    assert.deepEqual(result.questions.map(question => [question.partCode, question.correct]), [
      ['ELA', true], ['MATH', true], ['MATH', true], ['MATH', true],
    ]);
    const studentReport = await api(student, `/api/student/attempts/${attemptId}/report`);
    assert.equal(studentReport.scoreVisible, true, 'SHSAT scores are visible after submission by default, as in the independent system');
    await student.getByText('Raw Total', { exact: true }).waitFor();
    assert.equal(await student.locator('.summary-field').filter({ hasText: 'Raw Total' }).locator('.summary-field__value').textContent(), '4 / 4');
    await student.screenshot({ path: `/tmp/shsat-equation-report-${stamp}.png` });
    await student.evaluate(() => {
      window.__shsatPrintRequested = false;
      window.print = () => { window.__shsatPrintRequested = true; };
    });
    await student.getByRole('button', { name: 'Print Report', exact: true }).click();
    assert.equal(await student.evaluate(() => window.__shsatPrintRequested), true,
      'Print Report opens the browser print flow');
    const reportPdf = await student.pdf({ format: 'Letter', printBackground: true });
    assert.ok(reportPdf.subarray(0, 5).toString() === '%PDF-', 'the report produces a valid PDF document');
    assert.ok(reportPdf.byteLength > 10_000, `the report PDF contains rendered content (${reportPdf.byteLength} bytes)`);
    const reportPdfPath = `/tmp/shsat-equation-report-${stamp}.pdf`;
    await fs.writeFile(reportPdfPath, reportPdf);
    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the equation result report fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-equation-report-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, [], 'the student exam and report have no browser errors');

    console.log(JSON.stringify({
      result: 'PASS', totalScore: result.totalScore, questionResults: result.questions.map(question => [question.partCode, question.correct]),
      mobileSize, pageErrors: pageErrors.length,
      screenshots: [`/tmp/shsat-equation-report-${stamp}.png`, `/tmp/shsat-equation-report-mobile-${stamp}.png`],
      reportPdf: reportPdfPath,
      reportPdfBytes: reportPdf.byteLength,
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

function makeChoicePart() {
  return {
    sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0,
    instructions: null, settings: {}, questions: [],
    children: [{
      sectionCode: 'ELA_REVIEW', sectionKind: 'SUBTYPE', title: 'Reading and Writing', sortOrder: 0,
      instructions: null, settings: {}, children: [],
      questions: [{
        questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
        stem: 'Choose the correct language answer.',
        render: {
          options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Incorrect answer' }],
          questionConfig: {}, validationRules: {},
        },
        answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is correct.', categoryId: null,
        sortOrder: 0, displayNumber: 1, maxPoints: 1, scoringSectionCode: 'ELA',
      }],
    }],
  };
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
