# Vibe Coding 引导提示词

## 1. 使用方式

后续开发时，每次只把一个里程碑和相关文档交给 coding agent。不要一次性要求生成全量应用。

推荐顺序：

1. 工程骨架
2. 初始化和认证
3. 币种和汇率
4. 机构、账户、项目
5. 月度快照
6. 债权债务
7. 首页看板
8. 导入导出和恢复
9. 部署运维

## 2. 通用约束提示词

```text
你正在实现一个个人资金资产管理 Web 应用。请严格遵守 docs 中的产品范围和非目标。

技术栈：
- React + MUI
- TanStack Query
- React Hook Form + Zod
- Apache ECharts
- FastAPI + SQLAlchemy + Alembic
- Postgres
- Docker Compose

MVP 不做移动 App、不对接银行/券商 API、不做真实投资收益率、不做消费记账流水、不开放多用户注册。

请先阅读 docs/00-master-spec.md，然后阅读本任务相关的拆分文档。实现前先检查现有代码结构，沿用已有模式。完成后运行可用的测试、lint 或构建命令。
```

## 3. 工程骨架提示词

```text
请根据 docs/05-implementation-plan.md 的里程碑 0 创建工程骨架。

要求：
- frontend 使用 React + MUI
- backend 使用 FastAPI + SQLAlchemy + Alembic
- Postgres 通过 Docker Compose 启动
- 提供 /api/v1/system/health
- 不实现业务功能，只搭好可运行架构

验收：
- docker compose up 后前端和后端都能访问
- 后端能连接数据库
- Alembic 能执行空迁移或首个基础迁移
```

## 4. 初始化和认证提示词

```text
请实现首次管理员初始化和登录认证。

参考：
- docs/01-prd.md 的认证和初始化
- docs/04-api-spec.md 的 /setup/bootstrap 和 /auth/*
- docs/06-deployment-ops.md 的初始管理员设置方法

关键要求：
- 无用户时显示初始化页
- 初始化需要 BOOTSTRAP_TOKEN
- 创建管理员后初始化入口失效
- 未登录不能访问业务页面
- 密码必须哈希存储
```

## 5. 币种和汇率提示词

```text
请实现币种设置和汇率同步。

参考：
- docs/03-data-model.md 的 currencies、user_currencies、fx_rates、fx_sync_runs
- docs/04-api-spec.md 的 currency 和 fx API

关键要求：
- 默认币种 CNY、USD、JPY、HKD、EUR
- CNY 是基础货币
- 用户最多启用 5 个币种
- APScheduler 每天 08:00 同步
- 快照日期汇率缺失时使用之前最近可用汇率，并标记 stale
```

## 6. 机构、账户、项目提示词

```text
请实现机构、账户、项目管理。

参考：
- docs/01-prd.md 的机构与账户
- docs/02-ux-spec.md 的机构与账户页
- docs/03-data-model.md 的 institutions、accounts、projects
- docs/04-api-spec.md 的 institutions/accounts/projects API

关键要求：
- 项目在机构与账户页内维护，不做一级项目导航
- 现金使用显式现金钱包
- 不保存完整银行卡号，只保存脱敏标识
- 停用项目保留历史但不出现在新月份必填列表
```

## 7. 月度快照提示词

```text
请实现月度快照表格式录入。

参考：
- docs/02-ux-spec.md 的月度快照页
- docs/03-data-model.md 的 monthly_snapshots
- docs/04-api-spec.md 的 snapshots API

关键要求：
- 使用 MUI X Data Grid
- 用户每次自选快照日期
- 可复制上月项目清单
- 外币金额按历史汇率折算 CNY
- 变化超过 20000 CNY 或 20% 时提示填写备注，但不强制
- 历史月份可编辑，但必须写操作日志
```

## 8. 债权债务提示词

```text
请实现独立债权债务账本。

参考：
- docs/01-prd.md 的债权债务
- docs/03-data-model.md 的 debt_items、debt_events
- docs/04-api-spec.md 的 debts API

关键要求：
- 债权债务不作为普通项目
- 事件类型包含新增、还款、调整、结清
- 按事件计算某日期未偿本金
- 债权计入总资产，债务计入总负债
```

## 9. 首页看板提示词

```text
请实现首页看板。

参考：
- docs/01-prd.md 的首页看板
- docs/02-ux-spec.md 的首页看板
- docs/04-api-spec.md 的 dashboard API

关键要求：
- 顶部 KPI + 下方图表
- 总资产只统计正资产
- 总负债统计债务未偿本金
- 净资产 = 总资产 - 总负债
- Top 5 机构按正资产金额
- 币种占比只看正资产
- 金额变化不能命名为收益
```

## 10. 导入导出和恢复提示词

```text
请实现导入导出和完整备份恢复。

参考：
- docs/01-prd.md 的导入导出和备份
- docs/04-api-spec.md 的 imports/backups API

关键要求：
- 四个模板：机构/账户/项目、历史汇率、月度快照、债权债务事件
- 导入先校验再提交
- 业务数据有冲突整批拒绝，不部分写入；历史汇率按币种、日期、来源更新
- 恢复前必须重新输入密码
- 恢复前自动备份当前数据
- 恢复是全量替换
```
