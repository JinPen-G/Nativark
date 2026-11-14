# 原平台 Core 管理适配

本模块把 `@rental-os/core-host` 的授权/成员分配服务接到当前平台的真实账号、会话、角色与审计。宿主从已冻结的组合注册提供Core部署可用性，原HTTP/后台装配消费此模块。[宿主合同](../../../../../packages/core-host/README.md)

[原主体适配](original-core-principal.ts) → [管理组合](original-core-management.ts) → [独立Core管理服务](../../../../../packages/core-host/src/access.ts) → [私有MySQL](../../../../../packages/core-host/src/mysql.ts) → [原审计](../../common/operation-log.service.ts)。

主体来自原Guard的ALS身份及签名会话。适配依次锁原租户、账号、会话、角色分配/权限，再进入Core授权锁。账号和租户的当前状态、会话撤销/切换、令牌自然期限都核对。成员撤回允许其已经停用，SaaS对被冻结目标租户也可关闭Core，当前操作者仍须有效。

`composeOriginalCoreManagement`复用 `PlatformRepository.findUserById` 的原租户角色映射。租户Core授权要求当前SaaS管理员及租户管理权限，成员分配要求原租户管理员或明确的全租户账号管理权。配置身体的租户或Core标识只用于选择待管理对象，授权来自当前服务端事实。

管理收据通过 `OperationLogService.recordCoreAccessReceipt` 使用相同事务保存，审计失败抛出并回滚授权/收据。提交前再读同一会话及原账号权限。`deployment`从实际受控部署提供，包目录及源码清单的状态通过宿主组合后再使用。

API的dev/build/lint前置构建本树core-host及其core-contracts依赖。输入/输出及独立SQL迁移归这两个包维护，当前原AppModule/Guard路由、Core管理HTTP/后台、平台独立schema和真实运行验收按PCH公共接线片推进。[PCH当前入口](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)
