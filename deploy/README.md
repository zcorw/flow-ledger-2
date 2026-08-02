# Flow Ledger 生产部署与运维

根目录 `docker-compose.yml` 仅用于开发和集成测试。生产环境使用
`deploy/compose.production.yml`，由 Caddy 暴露 80/443，PostgreSQL、API、scheduler
和前端均不直接暴露宿主机端口。

## 1. VPS 准备

建议环境：2 核 CPU、4 GB 内存、Ubuntu LTS、Docker Engine 与 Compose v2；域名的
A/AAAA 记录需指向 VPS，并放行 TCP 80/443 与 UDP 443。

```bash
git clone <repository-url> flow-ledger
cd flow-ledger
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

生成密钥并写入 `.env.production`，不要复制示例占位值：

```bash
openssl rand -hex 32   # SECRET_KEY
openssl rand -hex 32   # BOOTSTRAP_TOKEN
openssl rand -base64 32 # POSTGRES_PASSWORD
```

`DATABASE_URL` 中的数据库密码必须进行 URL 编码，并与 `POSTGRES_PASSWORD` 对应。
生产配置会在进程启动时拒绝默认、占位、短密钥。检查最终配置：

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yml config --quiet
```

## 2. 首次部署与管理员初始化

```bash
sh deploy/deploy.sh
```

脚本按以下顺序执行：校验配置、构建镜像、启动 PostgreSQL、生成部署前备份、运行
Alembic、启动所有服务、等待健康检查、通过公网健康 URL 验证结果。

首次访问域名会进入 `/setup`。填写 `.env.production` 中的 `BOOTSTRAP_TOKEN`、管理员
邮箱、显示名和至少 12 位密码。初始化成功后入口永久失效；随后应轮换
`BOOTSTRAP_TOKEN` 并再次执行部署脚本。管理员密码只保存 Argon2 哈希，不能从环境变量
自动创建或找回。

## 3. 日常检查

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yml ps
curl --fail https://ledger.example.com/api/v1/system/health
```

健康响应包含 API、数据库、scheduler 最近心跳和最近汇率同步状态。容器探针分别检查
API/数据库、scheduler 心跳和前端。scheduler 启动时立即写入心跳，之后每 5 分钟更新。

日志同时写入受轮转限制的 Docker JSON 日志；backend、scheduler、backup 和 Caddy 还写入
各自的持久化日志卷：

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yml logs --since 1h backend scheduler backup proxy
```

应用请求日志为 JSON，只记录 method、path、status 和耗时，不记录请求体、Cookie 或查询
参数。导入、导出、恢复和登录失败另写数据库审计日志。

## 4. 备份

backup 容器启动时先执行一次 `pg_dump --format=custom`，之后按 `BACKUP_CRON` 每日执行；
每份备份带 SHA-256 文件，`BACKUP_RETENTION_DAYS` 默认 14 天。

手动备份并查看结果：

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yml exec backup sh /scripts/backup.sh
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yml exec backup sh -c \
  'ls -lh /backups && sha256sum -c /backups/*.sha256'
```

需要异地备份时，从 `flow-ledger-production_backup_data` 卷复制 `.dump` 与 `.sha256`，并在
另一台 PostgreSQL 16 实例定期做恢复演练。设置页 JSON 备份用于业务级导入恢复，不能替代
数据库级灾备。

## 5. 数据库恢复

先确认目标文件和校验和，停止产生写入的服务，再执行恢复。恢复脚本会在覆盖前自动生成
一份当前数据库备份，并使用单事务 `pg_restore`；失败时不会留下部分恢复数据。

```bash
COMPOSE='docker compose --env-file deploy/.env.production -f deploy/compose.production.yml'
$COMPOSE stop backend scheduler
$COMPOSE run --rm backup /scripts/restore.sh /backups/flow-ledger-YYYYMMDDTHHMMSSZ.dump
$COMPOSE run --rm migrate
$COMPOSE up -d --wait backend scheduler frontend proxy backup
curl --fail https://ledger.example.com/api/v1/system/health
```

恢复完成后验证管理员登录、机构数量、最新快照、债权债务余额和看板总额。不要在未停止写入
服务时做生产恢复。

## 6. 发布、回滚与 GitHub 配置

`.github/workflows/deploy.yml` 仅在 main 的 `CI` 成功后部署对应且完全相同的提交，也可由
production environment 手动触发。需配置以下 GitHub Secrets：

- `VPS_HOST`：VPS 主机名或 IP。
- `VPS_USER`：最小权限部署用户。
- `VPS_SSH_KEY`：部署私钥。
- `VPS_KNOWN_HOSTS`：预先核验的 SSH host key，禁止运行时自动信任。
- `VPS_PATH`：VPS 上仓库绝对路径。

应用代码回滚：在 main 创建恢复提交，等待完整 CI 后部署。紧急情况下可在 VPS 切换到已知
提交并重新执行 `sh deploy/deploy.sh`；如果该版本不兼容当前 schema，必须先按上一节恢复
该版本部署前的数据库备份。禁止直接执行未经演练的 Alembic downgrade。

部署失败时，`deploy.sh` 会打印 Compose 状态并返回非零；查看 backend、migrate、scheduler
和 proxy 日志，修复后重新运行。迁移失败不会启动新 API，原数据仍由部署前备份保护。
