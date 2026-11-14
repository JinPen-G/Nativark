# 平台 Core 宿主服务

`@rental-os/core-host`维护平台自己的Core授权与成员分配，业务规则和业务数据留在Core。当前已有管理服务、MySQL适配及独立迁移源码；原Auth/管理入口、实际部署注册、初始化绑定与无Core运行宿主尚未接线。

## 授权和成员分配分别办理

`CoreAccessService.changeTenantGrant(actor, input)`使用正式`ChangeTenantCoreGrantSchema`，只有当前获权SaaS管理员可办理目标租户的Core开通/停用。开通要求已注册且当前部署/数据/能力可用；停用允许在业务不可用时办理，保留成员分配、绑定与数据，不触发业务初始化。

`changeMemberAssignment(actor, input)`使用`ChangeMemberCoreAssignmentSchema`，租户来自当前主体，body不能选择租户。原租户管理员仅管理自己的成员，新增分配要求租户已开通Core且当前部署可用；撤回不要求先恢复停用的Core。Core开通不自动分配全员，成员分配不赋予该Core全部业务权限。

两类写入都使用原operationId/expectedRevision。不存在记录的expectedRevision是0，保存后从1递增；同键同输入复核当前管理权限后读原收据，不回写旧状态。同键不同输入拒绝，原收据与当前状态分开。停用重开不会恢复主动撤回的成员权限，也不延长原租户统一订阅期限。

## 接原身份与事务

[管理服务](src/access.ts)依赖`CoreManagementExecution`和`CoreDeploymentAvailability`。前者由当前宿主提供原管理权限、目标租户/成员核验和事务；后者读取真实部署/注册，不从本地源码目录推断已经安装。没有实现这两个适配不能将页面开放为可办理状态。

MySQL实现从`@rental-os/core-host/mysql`导入`createMysqlCoreManagement(client, authority)`。`authority.authorize`先按原固定顺序锁租户/人员/角色并确认本次SaaS或租户管理权；返回的lease绑定同一原主体/目标租户/成员，`revalidate()`用于提交前检查会话/期限。`authority.audit`调用原平台同事务审计，失败抛出。MySQL适配只接驱动窄接口，不引入Rental/AI模型。

执行顺序是原人员/租户授权锁 → 本tenant/Core锁行 → 检查原操作/当前修订 → 授权或成员事实 → 原收据及审计 → 同一lease期限复核 → 提交。所有SQL参数化并带tenant/Core复合条件。不同Core不共用授权记录，旧原操作返回不覆盖后续停用或撤权。当前实现没有热部署/网络下载/业务初始化或跨库事务。

[迁移](migrations/001-core-access.sql)只创建平台授权/成员/原操作/锁四表，不引用Rental。它尚未加入旧组合部署链或应用到数据库，进入真实宿主时须固定平台数据版本及迁移账；既有组合只做获准的增量迁移，不重放原历史SQL。租户/账号事实继续由原平台维护，本包不复制用户表或建立另一套登录。

## 构建和源码路线

```sh
npm run build -w @rental-os/core-host
```

构建先编译本树core-contracts，再编译本包。已有锁文件中的Prisma5是mysql适配的可选peer，只复用驱动SQL接口，无需生成行业模型。当前源码包不等于已发布npm发行。

[正式出口](src/index.ts) → [应用服务/窄仓储](src/access.ts) → [MySQL事务适配](src/mysql.ts) → [本包迁移](migrations/001-core-access.sql)。输入/输出复用[公共生命周期合同](../core-contracts/src/lifecycle.ts)，不另造同名DTO。

当前类型及离线正常/拒绝/重复行为通过，MySQL参数/调用顺序经实际适配与事务替身核对；真实数据库锁、原权限生产者、管理HTTP/UI、绑定初始化和缓存通知尚未验收。固定证据和下一接口见[PCH记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-host-access-20261114)，不把离线授权替身当生产授权。
