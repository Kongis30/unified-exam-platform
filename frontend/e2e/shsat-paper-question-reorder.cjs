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
  const paperTitle = `SHSAT Question Reorder ${stamp}`;
  const firstStem = `ELA reorder first ${stamp}`;
  const secondStem = `ELA reorder second ${stamp}`;
  const mathStem = `Math reorder boundary ${stamp}`;
  let paperId;

  try {
    await login(page);
    const created = await api(page, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `QUESTION_REORDER_${stamp}`,
      title: paperTitle,
      description: 'Temporary question order and section-boundary verification.',
      groupId: null,
      defaultDurationSeconds: 10_800,
    });
    paperId = Number(created.summary.id);

    const sections = (await api(page, `/api/admin/papers/${paperId}`)).sections.map(sectionRequest);
    const ela = sections.find(section => section.sectionCode === 'ELA');
    const math = sections.find(section => section.sectionCode === 'MATH');
    assert.ok(ela?.children?.length && math?.children?.length, 'the draft paper includes official SHSAT ELA and Math types');
    ela.children[0].questions = [makeQuestion(firstStem, 0, 1), makeQuestion(secondStem, 1, 2)];
    math.children[0].questions = [makeQuestion(mathStem, 0, 3, 'MATH')];
    await api(page, `/api/admin/papers/${paperId}/structure`, 'PUT', { sections });

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/edit`);
    await page.getByRole('heading', { name: paperTitle, exact: true }).waitFor();
    const elaGroup = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'English Language Arts', exact: true }) });
    const mathGroup = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'Mathematics', exact: true }) });
    const first = elaGroup.locator('.question-item').filter({ hasText: firstStem });
    const second = elaGroup.locator('.question-item').filter({ hasText: secondStem });
    await first.waitFor();
    await second.waitFor();

    await second.dragTo(first, { targetPosition: { x: 20, y: 1 } });
    await page.waitForFunction(({ firstStem, secondStem }) => {
      const group = [...document.querySelectorAll('.subject-group')]
        .find(node => node.querySelector('h3')?.textContent.trim() === 'English Language Arts');
      const text = [...(group?.querySelectorAll('.question-item') || [])].map(node => node.textContent);
      return text[0]?.includes(secondStem) && text[1]?.includes(firstStem);
    }, { firstStem, secondStem });
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();

    let detail = await api(page, `/api/admin/papers/${paperId}`);
    assert.deepEqual(questionOrder(detail, 'ELA', [firstStem, secondStem]), [secondStem, firstStem],
      'reordering questions within the same ELA section persists in the paper structure');
    assert.deepEqual(questionOrder(detail, 'MATH', [mathStem]), [mathStem],
      'reordering within ELA leaves Math order unchanged');

    await page.reload();
    await page.getByRole('heading', { name: paperTitle, exact: true }).waitFor();
    assert.ok((await elaGroup.locator('.question-item').allTextContents())[0].includes(secondStem),
      'the saved order is restored after refreshing the editor');
    const reorderedEla = elaGroup.locator('.question-item').filter({ hasText: secondStem });
    const mathTarget = mathGroup.locator('.question-item').filter({ hasText: mathStem });
    await reorderedEla.dragTo(mathTarget, { targetPosition: { x: 20, y: 1 } });
    const elaAfterRejectedDrop = await elaGroup.locator('.question-item').allTextContents();
    const mathAfterRejectedDrop = await mathGroup.locator('.question-item').allTextContents();
    assert.ok(elaAfterRejectedDrop[0].includes(secondStem) && elaAfterRejectedDrop[1].includes(firstStem),
      'an attempted cross-section drag leaves the ELA order unchanged');
    assert.ok(mathAfterRejectedDrop[0].includes(mathStem), 'the Math question remains in its original section');
    detail = await api(page, `/api/admin/papers/${paperId}`);
    assert.deepEqual(questionOrder(detail, 'ELA', [firstStem, secondStem]), [secondStem, firstStem],
      'an attempted cross-section drop is rejected without changing the saved order');
    assert.deepEqual(questionOrder(detail, 'MATH', [mathStem]), [mathStem],
      'a cross-section drop cannot move a question into the other subject');

    await page.screenshot({ path: `/tmp/shsat-paper-question-order-desktop-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390,
      'the question editor stays within a 390px viewport after drag-and-drop');
    await page.screenshot({ path: `/tmp/shsat-paper-question-order-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, [], 'the reorder interactions have no browser errors');

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['same-section drag order persists through save and refresh',
        'cross-section drag is rejected without changing either subject'],
      paperId,
      pageErrors: pageErrors.length,
      screenshots: [`/tmp/shsat-paper-question-order-desktop-${stamp}.png`, `/tmp/shsat-paper-question-order-mobile-${stamp}.png`],
    }));
  } finally {
    if (paperId) await api(page, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
    await browser.close();
  }
}

function sectionRequest(section) {
  return {
    sectionCode: section.sectionCode,
    sectionKind: section.sectionKind,
    title: section.title,
    sortOrder: section.sortOrder,
    instructions: section.instructions,
    settings: section.settings,
    questions: [],
    children: (section.children || []).map(sectionRequest),
  };
}

function makeQuestion(stem, sortOrder, displayNumber, scoringSectionCode = 'ELA') {
  return {
    questionTypeCode: 'MULTIPLE_CHOICE',
    payloadSchemaVersion: 1,
    stem,
    render: { options: [{ key: 'A', text: 'Correct' }, { key: 'B', text: 'Incorrect' }], questionConfig: {}, validationRules: {} },
    answerKey: { answers: ['A'] },
    grading: {},
    explanation: 'A is correct.',
    categoryId: null,
    sortOrder,
    displayNumber,
    maxPoints: 1,
    scoringSectionCode,
  };
}

function questionOrder(detail, partCode, stems) {
  const values = [];
  const visit = (sections, inPart = false) => {
    for (const section of sections || []) {
      const currentPart = inPart || section.sectionCode === partCode;
      if (currentPart) values.push(...(section.questions || []).map(question => question.stem).filter(stem => stems.includes(stem)));
      visit(section.children, currentPart);
    }
  };
  visit(detail.sections);
  return values;
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
