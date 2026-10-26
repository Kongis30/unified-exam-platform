# 新 SHSAT 功能对齐与逐页验收清单

> 基准：`shsat_exam_system/new_system` 的 `shsat_web` 与 `shsat_server`；不包含旧 SHSAT。目标：`unified_exam_platform` 的 SHSAT 模块。整理日期：2026-10-26。
>
> 本文是**执行清单和首轮现状记录**，不是“全部功能通过”的结论。`[ ]` 待操作验证；`[x]` 已按该项说明验证；`[!]` 已发现差异或问题。每项完成时补上账号角色、试卷/考试样本、结果、截图或日志证据。只看到按钮或页面能打开，不算通过。

## 0. 范围、差异与验收方法

- [ ] 使用同一份有代表性的 SHSAT 数据，在独立版与统一版逐页对照：至少覆盖正式 100 题卷、含材料/图片卷、12 种题型、未开始/进行中/已提交/已结束考试、原始分/折算分、有错题的学生、无记录的学生。
- [ ] 管理员、教师、学生分别验收可见入口和接口权限。统一账号、统一班级、跨考试类型班级成员是已确认的新需求；独立版的单独登录和页面内创建账号由统一账号页替代，不作为缺项。
- [ ] 对每个可写操作检查：成功后的数据持久化和刷新反馈、失败/冲突提示、重复点击、返回路径、权限拒绝。所有面向用户的消息必须为英文。
- [ ] 每个页面截取桌面 `1440×900`、窄屏 `390×844` 的**首屏和关键内容区**；弹窗、菜单、空状态、加载、错误状态另截图。对照独立版，检查无横向溢出、遮挡、乱码、错位和无效留白；表头/值对齐、字号层级、按钮可点击范围及信息密度合理。
- [ ] 导入数据对账独立记录：试卷、Part/子题型、材料/图片、试题配置与答案、分组顺序、发布、考试记录、答案、计分、报告快照、错题任务及班级归属。源数据本身不完整时标明“源数据问题”，不可直接算迁移丢失。

### 页面映射

| 独立版页面 | 统一版页面/路由 | 当前判断 |
|---|---|---|
| `LoginPage`、`SystemSelectPage` | `/login`、统一系统选择页 | 按统一入口验收 |
| `AdminHome` | `/exam-types/SHSAT/admin` | 已能加载，所有操作待逐项验收 |
| `PaperEditPage` | `/exam-types/SHSAT/admin/papers/:paperId/edit` | 已能加载，保存操作待验收 |
| 原 `StudentExam` 预览模式 | `/exam-types/SHSAT/admin/papers/:paperId/preview` | 已能加载，题型与导航待验收 |
| `PaperExportPage` | `/exam-types/SHSAT/admin/papers/:paperId/export` | 已能加载，打印输出待验收 |
| `ExamMonitorPage` | `/exam-types/SHSAT/admin/exams/:examId/monitor` | 实时数据与题目详情已抽测；全功能待验收 |
| `ClassDetailPage` | `/exam-types/SHSAT/admin/classes/:classId` | 可加载；V1 已修复，详见第 8 节 |
| `ClassExamResultsPage` | `/exam-types/SHSAT/admin/classes/:classId/exams/:examId/results` | 已能加载，统计待验收 |
| `StudentDetailPage` | `/exam-types/SHSAT/admin/classes/:classId/students/:studentId` | 已能加载，趋势/历史待验收 |
| `WrongAnswerTaskPage` | `/exam-types/SHSAT/admin/classes/:classId/exams/:examId/wrong-answer-tasks/:taskId` | 已能加载，任务记录待验收 |
| `StudentHome` | `/student/systems/SHSAT` | 已补 History 三标签；核心列表与练习链路开始实测，详见第 8 节 |
| `StudentExam` | `/student/shsat/exams/:examId`；管理员兼容入口 `/student/exams/:examId` | 入场页已能加载，完整作答待验收 |
| `StudentAttemptReport` | `/student/attempts/:attemptId/report` | 可加载；V2 已修复，详见第 8 节 |
| `WrongAnswerReviewPage` | `/student/attempts/:attemptId/wrong-answers` | 已迁入页面和路由；真实学生错题复习页已渲染 |

## 1. 统一入口与 SHSAT 首页

- [ ] 登录：用户名/密码必填、错误密码、禁用账号、退出与过期会话、刷新后身份恢复；进入 SHSAT 不需再次登录。
- [x] 角色登录与接口边界抽测：管理员、临时教师、临时学生均成功登录；教师可读 SHSAT 班级但不能读账户目录，学生可读考试列表/本人历史但不能访问管理班级接口；临时账号已清理。错误密码、禁用账号、退出和刷新恢复已另行抽测；空字段即时校验与会话自然过期仍待测。
- [x] 登录会话抽测：空用户名/密码分别显示英文必填提示且不发请求；错误密码返回英文 `Invalid username or password.`；禁用用户无法登录；成功登录后 `/api/auth/me` 保持身份，退出后会话立即失效。管理员浏览器刷新后仍显示登录身份；临时账号已删除。截图 `125-login-invalid-password.png`、`126-login-required-fields.png`。会话自然超时仍待测。
- [ ] 系统选择：学生选择 SHSAT；管理员/教师进入 SHSAT 后台；顶部导航与其它模块一致，考试作答页不显示平台导航。
- [x] 三种角色登录入口烟测：管理员账号 `admin` / `1` 能进入平台；临时教师账号能进入 SHSAT 后台并看到 Exam Release、Review Assignments、Classes，同时不显示 Paper Management；临时学生账号登录后进入系统选择并打开 SHSAT 学生工作区；教师刷新后会话身份保留。错误密码和禁用账号均显示英文 `Invalid username or password.`；临时账号已删除，脚本错误为 0。截图 `52-teacher-shsat-admin.png`、`53-student-shsat-home-mobile.png`。必填校验、退出及会话过期仍待验收。
- [ ] 管理员首页 Available Exams：刷新、折叠/展开及刷新后记忆；卡片只展示开放期内可进入的考试，显示时间、试卷、时长、状态；`Start Exam` 进入考试、退出返回原处；空状态正确。
- [x] 管理员首页折叠记忆回归：分别折叠 Available Exams 与 Assigned Review 后刷新，两区仍保持折叠；清除本次测试偏好并恢复页面初始展开状态。当前数据库没有开放中的 SHSAT 考试，Available Exams 正确显示空状态，因此本次不据此判断开放考试卡片字段和 Start Exam。
- [ ] 管理员首页 Assigned Review：刷新、折叠/记忆、任务卡片 `View Progress`、返回原标签位置；任务人数、完成数与详情一致。
- [ ] 管理标签：`Paper Management`、`Exam Release`、`Review Assignments`、`Classes` 切换后滚动位置稳定，路由返回时恢复标签/筛选；教师只见获授权操作。
- [x] SHSAT 无历史返回兜底：发现多个页面 push 到不存在的路由名 `admin`，修正为 `shsat-admin` 并附带目标标签。用新浏览器页直达后分别点击 Class Detail、Monitor、Paper Preview、Paper Editor 的返回按钮，均到达正确 SHSAT 后台标签；页面脚本错误为 0。完整返回上一页栈的行为仍需从各入口复核。
- [x] **G1 History 三标签已补齐。** 桌面/窄屏空状态截图及含真实临时尝试的历史数据已验证；刷新、报告入口、标签过滤尚需继续逐按钮验收（证据见第 8 节）。
- [ ] 学生 Available Exams：刷新/错误重试、按考试窗口和名额呈现 Upcoming/Available/In progress/Completed/Ended；`Start/Continue/View attempt` 分别正确进入、续考、看报告；无资格考试不泄露。
- [ ] 学生 Assigned Review：待开始、进行中、需重做、完成、截止状态；`Start review`/`Continue`/`Try again`/`View report`、剩余题量和截止时间正确。
- [ ] 学生 Exam History：按时间排序、刷新、`View Details`/`View Report`、重考多次记录、只有本人记录可见；返回后保留列表位置。
- [x] **History / report 定向闭环**：学生提交后回到统一 SHSAT 学生工作区，刷新 Exam History 可找到该记录并从历史再次打开本人报告；用临时学生复核，无浏览器脚本错误。历史分页、多次重考筛选与滚动位置仍待验收。
- [x] **G2 个人错题本核心链路已补齐并通过真实数据烟测。** 检查清单中仍需逐项验收的题号导航、上一题/下一题、图片放大、最近练习报告及与教师任务隔离。

## 2. Paper Management：每组与每卷

- [ ] 搜索框与 `Search`、文件夹筛选、Online 状态筛选：单独/组合使用，清空与刷新后结果和计数正确，空结果提示清楚。
- [ ] `Create Folder`：名称必填/重复/取消/确认；组列表更新；文件夹默认折叠、展开/收起与记忆。
- [ ] 分组拖动排序：首组、中间组、末组互换，拖入第二组或拖出第二组均持久化；刷新/重新登录顺序一致；每个组恰好一次，默认组规则正确。
- [x] 分组顺序回归抽测：在真实 SHSAT Paper Management 页面将第二个可拖动分组移到第三个位置；刷新后 UI 顺序与后端 `sortOrder` 一致，所有 7 个 group ID 唯一且完整；测试后通过正式排序接口恢复原顺序并复核成功。桌面截图 `42-paper-groups-reordered.png`。首/末组、反方向拖动、重新登录持久化仍待覆盖。
- [x] 分组第二位双向回归：真实拖动第三组进入第二位、第二组移到末位；拖动后 UI 与服务端顺序完全一致，刷新后仍保持；之后将所有 7 组恢复至测试前顺序并复核。无页面脚本错误。截图 `114-paper-group-drag-result.png`。这次覆盖了用户报告的“目标是第二组”场景；首组互换和重新登录后的持久化仍待测。
- [ ] 组操作 `Rename folder`、`Delete empty folder`：编辑、取消、成功刷新；非空不能误删；表内缩进、组名、数量和操作图标视觉一致。
- [x] 文件夹 CRUD 烟测：空名称显示英文必填错误；新建/重命名写入数据库并刷新后保留；取消创建不产生记录，取消删除保留文件夹，确认删除只删除空文件夹。临时文件夹已清理；浏览器脚本错误为 0。桌面状态截图 `43-folder-validation.png`、`44-folder-renamed.png`、`45-folder-delete-confirm.png`。
- [ ] `Create Paper`：名称、时长、状态等字段校验；创建后出现在正确分组，能从列表打开编辑。
- [x] 新建/删除试卷烟测：Paper Name 为空显示英文校验；补正后错误即时清除；成功创建后进入该试卷编辑器，ELA/Math 区域显示，列表/API 均可查到；从列表走 10 秒冷静期删除，确认后行消失且详情 API 为 404。临时试卷已删除；截图 `46-paper-create.png`、`47-new-paper-editor.png`、`48-paper-delete-cooldown.png`。此项只验证新建空草稿元数据和删除，不代表添加题目/保存题目通过。
- [x] Paper List action 菜单接入：发现 SHSAT AdminHome 漏导入共享 `AdminActionMenu`，导致菜单按钮未渲染、操作项作为普通按钮显示；补齐导入后确认每行显示省略号入口、Delete 排最后、Escape 可关闭；`Export PDF` 可进入导出页。115 题卷 PDF 输出 218,673 bytes、13 页 Letter，抽取文本含章节/题目内容，浏览器脚本错误为 0。封面后的空白页在独立版导出中也明确存在，是双面打印留白，保持一致；截图 `37-paper-export.png`，PDF `37-paper-export.pdf`。`Move` 仍待验证。
- [x] 纸卷只读操作抽测（SHSAT CRASH COURSE TEST 6）：`Detail` 显示纸卷名/分组题数，关闭正常；`Edit Info` 字段正确载入，取消不改数据；`Preview` 可显示题目并用 Back 回到 Paper Management；`Edit Paper` 可加载题树/当前题，未修改时 `Save Changes` 禁用；Delete 对临时新卷显示 10 秒冷静期，期满 UI 删除成功。浏览器脚本错误为 0；桌面截图 `38-paper-detail.png` 至 `41-paper-editor.png`、`48-paper-delete-cooldown.png`。此测试样卷有 Math 50 题、ELA 0 题，不能代替完整正式卷验收；编辑保存、拖题、导入等写操作仍待验证。
- [x] 选择题编辑保存闭环：临时创建 SHSAT 试卷，在 ELA 添加选择题并编辑题干、选项和正确答案；保存后从详情 API 核对，再刷新编辑器核对字段仍保留，预览中显示相同题干/选项；浏览器脚本错误为 0。临时试卷已清理。截图 `49-question-editor-before-save.png`、`50-question-editor-after-reload.png`、`51-question-preview.png`。仅覆盖 `MULTIPLE_CHOICE`，其它题型继续逐类验收。
- [x] 修复带题目试卷删除 500：保存一题后删除会被 `paper_sections` 的父子 `RESTRICT` 外键阻止；删除服务现在先移除子分组，再级联删除父试卷，并清理不再被其它纸卷引用的题目。保存闭环临时试卷删除返回 200，随后详情查询已不存在；关联已有考试记录的删除约束仍按下方项目继续验收。
- [x] SHSAT 已就绪试卷删除级联：核对独立 SHSAT 行为后，修复统一版错误地拒绝删除 READY 试卷的问题。创建临时 READY 试卷、考试、学生尝试和错题复习任务后删除试卷，确认关联考试/尝试/复习任务均被清理，账号和班级归属保留；临时数据清理完成。Java 17 下后端 90 项测试通过；另对 SAT 已引用 READY 试卷做回归，仍正确返回 409 且保留试卷。浏览器确认弹窗截图仍待补。
- [x] 逐卷 Action 菜单 `Move`：从 `SHSAT CRASH COURSE` 将 TEST 6 暂移入 `Default Folder`，列表计数从 6/2 变为 5/3；刷新页面后仍在目标组，再移回原文件夹，计数恢复且行内容完整。无浏览器错误，未改动试卷内容。截图 `139-paper-move-restored.png`。
- [x] Paper List `Detail` / `Edit Info` / `Preview`：详情接口显示正确的纸卷元数据；发现分科标签误用预设题数（本卷总数 50、ELA 0、Math 50，却显示 50/50），改为按实际题目归属计数并核对为 0/50；Edit Info 的名称/描述/时长载入正常，取消不写入；Preview 显示 50 道 Mathematics 题目，Back 返回 Paper Management，页面无脚本错误。截图 `140-paper-preview.png`、`141-paper-detail.png`。
- [ ] `Edit Paper`、`Export PDF`、`Delete` 继续逐项回归；弹窗关闭/保存刷新、删除影响提示与确认及引用处理需覆盖；危险动作始终排最后。PDF 导出曾单独通过（见 Paper Export 项），本轮未重跑。
- [ ] 试卷列表：名称、题量、时长、分数、状态/Online 与详情相同；长名称、空字段、离线/草稿、缺失资源显示合理；排序/过滤后菜单仍对准当前行。

## 3. SHSAT 试卷编辑器、预览、导出

- [ ] 顶部 `Back to Paper Management`、计分规则选择、`Preview`、`Save Changes`：未改动禁用保存；保存/刷新仍保留结构和答案；未保存返回出现 `Stay`/`Leave Without Saving`；错误有英文提示。
- [ ] 左侧题目树：ELA/Math Part 与子题型归类、题号、选择题目、上一题/下一题、各 Part `Add Question`、材料成组题插入；组内拖动和跨组限制与独立版一致，保存后编号及归属正确。
- [ ] `Import from Exam`：源考试/题型/分析筛选、展开分组、预览、单选/多选、确认导入、取消；材料、答案、标签、图片关联不丢失，不重复导入。
- [ ] `Parts`/`Types`：新增、编辑、删除主/次类型及次序；已被题引用时给出合理处理，编辑后题目树/预览同步。
- [ ] 单题通用编辑：题型、主/次类型、难度、官方 SHSAT 技能标签、题干、解析、分值/计分段、素材类型；`Add`、`Delete`、预览和保存后结构不变形。
- [x] 选择题写入抽测：添加 ELA 题目、编辑题干/选项/答案键，保存成功；API、编辑页刷新和预览内容一致，临时卷已清理。截图 `49-question-editor-before-save.png` 至 `51-question-preview.png`；仅覆盖 `MULTIPLE_CHOICE`。
- [x] `FILL_IN_BLANK` 编辑器定向闭环：临时试卷新增填空题、编辑题干与接受答案 `1.25`；保存后从纸卷详情 API 核对 `questionTypeCode` 与 `answerKey.answers`，刷新编辑页确认答案恢复，Preview 显示相同题干；临时卷已清理，页面脚本错误为 0。截图 `72-editor-fill-in-blank.png` 至 `74-editor-fill-in-blank-preview.png`。仅证明此题型编辑/保存/刷新/预览，学生提交、计分与报告需在逐题型闭环中验证。
- [x] `DRAG_AND_DROP` 学生端作答与保存抽测：从正式卷 247 的 ELA 第 5 题，通过学生界面把 4 个选项按正确答案放入分类框；点 `Next` 后服务端答案与答案键逐项一致，浏览器脚本错误为 0，临时考试和账号已清理。桌面截图 `54-student-drag-answer.png`。这里只验证了学生端交互/保存，不代表编辑器配置、刷新恢复、提交计分和报告复核已通过。
- [x] `MULTI_SELECT_FIXED` 学生端抽测：正式卷 247 ELA 第 7 题要求恰好选 2 项；通过学生界面选择 D/E，限制提示和选中状态显示正确，继续后服务端答案与答案键相符，浏览器脚本错误为 0，临时数据已清理。截图 `55-student-multi-select-fixed-selected.png`。
- [x] `MULTI_SELECT` 学生端抽测：正式卷 247 Math 第 58 题选择全部 4 个等价答案，提示未设置数量上限；继续后服务端答案与答案键一致，浏览器脚本错误为 0，临时数据已清理。截图 `60-student-multi-select.png`。
- [x] `FILL_IN_BLANK` 学生端抽测：正式卷 247 Math 第 65 题输入 `1.93`，通过 `Next` 保存并从考试尝试接口核对答案，浏览器脚本错误为 0，临时数据已清理。桌面截图 `56-student-fill-in-blank.png`。题型创建/编辑/报告闭环仍待覆盖。
- [x] `INLINE_CHOICE` 学生端抽测：正式卷 247 Math 第 94 题，在两个下拉框分别选择 B/C；通过 `Next` 保存后，服务端返回值与两个空格的答案键一致，浏览器脚本错误为 0，临时数据已清理。桌面截图 `57-student-inline-choice-selected.png`。
- [x] `GRAPH_QUESTION` 学生端抽测：正式卷 240 ELA 第 1 题，在坐标图上实际点击两个点；继续后尝试记录中的坐标与答案键一致，页面脚本错误为 0，临时数据已清理。截图 `graph-question-answer.png`。该样题题干为空，页面显示 `Question stem is not available`，属于试卷内容缺口，不能视为样题完整或对齐通过。
- [x] `HOT_TEXT` 学生端抽测：正式卷 244 ELA 第 48 题，点击文段中的目标片段；选中状态和数量提示正常，继续后服务端选中片段与答案键一致，页面脚本错误为 0，临时数据已清理。截图 `hot-text-answer.png`。
- [x] `EQUATION_EDITOR` 学生端抽测：正式卷 244 Math 第 56 题，通过公式输入控件输入 `8x+35≤95`；公式键盘与输入显示正常，继续后答案保存成功，页面脚本错误为 0，临时数据已清理。截图 `equation-editor-answer.png`。
- [x] `SOLUTION_SET` 学生端抽测：正式卷 244 Math 第 79 题，选择闭合右射线并在数轴设定端点 9；当前答案提示为 `x ≥ 9`，继续后尝试记录端点与答案键一致，页面脚本错误为 0，临时数据已清理。截图 `solution-set-answer.png`。
- [x] `TABLE_GRID` 学生端抽测：正式卷 247 Math 第 70 题，按正确答案逐行选择 5 个单选格；点 `Next` 后服务端各行值一致，浏览器脚本错误为 0，临时数据已清理。截图 `59-student-table-grid-selected.png`。该题材料图片 `/uploads/paper-materials/27-92486950-7d42-40d7-94e1-8a84c11069d9.png` 在独立版及统一版均缺失。
- [ ] `HOT_SPOT` 学生作答被缺失的源图片阻塞：正式卷 247 Math 第 62 题引用 `/uploads/paper-materials/27-3b8171c6-53bf-4796-8f68-532393316cb7.png`，文件在独立版 `shsat_server/uploads` 与统一版 `backend/uploads/paper-materials` 均不存在；不能完成区域选择。已修复图片失败时遗留的破图标/替代文字，并验证英文错误提示干净显示。需要找到源图片后才能验收作答和计分。截图 `58-student-hotspot-unavailable-clean.png`。
- [ ] 素材操作：选择已有、新建、清除文本/图片材料；图片上传、截图粘贴、预览/放大/重置/关闭，Markdown/公式插入与显示；共享材料编辑影响范围与源系统一致。
- [ ] **逐题型闭环**：12 类题均需完成创建→保存→刷新→预览→作答→提交→报告复核。当前 11 类已有学生 UI 作答及答案持久化抽测证据，但尚未逐类完成创建/编辑、刷新恢复、预览、提交计分和报告复核；`HOT_SPOT` 被源图片缺失阻塞。每类选项/交互数据、答案键、评分及解析需逐字段对照，不能只测选择题。
- [x] **新增四类学生端作答回归**：`GRAPH_QUESTION`、`HOT_TEXT`、`EQUATION_EDITOR`、`SOLUTION_SET` 均通过实际浏览器交互后保存，并从尝试 API 核对答案；零页面脚本错误，临时考试和学生账号清理完成。截图分别为 `graph-question-answer.png`、`hot-text-answer.png`、`equation-editor-answer.png`、`solution-set-answer.png`。坐标图样题内容不完整，题干为空；其控件行为虽通过，内容质量仍待修复/与独立版对账。此项不替代逐类型提交计分和报告验收。
- [x] 学生考试工具栏桌面抽测：书签开关、Review 面板与 Bookmarks 筛选、Notepad 关闭/重开保留当前尝试内内容、Answer Eliminator 划除与 Restore、高亮选中文字并应用黄色、Drawing Pen 开关/颜色菜单、Line Reader 拖动、字号 1.3x、页面宽度切换均可操作；全屏已处于考试要求状态时按钮正确禁用；页面脚本错误为 0，临时数据已清理。截图 `61-toolbar-in-exam.png`、`70-answer-eliminator.png`、`71-highlighted-text.png`。尚未在含材料题上验证画笔笔迹与工具状态跨刷新持久化。
- [x] SHSAT 管理端窄屏首屏抽查：Paper Management、Exam Release、Review Assignments、Classes、试卷编辑/预览/导出、班级详情、Monitor 均记录 390×844 截图，无页面脚本错误；除导出外页面根节点无水平溢出。原导出预览把 Letter 页面撑宽至 840px，已将固定纸张限制在独立横向滚动区、将工具栏改为窄屏纵向布局；修复后所有上述页面根节点宽度为 390px，导出页仍可在预览区横向查看完整纸张。前端生产构建通过。截图 `62-admin-papers-mobile.png` 至 `68-monitor-mobile.png`。这是首屏与布局抽查，不代表每个表格/弹窗均完成窄屏验收。
- [ ] 题型内按钮：填空可接受答案增删；拖拽 Item/Zone 增删和正确匹配；Hot Text/Spot 区域增删及坐标；图表点、方程输入、解答集等题型专用控件都要检查初始、修改、清空、保存恢复。
- [ ] 预览：`Back`、上一题/下一题、Review 面板与题号跳转、书签、工具栏、ELA/Math 转换；预览不写入正式学生记录；缺失题干/图片给出准确提示。
- [x] SHSAT PDF 分区与导出按钮回归：纸卷 252 导出曾把 ELA/Math 的 `scoringSectionCode` 在通用映射中丢失，导致 ELA 仅显示题 58、其余 115 题都归为 Other。修复映射后 PDF 分区为 ELA 1–57、Math 58–114、Other 115（该题源记录没有 ELA/Math 标签，页面已有明确提示且 Whole Paper 保留）；验证 Student Paper/Answer Key、ELA/Math/Whole Paper 切换及打印按钮状态。34 页 Letter PDF 非空，题序完整到 115，首个分区和末页已截图复核。窄屏纸张滚动不影响打印版。PDF `/tmp/shsat-visual-audit-20261026/69-paper-export-print-regression.pdf`。第112题源内容字面为 `question in image`，需查独立源资源/数据是否同样缺图；不能把该题内容质量标为通过。
- [ ] 导出：Student Paper/Answer Key、Whole Paper/ELA/Math 切换；`Print / Save ... PDF` 输出非空、有正确题序/页码/图片/公式/答案和分页，打印预览不裁切；无 ELA/Math 标签题给出提示，不能静默丢题。上述已完成纸卷 252 Whole Paper Student Paper 走查，Answer Key、单科导出、题型公式/图片和其它代表卷仍待验收。

## 4. Exam Release 与 Historical Exams

- [ ] `Create Exam`：标题/说明、试卷选择、开放/截止日期时间、考试时长、次数、面向全部学生或指定班级/学生；时间顺序与时区校验、题目结构风险确认，取消不产生记录。
- [ ] 发布前检查：试卷 READY/Online、ELA 与 Math 计分段、题量/答案完整性、截止时间与资格；`Publish`、`Unpublish` 成功后 Student Access 与卡片同时更新；重复提交/并发/409 给出可理解提示。
- [ ] 发布资格：全体/指定班级/指定学生规则正确；开放期间新加入目标班级的学生自动有资格，离班后资格、已在考/已提交记录处理符合规则。
- [x] 开放期新入班资格端到端：管理员创建临时班级和定向 SHSAT 考试，先加入一名学生并发布，再将第二名学生加入目标班级；该学生在统一学生首页看见考试并进入 ELA 考试说明页。班外学生首页无此考试，直接请求入场返回 404。临时考试、班级、学生均已清理并核对（考试/班级接口均为 404）；截图 `75-open-class-new-student-exam.png`，页面脚本错误为 0。
- [ ] 主表：搜索、visibility/time window/assigned-to 筛选，Refresh、折叠/展开、每页行数和前后翻页；表头/值对齐、时间 24 小时制到分钟；试卷被删除时考试名下显示明确提示。
- [ ] Action 菜单：当前场次 `Publish/Unpublish`、`Monitor`、`Delete`；结束场次 `Monitor`、`Delete`，删除始终最后。菜单不能被表格/分页裁切，键盘 Esc 和外部点击可关闭。
- [ ] Historical Exams：过期场次归档并自动不再对学生开放，展示状态应为 Unpublished；展开/收起、分页；删除需说明连带考试记录/答案/成绩/报告/任务，提供 5 秒冷静期，确认后级联删除，取消不改动数据。过期/学生不可开考与带进行中尝试的删除闭环已实测（见下）；已提交报告、关联 review task、取消删除、折叠和分页仍待验收。
- [x] **删除级联抽测**：有进行中学生尝试的测试考试，经 UI 的 5 秒确认后删除；考试接口返回 404，学生历史不再包含该尝试。截图 `35-monitor-live-data.png`；报告/复习任务等其它关联记录仍需逐类核对。
- [x] **过期场次与删除冷静期回归**：创建仅对临时学生开放的短时考试，截止后确认服务端自动转为 `CLOSED`、Historical Exams 显示 `Unpublished`、学生列表不再开放且直接开考返回 409。随后通过管理 UI 删除一场带有进行中学生尝试的临时考试：5 秒内按钮禁用，倒计时后确认删除，考试详情返回 404、学生历史尝试被级联清除；临时学生也已清理。桌面/窄屏均目视复核，确认对话框内容完整、按钮可见；浏览器脚本错误为 0。截图 `109-expired-exam-unpublished-desktop.png`、`110-expired-exam-unpublished-mobile.png`、`111-exam-delete-cooldown-desktop.png`、`112-exam-delete-cooldown-mobile.png`。本次没有覆盖已提交报告及关联 review task 的级联数据。
- [x] 统一账户管理端到端回归：使用临时账户验证创建及可选资料、默认姓名排序、姓名/用户名与联系方式搜索、角色筛选和修改、密码重置后实际登录、禁用/启用、5 秒删除确认与删除后目录查无该账号。测试脚本通过：`frontend/e2e/sat-account-management.cjs`。桌面截图 `/tmp/sat-account-management-ui.png`；390px 窄屏目视复核，页面与文档宽度均为 390px，无横向溢出，截图 `113-admin-accounts-mobile.png`。临时账号已清理。
- [ ] 考试发布/撤回/删除后，首页卡片、班级考试、监考与学生入口同步更新；有尝试记录的场次按业务规则处理，不误删别的考试或用户。

## 5. Review Assignments 与班级

- [ ] Review Assignments 搜索、按考试/班级筛选、Refresh、Create Assignment；设置来源考试、班级、开始/结束时间及目标，校验无来源记录/无错题/时间冲突；发布后人数和状态准确。已验证教师创建成功及默认来源考试/时间，字段错误、取消和选定自定义时间仍待测。
- [ ] 表格 Action：`View Progress` 返回原标签与筛选位置；`End`/取消任务及确认；状态、完成/资格、进行中/未开始/缺少源尝试统计要与详情相符。
- [ ] 任务进度页：Back、Refresh/Retry、逐学生题数/状态/完成时间、`View Report`；截止/重做/零剩余题、源考试删除后的状态和提示准确。
- [x] Review Assignments 搜索/筛选与只读流程抽测：2 条任务可见；不匹配搜索显示空状态，按考试筛出 2 条、再按班级筛出 1 条，Refresh 后仍保留筛选；创建弹窗打开后取消不写入数据。动作菜单顺序为 `View Progress`、`End`；打开 End 确认后取消，任务状态未变化。`View Progress` 展示学生资格、状态和题数，`View Report` 打开对应学生任务报告并返回进度页，`Back to Review Assignments` 返回带原 `tab` 的后台路由。390px 根节点宽度保持 390px，无浏览器脚本错误。截图 `99-review-assignments-desktop.png`、`100-review-assignment-create-modal.png`、`101-review-assignments-mobile.png`、`102-review-student-report-desktop.png`。字段错误提示、取消 End 和有真实错题来源的学生作答仍待验收。
- [x] 教师 Review Assignment 创建与结束闭环：临时教师为仅含一名临时学生的班级发布正式 SHSAT 考试，再从 SHSAT 后台创建任务；接口核对 `assignedCount=1`、`noSourceAttemptCount=1`，进度页明确显示 `No source attempt`、0/0 题和正确人数。通过 `View Progress` 后返回 Review Assignments，接受 `End` 确认后接口状态为 `ENDED`；教师仍无账号目录权限（403）。删除测试考试后复查任务和临时账户均已清理，页面脚本错误为 0。截图 `115-review-assignment-create-filled.png`、`116-review-assignment-created.png`、`117-review-task-progress.png`。有已提交错题源尝试的学生作答/重做、取消 End、截止后状态仍待测。
- [x] Review Assignment 进度页窄屏布局修复：原表格固定最小宽度 1000px，390px 下只露出前两列且其余字段需横向滑动；现改为带字段名的学生进度卡片，完成/状态/准确率/进度都可见，无结果页横向溢出。桌面表格保持原布局；返回 Review Assignments 路由回归通过。生产构建通过，页面脚本错误为 0。截图 `118-review-task-progress-mobile.png`（修复前）、`120-review-task-progress-mobile-cards.png`（修复后）。
- [x] 学生真实错题源任务启动抽测：临时学生完成一场已发布 SHSAT 考试后，教师创建班级 Review Assignment；接口核对已生成错题题目及 `NOT_STARTED` 资格。学生从 SHSAT 首页的 Review Assignments 点击 `Start review`，通过全屏提示进入独立 SHSAT 考试界面；服务端关联练习 attempt，教师进度状态更新为 `IN_PROGRESS`。零页面脚本错误；结束后考试、任务、临时学生及班级已清理。截图 `121-review-assigned-exam-desktop.png`。选用的源卷（Official SHSAT Label Template）有 9 道样题，其中图表第 1 题题干为空，这是源数据问题；任务完成/重试/报告闭环、窄屏该入口仍待测。
- [x] 学生 Review Assignment 完成/重做回归：从首页 `Start review` 启动后，在考试页用 `Submit Exam` 和确认弹窗提交；任务状态变为 `RETRY_REQUIRED`，仍有 9 题。首页 `Try again` 创建新练习，提交其中一道答对的选择题后再次经 UI 确认交卷并进入报告；报告答案与得分为 1/1 正确，任务剩余题由 9 降至 8，状态仍为 `RETRY_REQUIRED`。页面脚本错误为 0，考试/任务/临时账户已清理。报告截图 `123-review-report-after-retry-desktop.png`；此测试卷只有 9 题，若干题无技能标签，图表题题干为空，仍是源卷内容问题；全做正确后的 `COMPLETED` 状态及移动端仍待测。
- [ ] Classes 首页：搜索、`Create Class`、刷新、卡片打开、空班删除、拖动顺序持久化；同一学生可加入多个班级；班级能接收 SHSAT 或 SAT 场次。
- [x] 学生多班归属隔离烟测：将临时学生同时加入两个班级，从其中一个班移除后，另一个班仍保留其成员关系；随后删除临时班级和账号，均成功且无遗留。
- [ ] Unassigned Students：刷新/折叠、最多 800px 内滚动、表头全选/逐项多选、`Assign selected`、班级选择、取消/提交；已在其他班的学生不应被误标“未分配”。
- [x] Unassigned Students 数据筛选回归：只显示当前没有任何有效班级归属的学生账户；已分配到其它班的测试账户不会进入未分配列表。测试账户和班级已清理，截图 `133-unassigned-students-filtered.png`。
- [ ] 班级详情：Back、`Edit Class`、Refresh、字段校验、保存反馈；班级考试搜索/排序/分页、`View Results`/`Monitor`；学生表 `View`/`Edit`/`Delete`、批量 `Add student` 搜索与已属班级标注、多选加入；不得误删统一账号而只应移除本班归属（具体删除语义需与当前按钮文案核对）。
- [x] 班级详情批量添加学生回归：将入口明确为 `Add Students`；弹窗提供搜索表格、多选、全选当前结果，并显示学生姓名、用户名、现有班级和邮箱。已用临时学生验证从搜索到加入成功、刷新后成员关系落库；该学生可同时属于多个班级。桌面截图 `130-class-add-students-desktop.png`，390px 窄屏截图 `132-class-add-students-mobile-fixed.png`、`136-add-student-membership-mobile.png`；窄屏根节点宽度为 390px，无横向溢出，移动端保留学生姓名和现有班级列。后端学生选项接口现返回邮箱，控制器测试覆盖字段映射。
- [x] 班级成员移除语义修正并端到端回归：班级详情操作由 `Delete` 改为 `Remove`，确认窗口说明只移除当前班级成员关系，账户、考试历史及其它班级关系保留；不再使用误导性的永久删除措辞或 10 秒冷静期。临时学生同时加入两个班后，从一个班移除，再次验证账户仍存在且另一个班成员关系保留；随后从批量添加弹窗重新加入并确认两班关系都存在。截图 `134-remove-student-modal.png`；页面脚本错误为 0，相关测试数据已清理。
- [x] SHSAT 班级资料编辑持久化：发现详情表单中的教师姓名/邮箱、年级、学年、Active 状态没有接入共享班级 API，且详情查询会丢弃这些字段；现使用现有 `shsat_class_metadata` 保存 SHSAT 扩展资料，通用班级状态仍写 `classes`。界面修改并保存后，刷新核对资料与 Inactive 状态，API 字段一致；SAT 班级创建/更新回归仍返回 ACTIVE，SHSAT 扩展字段保持为空；临时班级已删除。Java 控制器测试及全量 92 项后端测试、前端生产构建通过；桌面/390px 截图 `127-class-metadata-before.png`、`128-class-metadata-after.png`、`129-class-metadata-mobile.png`，窄屏无横向溢出。班级字段校验和其它按钮继续待测。
- [x] `Class Exam Score Trend`：复核 SHSAT 文案、raw/scaled 提示和无数据状态；桌面截图确认没有 SAT/PSAT 范围提示。仍需用带 SHSAT 折算分/考试点的数据验证曲线与悬浮内容。
- [x] 班级详情统计真实数据烟测：发现统一版没有返回班级学生的平均分/已完成考试数，且班级摘要平均分为空；按已完成、非练习、学生当时属于班级且有考试资格的记录实时聚合，SHSAT 学生分数按独立版规则在折算分有效时使用折算分，否则回退原始分。SHSAT 学生统计显示 17 名有成绩、1 名无记录；班级摘要显示平均分 52.53。SAT/PSAT 查询也已烟测返回样本统计。截图 `81-class-student-stats-desktop.png`、`82-class-student-stats-mobile.png`、`83-class-summary-average-desktop.png`、`84-class-summary-average-mobile.png`；桌面和 390px 窄屏均无横向溢出，浏览器脚本错误为 0。针对聚合 SQL 的控制器测试和前端构建通过。这里只完成班级摘要及学生表统计，不代表班级详情其它操作已验收。
- [x] 班级详情非破坏性操作抽测：Edit Class 表单打开并显示当前班级信息，取消后数据未变；学生表第一行 `View` 打开对应学生详情，4 次完成考试、平均分、趋势及历史记录可见；`Back to Class Detail` 返回原班级路由。桌面截图 `86-class-edit-modal.png`、`87-class-student-detail.png`；学生详情 390px 窄屏截图 `88-student-detail-mobile.png`，页面无横向溢出，浏览器脚本错误为 0。保存编辑、刷新、View Report 等写入或跳转操作仍待逐项验收。
- [ ] 班级考试成绩页：Back、Monitor、Retry、总分/ELA/Math/正确率/提交时间排序、学生 View；无成绩/未开始/进行中/已完成统计与实际尝试一致，表头和数据逐列对齐。
- [ ] 学生详情页：Back/Refresh/Retry、总尝试/完成/平均/最高、Score Trend 的 Raw/Scaled 切换和点悬浮信息、Score History 原始分与折算分排序、`View Report`；重复考试按每次尝试显示，源记录缺少赋分表时显示 `—` 而非伪造分数。

## 6. 完整考试流程：必须用真实学生跑通

1. [ ] 管理员创建包含 ELA/Math 与代表性题型的草稿、保存并预览；正式发布到测试班级。学生在统一系统登录，选 SHSAT，看见正确卡片；未开放、已截止、未分配不可开考。
2. [ ] `Start Exam` → Instructions `Start` → 选择先做 ELA 或 Math；两种起始顺序都测。开考后计时、截止时间、限次及离线/重开规则与独立版相同。
3. [ ] 在每个 section 逐题作答：上一题/下一题、Review 的 All/Unanswered/Marked 和跳题、Bookmark、清空答案、作答时长与答题状态保存；刷新、断网恢复、跨设备或重复开考不丢答案/不重复创建尝试。
4. [ ] 工具栏：Pointer、Eliminate、Notes、Highlight 及颜色/清除、Drawing 及颜色/清空、Line Reader、Fullscreen、Font Size 各档、Width 各档、图片缩放/关闭。交互工具不能改变答案或遮挡题干；移动端/键盘可操作。
5. [ ] `Submit Section`：未答题提示、确认/取消、提交后锁定该 section，进入另一个 section；不能通过返回/刷新修改已提交内容。`Submit Exam`：确认/取消、自动或手动结束、重复提交幂等；结果只生成一次。
6. [ ] 失焦与全屏：违规提醒、继续按钮、后台记录；主动退出/返回时确认与续考；计时耗尽、窗口结束、网络异常时不会出现空白页或未提交半成品。
7. [ ] 提交后进入**本人报告**，从报告返回 SHSAT 学生工作区；再次进入显示 Completed/可重考状态。管理员从成绩页进入同一尝试报告；两个入口数据一致且权限正确。
8. [ ] 教师布置错题复习：学生进入任务、只答错题/未答题、提交后剩余题数减少；可重复至清零并看任务报告。独立错题本的个人练习另行验收，不能以教师任务代替。

## 7. Report、监考与输出

- [ ] 学生/管理员报告：Retry、Back、管理员 Monitor、`Print Report`；标题、考试/试卷/学生与提交时间准确，返回到发起页而非系统选择页。
- [x] **学生报告计时数据闭环**：报告 API 返回新考试的 `startedAt`、正的总用时以及已保存的逐题用时；修复计时起点丢失和报告查询将逐题用时固定返回空值的问题。全链路样本的报告总用时为 7 秒、逐题累计为 117 秒；后者由测试脚本逐题写入 1 秒构造，不能用于比较两种计时统计的一致性。
- [ ] Result Summary：题数、raw 总分、ELA raw、Math raw、折算分（有赋分表时）、正确/错误/空题、正确率、完成率、作答用时及离开页计数，和答案记录/计分规则逐项对账。
- [ ] Knowledge and Skills：ELA/Math 内部标签层级、题数、对错、百分比和题号；标签缺失或跨类别时有正确归类，不把 SAT 标签混入 SHSAT。
- [ ] Time Analysis：逐 section/逐题用时与暂停/续考统计；空数据不画虚假图。
- [ ] Question Review：`All Questions`、`Needs Review`、`Unanswered`、`Answered` 筛选（与独立 SHSAT 一致）；逐题跳转、原答案/正确答案/解析、材料/图片/公式和 12 种题型的结果组件；可见性规则限制未公开答案。
- [x] `Print Report`：管理员报告刷新返回 200；管理端 27 页及学生端 24 页 Letter PDF 已生成并抽查分页。知识技能分页空白已修复，学生端首屏/中间/末页文字和问题卡片可读。图片/公式极端长内容及 12 种题型 PDF 版式仍待覆盖。
- [ ] 监考页 Back、正确率热图交互、图片放大；结束考试/无人在线/无答案时图表或空状态准确，图宽不溢出容器。
- [x] **监考实时数据抽测**：真实学生开考、提交一道答案并移动到下一题后，页面显示 1 名进行中学生及当前题分布；平均用时图显示对应题的 2 秒数据；题目详情抽屉可打开并关闭。浏览器脚本错误为 0。截图 `35-monitor-live-data.png`。此结果仅为单学生、单题数据样本，不代表热图统计和其它监考操作均已验收。
- [x] 监考空答数据与班级入口回归：从班级考试表的 `View Results` 和 `Monitor` 分别进入考试 27，并从结果页返回班级；页面考试 ID 匹配且无脚本错误。目视发现无答案题曾显示红色 `0%`；原因是把 `attempt_items`（发放题目）当作答记录。现改为统计已保存答案、排除迁移数据的 `legacyAnswer: null` 空白占位，正确率仅按已评分答案计算，并显示待评分数。实测该考试 Q1–Q3 均为 `0` 已答、`1` 未答、无准确率；UI 显示灰色 `—`，点击题块能打开题目详情。单元测试覆盖未答和待评分，SHSAT/SAT monitor 测试共 4 项通过。桌面/390px 页面截图 `89-class-exam-results.png`、`90-class-exam-monitor.png`、`91-monitor-empty-answers-desktop.png`、`92-monitor-empty-answers-mobile.png`、`93-monitor-question-detail.png`；窄屏无横向溢出，浏览器脚本错误为 0。
- [x] 管理员报告入口与 Question Review 筛选定向验收：从 SHSAT 班级学生详情打开真实尝试报告，确认标题、raw 总分、ELA/Math raw、技能区、计时区及 100 道题目可见；筛选名称/数量为 `All Questions (100)`、`Needs Review (37)`、`Unanswered (0)`、`Answered (100)`，切换到 Unanswered 后显示空结果状态。报告的 `Back to Student Detail` 返回原班级的学生详情路由，而非系统选择页。桌面/390px 截图 `94-admin-report-desktop.png`、`95-admin-report-mobile.png`、`96-admin-report-unanswered-filter.png`；浏览器脚本错误为 0。此项只验证一个已有尝试的筛选与返回，不代表 raw/折算计分、答案解析可见性或全部题型结果逐项核验。

## 8. 首轮实测和视觉问题（2026-10-26）

本轮以本地数据库、管理员 `admin` 和一次性学生账号打开统一版页面。临时学生已删除，未发布或提交任何新考试。浏览器页面脚本错误为 0；**以下仅表示页面可载入与目视结果，不代表按钮业务通过**。截图在本地 `/tmp/shsat-visual-audit-20261026/`，未纳入仓库，避免把真实学生姓名与成绩提交到版本库。

| 截图 | 页面/状态 | 目视结论 |
|---|---|---|
| `01-login.png`、`15-student-workspace.png` | 登录、学生空工作区 | 首轮基线；之后已补 History/错题入口，见 `18`–`20` |
| `02-admin-papers.png`、`03-exam-release.png` | 管理首页、Paper、Release/History | 页面可读；Available/Assigned Review 在少量卡片时留白偏多；过期记录显示 Unpublished |
| `04-review-assignments.png`、`16-review-task-progress.png` | 任务列表、进度 | 可加载；任务表信息过密、时间/数字/状态字号和列宽需再调；进度页时间仍是 AM/PM，与 24 小时规范不一致 |
| `05-classes.png`、`06-class-detail.png` | 班级首页、班级详情 | `06-class-detail.png` 已重拍；SHSAT 文案与赋分提示已正确 |
| `07-class-results.png`、`08-student-detail.png` | 班级结果、学生详情 | 可加载；成绩表有排序入口；趋势需拿有 SHSAT 折算分样本复核 |
| `09-report.png`、`26-student-report-after-submit.png` | 管理员报告、学生交卷后本人报告 | 学生实际交卷跳到本人报告，完整 115 题列表可渲染；本次测试含大量未答题，仅验证路由/渲染，不作为计分准确性验收 |
| `10-paper-editor.png`、`11-paper-preview.png`、`12-paper-export.png` | 编辑、预览、导出 | 可加载；抽样的 `Official SHSAT Label Template` 有题目无题干、导出提示缺标签，须查源数据是否本来如此；实际打印待验收 |
| `13-monitor.png`、`17-student-exam-route.png` | 结束考试 Monitor、考试入场说明 | 页面可加载；初始数据为空；实时样本另见 `35-monitor-live-data.png` |
| `14-admin-mobile.png` | 390px 管理首页首屏 | 首屏未见横向溢出；其它页面窄屏截图未完成 |

- [x] **V1 已修复并截图确认**：SHSAT 班级趋势文案改为 SHSAT 专属说明，折算分提示采用 SHSAT 赋分表表述；截图 `06-class-detail.png`。
- [x] **V2 已修复并截图确认**：报告刷新按钮现在显示圆形刷新图标；重拍 `09-report.png` 已目视通过。
- [x] **V3 已修复并验证 PDF**：技能区不再作为整块强制留在同一页；PDF 内容连续分页，首尾页无截断，抽取文本覆盖到 Question 100。
- [ ] 将全部剩余弹窗、菜单、题型实际作答、报告完整页和窄屏状态补齐截图；与独立版相同状态并排比较，修复后重拍。当前只截了代表页面，不能据此判定整套 UI 达标。


### 第二轮真实业务验证（2026-10-26）

- [x] 修复真实烟测发现的创建考试 500：创建后详情查询遗漏 `allow_review`、`auto_submit`，现已补入详情 SQL，并增加 `ExamReleaseServiceTest.examDetailsReadReviewSettingsAfterCreation` 回归测试。
- [x] 后端单元/集成测试套件通过，前端 Vite production build 通过；构建仅有已有的大型分包提示。`git diff --check` 通过。
- [x] 学生个人错题端到端：临时学生登录、临时 SHSAT 考试创建/发布、正式提交、考试结束后答案开放、历史记录显示、个人练习只纳入错/空题、答对一题后从错题本清除、个人练习报告记录可见、错题页面无浏览器异常；115 道初始待复习降至 114，临时考试与账户已删除。截图 `20-wrong-answer-review.png`。
- [x] 教师登录烟测：可访问 SHSAT 班级/试卷/考试列表，可创建并编辑班级；统一账号目录返回 403，符合管理员权限边界；硬删除班级仅管理员允许，测试班级由管理员清理。
- [x] 教师权限回归重跑：教师浏览器登录后进入 SHSAT Classes，班级/试卷/考试 API 均为 200；教师创建和修改测试班级成功，账号目录为 403，班级硬删除为 403；管理员清理测试班级，临时教师账户删除。
- [x] 桌面截图目视：`06-class-detail.png` 的 SHSAT 趋势文案正确；`09-report.png` 刷新控件正常；`20-wrong-answer-review.png` 问题列表、答案状态、题目材料和返回操作可读。
- [x] 错题复习页窄屏截图 `24-wrong-answer-review-mobile.png`（390×844）：题号导航可滚动，当前题目与答案状态可见，无横向溢出；长用户名会省略显示且未挤压内容。此项只覆盖该页面窄屏，不代表其他页面已验收。
- [x] 报告刷新 API 返回 200；PDF 27 页，首屏包含结果摘要和技能区，末页完整显示最后题目；分页修复后技能行不再被整卡挤出页面。
- [x] 学生实际考试浏览器链路的两种起始顺序（ELA→Math、Math→ELA）均到达本人报告：使用正式卷 252、临时定向考试与学生，验证开始、首题 UI 作答保存、刷新恢复、提交第一 section、进入另一 section、最终提交确认与报告跳转；API 返回 `SUBMITTED`，历史状态为 `COMPLETED`，无页面脚本错误。Headless 浏览器用模拟全屏 API；为避免自动化逐题操作 115 题，其余答案由接口写入测试数据，因此**不能**据此认定 12 种题型的浏览器作答闭环或全答后计分已通过。临时数据已清理。截图 `21-student-exam-active.png`、`26-student-report-after-submit.png`。
- [x] 统一账号创建与禁用登录烟测：管理页创建临时学生，核对系统预填且可编辑的用户名及默认密码，使用账户操作禁用后尝试登录；被拒绝并显示英文错误，无浏览器脚本错误，临时账户已删除。管理员与学生登录已在考试链路实测，教师权限烟测见上文。错误密码、退出登录和过期会话仍待测。
- [x] 认证与退出补测：管理员/学生错误密码均留在登录页并显示英文错误；学生成功登录后退出，再访问受保护的 SHSAT 学生页会回到登录页；管理员退出先确认，确认后会话清除，访问 SHSAT 后台同样回登录页。浏览器脚本错误为 0，临时学生已删除。过期会话和刷新后的身份恢复仍待验收。
- [x] **SHSAT 新尝试时间戳回归**：正式尝试、个人错题练习、教师错题复习三条新建路径显式写入 `started_at`；正式考试完整浏览器流程断言开始时间不为空，报告总用时大于 0；错题练习烟测断言正式尝试及个人练习的开始时间均存在。
- [x] SHSAT Exam Release UI 闭环：实际创建 115 题试卷发布记录，确认官方结构提示后创建；通过行内/省略号操作分别发布和撤回，并从接口核对状态；打开删除确认，确认 5 秒冷静期内删除不可用，冷静期后删除成功、列表行消失；页面脚本错误为 0，临时发布已清理。桌面截图 `32-exam-release-created.png`、`33-exam-release-published.png`、`34-exam-release-delete-cooldown.png` 显示表格、发布状态和确认窗口可读。仍需用有学生尝试/报告/复习任务的考试验证 UI 删除级联清理。
- [x] SHSAT 删除级联第二次验证：对有进行中学生尝试的临时考试走管理员 UI 删除，5 秒冷静期通过后考试删除、学生历史同步移除该尝试，临时学生清理成功。截图 `35-monitor-live-data.png`；该次不包含已完成报告和复习任务关联数据。
- [x] 监考实时数据验证：实际考试过程中学生停留题目、提交答案并进入下一题；管理员监考显示实时分布、非空平均用时曲线，题目详情正常打开/关闭，无页面脚本错误。截图 `35-monitor-live-data.png`。复核中发现短用时刻度整数化后重复，现改为短时长显示一位小数，截图确认刻度为 `0s/0.5s/1s/1.5s/2s`。
- [x] 学生本人报告打印：真实学生通过考试流程提交后，点击 `Print Report` 触发浏览器打印；生成 24 页 Letter PDF，抽查第 1、2、12、24 页无空白故障页、文本未裁切，问题卡片分页可读。测试场次关闭成绩可见性；逐题用时由测试构造，PDF 用时内容不用于计分准确性或自然作答时长一致性判断。临时考试与学生已清理。
- [x] 报告计时查询回归后重跑：逐题计时随报告题目返回；打印首屏显示 ELA、Math 与总逐题时间。测试注入的逐题时间与 7 秒实际墙钟跨度不同，计时一致性需用自然作答等待重新验证。
- [x] 学生端真实完整考试与报告回归：临时学生通过页面完成 100 题 SHSAT 的 ELA→Math 流程，覆盖多选、固定多选、表格网格、拖放、热点文本、公式编辑器、内联选择、填空和数轴区间题；逐题保存请求均成功，空题继续时出现英文校验，分段提交与最终确认均可用，报告和返回学生工作区成功，浏览器无页面错误/失败请求。该测试卷按设置隐藏成绩及答案；发现报告此前因此错误显示 `0 / 0`、空的逐题计时，现通过安全的 `questionCount/answeredCount` 展示 `100 / 100`，并明确说明逐题内容受考试可见性设置限制。`Print Report` 按钮触发打印；390px 页面无横向溢出。截图 `137-student-report-hidden.png`、`138-student-report-hidden-mobile.png`；测试考试、尝试和学生账户均已删除。此次不等于验证了所有 12 种题型、成绩正确性、折算分或可见答案报告。
- [x] Review Assignment 返回路径复测：分别从首页 Assigned Review 卡片和 `Review Assignments` 表格打开现有进度页，再点击 `Back to Review Assignments`；均返回 SHSAT 后台而不是系统选择页，从表格入口返回后保留 Review Assignments 标签。未更改正式任务数据。
- [x] **真实试卷计分闭环抽测**：使用正式 SHSAT 试卷 252（ELA 57 题、Math 58 题）创建定向考试，提交 115 题答案，并通过考试页面实际输入一道填空题；报告与答案键逐题对账为 115/115 正确、0 错、0 空，ELA raw 58、Math raw 57，总分 115/115。测试确认填空答案在最终提交时来自当前界面状态，不能只靠后台写入模拟；临时考试与账号已在脚本清理。截图 `26-student-report-after-submit.png`：报告可读、两科题目分组完整、打印版页面连续。此样本验证原始题数计分及报告数据，不代表折算分曲线、全部题型真实 UI 作答或全量报告布局已验收。
- [ ] Math→ELA 起始顺序下纯 UI 完整作答和计分复核、考试工具栏/失焦与全屏违规/计时结束/断网续考仍待验证。ELA→Math 已完成一次 100 题 UI 作答保存与提交，但该次考试隐藏成绩，无法核对计分；刷新恢复及每题导航/工具操作也未完整覆盖。
- [ ] 12 种题型逐题闭环、管理员各页每个 CRUD/菜单动作、更多教师权限、PDF 极端材料/公式版式、移动端关键页面、图表有真实分数数据，以及与独立版逐页并排核对尚未完成。
- [x] 教师真实会话权限和导航回归：临时长用户名教师登录后进入 SHSAT 后台，导航只提供 Exam Release、Review Assignments、Classes；Paper Management 不可见，`/api/admin/users` 返回 403。发现 390px 下长用户名把页面撑宽至 410px；顶部账户名现限宽并省略显示。用 53 字符用户名在 390/768/1440px 复测，根节点宽度分别与视口一致，用户名触发省略，页面脚本错误为 0；临时教师已删除。桌面/窄屏截图 `103-teacher-classes-desktop.png`、`105-teacher-classes-mobile-fixed.png`、`106-teacher-classes-desktop-fixed.png`；前端生产构建通过。
- [x] **认证刷新与角色入口复测（2026-10-27）**：管理员登录 SHSAT 后台并刷新，仍保持登录且页面数据正常；临时教师刷新后仍保持后台会话，只显示 Exam Release、Review Assignments、Classes，调用统一账号 API 返回 403；临时学生刷新后仍停留系统选择页，可进入 SHSAT 学生工作区，看到正确空状态。所有临时账号已删除，浏览器脚本错误为 0。截图 `/tmp/shsat-admin-refresh-session-20261027.png`、`/tmp/shsat-teacher-workspace-20261027.png`、`/tmp/shsat-teacher-workspace-mobile-20261027.png`、`/tmp/shsat-student-system-select-20261027.png`、`/tmp/shsat-student-home-20261027.png`、`/tmp/shsat-student-home-mobile-20261027.png`；教师/学生窄屏页面根宽度均为 390px。此项只覆盖登录后刷新与角色入口，不代表会话过期、退出及登录错误路径已全部验收。
- [x] **Paper Management 文件夹 CRUD 回归（2026-10-27）**：管理员从页面新建临时分组并填写说明，刷新后仍存在；重命名后刷新仍保留新名称；从确认弹窗删除空分组后，页面及分组 API 均查无该项。临时分组已清理，页面脚本错误为 0。截图 `/tmp/shsat-paper-folder-renamed-20261027.png`。此项未覆盖重名校验、取消操作、非空分组删除限制与排序拖动。
- [x] 文件夹表单边界回归：空名称显示英文必填提示；重复已有分组名显示英文冲突提示；取消后对话框关闭且未创建记录。页面脚本错误为 0。非空分组删除限制与排序拖动仍待验收。

## 9. 建议执行顺序与完成门槛

1. **P0 学生主链路**：补齐 G1/G2；用真实学生跑完整考试、两种 section 顺序、12 题型答案保存与报告；这是切换独立 SHSAT 的门槛。
2. **P0 计分与报告**：raw/折算、ELA/Math/技能子标签、历史快照、打印输出逐项对账；删除与权限边界必须覆盖。
3. **P1 管理操作**：试卷编辑/导出、分组排序、发布与资格、错题任务、班级/监考按上面每个控件验证。
4. **P1 视觉验收**：修复 V1/V2 和首轮截图问题，逐页桌面/窄屏截图复核；所有用户提示英文，整体保持独立新 SHSAT 的简约、清晰风格。

**完成条件：** 本清单全部必需项附可复查证据、无未处理 P0/P1 差异；管理员/教师/学生真实浏览器端到端通过，导出/报告文件实测，独立版与统一版逐页截图检查通过。未测项不得改写为“已完成”。
