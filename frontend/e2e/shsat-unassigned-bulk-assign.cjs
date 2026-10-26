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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const stamp = Date.now();
  const students = [];
  let classId;

  try {
    await login(page);
    for (let index = 1; index <= 18; index += 1) {
      const suffix = String(index).padStart(2, '0');
      const student = await api(page, '/api/admin/users', 'POST', {
        username: `shsat_bulk_${stamp}_${suffix}`,
        password: `shsat-bulk-${stamp}`,
        realName: `SHSAT Bulk ${suffix}`,
        roleCode: 'STUDENT',
        email: null,
        phone: null,
      });
      students.push({ ...student, realName: `SHSAT Bulk ${suffix}` });
    }

    const classroom = await api(page, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `SHSAT Bulk Class ${stamp}`,
      description: 'Temporary batch assignment verification',
      sortOrder: 999,
      active: true,
    });
    classId = classroom.classId || classroom.id;
    assert.ok(classId, 'temporary SHSAT class is created');

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await page.getByRole('tab', { name: 'Classes', exact: true }).click();
    const scrollRegion = page.locator('.unassigned-students-scroll');
    await scrollRegion.waitFor();
    await page.getByTitle('Collapse unassigned students').click();
    await scrollRegion.waitFor({ state: 'detached' });
    await page.getByTitle('Expand unassigned students').click();
    await scrollRegion.waitFor();
    for (const student of students) {
      await scrollRegion.getByRole('checkbox', { name: `Select ${student.realName}` }).waitFor();
    }

    const scrollMetrics = await scrollRegion.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      maxHeight: getComputedStyle(element).maxHeight,
    }));
    assert.equal(scrollMetrics.maxHeight, '800px');
    assert.ok(scrollMetrics.clientHeight <= 800, 'unassigned student list is capped at 800px');
    assert.ok(scrollMetrics.scrollHeight > scrollMetrics.clientHeight, 'the list can scroll when many students are present');

    const selectAll = scrollRegion.getByRole('checkbox', { name: 'Select all unassigned students' });
    await selectAll.check();
    const selectionStatus = page.locator('.unassigned-students-card .form-hint');
    const allSelectedStatus = await selectionStatus.innerText();
    const allSelectedCount = allSelectedStatus.match(/^(\d+) selected · (\d+) unassigned students$/);
    assert.ok(allSelectedCount && allSelectedCount[1] === allSelectedCount[2] && Number(allSelectedCount[1]) >= students.length,
      'select-all selects every currently unassigned student');
    await selectAll.uncheck();
    assert.match(await selectionStatus.innerText(), /^0 selected · /, 'select-all can clear the selection');

    const firstTwo = students.slice(0, 2);
    for (const student of firstTwo) {
      await scrollRegion.getByRole('checkbox', { name: `Select ${student.realName}` }).check();
    }
    await page.getByRole('button', { name: 'Refresh unassigned students' }).click();
    await page.waitForFunction(() => document.querySelector('.unassigned-students-card .form-hint')?.textContent?.startsWith('2 selected ·'));
    await scrollRegion.evaluate(element => { element.scrollTop = 0; });
    await page.locator('.unassigned-students-card').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    await page.screenshot({ path: `/tmp/shsat-unassigned-bulk-desktop-${stamp}.png` });
    await page.getByRole('button', { name: 'Assign selected (2)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign Students to a Class' });
    await dialog.waitFor();
    await dialog.locator('select').selectOption(String(classId));
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await scrollRegion.getByRole('checkbox', { name: `Select ${firstTwo[0].realName}` }).isChecked(), true,
      'cancel keeps the selection for correction or retry');

    await page.getByRole('button', { name: 'Assign selected (2)' }).click();
    const retryDialog = page.getByRole('dialog', { name: 'Assign Students to a Class' });
    await retryDialog.locator('select').selectOption(String(classId));
    await retryDialog.getByRole('button', { name: 'Assign Students', exact: true }).click();
    await page.getByText('Students Assigned', { exact: true }).waitFor();

    const members = await api(page, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`);
    assert.deepEqual(new Set(members.map(item => Number(item.userId || item.id))),
      new Set(firstTwo.map(item => Number(item.id))), 'only selected students are assigned');
    const remainingRows = await scrollRegion.locator('tbody tr').allTextContents();
    for (const student of firstTwo) {
      assert.ok(!remainingRows.some(row => row.includes(student.realName)), `${student.realName} leaves the unassigned list`);
    }
    const accounts = await api(page, '/api/admin/users');
    for (const student of firstTwo) {
      assert.ok(accounts.some(item => Number(item.id) === Number(student.id)), 'assignment keeps the unified account');
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileWidth = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    assert.ok(mobileWidth.page <= mobileWidth.viewport, '390px class management has no horizontal overflow');
    await page.getByText('Students Assigned', { exact: true }).waitFor({ state: 'hidden' });
    await scrollRegion.evaluate(element => { element.scrollTop = 0; });
    await page.evaluate(() => {
      const card = document.querySelector('.unassigned-students-card');
      const top = card.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 150));
    });
    const mobileTableWidth = await scrollRegion.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    assert.ok(mobileTableWidth.scrollWidth <= mobileTableWidth.clientWidth, 'the mobile student table fits without horizontal scrolling');
    await page.screenshot({ path: `/tmp/shsat-unassigned-bulk-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['collapse and expand', '800px scroll cap', 'select all and clear selection', 'multi-select and refresh preserve selection', 'cancel preserves selection', 'assign selected students', 'accounts remain active', '390px layout without table overflow', 'temporary data cleanup'],
      scrollMetrics,
      mobileWidth,
      mobileTableWidth,
      pageErrors: pageErrors.length,
    }));
  } finally {
    if (classId) {
      for (const student of students.slice(0, 2)) {
        await api(page, `/api/admin/classes/${classId}/students/${student.id}`, 'DELETE').catch(() => {});
      }
      await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    }
    for (const student of students) {
      await api(page, `/api/admin/users/${student.id}`, 'DELETE').catch(() => {});
    }
    if (students.length) {
      const remainingUsers = await api(page, '/api/admin/users');
      assert.ok(students.every(student => !remainingUsers.some(item => Number(item.id) === Number(student.id))),
        'temporary student accounts are removed after the test');
    }
    if (classId) {
      const remainingClasses = await api(page, '/api/admin/classes?examTypeCodes=SHSAT');
      assert.ok(!remainingClasses.some(item => Number(item.classId || item.id) === Number(classId)),
        'temporary SHSAT class is removed after the test');
    }
    await browser.close();
  }
}

async function login(page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(adminUsername);
  await page.getByLabel('Password').fill(adminPassword);
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
