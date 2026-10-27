const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

if (!adminUsername || !adminPassword) {
  throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  let groupId;
  let paperId;
  const suffix = Date.now();
  const folderName = `Folder Lifecycle ${suffix}`;
  const renamedFolder = `${folderName} Updated`;

  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await signIn(page);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin?tab=papers`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Create Folder', exact: true }).click();
    await page.getByRole('heading', { name: 'Create Folder', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create Folder', exact: true }).last().click();
    await page.getByText('Folder name is required.', { exact: true }).waitFor();
    const cancelledName = `Cancelled Folder ${suffix}`;
    await page.locator('input[placeholder="e.g. 2025 Practice Tests"]').fill(cancelledName);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.ok(!(await api(page, '/api/admin/exam-types/SHSAT/paper-groups')).some(group => group.name === cancelledName),
      'cancelling folder creation does not create a group');

    await page.getByRole('button', { name: 'Create Folder', exact: true }).click();
    await page.locator('input[placeholder="e.g. 2025 Practice Tests"]').fill(folderName);
    await page.locator('input[placeholder="Optional"]').fill('Temporary folder management regression.');
    const createResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/paper-groups'));
    await page.getByRole('button', { name: 'Create Folder', exact: true }).last().click();
    assert.equal((await createResponse).status(), 200, 'the folder create request succeeds');

    let folder = page.locator('.folder-panel').filter({ hasText: folderName });
    const groups = await api(page, '/api/admin/exam-types/SHSAT/paper-groups');
    const createdGroup = groups.find(group => group.name === folderName);
    assert.ok(createdGroup, 'creating a folder persists it in the SHSAT group list');
    groupId = Number(createdGroup.id);
    try {
      await folder.waitFor({ timeout: 5000 });
    } catch {
      await page.screenshot({ path: `/tmp/shsat-folder-create-debug-${suffix}.png`, fullPage: true });
      throw new Error(`Created group ${groupId} is absent from the folder list. Filter=${await page.getByLabel('Folder', { exact: true }).inputValue()}; paper panel=${(await page.locator('.paper-list-card').innerText()).slice(0, 1500)}`);
    }
    assert.equal(await folder.getByLabel('Delete empty folder').count(), 1, 'empty folders expose the delete action');
    await page.getByRole('button', { name: 'Create Folder', exact: true }).click();
    await page.locator('input[placeholder="e.g. 2025 Practice Tests"]').fill(folderName);
    await page.getByRole('button', { name: 'Create Folder', exact: true }).last().click();
    await page.getByText('A paper group with that name already exists.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await folder.locator('.folder-panel__main-button').click();
    await folder.getByText('No papers in this folder yet.', { exact: true }).waitFor();
    await folder.locator('.folder-panel__main-button').click();
    await page.reload();
    await page.waitForLoadState('networkidle');
    folder = page.locator('.folder-panel').filter({ hasText: folderName });
    assert.equal(await folder.getByText('No papers in this folder yet.', { exact: true }).count(), 0,
      'new folders are collapsed after a reload');

    await folder.getByLabel('Rename folder').click();
    await page.getByRole('heading', { name: 'Rename Folder', exact: true }).waitFor();
    await page.getByLabel('Folder Name').fill(renamedFolder);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await api(page, '/api/admin/exam-types/SHSAT/paper-groups')).find(group => group.id === groupId).name,
      folderName, 'cancelling a rename leaves the stored folder name unchanged');

    folder = page.locator('.folder-panel').filter({ hasText: folderName });
    await folder.getByLabel('Rename folder').click();
    await page.getByLabel('Folder Name').fill(renamedFolder);
    await page.getByLabel('Description').fill('Updated during the regression test.');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    folder = page.locator('.folder-panel').filter({ hasText: renamedFolder });
    await folder.waitFor();
    const renamed = (await api(page, '/api/admin/exam-types/SHSAT/paper-groups')).find(group => group.id === groupId);
    assert.equal(renamed.name, renamedFolder, 'renaming updates the folder name');
    assert.equal(renamed.description, 'Updated during the regression test.', 'renaming saves the optional description');

    const createdPaper = await api(page, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `FOLDER_TEST_${suffix}`, title: `Folder Test Paper ${suffix}`, groupId,
      defaultDurationSeconds: 600,
    });
    paperId = Number(createdPaper.summary.id);
    await page.reload();
    await page.waitForLoadState('networkidle');
    folder = page.locator('.folder-panel').filter({ hasText: renamedFolder });
    await folder.locator('.folder-panel__main-button').click();
    const paperRow = folder.locator('.paper-table tbody tr').filter({ hasText: `Folder Test Paper ${suffix}` });
    await paperRow.getByRole('button', { name: 'Paper actions' }).click();
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await page.getByRole('heading', { name: 'Move Paper', exact: true }).waitFor();
    let moveDialog = page.locator('.modal-card').filter({ has: page.getByRole('heading', { name: 'Move Paper', exact: true }) });
    assert.equal(await moveDialog.locator('select').inputValue(), String(groupId),
      'the move dialog selects the paper’s current folder');
    await moveDialog.locator('select').selectOption('');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await api(page, `/api/admin/papers/${paperId}`)).summary.groupId, groupId,
      'cancelling a paper move keeps the stored folder unchanged');

    await paperRow.getByRole('button', { name: 'Paper actions' }).click();
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await page.getByRole('heading', { name: 'Move Paper', exact: true }).waitFor();
    moveDialog = page.locator('.modal-card').filter({ has: page.getByRole('heading', { name: 'Move Paper', exact: true }) });
    await moveDialog.locator('select').selectOption('');
    await page.screenshot({ path: `/tmp/shsat-folder-move-dialog-${suffix}.png` });
    const moveResponsePromise = page.waitForResponse(response => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname.endsWith(`/papers/${paperId}/group`));
    await page.getByRole('button', { name: 'Move Paper', exact: true }).click();
    const moveResponse = await moveResponsePromise;
    assert.equal(moveResponse.status(), 200, 'the paper move request succeeds');
    await page.getByRole('heading', { name: 'Move Paper', exact: true }).waitFor({ state: 'detached' });
    assert.equal((await api(page, `/api/admin/papers/${paperId}`)).summary.groupId, null,
      'moving to Default Folder persists a null group association');
    await page.reload();
    await page.waitForLoadState('networkidle');
    const defaultFolder = page.locator('.folder-panel').filter({ has: page.locator('.folder-panel__title').getByText('Default Folder', { exact: true }) });
    await defaultFolder.locator('.folder-panel__main-button').click();
    assert.equal(await defaultFolder.locator('.paper-table tbody tr').filter({ hasText: `Folder Test Paper ${suffix}` }).count(), 1,
      'a moved paper appears in the Default Folder after reload');

    assert.equal(await folder.getByLabel('Delete empty folder').count(), 1,
      'moving the paper out updates the folder to its empty state');

    await api(page, `/api/admin/papers/${paperId}`, 'DELETE');
    paperId = undefined;
    await page.reload();
    await page.waitForLoadState('networkidle');
    folder = page.locator('.folder-panel').filter({ hasText: renamedFolder });
    await folder.getByLabel('Delete empty folder').click();
    await page.getByRole('heading', { name: 'Delete empty folder?', exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-folder-delete-confirm-${suffix}.png` });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.ok((await api(page, '/api/admin/exam-types/SHSAT/paper-groups')).some(group => group.id === groupId),
      'cancelling folder deletion preserves the folder');

    await folder.getByLabel('Delete empty folder').click();
    await page.getByRole('button', { name: 'Delete Folder', exact: true }).click();
    await page.locator('.folder-panel').filter({ hasText: renamedFolder }).waitFor({ state: 'detached' });
    assert.ok(!(await api(page, '/api/admin/exam-types/SHSAT/paper-groups')).some(group => group.id === groupId),
      'confirming deletion removes the empty folder');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin?tab=papers`);
    await page.waitForLoadState('networkidle');
    const mobileWidth = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileWidth.page <= mobileWidth.viewport, 'Paper Management fits a 390px viewport');
    await page.locator('.paper-list-card').scrollIntoViewIfNeeded();
    const paperSearchHeight = await page.locator('input[placeholder="Paper name"]').evaluate(input => input.getBoundingClientRect().height);
    assert.ok(paperSearchHeight <= 40, `the mobile paper search remains compact, got ${paperSearchHeight}px`);
    await page.screenshot({ path: `/tmp/shsat-folder-management-mobile-${suffix}.png` });
    assert.deepEqual(pageErrors, [], 'folder management has no browser errors');

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['required/duplicate validation', 'create/cancel and reload', 'empty-folder state and default collapse', 'rename cancel and save',
        'paper move cancel and persistence', 'non-empty folder delete protection', 'delete cancel and confirm', '390px layout'],
      mobileWidth,
      paperSearchHeight,
      pageErrors: pageErrors.length,
      screenshots: [`/tmp/shsat-folder-move-dialog-${suffix}.png`, `/tmp/shsat-folder-delete-confirm-${suffix}.png`,
        `/tmp/shsat-folder-management-mobile-${suffix}.png`],
    }));
  } finally {
    if (paperId) await api(page, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
    if (groupId) await api(page, `/api/admin/paper-groups/${groupId}`, 'DELETE').catch(() => {});
    await context.close();
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
