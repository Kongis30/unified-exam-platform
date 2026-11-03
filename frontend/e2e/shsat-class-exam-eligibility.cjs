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
  [admin, student].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  const stamp = Date.now();
  const password = `Eligibility${stamp}!`;
  const initialUsername = `shsat_eligible_${stamp}`;
  const lateUsername = `shsat_late_join_${stamp}`;
  const examTitle = `SHSAT Class Eligibility ${String(stamp).slice(-6)}`;
  let classId;
  let examId;
  let attemptId;
  const userIds = [];

  try {
    await login(admin, adminUsername, adminPassword);
    const initialStudent = await createStudent(admin, initialUsername, password, `Eligibility Student ${stamp}`);
    const lateStudent = await createStudent(admin, lateUsername, password, `Late Join Student ${stamp}`);
    userIds.push(Number(initialStudent.id), Number(lateStudent.id));

    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Eligibility Class ${stamp}`,
      description: 'Temporary SHSAT exam eligibility verification',
      sortOrder: 999,
      active: true,
    });
    classId = Number(classroom.classId || classroom.id);
    assert.ok(classId, 'the temporary SHSAT target class is created');
    await addStudent(admin, classId, initialStudent.id);

    const paper = (await api(admin, '/api/admin/exam-types/SHSAT/papers'))
      .find(item => Number(item.id) === 247 && item.status === 'READY');
    assert.ok(paper, 'the migrated 100-question SHSAT paper is available');
    const release = await api(admin, `/api/admin/papers/${paper.id}/exams`, 'POST', {
      title: examTitle,
      description: 'Verifies exam eligibility after class membership changes',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 45 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    const initialStudentExam = await studentExamFor(admin, initialUsername, password, examId);
    assert.equal(Number(initialStudentExam.examId || initialStudentExam.id), examId,
      'students enrolled before publication receive the published exam');

    await addStudent(admin, classId, lateStudent.id);
    const classMembersAfterJoin = await api(admin, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`);
    assert.ok(classMembersAfterJoin.some(item => Number(item.userId || item.id) === Number(lateStudent.id)),
      'the late-joining student becomes a current class member');
    const lateStudentExam = await studentExamFor(admin, lateUsername, password, examId);
    assert.equal(Number(lateStudentExam.examId || lateStudentExam.id), examId,
      'a student joining a targeted class during the open window is automatically eligible');

    await api(admin, `/api/admin/classes/${classId}/students/${lateStudent.id}`, 'DELETE');
    const classMembersAfterRemoval = await api(admin, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`);
    assert.equal(classMembersAfterRemoval.some(item => Number(item.userId || item.id) === Number(lateStudent.id)), false,
      'the student is removed from the active class roster');

    await login(student, lateUsername, password);
    await installFullscreenMock(student);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const card = student.locator('.student-exam-list article.paper-row').filter({ hasText: examTitle });
    await card.getByText('Available', { exact: true }).waitFor();
    assert.equal(await card.getByRole('button', { name: /^Start exam/ }).count(), 1,
      'removing a student from the class does not revoke previously granted exam eligibility');
    await student.screenshot({ path: `/tmp/shsat-class-eligibility-desktop-${stamp}.png` });

    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the eligible exam card fits the 390px student view');
    await student.screenshot({ path: `/tmp/shsat-class-eligibility-mobile-${stamp}.png` });

    await student.setViewportSize({ width: 1440, height: 1000 });
    await card.getByRole('button', { name: /^Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
    const attemptRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST', { timeout: 12_000 });
    await student.getByRole('button', { name: /ELA/ }).click();
    let attemptResponse;
    try {
      attemptResponse = await attemptRequest;
    } catch (error) {
      const body = (await student.locator('body').innerText()).slice(-1200);
      throw new Error(`${error.message}; page after choosing ELA: ${body}; page errors: ${pageErrors.join(' | ')}`);
    }
    assert.equal(attemptResponse.status(), 200, `starting the published exam should succeed: ${await attemptResponse.text()}`);
    const attempt = await attemptResponse.json();
    attemptId = Number(attempt.id || attempt.attemptId);
    assert.ok(attemptId > 0, 'the newly eligible student can start the exam after leaving the class');
    await student.locator('.exam-transition-page .exam-transition-card__button').click();
    await expectQuestion(student, 1);
    const attemptDetails = await api(student, `/api/student/attempts/${attemptId}`);
    assert.equal(attemptDetails.status, 'IN_PROGRESS', 'the started exam remains available to its owner');

    await student.screenshot({ path: `/tmp/shsat-class-eligibility-active-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const activeMobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(activeMobileSize.page <= activeMobileSize.viewport, 'the active exam view fits the 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-class-eligibility-active-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      result: 'PASS',
      checks: [
        'students enrolled before publication are eligible',
        'students joining a targeted class during the open window are automatically eligible',
        'leaving a class does not revoke existing exam eligibility',
        'student can start an exam after leaving the target class',
        'desktop and 390px available/active exam UI',
        'temporary exam, class, users, and attempts are cleaned up',
      ],
      mobileSize,
      activeMobileSize,
      pageErrors: pageErrors.length,
    }));
  } finally {
    const cleanupErrors = [];
    const remove = async (path, label) => {
      try {
        await api(admin, path, 'DELETE');
      } catch (error) {
        cleanupErrors.push(`${label}: ${error.message}`);
      }
    };
    if (examId) await remove(`/api/admin/exams/${examId}`, 'exam');
    if (classId) {
      try {
        const members = await api(admin, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`);
        for (const userId of userIds) {
          if (members.some(item => Number(item.userId || item.id) === userId)) {
            await remove(`/api/admin/classes/${classId}/students/${userId}`, `class membership ${userId}`);
          }
        }
      } catch (error) {
        cleanupErrors.push(`class memberships: ${error.message}`);
      }
      await remove(`/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'class');
    }
    for (const userId of userIds) await remove(`/api/admin/users/${userId}`, `student ${userId}`);

    if (examId && await apiStatus(admin, `/api/admin/exams/${examId}`) !== 404) {
      cleanupErrors.push(`Exam ${examId} remains after cleanup.`);
    }
    if (classId) {
      const classes = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT');
      if (classes.some(item => Number(item.classId || item.id) === classId)) {
        cleanupErrors.push(`Class ${classId} remains after cleanup.`);
      }
    }
    if (userIds.length) {
      const users = await api(admin, '/api/admin/users');
      if (users.some(item => userIds.includes(Number(item.id)))) cleanupErrors.push('A temporary student remains after cleanup.');
    }
    await browser.close();
    if (cleanupErrors.length) throw new Error(`Test cleanup failed: ${cleanupErrors.join('; ')}`);
  }
}

async function createStudent(page, username, password, realName) {
  return api(page, '/api/admin/users', 'POST', {
    username,
    password,
    realName,
    roleCode: 'STUDENT',
    email: null,
    phone: null,
  });
}

async function addStudent(page, classId, studentUserId) {
  await api(page, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: Number(studentUserId) });
}

async function studentExamFor(admin, username, password, examId) {
  const context = await admin.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await login(page, username, password);
    const exams = await api(page, '/api/student/exams');
    const exam = exams.find(item => Number(item.examId || item.id) === examId);
    assert.ok(exam, `student ${username} receives the targeted exam`);
    return exam;
  } finally {
    await context.close();
  }
}

async function installFullscreenMock(page) {
  const mockFullscreen = () => {
    const install = () => {
      if (!document.documentElement) {
        document.addEventListener('DOMContentLoaded', install, { once: true });
        return;
      }
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
    };
    install();
  };
  await page.addInitScript(mockFullscreen);
  await page.evaluate(mockFullscreen);
}

async function expectQuestion(page, questionNumber) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const labels = await page.locator('.question-number').evaluateAll(elements => elements
      .filter(element => element.getClientRects().length)
      .map(element => element.textContent.trim()));
    if (labels.some(label => Number(label.match(/^Question\s+(\d+)\b/)?.[1]) === questionNumber)) return;

    const transitionButton = page.locator('.exam-transition-page .exam-transition-card__button');
    if (await transitionButton.isVisible().catch(() => false)) await transitionButton.click();
    else await page.waitForTimeout(250);
  }
  const visibleText = (await page.locator('body').innerText()).slice(-1000);
  throw new Error(`Expected Question ${questionNumber}; ${visibleText}`);
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

async function apiStatus(page, path) {
  return page.evaluate(async path => (await fetch(path, { credentials: 'same-origin' })).status, path);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
