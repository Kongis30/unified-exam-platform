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
  const teacherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const teacher = await teacherContext.newPage();
  const pageErrors = [];
  const teacherPageErrors = [];
  student.on('pageerror', error => pageErrors.push(error.message));
  teacher.on('pageerror', error => teacherPageErrors.push(error.message));

  const username = `sat_parity_${Date.now()}`;
  const secondaryStudentUsername = `sat_parity_additional_${Date.now()}`;
  const teacherUsername = `sat_parity_teacher_${Date.now()}`;
  const password = `sat-e2e-${Date.now()}`;
  let studentId;
  let secondaryStudentId;
  let teacherId;
  const examIds = [];
  let paperId;
  let classId;
  let classCreated = false;
  let classMembershipAdded = false;
  let secondaryClassMembershipAdded = false;

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
  const finishRemainingModules = async (attemptId, state) => {
    while (state.status !== 'finished') {
      if (state.awaitingBreak) {
        state = await api(student, `/api/student/sat-attempts/${attemptId}/resume-break`, 'POST');
      }
      assert.ok(state.currentModuleId, 'the next SAT module is available until the attempt is finished');
      state = await api(student, `/api/student/sat-attempts/${attemptId}/modules/${state.currentModuleId}/submit`,
        'POST', { answers: [], abnormalCount: 0 });
    }
    return state;
  };
  const paperQuestions = sections => sections.flatMap(section => [
    ...(section.questions || []), ...paperQuestions(section.children || []),
  ]);

  try {
    await login(admin, adminUsername, adminPassword);
    const created = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: 'SAT Parity Student', roleCode: 'STUDENT', email: null, phone: null,
    });
    studentId = created.id;
    const additionalStudent = await api(admin, '/api/admin/users', 'POST', {
      username: secondaryStudentUsername, password, realName: 'SAT Parity Additional Student',
      roleCode: 'STUDENT', email: null, phone: null,
    });
    secondaryStudentId = additionalStudent.id;
    const createdTeacher = await api(admin, '/api/admin/users', 'POST', {
      username: teacherUsername, password, realName: 'SAT Parity Teacher', roleCode: 'TEACHER', email: null, phone: null,
    });
    teacherId = createdTeacher.id;
    const className = `SAT parity class ${Date.now()}`;
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SAT&examTypeCodes=PSAT', 'POST', {
      name: className, description: 'Temporary SAT score trend verification', sortOrder: 999,
    });
    classId = classroom.id;
    classCreated = true;
    await api(admin, `/api/admin/classes/${classId}/students/batch`, 'POST', { studentUserIds: [studentId] });
    classMembershipAdded = true;
    await admin.goto(`${baseUrl}/exam-types/SAT/admin/classes/${classId}/students/${studentId}/scores`);
    await admin.getByRole('heading', { name: 'SAT Parity Student' }).waitFor();
    await admin.getByText('No completed score data is available yet.').waitFor();
    await admin.getByText('No SAT or PSAT attempts have been recorded for this student.').waitFor();
    await admin.setViewportSize({ width: 390, height: 844 });
    let emptyScorePage = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(emptyScorePage.page <= emptyScorePage.viewport, 'empty student score page has no overflow at 390px');
    await admin.goto(`${baseUrl}/exam-types/SAT/admin/classes/${classId}`);
    await admin.getByRole('heading', { name: 'Class Exam Score Trend' }).waitFor();
    await admin.getByText('No completed exam scores to chart yet.').waitFor();
    await admin.getByText('No exam records for this class yet.').waitFor();
    assert.equal(await admin.locator('.class-score-chart').count(), 0, 'empty class trend uses a message instead of an empty chart');
    const emptyClassPage = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(emptyClassPage.page <= emptyClassPage.viewport, 'empty class detail has no overflow at 390px');
    await admin.setViewportSize({ width: 1440, height: 1000 });
    const papers = await api(admin, '/api/admin/exam-types/SAT/papers');
    const paper = papers.find(row => row.status === 'READY' && row.questionCount > 0);
    assert.ok(paper, 'a ready SAT paper with questions is available');
    paperId = paper.id ?? paper.summary?.id;
    const psatPapers = await api(admin, '/api/admin/exam-types/PSAT/papers');
    const psatPaper = psatPapers.find(row => row.status === 'READY' && row.questionCount > 0);
    assert.ok(psatPaper, 'a ready PSAT paper with questions is available');

    const practiceEndpoints = [
      ['/api/student/sat-practice-papers', 'GET'],
      ['/api/student/sat-practice-attempts?page=1&size=10', 'GET'],
      [`/api/student/sat-practice-papers/${paperId}/attempts`, 'POST'],
      ['/api/student/sat-practice-attempts/999999999', 'DELETE'],
    ];
    for (const [path, method] of practiceEndpoints) {
      const response = await raw(admin, path, method);
      assert.equal(response.status, 403, `${method} ${path} denies an administrator without student role`);
    }
    await admin.goto(`${baseUrl}/student/systems/SAT`);
    await admin.waitForURL(`${baseUrl}/`);
    await admin.getByRole('heading', { name: 'Platform overview' }).waitFor();

    await login(teacher, teacherUsername, password);
    await teacher.goto(`${baseUrl}/student/systems/SAT`);
    await teacher.waitForURL(`${baseUrl}/`);
    await teacher.getByRole('heading', { name: 'Platform overview' }).waitFor();
    for (const [path, method] of practiceEndpoints) {
      const response = await raw(teacher, path, method);
      assert.equal(response.status, 403, `${method} ${path} denies a teacher account`);
    }
    await teacher.goto(`${baseUrl}/exam-types/SAT/admin?tab=classes`);
    await teacher.getByRole('heading', { name: 'Classes' }).waitFor();
    await teacher.getByRole('tab', { name: 'Classes' }).waitFor();
    assert.equal(await teacher.getByRole('tab', { name: 'Paper Management' }).count(), 0,
      'teachers only see the SAT class-management tab');
    assert.equal(await teacher.getByRole('tab', { name: 'Exam Release' }).count(), 0,
      'teachers do not receive SAT paper or release controls');
    await teacher.getByRole('button').filter({ hasText: className }).click();
    await teacher.getByRole('heading', { name: className, exact: true }).waitFor();
    await teacher.getByRole('button', { name: 'Edit class' }).waitFor();
    await teacher.getByRole('button', { name: 'Add student' }).click();
    await teacher.getByRole('heading', { name: 'Add students' }).waitFor();
    await teacher.getByLabel('Search students').fill('SAT Parity Additional Student');
    await teacher.getByText('No classes yet', { exact: true }).waitFor();
    await teacher.getByRole('checkbox', { name: 'Select SAT Parity Additional Student' }).check();
    const enrollmentResponse = teacher.waitForResponse(response =>
      response.url().includes(`/api/admin/classes/${classId}/students/batch`) && response.request().method() === 'POST');
    await teacher.getByRole('button', { name: 'Add 1 student' }).click();
    const enrollmentResult = await enrollmentResponse;
    assert.equal(enrollmentResult.status(), 200, 'teacher can enroll a student into any SAT class');
    secondaryClassMembershipAdded = true;
    await teacher.getByText('SAT Parity Additional Student', { exact: true }).waitFor();
    assert.deepEqual(teacherPageErrors, [], `teacher route-guard errors: ${teacherPageErrors.join('; ')}`);

    const formalExam = await createExam(`SAT parity flow ${Date.now()}`, Date.now() + 60 * 60_000, 2);
    const filteredExamList = `/exam-types/SAT/admin?tab=exams&examSearch=${encodeURIComponent(formalExam.title)}&examPageSize=20`;
    await admin.goto(`${baseUrl}${filteredExamList}`);
    await admin.getByRole('heading', { name: 'Exam Releases' }).waitFor();
    await admin.locator('.release-search-input').waitFor();
    const resultsUrl = `${baseUrl}/exam-types/SAT/admin/exams/${formalExam.id}/results?returnTo=${encodeURIComponent(filteredExamList)}`;
    await admin.goto(resultsUrl);
    await admin.getByRole('heading', { name: 'Student Results' }).waitFor();
    await admin.getByRole('button', { name: '← Back to Exam Releases' }).click();
    await admin.waitForURL(`${baseUrl}${filteredExamList}`);
    assert.equal(await admin.locator('.release-search-input').inputValue(), formalExam.title,
      'returning from results restores the exam search');
    assert.equal(await admin.locator('.exam-list-pagination select').first().inputValue(), '20',
      'returning from results restores the page size');
    assert.equal(await admin.getByRole('tab', { name: 'Exam Release' }).getAttribute('aria-selected'), 'true',
      'returning from results restores the selected admin tab');

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
    const attemptList = await api(student, '/api/student/exams');
    const attemptId = attemptList.find(row => row.id === formalExam.id).activeAttemptId;
    assert.ok(attemptId, 'starting the exam creates an attempt');
    const repeatedStart = await api(student, `/api/student/exams/${formalExam.id}/sat-attempt`, 'POST');
    assert.equal(repeatedStart.attemptId, attemptId,
      'repeating start while an attempt is in progress resumes the same attempt');

    const questionSelector = student.locator('.question-selector-btn');
    if (await student.locator('.question-status-panel .question-status-btn').count() < 2) {
      await questionSelector.click();
    }
    const questionButtons = student.locator('.question-status-panel .question-status-btn');
    if (await questionButtons.count() > 1) {
      await questionButtons.nth(1).click();
      assert.match(await questionSelector.textContent(), /Question 2 of/);
      let state = await api(student, `/api/student/sat-attempts/${attemptId}`);
      const secondQuestionId = state.questions[1].id;
      await studentContext.setOffline(true);
      await student.locator('.option-item').first().click();
      await student.waitForTimeout(1_200);
      await studentContext.setOffline(false);
      let secondSaved;
      for (let retry = 0; retry < 12; retry++) {
        state = await api(student, `/api/student/sat-attempts/${attemptId}`);
        secondSaved = state.savedAnswers.find(answer => Number(answer.questionId) === Number(secondQuestionId));
        if (secondSaved?.answer) break;
        await student.waitForTimeout(250);
      }
      assert.ok(secondSaved?.answer, 'an answer entered offline syncs after the connection returns');
      await questionSelector.click();
      await questionButtons.first().click();
      assert.match(await questionSelector.textContent(), /Question 1 of/);
    }

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

    const practicePaper = (await api(student, '/api/student/sat-practice-papers'))
      .find(row => Number(row.id) === Number(paperId));
    assert.ok(practicePaper, 'the selected SAT paper is available for student practice');
    await student.goto(`${baseUrl}/student/systems/SAT`);
    const practiceStartResponse = student.waitForResponse(response =>
      response.url().includes(`/api/student/sat-practice-papers/${paperId}/attempts`) &&
      response.request().method() === 'POST');
    await student.getByRole('button', { name: `Start practice: ${practicePaper.title}` }).click();
    await student.waitForURL(`**/student/sat/exams/${paperId}?mode=practice`);
    const practiceStartSnapshot = await practiceStartResponse;
    assert.equal(practiceStartSnapshot.status(), 200, 'the student practice start request succeeds');
    const practiceStart = await practiceStartSnapshot.json();
    assert.ok(practiceStart.practice && practiceStart.currentModuleId,
      'practice begins in its first module');
    await student.locator('.answer-options').waitFor({ timeout: 15_000 });
    if (await student.getByRole('heading', { name: 'Fullscreen Required' }).count()) {
      await student.getByRole('button', { name: 'Enter Fullscreen' }).click();
    }
    const practiceAttemptId = practiceStart.attemptId;
    const finishedPractice = await finishAllModules(practiceAttemptId);
    assert.equal(finishedPractice.status, 'finished');
    const practiceReport = await api(student, `/api/student/sat-attempts/${practiceAttemptId}/report`);
    assert.equal(practiceReport.mode, 'practice', 'the practice result is clearly identified as practice');
    const scoresAfterPractice = await api(admin, `/api/admin/sat/students/${studentId}/scores`);
    assert.equal(scoresAfterPractice.scores.some(row => Number(row.attemptId) === practiceAttemptId), false,
      'practice results do not enter formal SAT score history');
    assert.equal(scoresAfterPractice.statistics.sat.attempts, 2,
      'practice results do not change formal SAT attempt statistics');
    await teacher.goto(`${baseUrl}/exam-types/SAT/admin/classes/${classId}/students/${studentId}/scores?scoreMode=RAW`);
    await teacher.getByRole('heading', { name: 'SAT Parity Student' }).waitFor();
    const teacherScoreRows = teacher.locator('.sat-score-history-table tbody tr');
    await teacherScoreRows.first().waitFor();
    assert.equal(await teacherScoreRows.first().getByRole('button', { name: /Actions for/ }).count(), 0,
      'teachers do not see score deletion actions');
    const teacherDelete = await raw(teacher,
      `/api/admin/sat/students/${studentId}/attempts/${completedScores[0].attemptId}`, 'DELETE');
    assert.equal(teacherDelete.status, 403, 'teachers cannot delete a formal SAT score attempt');
    await student.goto(`${baseUrl}/student/systems/SAT`);
    const practiceRow = student.locator('.practice-history-row').filter({ hasText: practicePaper.title });
    await practiceRow.waitFor();
    await practiceRow.getByRole('button', { name: 'View report' }).click();
    await student.getByRole('heading', { name: 'Score Report' }).waitFor({ timeout: 15_000 });
    await student.locator('.mode-badge', { hasText: 'Practice' }).waitFor();
    await student.getByRole('link', { name: 'Back to SAT exams' }).click();
    await student.getByRole('heading', { name: 'Your exams' }).waitFor();

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
    let psatState = await api(student, `/api/student/sat-attempts/${psatStart.attemptId}`);
    const readingModules = psatState.modules.filter(module => module.subject === 'RW');
    assert.equal(readingModules.length, 2, 'PSAT has two Reading and Writing modules');
    for (const [moduleIndex, module] of readingModules.entries()) {
      assert.equal(psatState.currentModuleId, module.id, 'Reading and Writing modules follow the defined exam order');
      psatState = await api(student,
        `/api/student/sat-attempts/${psatStart.attemptId}/modules/${module.id}/submit`, 'POST',
        { answers: [], abnormalCount: 0 });
      if (moduleIndex === 0) {
        const staleModuleSave = await raw(student,
          `/api/student/sat-attempts/${psatStart.attemptId}/modules/${module.id}/save`, 'PUT',
          { answers: [], abnormalCount: 0 });
        assert.equal(staleModuleSave.status, 409, 'a completed module rejects late answer saves');
      }
    }
    assert.equal(psatState.awaitingBreak, true, 'PSAT provides the break between Reading and Writing and Math');
    psatState = await api(student, `/api/student/sat-attempts/${psatStart.attemptId}/resume-break`, 'POST');
    const gridIn = psatState.questions.find(question => question.type === 'fill_blank');
    assert.ok(gridIn, 'the PSAT Math module contains a fill-in response question');
    const psatPaperDetail = await api(admin, `/api/admin/papers/${psatState.paperId}`);
    const gridInSource = paperQuestions(psatPaperDetail.sections).find(question =>
      question.paperItemId === gridIn.id && question.questionTypeCode === 'SAT_FILL_IN_BLANK');
    let acceptedAnswer = gridInSource?.answerKey?.correctAnswer;
    assert.ok(acceptedAnswer !== undefined && acceptedAnswer !== null,
      'the selected PSAT fill-in question has a configured answer key');
    if (typeof acceptedAnswer === 'string' && acceptedAnswer.startsWith('[')) {
      try {
        const parsedAnswer = JSON.parse(acceptedAnswer);
        if (Array.isArray(parsedAnswer)) acceptedAnswer = parsedAnswer[0];
      } catch {
        // A malformed legacy value is still submitted literally for the grading check.
      }
    }
    const responseValue = Array.isArray(acceptedAnswer) ? String(acceptedAnswer[0]) : String(acceptedAnswer);
    assert.ok(responseValue.trim(), 'the PSAT fill-in question has a scorable accepted answer');

    await student.reload();
    await student.locator('.answer-options').waitFor({ timeout: 15_000 });
    const psatQuestionSelector = student.locator('.question-selector-btn');
    await psatQuestionSelector.click();
    await student.locator('.question-status-panel .question-status-btn').nth(
      psatState.questions.findIndex(question => question.id === gridIn.id)).click();
    const gridInNumber = psatState.questions.findIndex(question => question.id === gridIn.id) + 1;
    assert.match(await psatQuestionSelector.textContent(), new RegExp(`Question ${gridInNumber} of`),
      'the question selector navigates to the chosen PSAT fill-in question');
    const fillInput = student.locator('.fill-blank-input input');
    await fillInput.waitFor({ state: 'visible', timeout: 10_000 });
    const fillSaveResponse = student.waitForResponse(response =>
      response.url().includes(`/sat-attempts/${psatStart.attemptId}/modules/`) &&
      response.url().endsWith('/save') && response.request().method() === 'PUT' &&
      response.request().postDataJSON()?.answers?.some(answer =>
        Number(answer.questionId) === Number(gridIn.id) && answer.answer === responseValue));
    await fillInput.fill(responseValue);
    assert.equal(await fillInput.inputValue(), responseValue, 'PSAT fill-in input accepts a typed answer');
    const savedResponse = await fillSaveResponse;
    assert.equal(savedResponse.status(), 200, 'PSAT fill-in edit triggers a successful autosave');
    const savedPayload = savedResponse.request().postDataJSON();
    const submittedGridIn = savedPayload.answers.find(answer => Number(answer.questionId) === Number(gridIn.id));
    assert.equal(submittedGridIn?.answer, responseValue, 'PSAT autosave includes the typed fill-in response');
    let savedGridIn;
    for (let retry = 0; retry < 20; retry++) {
      psatState = await api(student, `/api/student/sat-attempts/${psatStart.attemptId}`);
      savedGridIn = psatState.savedAnswers.find(answer => Number(answer.questionId) === Number(gridIn.id));
      if (savedGridIn?.answer === responseValue) break;
      await student.waitForTimeout(250);
    }
    assert.equal(savedGridIn?.answer, responseValue, 'PSAT fill-in answers autosave to the server');
    await student.reload();
    await student.locator('.answer-options').waitFor({ timeout: 15_000 });
    await fillInput.waitFor({ state: 'visible' });
    let restoredGridIn = '';
    for (let retry = 0; retry < 20; retry++) {
      restoredGridIn = await fillInput.inputValue();
      if (restoredGridIn === responseValue) break;
      await student.waitForTimeout(250);
    }
    assert.equal(restoredGridIn, responseValue,
      'PSAT fill-in answer is restored after reload');

    const psatAttempt = await finishRemainingModules(psatStart.attemptId, psatState);
    assert.equal(psatAttempt.status, 'finished');
    const psatReport = await api(student, `/api/student/sat-attempts/${psatStart.attemptId}/report`);
    assert.equal(psatReport.scoringType, 'PSAT', 'PSAT submissions use the PSAT scoring identity');
    assert.ok(psatReport.summary.totalRaw > 0, 'a correct PSAT fill-in answer contributes to the raw score');
    assert.ok(psatReport.summary.totalScaled > 320, 'the PSAT scale reflects the correct fill-in answer');

    const trend = await api(admin,
      `/api/admin/classes/${classId}/score-trend?examTypeCodes=SAT&examTypeCodes=PSAT`);
    const testTrend = trend.filter(row => [formalExam.id, psatExam.id].includes(row.examId));
    assert.equal(testTrend.length, 2, 'class trend includes one SAT and one PSAT exam');
    const satTrend = testTrend.find(row => row.examId === formalExam.id);
    const psatTrend = testTrend.find(row => row.examId === psatExam.id);
    assert.equal(satTrend.studentCount, 1, 'repeated attempts are reduced to one student score per exam');
    assert.equal(satTrend.averageRawScore, 0);
    assert.equal(psatTrend.averageRawScore, psatReport.summary.totalRaw,
      'class score trend includes the raw points earned on the PSAT fill-in question');
    assert.equal(psatTrend.averageScaledScore, psatReport.summary.totalScaled,
      `PSAT report and class trend use the same scaled score: ${JSON.stringify({ report: psatReport.summary, trend: psatTrend })}`);
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.goto(`${baseUrl}/exam-types/SAT/admin/classes/${classId}`);
    await admin.getByRole('heading', { name: 'Class Exam Score Trend' }).waitFor();
    const trendPointLabels = await admin.locator('.class-score-chart g[role="img"][tabindex="0"]')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    const satPointIndex = trendPointLabels.findIndex(label => label?.includes(formalExam.title));
    const psatPointIndex = trendPointLabels.findIndex(label => label?.includes(psatExam.title));
    assert.notEqual(satPointIndex, -1, 'SAT exam appears as a chart point');
    assert.notEqual(psatPointIndex, -1, 'PSAT exam appears as a chart point');
    await admin.locator('.class-score-chart circle.class-score-chart__point').nth(satPointIndex).hover();
    const scoreTooltip = admin.locator('.class-score-chart__tooltip');
    await scoreTooltip.waitFor();
    assert.match(await scoreTooltip.textContent(), new RegExp(formalExam.title));
    const firstPointBox = await admin.locator('.class-score-chart circle.class-score-chart__point').nth(satPointIndex).boundingBox();
    const firstTooltipBox = await scoreTooltip.boundingBox();
    assert.ok(firstTooltipBox.x >= firstPointBox.x + firstPointBox.width,
      'the chart tooltip stays beside the hovered point instead of covering it');
    await admin.locator('#class-score-metric').selectOption('raw');
    await admin.locator('.class-score-chart circle.class-score-chart__point').nth(satPointIndex).hover();
    assert.match(await scoreTooltip.textContent(), /Average raw score: 0/);
    const classTables = admin.locator('.sat-class-detail-section table');
    await admin.getByRole('heading', { name: 'Exam Releases' }).waitFor();
    await admin.getByRole('heading', { name: 'Students' }).waitFor();
    assert.equal(await classTables.count(), 2, 'class detail provides separate releases and students tables');
    assert.equal(await classTables.nth(0).locator('tbody tr').count(), 2);
    assert.equal(await classTables.nth(1).locator('tbody tr').count(), 2,
      'the class table reflects both enrolled test students');
    await admin.setViewportSize({ width: 390, height: 844 });
    const classPageWidth = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(classPageWidth.page <= classPageWidth.viewport, 'class score trend has no page overflow at 390px');
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.goto(`${baseUrl}/exam-types/SAT/admin/classes/${classId}/students/${studentId}/scores?scoreType=PSAT&scoreMode=RAW`);
    await admin.getByRole('heading', { name: 'SAT Parity Student' }).waitFor();
    const scoreTypeStats = admin.locator('.sat-score-stat-type');
    assert.match(await scoreTypeStats.nth(0).textContent(), /SAT[\s\S]*Attempts[\s\S]*2/);
    assert.match(await scoreTypeStats.nth(1).textContent(), /PSAT[\s\S]*Attempts[\s\S]*1/);
    assert.equal(await admin.locator('.sat-score-chart-toolbar select').inputValue(), 'PSAT');
    assert.equal(await admin.locator('.sat-score-chart circle.sat-score-chart__point').count(), 1,
      'the PSAT filter shows only the PSAT score in its trend');
    const psatScoreRow = admin.locator('.sat-score-history-table tbody tr').filter({ hasText: psatExam.title });
    await psatScoreRow.waitFor();
    await psatScoreRow.getByRole('button', { name: `Actions for ${psatExam.title}` }).click();
    await admin.getByRole('menu').getByRole('button', { name: 'Delete attempt' }).click();
    const deleteDialog = admin.getByRole('dialog', { name: 'Delete exam attempt?' });
    await deleteDialog.waitFor();
    await deleteDialog.getByRole('button', { name: 'Delete attempt' }).click();
    await psatScoreRow.waitFor({ state: 'detached' });
    const duplicateDelete = await raw(admin,
      `/api/admin/sat/students/${studentId}/attempts/${psatStart.attemptId}`, 'DELETE');
    assert.equal(duplicateDelete.status, 404, 'repeating an admin delete reports the attempt as missing');
    await admin.locator('.sat-score-chart-toolbar select').waitFor({ state: 'detached' });
    assert.equal(new URL(admin.url()).searchParams.has('scoreType'), false,
      'when the filtered assessment type has no attempts, the view returns to an available type');
    const remainingScores = await api(admin, `/api/admin/sat/students/${studentId}/scores`);
    assert.equal(remainingScores.scores.filter(row => row.examId === psatExam.id && row.examTypeCode === 'PSAT').length, 0,
      'deleting a PSAT result removes its score history row');
    const deletedReport = await raw(student, `/api/student/sat-attempts/${psatStart.attemptId}/report`);
    assert.equal(deletedReport.status, 404, 'the deleted attempt no longer exposes a report');

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
      checks: ['question navigation', 'offline answer sync after reconnect', 'answer and review mark autosave/reload', 'module order and RW-to-Math break',
        'multiple attempts in score history, report return state, mobile table layout',
        'PSAT release type, student launch, fill-in autosave/reload, answer grading, and PSAT report scoring identity',
        'SAT practice start, report/history entry, and exclusion from formal score history',
        'administrator and teacher denial for student practice APIs and student workspace route',
        'teacher can manage all SAT classes and add students through the searchable enrollment table',
        'teacher cannot access SAT attempt deletion in UI or API; duplicate admin delete is safe',
        'empty student score and class trend states on mobile',
        'per-type student statistics, score filter, and fallback when a type has no attempts',
        'SAT/PSAT class score trend aggregation, type display, tooltip, and mobile layout',
        'admin deletes a PSAT attempt from student score history',
        'formal submission, score report, history, attempt limit', 'closed-window retry returns 409 after forced submission'],
    }));
  } finally {
    try {
      for (const examId of examIds) await api(admin, `/api/admin/exams/${examId}`, 'DELETE');
      if (classMembershipAdded) await api(admin, `/api/admin/classes/${classId}/students/${studentId}`, 'DELETE');
      if (secondaryClassMembershipAdded) await api(admin, `/api/admin/classes/${classId}/students/${secondaryStudentId}`, 'DELETE');
      if (classCreated) await api(admin, `/api/admin/classes/${classId}`, 'DELETE');
      if (studentId) await api(admin, `/api/admin/users/${studentId}`, 'DELETE');
      if (secondaryStudentId) await api(admin, `/api/admin/users/${secondaryStudentId}`, 'DELETE');
      if (teacherId) await api(admin, `/api/admin/users/${teacherId}`, 'DELETE');
      console.log(JSON.stringify({ cleanup: 'PASS', examIds, studentId, secondaryStudentId }));
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
