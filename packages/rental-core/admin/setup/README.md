# Rental 开业配置

本模块呈现当前经营空间的服务端就绪状态、必做与可暂缓配置，以及报价阻塞项。页面贡献与正文出口复用同一实现，配置入口通过已登记的 Core 页面或宿主公共账号入口定位。[页面贡献](index.tsx) · [页面声明](pages.ts) · [状态正文](TenantReadinessPage.tsx)

## 页面接入

1. 使用当前会话、实时会话读取器、查询范围及 `AdminRuntime` 创建页面上下文。读取前后核对同一账号、租户、经营空间和会话代次，查询信号传递给原请求。[上下文工厂](page-context.tsx) · [状态请求](client.ts)
2. 将上下文钩子传给 `createRentalSetupAdminContribution`，与其他 Rental 页面合入同一贡献。页面使用 `setup:view` 声明，兼容宿主保留订单查看、价格管理、人员管理或角色管理任一准入。[贡献工厂](index.tsx) · [原 OR 权限](pages.ts)
3. 将语言资源并入宿主同一语言目录。服务端动态配置名称与缺项说明继续从返回事实读取。[语言资源](messages.ts)

## 状态与配置入口

完成、继续配置和警告图标从 `@rental-os/platform-admin/ui` 使用原图标组件，状态文本、配置目标及原业务条件继续由本页面供给。[UI 出口](../../../platform-admin/src/components/ui/index.ts)

状态请求保留原 `/rental/v1/tenant-readiness` 接口。原 Rental Controller 委托业务运行时读取空间档案、履约网络、规则、日历、商品、价格和会员等实际配置。页面依据服务端 `ready`、状态、配置项和报价阻塞结果呈现，unavailable 项保留读取重试入口。[HTTP 入口](../../src/http-core.controller.ts) · [业务运行时](../../src/mysql-business-runtime.ts)

九个开业项使用固定映射，同时核对服务端项标识与原 `nextHref`。业务目标通过 `CorePageLocation` 解析当前登记页面，再核对目标访问要求。公共人员与角色配置由宿主提供 `accounts` 接点，调用前复核当前账号入口权限。[导航映射](navigation.ts) · [目标访问与跳转](TenantReadinessPage.tsx) · [公共账号接点](page-context.tsx)

原宿主的目标访问复用 `canAccessRoute`，沿当前角色、能力、品类和租户会员权限判断。`TenantReadinessPage` 与 `TenantReadinessBody` 均通过薄适配绑定同一上下文和登记目标。[旧宿主适配](../../../../apps/admin/src/features/settings/legacy-setup-context.tsx) · [旧页面与正文出口](../../../../apps/admin/src/features/settings/TenantReadinessPage.tsx) · [原路由权限](../../../../apps/admin/src/app/navigation.tsx)

## 验证入口

现有开业用例核对原配置就绪与首单门槛。页面映射、旧范围拒绝、类型、浏览器及真实业务接口的验证证据沿对应宿主阶段记录。[开业与首单用例](../../../../tests/tenant-ready-first-order.test.cjs) · [页面与请求实现](TenantReadinessPage.tsx)
