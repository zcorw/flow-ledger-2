# OpenAI 收据识别

本次替换将浏览器 Tesseract 日英 OCR 与规则解析改为后端 OpenAI Responses API。每次只提取一张票据的一笔开销候选：金额、消费日期、币种、商户和需核对事项。分类仍由用户选择。识别不自动记账，原有人工核对、重复提醒和保存幂等机制保持有效，无新增数据库迁移。旧的 Worker、模型复制脚本、前端依赖和已生成的本地模型资源已移除。

## 模型与配置

默认模型 `gpt-6-luna`。截至 2026-11-05，OpenAI Docs 将其列为面向成本敏感任务的模型，支持图片输入、Responses API 和 Structured Outputs。标准短上下文价格为每百万输入 token 0.10 美元、输出 token 0.50 美元。图片会计入输入 token，推理 token 也可能计入输出费用；不能用文件大小推算单张固定费用。价格和账号可用性以平台为准，未验证当前账号的实际模型权限。

### 创建 API 密钥

在 OpenAI 控制台为应用所在项目创建 API 密钥，并确认该项目有可用额度及所选模型的访问权限。应用使用密钥请求 `https://api.openai.com/v1/responses`，后端运行环境需要能够通过 HTTPS 访问此地址。密钥通过服务端环境变量提供，创建和管理方式见 [OpenAI 官方密钥说明](https://developers.openai.com/api/docs/guides/api-keys)。

### 配置项

将下面四项写入本地开发使用的根目录 `.env`，或生产部署使用的 `deploy/.env.production`。将占位文字替换为实际密钥。

```dotenv
OPENAI_API_KEY=在此设置你自己的服务端项目密钥
RECEIPT_MODEL=gpt-6-luna
RECEIPT_TIMEOUT_SECONDS=45
RECEIPT_REQUESTS_PER_MINUTE=6
```

| 配置项 | 默认值 | 用途和取值范围 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 空 | 服务端 API 密钥，填写后启用图片上传入口 |
| `RECEIPT_MODEL` | `gpt-6-luna` | 收据识别模型，需支持图片输入、Responses API、严格 JSON Schema 和 `reasoning.effort=low` |
| `RECEIPT_TIMEOUT_SECONDS` | `45` | 单次识别的服务端超时秒数，范围为 1–50 |
| `RECEIPT_REQUESTS_PER_MINUTE` | `6` | 单个后端进程内每用户每分钟的请求上限，范围为 1–30 |

密钥只放后端环境，不使用 `VITE_` 前缀，不写进仓库。根目录 `.env.example` 和 `deploy/.env.production.example` 提供空值示例。识别图片会经本应用后端发送给 OpenAI，并可能产生 API 费用。

### 本地 Docker Compose

首次启动时按[主 README](../README.md)创建 `.env` 并初始化数据库，在 `.env` 中补全上面的配置。已有环境直接编辑现有文件。开发 Compose 的 `backend` 通过 `env_file` 读取根目录 `.env`。

在项目根目录执行以下命令，将配置注入重新创建的后端容器。首次切换到 OpenAI 版本时，`--build` 也会安装新增的图片处理依赖。

```bash
docker compose up -d --build --no-deps --force-recreate backend
```

每次修改 `.env` 后都需要重新创建后端容器。`docker compose restart` 会沿用原容器的环境变量。

### 直接运行 Python 后端

从 `backend` 目录启动时，配置依次读取根目录 `.env` 和 `backend/.env`，后读文件中的同名值优先，进程环境变量优先于文件。通常将配置统一放在根目录 `.env`，同时按[本地开发说明](../README.md#本地开发)设置宿主机可访问的数据库地址。

激活虚拟环境后，在 `backend` 目录安装依赖并启动 API。

```bash
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload
```

修改密钥、模型或限流配置后，停止并重新启动后端进程，使缓存的配置重新加载。

### 生产环境

按[生产部署说明](../deploy/README.md)准备 `deploy/.env.production`，在已有配置中补全上述四项。生产 Compose 会将这些变量显式传给 `backend`。使用自定义环境文件时，将配置写入 `ENV_FILE` 指定的文件。

在已部署收据识别版本的服务器上，从项目根目录执行以下命令，使环境变量变更生效。

```bash
sh deploy/compose.sh up -d --no-deps --force-recreate backend
```

首次发布收据识别版本时，按部署文档更新包含该功能的应用镜像。以上命令适用于已有对应版本镜像的环境。

### 验证配置与排查错误

登录应用并刷新页面，在“每日开销”中新建开销，检查图片选择入口是否可用。也可在已登录的应用页面打开浏览器开发者工具，在 Console 中执行只读配置检查。

```javascript
fetch('/api/v1/expenses/receipt-recognition', { credentials: 'same-origin' })
  .then((response) => response.json())
  .then(console.log);
```

返回 `{"configured": true}` 表示后端读取到了非空密钥。该检查只读取本地配置，密钥有效性、模型权限和额度需要通过实际识别确认。选择一张脱敏 PNG/JPEG 图片进行识别会调用付费 API，完成后对照原图检查金额、日期、币种和商户。

| 状态或错误码 | 排查方式 |
| --- | --- |
| `configured=false` / `RECEIPT_NOT_CONFIGURED` | 检查实际使用的环境文件及密钥是否为空，重新创建容器或重启 Python 进程后刷新页面 |
| `RECEIPT_PROVIDER_CONFIG` | 检查密钥所属项目、密钥有效性、所选模型名称及访问权限 |
| `RECEIPT_PROVIDER_LIMIT` | 检查 OpenAI 项目的可用额度和速率限制 |
| `RECEIPT_RATE_LIMIT` / `RECEIPT_BUSY` | 等待本应用的每分钟限流或同时识别的请求释放 |
| `RECEIPT_TIMEOUT` / `RECEIPT_CONNECTION` | 检查后端到 `api.openai.com:443` 的网络连接和超时设置 |
| `RECEIPT_PROVIDER_ERROR` / `RECEIPT_INVALID_RESULT` | 核对模型是否满足上表中的接口能力要求，再检查上游服务状态或换图重试 |

没有密钥时，界面禁用图片识别并提示配置；手工记账仍可使用。密钥错误、额度不足、模型不可用时返回可理解的错误，不泄露上游响应或密钥，不悄悄更换模型。`RECEIPT_MODEL` 为管理员配置，修改前须确认目标支持图片、严格 JSON schema、`reasoning.effort=low` 和 Responses API。

## 识别与费用边界

- 登录后 `GET /api/v1/expenses/receipt-recognition` 返回是否配置；不会调用 OpenAI。
- `POST` 同一路径接收原始 PNG/JPEG 字节，需有效登录和 `X-Receipt-Upload: 1`，不接收远程图片 URL。自定义 header 强制跨域预检。
- 客户端和服务端均限制 8 MB、2000 万像素、单边 10000 像素。后端完整解码核实格式，应用 EXIF 方向，移除元数据，白底转 JPEG，最长边缩至 4096。图片不落盘，Nginx 对 API 关闭请求缓冲。若另有外部反向代理，应同样禁用该路径的请求落盘/正文日志。
- 单次一张图片、`detail=high`、`reasoning.effort=low`、输出上限 2000 token，严格结构化输出；不上传完整账本、不使用工具、不产生后续模型对话。后端使用已有 httpx 调用官方固定 HTTPS 地址。
- 每个后端进程最多同时识别两张，每用户每分钟默认六次。该限制是单进程保护；多 worker 或多副本需网关/共享限流，并在 OpenAI 项目设置费用预算和告警。
- 不自动重试、不升级到昂贵模型。服务端默认 45 秒超时（可配置 1–50 秒），浏览器等待最多 60 秒。取消、关闭页面或超时后忽略迟到结果并保留表单；已发出的请求仍可能完成并计费。再次选图是新的付费请求。
- 不确定的金额、日期和币种留空；不替换为今天或默认币种。区分合计、小计、税额、预收现金、找零和分摊付款。保留原币，不自动换汇。退款、负数金额、多张混拍应手工处理。

## 隐私变化

图片现会经过本应用后端发送给 OpenAI，界面在选择图片前已明确提示。请先遮盖不必要的个人资料。应用不持久化图片和识别原文，不把图片写入审计或数据库；只有用户确认的开销字段使用原有保存接口。金额与日期不会经浮点数转换。

请求设置 `store=false`，不创建 Files 资源，不记录图片、提示词或上游响应正文。提示词要求只返回必要字段，排除卡号、地址、税号等敏感内容，但模型可能出错，不能保证自动脱敏完整。`store=false` 不等于 OpenAI 零保留：仍可能存在默认最长 30 天的滥用监控日志及图片安全审核例外；零数据保留需满足平台资格并另外配置。详见官方数据控制文档。

## 验证与局限

后端测试使用合成图片与 httpx MockTransport 验证实际请求结构、验证失败前不收费、元数据剥离、超时/拒绝/截断/限流处理及不自动建账。前端测试覆盖上传、取消、超时和无自动重试；Playwright 使用合成图片与模拟识别响应验证核对、修改、保存、草稿保留和移动端流程。测试服务和测试配置强制清空真实 API 密钥。

这些是接口和产品流程验证，不是视觉准确率评测。没有进行真实付费 API 调用、没有上传真实收据，也没有证明新模型在真实收据上的准确率。模糊、反光、折叠、手写、小字、超长收据及混合支付仍可能出错。启用前应经授权，用代表性的脱敏样本检查总额、日期、币种及商户四项准确率、延迟和实际 token 账单。

`docs/09-expense-validation.md` 记录旧版本地 OCR 的历史结果，其“不上传图片”与真实 OCR 验证描述不适用于本实现。

官方来源：[模型规格](https://developers.openai.com/api/docs/models/gpt-6-luna)、[价格](https://developers.openai.com/api/docs/pricing)、[图片输入](https://developers.openai.com/api/docs/guides/images-vision)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[数据控制](https://developers.openai.com/api/docs/guides/your-data)。
