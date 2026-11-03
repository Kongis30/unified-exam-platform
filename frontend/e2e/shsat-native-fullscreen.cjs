const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
if (!adminUsername || !adminPassword) throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');

// 用有头浏览器验证系统原生全屏 API，避免 mock 掩盖浏览器权限或用户手势问题。
async function main() {
  const browser = await chromium.launch({
    headless: false,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const student = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const pageErrors = [];
  [admin, student].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  const stamp = Date.now();
  const username = `shsat_native_fullscreen_${stamp}`;
  const password = `Fullscreen${stamp}!`;
  const examTitle = `Native Fullscreen ${String(stamp).slice(-6)}`;
  let userId;
  let examId;
  let attemptId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Fullscreen Check ${stamp}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);

    const papers = await api(admin, '/api/admin/exam-types/SHSAT/papers');
    const paper = papers.find(item => Number(item.id) === 247 && item.status === 'READY');
    assert.ok(paper, 'the released SHSAT paper used for the browser check is available');
    const release = await api(admin, `/api/admin/papers/${paper.id}/exams`, 'POST', {
      title: examTitle,
      description: 'Temporary native fullscreen browser verification',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      durationSeconds: 1_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
      autoSubmit: true,
      allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [], studentUserIds: [userId] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    const distractionTab = process.env.E2E_NATIVE_TAB_SWITCH === 'manual'
      ? await student.context().newPage()
      : null;
    if (distractionTab) {
      await distractionTab.goto('about:blank');
      await student.bringToFront();
    }
    await student.getByRole('heading', { name: 'SHSAT', exact: true }).waitFor();
    const studentExams = await api(student, '/api/student/exams');
    assert.ok(studentExams.some(item => Number(item.examId || item.id) === examId),
      `the eligible student's exam list contains the published release: ${JSON.stringify(studentExams)}`);
    const card = student.locator('.student-exam-list article.paper-row').filter({ hasText: examTitle });
    await card.getByRole('button', { name: /^Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();

    const startAttempt = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /^ELA/ }).click();
    const attemptResponse = await startAttempt;
    assert.equal(attemptResponse.status(), 200, 'starting a section creates the attempt after native fullscreen starts');
    const attempt = await attemptResponse.json();
    attemptId = Number(attempt.id || attempt.attemptId);
    assert.ok(attemptId > 0, 'the student has an active exam attempt');
    await student.getByRole('heading', { name: /Fullscreen Required/ }).waitFor({ state: 'detached' });
    assert.equal(await student.evaluate(() => document.fullscreenElement === document.documentElement), true,
      'the section-selection click enters real browser fullscreen');
    await student.locator('.exam-transition-page .exam-transition-card__button').click();
    const readingIntroContinue = student.locator('.exam-transition-page .exam-transition-card__button');
    if (await readingIntroContinue.count()) await readingIntroContinue.click();
    await student.waitForTimeout(500);
    if (!await student.locator('.question-number').count()) {
      const pageText = (await student.locator('body').innerText()).slice(-1600);
      await student.screenshot({ path: `/tmp/shsat-native-fullscreen-start-state-${stamp}.png` });
      throw new Error(`The exam did not reach a question after the section transition; URL=${student.url()} body=${pageText}`);
    }
    const initialQuestion = await student.locator('.question-number').innerText();
    await student.screenshot({ path: `/tmp/shsat-native-fullscreen-active-${stamp}.png` });
    await student.evaluate(() => {
      window.__focusAuditEvents = [];
      document.addEventListener('visibilitychange', () => window.__focusAuditEvents.push({
        type: 'visibilitychange', state: document.visibilityState,
      }));
      document.addEventListener('fullscreenchange', () => window.__focusAuditEvents.push({
        type: 'fullscreenchange', state: Boolean(document.fullscreenElement),
      }));
    });

    // 用同一 Chromium 会话切换真实标签，验证浏览器实际发出的 visibilitychange/fullscreenchange。
    // 全屏启动后的 1.5 秒是产品定义的违规监测宽限期，切出标签时长超过该窗口后再切回。
    await student.waitForTimeout(1_700);
    if (process.env.E2E_NATIVE_ESCAPE === 'manual') {
      console.log('Press Escape in the fullscreen exam, then press Enter here.');
      await waitForTerminalInput();
      await student.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5_000 });
    } else if (process.env.E2E_NATIVE_TAB_SWITCH === 'manual') {
      console.log('Switch away from the fullscreen exam tab, then press Enter here.');
      await waitForTerminalInput();
      await student.waitForTimeout(250);
      const backgroundState = await student.evaluate(() => ({
        visibility: document.visibilityState,
        fullscreen: Boolean(document.fullscreenElement),
        events: window.__focusAuditEvents,
      }));
      if (backgroundState.visibility !== 'hidden') {
        throw new Error(`Native tab switch did not hide the exam page: ${JSON.stringify(backgroundState)}`);
      }
      await distractionTab.waitForTimeout(1_700);
      console.log('Switch back to the exam tab, then press Enter here.');
      await waitForTerminalInput();
      await student.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 5_000 });
    } else {
      // 自动化驱动的 Chromium 标签页切换不会稳定反映浏览器真实可见状态，因此保留全屏退出 API 的自动基线。
      await student.evaluate(() => document.exitFullscreen());
      await student.waitForTimeout(1_500);
    }
    const warning = student.locator('.focus-violation-modal');
    await warning.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (!await warning.isVisible().catch(() => false)) {
      const state = await student.evaluate(() => ({ fullscreen: Boolean(document.fullscreenElement), visibility: document.visibilityState }));
      const attemptState = await api(student, `/api/student/attempts/${attemptId}`);
      await student.screenshot({ path: `/tmp/shsat-native-fullscreen-escape-state-${stamp}.png` });
      throw new Error(`Native fullscreen exit did not show the focus warning; browser=${JSON.stringify(state)}, violations=${attemptState.progressState?.focusViolationCount || 0}`);
    }
    assert.match(await warning.innerText(), /You left the exam page/,
      'leaving native fullscreen displays the English warning instead of silently continuing');
    await student.screenshot({ path: `/tmp/shsat-native-fullscreen-warning-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    assert.ok(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'the native fullscreen warning fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-native-fullscreen-warning-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 900 });

    await warning.getByRole('button', { name: 'OK, Continue', exact: true }).click();
    await warning.waitFor({ state: 'hidden' });
    assert.equal(await student.evaluate(() => document.fullscreenElement === document.documentElement), true,
      'the warning confirmation re-enters native fullscreen before resuming');
    assert.equal(await student.locator('.question-number').innerText(), initialQuestion,
      'resuming fullscreen keeps the current question');
    const attemptState = await api(student, `/api/student/attempts/${attemptId}`);
    assert.equal(Number(attemptState.progressState?.focusViolationCount), 1,
      'the fullscreen violation is persisted to the attempt');
    assert.deepEqual(pageErrors, [], 'the exam flow has no browser runtime errors');

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['native fullscreen entry and exit', 'exit warning', 'mobile warning layout', 'resume fullscreen', 'violation persistence'],
      pageErrors: pageErrors.length,
      screenshots: [
        `/tmp/shsat-native-fullscreen-active-${stamp}.png`,
        `/tmp/shsat-native-fullscreen-warning-${stamp}.png`,
        `/tmp/shsat-native-fullscreen-warning-mobile-${stamp}.png`,
      ],
    }));
  } finally {
    if (await student.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) {
      await student.evaluate(() => document.exitFullscreen()).catch(() => {});
    }
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    await browser.close();
  }
}

// 登录并等待统一认证路由完成跳转，后续请求复用该浏览器会话。
async function login(page, loginUsername, loginPassword) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(loginUsername);
  await page.getByLabel('Password').fill(loginPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

// 复用同一会话和 CSRF token 调用管理/学生 API，供准备数据及核对持久化使用。
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

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${path} returned ${response.status}: ${response.text}`);
  }
  return response.text ? JSON.parse(response.text) : null;
}

// 手动验收时等待真实标签切换完成；普通自动化路径不会等待终端输入。
function waitForTerminalInput() {
  return new Promise(resolve => {
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
    process.stdin.resume();
  });
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
