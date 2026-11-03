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

  try {
    await login(page);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin?tab=papers`);
    await page.getByRole('heading', { name: 'Paper List', exact: true }).waitFor();
    const availableExams = page.locator('.available-exams-card');
    await availableExams.getByRole('button', { name: 'Collapse available exams' }).click();
    await page.reload();
    await page.getByRole('heading', { name: 'Paper List', exact: true }).waitFor();
    await availableExams.getByRole('button', { name: 'Expand available exams' }).waitFor();
    assert.equal(await availableExams.getByText('No available exams right now.', { exact: true }).count(), 0,
      'collapsed exam cards remain hidden after a reload');
    await availableExams.getByRole('button', { name: 'Expand available exams' }).click();
    await availableExams.getByText('No available exams right now.', { exact: true }).waitFor();
    const desktopHeaders = await assertDashboardHeaderActionsDoNotOverlap(page);
    const startingScrollY = await setScrollPosition(page, 360);
    assert.ok(startingScrollY > 0, 'the page has enough content for a meaningful scroll-position check');

    const tabs = ['Exam Release', 'Review Assignments', 'Classes', 'Paper Management'];
    const positions = [];
    for (const tabName of tabs) {
      await page.getByRole('tab', { name: tabName, exact: true }).click();
      await page.waitForTimeout(120);
      const scrollY = await page.evaluate(() => window.scrollY);
      assert.equal(scrollY, startingScrollY, `switching to ${tabName} should retain the page position`);
      positions.push({ tab: tabName, scrollY });
    }
    await page.screenshot({ path: '/tmp/shsat-admin-tab-scroll-desktop.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileHeaders = await assertDashboardHeaderActionsDoNotOverlap(page);
    const classesTab = page.getByRole('tab', { name: 'Classes', exact: true });
    await classesTab.scrollIntoViewIfNeeded();
    const mobileStart = await page.evaluate(() => window.scrollY);
    const tabsVisible = await classesTab.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    });
    assert.equal(tabsVisible, true, 'the mobile tab being clicked must be visible before measuring scroll retention');
    for (const tabName of ['Classes', 'Review Assignments', 'Exam Release', 'Paper Management']) {
      await page.getByRole('tab', { name: tabName, exact: true }).click();
      await page.waitForTimeout(120);
      assert.equal(await page.evaluate(() => window.scrollY), mobileStart,
        `switching to ${tabName} should retain the narrow-screen page position`);
    }
    const mobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the narrow-screen admin page has no horizontal overflow');
    await page.screenshot({ path: '/tmp/shsat-admin-tab-scroll-mobile.png' });
    assert.deepEqual(pageErrors, [], 'admin tab switching has no browser errors');

    console.log(JSON.stringify({ result: 'PASS', checks: ['Available Exams collapse persists after reload', 'dashboard card actions do not overlap subtitles at desktop and mobile widths'], desktop: positions, desktopHeaders, mobileHeaders, mobileScrollY: mobileStart, mobileSize,
      pageErrors: pageErrors.length, screenshots: ['/tmp/shsat-admin-tab-scroll-desktop.png', '/tmp/shsat-admin-tab-scroll-mobile.png'] }));
  } finally {
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

async function setScrollPosition(page, requestedY) {
  return page.evaluate(y => {
    window.scrollTo(0, y);
    return window.scrollY;
  }, requestedY);
}

async function assertDashboardHeaderActionsDoNotOverlap(page) {
  const headers = await page.locator('.available-exams-card, .dashboard-review-card').evaluateAll(cards => cards.map(card => {
    const subtitle = card.querySelector('.app-card__subtitle')?.getBoundingClientRect();
    const actions = card.querySelector('.app-card__actions')?.getBoundingClientRect();
    const overlaps = subtitle && actions
      && subtitle.left < actions.right && subtitle.right > actions.left
      && subtitle.top < actions.bottom && subtitle.bottom > actions.top;
    return { title: card.querySelector('.app-card__title')?.textContent.trim(), overlaps: Boolean(overlaps) };
  }));
  assert.equal(headers.length, 2, 'both dashboard cards should expose their actions in the shared header');
  assert.ok(headers.every(header => !header.overlaps), 'card actions must not overlap subtitles at this viewport');
  return headers;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
