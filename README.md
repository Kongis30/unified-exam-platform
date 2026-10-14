# 统一考试平台

本目录是 SAT / PSAT / SHSAT 统一考试系统项目。当前已建立前后端最小骨架、类型注册 API 和新库基础主数据 DDL；账号认证、数据库迁移器接入、管理功能和旧数据迁移仍按计划逐阶段实现。

- [数据库设计](./docs/DATABASE_DESIGN.md)：统一主数据、试卷/发布/作答模型、考试类型扩展方式和旧库数据落点。
- [实现计划与功能拆分](./docs/IMPLEMENTATION_PLAN.md)：工程骨架、模块边界、首阶段任务和后续实施顺序。

## 本地运行骨架

- 后端：安装 Java 17+ 和 Maven，在 `backend/` 执行 `mvn spring-boot:run`，默认监听 `http://localhost:8080`。
- 前端：在 `frontend/` 执行 `npm install`，再执行 `npm run dev`，默认监听 `http://localhost:5175`；Vite 将 `/api` 代理到后端。
- 数据库：新库基础结构见 `database/migrations/V1__platform_core.sql`。数据库迁移器与运行时数据访问将在账号/班级阶段接入；本阶段 API 类型目录来自后端已注册模块。
