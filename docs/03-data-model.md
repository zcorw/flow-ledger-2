# 数据模型

## 1. 设计原则

Postgres 是唯一事实来源。金额字段使用 `numeric(20, 6)`，不要使用浮点数。

所有业务表都包含 `id`、`created_at`、`updated_at`。私有单用户仍保留 `user_id`，方便未来扩展多用户或导入恢复。

历史汇率必须保存，历史快照保存使用的 `fx_rate_id` 和折算金额，避免未来汇率变化导致历史报表变动。

## 2. 核心表

### users

```sql
create table users (
  id uuid primary key,
  email text unique not null,
  password_hash text not null,
  display_name text not null,
  is_admin boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

### app_settings

```sql
create table app_settings (
  id uuid primary key,
  key text unique not null,
  value jsonb not null,
  updated_at timestamptz not null
);
```

用于保存币种上限、汇率同步时间、系统初始化状态等配置。

### currencies

```sql
create table currencies (
  code text primary key,
  name text not null,
  symbol text,
  decimal_places integer not null default 2,
  is_enabled_globally boolean not null default true,
  sort_order integer not null default 0
);
```

默认插入 CNY、USD、JPY、HKD、EUR。

### user_currencies

```sql
create table user_currencies (
  user_id uuid not null references users(id),
  currency_code text not null references currencies(code),
  is_base boolean not null default false,
  created_at timestamptz not null,
  primary key (user_id, currency_code)
);
```

约束：每个用户启用币种数量不超过 `app_settings.currency_limit`，默认 5。CNY 必须启用且为基础货币。

### fx_rates

```sql
create table fx_rates (
  id uuid primary key,
  base_currency text not null default 'CNY',
  quote_currency text not null references currencies(code),
  rate_date date not null,
  rate_to_base numeric(20, 10) not null,
  source text not null,
  is_stale_fallback boolean not null default false,
  fetched_at timestamptz not null,
  unique (base_currency, quote_currency, rate_date, source)
);
```

`rate_to_base` 表示 1 quote_currency 等于多少 CNY。

### fx_sync_runs

```sql
create table fx_sync_runs (
  id uuid primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null,
  currencies jsonb not null,
  message text
);
```

## 3. 机构、账户、项目

### institutions

```sql
create table institutions (
  id uuid primary key,
  user_id uuid not null references users(id),
  name text not null,
  institution_type text not null,
  display_color text,
  is_active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, name)
);
```

机构类型初始枚举：bank、broker、cash、person、other。

### accounts

```sql
create table accounts (
  id uuid primary key,
  user_id uuid not null references users(id),
  institution_id uuid references institutions(id),
  name text not null,
  account_type text not null,
  masked_identifier text,
  display_color text,
  is_active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (institution_id, name)
);

create unique index uq_accounts_user_unassigned_name
  on accounts (user_id, name)
  where institution_id is null;
```

`institution_id` 为空表示账户尚未关联机构；关联前账户及其项目保留，但不参与月度快照。账户类型初始枚举：savings、wealth_management、brokerage、cash_wallet、loan_related、other。

### projects

```sql
create table projects (
  id uuid primary key,
  user_id uuid not null references users(id),
  account_id uuid not null references accounts(id),
  name text not null,
  asset_type text not null,
  currency_code text not null references currencies(code),
  default_liquidity_level text not null,
  default_risk_level text not null,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (account_id, name)
);
```

资产类型初始枚举：bank_deposit、cash、securities。

债权债务不进入 `projects`，由独立账本维护。

流动性初始值建议：t0、within_7d、within_30d、within_90d、locked_or_unknown。

风险初始值：low、medium、high。

## 4. 月度快照

### monthly_snapshots

```sql
create table monthly_snapshots (
  id uuid primary key,
  user_id uuid not null references users(id),
  project_id uuid not null references projects(id),
  snapshot_date date not null,
  snapshot_month text not null,
  currency_code text not null references currencies(code),
  original_amount numeric(20, 6) not null,
  fx_rate_id uuid references fx_rates(id),
  fx_rate_to_cny numeric(20, 10) not null,
  fx_is_stale boolean not null default false,
  converted_amount_cny numeric(20, 6) not null,
  liquidity_level text not null,
  risk_level text not null,
  change_note text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (project_id, snapshot_date)
);
```

`snapshot_month` 使用 `YYYY-MM` 字符串，便于分组。保存前由 `snapshot_date` 推导。

历史快照查询通过 `monthly_snapshots.project_id -> projects.account_id -> accounts.institution_id` 的当前关系实时汇总。快照表不冗余保存机构或账户归属；账户重新关联机构后，相关项目的全部历史同步归入新机构。停用状态不影响历史查询。

## 5. 债权债务

### debt_items

```sql
create table debt_items (
  id uuid primary key,
  user_id uuid not null references users(id),
  debt_type text not null,
  counterparty text not null,
  currency_code text not null references currencies(code),
  status text not null default 'active',
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

`debt_type`：receivable 或 payable。

`status`：active、partially_settled、settled、overdue、written_off。

### debt_events

```sql
create table debt_events (
  id uuid primary key,
  user_id uuid not null references users(id),
  debt_item_id uuid not null references debt_items(id),
  event_type text not null,
  event_date date not null,
  amount numeric(20, 6) not null,
  counterparty text not null,
  note text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

事件类型：

- issue：新增借款或新增应收
- repayment：还款
- adjustment：调整
- settle：结清

未偿本金计算：

- 债权：issue 和 adjustment 增加余额，repayment 和 settle 减少余额
- 债务：issue 和 adjustment 增加负债余额，repayment 和 settle 减少负债余额

实际实现应使用服务层函数计算，避免在前端推导。

## 6. 导入、备份、日志

### import_jobs

```sql
create table import_jobs (
  id uuid primary key,
  user_id uuid not null references users(id),
  import_type text not null,
  status text not null,
  file_name text,
  row_count integer not null default 0,
  error_report jsonb,
  created_at timestamptz not null,
  finished_at timestamptz
);
```

### backup_exports

```sql
create table backup_exports (
  id uuid primary key,
  user_id uuid not null references users(id),
  file_name text not null,
  checksum text,
  created_at timestamptz not null
);
```

### audit_logs

```sql
create table audit_logs (
  id uuid primary key,
  user_id uuid references users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null
);
```

## 7. 索引建议

```sql
create index idx_snapshots_user_month on monthly_snapshots(user_id, snapshot_month);
create index idx_snapshots_project_date on monthly_snapshots(project_id, snapshot_date);
create index idx_fx_rates_currency_date on fx_rates(quote_currency, rate_date);
create index idx_debt_events_item_date on debt_events(debt_item_id, event_date);
create index idx_audit_logs_user_created on audit_logs(user_id, created_at desc);
```
