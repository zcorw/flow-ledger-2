# Flow Ledger 生产部署与运维

根目录 `docker-compose.yml` 仅用于开发和集成测试。生产部署由一份基础 Compose 和一份入口叠加配置组成，部署者通过 `PROXY_MODE` 选择公网入口：

- `caddy`：启动容器内 Caddy，自动管理 HTTPS 并占用宿主机 80/443。
- `external`：不启动 Caddy，仅将前端入口发布到 `127.0.0.1`，由宿主机 Nginx、Traefik 或其他代理接管。

PostgreSQL 和后端在两种模式下都不会直接暴露宿主机端口。未配置 `PROXY_MODE` 时默认使用 `caddy`，兼容已有部署。

## 1. VPS 准备

建议环境：1 核 CPU、1 GB 内存（建议配置 Swap）、Ubuntu LTS、Git、curl、Docker Engine 与 Compose v2。应用镜像由 GitHub Actions 构建，VPS 只负责拉取镜像和运行容器。部署用户需要拥有仓库目录写权限、仓库读取凭据和直接执行 Docker 的权限。

当前工作流发布 `linux/amd64` 镜像，VPS 上的 `uname -m` 应返回 `x86_64`；ARM VPS 需要先将工作流的 `platforms` 调整为 `linux/arm64`。

```bash
git clone <repository-url> flow-ledger
cd flow-ledger
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

生成密钥并写入 `.env.production`，不要复制示例占位值：

```bash
openssl rand -hex 32    # SECRET_KEY
openssl rand -hex 32    # BOOTSTRAP_TOKEN
openssl rand -base64 32 # POSTGRES_PASSWORD
```

`DATABASE_URL` 中的数据库密码必须进行 URL 编码，并与 `POSTGRES_PASSWORD` 对应。生产配置会拒绝默认值、占位值和过短密钥。

自动部署会使用当次 GitHub Actions 的临时 `GITHUB_TOKEN` 登录 GHCR，不需要在 VPS 永久保存镜像仓库令牌。需要在 VPS 手动部署时，应创建仅有 `read:packages` 权限的 GitHub Personal Access Token（classic），然后登录：

```bash
printf '%s' '<PAT>' | docker login ghcr.io -u '<GitHub 用户名>' --password-stdin
```

## 2. 选择入口代理模式

### 2.1 公共配置

两种模式都需要配置用户实际访问的地址：

```env
APP_ENV=production
APP_BASE_URL=https://ledger.example.com
```

`APP_BASE_URL` 必须包含协议，并与浏览器访问地址一致。

### 2.2 容器 Caddy 模式

适合没有现成公网代理的专用 VPS：

```env
PROXY_MODE=caddy
DOMAIN=ledger.example.com
ACME_EMAIL=admin@example.com
HTTP_PORT=80
HTTPS_PORT=443
```

域名的 A/AAAA 记录必须指向 VPS，并放行 TCP 80/443；使用 HTTP/3 时还需放行 UDP 443。宿主机不能有其他程序占用 80/443。Caddy 的证书、配置和日志保存在独立 Docker 卷中。

实际使用的文件为：

```text
deploy/compose.production.yml
+ deploy/compose.caddy.yml
```

### 2.3 外部代理模式

适合宿主机已经运行 Nginx 等代理的 VPS：

```env
PROXY_MODE=external
EXTERNAL_PROXY_PORT=18080
APP_BASE_URL=https://ledger.example.com
```

外部代理模式不会加载 Caddy 叠加配置，因此不需要以下 Caddy 专用变量：

```env
DOMAIN
ACME_EMAIL
HTTP_PORT
HTTPS_PORT
CADDYFILE
```

这些变量即使保留也不会生效，可以从 `.env.production` 删除。`APP_BASE_URL` 仍然必须保留，并填写用户通过外部代理实际访问的完整地址；`EXTERNAL_PROXY_PORT` 可省略，默认使用 `18080`。`HEALTHCHECK_URL` 为可选项，仅在需要部署脚本同时检查公网代理时设置。

此模式不会创建 Caddy 容器，也不会占用宿主机 80/443。前端入口固定绑定回环地址：

```text
127.0.0.1:18080
```

实际使用的文件为：

```text
deploy/compose.production.yml
+ deploy/compose.external-proxy.yml
```

宿主机 Nginx 示例，也可以从 `deploy/nginx.external.conf.example` 复制后修改：

```nginx
server {
    listen 80;
    server_name ledger.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ledger.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

外部代理负责 TLS 证书、HTTPS 跳转和公网访问控制。前端容器内的 Nginx 会继续将 `/api/*` 转发给 Docker 内部的后端，并保留外部代理传入的协议头。

### 2.4 校验最终配置

统一使用模式感知命令，不要直接手工组合 Compose 文件：

```bash
sh deploy/compose.sh config --quiet
sh deploy/compose.sh config --services
```

`caddy` 模式的服务列表应包含 `proxy`；`external` 模式不应包含 `proxy`。

## 3. 首次部署与管理员初始化

```bash
sh deploy/deploy.sh
```

脚本会根据 `PROXY_MODE` 选择 Compose 叠加文件，然后依次校验配置、检查 VPS 可用内存和 Docker 磁盘空间、拉取前后端镜像、启动 PostgreSQL、生成部署前备份、执行 Alembic、启动所选服务并等待健康检查。镜像必须全部拉取成功后才会开始备份和更新容器；健康检查成功后，脚本会清理超过指定保留时间且未被任何容器使用的旧镜像。

默认部署保护参数如下，可在 `.env.production` 中覆盖：

```env
COMPOSE_PARALLEL_LIMIT=1
DEPLOY_MIN_AVAILABLE_MEMORY_MB=128
DEPLOY_MIN_DOCKER_FREE_MB=2048
DEPLOY_PRUNE_ENABLED=true
DEPLOY_PRUNE_UNTIL=168h
```

两个资源阈值的单位均为 MB，设置为 `0` 可关闭对应检查。镜像拉取按顺序执行，降低小内存 VPS 的瞬时压力。自动清理会处理未使用的旧镜像和迁移前遗留的构建缓存，但不会删除正在使用的镜像或任何 Docker 卷；如需暂时保留这些内容，可设置 `DEPLOY_PRUNE_ENABLED=false`。

如果现有 VPS 的 `.env.production` 已经显式写入旧的 `DEPLOY_MIN_AVAILABLE_MEMORY_MB=1024` 或 `DEPLOY_MIN_DOCKER_FREE_MB=4096`，切换前应按上面的新值调整；否则实际环境文件会覆盖脚本的新默认值。

生产 Compose 项目名仍为 `flow-ledger-production`，数据库继续使用 `flow-ledger-production_postgres_data` 命名卷。部署脚本不会执行 `docker compose down -v`、`docker volume rm` 或其他卷删除操作；即使 PostgreSQL 容器需要重建，也会重新挂载同一个数据卷。首次从 VPS 构建模式切换前建议确认并额外执行一次备份：

```bash
docker volume inspect flow-ledger-production_postgres_data
sh deploy/compose.sh exec backup sh /scripts/backup.sh
```

健康检查默认行为：

- `caddy`：检查 `https://${DOMAIN}/api/v1/system/health`。
- `external`：检查 `http://127.0.0.1:${EXTERNAL_PROXY_PORT}/api/v1/system/health`，不依赖外部代理是否已配置。

如果希望部署时同时验证公网代理，可在 `.env.production` 设置：

```env
HEALTHCHECK_URL=https://ledger.example.com/api/v1/system/health
```

首次访问应用会进入 `/setup`。填写 `.env.production` 中的 `BOOTSTRAP_TOKEN`、管理员邮箱、显示名和至少 12 位密码。初始化成功后入口永久失效；随后应轮换 `BOOTSTRAP_TOKEN` 并再次部署。管理员密码只保存 Argon2 哈希，不能从环境变量自动创建或找回。

## 4. 切换代理模式

切换时只需修改 VPS 上的 `.env.production` 并重新部署：

```bash
sh deploy/deploy.sh
```

部署命令带有 `--remove-orphans`：从 `caddy` 切换为 `external` 时会停止并移除 Caddy 容器，但保留 Caddy 数据卷，切回后可以继续使用已有证书；从 `external` 切回 `caddy` 时会取消前端的回环端口发布并启动 Caddy。

切换到 `external` 前应确保宿主机代理指向正确的 `EXTERNAL_PROXY_PORT`。切换到 `caddy` 前必须确保 80/443 已由宿主机 Nginx 释放。

## 5. 日常检查和日志

所有管理命令都通过模式感知脚本执行：

```bash
sh deploy/compose.sh ps
sh deploy/verify.sh
```

健康响应包含 API、数据库、scheduler 最近心跳和最近汇率同步状态。scheduler 启动时立即写入心跳，之后每 5 分钟更新。

公共服务日志：

```bash
sh deploy/compose.sh logs --since 1h backend scheduler backup frontend
```

仅 Caddy 模式包含代理日志：

```bash
sh deploy/compose.sh logs --since 1h proxy
```

外部模式的公网代理日志由宿主机管理员在对应工具中查看。应用请求日志不记录请求体、Cookie 或查询参数；导入、导出、恢复和登录失败另写数据库审计日志。

## 6. 备份

部署脚本会在迁移前执行一次 `pg_dump --format=custom`。backup 容器之后按 `BACKUP_CRON` 每日执行；默认 `BACKUP_ON_START=false`，避免容器重建时紧接着重复备份。每份备份带 SHA-256 文件，`BACKUP_RETENTION_DAYS` 默认 14 天。

```bash
sh deploy/compose.sh exec backup sh /scripts/backup.sh
sh deploy/compose.sh exec backup sh -c \
  'ls -lh /backups && sha256sum -c /backups/*.sha256'
```

需要异地备份时，从 `flow-ledger-production_backup_data` 卷复制 `.dump` 与 `.sha256`，并在另一台 PostgreSQL 16 实例定期做恢复演练。设置页 JSON 备份用于业务级导入恢复，不能替代数据库级灾备。

## 7. 数据库恢复

先确认目标文件和校验和并停止写入服务。恢复脚本会在覆盖前自动生成当前数据库备份，并使用单事务 `pg_restore`；失败时不会留下部分恢复数据。

```bash
sh deploy/compose.sh stop backend scheduler
sh deploy/compose.sh run --rm backup \
  /scripts/restore.sh /backups/flow-ledger-YYYYMMDDTHHMMSSZ.dump
sh deploy/compose.sh run --rm migrate
sh deploy/deploy.sh
sh deploy/verify.sh
```

恢复后验证管理员登录、机构数量、最新快照、债权债务余额和看板总额。不要在未停止写入服务时执行生产恢复。

## 8. GitHub Actions 自动部署

`CI` 在 `main` 的前端、后端、部署配置和端到端测试全部通过后，在 GitHub 托管 Runner 上构建并推送以下镜像：

```text
ghcr.io/zcorw/flow-ledger-backend:<commit-sha>
ghcr.io/zcorw/flow-ledger-frontend:<commit-sha>
```

同时更新两个镜像的 `latest` 标签，供手动部署使用。`.github/workflows/deploy.yml` 等待整个 `CI`（包括镜像发布）成功后，将同一个提交 SHA 传给 VPS。VPS 使用该 SHA 拉取不可混淆的前后端版本，不再运行 `pip install`、`pnpm install` 或前端编译。自动部署通过仓库自带的 `GITHUB_TOKEN` 获得 GHCR 读取权限，不需要新增 GitHub Secret。

代理模式仍由 VPS 上的 `.env.production` 决定，无需为两种模式创建不同工作流。GitHub 仓库或组织策略必须允许 Actions 对 Packages 使用读写权限；如果 GHCR 返回 `denied`，还需在对应 Package 的设置中确认本仓库拥有 Actions 访问权限。

需要配置：

- `VPS_HOST`：VPS 主机名或 IP。
- `VPS_USER`：最小权限部署用户。
- `VPS_SSH_KEY`：部署私钥。
- `VPS_KNOWN_HOSTS`：预先核验的 SSH Host Key。
- `VPS_PATH`：VPS 上仓库绝对路径。

不需要新增 GHCR 用户名或令牌 Secret。自动部署的远程顺序为：更新已验证的 Git 提交、拉取对应 SHA 镜像、备份数据库、执行迁移、更新应用容器和健康检查。数据库卷不会被替换或删除。

应用代码回滚应优先在 `main` 创建恢复提交，等待完整 CI 后部署。紧急情况下也可在 VPS 使用仍保存在 GHCR 的已知镜像版本：

```bash
IMAGE_TAG=<known-good-commit-sha> sh deploy/deploy.sh
```

如果该版本不兼容当前 schema，必须先恢复对应的数据库备份。禁止直接执行未经演练的 Alembic downgrade。

部署失败时，脚本会打印 Compose 状态并返回非零。公共问题查看 backend、migrate、scheduler、frontend 和 backup；仅 Caddy 模式再检查 proxy。迁移失败不会启动新 API，原数据仍由部署前备份保护。
