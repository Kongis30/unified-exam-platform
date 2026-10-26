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
  const outsiderContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const outsider = await outsiderContext.newPage();
  const pageErrors = [];
  [admin, student, outsider].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  const stamp = Date.now();
  const password = `shsat-state-${stamp}`;
  const eligibleUsername = `shsat_state_${stamp}`;
  const outsiderUsername = `shsat_outsider_${stamp}`;
  const examIds = [];
  const userIds = [];

  try {
    await login(admin, adminUsername, adminPassword);
    const eligible = await api(admin, '/api/admin/users', 'POST', {
      username: eligibleUsername,
      password,
      realName: 'SHSAT State Check',
      roleCode: 'STUDENT',
      email: null,
      phone: null,
    });
    userIds.push(eligible.id);
    const ineligible = await api(admin, '/api/admin/users', 'POST', {
      username: outsiderUsername,
      password,
      realName: 'SHSAT State Check Outsider',
      roleCode: 'STUDENT',
      email: null,
      phone: null,
    });
    userIds.push(ineligible.id);

    const papers = await api(admin, '/api/admin/exam-types/SHSAT/papers');
    const paper = papers.find(item => item.id === 247 && item.status === 'READY');
    assert.ok(paper, 'the 100-question SHSAT CRASH COURSE TEST 4 paper is available');

    const upcoming = await createPublishedExam(admin, paper.id, eligible.id, 'Upcoming', 20);
    examIds.push(upcoming.id);
    const available = await createPublishedExam(admin, paper.id, eligible.id, 'Available', -5);
    examIds.push(available.id);

    await login(student, eligibleUsername, password);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await student.getByRole('heading', { name: 'SHSAT', exact: true }).waitFor();
    const rows = student.locator('.student-exam-list .paper-row');
    const upcomingRow = rows.filter({ hasText: upcoming.title });
    const availableRow = rows.filter({ hasText: available.title });
    await upcomingRow.waitFor();
    await availableRow.waitFor();

    assert.match(await upcomingRow.innerText(), /Upcoming/);
    assert.equal(await upcomingRow.getByRole('button', { name: 'Start exam' }).count(), 0,
      'upcoming exams cannot be started early');
    assert.match(await availableRow.innerText(), /Available/);
    assert.equal(await availableRow.getByRole('button', { name: 'Start exam' }).count(), 1,
      'available exams provide a Start exam action');
    assert.equal(await availableRow.getByRole('button', { name: 'Start exam' }).isEnabled(), true);
    await student.screenshot({ path: `/tmp/shsat-student-exam-states-${stamp}.png`, fullPage: true });

    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    assert.ok(mobileSize.pageWidth <= mobileSize.viewportWidth, 'SHSAT student home has no mobile overflow');
    await student.screenshot({ path: `/tmp/shsat-student-exam-states-mobile-${stamp}.png`, fullPage: true });

    await login(outsider, outsiderUsername, password);
    await outsider.goto(`${baseUrl}/student/systems/SHSAT`);
    await outsider.getByRole('heading', { name: 'SHSAT', exact: true }).waitFor();
    assert.equal(await outsider.getByText(upcoming.title, { exact: true }).count(), 0,
      'a student outside the target audience cannot see an upcoming release');
    assert.equal(await outsider.getByText(available.title, { exact: true }).count(), 0,
      'a student outside the target audience cannot see an available release');
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['Upcoming status and disabled start', 'Available status and start action', 'target eligibility isolation', '390px layout'],
      mobileSize,
      pageErrors: pageErrors.length,
    }));
  } finally {
    for (const examId of examIds) {
      await api(admin, `/api/admin/exams/${examId}`, 'DELETE');
    }
    for (const userId of userIds) {
      await api(admin, `/api/admin/users/${userId}`, 'DELETE');
    }
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

async function createPublishedExam(admin, paperId, studentId, state, startOffsetMinutes) {
  const now = Date.now();
  const created = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
    title: `SHSAT ${state} state ${Date.now()}`,
    description: 'Temporary student status verification',
    opensAt: new Date(now + startOffsetMinutes * 60_000).toISOString(),
    closesAt: new Date(now + 45 * 60_000).toISOString(),
    durationSeconds: 10_800,
    attemptLimit: 1,
    targetScope: 'SELECTED',
  });
  const examId = created.summary.id;
  await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', {
    classIds: [],
    studentUserIds: [studentId],
  });
  await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');
  return { id: examId, title: created.summary.title };
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
