# 管理端 Available Exams 分组为 Group Exams / 1on1 Exams 技术规范

> 状态：已实现（2026-11-11）。范围确认只改 SHSAT 管理首页；分组逻辑抽出共享模块 `examAssignmentGrouping.js`，学生端改为复用它。
> 需求原文：「管理界面的 available exam 也划分两个区域，gruop exam 和 1on1 exam」
> 关联需求：学生首页 My Exams 已按同一口径分组，见 `docs/STUDENT_MY_EXAMS_GROUPING_SPEC.md`

## 1. 需求定位

### 1.1 目标页面

**SHSAT 管理端首页**，不是学生端，也不是考试发布页。

| 项 | 值 |
|---|---|
| 路由 | `/admin/systems/SHSAT`（管理员控制台首页） |
| 组件 | `frontend/src/examTypes/shsat/admin/pages/AdminHome.vue` |
| 位置 | 第 3257 行 `<AppCard class="available-exams-card" title="Available Exams">` |
| 现有副标题 | `Start a practice attempt for a published exam from this dashboard.`（与用户截图一致，据此确认页面） |
| 现有渲染 | 第 3300–3321 行，单个 `.admin-exam-grid` 平铺 `adminExamCards` |

该卡片下方紧接 `<AdminTabs>`（Paper Management / Exam Release / ... 各标签页内容），本次只改这一张卡片内部。

### 1.2 不在本次范围

- 考试发布页（Exam Release 标签页）的发布列表 —— 属于管理动作，不是「可参加的考试」，不分组
- `ExamTypePage.vue:1718` 的 `sat-available-exams`（SAT / PSAT 工作区的管理端 Available Exams）—— 见第 8 节待确认项

## 2. 现状与缺口

### 2.1 前端

`AdminHome.vue:443` 的 `adminExamCards` 是一个平铺数组：

```js
const adminExamCards = computed(() => {
  const now = Date.now()
  return adminExams.value.map(normalizeExam).filter(...).sort(...)
})
```

模板用单个 `.admin-exam-grid` 遍历，**没有任何可用的分组依据**。

### 2.2 后端

管理端 Available Exams 的数据链路：

```
studentApi.getExams()            (frontend/src/examTypes/shsat/admin/services/studentApi.js:115)
  └─ 管理员/教师分支：listExams('SHSAT')  → GET /api/admin/exam-types/{code}/exams
       └─ ExamReleaseController.listExams → ExamReleaseService.list()
            └─ ExamSummary record（19 字段）
```

`ExamSummary` 当前只有 `targetScope`（`ALL_STUDENTS` / `SELECTED`），**无法区分“整班派发”和“只派给个人”**——因为两者都是 `SELECTED`。因此必须由后端补字段。

> 注意：学生接口 `StudentExamView.assignmentKind`（上一轮已实现）是**按学生冻结的 `exam_participant_classes` 判定**的，语义是「这名学生是通过班级还是个人拿到这场考试」。管理端看的是考试本身，语义不同，不能复用同一条 SQL。

### 2.3 可用的数据依据（均已存在，无需迁移）

| 表 / 列 | 用途 |
|---|---|
| `exams.target_scope` | `ALL_STUDENTS` / `SELECTED` |
| `exam_target_classes` | 整班派发目标（非空 → 整班） |
| `exam_target_students` / `exam_target_student_classes` | 个人派发目标 |
| `classes.class_type` | `STANDARD` / `INDIVIDUAL`（V39，**不参与**判定，沿用学生端决定，避免历史数据无法归类） |

## 3. 归类口径

与管理端/学生端口径保持一致：

```
target_scope = 'ALL_STUDENTS'                        → GROUP      （历史全量派发视角下等同整班）
EXISTS(exam_target_classes WHERE exam_id = e.id)     → GROUP      （整班派发）
其余（只有 exam_target_students）                     → ONE_ON_ONE （个人派发）
```

判定只看 `exam_target_classes` 是否存在，不看 `classes.class_type`，理由同学生端：`class_type` 对历史班级不可靠，且「是否通过班级派发」本身就是更直接的业务含义。

## 4. 接口契约变更

### 4.1 `ExamSummary` 增加字段

`backend/src/main/java/com/unifiedexam/platform/release/ExamReleaseService.java`

```java
public record ExamSummary(
    long id, String examTypeCode, long paperId, String paperTitle, String title,
    String description, String status, String targetScope, String opensAt,
    String closesAt, Integer durationSeconds, int attemptLimit, boolean hasStudentAttempts,
    boolean allowReview, boolean autoSubmit,
    String createdAt, String updatedAt, String publishedAt, String targetSummary,
    String assignmentKind) { }        // ← 新增，取值 GROUP / ONE_ON_ONE，非空
```

SQL 投影追加（`list`、`summary` 两处共用 `TARGET_SUMMARY_PROJECTION`，新字段单独拼接在同一 SELECT 中）：

```sql
CASE WHEN e.target_scope = 'ALL_STUDENTS' THEN 'GROUP'
     WHEN EXISTS (SELECT 1 FROM exam_target_classes tc WHERE tc.exam_id = e.id) THEN 'GROUP'
     ELSE 'ONE_ON_ONE' END AS assignment_kind
```

`mapSummary()` 追加 `rs.getString("assignment_kind")`。无新增占位符，参数列表不变。

**向后兼容**：只增字段不改语义，旧前端读不到该字段时按 `ONE_ON_ONE` 兜底（见 5.2）。

### 4.2 前端透传

`studentApi.getExams()` 的管理员分支已经把整条记录 `...exam` 展开，`assignmentKind` 会自动透传，**无需改动**。

## 5. 前端实现

### 5.1 分组工具复用

现有 `frontend/src/utils/studentExamGrouping.js` 已含「按 `assignmentKind` 拆两段 + 顺序 + 空状态」逻辑。本次把其中**与页面无关的判定与分组**提升为共享模块，避免复制一份：

- 新建 `frontend/src/utils/examAssignmentGrouping.js`
  - 导出 `ASSIGNMENT_KIND`、`isGroupAssignment(exam)`
  - 导出 `groupExamsByAssignment(exams, emptyCopy)`，`emptyCopy = { GROUP, ONE_ON_ONE }` 允许各页面给不同空状态文案
- `studentExamGrouping.js` 改为从共享模块 re-export 并保留现有 `groupStudentExams(exams)` 签名与文案
  → 现有 14 项单测与 `ExamTypePage.vue` 的引用**无需改动**
- 新增 `frontend/src/utils/examAssignmentGrouping.test.js` 覆盖共享函数的边界

> 若你更希望完全不碰学生端文件，我可以改为在 `AdminHome.vue` 内联一份，但会产生两处重复逻辑，后续改口径要改两遍。**默认按上面的复用方案执行。**

### 5.2 `AdminHome.vue` 改动

**computed（紧跟 `adminExamCards` 之后）**

```js
const groupedAdminExamCards = computed(() =>
  groupExamsByAssignment(adminExamCards.value, {
    GROUP: 'No group exams right now.',
    ONE_ON_ONE: 'No 1on1 exams right now.',
  }),
)
```

分组标题沿用复数的 `Group Exams` / `1on1 Exams`，与学生端一致。

**模板（替换 3300–3321 行）**

```vue
<div v-else-if="adminExamCards.length === 0" class="admin-state">No available exams right now.</div>
<template v-else>
  <section v-for="group in groupedAdminExamCards" :key="group.key" class="admin-exam-subsection">
    <h3 class="admin-exam-subsection__title">
      {{ group.title }} <span class="admin-exam-subsection__count">{{ group.exams.length }}</span>
    </h3>
    <div v-if="group.exams.length" class="admin-exam-grid">
      <AdminExamCard v-for="exam in group.exams" ... />   <!-- 卡片内容与现状完全一致 -->
    </div>
    <p v-else class="admin-state">{{ group.empty }}</p>
  </section>
</template>
```

**样式（`AdminHome.vue` 的 `<style scoped>` 内新增）**

```css
.admin-exam-subsection + .admin-exam-subsection { margin-top: 20px; }
.admin-exam-subsection__title {
  margin: 0 0 12px; color: #202b40; font-size: 15px; font-weight: 700;
}
.admin-exam-subsection__count {
  display: inline-flex; margin-left: 6px; border-radius: 999px; padding: 2px 8px;
  background: #edf3ff; color: #2563eb; font-size: 11px; font-weight: 750; vertical-align: middle;
}
```

不改 `.admin-exam-grid`（`src/styles.css:135`，已含 `max-height` 与滚动），两个子区域各自滚动。

## 6. 边界情况

| 情况 | 期望行为 |
|---|---|
| 两个子区域都为空 | 外层 `adminExamCards.length === 0` 命中，显示原有 `No available exams right now.`，**不渲染两个空分组** |
| 只有整班考试 | Group Exams 有卡片；1on1 Exams 显示 `No 1on1 exams right now.` + 徽标 0 |
| 只有个人考试 | 1on1 Exams 有卡片；Group Exams 显示 `No group exams right now.` + 徽标 0 |
| 后端未升级、响应缺 `assignmentKind` | 全部归入 1on1 Exams（共享函数只在明确等于 `GROUP` 时归组），考试不会消失 |
| `assignmentKind` 为未知值（如将来新增派发方式） | 归入 1on1 Exams，不丢数据 |
| `ALL_STUDENTS` 历史考试 | 归入 Group Exams |
| 加载中 / 加载失败 | 维持现有 `Loading exams...` 与错误条，不渲染分组 |
| 卡片折叠（`availableExamsCollapsed`） | 折叠逻辑不变，折叠时整块隐藏 |
| 响应式（≤780px） | `.admin-exam-grid` 单列，两个子区域纵向堆叠，无横向溢出 |

## 7. 验收标准

1. 管理端 SHSAT 首页 `Available Exams` 主标题与现有刷新/折叠按钮**保持不变**
2. 卡片内部出现 `Group Exams`、`1on1 Exams` 两个子区域，顺序固定
3. 整班派发的考试只出现在 Group Exams；个人派发的考试只出现在 1on1 Exams
4. 每个子区域徽标数量等于其卡片数；为空时显示自己的空状态
5. 两个子区域都为空时，只显示一条 `No available exams right now.`（不出现两个空分组标题）
6. 卡片的状态、时间窗、时长、按钮行为与改动前完全一致
7. 1440px 与 390px 视口均无横向溢出
8. 学生端 My Exams 分组行为**无回归**（现有 14 项单测继续通过）

## 8. 待确认项

**A. SAT / PSAT 管理端的 Available Exams 是否同步分组？**
`ExamTypePage.vue:1718` 还有一个 `sat-available-exams` 卡片（副标题不同，数据走 `exams` 而非管理端接口），SAT/PSAT 工作区的管理员也会看到。

- 已确认：本次只改 SHSAT 管理首页，`sat-available-exams` 维持原样。

**B. 空状态文案**：采用 `No group exams right now.` / `No 1on1 exams right now.`（管理端沿用 "right now" 语气，与学生端 "assigned yet" 有意区分）。

## 9. 测试计划

| 层级 | 内容 |
|---|---|
| 后端单测 | `ExamReleaseServiceTest` 追加：`assignment_kind` 进入 SQL 投影；整班/个人/全量三种取值；旧记录 `assignmentKind` 为空时不丢行。现有 22 项继续通过 |
| 前端单测 | `examAssignmentGrouping.test.js`：子区域顺序、混合拆分、顺序保留、缺字段兜底、未知值兜底、空状态文案、空数组、两段各自独立 |
| 前端构建 | `npm run build` 通过 |
| e2e（mock） | 新增 `frontend/e2e/admin-available-exams-grouping.cjs`：两种派发各一场 → 分段正确、徽标正确、空状态正确、两空时只显示一条总空状态、1440/390 布局 |
| 回归 | 学生端 `student-my-exams-grouping-mocked.cjs` 保持通过 |

## 10. 影响面

| 文件 | 改动 |
|---|---|
| `backend/.../release/ExamReleaseService.java` | `ExamSummary` +1 字段、SQL +1 表达式、`mapSummary` +1 行 |
| `backend/.../release/ExamReleaseServiceTest.java` | 5 处 `ExamSummary` 构造补参 + 新增用例 |
| `frontend/src/utils/examAssignmentGrouping.js` | 新建（共享分组） |
| `frontend/src/utils/examAssignmentGrouping.test.js` | 新建 |
| `frontend/src/utils/studentExamGrouping.js` | 改为复用共享模块，对外签名不变 |
| `frontend/src/examTypes/shsat/admin/pages/AdminHome.vue` | computed + 模板 + 样式 |
| `frontend/e2e/admin-available-exams-grouping.cjs` | 新建 |

无数据库迁移。接口只增字段。学生端代码行为不变。

## 11. 展示方式变更：纵向子区域改为 tab（2026-11-11）

> 需求原文：「用 tab 的形式切换」

### 11.1 变更内容

两个纵向子区域改为**药丸式 tab 切换**（视觉语气与 `AdminTabs.vue` 一致）：

- 新增 `activeAssignmentTab`（`ref`，默认 `'GROUP'`）与 `activeAdminExamGroup`（`computed`，当前激活分组）
- 模板用 `role="tablist"` / `role="tab"` / `aria-selected` 渲染两个带数量徽标的 tab，**只显示当前激活 tab 的卡片或空状态**
- tab 徽标始终反映各组总数，与激活与否无关
- 原纵向子区域样式（`.admin-exam-subsection*`）删除，替换为 `.assignment-tabs` / `.assignment-tab*`

### 11.2 卡片容器固定两排高度

管理端考试卡片基础高度 286px、行间距 16px。全局 `.admin-exam-grid` 的 `max-height: min(480px, 65vh)` 不足以保留两排，因此给本卡片网格加专用覆盖类（不动 SAT/PSAT 共用的全局规则）：

```css
.admin-exam-grid--assignment-tab {
  min-height: calc(286px * 2 + 16px);
  max-height: calc(286px * 2 + 16px);
}
```

移动端（≤780px）单列展示时放开固定高度（`min-height: 0; max-height: none`）。

### 11.3 验收标准（增量）

1. 默认激活 Group Exams tab；点击 1on1 Exams 切换，`aria-selected` 随之更新
2. 任一时刻只渲染当前 tab 的卡片；另一组的考试不出现
3. tab 徽标等于各组考试总数，与激活状态无关
4. 考试超过两排时容器高度固定在两排窗口内并滚动
5. 加载中 / 请求失败 / 折叠时不渲染 tab；完全为空时仍只显示一条总空状态
6. SAT / PSAT 管理端（`sat-available-exams`）不受影响

### 11.4 验证结果

- `node e2e/admin-available-exams-grouping.cjs`：PASS，10 项检查，含 tab 切换、徽标、固定两排高度、1440/390 布局
- 后端 `ExamReleaseServiceTest` 24/24 通过；前端单测 30/30；`npm run build` 通过
