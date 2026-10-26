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
- [x] 学生 SHSAT 考试入口/退出回归（2026-10-27）：临时学生登录后到系统选择页，选 SHSAT 后看到仅对本人发布且当前开放的考试；`Start exam` 打开说明页，选择 ELA 后成功创建尝试进入题目页。作答期间平台导航栏隐藏。发现退出后落到旧 `/exam-types/SHSAT` 路由，已在入口附上原工作区 `returnTo`；现在确认离开后回 `/student/systems/SHSAT` 且考试卡片变为 `In progress / Continue`。临时账号、考试及尝试均清理；桌面截图 `/tmp/shsat-student-available-exam-verified-20261027.png`、`/tmp/shsat-student-exam-active-entry-verified-20261027.png`、`/tmp/shsat-student-exit-destination-fixed-20261027.png`，浏览器脚本错误为 0。该项使用模拟全屏，只证明入口和离开续考状态，完整计时/交卷链路见考试流程项。
- [ ] 管理员首页 Available Exams：刷新、折叠/展开及刷新后记忆；卡片只展示开放期内可进入的考试，显示时间、试卷、时长、状态；`Start Exam` 进入考试、退出返回原处；空状态正确。
- [x] 管理员首页折叠记忆回归：分别折叠 Available Exams 与 Assigned Review 后刷新，两区仍保持折叠；清除本次测试偏好并恢复页面初始展开状态。当前数据库没有开放中的 SHSAT 考试，Available Exams 正确显示空状态，因此本次不据此判断开放考试卡片字段和 Start Exam。
- [ ] 管理员首页 Assigned Review：刷新、折叠/记忆、任务卡片 `View Progress`、返回原标签位置；任务人数、完成数与详情一致。
- [x] **复习任务结束状态与详情返回筛选回归（2026-10-27）**：发现过期任务 API 已返回 `ENDED`，首页却只识别 `CLOSED`，导致结束任务显示绿色 Active；现按状态和截止时间统一判定，结束任务不再显示在进行中卡片，且没有可结束操作。搜索筛选后进入 View Progress 再返回，原标签与搜索条件恢复、结果仍为 1 条。1440px 与 390px 根页面无横向溢出，页面脚本错误为 0。截图 `/tmp/shsat-review-assignment-return-verified-20261027.png`、`/tmp/shsat-review-assignment-mobile-verified-20261027.png`。创建/结束写操作已由下方完整流程覆盖；所有学生状态与报告操作仍待验收。
- [ ] 管理标签：`Paper Management`、`Exam Release`、`Review Assignments`、`Classes` 切换后滚动位置稳定，路由返回时恢复标签/筛选；教师只见获授权操作。
- [x] 管理标签滚动回归（2026-10-27）：管理员在页面向下滚动后依次切换 Paper Management、Exam Release、Review Assignments、Classes，再切回 Paper Management；每次 `window.scrollY` 保持不变（381px），浏览器脚本错误为 0。截图 `/tmp/shsat-admin-tab-scroll-20261027.png`。从各详情入口返回后恢复原标签/筛选、教师页面仍待完整验证。
- [x] Classes 详情返回标签回归（2026-10-27）：从 Classes 卡片进入班级详情，再点 `Back to Classes`，返回统一 SHSAT 管理首页并仍选中 Classes；测试前后班级列表首行相同，页面脚本错误为 0。截图 `/tmp/shsat-class-detail-tab-return-20261027.png`。
- [x] SHSAT 无历史返回兜底：发现多个页面 push 到不存在的路由名 `admin`，修正为 `shsat-admin` 并附带目标标签。用新浏览器页直达后分别点击 Class Detail、Monitor、Paper Preview、Paper Editor 的返回按钮，均到达正确 SHSAT 后台标签；页面脚本错误为 0。完整返回上一页栈的行为仍需从各入口复核。
- [x] **G1 History 三标签已补齐。** 桌面/窄屏空状态截图及含真实临时尝试的历史数据已验证；刷新、报告入口、标签过滤尚需继续逐按钮验收（证据见第 8 节）。
- [ ] 学生 Available Exams：刷新/错误重试、按考试窗口和名额呈现 Upcoming/Available/In progress/Completed/Ended；`Start/Continue/View attempt` 分别正确进入、续考、看报告；无资格考试不泄露。
- [x] 学生 Available Exams 当前开放场次入口与续考状态已由上方真实 SHSAT UI 流程覆盖；Upcoming、Ended、无资格及名额耗尽状态仍待逐类验证。
- [x] **学生考试状态与受众隔离（2026-10-27）**：以真实临时发布验证 Upcoming 考试不能开始、Available 考试显示 `Start exam` 且按钮可用、未被指定的学生看不到这两场考试；页面脚本错误为 0，窄屏宽度 390/390。桌面及窄屏截图 `/tmp/shsat-student-exam-states-1793044091903.png`、`/tmp/shsat-student-exam-states-mobile-1793044091903.png` 已检查；窄屏改用视口截图，避免 Chromium 全页截图重复粘性导航的采集伪影。测试考试和学生已清理。自动化 `npm run test:e2e:shsat:student-states` 通过。Ended、名额耗尽、不同发布范围/班级成员资格边界仍待测。
- [x] **学生多次重考历史排序、刷新与本人报告隔离（2026-10-27）**：扩展 `frontend/e2e/shsat-student-exam-states.cjs`；临时考试允许两次尝试，连续提交后核对历史 API 和页面按 attempt #2、#1 最新优先显示，点击 Refresh 后重新请求历史并保留两条顺序，能从最新记录打开对应报告。第二个学生访问该报告被拒绝（403/404），确认报告仅限本人。桌面/390px 历史截图 `/tmp/shsat-student-retake-history-1793050538799.png`、`/tmp/shsat-student-retake-history-mobile-1793050538799.png` 已目视检查；390px 根宽度 390px，页面脚本错误为 0，测试账号/考试/尝试均清理。`npm run test:e2e:shsat:student-states` 通过。滚动位置恢复和超过两次尝试的排序仍待验收。
- [ ] 学生 Assigned Review：待开始、进行中、需重做、完成、截止状态；`Start review`/`Continue`/`Try again`/`View report`、剩余题量和截止时间正确。
- [ ] 学生 Exam History：按时间排序、刷新、`View Details`/`View Report`、重考多次记录、只有本人记录可见；返回后保留列表位置。
- [x] **History / report 定向闭环**：学生提交后回到统一 SHSAT 学生工作区，刷新 Exam History 可找到该记录并从历史再次打开本人报告；用临时学生复核，无浏览器脚本错误。历史分页、多次重考筛选与滚动位置仍待验收。
- [x] **G2 个人错题本核心链路已补齐并通过真实数据烟测。** 检查清单中仍需逐项验收的题号导航、上一题/下一题、图片放大、最近练习报告及与教师任务隔离。

## 2. Paper Management：每组与每卷

- [x] 搜索框与 `Search`、文件夹筛选、Online 状态筛选：单独/组合使用，清空与刷新后结果和计数正确，空结果提示清楚（详见 2026-10-27 Paper List 筛选回归）。
- [x] `Create Folder`：名称必填/重复/取消/确认均已通过真实 UI 验证；组列表和筛选项更新，创建后刷新保留；文件夹默认折叠、可展开/收起，刷新后回到折叠，符合独立版行为。
- [ ] 分组拖动排序：首组、中间组、末组互换，拖入第二组或拖出第二组均持久化；刷新/重新登录顺序一致；每个组恰好一次，默认组规则正确。
- [x] 分组顺序回归抽测：在真实 SHSAT Paper Management 页面将第二个可拖动分组移到第三个位置；刷新后 UI 顺序与后端 `sortOrder` 一致，所有 7 个 group ID 唯一且完整；测试后通过正式排序接口恢复原顺序并复核成功。桌面截图 `42-paper-groups-reordered.png`。首/末组、反方向拖动、重新登录持久化仍待覆盖。
- [x] 分组第二位双向回归：真实拖动第三组进入第二位、第二组移到末位；拖动后 UI 与服务端顺序完全一致，刷新后仍保持；之后将所有 7 组恢复至测试前顺序并复核。无页面脚本错误。截图 `114-paper-group-drag-result.png`。这次覆盖了用户报告的“目标是第二组”场景；首组互换和重新登录后的持久化仍待测。
- [x] **纸卷分组全范围排序回归（2026-10-27）**：从第一个可拖动组拖到列表末组、末组拖回首组、再拖到第二位置；每次均核对完整组 ID 顺序、无重复/丢失，并刷新后核对整张列表显示顺序。测试结束恢复测试前顺序，临时文件夹已清理。1440px 与 390px 检查通过，窄屏无横向溢出，页面脚本错误为 0；截图 `/tmp/shsat-paper-group-order-desktop-1793048985168.png`、`/tmp/shsat-paper-group-order-mobile-1793048985168.png`。退出后重新登录再验证持久化仍待覆盖。
- [x] 组操作 `Rename folder`、`Delete empty folder`：改名取消不写入、确认后名称/描述刷新持久化；含试卷的文件夹不显示删除按钮；空文件夹删除取消不改变数据，确认后组记录消失。新建空文件夹自动筛选时此前被“无试卷”空状态遮住，现保留组卡片以供展开/管理。桌面删除确认截图 `/tmp/shsat-folder-delete-confirm-1793048862481.png`，手机纸卷列表截图 `/tmp/shsat-folder-management-mobile-1793048862481.png`；脚本无页面错误。
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
- [x] 手机端 Paper name 搜索框尺寸回归：首轮截图发现输入框继承桌面 `140px` 的 flex-basis，在窄屏纵向布局中变成 140px 高；现约束手机高度 34px 且取消固定 flex-basis。E2E 断言输入框高度 34px、页面宽度 390/390，无横向溢出；截图 `/tmp/shsat-folder-management-mobile-1793048862481.png`。
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
- [x] `EQUATION_EDITOR` 计分归一化与独立版对齐（2026-10-27）：对照独立版 `EquationEditorGradingStrategy` 后发现统一版未识别 `\\le`/`≤` 等价写法，学生在 244 Math Q56 输入视觉等价答案可能被误判。补充回归测试覆盖 `8x+35\\le95` 与 `8*x + 35 ≤ 95`、`\\geq` 与 `>=`、错误不等式应判错，以及 `normalizeOperators=false` 时不做运算符改写；SHSAT grader 定向测试与完整后端 `mvn test` 均通过。此项修复服务端等价答案判断，但正式考试提交后的端到端得分/报告展示仍待逐题型验证。
- [x] 选择题与 Hot Text/Hot Spot 拒绝重复答案 ID（2026-10-27）：对照独立版 grading strategies，发现统一版把重复 ID 折叠成集合，导致 `['A','A']` 或重复区域 ID 可能通过正确答案比对。新增红测先确认选择题、Hot Text 均可复现，再补充重复答案拒绝逻辑及选择题答案键重复的保护；回归覆盖 Hot Spot、Hot Text、单/多选与重复答案键。定向 SHSAT grader 测试及完整后端测试通过。常规学生 UI 不允许重复点击同一选项，此修复也保护被篡改/异常提交数据的计分准确性。
- [x] SHSAT 分数默认可见时点与独立版对齐（2026-10-27）：独立版 `ExamRequest` 默认 `showScoreStrategy=AFTER_SUBMIT`、`showAnswerStrategy=AFTER_END_TIME`；统一版原先两者都默认考试结束后才显示。已把 SHSAT 新考试的 score visibility 改为 `AFTER_SUBMIT`，answer visibility 保持 `AFTER_CLOSE`。服务层回归确认默认配置；新增 `frontend/e2e/shsat-equation-grading-report.cjs` 完成真实两分区考试：ELA 正确选择题 + MathLive 输入 `8*x + 35 \\le 95`，交卷后管理员报告两题均正确/2 分，学生报告 API `scoreVisible=true` 且页面显示 `Raw Total 2 / 2`。桌面及 390px 报告截图已目视复核：`/tmp/shsat-equation-report-1793047888637.png`、`/tmp/shsat-equation-report-mobile-1793047888637.png`；窄屏根宽度 390px，页面错误 0。答案详情仍按独立版默认策略在考试窗口结束前隐藏。
- [x] `SOLUTION_SET` 学生端抽测：正式卷 244 Math 第 79 题，选择闭合右射线并在数轴设定端点 9；当前答案提示为 `x ≥ 9`，继续后尝试记录端点与答案键一致，页面脚本错误为 0，临时数据已清理。截图 `solution-set-answer.png`。
- [x] SHSAT 题库题型盘点（2026-10-27）：逐一读取当前 47 份试卷的题目结构，共发现清单中的 12 种题型均有实际样题；`HOT_SPOT` 有 4 道，均引用缺失的图片资源（详见下方阻塞项）。此盘点证明题库覆盖，不代表 12 种题型已完成编辑/作答/计分/报告闭环。
- [x] `TABLE_GRID` 学生端抽测：正式卷 247 Math 第 70 题，按正确答案逐行选择 5 个单选格；点 `Next` 后服务端各行值一致，浏览器脚本错误为 0，临时数据已清理。截图 `59-student-table-grid-selected.png`。该题材料图片 `/uploads/paper-materials/27-92486950-7d42-40d7-94e1-8a84c11069d9.png` 在独立版及统一版均缺失。
- [ ] `HOT_SPOT` 学生原题作答仍被缺失的源图片阻塞：逐一查询当前 47 份 SHSAT 试卷发现 4 道 Hot Spot，分别为试卷 247 Math Q62 (`27-3b8171c6-53bf-4796-8f68-532393316cb7.png`)、试卷 242 Math Q62 (`17-7323749a-921f-4dc9-8a78-2233ba655ba4.png`)、试卷 242 Math Q70 (`17-1a624e0e-b1cf-4541-adda-46200a1a921b.png`)、试卷 241 Math Q63 (`12-9aac4dcd-48fa-4912-a38e-9ea75d87b862.png`)。四个 `/uploads/paper-materials/...` 请求在当前系统均返回 500；对应文件在独立版和统一版上传目录内都不存在。2026-10-27 再次对整个项目目录按四个资源 ID/文件名搜索，无匹配。已修复图片失败时遗留的破图标/替代文字，并验证英文错误提示干净显示；原题区域选择、计分和报告闭环仍需找回原始图片后验收，不能用替代图充当源题证据。截图 `58-student-hotspot-unavailable-clean.png`。
- [ ] 素材操作：选择已有、新建、清除文本/图片材料；图片上传、截图粘贴、预览/放大/重置/关闭，Markdown/公式插入与显示；共享材料编辑影响范围与源系统一致。
- [ ] **逐题型闭环**：12 类题均需完成创建→保存→刷新→预览→作答→提交→报告复核。当前 11 类已有学生 UI 作答及答案持久化抽测证据，但尚未逐类完成创建/编辑、刷新恢复、预览、提交计分和报告复核；`HOT_SPOT` 被源图片缺失阻塞。每类选项/交互数据、答案键、评分及解析需逐字段对照，不能只测选择题。
- [x] **新增四类学生端作答回归**：`GRAPH_QUESTION`、`HOT_TEXT`、`EQUATION_EDITOR`、`SOLUTION_SET` 均通过实际浏览器交互后保存，并从尝试 API 核对答案；零页面脚本错误，临时考试和学生账号清理完成。截图分别为 `graph-question-answer.png`、`hot-text-answer.png`、`equation-editor-answer.png`、`solution-set-answer.png`。坐标图样题内容不完整，题干为空；其控件行为虽通过，内容质量仍待修复/与独立版对账。此项不替代逐类型提交计分和报告验收。
- [x] 学生考试工具栏桌面抽测：书签开关、Review 面板与 Bookmarks 筛选、Notepad 关闭/重开保留当前尝试内内容、Answer Eliminator 划除与 Restore、高亮选中文字并应用黄色、Drawing Pen 开关/颜色菜单、Line Reader 拖动、字号 1.3x、页面宽度切换均可操作；全屏已处于考试要求状态时按钮正确禁用；页面脚本错误为 0，临时数据已清理。截图 `61-toolbar-in-exam.png`、`70-answer-eliminator.png`、`71-highlighted-text.png`。尚未在含材料题上验证画笔笔迹与工具状态跨刷新持久化。
- [x] SHSAT 管理端窄屏首屏抽查：Paper Management、Exam Release、Review Assignments、Classes、试卷编辑/预览/导出、班级详情、Monitor 均记录 390×844 截图，无页面脚本错误；除导出外页面根节点无水平溢出。原导出预览把 Letter 页面撑宽至 840px，已将固定纸张限制在独立横向滚动区、将工具栏改为窄屏纵向布局；修复后所有上述页面根节点宽度为 390px，导出页仍可在预览区横向查看完整纸张。前端生产构建通过。截图 `62-admin-papers-mobile.png` 至 `68-monitor-mobile.png`。这是首屏与布局抽查，不代表每个表格/弹窗均完成窄屏验收。
- [ ] 题型内按钮：填空可接受答案增删；拖拽 Item/Zone 增删和正确匹配；Hot Text/Spot 区域增删及坐标；图表点、方程输入、解答集等题型专用控件都要检查初始、修改、清空、保存恢复。
- [ ] 预览：`Back`、上一题/下一题、Review 面板与题号跳转、书签、工具栏、ELA/Math 转换；预览不写入正式学生记录；缺失题干/图片给出准确提示。
- [x] SHSAT PDF 分区与导出按钮回归：纸卷 252 导出曾把 ELA/Math 的 `scoringSectionCode` 在通用映射中丢失，导致 ELA 仅显示题 58、其余 115 题都归为 Other。修复映射后 PDF 分区为 ELA 1–57、Math 58–114、Other 115（该题源记录没有 ELA/Math 标签，页面已有明确提示且 Whole Paper 保留）；验证 Student Paper/Answer Key、ELA/Math/Whole Paper 切换及打印按钮状态。34 页 Letter PDF 非空，题序完整到 115，首个分区和末页已截图复核。窄屏纸张滚动不影响打印版。PDF `/tmp/shsat-visual-audit-20261026/69-paper-export-print-regression.pdf`。第112题源内容字面为 `question in image`，需查独立源资源/数据是否同样缺图；不能把该题内容质量标为通过。
- [ ] 导出：Student Paper/Answer Key、Whole Paper/ELA/Math 切换；`Print / Save ... PDF` 输出非空、有正确题序/页码/图片/公式/答案和分页，打印预览不裁切；无 ELA/Math 标签题给出提示，不能静默丢题。上述已完成纸卷 252 Whole Paper Student Paper 走查，Answer Key、单科导出、题型公式/图片和其它代表卷仍待验收。
- [x] **PDF 导出模式回归（2026-10-27）**：纸卷 252 的 Whole Paper Student Paper 为 115 题；ELA 单科 57 题、Math 单科 57 题；另有 1 道无分科标签的题目仅进入整卷，单科页面明确提示该规则。Whole Paper Answer Key 为 115 项，Math Answer Key 为 57 项。Student ELA/Math、Whole Answer Key、Math Answer Key 均生成 Letter PDF，分别为 18/17/7/4 页，文件均非空且抽取文本题号正确；打印按钮触发浏览器打印，页面脚本错误为 0。390px 下页面根宽度为 390px，Letter 纸张在专用横向滚动区可完整查看。截图 `/tmp/shsat-export-student-whole-20261027.png`、`/tmp/shsat-export-student-ela-20261027.png`、`/tmp/shsat-export-answer-whole-20261027.png`、`/tmp/shsat-export-answer-mobile-20261027.png`；PDF `/tmp/shsat-export-student-ela-20261027.pdf`、`/tmp/shsat-export-student-math-20261027.pdf`、`/tmp/shsat-export-answer-whole-20261027.pdf`、`/tmp/shsat-export-answer-math-20261027.pdf`。该项不替代含图/公式卷导出和极端分页检查。

## 4. Exam Release 与 Historical Exams

- [ ] `Create Exam`：标题/说明、试卷选择、开放/截止日期时间、考试时长、次数、面向全部学生或指定班级/学生；时间顺序与时区校验、题目结构风险确认，取消不产生记录。
- [ ] 发布前检查：试卷 READY/Online、ELA 与 Math 计分段、题量/答案完整性、截止时间与资格；`Publish`、`Unpublish` 成功后 Student Access 与卡片同时更新；重复提交/并发/409 给出可理解提示。
- [ ] 发布资格：全体/指定班级/指定学生规则正确；进行中/已提交尝试的资格与记录处理仍待测。
- [x] **开放期间新入班自动获得考试资格，离班不撤销资格（2026-10-27）**：管理员创建临时 SHSAT 班级及两名学生，先将一名学生加入班级，再将考试发布给该班；发布后第一名学生的考试 API 显示资格。第二名学生在考试开放期间才加入班级，随后其学生 API 和 SHSAT 工作区卡片均显示同一场考试；将第二名学生移出班级后，考试仍保留在其 API 列表中，符合 `docs/DATABASE_DESIGN.md` 中 `exam_participants` 的稳定资格规则。页面脚本错误为 0；考试、临时班级和两个学生账户均已清理。截图 `/tmp/shsat-open-class-new-member-20261027.png`。进行中/已提交尝试的规则仍待测。
- [x] 开放期新入班资格端到端：管理员创建临时班级和定向 SHSAT 考试，先加入一名学生并发布，再将第二名学生加入目标班级；该学生在统一学生首页看见考试并进入 ELA 考试说明页。班外学生首页无此考试，直接请求入场返回 404。临时考试、班级、学生均已清理并核对（考试/班级接口均为 404）；截图 `75-open-class-new-student-exam.png`，页面脚本错误为 0。
- [ ] 主表：搜索、visibility/time window/assigned-to 筛选，Refresh、折叠/展开、每页行数和前后翻页；表头/值对齐、时间 24 小时制到分钟；试卷被删除时考试名下显示明确提示。
- [ ] Action 菜单：当前场次 `Publish/Unpublish`、`Monitor`、`Delete`；结束场次 `Monitor`、`Delete`，删除始终最后。菜单不能被表格/分页裁切，键盘 Esc 和外部点击可关闭。
- [ ] Historical Exams：过期场次归档并自动不再对学生开放，展示状态应为 Unpublished；展开/收起、分页；删除需说明连带考试记录/答案/成绩/报告/任务，提供 5 秒冷静期，确认后级联删除，取消不改动数据。已从 UI 验证过期状态、学生尝试、关联 review task、删除警告、5 秒冷静期、取消保持和确认级联删除，且班级与统一账号保留（见 2026-10-27 回归记录）；折叠/分页、主表完整刷新/搜索仍待验收。
- [x] **删除级联抽测**：有进行中学生尝试的测试考试，经 UI 的 5 秒确认后删除；考试接口返回 404，学生历史不再包含该尝试。截图 `35-monitor-live-data.png`；报告/复习任务等其它关联记录仍需逐类核对。
- [x] **过期场次与删除冷静期回归**：创建仅对临时学生开放的短时考试，截止后确认服务端自动转为 `CLOSED`、Historical Exams 显示 `Unpublished`、学生列表不再开放且直接开考返回 409。随后通过管理 UI 删除一场带有进行中学生尝试的临时考试：5 秒内按钮禁用，倒计时后确认删除，考试详情返回 404、学生历史尝试被级联清除；临时学生也已清理。桌面/窄屏均目视复核，确认对话框内容完整、按钮可见；浏览器脚本错误为 0。截图 `109-expired-exam-unpublished-desktop.png`、`110-expired-exam-unpublished-mobile.png`、`111-exam-delete-cooldown-desktop.png`、`112-exam-delete-cooldown-mobile.png`。本次没有覆盖已提交报告及关联 review task 的级联数据。
- [x] 统一账户管理端到端回归：使用临时账户验证创建及可选资料、默认姓名排序、姓名/用户名与联系方式搜索、角色筛选和修改、密码重置后实际登录、禁用/启用、5 秒删除确认与删除后目录查无该账号。测试脚本通过：`frontend/e2e/sat-account-management.cjs`。桌面截图 `/tmp/sat-account-management-ui.png`；390px 窄屏目视复核，页面与文档宽度均为 390px，无横向溢出，截图 `113-admin-accounts-mobile.png`。临时账号已清理。
- [ ] 考试发布/撤回/删除后，首页卡片、班级考试、监考与学生入口同步更新；有尝试记录的场次按业务规则处理，不误删别的考试或用户。
- [x] **Exam Release 管理动作闭环抽测（2026-10-27）**：Create Exam 缺少必填项时显示英文提示；使用临时 SHSAT 发布创建一场未来考试，通过当前行 Action 菜单发布、撤回均返回 200，表格分别显示 Scheduled 与 Not published；删除确认前按钮禁用 5 秒，确认后返回 200，列表中试卷已移除。全程无浏览器脚本错误，临时考试已删除。页面截图 `/tmp/shsat-exam-release-review-20261027.png`。尚未覆盖指定班级/学生目标、时间边界校验、发布风险确认和学生/班级/监考端同步。
- [x] Exam Release 主表筛选/刷新抽测：临时未来考试分别通过 Published/Unpublished、Upcoming/Live、All students/Specific classes 过滤及标题搜索；Refresh 后行与筛选仍正常。测试发布已删除，浏览器脚本错误为 0。其它 audience 和日期边界、分页/窄屏对齐仍待验收。
- [x] **Historical Exams 展示与操作回归（2026-10-27）**：真实历史记录都显示 `Unpublished`；分页设置 5 行后前后翻页正确，设为 20 行显示 16 条；折叠/展开有效。历史记录 Action 菜单顺序为 `Monitor`、`Delete`，Esc 可以关闭，删除保持末位。删除确认明确说明关联的学生尝试/答案/分数/报告/复习任务会一并删除，5 秒内按钮禁用；取消后记录仍保留。浏览器脚本错误为 0。截图 `/tmp/shsat-exam-release-review-20261027.png`、`/tmp/shsat-exam-history-pagination-20261027.png`、`/tmp/shsat-exam-history-actions-20261027.png`、`/tmp/shsat-exam-delete-confirm-cancel-20261027.png`。搜索/刷新与点击外部关闭仍待测。
- [x] **Historical Exams 已提交尝试与复习任务删除级联（2026-10-27）**：新增 `frontend/e2e/shsat-historical-exam-delete.cjs`。真实学生在短时发布中提交正式尝试并成为复习任务来源；时间窗口过期后，管理列表自动将考试状态更新为 `CLOSED`，历史区显示 `Unpublished`。首次确认弹窗明确列出会删除的 student attempt、answer、score、report 和 review assignment；5 秒内禁用删除，取消后考试和任务均保留，二次等待后确认删除，考试/学生尝试/复习任务 API 均返回 404，而学生账号和班级在删除考试后仍保留。之后移除临时成员关系并验证临时班级/学生账号清理成功；桌面与 390px 截图已目视检查，页面错误为 0。截图 `/tmp/shsat-historical-delete-confirm-1793046224519.png`、`/tmp/shsat-historical-delete-confirm-mobile-1793046224519.png`。搜索、刷新、折叠/分页另有覆盖；历史主表的完整搜索/刷新复核待测。

## 5. Review Assignments 与班级

- [ ] Review Assignments 搜索、按考试/班级筛选、Refresh、Create Assignment；设置来源考试、班级、开始/结束时间及目标，校验无来源记录/无错题/时间冲突；发布后人数和状态准确。已验证教师创建成功及默认来源考试/时间，字段错误、取消和选定自定义时间仍待测。
- [ ] 表格 Action：`View Progress` 返回原标签与筛选位置；`End`/取消任务及确认；状态、完成/资格、进行中/未开始/缺少源尝试统计要与详情相符。
- [ ] 任务进度页：Back、Refresh/Retry、逐学生题数/状态/完成时间、`View Report`；截止/重做/零剩余题、源考试删除后的状态和提示准确。
- [x] Review Assignments 搜索/筛选与只读流程抽测：2 条任务可见；不匹配搜索显示空状态，按考试筛出 2 条、再按班级筛出 1 条，Refresh 后仍保留筛选；创建弹窗打开后取消不写入数据。动作菜单顺序为 `View Progress`、`End`；打开 End 确认后取消，任务状态未变化。`View Progress` 展示学生资格、状态和题数，`View Report` 打开对应学生任务报告并返回进度页，`Back to Review Assignments` 返回带原 `tab` 的后台路由。390px 根节点宽度保持 390px，无浏览器脚本错误。截图 `99-review-assignments-desktop.png`、`100-review-assignment-create-modal.png`、`101-review-assignments-mobile.png`、`102-review-student-report-desktop.png`。字段错误提示、取消 End 和有真实错题来源的学生作答仍待验收。
- [x] 教师 Review Assignment 创建与结束闭环：临时教师为仅含一名临时学生的班级发布正式 SHSAT 考试，再从 SHSAT 后台创建任务；接口核对 `assignedCount=1`、`noSourceAttemptCount=1`，进度页明确显示 `No source attempt`、0/0 题和正确人数。通过 `View Progress` 后返回 Review Assignments，接受 `End` 确认后接口状态为 `ENDED`；教师仍无账号目录权限（403）。删除测试考试后复查任务和临时账户均已清理，页面脚本错误为 0。截图 `115-review-assignment-create-filled.png`、`116-review-assignment-created.png`、`117-review-task-progress.png`。有已提交错题源尝试的学生作答/重做、取消 End、截止后状态仍待测。
- [x] Review Assignment 进度页窄屏布局修复：原表格固定最小宽度 1000px，390px 下只露出前两列且其余字段需横向滑动；现改为带字段名的学生进度卡片，完成/状态/准确率/进度都可见，无结果页横向溢出。桌面表格保持原布局；返回 Review Assignments 路由回归通过。生产构建通过，页面脚本错误为 0。截图 `118-review-task-progress-mobile.png`（修复前）、`120-review-task-progress-mobile-cards.png`（修复后）。
- [x] 学生真实错题源任务启动抽测：临时学生完成一场已发布 SHSAT 考试后，教师创建班级 Review Assignment；接口核对已生成错题题目及 `NOT_STARTED` 资格。学生从 SHSAT 首页的 Review Assignments 点击 `Start review`，通过全屏提示进入独立 SHSAT 考试界面；服务端关联练习 attempt，教师进度状态更新为 `IN_PROGRESS`。零页面脚本错误；结束后考试、任务、临时学生及班级已清理。截图 `121-review-assigned-exam-desktop.png`。选用的源卷（Official SHSAT Label Template）有 9 道样题，其中图表第 1 题题干为空，这是源数据问题；任务完成/重试/报告闭环、窄屏该入口仍待测。
- [x] 学生 Review Assignment 完成/重做回归：从首页 `Start review` 启动后，在考试页用 `Submit Exam` 和确认弹窗提交；任务状态变为 `RETRY_REQUIRED`，仍有 9 题。首页 `Try again` 创建新练习，提交其中一道答对的选择题后再次经 UI 确认交卷并进入报告；报告答案与得分为 1/1 正确，任务剩余题由 9 降至 8，状态仍为 `RETRY_REQUIRED`。页面脚本错误为 0，考试/任务/临时账户已清理。报告截图 `123-review-report-after-retry-desktop.png`；此测试卷只有 9 题，若干题无技能标签，图表题题干为空，仍是源卷内容问题；全做正确后的 `COMPLETED` 状态及移动端仍待测。
- [ ] Classes 首页：搜索/空结果/刷新失败恢复、`Create Class`、卡片打开、空班删除、拖动顺序持久化；同一学生可加入多个班级；班级能接收 SHSAT 或 SAT 场次。
- [x] SHSAT 班级新建/编辑/删除流程回归（2026-10-27）：空名称显示 `Class name is required.` 且不发创建；成功创建后打开详情，编辑班名并保存，刷新后新值仍存在。验收发现空班删除按钮一直被隐藏且旧 API 实际把“删除”实现为归档；对照独立版修复为 API 返回 `deletable`，只对无在班学生且无复习任务的空班显示删除，服务端也拒绝删除非空班级/仍有关联任务的班级，并调用真正的删除接口。管理员删除后详情 API 返回 404；教师也通过真实登录 UI 创建并删除测试空班，验证全班管理权限。服务端只清理班级、成员关系和发布目标，不删除学生账号、考试或尝试记录；临时账号与班级已清理。`ClassAdminControllerTest`、`SatAdminAuthorizationTest`、前端构建通过；确认窗口截图 `/tmp/shsat-empty-class-delete-confirm-verified-20261027.png`。搜索/创建/编辑/删除已验收；刷新失败重试、拖动顺序首末互换仍待测。
- [x] **SHSAT Classes 首页搜索、返回和刷新恢复（2026-10-27）**：真实管理员会话搜索临时班级、检查无匹配空状态，再打开班级并返回后确认仍留在 Classes 标签；模拟班级列表请求失败，页面显示错误态，点 Refresh 后列表恢复。返回后顶部导航仍高亮 SHSAT。桌面截图 `/tmp/shsat-class-home-verified-1793041822726.png`、390px 截图 `/tmp/shsat-class-order-mobile-1793041587482.png`；`frontend/e2e/shsat-class-order.cjs` 全流程通过，页面脚本错误为 0。班级创建/空班删除及排序另见相邻记录。
- [x] **SHSAT 班级卡片排序持久化回归（2026-10-27）**：真实管理员将三张临时班级卡片依次拖到末位、首位和第二位等位置；每次均核对 API 顺序、页面更新和刷新后顺序。再以教师真实会话拖动并验证顺序持久化。最初自动化直接拖动页面下方卡片时会从相邻卡片起拖，现改为先滚动到拖动点可见后按鼠标轨迹操作，避免测试错落点。清理临时班级、临时教师账户后恢复并核对所有原班级顺序；临时数据无残留。桌面与 390px 截图 `/tmp/shsat-class-order-desktop-1793041587482.png`、`/tmp/shsat-class-order-mobile-1793041587482.png` 已目视检查；窄屏根页面宽度与视口一致，页面脚本错误为 0。`frontend/e2e/shsat-class-order.cjs` 通过。此项覆盖排序边界及教师权限。
- [x] 学生多班归属隔离烟测：将临时学生同时加入两个班级，从其中一个班移除后，另一个班仍保留其成员关系；随后删除临时班级和账号，均成功且无遗留。
- [x] **Unassigned Students 批量分配闭环（2026-10-27）**：真实管理员 UI 新建 18 个临时学生和临时班级，验证折叠/展开、刷新、800px 高度限制（实测内容 1056px、容器 798px）、表头全选/清空、逐项多选、刷新保留选择、打开后取消保留选择、选班并批量加入。提交后 API 仅显示被选的两名成员；两人从未分配列表消失、统一账号仍存在；剩余临时数据均清理并核对无残留。390px 下根页面 390px、表格 264px 宽且无横向滚动、无浏览器脚本错误。截图 `/tmp/shsat-unassigned-bulk-desktop-1793037802122.png`、`/tmp/shsat-unassigned-bulk-mobile-1793037802122.png`。目视发现手机表格被通用 780px 最小宽度挤压，现窄屏仅显示选择框和姓名、姓名自然换行，桌面保留全部列。E2E `frontend/e2e/shsat-unassigned-bulk-assign.cjs` 与前端生产构建通过。其它已在班学生排除逻辑另见下一项。
- [x] Unassigned Students 数据筛选回归：只显示当前没有任何有效班级归属的学生账户；已分配到其它班的测试账户不会进入未分配列表。测试账户和班级已清理，截图 `133-unassigned-students-filtered.png`。
- [ ] 班级详情：Back、`Edit Class`、Refresh、字段校验、保存反馈；班级考试搜索/排序/分页、`View Results`/`Monitor`；学生表 `View`/`Edit`/`Remove`、批量 `Add Students` 搜索与已属班级标注、多选加入；不得误删统一账号而只移除本班归属。
- [x] **Class Exams 参与记录筛选回归（2026-10-27）**：发现空班级因查询仅按 `ALL_STUDENTS` 发布范围加载考试，错误显示 6 场与本班无关的考试。现改为只列该学生在本班有效归属期间实际开始的正式考试，沿用独立版“participated exams”语义。临时空班级 UI/API 显示 0 场；有 18 名学生、4 场实际考试的 SHSAT 班级仍列出 4 场，和班级统计一致。截图 `/tmp/shsat-class-bulk-add-result-20261027.png`；控制器测试通过。班级考试筛选、排序、分页及结果/监考入口仍待测。
- [x] 班级考试列表/成绩/监考入口定向验收（2026-10-27）：列表搜索 `TEST 3`、起始时间排序和 `View Results` 均有效；成绩页加载班级/场次/学生成绩，ELA、Math、准确率、提交时间均可升降序切换，学生 `View` → 学生详情 → `View Report` → `Back to Student Detail` → `Back to Class Results` 路由链完整；成绩页 Monitor 进入正确场次，Monitor 的 Back 返回成绩页，成绩页 Back 返回原班级。Monitor 有已提交答卷时正确呈现平均用时和问答准确率热图；已结束场次无实时题目位置时显示解释性空状态。桌面截图 `/tmp/shsat-class-exam-results-loaded-20261027.png`、`/tmp/shsat-class-student-detail-verified-20261027.png`、`/tmp/shsat-class-student-report-verified-20261027.png`、`/tmp/shsat-monitor-class-exam-verified-20261027.png`；390px 成绩页和 Monitor 均无根页面横向溢出，页面脚本错误为 0。分页、Retry 错误恢复、所有状态组合及热图图片缩放仍待验收。
- [x] **班级成绩五列排序与 API 记录一致回归（2026-10-27）**：对有 18 条真实结果的班级考试，逐项切换 Total、ELA、Math、Accuracy、Submitted 两个方向；页面学生顺序与 `/api/admin/reports/exams/{examId}/classes/{classId}` 数据按相同评分/空值规则排序结果逐行一致。桌面表头与数据列对齐，390px 窄屏无根页面溢出，页面脚本错误为 0。截图 `/tmp/shsat-class-results-sorting-desktop-1793049300276.png`、`/tmp/shsat-class-results-sorting-mobile-1793049300276.png`；自动化 `npm run test:e2e:shsat:class-results-sorting` 通过。
- [x] **班级考试成绩页 Retry 恢复回归（2026-10-27）**：以只读现有班级考试打开成绩页，临时中断成绩请求，确认错误状态显示后点击 Retry；请求恢复后摘要和成绩表正常加载，页面脚本错误为 0。390px 下根页面宽度为 390px，单个导航栏与内容无重叠。桌面/手机视口截图 `/tmp/shsat-class-results-retry-1793044183896.png`、`/tmp/shsat-class-results-retry-mobile-1793044183896.png` 已目视检查；重拍时移除全页截图，避免重复固定元素的截图伪影。自动化 `npm run test:e2e:shsat:class-results-retry` 通过。分页和所有成绩状态组合仍待验收。
- [x] 班级详情批量添加学生回归：将入口明确为 `Add Students`；弹窗提供搜索表格、多选、全选当前结果，并显示学生姓名、用户名、现有班级和邮箱。已用临时学生验证从搜索到加入成功、刷新后成员关系落库；该学生可同时属于多个班级。桌面截图 `130-class-add-students-desktop.png`，390px 窄屏截图 `132-class-add-students-mobile-fixed.png`、`136-add-student-membership-mobile.png`；窄屏根节点宽度为 390px，无横向溢出，移动端保留学生姓名和现有班级列。后端学生选项接口现返回邮箱，控制器测试覆盖字段映射。
- [x] 班级成员移除语义修正并端到端回归：班级详情操作由 `Delete` 改为 `Remove`，确认窗口说明只移除当前班级成员关系，账户、考试历史及其它班级关系保留；不再使用误导性的永久删除措辞或 10 秒冷静期。临时学生同时加入两个班后，从一个班移除，再次验证账户仍存在且另一个班成员关系保留；随后从批量添加弹窗重新加入并确认两班关系都存在。截图 `134-remove-student-modal.png`；页面脚本错误为 0，相关测试数据已清理。
- [x] SHSAT 班级资料编辑持久化：发现详情表单中的教师姓名/邮箱、年级、学年、Active 状态没有接入共享班级 API，且详情查询会丢弃这些字段；现使用现有 `shsat_class_metadata` 保存 SHSAT 扩展资料，通用班级状态仍写 `classes`。界面修改并保存后，刷新核对资料与 Inactive 状态，API 字段一致；SAT 班级创建/更新回归仍返回 ACTIVE，SHSAT 扩展字段保持为空；临时班级已删除。Java 控制器测试及全量 92 项后端测试、前端生产构建通过；桌面/390px 截图 `127-class-metadata-before.png`、`128-class-metadata-after.png`、`129-class-metadata-mobile.png`，窄屏无横向溢出。班级字段校验和其它按钮继续待测。
- [x] `Class Exam Score Trend`：复核 SHSAT 文案、raw/scaled 提示和无数据状态；桌面截图确认没有 SAT/PSAT 范围提示。后续用真实考试成绩确认 Raw 趋势图、关键点考试信息悬浮窗可用；当前班级样本没有折算分，因此 Scaled 有意义的折算数据仍待另一数据集验证。
- [x] 班级详情统计真实数据烟测：发现统一版没有返回班级学生的平均分/已完成考试数，且班级摘要平均分为空；按已完成、非练习、学生当时属于班级且有考试资格的记录实时聚合，SHSAT 学生分数按独立版规则在折算分有效时使用折算分，否则回退原始分。SHSAT 学生统计显示 17 名有成绩、1 名无记录；班级摘要显示平均分 52.53。SAT/PSAT 查询也已烟测返回样本统计。截图 `81-class-student-stats-desktop.png`、`82-class-student-stats-mobile.png`、`83-class-summary-average-desktop.png`、`84-class-summary-average-mobile.png`；桌面和 390px 窄屏均无横向溢出，浏览器脚本错误为 0。针对聚合 SQL 的控制器测试和前端构建通过。这里只完成班级摘要及学生表统计，不代表班级详情其它操作已验收。
- [x] 班级详情基础编辑/导航：现有类详情编辑取消保持原值，另在临时 SHSAT 班级修改名称后保存并刷新，值持久化；`View` → 学生详情 → `View Report` 可打开报告，返回至同一详情和发起的结果页。桌面/手机截图见前项 `86`–`88`、`/tmp/shsat-class-student-detail-verified-20261027.png`、`/tmp/shsat-class-student-report-verified-20261027.png`；学生资料字段校验、其它字段编辑、Refresh 错误恢复仍待验收。
- [ ] 班级考试成绩页：Back、Monitor、Retry、总分/ELA/Math/正确率/提交时间排序、学生 View；无成绩/未开始/进行中/已完成统计与实际尝试一致，表头和数据逐列对齐。
- [x] 学生详情分数趋势/历史回归（2026-10-27）：同一学生 4 次 SHSAT 完成尝试正确显示总数/完成数/平均/最高分及逐次历史；Raw 图有三条总分/ELA/Math 曲线，悬浮关键点显示考试名、提交时间及三项分数；点击 Scaled 对当前无折算数据的样本显示明确空状态，不伪造折算分；Raw Score 与 Scaled Score 表头均能切换排序，Refresh 后记录仍完整。桌面与 390px 截图 `/tmp/shsat-student-detail-verified-20261027.png`、`/tmp/shsat-student-detail-mobile-chart-visible-20261027.png`，窄屏根页面无横向溢出。缺少赋分表的有值数据、Retry 失败恢复及多次同场重考同学生的数据仍待验收。
- [ ] 学生详情页：Back、错误态 Retry、统计数据的独立对账、含折算分数据时 Raw/Scaled 图与排序、多次重考同场历史、源记录缺少赋分表时显示 `—` 而非伪造分数。

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
- [x] 学生详情报告返回链路补测（2026-10-27）：从班级考试成绩页打开学生详情和其首条已提交尝试报告，报告标题、学生/考试/试卷与 `Result Summary` 均正常；`Back to Student Detail` 返回原学生详情（保留 `returnTo` 参数），再 `Back to Class Results` 返回同一考试成绩页。截图 `/tmp/shsat-class-student-report-verified-20261027.png`，浏览器脚本错误为 0。

## 8. 首轮实测和视觉问题（2026-10-26）

- [x] **学生考试列表与历史数据加载失败重试（2026-10-27）**：首次进入 SHSAT 学生页时分别注入 `/api/student/exams` 与 `/api/student/wrong-answer-tasks` 的 503 响应；考试区和历史区各自显示英文错误，任务/考试的空状态不会在数据加载失败时误显示。Refresh 加载期间禁用，重试后两个请求恢复；另在手动刷新时再次注入考试列表失败，验证可二次重试并清除错误。桌面与 390px 窄屏错误态已截图并目视检查，页面脚本错误为 0、窄屏根宽度 390/390；临时学生已清理。截图 `/tmp/shsat-student-history-error-1793043998285.png`、`/tmp/shsat-student-history-error-mobile-1793043998285.png`；自动化 `npm run test:e2e:shsat:student-history-retry` 通过。此项只验证考试/复习任务数据请求异常处理，不代表历史分页、重复尝试、报告内容或其他 SHSAT 学生操作全部完成。

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
- [x] SHSAT Exam Release UI 闭环：实际创建 115 题试卷发布记录，确认官方结构提示后创建；通过行内/省略号操作分别发布和撤回，并从接口核对状态；5 秒冷静期与有关联数据的级联删除分别通过 UI 验证。截图 `32-exam-release-created.png`、`33-exam-release-published.png`、`34-exam-release-delete-cooldown.png` 显示表格、发布状态和确认窗口可读；级联删除见下方 `/tmp/shsat-historical-delete-confirm-*`。
- [x] SHSAT 删除级联第二次验证：对有进行中学生尝试的临时考试走管理员 UI 删除，5 秒冷静期通过后考试删除、学生历史同步移除该尝试，临时学生清理成功。截图 `35-monitor-live-data.png`；该次不包含已完成报告和复习任务关联数据。
- [x] 监考实时数据验证：实际考试过程中学生停留题目、提交答案并进入下一题；管理员监考显示实时分布、非空平均用时曲线，题目详情正常打开/关闭，无页面脚本错误。截图 `35-monitor-live-data.png`。复核中发现短用时刻度整数化后重复，现改为短时长显示一位小数，截图确认刻度为 `0s/0.5s/1s/1.5s/2s`。
- [x] 学生本人报告打印：真实学生通过考试流程提交后，点击 `Print Report` 触发浏览器打印；生成 24 页 Letter PDF，抽查第 1、2、12、24 页无空白故障页、文本未裁切，问题卡片分页可读。测试场次关闭成绩可见性；逐题用时由测试构造，PDF 用时内容不用于计分准确性或自然作答时长一致性判断。临时考试与学生已清理。
- [x] 报告计时查询回归后重跑：逐题计时随报告题目返回；打印首屏显示 ELA、Math 与总逐题时间。测试注入的逐题时间与 7 秒实际墙钟跨度不同，计时一致性需用自然作答等待重新验证。
- [x] 学生端真实完整考试与报告回归：临时学生通过页面完成 100 题 SHSAT 的 ELA→Math 流程，覆盖多选、固定多选、表格网格、拖放、热点文本、公式编辑器、内联选择、填空和数轴区间题；逐题保存请求均成功，空题继续时出现英文校验，分段提交与最终确认均可用，报告和返回学生工作区成功，浏览器无页面错误/失败请求。该测试卷按设置隐藏成绩及答案；发现报告此前因此错误显示 `0 / 0`、空的逐题计时，现通过安全的 `questionCount/answeredCount` 展示 `100 / 100`，并明确说明逐题内容受考试可见性设置限制。`Print Report` 按钮触发打印；390px 页面无横向溢出。截图 `137-student-report-hidden.png`、`138-student-report-hidden-mobile.png`；测试考试、尝试和学生账户均已删除。此次不等于验证了所有 12 种题型、成绩正确性、折算分或可见答案报告。
- [x] Review Assignment 返回路径复测：分别从首页 Assigned Review 卡片和 `Review Assignments` 表格打开现有进度页，再点击 `Back to Review Assignments`；均返回 SHSAT 后台而不是系统选择页，从表格入口返回后保留 Review Assignments 标签。未更改正式任务数据。
- [x] **真实试卷计分闭环抽测**：使用正式 SHSAT 试卷 252（ELA 57 题、Math 58 题）创建定向考试，提交 115 题答案，并通过考试页面实际输入一道填空题；报告与答案键逐题对账为 115/115 正确、0 错、0 空，ELA raw 58、Math raw 57，总分 115/115。测试确认填空答案在最终提交时来自当前界面状态，不能只靠后台写入模拟；临时考试与账号已在脚本清理。截图 `26-student-report-after-submit.png`：报告可读、两科题目分组完整、打印版页面连续。此样本验证原始题数计分及报告数据，不代表折算分曲线、全部题型真实 UI 作答或全量报告布局已验收。
- [ ] **考试计分正确性、刷新恢复、工具栏、失焦/全屏违规、计时结束与断网续考**仍待验证。正式 100 题纸卷 244 的 ELA→Math 和 Math→ELA 全题 UI 导航、分段/最终提交及桌面/手机报告检查均已通过（见上）；本次输入的是便于完成导航的任意答案，不能据此证明逐题计分正确。
- [ ] 12 种题型逐题闭环、管理员各页每个 CRUD/菜单动作、教师监考与 Review Assignment 权限、PDF 极端材料/公式版式、移动端关键页面、图表有真实分数数据，以及与独立版逐页并排核对尚未完成。
- [x] 教师真实会话权限和导航回归：临时长用户名教师登录后进入 SHSAT 后台，导航只提供 Exam Release、Review Assignments、Classes；Paper Management 不可见，`/api/admin/users` 返回 403。发现 390px 下长用户名把页面撑宽至 410px；顶部账户名现限宽并省略显示。用 53 字符用户名在 390/768/1440px 复测，根节点宽度分别与视口一致，用户名触发省略，页面脚本错误为 0；临时教师已删除。桌面/窄屏截图 `103-teacher-classes-desktop.png`、`105-teacher-classes-mobile-fixed.png`、`106-teacher-classes-desktop-fixed.png`；前端生产构建通过。
- [x] **认证刷新与角色入口复测（2026-10-27）**：管理员登录 SHSAT 后台并刷新，仍保持登录且页面数据正常；临时教师刷新后仍保持后台会话，只显示 Exam Release、Review Assignments、Classes，调用统一账号 API 返回 403；临时学生刷新后仍停留系统选择页，可进入 SHSAT 学生工作区，看到正确空状态。所有临时账号已删除，浏览器脚本错误为 0。截图 `/tmp/shsat-admin-refresh-session-20261027.png`、`/tmp/shsat-teacher-workspace-20261027.png`、`/tmp/shsat-teacher-workspace-mobile-20261027.png`、`/tmp/shsat-student-system-select-20261027.png`、`/tmp/shsat-student-home-20261027.png`、`/tmp/shsat-student-home-mobile-20261027.png`；教师/学生窄屏页面根宽度均为 390px。此项只覆盖登录后刷新与角色入口，不代表会话过期、退出及登录错误路径已全部验收。
- [x] **学生 SHSAT History 错误与刷新恢复回归（2026-10-27）**：注入考试列表与 Review Task History 加载失败，确认英文错误提示、失败时不显示误导性空状态；Refresh 请求期间禁用，成功重试后清除错误，重复刷新失败后仍可恢复。390px 根宽 390、浏览器脚本错误为 0，错误态截图 `/tmp/shsat-student-history-error-1793048428944.png`、`/tmp/shsat-student-history-error-mobile-1793048428944.png` 已检查。测试起初使用了已改名的旧 tab 文案 `Review Tasks`，与当前真实 UI `Review Task History` 不匹配；修正测试定位后通过，产品行为无须改动。
- [x] **SHSAT 教师发布权限与限制回归（2026-10-27）**：临时教师登录后只见 Exam Release、Review Assignments、Classes，无 Paper Management；能读全部 SHSAT 班级，但账户目录返回 403。临时班级有一名活动学生后，教师从 UI 创建面向该班级的考试、发布并撤回成功；Actions 菜单隐藏 Delete，直接调用删除 API 也返回 403。测试创建、发布、撤回和清理均成功；临时教师/学生/班级/考试已删除且核对无残留，浏览器脚本错误为 0。窄屏根宽度 390/390。截图 `/tmp/shsat-teacher-classes-1793045228317.png`、`/tmp/shsat-teacher-release-form-1793045228317.png`、`/tmp/shsat-teacher-release-published-1793045228317.png`、`/tmp/shsat-teacher-release-mobile-1793045228317.png`；自动化 `npm run test:e2e:shsat:teacher-workspace` 与 production build 通过。初次发布因测试班级没有学生而按预期返回 409；加入学生后通过。教师 Review Assignment 权限另见下方真实来源尝试回归。
- [x] **SHSAT 教师监考权限及无数据状态（2026-10-27）**：扩展 `frontend/e2e/shsat-teacher-workspace.cjs`。教师发布考试后从 Action 菜单打开 Monitor，实时数据与分析 API 均返回 200，空场次正确显示无实时位置/无作答用时提示；监考 Back 返回 SHSAT 管理端，再次进入 Exam Release 可继续撤回。1440×900 与 390×844 页面截图 `/tmp/shsat-teacher-monitor-1793046854930.png`、`/tmp/shsat-teacher-monitor-mobile-1793046854930.png` 已目视检查；页面根宽均与视口一致，页面脚本错误为 0。自动化 `npm run test:e2e:shsat:teacher-workspace` 通过。教师对有学生实时作答时的监考细节和 Review Assignment 的角色权限仍待验收。
- [x] **Paper Management 文件夹 CRUD 回归（2026-10-27）**：管理员从页面新建临时分组并填写说明，刷新后仍存在；重命名后刷新仍保留新名称；从确认弹窗删除空分组后，页面及分组 API 均查无该项。临时分组已清理，页面脚本错误为 0。截图 `/tmp/shsat-paper-folder-renamed-20261027.png`。此项未覆盖重名校验、取消操作、非空分组删除限制与排序拖动。
- [x] **正式 100 题考试全题 UI 导航与报告回归（2026-10-27）**：使用 SHSAT 纸卷 244 创建临时定向考试，学生分别从 ELA、Math 开始，逐题完成两个 50 题分段并提交最终考试；两种顺序的报告 API 与管理端统计均核对为 100 已答、0 未答、15 正确/85 错误，ELA/Math 各 50 题，页面无脚本错误。桌面与 390px 手机报告目视检查，无横向溢出；临时考试、学生、班级及尝试由测试清理。ELA→Math 截图 `/tmp/shsat-full-length-report-1793050329154.png`、`/tmp/shsat-full-length-report-mobile-1793050329154.png`；Math→ELA 截图 `/tmp/shsat-full-length-report-1793050347754.png`、`/tmp/shsat-full-length-report-mobile-1793050347754.png`。自动化 `npm run test:e2e:shsat:full-length-navigation` 两种起始顺序均通过。此项使用 UI 实际答案但未按正确答案作答，验证流程及数量/分段对账；逐题准确计分、刷新恢复、工具栏、打印报告仍需单独验证。另 247 纸卷 Math Q62 的 HOT_SPOT 图片缺失，保持为已记录的源数据阻塞项。
- [x] **Exam Release 有已提交尝试及 Review Assignment 的历史考试删除（2026-10-27）**：关闭的考试显示在 Historical Exams 且状态为 Unpublished；从 Actions 打开删除警告，5 秒冷静期内按钮禁用，取消后考试和复习任务仍在；再次确认后考试、学生尝试及 Review Assignment 均被删除，班级与共享学生账号保留。1440px 与 390px 确认弹窗截图 `/tmp/shsat-historical-delete-confirm-1793050256675.png`、`/tmp/shsat-historical-delete-confirm-mobile-1793050256675.png` 已目视检查，页面脚本错误为 0，自动化 `npm run test:e2e:shsat:historical-delete` 通过。测试数据已清理。
- [x] 文件夹表单边界回归：空名称显示英文必填提示；重复已有分组名显示英文冲突提示；取消后对话框关闭且未创建记录。页面脚本错误为 0。非空分组删除限制仍待验收；分组拖动已覆盖第二组到第三组后的持久化，其它顺序边界仍待测。
- [x] **第二个试卷分组拖动与刷新持久化回归（2026-10-27）**：分别验证第二可拖动组拖出，以及 `Saturday Class` 拖入第二组位置；两次页面排序请求均成功，刷新后 API 顺序与页面一致。每次结束都恢复并核对原始组顺序。截图 `/tmp/shsat-second-folder-order-20261027.png`、`/tmp/shsat-other-folder-into-second-20261027.png`。未覆盖首组/末组互换、教师权限及其它拖动边界。
- [x] **SHSAT Paper List 筛选与恢复回归（2026-10-27）**：对照独立版查询参数修复 Online/Offline 筛选；真实 SHSAT CRASH COURSE 数据为 Online 4 卷、Offline 2 卷，文件夹、状态、名称组合筛选均匹配。补充验证零匹配搜索后，原页面只显示折叠的 `0 papers` 分组、不够明确；现在显示 `No papers found. Try changing or clearing the filters.`；清空筛选后恢复全部 47 卷，刷新也回到完整列表。自动化回归 `frontend/e2e/shsat-paper-filters.cjs` 全部通过，浏览器脚本错误为 0。截图 `/tmp/shsat-paper-filter-online-20261027.png`、`/tmp/shsat-paper-filter-offline-20261027.png`、`/tmp/shsat-paper-filter-no-results-20261027.png`。
- [x] **SHSAT 试卷基础 CRUD 抽测（2026-10-27）**：管理员从 `Create Paper` 新建临时空白卷后进入编辑器，ELA/Math 区域可见；修改名称和说明，刷新后仍能按新名称检索；随后通过列表删除菜单确认影响并等待冷静期，试卷及 API 记录均已删除。浏览器脚本错误为 0。截图 `/tmp/shsat-paper-editor-created-20261027.png`。题目结构编辑、预览、PDF 导出和更多字段校验仍待覆盖。
- [x] **单题编辑与预览闭环抽测（2026-10-27）**：临时新卷中新增默认 Multiple Choice 题，填写题干、保存后刷新，题目仍在 ELA 且字段完整；Paper Preview 显示同一题干和两个答案选项。测试纸卷最终删除，未创建学生考试记录；浏览器脚本错误为 0。截图 `/tmp/shsat-question-editor-saved-20261027.png`、`/tmp/shsat-question-preview-20261027.png`。未覆盖题型专属编辑、答案正确性/评分、其它 11 种题型与 PDF。
- [x] **Math→ELA 学生端完整流程与成绩闭环（2026-10-27）**：临时创建含一题 ELA、一题 Math 的 SHSAT 卷和定向考试；学生实际登录、选择 SHSAT、从 Math 开始、在 UI 作答并提交 Math、进入 ELA 后作答并最终交卷，随后在考试结束时间后打开本人报告。检查尝试顺序为 `MATH → ELA`，报告状态 `COMPLETED`、raw 总分 `2/2`、ELA `1/1`、Math `1/1`、正确 `2`、错误/未答 `0`；管理员报告与学生报告一致。浏览器脚本错误为 0；测试考试、临时试卷、临时学生已全部删除。桌面题目与报告截图 `/tmp/shsat-math-first-mini-question-20261027.png`、`/tmp/shsat-math-first-mini-report-20261027.png`。报告只有在 SHSAT 结束时间到达后才显示分数/答案，和独立版 `AFTER_END_TIME` 可见策略一致。此项仅验证两道选择题和 Math→ELA 顺序，不代替正式卷/12 种题型全量回归。
- [x] **SHSAT 两种起始科目及分段评分双向回归（2026-10-27）**：新增 `frontend/e2e/shsat-two-section-exam.cjs` / `npm run test:e2e:shsat:two-section-exam`。真实学生先后从 ELA、Math 起始两次完成两题迷你卷；通过 UI 验证题目顺序、选择答案、提交当前科目、继续下一科并最终交卷；管理员结果接口核对两次 raw 总分均为 1/2，ELA/Math 分科得分及正确/错误/未答计数与题目答案相符。学生报告在成绩开放时可见 raw 分数；考试窗口关闭前，答案可见性规则会隐藏学生端正确数、错误数和准确率，管理端报告保留完整计数。桌面与 390px 报告截图 `/tmp/shsat-two-section-report-1793049403477.png`、`/tmp/shsat-two-section-report-mobile-1793049403477.png`，目视检查无根页面横向溢出；页面错误为 0。临时学生、班级、试卷、考试和尝试由脚本清理。此结果覆盖两种起始顺序的小卷流程，不代表正式 100 题、12 种题型及正式报告打印已全部验证。
- [x] **SHSAT 学生考试状态与窄屏回归（2026-10-27）**：新增 `frontend/e2e/shsat-student-exam-states.cjs` 可复跑检查。创建两名临时学生和两场仅分配给其中一人的考试，确认 Upcoming 不显示开始操作、Available 显示可用的 `Start exam`，另一名学生看不到两场考试；390px 视口无横向溢出、无页面脚本错误。截图 `/tmp/shsat-student-exam-states-1793037226351.png` 与 `/tmp/shsat-student-exam-states-mobile-1793037226351.png` 已目视检查。发现窄屏标题曾被挤成窄列逐字换行，现调整卡片网格、状态和操作区布局；测试账号与考试均已清理。前端 production build 通过。此项不替代完整开考/交卷状态矩阵。
- [x] **Paper Management 分组首尾位置排序回归（2026-10-27）**：自动化创建三组临时文件夹，将第一组拖到第三组之后；排序接口成功，页面/API 顺序一致且刷新后保持，随后删除临时组并恢复、核对原顺序。390px 页面下 Paper List 与分组容器均无内部横向溢出；目视检查桌面/手机截图 `/tmp/shsat-paper-group-order-desktop-1793038672975.png`、`/tmp/shsat-paper-group-order-mobile-1793038672975.png`。修复拖动时边经过渡重排造成目标位置不稳定的问题；收紧分组最小宽度，避免窄屏内容被裁切。脚本 `frontend/e2e/shsat-paper-group-order.cjs` 通过，production build 通过。
- [x] **SHSAT Exam Release 发布/撤回与清理回归（2026-10-27）**：从统一后台操作发布和撤回定向考试；管理员表格的 `Assigned To` 显示具体受众，Specific students / Specific classes 筛选匹配正确；学生在开放期间可看到 `Start exam`，撤回后该场次从学生列表消失；`Monitor` 可进入监考页并返回 Exam Release。删除弹窗取消不改数据，第二次打开需等待 5 秒后确认，释放及关联临时学生均已清理。全流程页面错误为 0，学生端 390px 无横向溢出。修复列表此前把内部 `SELECTED` 原样显示、导致管理员看不到具体受众的问题。截图 `/tmp/shsat-exam-release-published-1793039283760.png`、`/tmp/shsat-exam-release-student-mobile-1793039283760.png`、`/tmp/shsat-exam-release-monitor-1793039283760.png`、`/tmp/shsat-exam-release-delete-cooldown-1793039283760.png`。自动化脚本 `frontend/e2e/shsat-exam-release-actions.cjs`、后端 `mvn test` 和前端 production build 通过；已有提交记录和复习任务的历史场次删除级联仍待覆盖。
- [x] **SHSAT Create Exam 表单与班级受众验收（2026-10-27）**：管理员实际打开创建弹窗，确认开始/结束时间默认值、空表单英文必填提示、可选试卷、班级多选、默认自动交卷/允许复查设置；创建后核对发布记录仍为草稿且目标班级、选项持久化，随后清理临时发布。第一次真实提交发现页面列出了归档班级，但后端只接受活动班级，导致创建失败并提示 `One or more selected classes are unavailable.`；现受众选择器仅列活动班级，归档班级不能再误选。脚本同时断言选择器班级集合与活动班级 API 完全一致。桌面/390px 弹窗与结构风险确认截图 `/tmp/shsat-exam-release-create-form-1793039753594.png`、`/tmp/shsat-exam-release-create-form-mobile-1793039753594.png`、`/tmp/shsat-exam-release-structure-warning-1793039753594.png`；列表截图 `/tmp/shsat-exam-release-created-by-form-1793039753594.png`。自动化 `frontend/e2e/shsat-exam-release-create-form.cjs` 通过，页面错误为 0，窄屏宽度为 390/390。结构风险确认提示可继续创建；本项不代表考试创建字段全部边界、教师受众限制或发布资格所有状态均已验收。
- [x] **SHSAT Review Assignment 建立、学生开始、管理员进度与结束闭环（2026-10-27）**：新增 `frontend/e2e/shsat-review-assignment-flow.cjs`。管理员创建临时试卷考试并使学生提交正式尝试，随后在页面创建复习任务；空白与无效时间范围校验正确，纠正截止时间后错误提示立即清除。首轮实测发现任务时间落库后偏移 8 小时，学生端因此错误禁用开始按钮；原因是 JDBC 将数据库 `DATETIME` 按 `Timestamp` 读取并进行时区换算，而独立版使用本地 `LocalDateTime`。现改为按 `LocalDateTime` 读取数据库 `DATETIME`，再次核对管理列表、任务详情、学生列表时间与输入分钟完全一致，`canStart=true`。学生点击 `Start review` 成功创建复习尝试；管理员 `View Progress` 显示正确学生及 `In Progress`，返回后保留 Review Assignments 标签，再验证结束确认取消不改状态、确认结束后任务进入 `ENDED`，且正在进行的学生尝试仍保留；学生刷新后仍可用 `Continue` 恢复同一尝试。桌面/390px 管理弹窗（含可滚动底部）、学生任务列表及进度页截图 `/tmp/shsat-review-assignment-create-1793040973899.png`、`/tmp/shsat-review-assignment-create-mobile-1793040973899.png`、`/tmp/shsat-review-assignment-create-mobile-footer-1793040973899.png`、`/tmp/shsat-review-assignment-student-1793040973899.png`、`/tmp/shsat-review-assignment-student-mobile-1793040973899.png`、`/tmp/shsat-review-assignment-progress-1793040973899.png`、`/tmp/shsat-review-assignment-progress-mobile-1793040973899.png`。自动化通过，三处窄屏根宽度均为 390px，浏览器页面错误 0；临时账户、班级、考试和尝试均清理。`mvn test` 与前端 production build 通过。独立版错题练习题目生成差异、学生端完成/重做/报告与更多异常状态尚未验收。
- [x] **教师创建真实错题来源 Review Assignment（2026-10-27）**：扩展 `frontend/e2e/shsat-review-assignment-flow.cjs`，改由真实临时教师账户打开 SHSAT Review Assignments，选择其可管理班级和考试，创建来源为学生真实已提交尝试的 100 题复习任务；相同时间校验错误仍显示清楚并可修正，创建后通过管理员 API 核实人数、资格、来源 attempt、题量和本地时区时间。教师账号目录访问返回 403、Paper Management 标签不可见。之后学生真实开始该任务，管理员端进度/报告/重做/结束流程继续通过。390px 表单、任务卡、进度和报告根宽均为 390px，页面脚本错误为 0；桌面/390px 创建弹窗截图 `/tmp/shsat-review-assignment-create-1793046985504.png`、`/tmp/shsat-review-assignment-create-mobile-1793046985504.png`，弹窗底部滚动截图 `/tmp/shsat-review-assignment-create-mobile-footer-1793046985504.png` 已目视检查。完整自动化 `npm run test:e2e:shsat:review-assignment-flow` 通过，学生、教师、班级、考试、任务和尝试清理。尚未测试教师以 UI 查看进度、结束真实来源任务的操作权限。
- [x] Assigned Review 进行中报告路径复测：在 SHSAT 管理端进度表打开学生的 `View Report`，报告正确显示 0/100 的结果摘要且无加载错误；点击 `Back to Review Assignment` 返回相同任务详情，学生仍为 `In Progress`。报告和进度卡片在 390px 视口下无横向溢出，进度行操作按钮完整可见。手机截图 `/tmp/shsat-review-assignment-report-mobile-1793044446108.png`、`/tmp/shsat-review-assignment-progress-row-mobile-1793044446108.png`；目视确认报告无重复导航栏残影。自动化 `npm run test:e2e:shsat:review-assignment-flow` 通过、页面错误为 0。学生完成/重做、截止状态及报告数据正确性仍待验收。
- [x] **学生已完成 Review Assignment 历史及报告入口（2026-10-27）**：对照独立版发现统一版缺少已完成任务历史与 `View Report` 入口；现将活动任务和已完成历史分开，完成项显示清题数并可打开学生报告。E2E 用受控任务列表响应验证 `COMPLETED` 与 `ENDED` 展示分支（已结束任务明确禁用并标为 `Task ended`），报告基于真实提交的学生尝试加载；桌面和 390px 均无横向溢出、报告无错误，页面脚本错误为 0。目视截图 `/tmp/shsat-review-assignment-completed-history-1793044738805.png`、`/tmp/shsat-review-assignment-completed-history-mobile-1793044738805.png`、`/tmp/shsat-review-assignment-completed-report-1793044738805.png`、`/tmp/shsat-review-assignment-completed-report-mobile-1793044738805.png`。`npm run test:e2e:shsat:review-assignment-flow` 与 production build 通过。此测用受控响应覆盖列表展示分支，不等于验证所有题目答对后后端将分配更新为 `COMPLETED`；该业务转换、重新练习及截止状态仍待端到端验收。
- [x] **SHSAT Review Assignment 重做与结束后继续闭环（2026-10-27）**：学生第一次提交仍有未答题时，后端返回 `RETRY_REQUIRED` 且 `canStart=true`；页面显示 “More Practice Needed”，`Try again` 创建新练习尝试，管理员进度改指向新 attempt。结束任务后该进行中的 attempt 仍可 `Continue`；未开始的结束态显示禁用的 `Task ended`。结束操作取消不改状态，确认后结束请求返回 200。窄屏 ended 卡片截图 `/tmp/shsat-review-assignment-ended-mobile-1793044978875.png`，桌面截图 `/tmp/shsat-review-assignment-ended-1793044978875.png`，目视布局清晰。脚本 `frontend/e2e/shsat-review-assignment-flow.cjs` 与 production build 通过，390px 根宽度 390px、页面脚本错误为 0。全部答对后自动完成的真实状态转换已由下方闭环测试覆盖。
- [x] **SHSAT Review Assignment 正确答题完成真实闭环（2026-10-27）**：新增 `frontend/e2e/shsat-review-completion.cjs`。临时一题试卷中，学生先提交错误正式答案，管理员创建 Review Assignment 后确认只分配该题；学生进入真实练习、答对并从考试页交卷，后端将任务从 `IN_PROGRESS` 更新为 `COMPLETED`，余题为 0。管理员进度页显示 1/1、100%、Completed 并可打开报告；学生 Review Task History 显示 `1 / 1 questions cleared`，报告正常。桌面/390px 两角色页面目视检查通过，根宽均为 390px、页面脚本错误为 0。截图 `/tmp/shsat-review-completion-admin-1793045811601.png`、`/tmp/shsat-review-completion-admin-mobile-1793045811601.png`、`/tmp/shsat-review-completion-1793045811601.png`、`/tmp/shsat-review-completion-mobile-1793045811601.png`。临时试卷、考试、任务、学生和班级均由测试清理。此前“自动完成尚未验证”的相关条目以本次结果更新。
- [x] SHSAT 重做状态视觉复核：桌面/390px 下 `More Practice Needed` 和 `Try again` 均可见、无横向溢出，点击后创建新尝试；截图 `/tmp/shsat-review-assignment-retry-1793045022635.png`、`/tmp/shsat-review-assignment-retry-mobile-1793045022635.png`。Ended/Completed 状态操作文案已映射为学生可理解的文字，不直接显示内部枚举。
- [x] **学生 Clear Answer 持久化与失败重试回归（2026-10-27）**：新增 `frontend/e2e/shsat-clear-answer-persistence.cjs`。学生真实进入 SHSAT 正式考试并恢复服务器已有答案后，清空答案请求此前没有发出，刷新会恢复旧选项；原因是保存队列排除了所有空答案。实现中分别跟踪“当前答案已保存”和“服务器已有答案”，避免先改选项再清空时丢掉待清除状态；清空操作立即写回，并在切题/交卷前重试失败项；保存期间禁用重复点击。自动化先把已保存选项改为另一项，再注入一次 HTTP 500；确认选择仍在本地清空且出现英文错误提示，再次清除收到 200；刷新后仍无选中项。390px 根页面无横向溢出，页面脚本错误为 0。桌面/窄屏截图 `/tmp/shsat-clear-answer-desktop-1793043164170.png`、`/tmp/shsat-clear-answer-mobile-1793043164170.png`；窄屏工具栏可横向滚动，行为与独立版相同。临时学生、考试和尝试已清理。`npm run test:e2e:shsat:clear-answer` 通过；其它题型的清空答案和提交幂等仍待验收。
- [x] **SHSAT Graph Question 评分与独立版规则对齐（2026-10-27）**：对照 `GraphQuestionGradingStrategy` 发现统一版错误地把配置的 tolerance 用于坐标近似匹配，未拒绝重复坐标和超出图表边界的点；旧式 `select_points` 也未拒绝重复/未配置点。现按独立版区分坐标点模式与候选点模式：坐标精确集合匹配、数字格式规范化、边界和重复点校验；候选点 ID 校验配置及重复。定向回归覆盖 `2`/`2.0`、超 tolerance 的近似点、重复点、范围外点及旧模式合法/重复/未知 ID，`ShsatQuestionGraderTest` 通过；全量后端测试 96 项通过，前端 production build 通过。扩展后的真实 API/浏览器小卷同时覆盖选择题、方程输入和坐标图点击作答、答案保存、提交及报告，三题均判对（raw 3/3，ELA 1/1、Math 2/2），页面脚本错误 0，390px 无横向溢出；桌面和窄屏截图 `/tmp/shsat-equation-report-1793048269170.png`、`/tmp/shsat-equation-report-mobile-1793048269170.png` 已目视检查。其余图表配置/边界异常的浏览器交互及 12 种题型全部闭环仍未完成。

## 9. 建议执行顺序与完成门槛

1. **P0 学生主链路**：补齐 G1/G2；用真实学生跑完整考试、两种 section 顺序、12 题型答案保存与报告；这是切换独立 SHSAT 的门槛。
2. **P0 计分与报告**：raw/折算、ELA/Math/技能子标签、历史快照、打印输出逐项对账；删除与权限边界必须覆盖。
3. **P1 管理操作**：试卷编辑/导出、分组排序、发布与资格、错题任务、班级/监考按上面每个控件验证。
4. **P1 视觉验收**：修复 V1/V2 和首轮截图问题，逐页桌面/窄屏截图复核；所有用户提示英文，整体保持独立新 SHSAT 的简约、清晰风格。

**完成条件：** 本清单全部必需项附可复查证据、无未处理 P0/P1 差异；管理员/教师/学生真实浏览器端到端通过，导出/报告文件实测，独立版与统一版逐页截图检查通过。未测项不得改写为“已完成”。
