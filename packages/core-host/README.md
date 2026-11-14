# 平台 Core 宿主服务

`@rental-os/core-host`维护平台自己的Core授权、成员分配和初始化绑定。当前已有管理/绑定服务、MySQL事务适配及独立迁移源码，原Auth/管理入口、实际部署注册及无Core运行宿主按PCH接线。[当前实施入口](../../docs/平台底座/Core接入/平台Core接入-协作接续.md)

## 授权和成员分配分别办理

`CoreAccessService.changeTenantGrant(actor, input)`使用正式`ChangeTenantCoreGrantSchema`，只有当前获权SaaS管理员可办理目标租户的Core开通/停用。开通要求已注册且当前部署/数据/能力可用；停用允许在业务不可用时办理，保留成员分配、绑定与数据，不触发业务初始化。

`changeMemberAssignment(actor, input)`使用`ChangeMemberCoreAssignmentSchema`，租户来自当前主体，body不能选择租户。原租户管理员仅管理自己的成员，新增分配要求租户已开通Core且当前部署可用；撤回不要求先恢复停用的Core。Core开通不自动分配全员，成员分配不赋予该Core全部业务权限。

两类写入都使用原operationId/expectedRevision。不存在记录的expectedRevision是0，保存后从1递增；同键同输入复核当前管理权限后读原收据，不回写旧状态。同键不同输入拒绝，原收据与当前状态分开。停用重开不会恢复主动撤回的成员权限，也不延长原租户统一订阅期限。

结果未知时使用 `readTenantGrantOperation(actor, { tenantId, coreId, operationId })` 或 `readMemberAssignmentOperation(actor, { coreId, userId, operationId })`。两者只读本人原结果，仍核当前管理权、租户/Core及成员；缺收据返回unavailable，不能视为可重发。已停用的部署不要求先恢复才能核对原结果。MySQL读取只锁已有锁行，零事实/收据/审计写入；取得旧收据后另读当前状态，避免把旧开通结果当当前授权。

## 当前部署注册

`createCoreDeployedCatalogue({ lock, registrations, observations })`将真实部署锁与直接导入的Core服务端贡献核对。清单、版本、源码和所选Core集合与锁一致后提供 `registrations` 及授权服务使用的 `availability`。原迁移所有者通过 `observations.read()`返回当前实际数据版本、不可变迁移摘要和执行状态。[部署目录](src/deployment.ts)

`requireRegistered`核当前受控服务组合，授权撤回可在业务数据不可用时办理。`requireAvailable`要求平台和目标Core的实际数据/完整迁移账与部署锁匹配、执行状态为ready。一个Core未就绪只影响它自己的新准入，平台公共迁移未就绪则影响所有Core。空Core组合合法。该目录保存组合时的清单快照和绑定原服务实例的方法引用；`registrations` 每次返回隔离清单，调用方修改目录副本或原输入不会替换当前登记的方法。仓储与业务状态仍由原服务实时维护，后续部署变更重新创建核定组合。

Core有HTTP入口时，组合向 `createCoreDeployedCatalogue`额外传 `http: [coreHttpContribution]`。贡献必须属于当前已登记的Core/版本并通过[公共HTTP政策检查](../core-contracts/README.md#登记core的http政策)，失败不能创建可用目录。目录的 `http.resolve`只返回当前受控政策，输出元数据为隔离副本；目录/可用性/政策方法在组合后固定，后续升级重新建立组合。Core可无HTTP贡献，但未登记路径不能据此开放。Controller实际装配、原Guard和业务提交复验仍由宿主完成。

## 接原身份与事务

[管理服务](src/access.ts)依赖`CoreManagementExecution`和`CoreDeploymentAvailability`。前者由当前宿主提供原管理权限、目标租户/成员核验和事务；后者读取真实部署/注册，不从本地源码目录推断已经安装。没有实现这两个适配不能将页面开放为可办理状态。

MySQL实现从`@rental-os/core-host/mysql`导入`createMysqlCoreManagement(client, authority)`。`authority.authorize`先按原固定顺序锁租户/人员/角色并确认本次SaaS或租户管理权；返回的lease绑定同一原主体/目标租户/成员，`revalidate()`用于提交前检查会话/期限。`authority.audit`调用原平台同事务审计，失败抛出。MySQL适配只接驱动窄接口，不引入Rental/AI模型。

执行顺序是原人员/租户授权锁 → 本tenant/Core锁行 → 检查原操作/当前修订 → 授权或成员事实 → 原收据及审计 → 同一lease期限复核 → 提交。所有SQL参数化并带tenant/Core复合条件。不同Core不共用授权记录，旧原操作返回不覆盖后续停用或撤权。当前实现没有热部署/网络下载/业务初始化或跨库事务。

[迁移](migrations/001-core-access.sql)只创建平台授权/成员/原操作/锁四表，不引用Rental。它尚未加入旧组合部署链或应用到数据库，进入真实宿主时须固定平台数据版本及迁移账；既有组合只做获准的增量迁移，不重放原历史SQL。租户/账号事实继续由原平台维护，本包不复制用户表或建立另一套登录。

## 首次绑定与原结果

`CoreBindingService.bind(actor, input)`读取已登记的Core服务端贡献，租户从原身份确定。输入为Core标识、可选自身容器、原operationId和expectedRevision，以及该Core需要时提供的初始化配置。正式输入schema来自 `@rental-os/core-contracts`，已有绑定的修订通过读取取得，初次使用0。

首次绑定在当前授权/范围锁下由Core唯一初始化schema解析配置，业务写入、平台绑定、原操作和审计同事务。没有初始化数据的轻量Core可以省略初始化器。重复相同操作读取原收据，重复键输入不同会拒绝。重开时复用原绑定，已有Core的配置调整走它自己的业务接口。[应用服务](src/binding.ts)

`readOperation(actor, input)`专门读取原初始化收据，结果为 `recorded` 或 `unavailable`，仍核当前原身份和必要历史读取权限。停用及结果未知时沿这条读取路径核对，缺收据保持准确缺失状态。

MySQL私有入口 `@rental-os/core-host/mysql-bindings` 导出 `createMysqlCoreBindings(client, authority)`，提供执行器和仅供Core仓储适配使用的事务句柄解析。`authority.lockPrincipal`先锁原身份/成员/会话/角色，返回在tenant/Core锁下复核当前授权和范围的方法。回调中的初始化器可由宿主私有适配将句柄解析为本Core的受限仓储，scope和回调寿命都核验，结束后句柄失效。`authority.audit`将原审计加入相同事务，提交前lease再核同一会话/期限。[MySQL绑定适配](src/mysql-bindings.ts)

迁移按 [001授权锁与事实](migrations/001-core-access.sql) → [002绑定与原操作](migrations/002-core-bindings.sql) 登记，两条独立平台迁移只提供源码。范围键含Core/租户/容器类型与ID，原绑定和收据保存后持续保留。原收据读取只锁已存在的Core锁行并读事实，实际适配验证为零写入。

## 构建和源码路线

```sh
npm run build -w @rental-os/core-host
```

构建先编译本树core-contracts，再编译本包。已有锁文件中的Prisma5是mysql适配的可选peer，只复用驱动SQL接口，无需生成行业模型。当前源码包不等于已发布npm发行。

[正式出口](src/index.ts) → [部署目录](src/deployment.ts) / [授权服务](src/access.ts) / [绑定服务](src/binding.ts) → [授权MySQL](src/mysql.ts) / [绑定MySQL](src/mysql-bindings.ts) → 本包迁移。输入/输出复用[公共生命周期合同](../core-contracts/src/lifecycle.ts)，实际原身份/部署接线沿当前宿主推进。

当前类型及离线正常/拒绝/重复行为通过，MySQL参数/调用顺序经实际适配与事务替身核对；真实数据库锁、原权限生产者、管理HTTP/UI、绑定初始化和缓存通知尚未验收。固定证据和下一接口见[PCH记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-host-access-20261114)，不把离线授权替身当生产授权。
