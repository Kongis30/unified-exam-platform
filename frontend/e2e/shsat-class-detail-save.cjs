const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const username = process.env.E2E_ADMIN_USERNAME;
const password = process.env.E2E_ADMIN_PASSWORD;
if (!username || !password) throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const stamp = Date.now();
  let classId;

  try {
    await login(page);
    const created = await api(page, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `SHSAT Detail Save ${stamp}`,
      description: 'Temporary class detail save verification',
      active: true,
    });
    classId = Number(created.classId || created.id);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${classId}`);
    await page.getByRole('heading', { name: `SHSAT Detail Save ${stamp}`, exact: true }).waitFor();

    await page.getByRole('button', { name: 'Edit Class', exact: true }).click();
    const className = page.getByLabel('Class Name');
    await className.fill('');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('Class name is required.', { exact: true }).waitFor();
    assert.equal(await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`).then(item => item.name),
      `SHSAT Detail Save ${stamp}`, 'required-field validation leaves the saved class unchanged');
    await page.screenshot({ path: `/tmp/shsat-class-detail-validation-${stamp}.png` });

    await className.fill(`SHSAT Detail Save ${stamp} Updated`);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByRole('status').getByText('Class updated.', { exact: true }).waitFor();
    await page.getByRole('heading', { name: `SHSAT Detail Save ${stamp} Updated`, exact: true }).waitFor();
    const saved = await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`);
    assert.equal(saved.name, `SHSAT Detail Save ${stamp} Updated`, 'class edit persists to the API');
    await page.screenshot({ path: `/tmp/shsat-class-detail-save-toast-${stamp}.png` });
    assert.ok(!(await overlaps(page.locator('.class-detail-toast'), page.locator('.class-detail-hero__actions'))),
      'the success notification does not cover the class detail actions');

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileDimensions.page <= mobileDimensions.viewport, 'the success notification does not cause mobile overflow');
    await page.screenshot({ path: `/tmp/shsat-class-detail-save-toast-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 900 });

    let failNextDetailLoad = true;
    const detailUrl = `**/api/admin/classes/${classId}?examTypeCodes=SHSAT`;
    const interruptDetail = async route => {
      if (failNextDetailLoad && route.request().method() === 'GET') {
        failNextDetailLoad = false;
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    await page.route(detailUrl, interruptDetail);
    await page.getByRole('button', { name: 'Refresh class detail' }).click();
    await page.locator('.admin-state--error').waitFor();
    await page.screenshot({ path: `/tmp/shsat-class-detail-load-error-${stamp}.png` });
    await page.unroute(detailUrl, interruptDetail);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('heading', { name: `SHSAT Detail Save ${stamp} Updated`, exact: true }).waitFor();
    assert.equal(await page.locator('.admin-state--error').count(), 0, 'Retry clears the transient detail load error');
    assert.deepEqual(pageErrors, []);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'class detail remains within a 390px viewport');
    await page.screenshot({ path: `/tmp/shsat-class-detail-mobile-${stamp}.png` });
    console.log(JSON.stringify({ result: 'PASS', classId, checks: ['required class name validation', 'saved notification visible outside modal', 'class edit persistence', 'detail load error and Retry', '390px layout'], dimensions, pageErrors: pageErrors.length }));
  } finally {
    if (classId) await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    await browser.close();
  }
}

async function login(page) {
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
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: result.status, text: await result.text() };
  }, { path, method, body, token });
  if (response.status < 200 || response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  return response.text ? JSON.parse(response.text) : null;
}

async function overlaps(first, second) {
  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  return firstBox && secondBox
    && firstBox.x < secondBox.x + secondBox.width
    && firstBox.x + firstBox.width > secondBox.x
    && firstBox.y < secondBox.y + secondBox.height
    && firstBox.y + firstBox.height > secondBox.y;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
