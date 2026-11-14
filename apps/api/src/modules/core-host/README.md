# 原平台 Core 管理适配

本模块把 `@rental-os/core-host` 的授权/成员分配服务接到当前平台的真实账号、会话、角色与审计。宿主从已冻结的组合注册提供Core部署可用性，原HTTP/后台装配消费此模块。[宿主合同](../../../../../packages/core-host/README.md)

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

[CoreManagementController](core-management.controller.ts)消费上面的原管理/绑定组合以及[当前受控目录读取](original-core-catalogue.ts)，八条路径、输入/输出和接口资料共用 [CORE_MANAGEMENT_HTTP](../../../../../packages/core-contracts/src/management-http.ts)。模块由 `CoreManagementHttpModule.register(application)` 显式登记，application由原服务组合提供。

[当前管理事实读取](original-core-management-reads.ts)提供授权、成员分配和绑定的修订，页面取得当前事实后再提交变更。三个只读操作沿同一HTTP声明和Controller消费，SaaS管理者才能读指定租户授权，租户管理者读取本租户成员及绑定。缺记录明确返回unavailable，停用成员的撤回事实仍可核对。所有读取在原权限锁下完成并在返回前复核会话。

目录读取在原SaaS会话与角色锁下完成，返回前复核当前权限。租户授权和成员分配分别通过其原服务验证。Controller将已知schema/权限/冲突/不可用映射到对应状态码，未知错误沿原异常链抛出。原主Guard需要消费同源 `coreManagementHttpPolicy`，原AppModule明确登记本模块，接口组合消费 [同源OpenAPI](../../../../../packages/core-contracts/src/management-openapi.ts)，这些公共入口由原窗口核定。
