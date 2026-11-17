# Rental 第三方服务兼容入口

[公共模块](../../../../../packages/platform-server/src/modules/integrations/README.md) 持有配置、密钥、出站校验、原短信运行和对象存储签名。原 Controller、DTO、配置及短信服务消费同一公共实现，AppModule 为两个 HTTP token 提供原实例。

[业务参加者](rental-integration-business.participant.ts) 读取原租赁结算配置，并在配置行锁所在事务核支付／退款、短信队列及文件／上传依赖。原三参数 `TenantIntegrationService` 构造入口保留。

[支付运行](payment.runtime.service.ts) 继续维护原订单、资金、回调与恢复，并提供原连接探针。[文件运行](file-storage.runtime.service.ts) 继承公共存储接点，原业务引用、ACL、字节冻结、上传／删除收据及清理归本宿主。[通知运行](tenant-integration.runtime.service.ts) 转接公共发送／回执，Rental 的模板、批准、outbox 与原结果仍由所属业务服务维护。

原运营适配、TBox、任务交换和业务账沿其实际消费者维护。[旧运营入口](integrations.controller.ts) · [服务](integrations.service.ts) · [仓储](integrations.repository.ts)
