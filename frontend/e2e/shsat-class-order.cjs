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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const stamp = Date.now();
  const names = [1, 2, 3].map(index => `SHSAT Order ${stamp} ${index}`);
  const createdIds = [];
  let teacherId;
  let teacherContext;
  let originalOrder = [];

  try {
    await login(page);
    const teacher = await api(page, '/api/admin/users', 'POST', {
      username: `shsat_order_teacher_${stamp}`,
      password: `OrderTeacher${stamp}!`,
      realName: `Order Teacher ${String(stamp).slice(-6)}`,
      roleCode: 'TEACHER',
      email: null,
      phone: null,
    });
    teacherId = Number(teacher.id);
    const existing = await api(page, '/api/admin/classes?examTypeCodes=SHSAT');
    originalOrder = existing.map(item => Number(item.classId || item.id));
    for (const name of names) {
      const created = await api(page, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
        name,
        description: 'Temporary class order verification',
        sortOrder: 999,
        active: true,
      });
      createdIds.push(Number(created.classId || created.id));
    }

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await page.getByRole('tab', { name: 'Classes', exact: true }).click();
    const shsatNavLink = page.locator('.admin-layout__nav a').filter({ hasText: /^SHSAT$/ });
    await shsatNavLink.waitFor();
    await page.waitForFunction(() => document.querySelector('.admin-layout__nav a.router-link-active')?.textContent.trim() === 'SHSAT');
    const cards = page.locator('.class-grid .class-card');
    const beforeTitles = (await page.locator('.class-grid .class-card h3').allTextContents()).filter(title => names.includes(title));
    assert.equal(beforeTitles.length, 3, 'all temporary classes appear in the list');
    const initialApiOrder = (await api(page, '/api/admin/classes?examTypeCodes=SHSAT'))
      .filter(item => names.includes(item.name)).map(item => item.name);
    assert.deepEqual(initialApiOrder, beforeTitles, 'class cards start in API order');
    let expectedTitles = [...beforeTitles];
    async function dragAndVerify(sourceTitle, targetTitle, label) {
      const source = cards.filter({ hasText: sourceTitle });
      const target = cards.filter({ hasText: targetTitle });
      const reorderResponse = page.waitForResponse(response =>
        response.request().method() === 'POST' && response.url().includes('/api/admin/classes/reorder'), { timeout: 5000 })
        .catch(() => null);
      await dragCards(page, source, target);
      const response = await reorderResponse;
      assert.ok(response, `${label} submits a class reorder`);
      const sourceIndex = expectedTitles.indexOf(sourceTitle);
      const targetIndex = expectedTitles.indexOf(targetTitle);
      expectedTitles.splice(sourceIndex, 1);
      expectedTitles.splice(targetIndex, 0, sourceTitle);
      const rows = await api(page, '/api/admin/classes?examTypeCodes=SHSAT');
      const persistedTitles = rows.filter(item => names.includes(item.name)).map(item => item.name);
      assert.deepEqual(persistedTitles, expectedTitles, `${label} persists the expected temporary class order`);
      await page.waitForFunction(expected => {
        const current = [...document.querySelectorAll('.class-grid .class-card h3')].map(element => element.textContent.trim());
        return JSON.stringify(current.filter(title => title.includes('SHSAT Order '))) === JSON.stringify(expected);
      }, expectedTitles);
      await page.reload();
      await page.getByRole('tab', { name: 'Classes', exact: true }).click();
      await page.waitForFunction(expected => {
        const current = [...document.querySelectorAll('.class-grid .class-card h3')].map(element => element.textContent.trim());
        return JSON.stringify(current.filter(title => title.includes('SHSAT Order '))) === JSON.stringify(expected);
      }, expectedTitles);
    }

    await dragAndVerify(beforeTitles[0], beforeTitles[2], 'dragging the first class to the last position');
    await dragAndVerify(beforeTitles[0], beforeTitles[1], 'dragging the last class to the first position');
    await dragAndVerify(beforeTitles[2], beforeTitles[1], 'dropping onto the middle class');
    await dragAndVerify(beforeTitles[1], beforeTitles[0], 'dragging the last class back ahead of the first');

    await page.reload();
    await page.getByRole('tab', { name: 'Classes', exact: true }).click();
    const titles = await page.locator('.class-grid .class-card h3').allTextContents();
    const temporaryTitles = titles.filter(title => names.includes(title));
    assert.deepEqual(temporaryTitles, expectedTitles, 'the moved order survives reload');

    teacherContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const teacherPage = await teacherContext.newPage();
    teacherPage.on('pageerror', error => pageErrors.push(error.message));
    await loginCredentials(teacherPage, `shsat_order_teacher_${stamp}`, `OrderTeacher${stamp}!`);
    await teacherPage.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await teacherPage.getByRole('tab', { name: 'Classes', exact: true }).click();
    assert.ok(await teacherPage.locator('.class-grid--reorderable').count(), 'teachers can reorder classes in the SHSAT workspace');
    const teacherCards = teacherPage.locator('.class-grid .class-card');
    const teacherSource = teacherCards.filter({ hasText: expectedTitles[2] });
    const teacherTarget = teacherCards.filter({ hasText: expectedTitles[0] });
    const teacherReorderResponse = teacherPage.waitForResponse(response =>
      response.request().method() === 'POST' && response.url().includes('/api/admin/classes/reorder'), { timeout: 5000 });
    await dragCards(teacherPage, teacherSource, teacherTarget);
    await teacherReorderResponse;
    const teacherExpectedTitles = [expectedTitles[2], ...expectedTitles.slice(0, 2)];
    const teacherRows = await api(teacherPage, '/api/admin/classes?examTypeCodes=SHSAT');
    assert.deepEqual(teacherRows.filter(item => names.includes(item.name)).map(item => item.name), teacherExpectedTitles,
      'teacher class ordering is persisted by the shared class service');
    expectedTitles = teacherExpectedTitles;
    await teacherPage.reload();
    await teacherPage.getByRole('tab', { name: 'Classes', exact: true }).click();
    const teacherReloadTitles = (await teacherPage.locator('.class-grid .class-card h3').allTextContents())
      .filter(title => names.includes(title));
    assert.deepEqual(teacherReloadTitles, expectedTitles, 'teacher changes survive reload');

    await page.reload();
    await page.getByRole('tab', { name: 'Classes', exact: true }).click();
    await page.waitForFunction(expected => {
      const current = [...document.querySelectorAll('.class-grid .class-card h3')].map(element => element.textContent.trim());
      return JSON.stringify(current.filter(title => title.includes('SHSAT Order '))) === JSON.stringify(expected);
    }, expectedTitles);
    const firstOrderedCard = page.locator('.class-grid .class-card').filter({ hasText: expectedTitles[0] });
    await firstOrderedCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/shsat-class-order-desktop-${stamp}.png` });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'class cards fit a 390px page');
    const mobileTarget = page.locator('.class-grid .class-card').filter({ hasText: expectedTitles[2] });
    await mobileTarget.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/shsat-class-order-mobile-${stamp}.png` });

    const classSearch = page.getByPlaceholder('Search class, teacher, grade');
    await classSearch.fill(names[0]);
    assert.deepEqual(await page.locator('.class-grid .class-card h3').allTextContents(), [names[0]], 'class search returns the matching class');
    await classSearch.fill(`No matching class ${stamp}`);
    await page.getByText('No classes found.', { exact: true }).waitFor();
    await classSearch.clear();
    await page.locator('.class-grid .class-card h3').filter({ hasText: names[0] }).waitFor();

    const returnClassRow = page.locator('.class-grid .class-card').filter({ hasText: names[0] });
    await returnClassRow.click();
    await page.waitForURL(url => url.pathname.includes(`/admin/classes/${createdIds[0]}`));
    await page.getByRole('button', { name: 'Back to Classes', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith('/exam-types/SHSAT/admin') && url.searchParams.get('tab') === 'classes');

    let failNextClassLoad = true;
    const classListRoute = async route => {
      if (failNextClassLoad && route.request().method() === 'GET') {
        failNextClassLoad = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route('**/api/admin/classes?examTypeCodes=SHSAT', classListRoute);
    try {
      await page.getByRole('button', { name: 'Refresh classes' }).click();
      await page.locator('.class-grid').waitFor({ state: 'detached' });
      await page.locator('.admin-state--error').waitFor();
    } finally {
      await page.unroute('**/api/admin/classes?examTypeCodes=SHSAT', classListRoute);
    }
    await page.getByRole('button', { name: 'Refresh classes' }).click();
    await page.locator('.class-grid').waitFor();
    assert.ok((await api(page, '/api/admin/classes?examTypeCodes=SHSAT')).some(item => names.includes(item.name)),
      'refresh recovers the list after a temporary request error');
    assert.equal(await page.locator('.admin-layout__nav a.router-link-active').textContent(), 'SHSAT',
      'the SHSAT workspace remains selected after returning to Classes');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.class-grid .class-card').filter({ hasText: names[0] }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/shsat-class-home-verified-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', checks: ['first/middle/last drag boundaries', 'order persistence after every drop', 'reload order', 'teacher can reorder and persists changes', 'class search and empty result', 'class card navigation and return context', 'refresh error recovery', '390px page width'], dimensions }));
  } finally {
    for (const classId of createdIds) await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (originalOrder.length) await api(page, '/api/admin/classes/reorder?examTypeCodes=SHSAT', 'POST', { classIds: originalOrder }).catch(() => {});
    if (teacherId) await api(page, `/api/admin/users/${teacherId}`, 'DELETE').catch(() => {});
    const remaining = await api(page, '/api/admin/classes?examTypeCodes=SHSAT');
    assert.ok(createdIds.every(id => !remaining.some(item => Number(item.classId || item.id) === id)), 'temporary classes are removed');
    const restoredOrder = remaining.map(item => Number(item.classId || item.id));
    assert.deepEqual(restoredOrder, originalOrder, 'the original class order is restored');
    if (teacherId) {
      const accounts = await api(page, '/api/admin/users');
      assert.ok(!accounts.some(item => Number(item.id) === teacherId), 'the temporary teacher account is removed');
    }
    await teacherContext?.close();
    await browser.close();
  }
}

async function dragCards(page, source, target) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  const viewportHeight = await page.evaluate(() => innerHeight);
  const sourcePoint = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const targetPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  assert.ok(sourcePoint.y >= 0 && sourcePoint.y <= viewportHeight
    && targetPoint.y >= 0 && targetPoint.y <= viewportHeight, 'both drag points are visible');
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoint.x + 8, sourcePoint.y + 8, { steps: 3 });
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 12 });
  await page.mouse.up();
}

async function login(page) {
  await loginCredentials(page, adminUsername, adminPassword);
}

async function loginCredentials(page, username, password) {
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
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-XSRF-TOKEN': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: result.status, text: await result.text() };
  }, { path, method, body, token });
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
