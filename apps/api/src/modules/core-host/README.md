# 原平台 Core 管理适配

本模块把 `@rental-os/core-host` 的授权/成员分配服务接到当前平台的真实账号、会话、角色与审计。宿主从已冻结的组合注册提供Core部署可用性，原HTTP/后台装配消费此模块。[宿主合同](../../../../../packages/core-host/README.md)

## 从一个应用工厂装配

[composeOriginalCoreApplication](original-core-application.ts)接收原数据库、账号仓储、订阅、同事务审计和单一受控Core部署目录，组合管理/绑定/当前事实、SaaS目录、本人会话目录及范围读取。组合时只创建应用实例，不读取数据库或初始化Core；行业业务HTTP、AI与作业由选中Core另行装配。

主Nest组合通过 [CoreHostModule.register](core-host.module.ts) 使用一个应用工厂，三个Controller从同一个工厂取得对应服务。`imports`必须导出 `inject` 中使用的真实原服务或宿主依赖provider，父AppModule本地provider不会自动对子模块可见。不要在子模块重建数据库、Auth或审计实例。

```ts
CoreHostModule.register({
  imports: [originalHostDependenciesModule],
  inject: [originalHostDependenciesToken],
  useFactory: (dependencies: OriginalCoreApplicationInput) => composeOriginalCoreApplication(dependencies)
});
```

例子中的模块/token由主宿主提供并导出原实例，输入类型与函数从本目录实际源码读取。`CoreHostHttpApplication`只依赖公共Core服务和HTTP合同，原Prisma装配留在original适配中。已提供的三个单独DynamicModule入口继续兼容；主组合选择整体或单独入口，不能重复挂相同Controller。原Guard仍须消费精确管理政策、会话GET和范围POST政策；这里没有替换全局Guard或给路由自动授权。

[原主体适配](original-core-principal.ts) → [管理组合](original-core-management.ts) → [独立Core管理服务](../../../../../packages/core-host/src/access.ts) → [私有MySQL](../../../../../packages/core-host/src/mysql.ts) → [原审计](../../common/operation-log.service.ts)。

主体来自原Guard的ALS身份及签名会话。适配依次锁原租户、账号、会话、角色分配/权限，再进入Core授权锁。账号和租户的当前状态、会话撤销/切换、令牌自然期限都核对。成员撤回允许其已经停用，SaaS对被冻结目标租户也可关闭Core，当前操作者仍须有效。

`composeOriginalCoreManagement`复用 `PlatformRepository.findUserById` 的原租户角色映射。租户Core授权要求当前SaaS管理员及租户管理权限，成员分配要求原租户管理员或明确的全租户账号管理权。请求的租户或Core标识只用于选择待管理对象，授权来自当前服务端事实。

管理收据通过 `OperationLogService.recordCoreAccessReceipt` 使用相同事务保存，审计失败抛出并回滚授权/收据。提交前再读同一会话及原账号权限。`deployment`从实际受控部署提供，包目录及源码清单的状态通过宿主组合后再使用。

API的dev/build/lint前置构建本树core-host及其core-contracts依赖。输入/输出及独立SQL迁移归这两个包维护，当前原AppModule/Guard路由、Core管理HTTP/后台、平台独立schema和真实运行验收按PCH公共接线片推进。[PCH当前入口](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)

## 绑定与业务示范

[当前Core使用权](original-core-access.ts)在原事务内读取租户授权、成员分配和绑定，原订阅服务在同事务给出新业务期限判断。租户和成员必须分别开通，tenant/Core/成员复合条件用于读取，成员撤权后普通业务入口拒绝。

[绑定组合](original-core-bindings.ts)复用原租户管理员及Core/成员授权，初始化、绑定、收据及原审计同事务。容器业务须由自身适配在同事务核定容器归属和初始化范围，缺少适配明确不可用。原初始化收据可由仍获权的租户管理者只读核对。

[工单组合](original-tickets-host.ts)消费 `@rental-os/example-tickets-core` 正式服务端及MySQL出口，注册的业务权限、原主体/成员使用权、当前绑定和本租户受派者分别核验。创建工单沿原订阅期限，新建暂停后已获权工单的处理/关闭仍由自身业务状态与权限决定。停用后的原收据只读核对本人操作和当前对象可见性。普通业务审计消费Core提供的原操作关联，公共OperationLog继续使用通用输入。

新增Core可复用原主体和Core使用权适配，并提供自己的业务权限、范围、初始化和原收据语义。API组合构建先编译本树Core合同/宿主和选中示范模块，实际无Core独立构建由PCH宿主片落实。

## 平台管理 HTTP

[CoreManagementController](core-management.controller.ts)消费上面的原管理/绑定组合以及[当前受控目录读取](original-core-catalogue.ts)，十条路径、输入/输出和接口资料共用 [CORE_MANAGEMENT_HTTP](../../../../../packages/core-contracts/src/management-http.ts)。模块由 `CoreManagementHttpModule.register(application)` 显式登记，application由原服务组合提供。

[当前管理事实读取](original-core-management-reads.ts)提供授权、成员分配和绑定的修订，页面取得当前事实后再提交变更。三个只读操作沿同一HTTP声明和Controller消费，SaaS管理者才能读指定租户授权，租户管理者读取本租户成员及绑定。缺记录明确返回unavailable，停用成员的撤回事实仍可核对。所有读取在原权限锁下完成并在返回前复核会话。

目录读取在原SaaS会话与角色锁下完成，返回前复核当前权限。租户授权和成员分配分别通过其原服务验证。Controller将已知schema/权限/冲突/不可用映射到对应状态码，未知错误沿原异常链抛出。原主Guard需要消费同源 `coreManagementHttpPolicy`，原AppModule明确登记本模块，接口组合消费 [同源OpenAPI](../../../../../packages/core-contracts/src/management-openapi.ts)，这些公共入口由原窗口核定。

租户授权与成员分配各有原operationId只读入口，直接消费原管理服务的收据读取方法。读取复用同一原主体、人员/角色锁和返回前复核，MySQL不新建锁行、不写事实或审计。结果未知不能用当前状态代替原操作证据；停用后仍可在当前管理权下核对本人原收据。后台实际消费位于[CoreAccessPanel](../../../../admin/src/core/CoreAccessPanel.tsx)，主路由挂载仍沿公共窗口办理。

## 当前成员的Core目录

[原会话读取](original-core-session.ts)从原主体/人员/角色锁取得当前登录成员，查询本租户开通授权和本人Core分配，只返回已登记且获权的Core，以及当前角色的本Core精确权限码。原租户管理者另得到获开通Core的分配候选；SaaS管理目录继续使用自己的入口。读取结束后再次复核原身份和管理/业务权限；没有Core的组合不查询Core授权表，仍返回合法空目录。

[CoreSessionHttpModule](core-session.controller.ts)显式登记 `CORE_SESSION_HTTP` 的一条GET，输入不接收tenantId/userId，文档由 `createCoreSessionOpenApi()`生成。原Guard需明确加入已登录operator自助政策，主组合提供真实reader并登记模块；尚未修改这些公共入口。目录只说明注册/授权/成员/角色投影，当前部署、绑定、业务就绪和对象范围仍由自身服务核验。[前端消费者](../../../../admin/src/core/useCoreSession.ts)

## 当前Core范围与就绪

[原范围读取](original-core-scope.ts)先核当前会话与Core成员使用权，调用受控登记Core的resolveScope/readReadiness，再核原会话、授权和实际绑定修订。Core自行定义容器，返回的绑定和数据版本必须属于原范围及当前可读版本；读期间绑定变化返回冲突。Core返回结构沿唯一schema核验，错误贡献准确标记不可用，不视为可执行业务。

范围服务可持有自己的授权事务，宿主不在外层跨该调用持有人员/Core锁；前后核对各自使用短事务，避免工单原范围适配的嵌套锁等待。读取不创建绑定、执行初始化或业务写入。[CoreScopeHttpModule](core-scope.controller.ts)显式装配对应POST只读入口，文档由createCoreScopeOpenApi生成，主Guard/组合仍由公共窗口消费。[前端Hook](../../../../admin/src/core/useCoreScope.ts)

## Core业务HTTP准入

[原HTTP准入](original-core-http-access.ts)读取同一受控部署目录的 `http`，沿原normalizeRequestPath处理路径，未知方法/路径/当前分面在访问数据库前拒绝。原会话/租户主体和精确业务权限在原锁下核验；business还核当前租户Core授权、成员分配/部署和所需新业务订阅期限。原收据入口只做当前身份/动作粗准入，最终本人操作/对象可见性沿Core收据服务，不能借收尾开放普通业务。

`composeOriginalCoreApplication`返回 `http`及 `authorizeHttp(method, url)`，主Guard在原签名会话和ALS建立后统一消费。当前适配只处理operator；staff/client继续原专用身份和受控适配，不因Core清单声明自动变成员或开放路由。旧Rental仍沿原路径/空间权限，不用这份新政策替代旧链。主Guard实际调用尚待公共窗口；没有调用或未装配Controller时，声明不是可用接口。
