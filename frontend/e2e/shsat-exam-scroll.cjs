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
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const pageErrors = [];
  [admin, student].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  const stamp = Date.now();
  const suffix = String(stamp).slice(-6);
  const username = `shsat_hotspot_${stamp}`;
  const password = `HotSpot${stamp}!`;
  const title = `Hot Spot Flow ${suffix}`;
  let userId;
  let classId;
  let paperId;
  let examId;
  let attemptId;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Hot Spot Student ${suffix}`, roleCode: 'STUDENT', email: null, phone: null, workspaceCodes: ['SHSAT'],
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Hot Spot ${suffix}`, description: 'Temporary Hot Spot question flow test', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const paper = await api(admin, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `HOT_SPOT_FLOW_${stamp}`, title, description: 'Temporary Hot Spot interaction and scoring test',
      groupId: null, defaultDurationSeconds: 600,
    });
    paperId = Number(paper.summary.id);
    await api(admin, `/api/admin/papers/${paperId}/structure`, 'PUT', { sections: makeSections(), expectedRevision: paper.structureRevision });
    await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');

    const release = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary Hot Spot question flow test',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 600, attemptLimit: 1, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await student.route('**/uploads/paper-materials/scroll-test.svg', route => route.fulfill({
      status: 200, contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="1800"><rect width="320" height="1800" fill="white"/><text x="30" y="1750">End of tall diagram</text></svg>',
    }));
    await login(student, username, password);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await installFullscreenMock(student);
    await student.goto(`${baseUrl}/student/shsat/exams/${examId}`);
    await installFullscreenMock(student);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
    const startRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const startResponse = await startRequest;
    assert.equal(startResponse.status(), 200);
    const started = await startResponse.json();
    attemptId = Number(started.id || started.attemptId);

    await student.locator('.exam-transition-card__button').click();
    await student.locator('.question-text').waitFor();
    const image = student.locator('.question-text .mixed-content__image');
    await image.waitFor({ state: 'visible' });
    const content = student.locator('.main-layout__content');
    const answer = student.locator('.choice-answer__option').last();
    for (const viewport of [{ width: 1440, height: 720 }, { width: 390, height: 700 }]) {
      await student.setViewportSize(viewport);
      await content.evaluate(element => { element.scrollTop = 0; });
      const metrics = await content.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, overflow: getComputedStyle(element).overflowY }));
      assert.equal(metrics.overflow, 'auto', 'SHSAT exam content allows vertical scrolling');
      assert.ok(metrics.scrollHeight > metrics.height, `long image exceeds viewport: ${JSON.stringify(metrics)}`);
      await student.mouse.move(viewport.width / 2, viewport.height / 2);
      await student.mouse.wheel(0, 5000);
      await student.waitForFunction(() => document.querySelector('.main-layout__content')?.scrollTop > 0);
      const box = await answer.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, `answer remains reachable after wheel scroll: ${JSON.stringify(box)}`);
      await answer.click();
      assert.deepEqual(pageErrors, [], 'scrolling and choosing an answer causes no browser errors');
    }
    console.log(JSON.stringify({ result: 'PASS', checks: ['desktop and mobile scroll to long image answers', 'answer can be selected'] }));
  } finally {
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(() => {});
    if (classId && userId) await api(admin, `/api/admin/classes/${classId}/students/${userId}`, 'DELETE').catch(() => {});
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(() => {});
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(() => {});
    if (paperId) await api(admin, `/api/admin/papers/${paperId}`, 'DELETE').catch(() => {});
    await studentContext.close();
    await adminContext.close();
    await browser.close();
  }
}

function makeSections() {
  const passageImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#eef4ff"/><text x="20" y="86" font-size="22" fill="#1e293b">Material image preview</text></svg>')}`;
  return [
    {
      sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0,
      instructions: null, settings: {}, questions: [],
      children: [{
        sectionCode: 'ELA_REVIEW', sectionKind: 'SUBTYPE', title: 'Reading and Writing', sortOrder: 0,
        instructions: null, settings: {}, children: [],
        questions: [{
          questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
          stem: 'Choose the correct language answer.\n[[STEM_IMAGE:/uploads/paper-materials/scroll-test.svg]]',
          render: { options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Incorrect answer' }], questionConfig: {}, validationRules: {} },
          answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is correct.', categoryId: null,
          sortOrder: 0, displayNumber: 1, maxPoints: 1, scoringSectionCode: 'ELA',
        }],
      }],
    },
    {
      sectionCode: 'MATH', sectionKind: 'PART', title: 'Mathematics', sortOrder: 1,
      instructions: null, settings: {}, questions: [],
      children: [{
        sectionCode: 'MATH_GEOMETRY', sectionKind: 'SUBTYPE', title: 'Geometry', sortOrder: 0,
        instructions: null, settings: {}, children: [],
        questions: [{
          questionTypeCode: 'HOT_SPOT', payloadSchemaVersion: 1,
          stem: 'Select the shaded target area.',
          render: { material: { title: 'Drawing Passage', category: 'Reading Passage', content: `Drawing Passage\n\nA short passage for testing the drawing tool.\n[[MATERIAL_IMAGE:${passageImage}]]` }, questionConfig: {
            selectionMode: 'single',
            imageUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#eef4ff"/><text x="20" y="40" font-size="20" fill="#1e293b">Select the blue square</text><rect x="96" y="96" width="64" height="64" rx="8" fill="#3275f6"/></svg>')}`,
            regions: [{ id: 'target-region', label: 'Target area', shape: 'rect', x: 0.3, y: 0.4, width: 0.2, height: 0.27 }],
          }, validationRules: {} },
          answerKey: { selectedRegionIds: ['target-region'] }, grading: {}, explanation: 'The blue square is the target area.', categoryId: null,
          sortOrder: 0, displayNumber: 58, maxPoints: 1, scoringSectionCode: 'MATH',
        }],
      }],
    },
  ];
}

async function login(page, username, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

async function installFullscreenMock(page) {
  await page.evaluate(() => {
    let activeElement = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => activeElement });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    document.documentElement.requestFullscreen = async function () {
      activeElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    document.exitFullscreen = async () => {
      activeElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
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
