const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const stamp = Date.now();
  const title = `Export Check ${String(stamp).slice(-6)}`;
  let paperId;

  try {
    await login(page);
    const paper = await api(page, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `EXPORT_CHECK_${stamp}`, title, description: 'Temporary SHSAT paper export regression',
      groupId: null, defaultDurationSeconds: 1_200,
    });
    paperId = Number(paper.summary.id);
    await api(page, `/api/admin/papers/${paperId}/structure`, 'PUT', { sections: sections() });

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/export`);
    await page.locator('.print-section').first().waitFor();
    assert.equal(await page.getByRole('group', { name: 'Document type' }).count(), 1, 'document type controls are accessible as a group');
    assert.equal(await page.getByRole('group', { name: 'Paper section' }).count(), 1, 'paper section controls are accessible as a group');
    assert.equal(await page.title(), `${title} - Whole Paper - Student Paper`, 'browser document title identifies the paper and export mode');
    assert.match(await page.locator('style[data-paper-print-title]').textContent(), new RegExp(title), 'print page header uses the paper title');
    await page.locator('.print-section').count().then(count => assert.equal(count, 2, 'Whole Paper contains ELA and Math sections'));
    assert.equal(await page.locator('.print-question').count(), 3, 'Whole Paper renders all configured questions');
    assert.equal(await page.locator('.print-material img').count(), 1, 'whole paper renders its material image');
    assert.ok(await page.locator('.print-material img').evaluate(image => image.complete && image.naturalWidth > 0),
      'material image finishes loading before PDF export');
    assert.match(await page.locator('.print-material').innerText(), /Export Passage Check[\s\S]*Long passage paragraph 1/,
      'long material content remains in the printable paper');
    assert.ok(await page.locator('.print-material .formula-text__block-math').count() > 0,
      'formula is rendered as math in the printable material');
    assert.equal(await page.locator('.print-material__table').count(), 1, 'aligned material rows render as a print table');
    assert.match(await page.locator('.print-material__table').innerText(), /Year\s+Students[\s\S]*2024\s+120/,
      'table headers and values remain legible in the material');
    assert.match((await page.locator('.print-section').allInnerTexts()).join('\n'), /ENGLISH LANGUAGE ARTS SECTION[\s\S]*MATHEMATICS SECTION/);
    await page.screenshot({ path: `/tmp/shsat-paper-export-desktop-${stamp}.png` });
    const wholeStudentPdf = await printPdf(page, 'Print or save student paper PDF', `/tmp/shsat-paper-export-content-${stamp}.pdf`);

    const sectionGroup = page.getByRole('group', { name: 'Paper section' });
    await sectionGroup.getByRole('button', { name: 'ELA', exact: true }).click();
    assert.equal(await page.locator('.print-section').count(), 1, 'ELA export includes one section');
    assert.equal(await page.locator('.print-question').count(), 2, 'ELA export includes both ELA questions');
    assert.equal(await page.locator('.print-material img').count(), 1, 'ELA export includes its material image');
    assert.equal(await page.locator('.print-question').first().innerText().then(text => text.includes('Choose the ELA answer.')), true);
    assert.equal((await page.locator('.print-section').allInnerTexts()).join('\n').includes('Choose the Math answer.'), false,
      'ELA export excludes Math content');

    await page.getByRole('group', { name: 'Document type' }).getByRole('button', { name: 'Answer Key', exact: true }).click();
    assert.equal(await page.title(), `${title} - English Language Arts - Solutions`, 'document title follows selected answer key section');
    assert.equal(await page.locator('.answer-key').count(), 1, 'ELA answer key has one section');
    assert.match(await page.locator('.answer-key').innerText(), /A/);
    const elaAnswerPdf = await printPdf(page, 'Print or save answer key PDF');

    await sectionGroup.getByRole('button', { name: 'MATH', exact: true }).click();
    assert.equal(await page.locator('.answer-key').count(), 1, 'Math answer key has one section');
    assert.match(await page.locator('.answer-key').innerText(), /B/);
    const mathAnswerPdf = await printPdf(page, 'Print or save answer key PDF');

    await sectionGroup.getByRole('button', { name: 'All Sections', exact: true }).click();
    assert.equal(await page.locator('.answer-key').count(), 2, 'Whole Paper answer key includes both subjects');
    assert.match((await page.locator('.answer-key').allInnerTexts()).join('\n'), /A[\s\S]*B/);

    await page.getByRole('group', { name: 'Document type' }).getByRole('button', { name: 'Student Paper', exact: true }).click();
    await page.locator('.print-material img').evaluate(image => { image.src = 'data:image/png;base64,not-a-valid-image'; });
    await page.locator('.print-material img').evaluate(image => image.decode().catch(() => null));
    await page.getByRole('button', { name: 'Print or save student paper PDF' }).click();
    assert.match(await page.getByRole('alert').innerText(), /Some images are missing or still loading/,
      'missing image is explained in English before continuing to print');
    assert.equal(await page.evaluate(() => window.__printRequested), true, 'missing image warning does not block print flow');

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    await page.screenshot({ path: `/tmp/shsat-paper-export-mobile-${stamp}.png` });
    assert.ok(mobileSize.page <= mobileSize.viewport, `export page fits a 390px viewport (${mobileSize.page}px content)`);
    await page.getByRole('link', { name: 'Back to Paper Management' }).click();
    await page.waitForURL(url => url.pathname === '/exam-types/SHSAT/admin');
    assert.equal(await page.getByRole('tab', { name: 'Paper Management' }).getAttribute('aria-selected'), 'true',
      'back link returns to the paper management tab');
    assert.deepEqual(pageErrors, [], 'paper export has no browser errors');

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['accessible export controls', 'paper title and page header', 'whole-paper Student PDF', 'ELA-only Student view',
        'ELA Answer Key PDF', 'Math Answer Key PDF', 'whole-paper Answer Key', 'image/formula/material/table PDF output',
        'missing-image warning without blocking print', '390px export layout', 'back to Paper Management'],
      pdfBytes: { wholeStudent: wholeStudentPdf.byteLength, elaAnswer: elaAnswerPdf.byteLength, mathAnswer: mathAnswerPdf.byteLength },
      mobileSize,
      pageErrors: pageErrors.length,
      studentPdf: `/tmp/shsat-paper-export-content-${stamp}.pdf`,
      screenshots: [`/tmp/shsat-paper-export-desktop-${stamp}.png`, `/tmp/shsat-paper-export-mobile-${stamp}.png`],
    }));
  } finally {
    if (paperId) await api(page, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
    await browser.close();
  }
}

async function printPdf(page, buttonName, outputPath) {
  await page.evaluate(() => {
    window.__printRequested = false;
    window.print = () => { window.__printRequested = true; };
  });
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  await page.waitForFunction(() => window.__printRequested === true);
  assert.equal(await page.evaluate(() => window.__printRequested), true, `${buttonName} opens the print flow`);
  assert.ok(await page.locator('.paper-export math-span, .paper-export math-div').evaluateAll(formulas => (
    formulas.every(formula => formula.shadowRoot?.querySelector('.ML__latex'))
  )), 'MathLive formulas finish rendering before the print dialog opens');
  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', `${buttonName} creates a PDF`);
  assert.ok(pdf.byteLength > 5_000, `${buttonName} PDF contains printable content`);
  if (outputPath) fs.writeFileSync(outputPath, pdf);
  return pdf;
}

function sections() {
  return [
    {
      sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0,
      instructions: null, settings: {}, questions: [],
      children: [{
        sectionCode: 'ELA_READING', sectionKind: 'SUBTYPE', title: 'Reading', sortOrder: 0,
        instructions: null, settings: {}, children: [],
        questions: [
          question('Choose the ELA answer.', 'A', 1, 'ELA'),
          question('Use the passage to answer the question.', 'B', 2, 'ELA', {
            type: 'TEXT', title: 'Export Passage Check', category: 'Reading Passage',
          content: `\n\n| Year | Students |\n| --- | --- |\n| 2024 | 120 |\n\nThis passage verifies real print layout. The displayed formula is $$x^2 + 3x + 2 = 0$$.\n\n${Array.from({ length: 36 }, (_, index) => `Long passage paragraph ${index + 1}: The material should flow onto the next printed page without clipping or disappearing. It includes enough ordinary prose to exercise page breaks in the generated student paper.`).join('\n\n')}\n\n[[MATERIAL_IMAGE:${materialImageUrl()}]]`,
          }, 1),
        ],
      }],
    },
    {
      sectionCode: 'MATH', sectionKind: 'PART', title: 'Mathematics', sortOrder: 1,
      instructions: null, settings: {}, questions: [],
      children: [{
        sectionCode: 'MATH_ALGEBRA', sectionKind: 'SUBTYPE', title: 'Algebra', sortOrder: 0,
        instructions: null, settings: {}, children: [],
        questions: [question('Choose the Math answer.', 'B', 2, 'MATH')],
      }],
    },
  ];
}

function question(stem, correctAnswer, displayNumber, scoringSectionCode, material, sortOrder = 0) {
  return {
    questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1, stem,
    render: { options: [{ key: 'A', text: 'Option A' }, { key: 'B', text: 'Option B' }], questionConfig: {}, validationRules: {}, ...(material ? { material } : {}) },
    answerKey: { answers: [correctAnswer] }, grading: {}, explanation: `The answer is ${correctAnswer}.`,
    categoryId: null, sortOrder, displayNumber, maxPoints: 1, scoringSectionCode,
  };
}

function materialImageUrl() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#eaf1ff"/><text x="32" y="128" font-size="34" fill="#183b72">Printable material image</text></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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
