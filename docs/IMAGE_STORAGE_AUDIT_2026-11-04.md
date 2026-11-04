# 迁移试卷图片本地化核对

线上统一系统的持久化素材目录为 `/opt/unified-exam-platform/shared/uploads/`，独立于应用 release。迁移图片从旧系统复制到此目录，运行时不读取旧系统文件。

- SAT / PSAT 素材位于 `sat-import/materials/`，对外路径为 `/sat-api/uploads/materials/`；已修正 351 条素材记录的路径，并补充正文内嵌图片的原始文件名。
- SHSAT 主素材位于 `paper-materials/shsat-import/`；题目和历史快照引用的旧图片分别保存于 `paper-materials/` 与 `images/`，统一系统提供对应资源路径。
- 本次新增复制 1,703 个文件，逐文件核对 SHA-256；原有导入素材移动到 SHSAT 静态资源目录，文件保存在统一系统中。
- 覆盖素材、题目、元数据及历史快照的核查共找到 3,432 个不同引用，其中 3,431 个可由平台服务账号读取。剩余 `/uploads/paper-materials/3-3cd41be2-196d-47b2-b27c-a18fe1a00b33.png` 在旧系统缺失，保留原引用。
- 分别请求 SAT 主素材、SAT 正文图片、SHSAT 主素材、SHSAT 旧正文图片、SHSAT 题目内嵌图片，均返回 HTTP 200 和图片内容类型。

执行前数据库备份为 `/opt/unified-exam-platform/backups/unified-before-image-localization-20261104.sql.gz`，完整文件清单和缺失项保存在 `/opt/unified-exam-platform/private/image-localization-final.json`。数据处理脚本为 `scripts/localize_migrated_images.py`，默认只预检；线上服务发布版本为 `20261104-image-localization`。
