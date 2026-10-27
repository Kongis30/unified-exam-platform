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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let examId;
  const stamp = Date.now();
  const examTitle = `SHSAT release form check ${stamp}`;

  try {
    await login(page, adminUsername, adminPassword);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await page.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    await page.getByRole('button', { name: 'Create Exam', exact: true }).click();

    const modal = page.locator('.exam-release-modal');
    await modal.waitFor();
    const startTime = modal.getByRole('textbox', { name: 'Start time' });
    const endTime = modal.getByRole('textbox', { name: 'End time' });
    assert.ok(await startTime.inputValue(), 'the start time has a usable default');
    assert.ok(await endTime.inputValue(), 'the end time has a usable default');
    await page.screenshot({ path: `/tmp/shsat-exam-release-create-form-${stamp}.png` });

    const examsBeforeValidation = await api(page, '/api/admin/exam-types/SHSAT/exams');
    await modal.getByRole('button', { name: 'Create Release', exact: true }).click();
    await modal.getByText('Select a paper and enter the title, start time, and end time.', { exact: true }).waitFor();
    const examsAfterValidation = await api(page, '/api/admin/exam-types/SHSAT/exams');
    assert.deepEqual(examsAfterValidation.map(item => item.id), examsBeforeValidation.map(item => item.id),
      'invalid form submission does not create an exam');

    const papers = await api(page, '/api/admin/exam-types/SHSAT/papers');
    const paper = papers.find(item => item.status === 'READY');
    assert.ok(paper, 'a READY SHSAT paper is available');
    const originalStartTime = await startTime.inputValue();
    const originalEndTime = await endTime.inputValue();
    const durationInput = modal.getByLabel('Attempt Duration (minutes)');
    const originalDuration = await durationInput.inputValue();
    await modal.locator('.exam-paper-select').selectOption(String(paper.id));
    await modal.getByLabel('Exam Title').fill(examTitle);
    await endTime.fill(originalStartTime);
    const examsBeforeInvalidWindow = await api(page, '/api/admin/exam-types/SHSAT/exams');
    await modal.getByRole('button', { name: 'Create Release', exact: true }).click();
    await modal.getByText('The end time must be after the start time.', { exact: true }).waitFor();
    assert.deepEqual((await api(page, '/api/admin/exam-types/SHSAT/exams')).map(item => item.id),
      examsBeforeInvalidWindow.map(item => item.id), 'invalid time ordering does not create an exam');
    await endTime.fill(originalEndTime);

    const examsBeforeInvalidDuration = await api(page, '/api/admin/exam-types/SHSAT/exams');
    await durationInput.fill('0');
    await modal.getByRole('button', { name: 'Create Release', exact: true }).click();
    await modal.getByText('Duration must be greater than 0.', { exact: true }).waitFor();
    assert.deepEqual((await api(page, '/api/admin/exam-types/SHSAT/exams')).map(item => item.id),
      examsBeforeInvalidDuration.map(item => item.id), 'zero duration does not create an exam');
    await durationInput.fill(originalDuration);

    const apiStart = new Date(Date.now() + 60 * 60 * 1000);
    const invalidApiResponse = await apiRequest(page, `/api/admin/papers/${paper.id}/exams`, 'POST', {
      title: `SHSAT invalid time check ${stamp}`,
      description: null,
      opensAt: apiStart.toISOString(),
      closesAt: new Date(apiStart.getTime() - 60 * 1000).toISOString(),
      durationSeconds: 180 * 60,
      attemptLimit: 1,
      targetScope: 'ALL_STUDENTS',
      autoSubmit: true,
      allowReview: true,
    });
    assert.equal(invalidApiResponse.status, 400, 'the backend rejects a closing time before the opening time');
    assert.ok(!(await api(page, '/api/admin/exam-types/SHSAT/exams'))
      .some(item => item.title === `SHSAT invalid time check ${stamp}`), 'rejected API creation leaves no exam record');

    const activeClasses = (await api(page, '/api/admin/classes?examTypeCodes=SHSAT')).filter(item => item.status === 'ACTIVE');
    assert.ok(activeClasses.length, 'at least one active SHSAT class is available');
    await modal.getByLabel('Exam Description').fill('Temporary UI form verification');
    await modal.getByRole('radio', { name: /Specific classes/ }).check();
    const offeredClassIds = await modal.locator('.exam-class-option input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => Number(input.value)));
    assert.deepEqual(offeredClassIds.sort((a, b) => a - b), activeClasses.map(item => Number(item.id)).sort((a, b) => a - b),
      'the audience picker offers only active classes');
    const examsBeforeMissingAudience = await api(page, '/api/admin/exam-types/SHSAT/exams');
    await modal.getByRole('button', { name: 'Create Release', exact: true }).click();
    await modal.getByText('Select at least one class for this release.', { exact: true }).waitFor();
    assert.deepEqual((await api(page, '/api/admin/exam-types/SHSAT/exams')).map(item => item.id),
      examsBeforeMissingAudience.map(item => item.id), 'a selected-class release requires at least one active class');
    const classOption = modal.locator('.exam-class-option').first();
    await classOption.waitFor();
    const className = (await classOption.locator('strong').innerText()).trim();
    await classOption.locator('input[type="checkbox"]').check();
    assert.equal(await modal.locator('.exam-class-picker__header').innerText().then(text => text.includes('1 selected')), true,
      'the selected audience count updates');
    assert.equal(await modal.getByLabel('Auto-submit when time expires').isChecked(), true);
    assert.equal(await modal.getByLabel('Allow review').isChecked(), true);

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on('pageerror', error => errors.push(error.message));
    await login(mobilePage, adminUsername, adminPassword);
    await mobilePage.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await mobilePage.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    await mobilePage.getByRole('button', { name: 'Create Exam', exact: true }).click();
    const mobileModal = mobilePage.locator('.exam-release-modal');
    await mobileModal.waitFor();
    const mobileSize = await mobilePage.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the create exam dialog fits a 390px viewport');
    await mobilePage.screenshot({ path: `/tmp/shsat-exam-release-create-form-mobile-${stamp}.png` });
    await mobileContext.close();

    let releasePaperCheck;
    let resolvePaperCheck;
    let paperCheckCount = 0;
    let createRequestCount = 0;
    const paperCheckGate = new Promise(resolve => { releasePaperCheck = resolve; });
    const paperCheckReached = new Promise(resolve => { resolvePaperCheck = resolve; });
    await page.route(`**/api/admin/papers/${paper.id}`, async route => {
      paperCheckCount += 1;
      resolvePaperCheck();
      await paperCheckGate;
      await route.continue();
    });
    await page.route(`**/api/admin/papers/${paper.id}/exams`, async route => {
      createRequestCount += 1;
      await route.continue();
    });
    await modal.evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await paperCheckReached;
    await modal.evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    releasePaperCheck();
    const structureWarning = page.locator('.publish-confirm-modal');
    await Promise.race([
      structureWarning.waitFor({ state: 'visible' }),
      modal.waitFor({ state: 'detached' }),
    ]);
    if (await structureWarning.isVisible()) {
      await page.screenshot({ path: `/tmp/shsat-exam-release-structure-warning-${stamp}.png` });
      await structureWarning.getByRole('button', { name: 'Create Release', exact: true }).click();
    }
    try {
      await modal.waitFor({ state: 'detached', timeout: 8_000 });
    } catch (error) {
      console.error('Create form remained open:', await modal.locator('.error-text').allInnerTexts());
      console.error('Structure warning:', await page.locator('.publish-structure-warning').allInnerTexts());
      await page.screenshot({ path: `/tmp/shsat-exam-release-create-form-error-${stamp}.png` });
      throw error;
    }
    assert.equal(paperCheckCount, 1, 'rapid duplicate form submissions perform one paper structure check');
    assert.equal(createRequestCount, 1, 'rapid duplicate form submissions create at most one release');
    await page.unroute(`**/api/admin/papers/${paper.id}`);
    await page.unroute(`**/api/admin/papers/${paper.id}/exams`);
    const created = (await api(page, '/api/admin/exam-types/SHSAT/exams')).filter(item => item.title === examTitle);
    assert.equal(created.length, 1, 'the form creates exactly one release');
    examId = Number(created[0].id);
    const details = await api(page, `/api/admin/exams/${examId}`);
    assert.equal(details.summary.title, examTitle);
    assert.equal(details.summary.status, 'DRAFT');
    const expectedStartInstant = await page.evaluate(value => new Date(value).toISOString(), originalStartTime);
    const expectedEndInstant = await page.evaluate(value => new Date(value).toISOString(), originalEndTime);
    assert.equal(Date.parse(details.summary.opensAt), Date.parse(expectedStartInstant),
      'the selected local start time is stored as the same absolute instant');
    assert.equal(Date.parse(details.summary.closesAt), Date.parse(expectedEndInstant),
      'the selected local end time is stored as the same absolute instant');
    assert.equal(details.summary.durationSeconds, Number(originalDuration) * 60,
      'attempt duration is persisted in seconds without changing the entered minutes');
    assert.equal(details.summary.attemptLimit, 1, 'the default attempt limit is persisted');
    assert.ok(JSON.stringify(details).includes(className), 'the chosen class is persisted as the audience');
    assert.equal(details.summary.autoSubmit, true);
    assert.equal(details.summary.allowReview, true);

    await page.getByRole('tab', { name: 'Exam Release', exact: true }).click();
    await page.locator('.release-search-input').fill(examTitle);
    const row = page.locator('.exam-release-table tbody tr').filter({ hasText: examTitle });
    await row.waitFor();
    assert.ok((await row.innerText()).includes(className), 'the release table shows the selected class');
    await row.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-exam-release-created-by-form-${stamp}.png` });

    const examsBeforeCancel = await api(page, '/api/admin/exam-types/SHSAT/exams');
    await page.getByRole('button', { name: 'Create Exam', exact: true }).click();
    const cancelModal = page.locator('.exam-release-modal');
    await cancelModal.waitFor();
    await cancelModal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await cancelModal.waitFor({ state: 'detached' });
    assert.deepEqual((await api(page, '/api/admin/exam-types/SHSAT/exams')).map(item => item.id),
      examsBeforeCancel.map(item => item.id), 'canceling the create dialog does not persist another exam');

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['defaults and required validation', 'end time and duration validation in UI/API', 'active class audience and required selection', 'duplicate submissions create only one release', 'local time and duration persist accurately', 'default options', 'create and cancel persistence', 'desktop/mobile dialog layout'],
      className,
      mobileSize,
      pageErrors: errors.length,
    }));
  } finally {
    const matchingExams = await api(page, '/api/admin/exam-types/SHSAT/exams').catch(() => []);
    for (const exam of matchingExams.filter(item => item.title === examTitle)) {
      await apiDelete(page, `/api/admin/exams/${exam.id}`).catch(() => {});
    }
    await context.close();
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

async function api(page, path) {
  const response = await page.evaluate(async path => {
    const result = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return { status: result.status, text: await result.text() };
  }, path);
  if (response.status < 200 || response.status >= 300) throw new Error(`GET ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

async function apiRequest(page, path, method, body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  return page.evaluate(async ({ path, method, body, token }) => {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': token,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  }, { path, method, body, token });
}

async function apiDelete(page, path) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  const result = await page.evaluate(async ({ path, token }) => {
    const response = await fetch(path, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token },
    });
    return { status: response.status, text: await response.text() };
  }, { path, token });
  if (result.status < 200 || result.status >= 300) throw new Error(`DELETE ${path}: ${result.status} ${result.text}`);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
