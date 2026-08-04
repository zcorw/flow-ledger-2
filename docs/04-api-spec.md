# API 规格

## 1. 通用规则

API 前缀：`/api/v1`

认证：登录后使用 HTTP-only session cookie 或 Bearer token。MVP 推荐 HTTP-only cookie，降低前端存储 token 风险。

错误响应格式：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "字段校验失败",
    "details": []
  }
}
```

分页响应格式：

```json
{
  "items": [],
  "page": 1,
  "pageSize": 50,
  "total": 0
}
```

## 2. 初始化和认证

### POST /setup/bootstrap

仅当系统没有用户时可用。

请求：

```json
{
  "bootstrapToken": "from-env",
  "email": "admin@example.com",
  "displayName": "Admin",
  "password": "strong-password"
}
```

行为：

- 校验 `BOOTSTRAP_TOKEN`
- 创建管理员用户
- 初始化默认币种
- 创建默认现金机构
- 初始化应用设置
- 初始化后该接口失效

### POST /auth/login

```json
{
  "email": "admin@example.com",
  "password": "password"
}
```

### POST /auth/logout

退出登录。

### GET /auth/me

返回当前用户信息。

### PATCH /auth/profile

修改当前管理员的显示名称。显示名称会去除首尾空格，不能为空，最长 100 个字符；成功后写入审计日志。

### POST /auth/change-password

校验当前密码后修改密码。成功后撤销其他登录会话，重新签发当前会话，并写入审计日志。

## 3. 首页看板

### GET /dashboard/summary?snapshotDate=2026-07-31

返回：

```json
{
  "snapshotDate": "2026-07-31",
  "totalAssetsCny": "1000000.00",
  "totalLiabilitiesCny": "200000.00",
  "netWorthCny": "800000.00",
  "netWorthChangeFromPreviousMonthCny": "30000.00",
  "foreignAssetRatio": "0.35",
  "fxWarnings": []
}
```

### GET /dashboard/charts?snapshotDate=2026-07-31

返回净资产趋势、资产组成、流动性、风险、币种、Top 5 机构和金额变化数据。

## 4. 币种和汇率

### GET /currencies

返回全局币种和用户启用状态。

### PUT /currencies/enabled

请求：

```json
{
  "enabledCurrencyCodes": ["CNY", "USD", "JPY", "HKD", "EUR"]
}
```

规则：

- CNY 必须启用
- 启用数量不能超过配置上限

### GET /fx-rates/latest

返回用户启用币种的最新汇率。

### GET /fx-rates/history?currency=USD&from=2026-01-01&to=2026-07-31

返回历史汇率。

### POST /fx-rates/sync

手动触发同步。仅管理员可用。

## 5. 机构、账户、项目

### GET /institutions

返回机构列表及汇总金额。

### POST /institutions

创建机构。

### PUT /institutions/{id}

更新机构。

### DELETE /institutions/{id}

仅在机构下没有账户时删除机构，否则返回 `409 INSTITUTION_HAS_ACCOUNTS`。

### GET /institutions/{id}/accounts

返回机构下账户。

### GET /accounts/unassigned

返回当前用户尚未关联机构的账户。

### POST /accounts

创建账户。`institutionId` 可为 `null` 或省略，表示稍后关联机构。

### PUT /accounts/{id}

更新账户。传入机构 ID 可完成关联，传入 `null` 可解除关联。

### DELETE /accounts/{id}

仅在账户下没有项目时删除账户，否则返回 `409 ACCOUNT_HAS_PROJECTS`。

### GET /accounts/{id}/projects

返回账户下项目。

### POST /projects

创建项目。

请求：

```json
{
  "accountId": "uuid",
  "name": "季季宝",
  "assetType": "bank_deposit",
  "currencyCode": "CNY",
  "defaultLiquidityLevel": "within_30d",
  "defaultRiskLevel": "low",
  "notes": ""
}
```

### PUT /projects/{id}

更新项目。

### POST /projects/{id}/deactivate

停用项目。

### DELETE /projects/{id}

仅在项目没有任何月度快照记录时删除项目，否则返回 `409 PROJECT_HAS_SNAPSHOTS`。已有快照的项目应改为停用。

## 6. 月度快照

### GET /snapshots?date=2026-07-31

返回该日期所有可见项目快照和缺失项。机构或账户停用时，其下项目不返回；已有快照数据仍保留，重新启用上级后恢复返回。

### POST /snapshots/copy-from-previous

请求：

```json
{
  "targetDate": "2026-07-31"
}
```

根据上一个有数据月份复制项目清单和金额，生成待编辑草稿。

### PUT /snapshots/bulk

批量保存。

请求：

```json
{
  "snapshotDate": "2026-07-31",
  "rows": [
    {
      "projectId": "uuid",
      "originalAmount": "10000.00",
      "liquidityLevel": "t0",
      "riskLevel": "low",
      "changeNote": ""
    }
  ]
}
```

响应包含汇率使用结果和保存后的折算金额。

### GET /snapshots/history

参数：

- `level`：`institution`、`account` 或 `project`
- `entityId`：对应层级 ID
- `dateFrom`：可选开始日期
- `dateTo`：可选结束日期

返回当前关联关系下的概览、趋势、最新一期下级构成和逐条快照明细。接口不按启用状态过滤；账户重新关联后，全部历史实时归入新机构。

## 7. 债权债务

### GET /debts?type=receivable

返回债权或债务列表。

### POST /debts

创建债权债务项目。

```json
{
  "debtType": "receivable",
  "counterparty": "朋友 A",
  "currencyCode": "CNY",
  "notes": ""
}
```

### GET /debts/{id}/events

返回事件时间线。

### POST /debts/{id}/events

添加事件。

```json
{
  "eventType": "issue",
  "eventDate": "2026-07-01",
  "amount": "50000.00",
  "counterparty": "朋友 A",
  "note": "新增借出款"
}
```

### GET /debts/balances?snapshotDate=2026-07-31

返回某日期的债权债务未偿本金汇总。

## 8. 导入导出和备份

### GET /imports/templates/{type}

`type` 可为：

- institution_account_project
- monthly_snapshot
- debt_event

下载的 CSV 模板在示例数据后提供以 `#` 开头的可选值参考行，列出各类型、流动性和风险字段允许填写的系统值及中文含义。参考行在校验和导入时自动忽略，可以保留在文件中。

### POST /imports/{type}/validate

上传文件并校验，不写入数据库。

### POST /imports/{type}/commit

提交已校验通过的导入。冲突时整批拒绝。

### POST /exports/master-data

导出机构、账户和项目主数据，返回 ZIP 文件：

- `institutions.csv`：机构基础资料、状态和显示颜色
- `accounts.csv`：账户资料、当前所属机构 ID/名称；待关联账户的机构字段为空
- `projects.csv`：项目资料、当前所属账户及机构 ID/名称

三个 CSV 均使用带 BOM 的 UTF-8 编码，包含停用数据。导出操作写入审计日志。

### POST /backups/export

导出完整备份。

### POST /backups/restore

请求：

```json
{
  "password": "current-password",
  "backupFileId": "uploaded-file-id"
}
```

行为：

- 重新校验密码
- 自动导出当前数据作为预恢复备份
- 清空当前业务数据
- 导入备份数据
- 写操作日志

## 9. 日志

### GET /audit-logs

返回操作日志。

### GET /system/health

返回 API、数据库、调度器、最近汇率同步状态。
