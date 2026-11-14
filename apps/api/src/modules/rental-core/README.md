# Rental Core 业务入口

Rental Core维护租赁领域事实，包括经营空间/品类、商品和资产、报价库存、订单履约、检查及金额。它是首个业务Core示范，平台身份、公共后台和原AI机制通过受控适配消费，具体报价、金额与状态仍在原Core裁定。

[RentalCoreController](rental-core.controller.ts) → [RentalCoreService](rental-core.service.ts)连接商品/资产/订单及履约入口。[RentalBusinessController](rental-business.controller.ts) → [RentalBusinessService](rental-business.service.ts)承接报价、规则、日历及价值服务。调用方从原Guard/ALS取得租户、空间、角色和地点范围，领域服务按当前对象/历史依据核权限与提交条件。[Guard](../../common/api-auth.guard.ts) · [ALS](../../common/request-identity.ts)

持久事实经[业务事实仓储](rental-business-fact.repository.ts)、[状态仓储](rental-state.repository.ts)和[原幂等](rental-idempotency.repository.ts)读写。报价、价格、规则、检查和履约依据从原关联快照读取，修订与幂等键保护并发/重复操作，结果未知通过原操作核对。主事务和外部支付/通知执行点分别由原领域实现持有。

品类解析经[RentalCategoryResolver](rental-category-resolver.service.ts)、[能力Hook](capability-hook.runtime.ts)和[空间能力](workspace-capability.service.ts)。品类内部扩展与注册新的CRM/工单Core各有独立合同；原未完动态采用和业务闭环按其四册继续验收。[Rental当前入口](../../../../../docs/Rental%20Core/Rental%20Core-协作接续.md) · [品类治理](../../../../../docs/Rental%20Core/品类治理/品类治理-协作接续.md)

AI/企业/客户端消费者通过原正式业务接口读取事实和执行动作，文件ACL、金额、批准、原收据与恢复仍按原链核对。原到期[调度器](rental-due-job.scheduler.ts)和回调不得因为Core停用而丢弃已提交业务的受权收尾。[原业务接口资料](../../contracts/openapi-document.ts) · [AI组合](../ai-native/ai-native-application.providers.ts)

必要验证入口为[原Core](../../../../../tests/rental-core-v01.test.cjs)、[原业务](../../../../../tests/rental-business-v1.test.cjs)、[价格策略](../../../../../tests/rental-pricing-strategy.test.cjs)及对应专项收据/事务用例。旧失败、未验环境和完整迁移回退沿原记录保留，底座抽离按PCH受影响功能取前后对照。[拆分兼容门槛](../../../../../docs/平台底座/Core接入/平台Core接入-开发任务.md#compatibility-slices)
