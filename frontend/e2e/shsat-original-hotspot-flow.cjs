const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const sourceHotSpotSpecs = [
  { paperId: 247, questionNumber: 62, image: '27-3b8171c6-53bf-4796-8f68-532393316cb7.png' },
  { paperId: 242, questionNumber: 62, image: '17-7323749a-921f-4dc9-8a78-2233ba655ba4.png' },
  { paperId: 242, questionNumber: 70, image: '17-1a624e0e-b1cf-4541-adda-46200a1a921b.png' },
  { paperId: 241, questionNumber: 63, image: '12-9aac4dcd-48fa-4912-a38e-9ea75d87b862.png' },
];
if (!adminUsername || !adminPassword) throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const studentContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  const student = await studentContext.newPage();
  const pageErrors = [];
  [admin, student].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));
  const stamp = Date.now();
  const suffix = String(stamp).slice(-6);
  const username = `shsat_original_hotspot_${stamp}`;
  const password = `HotSpot${stamp}!`;
  const title = `Original Hot Spot ${suffix}`;
  const screenshotPrefix = `/tmp/shsat-original-hotspot-${stamp}`;
  let userId;
  let classId;
  let paperId;
  let examId;
  let failed = false;

  try {
    await login(admin, adminUsername, adminPassword);
    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Original Hot Spot ${suffix}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Original Hot Spot ${suffix}`, description: 'Temporary source-image Hot Spot verification', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const originalHotSpots = [];
    for (const spec of sourceHotSpotSpecs) {
      const sourcePaper = await api(admin, `/api/admin/papers/${spec.paperId}`);
      const question = flattenSections(sourcePaper.sections).find(item =>
        item.questionTypeCode === 'HOT_SPOT' && Number(item.displayNumber) === spec.questionNumber);
      assert.ok(question, `paper ${spec.paperId} contains original Hot Spot question ${spec.questionNumber}`);
      assert.equal(question.render.questionConfig.imageUrl, `/uploads/paper-materials/${spec.image}`);
      originalHotSpots.push(question);
    }

    const paper = await api(admin, '/api/admin/exam-types/SHSAT/papers', 'POST', {
      paperCode: `ORIGINAL_HOT_SPOT_${stamp}`, title, description: 'Real migrated Hot Spot material and answer key',
      groupId: null, defaultDurationSeconds: 600,
    });
    paperId = Number(paper.summary.id);
    await api(admin, `/api/admin/papers/${paperId}/structure`, 'PUT', { sections: makeSections(originalHotSpots) });
    await api(admin, `/api/admin/papers/${paperId}/seal`, 'POST');

    const release = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary original-image Hot Spot verification',
      opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 600, attemptLimit: 1, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    await student.goto(`${baseUrl}/student/systems/SHSAT`);
    await installFullscreenMock(student);
    const card = student.locator('.student-exam-list article.paper-row').filter({ hasText: title });
    await card.getByRole('button', { name: /Start exam/ }).click();
    await student.waitForURL(url => url.pathname === `/student/shsat/exams/${examId}`);
    await student.locator('.exam-transition-page--pre-attempt .exam-transition-card__button').click();
    await student.getByRole('heading', { name: 'Choose Starting Section', exact: true }).waitFor();
    const sectionChoice = student.locator('.section-choice__actions');
    assert.equal(await sectionChoice.evaluate(element => getComputedStyle(element).display), 'grid',
      'the starting sections are presented as a deliberate choice group');
    assert.equal(await sectionChoice.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2,
      'desktop presents ELA and Math side by side');
    assert.ok(await student.locator('.section-choice__button').first().evaluate(element =>
      parseFloat(getComputedStyle(element).borderRadius) >= 10),
    'section choices use the shared rounded card treatment');
    await student.screenshot({ path: `/tmp/shsat-section-choice-desktop-${stamp}.png` });
    await student.setViewportSize({ width: 390, height: 844 });
    assert.equal(await sectionChoice.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1,
      'mobile stacks the two section choices for readable tap targets');
    assert.ok(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'the section choice fits a 390px viewport');
    await student.screenshot({ path: `/tmp/shsat-section-choice-mobile-${stamp}.png` });
    await student.setViewportSize({ width: 1440, height: 900 });
    const startRequest = student.waitForResponse(response => response.url().endsWith(`/api/student/exams/${examId}/attempts`)
      && response.request().method() === 'POST');
    await student.getByRole('button', { name: /ELA/ }).click();
    const started = await (await startRequest).json();
    const attemptId = Number(started.id || started.attemptId);

    await student.locator('.exam-transition-card__button').click();
    await student.getByText('Choose the correct language answer.', { exact: true }).waitFor();
    await student.locator('.choice-answer__option').first().click();
    await student.getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Section', exact: true }).click();
    await student.waitForFunction(() => document.querySelector('.exam-transition-card__button'));
    await student.locator('.exam-transition-card__button').click();
    const answerScreenshots = [];
    for (let index = 0; index < originalHotSpots.length; index += 1) {
      const question = originalHotSpots[index];
      const expectedImage = question.render.questionConfig.imageUrl;
      const image = student.locator('.hot-spot-answer__stage img');
      await image.waitFor({ state: 'visible' });
      await student.waitForFunction(expected => {
        const element = document.querySelector('.hot-spot-answer__stage img');
        return element?.getAttribute('src') === expected && element.complete && element.naturalWidth > 0;
      }, expectedImage);
      assert.equal(await image.getAttribute('src'), expectedImage);
      const targetLabels = question.answerKey.selectedRegionIds.map(id =>
        question.render.questionConfig.regions.find(region => region.id === id)?.label);
      assert.ok(targetLabels.every(Boolean), 'every answer key region has a selectable label');
      for (const label of targetLabels) {
        const region = student.getByRole('button', { name: label, exact: true });
        await region.click();
        assert.equal(await region.getAttribute('aria-pressed'), 'true', `${label} can be selected`);
      }
      if (index === 0) {
        answerScreenshots.push(`${screenshotPrefix}-desktop.png`);
        await student.screenshot({ path: answerScreenshots[0] });
      }
      if (index < originalHotSpots.length - 1) {
        const answerSaved = student.waitForResponse(response =>
          response.url().includes(`/api/student/attempts/${attemptId}/answers/`) && response.request().method() === 'PUT');
        await student.getByRole('button', { name: 'Next', exact: true }).click();
        assert.equal((await answerSaved).status(), 200, `original Hot Spot ${index + 1} answer saves on navigation`);
      }
    }
    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, `original Hot Spot questions fit mobile: ${JSON.stringify(mobileSize)}`);
    answerScreenshots.push(`${screenshotPrefix}-mobile.png`);
    await student.screenshot({ path: answerScreenshots[1] });
    await student.setViewportSize({ width: 1440, height: 900 });

    const answerSave = student.waitForResponse(response =>
      response.url().includes(`/api/student/attempts/${attemptId}/answers/`) && response.request().method() === 'PUT');
    await student.getByRole('button', { name: 'Submit Exam', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Submit Exam', exact: true }).click();
    assert.equal((await answerSave).status(), 200, 'the original Hot Spot answer saves before submit');
    await student.waitForURL(url => url.pathname === `/student/attempts/${attemptId}/report`);

    const report = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    assert.equal(report.totalScore, 5, 'the ELA and all four original Hot Spot answers receive full credit');
    const hotspotResults = report.questions.filter(question => question.questionType === 'HOT_SPOT');
    assert.equal(hotspotResults.length, originalHotSpots.length);
    for (let index = 0; index < hotspotResults.length; index += 1) {
      assert.equal(hotspotResults[index].correct, true, `original Hot Spot ${index + 1} is scored correctly`);
      assert.deepEqual(JSON.parse(hotspotResults[index].answerData).selectedRegionIds,
        originalHotSpots[index].answerKey.selectedRegionIds);
    }
    await api(admin, `/api/admin/exams/${examId}/close`, 'POST');
    const studentReport = await api(student, `/api/student/attempts/${attemptId}/report`);
    assert.ok(studentReport.questions.filter(question => question.questionType === 'HOT_SPOT').every(question => question.correct));
    await admin.goto(`${baseUrl}/student/attempts/${attemptId}/report`);
    const adminReportPage = admin.locator('.attempt-report');
    await adminReportPage.locator('.question-table tbody tr').first().waitFor();
    const adminReportRows = adminReportPage.locator('.question-table tbody tr');
    assert.equal(await adminReportRows.count(), 5, 'the administrator report displays all five submitted questions');
    assert.equal(await adminReportRows.filter({ hasText: 'Hot Spot' }).count(), 4,
      'the administrator report exposes each original Hot Spot response');
    await admin.screenshot({ path: `${screenshotPrefix}-admin-report.png` });
    await admin.setViewportSize({ width: 390, height: 844 });
    const reportMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(reportMobileSize.page <= reportMobileSize.viewport,
      `the administrator report fits a 390px viewport: ${JSON.stringify(reportMobileSize)}`);
    await admin.screenshot({ path: `${screenshotPrefix}-admin-report-mobile.png` });
    assert.deepEqual(pageErrors, [], 'the original Hot Spot exam has no browser errors');
    await student.screenshot({ path: `${screenshotPrefix}-report.png` });
    console.log(JSON.stringify({
      result: 'PASS', score: report.totalScore, originalHotSpotCount: hotspotResults.length,
      mobileSize, reportMobileSize, pageErrors: pageErrors.length,
      screenshots: [...answerScreenshots, `${screenshotPrefix}-report.png`,
        `${screenshotPrefix}-admin-report.png`, `${screenshotPrefix}-admin-report-mobile.png`],
    }));
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (examId) await api(admin, `/api/admin/exams/${examId}`, 'DELETE').catch(error => cleanupErrors.push(error.message));
    if (classId && userId) await api(admin, `/api/admin/classes/${classId}/students/${userId}`, 'DELETE').catch(error => cleanupErrors.push(error.message));
    if (classId) await api(admin, `/api/admin/classes/${classId}?examTypeCodes=SHSAT`, 'DELETE').catch(error => cleanupErrors.push(error.message));
    if (userId) await api(admin, `/api/admin/users/${userId}`, 'DELETE').catch(error => cleanupErrors.push(error.message));
    if (paperId) await api(admin, `/api/admin/papers/${paperId}`, 'DELETE').catch(error => cleanupErrors.push(error.message));
    await studentContext.close();
    await adminContext.close();
    await browser.close();
    if (cleanupErrors.length) {
      console.error(JSON.stringify({ cleanupErrors }));
      if (!failed) throw new Error(`Temporary test data cleanup failed: ${cleanupErrors.join('; ')}`);
    }
  }
}

function flattenSections(sections) {
  return (sections || []).flatMap(section => [...(section.questions || []), ...flattenSections(section.children)]);
}

function makeSections(originalQuestions) {
  const elaQuestion = {
    questionTypeCode: 'MULTIPLE_CHOICE', payloadSchemaVersion: 1,
    stem: 'Choose the correct language answer.',
    render: { options: [{ key: 'A', text: 'Correct answer' }, { key: 'B', text: 'Incorrect answer' }], questionConfig: {}, validationRules: {} },
    answerKey: { answers: ['A'] }, grading: {}, explanation: 'A is correct.', categoryId: null,
    sortOrder: 0, displayNumber: 1, maxPoints: 1, scoringSectionCode: 'ELA',
  };
  const mathQuestions = originalQuestions.map((question, index) => ({
    ...question, sortOrder: index, displayNumber: index + 2, scoringSectionCode: 'MATH',
  }));
  return [
    { sectionCode: 'ELA', sectionKind: 'PART', title: 'English Language Arts', sortOrder: 0, instructions: null, settings: {}, questions: [], children: [{
      sectionCode: 'ELA_READING', sectionKind: 'SUBTYPE', title: 'Reading and Writing', sortOrder: 0,
      instructions: null, settings: {}, children: [], questions: [elaQuestion],
    }] },
    { sectionCode: 'MATH', sectionKind: 'PART', title: 'Mathematics', sortOrder: 1, instructions: null, settings: {}, questions: [], children: [{
      sectionCode: 'MATH_ARITHMETIC', sectionKind: 'SUBTYPE', title: 'Arithmetic', sortOrder: 0,
      instructions: null, settings: {}, children: [], questions: mathQuestions,
    }] },
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
