const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const username = process.env.E2E_ADMIN_USERNAME;
const password = process.env.E2E_ADMIN_PASSWORD;
if (!username || !password) throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const stamp = Date.now();
  let classId;
  let studentId;
  let otherClassId;
  const candidateStudentIds = [];

  try {
    await login(page);
    const created = await api(page, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `SHSAT Detail Save ${stamp}`,
      description: 'Temporary class detail save verification',
      active: true,
    });
    classId = Number(created.classId || created.id);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${classId}`);
    await page.getByRole('heading', { name: `SHSAT Detail Save ${stamp}`, exact: true }).waitFor();

    await page.getByRole('button', { name: 'Edit Class', exact: true }).click();
    const className = page.getByLabel('Class Name');
    await className.fill('');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('Class name is required.', { exact: true }).waitFor();
    assert.equal(await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`).then(item => item.name),
      `SHSAT Detail Save ${stamp}`, 'required-field validation leaves the saved class unchanged');
    await page.screenshot({ path: `/tmp/shsat-class-detail-validation-${stamp}.png` });

    await className.fill(`SHSAT Detail Save ${stamp} Updated`);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByRole('status').getByText('Class updated.', { exact: true }).waitFor();
    await page.getByRole('heading', { name: `SHSAT Detail Save ${stamp} Updated`, exact: true }).waitFor();
    const saved = await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`);
    assert.equal(saved.name, `SHSAT Detail Save ${stamp} Updated`, 'class edit persists to the API');
    await page.screenshot({ path: `/tmp/shsat-class-detail-save-toast-${stamp}.png` });
    assert.ok(!(await overlaps(page.locator('.class-detail-toast'), page.locator('.class-detail-hero__actions'))),
      'the success notification does not cover the class detail actions');

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileDimensions.page <= mobileDimensions.viewport, 'the success notification does not cause mobile overflow');
    await page.screenshot({ path: `/tmp/shsat-class-detail-save-toast-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 900 });

    let failNextDetailLoad = true;
    const detailUrl = `**/api/admin/classes/${classId}?examTypeCodes=SHSAT`;
    const interruptDetail = async route => {
      if (failNextDetailLoad && route.request().method() === 'GET') {
        failNextDetailLoad = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(detailUrl, interruptDetail);
    await page.getByRole('button', { name: 'Refresh class detail' }).click();
    await page.locator('.admin-state--error').waitFor();
    await page.screenshot({ path: `/tmp/shsat-class-detail-load-error-${stamp}.png` });
    await page.unroute(detailUrl, interruptDetail);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('heading', { name: `SHSAT Detail Save ${stamp} Updated`, exact: true }).waitFor();
    assert.equal(await page.locator('.admin-state--error').count(), 0, 'Retry clears the transient detail load error');

    const createdStudent = await api(page, '/api/admin/users', 'POST', {
      username: `shsat_detail_student_${stamp}`,
      password: `DetailStudent${stamp}!`,
      realName: `Detail Student ${stamp}`,
      roleCode: 'STUDENT',
      email: `shsat_detail_${stamp}@example.test`,
      phone: null,
    });
    studentId = Number(createdStudent.id);
    await api(page, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: studentId });
    await page.reload();
    await page.getByRole('row', { name: new RegExp(`Detail Student ${stamp}`) }).waitFor();
    const studentRow = page.getByRole('row', { name: new RegExp(`Detail Student ${stamp}`) });

    await studentRow.getByRole('button', { name: 'View', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/classes/${classId}/students/${studentId}`));
    await page.getByRole('button', { name: 'Back to Class Detail', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/classes/${classId}`));

    const restoredStudentRow = page.getByRole('row', { name: new RegExp(`Detail Student ${stamp}`) });
    await restoredStudentRow.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.screenshot({ path: `/tmp/shsat-class-detail-student-edit-${stamp}.png` });
    await page.getByLabel('Student Name').fill(`Detail Student ${stamp} Updated`);
    await page.getByLabel('Notes').fill('Roster details update check');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByRole('status').getByText('Student details updated.', { exact: true }).waitFor();
    const editedStudent = await api(page, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`);
    const editedStudentRow = (editedStudent.items || editedStudent).find(item => Number(item.studentId || item.id) === studentId);
    assert.equal(editedStudentRow.realName || editedStudentRow.studentName || editedStudentRow.name,
      `Detail Student ${stamp} Updated`, 'student roster edit persists');

    const editedRow = page.getByRole('row', { name: new RegExp(`Detail Student ${stamp} Updated`) });
    await editedRow.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('heading', { name: 'Remove Student from This Class?', exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-class-detail-student-remove-${stamp}.png` });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.ok(await page.getByRole('row', { name: new RegExp(`Detail Student ${stamp} Updated`) }).count(),
      'canceling removal keeps the student in the class');
    await page.getByRole('row', { name: new RegExp(`Detail Student ${stamp} Updated`) })
      .getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Remove from Class', exact: true }).click();
    await page.getByRole('status').getByText(`Detail Student ${stamp} Updated was removed from this class.`, { exact: true }).waitFor();
    await page.getByRole('row', { name: new RegExp(`Detail Student ${stamp} Updated`) }).waitFor({ state: 'detached' });
    const usersAfterRemoval = await api(page, '/api/admin/users');
    assert.ok(usersAfterRemoval.some(item => Number(item.id) === studentId), 'removing a student preserves the unified account');

    const otherClass = await api(page, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `SHSAT Other Class ${stamp}`, description: 'Temporary enrollment reference class', active: true,
    });
    otherClassId = Number(otherClass.classId || otherClass.id);
    const candidates = await Promise.all([
      api(page, '/api/admin/users', 'POST', {
        username: `shsat_add_candidate_${stamp}`, password: `AddCandidate${stamp}!`,
        realName: `Add Candidate ${stamp}`, roleCode: 'STUDENT', email: `add_candidate_${stamp}@example.test`, phone: null,
      }),
      api(page, '/api/admin/users', 'POST', {
        username: `shsat_add_unassigned_${stamp}`, password: `AddUnassigned${stamp}!`,
        realName: `Add Unassigned ${stamp}`, roleCode: 'STUDENT', email: `add_unassigned_${stamp}@example.test`, phone: null,
      }),
    ]);
    candidateStudentIds.push(...candidates.map(candidate => Number(candidate.id)));
    await api(page, `/api/admin/classes/${otherClassId}/students`, 'POST', { studentUserId: candidateStudentIds[0] });

    await page.getByRole('button', { name: 'Add Students', exact: true }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add Students' });
    const candidateRow = addDialog.locator('.add-students-table tbody tr').filter({ hasText: `Add Candidate ${stamp}` });
    const unassignedRow = addDialog.locator('.add-students-table tbody tr').filter({ hasText: `Add Unassigned ${stamp}` });
    await candidateRow.waitFor();
    await unassignedRow.waitFor();
    assert.match(await candidateRow.locator('td').nth(3).innerText(), new RegExp(`SHSAT Other Class ${stamp}`),
      'the picker lists the candidate student’s current class membership');
    assert.equal((await unassignedRow.locator('td').nth(3).innerText()).trim(), 'No classes yet',
      'the picker clearly identifies an unassigned student');
    await addDialog.getByLabel('Search students').fill(`Add Candidate ${stamp}`);
    assert.equal(await addDialog.locator('.add-students-table tbody tr').count(), 1,
      'student search narrows the roster to matching accounts');
    await addDialog.getByLabel('Search students').fill('');
    await candidateRow.locator('input[type="checkbox"]').check();
    await addDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const rosterAfterCancelResponse = await api(page, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`);
    assert.equal((rosterAfterCancelResponse.items || rosterAfterCancelResponse)
      .some(item => Number(item.studentId || item.id) === candidateStudentIds[0]), false,
    'canceling the picker does not enroll the selected student');

    await page.getByRole('button', { name: 'Add Students', exact: true }).click();
    const reopenedDialog = page.getByRole('dialog', { name: 'Add Students' });
    const candidateRows = reopenedDialog.locator('.add-students-table tbody tr');
    await candidateRows.filter({ hasText: `Add Candidate ${stamp}` }).locator('input[type="checkbox"]').check();
    await candidateRows.filter({ hasText: `Add Unassigned ${stamp}` }).locator('input[type="checkbox"]').check();
    await reopenedDialog.screenshot({ path: `/tmp/shsat-class-add-students-selected-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const addDialogMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(addDialogMobileSize.page <= addDialogMobileSize.viewport, 'the multi-select picker fits a 390px viewport');
    assert.equal(await reopenedDialog.locator('.add-students-selected').evaluate(element => getComputedStyle(element).whiteSpace), 'nowrap',
      'the mobile selected-count label stays on one line');
    assert.equal(await reopenedDialog.getByRole('button', { name: 'Add 2 Students', exact: true }).evaluate(button => getComputedStyle(button).whiteSpace), 'nowrap',
      'the mobile batch-add action stays on one line');
    await reopenedDialog.screenshot({ path: `/tmp/shsat-class-add-students-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await reopenedDialog.getByRole('button', { name: 'Add 2 Students', exact: true }).click();
    await reopenedDialog.waitFor({ state: 'detached' });
    const classRosterResponse = await api(page, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`);
    const classRoster = classRosterResponse.items || classRosterResponse;
    assert.deepEqual(candidateStudentIds.map(id => classRoster.some(item => Number(item.studentId || item.id) === id)),
      [true, true], 'both selected accounts are added to the class');
    await page.getByRole('row', { name: new RegExp(`Add Candidate ${stamp}`) }).waitFor();
    await page.getByRole('row', { name: new RegExp(`Add Unassigned ${stamp}`) }).waitFor();

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${classId}`);
    await page.getByRole('heading', { name: `SHSAT Detail Save ${stamp} Updated`, exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'class detail remains within a 390px viewport');
    await page.screenshot({ path: `/tmp/shsat-class-detail-mobile-${stamp}.png` });
    console.log(JSON.stringify({ result: 'PASS', classId, studentId, candidateStudentIds, checks: ['required class name validation', 'saved notification visible outside modal', 'class edit persistence', 'detail load error and Retry', 'student View and return route', 'student roster edit and persistence', 'remove cancellation and confirmation', 'remove preserves unified account', 'student picker shows memberships and supports search', 'cancel selection has no effect', 'batch-add selected students persists', '390px layout'], dimensions, addDialogMobileSize, pageErrors: pageErrors.length }));
  } finally {
    if (classId && studentId) await api(page, `/api/admin/classes/${classId}/students/${studentId}`, 'DELETE').catch(() => {});
    for (const candidateId of candidateStudentIds) {
      if (classId) await api(page, `/api/admin/classes/${classId}/students/${candidateId}`, 'DELETE').catch(() => {});
      if (otherClassId) await api(page, `/api/admin/classes/${otherClassId}/students/${candidateId}`, 'DELETE').catch(() => {});
      await api(page, `/api/admin/users/${candidateId}`, 'DELETE').catch(() => {});
    }
    if (studentId) await api(page, `/api/admin/users/${studentId}`, 'DELETE').catch(() => {});
    if (otherClassId) await api(page, `/api/admin/classes/${otherClassId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (classId) await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    await browser.close();
  }
}

async function login(page) {
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
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: result.status, text: await result.text() };
  }, { path, method, body, token });
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

async function overlaps(first, second) {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  return firstBox && secondBox
    && firstBox.x < secondBox.x + secondBox.width
    && firstBox.x + firstBox.width > secondBox.x
    && firstBox.y < secondBox.y + secondBox.height
    && firstBox.y + firstBox.height > secondBox.y;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
