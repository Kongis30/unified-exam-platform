# SAT 数据迁移

此迁移将独立 SAT 系统 `sat_exam` 的账户、班级、题库、试卷、考试、报名、作答与成绩导入统一系统。SAT 与 PSAT 保留为试卷版本标记；题目结构、模块和评分相关的 SAT 原始字段保存在 SAT 扩展表中，避免把考试专属结构塞进通用表。

## 执行

迁移脚本默认只做预检。正式写入需要明确传入 `--execute`、数据库环境变量和 `--backup-file`。迁移前先通过 `mysqldump` 备份目标数据库；冲突用户必须先提供人工核对后的映射。缺失素材可通过 `--allow-missing-assets` 保留源引用路径。

```sh
python3 scripts/migrate_sat_to_unified.py --allow-missing-assets --report-json /tmp/sat-preflight.json
python3 scripts/migrate_sat_to_unified.py --execute --allow-missing-assets \
  --backup-file /path/to/unified-before-sat.sql --report-json /path/to/sat-migration.json
```

本次预检确认源数据没有账号、班级名称或试卷代码冲突。源系统有一条考试记录（ID 63）失去学生报名关联，故保存在 `sat_import_orphan_attempts` 中，不虚构学生归属。找不到的素材文件保留其旧 URL，并在报告中逐项列出。

迁移运行记录及源到目标 ID 对照保存在 `sat_import_runs` 与 `sat_import_id_map`；考试特有的班级设置、发布设置、答题/评分字段分别保存在 `sat_class_settings`、`sat_exam_settings`、`sat_attempt_details` 和 `sat_answer_details`。
