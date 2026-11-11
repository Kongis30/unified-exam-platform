# 学生首页 Score Trend 折线图技术规范

> 状态：待确认（2026-11-11，v2）。
> 参考实现：管理端 `frontend/src/examTypes/shsat/admin/pages/StudentDetailPage.vue:476` 的 Score Trend（与截图一致）。
> 关联：学生首页 My Exams 分组见 `docs/STUDENT_MY_EXAMS_GROUPING_SPEC.md`。

## 0. v2 修订说明（相对 v1 的变更）

| 项 | v1 假设 | v2 事实与结论 |
|---|---|---|
| 工作区结构 | SAT 工作区容纳 SAT + PSAT 两个类型 | **错误**。V28 迁移为 `UPDATE exam_types SET workspace_code = code`，`exam_workspaces` 是 SAT / PSAT / SHSAT 三条独立记录。三者互相独立，一个类型对一个工作区。 |
| 后端归属 | 一个 `SatScoreTrendProvider` 同时管 SAT+PSAT | 改为**每个类型模块各自实现自己的 provider**，符合"sat、psat 是独立模块各自分别实现" |
| 分数模式 | 只画一条曲线（自动选 scaled） | 增加 **raw / scaled 切换**（用户明确要求） |
| 公共组件范围 | 图表组件 + 卡片组件 | 不变，但**明确公共的只是前端渲染层**；后端取数与口径归各类型模块 |
| 数据归属 | 学生本人 | 不变，并在第 2 节显式写明**与班级无关** |

## 1. 需求定位

### 1.1 目标页面

**学生端工作区首页**（三个工作区各自进入，共用同一个前端组件）。

| 项 | 值 |
|---|---|
| 路由 | `/student/systems/:code`（`name: 'student-workspace'`），`:code` ∈ `SAT` / `PSAT` / `SHSAT` |
| 组件 | `frontend/src/views/ExamTypePage.vue`，学生分支 `<template v-else-if="selectedType">`（第 2275 行起） |
| 插入位置 | `My Exams` 卡片之后、`Assigned Review` 卡片之前 |
| 请求参数 | 传 `selectedType.code`（即 `SAT` / `PSAT` / `SHSAT`），不是 `props.code`（workspace code）。当前两者取值相同，但语义上趋势属于考试类型 |

### 1.2 产品意图（用户原话）

> 「数据是学生自己的考试记录，不是班级的。这个图的作用是反应学生自己的考试里程变化。」

由此推出三条硬约束：

1. **数据源是 `attempts.student_user_id = 本人`**，绝不使用 `attempt_classes` 的班级归属，绝不聚合其他学生，绝不画班级平均。
2. **单条个人成长曲线**，不是横向对比图。因此：
   - 不画班级平均参照线
   - 不画其他学生
   - 不显示排名、百分位
3. **横轴必须严格按提交时间从早到晚**（"里程"= 时间线上的成长轨迹），不做按分数排序。

### 1.3 页面结构

```
My Exams
Score Trend                         ← 本次新增（独立卡片）
├─ Score Statistics                 （4 个瓷片，随 raw/scaled 切换联动）
│   Total attempts · Completed · Average score · Highest score
├─ Scaled score ▾ | Raw score       （分段切换，无量表分时隐藏）
├─ 折线图（可横向滚动）
└─ 图例说明
Assigned Review
Score History and Explanations
```

## 2. 现状与缺口

### 2.1 前端

`ExamTypePage.vue` 学生分支只有三张卡：My Exams / Assigned Review / Score History。无图表。

**关键事实**：三个工作区共用这一个学生首页组件。因此前端天然只有一处调用点，不存在"三份图表代码"的问题——**"各自分别实现"主要落在后端**。前端要做的是把图表抽成公共组件，供本页与将来可能的模块独立页面共用。

现有单学生分数趋势图表有两份（均不适合直接复用）：

| 位置 | 语义 | 处理 |
|---|---|---|
| `StudentDetailPage.vue:476` | 单个学生的分数时间序列（教师端视角） | **抽取为公共组件**，改为共用 |
| `components/admin/ClassExamScoreTrend.vue` | 班级平均分 + raw/scaled 切换 | **不复用**：多序列、班级聚合，语义不同 |

### 2.2 各类型数据可得性

| 类型 | 现有学生端接口 | 能否直接画图 |
|---|---|---|
| SHSAT | `GET /api/student/attempts/history` | **够**：已返回 `compositeScore` / `compositeMaxScore` / `totalScore` / `rawTotalScore` / `scoringMode` / `scoreVisible` / `submittedAt` |
| SAT | 只有 `GET /api/student/sat-practice-attempts`（练习）与单场报告 | **不够**：无正式考试历史列表 |
| PSAT | 同上 | **不够**：同上 |

结论：三个类型各自需要在**自己的模块内**新增趋势数据提供者。接口对外统一，内部各自实现。

### 2.3 分数语义差异（必须各自处理）

| 类型 | scaled 来源 | scaled 满分 | raw 来源 | raw 满分 | raw 满分是否固定 |
|---|---|---|---|---|---|
| SHSAT | `attempt_result_breakdowns` ELA/MATH `scaled_score` 之和 | 720（`SHSAT_2026_100`） | `attempt_results.total_points` | `attempt_results.max_points` | 通常 100，可随试卷变 |
| SAT | `SatScoreScale.scaledTotal(RW)+scaledTotal(Math)` | 1600 | 正确题数（`rw1+rw2+math1+math2`） | `paper_question_count` | **随试卷题数变** |
| PSAT | 同上（`scoring_table_code = PSAT`） | 1520 | 同上 | 同上 | **随试卷题数变** |

**这是 raw 模式最大的诚实性风险**：若各次试卷题数不同，raw 绝对值上涨可能只是因为题目变多。处理方案见 5.4。

SAT 的换算逻辑目前只写在 `SatAdminStudentScoreService.scoreRow()`（第 158–217 行），本次抽成共享计算器，避免学生端与教师端各算一份。

## 3. 口径（已确认）

### 3.1 纳入统计的作答

1. `attempts.is_practice = FALSE`（正式考试；练习与错题重做排除）
2. `attempts.student_user_id = 本人`
3. 状态 ∈ `SUBMITTED` / `COMPLETED` / `EXPIRED`
4. 分数可见：按 `exams.score_visibility`（`AFTER_SUBMIT` 提交即可见；`AFTER_CLOSE` 结束后可见）
5. 分数已判完：`attempt_results.ungraded_count = 0`

`IN_PROGRESS` 只计入 Total attempts，不进曲线、不进 Average/Highest。

### 3.2 统计条（随当前 metric 联动）

| 瓷片 | 口径 | 是否随切换变化 |
|---|---|---|
| Total attempts | 全部正式尝试（含未完成） | 否 |
| Completed | 已结束的正式尝试 | 否 |
| Average score | 当前 metric（scaled 或 raw）下**可见**点的算术平均，四舍五入取整 | **是** |
| Highest score | 当前 metric 下可见点的最大值 | **是** |

无数据时显示 `—`，**不显示 0**。

### 3.3 模式切换规则

- 两个模式都有数据：默认 **scaled**（量表分才是"真实成绩"），可切换。
- 仅 raw 有数据（如 SHSAT 的 `RAW_ONLY` profile）：**隐藏切换控件**，只显示 raw，并提供说明。
- 仅 scaled 有数据：同上，只显示 scaled。
- 切换后统计条、曲线、tooltip 同时更新；切换状态不持久化（每次进入默认 scaled）。

### 3.4 纵轴

- 单条曲线。范围取当前模式下可见点的实际最小/最大值，**不做 0 基线**（避免曲线被压平，这是"看成长"的关键）。
- 无数据变化（所有点相同）时上下各留一格。
- 刻度 4–6 档，取整数。
- 横轴按**序号等距**排布，不按真实时间比例（与现有实现和截图一致）；点较多时横向滚动。

## 4. 接口契约

### 4.1 新增 `GET /api/student/score-trend`

参数：`examTypeCode`（`SAT` / `PSAT` / `SHSAT`），必填。

用 `examTypeCode` 而非 `workspaceCode`：趋势数据属于考试类型，provider 按类型注册；当前两者 1:1，但用类型编码不会把将来的可用性绑死在"一工作区一类型"上。

响应：

```json
{
  "examTypeCode": "SHSAT",
  "statistics": {
    "totalAttempts": 18,
    "completedAttempts": 18
  },
  "series": {
    "scaled": {
      "available": true,
      "unit": "SCALED",
      "scoreMax": 720,
      "scoreMaxVaries": false,
      "average": 375,
      "highest": 509,
      "points": [
        { "attemptId": 312, "examId": 41, "examTitle": "SHSAT Practice Exam 3",
          "attemptNumber": 2, "submittedAt": "2026-10-18T14:02:11",
          "score": 406, "scoreMax": 720 }
      ]
    },
    "raw": {
      "available": true,
      "unit": "POINTS",
      "scoreMax": 100,
      "scoreMaxVaries": false,
      "average": 43,
      "highest": 61,
      "points": [
        { "attemptId": 312, "examId": 41, "examTitle": "SHSAT Practice Exam 3",
          "attemptNumber": 2, "submittedAt": "2026-10-18T14:02:11",
          "score": 43, "scoreMax": 61 }
      ]
    }
  },
  "excluded": { "notScored": 0, "notVisible": 3 }
}
```

要点：

- `points` 双方阵均按 `submittedAt` **升序**；前端不排序。
- `statistics` 只放与 metric 无关的计数；平均与最高分放在各自 series 里，避免前端再实现口径。
- `unit` 用于前端选择文案：`SCALED` → "Scaled score"，`POINTS` → "Raw score (points)"（SHSAT），`CORRECT` → "Raw score (correct answers)"（SAT/PSAT）。
- `scoreMaxVaries` 为 `true` 时前端按 5.4 显示提示。
- `excluded.notVisible` 用于脚注："3 attempts are not shown yet because their scores have not been opened."
- `available: false` 时 `points` 为空数组，前端隐藏对应模式。

### 4.2 鉴权

- 必须 `STUDENT` 角色；只返回本人数据（按 `username` 解析 `users.id`，**不接收外部 `studentId`**）。
- `WorkspaceAccessService.requireExamType(authentication, examTypeCode)` 校验授权，不通过 → `403`。
- 管理员/教师不走该接口（学生首页的员工分支不渲染这张卡）。

### 4.3 不修改的既有接口

`GET /api/student/attempts/history`（SHSAT 历史列表）保持原样，理由见第 9 节。

## 5. 后端实现

### 5.1 模块归属（各自分别实现）

| 文件 | 所属模块 | 职责 |
|---|---|---|
| `attempt/StudentScoreTrendController.java` | 平台 | `GET /api/student/score-trend`，解析学员与授权 |
| `attempt/StudentScoreTrendService.java` | 平台 | 按 `examTypeCode` 找已注册 provider，组装响应 |
| `attempt/StudentScoreTrend.java` | 平台 | record：`Statistics` / `Series` / `Point` / `Response` |
| `examtype/ScoreTrendProvider.java` | 平台契约 | `String examTypeCode()`、`ScoreTrendData load(long studentUserId)` |
| `examtype/shsat/ShsatScoreTrendProvider.java` | **SHSAT 模块** | 自己查自己的表，产出 scaled（ELA+Math 量表）与 raw（`total_points`）两条序列 |
| `examtype/sat/SatScoreTrendProvider.java` | **SAT 模块** | SAT 实现 |
| `examtype/psat/PsatScoreTrendProvider.java` | **PSAT 模块** | PSAT 实现 |

`StudentScoreTrendService` 构造时收集全部 `ScoreTrendProvider` 并按编码建索引，与 `ExamTypeRegistry` 同构。平台层**不出现** `if (type == "SAT")` 之类的类型分支——这是 `IMPLEMENTATION_PLAN.md`「平台通过稳定的项目编码找到已注册的处理器」的直接应用。

**SAT 与 PSAT 共享实现类**：两者换算表与题目结构一致，`SatScoreTrendProvider` 是抽象基类（或共享 helper 类），SAT/PSAT 各自注册一个子类只覆盖 `examTypeCode()` 与 `scoring_table_code` 过滤。这样既满足"独立模块"，又不复制换算逻辑。

### 5.2 抽出的平台共享件

| 文件 | 改动 |
|---|---|
| `examtype/sat/SatAttemptScoreCalculator.java`（新增） | 从 `SatAdminStudentScoreService.scoreRow()` 第 158–217 行抽出：入参为模块 raw 分、`source_score_json`、`scoring_table_code`、题目数；输出 `rwScaled` / `mathScaled` / `totalScaled` / `scaledMax`。SAT 与 PSAT 两个 provider 共用 |
| `examtype/sat/SatAdminStudentScoreService.java` | `scoreRow()` 改为调用计算器，输出不变 |
| `attempt/ScoreVisibilityPolicy.java`（新增） | 由 `examtype/shsat/admin/ReportVisibilityPolicy.java` 平移为公共类，SHSAT 三处调用点改引用 |

`score_visibility` 的 `AFTER_SUBMIT` / `AFTER_CLOSE` 语义与类型无关，三个 provider 都要用，因此提到平台层。

### 5.3 各 provider 取数要点

**SHSAT**（以 `studentOwnAttemptHistory` 的 SQL 为基础裁剪）
- 保留 `attempt_result_breakdowns` 的 ELA/MATH `raw_score` / `scaled_score` / `scaled_max_score`
- 保留 `scoring_profiles.algorithm_code`（判 `RAW_ONLY`）与 `attempt_results.ungraded_count`
- scaled：`elaScaled + mathScaled`，max = `elaMax + mathMax`（复用 `addScaledScores` 的合成规则）
- raw：`total_points` / `max_points`
- `RAW_ONLY` 时 `series.scaled.available = false`

**SAT / PSAT**（以 `SatAdminStudentScoreService` 第 63–107 行 SQL 为模板）
- `WHERE u.username = ?`（不是 `student_user_id`）+ `p.exam_type_code = ?`
- 追加 `e.score_visibility`、`e.closes_at <= NOW() AS exam_closed`，按 `ScoreVisibilityPolicy` 裁剪
- 复用 `SatModuleScoreSql.rawScore(...)` 与 `SatAttemptScoreCalculator`
- raw：`rw1+rw2+math1+math2`，max = `paper_question_count`
- scaled 恒可用；迁移导入的旧成绩以 `source_score_json` 封存字段为准（沿用 `applyLegacyReportSummary` 逻辑）

### 5.4 raw 满分可变（诚实性处理）

**问题**：SAT/PSAT 的 raw 满分是题目数，各试卷可能不同。若直接画绝对值，学生可能误判"进步"。

**方案**：
- 后端在 `series.raw.scoreMaxVaries` 标出是否为统一满分。
- 前端 raw 模式下：
  - 值标签显示绝对值（如 `43`）
  - tooltip 显示 `Raw score 43 / 54`
  - `scoreMaxVaries = true` 时图下显示脚注：`Raw score totals vary between papers. Compare attempts with the same question count.`
- **不做百分比归一**：把 raw 换成正确率会让学生看到与 Score History 列表不一致的数字，反而更困惑。绝对值 + 明确满分 + 脚注是更诚实的选择。

## 6. 前端实现

### 6.1 新增文件（公共组件）

| 文件 | 职责 |
|---|---|
| `components/ScoreTrendChart.vue` | **纯渲染**。props：`points`、`unit`、`scoreMaxVaries`。SVG 折线 + 点 + 值标签 + 日期轴 + 悬停/聚焦 tooltip + 横向滚动 + 窄屏滚动提示。**不含取数、不含统计、不含切换** |
| `components/ScoreTrendCard.vue` | **卡片外壳**。取数（`cachedResource('/api/student/score-trend?examTypeCode=…', ['student'], 30_000)`）、统计条、raw/scaled 分段切换、加载/错误/空状态、刷新按钮、脚注。内部使用 `ScoreTrendChart` |
| `api/platform.js` | 新增 `listStudentScoreTrend(examTypeCode, { force })` |

`ScoreTrendCard` 是公共组件而非每模块一份：卡片外壳、统计条、切换控件、状态文案全部与考试类型无关，差异只来自接口返回的 `unit` 与 `scoreMaxVaries`。三个工作区共用真正的同一份样式，满足"样式统一"。

### 6.2 改造文件

| 文件 | 改动 |
|---|---|
| `views/ExamTypePage.vue` | 学生分支插入 `<ScoreTrendCard :exam-type-code="selectedType.code" />`（My Exams 之后）；不新增 computed 与取数逻辑，约 +3 行 |
| `examTypes/shsat/admin/pages/StudentDetailPage.vue` | `<AppCard title="Score Trend">` 内部换成 `<ScoreTrendChart>`，删除内联图表计算（第 21–23、40–56、184–230 行）及对应模板与样式。`stats` computed 保留（管理端口径不同，本次不动） |

`ClassExamScoreTrend.vue` **不合并**：多序列班级平均分 + raw/scaled 切换，纵轴与数据源语义都不同。

### 6.3 统计条样式

与截图一致：浅灰描边瓷片、小号大写 `letter-spacing` 标签、大号数值。

```
TOTAL ATTEMPTS   COMPLETED   AVERAGE SCORE   HIGHEST SCORE
18               18          375             509
```

- 桌面 4 列；≤ 900px 两列；≤ 560px 单列。
- 切换 raw/scaled 时 Average 与 Highest 有过渡动画（`transition: color .15s` 即可，不做数字滚动）。

### 6.4 切换控件

分段按钮（两段），不用 `<select>`：

```
[ Scaled score | Raw score ]
```

- 位置：统计条下方、图表上方，与 `ClassExamScoreTrend.vue` 的 toolbar 位置一致（保持视觉习惯一致）。
- 仅 `available` 的模式可选；只有一个可用时整个控件不渲染。
- 选中态用 `--color-primary` 填充，未选中为描边。
- `aria-pressed` 标注。

### 6.5 图表细节

- 尺寸：`width = max(760, 72 * (points-1) + 72)`，`height = 320`；容器 `overflow-x: auto`，`min-width` 绑定 `width`。
- 单点（仅一次考试）不画折线，只画点。
- 值标签：首点右对齐、末点左对齐，其余居中。
- tooltip：考试标题、提交时间、`Scaled score 406 / 720` 或 `Raw score 43 / 54`。定位沿用 `is-below` / `is-left` / `is-right` 三档避让。
- 无障碍：每点 `tabindex="0"` + `aria-label`；SVG `role="img"` + `aria-label="Score trend over time"`。
- 颜色只用既有 token：`--color-primary` / `--color-border` / `--color-muted` / `--color-text`。

### 6.6 空与异常状态

| 情况 | 呈现 |
|---|---|
| 加载中 | `Loading score trend...` |
| 无任何正式尝试 | `No completed exams to chart yet.` |
| 有尝试但两模式都无可见分 | `Your scores are not available yet. Check back after your teacher opens them.` |
| 仅 raw 可用 | 正常显示 raw 曲线，图下说明 `This exam system has no scaled score table, so raw scores are shown.` |
| `excluded.notVisible > 0` | 图下脚注 `N attempt(s) are not shown yet because their scores have not been opened.` |
| 请求失败 | 错误文案 + `Retry` |
| 接口 404（后端未升级） | 显示错误态，不影响其他三张卡 |

## 7. 边界情况

| 情况 | 期望 |
|---|---|
| 三个工作区 | 同一张卡、同一接口，仅 `examTypeCode` 不同 |
| SAT 与 PSAT | 各自独立工作区、独立 provider、独立曲线；不混排 |
| 同一场考试多次作答 | 每次一个点，tooltip 显示 `Attempt #2` |
| 切换 raw/scaled | 统计条、曲线、tooltip 同步；默认 scaled |
| SHSAT `RAW_ONLY` | 隐藏切换控件，只显示 raw |
| `score_visibility = AFTER_CLOSE` 且未结束 | 计入 Completed，不进曲线与 Average/Highest，计入 `excluded.notVisible` |
| `ungraded_count > 0` | 不进曲线，计入 `excluded.notScored` |
| 未作答（`IN_PROGRESS`） | 只计入 Total attempts |
| 迁移导入的 SAT 旧成绩 | 以 `source_score_json` 封存字段为准 |
| 学生退班 / 换班 | 曲线不变（按 `student_user_id`，不看班级） |
| 无工作区授权 | `403`；卡片显示错误态 + Retry |
| 390px 视口 | 图表横向滚动 + 滚动提示，卡片无横向溢出 |
| 数百次尝试 | 不设上限，靠横向滚动；超过 200 点再议（本次不做） |

## 8. 验收标准

1. 学生登录 SHSAT / SAT / PSAT 任一工作区，`My Exams` 与 `Assigned Review` 之间出现 `Score Trend` 卡片。
2. 三个工作区的卡片外观完全一致（同一公共组件）。
3. 统计条 4 个瓷片数值与接口 `statistics` / 当前 series 一致；切换 raw/scaled 后 Average 与 Highest 随之更新。
4. 曲线按提交时间从早到晚排列；悬停/键盘聚焦显示标题、时间与 `分数 / 满分`。
5. 只出现正式考试；练习、未完成、未开放分数、未判完的均不出现，并在脚注中说明被排除的数量。
6. 曲线不包含任何其他学生或班级平均数据。
7. raw 满分不一致时出现对应脚注。
8. 管理端学生详情 Score Trend 外观与行为与改造前一致（共享组件抽取无回归）。
9. 1440px 与 390px 无横向溢出，`pageErrors = 0`。
10. `npm run build` 通过；后端相关测试通过。

## 9. 取舍与已知代价

1. **SHSAT 会多一次请求**：学生首页对 SHSAT 学生并发请求 `attempts/history`（列表）与 `score-trend`（图表），约 2 条聚合查询、15–30s 缓存，可接受。合并两者需先迁移列表，属独立任务。
2. **口径全部在后端**：前端不做二次计算，避免两端口径漂移。代价是切换 raw/scaled 需要前端在设计上支持"两套序列同时下发"——本方案一次返回两条序列，切换纯本地，**不发新请求**。
3. **raw 不做百分比归一**：见 5.4，保真优于好看。
4. **管理端 Student Detail 改用共享图表组件**：属必要的小重构，有 `e2e/student-detail-cache.cjs` 兜底，仍需回归。
5. **`ReportVisibilityPolicy` 平移**需同步 3 处 import。

## 10. 测试计划

| 项 | 内容 |
|---|---|
| 后端单测 | `StudentScoreTrendServiceTest`：类型解析、无授权 403、未注册类型的 400、两条序列组装 |
| 后端单测 | `SatAttemptScoreCalculatorTest`：抽取前后与 `SatAdminStudentScoreService` 输出一致（SAT 1600 / PSAT 1520 / legacy 导入） |
| 后端单测 | `ShsatScoreTrendProviderTest`：量表分、`RAW_ONLY` 隐藏 scaled、`AFTER_CLOSE` 未结束不可见、`scoreMaxVaries` |
| 后端单测 | `SatScoreTrendProviderTest`：raw 满分随题数变化、`scoreMaxVaries = true`、`AFTER_CLOSE` 裁剪 |
| 前端 mock e2e | `frontend/e2e/student-score-trend-mocked.cjs`（`npm run test:e2e:shsat:score-trend-mocked`）：默认 scaled / 切到 raw 后统计条联动 / 仅 raw / 无数据 / 无可见分 / 接口失败 / `scoreMaxVaries` 脚注 / 单点 / 1440 与 390 布局 |
| 前端回归 | `node e2e/student-detail-cache.cjs`（管理端图表抽取回归）、`npm run test:e2e:shsat:my-exams-grouping-mocked` |
| 构建 | `npm run build` |

## 11. 影响面

- 后端：新增 7 个文件（4 平台 + 3 类型 provider）+ 2 处改造；**无数据库迁移**。
- 前端：新增 3 个文件、改造 2 个文件；`ExamTypePage.vue` 仅 +3 行。
- 测试：新增 4 个后端测试类 + 1 个前端 mock e2e；`package.json` 增一条脚本。
- 风险：`ReportVisibilityPolicy` 平移的 import 同步；`StudentDetailPage.vue` 图表替换需回归确认数值标签与 tooltip 位置不变。

## 12. 待确认项（不阻塞开工，按默认值实施）

| # | 问题 | 默认取值 |
|---|---|---|
| 1 | 是否显示"较首考提升 +156"之类的爬升提示 | **不做**，统计条已足够；后续看反馈再加 |
| 2 | 是否画同分段的水平参考线（如 SHSAT 目标 500） | **不做**，目标分属教师设定，学生端不擅自定义 |
| 3 | 点数很多时是否抽样 | **不抽样**，靠横向滚动；超过 200 点再议 |
| 4 | 切换偏好是否记住 | **不记住**，每次进入默认 scaled |
| 5 | 是否支持按考试类型筛选（若将来 SAT 工作区容纳多类型） | **不做**，当前一工作区一类型 |
