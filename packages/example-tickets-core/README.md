# 轻量工单 Core 示范

`@rental-os/example-tickets-core`示范一条非租赁业务链，使用租户范围，不需要经营空间、品类、金额或库存。它已有业务服务、清单生成和MySQL适配；真实宿主授权、HTTP/页面及部署尚未接线，当前不能直接作为完整工单应用安装使用。

## 业务范围

创建 → 分派 → 开始处理 → 关闭。字段与输入输出的唯一来源为[contracts.ts](src/contracts.ts)，状态只有`open / in_progress / closed`。普通成员读取本人创建或获分派的工单；管理者在获授`read.all`等对应权限后读取和管理本租户工单。进入Core本身仍须租户授权和成员分配，不因业务角色存在自动取得使用权。

| 方法 | 当前规则 |
| --- | --- |
| `list/get` | 当前权限下读取；普通成员限定创建者/受派者范围，不可见对象与不存在同样处理 |
| `create` | 标题必填、说明可空；初始open、修订1、创建者取可信主体 |
| `assign` | 管理者分派open工单；受派者须已是本租户可使用Core的成员 |
| `start` | 已分派的open工单变为in_progress；当前受派者或获权管理者执行 |
| `close` | in_progress变为closed；当前受派者或获权管理者执行，首版不提供重开 |

每次写入携带原`operationId`，更新再携带`expectedRevision`。同键同输入在复核当前授权和对象可见性后返回历史收据，不重新执行；同键不同输入拒绝。当前工单可能已前进，原收据中的状态仍是原操作时结果，不能当作最新对象。修订冲突重新读取，不自动换键重做。

## 接入已有宿主

使用[服务端贡献](src/server.ts)的`createTicketsServer(authority)`供给Core注册表。它采用公共`CorePrincipal/CoreBinding`，拒绝其他Core、跨租户和业务容器；授权绑定由原宿主供给，省略业务初始化和AI工具。没有提供移除检查器时，宿主继续保留代码和历史收据读取者。

业务创建 `new TicketsService(execution)`。`TicketExecution.run`在每次调用时使用原认证、当前租户/Core/成员及业务权限，并将只有本Core方法的仓储交给业务服务。不能用恒真权限或内存演示数据代替真实宿主。

MySQL入口单独从 `@rental-os/example-tickets-core/mysql` 导入 `createMysqlTicketsExecution(client, authority)`，接受实际Prisma交互事务的窄接口。适配只依赖Prisma5的SQL模板/Runtime，不要求生成Rental模型；SQL值全部参数化，查询和写入都含租户条件。`authority.authorize`和`authority.audit`是必须由宿主提供的真实适配，前者取得人员/授权锁并返回受权范围，后者沿原平台审计写同一事务。

锁顺序为人员/当前Core授权与受派成员 → 本租户工单锁行 → 原操作回执/工单变更 → 平台审计。受派成员必须在工单锁之前核定，不能由Core在领域回调中倒序申请人员锁。小样例使用每租户一条工单写锁，保证原操作幂等与收据一起提交；审计、回执或业务失败均抛错回滚。ReadCommitted加原修订条件避免覆盖别人的更新，领域服务不取得整个Prisma client。

`migrations/001-tickets.sql`只创建这个Core的三张表。仅在目标组合选择本Core并完成部署授权后应用；无Core宿主不执行，停用也不删表或清收据。迁移SHA-256在清单生成器固定，本包局部gitattributes保证LF；已发布迁移不可改写。

## 构建与打包

准备仓库锁文件对应依赖后，单独构建此Core。

```sh
npm run build -w @rental-os/example-tickets-core
```

构建先生成本树core-contracts，然后编译本Core，不构建Rental或后台。`createTicketsManifest({ repository, commit })`返回可由标准检查器读取的清单；source必须是此次真实固定发行来源，不在源码内填写占位提交。打包方把清单输出为`core.manifest.json`，将当前README、LICENSE、所声明dist/迁移及按[公共命令](../core-contracts/README.md#生成随包指南与归档)生成的CORE_GUIDE.md放到交付目录，再用同一pack/prepare链准备候选。

现在清单只声明已提供的服务端入口，没有假页面、假AI工具或可执行HTTP文档。后续真实Controller/页面完成时，同片增加对应贡献和示例；不把本包领域服务通过称为已独立接手或安装完成。

## 源码与验证入口

[index](src/index.ts) → [业务schema](src/contracts.ts)/[服务](src/service.ts)/[服务端注册](src/server.ts)/[发行清单](src/manifest.ts)；[MySQL私有适配](src/mysql.ts) → [独立迁移](migrations/001-tickets.sql)。公开领域出口不依赖Rental/Nest/Prisma；私有mysql出口才读取驱动Runtime。

当前类型和反向依赖检查通过，离线SQL事务替身核过完整业务链、当前权限/租户拒绝、修订与同键收据、审计失败回滚和参数化；没有运行真实MySQL、HTTP或后台。固定证据与剩余接线见[PCH开发记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-tickets-domain-20261114)。不新增专用测试运行器，继续复用必要类型检查及原定向验证。
