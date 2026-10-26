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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const stamp = Date.now();
  const paperTitle = `Editor Navigation ${stamp}`;
  const questionStem = `Editor persistence question ${stamp}`;
  let paperId;

  try {
    await login(page);
    const paper = await api(page, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `EDITOR_NAV_${stamp}`,
      title: paperTitle,
      description: 'Temporary paper editor navigation verification',
      groupId: null,
      defaultDurationSeconds: 1_200,
    });
    paperId = Number(paper.summary.id);
    const editorUrl = `${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/edit`;

    await page.goto(editorUrl);
    await page.getByRole('heading', { name: paperTitle, exact: true }).waitFor();
    const saveButton = page.getByRole('button', { name: 'No Changes', exact: true });
    assert.equal(await saveButton.isDisabled(), true, 'an unchanged paper cannot be saved');
    await page.screenshot({ path: `/tmp/shsat-paper-editor-clean-${stamp}.png` });

    const scoringRule = page.locator('.scoring-rule-field select');
    await scoringRule.selectOption('SHSAT_LEGACY_114');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    assert.equal((await api(page, `/api/admin/papers/${paperId}`)).scoringProfileCode,
      'SHSAT_LEGACY_114', 'the selected scoring profile persists');

    await page.getByRole('button', { name: 'Add Question', exact: true }).first().click();
    await page.locator('.stem-input').fill(questionStem);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByText('Save your changes before opening the student preview.', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, `/exam-types/SHSAT/admin/papers/${paperId}/edit`,
      'preview remains blocked while changes are unsaved');

    await page.getByRole('button', { name: 'Back to Paper Management' }).click();
    const leaveDialog = page.getByRole('heading', { name: 'Leave Paper Editor?' });
    await leaveDialog.waitFor();
    await page.getByRole('button', { name: 'Stay', exact: true }).click();
    assert.equal(new URL(page.url()).pathname, `/exam-types/SHSAT/admin/papers/${paperId}/edit`,
      'Stay keeps the editor open');
    await page.getByRole('button', { name: 'Back to Paper Management' }).click();
    await page.getByRole('button', { name: 'Leave Without Saving', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
    assert.equal(readQuestions(await api(page, `/api/admin/papers/${paperId}`)).length, 0,
      'leaving without saving discards the pending question');

    await page.goto(editorUrl);
    await page.getByRole('heading', { name: paperTitle, exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'No Changes', exact: true }).isDisabled(), true,
      'reopening the editor does not retain the discarded question');
    await page.getByRole('button', { name: 'Add Question', exact: true }).first().click();
    await page.locator('.stem-input').fill(questionStem);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();

    const detail = await api(page, `/api/admin/papers/${paperId}`);
    const savedQuestions = readQuestions(detail);
    assert.equal(savedQuestions.length, 1, 'saving adds one question');
    assert.equal(savedQuestions[0].stem, questionStem, 'saved question content is returned by the paper API');
    await page.reload();
    await page.locator('.stem-input').waitFor();
    assert.equal(await page.locator('.stem-input').inputValue(), questionStem,
      'the saved question is restored in the editor after reload');
    await page.screenshot({ path: `/tmp/shsat-paper-editor-saved-${stamp}.png` });

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.getByText(questionStem, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-paper-editor-preview-${stamp}.png` });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/edit`);
    await page.getByRole('heading', { name: paperTitle, exact: true }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.question-editor').scrollIntoViewIfNeeded();
    const mobileSize = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      editor: (() => {
        const element = document.querySelector('.paper-edit');
        return element ? {
          width: element.getBoundingClientRect().width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        } : null;
      })(),
      workspace: (() => {
        const element = document.querySelector('.workspace');
        return element ? {
          width: element.getBoundingClientRect().width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowingChildren: [...element.querySelectorAll('*')]
            .filter(child => child.scrollWidth > child.clientWidth + 1)
            .map(child => ({
              className: child.className?.toString().slice(0, 100),
              width: Math.round(child.getBoundingClientRect().width),
              clientWidth: child.clientWidth,
              scrollWidth: child.scrollWidth,
            }))
            .slice(0, 12),
        } : null;
      })(),
      choiceInputWidths: [...document.querySelectorAll('.choice-editor__option-main > .form-input')]
        .map(element => Math.round(element.getBoundingClientRect().width)),
    }));
    await page.screenshot({ path: `/tmp/shsat-paper-editor-mobile-${stamp}.png` });
    assert.ok(mobileSize.pageWidth <= mobileSize.viewportWidth,
      `the paper editor has no root overflow at 390px: ${JSON.stringify(mobileSize)}`);
    assert.ok(mobileSize.editor.width <= mobileSize.viewportWidth,
      `the paper editor fits the viewport at 390px: ${JSON.stringify(mobileSize)}`);
    assert.ok(mobileSize.workspace.scrollWidth <= mobileSize.workspace.clientWidth,
      `the editor workspace has no clipped content at 390px: ${JSON.stringify(mobileSize)}`);
    assert.ok(mobileSize.choiceInputWidths.length > 0 && mobileSize.choiceInputWidths.every(width => width >= 120),
      `multiple-choice fields remain usable at 390px: ${JSON.stringify(mobileSize.choiceInputWidths)}`);
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['unchanged save disabled', 'scoring rule persists', 'unsaved preview is blocked',
        'Stay preserves edits', 'Leave Without Saving discards edits', 'saved question survives reload',
        'preview shows saved question and Back returns to editor', '390px editor layout'],
      mobileSize,
      pageErrors: pageErrors.length,
      screenshots: ['clean', 'saved', 'preview', 'mobile'].map(name => `/tmp/shsat-paper-editor-${name}-${stamp}.png`),
    }));
  } finally {
    if (paperId) await api(page, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
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

function readQuestions(detail) {
  const questions = [];
  const visit = sections => {
    for (const section of sections || []) {
      questions.push(...(section.questions || []));
      visit(section.children);
    }
  };
  visit(detail.sections);
  return questions;
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
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  }
  return response.text ? JSON.parse(response.text) : null;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
