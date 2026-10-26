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
  const username = `shsat_history_delete_${stamp}`;
  const password = `Delete${stamp}!`;
  const examTitle = `Historical Delete ${suffix}`;
  let studentId;
  let classId;
  let examId;
  let attemptId;

  try {
    await login(admin, adminUsername, adminPassword);
    const papers = await api(admin, '/api/admin/exam-types/SHSAT/papers');
    const paper = papers.find(item => item.status === 'READY' && item.questionCount > 0);
    assert.ok(paper, 'a ready SHSAT paper is available for release');
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `History Delete ${suffix}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    studentId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `History Delete ${suffix}`, description: 'Temporary historical deletion verification', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: studentId });

    const release = await api(admin, `/api/admin/papers/${paper.id}/exams`, 'POST', {
      title: examTitle, description: 'Temporary historical deletion verification',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 20_000).toISOString(),
      durationSeconds: paper.defaultDurationSeconds || 10_800, attemptLimit: 1,
      targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    const attempt = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    attemptId = Number(attempt.id);
    await api(student, `/api/student/attempts/${attemptId}/submit`, 'POST');

    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60_000);
    const localDateTime = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
    const review = await api(admin, '/api/admin/wrong-answer-tasks', 'POST', {
      examId, classId, title: `Historical Review ${suffix}`, description: 'Linked cleanup verification',
      startAt: localDateTime(new Date(now.getTime() - 60_000)), endAt: localDateTime(end),
    });
    assert.equal((await api(admin, `/api/admin/wrong-answer-tasks/${review.taskId}`)).assignments[0].sourceAttemptId, attemptId);
    const windowRemainder = Date.parse(release.summary.closesAt) - Date.now();
    if (windowRemainder > 0) await new Promise(resolve => setTimeout(resolve, windowRemainder + 1_000));
    const historicalReleases = await api(admin, '/api/admin/exam-types/SHSAT/exams');
    assert.equal(historicalReleases.find(item => item.id === examId)?.status, 'CLOSED',
      'the expired published release is automatically closed');

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await admin.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    const row = admin.locator('.exam-release-table--history tbody tr').filter({ hasText: examTitle });
    await row.waitFor();
    assert.equal(await row.getByText('Unpublished', { exact: true }).count(), 1,
      'an ended exam is shown as unpublished in Historical Exams');
    const historicalCard = admin.locator('.exam-history-card');
    const collapseButton = historicalCard.getByRole('button', { name: /^(Collapse|Expand) historical exams$/ });
    if (await collapseButton.getAttribute('aria-label') === 'Expand historical exams') {
      await collapseButton.click();
    }
    await historicalCard.getByRole('button', { name: 'Collapse historical exams', exact: true }).click();
    assert.equal(await historicalCard.locator('.exam-release-table--history').count(), 0,
      'Historical Exams can be collapsed');
    await historicalCard.getByRole('button', { name: 'Expand historical exams', exact: true }).click();
    await row.waitFor();

    const historyPagination = historicalCard.locator('.table-pagination');
    const pageSummary = historyPagination.locator('> span');
    const totalMatch = (await pageSummary.innerText()).match(/of (\d+)/);
    const historicalTotal = Number(totalMatch?.[1] || 0);
    if (historicalTotal > 5) {
      await historicalCard.getByRole('combobox', { name: 'Historical rows per page' }).selectOption('5');
      await historyPagination.getByRole('button', { name: 'Next', exact: true }).click();
      assert.match(await historyPagination.innerText(), /Page 2\s*\/\s*\d+/,
        'historical releases can advance to the next page');
      await admin.screenshot({ path: `/tmp/shsat-historical-exams-page-2-${stamp}.png` });
      await historyPagination.getByRole('button', { name: 'Prev', exact: true }).click();
      assert.match(await historyPagination.innerText(), /Page 1\s*\/\s*\d+/,
        'historical releases can return to the previous page');
      await historicalCard.getByRole('combobox', { name: 'Historical rows per page' }).selectOption('10');
      await row.waitFor();
    }
    await admin.screenshot({ path: `/tmp/shsat-historical-exams-desktop-${stamp}.png` });
    await row.getByRole('button', { name: `Actions for ${examTitle}` }).click();
    await admin.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const dialog = admin.getByRole('dialog', { name: 'Delete this exam release?' });
    await dialog.waitFor();
    const warning = await dialog.innerText();
    for (const recordType of ['student attempt', 'answer', 'score', 'report', 'review assignment']) {
      assert.ok(warning.toLowerCase().includes(recordType), `the warning explains deletion of ${recordType} records`);
    }
    const deleteButton = dialog.getByRole('button', { name: /^Delete Exam \(/ });
    await deleteButton.waitFor();
    assert.equal(await deleteButton.isDisabled(), true, 'the delete action is disabled during the 5-second cooldown');
    await admin.screenshot({ path: `/tmp/shsat-historical-delete-confirm-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the historical deletion dialog fits a 390px page');
    await admin.screenshot({ path: `/tmp/shsat-historical-delete-confirm-mobile-${stamp}.png` });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await api(admin, `/api/admin/exams/${examId}`)).summary.id, examId,
      'cancel preserves the historical exam');
    assert.equal((await api(admin, `/api/admin/wrong-answer-tasks/${review.taskId}`)).assignments.length, 1,
      'cancel preserves the linked review task');

    await admin.setViewportSize({ width: 1440, height: 900 });
    await row.getByRole('button', { name: `Actions for ${examTitle}` }).click();
    await admin.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const deleteDialog = admin.getByRole('dialog', { name: 'Delete this exam release?' });
    await deleteDialog.getByRole('button', { name: 'Delete Exam Permanently', exact: true }).waitFor({ timeout: 8_000 });
    const deleteResponse = admin.waitForResponse(response => response.url().endsWith(`/api/admin/exams/${examId}`)
      && response.request().method() === 'DELETE');
    await deleteDialog.getByRole('button', { name: 'Delete Exam Permanently', exact: true }).click();
    assert.equal((await deleteResponse).status(), 200, 'the historical exam delete request succeeds');
    await row.waitFor({ state: 'detached' });
    assert.equal((await raw(admin, `/api/admin/exams/${examId}`)).status, 404, 'the exam release is deleted');
    assert.equal((await raw(student, `/api/student/attempts/${attemptId}`)).status, 404,
      'the student attempt is deleted with its exam');
    assert.equal((await raw(admin, `/api/admin/wrong-answer-tasks/${review.taskId}`)).status, 404,
      'the linked review task is deleted with its exam');
    assert.ok((await api(admin, '/api/admin/users')).some(item => item.id === studentId),
      'deleting exam records preserves the shared student account');
    assert.equal((await raw(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`)).status, 200,
      'deleting exam records preserves the class');
    examId = undefined;
    await admin.reload();
    assert.equal(await admin.locator('.exam-release-table--history tbody tr').filter({ hasText: examTitle }).count(), 0,
      'the deleted exam disappears from historical releases');
    await api(admin, `/api/admin/classes/${classId}/students/${studentId}`, 'DELETE');
    await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE');
    await api(admin, `/api/admin/users/${studentId}`, 'DELETE');
    assert.equal((await api(admin, '/api/admin/users')).some(item => item.id === studentId), false,
      'the temporary shared student account is cleaned up after verifying it was preserved');
    assert.equal((await api(admin, '/api/admin/classes?examTypeCodes=SHSAT')).some(item => item.id === classId), false,
      'the temporary class is cleaned up after verifying it was preserved');
    classId = undefined;
    studentId = undefined;
    assert.deepEqual(pageErrors, [], 'the deletion flow has no browser errors');
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['closed release enters Historical Exams as Unpublished', 'Historical Exams collapse/expand and pagination',
        'deletion warning identifies all cascaded data', '5-second confirmation cooldown', 'cancel preserves exam and review task',
        'confirmed deletion removes release, attempt and review task', 'class and shared student account remain intact',
        'desktop and 390px confirmation layout'],
      examId: release.summary.id, attemptId, taskId: review.taskId, mobileSize, pageErrors: pageErrors.length,
      screenshots: [`/tmp/shsat-historical-exams-desktop-${stamp}.png`, `/tmp/shsat-historical-delete-confirm-${stamp}.png`,
        `/tmp/shsat-historical-delete-confirm-mobile-${stamp}.png`, `/tmp/shsat-historical-exams-page-2-${stamp}.png`],
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (classId && studentId) await api(admin, `/api/admin/classes/${classId}/students/${studentId}`, 'DELETE').catch(() => {});
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (studentId) await api(admin, `/api/admin/users/${studentId}`, 'DELETE').catch(() => {});
    await studentContext.close();
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
  const response = await raw(page, path, method, body);
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

async function raw(page, path, method = 'GET', body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  return page.evaluate(async ({ path, method, body, token }) => {
    const response = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-XSRF-TOKEN': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, text: await response.text() };
  }, { path, method, body, token });
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
