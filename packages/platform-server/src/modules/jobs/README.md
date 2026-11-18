# 公共异步作业台账

`JobLedgerApplication` 与 `JobLedgerRepository` 提供原 AsyncJob 的列表、创建、读取、完成和手动运行编排。当前租户来自公共 ALS，数据由宿主的窄存储端口提供。业务结果、运行日志、批准及原结果恢复由宿主和业务 Core 的正式入口处理。[源码](job-ledger.ts)

## Core 接入

1. 从 `@rental-os/platform-contracts/jobs` 使用 `AsyncJobSummary` 和 `CreateAsyncJobRequest`，从 `@rental-os/platform-server/jobs` 使用台账应用、仓储和窄存储类型。
2. 宿主提供 `JobLedgerDataStore` 的 `asyncJob.findMany/create`，由 `JobLedgerRepository` 适配原表。读取与完成能力按需提供 `findFirst/update`。应用接入当前持久模式和适配日志回调，内存宿主传入原 `jobsByTenant` Map 与初始任务。
3. 在原权限入口和公共请求上下文中调用台账。需要手动运行时，在 `execution` 中供给同一 `JobLedgerExecutionStorage`、`buildRunResult` 和 `recordRunLog`，分别负责原任务读取/完成、已确认结果与运行日志。运行前核对执行存储的 `getJob/finishJob` 和两项回调是否齐全。缺少执行参加者、有效结果或对应存储能力时抛出 `ServiceUnavailableException`。业务 Core 提供任务类型、对象关联与有效执行者，执行和恢复按当前授权、原操作与收据办理。

公共应用缺省从空内存台账开始。原 API 由 `IntegrationsService` 提供业务种子、执行结果和运行日志，`IntegrationsRepository` 接入原 SQL 存储，`JobsController` 使用同一服务实例。内存执行共用原 Map 和行对象。[原服务](../../../../../apps/api/src/modules/integrations/integrations.service.ts) · [原仓储](../../../../../apps/api/src/modules/integrations/integrations.repository.ts) · [原 HTTP](../../../../../apps/api/src/modules/jobs/jobs.controller.ts)

## 字段与失败语义

- SQL 列表沿原租户条件、状态升序和创建时间降序，最多返回 80 条。nullable 字段、日期、JSON 和历史状态按原投影读取。
- 内存任务沿原 UUID 短 ID、attempt 0 和 maxAttempts 3。SQL 短 ID 与原数据库默认字段分别保持各自规则。
- 创建先登记 `queued` 任务，再等待原适配日志。日志失败向调用方传播，已登记任务保留在原台账，后续核对沿原任务 ID 进行。
- 完成先按原租户与 ID 读取，再更新同一任务，SQL 尝试次数沿原原子增量。运行日志失败向调用方传播，已完成任务及结果保留在原台账。
- 批次按 `queued` 与原时间条件筛选，最多 10 条逐个运行，单项失败立即传播。unknown 的核对与恢复由原宿主的可信操作和收据处理。
- 入队日志沿原 `mock-job-runner` 与 `externalCallSkipped` 字段表示模拟登记。正式业务执行和 Provider 结果由原执行者记录。

原 `runJob/runDueJobs` 与仓储 `getJob/finishJob` 委托同一公共实现。数据交换模板、文件结果和打印由原宿主供给。独立公共宿主持有 AsyncJob 模型与同字段迁移，任务 HTTP、Core 执行注册与恢复由宿主沿原权限、操作键和收据接入。[平台数据计划](../../../../../apps/platform-api/src/platform-data.ts)
