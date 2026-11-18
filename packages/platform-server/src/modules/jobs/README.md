# 公共异步作业台账

[JobLedgerApplication / Repository](job-ledger.ts)提供原 AsyncJob 的列表、创建和入队日志。当前租户来自公共 ALS，数据由宿主的窄存储端口提供。业务执行、调度、批准及原结果恢复沿宿主和业务 Core 的正式入口处理。

## Core 接入

1. 从 `@rental-os/platform-contracts/jobs` 使用 `AsyncJobSummary` 和 `CreateAsyncJobRequest`，从 `@rental-os/platform-server/jobs` 使用台账应用、仓储和窄存储类型。
2. 宿主提供 `JobLedgerDataStore` 的 `asyncJob.findMany/create`，由 `JobLedgerRepository` 适配原表。应用接入当前持久模式及原适配日志回调。内存宿主传入原 `jobsByTenant` Map 和初始任务，后续执行者复用同一 Map 与行对象。
3. 在原权限入口和公共请求上下文中调用 `listJobs/createJob`。业务 Core 提供任务类型、对象关联和有效执行者，执行与恢复按当前授权、原操作和收据办理。

公共应用缺省从空内存台账开始。原 API 的业务种子由 [IntegrationsService](../../../../../apps/api/src/modules/integrations/integrations.service.ts)提供，原 SQL 存储由 [IntegrationsRepository](../../../../../apps/api/src/modules/integrations/integrations.repository.ts)接入。[JobsController](../../../../../apps/api/src/modules/jobs/jobs.controller.ts)继续使用同一服务实例。

## 字段与失败语义

- SQL 列表沿原租户条件、状态升序和创建时间降序，最多返回 80 条。nullable 字段、日期、JSON 和历史状态按原投影读取。
- 内存任务沿原 UUID 短 ID、attempt 0 和 maxAttempts 3。SQL 短 ID 与原数据库默认字段分别保持各自规则。
- 创建先登记 `queued` 任务，再等待原适配日志。日志失败向调用方传播，已登记任务保留在原台账，后续核对沿原任务 ID 进行。
- 入队日志沿原 `mock-job-runner` 与 `externalCallSkipped` 字段表示模拟登记。正式业务执行和 Provider 结果由原执行者记录。

原 `runJob/runDueJobs`、仓储 `getJob/finishJob` 及导入导出继续消费同一台账。独立公共宿主已提供 AsyncJob 模型与同字段迁移，由[平台数据计划](../../../../../apps/platform-api/src/platform-data.ts)维护；独立任务 HTTP、完整业务执行与恢复接入继续交付。[当前接续](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)
