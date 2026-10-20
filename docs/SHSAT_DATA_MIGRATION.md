# 独立 SHSAT V2 数据迁移

此脚本只迁移 `shsat_exam_v2`（新 SHSAT 系统），不读取旧版 SHSAT 数据库。数据进入统一平台的 SHSAT 模块；统一账户仍存入平台 `users`，考试和题目进入通用表，SHSAT 特有的题型/材料/计分/历史快照放在 `shsat_*` 表。

## 覆盖内容

- 账户、密码哈希、角色、邮箱和启用状态
- 班级、成员关系、学生性别/学号/备注、延时 accommodation 和班级教师/学年信息
- 试卷组、试卷版本、Part/子题型层级、材料、题目、答案键、题型配置、校验规则和评分规则
- 计分 profile 与完整换算表、答案 PDF
- 考试发布、发布目标、所有正式及练习 attempt、题目/作答快照、答案、分数与分类 breakdown
- 错题任务、学生分配、关联正式/练习 attempt
- 被材料、题目快照和答案 PDF 引用的上传文件

源题目 JSON 按原字段保存在目标题目的 JSON payload 中。试卷总题数、分值、显示顺序和版本标签等通用表无法表达的字段保存在 `shsat_paper_metadata`。历史 attempt 的完整题目快照存入 `shsat_attempt_item_snapshots`，逐题答案的旧字段存入 `shsat_attempt_answer_details`，因此历史回看不依赖当前试卷内容。来源的练习标记和原始状态保存在 SHSAT 扩展记录中；源状态 `COMPLETED` 映射到平台标准状态 `SUBMITTED`，便于平台已有报告读取。

## 前置条件

1. 确认源库是新 SHSAT V2 的 `shsat_exam_v2`；资源根目录应覆盖历史上传文件实际所在位置。若资源分散在项目不同目录，可指向整个工作区根目录。
2. 备份源库，并先在目标项目应用 V12 Flyway 迁移。不要手工编辑已经应用的历史 migration。
3. 安装依赖：

   ```bash
   cd unified_exam_platform
   python3 -m venv .venv-migration
   . .venv-migration/bin/activate
   pip install -r scripts/requirements-migration.txt
   ```

4. 为源库和目标库分别设置连接环境变量。密码只从环境读取，不作为命令行参数：

   ```bash
   export SOURCE_DB_HOST=127.0.0.1 SOURCE_DB_PORT=3306 SOURCE_DB_NAME=shsat_exam_v2
   export SOURCE_DB_USER=root SOURCE_DB_PASSWORD='源库密码'
   export TARGET_DB_HOST=127.0.0.1 TARGET_DB_PORT=3306 TARGET_DB_NAME=unified_exam_platform
   export TARGET_DB_USER=root TARGET_DB_PASSWORD='目标库密码'
   export SOURCE_ASSET_ROOT='/绝对路径/jin'
   export TARGET_ASSET_ROOT='/绝对路径/unified_exam_platform/backend/uploads'
   ```

## 账户冲突人工核对

脚本不会根据姓名或用户名自动合并账户。若目标库已有同用户名，先人工确认确为同一人，再复制示例映射文件并填写 `source_user_id,target_user_id`：

```csv
source_user_id,target_user_id
1,1
```

源账号 ID 可从源库 `users.user_id` 查询，目标账号 ID 可从目标库 `users.id` 查询。映射目标必须存在且角色相同。映射时脚本不会覆盖已有目标账号的姓名、密码、邮箱、角色或状态。未解决冲突会中止迁移。

若班级名称或 SHSAT 试卷版本键与目标库冲突，脚本也会中止。先在目标后台确认是否属于已有数据；若不是同一记录，需先调整目标端班级名称/试卷编码后再运行，脚本不会自动合并。

## 运行

默认是演练模式：执行全量转换和目标端约束检查，事务最后回滚，不保存数据库行或附件。先输出预检审计文件：

```bash
python3 scripts/migrate_shsat_v2_to_unified.py \
  --account-map scripts/mappings/shsat_account_map.csv \
  --report-json /tmp/shsat-migration-preflight.json
```

检查报告中的源记录数量、账户冲突和附件状态。附件缺失/同名但内容不同默认会阻止运行；补全 `SOURCE_ASSET_ROOT` 后重试。若已确认缺失附件可保留原引用路径，可加 `--allow-missing-assets`；脚本会保留原路径，并将缺失文件逐项写入报告。只有确认演练结果和人工账号映射后，才执行正式导入：

```bash
python3 scripts/migrate_shsat_v2_to_unified.py \
  --execute \
  --account-map scripts/mappings/shsat_account_map.csv \
  --allow-missing-assets \
  --backup-file /安全备份目录/unified_exam_platform-before-shsat-import.sql \
  --report-json /安全备份目录/shsat-migration-report.json
```

`--execute` 强制要求 `--backup-file`，且只有目标库备份成功后才开始导入。脚本把目标库导入放在单个事务中；发生错误会回滚目标记录并清理本次新复制的附件。源库始终只读。导入 ID 映射以 `(source_system, entity_type, source_id)` 为主键，完成的迁移再次运行会跳过已有映射，不覆盖业务数据。

## 目标库核对

脚本会核对账户/试卷/考试/attempt 的映射数量，并依赖目标外键验证关联完整性。导入完成后，结合运行输出和审计报告核对源记录量、目标映射量、附件哈希，以及各模块页面显示。`attempts.is_practice` 区分练习记录；平台正式考试次数、学生考试列表、SHSAT 班级成绩和监考分析会排除练习记录。

## 需要注意

- 不会清空目标库，现有 SAT 数据及管理员账号不会被覆盖。
- 若同名 SHSAT 计分 profile 已存在，导入时创建下一个版本号并迁入源换算表，不修改平台内置版本。
- 来源 `created_by` 若为空，试卷/考试由指定平台管理员作为创建人，原始来源 ID 与完整源行保存在迁移 ID 映射/元数据中。
- 数据库事务无法覆盖文件系统事务；脚本记录本次新复制文件并在数据库失败时清理这些文件。正式迁移前仍应备份 `backend/uploads`。
- 迁移工具不从旧 SHSAT 系统导数据，也不自动重置或统一密码；源 BCrypt 哈希复制后，用户仍使用原账号凭证登录（映射到现有账号时沿用目标端凭证）。
