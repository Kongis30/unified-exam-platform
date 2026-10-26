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
  let studentId;
  let examId;
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
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [], studentUserIds: [studentId] });

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await admin.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    const search = admin.locator('.release-search-input');
    await search.fill(examTitle);
    const row = admin.locator('.exam-release-table tbody tr').filter({ hasText: examTitle });
    await row.waitFor();

    await openActions(row, examTitle, 'Publish');
    await admin.getByRole('heading', { name: 'Publish this exam?' }).waitFor();
    await admin.getByRole('button', { name: 'Publish Exam', exact: true }).click();
    await row.locator('.access-pill--open').waitFor();
    assert.ok((await row.locator('.exam-release-table__target-cell').innerText()).includes(`Students: Release Check ${stamp}`),
      'the Assigned To column identifies the selected student');
    await row.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await admin.screenshot({ path: `/tmp/shsat-exam-release-published-${stamp}.png` });
    const audienceFilter = admin.getByRole('combobox', { name: 'Target type' });
    await audienceFilter.selectOption('SPECIFIC_STUDENTS');
    await row.waitFor();
    await audienceFilter.selectOption('SPECIFIC_CLASSES');
    await row.waitFor({ state: 'detached' });
    await audienceFilter.selectOption('');
    await row.waitFor();
    const publishedExam = await api(admin, `/api/admin/exams/${examId}`);
    assert.equal(publishedExam.summary.status, 'PUBLISHED', 'publish updates the release status');

    studentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    student = await studentContext.newPage();
    student.on('pageerror', error => errors.push(error.message));
    await login(student, `shsat_release_${stamp}`, `Release${stamp}!`);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByText(examTitle, { exact: true }).waitFor();
    await student.getByRole('button', { name: /^Start exam/ }).waitFor();
    await student.getByText(examTitle, { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await student.screenshot({ path: `/tmp/shsat-exam-release-student-mobile-${stamp}.png` });
    const studentWidth = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(studentWidth.page <= studentWidth.viewport, 'the published exam card fits a 390px page');

    await openActions(row, examTitle, 'Unpublish');
    await admin.getByRole('heading', { name: 'Unpublish this exam?' }).waitFor();
    await admin.getByRole('button', { name: 'Unpublish Exam', exact: true }).click();
    await row.locator('.access-pill--hidden').waitFor();
    assert.equal((await api(admin, `/api/admin/exams/${examId}`)).summary.status, 'DRAFT', 'unpublish returns it to draft');
    await student.reload();
    await student.getByRole('heading', { name: 'Your exams' }).waitFor();
    await student.getByText('No exams have been assigned to you yet.', { exact: true }).waitFor();
    assert.equal(await student.getByText(examTitle, { exact: true }).count(), 0, 'unpublished exam is removed from the student workspace');

    await openActions(row, examTitle, 'Monitor');
    await admin.waitForURL(url => url.pathname.endsWith(`/exams/${examId}/monitor`));
    await admin.getByRole('heading', { name: examTitle }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-exam-release-monitor-${stamp}.png` });
    await admin.getByRole('button', { name: 'Back' }).click();
    await admin.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
    await admin.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    await admin.locator('.release-search-input').fill(examTitle);
    await row.waitFor();

    await openActions(row, examTitle, 'Delete');
    const deleteDialog = admin.getByRole('heading', { name: 'Delete this exam release?' });
    await deleteDialog.waitFor();
    assert.ok((await admin.locator('.publish-confirm-details').innerText()).includes(`Students: Release Check ${stamp}`),
      'the delete confirmation identifies the affected student');
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
    const deletedExam = await raw(admin, `/api/admin/exams/${examId}`);
    assert.equal(deletedExam.status, 404, 'confirmed deletion removes the release');
    examId = undefined;

    const deletedStudent = await api(admin, `/api/admin/users/${studentId}`, 'DELETE').then(() => true);
    assert.equal(deletedStudent, true);
    studentId = undefined;
    await student.reload();
    await student.waitForURL(url => url.pathname.endsWith('/login'));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['audience details and filters', 'publish and student access', 'unpublish removes student access', 'monitor and return', 'delete cancel and 5-second cooldown'],
      studentWidth,
      pageErrors: errors.length,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (studentId) await api(admin, `/api/admin/users/${studentId}`, 'DELETE').catch(() => {});
    await studentContext?.close();
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

main().catch(error => { console.error(error.stack || error); process.exit(1); });
