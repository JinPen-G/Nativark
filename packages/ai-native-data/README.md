# AI Native 数据贡献

本包承接原 AI Native 的持久模型和 SQL 材料，供显式选择 AI 的宿主在同一数据库、同一 Prisma Client 和原业务事务中使用。Runtime、Gateway、Worker、租户授权与原财务 / 删除账由各自服务负责，数据贡献归独立平台能力 `ai-native`。

本版提供固定数据贡献、完整构建包校验、新库候选及 MySQL 结构计划。公共数据为 40 模型、`0.1.8`，Rental 为 121 模型、`0.1.0`，选择本包再加入原 AI 的 86 模型和 16 枚举，组合为 **247 模型、35 枚举**。原 API 为 241 模型，差出的 6 个对象归平台 Core 访问、绑定及操作。固定材料与前置以 [provenance](prisma/provenance.json) 和 [preparation](src/preparation.ts) 为准。

## 入口与组合

- `createAiNativeDataContribution(files)` 接收同一固定包的字节快照，核 schema、来源清单和 58 份迁移的路径 / SHA-256，返回 `platform-capability / ai-native` 所有者。`AI_NATIVE_DATA_FILES` 列出 60 份必需数据文件，未知 `prisma/` 材料、缺项、空文件或摘要变化拒绝。`AI_NATIVE_DATA_SHA256` 仅指这些有序路径 / 摘要的指纹，完整包另有归档摘要。[data.ts](src/data.ts)
- `composeAiNativePrismaSchema(base, contribution)` 在**已组合公共与 Rental 的源码**上追加 AI 模型及 21 条原关系回指。公共 40 模型单独作为 base 缺少 Rental 关系目标，重复加入 AI 也拒绝。schema 使用公共纯组合器，业务 Core 清单由宿主单独核定。[prisma-schema.ts](src/prisma-schema.ts) · [回指](src/prisma-relations.ts)
- `createAiNativeDataPreparation({ baseSchema, contribution })` 返回新的内存文件集合，包含组合 schema、58 份迁移和 `ai-native.data.candidate.json`。状态固定 `prepared / pending`，结果给出完整包 / 部署与迁移执行缺口。保存、Client 生成、连接和 DDL 由所属宿主的独立入口办理。[preparation.ts](src/preparation.ts)
- `createAiNativeDataRelease({ files, source })` 锁定完整构建包与归档摘要，`readAiNativeDataPackage` 核字节快照，`requireAiNativeDataPackage` 核普通安装目录。包须有 data、prisma-schema、preparation、data-package、mysql-data 五个正式出口的真实 JS / 声明及 schema、SQL、说明和许可，缺实际构建入口拒绝。[data-package.ts](src/data-package.ts) · [正式出口](package.json)
- `createAiNativeMysqlDataPlanFromContribution(contribution)` 从同一固定贡献形成 MySQL 计划，核实际表、列、索引、CHECK / 外键，供原迁移账观察器使用。正式导入为 `@rental-os/ai-native-data/mysql-data`。[mysql-data.ts](src/mysql-data.ts)

宿主供给所选 publicSchema、已核 Rental 贡献和同一固定包的 aiDataFiles，再按下列顺序组合。保存候选沿已有只写新目录、失败清理的入口，完整锁与当前组合分别保管。

```ts
import { composeCorePrismaSchema } from "@rental-os/core-contracts/prisma";
import { createAiNativeDataContribution } from "@rental-os/ai-native-data/data";
import { createAiNativeDataPreparation } from "@rental-os/ai-native-data/preparation";

const ai = createAiNativeDataContribution(aiDataFiles);
const baseSchema = composeCorePrismaSchema(publicSchema, [rental.prisma]);
const prepared = createAiNativeDataPreparation({ baseSchema, contribution: ai });
// prepared.schema 供本宿主独占 generated/client；本函数不执行 generate。
// prepared.files 只包含 AI 候选材料，不是完整可执行部署锁。
```

`AI_NATIVE_DATA_PREREQUISITES` 记录本版材料依赖的公共／Rental 数据版本、Rental schema 和 initial 摘要。它是部署前置要求，不是已经检查过数据库的证明。base 的摘要写入候选，固定包、可选能力版本及迁移顺序仍须由宿主的正式部署合同共同锁定。

## 持久模型与服务消费者

完整模型及关系以[本包 schema](prisma/schema.prisma)和[来源清单](prisma/provenance.json)为准。按服务接点阅读下列模型族，再沿[原请求工厂](../ai-native-server/src/runtime/ai-native-application.providers.ts)和[独立 AI 装配](../../apps/rental-api/src/ai-composition.ts)定位实际调用方。表中导航覆盖原持久职责，方法是否发布由所选宿主的 HTTP 与工具政策裁定。

| 持久职责 | 仓储与服务入口 | 提交及读取边界 |
| --- | --- | --- |
| 模型配置、供应商与能力证据 | [租户模型配置](../ai-native-server/src/runtime/tenant-model-config.repository.ts)、[Provider 主档](../ai-native-server/src/runtime/provider-profile.repository.ts)与[模型设置工厂](../ai-native-server/src/runtime/model-settings.application.ts) | 原配置修订、凭据与能力证据由服务端核定，历史调用继续使用原配置引用 |
| 调用准入、用量预占及结算 | [准入仓储](../ai-native-server/src/runtime/invocation-admission.repository.ts)、[用量仓储](../ai-native-server/src/runtime/usage-settlement.repository.ts)与[Gateway 绑定](../ai-native-server/src/runtime/budget/prisma-gateway-invocation-bindings.ts) | 原 holder、调用键、派发与结算收据保持关联，unknown 只核原调用 |
| 模型财务预算、额度与价格依据 | [预算仓储](../ai-native-server/src/runtime/budget/prisma-budget.repository.ts)、[租户额度](../ai-native-server/src/runtime/budget/ai-credit.service.ts)与[冻结价格](../ai-native-server/src/runtime/budget/prisma-gateway-pricing-records.ts) | 预占、结算和原财务账由唯一 Gateway 消费，金额、tokens 与 calls 沿各自原契约 |
| 任务、Run、Step、计划、结果及累计资源 | [任务仓储](../ai-native-server/src/runtime/ai-task.repository.ts)、[计划依据](../ai-native-server/src/runtime/runner/prisma-task-plan-policy.repository.ts)、[累计资源](../ai-native-server/src/runtime/runner/prisma-task-execution-budget.repository.ts)与[恢复快照](../ai-native-server/src/runtime/runner/prisma-task-recovery-snapshot.repository.ts) | 原租约、修订、执行阶段和资源占用随同一 Task 保留，恢复读取原效果及收据 |
| 提案、批准与原业务消费 | [提案仓储](../ai-native-server/src/runtime/ai-proposal-repository.ts)、[批准仓储](../ai-native-server/src/runtime/ai-approval-repository.ts)与[批准消费](../ai-native-server/src/runtime/prisma-approval-consumption.repository.ts) | 材料、决定、重准备和 Core 消费分别核验，原批准消费参加原业务事务 |
| 会话、原请求、报价选择及人工回答 | [会话仓储](../ai-native-server/src/runtime/conversation.repository.ts)、[原请求](../ai-native-server/src/runtime/task-request/prisma-original-request.repository.ts)、[报价选择](../ai-native-server/src/runtime/task-request/prisma-quote-selection.repository.ts)与[回答收据](../ai-native-server/src/runtime/task-input/prisma-task-input.repository.ts) | 当前主体读取原请求和回答，保存与显式续程分开，释放会话前继续核未决效果 |
| 客户场景、政策、输入和预约交接 | [场景材料](../ai-native-server/src/runtime/scenes/prisma-client-scene-material.repository.ts)、[预约仓储](../ai-native-server/src/runtime/scenes/prisma-client-booking.repository.ts)与[客户请求应用](../ai-native-server/src/runtime/scenes/client-request.application.ts) | 同一客户会话、本人对象和已发布来源复验，草稿、交接及原操作分别保存 |
| 自动化政策、授权、失败输入与原事件 | [政策管理](../ai-native-server/src/runtime/automation/human-automation-policy-management.service.ts)、[失败输入](../ai-native-server/src/runtime/automation/automation-failure-task.service.ts)与[失败出箱](../ai-native-server/src/business-events/prisma-business-failure-outbox.ts) | 原主体、授权、材料和去重依据保留，业务事实与出箱共同提交，执行另核当前权威 |
| 知识、版本、分块、ACL、索引与结构化记忆 | [知识组合](../ai-native-server/src/runtime/knowledge/persistent-knowledge.composition.ts)、[知识仓储](../ai-native-server/src/runtime/knowledge/prisma-knowledge.repository.ts)与[记忆仓储](../ai-native-server/src/runtime/knowledge/prisma-memory.repository.ts) | 原文件绑定、版本、当前 ACL、操作与确认收据共同裁定读取和写入，索引代次由知识服务维护 |
| 检查草稿、操作与冻结影像绑定 | [检查仓储](../ai-native-server/src/runtime/inspection-assist/prisma-inspection-draft.repository.ts)与[影像权威](../ai-native-server/src/runtime/inspection-assist/prisma-inspection-evidence.authority.ts) | 原检查目标、文件摘要及当前员工范围复验，识别材料与正式检查执行分别办理 |
| 本地业务政策及原保存收据 | [政策仓储](../ai-native-server/src/runtime/desktop-business/desktop-business-policy.repository.ts)与[请求应用](../ai-native-server/src/runtime/desktop-business/desktop-business.application.ts) | 参数化 SQL 保存当前租户/空间的修订和原键，业务工具继续核正式授权 |
| 正文保留、删除账与未决效果 | [保留服务](../ai-native-server/src/runtime/privacy/retention.service.ts)、[平台保留](../ai-native-server/src/runtime/privacy/platform-retention.service.ts)与[未决效果](../ai-native-server/src/runtime/task-unresolved-effects.ts) | 原密文、未决占用、删除 CAS 和稳定收据由维护事务处理，缺证据保持不可用 |

## 原业务与维护链的表归属

| 原接点 | 直接及必须继续保留的关联 | 数据所有者 |
| --- | --- | --- |
| [inspection 失败出箱](../ai-native-server/src/business-events/prisma-business-failure-outbox.ts) | `RentalInspectionRecord`、`AiBusinessFailureOutbox`；`automationInputs.some` 保留 `AiAutomationInput` 关系和原去重语义 | 检查事实属于 Rental；事件与自动化输入属于 AI |
| [return-exception-source](../ai-native-server/src/business-events/return-exception-source.ts) | 读取原检查 JSON、revision、orderId 并计算指纹，不创建表 | Rental 原检查事实 |
| [通知草稿正文读取](../ai-native-server/src/privacy/notification-draft-reader.ts) | `RentalNotificationLog` 与 `AiDataErasure` 同一原 ID／哈希删除收据 | 草稿日志属于 Rental，删除账属于 AI |
| [通知正文清理](../ai-native-server/src/runtime/privacy/retention-notification-draft.ts) | 出箱、自动化输入、Task／Run 的真实关联；[未决效果](../ai-native-server/src/runtime/task-unresolved-effects.ts)继续核 Step、ApprovalConsumption、执行资源、Gateway、admission、reservation 及原账 | 沿原 AI 保留链；不以无关任务无限 hold，也不以空正文伪造删除 |
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

1. 在已有 npm workspace 依赖环境运行 `npm run build -w @rental-os/ai-native-data`，从同一构建包取得完整字节集合，以 `createAiNativeDataRelease({ files, source })` 生成固定发行资料。`source` 是实际发行提交，原 SQL 来源由 provenance 保存。构建前置以 [包脚本](package.json) 为准。
2. 将发行资料加入所选部署锁的 `dataCapabilities`，使用 `checkPlatformDataCapabilities(lock)` 核数据前置。Core 安装检查使用 `coreDeploymentHostVersions(lock)` 的同一版本视图。本版材料只支持公共数据 `0.1.8` 与 Rental 数据 `0.1.0` 的已声明范围和 initial 摘要。
3. 以 `createCoreMigrationDeployment({ lock, platform, cores, dataCapabilities })` 准备完整迁移集合。`dataCapabilities` 是能力 ID 到完整已核包字节的 Map，必须覆盖锁中的全部所选能力。另用上面的 schema 组合器形成同一宿主的完整 schema，再沿宿主准备入口保存新的待部署目录。

部署组合核对公共 → Core → 平台能力的实际目录排序，缺包、摘要变化或混入未选择能力都会拒绝。`createAiNativeDataPreparation` 仅返回 AI 材料，完整部署与最终 schema 由宿主组合；结果仍为 `prepared / pending`。

更新已选择的 AI 数据能力时，向 `planCoreUpdate` 提交 `{ kind: "platform-capability", capabilityId: "ai-native", release }`。预检保留底座及其他 Core／能力，只核前进版本、不可变旧迁移、当前物理版本和原执行状态。缺观察、同版本资料改写、降版、unknown 或未选模块还需迁移时都拒绝；它不执行更新或补写成功账。[独立更新合同](../core-contracts/README.md#分别更新底座或一个-core)

宿主向[原账观察器](../core-host/src/mysql-deployment.ts)显式登记能力的 `data`、原迁移名称与真实 `readPhysical`，再通过 `catalogue.requireDataCapabilityAvailable("ai-native")` 核准入。Core 的 `manifest.requires` 只声明所需宿主能力版本；业务权限、工具发布、Gateway、预算及批准继续按原入口执行。

## 实际宿主消费者

- 首次 schema 准备使用源码入口的 `rental-ai` 模式，先公共与 Rental，再追加同一 AI 贡献，供本宿主独占 generated/client。数据包与生成声明的模式须一致。[schema 准备](../../scripts/prepare-selected-prisma-schema.cjs) · [所选 Client 编译器](../../scripts/build-selected-prisma.cjs)
- `createRentalDeploymentFiles` 核固定公共、Rental 及显式 AI 完整包，组合最终 schema / 迁移 / 部署锁。CLI 只写本宿主的新候选目录，结果保持 prepared / pending。[部署准备](../../apps/rental-api/src/prepare-deployment.ts)
- `composeRentalAiApplication` 从部署锁定位同一安装包，用 requireAiNativeDataPackage 和 MySQL 计划供给实际装配。原账 / 物理观察由同一 Native 提供，AI 请求再核 requireDataCapabilityAvailable("ai-native")，普通 Rental 使用自己的原准入路径。[AI 装配](../../apps/rental-api/src/ai-assembly.ts) · [同一宿主](../../apps/rental-api/src/assembly.ts) · [宿主构建与运行](../../apps/rental-api/README.md)

本版依赖 Rental 的原关联，公共 40 模型宿主须先具备已声明的 Rental 数据前置。选择数据、准备迁移、当前物理 / 原账可用和 AI 工具发布各由对应入口核定。

## 真实物理观察与旧库边界

通过正式 MySQL 计划把固定贡献交给宿主的同一原账观察器。

```ts
import { createAiNativeMysqlDataPlanFromContribution } from "@rental-os/ai-native-data/mysql-data";
import { createMysqlCoreDeploymentObservation } from "@rental-os/core-host/mysql-deployment";

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

## 验证入口与证据范围

| 现有入口 | 核对内容 | 证据范围 |
| --- | --- | --- |
| [所选源码类型](../../scripts/check-selected-prisma-types.cjs) | rental-ai 组合、官方 Prisma 5.22 声明及所选源码 / 出口 | WASM / generator 与严格编译只驻内存，真实 Client 和数据库另验 |
| [固定发行](../../scripts/verify-rental-distribution.cjs) | 明确 --commit 的真实配置 emit、AI 完整包 / 归档 / 安装准备和正式出口 | 固定 Git 树与内存产物，冷安装 / Docker / OS 部署另验 |
| [宿主打包](../../tests/rental-host-package.test.cjs) | 普通 / AI 同版包、部署锁、所选 Client 与 CLI 文件运输 | 显式内存文件 / 运输 fixture，真实迁移与启动另验 |
| [AI 宿主组合](../../apps/rental-api/test/ai-composition.test.cjs) | 同一数据贡献与原 AI / Rental 依赖、HTTP 和恢复消费者 | 依赖、SQL、授权与外部运输按用例明确的 fixture 取证 |

本版 schema 与来源材料可逐字节核 102 个原模型 / 枚举块、58 份 SQL 和所有提取 / 排除范围，组合目标为 247 模型 / 35 枚举。createAiNativeDataPreparation 输出 60 文件并保持 pending，完整构建包以五个真实出口及固定摘要另行校验。阶段执行次数、命令与固定版本保留在原开发记录。

运行前读取上述脚本及其依赖 / 写入范围，按原离线守卫和本树绝对任务目录准备 audit / TEMP / TMP / 缓存。类型、来源、内存构建和结构 fixture 与真实安装 / 数据库证据分别记录。[离线守卫](../../tests/fixtures/ai-native/prisma-offline-preload.cjs) · [验证与清理规则](../../AGENTS.md#修改验证与交付)

候选仍待实际宿主执行 DDL / 迁移与原账 / 物理观察。B02 旧库升级 / 备份恢复、正文保留清理、HTTP / 模型 / 供应商及生产发布分别按原范围取证，prepared / pending 和结构观察各保留自身含义。
