# Rental 数据接入

Rental 自己维护121个模型和5个枚举。公共账号、角色、授权、配置与台账由底座维护；AI 模型属于可选 AI 模块。未安装 Rental 时，公共 schema 和迁移无需包含这些业务表。[业务模型](schema.prisma)

## 组合新宿主

1. 读取底座公共 schema 与本包 `prisma/schema.prisma`，调用 `createRentalPrismaContribution(rentalSchema)`，交给公共 `composeCorePrismaSchema`。宿主在自己的目录生成一个组合 Client。原公共关系由本包提供，业务字段无需复制到平台文件。[源码组合](../src/prisma-schema.ts)
2. 调用 `createRentalMysqlDataPlan()`，将 `publicForeignKeys` 传给公共 `createPublicPlatformDataPlan`。两份计划分别检查公共表和 Rental 表；迁移执行状态从同一数据库的原 `_prisma_migrations` 读取。[Rental 数据计划](../src/mysql-data.ts) · [公共数据计划](../../../apps/platform-api/src/platform-data.ts) · [原账读取](../../core-host/src/mysql-deployment.ts)
3. 固定包和版本后，使用公共 `createCoreMigrationDeployment` 准备公共迁移与所选 Core 的新部署目录，再按部署流程应用、初始化与验证。准备文件、应用迁移和租户授权分别办理。[部署组合](../../core-contracts/src/deployment.ts) · [完整接入步骤](../../core-contracts/README.md#五步快速接入)

```ts
import { composeCorePrismaSchema } from "@rental-os/core-contracts/prisma";
import { createRentalPrismaContribution } from "@rental-os/rental-core/prisma-schema";
import { createRentalMysqlDataPlan } from "@rental-os/rental-core/mysql-data";

const schema = composeCorePrismaSchema(publicSchema, [createRentalPrismaContribution(rentalSchema)]);
const rentalData = createRentalMysqlDataPlan();
const platformData = createPublicPlatformDataPlan(rentalData.publicForeignKeys);
```

`publicSchema`、`rentalSchema` 为受控安装包读取的源码；`createPublicPlatformDataPlan` 由宿主导入。生成器和输出目录归宿主，同一组合使用同一个数据库与事务。数据计划读取包内固定 SQL 和摘要，不连接数据库、不执行 DDL；调用 `readPhysical` 才读取实际结构。

## 迁移与历史

新空库先应用公共链，再应用本包[Rental 初始迁移](migrations/20261119030000_rental_initial/migration.sql)。该迁移创建业务表，追加原 AuthSession／OperationLog 关系，保留原批准、配置快照和检查修订的7个 CHECK，以及原操作键的二进制排序规则。初始迁移不填充示范业务、不更新历史对象，也不执行模型或资金操作。

Rental 数据版本、可读范围、迁移 ID、包内路径和原文摘要由同一[发行声明](../src/data.ts)提供。包内目录名定位 SQL；部署目录及原账名称使用公共 `corePrismaMigrationName`，与 `deploymentMigrationNames` 保持一致。已应用 SQL 不因换行、编码或打包变化改写。

已有混合数据库继续使用原[组合迁移链](../../../apps/api/prisma/migrations)及原收据。不能将新空库基线套用已有库，或把新计划的版本当作存量数据已经迁移。存量切换、备份、迁移与回退另按对应部署验证办理。

普通业务、客户、企业、渠道、支付和检查的物理字段及业务外键沿原 schema 保留。无 AI 组合省略 AI 的反向关系，原组合 schema 继续保留可选 AI 的历史关联；启用 AI 的新组合还须接其正式数据贡献。
