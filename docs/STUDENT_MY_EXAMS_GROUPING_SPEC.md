# 学生首页 My Exams 分组为 Group Exams / 1on1 Exams 技术规范

> 状态：已实现（2026-11-10）。文案采用复数 `Group Exams` / `1on1 Exams`；已补充覆盖分组的前端 e2e。
> 需求原文：「可不可以将系统顶部的 My Exam 区域细分为 Group Exam 和 1on1 Exam 两个子区域，分别展示班级考试和一对一考试。保留 My Exam 作为主标题」

## 1. 需求定位

### 1.1 目标页面

**学生端工作区首页**，不是管理员后台。

| 项 | 值 |
|---|---|
| 路由 | `/student/systems/:code`（`name: 'student-workspace'`），SHSAT / SAT / PSAT 共用 |
| 组件 | `frontend/src/views/ExamTypePage.vue`，学生分支 `<template v-else-if="selectedType">` |
| 位置 | 第 2222–2248 行，`<div class="student-home">` 内第一张 `AppCard` |
| 现有标题 | `My Exams`（代码里是复数），副标题 `Only exams published to your account are shown.` |

该卡片下方还有 `Assigned Review`、`Score History and Explanations` 两张卡片，本次只改第一张。

> 说明：用户说的 “My Exam” 与代码中的 `My Exams` 指同一处，本轮保留现有单复数不改。

### 1.2 改造目标

主标题仍为 `My Exams`，卡片内部拆成两个子区域：

```
My Exams                                      ← 保留 AppCard title，不拆成两张卡
├─ Group Exams     （数量徽标）  ← 整班派发的考试
└─ 1on1 Exams      （数量徽标）  ← 一对一派发的考试
```

## 2. 现状与缺口

### 2.1 前端

`ExamTypePage.vue:40` 的 `studentExams` 是平铺数组，模板用单个 `.student-home-grid` 遍历渲染，**没有任何分组依据可用**。

### 2.2 后端

`backend/src/main/java/com/unifiedexam/platform/release/ExamReleaseService.java:453` `listForStudent()` 返回 `StudentExamView`（第 643 行），当前 12 个字段：

```
id, examTypeCode, title, description, opensAt, closesAt, paperTitle,
durationSeconds, attemptLimit, attemptsUsed, activeAttemptId, latestAttemptId
```

不含“这场考试是通过整班还是个人派给我”的信息。因此**必须由后端补一个字段**，前端才能分组。

### 2.3 可用的数据依据（均已存在，无需迁移）

| 表 | 用途 |
|---|---|
| `exams.target_scope` | `ALL_STUDENTS` / `SELECTED` |
| `exam_target_classes` | 整班派发目标 |
| `exam_target_students` + `exam_target_student_classes` | 个人派发目标及其来源班级 |
| `exam_participant_classes` | 发布时**冻结**的「该学生通过哪些班级获得资格」（V30 迁移，注释明确「作答开始时固定，后续班级变更不改写历史」） |
| `classes.class_type` | `STANDARD` / `INDIVIDUAL`（V39，本轮不参与判定） |

## 3. 归类口径（已确认）

判定顺序：

1. `exams.target_scope = 'ALL_STUDENTS'` → **Group**
2. 否则若 `exam_participant_classes` 与 `exam_target_classes` 存在交集（该学生确实通过整班目标获得资格）→ **Group**
3. 否则 → **1on1**

选择理由：

- 以发布时刻冻结的 `exam_participant_classes` 为准，学生后续换班 / 退班不会让历史考试在两类之间跳变；
- `ALL_STUDENTS` 历史派发没有班级归属，必须显式归入 Group，否则会被错误归到 1on1；
- 不掺入 `classes.class_type`：V30 迁移注释已说明旧的个人派发「没有可靠的班级来源」，用班级类型判定会产生无法归类与误归类。

**已确认的已知边界**（不视为缺陷）：某场考试既整班派发、又被单独勾选了部分学生时，该考试对这些学生归入 Group（交集非空）。

## 4. 接口契约变更

### 4.1 后端

`ExamReleaseService.listForStudent()` 的 SELECT 增加一列：

```sql
CASE WHEN e.target_scope = 'ALL_STUDENTS' THEN 'GROUP'
     WHEN EXISTS (
       SELECT 1 FROM exam_participant_classes pc
       JOIN exam_target_classes tc ON tc.exam_id = pc.exam_id AND tc.class_id = pc.class_id
       WHERE pc.exam_id = e.id AND pc.student_user_id = ?
     ) THEN 'GROUP'
     ELSE 'ONE_ON_ONE' END AS assignment_kind
```

`StudentExamView` 追加字段 `String assignmentKind`（末位追加，不改动既有字段顺序）。

> 参数顺序注意：新 `?` 位于 SELECT 列表末尾，因此 `jdbcTemplate.query(...)` 的实参要从 4 个 `studentId` 改为 5 个。

`GET /api/student/exams` 响应新增 `assignmentKind` 属性，属**纯加字段**，既有消费方（`ExamTypePage.vue`、`@shsat/admin/services/studentApi.js:125` 的 `mapExam` 透传）不受影响。

### 4.2 前端

`frontend/src/api/platform.js:399` `listStudentExams` 无需改动。

`ExamTypePage.vue` 新增两个 computed（放在第 435 行 `activeReviewTasks` 附近）：

```js
const groupStudentExams = computed(() => studentExams.value.filter((exam) => exam.assignmentKind === 'GROUP'))
const oneOnOneStudentExams = computed(() => studentExams.value.filter((exam) => exam.assignmentKind !== 'GROUP'))
```

> 用 `!== 'GROUP'` 而非 `=== 'ONE_ON_ONE'`，这样后端字段缺失（例如未部署新版后端的窗口期）时全部落到 1on1，不会整块消失。

## 5. 前端模板改造

`ExamTypePage.vue:2233–2251` 由「一个空状态 + 一个 grid」改为「两个子区域」。

为避免同一段考试卡片标记写两遍导致后续改一处漏一处，用**外层遍历分组定义**渲染两个子区域，卡片 `<article>` 只写一份：

```js
// 分组定义即两个子区域的文案来源，新增分组只改这里。
const groupedStudentExams = computed(() => [
  { key: 'GROUP', title: 'Group Exams', empty: 'No group exams assigned yet.', exams: groupStudentExams.value },
  { key: 'ONE_ON_ONE', title: '1on1 Exams', empty: 'No 1on1 exams assigned yet.', exams: oneOnOneStudentExams.value },
])
```

```vue
<AppCard class="management-card student-home-section" title="My Exams" subtitle="Only exams published to your account are shown.">
  <button class="student-home-refresh" ... />                        <!-- 保持不动，两段共用一次请求 -->
  <div v-if="studentExamsLoading && !studentExams.length" class="student-home-state">Loading exams...</div>
  <p v-else-if="studentExamError" class="error-text" role="alert">{{ studentExamError }}</p>
  <template v-else>                                                   <!-- 关键：不再用 !studentExams.length 整块空态 -->
    <section v-for="group in groupedStudentExams" :key="group.key" class="student-home-subsection">
      <h3 class="student-home-subsection__title">
        {{ group.title }}<span class="student-home-subsection__count">{{ group.exams.length }}</span>
      </h3>
      <div v-if="group.exams.length" class="student-home-grid">
        <article v-for="exam in group.exams" :key="exam.id" class="student-home-exam-card">
          ...（卡片内容原样保留，只把外层数组从 studentExams 换成 group.exams）
        </article>
      </div>
      <p v-else class="student-home-state">{{ group.empty }}</p>
    </section>
  </template>
</AppCard>
```

要点：

- 考试卡片 `<article>` 的整段标记（状态徽标、Time Window / Submission / Duration、操作按钮）**不改动**，仅 `v-for` 的数据源换成 `group.exams`；
- 顶部 loading / error 仍为单一状态，两段共享一次 `loadStudentExams` 请求，不重复刷新按钮；
- 空状态按「各自显示」（已确认）：某一类为空时只在该子区域显示提示，两个子标题始终存在。

样式（追加到现有 `.student-home-*` 附近，约第 2368 行区块）：

```css
.student-home-subsection + .student-home-subsection { margin-top: 24px; }
.student-home-subsection__title { margin: 0 0 14px; color: #202b40; font-size: 15px; font-weight: 700; }
.student-home-subsection__count { margin-left: 6px; border-radius: 999px; padding: 2px 8px; background: #edf3ff; color: #2563eb; font-size: 11px; font-weight: 750; }
```

窄屏无需新增规则：`.student-home-grid` 已有 `minmax(min(100%, 320px), 340px)` + 640px 以下单列规则（第 2415 行）。

## 6. 边界情况

| 情况 | 期望 |
|---|---|
| 学生无任何考试 | 两个子区域都显示各自空状态（不再显示原来的整卡提示 `No exams have been assigned to you yet.`） |
| 只有整班考试 | Group 有卡片，1on1 显示空状态 |
| 只有一对一派发 | 反之 |
| 考试同时整班 + 个人勾选 | 归 Group |
| `target_scope = ALL_STUDENTS` 历史数据 | 归 Group |
| 已撤回（`DRAFT`）但有进行中作答 | 仍出现在列表，跟随其原归类，不因状态变化而换组 |
| 学生换班 / 退班后 | 归类不变（`exam_participant_classes` 已冻结） |
| 后端未升级、响应无 `assignmentKind` | 全部归入 1on1，页面不空白 |
| SHSAT / SAT / PSAT 三个工作区 | 逻辑一致，无需分模块处理 |

## 7. 影响面与风险

- 后端：`ExamReleaseService.java` 1 处 SQL + record 增 1 字段；无数据库迁移。
- **测试影响**：`backend/src/test/.../release/ExamReleaseServiceTest.java:204` 直接 `new StudentExamView(...)` 构造 12 个参数，需补第 13 个参数，否则编译失败。
- 前端：`ExamTypePage.vue` 单文件改造（computed + 模板 + 样式）。
- 其它考试类型模块共用同一个 `listForStudent`，因此改动对 SHSAT / SAT / PSAT 同时生效，属预期。
- 风险：分组依赖发布时冻结数据，历史上在 V30 之前发布、且学生已退班的考试可能落入 1on1。低概率、可通过 SQL 抽样核对。

## 8. 验收标准

1. 学生端任一工作区首页，`My Exams` 卡片内出现 `Group Exams` 与 `1on1 Exams` 两个子区域，主标题仍为 `My Exams`。
2. 整班派发的考试只出现在 `Group Exams`；只派给个人的考试只出现在 `1on1 Exams`；两类数量徽标与实际卡片数一致。
3. 某一类为空时显示该子区域空状态，另一类正常渲染，两个子标题均不消失。
4. 卡片上的状态徽标、时间段、时长、开始/继续按钮行为与改造前完全一致。
5. 1440px 与 390px 视口下无横向溢出，无浏览器脚本错误。
6. `mvn -q test -Dtest=ExamReleaseServiceTest` 通过；`npm run build` 通过。

## 9. 测试计划

| 项 | 内容 |
|---|---|
| 后端单测 | 更新 `ExamReleaseServiceTest` 构造参数；断言 SQL 含 `assignment_kind` 与 `exam_participant_classes` 交集判定；新增 `studentExamListExposesAssignmentKindForHomeGrouping` 覆盖 GROUP / ONE_ON_ONE 取值 |
| 后端集成 | 复用 `ExamClassAttributionMySqlTest` 场景（`EXAM_ATTRIBUTION_TEST_*` 环境变量），校验整班 / 个人两类考试的 `assignmentKind` 取值 |
| 前端真实数据 | `frontend/e2e/student-my-exams-grouping.cjs`（`npm run test:e2e:shsat:my-exams-grouping`）：建临时班级 + 两名学生 + 一场整班考试 + 一场个人派发考试，校验归属、徽标、空状态、1440/390 布局与清理 |
| 前端 mock | `frontend/e2e/student-my-exams-grouping-mocked.cjs`（`npm run test:e2e:shsat:my-exams-grouping-mocked`）：不写数据库，覆盖两类都有 / 只有整班 / 只有个人 / 完全无考试，以及缺 `assignmentKind` 的回退 |
| 回归 | `npm run test:e2e:shsat:student-states`（注意：该脚本仍用已不存在的 `.student-exam-list` 选择器，属既有遗留，本轮不修，但需确认页面 `pageErrors=0`） |

## 10. 实现记录（2026-11-10）

### 10.1 落地文件

| 文件 | 改动 |
|---|---|
| `backend/.../release/ExamReleaseService.java` | `listForStudent()` SELECT 增加 `assignment_kind` 列；`StudentExamView` 末位追加 `String assignmentKind` |
| `backend/src/test/.../release/ExamReleaseServiceTest.java` | 补构造参数；扩充 SQL 断言；新增分组取值用例 |
| `frontend/src/views/ExamTypePage.vue` | 新增 `groupStudentExams` / `oneOnOneStudentExams` / `groupedStudentExams` 三个 computed；`My Exams` 卡片改为按分组渲染两个子区域；新增 `.student-home-subsection*` 样式 |
| `frontend/e2e/student-my-exams-grouping.cjs` | 新增真实数据 e2e |
| `frontend/e2e/student-my-exams-grouping-mocked.cjs` | 新增 mock e2e |
| `frontend/package.json` / `frontend/e2e/README.md` | 注册两个 npm 脚本并补说明 |

### 10.2 与草案的差异

- **模板实现改为遍历分组定义**（`groupedStudentExams`），而非把两个子区域各写一遍。卡片标记仍只存在一份，避免后续改一处漏一处。
- **SQL 未新增 JDBC 占位符**：改用已在外层查询中的 `ep.student_user_id`，因此 `jdbcTemplate.query(...)` 的实参个数保持 4 个 `studentId` 不变，与草案第 4.1 节的提示不同。
- 分组定义集中在 `groupedStudentExams`，新增分组只改这一处。

### 10.3 验证结果

- `npm run build`：通过。
- `mvn test -Dtest=ExamReleaseServiceTest`：19/19 通过（需 JDK 17；JDK 24 下 Mockito 无法 mock `JdbcTemplate`，属环境问题，与本次改动无关）。
- `node e2e/student-my-exams-grouping-mocked.cjs`：PASS，7 项检查通过，`errors: 0`，桌面 1440px、移动 390px 均无横向溢出。
- 真实数据 e2e `student-my-exams-grouping.cjs` 未在本机执行：本地未配置 `DB_URL` / `DB_USERNAME` / `DB_PASSWORD`，无可用数据库实例。脚本已通过 `node --check` 语法校验，需在有数据库的环境按 README 步骤执行。
