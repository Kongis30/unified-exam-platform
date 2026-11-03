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
  const username = `shsat_monitor_retake_${stamp}`;
  const password = `Monitor${stamp}!`;
  const examTitle = `SHSAT Monitor Retake ${stamp}`;
  let studentId;
  let examId;

  try {
    await login(admin, adminUsername, adminPassword);
    const account = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Monitor Retake ${stamp}`,
      roleCode: 'STUDENT', email: null, phone: null,
    });
    studentId = Number(account.id);

    const paper = (await api(admin, '/api/admin/exam-types/SHSAT/papers'))
      .find(item => item.status === 'READY');
    assert.ok(paper, 'a ready SHSAT paper is available');
    const created = await api(admin, `/api/admin/papers/${paper.id}/exams`, 'POST', {
      title: examTitle,
      description: 'Temporary repeat-attempt monitor verification',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: paper.defaultDurationSeconds || 10_800,
      attemptLimit: 3,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    examId = Number(created.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [], studentUserIds: [studentId] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    const submittedAttempts = [];
    for (let index = 0; index < 2; index += 1) {
      const started = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
      const submitted = await api(student, `/api/student/attempts/${started.id}/submit`, 'POST');
      assert.ok(['SUBMITTED', 'COMPLETED'].includes(submitted.status), `retake ${index + 1} is submitted`);
      submittedAttempts.push(Number(started.id));
    }
    const activeAttempt = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    assert.ok(activeAttempt.id, 'the third allowed attempt is active');

    const live = await api(admin, `/api/admin/reports/exams/${examId}/monitor/live`);
    assert.equal(Number(live.summary.startedAttempts), 3, 'all three attempts remain represented');
    assert.equal(Number(live.summary.inProgressAttempts), 1, 'the active attempt count stays separate');
    assert.equal(Number(live.summary.finishedAttempts), 2, 'both submitted attempts are counted');
    assert.equal(Number(live.summary.inProgressStudents), 1, 'the student is counted once while taking the third attempt');
    assert.equal(Number(live.summary.completedStudents), 1, 'two completed retakes count as one completed student');
    assert.equal(Number(live.summary.incompleteStudents), 2, 'incomplete count follows the source monitor calculation');
    assert.equal(Number(live.summary.totalStudents), 3, 'total uses the greater of participants and started attempts');

    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin/exams/${examId}/monitor`);
    await admin.getByRole('heading', { name: examTitle, exact: true }).waitFor();
    const summary = admin.locator('.monitor-summary-grid');
    const expectedCards = [
      ['In progress', '1'],
      ['Incomplete students', '2'],
      ['Completed students', '1'],
      ['Total students', '3'],
    ];
    for (const [label, value] of expectedCards) {
      const card = summary.locator('.monitor-summary-item').filter({ hasText: label });
      assert.equal((await card.locator('strong').innerText()).trim(), value, `${label} displays ${value}`);
    }
    await admin.screenshot({ path: `/tmp/shsat-monitor-retry-counters-desktop-${stamp}.png` });

    await admin.setViewportSize({ width: 390, height: 844 });
    const mobile = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobile.page <= mobile.viewport, `monitor has no mobile page overflow: ${JSON.stringify(mobile)}`);
    for (const [label] of expectedCards) {
      assert.ok(await summary.getByText(label, { exact: true }).isVisible(), `${label} remains visible on mobile`);
    }
    await admin.screenshot({ path: `/tmp/shsat-monitor-retry-counters-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['repeat attempts are distinct from student counts', 'completed retakes count one student',
        'all monitor summary cards match the API', '390px layout', 'no page errors'],
      summary: live.summary,
      mobile,
      screenshots: [`/tmp/shsat-monitor-retry-counters-desktop-${stamp}.png`,
        `/tmp/shsat-monitor-retry-counters-mobile-${stamp}.png`],
      pageErrors: pageErrors.length,
    }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (studentId) await api(admin, `/api/admin/users/${studentId}`, 'DELETE').catch(() => {});
    if (examId) {
      const releases = await api(admin, '/api/admin/exam-types/SHSAT/exams');
      assert.ok(!releases.some(item => Number(item.id) === examId), 'temporary release is removed');
    }
    if (studentId) {
      const accounts = await api(admin, '/api/admin/users');
      assert.ok(!accounts.some(item => Number(item.id) === studentId), 'temporary student is removed');
    }
    await adminContext.close();
    await studentContext.close();
    await browser.close();
  }
}

async function login(page, user, pass) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
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

main().catch(error => { console.error(error.stack || error); process.exit(1); });
