# 平台管理与现有业务适配

[PlatformController](platform.controller.ts) → [PlatformService](platform.service.ts) → [PlatformRepository](platform.repository.ts)负责当前租户、账号、组织、角色、参数和审计入口。原账号密码/会话、角色映射和管理权限是Core接入继续复用的事实来源。

租户创建、状态和当前认证投影在原仓储读写Tenant/User/AuthSession，角色与Permission通过原分配及当前活跃状态计算。SaaS管理者显式选择目标租户，租户管理者仍限制到自身租户；成员和角色调整保留修订/事务及原审计。代码中的数据所有者按实际服务判断。[当前请求身份](../../common/request-identity.ts) · [数据投影](../../common/data-permission.ts)

当前目录也包含Rental领域适配，包括租户经营空间创建/初始化、共享租赁客户、会员及企业资格/账期。原租赁bootstrap在同事务调用Rental初始化，不能将初始化回调改成默认成功。会员资料和订单/财务范围分别裁定，新Core的同名客户对象按自身合同与数据归属维护。[会员服务](membership.service.ts) · [共享客户仓储](shared-customer.repository.ts) · [企业结算](customer-corporate-settlement.service.ts)

原Core管理消费当前平台角色映射，SaaS授予租户Core使用权，租户管理者分配成员，再由Core绑定/业务范围实现消费。独立公共租户创建和基础投影的精确拆分候选沿PCH原记录推进。[原Core组合](../core-host/README.md) · [平台数据及消费者归属](../../../../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-ownership-baseline-20261114)

接口资料沿[OpenAPI](../../contracts/openapi-document.ts)及[公共类型出口](../../../../../packages/shared/src/index.ts)，必要验证从[租户管理写权](../../../../../tests/tenant-admin-privilege-write.test.cjs)、[租户成员](../../../../../tests/tenant-membership-policy.test.cjs)与[原租户访问原子性](../../../../../tests/tenant-access-atomic.test.cjs)选择。逐项先查读写及环境前置，静态检查与真实数据库证据分别记录。
