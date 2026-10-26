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
  const names = [1, 2, 3].map(index => `SHSAT Group Order ${stamp} ${index}`);
  const createdIds = [];
  let originalOrder = [];

  try {
    await login(page);
    const existing = await api(page, '/api/admin/exam-types/SHSAT/paper-groups');
    originalOrder = existing.map(group => Number(group.id));
    for (const name of names) {
      const created = await api(page, '/api/admin/exam-types/SHSAT/paper-groups', 'POST', {
        name,
        description: 'Temporary SHSAT group order verification',
        sortOrder: 0,
      });
      createdIds.push(Number(created.id));
    }

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await page.getByRole('tab', { name: 'Paper Management', exact: true }).click();
    const panels = page.locator('.folder-list .folder-panel');
    const currentGroups = await api(page, '/api/admin/exam-types/SHSAT/paper-groups');
    const groupIdsByName = new Map(currentGroups.map(group => [group.name, Number(group.id)]));
    const beforeTitles = (await page.locator('.folder-panel__title strong').allTextContents())
      .filter(title => names.includes(title));
    const initialPanelTitles = await page.locator('.folder-panel__title strong').allTextContents();
    assert.equal(beforeTitles.length, 3, 'all temporary folders appear in the list');
    async function dragGroup(sourceName, targetName, assertion, expectedNamesBefore) {
      const source = panels.filter({ hasText: sourceName });
      const target = panels.filter({ hasText: targetName });
      await source.waitFor();
      await target.waitFor();
      await source.evaluate(element => element.scrollIntoView({ block: 'center' }));
      const sourceRect = await source.boundingBox();
      const targetRect = await target.boundingBox();
      const beforeOrder = await api(page, '/api/admin/exam-types/SHSAT/paper-groups');
      const expectedOrder = beforeOrder.map(group => Number(group.id));
      const sourceIndex = expectedOrder.indexOf(groupIdsByName.get(sourceName));
      const targetIndex = expectedOrder.indexOf(groupIdsByName.get(targetName));
      const [movedId] = expectedOrder.splice(sourceIndex, 1);
      expectedOrder.splice(targetIndex, 0, movedId);
      const reorderResponse = page.waitForResponse(response =>
        response.request().method() === 'PUT' && response.url().includes('/api/admin/exam-types/SHSAT/paper-groups/order'));
      await page.mouse.move(sourceRect.x + 90, sourceRect.y + sourceRect.height / 2);
      await page.mouse.down();
      await page.mouse.move(sourceRect.x + 110, sourceRect.y + sourceRect.height / 2, { steps: 4 });
      await page.mouse.move(targetRect.x + 90, targetRect.y + targetRect.height / 2, { steps: 12 });
      await page.mouse.up();
      const response = await reorderResponse;
      assert.ok(response.ok(), `${assertion}: reorder request succeeds (${response.status()})`);

      const persistedOrder = await api(page, '/api/admin/exam-types/SHSAT/paper-groups');
      const ids = persistedOrder.map(group => Number(group.id));
      assert.equal(new Set(ids).size, ids.length, `${assertion}: every group occurs exactly once`);
      assert.deepEqual(ids, expectedOrder, `${assertion}: server persists the expected complete order`);
      const nextNames = [...expectedNamesBefore];
      const targetPosition = nextNames.indexOf(targetName);
      const [movedName] = nextNames.splice(nextNames.indexOf(sourceName), 1);
      nextNames.splice(targetPosition, 0, movedName);
      return nextNames;
    }

    async function assertReloadedGroupNames(expectedNames, assertion) {
      await page.reload();
      await page.getByRole('tab', { name: 'Paper Management', exact: true }).click();
      const reloadedNames = await page.locator('.folder-panel__title strong').allTextContents();
      assert.deepEqual(reloadedNames, expectedNames, `${assertion}: full displayed order survives reload`);
    }

    const initialOrder = currentGroups.map(group => Number(group.id));
    let expectedNames = [...initialPanelTitles];
    const firstDraggableGroup = expectedNames[1];
    const lastDraggableGroup = currentGroups[currentGroups.length - 1].name;
    expectedNames = await dragGroup(firstDraggableGroup, lastDraggableGroup, 'first-to-last drag', expectedNames);
    await assertReloadedGroupNames(expectedNames, 'first-to-last drag');

    expectedNames = await dragGroup(lastDraggableGroup, firstDraggableGroup, 'last-to-first drag', expectedNames);
    await assertReloadedGroupNames(expectedNames, 'last-to-first drag');

    expectedNames = await dragGroup(expectedNames[1], expectedNames[2], 'second-position target drag', expectedNames);
    await assertReloadedGroupNames(expectedNames, 'second-position target drag');

    const finalGroupOrder = await api(page, '/api/admin/exam-types/SHSAT/paper-groups');
    assert.equal(new Set(finalGroupOrder.map(group => Number(group.id))).size, finalGroupOrder.length,
      'all persisted group IDs are unique');
    assert.equal(finalGroupOrder.length, initialOrder.length, 'no group is lost during repeated reorder');
    const lastPanel = panels.filter({ hasText: expectedNames[2] });
    await lastPanel.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-paper-group-order-desktop-${stamp}.png` });

    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
      elements: ['.admin-home', '.admin-workspace-section', '.paper-list-card', '.folder-list', '.folder-panel']
        .map(selector => {
          const element = document.querySelector(selector);
          if (!element) return { selector, missing: true };
          const rect = element.getBoundingClientRect();
          return { selector, x: rect.x, width: rect.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
        }),
    }));
    assert.ok(dimensions.page <= dimensions.viewport, 'paper management fits a 390px page');
    assert.ok(dimensions.elements.every(item => item.missing || item.scrollWidth <= item.clientWidth + 1),
      'paper management containers do not hide horizontal overflow');
    await lastPanel.evaluate(element => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 145));
    });
    await page.screenshot({ path: `/tmp/shsat-paper-group-order-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ result: 'PASS', checks: ['first-to-last drag', 'last-to-first drag', 'drag to second position', 'order persistence after each reload', 'complete unique group IDs', '390px layout'], dimensions }));
  } finally {
    for (const groupId of createdIds) await api(page, `/api/admin/paper-groups/${groupId}`, 'DELETE').catch(() => {});
    if (originalOrder.length) {
      await api(page, '/api/admin/exam-types/SHSAT/paper-groups/order', 'PUT', { paperGroupIds: originalOrder }).catch(() => {});
    }
    const remaining = await api(page, '/api/admin/exam-types/SHSAT/paper-groups');
    assert.ok(createdIds.every(id => !remaining.some(group => Number(group.id) === id)), 'temporary groups are removed');
    assert.deepEqual(remaining.map(group => Number(group.id)), originalOrder, 'the original group order is restored');
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
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
