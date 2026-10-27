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
  const studentContexts = [];
  const studentAccounts = [];
  const pageErrors = [];
  admin.on('pageerror', error => pageErrors.push(error.message));
  const stamp = Date.now();
  const className = `SHSAT Result States ${stamp}`;
  const examTitle = `SHSAT Result States ${stamp}`;
  let classId;
  let examId;

  try {
    await login(admin, adminUsername, adminPassword);
    const papers = await api(admin, '/api/admin/exam-types/SHSAT/papers');
    const paper = papers.find(item => item.status === 'READY');
    assert.ok(paper, 'a ready SHSAT paper is available');

    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: className, description: 'Temporary mixed result state verification', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    const students = await Promise.all(['Not Started', 'In Progress', 'Completed'].map(async (state, index) => {
      const username = `shsat_result_state_${stamp}_${index}`;
      const password = `Result${stamp}_${index}!`;
      const user = await api(admin, '/api/admin/users', 'POST', {
        username, password, realName: `${state} ${stamp}`, roleCode: 'STUDENT', email: null, phone: null,
      });
      studentAccounts.push(Number(user.id));
      await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: user.id });
      return { state, username, password, id: Number(user.id) };
    }));

    const created = await api(admin, `/api/admin/papers/${paper.id}/exams`, 'POST', {
      title: examTitle, description: 'Temporary mixed result states',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      durationSeconds: 180 * 60, attemptLimit: 1, targetScope: 'SELECTED',
      autoSubmit: true, allowReview: true,
    });
    examId = Number(created.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    for (const student of students.slice(1)) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      studentContexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await login(page, student.username, student.password);
      const attempt = await api(page, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
      if (student.state === 'Completed') {
        const submitted = await api(page, `/api/student/attempts/${attempt.id}/submit`, 'POST');
        assert.ok(['SUBMITTED', 'COMPLETED'].includes(submitted.status), 'the completed sample is submitted');
      }
    }

    const classExams = await api(admin, `/api/admin/classes/${classId}/exams?examTypeCodes=SHSAT`);
    assert.equal(classExams.length, 1, 'the class exam list includes the exam once students have participated');
    assert.equal(Number(classExams[0].examId), examId);
    await admin.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${classId}`);
    await admin.getByRole('heading', { name: className, exact: true }).waitFor();
    const classExamRow = admin.locator('.class-exam-table tbody tr').filter({ hasText: examTitle });
    await classExamRow.waitFor();
    await classExamRow.locator('.exam-status-pill').getByText('Live', { exact: true }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-class-detail-live-exam-${stamp}.png` });

    await classExamRow.getByRole('button', { name: 'Monitor', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/exams/${examId}/monitor`));
    await admin.getByRole('heading', { name: examTitle, exact: true }).waitFor();
    const monitorSummary = admin.locator('.monitor-summary-grid');
    await monitorSummary.getByText('In progress', { exact: true }).waitFor();
    assert.equal(await monitorSummary.locator('.monitor-summary-item').filter({ hasText: 'In progress' }).locator('strong').innerText(), '1');
    assert.equal(await monitorSummary.locator('.monitor-summary-item').filter({ hasText: 'Incomplete students' }).locator('strong').innerText(), '2');
    assert.equal(await monitorSummary.locator('.monitor-summary-item').filter({ hasText: 'Completed students' }).locator('strong').innerText(), '1');
    assert.equal(await monitorSummary.locator('.monitor-summary-item').filter({ hasText: 'Total students' }).locator('strong').innerText(), '3');
    await admin.screenshot({ path: `/tmp/shsat-class-detail-live-monitor-${stamp}.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    const monitorMobile = await measureWidth(admin);
    assert.ok(monitorMobile.page <= monitorMobile.viewport, 'the in-progress monitor page has no mobile overflow');
    for (const label of ['In progress', 'Incomplete students', 'Completed students', 'Total students']) {
      assert.ok(await monitorSummary.getByText(label, { exact: true }).isVisible(), `${label} remains visible on mobile`);
    }
    await admin.screenshot({ path: `/tmp/shsat-class-detail-live-monitor-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 900 });
    await admin.getByRole('button', { name: 'Back', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/admin/classes/${classId}`));

    await admin.setViewportSize({ width: 390, height: 844 });
    const classDetailMobile = await measureWidth(admin);
    assert.ok(classDetailMobile.page <= classDetailMobile.viewport, 'the live class exam card has no mobile page overflow');
    const mobileClassRow = admin.locator('.class-exam-table tbody tr').filter({ hasText: examTitle });
    await mobileClassRow.getByText('Live', { exact: true }).waitFor();
    assert.ok(await mobileClassRow.getByRole('button', { name: 'View Results', exact: true }).isVisible());
    assert.ok(await mobileClassRow.getByRole('button', { name: 'Monitor', exact: true }).isVisible());
    await admin.screenshot({ path: `/tmp/shsat-class-detail-live-exam-mobile-${stamp}.png` });
    await admin.setViewportSize({ width: 1440, height: 900 });

    const scoreRows = await api(admin, `/api/admin/reports/exams/${examId}/classes/${classId}`);
    assert.equal(scoreRows.length, 3, 'all three assigned students appear in class results');
    assert.deepEqual(scoreRows.map(row => row.status).sort(), ['COMPLETED', 'IN_PROGRESS', 'NOT_STARTED']);

    await admin.locator('.class-exam-table tbody tr').filter({ hasText: examTitle })
      .getByRole('button', { name: 'View Results', exact: true }).click();
    await admin.waitForURL(url => url.pathname.endsWith(`/classes/${classId}/exams/${examId}/results`));
    await admin.getByRole('heading', { name: examTitle, exact: true }).waitFor();
    for (const student of students) {
      const row = admin.locator('.result-table tbody tr').filter({ hasText: `${student.state} ${stamp}` });
      await row.getByText(student.state, { exact: true }).waitFor();
    }
    await admin.getByText('Across 1 completed students in this class release', { exact: true }).waitFor();
    await admin.getByText('33%', { exact: true }).waitFor();
    await admin.screenshot({ path: `/tmp/shsat-class-results-states-desktop-${stamp}.png` });

    await admin.setViewportSize({ width: 390, height: 844 });
    const mobile = await measureWidth(admin);
    assert.ok(mobile.page <= mobile.viewport, 'the results page has no root overflow at 390px');
    await admin.locator('.result-table-wrap').scrollIntoViewIfNeeded();
    await admin.screenshot({ path: `/tmp/shsat-class-results-states-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', checks: ['Not Started / In Progress / Completed rows match API',
      'summary includes only completed results', '33% completion count', '390px layout', 'no page errors'], mobile }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    for (const userId of studentAccounts) {
      if (classId) await api(admin, `/api/admin/classes/${classId}/students/${userId}`, 'DELETE').catch(() => {});
    }
    if (classId) await api(admin, `/api/admin/classes/${classId}`, 'DELETE').catch(() => {});
    for (const userId of studentAccounts) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    for (const context of studentContexts) await context.close();
    await adminContext.close();
    await browser.close();
  }
}

// 使用当前浏览器会话验证 HTTP 业务接口，使测试数据仍经过与用户相同的认证边界。
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
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

// 统一登录入口并等待应用路由守卫完成认证跳转。
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

main().catch(error => { console.error(error.stack || error); process.exit(1); });
