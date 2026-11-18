# Rental 经营空间能力后台

能力目录、配置、实现升级和生命周期审计使用原 Rental 能力合同与服务端方法。生产就绪、未实现、品类适用、Core 内建及状态口径沿原字段呈现。

## 页面与数据入口

- [页面声明](pages.ts)提供当前页名称、经营基础分组和能力权限，兼容地址为 `/rental/capabilities`。
- [页面贡献](index.tsx)把本页加入同一个 Rental Core，宿主供给[当前上下文](page-context.ts)。
- [请求工厂](client.ts)复用宿主唯一认证请求，读取接收取消信号。原配置和实现升级保留代码、原因、配置和期望修订。
- [业务正文](CapabilityGovernancePage.tsx)复用公共 CorePage、原列表与卡片、Form、SaveButton 和原生 UIArc 按钮。

上下文的 `scopeKey` 与 `currentScopeKey` 包含当前租户、Rental 经营空间、用户、权限及会话代次。请求在派发前与返回后核对同一范围。保存与升级完成后调用宿主原 `refreshSession`，已启用能力和菜单使用原会话结果。

生命周期表单共用[现有 Rental 编辑围栏](../orders/useOrderEditor.ts)，每次打开具有独立代次。按钮和回车等待同一校验及原保存 Promise，失败保留输入并显示原错误，请求在途时保留原编辑对象。配置字段与兼容关系 JSON 转换沿原配置描述，提交使用打开时的修订。

## 共同装配接点

从 `@rental-os/rental-core/admin/capabilities`、`/admin/capabilities/client` 和 `/admin/capabilities/pages` 使用页面、请求和声明。[统一 Rental 贡献](../index.tsx)通过 `useCapabilityContext` 供给本页当前上下文，与订单和养护只登记一份 Core 贡献。标准宿主的 Core 清单须声明 `capability` 资源的 `view` 与 `manage` 权限，页面读取和配置变更分别使用这两项声明。

卡片按钮从 `@rental-os/platform-admin/native-ui` 使用原 UIArc Button，保留原参数和动效。公共出口由[原生组件接点](../../../platform-admin/src/native-ui.ts)提供；一般业务表单继续使用 `/ui`。

[旧宿主薄适配](../../../../apps/admin/src/features/rental-core/CapabilityGovernancePage.tsx)以原 AuthStore 和请求代次供给当前范围，沿原 `bootstrap` 刷新已启用能力。查看允许原查看或治理权限，写入要求治理权限。权限、经营空间或代次变化时，原页面回调停止派发。

[原 API 入口](../../../../apps/admin/src/api/rentalCore.ts)将四个能力方法转接到同一请求工厂，继续供给原方法名和请求载荷。

旧宿主仍按原地址和权限消费该页面；完整 Rental 标准清单、数据与独立主装配继续由业务包交付，不能用其他 Core 的清单代替。

## 验证入口

原业务状态和修订语义由[能力验证](../../../../tests/workspace-capability.test.cjs)定位，公共保存行为沿[现有编辑验证](../../../../tests/rental-order-command-review.test.cjs)复用。宿主验收分别核对当前权限、双范围切换、浏览器和真实 API。
