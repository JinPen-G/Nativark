# 平台管理与现有业务适配

[PlatformController](platform.controller.ts) → [PlatformService](platform.service.ts) 保留原管理方法和内存演示。持久化租户、人员和角色经 [原 HTTP 适配](public-management.adapter.ts) 使用同一 [公共管理服务](../../../../../packages/platform-server/src/modules/platform/README.md)，组织、安全及字典编号也使用原公共应用实例。原账号密码、会话、角色映射和管理权限继续来自同一公共身份表。

公共管理在原 ALS 及持久化主体上锁定会话、租户、账号和角色，保存与原审计共用 Serializable 事务。SaaS 管理者通过租户路径选择目标，人员和角色管理使用本人租户及原数据范围。电话和组织省略时保留存量，权限单独保存保留角色资料；具体合法自身撤权沿写入前复验及原提交结果处理。[当前请求身份](../../common/request-identity.ts) · [公共数据投影](../../../../../packages/platform-server/src/common/platform-data-permission.ts)

[Rental 管理兼容](../../../../../packages/rental-core/src/public-management-compatibility.ts) 在同一事务读取品类、能力、空间与订单汇总，解释原权限目录和按钮，并保护空间引用角色及空间管理员账号。[PlatformRepository](platform.repository.ts) 继续提供原租赁初始化、业务范围与认证适配，公共租户创建由公共 Controller 及服务办理。[公共 HTTP](../../../../../packages/platform-server/src/modules/platform/platform-management.controller.ts)

当前目录也包含Rental领域适配，包括租户经营空间创建/初始化、共享租赁客户、会员及企业资格/账期。原租赁bootstrap在同事务调用Rental初始化，不能将初始化回调改成默认成功。会员资料和订单/财务范围分别裁定，新Core的同名客户对象按自身合同与数据归属维护。[会员服务](membership.service.ts) · [共享客户仓储](shared-customer.repository.ts) · [企业结算](customer-corporate-settlement.service.ts)

会员、客户状态和企业门户已通过正式Rental子出口使用同一实现，原Controller和请求类转接同一类。宿主只供给同一数据源、主档写入者及[HTTP服务别名](../rental-core/rental-http.providers.ts)；身份仍由原Guard/ALS验证。[会员HTTP](../../../../../packages/rental-core/src/http-membership.controller.ts) → [会员应用](../../../../../packages/rental-core/src/mysql-membership.ts) / [门户授权](../../../../../packages/rental-core/src/mysql-enterprise-portal.ts) → [客户状态仓储](../../../../../packages/rental-core/src/mysql-customer-operations.ts)。客户治理和合并应用尚在本目录，继续按同一业务边界迁入。

原 Core 管理消费当前平台角色映射，SaaS 授予租户 Core 使用权，租户管理者分配成员，再由 Core 绑定与业务范围实现消费。[原 Core 组合](../core-host/README.md) · [公共管理调用链](../../../../../packages/platform-server/src/modules/platform/README.md)

接口资料沿[OpenAPI](../../contracts/openapi-document.ts)及[公共类型出口](../../../../../packages/shared/src/index.ts)，必要验证从[租户管理写权](../../../../../tests/tenant-admin-privilege-write.test.cjs)、[租户成员](../../../../../tests/tenant-membership-policy.test.cjs)与[原租户访问原子性](../../../../../tests/tenant-access-atomic.test.cjs)选择。逐项先查读写及环境前置，静态检查与真实数据库证据分别记录。
