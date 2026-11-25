# Rental 数据接入

Rental 自己维护121个模型、5个枚举和6张由 raw SQL 仓储使用的换货工作流表。公共账号、角色、授权、配置与台账由底座维护，AI 模型属于可选 AI 模块。业务模型与换货迁移共同构成 Rental 的物理数据范围。[业务模型](schema.prisma) · [换货工作流迁移](migrations/20261125010000_rental_exchange_workflow/migration.sql)

## 组合新宿主

1. 从部署锁和明确的已准备包目录调用 `requireRentalDataPackage(directory, pin, hostVersions)`。它核对实际完整包、清单、实现/数据版本、范围、schema 和原迁移摘要；缺少标准清单的源码目录不能充当安装证明。将返回的 `prisma` 贡献交给公共 `composeCorePrismaSchema`，宿主在自己的目录生成组合 Client。[固定包读取](../src/data-package.ts) · [源码组合](../src/prisma-schema.ts)
2. 使用同次固定包读取返回的 `dataPlan`，将其 `publicForeignKeys` 传给公共 `createPublicPlatformDataPlan`。两份计划分别检查公共表和 Rental 表；迁移执行状态从同一数据库的原 `_prisma_migrations` 读取。原 `createRentalMysqlDataPlan()` 保留给包内已核定源码消费者，新宿主不从另一作者目录混读迁移。[Rental 数据计划](../src/mysql-data.ts) · [公共数据计划](../../../apps/platform-api/src/platform-data.ts) · [原账读取](../../core-host/src/mysql-deployment.ts)
3. 固定包和版本后，使用公共 `createCoreMigrationDeployment` 准备公共迁移与所选 Core 的新部署目录，再按部署流程应用、初始化与验证。准备文件、应用迁移和租户授权分别办理。[部署组合](../../core-contracts/src/deployment.ts) · [完整接入步骤](../../core-contracts/README.md#五步快速接入)

```ts
import { composeCorePrismaSchema } from "@rental-os/core-contracts/prisma";
import { requireRentalDataPackage } from "@rental-os/rental-core/data-package";

const rental = requireRentalDataPackage(installedDirectory, rentalPin, platformRelease.versions);
const schema = composeCorePrismaSchema(publicSchema, [rental.prisma]);
const platformData = createPublicPlatformDataPlan(rental.dataPlan.publicForeignKeys);
```

`publicSchema` 为固定公共发行的源码，`rentalPin` 来自部署锁；`createPublicPlatformDataPlan` 由宿主导入。生成器和输出目录归宿主，同一组合使用同一个数据库与事务。数据计划读取包内固定 SQL 和摘要，不连接数据库、不执行 DDL；调用 `readPhysical` 才读取实际结构。

## 构建与初始化

[发行工厂](../src/package.ts) `createRentalPackage` 接收已构建代码、声明、客户端、数据和许可的完整字节 Map，以及真实固定 Core 来源、底座来源和公开接入手册。工厂检查 npm 正式出口和相对依赖，按同一数据发行生成 `core.manifest.json`、`CORE_GUIDE.md` 与确定性归档。仅有源码或缺少构建文件时会失败；生成包不代表已经安装、迁移或放行业务。原权限码保留在 HTTP/worker 的真实策略中，清单不新增一套替代授权。

空库完成迁移后，部署人员可在显式事务中调用 [initializeRentalCategories](../src/initialize-categories.ts)。它只维护原四个内置品类、当前库 legacy 快照和不可变内置版本，不创建演示租户、账号、经营空间或 Core 授权。调用方提供操作者与时间，并负责原部署权限和事务提交；失败回滚同一事务。

重复初始化不覆盖已保存品类正文、版本政策或既有推荐；发现同 ID 的发布正文不同则拒绝。已有品类缺少推荐时仍沿原 Seed 指向 legacy 快照，不能把当前代码当作历史运行依据。业务空间和原绑定沿正式业务入口创建，普通升级不重跑业务 Seed。

## 迁移与历史

新空库先应用公共链，再应用本包[Rental 初始迁移](migrations/20261119030000_rental_initial/migration.sql)。该迁移创建业务表，追加原 AuthSession／OperationLog 关系，保留原批准、配置快照和检查修订的7个 CHECK，以及原操作键的二进制排序规则。初始迁移不填充示范业务、不更新历史对象，也不执行模型或资金操作。

随后应用[换货工作流前进迁移](migrations/20261125010000_rental_exchange_workflow/migration.sql)，物理数据版本推进至 `0.1.1`。原七份换货 SQL 的最终结构承接为六表，包含企业审批与费用确认、检查准备、媒体及完成 claim、媒体使用、客户同意和原执行收据。原操作键、字段默认、状态、唯一约束、外键及排序规则由同一迁移提供，MySQL 原默认外键更新动作显式写为 `RESTRICT`。SQL 文件头保留七份来源目录名。

| 表 | 持久事实 |
| --- | --- |
| `enterprise_exchange_approvals` | 换货费用审批、员工费用确认和修订 |
| `rental_exchange_inspection_preparations` | 原检查准备及请求、载荷摘要 |
| `rental_exchange_inspection_media` | 原媒体绑定、完成占用和完成证据 |
| `rental_exchange_inspection_media_uses` | 媒体与原检查准备的使用关联 |
| `rental_exchange_inspection_consents` | 原客户同意及操作键 |
| `rental_approved_exchange_executions` | 批准、准备、同意和 Core 变更的原执行收据 |

六表进入同一物理数据计划。部署观察同时核原迁移账和实际表、列、约束，任一表缺失均拒绝 Rental 准入。原独立 `0.1.0` 数据库通过追加本迁移升级，已应用的初始迁移保留原摘要。

绑定的可读范围继续为 `>=0.1.0 <0.2.0`。在完整的新物理版本和两份迁移收据核定后，原 `dataVersion=0.1.0` 绑定仍沿原经营空间读取就绪状态，保留其授权、配置与绑定修订。部署准入另外要求观察版本等于本版 `0.1.1` 且完整迁移链匹配，未迁移库由该检查拒绝。

旧 Rental `0.1.12` 实现的数据观察会拒绝新增的所属迁移。程序回退须使用经过实际兼容验证的版本，或由部署负责人按备份恢复方案处理数据库与程序组合，原可读范围声明不能作为升级后回退成功的依据。已有混合库的原七份迁移及数据继续沿原链核对，切换独立迁移链须另行核定。

Rental 数据版本、可读范围、迁移 ID、包内路径和原文摘要由同一[发行声明](../src/data.ts)提供。包内目录名定位 SQL；部署目录及原账名称使用公共 `corePrismaMigrationName`，与 `deploymentMigrationNames` 保持一致。已应用 SQL 不因换行、编码或打包变化改写。

已有混合数据库继续使用原[组合迁移链](../../../apps/api/prisma/migrations)及原收据。不能将新空库基线套用已有库，或把新计划的版本当作存量数据已经迁移。存量切换、备份、迁移与回退另按对应部署验证办理。

普通业务、客户、企业、渠道、支付和检查的物理字段及业务外键沿原 schema 保留。无 AI 组合省略 AI 的反向关系，原组合 schema 继续保留可选 AI 的历史关联；启用 AI 的新组合还须接其正式数据贡献。
