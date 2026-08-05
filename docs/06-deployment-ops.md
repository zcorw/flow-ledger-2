# 部署和运维方案

## 1. 目标环境

MVP 部署到一台 VPS，使用 Docker Compose 管理全部服务。

服务：

- frontend：React 静态资源或 Node 服务
- backend：FastAPI API
- scheduler：APScheduler 定时任务
- postgres：Postgres 数据库
- 可选容器 Caddy，或由宿主机 Nginx、Traefik 等外部工具负责反向代理和 TLS

## 2. 环境变量

必须配置：

```env
APP_ENV=production
APP_BASE_URL=https://your-domain.example
PROXY_MODE=caddy
DATABASE_URL=postgresql+psycopg://app:password@postgres:5432/asset_app
SECRET_KEY=replace-with-long-random-secret
BOOTSTRAP_TOKEN=replace-with-one-time-random-token
BASE_CURRENCY=CNY
CURRENCY_LIMIT=5
FX_SYNC_TIME=08:00
TZ=Asia/Tokyo
BACKUP_DIR=/var/backups/asset-app
```

初始管理员设置方法：

1. 首次部署时设置 `BOOTSTRAP_TOKEN`。
2. 打开应用，如果数据库中没有用户，系统显示初始化页面。
3. 输入 `BOOTSTRAP_TOKEN`、管理员邮箱、显示名和密码。
4. 系统创建管理员、默认币种、现金机构和基础配置。
5. 创建完成后 `/setup` 入口失效。
6. 初始化成功后建议从 VPS 环境变量中移除或轮换 `BOOTSTRAP_TOKEN`。

## 3. Docker Compose 结构

生产环境使用一份基础配置和一份入口叠加配置：

- `deploy/compose.production.yml`：PostgreSQL、迁移、后端、scheduler、前端和备份。
- `deploy/compose.caddy.yml`：增加容器 Caddy，并发布宿主机 80/443。
- `deploy/compose.external-proxy.yml`：不启动 Caddy，只将前端发布到 `127.0.0.1:${EXTERNAL_PROXY_PORT}`。

`deploy/compose.sh` 根据 `PROXY_MODE=caddy|external` 自动选择叠加文件，部署、验证、备份和恢复命令都必须通过该脚本执行。未配置时默认 `caddy`，保证已有部署兼容。

外部代理模式下，宿主机代理将全部请求转发到回环端口，前端容器内 Nginx 再将 `/api/*` 转发至 Docker 内部后端。PostgreSQL 和后端均不发布宿主机端口。

## 4. 数据库迁移

使用 Alembic。

常用命令：

```bash
alembic revision --autogenerate -m "create core tables"
alembic upgrade head
```

部署时策略：

- GitHub Actions 构建镜像
- 上传或拉取镜像到 VPS
- 执行 `docker compose run --rm backend alembic upgrade head`
- 重启服务

## 5. GitHub Actions 部署流程

推荐流程：

1. push 到 main。
2. CI 执行前端 lint、typecheck、test、build 和 bundle 检查。
3. CI 执行后端 lint、test、覆盖率和迁移检查。
4. CI 校验 Caddy 与外部代理两套 Compose 配置。
5. CI 成功后部署工作流通过 SSH 登录 VPS。
6. VPS 仓库快进到刚通过 CI 的准确提交。
7. `deploy.sh` 根据 VPS 上的 `PROXY_MODE` 选择入口模式。
8. 生成部署前备份、执行数据库迁移并重启服务。
9. 调用 `/api/v1/system/health` 验证。

## 6. 备份

数据库备份：

```bash
pg_dump "$DATABASE_URL" > "$BACKUP_DIR/asset-app-$(date +%F-%H%M%S).sql"
```

建议：

- 每天自动备份一次
- 至少保留最近 14 天
- 恢复前自动生成当前数据备份
- 备份文件不要提交到 Git

## 7. 日志

需要可查看：

- backend API 日志
- scheduler 汇率同步日志
- 数据库备份日志
- 导入恢复日志

健康检查包含：

- API 是否存活
- 数据库是否可连接
- 最近一次汇率同步时间和状态
- scheduler 是否在最近周期内运行

## 8. 安全

生产要求：

- 使用 HTTPS
- `SECRET_KEY` 不得使用默认值
- `BOOTSTRAP_TOKEN` 必须是随机长字符串
- 不保存完整银行卡号或券商账号
- 导出备份需要登录
- 恢复备份需要重新输入密码
- 所有导入、导出、恢复操作写审计日志
