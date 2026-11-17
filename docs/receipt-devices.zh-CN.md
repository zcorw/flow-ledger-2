# 收据识别专用设备授权

[English](receipt-devices.md) | **简体中文**

Rokid 使用独立、可撤销的长期 Bearer 授权。用户在手机登录后，从 **设置 → 设备授权** 进入并核对授权码、明确允许。保留 `/receipt-devices` 直达配对链接。权限仅用于识别收据，不能创建开销或修改资产；结果仍需核对，不会自动记账。

## 部署

前后端应部署同一版本，沿用 [deploy/README.md](../deploy/README.md) 的备份及发布步骤。在新 API 提供服务前，对部署配置的数据库执行 `alembic upgrade head`，并重新构建前端。`0011_receipt_devices` 新增两张表；`0012_persistent_devices` 允许设备有效期为空，保留旧授权的原有期限及所有账务记录。降级 0012 时使长期授权立即到期，以兼容旧服务；降级 0011 会移除这两张表。

后端设置 `APP_BASE_URL=https://ledger.zcorw.xyz`。识别服务配置仅放服务端，见[收据配置](10-openai-receipts.md)。HTTPS API 请求必须直接到达此来源，不能依赖跳转；原生 fetch 和同源手机页面无需新增 CORS 配置。不要记录授权头、短码、设备码、照片体或服务密钥。

部署后，未登录访问 `/receipt-devices` 应先登录再返回。使用最新眼镜资源包时，未绑定设备应在入口先显示授权码，不访问相机。在手机输入相同授权码、勾选核对并允许后自动打开取景，拍照后开始识别。将返回的金额、币种、日期和商户与收据核对，并在设备验收拒绝、过期、撤销、重试及退出。自动化测试使用替代识别服务，不调用生产模型。

## 接口

以下路径均位于 `/api/v1/receipt-devices`，响应均为 `Cache-Control: no-store`。

| 方法 / 路径 | 鉴权及数据 |
| --- | --- |
| POST `/pairings` | 公开 JSON `{deviceName:"Rokid"}`；返回 `deviceCode`、`userCode`、`verificationUri`、`expiresAt`、`interval`。 |
| POST `/pairings/token` | JSON `{deviceCode}`；等待时 202 `authorization_pending`，过快时 429，同意后 200 `{accessToken,tokenType:"Bearer",scope:"receipt:recognize",deviceId,expiresAt}`。 |
| POST `/pairings/lookup` | 用户网页会话；返回设备名称、状态、期限、权限。 |
| POST `/pairings/approve` 或 `/pairings/deny` | 用户网页会话及 `X-Device-Approval: 1`；检查同源操作意图。 |
| GET 根路径 | 用户网页会话；列出有效授权。 |
| DELETE `/{deviceId}` | 用户网页会话及 `X-Device-Approval: 1`；撤销授权。 |
| POST `/receipt-recognition` | `Authorization: Bearer …`、`X-Receipt-Upload: 1`、原始 PNG/JPEG 请求体（1 字节至 8 MiB）。 |

返回与网页 OCR 一致的字符串 `amount`、`expenseDate`、`currencyCode`、`merchant` 和字符串数组 `warnings`。照片在内存中规范化，复用原有识别服务与限流。处理上传前、调用识别服务前、返回结果前均检查授权。撤销不能撤回已发起的识别服务调用，但撤销后不返回其结果。

配对码 10 分钟有效，轮询间隔至少 3 秒；同意后仅可交换一次长期令牌，返回 `expiresAt: null`。改密码、撤销会使授权失效；旧版有限期授权仍按原期限到期。眼镜将凭证保存到按 Agent 隔离的原生存储，退出或重启后自动恢复；清除 Agent 数据后需重新授权。数据库只保存哈希，不保存可恢复码或令牌。配对创建有来源及全局限制，JSON/照片有体积限制。手机必须明确核对并确认，URL 参数不会自动授权。

眼镜通过 `Blob`、`createImageBitmap` 和离屏 `Canvas.convertToBlob` 转换原始 WebP，最长边不超过 4096 像素，不上传 400×180 显示缩略图。隐藏或退出取消轮询及上传，眼镜不持久化照片或账单内容，只保存绑定后端来源的收据凭证。存储错误会明确显示，网络错误不会丢弃授权。AIUI 文档保证 Agent 存储隔离，此实现不承诺硬件加密；识别服务提供方仍适用其隐私与保留政策。

用户核对及决定接口在 JSON 请求体传入 `{userCode}`，避免授权码出现在 API 请求 URL 中。
