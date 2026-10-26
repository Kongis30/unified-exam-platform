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
- [ ] 系统选择：学生选择 SHSAT；管理员/教师进入 SHSAT 后台；顶部导航与其它模块一致，考试作答页不显示平台导航。
- [ ] 管理员首页 Available Exams：刷新、折叠/展开及刷新后记忆；卡片只展示开放期内可进入的考试，显示时间、试卷、时长、状态；`Start Exam` 进入考试、退出返回原处；空状态正确。
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
- [ ] 组操作 `Rename folder`、`Delete empty folder`：编辑、取消、成功刷新；非空不能误删；表内缩进、组名、数量和操作图标视觉一致。
- [x] 文件夹 CRUD 烟测：空名称显示英文必填错误；新建/重命名写入数据库并刷新后保留；取消创建不产生记录，取消删除保留文件夹，确认删除只删除空文件夹。临时文件夹已清理；浏览器脚本错误为 0。桌面状态截图 `43-folder-validation.png`、`44-folder-renamed.png`、`45-folder-delete-confirm.png`。
- [ ] `Create Paper`：名称、时长、状态等字段校验；创建后出现在正确分组，能从列表打开编辑。
- [x] 新建/删除试卷烟测：Paper Name 为空显示英文校验；补正后错误即时清除；成功创建后进入该试卷编辑器，ELA/Math 区域显示，列表/API 均可查到；从列表走 10 秒冷静期删除，确认后行消失且详情 API 为 404。临时试卷已删除；截图 `46-paper-create.png`、`47-new-paper-editor.png`、`48-paper-delete-cooldown.png`。此项只验证新建空草稿元数据和删除，不代表添加题目/保存题目通过。
- [x] Paper List action 菜单接入：发现 SHSAT AdminHome 漏导入共享 `AdminActionMenu`，导致菜单按钮未渲染、操作项作为普通按钮显示；补齐导入后确认每行显示省略号入口、Delete 排最后、Escape 可关闭；`Export PDF` 可进入导出页。115 题卷 PDF 输出 218,673 bytes、13 页 Letter，抽取文本含章节/题目内容，浏览器脚本错误为 0。封面后的空白页在独立版导出中也明确存在，是双面打印留白，保持一致；截图 `37-paper-export.png`，PDF `37-paper-export.pdf`。`Move` 仍待验证。
- [x] 纸卷只读操作抽测（SHSAT CRASH COURSE TEST 6）：`Detail` 显示纸卷名/分组题数，关闭正常；`Edit Info` 字段正确载入，取消不改数据；`Preview` 可显示题目并用 Back 回到 Paper Management；`Edit Paper` 可加载题树/当前题，未修改时 `Save Changes` 禁用；Delete 对临时新卷显示 10 秒冷静期，期满 UI 删除成功。浏览器脚本错误为 0；桌面截图 `38-paper-detail.png` 至 `41-paper-editor.png`、`48-paper-delete-cooldown.png`。此测试样卷有 Math 50 题、ELA 0 题，不能代替完整正式卷验收；编辑保存、拖题、导入等写操作仍待验证。
- [x] 选择题编辑保存闭环：临时创建 SHSAT 试卷，在 ELA 添加选择题并编辑题干、选项和正确答案；保存后从详情 API 核对，再刷新编辑器核对字段仍保留，预览中显示相同题干/选项；浏览器脚本错误为 0。临时试卷已清理。截图 `49-question-editor-before-save.png`、`50-question-editor-after-reload.png`、`51-question-preview.png`。仅覆盖 `MULTIPLE_CHOICE`，其它题型继续逐类验收。
- [x] 修复带题目试卷删除 500：保存一题后删除会被 `paper_sections` 的父子 `RESTRICT` 外键阻止；删除服务现在先移除子分组，再级联删除父试卷，并清理不再被其它纸卷引用的题目。保存闭环临时试卷删除返回 200，随后详情查询已不存在；关联已有考试记录的删除约束仍按下方项目继续验收。
- [ ] 逐卷 Action 菜单：`Move`、`Detail`、`Edit Info`、`Edit Paper`、`Preview`、`Export PDF`、`Delete` 按独立版逐个操作；弹窗可关闭、保存后刷新，删除有影响说明和确认，删除后引用处处理明确；危险动作始终排最后。
- [ ] 试卷列表：名称、题量、时长、分数、状态/Online 与详情相同；长名称、空字段、离线/草稿、缺失资源显示合理；排序/过滤后菜单仍对准当前行。

## 3. SHSAT 试卷编辑器、预览、导出

- [ ] 顶部 `Back to Paper Management`、计分规则选择、`Preview`、`Save Changes`：未改动禁用保存；保存/刷新仍保留结构和答案；未保存返回出现 `Stay`/`Leave Without Saving`；错误有英文提示。
- [ ] 左侧题目树：ELA/Math Part 与子题型归类、题号、选择题目、上一题/下一题、各 Part `Add Question`、材料成组题插入；组内拖动和跨组限制与独立版一致，保存后编号及归属正确。
- [ ] `Import from Exam`：源考试/题型/分析筛选、展开分组、预览、单选/多选、确认导入、取消；材料、答案、标签、图片关联不丢失，不重复导入。
- [ ] `Parts`/`Types`：新增、编辑、删除主/次类型及次序；已被题引用时给出合理处理，编辑后题目树/预览同步。
- [ ] 单题通用编辑：题型、主/次类型、难度、官方 SHSAT 技能标签、题干、解析、分值/计分段、素材类型；`Add`、`Delete`、预览和保存后结构不变形。
- [x] 选择题写入抽测：添加 ELA 题目、编辑题干/选项/答案键，保存成功；API、编辑页刷新和预览内容一致，临时卷已清理。截图 `49-question-editor-before-save.png` 至 `51-question-preview.png`；仅覆盖 `MULTIPLE_CHOICE`。
- [ ] 素材操作：选择已有、新建、清除文本/图片材料；图片上传、截图粘贴、预览/放大/重置/关闭，Markdown/公式插入与显示；共享材料编辑影响范围与源系统一致。
- [ ] **逐题型闭环**：`MULTIPLE_CHOICE`、`MULTI_SELECT`、`MULTI_SELECT_FIXED`、`FILL_IN_BLANK`、`INLINE_CHOICE`、`DRAG_AND_DROP`、`HOT_TEXT`、`HOT_SPOT`、`TABLE_GRID`、`GRAPH_QUESTION`、`EQUATION_EDITOR`、`SOLUTION_SET` 各用一题完成创建→保存→刷新→预览→作答→提交→报告复核。每类的选项/交互数据、答案键、评分及解析需逐字段对照，不能只测选择题。
- [ ] 题型内按钮：填空可接受答案增删；拖拽 Item/Zone 增删和正确匹配；Hot Text/Spot 区域增删及坐标；图表点、方程输入、解答集等题型专用控件都要检查初始、修改、清空、保存恢复。
- [ ] 预览：`Back`、上一题/下一题、Review 面板与题号跳转、书签、工具栏、ELA/Math 转换；预览不写入正式学生记录；缺失题干/图片给出准确提示。
- [ ] 导出：Student Paper/Answer Key、Whole Paper/ELA/Math 切换；`Print / Save ... PDF` 输出非空、有正确题序/页码/图片/公式/答案和分页，打印预览不裁切；无 ELA/Math 标签题给出提示，不能静默丢题。

## 4. Exam Release 与 Historical Exams

- [ ] `Create Exam`：标题/说明、试卷选择、开放/截止日期时间、考试时长、次数、面向全部学生或指定班级/学生；时间顺序与时区校验、题目结构风险确认，取消不产生记录。
- [ ] 发布前检查：试卷 READY/Online、ELA 与 Math 计分段、题量/答案完整性、截止时间与资格；`Publish`、`Unpublish` 成功后 Student Access 与卡片同时更新；重复提交/并发/409 给出可理解提示。
- [ ] 发布资格：全体/指定班级/指定学生规则正确；开放期间新加入目标班级的学生自动有资格，离班后资格、已在考/已提交记录处理符合规则。
- [ ] 主表：搜索、visibility/time window/assigned-to 筛选，Refresh、折叠/展开、每页行数和前后翻页；表头/值对齐、时间 24 小时制到分钟；试卷被删除时考试名下显示明确提示。
- [ ] Action 菜单：当前场次 `Publish/Unpublish`、`Monitor`、`Delete`；结束场次 `Monitor`、`Delete`，删除始终最后。菜单不能被表格/分页裁切，键盘 Esc 和外部点击可关闭。
- [ ] Historical Exams：过期场次归档并自动不再对学生开放，展示状态应为 Unpublished；展开/收起、分页；删除需说明连带考试记录/答案/成绩/报告/任务，提供 5 秒冷静期，确认后级联删除，取消不改动数据。
- [x] **删除级联抽测**：有进行中学生尝试的测试考试，经 UI 的 5 秒确认后删除；考试接口返回 404，学生历史不再包含该尝试。截图 `35-monitor-live-data.png`；报告/复习任务等其它关联记录仍需逐类核对。
- [ ] 考试发布/撤回/删除后，首页卡片、班级考试、监考与学生入口同步更新；有尝试记录的场次按业务规则处理，不误删别的考试或用户。

## 5. Review Assignments 与班级

- [ ] Review Assignments 搜索、按考试/班级筛选、Refresh、Create Assignment；设置来源考试、班级、开始/结束时间及目标，校验无来源记录/无错题/时间冲突；发布后人数和状态准确。
- [ ] 表格 Action：`View Progress` 返回原标签与筛选位置；`End`/取消任务及确认；状态、完成/资格、进行中/未开始/缺少源尝试统计要与详情相符。
- [ ] 任务进度页：Back、Refresh/Retry、逐学生题数/状态/完成时间、`View Report`；截止/重做/零剩余题、源考试删除后的状态和提示准确。
- [ ] Classes 首页：搜索、`Create Class`、刷新、卡片打开、空班删除、拖动顺序持久化；同一学生可加入多个班级；班级能接收 SHSAT 或 SAT 场次。
- [ ] Unassigned Students：刷新/折叠、最多 800px 内滚动、表头全选/逐项多选、`Assign selected`、班级选择、取消/提交；已在其他班的学生不应被误标“未分配”。
- [ ] 班级详情：Back、`Edit Class`、Refresh、字段校验、保存反馈；班级考试搜索/排序/分页、`View Results`/`Monitor`；学生表 `View`/`Edit`/`Delete`、批量 `Add student` 搜索与已属班级标注、多选加入；不得误删统一账号而只应移除本班归属（具体删除语义需与当前按钮文案核对）。
- [x] `Class Exam Score Trend`：复核 SHSAT 文案、raw/scaled 提示和无数据状态；桌面截图确认没有 SAT/PSAT 范围提示。仍需用带 SHSAT 折算分/考试点的数据验证曲线与悬浮内容。
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
- [ ] Question Review：All/Correct/Wrong/Unanswered 筛选、逐题跳转、原答案/正确答案/解析、材料/图片/公式和 12 种题型的结果组件；可见性规则限制未公开答案。
- [x] `Print Report`：管理员报告刷新返回 200；管理端 27 页及学生端 24 页 Letter PDF 已生成并抽查分页。知识技能分页空白已修复，学生端首屏/中间/末页文字和问题卡片可读。图片/公式极端长内容及 12 种题型 PDF 版式仍待覆盖。
- [ ] 监考页 Back、正确率热图交互、图片放大；结束考试/无人在线/无答案时图表或空状态准确，图宽不溢出容器。
- [x] **监考实时数据抽测**：真实学生开考、提交一道答案并移动到下一题后，页面显示 1 名进行中学生及当前题分布；平均用时图显示对应题的 2 秒数据；题目详情抽屉可打开并关闭。浏览器脚本错误为 0。截图 `35-monitor-live-data.png`。此结果仅为单学生、单题数据样本，不代表热图统计和其它监考操作均已验收。

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
- [x] **真实试卷计分闭环抽测**：使用正式 SHSAT 试卷 252（ELA 57 题、Math 58 题）创建定向考试，提交 115 题答案，并通过考试页面实际输入一道填空题；报告与答案键逐题对账为 115/115 正确、0 错、0 空，ELA raw 58、Math raw 57，总分 115/115。测试确认填空答案在最终提交时来自当前界面状态，不能只靠后台写入模拟；临时考试与账号已在脚本清理。截图 `26-student-report-after-submit.png`：报告可读、两科题目分组完整、打印版页面连续。此样本验证原始题数计分及报告数据，不代表折算分曲线、全部题型真实 UI 作答或全量报告布局已验收。
- [ ] 真实学生考试完整逐题作答（不经接口代填）、两种起始顺序下答案与计分复核、工具栏操作、失焦/全屏违规、计时结束和断网续考仍待验证。刷新后保留答案已抽样验证；未覆盖每题导航/工具操作。
- [ ] 12 种题型逐题闭环、管理员各页每个 CRUD/菜单动作、更多教师权限、PDF 极端材料/公式版式、移动端关键页面、图表有真实分数数据，以及与独立版逐页并排核对尚未完成。

## 9. 建议执行顺序与完成门槛

1. **P0 学生主链路**：补齐 G1/G2；用真实学生跑完整考试、两种 section 顺序、12 题型答案保存与报告；这是切换独立 SHSAT 的门槛。
2. **P0 计分与报告**：raw/折算、ELA/Math/技能子标签、历史快照、打印输出逐项对账；删除与权限边界必须覆盖。
3. **P1 管理操作**：试卷编辑/导出、分组排序、发布与资格、错题任务、班级/监考按上面每个控件验证。
4. **P1 视觉验收**：修复 V1/V2 和首轮截图问题，逐页桌面/窄屏截图复核；所有用户提示英文，整体保持独立新 SHSAT 的简约、清晰风格。

**完成条件：** 本清单全部必需项附可复查证据、无未处理 P0/P1 差异；管理员/教师/学生真实浏览器端到端通过，导出/报告文件实测，独立版与统一版逐页截图检查通过。未测项不得改写为“已完成”。
