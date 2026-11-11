// 学生首页 My Exams 卡片按派发方式分为 Group Exams / 1on1 Exams 两个子区域。
// 本测试创建一个整班派发的考试和一个只派给个人的考试，验证两个子区域的归属、
// 数量徽标、空状态、以及 1440px / 390px 布局，最后清理全部临时数据。
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';
const adminUsername = process.env.E2E_ADMIN_USERNAME;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

if (!adminUsername || !adminPassword) {
  throw new Error('Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD before running this test.');
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {}),
  });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const groupContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const oneOnOneContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminContext.newPage();
  const groupStudent = await groupContext.newPage();
  const oneOnOneStudent = await oneOnOneContext.newPage();
  const pageErrors = [];
  [admin, groupStudent, oneOnOneStudent]
    .forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  const stamp = Date.now();
  const password = `Grouping${stamp}!`;
  const groupUsername = `my_exams_group_${stamp}`;
  const oneOnOneUsername = `my_exams_solo_${stamp}`;
  const groupExamTitle = `SHSAT Group Exam ${String(stamp).slice(-6)}`;
  const oneOnOneExamTitle = `SHSAT 1on1 Exam ${String(stamp).slice(-6)}`;
  let classId;
  const examIds = [];
  const userIds = [];

  try {
    await login(admin, adminUsername, adminPassword);
    const groupUser = await createStudent(admin, groupUsername, password, `Group Exams Student ${stamp}`);
    const oneOnOneUser = await createStudent(admin, oneOnOneUsername, password, `1on1 Exams Student ${stamp}`);
    userIds.push(Number(groupUser.id), Number(oneOnOneUser.id));

    const paper = (await api(admin, '/api/admin/exam-types/SHSAT/papers'))
      .find(item => Number(item.id) === 247 && item.status === 'READY');
    assert.ok(paper, 'the migrated 100-question SHSAT paper is available');

    // 整班派发：学生通过 classId 这个整班目标获得资格，应归入 Group Exams。
    const classroom = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT', 'POST', {
      name: `My Exams Grouping Class ${stamp}`,
      description: 'Temporary class for My Exams grouping verification',
      sortOrder: 999,
      active: true,
    });
    classId = Number(classroom.classId || classroom.id);
    assert.ok(classId, 'the temporary SHSAT class is created');
    await addStudent(admin, classId, groupUser.id);

    const groupExam = await createPublishedExam(admin, paper.id, groupExamTitle, {
      classIds: [classId],
    });
    examIds.push(groupExam.id);

    // 个人派发：只把考试派给该学生本人，不带整班目标，应归入 1on1 Exams。
    const oneOnOneExam = await createPublishedExam(admin, paper.id, oneOnOneExamTitle, {
      studentUserIds: [Number(oneOnOneUser.id)],
    });
    examIds.push(oneOnOneExam.id);

    // 整班学生只看到 Group Exams 一支，1on1 子区域显示空状态。
    await login(groupStudent, groupUsername, password);
    await groupStudent.goto(`${baseUrl}/student/systems/SHSAT`);
    await groupStudent.getByRole('heading', { name: 'SHSAT', exact: true }).waitFor();
    await groupStudent.locator('.student-home-subsection').first().waitFor();

    const groupSections = groupStudent.locator('.student-home-subsection');
    assert.equal(await groupSections.count(), 2, 'My Exams renders exactly two subsections');
    const groupSection = groupStudent.locator('.student-home-subsection').filter({ hasText: 'Group Exams' });
    const oneOnOneSection = groupStudent.locator('.student-home-subsection').filter({ hasText: '1on1 Exams' });
    assert.equal(await groupSection.count(), 1, 'the Group Exams subsection is present');
    assert.equal(await oneOnOneSection.count(), 1, 'the 1on1 Exams subsection is present');

    await groupSection.getByText(groupExamTitle, { exact: true }).waitFor();
    assert.equal(await groupSection.locator('.student-home-exam-card').count(), 1,
      'the class-targeted exam appears only in Group Exams');
    assert.equal(await oneOnOneSection.locator('.student-home-exam-card').count(), 0,
      'the 1on1 Exams subsection has no card for a class-only student');
    await oneOnOneSection.getByText('No 1on1 exams assigned yet.', { exact: true }).waitFor();

    assert.equal(await groupSection.locator('.student-home-subsection__count').innerText(), '1',
      'the Group Exams badge matches its card count');
    assert.equal(await oneOnOneSection.locator('.student-home-subsection__count').innerText(), '0',
      'the 1on1 Exams badge matches its card count');
    // 主标题保持为 My Exams。
    await groupStudent.getByRole('heading', { name: 'My Exams', exact: true }).waitFor();

    // 接口层确认字段与分组一致。
    const groupApiExams = await api(groupStudent, '/api/student/exams');
    const groupApiExam = groupApiExams.find(item => Number(item.id) === groupExam.id);
    assert.ok(groupApiExam, 'the student receives the class-targeted exam');
    assert.equal(groupApiExam.assignmentKind, 'GROUP',
      'a class-targeted exam exposes assignmentKind=GROUP');

    await groupStudent.screenshot({ path: `/tmp/my-exams-grouping-class-student-${stamp}.png` });
    const groupDesktopSize = await pageSize(groupStudent);
    assert.ok(groupDesktopSize.pageWidth <= groupDesktopSize.viewportWidth,
      'the grouped My Exams card has no desktop overflow');

    // 个人派发学生看到 1on1 分支，Group 子区域显示空状态。
    await login(oneOnOneStudent, oneOnOneUsername, password);
    await oneOnOneStudent.goto(`${baseUrl}/student/systems/SHSAT`);
    await oneOnOneStudent.getByRole('heading', { name: 'SHSAT', exact: true }).waitFor();
    await oneOnOneStudent.locator('.student-home-subsection').first().waitFor();

    const soloGroupSection = oneOnOneStudent.locator('.student-home-subsection').filter({ hasText: 'Group Exams' });
    const soloOneOnOneSection = oneOnOneStudent.locator('.student-home-subsection').filter({ hasText: '1on1 Exams' });
    await soloOneOnOneSection.getByText(oneOnOneExamTitle, { exact: true }).waitFor();
    assert.equal(await soloOneOnOneSection.locator('.student-home-exam-card').count(), 1,
      'an individually targeted exam appears only in 1on1 Exams');
    assert.equal(await soloGroupSection.locator('.student-home-exam-card').count(), 0,
      'the Group Exams subsection has no card for an individually targeted student');
    await soloGroupSection.getByText('No group exams assigned yet.', { exact: true }).waitFor();

    const soloApiExams = await api(oneOnOneStudent, '/api/student/exams');
    const soloApiExam = soloApiExams.find(item => Number(item.id) === oneOnOneExam.id);
    assert.ok(soloApiExam, 'the student receives the individually targeted exam');
    assert.equal(soloApiExam.assignmentKind, 'ONE_ON_ONE',
      'an individually targeted exam exposes assignmentKind=ONE_ON_ONE');

    // 考试卡片原有信息在分组后仍然完整。
    const soloCard = soloOneOnOneSection.locator('.student-home-exam-card').first();
    await soloCard.getByText('Time Window', { exact: true }).waitFor();
    await soloCard.getByText('Submission', { exact: true }).waitFor();
    await soloCard.getByText('Duration', { exact: true }).waitFor();
    await soloCard.getByRole('button', { name: /^Start exam/ }).waitFor();

    await oneOnOneStudent.screenshot({ path: `/tmp/my-exams-grouping-solo-student-${stamp}.png` });
    await oneOnOneStudent.setViewportSize({ width: 390, height: 844 });
    const soloMobileSize = await pageSize(oneOnOneStudent);
    assert.ok(soloMobileSize.pageWidth <= soloMobileSize.viewportWidth,
      'the grouped My Exams card fits the 390px viewport');
    await oneOnOneStudent.screenshot({ path: `/tmp/my-exams-grouping-solo-student-mobile-${stamp}.png` });
    assert.equal(await oneOnOneStudent.locator('.student-home-subsection').count(), 2,
      'both subsections remain visible at 390px');

    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({
      result: 'PASS',
      checks: [
        'My Exams keeps its main title and renders Group Exams / 1on1 Exams subsections',
        'a class-targeted exam appears only under Group Exams with assignmentKind=GROUP',
        'an individually targeted exam appears only under 1on1 Exams with assignmentKind=ONE_ON_ONE',
        'each subsection shows its own empty state and matching count badge',
        'exam card status, time window, duration and start action survive the grouping',
        'grouped layout fits 1440px and 390px viewports',
        'temporary exam, class, and student data is cleaned up',
      ],
      groupDesktopSize,
      soloMobileSize,
      pageErrors: pageErrors.length,
    }));
  } finally {
    const cleanupErrors = [];
    const remove = async (path, label) => {
      try {
        await api(admin, path, 'DELETE');
      } catch (error) {
        cleanupErrors.push(`${label}: ${error.message}`);
      }
    };
    // 归档班级：学生入班即写入 class_membership_periods，后端据此保留历史并拒绝删除，
    // 因此临时班级按项目既有设计归档，而不是硬删。
    const archiveClass = async (id) => {
      try {
        await api(admin, `/api/admin/classes/${id}/status`, 'PATCH', { status: 'ARCHIVED' });
      } catch (error) {
        cleanupErrors.push(`archive class ${id}: ${error.message}`);
      }
    };
    for (const examId of examIds) await remove(`/api/admin/exams/${examId}`, `exam ${examId}`);
    if (classId) {
      try {
        const members = await api(admin, `/api/admin/classes/${classId}/students?examTypeCodes=SHSAT`);
        for (const userId of userIds) {
          if (members.some(item => Number(item.userId || item.id) === userId)) {
            await remove(`/api/admin/classes/${classId}/students/${userId}`, `class membership ${userId}`);
          }
        }
      } catch (error) {
        cleanupErrors.push(`class memberships: ${error.message}`);
      }
      await archiveClass(classId);
    }
    for (const userId of userIds) await remove(`/api/admin/users/${userId}`, `student ${userId}`);

    for (const examId of examIds) {
      if (await apiStatus(admin, `/api/admin/exams/${examId}`) !== 404) {
        cleanupErrors.push(`Exam ${examId} remains after cleanup.`);
      }
    }
    if (classId) {
      const classes = await api(admin, '/api/admin/classes?examTypeCodes=SHSAT');
      const remaining = classes.find(item => Number(item.classId || item.id) === classId);
      if (remaining && String(remaining.status).toUpperCase() !== 'ARCHIVED') {
        cleanupErrors.push(`Class ${classId} was neither removed nor archived.`);
      }
    }
    if (userIds.length) {
      const users = await api(admin, '/api/admin/users');
      if (users.some(item => userIds.includes(Number(item.id)))) {
        cleanupErrors.push('A temporary student remains after cleanup.');
      }
    }
    await browser.close();
    if (cleanupErrors.length) throw new Error(`Test cleanup failed: ${cleanupErrors.join('; ')}`);
  }
}

async function pageSize(page) {
  return page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
}

async function createStudent(page, username, password, realName) {
  return api(page, '/api/admin/users', 'POST', {
    username,
    password,
    realName,
    roleCode: 'STUDENT',
    email: null,
    phone: null,
    // 学生必须至少获得一个工作区权限，否则无法进入 SHSAT 学生端。
    workspaceCodes: ['SHSAT'],
  });
}

async function addStudent(page, classId, studentUserId) {
  await api(page, `/api/admin/classes/${classId}/students`, 'POST', { studentUserId: Number(studentUserId) });
}

// 创建并发布一个 SHSAT 考试；targets 决定派发方式，
// 只给 classIds 时为整班派发（Group），只给 studentUserIds 时为个人派发（1on1）。
async function createPublishedExam(admin, paperId, title, targets) {
  const now = Date.now();
  const created = await api(admin, `/api/admin/papers/${paperId}/exams`, 'POST', {
    title,
    description: 'Temporary My Exams grouping verification',
    opensAt: new Date(now - 5 * 60_000).toISOString(),
    closesAt: new Date(now + 45 * 60_000).toISOString(),
    durationSeconds: 10_800,
    attemptLimit: 1,
    targetScope: 'SELECTED',
    allowReview: true,
  });
  const examId = Number(created.summary.id);
  await api(admin, `/api/admin/exams/${examId}/targets`, 'PUT', {
    classIds: targets.classIds || [],
    studentUserIds: targets.studentUserIds || [],
  });
  await api(admin, `/api/admin/exams/${examId}/publish`, 'POST');
  return { id: examId, title: created.summary.title };
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

async function apiStatus(page, path) {
  return page.evaluate(async path => (await fetch(path, { credentials: 'same-origin' })).status, path);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
