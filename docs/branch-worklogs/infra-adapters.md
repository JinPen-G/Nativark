# infra-adapters 分支工作记录

集成恢复：2026-06-09 用户先指出无 PRD/原型的独立“通知中心”“附件与打印”“异步任务”“外部接入与任务”“安全基线”不应作为营运端正式功能页暴露，integration 曾短暂下线这些菜单和路由；随后用户要求“恢复成原来的样子”，当前 integration 已恢复这些菜单、路由、页面和前端 API。后续新增或扩展仍需记录 PRD/原型依据和用户确认。

更新时间：2026-06-09

目标分支：`codex/infra-adapters`

## 本轮范围

- 严格按门市租赁 PRD 的外部能力边界执行：支付/预授权、通知、电子合同、TBox、AI 调度分析均不做真实外部调用，但必须有统一预留点和可追踪日志。
- 页面参考 `system_rules.html` 的系统管理密度、`tbox_management.html` 的车机字段、`order_detail.html` 的通知/预授权/打印/附件入口语义。
- 本轮不开发工作台，不开发分时租赁，不修改 PRD 和原型文件。

## 已完成切片

### 1. MySQL 基础设施表

新增 Prisma 模型与 migration：

- `FileAsset`：附件/文件元数据，服务车况照片、证件附件、合同附件、打印单据文件。
- `NotificationTemplate`：通知模板，预置订单确认、追缴通知、租赁合约签署。
- `NotificationSendLog`：通知发送日志，记录渠道、对象、请求、mock 响应。
- `ExternalAdapterLog`：统一外部 adapter 调用日志，覆盖支付、预授权、短信、电子合同、TBox、AI、导出、打印、文件。
- `AsyncJob`：异步任务队列预留，覆盖待支付超时、通知补发、月结生成、导入导出等。
- `DocumentPrintJob`：打印/合同模板生成任务预留。
- `TBoxDevice`：TBox 设备入库、绑定、解绑、通讯状态台账。

数据源开关：

- 默认仍为内存演示。
- 设置 `INFRA_DATA_SOURCE=mysql` 后，基础设施模块读写 MySQL。
- 未设置 `INFRA_DATA_SOURCE` 时，会沿用 `STORE_RENTAL_DATA_SOURCE`；便于整套门市租赁一起切 MySQL。

### 2. 后端接口

新增 API：

- `/integrations/dashboard`：返回能力总览、日志、附件、任务、打印、TBox 台账。
- `/integrations/adapters/mock-call`：手动触发 adapter mock 调用并写入 `ExternalAdapterLog`。
- `/integrations/adapter-logs`：查询外部 adapter 调用日志。
- `/integrations/tbox-devices`：TBox 台账列表/新增/编辑。
- `/integrations/tbox-devices/:id/bind`：TBox 绑定/解绑车辆 mock。
- `/files`：附件元数据列表/创建。
- `/notifications/templates`：通知模板列表。
- `/notifications/logs`：通知发送日志。
- `/notifications/send`：通知 mock 发送。
- `/jobs`：异步任务列表/入队。
- `/jobs/:id/run`：手动执行单个任务。
- `/jobs/run-due`：手动执行到期任务。
- `/jobs/print`：打印/合同单据 mock 生成。

权限：

- 新增 `system:integration:manage`。
- API guard 对 `/integrations`、`/files`、`/notifications`、`/jobs` 要求 `system:integration:manage` 或 `system:params:manage`。
- 租户管理员固定拥有当前租户内全权限；价格规则管理员新增该租户内权限，便于本地验证系统参数/外部接入。

### 3. 前端营运端页面

历史前端实现（已按用户要求恢复为独立入口）：

- 原路由：`/integrations`，已在 integration 分支恢复。
- 原菜单：系统管理 / 外部接入与任务，已在 integration 分支恢复。
- 原页面文件：`apps/admin/src/views/IntegrationOpsView.vue`，已在 integration 分支恢复。

以下能力已恢复为历史实现状态；后续扩展仍需审计依据：

- 能力总览：展示支付、预授权、短信、电子合同、TBox、AI、导入导出、打印、附件的 provider、mock/reserved 状态、日志数和真实接入改造点。
- 通知中心：展示模板和发送日志，可触发一次通知 mock。
- 附件与打印：可创建附件元数据、生成打印单据 mock 记录。
- 异步任务：可创建任务、执行到期任务、执行单个任务。
- TBox：展示车机台账字段，可 mock 绑定/解绑车辆。
- Adapter 日志：展示 provider、能力、操作、业务对象和 mock 响应。

### 4. PF-13 导入导出/打印基础补强

新增共享 DTO：

- `DataExchangeTemplateSummary`：导入导出模板定义，覆盖目标模块、对象、字段、mock 文件名和真实接入点。
- `CreateDataExchangeJobRequest`：创建模板下载、列表导出、导入校验任务。
- `DataExchangeJobResult`：返回 `AsyncJob` 和可选导入源文件元数据。

新增 API：

- `GET /integrations/data-exchange/templates`：返回站点、车辆、会员、企业客户、订单导出和会员导入校验模板。
- `POST /integrations/data-exchange/jobs`：创建数据交换任务，写入 `AsyncJob`，并记录 `ExternalAdapterLog`。
- `POST /jobs/:id/run`：执行数据交换任务时，按任务类型生成 mock 模板文件、导出文件或导入校验报告 `FileAsset` 元数据。

历史前端增强（已恢复）：

- `IntegrationOpsView.vue` 的“附件与打印”页签曾新增导入导出模板表、任务创建表单和数据任务结果表；页面已按用户要求恢复。
- 前端 API client 曾补齐数据交换接口；当前已按用户要求恢复对应调用。

MySQL / mock 边界：

- 不新增 Prisma 表，复用本分支已有 `AsyncJob`、`FileAsset`、`ExternalAdapterLog`。
- 设置 `INFRA_DATA_SOURCE=mysql` 后，数据交换任务、文件产物和 adapter 日志可落 MySQL。
- MVP 不解析真实 Excel，不生成真实二进制文件，不写入站点/车辆/会员/企业/订单业务主表。

### 5. PF-15 附件中心企业合同引用第一片

新增共享 DTO：

- `FileAssetQuery`：附件元数据查询过滤，支持按业务模块、对象类型、对象 ID、上传场景、状态和数量限制查询。
- `CreateCorporateContractAttachmentRequest`：企业合同附件 mock 创建请求。
- `CorporateContractAttachmentResult`：返回更新后的企业客户、企业合同和附件元数据。

新增/增强 API：

- `GET /files`：支持查询参数过滤对象附件。
- `GET /store-rental/corporates/:id/contracts/:contractId/attachments`：读取企业合同附件元数据。
- `POST /store-rental/corporates/:id/contracts/:contractId/attachments`：为已保存企业合同创建 mock 附件元数据。

业务引用：

- 企业合同附件固定写入 `FileAsset.businessModule=store_rental`、`businessType=corporate_contract`、`businessId=contractId`。
- 创建附件后同步回写 `CorporateContract.attachments` 文件名数组，企业详情页可立即展示合同附件名。
- MySQL 模式下 `FileAsset` 由 `INFRA_DATA_SOURCE=mysql` 落库，企业合同附件名由 `STORE_RENTAL_DATA_SOURCE=mysql` 对应的 `CorporateContract.attachments` 写回。

前端增强：

- 企业客户详情合同台账增加“生成 mock 附件”入口，对已保存合同调用后端附件接口。
- 仍不做真实 multipart 上传，不生成真实二进制文件，当前只创建本地 mock storage key 和 mock 下载 URL。

## Mock 行为约定

- 所有外部调用均自动跳过真实供应商，响应中包含 `externalCallSkipped: true`。
- Mock 调用必须写入 `ExternalAdapterLog` 或对应业务日志。
- 文件上传当前只保存元数据和 mock storage key，不写真实二进制文件。
- 企业合同附件当前通过 `FileAsset.businessType=corporate_contract` 绑定真实合同，合同表只回写附件文件名用于台账展示。
- 打印/合同当前只生成 `DocumentPrintJob` 与 mock PDF 文件元数据，不渲染真实 PDF。
- 导入导出当前只创建任务和 mock 文件元数据；导入校验只返回示例报告结构，不解析真实 Excel，不写业务主数据。
- 通知当前只写 `NotificationSendLog`，不调用短信、邮件或 APP 推送。
- TBox 当前只维护台账和绑定关系，不调用真实车机平台，不执行远程开锁/落锁。
- AI 调度当前只沿用系统参数与调度分支的 mock 日志边界；AI 不直接修改订单、车辆或排程。

## 后续真实接入改造点

| 能力 | 当前入口 | 后续真实接入修改点 |
| --- | --- | --- |
| 文件/附件 | `IntegrationsService.createFile`、`FileAsset` | 接对象存储上传、签名 URL、访问控制、病毒扫描、文件清理 job |
| 企业合同附件 | `StoreRentalService.createCorporateContractAttachment`、`FileAsset.businessType=corporate_contract`、`CorporateContract.attachments` | 接真实上传流、下载鉴权、合同有效期/签署状态联动和电子签署回存 |
| 通知 | `sendNotification`、`NotificationSendLog` | 接短信/邮件/APP provider、模板 ID、发送回执、失败补发、退订/黑名单 |
| 支付/预授权 | `invokeMockAdapter` capability `payment/pre_auth` | 抽支付 provider 接口，写真实交易号、验签回调、状态查询、幂等键 |
| 打印/合同 | `createPrintJob`、`DocumentPrintJob` | 接模板渲染、PDF 生成、电子签署、已签文件回存、签署回调 |
| 导入导出 | `AsyncJob`、capability `export` | 接 Excel 生成/解析、导入校验报告、下载链接权限、任务进度 |
| 定时任务 | `AsyncJob`、`runDueJobs` | 接常驻 worker/cron、重试策略、死信队列、超时取消和通知补发 |
| TBox | `TBoxDevice`、`bindTBoxDevice` | 接车机平台绑定、遥测回调、远程指令、指令失败兜底和订单履约联动 |
| AI 调度 | `ExternalAdapterLog` capability `ai_dispatch` | 接模型调用、JSON Schema 校验、业务二次校验、180 天日志清理 |

## 本轮未完成项

- 未接真实 Redis 缓存，仅保留 `AsyncJob` 和 adapter 日志；后续可补 Redis cache service。
- 未做真实二进制上传和下载流。
- 未做真实 Excel 解析、真实导出二进制生成和打印 PDF 渲染。
- 未把所有订单/车辆页面按钮接入这些 adapter；本轮已先接企业合同真实业务引用，其余对象继续使用平台统一预留层和管理入口。
- 未启动常驻 job runner；当前通过 `/jobs/run-due` 手动触发到期任务。

## 修改文件索引

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260608000300_add_infra_adapters/migration.sql`
- `apps/api/src/modules/integrations/*`
- `apps/api/src/modules/files/files.controller.ts`
- `apps/api/src/modules/store-rental/store-rental.controller.ts`
- `apps/api/src/modules/store-rental/store-rental.service.ts`
- `apps/api/src/modules/store-rental/store-rental.repository.ts`
- `apps/api/src/modules/notifications/notifications.controller.ts`
- `apps/api/src/modules/jobs/jobs.controller.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/common/api-auth.guard.ts`
- `apps/api/src/modules/platform/platform.service.ts`
- `apps/api/prisma/seed.ts`
- `packages/shared/src/index.ts`
- `apps/admin/src/api/client.ts`
- `apps/admin/src/views/CorporateDetailView.vue`
- `apps/admin/src/views/IntegrationOpsView.vue`
- `apps/admin/src/router.ts`
- `apps/admin/src/components/AppLayout.vue`
- `.env.example`
- `docs/STORE_RENTAL_DEVELOPMENT_TASKS.md`
- `docs/TECHNICAL_DEVELOPMENT_GUIDE.md`
- `docs/branch-worklogs/infra-adapters.md`
