# Rental Core 业务入口

Rental Core维护租赁领域事实，包括经营空间/品类、商品和资产、报价库存、订单履约、检查及金额。它是首个业务Core示范，平台身份、公共后台和原AI机制通过受控适配消费，具体报价、金额与状态仍在原Core裁定。

领域与品类治理合同、营业日、计价与器材、能力执行/条件判定及审计仓储已单源移入 Rental 包。原 shared/API 路径和 Nest provider 继续转接同一实现，本目录承接剩余业务服务、事务、数据和任务。[独立 Rental 包](../../../../../packages/rental-core/README.md)

[RentalCoreController](rental-core.controller.ts) → [RentalCoreService](rental-core.service.ts)连接商品/资产/订单及履约入口。[RentalBusinessController](rental-business.controller.ts) → [RentalBusinessService](rental-business.service.ts)承接报价、规则、日历及价值服务。调用方从原Guard/ALS取得租户、空间、角色和地点范围，领域服务按当前对象/历史依据核权限与提交条件。[Guard](../../common/api-auth.guard.ts) · [ALS](../../common/request-identity.ts)

持久事实经[业务事实仓储](rental-business-fact.repository.ts)读写。[状态仓储](rental-state.repository.ts)和[原幂等](rental-idempotency.repository.ts)已是 Rental 包的窄 Nest 适配，供给原配置、范围、品类锁、事件和同一数据库事务。快照保留原行修订与已持久档案，收据按当前空间读取原键；恢复副本不重建业务事实，同键重试不重做已提交动作。[快照实现](../../../../../packages/rental-core/src/mysql-state.ts) · [收据实现](../../../../../packages/rental-core/src/mysql-idempotency.ts)

报价、价格、规则、检查和履约依据从原关联快照读取，修订与幂等键保护并发/重复操作，结果未知通过原操作核对。主事务和外部支付/通知执行点分别由原领域实现持有。

品类解析、身份、空间能力服务及实例/审计仓储由 Rental 包持有。原 Nest provider 提供当前绑定、版本、范围和同一数据源接线，历史动作沿原版本引用，提交点继续传入原事务。采用业务和租赁领域链继续按原四册迁移及验收。[品类 provider](rental-category-resolver.service.ts) · [能力Hook](capability-hook.runtime.ts) · [空间能力](workspace-capability.service.ts) · [实例仓储](workspace-capability.repository.ts) · [Rental当前入口](../../../../../docs/Rental%20Core/Rental%20Core-协作接续.md) · [品类治理](../../../../../docs/Rental%20Core/品类治理/品类治理-协作接续.md)

商品保存流程调用 Rental 包登记的专业属性校验，露营容量与工程载荷限制沿原规则执行。通用流程只传当前品类及已校验属性，专业规则从本模块的正式出口维护。[专业商品属性](../../../../../packages/rental-core/src/item-group-validation.ts)

能力执行器消费当前空间实例 reader 和审计 writer，原 provider 将原 `WorkspaceCapabilityService`、审计仓储及调用方 Prisma 事务交给 Rental 实现。启动登记器调用 `/capabilities` 的唯一组合，保留当前及历史实现。放行审计随业务事务提交，报价阻止后的拒绝留痕沿原业务调用者执行。[执行器 provider](capability-hook.runtime.ts) · [审计 provider](capability-hook.repository.ts) · [登记器](capability-hook.registrar.ts)

AI/企业/客户端消费者通过原正式业务接口读取事实和执行动作，文件ACL、金额、批准、原收据与恢复仍按原链核对。原到期[调度器](rental-due-job.scheduler.ts)和回调不得因为Core停用而丢弃已提交业务的受权收尾。[原业务接口资料](../../contracts/openapi-document.ts) · [AI组合](../ai-native/ai-native-application.providers.ts)

必要验证入口为[原Core](../../../../../tests/rental-core-v01.test.cjs)、[原业务](../../../../../tests/rental-business-v1.test.cjs)、[价格策略](../../../../../tests/rental-pricing-strategy.test.cjs)及对应专项收据/事务用例。旧失败、未验环境和完整迁移回退沿原记录保留，底座抽离按PCH受影响功能取前后对照。[拆分兼容门槛](../../../../../docs/平台底座/Core接入/平台Core接入-开发任务.md#compatibility-slices)
