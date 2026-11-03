const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const paperId = 240;
const missingAssetUrl = '/uploads/paper-materials/1-3fd064f7-8a98-4296-8f5c-4a2c6c61d0d7.jpg';

if (!adminUsername || !adminPassword) {
  throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');
}

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
  const username = `shsat_missing_image_${stamp}`;
  const password = `MissingImage${stamp}!`;
  const title = `Missing Material Image ${stamp}`;
  let userId;
  let classId;
  let examId;
  let attemptId;

  try {
    await login(admin, adminUsername, adminPassword);
    const paper = await api(admin, `/api/admin/papers/${paperId}`);
    const imageMaterial = paper.materials.find(material => material.assetUrl === missingAssetUrl);
    assert.ok(imageMaterial, 'the migrated paper retains the source material reference');
    const linkedQuestions = flattenSections(paper.sections).filter(question => Number(question.render?.materialId) === imageMaterial.id);
    assert.ok(linkedQuestions.length > 0, 'the missing image material is used by migrated questions');
    const missingAssetStatus = await admin.evaluate(async assetUrl => (await fetch(assetUrl)).status, missingAssetUrl);
    assert.equal(missingAssetStatus, 404, 'the source image is unavailable in the local upload store');

    const user = await api(admin, '/api/admin/users', 'POST', {
      username, password, realName: `Missing Image ${stamp}`, roleCode: 'STUDENT', email: null, phone: null,
    });
    userId = Number(user.id);
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `Missing Image ${stamp}`, description: 'Temporary missing material report test', sortOrder: 0,
      teacherName: null, teacherEmail: null, gradeLevel: null, academicYear: null, active: true,
    });
    classId = Number(classroom.id);
    await api(admin, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: userId });

    const release = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
      title, description: 'Temporary missing material report test',
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      durationSeconds: 10_800, attemptLimit: 1, targetScope: 'SELECTED', autoSubmit: true, allowReview: true,
    });
    examId = Number(release.summary.id);
    await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', { classIds: [classId], studentUserIds: [] });
    await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');

    await login(student, username, password);
    const started = await api(student, `/api/student/exams/${examId}/attempts`, 'POST', { firstSection: 'ELA' });
    attemptId = Number(started.id || started.attemptId);
    await api(student, `/api/student/attempts/${attemptId}/submit`, 'POST');
    await student.goto(`${baseUrl}/student/attempts/${attemptId}/report`);
    await student.getByText('Result Summary', { exact: true }).waitFor();

    const studentReport = await api(student, `/api/student/attempts/${attemptId}/report`);
    const reportImageQuestionCount = studentReport.questions.filter(question => question.assetUrl === missingAssetUrl).length;
    assert.ok(reportImageQuestionCount > 0,
      'the report preserves the unavailable image reference for the affected questions');
    const unavailableImages = student.locator('.question-preview__image-unavailable');
    await unavailableImages.first().waitFor();
    assert.ok(await unavailableImages.count() >= reportImageQuestionCount,
      'every question using the broken material displays an English fallback');
    assert.equal(await student.locator(`.question-preview__image[src="${missingAssetUrl}"]`).count(), 0,
      'the report removes broken image elements after the load error');
    const desktopScreenshot = `/tmp/shsat-missing-material-report-${stamp}-desktop.png`;
    await student.screenshot({ path: desktopScreenshot, fullPage: true });

    await student.setViewportSize({ width: 390, height: 844 });
    const mobileSize = await student.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(mobileSize.page <= mobileSize.viewport, `the report fits a 390px viewport: ${JSON.stringify(mobileSize)}`);
    const mobileScreenshot = `/tmp/shsat-missing-material-report-${stamp}-mobile.png`;
    await student.screenshot({ path: mobileScreenshot, fullPage: true });

    await admin.goto(`${baseUrl}/student/attempts/${attemptId}/report?adminReport=1`);
    await admin.getByText('Result Summary', { exact: true }).waitFor();
    const adminReport = await api(admin, `/api/admin/reports/attempts/${attemptId}/result`);
    const adminImageQuestionCount = adminReport.questions.filter(question => question.assetUrl === missingAssetUrl).length;
    assert.ok(adminImageQuestionCount > 0, 'the admin report also receives migrated material image references');
    await admin.locator('.question-preview__image').evaluateAll(images => {
      images.forEach(image => { image.loading = 'eager'; });
    });
    const adminUnavailableImages = admin.locator('.question-preview__image-unavailable');
    await adminUnavailableImages.first().waitFor();
    assert.ok(await adminUnavailableImages.count() >= adminImageQuestionCount,
      'the admin report gives the same English fallback for missing image files');
    const adminDesktopScreenshot = `/tmp/shsat-missing-material-report-${stamp}-admin-desktop.png`;
    await admin.screenshot({ path: adminDesktopScreenshot, fullPage: true });
    await admin.setViewportSize({ width: 390, height: 844 });
    const adminMobileSize = await admin.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(adminMobileSize.page <= adminMobileSize.viewport,
      `the admin report fits a 390px viewport: ${JSON.stringify(adminMobileSize)}`);
    const adminMobileScreenshot = `/tmp/shsat-missing-material-report-${stamp}-admin-mobile.png`;
    await admin.screenshot({ path: adminMobileScreenshot, fullPage: true });
    assert.deepEqual(pageErrors, [], 'the report renders without browser errors');

    console.log(JSON.stringify({
      result: 'PASS', paperId, affectedQuestions: linkedQuestions.map(question => question.displayNumber),
      reportImageQuestionCount, adminImageQuestionCount, missingAssetStatus, mobileSize, adminMobileSize,
      pageErrors: pageErrors.length,
      screenshots: [desktopScreenshot, mobileScreenshot, adminDesktopScreenshot, adminMobileScreenshot],
    }));
  } finally {
    const cleanupErrors = [];
    const remove = async path => {
      try {
        await api(admin, path, 'DELETE');
      } catch (error) {
        cleanupErrors.push(`${path}: ${error.message}`);
      }
    };
    if (examId) await remove(`/api/admin/exams/${examId}`);
    if (classId && userId) await remove(`/api/admin/classes/${classId}/students/${userId}`);
    if (classId) await remove(`/api/admin/classes/${classId}?examTypeCodes=SHSAT`);
    if (userId) await remove(`/api/admin/users/${userId}`);
    await studentContext.close();
    await adminContext.close();
    await browser.close();
    assert.deepEqual(cleanupErrors, [], 'all temporary report test records are removed');
  }
}

function flattenSections(sections = []) {
  return sections.flatMap(section => [...(section.questions || []), ...flattenSections(section.children || [])]);
}

async function login(page, username, password) {
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

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
