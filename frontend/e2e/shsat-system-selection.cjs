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
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  const teacher = await teacherContext.newPage();
  const student = await studentContext.newPage();
  const errors = [];
  [admin, teacher, student].forEach(page => page.on('pageerror', error => errors.push(error.message)));
  const stamp = Date.now();
  const teacherUsername = `shsat_system_teacher_${stamp}`;
  const studentUsername = `shsat_system_student_${stamp}`;
  const temporaryIds = [];

  try {
    await login(admin, adminUsername, adminPassword);
    await admin.getByRole('heading', { name: 'Platform overview', exact: true }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-system-select-admin-${stamp}.png` });
    await enterWorkspace(admin, 'ADMIN');
    await admin.locator('.available-exams-card').getByText(
      'Start a practice attempt for a published exam from this dashboard.', { exact: true }
    ).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-system-select-admin-workspace-${stamp}.png` });

    const teacherAccount = await api(admin, '/api/admin/users', 'POST', {
      username: teacherUsername, password: `Teacher${stamp}!`, realName: `System Teacher ${stamp}`,
      roleCode: 'TEACHER', email: null, phone: null,
    });
    temporaryIds.push(Number(teacherAccount.id));
    const studentAccount = await api(admin, '/api/admin/users', 'POST', {
      username: studentUsername, password: `Student${stamp}!`, realName: `System Student ${stamp}`,
      roleCode: 'STUDENT', email: null, phone: null,
    });
    temporaryIds.push(Number(studentAccount.id));

    await login(teacher, teacherUsername, `Teacher${stamp}!`);
    await teacher.getByRole('heading', { name: 'Platform overview', exact: true }).waitFor();
    await enterWorkspace(teacher, 'TEACHER');
    assert.equal(await teacher.getByRole('tab', { name: 'Paper Management', exact: true }).count(), 0,
      'the teacher opens SHSAT with the permitted management tabs only');
    for (const label of ['Exam Release', 'Review Assignments', 'Classes']) {
      assert.equal(await teacher.getByRole('tab', { name: label, exact: true }).count(), 1);
    }
    await teacher.locator('.available-exams-card').getByText(
      'Start a practice attempt for a published exam from this dashboard.', { exact: true }
    ).waitFor();
    await teacher.screenshot({ path: `/tmp/shsat-system-select-teacher-${stamp}.png` });

    await login(student, studentUsername, `Student${stamp}!`);
    await student.waitForURL(url => url.pathname === '/student/systems');
    await student.getByRole('heading', { name: 'Choose your exam system', exact: true }).waitFor();
    assert.equal(await student.locator('.student-system-card').count(), 2,
      'SAT and PSAT share a workspace while SHSAT remains a separate system');
    const shsatCard = student.locator('.student-system-card').filter({ hasText: 'SHSAT' });
    await shsatCard.getByRole('link', { name: 'Enter SHSAT' }).waitFor();
    await student.screenshot({ path: `/tmp/shsat-system-select-student-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    const systemPickerMobileSize = await measureWidth(student);
    assert.ok(systemPickerMobileSize.page <= systemPickerMobileSize.viewport,
      'the student system selector fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-system-select-student-mobile-${stamp}.png` });
    await shsatCard.getByRole('link', { name: 'Enter SHSAT' }).click();
    await student.waitForURL(url => url.pathname === '/student/systems/SHSAT');
    await student.getByRole('heading', { name: 'Your exams', exact: true }).waitFor();

    await teacher.setViewportSize({ width: 390, height: 844 });
    const teacherMobileSize = await measureWidth(teacher);
    assert.ok(teacherMobileSize.page <= teacherMobileSize.viewport,
      'the teacher SHSAT workspace fits a 390px viewport');
    await teacher.screenshot({ path: `/tmp/shsat-system-select-teacher-mobile-${stamp}.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['admin opens SHSAT from platform overview', 'teacher opens SHSAT with role-specific tabs',
        'student chooses SHSAT from the unified system selector', 'SAT and PSAT appear as one workspace',
        '390px student and teacher layouts'],
      systemPickerMobileSize,
      teacherMobileSize,
      pageErrors: errors.length,
    }));
  } finally {
    for (const userId of temporaryIds) {
      await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    }
    await studentContext.close();
    await teacherContext.close();
    await adminContext.close();
    await browser.close();
  }
}

async function enterWorkspace(page, role) {
  const card = page.locator('.type-card').filter({ hasText: 'SHSAT' });
  await card.getByRole('link', { name: 'Open workspace' }).click();
  await page.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
  await page.getByRole('tab', { name: 'Classes', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Paper Management', exact: true }).count(), role === 'ADMIN' ? 1 : 0);
  await page.getByRole('tab', { name: 'Classes', exact: true }).click();
  await page.waitForFunction(() => {
    const available = document.querySelector('.available-exams-card');
    const assigned = document.querySelector('.dashboard-review-card');
    const classesLoaded = document.querySelector('.class-grid') || document.body.innerText.includes('No classes found.');
    return available && assigned && !available.innerText.includes('Loading')
      && !assigned.innerText.includes('Loading') && classesLoaded;
  });
}

async function login(page, username, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

async function measureWidth(page) {
  return page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
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

main().catch(error => { console.error(error.stack || error); process.exit(1); });
