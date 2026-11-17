# Rental 订阅兼容入口

本目录的服务、DTO 和公共 HTTP 通过 `@rental-os/platform-server` 的订阅子出口消费同一实现。AppModule 将 `SUBSCRIPTION_APPLICATION` 绑定到原 `SubscriptionService`。原数据库实例与真实已发布品类目录参加者在同一办理事务工作。

[公共模块接入与接口](../../../../../packages/platform-server/src/modules/subscription/README.md) · [公共后台](../../../../../packages/platform-admin/src/features/subscription/README.md) · [原四册依据](../../../../../docs/SaaS订阅/SaaS订阅-需求.md)

[服务转接](subscription.service.ts) 保留 `rentalCategoryLabels`、品类商业快照及原 Core 调用入口。[员工 Controller](subscription-staff.controller.ts) 继续提供原员工最小投影，沿原员工身份读取本人租户。统一期限、Core 使用权、成员权限和账号状态分别从原正式域核验。
