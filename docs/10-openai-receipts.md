# OpenAI 收据识别

本次替换将浏览器 Tesseract 日英 OCR 与规则解析改为后端 OpenAI Responses API。每次只提取一张票据的一笔开销候选：金额、消费日期、币种、商户和需核对事项。分类仍由用户选择。识别不自动记账，原有人工核对、重复提醒和保存幂等机制保持有效，无新增数据库迁移。旧的 Worker、模型复制脚本、前端依赖和已生成的本地模型资源已移除。

## 模型与配置

默认模型 `gpt-6-luna`。截至 2026-11-05，OpenAI Docs 将其列为面向成本敏感任务的模型，支持图片输入、Responses API 和 Structured Outputs。标准短上下文价格为每百万输入 token 0.10 美元、输出 token 0.50 美元。图片会计入输入 token，推理 token 也可能计入输出费用；不能用文件大小推算单张固定费用。价格和账号可用性以平台为准，未验证当前账号的实际模型权限。

在后端环境文件中配置：

```dotenv
OPENAI_API_KEY=在此设置你自己的服务端项目密钥
RECEIPT_MODEL=gpt-6-luna
RECEIPT_TIMEOUT_SECONDS=45
RECEIPT_REQUESTS_PER_MINUTE=6
```

密钥只放后端环境，不使用 `VITE_` 前缀，不写进仓库。根目录 `.env.example` 和 `deploy/.env.production.example` 提供空值示例。开发 Compose 的 backend 已读取 `.env`；生产 Compose 将上述变量显式传给 backend。修改配置后重建/重启对应服务才生效；本次未执行部署。Python 后端需重新安装 `backend/pyproject.toml` 的依赖（新增 Pillow 12.x）：`python -m pip install -e ".[dev]"`。

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
