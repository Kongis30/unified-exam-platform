const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  let studentPage;

  const stamp = Date.now();
  const stem = `Image material import ${stamp}`;
  let sourcePaperId;
  let targetPaperId;
  let draftTargetPaperId;
  let examId;
  let studentId;
  let classId;
  let groupId;
  const groupedPaperIds = [];
  let uploadedAssetUrl;
  try {
    await login(page);
    sourcePaperId = Number((await createPaper(page, `IMPORT_IMAGE_SOURCE_${stamp}`, `Image Source ${stamp}`)).summary.id);
    targetPaperId = Number((await createPaper(page, `IMPORT_IMAGE_TARGET_${stamp}`, `Image Target ${stamp}`)).summary.id);
    draftTargetPaperId = Number((await createPaper(page, `IMPORT_DRAFT_TARGET_${stamp}`, `Draft Target ${stamp}`)).summary.id);
    const group = await api(page, '/api/admin/exam-types/SHSAT/paper-groups', 'POST', {
      name: `Import Folder ${stamp}`, description: 'Temporary grouping test', sortOrder: 0,
    });
    groupId = Number(group.id);
    for (const title of [`Zulu ${stamp}`, `Alpha ${stamp}`]) {
      const grouped = await createPaper(page, `GROUP_${title.split(' ')[0]}_${stamp}`, title, groupId);
      groupedPaperIds.push(Number(grouped.summary.id));
    }

    const imageBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      context.fillStyle = '#eaf1ff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#183b72';
      context.font = '20px sans-serif';
      context.fillText('Imported image material', 18, 68);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const uploadedImage = await uploadMaterialImage(page, sourcePaperId, imageBase64);
    uploadedAssetUrl = uploadedImage.assetUrl;
    assert.match(uploadedImage.assetUrl, /\/uploads\/paper-materials\//,
      'the temporary source image is stored as a paper material asset');

    const sourceDetail = await api(page, `/api/admin/papers/${sourcePaperId}`);
    const sourceSections = sourceDetail.sections.map((part, partIndex) => ({
      ...toSectionRequest(part),
      sortOrder: partIndex,
      children: part.children.map((subtype, subtypeIndex) => ({
        ...toSectionRequest(subtype),
        sortOrder: subtypeIndex,
        questions: part.sectionCode === 'ELA' && subtypeIndex === 0
          ? [imageQuestion(stem)]
          : [],
      })),
    }));
    await api(page, `/api/admin/papers/${sourcePaperId}/structure`, 'PUT', {
      materials: [{
        clientRef: 'import-image-material', partCode: 'ELA',
        subTypeCode: sourceDetail.sections[0].children[0].settings?.subTypeCode,
        materialType: 'IMAGE', title: `Image material ${stamp}`,
        content: null, assetUrl: uploadedImage.assetUrl, sortOrder: 0,
      }],
      sections: sourceSections,
    });
    // 未发布过考试的草稿试卷也应可选、可预览；取消后不改变目标试卷。
    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${draftTargetPaperId}/edit`);
    await page.getByRole('heading', { name: `Draft Target ${stamp}`, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Import from Paper', exact: true }).click();
    await page.getByRole('heading', { name: 'Import questions', exact: true }).waitFor();
    const sourceSelect = page.locator('.import-source-select select');
    await sourceSelect.locator('optgroup', { hasText: `Alpha ${stamp}` }).waitFor({ state: 'attached' });
    const groupOptions = await sourceSelect.locator(`optgroup[label="Import Folder ${stamp}"] option`).allTextContents();
    assert.deepEqual(groupOptions.map(text => text.trim()), [`Alpha ${stamp}`, `Zulu ${stamp}`],
      'source papers are grouped by folder and sorted by name');
    assert.ok(await sourceSelect.locator('optgroup[label="Default Folder"]').count(),
      'ungrouped papers are listed under Default Folder');
    await sourceSelect.selectOption(String(sourcePaperId));
    await page.getByText('No exam performance data is available for this paper.').waitFor();
    await page.locator('.import-question-row').first().waitFor();
    const draftNumber = Number((await page.locator('.import-question-row').first().innerText()).match(/Q(\d+)/)?.[1]);
    await page.getByLabel(`Select question ${draftNumber}`, { exact: true }).check();
    await page.getByRole('button', { name: 'Add 1 questions', exact: true }).click();
    await page.getByText('1 questions added from', { exact: false }).waitFor();
    assert.ok(readQuestions(await api(page, `/api/admin/papers/${draftTargetPaperId}`)).some(question => question.stem === stem),
      'a draft paper without an exam can be imported');
    await api(page, `/api/admin/papers/${sourcePaperId}/seal`, 'POST');
    const student = await api(page, '/api/admin/users', 'POST', {
      username: `imageimport${stamp}@jin`, password: `Image-Import-${stamp}-Pass!`,
      realName: `Image Import ${stamp}`, roleCode: 'STUDENT', email: null, phone: null, workspaceCodes: ['SHSAT'],
    });
    studentId = Number(student.id);
    const classroom = await api(page, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Image Import Class ${stamp}`, description: 'Temporary import test', sortOrder: 999, active: true,
    });
    classId = Number(classroom.classId || classroom.id);
    await api(page, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: studentId });
    const release = await api(page, `/api/admin/papers/${sourcePaperId}/exams`, 'POST', {
      title: `Image Import Source ${stamp}`,
      description: 'Temporary source exam for image material import regression',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 10_800,
      attemptLimit: 1,
      targetScope: 'SELECTED',
    });
    examId = Number(release.summary.id);
    await api(page, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(page, `/api/admin/exams/${examId}/publish`, 'POST');
    studentPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    studentPage.on('pageerror', error => pageErrors.push(error.message));
    await login(studentPage, `imageimport${stamp}@jin`, `Image-Import-${stamp}-Pass!`);
    const attempt = await api(studentPage, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    const attemptId = Number(attempt.id || attempt.attemptId);
    const sourceQuestion = readQuestions(await api(page, `/api/admin/papers/${sourcePaperId}`)).find(q => q.stem === stem);
    await api(studentPage, `/api/student/attempts/${attemptId}/answers/${sourceQuestion.paperItemId}`, 'PUT', {
      answer: { answers: ['A'] }, timeSpentSeconds: 12,
    });
    await api(studentPage, `/api/student/attempts/${attemptId}/submit`, 'POST');
    await api(page, `/api/admin/exams/${examId}/close`, 'POST');

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/papers/${targetPaperId}/edit`);
    await page.getByRole('heading', { name: `Image Target ${stamp}`, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Import from Paper', exact: true }).click();
    await page.getByRole('heading', { name: 'Import questions', exact: true }).waitFor();
    await page.locator('.import-source-select select').selectOption(String(sourcePaperId));
    const row = page.locator('.import-question-row').first();
    await row.waitFor();
    assert.match(await row.innerText(), /1 \/ 1 answered/, 'the closed exam retains its student performance data');
    const questionNumber = Number((await row.innerText()).match(/Q(\d+)/)?.[1]);
    assert.ok(questionNumber > 0, 'the source image question is listed for import');
    await page.getByLabel(`Select question ${questionNumber}`, { exact: true }).check();
    await page.getByRole('button', { name: 'Add 1 questions', exact: true }).click();
    await page.getByText('1 questions added from', { exact: false }).waitFor();

    const targetDetail = await api(page, `/api/admin/papers/${targetPaperId}`);
    const imported = readQuestions(targetDetail).find(question => question.stem === stem);
    assert.ok(imported, 'the source question was copied into the target paper');
    assert.notEqual(String(imported.render.materialId), String(readQuestions(sourceDetail).find(q => q.stem === stem)?.render.materialId),
      'the imported question points to its own target-paper material record');
    const targetMaterial = targetDetail.materials.find(material => String(material.id) === String(imported.render.materialId));
    assert.ok(targetMaterial, 'the copied image material belongs to the target paper');
    assert.equal(targetMaterial.materialType.toUpperCase(), 'IMAGE');
    assert.equal(targetMaterial.title, `Image material ${stamp}`);
    assert.equal(targetMaterial.assetUrl, uploadedImage.assetUrl,
      'the imported material keeps its valid image asset URL');

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/papers/${targetPaperId}/preview`));
    const image = page.locator('.material-section img');
    await image.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const img = document.querySelector('.material-section img');
      return img?.complete && img.naturalWidth === 320;
    });
    await page.screenshot({ path: `/tmp/shsat-import-image-material-${stamp}.png` });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      imageWidth: document.querySelector('.material-section img')?.getBoundingClientRect().width || 0,
    }));
    assert.ok(mobile.pageWidth <= mobile.viewportWidth, `the imported image preview fits 390px: ${JSON.stringify(mobile)}`);
    assert.ok(mobile.imageWidth > 0 && mobile.imageWidth <= mobile.viewportWidth,
      `the image remains visible on mobile: ${JSON.stringify(mobile)}`);
    await page.screenshot({ path: `/tmp/shsat-import-image-material-mobile-${stamp}.png` });
    assert.deepEqual(pageErrors, [], `the browser reports no page errors: ${pageErrors.join('; ')}`);
    console.log(JSON.stringify({
      passed: true,
      sourcePaperId,
      targetPaperId,
      examId,
      imageUrl: uploadedImage.assetUrl,
      desktopScreenshot: `/tmp/shsat-import-image-material-${stamp}.png`,
      mobileScreenshot: `/tmp/shsat-import-image-material-mobile-${stamp}.png`,
      pageErrors: pageErrors.length,
    }, null, 2));
  } finally {
    if (examId) await api(page, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (studentPage) await studentPage.close().catch(() => {});
    if (classId && studentId) await api(page, `/api/admin/classes/${classId}/students/${studentId}`, 'DELETE').catch(() => {});
    if (classId) await api(page, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (studentId) await api(page, `/api/admin/users/${studentId}`, 'DELETE').catch(() => {});
    for (const id of groupedPaperIds) await api(page, `/api/admin/papers/${id}`, 'DELETE').catch(() => {});
    if (groupId) await api(page, `/api/admin/paper-groups/${groupId}`, 'DELETE').catch(() => {});
    if (draftTargetPaperId) await api(page, `/api/admin/papers/${draftTargetPaperId}`, 'DELETE').catch(() => {});
    if (targetPaperId) await api(page, `/api/admin/papers/${targetPaperId}`, 'DELETE').catch(() => {});
    if (sourcePaperId) await api(page, `/api/admin/papers/${sourcePaperId}`, 'DELETE').catch(() => {});
    if (uploadedAssetUrl?.startsWith('/uploads/paper-materials/')) {
      const fileName = path.basename(uploadedAssetUrl);
      for (const directory of ['../../backend/uploads/paper-materials', '../../uploads/paper-materials']) {
        fs.rmSync(path.resolve(__dirname, directory, fileName), { force: true });
      }
    }
    await browser.close();
  }
}

async function login(page, loginUsername = username, loginPassword = password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(loginUsername);
  await page.getByLabel('Password').fill(loginPassword);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

async function createPaper(page, code, title, groupId = null) {
  return api(page, '/api/admin/exam-types/SHSAT/papers', 'POST', {
    paperCode: code, title, description: 'Temporary image material import test',
    groupId, defaultDurationSeconds: 1_200,
  });
}

async function uploadMaterialImage(page, paperId, imageBase64) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  const result = await page.evaluate(async ({ paperId, imageBase64, token }) => {
    const form = new FormData();
    const bytes = Uint8Array.from(atob(imageBase64), character => character.charCodeAt(0));
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'import-image.png');
    const response = await fetch(`/api/admin/papers/${paperId}/materials/images`, {
      method: 'POST', credentials: 'same-origin', headers: { 'X-XSRF-TOKEN': token }, body: form,
    });
    return { status: response.status, body: await response.text() };
  }, { paperId, imageBase64, token });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`POST image upload failed: ${result.status} ${result.body}`);
  }
  return JSON.parse(result.body);
}

async function api(page, path, method = 'GET', body) {
  const token = await page.evaluate(async () => (await (await fetch('/api/auth/csrf')).json()).token);
  const result = await page.evaluate(async ({ path, method, body, token }) => {
    const response = await fetch(path, {
      method, credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) ? { 'X-XSRF-TOKEN': token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, text: await response.text() };
  }, { path, method, body, token });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${method} ${path}: ${result.status} ${result.text}`);
  }
  return result.text ? JSON.parse(result.text) : null;
}

function toSectionRequest(section) {
  return {
    sectionCode: section.sectionCode,
    sectionKind: section.sectionKind,
    title: section.title,
    sortOrder: section.sortOrder,
    instructions: section.instructions,
    settings: section.settings,
    questions: [],
    children: [],
  };
}

function imageQuestion(stem) {
  return {
    questionTypeCode: 'MULTIPLE_CHOICE',
    payloadSchemaVersion: 1,
    stem,
    render: {
      materialRef: 'import-image-material',
      options: [{ key: 'A', text: 'Option A' }, { key: 'B', text: 'Option B' }],
      questionConfig: {},
      validationRules: {},
    },
    answerKey: { answers: ['A'] },
    grading: {},
    explanation: 'A is correct.',
    categoryId: null,
    sortOrder: 0,
    displayNumber: 1,
    maxPoints: 1,
    scoringSectionCode: 'ELA',
  };
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

main().catch(error => { console.error(error.stack || error); process.exit(1); });
