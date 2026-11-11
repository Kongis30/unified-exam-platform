# 删除 Default Class 技术方案

> 目标：把旧系统迁移进来的 "Default Class" 从系统中彻底删除；班内学生账户与全部成绩保留；学生与该班的关联全部解除。
>
> 状态：已实施并验证（本地库已应用 V41；线上待发布）。

---

## 零、线上与本地形态不同（关键）

同一份迁移必须同时适配两种数据形态，已实测确认：

| | 本地开发库 | 线上库 |
|---|---|---|
| Default Class 数量 | 1 个（id 37） | **2 个**：id 59（SAT）、id 63（PSAT） |
| 成因 | 旧班级 SAT 单一映射 | 旧班级源 id=3 同时含 SAT/PSAT，导入时**按工作区拆成两个班** |
| 映射表 | `class` 表 `3 → 37` | `class` 表 `3 → 59`，另有 `class_workspace` 表 `3:SAT → 59`、`3:PSAT → 63` |
| 覆盖工作区 | SAT + SHSAT | 59 是 SAT，63 是 PSAT |
| 在班学生 | 4 人 | **0 人**（4 人已于 2026-11-04 全部退出） |
| `attempt_classes` 成绩归属 | 0 条 | **6 条**（59 班 5 条、63 班 1 条） |
| 学生当前班级 | 都在 1on1 | **无任何班级**（已是无班级学生） |

因此迁移**不能只用 `entity_type='class'` 定位**，否则线上只会删掉 59、漏掉 63。定位逻辑同时读取 `class` 与 `class_workspace` 两类映射。

---

## 一、这个班级是什么

| 项 | 值 |
|---|---|
| id | 37 |
| name | Default Class |
| class_type | STANDARD |
| status | ACTIVE |
| created_at | 2025-12-06 13:17:24 |
| 来源 | 旧 SAT 系统（`sat_import_id_map`: `SAT_V1 / class / 源id=3 → 37`） |
| 旧系统元数据 | `sat_class_settings.source_metadata_json` = `{id:3, class_name:"Default Class", teacher_id:1, student_count:4, create_time:"2025-12-06 13:17:24"}` |

**结论**：这是旧 SAT 库里一个叫 "Default Class" 的源班级被 `scripts/migrate_sat_to_unified.py` 按 1:1 映射搬过来的产物，不是平台自己创建的。平台代码中唯一的 `INSERT INTO classes` 是管理员建班接口（`ClassAdminController:349`），没有任何自动建班逻辑。

> 注意与 `id=30 "Unassigned Students"` 区分：后者的 `source_metadata_json` 为 NULL、创建于 2026-09-29，是平台原生的兜底班级（新账号未分配班级时的落点）。**本次不动它。**

---

## 二、学生与班级的业务关联梳理

平台里"学生在班上"这一事实被拆成 **5 个层次**，用途完全不同。删除时不能一刀切。

| 层次 | 表 | 语义 | 37 班现状 | 能否删 |
|---|---|---|---|---|
| ① 当前成员关系 | `class_memberships` | 学生此刻是否在该班（`left_at IS NULL` 为在班） | 4 行，均在班 | 可删（本次目标） |
| ② 成员关系历史 | `class_membership_periods` | 每次入班/退班的时间区间，用于历史统计 | 4 行，`left_at` 均 NULL | 可删，但**这是唯一的历史证据** |
| ③ 考试资格快照 | `exam_participant_classes` | 考试发布那一刻冻结的"该班哪些人参加" | 4 行，全指向考试 3269 | 可删 |
| ④ 成绩归属快照 | `attempt_classes` | 作答开始时冻结的"这次成绩算哪个班" | **0 行** | 无需处理 |
| ⑤ 考试发布目标 | `exam_target_classes` | 该考试发布给了哪些班 | 3 行：112 / 113 / 3269 | 可删，但**会抹掉发布历史** |

另外两类附属记录：

| 表 | 37 班现状 | 说明 |
|---|---|---|
| `class_exam_workspaces` | 2 行：SAT、SHSAT | 决定该班学生在哪些工作区可见；外键 `ON DELETE CASCADE` |
| `sat_class_settings` | 1 行 | 旧系统班级元数据；外键 `ON DELETE CASCADE` |
| `shsat_class_metadata` | 0 行 | — |
| `exam_target_student_classes` | 0 行 | — |
| `exam_excluded_classes` | 0 行 | — |
| `review_tasks` | 0 行 | — |
| `shsat_wrong_answer_tasks` | 0 行 | — |
| `shsat_attempt_record_details.source_class_id` | 0 行 | 非外键，无引用 |

### 班内 4 名学生

| user_id | username | 姓名 | 入班时间 | 其它班级 | 工作区授权 |
|---|---|---|---|---|---|
| 289 | jennyy@jin | Jenny Yu | 2026-08-07 | 1on1 (1487) | SAT + PSAT + SHSAT |
| 290 | jieyul@jin | Jie Yu Li | 2026-09-06 | 1on1 (1487) | SAT + PSAT + SHSAT |
| 291 | liekkasl@jin | liekkas Lin | 2026-09-07 | 1on1 (1487) | SAT + PSAT + SHSAT |
| 292 | Joshuaz@jin | Joshua Zhen | 2026-09-19 | 1on1 (1487) | SAT + PSAT + SHSAT |

四个账号均 `ACTIVE`，且**都已在 1on1 班（1487，INDIVIDUAL 类型）**，入班时间 2026-11-08。

### 成绩情况

| 学生 | 作答 | 班级归属 |
|---|---|---|
| 289 | attempt 476「SAT ASSESMENT TEST」SUBMITTED | `attempt_classes` = NULL（个人派发，非班级派发） |
| 290 | attempt 495「SAT ASSEMENT TEST 4」SUBMITTED | NULL |
| 292 | attempt 498「Assement Test」SUBMITTED | NULL |
| 291 | 无 SAT/PSAT 正式作答 | — |

即：**没有任何成绩的班级归属挂在这个班上**，删班不会影响学生的成绩归属与可见性。

---

## 三、影响面分析：删掉之后会发生什么

### 3.1 不受影响（已验证）

1. **工作区访问权限**：4 人对 SAT / PSAT / SHSAT 都有 `user_workspace_access` 显式授权，不依赖班级。
2. **学生账户与成绩**：不动 `users`、`attempts`、`attempt_results`，成绩趋势、成绩单、报告页全部照常。
3. **个人定向考试**：4 人被单独指派过考试（95/97/98 等，`exam_target_students`），与班级无关。
4. **考试参与记录**：112 / 113 / 3269 的 `exam_participants` 行保留，学生仍能看到这些已关闭的考试。
5. **1on1 班成员关系**：保留。

### 3.2 会失去的东西（需要用户接受）

| # | 后果 | 严重度 | 处理建议 |
|---|---|---|---|
| A | **4 名学生失去 SHSAT 的"班级归属"**。class 37 覆盖 SAT+SHSAT，而 1on1 只有 SAT。今后发布 `target_scope = ALL_STUDENTS` 的 **SHSAT** 考试时，这 4 人不再被班级自动纳入（需显式指派）。现有 SHSAT 全员考试中他们本就不是参与者，因此**无存量影响，只影响未来**。 | 中 | 见下"待决事项 1" |
| B | **112 / 113 / 3269 的"发布给了 Default Class"这条记录消失**。三场考试均为 `CLOSED`，且各自还有 2 / 7 / 7 个其它目标班，考试本身不受影响。 | 低 | 用审计快照留存（见 §四） |
| C | **4 名学生的入班历史（`class_membership_periods`）消失**——这张表存在的意义正是保留这段历史。 | 中 | 用审计快照留存（见 §四） |
| D | 考试 3269 对这 4 人的**分派类型标签从 `GROUP` 变成 `ONE_ON_ONE`**（因为 `assignment_kind` 依赖 `exam_participant_classes ⋈ exam_target_classes`）。该考试已关闭、这 4 人无作答，仅在"我的考试"里展示文案变化。 | 低 | 接受 |
| E | 班级列表 / 班级详情 / 成绩趋势 / 班级考试等所有入口中，该班自然消失（`findClass(37)` 返回 404）。 | — | 这正是需求 |

### 3.3 为什么不能直接用平台现有的删除接口

`ClassAdminController.deleteClass`（第 391 行）对 class 37 **必然拒绝**，三重命中：

- `class_memberships` 有 4 个在班学生 → `"Only empty classes can be deleted."`
- `class_membership_periods` / `exam_participant_classes` 有记录 → `"This class has historical records. Archive it to preserve its history."`

而列表页的 `deletable` 标志对 37 也是 `FALSE`。

**因此这是一次数据清理，不是产品功能变更。** 我建议不去放宽这个通用保护（它会削弱所有班级的保护），而是用一次性 Flyway 迁移定点处理。

---

## 四、方案：V41 数据迁移

### 4.1 识别谓词（不用硬编码 id）

优先按旧系统映射定位，避免误删同名班级：

```sql
-- 唯一命中 37，且语义明确：旧 SAT 库 class 源 id=3
SELECT target_id FROM sat_import_id_map
WHERE source_system = 'SAT_V1' AND entity_type = 'class' AND source_id = '3';
```

迁移中先取该 id 存入变量，再以该 id 为条件做所有清理；若取不到（已在别处删除）则整段跳过，保证可重复执行。

### 4.2 执行顺序（必须遵守 RESTRICT 约束）

`classes` 的 12 个引用表中，`class_exam_workspaces` / `exam_excluded_classes` / `sat_class_settings` / `shsat_class_metadata` 是 `ON DELETE CASCADE`，其余 8 张是 `RESTRICT`。RESTRICT 的必须先生效清理。

| 步 | 动作 | 影响行数 |
|---|---|---|
| 0 | 写入 `audit_events`（`action_code = DELETE_LEGACY_CLASS`），`detail_json` 快照见 §4.3 | 1 |
| 1 | `DELETE FROM exam_participant_classes WHERE class_id = ?` | 4 |
| 2 | `DELETE FROM exam_target_classes WHERE class_id = ?` | 3 |
| 3 | `DELETE FROM class_membership_periods WHERE class_id = ?` | 4 |
| 4 | `DELETE FROM class_memberships WHERE class_id = ?` | 4 |
| 5 | `UPDATE sat_import_id_map SET target_id = NULL WHERE source_system='SAT_V1' AND entity_type='class' AND source_id='3'` | 1 |

第 5 步说明：不删行、只把 `target_id` 置空。这样既解除指向已删班级的悬空引用，又保留"旧系统 class 3 曾被导入"的审计痕迹；同时因为映射仍存在，重跑 `migrate_sat_to_unified.py` 的 `save_map` 会因主键冲突而失败并中止，不会把 Default Class 重新建出来。

第 6 步注意：执行前必须先清空第 5 步的 `target_id`，否则 `idx_sat_import_map_target` 上会残留指向不存在 id 的索引项。

### 4.3 审计快照（`audit_events.detail_json`）

```json
{
  "reason": "legacy default class removed at product request",
  "classId": 37,
  "className": "Default Class",
  "classType": "STANDARD",
  "createdAt": "2025-12-06 13:17:24",
  "legacySource": {"system": "SAT_V1", "classId": "3"},
  "legacyMetadata": { "teacher_id": 1, "class_name": "Default Class", "create_time": "2025-12-06 13:17:24", "student_count": 4 },
  "workspaces": ["SAT", "SHSAT"],
  "members": [
    {"userId": 289, "username": "jennyy@jin", "name": "Jenny Yu",    "joinedAt": "2026-08-07 08:58:37"},
    {"userId": 290, "username": "jieyul@jin", "name": "Jie Yu Li",   "joinedAt": "2026-09-06 15:32:36"},
    {"userId": 291, "username": "liekkasl@jin", "name": "liekkas Lin","joinedAt": "2026-09-07 13:48:02"},
    {"userId": 292, "username": "Joshuaz@jin", "name": "Joshua Zhen", "joinedAt": "2026-09-19 13:54:50"}
  ],
  "targetedExams": [
    {"examId": 112,  "title": "123", "examType": "PSAT", "status": "CLOSED"},
    {"examId": 113,  "title": "qwe", "examType": "PSAT", "status": "CLOSED"},
    {"examId": 3269, "title": "123", "examType": "SAT",  "status": "CLOSED"}
  ],
  "preserved": "students kept, attempts and scores untouched, workspace access unaffected"
}
```

快照用 `JSON_OBJECT` / `JSON_ARRAYAGG` 在迁移里从实际数据聚合生成，不写字面量，避免与实际数据不一致。

### 4.4 迁移后校验（写在同一迁移末尾，用 SIGNAL 或后续核对查询）

迁移本身只做删除；校验用以下只读查询确认（我会在迁移应用后逐条执行并回报）：

1. `SELECT COUNT(*) FROM classes WHERE id = 37` → 0
2. 4 名学生仍 `ACTIVE`，`user_workspace_access` 三行不丢
3. 4 人在 1on1(1487) 的 `class_memberships` 仍为 4 行
4. 4 人的 `attempts`（476/495/498）与 `attempt_results` 完好
5. 全库无残留：`class_memberships` / `class_membership_periods` / `exam_participant_classes` / `exam_target_classes` / `class_exam_workspaces` / `sat_class_settings` / `shsat_class_metadata` 中 `= 37` 的行均为 0；`sat_import_id_map` 中该映射行的 `target_id` 为 NULL（行仍在）
6. 112 / 113 / 3269 仍存在且其它目标班未受影响（112 剩 2 班、113 剩 7 班、3269 剩 7 班）
7. 4 人仍能在"我的考试"看到 112 / 113 / 3269（`exam_participants` 未动）

### 4.5 回滚预案

Flyway 版本迁移不做自动回滚。若需恢复，按 `audit_events` 快照手工重建：`INSERT classes` → `class_exam_workspaces` → `sat_class_settings` → `class_memberships` + `class_membership_periods`（用快照 joinedAt）→ `exam_target_classes`（3 行）→ `exam_participant_classes`（4 行）→ `sat_import_id_map`。快照包含全部重建所需字段，因此可完整还原。

---

## 五、代码改动清单

| 文件 | 改动 |
|---|---|
| `backend/src/main/resources/db/migration/V41__remove_legacy_default_class.sql` | 新增：定位（含工作区拆分）+ 安全闸门 + 审计快照 + 按序删除 |
| `docs/DEFAULT_CLASS_DELETION_SPEC.md` | 本文件 |
| `docs/DEPLOYMENT_RUNBOOK.md` | 新增：本次部署踩到的两个坑（`Requires=` 连带停前端、release 缺 `dist`）及迁移编写注意事项 |

**不改动**：`ClassAdminController` 的删除保护逻辑、前端任何页面。班级从所有列表自然消失，符合"从用户视角让这个班级消失"的要求。

---

## 五之一、线上执行结果（已完成）

### 定位逻辑

不能只用 `entity_type='class'` 定位——线上 Default Class 被拆成两个，第二个仅通过 `class_workspace` 映射登记。最终定位逻辑取三者的并集：

1. `sat_import_id_map` 中 `entity_type='class' AND source_id='3'` → 59
2. `sat_import_id_map` 中 `entity_type='class_workspace' AND source_id LIKE '3:%'` → 59、63
3. 兜底：`sat_class_settings` 中 `source_metadata_json` 的 `id=3` 且 `class_name='Default Class'`

结果集写入实体表 `tmp_legacy_default_classes`（不能用临时表，MySQL 不允许同语句内多次引用），末尾 `DROP`。

### 安全闸门调整

原设计要求「有 `attempt_classes` 就中止」。线上 59/63 共 6 条成绩归属，会让闸门必然触发、导致部署失败。经确认后改为：

- **成绩归属**：允许删除，但必须在审计快照中完整记录（`scoreAttributions` 字段）。依据：作答本身、`attempt_results`、`exam_participants` 全部保留，学生成绩与可见性不受影响，只是不再挂在 Default Class 名下。
- **复习任务**（`review_tasks` / `shsat_wrong_answer_tasks`）：仍然中止。这类数据无法通过删班安全解除，必须人工处理。

### 线上实际删除量

| 表 | 行数 |
|---|---|
| `classes` | 2（id 59、63） |
| `attempt_classes` | 6（59 班 5 条 + 63 班 1 条） |
| `exam_participant_classes` | 24 |
| `exam_target_classes` | 9（59 班 8 场、63 班 1 场，均为 CLOSED） |
| `class_memberships` | 8（4 人 × 2 班，均已于 2026-11-04 退出） |
| `class_exam_workspaces` / `sat_class_settings` | 级联清理（各 2 条） |
| `sat_import_id_map` | 3 行 `target_id` 置 NULL（行保留） |
| `audit_events` | 新增 2 条 `DELETE_LEGACY_CLASS` |

### 线上验证结果

| 校验 | 结果 |
|---|---|
| 两个 Default Class | 均已删除，零残留 |
| 4 名学生（582/584/585/594） | 全 ACTIVE，SAT 授权完好，已是无班级学生 |
| 6 次作答及成绩 | 完好（990 / 810 / 1080 / 520 / 1090 / 950），`attempt_results` 未动 |
| 考试可见性 | 4 人仍是 `exam_participants`，仍能看到那 9 场已关闭考试 |
| 班级列表 | 已无 Default Class |
| `flyway_schema_history` | v41 success=1 |

### 迁移前备份

`/opt/unified-exam-platform/backups/unified-before-default-class-removal-20261111T153831Z.sql.gz`（32MB，gzip -t 校验通过）。

---

## 六、处置规则（已确认）

用户明确的规则：

1. **班级物理删除**，不是归档、不是改名。
2. **学生账户与成绩全部保留**。
3. **学生与 Default Class 的关联全部解除**。
4. **该学生若还在其他班级，其他班级的归属完全不受影响**。
5. **该学生若只属于 Default Class，删除后正常成为"无班级学生"**——这在本系统是合法状态，不是异常。

### 规则 4 / 5 的实际落点（实测数据）

| 学生 | 删前班级 | 删后班级 | 是否变成无班级 |
|---|---|---|---|
| 289 Jenny Yu | Default Class + 1on1 | 1on1 | 否 |
| 290 Jie Yu Li | Default Class + 1on1 | 1on1 | 否 |
| 291 liekkas Lin | Default Class + 1on1 | 1on1 | 否 |
| 292 Joshua Zhen | Default Class + 1on1 | 1on1 | 否 |

**本次 4 名学生都另有 1on1 班，因此没有人会变成"无班级"**。但迁移逻辑按通用规则编写——不假设成员一定还有别的班，即使将来有学生只在这个班，也会被正确地解除关联而非删除账户。

### "无班级学生"是系统已支持的正常状态

已验证：
- 库中存在先例（`users.id=3711`，ACTIVE，SHSAT 工作区，无任何班级）。
- 学生端"我的考试"列表（`ExamReleaseService.listForStudent`）的数据源是 `exam_participants`（发布时冻结），**完全不依赖 `class_memberships`**，因此无班级学生照常看到已分派的考试。
- 学生工作区访问权限来自 `user_workspace_access` 显式授权，不来自班级。

### 唯一剩余的偏差，需要你确认

**37 班覆盖 SAT + SHSAT 两个工作区，而 1on1 只有 SAT。** 因此删除后：

- 4 名学生在 **SAT** 工作区仍有班级（1on1）；
- 4 名学生在 **SHSAT** 工作区将不再有任何班级（删前是 Default Class）。

影响范围：
- **存量无影响**：现有 SHSAT 考试中这 4 人本就不是参与者（`exam_participants` 无记录），已发布的考试可见性已冻结，不受班级变动影响。
- **未来有影响**：今后发布 `target_scope = ALL_STUDENTS` 的 SHSAT 考试时，发布逻辑按"班级所属工作区"扩展参与者，无班级学生不会被自动纳入，需显式指派。

两种处理，请选一个：
- **(a) 按当前规则直接删**（推荐，也最贴合你说的"没有其他班级就是无班级"）：SHSAT 侧他们变成无班级，将来需要时显式指派。
- **(b) 删班，同时给 1on1(1487) 补一行 SHSAT 工作区归属**，让这 4 人在 SHSAT 也保留班级归属。这会改变 1on1 班的可见范围，属于额外改动。

### 我按默认方式处理、无需你决策的两项

1. **历史记录**：`exam_participant_classes`(4) / `exam_target_classes`(3) / `class_membership_periods`(4) 随班级一起删除，但先写入 `audit_events` 完整快照（§4.3），可完整还原。
2. **`sat_import_id_map` 的旧映射行**（`SAT_V1 / class / 3 → 37`）：`target_id` 置为 `NULL` 而不是删行。理由：既解除指向已删班级的悬空引用，又保留"旧系统 class 3 曾被导入"的审计痕迹；同时避免重跑 `migrate_sat_to_unified.py` 时把 Default Class 重新建出来。

---

## 七、验证计划

1. 在数据库克隆（`v41_dryrun`）上先跑一遍迁移，逐条执行 §4.4 的 7 项校验
2. 校验通过后再通过 Flyway 正式应用
3. `JAVA_HOME` 指向 JDK 17 跑后端测试，确认无回归
4. 启动后端，确认启动无迁移错误；前端确认班级列表不再出现 Default Class、4 名学生仍能正常登录并看到自己的成绩与考试
