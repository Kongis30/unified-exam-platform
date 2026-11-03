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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const failedResponses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      failedResponses.push({ status: response.status(), url: response.url() });
    }
  });
  const stamp = Date.now();

  try {
    await login(page);
    const classes = asList(await api(page, '/api/admin/classes?examTypeCodes=SHSAT'));
    const candidates = await Promise.all(classes.map(async classroom => {
      const classId = Number(classroom.classId || classroom.id);
      const [exams, students] = await Promise.all([
        api(page, `/api/admin/classes/${classId}/exams?examTypeCodes=SHSAT`),
        api(page, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`),
      ]);
      return { classroom, classId, exams: asList(exams), students: asList(students) };
    }));
    const sample = candidates
      .filter(candidate => candidate.exams.length >= 6
        && candidate.students.some(student => Number(student.examCount || 0) === 0))
      .sort((left, right) => right.exams.length - left.exams.length)[0];
    assert.ok(sample, 'read-only class data includes at least six exams and a student with no attempts');

    await page.goto(`${baseUrl}/exam-types/SHSAT/admin/classes/${sample.classId}`);
    await page.getByRole('heading', { name: sample.classroom.name, exact: true }).waitFor();
    const examTable = page.locator('.class-exam-table');
    const rows = examTable.locator('tbody tr');
    const examTitles = () => examTable.locator('.class-exam-table__exam-title').allTextContents();
    const displayTitle = exam => /^\d+$/.test(String(exam.examTitle || '').trim()) && exam.paperName
      ? exam.paperName : exam.examTitle || exam.paperName || 'Untitled exam';
    const apiSorted = [...sample.exams].sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime));
    assert.deepEqual((await examTitles()).map(title => title.trim()), apiSorted.map(displayTitle),
      'class detail initially sorts exams newest first');

    const expiredHiddenExam = sample.exams.find(exam => exam.published === false
      && Date.parse(exam.endTime) < Date.now());
    assert.ok(expiredHiddenExam, 'sample includes an ended exam that has been automatically unpublished');
    const expiredRow = examTable.locator('tbody tr')
      .filter({ hasText: displayTitle(expiredHiddenExam) }).first();
    assert.equal(await expiredRow.locator('.exam-status-pill').innerText(), 'Ended',
      'class exam status communicates that an automatically unpublished exam has ended');

    const search = page.getByPlaceholder('Search by exam name or paper');
    const uniqueExam = sample.exams.find(exam =>
      sample.exams.filter(candidate => candidate.examTitle === exam.examTitle).length === 1);
    assert.ok(uniqueExam, 'sample includes a unique exam title for the search check');
    await search.fill(uniqueExam.examTitle);
    assert.equal(await rows.count(), 1, 'search filters the class exam list');
    await search.fill(`No matching SHSAT exam ${stamp}`);
    await page.getByText('No class exams yet', { exact: true }).waitFor();
    await search.clear();

    const sort = page.getByRole('combobox', { name: 'Sort class exams' });
    await sort.selectOption('start-asc');
    const oldestFirst = [...sample.exams].sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
    assert.deepEqual((await examTitles()).map(title => title.trim()), oldestFirst.map(displayTitle),
      'oldest-first sorting matches API timestamps');
    await sort.selectOption('start-desc');

    const pageSize = page.getByRole('combobox', { name: 'Class exam rows per page' });
    await pageSize.selectOption('5');
    assert.equal(await rows.count(), 5, 'page size limits the visible exam rows');
    const pagination = page.locator('.class-exams-card .table-pagination');
    assert.match(await pagination.innerText(), /Page 1 \/ 2/);
    await pagination.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await rows.count(), sample.exams.length - 5, 'the second page contains the remaining exams');
    assert.match(await pagination.innerText(), /Page 2 \/ 2/);
    await pagination.getByRole('button', { name: 'Prev', exact: true }).click();
    await alignCardTitle(page);
    await page.screenshot({ path: `/tmp/shsat-class-detail-exams-desktop-${stamp}.png` });

    const firstRow = rows.first();
    const firstVisibleTitle = (await firstRow.locator('.class-exam-table__exam-title').innerText()).trim();
    assert.equal(firstVisibleTitle, displayTitle(apiSorted[0]), 'first page first row matches newest exam');
    const firstExamId = Number(apiSorted[0].examId);
    await page.evaluate(() => window.scrollTo(0, 300));
    const viewResultsButton = firstRow.getByRole('button', { name: 'View Results', exact: true });
    await viewResultsButton.scrollIntoViewIfNeeded();
    const classDetailScrollY = await page.evaluate(() => window.scrollY);
    assert.ok(classDetailScrollY >= 100, 'class detail is scrolled before opening a child page');
    await viewResultsButton.click();
    await page.waitForURL(url => url.pathname.endsWith(`/classes/${sample.classId}/exams/${firstExamId}/results`));
    const resultsHero = page.locator('.class-results-hero');
    await resultsHero.waitFor();
    await page.getByRole('heading', { name: apiSorted[0].examTitle, exact: true }).waitFor();
    await page.locator('.class-results-page__subtitle').getByText(sample.classroom.name, { exact: true }).waitFor();
    const resultsHeroText = await resultsHero.innerText();
    if (!resultsHeroText.includes(sample.classroom.name)) {
      await page.screenshot({ path: `/tmp/shsat-class-detail-exams-results-error-${stamp}.png` });
      console.error(JSON.stringify({ failedResponses, errorText: await page.locator('.admin-state--error').allInnerTexts() }));
    }
    assert.ok(resultsHeroText.includes(sample.classroom.name),
      `results page identifies its source class (${sample.classroom.name}); rendered: ${resultsHeroText}`);
    assert.ok(resultsHeroText.includes(apiSorted[0].examTitle),
      `results page identifies the selected exam (${apiSorted[0].examTitle}); rendered: ${resultsHeroText}`);
    assert.doesNotMatch(await page.locator('.class-results-page__meta').innerText(), /\b(?:AM|PM)\b/,
      'class results display the exam window in 24-hour time');
    await page.screenshot({ path: `/tmp/shsat-class-detail-exams-results-${stamp}.png` });
    await page.getByRole('button', { name: 'Back to Class Detail', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/classes/${sample.classId}`));
    await page.getByRole('heading', { name: sample.classroom.name, exact: true }).waitFor();
    assert.equal(await search.inputValue(), '', 'returning from results preserves the cleared search state');
    assert.equal(await sort.inputValue(), 'start-desc', 'returning from results preserves newest-first sorting');
    assert.equal(await pageSize.inputValue(), '5', 'returning from results preserves the selected page size');
    assert.equal(await rows.count(), 5, 'returning from results restores the first page of filtered exams');
    assert.match(await pagination.innerText(), /Page 1 \/ 2/, 'returning from results restores the original pagination page');
    const resultsReturnScrollY = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(resultsReturnScrollY - classDetailScrollY) <= 2,
      `returning from results restores the class detail scroll position (${classDetailScrollY} -> ${resultsReturnScrollY})`);

    await page.locator('.class-exam-table tbody tr').first().getByRole('button', { name: 'Monitor', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/exams/${firstExamId}/monitor`));
    await page.getByRole('heading', { name: apiSorted[0].examTitle, exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('.exam-info-meta').innerText(), /\b(?:AM|PM)\b/,
      'the monitor exam window uses 24-hour time');
    await page.screenshot({ path: `/tmp/shsat-class-detail-exams-monitor-${stamp}.png` });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/classes/${sample.classId}`));
    assert.equal(await search.inputValue(), '', 'returning from Monitor preserves the cleared search state');
    assert.equal(await sort.inputValue(), 'start-desc', 'returning from Monitor preserves newest-first sorting');
    assert.equal(await pageSize.inputValue(), '5', 'returning from Monitor preserves the selected page size');
    assert.equal(await rows.count(), 5, 'returning from Monitor restores the first page of exams');
    assert.match(await pagination.innerText(), /Page 1 \/ 2/, 'returning from Monitor restores the original pagination page');
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - classDetailScrollY) <= 2,
      'returning from Monitor restores the class detail scroll position');

    const student = sample.students.find(item => Number(item.examCount || 0) === 0);
    const studentName = student.studentName || student.realName || student.name;
    const studentId = Number(student.studentId || student.id);
    assert.ok(studentName && studentId, 'sample class includes an identifiable student with no attempts');
    const studentViewButton = page.locator('.student-table tbody tr')
      .filter({ hasText: studentName })
      .getByRole('button', { name: 'View', exact: true });
    await studentViewButton.scrollIntoViewIfNeeded();
    const studentDetailScrollY = await page.evaluate(() => window.scrollY);
    await studentViewButton.click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/classes/${sample.classId}/students/${studentId}`));
    await page.getByRole('heading', { name: studentName, exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Score Statistics', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Unable to Load History', exact: true }).count(), 0,
      'student detail loads the account history instead of showing an error');
    assert.deepEqual(await page.locator('.summary-grid dd').allTextContents(), ['0', '0', '-', '-'],
      'a student with no attempts has empty score values instead of NaN');
    await page.getByText('No completed attempts to chart yet.', { exact: true }).waitFor();
    await page.getByText('This student has no exam attempts yet.', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/shsat-class-detail-student-desktop-${stamp}.png` });
    await page.screenshot({ path: `/tmp/shsat-empty-student-detail-desktop-${stamp}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Back to Class Detail', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/classes/${sample.classId}`));
    await page.getByRole('heading', { name: sample.classroom.name, exact: true }).waitFor();
    assert.equal(await search.inputValue(), '', 'returning from Student Detail preserves the cleared search state');
    assert.equal(await sort.inputValue(), 'start-desc', 'returning from Student Detail preserves newest-first sorting');
    assert.equal(await pageSize.inputValue(), '5', 'returning from Student Detail preserves the selected page size');
    assert.equal(await rows.count(), 5, 'returning from Student Detail restores the first page of exams');
    assert.match(await pagination.innerText(), /Page 1 \/ 2/, 'returning from Student Detail restores the pagination page');
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - studentDetailScrollY) <= 2,
      'returning from Student Detail restores the class detail scroll position');

    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, 'class detail fits a 390px viewport');
    await alignCardTitle(page);
    const toolbarGeometry = await page.evaluate(() => {
      const search = document.querySelector('.class-exams-toolbar__search').getBoundingClientRect();
      const filters = document.querySelector('.class-exams-toolbar .admin-toolbar__filters').getBoundingClientRect();
      const searchInput = document.querySelector('.class-search-input');
      const input = searchInput.getBoundingClientRect();
      const inputStyle = getComputedStyle(searchInput);
      return { gap: filters.top - search.bottom, leftOffset: Math.abs(filters.left - search.left),
        searchInput: { top: input.top, height: input.height, width: input.width, display: inputStyle.display,
          opacity: inputStyle.opacity, visibility: inputStyle.visibility, borderColor: inputStyle.borderColor,
          borderWidth: inputStyle.borderWidth, background: inputStyle.backgroundColor } };
    });
    assert.ok(toolbarGeometry.gap >= 0 && toolbarGeometry.gap <= 20,
      `mobile filters should sit directly below search, got ${toolbarGeometry.gap}px`);
    assert.ok(toolbarGeometry.leftOffset <= 1, 'mobile search and filters share the same left edge');
    const mobileTableWidth = await examTable.evaluate(table => ({ content: table.scrollWidth, visible: table.clientWidth }));
    assert.ok(mobileTableWidth.content <= mobileTableWidth.visible, 'mobile exam cards do not require horizontal scrolling');
    const mobileCardWidth = await rows.first().evaluate(row => row.getBoundingClientRect().width);
    assert.ok(mobileCardWidth >= 250, `mobile exam card uses the available content width, got ${mobileCardWidth}px`);
    assert.equal(await rows.first().locator('td').count(), 5, 'mobile cards retain all exam fields');
    assert.ok(await rows.first().getByRole('button', { name: 'View Results', exact: true }).isVisible(),
      'mobile results action remains visible');
    assert.ok(await rows.first().getByRole('button', { name: 'Monitor', exact: true }).isVisible(),
      'mobile monitor action remains visible');
    const mobileStudentViewButton = page.locator('.student-table tbody tr')
      .filter({ hasText: studentName })
      .getByRole('button', { name: 'View', exact: true });
    await mobileStudentViewButton.scrollIntoViewIfNeeded();
    const mobileClassDetailScrollY = await page.evaluate(() => window.scrollY);
    await mobileStudentViewButton.click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/classes/${sample.classId}/students/${studentId}`));
    await page.getByRole('heading', { name: studentName, exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Score Statistics', exact: true }).waitFor();
    const studentPageDimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(studentPageDimensions.page <= studentPageDimensions.viewport, 'student detail fits a 390px viewport');
    assert.deepEqual(await page.locator('.summary-grid dd').allTextContents(), ['0', '0', '-', '-'],
      'the mobile empty history keeps score metrics readable');
    await page.screenshot({ path: `/tmp/shsat-class-detail-student-mobile-${stamp}.png` });
    await page.screenshot({ path: `/tmp/shsat-empty-student-detail-mobile-${stamp}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Back to Class Detail', exact: true }).click();
    await page.waitForURL(url => url.pathname.endsWith(`/admin/classes/${sample.classId}`));
    await page.getByRole('heading', { name: sample.classroom.name, exact: true }).waitFor();
    assert.equal(await sort.inputValue(), 'start-desc', 'mobile return from Student Detail preserves sorting');
    assert.equal(await pageSize.inputValue(), '5', 'mobile return from Student Detail preserves page size');
    assert.equal(await rows.count(), 5, 'mobile return from Student Detail restores the exam page');
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - mobileClassDetailScrollY) <= 2,
      'mobile return from Student Detail restores the class detail scroll position');
    await page.screenshot({ path: `/tmp/shsat-class-detail-exams-mobile-${stamp}.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', classId: sample.classId, examCount: sample.exams.length,
      checks: ['search and empty state', 'ascending/descending sort', 'page size and pagination',
        'View Results, Monitor, and Student Detail return with filters/pagination/scroll position preserved',
        '390px class/student detail layout and actions'],
      dimensions, toolbarGeometry, mobileTableWidth, mobileCardWidth, studentPageDimensions, pageErrors: errors.length }));
  } finally {
    await context.close();
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

async function api(page, path) {
  const result = await page.evaluate(async path => {
    const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    return { status: response.status, text: await response.text() };
  }, path);
  if (result.status < 200 || result.status >= 300) throw new Error(`GET ${path}: ${result.status} ${result.text}`);
  return result.text ? JSON.parse(result.text) : null;
}

function asList(response) {
  if (Array.isArray(response)) return response;
  const payload = response?.data ?? response;
  return payload?.items || payload?.records || payload?.list || payload?.content || [];
}

async function alignCardTitle(page) {
  await page.locator('.class-exams-card .app-card__title').evaluate(element => {
    const offset = element.getBoundingClientRect().top - 150;
    window.scrollBy(0, offset);
  });
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
