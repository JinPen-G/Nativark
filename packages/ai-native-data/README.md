# AI Native 数据贡献

本包承接原 AI Native 的持久模型和 SQL 材料，供选择 AI 公共能力的宿主在同一数据库、同一 Prisma Client 和原业务事务中使用。它不提供 Runtime、Gateway、Worker、租户授权、种子或新的财务／删除账本，也不注册成业务 Core。

当前产物是可校验的源码与新库数据候选。公共数据仍为 40 模型、`0.1.8`，Rental 仍为 121 模型、`0.1.0`；选择本包再加入原 AI 的 86 模型和 16 枚举，组合结果为 **247 模型、35 枚举**。原 API 的 241 模型与其相差的 6 个对象是新增平台 Core 访问、绑定及操作模型。原 API 与公共／Rental 的模型差集中只有这 86 个 AI 模型，没有旧车辆域模型或未归属业务表。

## 入口与组合

- [data.ts](src/data.ts)：`createAiNativeDataContribution(files)` 接收同一固定包的字节快照，核对 schema、来源清单和 58 份迁移的路径及 SHA-256，返回独立 `platform-capability / ai-native` 所有者。`AI_NATIVE_DATA_FILES` 列出必需的 60 份数据文件；未知 `prisma/` 材料、缺项、空文件或摘要变化均拒绝。`AI_NATIVE_DATA_SHA256` 是这些有序路径／摘要的指纹，不是整个 npm 包、构建或部署摘要。
- [prisma-schema.ts](src/prisma-schema.ts)：`composeAiNativePrismaSchema(base, contribution)` 在**已经组合公共与 Rental 的源码**上追加 AI 模型和 [21 条原关系回指](src/prisma-relations.ts)。它使用公共纯 schema 组合器，但不把 AI 加入业务 Core 清单。公共 40 模型单独作为 base 会因缺少 Rental 关系目标而拒绝；重复加入 AI 也拒绝。
- [preparation.ts](src/preparation.ts)：`createAiNativeDataPreparation({ baseSchema, contribution })` 返回新的内存文件集合：组合 schema、58 份 AI 迁移和 `ai-native.data.candidate.json`。状态固定为 `prepared / pending`，返回实际缺口；不读 `.env`、生成 Client、连接数据库、执行 DDL 或覆盖已有文件。
- [data-package.ts](src/data-package.ts)：`createAiNativeDataRelease({ files, source })` 锁定完整构建包的文件集合与归档摘要；`readAiNativeDataPackage` 校验字节快照，`requireAiNativeDataPackage` 校验普通安装目录。包须包含 `data`、`prisma-schema`、`preparation`、`data-package`、`mysql-data` 五个正式出口的真实 JS 与声明，以及 schema、SQL、说明和许可；仅有源码或 SQL 指纹不能通过。
- [mysql-data.ts](src/mysql-data.ts)：正式 `@rental-os/ai-native-data/mysql-data` 的 `createAiNativeMysqlDataPlanFromContribution(contribution)` 从同一固定包形成 MySQL 计划，读取实际表、列、索引、CHECK 和外键，供原迁移账观察器使用。

宿主顺序如下。数据字节须来自同一固定安装包；公共与 Rental 仍按各自发行核定。宿主保存候选时沿已有“只写新目录、失败清理、不覆盖当前组合”的入口。

```ts
const ai = createAiNativeDataContribution(aiDataFiles);
const baseSchema = composeCorePrismaSchema(publicSchema, [rental.prisma]);
const prepared = createAiNativeDataPreparation({ baseSchema, contribution: ai });
// prepared.schema 供本宿主独占 generated/client；本函数不执行 generate。
// prepared.files 只包含 AI 候选材料，不是完整可执行部署锁。
```

`AI_NATIVE_DATA_PREREQUISITES` 记录本版材料依赖的公共／Rental 数据版本、Rental schema 和 initial 摘要。它是部署前置要求，不是已经检查过数据库的证明。base 的摘要写入候选，固定包、可选能力版本及迁移顺序仍须由宿主的正式部署合同共同锁定。

## 原业务与维护链的表归属

| 原接点 | 直接及必须继续保留的关联 | 数据所有者 |
| --- | --- | --- |
| [inspection 失败出箱](../../apps/api/src/modules/ai-native/business-events/prisma-business-failure-outbox.ts) | `RentalInspectionRecord`、`AiBusinessFailureOutbox`；`automationInputs.some` 保留 `AiAutomationInput` 关系和原去重语义 | 检查事实属于 Rental；事件与自动化输入属于 AI |
| [return-exception-source](../../apps/api/src/modules/ai-native/business-events/return-exception-source.ts) | 读取原检查 JSON、revision、orderId 并计算指纹，不创建表 | Rental 原检查事实 |
| 通知草稿正文读取 | `RentalNotificationLog` 与 `AiDataErasure` 同一原 ID／哈希删除收据 | 草稿日志属于 Rental，删除账属于 AI |
| [通知正文清理](../../apps/api/src/modules/ai-native/privacy/retention-notification-draft.ts) | 出箱、自动化输入、Task／Run 的真实关联；[未决效果](../../apps/api/src/modules/ai-native/task-unresolved-effects.ts)继续核 Step、ApprovalConsumption、执行资源、Gateway、admission、reservation 及原账 | 沿原 AI 保留链；不以无关任务无限 hold，也不以空正文伪造删除 |
| 通知恢复副本 | 同一事务内锁定 `RentalBusinessStateSnapshot`，只处理目标通知 JSON | Rental 快照；AI 维护服务拥有原受权操作 |
| 平台正文维护 | 原 `AiScope`、Task／Request 与公共 `OperationLog` 删除记录，平台归属仍为 null tenant/workspace | AI 模型与公共审计分别保留原所有者 |

出箱的原 Prisma 关系闭包已经连接 52 个 AI 模型。完整保留链还按原仓储与正文 codec 访问其他模型，因此本包完整承接 86 个原 AI 持久模型，不删关系来缩小 Client。所有名称、表名、枚举和原字节范围见 [provenance.json](prisma/provenance.json)。

跨包引用只指向已有 `Tenant`、`FileAsset`、`BusinessWorkspace`、`RentalNotificationLog`、`RentalPaymentRefund`、`RentalInspectionRecord`、`RentalOrder`、`RentalFulfillmentLocation`、`TenantRentalProfile`、`RentalCoreStateSnapshot` 和 `RentalTenantBusinessSettings`。不新增这些对象的列、索引或事实。

## SQL 来源与新库边界

固定来源为提交 `a3ba65b408fbc1be97f0f6e1170330b256a1ab29` 的 `apps/api/prisma/schema.prisma` 和原迁移。来源 schema 的 Git blob SHA-256 为 `ba38e13d620d7fca3205410992e4d483f14d3ca6e8ccab532e035b7376b3b1af`。材料从 Git blob 按原字节提取，不按工作树 CRLF 重编码；schema 的 102 个模型／枚举块与其原说明保持原文。

59 份原迁移涉及 AI，本包形成 58 份**仅适用于新库候选**的材料，建表覆盖全部 86 个模型。每份材料的原文件摘要、输出摘要、零起始／尾部不包含的 byte range 和排除部分均登记在 [来源清单](prisma/provenance.json)。[artifacts.ts](src/artifacts.ts) 固定本版材料摘要。

| 原迁移 | 本包处理 | 留在原所有者的部分 |
| --- | --- | --- |
| `20261003050000_ai_b02_scope_preserve` | 只提取原 `ai_legacy_b02_scopes` 的完整 CREATE 语句，保留字段说明 | 旧库检查、原 178 条收据约束、归档与改名桥接仍留原升级链 |
| `20261003065000_ai_b02_scope_project` | 不进入新库材料 | 整份原迁移依赖原 migration_name、B02 归档和旧 profile 外键，不能改名重放 |
| `20261008123000_ai_business_failure_events` | 原 AI 出箱 CREATE 起的字节 | 通知与退款两条 ALTER 已由 Rental initial 承接 |
| `20261011153000_ai_return_exception_events` | 原 AI 出箱 ALTER 起的字节 | 检查 revision／updatedAt／复合唯一键／CHECK 已由 Rental initial 承接 |
| `20261111220000_ai_failure_resource_sources` | 原 AI 出箱 ALTER 起的字节 | 两个配置源的 revision／CHECK 及 business-settings 唯一键已由 Rental initial 承接 |
| 其他 54 份 | 完整原 Git blob | 无 SQL 改写 |

材料中的 AI ALTER、CREATE INDEX、CHECK、外键和原 backfill SQL 保留原文；没有写入 Rental／公共表的 ALTER，也没有旧 `_prisma_migrations` 名称检查进入新候选。原始 schema 和迁移文件不变。

新候选名称为 `platform-capability.ai-native.<原时间戳>`，正式部署组合在公共及 `core.rental.*` 之后按原顺序准备 AI 材料。`originalName` 只说明来源，**不能**把旧库同名收据映射成已执行本候选：部分 SQL 是提取件，其摘要与原文件不同。旧完整库继续走原迁移、原 B02 检查和备份恢复链；本包没有旧库升级、清空或 initial 覆盖入口。

## 显式选装与独立更新

[部署锁](../core-contracts/src/update.ts)通过可省略的 `dataCapabilities` 选择独立平台数据能力。[发行合同](../core-contracts/src/data-capability.ts)分别锁定实现版本、来源、完整包 SHA-256、schema／SQL 摘要及公共／Core 数据前置。未选择时保留原公共与 Core 组合；选择数据不注册业务 Core、发布工具或启动 AI 作业。

准备本包时按下面三个步骤装配。

1. 构建本包，从同一构建包取得字节集合，以 `createAiNativeDataRelease({ files, source })` 生成固定发行资料。`source` 是实际发行提交；原 SQL 来源仍由 provenance 保存。
2. 将发行资料加入所选部署锁的 `dataCapabilities`，使用 `checkPlatformDataCapabilities(lock)` 核数据前置。Core 安装检查使用 `coreDeploymentHostVersions(lock)` 的同一版本视图。本版材料只支持公共数据 `0.1.8` 与 Rental 数据 `0.1.0` 的已声明范围和 initial 摘要。
3. 以 `createCoreMigrationDeployment({ lock, platform, cores, dataCapabilities })` 准备完整迁移集合。`dataCapabilities` 是能力 ID 到完整已核包字节的 Map，必须覆盖锁中的全部所选能力。另用上面的 schema 组合器形成同一宿主的完整 schema，再沿宿主准备入口保存新的待部署目录。

部署组合核对公共 → Core → 平台能力的实际目录排序，缺包、摘要变化或混入未选择能力都会拒绝。`createAiNativeDataPreparation` 仅返回 AI 材料，完整部署与最终 schema 由宿主组合；结果仍为 `prepared / pending`。

更新已选择的 AI 数据能力时，向 `planCoreUpdate` 提交 `{ kind: "platform-capability", capabilityId: "ai-native", release }`。预检保留底座及其他 Core／能力，只核前进版本、不可变旧迁移、当前物理版本和原执行状态。缺观察、同版本资料改写、降版、unknown 或未选模块还需迁移时都拒绝；它不执行更新或补写成功账。[独立更新合同](../core-contracts/README.md#分别更新底座或一个-core)

宿主向[原账观察器](../core-host/src/mysql-deployment.ts)显式登记能力的 `data`、原迁移名称与真实 `readPhysical`，再通过 `catalogue.requireDataCapabilityAvailable("ai-native")` 核准入。Core 的 `manifest.requires` 只声明所需宿主能力版本；业务权限、工具发布、Gateway、预算及批准继续按原入口执行。

## 真实物理观察与旧库边界

通过正式 MySQL 计划把固定贡献交给宿主的同一原账观察器。

```ts
const aiPlan = createAiNativeMysqlDataPlanFromContribution(ai);
const observations = createMysqlCoreDeploymentObservation({
  database,
  platform: publicPlan,
  cores: [{ ...rentalPlan, coreId: "rental" }],
  dataCapabilities: [{ ...aiPlan, capabilityId: "ai-native" }]
});
```

[严格结构解析](../platform-core-host/src/mysql-structure.ts)和[物理读取](../platform-core-host/src/mysql-physical.ts)覆盖本版 86 表、1271 列、271 索引、77 CHECK 与128外键；支持原CREATE INDEX、MODIFY/DROP、复杂CHECK与provenance注释，未知结构或未执行约束仍拒绝。数据包使用两个窄MySQL出口，避免把HTTP/Nest目录引入纯数据合同。

唯一billingMode UPDATE按原迁移ID和语句摘要明确识别，只从结构分析分开，原SQL仍完整保留在58项迁移合同中。物理观察只证明结构；[同一原账](../core-host/src/mysql-deployment.ts)的全链checksum、实际执行顺序、finishedAt、未回滚及unknown状态共同决定准入。未匹配的legacy_unknown继续保留，不读取今天数据反推历史回填，也不自动重做或建立第二本执行账。

候选保持prepared/pending，未执行DDL或初始化；实际宿主必须核固定完整包、部署锁和当前物理/原账，再调用catalogue.requireDataCapabilityAvailable("ai-native")。旧完整库的B02桥接、原迁移名和备份恢复仍走原升级链，不能把旧账改名当新候选已执行。

## 本次验证范围

- 在原离线守卫下用 Prisma 5.22 官方 WASM 解析组合 schema，并由官方 generator 在内存生成声明：247 模型／35 枚举。86 个原 AI 模型的字段、关系、主键和唯一键语义一致，21 条回指补齐；公共组合器会省略模型级说明，比较将说明与结构分开。
- 使用真实组合声明及单独公共 40 模型声明完成严格类型核验：26 个入口、2084 个源码单元、0 个诊断。覆盖新数据模块、原出箱和 return 源、完整 privacy 模块与未决效果链，并用真实 `RentalDatabaseClient` 核原保留服务、公共依赖和同事务出箱参数，没有用类型强转掩盖模型差异。
- 固定来源核对 102 个 schema 原块、58 份 SQL 及所有提取／排除范围；SQL 建表覆盖 86 个模型，没有未知外部表引用。数据准备及 7 个拒绝路径通过，候选输出 60 个文件并保持 pending。
- 命令为带原 `prisma-offline-preload.cjs` 的短 Node stdin；最终 schema／行为、严格类型和来源核验退出码均为 0。过程中的说明字段比较和虚拟探针相对路径问题已分别修正核验输入后复验。没有落盘 Client／dist、临时文件或后台进程。

没有执行真实 MySQL DDL、迁移、物理观察、B02 旧库升级或恢复，也没有启动应用／HTTP、模型或供应商调用。完整包／部署合同已提供；真实安装、物理观察、保留清理和生产发布仍须分别取得证据。
