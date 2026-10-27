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
  const suffix = String(stamp).slice(-6);
  const paperTitle = `Material Editor ${stamp}`;
  const firstStem = `Read the passage ${suffix}.`;
  const secondStem = `Use the same passage ${suffix}.`;
  let paperId;
  let versionId;

  try {
    await login(page);
    const paper = await api(page, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `MATERIAL_EDITOR_${stamp}`,
      title: paperTitle,
      description: 'Temporary SHSAT material editor regression',
      groupId: null,
      defaultDurationSeconds: 1_200,
    });
    paperId = Number(paper.summary.id);
    const editorUrl = `${baseUrl}/exam-types/SHSAT/admin/papers/${paperId}/edit`;
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: paperTitle, exact: true }).waitFor();

    const ela = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'English Language Arts', exact: true }) });
    await ela.getByRole('button', { name: 'Add Question', exact: true }).first().click();
    await page.locator('.stem-input').fill(firstStem);
    const editor = page.locator('.material-editor');
    await editor.locator('.material-type select').selectOption('text');
    await editor.locator('.material-form-grid input').nth(0).fill(`Shared Passage ${suffix}`);
    await editor.locator('.material-form-grid input').nth(1).fill('Reading Passage');

    const structuredEditor = editor.locator('.structured-material-editor');
    await structuredEditor.locator('textarea').nth(0).fill(`Read the selection carefully. ${suffix}`);
    await structuredEditor.locator('input').nth(0).fill(`A Short Passage ${suffix}`);
    await structuredEditor.locator('input').nth(1).fill(`Author ${suffix}`);
    const body = structuredEditor.locator('textarea').nth(1);
    await body.fill(`The value ${suffix} is **important**.`);
    await editor.getByRole('button', { name: 'Insert Formula', exact: true }).click();
    await editor.getByRole('button', { name: 'Insert Block', exact: true }).click();
    assert.match(await body.inputValue(), /\$x\^2\$/);
    assert.match(await body.inputValue(), /\$\$[\s\S]*x\^2[\s\S]*\$\$/);

    await body.evaluate(textarea => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    await editor.getByRole('button', { name: 'Insert Screenshot', exact: true }).click();
    const pasteZone = page.getByLabel('Paste screenshot here', { exact: true });
    await pasteZone.waitFor();
    await page.screenshot({ path: `/tmp/shsat-material-screenshot-modal-${stamp}.png` });
    await pasteZone.evaluate(zone => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      context.fillStyle = '#eaf1ff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#183b72';
      context.font = '20px sans-serif';
      context.fillText('Shared material image', 20, 68);
      const base64 = canvas.toDataURL('image/png').split(',')[1];
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'material-test.png', { type: 'image/png' }));
      zone.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await page.locator('.material-screenshot-modal').waitFor({ state: 'hidden' });
    await page.getByText('Image inserted into the material body. Save changes to keep it.', { exact: true }).waitFor();
    assert.match(await body.inputValue(), /\[\[MATERIAL_IMAGE:/, 'pasted screenshot is inserted as a material image block');
    const materialPreview = editor.getByLabel('Material content preview');
    assert.equal(await materialPreview.locator('.safe-markdown-text__segment--bold').filter({ hasText: 'important' }).count(), 1,
      'Markdown emphasis is rendered in the material preview');
    const fileImageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff1e8';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#783b18';
      context.font = '20px sans-serif';
      context.fillText('File picker image', 20, 68);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await body.evaluate(textarea => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    await editor.getByRole('button', { name: 'Insert Screenshot', exact: true }).click();
    const filePicker = page.locator('.material-screenshot-modal input[type="file"]');
    await filePicker.setInputFiles({
      name: 'material-body-file.png',
      mimeType: 'image/png',
      buffer: Buffer.from(fileImageBase64, 'base64'),
    });
    await page.locator('.material-screenshot-modal').waitFor({ state: 'hidden' });
    assert.equal((await body.inputValue()).match(/\[\[MATERIAL_IMAGE:/g)?.length, 2,
      'choosing an image file inserts a second material image block');
    const imagePreviews = materialPreview.locator('img');
    assert.equal(await imagePreviews.count(), 2);
    for (const image of await imagePreviews.all()) {
      assert.ok(await image.evaluate(item => item.complete && item.naturalWidth > 0), 'uploaded material images load in the editor preview');
    }
    await materialPreview.locator('button[title="View material image"]').first().click();
    const imageDialog = page.getByRole('dialog', { name: 'Image preview' });
    await imageDialog.waitFor();
    await imageDialog.getByRole('button', { name: 'Zoom In', exact: true }).click();
    await imageDialog.getByRole('button', { name: 'Reset', exact: true }).click();
    await imageDialog.getByRole('button', { name: 'Close image preview', exact: true }).click();

    await savePaperChanges(page, paperId);
    let stored = await api(page, `/api/admin/papers/${paperId}`);
    let questions = readQuestions(stored);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].stem, firstStem);
    assert.equal(questions[0].render.material.title, `Shared Passage ${suffix}`);
    assert.equal(questions[0].render.material.category, 'Reading Passage');
    assert.match(questions[0].render.material.content, /\[\[TEXT_MATERIAL_FORMAT:2\]\]/);
    assert.equal(questions[0].render.material.content.match(/\[\[MATERIAL_IMAGE:/g)?.length, 2);
    assert.match(questions[0].render.material.content, /\$x\^2\$/);

    await page.reload();
    await page.getByRole('heading', { name: /Question \d+ · Multiple Choice/ }).waitFor();
    assert.equal(await editor.locator('.material-type select').inputValue(), 'text');
    assert.equal(await editor.locator('.material-form-grid input').nth(0).inputValue(), `Shared Passage ${suffix}`);
    assert.match(await structuredEditor.locator('textarea').nth(1).inputValue(), /\[\[MATERIAL_IMAGE:/,
      'text fields and screenshot marker are restored after reloading the editor');
    await editor.scrollIntoViewIfNeeded();
    await editor.screenshot({ path: `/tmp/shsat-material-editor-saved-${stamp}.png` });

    await ela.getByRole('button', { name: 'Add Question', exact: true }).first().click();
    await page.locator('.stem-input').fill(secondStem);
    const secondEditor = page.locator('.material-editor');
    await secondEditor.locator('.material-type select').selectOption('text');
    const materialSelect = secondEditor.locator('.material-topline select');
    const sharedMaterialOption = await materialSelect.locator('option').evaluateAll((options, title) => (
      options.find(option => option.textContent.includes(title))?.value || ''
    ), `Shared Passage ${suffix}`);
    assert.ok(sharedMaterialOption, 'a newly saved material is available for reuse');
    await materialSelect.selectOption(sharedMaterialOption);
    assert.match(await secondEditor.locator('.material-usage-note').innerText(), /editing it here updates Q1, Q2/,
      'the editor explains the impact of editing a shared material');

    const secondFields = secondEditor.locator('.structured-material-editor');
    const imageMarkers = (await secondFields.locator('textarea').nth(1).inputValue()).match(/\[\[MATERIAL_IMAGE:[^\]]+\]\]/g) || [];
    assert.equal(imageMarkers.length, 2, 'the shared text retains both uploaded screenshot markers');
    await secondEditor.locator('.material-form-grid input').nth(0).fill(`Shared Passage Edited ${suffix}`);
    await secondFields.locator('textarea').nth(1).fill(`Shared content updated ${suffix}.\n${imageMarkers.join('\n')}`);
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.equal(questions.length, 2);
    assert.equal(questions[0].render.material.title, `Shared Passage Edited ${suffix}`,
      'editing the shared material through the second question updates the first question too');
    assert.equal(questions[1].render.material.title, `Shared Passage Edited ${suffix}`);
    assert.equal(questions[0].render.material.content, questions[1].render.material.content,
      'both linked questions reference identical material content');

    const passageSet = page.locator('.passage-set').filter({ hasText: `Shared Passage Edited ${suffix}` });
    assert.equal(await passageSet.count(), 1, 'adjacent questions that share a passage appear as one passage set');
    assert.match(await passageSet.locator('.passage-set__header small').innerText(), /Q1-Q2 · 2 questions/,
      'the passage set reports its question range and size');
    await passageSet.getByRole('button', { name: 'Add Question', exact: true }).click();
    const groupedQuestionStem = `Additional passage question ${suffix}.`;
    await page.locator('.stem-input').fill(groupedQuestionStem);
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.equal(questions.length, 3, 'Add Question in a passage set inserts exactly one question');
    assert.deepEqual(questions.map(question => question.stem), [firstStem, secondStem, groupedQuestionStem],
      'the new question is inserted after the existing passage questions');
    assert.ok(questions.every(question => question.render.material.title === `Shared Passage Edited ${suffix}`),
      'the inserted question retains the same passage content');
    assert.deepEqual(questions.map(question => question.displayNumber), [1, 2, 3],
      'passage question numbering remains contiguous after insertion');
    assert.deepEqual((await page.locator('.passage-set .question-item--nested').allInnerTexts())
      .map(text => Number(text.match(/\bQ(\d+)\b/)?.[1])), [1, 2, 3],
    'the editor preserves paper-wide question order after reloading grouped subtype data');
    const updatedPassageSet = page.locator('.passage-set').filter({ hasText: `Shared Passage Edited ${suffix}` });
    assert.match(await updatedPassageSet
      .locator('.passage-set__header small').innerText(), /Q1-Q3 · 3 questions/,
    'the passage set range updates after adding a grouped question');
    await updatedPassageSet.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/shsat-material-passage-set-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `/tmp/shsat-material-passage-set-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.passage-set .question-item--nested').filter({ hasText: secondStem }).click();

    await page.locator('.material-editor').getByRole('button', { name: 'New', exact: true }).click();
    assert.equal(await page.locator('.stem-input').inputValue(), secondStem, 'the independent draft is created from the second question');
    assert.equal(await secondEditor.locator('.material-form-grid input').nth(0).inputValue(), '',
      'New starts a separate material draft');
    await secondEditor.locator('.material-form-grid input').nth(0).fill(`Independent Passage ${suffix}`);
    await secondFields.locator('textarea').nth(1).fill(`Independent content ${suffix}.`);
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.equal(questions[0].render.material.title, `Shared Passage Edited ${suffix}`,
      'a new material draft does not change the original shared material');
    assert.equal(questions[1].render.material.title, `Independent Passage ${suffix}`);

    const questionTree = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'English Language Arts', exact: true }) });
    const dropEffect = await page.evaluate(({ sourceStem, targetStem }) => {
      const questions = [...document.querySelectorAll('.question-item')];
      const source = questions.find(item => item.textContent.includes(sourceStem));
      const target = questions.find(item => item.textContent.includes(targetStem));
      const bounds = target.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer, clientY: bounds.top + 1,
      }));
      const effect = dataTransfer.dropEffect;
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
      return effect;
    }, { sourceStem: secondStem, targetStem: firstStem });
    assert.equal(dropEffect, 'none', 'the browser rejects dragging a question into a different material set');
    await page.getByText('Keep passage sets together.', { exact: true }).waitFor();
    assert.deepEqual((await questionTree.locator('.question-item').allInnerTexts())
      .map(text => Number(text.match(/\bQ(\d+)\b/)?.[1])), [1, 2, 3],
    'questions cannot be dragged into a different material set');
    await page.getByRole('button', { name: 'Close notification', exact: true }).click();

    await secondEditor.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(await secondEditor.locator('.material-type select').inputValue(), 'none',
      'Clear unlinks material from the selected question');
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.ok(questions[0].render.material, 'clearing one question leaves the original material linked to the first question');
    assert.equal(questions[1].render.material, undefined, 'the second question no longer has material after Clear');

    await secondEditor.locator('.material-type select').selectOption('image');
    const imageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      context.fillStyle = '#eaf1ff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#183b72';
      context.font = '20px sans-serif';
      context.fillText('Standalone image material', 20, 68);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const imageUpload = page.waitForResponse(response => (
      response.url().includes(`/api/admin/papers/${paperId}/materials/images`)
      && response.request().method() === 'POST'
    ));
    await secondEditor.locator('input[type="file"]').setInputFiles({
      name: 'standalone-material.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBase64, 'base64'),
    });
    assert.equal((await imageUpload).status(), 200, 'standalone image material upload succeeds');
    const standaloneImage = secondEditor.locator('.image-preview-button img');
    await standaloneImage.waitFor();
    assert.ok(await standaloneImage.evaluate(image => image.complete && image.naturalWidth > 0), 'standalone image material preview loads');
    const originalImageSrc = await standaloneImage.getAttribute('src');

    const imageUploadFailureMessage = 'Simulated image upload failure. Please try again.';
    await page.route(`**/api/admin/papers/${paperId}/materials/images`, route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: imageUploadFailureMessage }),
    }), { times: 1 });
    const failedImageUpload = page.waitForResponse(response => (
      response.url().includes(`/api/admin/papers/${paperId}/materials/images`)
      && response.request().method() === 'POST'
    ));
    await secondEditor.locator('input[type="file"]').setInputFiles({
      name: 'failed-material.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBase64, 'base64'),
    });
    assert.equal((await failedImageUpload).status(), 500, 'the failure path receives a server error');
    await page.getByRole('status').getByText(imageUploadFailureMessage, { exact: true }).waitFor();
    assert.equal(await standaloneImage.getAttribute('src'), originalImageSrc,
      'a failed replacement does not clear the current image preview');
    const desktopNoticeOverlapsToolbar = await page.evaluate(() => {
      const notice = document.querySelector('.notice').getBoundingClientRect();
      const toolbar = document.querySelector('.edit-header__actions').getBoundingClientRect();
      return notice.left < toolbar.right && notice.right > toolbar.left
        && notice.top < toolbar.bottom && notice.bottom > toolbar.top;
    });
    assert.equal(desktopNoticeOverlapsToolbar, false, 'the upload error notice does not cover editor toolbar actions');
    await page.screenshot({ path: `/tmp/shsat-material-upload-failure-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const uploadFailureMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(uploadFailureMobileSize.page <= uploadFailureMobileSize.viewport,
      `the upload error notice fits a 390px viewport: ${JSON.stringify(uploadFailureMobileSize)}`);
    assert.equal(await page.evaluate(() => {
      const notice = document.querySelector('.notice').getBoundingClientRect();
      const toolbar = document.querySelector('.edit-header__actions').getBoundingClientRect();
      return notice.left < toolbar.right && notice.right > toolbar.left
        && notice.top < toolbar.bottom && notice.bottom > toolbar.top;
    }), false, 'the mobile upload error notice does not cover editor toolbar actions');
    await page.screenshot({ path: `/tmp/shsat-material-upload-failure-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.unroute(`**/api/admin/papers/${paperId}/materials/images`);
    await secondEditor.screenshot({ path: `/tmp/shsat-material-image-editor-${stamp}.png` });
    await page.getByRole('status').getByText(imageUploadFailureMessage, { exact: true }).waitFor();
    const imageReplacement = page.waitForResponse(response => (
      response.url().includes(`/api/admin/papers/${paperId}/materials/images`)
      && response.request().method() === 'POST'
    ));
    await secondEditor.locator('input[type="file"]').setInputFiles({
      name: 'replacement-material.png',
      mimeType: 'image/png',
      buffer: Buffer.from(imageBase64, 'base64'),
    });
    assert.equal((await imageReplacement).status(), 200, 'replacing an existing image material succeeds after recovery');
    const replacementImageSrc = await standaloneImage.getAttribute('src');
    assert.notEqual(replacementImageSrc, originalImageSrc, 'the replacement image becomes the active preview');
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.equal(questions[1].render.material.type, 'IMAGE');
    assert.match(questions[1].render.material.assetUrl, /replacement-material\.png|paper-materials/);

    await page.locator('.question-item').filter({ hasText: groupedQuestionStem }).click();
    const sharedImageEditor = page.locator('.material-editor');
    await sharedImageEditor.locator('.material-type select').selectOption('image');
    const sharedImageSelect = sharedImageEditor.locator('.material-topline select');
    const sharedImageOption = await sharedImageSelect.locator('option').evaluateAll((options, title) => (
      options.find(option => option.textContent.includes(title))?.value || ''
    ), 'standalone-material.png');
    assert.ok(sharedImageOption, 'a saved standalone image material is available to another question');
    await sharedImageSelect.selectOption(sharedImageOption);
    assert.match(await sharedImageEditor.locator('.material-usage-note').innerText(), /editing it here updates Q2, Q3/,
      'the editor identifies all questions linked to the shared image material');
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.equal(questions[1].render.material.materialId, questions[2].render.material.materialId,
      'both questions reference the same standalone image material');
    assert.equal(questions[1].render.material.assetUrl, questions[2].render.material.assetUrl,
      'both linked questions resolve the same image after saving');

    const sharedImageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      context.fillStyle = '#e8f7ed';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#1d6236';
      context.font = '20px sans-serif';
      context.fillText('Shared replacement image', 20, 68);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const sharedImageReplacement = page.waitForResponse(response => (
      response.url().includes(`/api/admin/papers/${paperId}/materials/images`)
      && response.request().method() === 'POST'
    ));
    await sharedImageEditor.locator('input[type="file"]').setInputFiles({
      name: 'shared-replacement.png',
      mimeType: 'image/png',
      buffer: Buffer.from(sharedImageBase64, 'base64'),
    });
    assert.equal((await sharedImageReplacement).status(), 200);
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.equal(questions[1].render.material.assetUrl, questions[2].render.material.assetUrl,
      'replacing a shared image keeps all question references synchronized');
    assert.match(questions[1].render.material.assetUrl, /shared-replacement\.png|paper-materials/);

    await page.reload();
    await page.locator('.question-item').filter({ hasText: secondStem }).click();
    assert.equal(await page.locator('.material-editor .image-preview-button img').getAttribute('src'),
      questions[1].render.material.assetUrl,
      'the replacement image remains synchronized after reloading the editor');

    await page.locator('.question-item').filter({ hasText: groupedQuestionStem }).click();
    await secondEditor.getByRole('button', { name: 'Clear Image', exact: true }).click();
    assert.equal(await page.locator('.material-editor .image-preview-button img').count(), 0,
      'clearing the shared image removes its preview from every linked question');
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.equal(questions[1].render.material.type, 'IMAGE', 'Clear Image keeps the shared image material type');
    assert.equal(questions[2].render.material.type, 'IMAGE', 'Clear Image keeps the image type for every linked question');
    assert.equal(questions[1].render.material.assetUrl, null);
    assert.equal(questions[2].render.material.assetUrl, null);

    await page.locator('.question-item').filter({ hasText: secondStem }).click();
    await secondEditor.getByRole('button', { name: 'Clear', exact: true }).click();
    await savePaperChanges(page, paperId);
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.equal(questions[1].render.material, undefined, 'Clear also unlinks an uploaded image material');

    for (const stem of [firstStem, groupedQuestionStem]) {
      await page.locator('.question-item').filter({ hasText: stem }).click();
      const passageEditor = page.locator('.material-editor');
      await passageEditor.getByRole('button', { name: 'Clear', exact: true }).click();
      await savePaperChanges(page, paperId);
    }
    stored = await api(page, `/api/admin/papers/${paperId}`);
    questions = readQuestions(stored);
    assert.ok(stored.materials.some(material => material.title === `Shared Passage Edited ${suffix}`),
      'a passage remains in the material library after every question is unlinked');
    assert.ok(questions.every(question => question.render.material === undefined),
      'clearing the final passage reference removes it from the questions');

    await page.reload();
    await page.getByRole('heading', { name: /Question \d+ · Multiple Choice/ }).waitFor();
    await page.locator('.question-item').filter({ hasText: firstStem }).click();
    const restoredMaterialEditor = page.locator('.material-editor');
    await restoredMaterialEditor.locator('.material-type select').selectOption('text');
    const restoredMaterialSelect = restoredMaterialEditor.locator('.material-topline select');
    const preservedMaterialOption = await restoredMaterialSelect.locator('option').evaluateAll((options, title) => (
      options.find(option => option.textContent.includes(title))?.value || ''
    ), `Shared Passage Edited ${suffix}`);
    assert.ok(preservedMaterialOption, 'an unlinked passage remains available after a page reload');
    await restoredMaterialSelect.selectOption(preservedMaterialOption);
    assert.equal(await restoredMaterialEditor.locator('.material-form-grid input').nth(0).inputValue(),
      `Shared Passage Edited ${suffix}`, 'the unlinked material can be reattached with its saved content');
    await savePaperChanges(page, paperId);

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.getByText(firstStem, { exact: true }).waitFor();
    const previewMaterial = page.locator('.material-section');
    await previewMaterial.waitFor();
    const previewImages = previewMaterial.locator('img');
    assert.equal(await previewImages.count(), 2);
    for (const image of await previewImages.all()) {
      assert.ok(await image.evaluate(item => item.complete && item.naturalWidth > 0), 'material images load in the student preview');
    }
    await page.screenshot({ path: `/tmp/shsat-material-preview-${stamp}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, `the material preview fits a 390px viewport: ${JSON.stringify(mobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-material-preview-mobile-${stamp}.png` });

    const version = await api(page, `/api/admin/papers/${paperId}/versions`, 'POST');
    versionId = Number(version.summary.id);
    assert.ok(version.materials.some(material => material.title === `Shared Passage Edited ${suffix}`),
      'creating a paper version copies its independent material library');
    assert.ok(readQuestions(version).some(question => question.render.material?.title === `Shared Passage Edited ${suffix}`),
      'the copied question points to its copied material record');
    await api(page, `/api/admin/papers/${versionId}`, 'DELETE');
    versionId = undefined;

    assert.deepEqual(pageErrors, [], 'material editing, persistence, and preview have no browser errors');
    console.log(JSON.stringify({
      result: 'PASS',
      materialOperations: ['create text', 'Markdown/formula preview', 'clipboard and file-picker image insertion', 'image zoom/reset/close', 'standalone image upload/failure/replacement/clear image/clear material', 'reuse', 'shared edit', 'passage set grouping, question insertion, and drag boundary', 'new independent copy', 'clear one link', 'retain and reuse material after all question links are cleared', 'copy independent materials when creating a paper version'],
      uploadFailureMobileSize,
      mobileSize,
      pageErrors: pageErrors.length,
      screenshots: [
        `/tmp/shsat-material-screenshot-modal-${stamp}.png`,
        `/tmp/shsat-material-editor-saved-${stamp}.png`,
        `/tmp/shsat-material-passage-set-${stamp}.png`,
        `/tmp/shsat-material-passage-set-mobile-${stamp}.png`,
        `/tmp/shsat-material-upload-failure-${stamp}.png`,
        `/tmp/shsat-material-upload-failure-mobile-${stamp}.png`,
        `/tmp/shsat-material-image-editor-${stamp}.png`,
        `/tmp/shsat-material-preview-${stamp}.png`,
        `/tmp/shsat-material-preview-mobile-${stamp}.png`,
      ],
    }));
  } finally {
    if (versionId) await api(page, `/api/admin/papers/${versionId}`, 'DELETE').catch(() => {});
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

async function savePaperChanges(page, paperId) {
  const saveResponse = page.waitForResponse(response => (
    response.url().includes(`/api/admin/papers/${paperId}/structure`)
    && response.request().method() === 'PUT'
  ));
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  const response = await saveResponse;
  assert.equal(response.status(), 200, 'paper structure save succeeds');
  await page.getByText('All changes saved.', { exact: true }).waitFor();
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
