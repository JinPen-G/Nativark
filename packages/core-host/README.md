# 平台 Core 宿主服务

`@rental-os/core-host`维护平台自己的Core授权、成员分配和初始化绑定。当前已有管理/绑定服务、MySQL事务适配及独立迁移源码，原Auth/管理入口、实际部署注册及无Core运行宿主按PCH接线。[公共宿主接线](../platform-core-host/README.md)

## 授权和成员分配分别办理

`CoreAccessService.changeTenantGrant(actor, input)`使用正式`ChangeTenantCoreGrantSchema`，只有当前获权SaaS管理员可办理目标租户的Core开通/停用。开通要求已注册且当前部署/数据/能力可用；停用允许在业务不可用时办理，保留成员分配、绑定与数据，不触发业务初始化。

`changeMemberAssignment(actor, input)`使用`ChangeMemberCoreAssignmentSchema`，租户来自当前主体，body不能选择租户。原租户管理员仅管理自己的成员，新增分配要求租户已开通Core且当前部署可用；撤回不要求先恢复停用的Core。Core开通不自动分配全员，成员分配不赋予该Core全部业务权限。

两类写入都使用原operationId/expectedRevision。不存在记录的expectedRevision是0，保存后从1递增；同键同输入复核当前管理权限后读原收据，不回写旧状态。同键不同输入拒绝，原收据与当前状态分开。停用重开不会恢复主动撤回的成员权限，也不延长原租户统一订阅期限。

结果未知时使用 `readTenantGrantOperation(actor, { tenantId, coreId, operationId })` 或 `readMemberAssignmentOperation(actor, { coreId, userId, operationId })`。两者只读本人原结果，仍核当前管理权、租户/Core及成员；缺收据返回unavailable，不能视为可重发。已停用的部署不要求先恢复才能核对原结果。MySQL读取只锁已有锁行，零事实/收据/审计写入；取得旧收据后另读当前状态，避免把旧开通结果当当前授权。

## 当前部署注册

`createCoreDeployedCatalogue({ lock, registrations, observations })`将真实部署锁与直接导入的Core服务端贡献核对。清单、版本、源码和所选Core集合与锁一致后提供 `registrations` 及授权服务使用的 `availability`。原迁移所有者通过 `observations.read()`返回当前实际数据版本、不可变迁移摘要和执行状态。[部署目录](src/deployment.ts)

`requireRegistered`核当前受控服务组合，授权撤回可在业务数据不可用时办理。`requireAvailable`要求平台和目标Core的实际数据/完整迁移账与部署锁匹配、执行状态为ready。一个Core未就绪只影响它自己的新准入，平台公共迁移未就绪则影响所有Core。空Core组合合法。该目录保存组合时的清单快照和绑定原服务实例的方法引用；`registrations` 每次返回隔离清单，调用方修改目录副本或原输入不会替换当前登记的方法。仓储与业务状态仍由原服务实时维护，后续部署变更重新创建核定组合。

Core有HTTP入口时，组合向 `createCoreDeployedCatalogue`额外传 `http: [coreHttpContribution]`。贡献必须属于当前已登记的Core/版本并通过[公共HTTP政策检查](../core-contracts/README.md#登记core的http政策)，失败不能创建可用目录。目录的 `http.resolve`只返回当前受控政策，输出元数据为隔离副本；目录/可用性/政策方法在组合后固定，后续升级重新建立组合。Core可无HTTP贡献，但未登记路径不能据此开放。Controller实际装配、原Guard和业务提交复验仍由宿主完成。

同一业务事务需要多次核验部署时，用 `createCoreTransactionCatalogues(transaction => createCoreDeployedCatalogue(...))` 复用该事务的固定目录。传入同一个实际事务对象，SQL适配也应保持读取器身份；新事务取得独立目录。该工厂只减少清单和HTTP政策的重复解析，每次可用性核验仍读取真实迁移账与物理状态，原身份、权限、锁序和提交复验保持。根数据库读取继续使用普通目录。[Rental实际组合](../../apps/rental-api/src/assembly.ts) · [工单实际组合](../../apps/example-tickets-api/src/assembly.ts)

## 读取原迁移账与实际结构

从 `@rental-os/core-host/mysql-deployment`导入 `createMysqlCoreDeploymentObservation({ database, platform, cores, dataCapabilities })`，将返回值直接作为部署目录的 `observations`。每个模块提供自己的正式 `data`合同、与迁移ID逐项对应的原Prisma `migrationNames`，以及读取实际表/列/约束的 `readPhysical`。平台与Core均由原数据所有者提供真实检查；不能用清单版本、文件存在或刚执行过迁移代替检查结果。没有选装平台数据能力时省略 `dataCapabilities`，保持原组合。[只读适配](src/mysql-deployment.ts)

部署准入调用 `observations.read(coreId)`，物理检查限于平台、目标Core及显式登记能力；升级预检调用 `read()`检查全组合。读取器每次读取完整 `_prisma_migrations`，保留原完成收据的checksum和执行顺序，不加载logs正文。旧迁移名称按宿主的显式映射归属，正式名称按 `core.<coreId>.` 或 `platform-capability.<capabilityId>.` 精确区分。跨模块重名或冒用别的模块命名空间时拒绝登记。

本版未声明的所属迁移使该模块观察不可用，包括已完成、失败、结果未知或已标记回退的未来迁移。新增表和纯数据回填可能不改变旧表结构；Prisma回退账标记也不证明DDL或数据已恢复，不能据此允许旧实例继续运行。无法归属的公共时间戳或旧混合库记录使公共平台观察不可用；未选择Core或能力的正式命名空间不影响无依赖的其他Core。兼容回退须先核定完整原账、实际结构及历史读取条件，不能只换回旧程序。

有效回退收据不算已应用，也不证明物理DDL已经恢复；未结束收据按原失败标记返回failed或unknown，不据此声称仍running或推断完成了几条DDL。缺迁移继续保留不完整链，由部署目录和升级预检拒绝。重复未回退收据、损坏摘要、物理观察缺失或其读取异常只省略所属模块，其他已就绪且无依赖的Core仍可用；平台缺观察使全部Core新准入不可用。原迁移账读取失败或记录名称无法核定时整体拒绝，任何缺失都不补成ready。

可选平台能力通过部署锁的 `dataCapabilities` 独立固定版本与包摘要，观察项使用 `capabilityId`，执行状态必需。`catalogue.requireDataCapabilityAvailable(id)` 核所选能力、公共数据及其Core数据前置；缺项或unknown拒绝。Core只有在 `manifest.requires` 明确要求该能力时才增加对应数据门禁，普通Core不会因能力的未知执行自动停新。所需能力依赖另一Core数据时，目录读取全组合；这仍不授予跨Core业务读取或AI权限。[能力合同](../core-contracts/src/data-capability.ts) · [AI数据示例](../ai-native-data/README.md)

工单已提供 `readTicketsPhysicalData`，可以在受控宿主组合中直接传入。示例中的平台数据检查和原迁移名称必须来自目标部署已核定的真实来源；这里只建立只读观察，不登记或执行迁移。[工单检查](../example-tickets-core/src/mysql.ts)

```ts
import { createMysqlCoreDeploymentObservation } from "@rental-os/core-host/mysql-deployment";
import { readTicketsPhysicalData } from "@rental-os/example-tickets-core/mysql";

const observations = createMysqlCoreDeploymentObservation({
  database,
  platform: { data: lock.platform.data, migrationNames: platformMigrationNames, readPhysical: readPlatformPhysicalData },
  cores: [{ coreId: tickets.manifest.id, data: tickets.manifest.data,
    migrationNames: ticketsMigrationNames, readPhysical: readTicketsPhysicalData }]
});
const catalogue = createCoreDeployedCatalogue({ lock, registrations: [tickets], observations });
```

公共平台、Rental和工单宿主分别提供原迁移链与完整物理检查。[原账恢复回归](../../apps/rental-api/test/multi-core-recovery-cases.cjs)覆盖未知结果、未来所属迁移和可选能力读取失败；[宿主包回归](../../tests/rental-host-package.test.cjs)将原准备收据的底座更新、单Core更新候选重新构建并安装，用安装后的真实服务读取同一份授权、绑定和业务收据。版本候选及SQL/身份存储是明确夹具；内存安装和根模块构造不代表真实数据库迁移、服务启动或程序回退已经完成。

## 接原身份与事务

[管理服务](src/access.ts)依赖`CoreManagementExecution`和`CoreDeploymentAvailability`。前者由当前宿主提供原管理权限、目标租户/成员核验和事务；后者读取真实部署/注册，不从本地源码目录推断已经安装。没有实现这两个适配不能将页面开放为可办理状态。

MySQL实现从`@rental-os/core-host/mysql`导入`createMysqlCoreManagement(client, authority)`。`authority.authorize`先按原固定顺序锁租户/人员/角色并确认本次SaaS或租户管理权；返回的lease绑定同一原主体/目标租户/成员，`revalidate()`用于提交前检查会话/期限。`authority.audit`调用原平台同事务审计，失败抛出。MySQL适配只接驱动窄接口，不引入Rental/AI模型。

可信管理及绑定lease可供给当前事务的 `deployment` 观察。开通、分配与初始化复用该观察，原结果读取不重新取得新业务准入；未提供此字段的非SQL适配继续使用服务构造时的可用性对象。SQL公共宿主的实际供给由[统一应用](../platform-core-host/src/platform-core-application.ts)维护。

执行顺序是原人员/租户授权锁 → 本tenant/Core锁行 → 检查原操作/当前修订 → 授权或成员事实 → 原收据及审计 → 同一lease期限复核 → 提交。所有SQL参数化并带tenant/Core复合条件。不同Core不共用授权记录，旧原操作返回不覆盖后续停用或撤权。当前实现没有热部署/网络下载/业务初始化或跨库事务。

[迁移](../../apps/platform-api/prisma/migrations/20261115010000_core_access/migration.sql)只创建平台授权/成员/原操作/锁四表，不引用Rental。原迁移源码已单份移入公共宿主的Prisma迁移链，原字节保留。它尚未应用到数据库，进入真实宿主时须固定平台数据版本及迁移账；既有组合只做获准的增量迁移，不重放原历史SQL。租户/账号事实继续由原平台维护，本包不复制用户表或建立另一套登录。

## 首次绑定与原结果

`CoreBindingService.bind(actor, input)`读取已登记的Core服务端贡献，租户从原身份确定。输入为Core标识、可选自身容器、原operationId和expectedRevision，以及该Core需要时提供的初始化配置。正式输入schema来自 `@rental-os/core-contracts`，已有绑定的修订通过读取取得，初次使用0。

首次绑定在当前授权/范围锁下由Core唯一初始化schema解析配置，业务写入、平台绑定、原操作和审计同事务。没有初始化数据的轻量Core可以省略初始化器。重复相同操作读取原收据，重复键输入不同会拒绝。重开时复用原绑定，已有Core的配置调整走它自己的业务接口。[应用服务](src/binding.ts)

`readOperation(actor, input)`专门读取原初始化收据，结果为 `recorded` 或 `unavailable`，仍核当前原身份和必要历史读取权限。停用及结果未知时沿这条读取路径核对，缺收据保持准确缺失状态。

MySQL私有入口 `@rental-os/core-host/mysql-bindings` 导出 `createMysqlCoreBindings(client, authority)`，提供执行器和仅供Core仓储适配使用的事务句柄解析。`authority.lockPrincipal`先锁原身份/成员/会话/角色，返回在tenant/Core锁下复核当前授权和范围的方法。回调中的初始化器可由宿主私有适配将句柄解析为本Core的受限仓储，scope和回调寿命都核验，结束后句柄失效。`authority.audit`将原审计加入相同事务，提交前lease再核同一会话/期限。[MySQL绑定适配](src/mysql-bindings.ts)

迁移按 [001授权锁与事实](../../apps/platform-api/prisma/migrations/20261115010000_core_access/migration.sql) → [002绑定与原操作](../../apps/platform-api/prisma/migrations/20261115020000_core_bindings/migration.sql) 登记，两条独立平台迁移由公共宿主单源维护，当前只提供源码。范围键含Core/租户/容器类型与ID，原绑定和收据保存后持续保留。原收据读取只锁已存在的Core锁行并读事实，实际适配验证为零写入。

## 移除代码前读取依赖

`CoreRemovalService(catalogue, platformSource).inspect({ coreId })`只读汇合Core的assessRemoval与平台实际依赖观察，返回当前时间、实现版本和blockers。平台Source读取真实新准入状态、任务、回调/作业及历史读取依赖，并说明是否完整；不从租户停用、超时或无活动进程推断已排空。[检查服务](src/removal.ts)

缺Core检查器、平台准入accepting/unknown或依赖不完整都会blocked；Core返回错误结构/错误Core的原操作则明确不可用。两个检查都完成、准入stopped且无阻碍时返回clear。clear不执行删除、迁移、业务取消或停用，实际部署仍需复核当前状态；在途/unknown只按原操作收尾。未提供平台Source时管理入口不可用，普通Core使用不因此增加空成功依赖。

## 构建和源码路线

```sh
npm run build -w @rental-os/core-host
```

构建先编译本树core-contracts，再编译本包。已有锁文件中的Prisma5是mysql适配的可选peer，只复用驱动SQL接口，无需生成行业模型。当前源码包不等于已发布npm发行。

[正式出口](src/index.ts) → [部署目录](src/deployment.ts) / [授权服务](src/access.ts) / [绑定服务](src/binding.ts) → [原账与结构观察](src/mysql-deployment.ts) / [授权MySQL](src/mysql.ts) / [绑定MySQL](src/mysql-bindings.ts) → [公共宿主迁移](../../apps/platform-api/prisma/migrations)。输入/输出复用[公共生命周期合同](../core-contracts/src/lifecycle.ts)，实际原身份与部署接线由所选宿主提供。

验证输入应使用真实授权生产者、所选部署锁和原迁移名称；离线事务替身仅核参数、调用顺序和拒绝行为。真实数据库锁、HTTP/UI、绑定初始化与缓存通知分别验收，不能以离线授权替身证明生产准入。
