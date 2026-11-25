# Rental 官网登录态业务客户端

[工厂](../session.ts)提供 `createRentalWebsiteSessionClient(authedJson)`。原网站 [authClient](../../../../../apps/tenant-website/src/data/authClient.ts)注入同一个 JSON 请求入口，并通过原 `sessionApi` 供页面和业务协调器消费。请求字段与结果从本包的客户及企业合同单源读取。

## 接入

`@rental-os/rental-core/clients/website` 的正式出口提供工厂和 `RentalWebsiteSessionRequest` 类型。宿主提供原 `authedJson`。

```ts
import { createRentalWebsiteSessionClient } from "@rental-os/rental-core/clients/website";

const sessionApi = createRentalWebsiteSessionClient(authedJson);
```

宿主 [AuthContext](../../../../../apps/tenant-website/src/AuthContext.tsx)维护客户会话，原 `authedFetch` 经 [web-client](../../../../web-client/src/session.ts)发送当前商户、本人和经营空间请求。安全 GET 沿原策略刷新一次，业务写入按原策略派发。JSON 响应解包及 `ClientTransportError` 沿原入口传播。

## 业务归属与消费者

| 方法组 | 原服务端入口 | 直接消费者 |
| --- | --- | --- |
| 目录、可用性、报价及原报价 | [客户 HTTP](../../../src/http-client.controller.ts) → [客户应用](../../../src/mysql-client-application.ts) → 原 Core | [真实预约](../../../../../apps/tenant-website/src/components/RemoteBooking.tsx) |
| 企业政策、批准、委托、续租、换货与原结果 | [企业工作流 HTTP](../../../src/http-enterprise-workflows.controller.ts)及客户 HTTP → 原企业授权与业务服务 | [企业建单](../../../../../apps/tenant-website/src/components/useEnterpriseOrderSubmission.ts)、[续租](../../../../../apps/tenant-website/src/components/EnterpriseExtensionApproval.tsx)、[换货](../../../../../apps/tenant-website/src/components/enterprise-exchange-request.ts) |
| 本人订单列表、建单与原订单 | 客户 HTTP → 客户应用及原 Core | [订单页](../../../../../apps/tenant-website/src/pages/OrderPages.tsx)与真实预约 |
| 支付能力与支付意图 | 客户 HTTP → 原支付运行及原金额裁定 | 订单页 |
| 地址、优惠券和通知 | 客户 HTTP → 原客户、会员及通知应用 | [账户页](../../../../../apps/tenant-website/src/pages/AccountPage.tsx)与真实预约 |

普通客户读取沿本人及正式公开范围。企业请求继续经专用企业关系、角色、空间、付费及字段投影授权。工厂每次调用宿主原请求函数，当前会话及范围由运输与业务服务复验。

## 参数、原操作与读取寿命

路径、URL 编码、分页默认值、缺值过滤、空查询尾部和原返回类型保持原语义。`enterpriseCommand` 继续消费原协调器提供的企业路径。`enterpriseOrderDelegation` 保留 `cache: "no-store"`。`createOrder` 保留原幂等请求头，`createPaymentIntent` 将同一个原键写入原 body 和兼容请求头。

企业写入、明确结束及未知结果沿原操作协调器保存和核对原引用。换货请求与结束收据见 [原换货协调器](../../../../../apps/tenant-website/src/components/enterprise-exchange-request.ts)，续租及建单由上述消费者维护当前寿命、Web Lock 和原操作。取消、隐藏、卸载、切换本人或空间后的返回仍按原消费者复验，未知写入结果继续读取原收据。

宿主保留客户认证、空间切换、本人资料的最小字段投影及其读取寿命，以及现有 AI/Booking 宿主调用。公开网站工厂与原 `/public/availability` 待核定范围见 [公开客户端](../README.md)。

## 验证入口

[客户端类型配置](../../tsconfig.json)与 [网站类型配置](../../../../../apps/tenant-website/tsconfig.json)核对工厂、原薄消费者及直接页面。一次定向冒烟通过原 `sessionApi` 对照全部业务方法的路径、选项、body、结果及错误，并核对原运输的 GET 刷新与写入策略。现有 [企业消费者](../../../../../tests/enterprise-consumers.test.cjs)和 [网站读取](../../../../../tests/tenant-website-resolve.test.cjs)保留原协调器与迟到响应断言。包构建、浏览器、真实 HTTP/数据库及支付验证按实际宿主另行取证。
