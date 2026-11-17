# 知产 (Zhichan)

**English** | [简体中文](README.zh-CN.md)

Zhichan (知产, formerly Flow Ledger) is a private, personal asset-management web application. Built around monthly snapshots, it brings institutions, accounts, asset items, historical exchange rates, receivables, and liabilities into one place. Balances in different currencies are converted to CNY, making it easy to track total assets, total liabilities, net worth, and month-over-month changes.

The project centers on monthly asset snapshots and also supports independent daily expense records. It does not connect to banking or brokerage APIs, nor does it calculate actual investment returns.

> [!NOTE]
> flow-ledger-2 is the second-generation, full-stack rewrite of
> FlowLedger. It replaces the original split-repository implementation:
>
> - [FlowLedger-ui](https://github.com/zcorw/FlowLedger-ui) — v1 frontend
> - [FlowLedger-server](https://github.com/zcorw/FlowLedger-server) — v1 backend

## Features

- Dashboard: view total assets, total liabilities, net worth, changes from the previous month, and the share of assets held in foreign currencies.
- Net-worth trends: review the most recent 12 months, 24 months, or the complete history.
- Asset hierarchy: manage assets as “institution → account → item”; accounts can also be created before they are linked to an institution.
- Monthly snapshots: enter asset balances in bulk, automatically convert them to CNY using historical exchange rates, and edit individual amounts and dates.
- Receivables and liabilities: calculate outstanding principal for a selected month using creation, repayment, adjustment, and settlement events.
- Exchange-rate management: periodically synchronize rates for enabled currencies or import historical exchange rates.
- Import and export: centrally import or export master data, historical exchange rates, monthly snapshots, and receivable/liability events.
- Account profile: update the administrator display name and password.
- Operations: database migrations, health checks, audit logs, production deployment, and scheduled backups.

## Receipt Photo Recognition

Daily expenses support manual entry and image-assisted filling. The backend calls the OpenAI Responses API, with the default low-cost model `gpt-6-luna`. Review amount, date, currency and merchant before saving. Daily expenses do not affect monthly asset statistics.

Set `OPENAI_API_KEY` only in the backend environment file; use `RECEIPT_MODEL` to change models. Never prefix the key with `VITE_` or expose it in the frontend. Manual entry remains available without a key. Photos are sent to OpenAI and may incur charges; the application does not save photos or raw recognition text. See [receipt configuration, cost controls and privacy](docs/10-openai-receipts.md).

### OpenAI Configuration

Configure the root `.env` for local development or `deploy/.env.production` for production. Create a project API key in the OpenAI console and replace the placeholder:

```dotenv
OPENAI_API_KEY=your-server-project-key
RECEIPT_MODEL=gpt-6-luna
RECEIPT_TIMEOUT_SECONDS=45
RECEIPT_REQUESTS_PER_MINUTE=6
```

For an existing local Docker deployment, run `docker compose up -d --build --no-deps --force-recreate backend` at the project root, then sign in and refresh Daily Expenses. Restart the backend process when running Python directly. Production commands and troubleshooting are documented in [OpenAI configuration](docs/10-openai-receipts.md#模型与配置).

## Rokid Device Authorization

Sign in on the phone and open **Settings → Device authorization**, enter the glasses code and explicitly approve receipt recognition. The direct `/receipt-devices` URL remains available for glasses pairing links. Pairing lasts 10 minutes; the receipt-only grant remains valid until revoked or the account password changes. The glasses remember it across Agent exit and device restart; clearing Agent data requires authorization again. The grant cannot create expenses or modify assets; it can be revoked from the same page. Deploy both frontend/backend, run migration `0012_persistent_devices` and use the canonical HTTPS `APP_BASE_URL` before updating the glasses. See [device protocol and deployment](docs/receipt-devices.md).

## Dashboard Calculation Rules

- The dashboard only includes monthly snapshots recorded within the selected calendar month.
- If an item has multiple records in the same month, the latest record by date is used.
- If an item has no record for the selected month, data from earlier months is not carried forward.
- Any record in the selected month is included in assets and net-worth trends, even if its institution, account, or item is currently disabled.
- Receivables count toward total assets at their month-end outstanding principal; liabilities count toward total liabilities on the same basis.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, MUI, TanStack Query, ECharts |
| Backend | FastAPI, SQLAlchemy, Alembic, Pydantic |
| Database | PostgreSQL 16 |
| Scheduled jobs | APScheduler |
| Deployment | Docker Compose, Nginx; production ingress via optional containerized Caddy or a host-level reverse proxy |
| Testing | Vitest, Pytest, Playwright |

## Quick Start

### Prerequisites

- Docker Engine or Docker Desktop
- Docker Compose v2

### 1. Create a local configuration

PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS / Linux:

```bash
cp .env.example .env
```

Open `.env` and replace at least the following example values:

```env
SECRET_KEY=a-random-string-at-least-32-characters-long
BOOTSTRAP_TOKEN=a-random-token-used-for-first-time-setup
POSTGRES_PASSWORD=your-local-database-password
```

If you change `POSTGRES_PASSWORD`, update the password in `DATABASE_URL` as well.

### 2. Initialize the database and start the services

```bash
docker compose up -d postgres
docker compose run --rm backend alembic upgrade head
docker compose up -d --build
```

Check the service status:

```bash
docker compose ps
```

Once the services are running, open:

| Service | URL |
| --- | --- |
| Web application | http://localhost:3000 |
| API documentation (development only) | http://localhost:8000/api/docs |
| Health check | http://localhost:8000/api/v1/system/health |

Stop the services with:

```bash
docker compose down
```

This command preserves the PostgreSQL data volume.

## Initialize the Administrator Account

The system has no default account or password.

1. Open `http://localhost:3000` for the first time. The application automatically redirects to the setup page.
2. Enter the `BOOTSTRAP_TOKEN` configured in `.env`.
3. Set the administrator email address, display name, and a password of at least 12 characters.
4. After initialization, the `/setup` route is automatically disabled. Use the configured email address and password for subsequent sign-ins.

A forgotten password cannot be recovered from environment variables. A signed-in user can change the password from the account profile.

## Recommended Data-Entry Order

When using the application for the first time, you can create data manually or import it from “Settings → Import, Export & Recovery” in this order:

1. Institutions, accounts, and items
2. Historical exchange rates
3. Monthly snapshots
4. Receivable and liability events

Download the relevant CSV templates first and refer to their supported type values. The system validates the entire file before writing any data; if it finds a business conflict, the complete batch is rejected to prevent partial or inconsistent imports. Historical exchange rates update matching records by “currency + date + source.”

## Local Development

In addition to Docker, local development requires Node.js 22, pnpm 10.33.1, and Python 3.11.

Install the frontend dependencies and start the development server:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The frontend development server runs at `http://localhost:5173` by default and proxies `/api` requests to `http://localhost:8000`.

Install the backend development dependencies and start the API:

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```bash
# macOS / Linux
source .venv/bin/activate
```

Set `DATABASE_URL` to a PostgreSQL or SQLite address that is accessible from the host, then run:

```bash
python -m pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload
```

By default, Compose does not expose the PostgreSQL port to the host. Therefore, the connection string from `.env.example`, whose hostname is `postgres`, cannot be used directly by a backend running on the host. Alternatively, keep the backend in Docker and run only the frontend development server on the host.

## Testing and Quality Checks

Frontend:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm bundle:check
```

Backend:

```bash
cd backend
ruff check .
pytest
```

End-to-end tests:

```bash
pnpm exec playwright install chromium
pnpm e2e
```

## Project Structure

```text
Flow-Ledger2/
├── backend/                 FastAPI, data models, migrations, and backend tests
├── frontend/                React frontend application
├── e2e/                     Playwright end-to-end tests
├── deploy/                  Production Compose, optional proxy, backup, and deployment scripts
├── docs/                    Product, UX, data model, API, and operations documentation
├── prototype/               Static pages and design prototypes
├── scripts/                 Engineering checks
├── docker-compose.yml       Local development and integration environment
└── package.json             Monorepo frontend command entry point
```

## Production Deployment and Backups

The root-level `docker-compose.yml` is intended for local development and integration testing. For production, follow [deploy/README.md](deploy/README.md). Operators can set `PROXY_MODE=caddy` to start a containerized Caddy instance automatically, or set `PROXY_MODE=external` to place the application behind an existing host-level Nginx, Traefik, or other reverse proxy.

GitHub Actions deploys a main commit after CI and both SHA-tagged images succeed. A manual production run must select `main`; it waits up to 20 minutes for that exact commit's CI and image publication before connecting to the VPS. Failed CI or missing/skipped image jobs stop deployment before any server changes.

- Optional Caddy or external reverse-proxy ingress
- Production environment-variable validation
- Alembic database migrations
- Health checks
- Scheduled PostgreSQL backups and verification
- Restore, release, and rollback procedures

## Project Documentation

- [Master specification](docs/00-master-spec.md)
- [Product requirements](docs/01-prd.md)
- [UX specification](docs/02-ux-spec.md)
- [Data model](docs/03-data-model.md)
- [API specification](docs/04-api-spec.md)
- [Implementation plan](docs/05-implementation-plan.md)
- [Deployment and operations](docs/06-deployment-ops.md)
- [OpenAI receipt recognition and configuration](docs/10-openai-receipts.md)
- [Quality budgets](docs/quality-budgets.md)

## Security Notes

- Do not commit `.env`, production secrets, database backups, or exports containing real asset data.
- Production environments must use random, sufficiently long values for `SECRET_KEY`, `BOOTSTRAP_TOKEN`, and the database password.
- Do not store full bank-card numbers, brokerage account numbers, secret keys, or online-banking credentials. Use masked suffixes or custom aliases for account identifiers.
- Rotate `BOOTSTRAP_TOKEN` after the administrator account has been initialized.
