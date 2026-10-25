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
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const username = `sat_parity_${Date.now()}@jin`;
  const contactEmail = `parity-${Date.now()}@example.test`;
  const initialPassword = `initial-${Date.now()}`;
  const resetPassword = `reset-${Date.now()}`;
  let userId;

  const csrf = async (page) => (await (await page.request.get(`${baseUrl}/api/auth/csrf`)).json()).token;
  const api = async (page, path, method = 'GET', body) => {
    const token = await csrf(page);
    const response = await page.request.fetch(`${baseUrl}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token },
      data: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok()) throw new Error(`${method} ${path}: ${response.status()} ${text}`);
    return text ? JSON.parse(text) : null;
  };

  try {
    await login(admin, adminUsername, adminPassword);
    await admin.goto(`${baseUrl}/users`);
    await admin.getByRole('heading', { name: 'Account management' }).waitFor();

    await admin.getByRole('button', { name: 'Create account', exact: true }).click();
    const nameInput = admin.locator('input[autocomplete="name"]');
    const usernameInput = admin.locator('input[autocomplete="username"]');
    const passwordInput = admin.locator('input[autocomplete="new-password"]');
    await nameInput.fill(`SAT Parity ${Date.now()} Student`);
    assert.match(await usernameInput.inputValue(), /@jin$/);
    await usernameInput.fill(username);
    await passwordInput.fill(initialPassword);
    await admin.getByText('Additional details').click();
    await admin.locator('input[autocomplete="email"]').fill(contactEmail);
    await admin.locator('input[autocomplete="tel"]').fill('5550102');
    await admin.getByRole('button', { name: 'Create account', exact: true }).last().click();
    await admin.getByRole('status').filter({ hasText: 'Account created' }).waitFor();

    const users = await api(admin, '/api/admin/users');
    userId = users.find((user) => user.username === username)?.id;
    assert.ok(userId, 'the created account should be present in the platform directory');

    const search = admin.getByRole('searchbox', { name: 'Search by name or username' });
    const roleFilter = admin.getByRole('combobox', { name: 'Filter accounts by role' });
    const row = admin.locator('tbody tr').filter({ hasText: username });
    await search.fill(username);
    await row.waitFor();
    assert.match(await row.innerText(), /Student/);
    await roleFilter.selectOption('STUDENT');
    assert.equal(await row.count(), 1);
    await search.clear();
    const studentNames = await admin.locator('.accounts-cell-name strong').allTextContents();
    assert.deepEqual(studentNames, [...studentNames].sort((left, right) => left.localeCompare(
      right, undefined, { sensitivity: 'base' },
    )), 'student accounts should be sorted alphabetically by name');
    const contactSearch = admin.getByRole('searchbox', { name: 'Search by email or phone' });
    await contactSearch.fill(contactEmail);
    assert.equal(await row.count(), 1);
    await contactSearch.clear();
    await search.fill(username);
    await roleFilter.selectOption('');

    await row.getByRole('button', { name: `Change ${username} role` }).click();
    await admin.locator('#change-account-role-form select').selectOption('TEACHER');
    await admin.getByRole('button', { name: 'Save role', exact: true }).click();
    await admin.getByRole('status').filter({ hasText: 'is now a Teacher' }).waitFor();

    await admin.once('dialog', (dialog) => dialog.accept(resetPassword));
    await row.getByRole('button', { name: 'Account actions' }).click();
    await admin.getByRole('menuitem', { name: 'Reset password' }).click();
    const studentContext = await browser.newContext();
    const student = await studentContext.newPage();
    try {
      await login(student, username, resetPassword);
      await student.goto(baseUrl);
      await student.getByText(/Choose your exam system|SAT|SHSAT/).first().waitFor();
    } finally {
      await studentContext.close();
    }

    await row.getByRole('button', { name: 'Account actions' }).click();
    await admin.getByRole('menuitem', { name: 'Disable' }).click();
    await row.getByText('Disabled', { exact: true }).waitFor();
    await row.getByRole('button', { name: 'Account actions' }).click();
    await admin.getByRole('menuitem', { name: 'Enable' }).click();
    await row.getByText('Active', { exact: true }).waitFor();

    await admin.screenshot({ path: '/tmp/sat-account-management-ui.png', fullPage: true });
    await row.getByRole('button', { name: 'Account actions' }).click();
    await admin.getByRole('menuitem', { name: 'Delete permanently' }).click();
    const deleteButton = admin.getByRole('button', { name: /Delete \(\d+s\)|Delete permanently/ });
    assert.equal(await deleteButton.isDisabled(), true, 'permanent deletion must wait through its cooldown');
    await admin.waitForTimeout(5200);
    await admin.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await admin.getByRole('status').filter({ hasText: 'and their linked exam records were deleted' }).waitFor();
    assert.equal((await api(admin, '/api/admin/users')).some((user) => user.username === username), false);
    userId = undefined;

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['create with editable defaults and optional details', 'alphabetical order, search and role filter',
        'change role', 'reset password and sign in', 'disable and re-enable', 'five-second delete confirmation'],
      screenshot: '/tmp/sat-account-management-ui.png',
    }));
  } finally {
    // 无论哪一步失败都清理临时账号，避免测试数据留在本地系统。
    if (!userId) {
      try {
        userId = (await api(admin, '/api/admin/users')).find((user) => user.username === username)?.id;
      } catch { /* 如果登录或账号创建失败，尚无可清理的目标账号。 */ }
    }
    if (userId) {
      try {
        await api(admin, `/api/admin/users/${userId}`, 'DELETE');
      } catch (error) {
        const remainingUsers = await api(admin, '/api/admin/users');
        if (remainingUsers.some((user) => user.id === userId)) throw error;
      }
    }
    await browser.close();
  }
}

async function login(page, username, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
