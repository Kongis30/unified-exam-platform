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
  const failedApiResponses = [];
  const previewWriteRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/api/student/attempts') && request.method() !== 'GET') {
      previewWriteRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on('response', async response => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      failedApiResponses.push({ status: response.status(), url: response.url(), body: await response.text().catch(() => '') });
    }
  });

  const stamp = Date.now();
  const paperTitle = `Editor Navigation ${stamp}`;
  const questionStem = `Editor persistence question ${stamp}`;
  let paperId;
  let metadataPaperId;
  let tempUserId;
  let sourceExamId;

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
    await page.route(`**/api/admin/papers/${paperId}/structure`, route => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'The paper changed before your save. Reload and try again.' }),
    }), { times: 1 });
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('The paper changed before your save. Reload and try again.', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-paper-editor-save-conflict-${stamp}.png` });
    assert.equal(readQuestions(await api(page, `/api/admin/papers/${paperId}`)).length, 0,
      'a rejected save does not partially persist editor changes');
    await page.getByRole('button', { name: 'Close notification', exact: true }).click();
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

    const customPartCode = `CUSTOM_${stamp}`;
    const customPartName = `Custom Part ${stamp}`;
    const updatedCustomPartName = `${customPartName} Updated`;
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    const partsModal = page.locator('.modal-card--wide').filter({ has: page.getByRole('heading', { name: 'Manage Primary Types' }) });
    const officialEla = partsModal.locator('.structure-item').filter({ hasText: 'English Language Arts' }).first();
    assert.equal(await officialEla.getByRole('button', { name: 'Delete', exact: true }).isDisabled(), true,
      'official SHSAT primary types cannot be deleted');
    const newPart = partsModal.locator('.new-structure');
    await newPart.getByPlaceholder('Code, e.g. ELA').fill(customPartCode);
    await newPart.getByPlaceholder('Part name').fill(customPartName);
    await newPart.getByRole('button', { name: 'Add Primary Type', exact: true }).click();
    await page.getByText(`Primary type "${customPartName}" created.`, { exact: true }).waitFor();
    await partsModal.locator('.modal-card__close').click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    assert.ok((await api(page, `/api/admin/papers/${paperId}`)).sections.some(section => section.sectionCode === customPartCode),
      'a custom primary type persists as a section');
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    const editablePart = page.locator('.modal-card--wide').filter({ has: page.getByRole('heading', { name: 'Manage Primary Types' }) })
      .locator('.structure-item').filter({ hasText: customPartName });
    await editablePart.locator('.form-field').filter({ hasText: 'Part Name' }).locator('input').fill(updatedCustomPartName);
    await editablePart.getByRole('button', { name: 'Update', exact: true }).click();
    await page.getByText('Primary type updated.', { exact: true }).waitFor();
    await page.locator('.modal-card--wide .modal-card__close').click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    assert.ok((await api(page, `/api/admin/papers/${paperId}`)).sections.some(section => section.sectionCode === customPartCode
      && section.title === updatedCustomPartName), 'updating a custom primary type persists its name');

    const savedEla = (await api(page, `/api/admin/papers/${paperId}`)).sections.find(section => section.sectionCode === 'ELA');
    assert.ok(savedEla, 'the official ELA primary type remains available');
    const customSubTypeCode = `CUSTOM_TYPE_${stamp}`;
    const customSubTypeName = `Custom Secondary ${stamp}`;
    const updatedCustomSubTypeName = `${customSubTypeName} Updated`;
    await page.getByRole('button', { name: 'Types', exact: true }).click();
    const typesModal = page.locator('.modal-card--wide').filter({ has: page.getByRole('heading', { name: 'Manage Secondary Types' }) });
    const officialSubType = typesModal.locator('.structure-item').filter({ hasText: 'Revising/Editing Part A' }).first();
    assert.equal(await officialSubType.getByRole('button', { name: 'Delete', exact: true }).isDisabled(), true,
      'official SHSAT secondary types cannot be deleted');
    const newSubType = typesModal.locator('.new-structure');
    await newSubType.locator('select').first().selectOption(String(savedEla.id));
    await newSubType.getByPlaceholder('Code, e.g. CUSTOM_READING').fill(customSubTypeCode);
    await newSubType.getByPlaceholder('Type name').fill(customSubTypeName);
    await newSubType.getByRole('button', { name: 'Add Secondary Type', exact: true }).click();
    await page.getByText(`Secondary type "${customSubTypeName}" created.`, { exact: true }).waitFor();
    await typesModal.locator('.modal-card__close').click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    assert.ok((await api(page, `/api/admin/papers/${paperId}`)).sections
      .find(section => section.sectionCode === 'ELA')?.children.some(section => section.sectionCode === `ELA_${customSubTypeCode}`),
    'a custom secondary type persists under its selected primary type');
    await page.getByRole('button', { name: 'Types', exact: true }).click();
    const editableSubType = page.locator('.modal-card--wide').filter({ has: page.getByRole('heading', { name: 'Manage Secondary Types' }) })
      .locator('.structure-item').filter({ hasText: customSubTypeName });
    await editableSubType.locator('.form-field').filter({ hasText: 'Type Name' }).locator('input').fill(updatedCustomSubTypeName);
    await editableSubType.getByRole('button', { name: 'Update', exact: true }).click();
    await page.getByText('Secondary type updated.', { exact: true }).waitFor();
    await page.locator('.modal-card--wide .modal-card__close').click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    const updatedEla = (await api(page, `/api/admin/papers/${paperId}`)).sections.find(section => section.sectionCode === 'ELA');
    assert.ok(updatedEla?.children.some(section => section.sectionCode === `ELA_${customSubTypeCode}`
      && section.title === updatedCustomSubTypeName), 'updating a custom secondary type persists its name');

    const primaryTypeSelect = page.locator('.meta-field').filter({ hasText: 'Primary Type' }).locator('select');
    await primaryTypeSelect.selectOption({ label: updatedCustomPartName });
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    const referencedPartsModal = page.locator('.modal-card--wide').filter({ has: page.getByRole('heading', { name: 'Manage Primary Types' }) });
    const referencedCustomPart = referencedPartsModal.locator('.structure-item').filter({ hasText: updatedCustomPartName });
    await referencedCustomPart.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByText('Move or delete this type’s questions, materials, and secondary types before deleting it.', { exact: true }).waitFor();
    assert.equal(await referencedCustomPart.count(), 1, 'a primary type used by a question cannot be removed');
    await page.getByRole('button', { name: 'Close notification', exact: true }).click();
    await referencedPartsModal.locator('.modal-card__close').click();

    await primaryTypeSelect.selectOption({ label: 'English Language Arts' });
    const secondaryTypeSelect = page.locator('.meta-field').filter({ hasText: 'Secondary Type' }).locator('select');
    await secondaryTypeSelect.selectOption({ label: updatedCustomSubTypeName });
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    const paperWithCustomType = await api(page, `/api/admin/papers/${paperId}`);
    assert.ok(paperWithCustomType.sections.find(section => section.sectionCode === 'ELA')?.children
      .find(section => section.title === updatedCustomSubTypeName)?.questions.some(question => question.stem === questionStem),
    'the question is saved under its custom secondary type');

    await page.getByRole('button', { name: 'Types', exact: true }).click();
    const referencedTypesModal = page.locator('.modal-card--wide').filter({ has: page.getByRole('heading', { name: 'Manage Secondary Types' }) });
    const referencedCustomSubType = referencedTypesModal.locator('.structure-item').filter({ hasText: updatedCustomSubTypeName });
    await referencedCustomSubType.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByText('Move or delete this type’s questions and materials before deleting it.', { exact: true }).waitFor();
    assert.equal(await referencedCustomSubType.count(), 1, 'a secondary type used by a question cannot be removed');
    await page.getByRole('button', { name: 'Close notification', exact: true }).click();
    await referencedTypesModal.locator('.modal-card__close').click();
    await secondaryTypeSelect.selectOption('');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Types', exact: true }).click();
    const unusedTypesModal = page.locator('.modal-card--wide').filter({ has: page.getByRole('heading', { name: 'Manage Secondary Types' }) });
    const unusedCustomSubType = unusedTypesModal.locator('.structure-item').filter({ hasText: updatedCustomSubTypeName });
    await unusedCustomSubType.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByText('Secondary type deleted.', { exact: true }).waitFor();
    await unusedTypesModal.locator('.modal-card__close').click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    assert.equal((await api(page, `/api/admin/papers/${paperId}`)).sections
      .find(section => section.sectionCode === 'ELA')?.children.some(section => section.sectionCode === `ELA_${customSubTypeCode}`), false,
    'deleting an unused custom secondary type persists');

    await page.getByRole('button', { name: 'Parts', exact: true }).click();
    const unusedPartsModal = page.locator('.modal-card--wide').filter({ has: page.getByRole('heading', { name: 'Manage Primary Types' }) });
    const unusedCustomPart = unusedPartsModal.locator('.structure-item').filter({ hasText: updatedCustomPartName });
    await unusedCustomPart.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByText('Primary type deleted.', { exact: true }).waitFor();
    await unusedPartsModal.locator('.modal-card__close').click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    assert.equal((await api(page, `/api/admin/papers/${paperId}`)).sections.some(section => section.sectionCode === customPartCode), false,
      'an unused custom primary type can still be removed');

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.getByText(questionStem, { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-paper-editor-preview-${stamp}.png` });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/edit`);
    await page.getByRole('heading', { name: paperTitle, exact: true }).waitFor();

    const mathematics = page.locator('.subject-group').filter({ has: page.getByRole('heading', { name: 'Mathematics', exact: true }) });
    await mathematics.getByRole('button', { name: 'Add Question', exact: true }).click();
    const mathStemText = `Mathematics persistence question ${stamp}`;
    const missingQuestionImageUrl = `/uploads/paper-materials/missing-question-${stamp}.png`;
    const mathStem = `${mathStemText}\n[[STEM_IMAGE:${missingQuestionImageUrl}]]`;
    await page.locator('.stem-input').fill(mathStem);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor({ timeout: 5_000 }).catch(async () => {
      console.error('Failed API responses:', JSON.stringify(failedApiResponses));
      console.error('Math question save state:', (await page.locator('body').innerText()).slice(-2_000));
      await page.screenshot({ path: `/tmp/shsat-paper-editor-math-save-error-${stamp}.png` });
      throw new Error('The Math question was not saved successfully.');
    });
    assert.deepEqual(readQuestions(await api(page, `/api/admin/papers/${paperId}`)).map(question => question.stem),
      [questionStem, mathStem], 'questions added from separate parts persist in the expected order');

    const previewMaterialRef = `preview-material-${stamp}`;
    const previewMissingImageRef = `preview-missing-image-${stamp}`;
    const previewPaperDetail = await api(page, `/api/admin/papers/${paperId}`);
    let previewMaterialAttached = false;
    let previewMissingImageAttached = false;
    const mapSectionForSave = section => ({
      sectionCode: section.sectionCode,
      sectionKind: section.sectionKind,
      title: section.title,
      sortOrder: section.sortOrder,
      instructions: section.instructions,
      settings: section.settings,
      questions: (section.questions || []).map(question => {
        const render = question.render || {};
        if (question.stem === questionStem) {
          render.materialRef = previewMaterialRef;
          previewMaterialAttached = true;
        } else if (question.stem === mathStem) {
          render.materialRef = previewMissingImageRef;
          previewMissingImageAttached = true;
        }
        return {
          questionTypeCode: question.questionTypeCode,
          payloadSchemaVersion: question.payloadSchemaVersion,
          stem: question.stem,
          render,
          answerKey: question.answerKey,
          grading: question.grading,
          explanation: question.explanation,
          categoryId: question.categoryId,
          sortOrder: question.sortOrder,
          displayNumber: question.displayNumber,
          maxPoints: question.maxPoints,
          scoringSectionCode: question.scoringSectionCode,
        };
      }),
      children: (section.children || []).map(mapSectionForSave),
    });
    assert.ok(previewPaperDetail.sections.some(section => JSON.stringify(section).includes(questionStem)),
      'the ELA preview question is present in the saved paper structure');
    const savedSections = previewPaperDetail.sections.map(mapSectionForSave);
    assert.equal(previewMaterialAttached, true, 'the preview test question receives a temporary reading material');
    assert.equal(previewMissingImageAttached, true, 'the math preview question receives a missing image fixture');
    const materialWrites = (previewPaperDetail.materials || []).map(material => ({
      materialId: String(material.id), clientRef: null, partCode: material.partCode,
      subTypeCode: material.subTypeCode, materialType: material.materialType,
      category: material.category, title: material.title, content: material.content,
      assetUrl: material.assetUrl, sortOrder: material.sortOrder,
    }));
    materialWrites.push({
      materialId: null, clientRef: previewMaterialRef, partCode: 'ELA', subTypeCode: null,
      materialType: 'TEXT', category: 'Reading Passage', title: `Preview Drawing Material ${stamp}`,
      content: 'A short passage used to verify the preview drawing pen.', assetUrl: null,
      sortOrder: materialWrites.length,
    });
    materialWrites.push({
      materialId: null, clientRef: previewMissingImageRef, partCode: 'MATH', subTypeCode: null,
      materialType: 'IMAGE', category: 'Question Image', title: `Missing Preview Image ${stamp}`,
      content: null, assetUrl: `${baseUrl}/uploads/paper-materials/missing-preview-${stamp}.png`,
      sortOrder: materialWrites.length,
    });
    await page.route(`**/uploads/paper-materials/missing-preview-${stamp}.png`, route => route.fulfill({ status: 404, body: '' }));
    await page.route(`**${missingQuestionImageUrl}`, route => route.fulfill({ status: 404, body: '' }));
    await api(page, `/api/admin/papers/${paperId}/structure`, 'PUT', {
      sections: savedSections, materials: materialWrites,
    });

    const nextQuestion = page.getByRole('button', { name: 'Next →', exact: true });
    assert.equal(await nextQuestion.isDisabled(), true, 'Next is disabled on the last question');
    const previousQuestion = page.getByRole('button', { name: '← Previous', exact: true });
    assert.equal(await previousQuestion.isDisabled(), false, 'Previous is enabled when another question exists');
    await previousQuestion.click();
    await page.getByRole('heading', { name: 'Question 1 · Multiple Choice', exact: true }).waitFor();
    await nextQuestion.click();
    await page.getByRole('heading', { name: 'Question 2 · Multiple Choice', exact: true }).waitFor();

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.getByText(questionStem, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText(mathStemText, { exact: false }).first().waitFor();
    await page.getByText('Question image is unavailable.', { exact: true }).waitFor();
    await page.getByText('Image unavailable: Stem image', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-paper-preview-missing-image-${stamp}.png` });
    await page.screenshot({ path: `/tmp/shsat-paper-preview-tools-desktop-${stamp}.png` });
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByText(questionStem, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    const reviewPanel = page.locator('.review-panel');
    const bookmarkFilter = reviewPanel.locator('.stat-item').filter({ hasText: 'Bookmarks' });
    assert.equal((await bookmarkFilter.locator('.stat-number').innerText()).trim(), '1',
      'preview review counts the bookmarked question');
    await bookmarkFilter.click();
    assert.equal(await reviewPanel.locator('.question-list button').count(), 1,
      'the bookmark filter limits the preview question list');
    await reviewPanel.getByRole('button', { name: /Question 1/ }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText(mathStemText, { exact: false }).first().waitFor();
    await page.getByRole('button', { name: 'Bookmark', exact: true }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    assert.equal((await reviewPanel.locator('.stat-item').filter({ hasText: 'Bookmarks' }).locator('.stat-number').innerText()).trim(), '2',
      'bookmarks update across ELA and Math preview sections');
    await page.getByRole('button', { name: 'Font Size', exact: true }).click();
    await page.getByRole('button', { name: '1.3x', exact: true }).click();
    assert.equal(await page.locator('.exam-question-shell').evaluate(element => element.style.getPropertyValue('--exam-font-scale')), '1.3',
      'the font-size tool updates the preview question');
    await page.getByRole('button', { name: 'Page Width', exact: true }).click();
    await page.getByRole('button', { name: 'Extra Wide', exact: true }).click();
    assert.ok((await page.locator('.student-exam').getAttribute('class')).includes('student-exam--ultra-wide'),
      'the page-width tool applies the selected preview layout');
    await page.getByRole('button', { name: 'Notepad', exact: true }).click();
    const notesPanel = page.getByRole('dialog', { name: 'Notes' });
    await notesPanel.waitFor();
    await notesPanel.locator('textarea').fill('Preview-only note');
    await notesPanel.getByRole('button', { name: 'Close Notes', exact: true }).click();
    await page.getByRole('button', { name: 'Notepad', exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: 'Notes' }).locator('textarea').inputValue(), 'Preview-only note',
      'preview notes remain available after closing and reopening the notepad');
    await page.getByRole('button', { name: 'Close Notes', exact: true }).click();
    await page.getByRole('button', { name: 'Highlighter', exact: true }).click();
    assert.ok((await page.getByRole('button', { name: 'Highlighter', exact: true }).getAttribute('class')).includes('active'),
      'the highlighter tool can be enabled in preview mode');
    await page.getByRole('button', { name: 'Answer Eliminator', exact: true }).click();
    assert.ok((await page.getByRole('button', { name: 'Answer Eliminator', exact: true }).getAttribute('class')).includes('active'),
      'the answer eliminator can be enabled in preview mode');
    const optionToEliminate = page.locator('.choice-answer__option').first();
    await optionToEliminate.getByRole('button', { name: 'Cross out this option', exact: true }).click();
    assert.ok((await optionToEliminate.getAttribute('class')).includes('eliminated'),
      'the answer eliminator strikes through an option');
    await optionToEliminate.getByRole('button', { name: 'Restore this option', exact: true }).click();
    assert.equal((await optionToEliminate.getAttribute('class')).includes('eliminated'), false,
      'the answer eliminator can restore a crossed-out option');
    await page.getByRole('button', { name: 'Answer Eliminator', exact: true }).click();
    await page.getByRole('button', { name: 'Drawing Pen', exact: true }).click();
    assert.ok((await page.getByRole('button', { name: 'Drawing Pen', exact: true }).getAttribute('class')).includes('active'),
      'the drawing tool can be enabled in preview mode');
    await page.getByRole('button', { name: 'Pen Color', exact: true }).click();
    await page.getByRole('button', { name: 'Blue', exact: true }).click();
    assert.equal(await page.locator('.tool-icon--pen').evaluate(element => getComputedStyle(element).getPropertyValue('--pen-color').trim()), '#2266c7',
      'the drawing pen color selection is applied');
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByText(questionStem, { exact: true }).waitFor();
    const drawingLayer = page.locator('.drawing-layer');
    const drawingBounds = await drawingLayer.boundingBox();
    assert.ok(drawingBounds && drawingBounds.width > 40 && drawingBounds.height > 40,
      'the material question exposes a usable drawing surface');
    await page.mouse.move(drawingBounds.x + 20, drawingBounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(drawingBounds.x + 90, drawingBounds.y + 50, { steps: 4 });
    await page.mouse.up();
    assert.equal(await drawingLayer.locator('path.drawing-stroke').count(), 1,
      'the pen draws a stroke over the preview material');
    await page.screenshot({ path: `/tmp/shsat-paper-preview-drawing-desktop-${stamp}.png` });
    await page.getByRole('button', { name: 'Pen Color', exact: true }).click();
    await page.getByRole('button', { name: 'Clear Drawing', exact: true }).click();
    assert.equal(await drawingLayer.locator('path.drawing-stroke').count(), 0,
      'Clear Drawing removes the current preview stroke');
    await page.getByRole('button', { name: 'Line Reader', exact: true }).click();
    await page.locator('.line-reader').waitFor();
    await page.getByRole('button', { name: 'Line Reader', exact: true }).click();
    await page.locator('.line-reader').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    assert.ok((await page.getByRole('button', { name: 'Fullscreen', exact: true }).getAttribute('class')).includes('active'),
      'the preview fullscreen control enters fullscreen mode');
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal((await page.getByRole('button', { name: 'Fullscreen', exact: true }).getAttribute('class')).includes('active'), false,
      'the preview fullscreen control exits fullscreen mode');
    assert.deepEqual(previewWriteRequests, [],
      `preview interactions do not write student attempts: ${previewWriteRequests.join(', ')}`);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/edit`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(`**/api/admin/papers/${paperId}`, async route => {
      const response = await route.fetch();
      const detail = await response.json();
      const clearQuestionStem = value => {
        if (Array.isArray(value)) {
          value.forEach(clearQuestionStem);
        } else if (value && typeof value === 'object') {
          if (value.stem === mathStem) value.stem = '';
          Object.values(value).forEach(clearQuestionStem);
        }
      };
      clearQuestionStem(detail);
      await route.fulfill({ response, body: JSON.stringify(detail) });
    }, { times: 1 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/preview`);
    await page.getByText(questionStem, { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Question stem is not available', { exact: true }).waitFor();
    await page.getByText('Question image is unavailable.', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-paper-preview-empty-stem-mobile-${stamp}.png` });
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.getByText(questionStem, { exact: true }).waitFor();
    const previewMobileSize = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(previewMobileSize.page <= previewMobileSize.viewport, 'the paper preview fits a 390px viewport');
    const mobileToolbar = page.locator('.exam-toolbar');
    const mobileToolbarMetrics = await mobileToolbar.evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      maxScrollLeft: element.scrollWidth - element.clientWidth,
    }));
    assert.ok(mobileToolbarMetrics.maxScrollLeft > 0,
      'the mobile preview toolbar exposes overflow through its own horizontal scroll');
    await page.screenshot({ path: `/tmp/shsat-paper-preview-tools-mobile-${stamp}.png` });
    await mobileToolbar.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    const mobileBackBounds = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
    assert.ok(mobileBackBounds && mobileBackBounds.x >= 0 && mobileBackBounds.x + mobileBackBounds.width <= 390,
      `the preview Back control is reachable at the end of the mobile toolbar: ${JSON.stringify(mobileBackBounds)}`);
    await page.screenshot({ path: `/tmp/shsat-paper-preview-tools-mobile-end-${stamp}.png` });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/exam-types/SHSAT/admin/papers/${paperId}/edit`);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole('button', { name: 'Delete Question', exact: true }).click();
    await page.getByRole('heading', { name: 'Delete Question?' }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(readQuestions(await api(page, `/api/admin/papers/${paperId}`)).length, 2,
      'cancelling question deletion leaves both saved questions intact');
    await page.getByRole('button', { name: 'Delete Question', exact: true }).click();
    await page.getByRole('button', { name: 'Delete Question', exact: true }).last().click();
    await page.getByText('Question deleted.', { exact: true }).waitFor();
    assert.equal(readQuestions(await api(page, `/api/admin/papers/${paperId}`)).length, 2,
      'question deletion stays local until the paper structure is saved');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Question 1 · Multiple Choice', exact: true }).waitFor();
    assert.equal(readQuestions(await api(page, `/api/admin/papers/${paperId}`)).length, 1,
      'confirming question deletion removes the selected saved question');

    const sourcePaperId = 247;
    const sourcePaper = await api(page, `/api/admin/papers/${sourcePaperId}`);
    const sourceQuestions = readQuestions(sourcePaper);
    assert.ok(sourceQuestions.length > 0, 'the ready SHSAT source paper has questions');
    const existingTargetQuestions = readQuestions(await api(page, `/api/admin/papers/${paperId}`));
    const targetSections = sourcePaper.sections.map((part, partIndex) => {
      const partCode = part.settings?.partCode || part.sectionCode;
      return {
        sectionCode: partCode,
        sectionKind: part.sectionKind,
        title: part.title,
        sortOrder: partIndex,
        instructions: part.instructions,
        settings: part.settings,
        questions: partCode === 'ELA' ? existingTargetQuestions.map(toQuestionRequest) : [],
        children: (part.children || []).map((subType, subTypeIndex) => ({
          sectionCode: `${partCode}_${subType.settings?.subTypeCode || subType.sectionCode}`,
          sectionKind: subType.sectionKind,
          title: subType.title,
          sortOrder: subTypeIndex,
          instructions: subType.instructions,
          settings: subType.settings,
          questions: [],
          children: [],
        })),
      };
    });
    await api(page, `/api/admin/papers/${paperId}/structure`, 'PUT', { sections: targetSections });
    const importStudent = await api(page, '/api/admin/users', 'POST', {
      username: `editorimport${stamp}@jin`,
      password: `Import-${stamp}-Pass!`,
      realName: `Editor Import ${stamp}`,
      roleCode: 'STUDENT',
      email: null,
      phone: null,
    });
    tempUserId = Number(importStudent.id);
    const importRelease = await api(page, `/api/admin/papers/${sourcePaperId}/exams`, 'POST', {
      title: `Editor Import Source ${stamp}`,
      description: 'Temporary paper editor import verification',
      opensAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
    });
    sourceExamId = Number(importRelease.summary.id);
    await api(page, `/api/admin/exams/${sourceExamId}/targets`, 'PUT', { classIds: [], studentUserIds: [tempUserId] });
    await api(page, `/api/admin/exams/${sourceExamId}/publish`, 'POST');

    const sourceAnalytics = await api(page, `/api/admin/reports/exams/${sourceExamId}/monitor/analytics`);
    const analyticsRows = sourceAnalytics.questionAnalytics || [];
    assert.ok(analyticsRows.length > 0, 'a published SHSAT exam exposes questions for import');
    const noAnswerQuestion = analyticsRows.find(row => row.accuracy === null || row.accuracy === undefined) || analyticsRows[0];
    const sourceQuestionNumber = Number(noAnswerQuestion.questionNumber);
    const sourceQuestion = sourceQuestions.find(question => Number(question.displayNumber) === sourceQuestionNumber);
    assert.ok(sourceQuestion, 'question analytics map to a question on the source paper');

    await page.locator('.notice').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Import from Exam', exact: true }).click();
    await page.getByRole('heading', { name: 'Import questions', exact: true }).waitFor();
    const sourceExamSelect = page.locator('.import-source-select select');
    await page.waitForFunction((examId) => {
      const select = document.querySelector('.import-source-select select');
      return select && select.value === String(examId);
    }, sourceExamId);
    const questionTypeFilter = page.locator('.import-type-select select');
    await questionTypeFilter.selectOption({ label: 'Multiple Choice' });
    assert.ok(await page.locator('.import-question-row').count() > 0,
      'the question type filter shows matching questions');
    await questionTypeFilter.selectOption('all');
    for (const filter of ['Below 50%', '50% to <75%', '75%+']) {
      await page.getByRole('button', { name: filter, exact: true }).click();
      await page.getByText('No questions match this filter.', { exact: true }).waitFor();
    }
    await page.getByRole('button', { name: 'No answers', exact: true }).click();
    assert.ok(await page.locator('.import-question-row').count() > 0,
      'the No answers filter shows unanswered source questions');
    await page.locator('.import-question-row__preview')
      .filter({ hasText: new RegExp(`^Q${sourceQuestionNumber}(?:\\s|$)`) }).click();
    await page.getByText(`Question ${sourceQuestionNumber}`, { exact: true }).waitFor();
    await page.getByLabel(`Select question ${sourceQuestionNumber}`, { exact: true }).check();
    assert.equal(await page.getByRole('button', { name: 'Add 1 questions', exact: true }).isEnabled(), true,
      'selecting a source question enables import');
    await page.screenshot({ path: `/tmp/shsat-paper-editor-import-${stamp}.png` });

    await page.setViewportSize({ width: 390, height: 844 });
    const importMobileSize = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      dialogWidth: document.querySelector('.import-questions-dialog')?.getBoundingClientRect().width || 0,
    }));
    assert.ok(importMobileSize.pageWidth <= importMobileSize.viewportWidth
      && importMobileSize.dialogWidth <= importMobileSize.viewportWidth,
    `question import dialog fits 390px: ${JSON.stringify(importMobileSize)}`);
    await page.screenshot({ path: `/tmp/shsat-paper-editor-import-mobile-${stamp}.png` });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(readQuestions(await api(page, `/api/admin/papers/${paperId}`)).length, 1,
      'cancelling import does not change the target paper');

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Import from Exam', exact: true }).click();
    await page.getByRole('heading', { name: 'Import questions', exact: true }).waitFor();
    await page.waitForFunction((examId) => {
      const select = document.querySelector('.import-source-select select');
      return select && select.value === String(examId);
    }, sourceExamId);
    await page.locator('.import-question-row__preview')
      .filter({ hasText: new RegExp(`^Q${sourceQuestionNumber}(?:\\s|$)`) }).click();
    await page.getByLabel(`Select question ${sourceQuestionNumber}`, { exact: true }).check();
    await page.getByRole('button', { name: 'Add 1 questions', exact: true }).click();
    await page.waitForTimeout(1000);
    if (await page.locator('.import-questions-dialog').count()) {
      const dialogText = await page.locator('.import-questions-dialog').innerText();
      const failures = failedApiResponses.map(response => `${response.status} ${response.url}: ${response.body}`).join('\n');
      throw new Error(`Question import did not close the dialog. Dialog: ${dialogText}\nAPI failures: ${failures}`);
    }
    await page.getByText('1 questions added from', { exact: false }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileNoticePosition = await page.locator('.notice').evaluate(element => ({
      bottom: getComputedStyle(element).bottom,
      y: element.getBoundingClientRect().y,
    }));
    assert.equal(mobileNoticePosition.bottom, '12px', 'the mobile success notification is anchored to the lower screen edge');
    assert.ok(mobileNoticePosition.y > 140, 'the mobile success notification stays below the two-row platform navigation');
    const notificationPageWidth = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(notificationPageWidth.page <= notificationPageWidth.viewport, 'the mobile editor notification causes no horizontal overflow');
    await page.screenshot({ path: `/tmp/shsat-paper-editor-notice-mobile-${stamp}.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const importedPaper = await api(page, `/api/admin/papers/${paperId}`);
    const importedQuestions = readQuestions(importedPaper);
    assert.equal(importedQuestions.length, 2, 'confirming import adds one source question');
    const importedQuestion = importedQuestions.find(question => question.stem === sourceQuestion.stem);
    assert.ok(importedQuestion, 'the imported source question retains its original stem');
    assert.equal(importedQuestion.questionTypeCode, sourceQuestion.questionTypeCode,
      'the imported question retains its original type');
    assert.deepEqual(importedQuestion.render, sourceQuestion.render, 'the imported question retains its display data');
    assert.deepEqual(importedQuestion.answerKey, sourceQuestion.answerKey, 'the imported question retains its answer key');
    const sourceSection = findQuestionSection(sourcePaper.sections, sourceQuestion.paperItemId);
    const importedSection = findQuestionSection(importedPaper.sections, importedQuestion.paperItemId);
    assert.ok(sourceSection && importedSection, 'the imported question remains attached to its section');
    const sourcePart = sourcePaper.sections.find(part => (part.children || []).includes(sourceSection));
    const sourcePartCode = sourcePart.settings?.partCode || sourcePart.sectionCode;
    const sourceSubTypeCode = sourceSection.settings?.subTypeCode
      || (sourceSection.sectionCode.startsWith(`${sourcePart.sectionCode}_`)
        ? sourceSection.sectionCode.slice(sourcePart.sectionCode.length + 1)
        : sourceSection.sectionCode);
    const semanticSectionCode = `${sourcePartCode}_${sourceSubTypeCode}`;
    assert.equal(importedSection.sectionCode, semanticSectionCode,
      'the imported question maps from its legacy section code to the semantic SHSAT label');

    const metadataPaper = await api(page, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `EDITOR_METADATA_${stamp}`,
      title: `Editor Metadata Preservation ${stamp}`,
      description: 'Temporary paper metadata round-trip verification',
      groupId: null,
      defaultDurationSeconds: 1_200,
    });
    metadataPaperId = Number(metadataPaper.summary.id);
    const metadataStem = `Preserve question metadata ${stamp}`;
    const metadataExplanation = `Explanation must survive editor save ${stamp}`;
    await api(page, `/api/admin/papers/${metadataPaperId}/structure`, 'PUT', {
      materials: [],
      sections: [{
        sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0,
        instructions: null, settings: { partCode: 'ELA' }, children: [],
        questions: [{
          questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1, stem: metadataStem,
          render: { options: [{ key: 'A', text: 'Option A' }, { key: 'B', text: 'Option B' }], questionConfig: {}, validationRules: {} },
          answerKey: { answers: ['A'] }, grading: {}, explanation: metadataExplanation, categoryId: null,
          sortOrder: 0, displayNumber: 1, maxPoints: 2.5, scoringSectionCode: 'UNSCORED',
        }],
      }],
    });
    const metadataEditorUrl = `${baseUrl}/exam-types/SHSAT/admin/papers/${metadataPaperId}/edit`;
    await page.goto(metadataEditorUrl);
    await page.getByRole('heading', { name: `Editor Metadata Preservation ${stamp}`, exact: true }).waitFor();
    const metadataStemInput = page.locator('.stem-input');
    await metadataStemInput.fill(`${metadataStem} edited`);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await page.getByText('All changes saved.', { exact: true }).waitFor();
    let metadataQuestion = readQuestions(await api(page, `/api/admin/papers/${metadataPaperId}`))[0];
    assert.equal(metadataQuestion.explanation, metadataExplanation,
      'saving an edited question preserves its explanation');
    assert.equal(Number(metadataQuestion.maxPoints), 2.5,
      'saving an edited question preserves its point value');
    assert.equal(metadataQuestion.scoringSectionCode, 'UNSCORED',
      'saving an edited question preserves its scoring-section override');
    await page.screenshot({ path: `/tmp/shsat-paper-editor-metadata-preservation-${stamp}.png` });
    await page.reload();
    await page.getByRole('heading', { name: `Editor Metadata Preservation ${stamp}`, exact: true }).waitFor();
    metadataQuestion = readQuestions(await api(page, `/api/admin/papers/${metadataPaperId}`))[0];
    assert.equal(metadataQuestion.explanation, metadataExplanation, 'question explanation persists after editor reload');
    assert.equal(Number(metadataQuestion.maxPoints), 2.5, 'question points persist after editor reload');
    assert.equal(metadataQuestion.scoringSectionCode, 'UNSCORED', 'scoring override persists after editor reload');

    await page.getByText('All changes saved.', { exact: true }).waitFor({ state: 'hidden' });
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
    assert.deepEqual(failedApiResponses.filter(response => response.status >= 500), [],
      `paper editor actions have no server errors: ${JSON.stringify(failedApiResponses)}`);

    console.log(JSON.stringify({
      result: 'PASS',
      checks: ['unchanged save disabled', 'scoring rule persists', 'unsaved preview is blocked',
        'Stay preserves edits', 'Leave Without Saving discards edits', 'saved question survives reload',
        'primary and secondary type create/edit/delete and protect referenced types', 'official SHSAT labels are protected',
        'import source, performance filter, preview, cancel, and confirm',
        'preview review/bookmark/section navigation and toolbar tools', 'preview does not write student attempts',
        'desktop/mobile preview and Back', 'per-part add and question navigation',
        'question deletion cancel and confirm', 'question explanation, points, and scoring override survive editor save/reload', '390px editor layout'],
      mobileSize,
      previewMobileSize,
      mobileToolbarMetrics,
      pageErrors: pageErrors.length,
      screenshots: ['clean', 'saved', 'save-conflict', 'preview', 'import', 'import-mobile', 'mobile-success-notice', 'mobile']
        .map(name => `/tmp/shsat-paper-editor-${name}-${stamp}.png`)
        .concat(`/tmp/shsat-paper-editor-metadata-preservation-${stamp}.png`),
    }));
  } finally {
    if (sourceExamId) await api(page, `/api/admin/exams/${sourceExamId}`, 'DELETE').catch(() => {});
    if (tempUserId) await api(page, `/api/admin/users/${tempUserId}`, 'DELETE').catch(() => {});
    if (metadataPaperId) await api(page, `/api/admin/papers/${metadataPaperId}`, 'DELETE').catch(() => {});
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

function findQuestionSection(sections, paperItemId) {
  for (const section of sections || []) {
    if ((section.questions || []).some(question => Number(question.paperItemId) === Number(paperItemId))) return section;
    const nested = findQuestionSection(section.children, paperItemId);
    if (nested) return nested;
  }
  return null;
}

function toQuestionRequest(question, sortOrder) {
  return {
    questionTypeCode: question.questionTypeCode,
    payloadSchemaVersion: question.payloadSchemaVersion,
    stem: question.stem,
    render: question.render,
    answerKey: question.answerKey,
    grading: question.grading,
    explanation: question.explanation,
    categoryId: question.categoryId,
    sortOrder,
    displayNumber: question.displayNumber,
    maxPoints: question.maxPoints,
    scoringSectionCode: question.scoringSectionCode,
  };
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
