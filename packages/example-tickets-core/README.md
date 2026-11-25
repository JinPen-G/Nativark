# 轻量工单 Core 示范

`@rental-os/example-tickets-core`示范一条非租赁业务链，使用租户范围，不需要经营空间、品类、金额或库存。它已有业务服务、清单/API文档生成、MySQL/Nest适配、标准平台宿主及首次设置/列表/新建/详情四页贡献；[独立示范宿主](../../apps/example-tickets-api/README.md)已接授权/HTTP与部署准备，独立标准包安装、MySQL原迁移、授权与业务HTTP、停用重开及持久重启已有实际冒烟，完整工单后台与双Core继续核收。

## 业务范围

创建 → 分派 → 开始处理 → 关闭。字段与输入输出的唯一来源为[contracts.ts](src/contracts.ts)，状态只有`open / in_progress / closed`。普通成员读取本人创建或获分派的工单；管理者在获授`read.all`等对应权限后读取和管理本租户工单。进入Core本身仍须租户授权和成员分配，不因业务角色存在自动取得使用权。

| 方法 | 当前规则 |
| --- | --- |
| `list/page/get` | 当前权限下读取；普通成员限定创建者/受派者范围，不可见对象与不存在同样处理；page正文和总数同范围 |
| `statusCounts` | 当前可见全部工单的total及open/in_progress/closed计数，沿read/read.all范围；不受列表分页、标题和状态筛选影响 |
| `create` | 标题必填、说明可空；初始open、修订1、创建者取可信主体 |
| `assign` | 管理者分派open工单；受派者须已是本租户可使用Core的成员 |
| `start` | 已分派的open工单变为in_progress；当前受派者或获权管理者执行 |
| `close` | in_progress变为closed；当前受派者或获权管理者执行，首版不提供重开 |

每次写入携带原`operationId`，更新再携带`expectedRevision`。同键同输入在复核当前授权和对象可见性后返回历史收据，不重新执行；同键不同输入拒绝。当前工单可能已前进，原收据中的状态仍是原操作时结果，不能当作最新对象。修订冲突重新读取，不自动换键重做。

`receipt(principal, operationId)`提供只读核对。只开放本人原操作且当前仍可见的对象，返回recorded及原收据，或unavailable；unavailable不表示未执行。结果未知后的页面只调用该读取，不自动重发写入。

执行请求的`purpose`由服务端方法固定为business或original_receipt，不能从HTTP body选择。宿主分别办理普通准入与原收据善后，Core停用/到期后的必要核对仍复用当前身份和原操作范围，不能借此开放普通工单查询或写入。

## 接入已有宿主

使用[服务端贡献](src/server.ts)的`createTicketsServer(authority)`供给Core注册表。它采用公共`CorePrincipal/CoreBinding`，拒绝其他Core、跨租户和业务容器；授权绑定由原宿主供给，省略业务初始化和AI工具。没有提供移除检查器时，宿主继续保留代码和历史收据读取者。

兼容更新保留原绑定的 `bindingId/revision/dataVersion`。清单、服务端就绪读取和原业务适配共用 [TICKETS_DATA_READABLE](src/contracts.ts) 核对原绑定版本，不要求它等于当前实现的数据版本。当前物理数据仍须符合所选发行的版本和完整迁移账；可读范围不替代这一检查。重新开通或设置已有绑定不会再次初始化，原操作收据继续保留当时的绑定和执行版本。

需要移除检查时，向 `authority.assessRemoval`传入MySQL正式出口 `readTicketsRemoval`的只读绑定。它先核真实结构，再查询未关闭工单、历史工单和原操作收据是否存在；部署移除检查全Core，可选tenantId仅缩小观察范围。未关闭返回in_flight，保留历史/收据返回history，缺结构返回unknown。全部不存在也只表示Core数据没有阻碍，平台仍须确认已停止新准入、没有在途任务/回调和完整历史依赖。停用不要求清空历史，检查不关闭工单、不删数据，也不批准删除代码。[实际检查](src/mysql.ts) · [平台汇合](../core-host/README.md#移除代码前读取依赖)

后台直接调用 `createTicketsAdmin()`取得四页贡献并按平台标准注册。默认详情从 `useCorePageHost().params.ticketId`读取框架匹配的登记参数；已有宿主仍可提供自己的受控详情组件。Core不需要自己写React Router适配或修改平台导航，[工单Web宿主](../../apps/example-tickets-admin/README.md)已将注册表交给正式公共应用工厂；原Rental主应用仍沿自己的组合。[页面源码](admin/index.tsx)

新建页通过 `useCoreForm`共用原Form、顶部SaveButton和回车提交，框架维护等待、防重、失败及未保存提醒，Core只保留业务输入转换和原操作核对。同步成功后禁止重复创建，unknown未重新渲染也不重发；原收据暂缺继续保留同键，取得可信结果后解除这次草稿。没有另写按钮/表单样式或第二套请求。[简明表单写法](../platform-admin/src/core/README.md#保存保留原-form)

详情页的分派表单也使用 `useCoreForm`，保存与回车共用一次请求。处理/关闭和分派共享等待边界，但不同动作或输入不会复用另一操作的成功结果；unknown只核对原键。处理/关闭的成功或原结果核对保留未保存的分派草稿，只有当前输入仍对应已确认的原分派才清稿。操作收据与详情刷新分别处理，已记录的操作不会因刷新失败变成unknown；读取失败显示重新读取入口，最新工单尚未读到时不继续提交。对象切换释放原表单和操作状态。[详情源码](admin/index.tsx)

列表页使用 `CoreList`及本Core的 `GET ticket-pages`，返回rows/total。默认20条，条数、状态或标题搜索变化回首页；总数与正文共用同一个租户/当前成员/状态/标题条件。标题最多160字，去除首尾空白后按原列排序规则作区分大小写的字面包含匹配，空值不筛选；百分号、下划线、引号和反斜线都按普通文字处理。搜索由服务端在分页前完成，不仅过滤已显示的一页。空末页仍保留真实total，框架只读回有效页。原GET tickets数组合同及10万offset限制继续保留；新分页入口的安全整数offset独立声明。[简明列表写法](../platform-admin/src/core/README.md#列表只提供业务列和读取结果)

`createTicketsHttpContribution()`从TICKETS_HTTP生成原Guard所需的九条政策，登记到当前部署目录的 `http`。创建工单标记startsNewBusiness，原操作收据标记original_receipt，其他查询/处理继续business；权限、分面和OpenAPI扩展来自同一合同。宿主按标准目录接入，Core作者不向原Guard追加工单专用分支。最终对象、幂等、停用/期限和本人原收据仍由工单服务核验。[HTTP合同](src/http.ts) · [平台标准](../core-contracts/README.md#登记core的http政策)

业务创建 `new TicketsService(execution)`。`TicketExecution.run`在每次调用时使用原认证、当前租户/Core/成员及业务权限，并将只有本Core方法的仓储交给业务服务。不能用恒真权限或内存演示数据代替真实宿主。

使用平台公共身份的宿主可从 `@rental-os/example-tickets-core/platform-host` 导入 `composeTicketsPlatformHost`，传真实数据库、当前公共账号、Core部署可用性、统一订阅和同事务审计。SQL宿主同时供给 `deploymentForTransaction(tx)`，使范围、业务与受派成员校验复用当前授权事务；单工单和Rental组合共用这个适配。它保留当前角色 / Core / 成员 / 对象 / 原收据核验，Core作者不复制原API源码。[实际标准适配](src/platform-host.ts)

本Core的六项业务权限由同一清单生成。部署者通过[显式权限登记命令](../../apps/example-tickets-api/README.md)写入公共权限目录，原角色接口即可选择这些精确权限；登记不分配角色或Core。Core作者只维护清单，不另外手写Permission Seed或让页面自行注册权限。

MySQL入口单独从 `@rental-os/example-tickets-core/mysql` 导入 `createMysqlTicketsExecution(client, authority)`，接受实际Prisma交互事务的窄接口。适配只依赖Prisma5的SQL模板/Runtime，不要求生成Rental模型；SQL值全部参数化，查询和写入都含租户条件。`authority.authorize`和`authority.audit`是必须由宿主提供的真实适配，前者取得人员/授权锁并返回受权范围，后者沿原平台审计写同一事务。

锁顺序为人员/当前Core授权与受派成员 → 本租户工单锁行 → 原操作回执/工单变更 → 平台审计。受派成员必须在工单锁之前核定，不能由Core在领域回调中倒序申请人员锁。小样例使用每租户一条工单写锁，保证原操作幂等与收据一起提交；审计、回执或业务失败均抛错回滚。ReadCommitted加原修订条件避免覆盖别人的更新，领域服务不取得整个Prisma client。

authority返回的`revalidate()`在提交前复核同一原会话/订阅等期限。锁定行不会阻止时间流逝，等待后失效必须回滚；不能重新借用平台身份或另一会话使原操作继续。

`migrations/001-tickets.sql`只创建这个Core的三张表。仅在目标组合选择本Core并完成部署授权后应用；无Core宿主不执行，停用也不删表或清收据。迁移SHA-256在清单生成器固定，本包局部gitattributes保证LF；已发布迁移不可改写。

`readTicketsPhysicalData(reader)`由同一MySQL正式出口提供，读取三表的真实列类型/空值/排序规则、InnoDB、复合主键和查询索引、受执行的状态/修订CHECK及原操作外键。只有本版所需结构全部满足才返回数据版本、观察时间与结构摘要，缺项返回undefined；不读业务数据或执行DDL。MySQL的冗余括号、字符引入符及原CHECK包装按表达式结构核对，不能只删字符后误把不同约束当等价。额外非唯一索引可用于调优，额外唯一/业务约束须按数据版本处理。[检查源码](src/mysql.ts)

宿主把该函数传给[原迁移账读取器](../core-host/README.md#读取原迁移账与实际结构)的本Core `readPhysical`，同时提供已登记的Prisma迁移名称。独立工单及双Core宿主消费这一适配，完成收据与物理观察分别核对；未完/缺失/错误迁移都不能据此开放业务，包校验不代替真实数据库观察。

## 构建与打包

准备仓库锁文件对应依赖后，单独构建此Core。

```sh
npm run build -w @rental-os/example-tickets-core
```

构建准备公共platform-core-host及其合同依赖，然后编译本Core，不构建Rental或后台。Prisma5/Nest10和平台宿主是可选适配peer；领域入口不导入它们，使用对应适配时才需要准备。`createTicketsManifest({ repository, commit })`返回可由标准检查器读取的清单；source必须是此次真实固定发行来源，不在源码内填写占位提交。

只读检查源码类型时，可使用仓库的现有内存类型入口。准备根锁文件依赖后，显式选择配置并省略源码位置参数，检查器会采用该配置的完整文件集，包含后台所需的Vite/CSS声明；依赖放在其他受管目录时用`--deps <node_modules目录>`指定。检查不生成Client、dist或连接数据库。[类型入口](../../scripts/check-selected-prisma-types.cjs) · [Core配置](tsconfig.json) · [后台配置](admin/tsconfig.json)

```sh
node scripts/check-selected-prisma-types.cjs --mode platform --config packages/example-tickets-core/tsconfig.json
node scripts/check-selected-prisma-types.cjs --mode platform --config packages/example-tickets-core/admin/tsconfig.json
```

清单和API文档可向stdout输出。

```sh
node packages/example-tickets-core/dist/metadata.js manifest <仓库HTTPS地址> <固定提交>
node packages/example-tickets-core/dist/metadata.js openapi
```

打包方分别保存为`core.manifest.json`、`openapi.json`，将当前README、LICENSE、所声明dist/迁移、`admin/index.tsx`及按[公共命令](../core-contracts/README.md#生成随包指南与归档)生成的CORE_GUIDE.md放到交付目录，再用同一pack/prepare链准备候选。成功stdout只有JSON且退出0，错误stderr说明并退出1。后台TSX由受控宿主组合构建，不在运行时从包路径热加载；AI工具仍未提供，不把本包领域/适配通过称为已独立安装完成。

本示范可直接用一个命令生成完整包。先提交本Core/接入合同源码，准备含 `repository` 和40位 `commit`的底座来源JSON；输出父目录预先存在，输出文件必须是新文件。

```sh
npm run pack:core -w @rental-os/example-tickets-core -- <Core仓库HTTPS地址> <固定Core提交> <底座来源JSON> <新包.tgz>
```

命令先构建当前Core和合同，再核所选提交与当前Core/合同源码一致，生成清单、同源OpenAPI和固定版本CORE_GUIDE.md，按清单收集编译入口/后台TSX/迁移/许可。包内README链接转换为固定源码引用，根源码原文不另维护副本。输出packed/sha256/files的JSON，之后使用平台prepare-install命令核版本并准备待部署目录。重复输出拒绝覆盖；失败不安装、执行迁移或授权Core。[打包实现](src/package.ts) · [命令入口](src/metadata.ts)

独立发行目录可从Node专用 `@rental-os/example-tickets-core/package` 使用packTicketsPackage，显式提供自己的编译目录、Core/底座来源及固定公开接入README原文。公开手册内容仍通过旧参数名`platformTask`传入，保持已有程序调用兼容。它只读声明文件并返回标准包字节，调用者负责在该来源版本构建后写一个新文件；标准包格式、检查和安装仍复用公共出口，不做第二套解压/安装器。

自 `0.1.2` 起，打包时核对 npm 包名及版本与生成清单的发行身份。遇到版本不一致，先同步 [package.json](package.json) 与 [Core 版本](src/contracts.ts)，再从同一固定来源重建并打包。沿用已登记的旧包作为升级起点，候选继续使用数据版本 `0.1.0` 和原迁移，原绑定与收据按当前权限回读。

当前正式版本为 `0.1.4`，包含工单分派筛选，标准包及同一双Core宿主的必要冒烟已通过。公开发行使用 Tag `example-tickets/v0.1.4` 和资产 `example-tickets-0.1.4.tgz`，固定源提交 `74a16a2c3fecfad654241de25cea5d3f27da1332`；下载后按 Release 摘要和同版清单核对。[0.1.4 发行](https://github.com/JinPen-G/Nativark/releases/tag/example-tickets/v0.1.4)。推荐从该固定版本准备更新候选，`dataVersion` 仍为 `0.1.0`，沿用原迁移。独立升级只更新所选 Tickets 包及宿主对应的部署锁，保留原绑定、工单和操作收据。程序回退候选同样须核对包身份、宿主合同、数据版本和完整迁移账，并按目标版本核验页面及 API 能力。[版本与数据合同](src/contracts.ts) · [独立宿主](../../apps/example-tickets-api/README.md)

生成的CORE_GUIDE直接链接本包API、服务端/后台入口和README/LICENSE。公开接入手册和源码资料固定到各自来源提交，README保留本页锚点和代码示例；两份资料复用同一链接规则，Core作者维护原README即可。[资料生成](../core-contracts/src/guide.ts)

## HTTP 与 API 文档

宿主从 `@rental-os/example-tickets-core/nest`导入`TicketsHttpModule.register(service, principalAccessor)`，或用 `registerFactory` 消费公共宿主导出的同一服务；`principalAccessor.current()`仅从原Guard/ALS当前身份取值。[独立API组合](../../apps/example-tickets-api/src/assembly.ts)按同一贡献登记九条工单政策到公共Guard目录，原Rental宿主是否选择本Core由自身组合决定。[HTTP合同](src/http.ts)同时生成政策与API资料。

| 方法与路径 | 业务权限 | 输入与返回 |
| --- | --- | --- |
| `GET /api/cores/example-tickets/tickets` | `example-tickets:ticket:read` | 可选state/offset/limit；当前可见工单数组 |
| `GET /api/cores/example-tickets/ticket-pages` | 同上 | 可选subject/state/assignment/offset/limit；subject为标题字面包含搜索，assignment为assigned或unassigned，同一次读取的rows/total只计当前可见且匹配的范围 |
| `GET /api/cores/example-tickets/ticket-status-counts` | 同上 | 无查询输入；当前可见全部工单的total/open/in_progress/closed计数 |
| `GET /api/cores/example-tickets/tickets/{ticketId}` | 同上 | 已登记工单ID；当前可见详情 |
| `GET /api/cores/example-tickets/operations/{operationId}` | 同上 | 本人的原操作键；recorded原收据或unavailable |
| `POST /api/cores/example-tickets/tickets` | `example-tickets:ticket:create` | operationId/subject/description；原操作收据 |
| `POST .../tickets/{ticketId}/assign` | `example-tickets:ticket:assign` | operationId/expectedRevision/assigneeId；原操作收据 |
| `POST .../tickets/{ticketId}/start` | `example-tickets:ticket:start` | operationId/expectedRevision；原操作收据 |
| `POST .../tickets/{ticketId}/close` | `example-tickets:ticket:close` | operationId/expectedRevision；原操作收据 |

全部成功返回200，沿原平台`{ data, requestId }`信封；输入不符400、当前授权不足403、对象不在可读范围404、修订/状态/原操作冲突409；会话失败和未处理存储异常仍走原宿主401/500。请求不接tenantId、创建者和body里的ticketId，路径标识与body分别校验。HTTP200只说明本次请求返回，收据中的工单状态是原操作时状态；当前状态另读详情。

[生成器](src/openapi.ts)从相同Zod/HTTP合同生成OpenAPI贡献，复用公共`coreOpenApiSchema`，不手工维护另一套字段。输出可给平台`composeCoreOpenApi`组合，也可随包离线阅读；标准包检查会核路径/schema命名空间和本地引用。单工单宿主已通过真实Controller装配、授权/成员分配、普通业务、原收据及跨租户拒绝冒烟；其他宿主按自己的组合核验。

分页实现使用单条MySQL8 CTE，正文和COUNT共用可见集合及语句快照；成员读取和总数均限定创建者/受派者，read.all只扩大到本租户。LEFT JOIN保留空末页的真实总数，total单独解析，不混入严格工单对象。读取不创建Core锁行、工单、收据或审计。[分页合同](src/contracts.ts) · [仓储](src/mysql.ts)

分派筛选使用原工单的 `assigneeId`：`assignment=assigned` 只读取已有受派成员的工单，`assignment=unassigned` 只读取尚未分派的工单。省略此项读取全部当前可见范围，清除或切换筛选回到首页。分派条件与标题、状态一起作用于同一分页正文和总数，顶部状态汇总仍读取当前可见全部工单。查询不接收租户或成员范围，不改变原 `read / read.all` 权限与创建者/受派者可见条件。

0.1.1增加状态数量汇总，数据版本仍为0.1.0。汇总复用原租户及创建者/受派者条件，在同一SQL语句内计数全部可读工单。空范围返回零，计数必须为非负安全整数，读取失败明确报错。旧仓储适配仍可使用原接口，缺少汇总端口时明确报错。路径使用独立的`ticket-status-counts`，遵守静态路径不能与`tickets/:ticketId`重叠的注册规则。列表页通过原`CorePage.summary`显示总数及三个状态计数，标题和状态筛选仍只作用于列表；原列表刷新同时重读汇总，汇总失败提供自己的只读重试。汇总和分页各自是一份读取观察。[汇总合同](src/http.ts) · [列表呈现](admin/index.tsx)

<a id="后台三页面"></a>

## 后台页面与首次设置

`@rental-os/example-tickets-core/admin`提供[首次设置、列表、新建和详情](admin/index.tsx)，从`@rental-os/platform-admin/core`取得公共呈现、原组件和请求。`createTicketsAdmin()`返回同一页面注册贡献，默认详情使用框架登记参数；公共应用工厂负责真实`CorePageHostProvider`与路由挂接，已有宿主也可继续提供受控detailComponent。

测试宿主接通后，按“受控注册 → SaaS开通租户 → 租户管理者给成员分配Core → 工单设置 → 创建/分派/处理/关闭”使用。`/cores/example-tickets/setup`是已登记配置页，不要求工单业务先就绪；管理者需已获Core成员分配才能办理首次绑定。工单没有额外初始化配置，设置动作调用平台原绑定服务，已有绑定复用。结果未知只核对原设置收据，刷新或重入保留原键；设置成功后再进入实际工单列表。[平台绑定用法](../platform-admin/src/core/README.md#core首次设置)

列表支持标题搜索、状态与分派筛选和显式分页；输入或清除筛选后回首页并读取同条件的服务端总数。筛选控件共用原 `CoreList.controls` 和选择器，表格、页头及详情保持同一呈现。新建用声明式保存主操作，详情按当前状态声明处理/关闭，分派使用原Form/SaveButton。没有新CSS或外壳，页面标题从路由声明读取；普通成员仍经服务端数据范围。首次示范的分派填写已授权成员ID，后续原成员目录适配接通后可改为实名选择，当前不创建假人员列表。

网络/未知结果保留原输入、键和常显提示，只提供GET原收据核对；已知本Core提交前拒绝允许核正输入/状态再发起新操作。输入未保存、写入中或未知结果沿原UnsavedChangesGuard保护。查询缓存包含Core/会话/页面代次，原HTTP负责凭据与信封，通用Core请求适配负责离页中止及迟到响应拒绝。

在已经具备对应React后台peer与原锁文件依赖的源码组合中，可运行`npm run lint:admin -w @rental-os/example-tickets-core`，先构建服务端合同/产物，再按当前后台tsconfig检查页面。它不是完整独立前端发行构建；正式公共应用已消费同一页面注册表；独立API已验证授权、业务和持久化，完整工单React实页继续按对应Web宿主验收。

## 源码与验证入口

[index](src/index.ts) → [业务schema](src/contracts.ts)/[服务](src/service.ts)/[服务端注册](src/server.ts)/[发行清单](src/manifest.ts)。[Nest入口](src/nest.ts) → 同一[HTTP合同](src/http.ts)与服务，[OpenAPI](src/openapi.ts)及[元数据命令](src/metadata.ts)供离线资料。[MySQL私有适配](src/mysql.ts) → [独立迁移](migrations/001-tickets.sql)。公开领域出口不依赖Rental/Nest/Prisma；私有mysql/nest出口才读取对应依赖。

类型与反向依赖检查、原SQL事务定向验证覆盖完整业务链、当前权限/租户拒绝、修订/同键收据、审计失败回滚及参数化。早期0.1.1标准包已在独立Windows宿主安装，使用真实MySQL8.4和公共40模型Client完成授权、绑定、创建/分派/开始/关闭、跨租户拒绝、撤权及停用重开。API和数据库重启后原业务、绑定及原操作收据保持，重读或复用原键不递增修订、不再次初始化。完整工单Web、同宿主Rental并存、独立更新和Linux镜像另按对应组合核验。验证复用必要类型和定向冒烟。
