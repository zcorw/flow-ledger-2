# Project Summary

Flow Ledger 是一个面向个人私有使用的资金资产管理 Web 应用。MVP 以手工维护“机构 → 账户 → 项目 → 月度快照”为主流程，通过快照日历史汇率统一折算为 CNY，并结合独立的债权债务事件账本生成资产看板。产品采用 Desktop Web 优先的财务后台形态，不追踪消费流水、不连接银行或券商 API，也不计算真实投资收益。

本轮先交付 `prototype/` 下的静态页面原型，用于确认整体视觉语言、信息架构和页面元素；正式 React/FastAPI 开发在原型确认后按里程碑推进。

## Source Documents Reviewed

- `docs/00-master-spec.md`：产品边界、关键业务决策、主导航和首页范围。
- `docs/01-prd.md`：用户角色、核心实体、功能范围与 MVP 验收标准。
- `docs/02-ux-spec.md`：桌面布局、五个主页面、表格字段、交互及错误状态。
- `docs/03-data-model.md`：Postgres 表结构、金额/汇率精度、债权债务事件和索引。
- `docs/04-api-spec.md`：认证、看板、币种汇率、快照、债权债务和备份 API 契约。
- `docs/05-implementation-plan.md`：工程到部署的九阶段开发顺序。
- `docs/06-deployment-ops.md`：Docker Compose、环境变量、迁移、备份、日志和安全要求。
- `docs/07-vibe-coding-prompts.md`：后续按单里程碑推进的开发约束。

## Key Requirements

### Product workflows

- 私有管理员完成首次初始化和登录后使用系统，不开放注册。
- 维护机构、账户和项目；现金通过内置“现金”机构下的现金钱包显式维护。
- 选择快照日期，批量录入所有启用项目的原币金额并折算为 CNY。
- 通过事件维护债权与债务，按指定日期计算未偿本金并纳入净资产。
- 查看总资产、总负债、净资产、月度变化及资产、流动性、风险、币种和机构分布。

### Data model

- Postgres 为唯一事实来源，金额使用 `numeric(20, 6)`，汇率使用高精度 decimal。
- 历史快照固化使用的汇率、折算金额和 stale 状态。
- 债权债务与普通资产项目分账维护；债权计入正资产，债务计入总负债。

### Backend/API

- FastAPI + SQLAlchemy + Alembic，API 前缀为 `/api/v1`。
- 使用 HTTP-only session cookie，统一错误与分页响应。
- 汇率任务每天 08:00 由独立 APScheduler 服务执行。
- 导入必须先校验，有冲突时整批拒绝；恢复前重认证并自动备份当前数据。

### Frontend/UI

- React + MUI，Desktop 优先；左侧主导航、顶部标题栏和中密度主内容区。
- 首页为紧凑 KPI + 图表；月度快照使用 Data Grid 式批量录入。
- 金额右对齐并使用千分位，折算金额明确标识 CNY，外币展示汇率和 stale 状态。
- 破坏性操作使用确认对话框；金额异常变化提示备注但不阻止保存。

### Testing, quality, deployment

- 前端执行 lint、typecheck、test、build；后端执行 lint、test 和迁移验证。
- Docker Compose 运行 frontend、backend、scheduler、postgres 和反向代理。
- 健康检查覆盖 API、数据库、scheduler 和最近汇率同步；生产使用 HTTPS 和每日备份。

## Questions / Assumptions

- 原型使用项目名 “Flow Ledger”，正式产品中文名尚未在文档中确定，可在视觉确认时修改。
- 原型数据均为演示数据，不代表最终种子数据或接口固定返回值。
- UX 仅明确 Desktop 优先；原型补充窄屏降级布局，但正式 MVP 不以移动端适配为验收重点。
- 汇率数据源、密码强度规则、session 存储方式和 CI 托管平台需要在对应正式里程碑开始前确认。
- `asset_type` 当前只列出银行存款、现金和证券；债权由独立账本补充。若未来需要贵金属、房产等类别，应另行扩展枚举和看板口径。

## Development TodoList

- [x] T000 [P0] 确认静态产品原型
  Goal: 用户可在浏览器中检查五个主页面、认证页面和关键交互状态，并确认视觉方向。
  Notes: 使用纯 HTML/CSS/JS；覆盖首页看板、月度快照、机构与账户、债权债务、设置、登录与首次初始化预览。
  Likely files/modules: `prototype/index.html`, `prototype/styles.css`, `prototype/app.js`。
  Depends on: None。
  Verify: 本地静态服务器打开页面；逐项检查主导航、弹窗、抽屉、编辑状态和窄屏布局。

- [x] T001 [P0] 建立 monorepo 与本地运行骨架
  Goal: React 前端、FastAPI 后端、Postgres 和 scheduler 可独立构建并由 Docker Compose 联合启动。
  Notes: 配置 TypeScript、MUI、TanStack Query、React Hook Form、Zod、ECharts、SQLAlchemy、Alembic、测试与 lint。
  Likely files/modules: `frontend/`, `backend/`, `deploy/`, `docker-compose.yml`, CI workflow。
  Depends on: T000。
  Verify: `docker compose up` 后前端可访问，`GET /api/v1/system/health` 正常，首个 Alembic 迁移可执行。

- [x] T002 [P0] 实现首次初始化与认证
  Goal: 无用户系统只能初始化管理员，初始化完成后仅可登录访问业务页面。
  Notes: 校验一次性 `BOOTSTRAP_TOKEN`，哈希密码，初始化默认币种、现金机构和应用配置，采用 HTTP-only cookie。
  Likely files/modules: frontend auth/setup routes；backend users/auth/setup models, schemas, services, routes, migration。
  Depends on: T001。
  Verify: 覆盖首次初始化、入口失效、登录/退出、未认证拦截和修改密码测试。

- [x] T003 [P0] 实现币种配置与历史汇率
  Goal: 管理员可启用最多五个币种，系统每天同步汇率并为历史快照提供确定的折算依据。
  Notes: CNY 必须启用且为基础币；实现精确 decimal 计算、历史查询、手动同步和最近历史汇率 fallback/stale 标记。
  Likely files/modules: currency/fx models and APIs；scheduler service；settings currency/fx UI。
  Depends on: T002。
  Verify: 测试币种上限、CNY 约束、同步历史写入、指定日期命中及 stale fallback。

- [x] T004 [P0] 实现机构、账户与项目管理
  Goal: 用户可建立完整资产层级并维护现金钱包，停用项目保留历史但退出新月份必填范围。
  Notes: 仅保存账户脱敏标识；项目在账户上下文内维护，不增加一级项目导航。
  Likely files/modules: institution/account/project models, APIs and frontend feature pages。
  Depends on: T002, T003。
  Verify: CRUD、唯一约束、现金钱包、停用项目及历史可见性测试通过。

- [x] T005 [P0] 实现月度快照批量录入
  Goal: 用户可选择日期、复制上月清单、编辑并批量保存项目余额，系统正确折算 CNY。
  Notes: 持久化快照时使用的汇率与折算值；变化超过 20,000 CNY 或 20% 时提示备注；历史编辑写审计日志。
  Likely files/modules: monthly snapshot model/service/API；Data Grid page；validation schemas。
  Depends on: T003, T004。
  Verify: 批量校验、唯一性、缺失提醒、stale、无可用汇率阻断、异常变化提示和审计测试通过。

- [ ] T006 [P1] 实现债权债务事件账本
  Goal: 债权与债务按新增、还款、调整和结清事件计算任意日期未偿本金。
  Notes: 余额由后端服务计算；禁止非法负数，调整产生负数时需要显式确认；事件后立即刷新汇总。
  Likely files/modules: debt item/event models, balance service, APIs, list and timeline UI。
  Depends on: T003。
  Verify: 不同事件序列、日期截点、币种折算、非法余额和状态流转测试通过。

- [ ] T007 [P1] 实现首页看板与统计口径
  Goal: 首页按选定快照日展示 KPI、趋势、各类分布、Top 5 机构和项目金额变化。
  Notes: 总资产只含正资产和债权；币种占比只含正资产；Top 5 不受债务影响；禁止使用“收益”命名。
  Likely files/modules: dashboard aggregation service/APIs；KPI, ECharts and ranking components。
  Depends on: T005, T006。
  Verify: 使用固定数据集校验所有口径和图表汇总，并做空态与 stale 警告检查。

- [ ] T008 [P1] 实现导入、导出、备份与恢复
  Goal: 三类模板可下载、全量校验和提交，完整备份可安全导出和恢复。
  Notes: 冲突整批拒绝并返回行号/字段/原因；恢复前重认证、自动预备份并全量替换；写审计日志。
  Likely files/modules: import jobs, backup exports, validators, APIs and settings UI。
  Depends on: T004, T005, T006。
  Verify: 正常导入、字段错误、冲突回滚、错误报告、错误密码、预备份与恢复一致性测试通过。

- [ ] T009 [P1] 完成端到端质量与安全校验
  Goal: 关键业务链路有自动化覆盖，金额计算、权限、日志和破坏性操作满足文档约束。
  Notes: 增加前后端单元/集成测试和核心 E2E；检查敏感字段、cookie、审计和导出权限。
  Likely files/modules: frontend/backend test suites, E2E config, CI workflow。
  Depends on: T002-T008。
  Verify: CI 中 lint、typecheck、test、build、migration 和 E2E 全部通过。

- [ ] T010 [P1] 完成生产部署与运维
  Goal: main 分支可部署到单台 VPS，支持 TLS、迁移、健康检查、日志和可恢复备份。
  Notes: Docker Compose 包含 frontend/backend/scheduler/postgres/proxy；密钥只来自环境变量；备份至少保留 14 天。
  Likely files/modules: production compose, Dockerfiles, reverse proxy, CI/CD workflow, backup scripts, runbook。
  Depends on: T009。
  Verify: staging/VPS 部署演练、迁移、健康检查、汇率调度、备份与恢复演练全部成功。

- [ ] T011 [P2] 可用性与性能打磨
  Goal: 大量项目和多年快照下仍保持可操作性，并完善键盘、焦点、颜色和可读性体验。
  Notes: 优化 Data Grid、查询缓存与图表重绘；补充无障碍标签、键盘导航和 reduced-motion。
  Likely files/modules: shared UI/theme, data grids, chart components, API query/index tuning。
  Depends on: T009。
  Verify: 使用目标规模数据做性能基准、可访问性扫描和手动键盘测试。

## Acceptance Criteria

- 静态原型获确认，五个主页面的信息架构、组件样式和关键交互状态可作为正式前端基线。
- 首次初始化、登录与业务路由保护符合单用户私有系统边界。
- 机构、账户、项目、现金钱包和停用历史行为完整可用。
- 月度快照可以批量录入并以历史汇率稳定折算，stale 与无汇率状态行为正确。
- 债权债务余额由事件可靠推导，并正确进入指定日期总资产/总负债。
- 看板指标与图表口径符合主规约，Top 5 和币种占比只基于正资产。
- 三类导入满足先校验、冲突整批回滚，备份恢复满足重认证与预备份。
- CI、Docker Compose、迁移、健康检查、日志、定时任务和每日备份达到可部署状态。

## Suggested Execution Order

1. 原型确认：T000。
2. Foundation：T001-T003。
3. Core data and primary workflows：T004-T007。
4. Data portability and recovery：T008。
5. Tests, security and validation：T009。
6. Deployment and polish：T010-T011。
