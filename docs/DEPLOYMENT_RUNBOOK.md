# 线上部署与回滚手册

> 线上环境：`jin`（50.6.225.42），部署根目录 `/opt/unified-exam-platform/`
> 本文记录实际验证过的部署流程，以及两个曾导致线上中断的坑。

---

## 一、线上环境结构

| 项 | 值 |
|---|---|
| SSH 别名 | `jin` |
| 部署根目录 | `/opt/unified-exam-platform/` |
| 当前版本 | `/opt/unified-exam-platform/current` → `releases/<版本名>` 符号链接 |
| release 目录内容 | `target/exam-platform-api-0.1.0-SNAPSHOT.jar` + `dist/`（前端静态文件） |
| 环境变量文件 | `/etc/sysconfig/unified-exam-platform`（含 DB 密码，需 sudo 读取） |
| 后端服务 | `unified-exam-platform-api.service`，监听 `127.0.0.1:8087` |
| 前端服务 | `unified-exam-platform-web.service`，nginx，监听 `:443` 与 `:8446` |
| 真实域名 | `exam.jinbesttutoring.com` |
| 数据库 | 本机 MySQL 8.0，库名 `unified_exam_platform`，应用账号 `unified_exam_app` |
| 备份目录 | `/opt/unified-exam-platform/backups/` |

---

## 二、部署前必查（两次真实事故的教训）

### 坑一：`systemctl stop api` 会连带停掉前端

`unified-exam-platform-web.service` 中写着：

```ini
After=network.target unified-exam-platform-api.service
Requires=unified-exam-platform-api.service
```

`Requires=k` 表示：k 停止时本服务**也被停止**。但反过来**不成立**——`systemctl start api` 之后 web **不会**自动恢复。

**后果**：只 `stop api` 再 `start api`，前端会一直处于 inactive，网站打不开。

**正确做法**：每次重启 api 后，必须显式确认并启动 web：

```sh
systemctl is-active unified-exam-platform-api unified-exam-platform-web
# 若 web 不是 active：
sudo systemctl start unified-exam-platform-web
```

**建议用 `restart` 而不是 `stop` + `start`**，并且始终同时处理两个服务：

```sh
sudo systemctl restart unified-exam-platform-api
sudo systemctl restart unified-exam-platform-web
```

### 坑二：新 release 目录必须同时包含 `dist/` 和 `target/`

nginx 的 `root` 配置为：

```
root /opt/unified-exam-platform/current/dist;
```

如果新建 release 目录只放了 `target/`（jar），切换 `current` 符号链接后 nginx 找不到静态文件，**首页返回 500**（API 仍然正常，容易误判为「只有首页坏了」）。

**正确做法**：创建 release 目录后，逐项比对上一个 release 的目录结构：

```sh
ls /opt/unified-exam-platform/releases/<上一个版本>/
ls /opt/unified-exam-platform/releases/<新版本>/
```

若本次改动不涉及前端，直接复制上一版前端产物（保持 uid 一致）：

```sh
sudo cp -a /opt/unified-exam-platform/releases/<上一个版本>/dist \
           /opt/unified-exam-platform/releases/<新版本>/dist
sudo chown -R unifiedexam:unifiedexam /opt/unified-exam-platform/releases/<新版本>/dist
```

若涉及前端改动，则需在本地 `npm run build` 后上传新的 `dist/`。

---

## 三、标准部署流程

### 1. 备份数据库（不可跳过）

```sh
TS=$(date -u +%Y%m%dT%H%M%SZ)
ssh jin "sudo mysqldump --single-transaction --routines --triggers unified_exam_platform \
  | gzip -1 > /opt/unified-exam-platform/backups/unified-before-<改动名>-\$TS.sql.gz"
# 校验备份可解压
ssh jin "gzip -t /opt/unified-exam-platform/backups/unified-before-<改动名>-\$TS.sql.gz && echo GZIP_OK"
```

### 2. 本地构建并确认迁移已打入

```sh
cd backend
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.18/libexec/openjdk.jdk/Contents/Home
mvn clean package -DskipTests
# 确认新增的迁移文件在 jar 内
unzip -l target/exam-platform-api-0.1.0-SNAPSHOT.jar | grep "db/migration/V<版本>"
```

### 3. 创建 release 目录并上传

```sh
REL=<日期>-<改动名>-<短提交号>
ssh jin "sudo mkdir -p /opt/unified-exam-platform/releases/$REL/target && \
         sudo chown -R unifiedexam:unifiedexam /opt/unified-exam-platform/releases/$REL"
scp backend/target/exam-platform-api-0.1.0-SNAPSHOT.jar jin:/tmp/new.jar
ssh jin "sudo mv /tmp/new.jar /opt/unified-exam-platform/releases/$REL/target/exam-platform-api-0.1.0-SNAPSHOT.jar && \
         sudo chown unifiedexam:unifiedexam /opt/unified-exam-platform/releases/$REL/target/*.jar"
```

### 4. 补齐前端 `dist/`（见坑二）

```sh
ls /opt/unified-exam-platform/releases/$REL/   # 必须同时有 dist 和 target
```

### 5. 切换并重启

```sh
ssh jin "
  sudo systemctl stop unified-exam-platform-api
  sudo ln -sfn /opt/unified-exam-platform/releases/$REL /opt/unified-exam-platform/current
  readlink -f /opt/unified-exam-platform/current
  sudo systemctl start unified-exam-platform-api
  sleep 25
  sudo systemctl start unified-exam-platform-web   # 必做，见坑一
"
```

### 6. 验证（三项全绿才算完成）

```sh
ssh jin "
  systemctl is-active unified-exam-platform-api unified-exam-platform-web
  sudo journalctl -u unified-exam-platform-api --since '5 minutes ago' --no-pager \
    | grep -iE 'Migrating|Successfully applied|Started ExamPlatform|ERROR' | tail -10
  curl -s -o /dev/null -w 'home=%{http_code}\n'  --resolve exam.jinbesttutoring.com:443:127.0.0.1 https://exam.jinbesttutoring.com/
  curl -s -o /dev/null -w 'api=%{http_code}\n'   --resolve exam.jinbesttutoring.com:443:127.0.0.1 https://exam.jinbesttutoring.com/api/exam-types
"
```

期望：两个服务 `active`，Flyway 显示 `Successfully applied`，`home=200`、`api=200`。

**注意**：验证必须用 `--resolve` 带上真实域名。直接 `curl https://127.0.0.1/api/...` 会命中另一个 server 块（`proxy_pass 127.0.0.1:8446`），返回 404，那是误报。

---

## 四、回滚

### 版本回滚（代码）

```sh
ssh jin "
  sudo ln -sfn /opt/unified-exam-platform/releases/<上一个版本> /opt/unified-exam-platform/current
  sudo systemctl restart unified-exam-platform-api
  sudo systemctl restart unified-exam-platform-web
"
```

### 数据库回滚

**注意：Flyway 迁移已执行后，代码回滚不会撤销数据变更。** 需从备份恢复：

```sh
ssh jin "
  sudo sh -c 'gunzip -c /opt/unified-exam-platform/backups/<备份文件>.sql.gz | mysql unified_exam_platform'
"
```

恢复前务必确认备份的完整性，并停掉 api 服务避免写入。

---

## 五、迁移编写的注意事项

### 1. 本地与线上数据形态可能不同

不能只按本地数据验证就上线。以 `V41__remove_legacy_default_class.sql` 为例：

| | 本地 | 线上 |
|---|---|---|
| Default Class 数量 | 1 个 | 2 个（旧班级按工作区拆分） |
| 映射表 | 仅 `entity_type='class'` | 还有 `entity_type='class_workspace'` |
| `attempt_classes` | 0 条 | 6 条 |

**因此定位逻辑必须同时读取 `class` 与 `class_workspace` 两类映射**，只查一类会漏删一半。

### 2. 迁移必须在真实数据副本上干跑

```sh
# 导出线上库到本地，改库名后导入独立克隆库验证
ssh jin "sudo mysqldump --single-transaction --routines --triggers unified_exam_platform | gzip -1" > /tmp/prod_snapshot.sql.gz
gunzip -c /tmp/prod_snapshot.sql.gz \
  | sed -e 's/`unified_exam_platform`/`prod_clone`/g' | mysql -u... prod_clone
```

**警告**：`mysqldump` 输出含 `CREATE DATABASE \`unified_exam_platform\`` 与 `USE \`unified_exam_platform\``，直接导入会覆盖本地库。必须先改库名。

### 3. MySQL 临时表不能在同一语句内多次引用

`CREATE TEMPORARY TABLE` 后，形如

```sql
SELECT COUNT(*) FROM review_tasks WHERE class_id IN (SELECT class_id FROM tmp_x)
     + (SELECT COUNT(*) FROM y WHERE class_id IN (SELECT class_id FROM tmp_x));
```

会报 `ERROR 1137 Can't reopen table`。改用普通表，并在迁移末尾显式 `DROP TABLE IF EXISTS`。

### 4. 安全闸门要用会真正失败的手法

只 `SELECT IF(...)` 不会中断迁移。要让 Flyway 失败回滚，用单值变量接多行子查询：

```sql
SET @guard = IF(<危险条件>, (SELECT 1 UNION ALL SELECT 2), 0);
-- 触发时报 ERROR 1242，迁移失败
```

验证方式：在克隆库注入脏数据 → 跑迁移 → 确认退出码为 1、目标数据未被删除、无残留审计行。

### 5. 危险变更前写审计快照

删除类迁移应先把实体与关联记录聚合写进 `audit_events`（用 `JSON_OBJECT` / `JSON_ARRAYAGG` 从实际数据生成，不写字面量），再执行删除。这样即使删除不可逆，也能据此还原。
