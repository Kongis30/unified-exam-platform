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
  const admin = await adminContext.newPage();
  const teacher = await teacherContext.newPage();
  const errors = [];
  [admin, teacher].forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const stamp = Date.now();
  const teacherUsername = `shsat_teacher_${stamp}`;
  const teacherPassword = `Teacher${stamp}!`;
  const className = `SHSAT Teacher Check ${String(stamp).slice(-6)}`;
  const examTitle = `SHSAT Teacher Release ${String(stamp).slice(-6)}`;
  let teacherId;
  let studentId;
  let classId;
  let examId;

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
      username: `shsat_student_${stamp}`, password: `Student${stamp}!`, realName: `Student ${stamp}`,
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
    await teacher.getByText('No response-time data has been recorded for this exam yet.').waitFor();
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-${stamp}.png` });
    await teacher.setViewportSize({ width: 390, height: 844 });
    await teacher.evaluate(() => window.scrollTo(0, 0));
    const monitorMobileSize = await teacher.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(monitorMobileSize.page <= monitorMobileSize.viewport, 'teacher monitor fits a 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-teacher-monitor-mobile-${stamp}.png` });
    await teacher.locator('.monitor-back-button').click();
    await teacher.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
    await teacher.getByRole('tab', { name: 'Exam Release', exact: true }).waitFor();
    await teacher.setViewportSize({ width: 1440, height: 900 });
    await teacher.getByRole('tab', { name: 'Exam Release', exact: true }).click();

    const forbiddenDelete = await raw(teacher, `/api/admin/exams/${examId}`, 'DELETE');
    assert.equal(forbiddenDelete.status, 403, 'the backend also denies teacher release deletion');
    await row.getByRole('button', { name: `Actions for ${examTitle}` }).click();
    await teacher.getByRole('menuitem', { name: 'Unpublish', exact: true }).click();
    await teacher.getByRole('button', { name: 'Unpublish Exam', exact: true }).click();
    const unpublished = await api(teacher, '/api/admin/exam-types/SHSAT/exams');
    assert.equal(unpublished.find(item => Number(item.id) === examId)?.status, 'DRAFT',
      'a teacher can unpublish a release');

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
        'create, publish and unpublish release', 'monitor access, empty analytics and return path',
        'delete hidden in UI and forbidden by API', '390px layout'],
      mobileSize,
      monitorMobileSize,
      pageErrors: errors.length,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
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
