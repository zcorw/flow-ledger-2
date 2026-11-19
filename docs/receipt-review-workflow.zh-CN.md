# 单据审核、草稿与确认入账

[English](receipt-review-workflow.md) | **简体中文**

本次源码增量需要配套 Rokid 资源包及 `0014_receipt_drafts`、`0015_device_expense_grants` 两项迁移，不会自动部署或升级旧设备权限。

## 使用流程

眼镜固定显示商户、金额、时间、账户、分类标签。未知值留空，已确认币种随符号显示 ISO 代码。方向键/前后滑动先高亮七个可编辑字段，再选择语音修改、草稿或确认；点击字段进入其专属语音界面。

- 语音修改仅在用户触发后启动一次 `SpeechRecognition`。转写文本、当前字段、启用币种及账户名称由后端配置的模型按 `store: false` 和严格 JSON 结构处理；非法修改被拒绝，未提及字段不变，账户/币种歧义需澄清。此操作不保存音频、供应商原始响应或开销。不支持语音的运行时可在网站编辑。
- 草稿在同一单据上保存带版本的候选，保留原始字节，不创建开销。网站可筛选未入账草稿、搜索商户、修订字段，再明确记录开销。JSON v4 备份包含草稿，仍支持恢复旧版备份。
- 确认要求有效金额、日历日期、启用的 ISO 币种、分类及所属的启用账户。账户主人先在手机核对指定设备并单独勾选授权入账；眼镜保存审核快照后，明确确认该版本。疑似重复需再次明确触发。成功后只有一笔开销关联原图，不扣减账户或资产余额。

## 新增 API

以下设备接口均使用 `/api/v1/receipt-devices` 下的现有 Bearer 凭据；普通网页登录接口仍不接受设备凭据。

| 方法及路径 | 契约 |
| --- | --- |
| GET `/review-options` | `{version: 1, categories, currencies, accounts}`；完整 value/label/aliases 候选，仅所属启用账户，不分页、不静默限为100个账户 |
| POST `/review-correction` | `{transcript, values, targetField?}` → `{values, changedFields, warnings, fieldOutcome?}`；定向有限选项无需调用模型 |
| POST `/receipt-drafts` | `{receiptId, requestKey, expectedRevision, values}` → 保存版本；同键重放、异内容冲突及旧版本覆盖保护 |
| GET `/receipt-drafts/{id}` | 读取已知且所属单据的草稿字段/版本；不返回原图或归档列表 |
| GET `/capabilities` | 设备 ID、入账权限及规范手机授权网址；读取不会授予权限 |
| POST `/{id}/expense-permission` | **仅账户主人网页登录会话**，需 `X-Device-Approval: 1`、同源操作意图及 `{enabled: boolean}`；设备凭据和网址参数不能授予权限 |
| POST `/receipt-confirmations` | `{receiptId, revision, requestKey, confirmed: true, allowDuplicate?: boolean}`；核对冻结快照与设备权限，复用原开销写入、校验、审计和唯一性约束 |
| GET `/receipt-confirmations/{key}?receiptId={id}` | 只读结果：`not_found`、带记录的 `recorded` 或 `deleted`；校验归属，单独撤销入账权限后仍可查询 |

配套后端新增 `GET /review-options`（版本 1，完整分类、启用币种及所属启用账户），`POST /review-correction` 支持可选 `targetField`，定向响应增加 `fieldOutcome`：`matched`、`unchanged`、`ambiguous`、`unmatched`。前后端均限制字段边界。有限选项先按规范化名称/别名精确匹配，再按唯一包含项及保守文字相似度匹配（至少 0.72，领先次项至少 0.15）；多项接近或否定指令需澄清，不等于通用拼音/语义匹配。自由字段沿用模型但明确目标，并丢弃其他字段修改，不写账。候选仅存内存，隐藏/退出时清除。安装原生新包前须部署这项后端增量，候选接口缺失/无效时明确失败；未传目标字段的旧请求保持原行为。

网站主人通过 `POST /api/v1/receipts/drafts` 使用相同草稿请求保存；`GET /api/v1/receipts?drafts=true&q=merchant` 筛选未入账草稿，并搜索原始/修正后的商户。拒绝其他账户的单据或账户。删除开销保留幂等墓碑与原图，重放不会重新创建已删除的开销。

## 恢复与部署

眼镜在发送入账请求前，仅持久保存绑定后端的单据 ID、版本及请求键，不在此恢复记录中保存图片字节、语音文本、授权凭据或单据字段。中断/重启后先查询结果；记录不存在时恢复服务器草稿，等待用户再次明确触发后使用相同请求键重试。服务器草稿改变时必须重新核对。已确认入账的记录直接展示，不再发送入账请求。恢复状态写入失败会阻止财务请求。

发布时先全量备份、执行 `alembic upgrade head` 并部署后端/网站，再安装新眼镜资源包。旧设备仍只有收据权限，除非主人明确开启入账。降级 0015 会移除入账权限，再升级后仍为关闭；降级 0014 会丢弃草稿字段，应先保留全量备份。不使用未挂载的短期授权实验。

自动化仅使用隔离合成数据和替代模型回复。新包仍需验收语音可用性、原生焦点/滚动、手机授权、退出重启恢复、原图及开销回看。上一资源包的验收不代表本次增量已通过。

语音契约：[Rokid SpeechRecognition](https://open.rokid.com/aiui/api/ai/speech-recognition?lang=zh-CN&version=0.19.0)。
