# 公共订阅接入

订阅服务维护租户统一期限、下期排期、功能目录、标准年费、申请与办理审计。套餐、Core 使用权、成员分配和账号状态由各自正式服务共同校验。租户续费只更新本模块的订阅事实。

| 阅读入口 | 职责 |
| --- | --- |
| [租户 HTTP](subscription.controller.ts)、[SaaS HTTP](subscription-platform.controller.ts) | 保持原单数自读/申请与复数跨租户办理路径，主体来自公共 Guard 的当前会话 |
| [HTTP 政策](subscription-http-policy.ts)、[OpenAPI schema](subscription-openapi.ts) | 公共宿主和原 API 共用的权限、路径、请求/响应和查询字段 |
| [应用服务](subscription.service.ts) | 父锁、修订检查、价格版本、申请关联、办理与审计在同一原事务完成 |
| [存储与参加者](subscription-store.ts) | 七张订阅表、公共租户读取及参数化 SQL，由宿主唯一数据库提供 |
| [状态投影](subscription-state.ts)、[服务时区与周年](subscription-term.ts) | 读取按当前时间投影排期，写入保留原周年锚点和半开期间 |
| [独立公共 schema](../../../../../apps/platform-api/prisma/schema.prisma) | 公共期限和办理表，独立公共迁移链维护 |
| [公共后台](../../../../platform-admin/src/features/subscription/README.md) | 聚合视图、版本对比、申请、办理、目录和到期浮窗 |
| [Rental 转接](../../../../../apps/api/src/modules/subscription/subscription.service.ts) | 原 Prisma 与真实已发布品类目录参加者，兼容员工投影和原 Core 调用 |

## 装配

`PlatformServerModule.register` 从同一 `useFactory` 数据库装配认证、管理、外观及订阅。两个订阅 Controller 通过 `SUBSCRIPTION_APPLICATION` 指向同一个 `SubscriptionService`，直接构造服务时从 `/subscription` 与 `/subscription-store` 导入。

行业目录由宿主提供可选 `subscriptionCategories`。`assertPublished(transaction, codes)` 在原办理事务核验已发布编码，`labels(tenantId?)` 返回当前可见的编码与名称。无 Core 组合具有真实空目录，可以处理公共无品类功能及一般申请。带非空适用范围的写入需要实际参加者，缺失时返回 503。历史申请重试优先读取原待处理申请，目录变化继续保留原申请事实。

租户路径位于 `/api/platform/subscription`。`view` 与 `category-labels` 沿原 `rental-os:subscription:view`，申请及撤销沿 `rental-os:subscription:manage`。`reminder` 为当前已登录租户的无金额摘要。SaaS 管理路径位于 `/api/platform/subscriptions`，沿原 SaaS 身份的 `system:tenant:subscription:manage` 口径。

办理输入保留 `expectedRevision`、服务时区、`serviceYears` / `endAt` 二选一、含税口径和价格版本。线下办理与原申请关联由服务端执行。PRO 正式销售沿原关闭条件，受控试点和历史登记需要实际依据。金额缺失保持待确认，未发布年费保持待公布。

核心边界从租户父锁开始。期限修订、分段、关联申请与审计任一步失败由原事务回滚。等待锁后重新读取当前时间与排期，处理周年、到期和相邻期间。功能授权依附当前有效订阅，Core 主动停用、成员撤权和账号冻结继续由原授权域裁定。

## 接口与验证

构建后的 `npm run api:document:platform` 输出同源 OpenAPI，宿主的 `/api/openapi.json` 提供同版本声明。原 API 保留原 operationId，并消费相同公共订阅 schema。

定向验证复用 [服务与事务](../../../../../tests/saas-subscription-service.test.cjs)、[日历与时区](../../../../../tests/saas-subscription-calendar.test.cjs)、[表单与提醒](../../../../../tests/saas-subscription-admin.test.cjs)、[原路由与权限](../../../../../tests/saas-subscription-framework.test.cjs) 和 [Rental 品类参加者](../../../../../tests/category-subscription-identity.test.cjs)。执行方式与环境边界先核 [项目验证规则](../../../../../AGENTS.md#修改验证与交付)。
