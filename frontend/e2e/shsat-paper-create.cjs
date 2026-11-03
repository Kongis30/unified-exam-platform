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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/api/') && response.status() >= 500) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  const stamp = Date.now();
  let title = `Temporary SHSAT Practice Paper Name Layout and Filtering Regression Check ${String(stamp).slice(-6)}`;
  let paperId;
  let versionId;
  let releaseExamId;

  try {
    await login(page);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin`);
    await page.getByRole('tab', { name: 'Paper Management', exact: true }).click();
    await page.getByRole('button', { name: 'Create Paper', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Create Paper' });
    await modal.waitFor();
    await page.screenshot({ path: `/tmp/shsat-paper-create-modal-${stamp}.png` });

    await modal.getByRole('button', { name: 'Create and Edit', exact: true }).click();
    await modal.getByText('Paper name is required.', { exact: true }).waitFor();
    await modal.getByLabel('Paper Name').fill(title);
    await modal.getByLabel('Description').fill('Temporary paper creation and folder assignment regression.');
    await modal.getByLabel('Folder').selectOption('');
    await modal.locator('input[type="number"]').fill('180');
    await modal.screenshot({ path: `/tmp/shsat-paper-create-filled-${stamp}.png` });
    await modal.getByRole('button', { name: 'Create and Edit', exact: true }).click();
    await page.waitForURL(/\/exam-types\/SHSAT\/admin\/papers\/\d+\/edit$/);
    paperId = Number(new URL(page.url()).pathname.match(/papers\/(\d+)\/edit$/)[1]);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();

    const detail = await api(page, `/api/admin/papers/${paperId}`);
    assert.equal(detail.summary.title, title, 'the created title is persisted');
    assert.equal(detail.summary.groupId, null, 'the selected Default Folder persists as an ungrouped paper');
    assert.equal(detail.summary.defaultDurationSeconds, 10_800, 'the duration is converted from minutes to seconds');
    assert.equal(detail.summary.status, 'DRAFT', 'new papers are created as drafts');
    assert.deepEqual(detail.sections.filter(section => section.sectionKind === 'PART').map(section => section.sectionCode), ['ELA', 'MATH'],
      'the new paper includes the official ELA and Math structure');
    assert.deepEqual(detail.sections.flatMap(section => section.children.map(child => child.settings?.subTypeCode)), [
      'REVISING_EDITING_PART_A', 'REVISING_EDITING_PART_B', 'READING_COMPREHENSION',
      'MATH_FILL_IN_BLANK', 'MATH_MULTIPLE_CHOICE', 'MATH_TECH_ENHANCED',
    ], 'the new paper includes all official SHSAT subtypes');
    assert.deepEqual(detail.sections.map(section => [section.settings?.questionRange, section.settings?.questionCount]), [
      ['1-50', 50], ['51-100', 50],
    ], 'the default parts retain their official question ranges and counts');
    assert.deepEqual(detail.sections.map(section => [section.title, section.instructions]), [
      ['English Language Arts', 'SHSAT English Language Arts section with 50 scored questions.'],
      ['Mathematics', 'SHSAT Mathematics section with 50 scored questions.'],
    ], 'the default parts retain the independent system names and descriptions');
    assert.deepEqual(detail.sections.flatMap(section => section.children.map(child => [child.title, child.instructions])), [
      ['Revising/Editing Part A', 'Stand-alone language and writing questions.'],
      ['Revising/Editing Part B', 'Passage-based writing improvement questions.'],
      ['Reading Comprehension', 'Passage-based reading analysis questions.'],
      ['Math Fill in the Blank', 'Math questions answered by entering a value.'],
      ['Math Multiple Choice', 'Math questions answered by choosing one option.'],
      ['Math Tech-Enhanced', 'Technology-enhanced SHSAT math interaction questions.'],
    ], 'official SHSAT subtype names and guidance match the independent system');

    await api(page, `/api/admin/papers/${paperId}/scoring-profile`, 'PATCH', {
      scoringProfileCode: 'SHSAT_2026_100',
    });
    const createdVersion = await api(page, `/api/admin/papers/${paperId}/versions`, 'POST');
    versionId = Number(createdVersion.summary.id);
    assert.equal(createdVersion.scoringProfileCode, 'SHSAT_2026_100',
      'a new version inherits the source paper scoring profile');
    assert.equal((await api(page, `/api/admin/papers/${versionId}`)).scoringProfileCode,
      'SHSAT_2026_100', 'the inherited scoring profile persists after reloading the new version');
    assert.equal((await api(page, `/api/admin/papers/${paperId}`)).scoringProfileCode, 'SHSAT_2026_100',
      'the source scoring profile remains unchanged after version creation');
    await api(page, `/api/admin/papers/${versionId}`, 'DELETE');
    versionId = undefined;

    await page.getByRole('button', { name: /Back to Paper Management/ }).click();
    await page.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
    const nameFilter = page.getByPlaceholder('Paper name');
    await nameFilter.fill(title);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).waitFor();
    const defaultGroup = page.locator('.folder-panel').filter({ hasText: 'Default Folder' });
    let paperRow = defaultGroup.locator('.paper-table tbody tr').filter({ hasText: title });
    if (!await paperRow.count()) await defaultGroup.locator('.folder-panel__main-button').click();
    await paperRow.waitFor();
    await paperRow.getByRole('button', { name: 'Paper actions', exact: true }).click();
    await page.getByRole('menu').getByRole('button', { name: 'Seal', exact: true }).click();
    const sealError = page.getByText('Add at least one section and one question before sealing this paper.', { exact: true });
    await sealError.waitFor();
    await page.screenshot({ path: `/tmp/shsat-paper-seal-empty-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
      'the empty-paper seal error fits a 390px viewport');
    await page.screenshot({ path: `/tmp/shsat-paper-seal-empty-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal((await api(page, `/api/admin/papers/${paperId}`)).summary.status, 'DRAFT',
      'sealing an empty draft keeps it in DRAFT');
    await page.getByRole('button', { name: 'Close notification', exact: true }).click();
    await paperRow.getByRole('button', { name: 'Paper actions', exact: true }).click();
    await page.getByRole('menu').getByRole('button', { name: 'Edit Info', exact: true }).click();
    const editInfoDialog = page.locator('.modal-card--paper-settings');
    await editInfoDialog.waitFor();
    const updatedTitle = `${title} Revised`;
    await editInfoDialog.getByLabel('Paper Name').fill(updatedTitle);
    await editInfoDialog.getByLabel('Description').fill('Updated paper details persisted from the edit dialog.');
    await editInfoDialog.getByLabel('Duration (minutes)').fill('165');
    await page.screenshot({ path: `/tmp/shsat-paper-edit-info-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
      'the paper info dialog fits a 390px viewport');
    await page.screenshot({ path: `/tmp/shsat-paper-edit-info-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await editInfoDialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await editInfoDialog.waitFor({ state: 'detached' });
    title = updatedTitle;
    const editedPaper = await api(page, `/api/admin/papers/${paperId}`);
    assert.equal(editedPaper.summary.title, title, 'Edit Info saves the paper title');
    assert.equal(editedPaper.description, 'Updated paper details persisted from the edit dialog.');
    assert.equal(editedPaper.summary.defaultDurationSeconds, 9_900, 'Edit Info saves duration in minutes');

    const release = await api(page, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title: `Paper deletion release ${stamp}`,
      description: 'Temporary draft release used to verify paper deletion cleanup.',
      opensAt: new Date(Date.now() + 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 9_900,
      attemptLimit: 1,
      targetScope: 'ALL_STUDENTS',
      autoSubmit: true,
      allowReview: true,
    });
    releaseExamId = Number(release.summary.id);

    await nameFilter.fill(title);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).waitFor();
    paperRow = defaultGroup.locator('.paper-table tbody tr').filter({ hasText: title });
    await paperRow.waitFor();
    const listValues = (await paperRow.locator('td').allTextContents()).map(value => value.replace(/\s+/g, ' ').trim());
    assert.equal(listValues[0], title, 'the long paper name remains readable and is the only first-column value');
    assert.equal(listValues[1], '0', 'a draft with no questions displays zero questions');
    assert.equal(listValues[2], '165 min', 'the paper list reflects the edited duration');
    assert.equal(listValues[3], '0', 'an empty draft displays a zero score');
    assert.equal(listValues[4], 'DRAFT / Offline', 'a draft is marked offline in the list');
    await page.screenshot({ path: `/tmp/shsat-paper-list-long-name-${stamp}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
      'a long paper name in the list does not create mobile horizontal overflow');
    await page.screenshot({ path: `/tmp/shsat-paper-list-long-name-mobile-${stamp}.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await paperRow.getByRole('button', { name: 'Paper actions', exact: true }).click();
    await page.getByRole('menu').getByRole('button', { name: 'Edit Paper', exact: true }).click();
    await page.waitForURL(new RegExp(`/exam-types/SHSAT/admin/papers/${paperId}/edit$`));
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add Question', exact: true }).first().click();
    const sealQuestionStem = `Seal validation question ${stamp}`;
    await page.locator('.stem-input').fill(sealQuestionStem);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();

    await page.getByRole('button', { name: /Back to Paper Management/ }).click();
    await page.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
    await nameFilter.fill(title);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).waitFor();
    paperRow = defaultGroup.locator('.paper-table tbody tr').filter({ hasText: title });
    if (!await paperRow.count()) await defaultGroup.locator('.folder-panel__main-button').click();
    await paperRow.waitFor();
    await paperRow.getByRole('button', { name: 'Paper actions', exact: true }).click();
    await page.getByRole('menu').getByRole('button', { name: 'Seal', exact: true }).click();
    await page.getByText('Paper sealed and ready for exam releases.', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-paper-seal-ready-${stamp}.png` });
    const sealedPaper = await api(page, `/api/admin/papers/${paperId}`);
    assert.equal(sealedPaper.summary.status, 'READY', 'a valid paper can be sealed from the Paper Management list');
    assert.ok(questionStemsInPart(sealedPaper, 'ELA').includes(sealQuestionStem),
      'sealing preserves the saved ELA question');

    await page.getByRole('button', { name: 'Create Paper', exact: true }).click();
    const duplicateModal = page.getByRole('dialog', { name: 'Create Paper' });
    await duplicateModal.getByLabel('Paper Name').fill(title);
    await duplicateModal.getByRole('button', { name: 'Create and Edit', exact: true }).click();
    await duplicateModal.getByText('Paper name already exists.', { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, 'the create-paper dialog fits a 390px page');
    await page.screenshot({ path: `/tmp/shsat-paper-create-duplicate-mobile-${stamp}.png` });
    await duplicateModal.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.setViewportSize({ width: 1440, height: 900 });
    const deleteSearch = page.getByPlaceholder('Paper name');
    await deleteSearch.fill(title);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).waitFor();
    const createdPaperRow = page.locator('.folder-panel').filter({ hasText: 'Default Folder' })
      .locator('.paper-table tbody tr').filter({ hasText: title });
    const defaultFolder = page.locator('.folder-panel').filter({ has: page.getByRole('button', { name: /Default Folder/ }) });
    if (!await createdPaperRow.count()) await defaultFolder.locator('.folder-panel__main-button').click();
    await createdPaperRow.waitFor();
    await createdPaperRow.getByRole('button', { name: 'Paper actions', exact: true }).click();
    await page.getByRole('menu').getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('alertdialog', { name: 'Delete this paper?' });
    await deleteDialog.waitFor();
    assert.equal(await page.locator('.action-toast').count(), 0,
      'a stale action notification does not overlap the permanent-delete confirmation');
    await deleteDialog.getByText(title, { exact: true }).waitFor();
    await deleteDialog.getByText('Loading deletion impact...', { exact: true }).waitFor({ state: 'detached' });
    assert.ok(await deleteDialog.locator('.paper-delete-impact-grid').isVisible(),
      'the confirmation dialog shows the paper deletion impact');
    const deleteImpactText = await deleteDialog.locator('.paper-delete-impact-grid').innerText();
    assert.match(deleteImpactText, /Scheduled Exams\s*\?\s*1/,
      `the deletion impact reports its linked exam release: ${deleteImpactText}`);
    const permanentDeleteButton = deleteDialog.getByRole('button', { name: 'Delete Paper Permanently', exact: true });
    assert.equal(await permanentDeleteButton.isDisabled(), true, 'paper deletion is disabled during the cooldown');
    await page.screenshot({ path: `/tmp/shsat-paper-delete-confirm-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
      'the paper delete confirmation fits a 390px viewport');
    assert.equal(await permanentDeleteButton.evaluate(button => getComputedStyle(button).whiteSpace), 'nowrap',
      'the permanent-delete label stays on one line on mobile');
    assert.ok(await page.evaluate(() => {
      const backdrop = document.querySelector('.paper-delete-confirm')?.parentElement;
      const toast = document.querySelector('.action-toast');
      return !backdrop || !toast || Number(getComputedStyle(backdrop).zIndex) > Number(getComputedStyle(toast).zIndex);
    }), 'the delete confirmation stays above any action notification');
    await page.screenshot({ path: `/tmp/shsat-paper-delete-confirm-mobile-${stamp}.png` });
    await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await api(page, `/api/admin/papers/${paperId}`)).summary.title, title,
      'cancel leaves the paper unchanged');

    await createdPaperRow.getByRole('button', { name: 'Paper actions', exact: true }).click();
    await page.getByRole('menu').getByRole('button', { name: 'Delete', exact: true }).click();
    const confirmedDeleteDialog = page.getByRole('alertdialog', { name: 'Delete this paper?' });
    const confirmedDeleteButton = confirmedDeleteDialog.getByRole('button', { name: 'Delete Paper Permanently', exact: true });
    await page.waitForFunction(() => {
      const button = document.querySelector('.paper-delete-confirm__delete');
      return button && !button.disabled;
    }, null, { timeout: 16_000 });
    await confirmedDeleteButton.click();
    await createdPaperRow.waitFor({ state: 'detached' });
    const deletedPaper = await page.evaluate(async paperId => {
      const response = await fetch(`/api/admin/papers/${paperId}`);
      return response.status;
    }, paperId);
    assert.equal(deletedPaper, 404, 'confirmed paper deletion removes the paper');
    const deletedRelease = await page.evaluate(async examId => {
      const response = await fetch(`/api/admin/exams/${examId}`);
      return response.status;
    }, releaseExamId);
    assert.equal(deletedRelease, 404, 'paper deletion also removes its linked release');
    releaseExamId = undefined;
    paperId = undefined;

    assert.deepEqual(pageErrors, [], 'paper creation has no browser errors');
    assert.deepEqual(failedRequests, [], `paper creation has no server errors: ${failedRequests.join(', ')}`);

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['required name validation', 'description and duration save', 'Default Folder assignment',
        'new SHSAT paper versions inherit the configured scoring profile',
        'empty draft seal is blocked; valid ELA paper is sealed and remains ready',
        'offline DRAFT with official ELA/Math parts and six subtypes', 'Edit Info metadata persistence', 'Edit Paper route',
        'long paper name and list question/duration/score/status columns on desktop and mobile',
        'duplicate name validation', 'paper deletion impact and linked release cascade', 'cooldown, cancel and confirm', '390px create/delete dialogs'],
      paperId, mobileSize, pageErrors: pageErrors.length,
      screenshots: [`/tmp/shsat-paper-create-modal-${stamp}.png`, `/tmp/shsat-paper-create-filled-${stamp}.png`,
        `/tmp/shsat-paper-edit-info-${stamp}.png`, `/tmp/shsat-paper-edit-info-mobile-${stamp}.png`,
        `/tmp/shsat-paper-seal-empty-${stamp}.png`, `/tmp/shsat-paper-seal-empty-mobile-${stamp}.png`,
        `/tmp/shsat-paper-seal-ready-${stamp}.png`,
        `/tmp/shsat-paper-list-long-name-${stamp}.png`, `/tmp/shsat-paper-list-long-name-mobile-${stamp}.png`,
        `/tmp/shsat-paper-create-duplicate-mobile-${stamp}.png`, `/tmp/shsat-paper-delete-confirm-${stamp}.png`,
        `/tmp/shsat-paper-delete-confirm-mobile-${stamp}.png`],
    }));
  } finally {
    if (releaseExamId) await api(page, `/api/admin/exams/${releaseExamId}`, 'DELETE').catch(() => {});
    if (versionId) await api(page, `/api/admin/papers/${versionId}`, 'DELETE').catch(() => {});
    if (paperId) await api(page, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
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

function questionStemsInPart(detail, partCode) {
  const stems = [];
  const visit = (sections, insidePart = false) => {
    for (const section of sections || []) {
      const belongsToPart = insidePart || section.sectionCode === partCode;
      if (belongsToPart) stems.push(...(section.questions || []).map(question => question.stem));
      visit(section.children, belongsToPart);
    }
  };
  visit(detail.sections);
  return stems;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
