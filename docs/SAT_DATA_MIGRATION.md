# SAT 数据迁移

此迁移将独立 SAT 系统 `sat_exam` 的账户、班级、题库、试卷、考试、报名、作答与成绩导入统一系统。每份试卷明确归属 SAT 或 PSAT，考试与记录跟随试卷归属；原系统的题目结构、模块和评分字段保存在 SAT 扩展表中。

## 执行

迁移脚本默认演练并回滚。必须提供试卷映射（CSV 列名 `source_paper_id,exam_type`）和班级映射（CSV 列名 `source_class_id,exam_type`），覆盖全部源试卷和班级，类型只能是 SAT 或 PSAT。旧班级若经确认需在两个模块保留，班级映射写两行，脚本创建两个独立班级并复制成员。出现遗漏时迁移会停止。正式写入需要 `--execute`、数据库环境变量和 `--backup-file`；冲突用户必须先提供人工核对后的映射。缺失素材可通过 `--allow-missing-assets` 保留源引用路径。

```sh
python3 scripts/migrate_sat_to_unified.py --paper-type-map /path/to/paper-types.csv --class-type-map /path/to/class-types.csv --report-json /tmp/sat-preflight.json
python3 scripts/migrate_sat_to_unified.py --execute --paper-type-map /path/to/paper-types.csv --class-type-map /path/to/class-types.csv \
  --backup-file /path/to/unified-before-sat.sql --report-json /path/to/sat-migration.json
```

本次预检确认源数据没有账号、班级名称或试卷代码冲突。源系统有一条考试记录（ID 63）失去学生报名关联，故保存在 `sat_import_orphan_attempts` 中，不虚构学生归属。找不到的素材文件保留其旧 URL，并在报告中逐项列出。

迁移运行记录及源到目标 ID 对照保存在 `sat_import_runs` 与 `sat_import_id_map`；考试特有的班级设置、发布设置、答题/评分字段分别保存在 `sat_class_settings`、`sat_exam_settings`、`sat_attempt_details` 和 `sat_answer_details`。

旧 SAT 只记录学生当前班级，并不记录考试时班级。只有经用户确认后才可传入 `--infer-class-attribution`，按学生当前班级和试卷类型推断正式考试归属；推断结果记录在 `sat_import_id_map` 的 `inferred_attempt_class` 中。找不到对应模块班级的记录不推断。

导入图片位于统一系统的 `uploads/sat-import/materials`，通过 `/sat-api/uploads/materials/` 提供。迁移后还应使用 `scripts/localize_migrated_images.py` 检查正文和历史快照里嵌入的旧图片引用。
