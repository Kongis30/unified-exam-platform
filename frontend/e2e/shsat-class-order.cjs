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
  let originalOrder = [];

  try {
    await login(page);
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
    const cards = page.locator('.class-grid .class-card');
    const currentClasses = await api(page, '/api/admin/classes?examTypeCodes=SHSAT');
    const temporaryClassIds = new Map(currentClasses
      .filter(item => names.includes(item.name))
      .map(item => [item.name, Number(item.classId || item.id)]));
    const beforeTitles = (await page.locator('.class-grid .class-card h3').allTextContents()).filter(title => names.includes(title));
    assert.equal(beforeTitles.length, 3, 'all temporary classes appear in the list');
    const first = cards.filter({ hasText: beforeTitles[0] });
    const third = cards.filter({ hasText: beforeTitles[2] });
    await first.waitFor();
    await third.waitFor();
    const reorderResponse = page.waitForResponse(response =>
      response.request().method() === 'POST' && response.url().includes('/api/admin/classes/reorder'));
    await first.dragTo(third, { targetPosition: { x: 40, y: 30 } });
    await reorderResponse;

    const expected = await api(page, '/api/admin/classes?examTypeCodes=SHSAT');
    const expectedOrder = expected.map(item => Number(item.classId || item.id));
    const draggedOrder = beforeTitles.map(title => temporaryClassIds.get(title));
    draggedOrder.splice(0, 1);
    draggedOrder.splice(2, 0, temporaryClassIds.get(beforeTitles[0]));
    const expectedWithOriginal = [...originalOrder, ...draggedOrder];
    assert.deepEqual(expectedOrder, expectedWithOriginal, 'dragging the first temporary class to the third persists its new order');

    await page.reload();
    await page.getByRole('tab', { name: 'Classes', exact: true }).click();
    const titles = await page.locator('.class-grid .class-card h3').allTextContents();
    const temporaryTitles = titles.filter(title => names.includes(title));
    const expectedTitles = [...beforeTitles.slice(1), beforeTitles[0]];
    assert.deepEqual(temporaryTitles, expectedTitles, 'the moved order survives reload');
    const firstOrderedCard = page.locator('.class-grid .class-card').filter({ hasText: expectedTitles[0] });
    const lastOrderedCard = page.locator('.class-grid .class-card').filter({ hasText: expectedTitles[2] });
    await firstOrderedCard.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-class-order-desktop-${stamp}.png` });

    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'class cards fit a 390px page');
    await page.evaluate(title => {
      const grid = document.querySelector('.class-grid');
      const card = [...grid.querySelectorAll('.class-card')]
        .find(element => element.querySelector('h3')?.textContent === title);
      grid.scrollTop = card.offsetTop - 16;
      const top = grid.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 150));
    }, expectedTitles[2]);
    await page.screenshot({ path: `/tmp/shsat-class-order-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', checks: ['drag order persistence', 'reload order', '390px page width'], dimensions }));
  } finally {
    for (const classId of createdIds) await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (originalOrder.length) await api(page, '/api/admin/classes/reorder?examTypeCodes=SHSAT', 'POST', { classIds: originalOrder }).catch(() => {});
    const remaining = await api(page, '/api/admin/classes?examTypeCodes=SHSAT');
    assert.ok(createdIds.every(id => !remaining.some(item => Number(item.classId || item.id) === id)), 'temporary classes are removed');
    const restoredOrder = remaining.map(item => Number(item.classId || item.id));
    assert.deepEqual(restoredOrder, originalOrder, 'the original class order is restored');
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
