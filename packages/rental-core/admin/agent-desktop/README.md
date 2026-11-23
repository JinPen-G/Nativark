# Rental 桌面授权与会话桥接

此目录保留原管理后台的客户端授权页、表单、样式和桌面桥接。业务政策由原服务端裁定；页面不配置模型、不授予业务执行权限，也不创建另一份登录态。

- [index.tsx](index.tsx) 的 `createRentalDesktopAdmin` 接收同一 `RentalBrowserAdminSession` 及 `useNavigation`，返回客户端授权页、无 DOM 的桥接组件及原编辑器兼容入口。
- [page-context.tsx](page-context.tsx) 只供给原会话、请求和品类资料。`useNavigation` 必须订阅当前登记菜单及权限变化；菜单隐藏不替代服务端授权。宿主登记原 `/settings/client-authorization` 路径和 `system:params:manage` 租户权限。
- [DesktopBusinessPolicySettings.tsx](DesktopBusinessPolicySettings.tsx) 保留原访问范围、服务、模型三段表单，以及刷新、保存和原结果核对动作。[desktop-policy-session.ts](desktop-policy-session.ts) 在派发前保存原操作键；失应答、重挂载或迟到的旧空间回执都不能自动重试保存或丢弃该键。
- [client.ts](client.ts) 消费原 `@rental-os/shared/agent-desktop` 合同及同一 Runtime，明确关闭认证后的自动重放。历史回执只用于核对，不能冒充当前政策。
- [DesktopSessionBridge.tsx](DesktopSessionBridge.tsx) 仅识别原 preload bridge，沿当前登记菜单处理导航。切换空间和退出尊重原未保存编辑保护；并发限制、心跳、超时、取消与退订沿原实现保留。会话投影不包含凭据。

## 浏览器装配

[createRentalDesktopBrowser](../desktop-browser.tsx) 接收同一 `session`、原助手的 `useNavigation` 和当前 Web 菜单的 `useSections`，一次返回 `Provider`、`Bridge`、`ClientAuthorizationPage`、`ContentShell` 与真实 preload 判定 `isDesktop()`。`Provider` 在应用外层挂一次，`Bridge` 在同一 Router 内挂一次，覆盖原登录会话复核入口。两个返回的正文组件直接消费这一上下文，原 `createRentalDesktopAdmin` 的独立包装组件继续可用。

[菜单适配](browser-navigation.ts) 保留原登记标识，通过同一导航的 `canAccess`、`resolve` 与 `originalPath` 核当前权限和路径往返，再沿正式 `rentalDesktopPath` 校验运输路径。分组、顺序和品类称呼取自同一 Web 壳当前已过滤的菜单，缺登记、撤权和未出现在该菜单的目标不进入默认路径或桌面命令集合。`useNavigation` 与 `useSections` 均须消费这一份会话并订阅当前菜单变化。

`ContentShell` 只在真实 preload 存在时保留原 `desktop-business-content`、`content-canvas` 和订阅浮卡位置。RD 在其外继续挂原助手、消息等 Provider，各一份，并提供两个公共插槽。

```ts
RestProvider: ComponentType<{
  children: ReactNode;
  browserSession: false;
  verified: boolean;
}>;
SubscriptionExpiryFloatingCard: ComponentType;
```

`ContentShell` 从同一会话传入 `sessionVerified`，Rest 的桌面标志固定为 `false`。公共 application、两个 main、路由、正式出口和公共插槽由宿主装配。客户端授权页仍登记原公共路径及权限。该工厂不创建 Electron 主进程、preload 或新的业务运输。

定向验证在原 [agent-desktop.test.cjs](../../../../tests/agent-desktop.test.cjs)，覆盖原键恢复、动态菜单、切空间取消和卸载退订。离线 Hook 与运输夹具不代表 Electron、真实服务端或浏览器视觉验收。
