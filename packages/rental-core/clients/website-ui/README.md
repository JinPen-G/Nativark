# Rental 客户网站前端

完整租赁客户网站的 React 页面贡献，沿原网站迁入 App、Site/Auth 上下文、页面、组件、语言、主题与样式。原 15 条路由、按需分包和真实／演示数据边界保持。

消费本 UI 入口时，宿主须按其 package 依赖准备 `@rental-os/shared@0.1.0`，与 Rental 包声明的 Shared peer 版本一致。该 peer 的 optional 标记允许未消费这些 UI 出口的宿主省略依赖。

## 接入

宿主创建一个 [RentalWebsiteHost](host.ts)，交给根组件。原浏览器宿主实现见 [website-host.ts](../../../../apps/tenant-website/src/website-host.ts)。

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RentalWebsite } from "@rental-os/rental-core/clients/website-ui";
import { websiteHost } from "./website-host";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><RentalWebsite host={websiteHost} /></StrictMode>,
);
```

宿主输入按原单网站寿命保持同一对象。直接使用 source 出口的页面或数据时，先调用同一 [configureRentalWebsiteHost](host.ts)。原路径转发已安装原浏览器宿主，原 App 也供给同一对象。更换宿主对象会拒绝，跨租户切换继续由原 SiteProvider 和客户协调器处理。

| 输入 | 宿主责任 |
| --- | --- |
| apiBase、baseDomain、defaultTenant | 原公开构建参数，分别来自 VITE_API_BASE、VITE_BASE_DOMAIN、VITE_DEFAULT_TENANT |
| publicClient | 使用同一基址的原 [公开客户端工厂](../website/index.ts) |
| session | 同一 [客户会话协调器](../../../web-client/src/session.ts)的原运输、登录、登出、切空间、代次和订阅函数 |
| request | 原公开及 AI 公开请求的 fetch，登录态请求仍由客户运输执行 |
| localStorage、sessionStorage、locks | 原可靠存储与浏览器锁，业务派发前仍核对原引用已保存，缺锁的原受控动作继续拒绝 |
| assetUrl、photoSources | 原宿主资产 URL 与署名，映射只处理宿主拥有的资产，租户远端配置继续按原投影消费 |

[host.ts](host.ts)只提供输入适配，服务端持有身份、授权、库存、报价、支付和原业务收据。原 API 工厂正文在 [website](../website/README.md)单源维护。

## 源码链路

- [App](App.tsx) → [SiteProvider](SiteContext.tsx) → [租户解析](data/resolveTenant.ts)、[公开映射](data/remoteSite.ts) → [目录](data/siteRepository.ts)。自定义域名仍向公开 resolveHost 核对，真实目录就绪前隔离演示商品。
- [AuthProvider](AuthContext.tsx) → [原认证与读取围栏](data/authClient.ts) → [认证／session 工厂](../website/README.md)。迟到页面回包不重写协调器已提交会话，安全 GET 与单次写入沿原运输策略。
- [首页查询](components/RentalFinder.tsx) → [目录条件](components/CatalogConditions.tsx) → [商品详情](pages/ProductDetailPage.tsx) → [预约](pages/BookingPage.tsx)及[真实报价](components/RemoteBooking.tsx) → [本人订单](pages/OrderPages.tsx)。未知金额和支付事实保留原缺失表达。
- [企业预约](components/EnterpriseBookingApproval.tsx)、[原订单提交](components/useEnterpriseOrderSubmission.ts)、[延期](components/EnterpriseExtensionApproval.tsx)及[换货申请](components/enterprise-exchange-request.ts)／[确认](components/enterprise-exchange-confirmation.ts) → 原 session 工厂及原操作收据。未知结果保留原操作键，撤销、确认和恢复仍按原门槛执行。
- [AI 预约交接](features/ai-native/booking-handoff.ts)、[交接宿主](features/ai-native/booking-host.factory.ts)、[目标恢复](features/ai-native/client-goal-session.ts)和[任务恢复](features/ai-native/client-task-session.ts)消费原受控业务 API，保留发布、本人／空间、批准和原材料核验。

[styles.css](styles.css)、[theme.ts](theme.ts)和[i18n.ts](i18n.ts)沿原视觉与语言实现。[目录演示](data/catalog.ts)与本地演示订单保留明确隔离，正式订单读取原 API。

## 验证码请求恢复

[登录与注册页](pages/LoginPage.tsx)按当前商户、手机号和用途，在原宿主 `sessionStorage` 保存原请求键后派发。该引用在页面离开或刷新后保留，保存／读取失败时停止派发；引用不含验证码、密码或一次性证明。核对原请求使用同一键，用户点击“重新获取验证码”才产生新键。倒计时沿服务端返回，冷却结束或原挑战到期均保留原引用。

只有原状态为待验证、期限有效且投递方式已确认的挑战可进入验证。未知投递、过期、失败与已消费回执显示相应恢复入口。当前商户／手机号／用途代次变化或卸载会隔离迟到结果，快速重复点击沿同一执行占用控制；恢复原请求保留用户已输入验证码。

注册页取得证明后，先在当前页面保留完整原注册输入，再提交注册。提交失应答后的再次提交沿原证明、输入、同意时间和请求键核对，不重复验证已消费的验证码。明确重新获取验证码或改变商户／手机号／用途会清除旧页面提交；证明和密码不写入存储。注册已完成后的自动登录也使用原注册资料。

## 路由

`/`、`/products`、`/category/:categoryId`、`/product/:productId`、`/booking/:productId`、`/login`、`/account`、`/orders`、`/orders/:orderId`、`/about`、`/guide`、`/help`、`/agreement`、`/privacy`和缺失页 `*`。

## 资产与验证

字体 @font-face 由宿主样式声明，原规则见 [宿主样式](../../../../apps/tenant-website/src/styles.css)。原摄影、生成图片 sidecar、标志、Manrope 和许可分别保留在 [media](../../../../apps/tenant-website/public/media)、[brand](../../../../apps/tenant-website/public/brand)和[fonts](../../../../apps/tenant-website/public/fonts)的唯一原稿。前端包通过明确宿主映射使用这些资产。

原验证入口为 [组件与定向行为冒烟](../../../../apps/tenant-website/scripts/storefront-render-cases.tsx)、[租户与本人订单兼容](../../../../tests/tenant-website-resolve.test.cjs)和[企业消费者](../../../../tests/enterprise-consumers.test.cjs)。前端类型／内存构建与离线 fixture 只验证对应源码链路。浏览器、真实业务 HTTP／数据库、支付及生产发布沿各自验收处理。
