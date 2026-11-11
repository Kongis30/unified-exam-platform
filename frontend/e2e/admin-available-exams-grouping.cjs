// 管理端 SHSAT 首页 Available Exams 用 tab 在 Group Exams / 1on1 Exams 之间切换。
// 全程走路由 mock，不依赖数据库，覆盖：两种派发并存、只有一种、两个都空、
// 缺 assignmentKind 的旧响应、未知取值、加载中、错误态、折叠、固定两排高度、1440px / 390px 布局。
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5175';

const exam = (id, title, assignmentKind, extra = {}) => ({
  id,
  examTypeCode: 'SHSAT',
  paperId: 247,
  paperTitle: 'Paper A',
  title,
  description: `${title} description`,
  status: 'PUBLISHED',
  targetScope: assignmentKind === 'GROUP' ? 'ALL_STUDENTS' : 'SELECTED',
  opensAt: '2026-11-01T09:00:00Z',
  closesAt: '2030-11-01T12:00:00Z',
  durationSeconds: 7200,
  attemptLimit: 1,
  hasStudentAttempts: false,
  allowReview: true,
  autoSubmit: true,
  createdAt: '2026-11-01T08:00:00Z',
  updatedAt: '2026-11-01T08:00:00Z',
  publishedAt: '2026-11-01T08:00:00Z',
  targetSummary: 'All students',
  ...(assignmentKind === undefined ? {} : { assignmentKind }),
  ...extra,
});

async function main() {
  const browser = await chromium.launch({ headless: true });
  const checks = [];

  // 打开管理端 SHSAT 首页；exams 用于指定本次 /api/admin/exam-types/SHSAT/exams 的返回。
  async function openAdminHome(options = {}) {
    const {
      exams = [],
      delayMs = 0,
      failExams = false,
      viewport = { width: 1440, height: 1000 },
    } = options;
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) return route.continue();

      if (url.pathname === '/api/auth/me') {
        return route.fulfill({ json: { username: 'admin', roleCode: 'ADMIN', realName: 'Admin' } });
      }
      if (url.pathname === '/api/auth/csrf') return route.fulfill({ json: { token: 'token' } });
      if (url.pathname === '/api/exam-types') {
        return route.fulfill({
          json: [{
            code: 'SHSAT', displayName: 'SHSAT', summary: 'SHSAT workspace',
            workspaceCode: 'SHSAT', workspaceName: 'SHSAT',
          }],
        });
      }
      if (url.pathname === '/api/admin/exam-types/SHSAT/exams') {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (failExams) {
          return route.fulfill({ status: 500, json: { message: 'Failed to load exams' } });
        }
        return route.fulfill({ json: exams });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto(`${baseUrl}/shsat`);
    return { page, context, pageErrors };
  }

  const availableCard = (page) => page.locator('.available-exams-card');

  // 读取当前 tab 结构
  async function readTabs(page) {
    return availableCard(page).evaluate((card) => {
      const tabs = [...card.querySelectorAll('.assignment-tab')];
      const active = card.querySelector('.assignment-tab--active');
      return {
        tabs: tabs.map((tab) => ({
          label: tab.textContent?.replace(/\s+/, ' ').trim() || '',
          selected: tab.getAttribute('aria-selected'),
        })),
        activeLabel: active?.textContent?.replace(/\s+/, ' ').trim() || null,
        cards: card.querySelectorAll('.admin-exam-card').length,
        empty: card.querySelector('.admin-state:not(.admin-state--error)')?.textContent?.trim() || null,
      };
    });
  }

  try {
    // 1. 两种派发并存：默认激活 Group，tab 徽标正确，只显示当前 tab 的卡片
    {
      const { page, context, pageErrors } = await openAdminHome({
        exams: [
          exam(101, 'Class Group Exam A', 'GROUP'),
          exam(102, 'Individual 1on1 Exam B', 'ONE_ON_ONE'),
          exam(103, 'Class Group Exam C', 'GROUP'),
        ],
      });
      const card = availableCard(page);
      await card.locator('.assignment-tab').first().waitFor();

      await card.getByRole('heading', { name: 'Available Exams', exact: true }).waitFor();

      let state = await readTabs(page);
      assert.equal(state.tabs.length, 2, 'two tabs render');
      assert.match(state.tabs[0].label, /^Group Exams 2$/, 'Group Exams badge matches its total');
      assert.match(state.tabs[1].label, /^1on1 Exams 1$/, '1on1 Exams badge matches its total');
      assert.equal(state.tabs[0].selected, 'true', 'Group Exams is selected by default');
      assert.equal(state.activeLabel, 'Group Exams 2', 'Group Exams is the active tab');
      assert.equal(state.cards, 2, 'only the active tab cards render');
      assert.equal(await card.getByText('Individual 1on1 Exam B', { exact: true }).count(), 0,
        'the 1on1 exam does not render while the Group tab is active');
      await card.getByText('Class Group Exam A', { exact: true }).waitFor();

      // 卡片原有信息在切 tab 后仍然完整
      const firstCard = card.locator('.admin-exam-card').first();
      for (const label of ['Available', 'Submission', 'Duration']) {
        await firstCard.locator('.admin-exam-card__meta').getByText(label, { exact: true }).waitFor();
      }
      await firstCard.getByRole('button', { name: /Start Exam|Continue Exam/ }).waitFor();

      // 点击 1on1 tab：只显示 1on1 卡片
      await card.getByRole('tab', { name: /1on1 Exams/ }).click();
      await page.waitForTimeout(100);
      state = await readTabs(page);
      assert.equal(state.activeLabel, '1on1 Exams 1', 'clicking switches the active tab');
      assert.equal(state.tabs[0].selected, 'false');
      assert.equal(state.tabs[1].selected, 'true');
      assert.equal(state.cards, 1, 'only the 1on1 card renders after switching');
      await card.getByText('Individual 1on1 Exam B', { exact: true }).waitFor();
      assert.equal(await card.getByText('Class Group Exam A', { exact: true }).count(), 0,
        'the group exam disappears after switching to the 1on1 tab');

      assert.deepEqual(pageErrors, [], 'no page errors while rendering the tabbed card');
      checks.push('tabs switch between Group Exams and 1on1 Exams showing only the active group');
      await context.close();
    }

    // 2. 只有整班考试：切到 1on1 显示自己的空状态，徽标保持总数
    {
      const { page, context } = await openAdminHome({
        exams: [exam(201, 'Only Group Exam', 'GROUP')],
      });
      const card = availableCard(page);
      await card.locator('.assignment-tab').first().waitFor();
      let state = await readTabs(page);
      assert.equal(state.cards, 1);
      await card.getByRole('tab', { name: /1on1 Exams/ }).click();
      await page.waitForTimeout(100);
      state = await readTabs(page);
      assert.match(state.tabs[1].label, /^1on1 Exams 0$/, 'the empty tab keeps its zero badge');
      assert.equal(state.empty, 'No 1on1 exams right now.', 'the empty tab shows its own copy');
      checks.push('a group-only list shows the 1on1 empty state on its tab with a zero badge');
      await context.close();
    }

    // 3. 只有个人考试：Group tab 显示自己的空状态
    {
      const { page, context } = await openAdminHome({
        exams: [exam(301, 'Only 1on1 Exam', 'ONE_ON_ONE')],
      });
      const card = availableCard(page);
      await card.locator('.assignment-tab').first().waitFor();
      const state = await readTabs(page);
      assert.equal(state.activeLabel, 'Group Exams 0', 'Group Exams is still the default tab');
      assert.equal(state.empty, 'No group exams right now.', 'the empty default tab has its own copy');
      checks.push('a one-on-one-only list shows the Group empty state on the default tab');
      await context.close();
    }

    // 4. 两个都空：只显示一条总空状态，不渲染 tab
    {
      const { page, context } = await openAdminHome({ exams: [] });
      const card = availableCard(page);
      await card.getByText('No available exams right now.', { exact: true }).waitFor();
      assert.equal(await card.locator('.assignment-tab').count(), 0,
        'no tabs render when there is nothing at all');
      checks.push('an entirely empty list shows the single overall empty state, not empty tabs');
      await context.close();
    }

    // 5. 旧响应缺 assignmentKind：不丢考试，全部归入 1on1
    {
      const { page, context } = await openAdminHome({
        exams: [exam(401, 'Legacy Exam Without Kind', undefined)],
      });
      const card = availableCard(page);
      await card.locator('.assignment-tab').first().waitFor();
      let state = await readTabs(page);
      assert.equal(state.cards, 0, 'an exam without assignmentKind is not guessed into Group');
      await card.getByRole('tab', { name: /1on1 Exams/ }).click();
      await page.waitForTimeout(100);
      state = await readTabs(page);
      assert.equal(state.cards, 1, 'an exam without assignmentKind falls back to the 1on1 tab');
      checks.push('a response missing assignmentKind falls back to 1on1 without losing the exam');
      await context.close();
    }

    // 6. 未知取值：同样兜底到 1on1，不丢数据
    {
      const { page, context } = await openAdminHome({
        exams: [exam(501, 'Future Kind Exam', 'SOMETHING_NEW')],
      });
      const card = availableCard(page);
      await card.locator('.assignment-tab').first().waitFor();
      await card.getByRole('tab', { name: /1on1 Exams/ }).click();
      await page.waitForTimeout(100);
      assert.equal(await card.locator('.admin-exam-card').count(), 1,
        'an unknown assignmentKind lands under the 1on1 tab');
      checks.push('an unknown assignmentKind is shown under 1on1 rather than disappearing');
      await context.close();
    }

    // 7. 加载中：不渲染 tab
    {
      const { page, context } = await openAdminHome({
        exams: [exam(601, 'Delayed Exam', 'GROUP')],
        delayMs: 1500,
      });
      const card = availableCard(page);
      await card.getByText('Loading exams...', { exact: true }).waitFor();
      assert.equal(await card.locator('.assignment-tab').count(), 0,
        'no tabs render while the exam list is still loading');
      checks.push('the loading state does not render the tabs');
      await context.close();
    }

    // 8. 错误态：显示错误条，不渲染 tab
    {
      const { page, context } = await openAdminHome({ failExams: true });
      const card = availableCard(page);
      await card.locator('.admin-state--error').first().waitFor();
      assert.equal(await card.locator('.assignment-tab').count(), 0,
        'no tabs render when loading the exam list failed');
      checks.push('the error state does not render the tabs');
      await context.close();
    }

    // 9. 折叠：整块隐藏，与改动前一致
    {
      const { page, context } = await openAdminHome({
        exams: [exam(701, 'Collapse Group Exam', 'GROUP')],
      });
      const card = availableCard(page);
      await card.locator('.assignment-tab').first().waitFor();
      await card.getByRole('button', { name: /Collapse available exams|Expand available exams/ }).click();
      await page.waitForTimeout(200);
      assert.equal(await card.locator('.assignment-tab').count(), 0,
        'collapsing the card hides the tabs');
      checks.push('collapsing the card hides the tabbed content');
      await context.close();
    }

    // 10. 卡片容器固定保留两排高度，超出滚动；1440px 与 390px 均无横向溢出
    {
      const { page, context } = await openAdminHome({
        exams: [
          exam(801, 'Responsive Group Exam With A Fairly Long Title For Wrapping', 'GROUP'),
          exam(802, 'Responsive 1on1 Exam With A Fairly Long Title For Wrapping', 'ONE_ON_ONE'),
          ...Array.from({ length: 7 }, (_, i) => exam(810 + i, `Overflow Group Exam ${i}`, 'GROUP')),
        ],
      });
      const card = availableCard(page);
      await card.locator('.assignment-tab').first().waitFor();

      const desktop = await page.evaluate(() => ({
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      assert.ok(desktop.pageWidth <= desktop.viewportWidth,
        `the tabbed card has no desktop overflow (${desktop.pageWidth} > ${desktop.viewportWidth})`);

      // 当前 tab 只有 8 场 Group 考试，容器高度仍停留在两排卡片高度
      const gridBox = await card.locator('.admin-exam-grid--assignment-tab').boundingBox();
      const TWO_ROWS = 286 * 2 + 16 + 12; // 基础高度 + gap + 网格自身 padding 上下界
      assert.ok(Math.abs(gridBox.height - TWO_ROWS) <= 24,
        `the grid keeps a two-row height window (got ${gridBox.height}px, expected ~${TWO_ROWS}px)`);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      const mobile = await page.evaluate(() => ({
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      assert.ok(mobile.pageWidth <= mobile.viewportWidth,
        `the tabbed card fits the 390px viewport (${mobile.pageWidth} > ${mobile.viewportWidth})`);
      assert.equal(await availableCard(page).locator('.assignment-tab').count(), 2,
        'both tabs remain visible at 390px');

      checks.push('the grid keeps a fixed two-row height and fits 1440px and 390px');
      await page.screenshot({ path: '/tmp/admin-available-exams-tab-mobile.png' });
      await context.close();
    }

    console.log(JSON.stringify({ result: 'PASS', checks, checksRun: checks.length }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
