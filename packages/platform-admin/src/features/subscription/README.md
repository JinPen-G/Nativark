# 公共订阅后台

宿主在现有 `AdminRuntimeProvider` 与同一查询缓存下使用 `/subscription` 的页面与提醒。公共应用工厂已装配全部六条订阅路由，原 Rental 后台入口再导出同一实现。

| 入口 | 用途 |
| --- | --- |
| [路径](subscriptionRoutes.ts)、[页面门禁](SubscriptionRoute.tsx)、[原权限口径](subscription-access.ts) | 直接路由和菜单共用固定路径，租户查看/申请与 SaaS 办理分别开放 |
| [客户端](client.ts) | `createSubscriptionClient(runtime.request)` 复用宿主唯一 HTTP 和会话围栏 |
| [租户页](TenantSubscriptionPage.tsx)、[版本对比](SubscriptionProPage.tsx)、[申请详情](SubscriptionRequestDetailPage.tsx) | 当前租户聚合事实、真实年费、原申请及撤销 |
| [平台列表](PlatformSubscriptionsPage.tsx)、[详情](PlatformSubscriptionDetailPage.tsx)、[功能目录与定价](SubscriptionCatalogPage.tsx) | 实际租户选择、办理、特批、原目录和价格版本 |
| [办理表单](PlatformSubscriptionActionForm.tsx)、[日期与 payload](subscriptionOperations.ts) | 原修订、周年/时区转换、统一截止、下期排期和关联申请 |
| [到期浮窗](SubscriptionExpiryFloatingCard.tsx)、[关闭范围](subscriptionReminder.ts) | 无金额摘要，关闭状态按账号/租户/修订/阶段/服务自然日隔离 |
| [对比组件来源](plan-comparison/SOURCE.md) | 保留原 UIArc 来源、样式与交互，展示服务端实际价格与发布状态 |

租户查看和申请延续 `rental-os:subscription:view/manage` 的原平台管理员、通配或明确权限口径。SaaS 办理延续原 SaaS 管理身份。页面可见性从宿主已验证会话读取，HTTP 继续经服务端 Guard。公共订阅入口具有租户级范围，业务 Core 和原经营空间的最终权限在各自服务端入口核验。

查询键与表单失效范围保持原逻辑。切换账号、租户或权限后，宿主中止旧请求并清理同一缓存。浮窗跨普通页面导航保持当前关闭状态，到期计时与旧请求各自清理。申请按钮只保存原申请，实际开通/续费、收费依据和审计由 [公共服务](../../../../platform-server/src/modules/subscription/README.md) 办理。

已有宿主可继续导入原页面位置，或使用 `@rental-os/platform-admin/subscription`。单独使用客户端时注入已有 `request`。字段来自 `@rental-os/platform-contracts/subscription`，资料与验证见 [公共后台包](../../../README.md) 和 [订阅服务验证](../../../../platform-server/src/modules/subscription/README.md#接口与验证)。

## 语言资源

公共 `LocaleProvider` 合并 `subscriptionMessages`，提供统一语言状态和翻译函数。订阅列表、申请、办理及功能目录沿页面原有的 `t` 调用读取界面词条。[词条资源](messages.ts) · [公共语言入口](../../app/locale.tsx) · [功能目录弹层](FeatureCatalogModal.tsx)
