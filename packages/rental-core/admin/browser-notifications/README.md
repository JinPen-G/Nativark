# Rental 浏览器通知

`createRentalBrowserNotifications` 将原待办、个人消息状态与内联详情绑定到一个 Rental 浏览器宿主，返回 `NotificationProvider`、`useNotifications` 和 `NoticeActions`。旧组合后台与独立后台消费同一实现。[正式工厂](index.tsx) · [原后台适配](../../../../apps/admin/src/features/notifications/NotificationProvider.tsx) · [独立外壳](https://github.com/JinPen-G/Zelo-rental-core/blob/5cef75a1814814a4a4ccc1172de15f16dc5ff74e/workspace/apps/rental-admin/src/RentalShell.tsx)

## 宿主输入

`session` 使用同一 `createRentalBrowserAdminSession` 实例。`resolveHref` 按当前身份、已登记页面和实际 Core 使用权返回路径或 `null`。标准 Core 宿主提供 `hasPageAccess`，从当前使用目录核对工作台及工单页面，目录更新同步重渲染 Provider。公共铃铛直接消费 `useNotifications()`，内联展开区渲染同一工厂的 `NoticeActions`。[输入类型](types.ts) · [公共铃铛](../../../platform-admin/src/features/notifications/HeaderNotifications.tsx)

```tsx
import type { ReactNode } from "react";
import { createRentalBrowserNotifications } from "@rental-os/rental-core/admin/browser-notifications";

const notifications = createRentalBrowserNotifications({
  session,
  resolveHref,
  hasPageAccess,
  soundScopeKey: auth => JSON.stringify([auth.tenant?.tenantId, auth.user?.id]),
});

function RentalNotifications({ children }: { children: ReactNode }) {
  return <notifications.NotificationProvider>{children}</notifications.NotificationProvider>;
}
```

`soundScopeKey` 与宿主唯一 `AdminUiProvider` 的声音范围一致，声音还核对当前会话代次。未提供时沿原本人、租户及空间通知范围。可选 `useOperator`、`aiHref` 与 `confirmationDetails` 供给原本地 AI 展示、会话入口和确认摘要，相关控件依据实际输入开放。

## 数据与个人状态

待办沿原受权工作台接口读取，缓存保留 `30_000` 毫秒、轮询保留 `60_000` 毫秒，后台标签停止轮询。同一订单的待办沿原事件规则合并，业务处理状态与个人已读各自维护。[状态 Provider](NotificationProvider.tsx) · [原客户端供给](api.ts)

本机键使用 `rental_notifications_v1` 加本人、租户与空间范围。身份或空间切换重建对应消息投影，存储事件同步同源标签页的个人元数据。解析继续执行原字段校验、500 条上限及每条 40 个事件上限。新的业务事件使对应消息重新进入收件箱。[纯模型](model.ts)

纯模型通过 `@rental-os/rental-core/admin/browser-notifications/model` 导出。它只处理待办分组和本机元数据，可用于离线调用。

## 工单操作

工单查看、领取与派工使用原养护权限。提交前重新读取工单、所属空间、状态、修订与可选人员，再沿原客户端单次提交。忙碌锁与结果未知锁保留在同一模块，确认取消、页面卸载和认证变化继续按原操作核对结果。[内联动作](NoticeActions.tsx) · [工单客户端](../work-orders/client.ts)

首次快照静默，新增收件箱事件沿原声音、可见性与跨标签去重机制播放。业务消息来自实际接口，AI 展示保留本地演示标记。

## 验证入口

必要类型与一次定向离线行为验证覆盖纯模型、作用域切换、存储监听释放、首次静默、可选 Operator、登记导航、原工单复验和单次提交。真实浏览器、业务 HTTP 与完整消息中心分别沿宿主记录核收。
