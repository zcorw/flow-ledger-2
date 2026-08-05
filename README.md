# Flow Ledger

Flow Ledger 是一个面向个人使用的私有资产管理 Web 应用。它以月度快照为核心，集中管理机构、账户、资产项目、历史汇率和债权债务，并将不同币种统一折算为人民币，用于查看总资产、总负债、净资产及其月度变化。

本项目不是日常消费记账工具，也不连接银行或券商 API，不计算真实投资收益率。

## 主要功能

- 首页看板：按月份查看总资产、总负债、净资产、较上月变化和外币资产占比。
- 净资产趋势：支持最近 12 个月、最近 24 个月和全部历史。
- 资产层级：按“机构 → 账户 → 项目”维护资产，账户也可以先创建、后关联机构。
- 月度快照：批量录入资产余额，自动按历史汇率折算 CNY，并支持修改单条金额与日期。
- 债权债务：通过新增、还款、调整和结清事件计算指定月份的未偿本金。
- 汇率管理：定时同步启用币种的汇率，也支持导入历史汇率。
- 导入导出：集中导入或导出主数据、历史汇率、月度快照和债权债务事件。
- 账户资料：修改管理员显示名称和密码。
- 运维能力：数据库迁移、健康检查、审计日志、生产部署和定时备份。

## 首页统计口径

- 首页只统计所选自然月内的月度快照。
- 同一项目当月有多条记录时，取日期最晚的一条。
- 项目当月没有记录时，不沿用以前月份的数据。
- 只要当月存在记录，即使机构、账户或项目当前已停用，仍计入当月资产和净资产趋势。
- 债权按月末未偿本金计入总资产，债务按月末未偿本金计入总负债。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、MUI、TanStack Query、ECharts |
| 后端 | FastAPI、SQLAlchemy、Alembic、Pydantic |
| 数据库 | PostgreSQL 16 |
| 定时任务 | APScheduler |
| 部署 | Docker Compose、Nginx；生产环境使用 Caddy 提供 TLS |
| 测试 | Vitest、Pytest、Playwright |

## 快速启动

### 环境要求

- Docker Engine 或 Docker Desktop
- Docker Compose v2

### 1. 创建本地配置

PowerShell：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

打开 `.env`，至少替换以下配置中的示例值：

```env
SECRET_KEY=一段至少32位的随机字符串
BOOTSTRAP_TOKEN=用于首次初始化的随机令牌
POSTGRES_PASSWORD=本地数据库密码
```

如果修改了 `POSTGRES_PASSWORD`，请同步修改 `DATABASE_URL` 中的密码。

### 2. 初始化数据库并启动服务

```bash
docker compose up -d postgres
docker compose run --rm backend alembic upgrade head
docker compose up -d --build
```

查看服务状态：

```bash
docker compose ps
```

启动成功后可访问：

| 服务 | 地址 |
| --- | --- |
| Web 页面 | http://localhost:3000 |
| API 文档（开发环境） | http://localhost:8000/api/docs |
| 健康检查 | http://localhost:8000/api/v1/system/health |

停止服务：

```bash
docker compose down
```

上述停止命令会保留 PostgreSQL 数据卷。

## 初始化管理员账号

系统没有默认账号或默认密码。

1. 第一次打开 `http://localhost:3000` 时，系统会自动进入初始化页面。
2. 输入 `.env` 中设置的 `BOOTSTRAP_TOKEN`。
3. 设置管理员邮箱、显示名称和至少 12 位的密码。
4. 初始化完成后，`/setup` 入口自动失效，之后使用该邮箱和密码登录。

忘记密码时无法从环境变量找回原密码；已登录用户可以在账户资料中修改密码。

## 推荐的数据录入顺序

首次使用可以手动创建数据，也可以在“设置 → 导入、导出与恢复”中按以下顺序导入：

1. 机构、账户与项目
2. 历史汇率
3. 月度快照
4. 债权债务事件

建议先下载对应 CSV 模板并参考模板中的类型值。系统会先校验整份文件；存在业务冲突时会拒绝整批导入，避免写入部分脏数据。历史汇率会按“币种 + 日期 + 来源”更新同键记录。

## 本地开发

除 Docker 外，本地开发需要 Node.js 22、pnpm 10.33.1 和 Python 3.11。

安装前端依赖并启动开发服务器：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

前端开发服务器默认运行在 `http://localhost:5173`，并将 `/api` 请求代理到 `http://localhost:8000`。

安装后端开发依赖并启动 API：

```bash
cd backend
python -m venv .venv
```

激活虚拟环境：

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```bash
# macOS / Linux
source .venv/bin/activate
```

将 `DATABASE_URL` 设置为宿主机可以访问的 PostgreSQL 或 SQLite 地址，然后运行：

```bash
python -m pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload
```

Compose 默认没有将 PostgreSQL 端口暴露给宿主机，因此不能直接使用 `.env.example` 中主机名为 `postgres` 的连接地址启动宿主机后端；也可以继续让后端运行在 Docker 中，只在宿主机启动前端开发服务器。

## 测试与质量检查

前端：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm bundle:check
```

后端：

```bash
cd backend
ruff check .
pytest
```

端到端测试：

```bash
pnpm exec playwright install chromium
pnpm e2e
```

## 项目结构

```text
Flow-Ledger2/
├── backend/                 FastAPI、数据模型、迁移和后端测试
├── frontend/                React 前端应用
├── e2e/                     Playwright 端到端测试
├── deploy/                  生产 Compose、Caddy、备份和部署脚本
├── docs/                    产品、交互、数据模型、API 和运维文档
├── prototype/               静态页面与设计原型
├── scripts/                 工程检查脚本
├── docker-compose.yml       本地开发与集成环境
└── package.json             Monorepo 前端命令入口
```

## 生产部署与备份

根目录的 `docker-compose.yml` 用于本地开发和集成测试。生产环境请使用 [deploy/README.md](deploy/README.md) 中的部署方案，其中包含：

- Caddy HTTPS 反向代理
- 生产环境变量校验
- Alembic 数据库迁移
- 健康检查
- PostgreSQL 定时备份与校验
- 恢复、发布和回滚流程

## 项目文档

- [产品总文档](docs/00-master-spec.md)
- [产品需求](docs/01-prd.md)
- [交互规范](docs/02-ux-spec.md)
- [数据模型](docs/03-data-model.md)
- [API 规范](docs/04-api-spec.md)
- [实现计划](docs/05-implementation-plan.md)
- [部署与运维](docs/06-deployment-ops.md)
- [质量预算](docs/quality-budgets.md)

## 安全说明

- 不要提交 `.env`、生产密钥、数据库备份或导出的真实资产数据。
- 生产环境必须使用随机且足够长的 `SECRET_KEY`、`BOOTSTRAP_TOKEN` 和数据库密码。
- 不要在系统中保存完整银行卡号、券商账号、密钥或银行登录凭据，账户标识应使用脱敏尾号或自定义简称。
- 完成管理员初始化后，建议轮换 `BOOTSTRAP_TOKEN`。
