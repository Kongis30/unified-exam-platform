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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await signIn(page);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await page.waitForLoadState('networkidle');

    const groupsResponse = await page.request.get(`${baseUrl}/api/admin/exam-types/SHSAT/paper-groups`);
    const groups = await groupsResponse.json();
    assert.ok(groupsResponse.ok(), 'paper groups should load');
    const group = groups.find(item => item.name === 'SHSAT CRASH COURSE');
    assert.ok(group, 'the seeded SHSAT paper group should exist');

    const papersResponse = await page.request.get(`${baseUrl}/api/admin/exam-types/SHSAT/papers`);
    const papers = await papersResponse.json();
    assert.ok(papersResponse.ok(), 'SHSAT papers should load');
    const expectedPapers = papers.filter(paper => paper.groupId === group.id);
    const folderFilter = page.getByLabel('Folder', { exact: true });
    const statusFilter = page.getByLabel('Online Status', { exact: true });
    const search = page.locator('input[placeholder="Paper name"]');
    const searchButton = page.getByRole('button', { name: 'Search', exact: true }).first();

    await folderFilter.selectOption(String(group.id));
    for (const onlineValue of ['true', 'false']) {
      await statusFilter.selectOption(onlineValue);
      await searchButton.click();
      const folder = page.locator('.folder-panel').filter({ hasText: group.name });
      await folder.locator('.folder-panel__main-button').click();
      const expected = expectedPapers
        .filter(paper => (paper.status === 'READY') === (onlineValue === 'true'))
        .map(paper => paper.title);
      const displayed = await folder.locator('tbody tr td:first-child strong').allTextContents();
      assert.deepEqual(new Set(displayed), new Set(expected), `${onlineValue} should show only matching SHSAT papers`);
      await page.screenshot({
        path: `/tmp/shsat-paper-filter-${onlineValue === 'true' ? 'online' : 'offline'}-20261027.png`,
        fullPage: true,
      });
      await folder.locator('.folder-panel__main-button').click();
    }

    const onlinePaper = expectedPapers.find(paper => paper.status === 'READY');
    assert.ok(onlinePaper, 'the test group should contain a READY paper');
    await statusFilter.selectOption('true');
    await search.fill(onlinePaper.title);
    await searchButton.click();
    const filteredFolder = page.locator('.folder-panel').filter({ hasText: group.name });
    await filteredFolder.locator('.folder-panel__main-button').click();
    const displayedSearchResults = await filteredFolder.locator('tbody tr td:first-child strong').allTextContents();
    assert.deepEqual(displayedSearchResults, [onlinePaper.title], 'folder, online status, and name filters should combine');
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['folder filter', 'Online filter', 'Offline filter', 'combined folder/status/name search'],
      matchedPapers: { online: expectedPapers.filter(paper => paper.status === 'READY').length,
        offline: expectedPapers.filter(paper => paper.status !== 'READY').length },
      pageErrors: pageErrors.length,
    }));
  } finally {
    await browser.close();
  }
}

async function signIn(page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(adminUsername);
  await page.getByLabel('Password').fill(adminPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
