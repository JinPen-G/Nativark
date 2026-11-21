# Rental 浏览器会话

`createRentalBrowserAdminSession` 为一个 Web 宿主供给原 Zustand 会话、公共 HTTP 和 QueryClient。原后台的 HTTP 入口传入已有查询缓存，独立后台通过同一工厂准备自己的宿主实例。[工厂与输入](../browser.ts) · [会话与权限](../browser-auth-store.ts) · [刷新运输](../browser-http.ts) · [原后台入口](../../../../apps/admin/src/api/http.ts)

## 接入

```ts
import { createRentalBrowserAdminSession } from "@rental-os/rental-core/admin/browser";

const session = createRentalBrowserAdminSession({ baseURL: "/api" });
```

已有宿主可用 `queries` 传入 `createAdminSessionQueries` 返回的原实例。返回的 `runtime`、`getSnapshot`、`subscribe`、认证方法和运输共享 `useAuthStore`，公共应用使用同一个 `queryClient`。会话实例在宿主组合入口创建一次，退出或热更新销毁时调用 `dispose()` 释放监听和旧请求。[公共查询边界](../../../platform-admin/src/runtime/session-queries.ts) · [原会话窄入口](../browser-api.ts) · [公共应用组合](../../../platform-admin/src/application-context.ts)

`createRentalBrowserAdminHost` 将该实例接入十二组页面，提供原头像、企业申请和管理附件、型号图片、CSV、客户预览、组织映射权限及开业账号导航。公共应用的 `session` 使用这个浏览器实例，页面贡献使用返回的 `contexts`，并以 `Provider` 包住应用。[浏览器装配](../browser-host.tsx) · [统一页面贡献](../index.tsx)

装配时提供原登录品牌默认文案及显式品类治理展示开关。`OrderFactsEntry`、会员 AI 组件和治理 AI/Copilot 组件沿原类型化接点按需提供。订单缺 AI 展示时显示装配状态，普通业务继续使用同一页面。各组件的真实权限、模型和批准仍归原入口。

## 导航与经营范围

`createRentalNavigation` 从同一登记表解析原 Rental 深链接，保留对象参数、查询和锚点。工单通知按 `workOrderId` 定位已登记详情，同时保留原本可解析的历史页签及锚点。消息跳转再次核对当前服务端 Core 目录。租户级会员与客户端渠道使用租户绑定，其他业务页使用当前已验证的经营空间。[导航工厂](../browser-navigation.ts)

`createRentalShell` 复用原空间切换命令。成功回执提交后，原路由仍有效时进入工作台。路由已切换或外层壳已卸载时，迟到回调结束该轮导航与错误反馈。有效性由通知树外的壳保存，正常切空间重建消息投影后仍可完成导航。[薄壳](../browser-shell.tsx)

后台查询范围包含原账号权限、租户会员权限、组织及地点范围。租户会员授权变化后使用新的查询键，页面请求仍在异步前后核对原身份及范围。[浏览器宿主](../browser-host.tsx) · [会员范围](../membership/page-context.tsx)

## 身份与恢复

沿用 `rental_access_token`、`rental_refresh_token`、`rental_tenant`、`rental_user`、`rental_workspaces` 和 `rental_current_workspace`。登录、会话上下文、改密、空间切换和刷新仅接受原服务端响应，storage 同步后重新验证权限。切空间保留原空刷新令牌语义，原租户会员权限、角色、组织、地点和品类能力继续由原会话实现判定。

同文档刷新回执先提交给 Zustand，再通知 `rental-session-updated` 消费者。跨标签刷新沿公共 HTTP 的 `rental-auth-refresh` 锁，身份或空间切换先推进原会话代次并清理查询。结果未知的业务仍按原操作与收据核对。[公共 HTTP](../../../platform-admin/src/runtime/browser-http.ts) · [后台上下文](../host-context.tsx)

浏览器存储仅保存待核会话与本机偏好。后台页面、直接 URL 和正式请求的范围继续通过当前服务端权限及登记的 Core 准入复验。JSON、文本与图片消费者保留各自的范围检查，文件及客户资料沿原授权读取。

## 验证入口

必要类型检查覆盖浏览器工厂、原后台薄入口和公共应用的 session 输入。定向离线冒烟覆盖已有 storage、唯一 QueryClient、原刷新回执、空间切换、跨标签撤权及迟到响应。实际浏览器、真实 HTTP、数据库和发布按宿主的正式验收范围分别核对。
