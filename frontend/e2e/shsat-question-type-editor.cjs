const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
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
  const title = `Question Type Editor ${stamp}`;
  const suffix = String(stamp).slice(-6);
  let paperId;
  let uploadedImageUrl;

  try {
    await login(page);
    const paper = await api(page, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `QUESTION_TYPE_EDITOR_${stamp}`,
      title,
      description: 'Temporary question type editor regression',
      groupId: null,
      defaultDurationSeconds: 1_200,
    });
    paperId = Number(paper.summary.id);
    const editorUrl = `${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/edit`;
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();

    await page.getByRole('button', { name: 'Add Question', exact: true }).first().click();
    await page.locator('.stem-input').fill(`Sort numbers ${suffix} by parity.`);
    await page.getByLabel('Primary Type').selectOption({ label: 'English Language Arts' });
    await page.getByLabel('Secondary Type').selectOption({ label: 'Revising/Editing Part A' });
    await page.getByLabel('Difficulty').selectOption('Hard');
    await page.locator('.skill-tag-trigger').click();
    await page.getByRole('menuitem', { name: 'English Language Arts', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Reading Comprehension', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Inference', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('DRAG_AND_DROP');
    const dragEditor = page.locator('.drag-editor');
    await dragEditor.waitFor();
    await dragEditor.getByRole('button', { name: 'Add Card', exact: true }).click();
    assert.equal(await dragEditor.locator('.drag-editor__row--choice').count(), 5, 'Add Card creates another configurable answer choice');
    await dragEditor.locator('.drag-editor__row--choice').last().getByRole('button', { name: 'Remove card' }).click();
    assert.equal(await dragEditor.locator('.drag-editor__row--choice').count(), 4, 'Remove card restores the original choice count');
    await dragEditor.getByRole('button', { name: 'Add Target', exact: true }).click();
    assert.equal(await dragEditor.locator('.drag-editor__row--target').count(), 3, 'Add Target creates another configurable target');
    await dragEditor.locator('.drag-editor__row--target').last().getByRole('button', { name: 'Remove target' }).click();
    assert.equal(await dragEditor.locator('.drag-editor__row--target').count(), 2, 'Remove target restores the original target count');
    await dragEditor.getByLabel('Sorting boxes', { exact: true }).check();

    const choiceRows = dragEditor.locator('.drag-editor__row--choice');
    await choiceRows.nth(0).locator('input').fill('1');
    await choiceRows.nth(1).locator('input').fill('2');
    await choiceRows.nth(2).locator('input').fill('3');
    await choiceRows.nth(3).locator('input').fill('4');
    const targetRows = dragEditor.locator('.drag-editor__row--target');
    await targetRows.nth(0).locator('input.form-input').fill(`Odd ${suffix}`);
    await targetRows.nth(1).locator('input.form-input').fill(`Even ${suffix}`);
    const targetChoices = targetRows.nth(0).locator('.drag-editor__choice-checks label input');
    await targetChoices.nth(0).check();
    await targetChoices.nth(2).check();
    const evenChoices = targetRows.nth(1).locator('.drag-editor__choice-checks label input');
    await evenChoices.nth(1).check();
    await evenChoices.nth(3).check();

    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    const savedPaper = await api(page, `/api/admin/papers/${paperId}`);
    let questions = readQuestions(savedPaper);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].questionTypeCode, 'DRAG_AND_DROP');
    assert.equal(questions[0].render.difficulty, 'Hard', 'difficulty is persisted with the question');
    assert.deepEqual(questions[0].render.questionConfig.shsatSkillTag, {
      subjectCode: 'ELA', domainCode: 'ELA_READING_COMPREHENSION', skillCode: 'ELA_READING_INFERENCE',
    }, 'official SHSAT skill tags are persisted in the question configuration');
    assert.deepEqual(questions[0].render.questionConfig.choices.map(choice => choice.text), ['1', '2', '3', '4']);
    assert.deepEqual(questions[0].render.questionConfig.targets.map(target => target.label), [`Odd ${suffix}`, `Even ${suffix}`]);
    assert.deepEqual(questions[0].answerKey.placements, { target1: ['choice1', 'choice3'], target2: ['choice2', 'choice4'] });
    const elaPart = savedPaper.sections.find(section => section.sectionCode === 'ELA');
    const revisingPartA = elaPart?.children.find(section => section.sectionCode === 'ELA_REVISING_EDITING_PART_A');
    assert.ok(revisingPartA?.questions.some(question => question.stem === `Sort numbers ${suffix} by parity.`),
      'the question remains assigned to its selected ELA secondary type');

    await page.reload();
    await dragEditor.waitFor();
    assert.equal(await page.getByLabel('Difficulty').inputValue(), 'Hard', 'difficulty is restored after reloading the editor');
    assert.match(await page.locator('.skill-tag-trigger').innerText(), /Reading Comprehension.*Inference/,
      'the selected SHSAT skill tag is restored after reloading the editor');
    await page.locator('.meta-toolbar').screenshot({ path: `/tmp/shsat-question-type-editor-metadata-${stamp}.png` });
    assert.deepEqual(await dragEditor.locator('.drag-editor__row--choice input').evaluateAll(inputs => inputs.map(input => input.value)), ['1', '2', '3', '4'],
      'drag-and-drop choices are restored after reloading the editor');
    assert.deepEqual(await dragEditor.locator('.drag-editor__row--target input.form-input').evaluateAll(inputs => inputs.map(input => input.value)), [`Odd ${suffix}`, `Even ${suffix}`],
      'drag-and-drop target labels are restored after reloading the editor');
    assert.deepEqual(await dragEditor.locator('.drag-editor__row--target').evaluateAll(rows => rows.map(row => (
      [...row.querySelectorAll('.drag-editor__choice-checks input:checked')].map(input => input.closest('label')?.textContent.trim())
    ))), [['1', '3'], ['2', '4']], 'correct drag placements are restored after reloading the editor');
    await dragEditor.scrollIntoViewIfNeeded();
    await dragEditor.screenshot({ path: `/tmp/shsat-question-type-editor-drag-${stamp}.png` });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.getByText(`Sort numbers ${suffix} by parity.`, { exact: true }).waitFor();
    await page.getByText(`Odd ${suffix}`, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-drag-${stamp}.png` });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname === editorUrl.replace(baseUrl, ''));
    await page.getByRole('heading', { name: title, exact: true }).waitFor();

    const mathSection = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'Mathematics', exact: true }) });
    await mathSection.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('SOLUTION_SET');
    const solutionEditor = page.locator('.solution-editor');
    await solutionEditor.waitFor();
    const solutionStem = 'Graph x ≥ 8.';
    await page.locator('.stem-input').fill(solutionStem);
    const settings = solutionEditor.locator('.solution-editor__settings');
    await settings.locator('.form-field').nth(0).locator('input').fill('-2');
    await settings.locator('.form-field').nth(1).locator('input').fill('10');
    await settings.locator('.form-field').nth(2).locator('input').fill('1');
    const rayButtons = solutionEditor.locator('.solution-answer__ray-button');
    assert.equal(await rayButtons.count(), 4, `the solution-set editor renders all ray choices; editor=${(await solutionEditor.innerText()).slice(0, 500)}`);
    await rayButtons.filter({ hasText: 'Closed right ray' }).click();
    await solutionEditor.locator('.solution-line__tick').filter({ hasText: /^8$/ }).locator('.solution-line__hit').click();
    await solutionEditor.locator('.solution-editor__summary').getByText('x ≥ 8', { exact: true }).waitFor();
    await solutionEditor.getByRole('button', { name: 'Reset Answer', exact: true }).click();
    await solutionEditor.locator('.solution-editor__summary').getByText('x ≥ 1', { exact: true }).waitFor();
    await rayButtons.filter({ hasText: 'Closed right ray' }).click();
    await solutionEditor.locator('.solution-line__tick').filter({ hasText: /^8$/ }).locator('.solution-line__hit').click();
    await solutionEditor.locator('.solution-editor__summary').getByText('x ≥ 8', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();

    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    assert.equal(questions.length, 2);
    const solutionQuestion = questions.find(question => question.questionTypeCode === 'SOLUTION_SET');
    assert.ok(solutionQuestion, 'the solution-set question is stored in the paper structure');
    assert.equal(solutionQuestion.stem, solutionStem);
    assert.equal(solutionQuestion.render.questionConfig.numberLine.min, -2);
    assert.equal(solutionQuestion.render.questionConfig.numberLine.max, 10);
    assert.deepEqual(solutionQuestion.answerKey.solution, { type: 'ray', endpoint: 8, endpointIncluded: true, direction: 'right' });

    await page.reload();
    await page.getByRole('heading', { name: 'Question 2 · Solution Set', exact: true }).waitFor();
    assert.equal(await page.locator('.stem-input').inputValue(), solutionStem, 'the solution-set prompt is restored after reloading the editor');
    assert.equal(await settings.locator('.form-field').nth(0).locator('input').inputValue(), '-2');
    assert.equal(await settings.locator('.form-field').nth(1).locator('input').inputValue(), '10');
    await solutionEditor.locator('.solution-editor__summary').getByText('x ≥ 8', { exact: true }).waitFor();
    await solutionEditor.scrollIntoViewIfNeeded();
    await solutionEditor.screenshot({ path: `/tmp/shsat-question-type-editor-solution-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileEditorSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileEditorSize.page <= mobileEditorSize.viewport,
      `the solution-set editor fits a 390px viewport: ${JSON.stringify(mobileEditorSize)}`);
    await solutionEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-solution-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.getByText(`Sort numbers ${suffix} by parity.`, { exact: true }).waitFor();
    await page.locator('.nav-button--next').click();
    await page.getByText(solutionStem, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-solution-${stamp}.png` });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, `the question preview fits a 390px viewport: ${JSON.stringify(mobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-solution-mobile-${stamp}.png`, fullPage: true });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/edit`);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();

    const elaSection = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'English Language Arts', exact: true }) });
    await elaSection.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('HOT_TEXT');
    await page.locator('.stem-input').fill(`Select the clickable phrase ${suffix}.`);
    const hotTextEditor = page.locator('.hot-text-editor');
    await hotTextEditor.waitFor();
    const hotTextPassage = `Water ${suffix} freezes at zero degrees.`;
    const selectableText = `${suffix} freezes`;
    await hotTextEditor.locator('.hot-text-editor__textarea').fill(hotTextPassage);
    const selectionStart = hotTextPassage.indexOf(selectableText);
    await hotTextEditor.locator('.hot-text-editor__textarea').evaluate((textarea, { start, end }) => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      textarea.dispatchEvent(new Event('select', { bubbles: true }));
    }, { start: selectionStart, end: selectionStart + selectableText.length });
    await hotTextEditor.getByRole('button', { name: 'Make selected text clickable' }).click();
    await hotTextEditor.locator('.hot-text-editor__segment-card').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();

    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    assert.equal(questions.length, 3);
    const hotTextQuestion = questions.find(question => question.questionTypeCode === 'HOT_TEXT');
    assert.ok(hotTextQuestion, 'the hot-text question is stored in the paper structure');
    assert.equal(hotTextQuestion.render.questionConfig.contentParts.find(part => part.type === 'segment').text, selectableText);
    assert.equal(hotTextQuestion.answerKey.selectedSegmentIds.length, 1);

    await page.reload();
    const hotTextHeading = page.getByRole('heading', { name: /Question \d+ · Hot Text/ });
    await hotTextHeading.waitFor();
    const hotTextQuestionNumber = Number((await hotTextHeading.innerText()).match(/Question (\d+)/)[1]);
    await hotTextEditor.locator('.hot-text-editor__textarea').waitFor();
    assert.equal(await hotTextEditor.locator('.hot-text-editor__textarea').inputValue(), hotTextPassage,
      'hot-text passage is restored after reloading the editor');
    assert.equal(await hotTextEditor.locator('.hot-text-editor__segment-card').count(), 1,
      'hot-text clickable segment is restored after reloading the editor');
    assert.equal(await hotTextEditor.locator('.hot-text-editor__correct-control input').isChecked(), true,
      'hot-text correct segment is restored after reloading the editor');
    await hotTextEditor.scrollIntoViewIfNeeded();
    await hotTextEditor.screenshot({ path: `/tmp/shsat-question-type-editor-hot-text-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const hotTextMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(hotTextMobileSize.page <= hotTextMobileSize.viewport, `the hot-text editor fits a 390px viewport: ${JSON.stringify(hotTextMobileSize)}`);
    await hotTextEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-hot-text-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${hotTextQuestionNumber}`);
    await page.reload();
    await page.locator('.hot-text-answer').waitFor();
    await page.locator('.hot-text-answer__segment').getByText(selectableText, { exact: true }).waitFor();
    await page.getByText(selectableText, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-hot-text-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const hotTextPreviewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(hotTextPreviewMobileSize.page <= hotTextPreviewMobileSize.viewport, `the hot-text preview fits a 390px viewport: ${JSON.stringify(hotTextPreviewMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-hot-text-mobile-${stamp}.png` });
    await page.goto(editorUrl);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/edit`);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();

    const mathGroup = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'Mathematics', exact: true }) });
    await mathGroup.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('INLINE_CHOICE');
    await page.locator('.stem-input').fill(`Choose one result ${suffix}.`);
    const inlineEditor = page.locator('.inline-choice-editor');
    await inlineEditor.waitFor();
    const inlineParagraph = `Choose the correct result ${suffix}.`;
    const paragraphPart = inlineEditor.locator('.inline-choice-editor__text-part').first();
    await paragraphPart.fill(inlineParagraph);
    await paragraphPart.click();
    await page.keyboard.press('End');
    await inlineEditor.getByRole('button', { name: 'Add Dropdown', exact: true }).click();
    assert.equal(await inlineEditor.locator('.inline-choice-editor__blank-card').count(), 2,
      'Add Dropdown inserts a new configurable dropdown');
    await inlineEditor.locator('.inline-choice-editor__blank-card').last().getByRole('button', { name: 'Remove dropdown' }).click();
    assert.equal(await inlineEditor.locator('.inline-choice-editor__blank-card').count(), 1,
      'Remove dropdown removes the additional dropdown');
    const blankCard = inlineEditor.locator('.inline-choice-editor__blank-card').first();
    await blankCard.locator('input').nth(0).fill(`Result ${suffix}`);
    await blankCard.locator('.inline-choice-editor__option-main input.form-input').nth(0).fill(`${suffix} + 1`);
    await blankCard.locator('.inline-choice-editor__option-main input.form-input').nth(1).fill(`${suffix} + 2`);
    await blankCard.locator('.inline-choice-editor__option-main input[type="radio"]').nth(1).check();
    await blankCard.getByRole('button', { name: 'Add Option', exact: true }).click();
    assert.equal(await blankCard.locator('.inline-choice-editor__option-card').count(), 3,
      'Add Option creates an additional dropdown answer choice');
    await blankCard.locator('.inline-choice-editor__option-card').last().getByRole('button', { name: 'Delete option' }).click();
    assert.equal(await blankCard.locator('.inline-choice-editor__option-card').count(), 2,
      'Delete option removes the extra dropdown answer choice');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.locator('.notice').waitFor();
    const saveNotice = await page.locator('.notice').innerText();
    assert.ok(saveNotice.includes('All changes saved.'), `inline-choice save failed: ${saveNotice}`);

    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    assert.equal(questions.length, 4);
    const inlineQuestion = questions.find(question => question.questionTypeCode === 'INLINE_CHOICE');
    assert.ok(inlineQuestion, 'the inline-choice question is stored in the paper structure');
    assert.equal(inlineQuestion.render.questionConfig.blanks.length, 1);
    assert.deepEqual(inlineQuestion.render.questionConfig.blanks[0].options.map(option => option.text), [`${suffix} + 1`, `${suffix} + 2`]);
    assert.equal(inlineQuestion.answerKey.answers.blank1, 'B');

    await page.reload();
    const inlineHeading = page.getByRole('heading', { name: /Question \d+ · Inline Choice/ });
    await inlineHeading.waitFor();
    const inlineQuestionNumber = Number((await inlineHeading.innerText()).match(/Question (\d+)/)[1]);
    await inlineEditor.locator('.inline-choice-editor__blank-card').waitFor();
    assert.equal(await inlineEditor.locator('.inline-choice-editor__text-part').evaluateAll(parts => parts.map(part => part.textContent).join('')), inlineParagraph,
      'inline-choice paragraph text is restored after reloading the editor');
    assert.deepEqual(await inlineEditor.locator('.inline-choice-editor__option-main input.form-input').evaluateAll(inputs => inputs.map(input => input.value)), [`${suffix} + 1`, `${suffix} + 2`],
      'inline-choice options are restored after reloading the editor');
    assert.equal(await inlineEditor.locator('.inline-choice-editor__option-main input[type="radio"]').nth(1).isChecked(), true,
      'inline-choice correct answer is restored after reloading the editor');
    await inlineEditor.scrollIntoViewIfNeeded();
    await inlineEditor.screenshot({ path: `/tmp/shsat-question-type-editor-inline-choice-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const inlineEditorMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(inlineEditorMobileSize.page <= inlineEditorMobileSize.viewport, `the inline-choice editor fits a 390px viewport: ${JSON.stringify(inlineEditorMobileSize)}`);
    await inlineEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-inline-choice-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${inlineQuestionNumber}`);
    await page.reload();
    const inlinePreview = page.locator('.inline-choice-answer');
    await inlinePreview.waitFor();
    await inlinePreview.locator('.rich-select__trigger').click();
    assert.deepEqual(await inlinePreview.getByRole('option').evaluateAll(options => options.map(option => option.innerText.trim())), [`${suffix} + 1`, `${suffix} + 2`],
      'inline-choice options are rendered in the paper preview');
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-inline-choice-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const inlinePreviewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(inlinePreviewMobileSize.page <= inlinePreviewMobileSize.viewport, `the inline-choice preview fits a 390px viewport: ${JSON.stringify(inlinePreviewMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-inline-choice-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(editorUrl);
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/edit`);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const mathQuestionSection = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'Mathematics', exact: true }) });
    await mathQuestionSection.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('HOT_SPOT');
    await page.locator('.stem-input').fill(`Select the highlighted area ${suffix}.`);
    const hotSpotEditor = page.locator('.hot-spot-editor');
    await hotSpotEditor.waitFor();
    const imageUpload = hotSpotEditor.locator('input[type="file"]');
    const hotSpotImageData = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      context.fillStyle = '#eef4ff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#1e293b';
      context.font = '18px sans-serif';
      context.fillText('Test hotspot image', 16, 34);
      context.fillStyle = '#3275f6';
      context.fillRect(96, 88, 72, 72);
      return canvas.toDataURL('image/png');
    });
    const uploadResponse = page.waitForResponse(response => response.url().includes(`/api/admin/papers/${paperId}/question-images`)
      && response.request().method() === 'POST');
    await imageUpload.setInputFiles({
      name: `hot-spot-fixture-${suffix}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(hotSpotImageData.split(',')[1], 'base64'),
    });
    const imageResponse = await uploadResponse;
    assert.equal(imageResponse.status(), 200, 'Hot Spot image upload succeeds for the draft paper');
    uploadedImageUrl = (await imageResponse.json()).assetUrl;
    await hotSpotEditor.locator('.hot-spot-editor__image-plane img').waitFor({ state: 'visible' });
    assert.equal(await hotSpotEditor.locator('.hot-spot-editor__image-plane img').getAttribute('alt'), 'Hot spot editor visual');
    await page.waitForFunction(() => {
      const image = document.querySelector('.hot-spot-editor__image-plane img');
      return image?.complete && image.naturalWidth === 320;
    }, null, { timeout: 5000 });

    const regionRows = hotSpotEditor.locator('.hot-spot-editor__region-row');
    assert.equal(await regionRows.count(), 1, 'a new Hot Spot question starts with one editable region');
    await regionRows.first().locator('input.form-input').first().fill(`Target ${suffix}`);
    await regionRows.first().locator('.hot-spot-editor__coords label').nth(0).locator('input').fill('32');
    await regionRows.first().locator('.hot-spot-editor__coords label').nth(1).locator('input').fill('38');
    await regionRows.first().getByRole('checkbox').check();
    await hotSpotEditor.getByRole('button', { name: 'Add Region', exact: true }).click();
    assert.equal(await regionRows.count(), 2, 'Add Region creates another clickable target');
    await regionRows.nth(1).locator('input.form-input').first().fill(`Distractor ${suffix}`);
    await regionRows.nth(1).getByRole('button', { name: 'Remove region' }).click();
    assert.equal(await regionRows.count(), 1, 'Remove region removes the extra target');
    assert.equal(await regionRows.first().getByRole('checkbox').isChecked(), true, 'the correct-region setting remains selected');

    await hotSpotEditor.scrollIntoViewIfNeeded();
    await hotSpotEditor.screenshot({ path: `/tmp/shsat-question-type-editor-hot-spot-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const hotSpotEditorMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(hotSpotEditorMobileSize.page <= hotSpotEditorMobileSize.viewport,
      `the Hot Spot editor fits a 390px viewport: ${JSON.stringify(hotSpotEditorMobileSize)}`);
    await hotSpotEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-hot-spot-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    assert.equal(questions.length, 5);
    const hotSpotQuestion = questions.find(question => question.questionTypeCode === 'HOT_SPOT');
    assert.ok(hotSpotQuestion, 'the Hot Spot question is stored in the paper structure');
    assert.equal(hotSpotQuestion.stem, `Select the highlighted area ${suffix}.`);
    assert.match(hotSpotQuestion.render.questionConfig.imageUrl, new RegExp(`/uploads/paper-materials/${paperId}-`));
    assert.deepEqual(hotSpotQuestion.render.questionConfig.regions.map(({ id, label, x, y }) => ({ id, label, x, y })), [
      { id: 'region1', label: `Target ${suffix}`, x: 0.32, y: 0.38 },
    ]);
    assert.deepEqual(hotSpotQuestion.answerKey.selectedRegionIds, ['region1']);

    await page.reload();
    await page.getByRole('heading', { name: /Question \d+ · Hot Spot/ }).waitFor();
    assert.equal(await page.locator('.stem-input').inputValue(), `Select the highlighted area ${suffix}.`,
      'the Hot Spot prompt is restored after reloading the editor');
    assert.equal(await hotSpotEditor.locator('.hot-spot-editor__region-row input.form-input').first().inputValue(), `Target ${suffix}`,
      'the Hot Spot region label is restored after reloading the editor');
    assert.equal(await hotSpotEditor.locator('.hot-spot-editor__region-row .hot-spot-editor__coords label').first().locator('input').inputValue(), '32',
      'the Hot Spot region coordinates are restored after reloading the editor');
    assert.equal(await hotSpotEditor.locator('.hot-spot-editor__region-row .hot-spot-editor__coords label').nth(1).locator('input').inputValue(), '38');
    assert.equal(await hotSpotEditor.locator('.hot-spot-editor__region-row input[type="checkbox"]').isChecked(), true,
      'the Hot Spot answer key is restored after reloading the editor');
    await hotSpotEditor.scrollIntoViewIfNeeded();
    await hotSpotEditor.screenshot({ path: `/tmp/shsat-question-type-editor-hot-spot-reloaded-${stamp}.png` });

    const hotSpotHeading = page.getByRole('heading', { name: /Question \d+ · Hot Spot/ });
    const hotSpotQuestionNumber = Number((await hotSpotHeading.innerText()).match(/Question (\d+)/)[1]);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${hotSpotQuestionNumber}`);
    await page.reload();
    await page.locator('.hot-spot-answer').waitFor();
    await page.locator('.hot-spot-answer__stage img').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: `Target ${suffix}`, exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-hot-spot-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const hotSpotPreviewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(hotSpotPreviewMobileSize.page <= hotSpotPreviewMobileSize.viewport,
      `the Hot Spot preview fits a 390px viewport: ${JSON.stringify(hotSpotPreviewMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-hot-spot-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(editorUrl);
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/edit`);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();

    const elaQuestionSection = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'English Language Arts', exact: true }) });
    await elaQuestionSection.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('EQUATION_EDITOR');
    const equationStem = `Write an expression for ${suffix} plus two.`;
    await page.locator('.stem-input').fill(equationStem);
    const equationEditor = page.locator('.equation-editor');
    await equationEditor.waitFor();
    await equationEditor.locator('.equation-editor__setup-grid select').selectOption('expression');
    await equationEditor.locator('.equation-editor__setup-grid input').fill('x, y');
    await equationEditor.locator('input[placeholder="Enter only the equation."]').fill('Enter an expression.');
    await equationEditor.getByRole('button', { name: 'Add Answer', exact: true }).click();
    assert.equal(await equationEditor.locator('.equation-editor__answer-row').count(), 2, 'Add Answer adds an accepted answer');
    await equationEditor.locator('.equation-editor__answer-row').last().getByRole('button', { name: 'Remove answer' }).click();
    const acceptedAnswerField = equationEditor.locator('.equation-editor__answer-row math-field').first();
    await acceptedAnswerField.evaluate(element => {
      element.value = 'x+2';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await equationEditor.locator('.equation-editor__tool-card input').first().uncheck();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    const equationQuestion = questions.find(question => question.questionTypeCode === 'EQUATION_EDITOR');
    assert.ok(equationQuestion, 'the equation-editor question is stored in the paper structure');
    assert.equal(equationQuestion.stem, equationStem);
    assert.equal(equationQuestion.render.questionConfig.editorMode, 'expression');
    assert.deepEqual(equationQuestion.render.questionConfig.variables, ['x', 'y']);
    assert.equal(equationQuestion.render.questionConfig.placeholder, 'Enter an expression.');
    assert.equal(equationQuestion.answerKey.acceptedAnswers[0].value, 'x+2');
    assert.equal(equationQuestion.render.questionConfig.enabledTools.includes('basic'), false);

    await page.reload();
    await page.getByRole('heading', { name: /Question \d+ · Equation Editor/ }).waitFor();
    assert.equal(await equationEditor.locator('.equation-editor__setup-grid select').inputValue(), 'expression');
    assert.equal(await equationEditor.locator('.equation-editor__setup-grid input').inputValue(), 'x, y');
    assert.equal(await equationEditor.locator('.equation-editor__answer-row math-field').first().evaluate(element => element.value), 'x+2');
    await equationEditor.scrollIntoViewIfNeeded();
    await equationEditor.screenshot({ path: `/tmp/shsat-question-type-editor-equation-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const equationEditorMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(equationEditorMobileSize.page <= equationEditorMobileSize.viewport,
      `the equation-editor editor fits a 390px viewport: ${JSON.stringify(equationEditorMobileSize)}`);
    await equationEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-equation-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    const equationHeading = page.getByRole('heading', { name: /Question \d+ · Equation Editor/ });
    const equationQuestionNumber = Number((await equationHeading.innerText()).match(/Question (\d+)/)[1]);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${equationQuestionNumber}`);
    await page.reload();
    await page.locator('.equation-answer').waitFor();
    await page.getByText(equationStem, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-equation-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const equationPreviewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(equationPreviewMobileSize.page <= equationPreviewMobileSize.viewport,
      `the equation-editor preview fits a 390px viewport: ${JSON.stringify(equationPreviewMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-equation-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const mathQuestionSectionForGraph = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'Mathematics', exact: true }) });
    await mathQuestionSectionForGraph.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('GRAPH_QUESTION');
    const graphStem = `Select the point ${suffix}.`;
    await page.locator('.stem-input').fill(graphStem);
    const graphEditor = page.locator('.graph-select-editor');
    await graphEditor.waitFor();
    await graphEditor.locator('.graph-select-editor__settings-card--labels input').first().fill(`Coordinate Plane ${suffix}`);
    await graphEditor.getByRole('button', { name: 'Add Candidate Point', exact: true }).click();
    const graphPoints = graphEditor.locator('.graph-select-editor__point-row');
    assert.equal(await graphPoints.count(), 1, 'Add Candidate Point creates a coordinate');
    await graphPoints.first().locator('input').nth(0).fill(`Target ${suffix}`);
    await graphPoints.first().locator('input').nth(1).fill('2');
    await graphPoints.first().locator('input').nth(2).fill('3');
    await graphEditor.getByRole('button', { name: 'Add Candidate Point', exact: true }).click();
    assert.equal(await graphPoints.count(), 2);
    await graphPoints.last().getByRole('button', { name: 'Remove candidate point' }).click();
    assert.equal(await graphPoints.count(), 1, 'Remove candidate point removes the extra point');
    await graphEditor.locator('.graph-select-editor__answer-option input').first().check();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    const graphQuestion = questions.find(question => question.questionTypeCode === 'GRAPH_QUESTION');
    assert.ok(graphQuestion, 'the graph question is stored in the paper structure');
    assert.equal(graphQuestion.stem, graphStem);
    assert.equal(graphQuestion.render.questionConfig.graph.title, `Coordinate Plane ${suffix}`);
    assert.deepEqual(graphQuestion.render.questionConfig.points.map(point => [point.label, point.x, point.y]), [[`Target ${suffix}`, 2, 3]]);
    assert.deepEqual(graphQuestion.answerKey.selectedPointIds, ['p1']);

    await page.reload();
    await page.getByRole('heading', { name: /Question \d+ · Point Graph/ }).waitFor();
    assert.equal(await graphEditor.locator('.graph-select-editor__settings-card--labels input').first().inputValue(), `Coordinate Plane ${suffix}`);
    assert.deepEqual(await graphPoints.first().locator('input').evaluateAll(inputs => inputs.map(input => input.value)), [`Target ${suffix}`, '2', '3']);
    assert.equal(await graphEditor.locator('.graph-select-editor__answer-option input').first().isChecked(), true);
    await graphEditor.scrollIntoViewIfNeeded();
    await graphEditor.screenshot({ path: `/tmp/shsat-question-type-editor-graph-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const graphEditorMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(graphEditorMobileSize.page <= graphEditorMobileSize.viewport,
      `the graph-question editor fits a 390px viewport: ${JSON.stringify(graphEditorMobileSize)}`);
    await graphEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-graph-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    const graphHeading = page.getByRole('heading', { name: /Question \d+ · Point Graph/ });
    const graphQuestionNumber = Number((await graphHeading.innerText()).match(/Question (\d+)/)[1]);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${graphQuestionNumber}`);
    await page.reload();
    await page.locator('.graph-select-answer').waitFor();
    await page.getByText(graphStem, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-graph-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const graphPreviewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(graphPreviewMobileSize.page <= graphPreviewMobileSize.viewport,
      `the graph-question preview fits a 390px viewport: ${JSON.stringify(graphPreviewMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-graph-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const mathQuestionSectionForTable = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'Mathematics', exact: true }) });
    await mathQuestionSectionForTable.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('TABLE_GRID');
    const tableStem = `Complete the table for ${suffix}.`;
    await page.locator('.stem-input').fill(tableStem);
    const tableEditor = page.locator('.table-grid-editor');
    await tableEditor.waitFor();
    await tableEditor.locator('.table-grid-item-row input').nth(0).fill(`Choice A ${suffix}`);
    await tableEditor.locator('.table-grid-item-row input').nth(1).fill(`Prompt A ${suffix}`);
    await tableEditor.getByRole('button', { name: 'Add another column', exact: true }).click();
    assert.equal(await tableEditor.locator('.table-grid-setup-grid section').first().locator('.table-grid-item-row').count(), 2);
    await tableEditor.locator('.table-grid-setup-grid section').first().locator('.table-grid-item-row').last().locator('input').fill(`Choice B ${suffix}`);
    await tableEditor.getByRole('button', { name: 'Add another column', exact: true }).click();
    const tableColumnRows = tableEditor.locator('.table-grid-setup-grid section').first().locator('.table-grid-item-row');
    assert.equal(await tableColumnRows.count(), 3);
    await tableColumnRows.last().locator('input').fill(`Choice C ${suffix}`);
    await tableEditor.getByRole('button', { name: 'Add another row', exact: true }).click();
    const tableSections = tableEditor.locator('.table-grid-setup-grid section');
    assert.equal(await tableSections.nth(1).locator('.table-grid-item-row').count(), 2);
    await tableSections.nth(1).locator('.table-grid-item-row').last().locator('input').fill(`Prompt B ${suffix}`);
    await tableEditor.locator('.table-grid-mode-card input[value="multi"]').check();
    await tableEditor.getByRole('button', { name: 'Add another row', exact: true }).click();
    await tableSections.nth(1).locator('.table-grid-item-row').last().getByRole('button', { name: 'Remove row' }).click();
    assert.equal(await tableSections.nth(1).locator('.table-grid-item-row').count(), 2);
    const tableCorrectCells = tableEditor.locator('.table-grid-matrix input[type="checkbox"]');
    await tableCorrectCells.nth(1).check({ force: true });
    await tableCorrectCells.nth(3).check({ force: true });
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    const tableQuestion = questions.find(question => question.questionTypeCode === 'TABLE_GRID');
    assert.ok(tableQuestion, 'the table-grid question is stored in the paper structure');
    assert.equal(tableQuestion.stem, tableStem);
    assert.deepEqual(tableQuestion.render.questionConfig.columns.map(column => column.label), [`Choice A ${suffix}`, `Choice B ${suffix}`, `Choice C ${suffix}`]);
    assert.deepEqual(tableQuestion.render.questionConfig.rows.map(row => row.label), [`Prompt A ${suffix}`, `Prompt B ${suffix}`]);
    assert.equal(tableQuestion.render.questionConfig.selectionMode, 'multi');
    assert.deepEqual(tableQuestion.answerKey.answers, { row1: ['col1', 'col2'], row2: ['col1'] });

    await page.reload();
    await page.getByRole('heading', { name: /Question \d+ · Table Grid/ }).waitFor();
    assert.deepEqual(await tableEditor.locator('.table-grid-setup-grid section').nth(0).locator('.table-grid-item-row input').evaluateAll(inputs => inputs.map(input => input.value)), [`Choice A ${suffix}`, `Choice B ${suffix}`, `Choice C ${suffix}`]);
    assert.deepEqual(await tableEditor.locator('.table-grid-setup-grid section').nth(1).locator('.table-grid-item-row input').evaluateAll(inputs => inputs.map(input => input.value)), [`Prompt A ${suffix}`, `Prompt B ${suffix}`]);
    assert.equal(await tableEditor.locator('.table-grid-mode-card input[value="multi"]').isChecked(), true);
    assert.equal(await tableEditor.locator('.table-grid-matrix input[type="checkbox"]:checked').count(), 3);
    await tableEditor.scrollIntoViewIfNeeded();
    await tableEditor.screenshot({ path: `/tmp/shsat-question-type-editor-table-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const tableEditorMobileSize = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
      matrixWidth: document.querySelector('.table-grid-matrix')?.clientWidth,
      matrixContentWidth: document.querySelector('.table-grid-matrix')?.scrollWidth,
    }));
    assert.ok(tableEditorMobileSize.page <= tableEditorMobileSize.viewport,
      `the table-grid editor fits a 390px viewport: ${JSON.stringify(tableEditorMobileSize)}`);
    await tableEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await tableEditor.screenshot({ path: `/tmp/shsat-question-type-editor-table-mobile-${stamp}.png` });
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-table-mobile-viewport-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    const tableHeading = page.getByRole('heading', { name: /Question \d+ · Table Grid/ });
    const tableQuestionNumber = Number((await tableHeading.innerText()).match(/Question (\d+)/)[1]);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${tableQuestionNumber}`);
    await page.reload();
    await page.locator('.table-grid-answer').waitFor();
    await page.getByText(tableStem, { exact: true }).waitFor();
    assert.deepEqual(await page.locator('.table-grid-answer thead th').evaluateAll(headers => headers.map(header => header.innerText.trim())), [
      'Item', `Choice A ${suffix}`, `Choice B ${suffix}`, `Choice C ${suffix}`,
    ]);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-table-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const tablePreviewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(tablePreviewMobileSize.page <= tablePreviewMobileSize.viewport,
      `the table-grid preview fits a 390px viewport: ${JSON.stringify(tablePreviewMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-table-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const multiSelectStem = `Choose every odd number ${suffix}.`;
    await elaSection.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('MULTI_SELECT');
    await page.locator('.stem-input').fill(multiSelectStem);
    const multiSelectEditor = page.locator('.choice-editor');
    await multiSelectEditor.waitFor();
    const multiSelectOptions = multiSelectEditor.locator('.choice-editor__option-row');
    assert.equal(await multiSelectOptions.count(), 2, 'multi-select starts with two configurable choices');
    await multiSelectEditor.getByRole('button', { name: 'Add Option', exact: true }).click();
    assert.equal(await multiSelectOptions.count(), 3, 'multi-select can add a choice');
    await multiSelectOptions.last().getByRole('button', { name: 'Remove option', exact: true }).click();
    await multiSelectOptions.nth(0).locator('input[type="checkbox"]').check();
    await multiSelectOptions.nth(1).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    const multiSelectQuestion = questions.find(question => question.stem === multiSelectStem);
    assert.ok(multiSelectQuestion, 'the multi-select question is persisted');
    assert.equal(multiSelectQuestion.questionTypeCode, 'MULTI_SELECT');
    assert.deepEqual(multiSelectQuestion.answerKey.answers, ['A', 'B']);

    await page.reload();
    await page.locator('.question-item').filter({ hasText: multiSelectStem }).click();
    assert.equal(await page.locator('.choice-editor__option-row input[type="checkbox"]:checked').count(), 2,
      'multi-select correct choices are restored after reloading');
    await multiSelectEditor.scrollIntoViewIfNeeded();
    await multiSelectEditor.screenshot({ path: `/tmp/shsat-question-type-editor-multi-select-${stamp}.png` });

    const multiSelectQuestionNumber = Number(multiSelectQuestion.displayNumber);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${multiSelectQuestionNumber}`);
    await page.getByText(multiSelectStem, { exact: true }).waitFor();
    assert.equal(await page.locator('.choice-answer__option').count(), 2,
      'multi-select preview renders each saved option');
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-multi-select-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const multiSelectPreviewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(multiSelectPreviewMobileSize.page <= multiSelectPreviewMobileSize.viewport,
      `the multi-select preview fits a 390px viewport: ${JSON.stringify(multiSelectPreviewMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-multi-select-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();

    const fixedMultiSelectStem = `Choose two factors of ten ${suffix}.`;
    await elaSection.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('MULTI_SELECT_FIXED');
    await page.locator('.stem-input').fill(fixedMultiSelectStem);
    const fixedMultiSelectEditor = page.locator('.choice-editor');
    await fixedMultiSelectEditor.locator('.choice-editor__option-row').nth(1).locator('input[type="checkbox"]').check();
    await fixedMultiSelectEditor.locator('.choice-editor__option-row').nth(0).locator('input[type="checkbox"]').check();
    await fixedMultiSelectEditor.locator('.choice-editor__limit').getByText('exactly 2', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    const fixedMultiSelectQuestion = questions.find(question => question.stem === fixedMultiSelectStem);
    assert.ok(fixedMultiSelectQuestion, 'the fixed multi-select question is persisted');
    assert.equal(fixedMultiSelectQuestion.questionTypeCode, 'MULTI_SELECT_FIXED');
    assert.deepEqual([...fixedMultiSelectQuestion.answerKey.answers].sort(), ['A', 'B'],
      'fixed multi-select persists the selected correct-answer set');

    await page.reload();
    await page.locator('.question-item').filter({ hasText: fixedMultiSelectStem }).click();
    assert.match(await fixedMultiSelectEditor.locator('.choice-editor__limit').innerText(), /exactly 2 answers/,
      'the fixed selection limit is restored after reloading');
    await fixedMultiSelectEditor.scrollIntoViewIfNeeded();
    await fixedMultiSelectEditor.screenshot({ path: `/tmp/shsat-question-type-editor-multi-select-fixed-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const fixedMultiSelectMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(fixedMultiSelectMobileSize.page <= fixedMultiSelectMobileSize.viewport,
      `the fixed multi-select editor fits a 390px viewport: ${JSON.stringify(fixedMultiSelectMobileSize)}`);
    await fixedMultiSelectEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-multi-select-fixed-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });

    const fillBlankStem = `Enter four in words or digits ${suffix}.`;
    await elaSection.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('FILL_IN_BLANK');
    await page.locator('.stem-input').fill(fillBlankStem);
    const fillBlankEditor = page.locator('.fill-blank-answer-editor');
    const acceptedAnswerRows = fillBlankEditor.locator('.fill-blank-answer-editor__row');
    await acceptedAnswerRows.first().locator('input').fill('4');
    await fillBlankEditor.getByRole('button', { name: 'Add Answer', exact: true }).click();
    assert.equal(await acceptedAnswerRows.count(), 2, 'Add Answer adds another accepted response');
    await acceptedAnswerRows.nth(1).locator('input').fill('four');
    await fillBlankEditor.getByRole('button', { name: 'Add Answer', exact: true }).click();
    await acceptedAnswerRows.nth(2).locator('input').fill('4');
    await acceptedAnswerRows.nth(2).getByText('Duplicate answers must be removed before saving.', { exact: true }).waitFor();
    await acceptedAnswerRows.nth(2).getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal(await acceptedAnswerRows.count(), 2, 'Remove deletes the duplicate answer row');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    const fillBlankQuestion = questions.find(question => question.stem === fillBlankStem);
    assert.ok(fillBlankQuestion, 'the fill-in-the-blank question is persisted');
    assert.deepEqual(fillBlankQuestion.answerKey.answers, ['4', 'four'],
      'all accepted responses are saved without the removed duplicate');

    await page.reload();
    await page.locator('.question-item').filter({ hasText: fillBlankStem }).click();
    assert.deepEqual(await acceptedAnswerRows.locator('input').evaluateAll(inputs => inputs.map(input => input.value)), ['4', 'four'],
      'accepted responses are restored after reloading the editor');
    await fillBlankEditor.screenshot({ path: `/tmp/shsat-question-type-editor-fill-blank-${stamp}.png` });
    const fillBlankQuestionNumber = Number(fillBlankQuestion.displayNumber);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${fillBlankQuestionNumber}`);
    await page.locator('.fill-blank-input').waitFor();
    await page.getByText(fillBlankStem, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-fill-blank-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(editorUrl);
    await page.locator('.question-item').filter({ hasText: fillBlankStem }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const choiceEditorMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(choiceEditorMobileSize.page <= choiceEditorMobileSize.viewport,
      `question type editors fit a 390px viewport: ${JSON.stringify(choiceEditorMobileSize)}`);
    const acceptedAnswerInputWidth = await acceptedAnswerRows.first().locator('input').evaluate(input => input.getBoundingClientRect().width);
    assert.ok(acceptedAnswerInputWidth >= 150,
      `accepted-answer inputs remain wide enough to review on mobile: ${acceptedAnswerInputWidth}px`);
    assert.equal(await page.locator('.question-navigation .delete-question-button').evaluate(button => getComputedStyle(button).whiteSpace), 'nowrap',
      'the mobile Delete Question action stays on one line');
    await fillBlankEditor.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `/tmp/shsat-question-type-editor-fill-blank-mobile-${stamp}.png` });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await elaSection.getByRole('button', { name: 'Add Question', exact: true }).click();
    await page.locator('.meta-field--type select').selectOption('MULTIPLE_CHOICE');
    const multipleChoiceStem = `Choose the even number ${suffix}.`;
    await page.locator('.stem-input').fill(multipleChoiceStem);
    const multipleChoiceEditor = page.locator('.choice-editor');
    await multipleChoiceEditor.waitFor();
    const multipleChoiceOptions = multipleChoiceEditor.locator('.choice-editor__option-row');
    assert.ok(await multipleChoiceOptions.count() >= 2, 'multiple-choice starts with at least two options');
    await multipleChoiceOptions.nth(0).locator('.choice-editor__option-key').fill('A');
    await multipleChoiceOptions.nth(0).locator('input.form-input').fill('2');
    await multipleChoiceOptions.nth(1).locator('.choice-editor__option-key').fill('B');
    await multipleChoiceOptions.nth(1).locator('input.form-input').fill('3');
    await multipleChoiceOptions.nth(0).locator('input[type="radio"]').check();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    questions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    const multipleChoiceQuestion = questions.find(question => question.stem === multipleChoiceStem);
    assert.ok(multipleChoiceQuestion, 'the multiple-choice question is persisted');
    assert.equal(multipleChoiceQuestion.questionTypeCode, 'MULTIPLE_CHOICE');
    assert.deepEqual(multipleChoiceQuestion.render.options.map(option => option.text), ['2', '3']);
    assert.deepEqual(multipleChoiceQuestion.answerKey.answers, ['A']);

    await page.reload();
    await page.locator('.question-item').filter({ hasText: multipleChoiceStem }).click();
    assert.deepEqual(await multipleChoiceOptions.evaluateAll(rows => rows.map(row => ({
      key: row.querySelector('.choice-editor__option-key')?.value,
      text: row.querySelector('input.form-input')?.value,
      correct: row.querySelector('input[type="radio"]')?.checked,
    }))), [{ key: 'A', text: '2', correct: true }, { key: 'B', text: '3', correct: false }],
    'multiple-choice options and correct answer are restored after reloading');
    await multipleChoiceEditor.scrollIntoViewIfNeeded();
    await multipleChoiceEditor.screenshot({ path: `/tmp/shsat-question-type-editor-multiple-choice-${stamp}.png` });
    const multipleChoiceQuestionNumber = Number(multipleChoiceQuestion.displayNumber);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/preview?questionNumber=${multipleChoiceQuestionNumber}`);
    await page.getByText(multipleChoiceStem, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-multiple-choice-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const multipleChoicePreviewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(multipleChoicePreviewMobileSize.page <= multipleChoicePreviewMobileSize.viewport,
      `the multiple-choice preview fits a 390px viewport: ${JSON.stringify(multipleChoicePreviewMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-question-type-preview-multiple-choice-mobile-${stamp}.png` });

    assert.deepEqual(pageErrors, [], 'question type editing and preview have no browser errors');
    console.log(JSON.stringify({
      result: 'PASS',
      questionTypes: [...new Set(questions.map(question => question.questionTypeCode))],
      multiSelectPreviewMobileSize,
      mobileEditorSize,
      mobileSize,
      hotTextMobileSize,
      hotTextPreviewMobileSize,
      inlineEditorMobileSize,
      inlinePreviewMobileSize,
      hotSpotEditorMobileSize,
      hotSpotPreviewMobileSize,
      equationEditorMobileSize,
      equationPreviewMobileSize,
      graphEditorMobileSize,
      graphPreviewMobileSize,
      tableEditorMobileSize,
      tablePreviewMobileSize,
      multipleChoicePreviewMobileSize,
      pageErrors: pageErrors.length,
      screenshots: [
        `/tmp/shsat-question-type-editor-drag-${stamp}.png`,
        `/tmp/shsat-question-type-preview-drag-${stamp}.png`,
        `/tmp/shsat-question-type-editor-solution-${stamp}.png`,
        `/tmp/shsat-question-type-editor-solution-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-preview-solution-${stamp}.png`,
        `/tmp/shsat-question-type-preview-solution-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-hot-text-${stamp}.png`,
        `/tmp/shsat-question-type-editor-hot-text-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-preview-hot-text-${stamp}.png`,
        `/tmp/shsat-question-type-preview-hot-text-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-inline-choice-${stamp}.png`,
        `/tmp/shsat-question-type-editor-inline-choice-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-preview-inline-choice-${stamp}.png`,
        `/tmp/shsat-question-type-preview-inline-choice-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-hot-spot-${stamp}.png`,
        `/tmp/shsat-question-type-editor-hot-spot-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-hot-spot-reloaded-${stamp}.png`,
        `/tmp/shsat-question-type-preview-hot-spot-${stamp}.png`,
        `/tmp/shsat-question-type-preview-hot-spot-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-equation-${stamp}.png`,
        `/tmp/shsat-question-type-editor-equation-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-preview-equation-${stamp}.png`,
        `/tmp/shsat-question-type-preview-equation-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-graph-${stamp}.png`,
        `/tmp/shsat-question-type-editor-graph-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-preview-graph-${stamp}.png`,
        `/tmp/shsat-question-type-preview-graph-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-table-${stamp}.png`,
        `/tmp/shsat-question-type-editor-table-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-table-mobile-viewport-${stamp}.png`,
        `/tmp/shsat-question-type-preview-table-${stamp}.png`,
        `/tmp/shsat-question-type-preview-table-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-metadata-${stamp}.png`,
        `/tmp/shsat-question-type-editor-multi-select-${stamp}.png`,
        `/tmp/shsat-question-type-editor-fill-blank-${stamp}.png`,
        `/tmp/shsat-question-type-editor-fill-blank-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-multi-select-fixed-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-preview-fill-blank-${stamp}.png`,
        `/tmp/shsat-question-type-preview-multi-select-${stamp}.png`,
        `/tmp/shsat-question-type-preview-multi-select-mobile-${stamp}.png`,
        `/tmp/shsat-question-type-editor-multi-select-fixed-${stamp}.png`,
        `/tmp/shsat-question-type-editor-multiple-choice-${stamp}.png`,
        `/tmp/shsat-question-type-preview-multiple-choice-${stamp}.png`,
        `/tmp/shsat-question-type-preview-multiple-choice-mobile-${stamp}.png`,
      ],
    }));
  } finally {
    if (paperId) await api(page, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
    if (uploadedImageUrl) {
      await fs.unlink(path.resolve(__dirname, '../../backend/uploads/paper-materials', path.basename(uploadedImageUrl))).catch(() => {});
    }
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
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: result.status, text: await result.text() };
  }, { path, method, body, token });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  }
  return response.text ? JSON.parse(response.text) : null;
}

function readQuestions(paper) {
  const questions = [];
  const visit = sections => {
    for (const section of sections || []) {
      questions.push(...(section.questions || []));
      visit(section.children);
    }
  };
  visit(paper.sections);
  return questions;
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
