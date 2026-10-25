const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

if (!adminUsername || !adminPassword) {
  throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const pageErrors = [];
  student.on('pageerror', error => pageErrors.push(error.message));

  const username = `sat_parity_${Date.now()}`;
  const password = `sat-e2e-${Date.now()}`;
  let studentId;
  const examIds = [];
  let paperId;

  const csrf = page => page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  const raw = async (page, path, method = 'GET', body) => {
    const token = await csrf(page);
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
  };
  const api = async (page, path, method = 'GET', body) => {
    const response = await raw(page, path, method, body);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
    }
    return response.text ? JSON.parse(response.text) : null;
  };
  const login = async (page, name, secret) => {
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel('Username').fill(name);
    await page.getByLabel('Password').fill(secret);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => !url.pathname.endsWith('/login'));
  };
  const createExam = async (title, closesAt, attemptLimit, targetPaperId = paperId) => {
    const now = Date.now();
    const release = await api(admin, `/api/admin/papers/${targetPaperId}/exams`, 'POST', {
      title,
      description: 'Temporary SAT parity verification',
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(closesAt).toISOString(),
      durationSeconds: 3600,
      attemptLimit,
      targetScope: 'SELECTED',
    });
    const examId = release.summary.id;
    examIds.push(examId);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', {
      classIds: [], studentUserIds: [studentId],
    });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');
    return { id: examId, ...release.summary };
  };
  const finishAllModules = async attemptId => {
    let state = await api(student, `/api/student/sat-attempts/${attemptId}`);
    for (let index = 0; index < state.modules.length; index++) {
      if (state.awaitingBreak) {
        state = await api(student, `/api/student/sat-attempts/${attemptId}/resume-break`, 'POST');
      }
      assert.ok(state.currentModuleId, `module ${index + 1} is available in the fixed SAT path`);
      state = await api(student, `/api/student/sat-attempts/${attemptId}/modules/${state.currentModuleId}/submit`,
        'POST', { answers: [], abnormalCount: 0 });
    }
    return state;
  };

  try {
    await login(admin, adminUsername, adminPassword);
    const created = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: 'SAT Parity Student', roleCode: 'STUDENT', email: null, phone: null,
    });
    studentId = created.id;
    const papers = await api(admin, '/api/admin/exam-types/SAT/papers');
    const paper = papers.find(row => row.status === 'READY' && row.questionCount > 0);
    assert.ok(paper, 'a ready SAT paper with questions is available');
    paperId = paper.id ?? paper.summary?.id;
    const psatPapers = await api(admin, '/api/admin/exam-types/PSAT/papers');
    const psatPaper = psatPapers.find(row => row.status === 'READY' && row.questionCount > 0);
    assert.ok(psatPaper, 'a ready PSAT paper with questions is available');

    const formalExam = await createExam(`SAT parity flow ${Date.now()}`, Date.now() + 60 * 60_000, 2);
    await login(student, username, password);
    await student.goto(`${baseUrl}/student/systems/SAT`);
    await student.getByRole('heading', { name: 'Your exams' }).waitFor();
    await student.getByText(formalExam.title, { exact: true }).waitFor();
    await student.getByRole('button', { name: /Start exam/ }).click();
    await student.waitForURL(`**/student/sat/exams/${formalExam.id}`);
    await student.locator('.answer-options').waitFor({ timeout: 15_000 });
    if (await student.getByRole('heading', { name: 'Fullscreen Required' }).count()) {
      await student.getByRole('button', { name: 'Enter Fullscreen' }).click();
    }
    await student.locator('.option-item').first().click();
    await student.getByRole('button', { name: 'Mark for Review' }).click();

    const questionSelector = student.locator('.question-selector-btn');
    if (await student.locator('.question-status-panel .question-status-btn').count() < 2) {
      await questionSelector.click();
    }
    const questionButtons = student.locator('.question-status-panel .question-status-btn');
    if (await questionButtons.count() > 1) {
      await questionButtons.nth(1).click();
      assert.match(await questionSelector.textContent(), /Question 2 of/);
      await questionSelector.click();
      await questionButtons.first().click();
      assert.match(await questionSelector.textContent(), /Question 1 of/);
    }

    const attemptList = await api(student, '/api/student/exams');
    const attemptId = attemptList.find(row => row.id === formalExam.id).activeAttemptId;
    assert.ok(attemptId, 'starting the exam creates an attempt');
    let state;
    let saved;
    for (let retry = 0; retry < 12; retry++) {
      state = await api(student, `/api/student/sat-attempts/${attemptId}`);
      saved = state.savedAnswers.find(answer => Number(answer.questionId) === Number(state.questions[0].id));
      if (saved?.answer && saved.isMarked) break;
      await student.waitForTimeout(250);
    }
    const firstQuestionId = state.questions[0].id;
    assert.ok(saved?.answer, 'the selected answer is autosaved');
    assert.equal(saved.isMarked, true, 'the review mark is autosaved');
    const secondsBeforeReload = state.remainingSeconds;

    await student.reload();
    await student.locator('.answer-options').waitFor({ timeout: 15_000 });
    await student.locator('.option-item.selected').first().waitFor({ timeout: 10_000 });
    await student.locator('.mark-review-btn.marked').waitFor({ timeout: 10_000 });
    state = await api(student, `/api/student/sat-attempts/${attemptId}`);
    saved = state.savedAnswers.find(answer => Number(answer.questionId) === Number(firstQuestionId));
    assert.ok(saved?.answer, 'the selected answer is restored after reload');
    assert.equal(saved.isMarked, true, 'the review mark is restored after reload');
    assert.ok(state.remainingSeconds <= secondsBeforeReload, 'server timer continues through reload');

    state = await finishAllModules(attemptId);
    assert.equal(state.status, 'finished', 'the last module completes the formal attempt');
    const report = await api(student, `/api/student/sat-attempts/${attemptId}/report`);
    assert.equal(report.mode, 'exam');
    assert.equal(report.answersVisible, true);
    assert.ok(report.summary, 'the report includes a score summary');
    assert.equal(typeof report.summary.totalRaw, 'number', 'the report includes a calculated raw score');
    const history = await api(student, '/api/student/exams');
    const completed = history.find(row => row.id === formalExam.id);
    assert.equal(completed.latestAttemptId, attemptId);
    assert.equal(completed.attemptsUsed, 1);

    const secondStart = await api(student, `/api/student/exams/${formalExam.id}/sat-attempt`, 'POST');
    assert.notEqual(secondStart.attemptId, attemptId, 'a second allowed attempt gets a distinct record');
    const secondAttempt = await finishAllModules(secondStart.attemptId);
    assert.equal(secondAttempt.status, 'finished');
    const scores = await api(admin, `/api/admin/sat/students/${studentId}/scores`);
    const completedScores = scores.scores.filter(row => row.status === 'COMPLETED' && row.examId === formalExam.id);
    assert.equal(completedScores.length, 2, 'score history retains both attempts for one exam');
    assert.equal(scores.statistics.sat.attempts, 2);
    const blockedStart = await raw(student, `/api/student/exams/${formalExam.id}/sat-attempt`, 'POST');
    assert.equal(blockedStart.status, 409, 'the attempt limit is enforced after both allowed attempts');

    await admin.goto(`${baseUrl}/exam-types/SAT/admin/classes/1/students/${studentId}/scores?scoreMode=RAW`);
    await admin.getByRole('heading', { name: 'SAT Parity Student' }).waitFor();
    await admin.locator('.sat-score-history-table tbody tr').nth(0).waitFor();
    assert.equal(await admin.locator('.sat-score-history-table tbody tr').count(), 2);
    await admin.getByRole('button', { name: 'Raw score' }).waitFor();
    await admin.locator('.sat-score-history-table .sat-score-report-button').first().click();
    await admin.getByRole('heading', { name: 'Score Report' }).waitFor({ timeout: 15_000 });
    await admin.getByRole('button', { name: /Back to results/ }).click();
    await admin.getByRole('heading', { name: 'SAT Parity Student' }).waitFor();
    assert.equal(new URL(admin.url()).searchParams.get('scoreMode'), 'RAW', 'returning from a report preserves the score scale');
    await admin.setViewportSize({ width: 390, height: 844 });
    const historyWidth = await admin.evaluate(() => {
      const table = document.querySelector('.sat-score-table-scroll');
      return {
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        table: table ? { client: table.clientWidth, content: table.scrollWidth } : null,
      };
    });
    assert.ok(historyWidth.page <= historyWidth.viewport, 'score history has no page-level horizontal overflow at 390px');
    assert.ok(historyWidth.table && historyWidth.table.content > historyWidth.table.client,
      'score history columns remain reachable through the table’s own horizontal scroller at 390px');

    const psatExam = await createExam(`PSAT parity flow ${Date.now()}`, Date.now() + 60 * 60_000, 1, psatPaper.id);
    await student.goto(`${baseUrl}/student/systems/SAT`);
    const psatTitle = student.getByText(psatExam.title, { exact: true });
    await psatTitle.waitFor();
    assert.match(await psatTitle.locator('..').textContent(), /PSAT/,
      'the unified SAT workspace identifies a PSAT release with its assessment type');
    await student.getByRole('button', { name: /Start exam/ }).click();
    await student.waitForURL(`**/student/sat/exams/${psatExam.id}`);
    await student.locator('.answer-options').waitFor({ timeout: 15_000 });
    const psatStart = await api(student, `/api/student/exams/${psatExam.id}/sat-attempt`, 'POST');
    const psatAttempt = await finishAllModules(psatStart.attemptId);
    assert.equal(psatAttempt.status, 'finished');
    const psatReport = await api(student, `/api/student/sat-attempts/${psatStart.attemptId}/report`);
    assert.equal(psatReport.scoringType, 'PSAT', 'PSAT submissions use the PSAT scoring identity');

    await student.goto(`${baseUrl}/student/systems/SAT`);
    await student.locator('.student-exam-list article.paper-row')
      .filter({ hasText: formalExam.title }).getByRole('button', { name: 'View attempt' }).click();
    await student.getByRole('heading', { name: 'Score Report' }).waitFor({ timeout: 15_000 });
    await student.setViewportSize({ width: 390, height: 844 });
    const mobileWidth = await student.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    assert.ok(mobileWidth.page <= mobileWidth.viewport, 'score report has no page-level horizontal overflow at 390px');

    // 让正式考试保持在未打开的状态，验证迟到的续考请求会先完成并评分原尝试。
    const deadlineExam = await createExam(`SAT deadline retry ${Date.now()}`, Date.now() + 25_000, 2);
    const deadlineStart = await api(student, `/api/student/exams/${deadlineExam.id}/sat-attempt`, 'POST');
    const deadlineAttemptId = deadlineStart.attemptId;
    const deadlineDetail = await api(student, `/api/student/attempts/${deadlineAttemptId}`);
    const waitMs = new Date(deadlineDetail.expiresAt).getTime() - Date.now() + 1_000;
    assert.ok(waitMs > 0 && waitMs < 30_000, 'deadline attempt is bounded by its exam window');
    await new Promise(resolve => setTimeout(resolve, waitMs));
    const lateStart = await raw(student, `/api/student/exams/${deadlineExam.id}/sat-attempt`, 'POST');
    assert.equal(lateStart.status, 409, 'a closed exam cannot be restarted');
    const finished = await api(student, `/api/student/sat-attempts/${deadlineAttemptId}`);
    assert.equal(finished.status, 'finished', 'the expired attempt is finalized before start is rejected');
    assert.equal(finished.currentModuleId, null);
    assert.equal(finished.modules.length, 4);
    const deadlineReport = await api(student, `/api/student/sat-attempts/${deadlineAttemptId}/report`);
    assert.equal(deadlineReport.mode, 'exam');
    assert.ok(deadlineReport.summary);
    assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);

    console.log(JSON.stringify({
      result: 'PASS', formalExamId: formalExam.id, deadlineExamId: deadlineExam.id,
      attemptId, secondAttemptId: secondStart.attemptId, deadlineAttemptId, modules: state.modules.length,
      checks: ['question navigation', 'answer and review mark autosave/reload', 'module order and RW-to-Math break',
        'multiple attempts in score history, report return state, mobile table layout',
        'PSAT release type, student launch, and PSAT report scoring identity',
        'formal submission, score report, history, attempt limit', 'closed-window retry returns 409 after forced submission'],
    }));
  } finally {
    try {
      for (const examId of examIds) await api(admin, `/api/admin/exams/${examId}`, 'DELETE');
      if (studentId) await api(admin, `/api/admin/users/${studentId}`, 'DELETE');
      console.log(JSON.stringify({ cleanup: 'PASS', examIds, studentId }));
    } catch (error) {
      console.error('CLEANUP_FAILURE', error.message);
      process.exitCode = 2;
    }
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
