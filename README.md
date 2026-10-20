# Unified Exam Platform

SAT and PSAT are managed inside one SAT system workspace; SHSAT has its own workspace. All systems share accounts and classes while keeping their paper and exam rules separate.

- [数据库设计](./docs/DATABASE_DESIGN.md)：统一身份、试卷/发布/作答模型和类型扩展方式。
- [实现计划与功能拆分](./docs/IMPLEMENTATION_PLAN.md)：模块边界和分阶段交付顺序。
- [学生端目标与设计](./SYSTEM_DESIGN.md)：统一入口、SAT/SHSAT 页面与考试规则的目标。
- [学生端实施阶段](./DEVELOPMENT_STAGES.md)：按依赖顺序完成入口、考试、评分与验收。

## Local setup

Requires Java 17+, Maven, Node.js, npm, and MySQL 8.

1. Create an empty database:

   ```sql
   CREATE DATABASE unified_exam_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   ```

2. In `backend/`, set `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD`, then run `mvn spring-boot:run`. Flyway applies the versioned migrations in `backend/src/main/resources/db/migration/` automatically.
3. On the first start with an empty database, set `PLATFORM_BOOTSTRAP_ADMIN_USERNAME` and `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD` (at least 6 characters). No default credentials are provided. The bootstrap account is not recreated once the database contains users.
4. In `frontend/`, run `npm install` and `npm run dev`, then open `http://localhost:5175`. Vite proxies `/api` requests to the backend.

For HTTPS deployments, set `SESSION_COOKIE_SECURE=true`. The browser uses a same-site session and CSRF token. User-facing prompts and errors are in English.

## Current implementation

- Available: platform and exam-type registry, MySQL/Flyway schema, shared login, role-based access, account and class management, paper drafts and versions, exam release/eligibility, and the initial SHSAT attempt flow for choice questions.
- In progress: full SHSAT question-type support, type-specific paper validation, detailed scoring reports, then SAT/PSAT exam flows.
- Planned: complete SHSAT first, then SAT/PSAT, followed by legacy data migration.
