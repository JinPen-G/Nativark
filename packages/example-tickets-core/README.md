# 轻量工单 Core 示范

`@rental-os/example-tickets-core`示范一条非租赁业务链，使用租户范围，不需要经营空间、品类、金额或库存。它已有业务服务、清单/API文档生成、MySQL/Nest适配和三页面贡献；真实宿主授权、路由装配及部署尚未接线，当前不能直接作为完整工单应用安装使用。

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

`receipt(principal, operationId)`提供只读核对。只开放本人原操作且当前仍可见的对象，返回recorded及原收据，或unavailable；unavailable不表示未执行。结果未知后的页面只调用该读取，不自动重发写入。

执行请求的`purpose`由服务端方法固定为business或original_receipt，不能从HTTP body选择。宿主分别办理普通准入与原收据善后，Core停用/到期后的必要核对仍复用当前身份和原操作范围，不能借此开放普通工单查询或写入。

## 接入已有宿主

使用[服务端贡献](src/server.ts)的`createTicketsServer(authority)`供给Core注册表。它采用公共`CorePrincipal/CoreBinding`，拒绝其他Core、跨租户和业务容器；授权绑定由原宿主供给，省略业务初始化和AI工具。没有提供移除检查器时，宿主继续保留代码和历史收据读取者。

业务创建 `new TicketsService(execution)`。`TicketExecution.run`在每次调用时使用原认证、当前租户/Core/成员及业务权限，并将只有本Core方法的仓储交给业务服务。不能用恒真权限或内存演示数据代替真实宿主。

MySQL入口单独从 `@rental-os/example-tickets-core/mysql` 导入 `createMysqlTicketsExecution(client, authority)`，接受实际Prisma交互事务的窄接口。适配只依赖Prisma5的SQL模板/Runtime，不要求生成Rental模型；SQL值全部参数化，查询和写入都含租户条件。`authority.authorize`和`authority.audit`是必须由宿主提供的真实适配，前者取得人员/授权锁并返回受权范围，后者沿原平台审计写同一事务。

锁顺序为人员/当前Core授权与受派成员 → 本租户工单锁行 → 原操作回执/工单变更 → 平台审计。受派成员必须在工单锁之前核定，不能由Core在领域回调中倒序申请人员锁。小样例使用每租户一条工单写锁，保证原操作幂等与收据一起提交；审计、回执或业务失败均抛错回滚。ReadCommitted加原修订条件避免覆盖别人的更新，领域服务不取得整个Prisma client。

authority返回的`revalidate()`在提交前复核同一原会话/订阅等期限。锁定行不会阻止时间流逝，等待后失效必须回滚；不能重新借用平台身份或另一会话使原操作继续。

`migrations/001-tickets.sql`只创建这个Core的三张表。仅在目标组合选择本Core并完成部署授权后应用；无Core宿主不执行，停用也不删表或清收据。迁移SHA-256在清单生成器固定，本包局部gitattributes保证LF；已发布迁移不可改写。

## 构建与打包

准备仓库锁文件对应依赖后，单独构建此Core。

```sh
npm run build -w @rental-os/example-tickets-core
```

构建先生成本树core-contracts，然后编译本Core，不构建Rental或后台。已在组合工程中的Prisma5/Nest10是可选适配peer；领域入口不导入它们，使用对应适配时才需要准备。`createTicketsManifest({ repository, commit })`返回可由标准检查器读取的清单；source必须是此次真实固定发行来源，不在源码内填写占位提交。可用下列命令向stdout输出包清单和API文档。

```sh
node packages/example-tickets-core/dist/metadata.js manifest <仓库HTTPS地址> <固定提交>
node packages/example-tickets-core/dist/metadata.js openapi
```

打包方分别保存为`core.manifest.json`、`openapi.json`，将当前README、LICENSE、所声明dist/迁移、`admin/index.tsx`及按[公共命令](../core-contracts/README.md#生成随包指南与归档)生成的CORE_GUIDE.md放到交付目录，再用同一pack/prepare链准备候选。成功stdout只有JSON且退出0，错误stderr说明并退出1。后台TSX由受控宿主组合构建，不在运行时从包路径热加载；AI工具仍未提供，不把本包领域/适配通过称为已独立安装完成。

## HTTP 与 API 文档

宿主从 `@rental-os/example-tickets-core/nest`导入`TicketsHttpModule.register(service, principalAccessor)`，放入受控组合；`principalAccessor.current()`仅从原Guard/ALS当前身份取值。这里不加公开路由豁免、不替换全局Guard或读取请求体的tenantId。原全局路由政策还没有登记工单接口，当前默认拒绝应保留，待公共窗口按[HTTP合同](src/http.ts)逐项注册。

| 方法与路径 | 业务权限 | 输入与返回 |
| --- | --- | --- |
| `GET /api/cores/example-tickets/tickets` | `example-tickets:ticket:read` | 可选state/offset/limit；当前可见工单数组 |
| `GET /api/cores/example-tickets/tickets/{ticketId}` | 同上 | 已登记工单ID；当前可见详情 |
| `GET /api/cores/example-tickets/operations/{operationId}` | 同上 | 本人的原操作键；recorded原收据或unavailable |
| `POST /api/cores/example-tickets/tickets` | `example-tickets:ticket:create` | operationId/subject/description；原操作收据 |
| `POST .../tickets/{ticketId}/assign` | `example-tickets:ticket:assign` | operationId/expectedRevision/assigneeId；原操作收据 |
| `POST .../tickets/{ticketId}/start` | `example-tickets:ticket:start` | operationId/expectedRevision；原操作收据 |
| `POST .../tickets/{ticketId}/close` | `example-tickets:ticket:close` | operationId/expectedRevision；原操作收据 |

全部成功返回200，沿原平台`{ data, requestId }`信封；输入不符400、当前授权不足403、对象不在可读范围404、修订/状态/原操作冲突409；会话失败和未处理存储异常仍走原宿主401/500。请求不接tenantId、创建者和body里的ticketId，路径标识与body分别校验。HTTP200只说明本次请求返回，收据中的工单状态是原操作时状态；当前状态另读详情。

[生成器](src/openapi.ts)从相同Zod/HTTP合同生成OpenAPI贡献，复用公共`coreOpenApiSchema`，不手工维护另一套字段。输出可给平台`composeCoreOpenApi`组合，也可随包离线阅读；标准包检查会核路径/schema命名空间和本地引用。Controller装配与真实HTTP权限仍待宿主验证。

## 后台三页面

`@rental-os/example-tickets-core/admin`提供[列表、新建和详情](admin/index.tsx)，只从`@rental-os/admin/core`取得公共呈现、原组件和请求。`createTicketsAdmin(detailComponent)`返回同一页面注册贡献；detailComponent由受控宿主解析路由参数并传给`TicketDetailPage({ ticketId })`，宿主仍须包裹真实`CorePageHostProvider`。

列表支持状态筛选和显式分页，新建用声明式保存主操作，详情按当前状态声明处理/关闭，分派使用原Form/SaveButton。没有新CSS或外壳，页面标题从路由声明读取；普通成员仍经服务端数据范围。首次示范的分派填写已授权成员ID，后续原成员目录适配接通后可改为实名选择，当前不创建假人员列表。

网络/未知结果保留原输入、键和常显提示，只提供GET原收据核对；已知本Core提交前拒绝允许核正输入/状态再发起新操作。输入未保存、写入中或未知结果沿原UnsavedChangesGuard保护。查询缓存包含Core/会话/页面代次，原HTTP负责凭据与信封，通用Core请求适配负责离页中止及迟到响应拒绝。

在已经具备对应React后台peer与原锁文件依赖的源码组合中，可运行`npm run lint:admin -w @rental-os/example-tickets-core`，先构建服务端合同/产物，再按当前后台tsconfig检查页面。它不是完整独立前端发行构建；实际AppRouter/导航、后端授权、持久化和实页仍待公共宿主片。

## 源码与验证入口

[index](src/index.ts) → [业务schema](src/contracts.ts)/[服务](src/service.ts)/[服务端注册](src/server.ts)/[发行清单](src/manifest.ts)。[Nest入口](src/nest.ts) → 同一[HTTP合同](src/http.ts)与服务，[OpenAPI](src/openapi.ts)及[元数据命令](src/metadata.ts)供离线资料。[MySQL私有适配](src/mysql.ts) → [独立迁移](migrations/001-tickets.sql)。公开领域出口不依赖Rental/Nest/Prisma；私有mysql/nest出口才读取对应依赖。

当前类型和反向依赖检查通过，离线SQL事务替身核过完整业务链、当前权限/租户拒绝、修订与同键收据、审计失败回滚和参数化；没有运行真实MySQL、HTTP或后台。固定证据与剩余接线见[PCH开发记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-tickets-domain-20261114)。不新增专用测试运行器，继续复用必要类型检查及原定向验证。
