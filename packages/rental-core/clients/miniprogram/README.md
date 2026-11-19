# Rental 客户小程序业务客户端

[正式模块入口](index.ts)提供七组业务请求工厂。原小程序 [api 入口](../../../../apps/miniprogram/src/api/orders.ts)注入 [request](../../../../apps/miniprogram/src/core/http.ts)，继续导出原方法和返回类型。合同沿 Rental 包内的[客户声明](../../src/client-contracts.ts)、[租赁声明](../../src/contracts.ts)和企业声明单源消费。

## 宿主接入

```ts
import { createRentalMiniProgramOrdersApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "./core/http";

const orders = createRentalMiniProgramOrdersApi({ request });
```

[端口](ports.ts)保持原请求选项。宿主 request 使用原 `/api/client/v1`、客户会话、响应解包、错误实例、刷新策略和范围复验。每次调用使用运输当前身份；[session](../../../../apps/miniprogram/src/core/session.ts)负责服务切换与单调上下文版本。

[目录工厂](catalog.ts)还注入公开 `tenantCode` 配置对象、原 `contractMissing` 和 `featureUnavailable`；[商户工厂](merchant.ts)注入公开 `tenantCode/appId` 配置对象与原 `contractMissing`。配置沿宿主对象读取，游客目录、渠道启动和文档的原参数与缺能力提示保持。

## 请求归属与调用链

| 工厂 | 原请求范围 | 服务端入口与直接消费者 |
| --- | --- | --- |
| [addresses](addresses.ts) | 本人地址列表、保存、删除，沿 `scope: tenant` | [客户 Controller](../../src/http-client.controller.ts) → [客户地址仓储](../../src/mysql-client-delivery-address.ts)；地址页与结算页 |
| [catalog](catalog.ts) | 登录／游客目录、可用性、报价、原报价与优惠券 | 客户 Controller → [客户应用](../../src/mysql-client-application.ts)；[原目录缓存](../../../../apps/miniprogram/src/core/catalogStore.ts)与结算页 |
| [enterprise](enterprise.ts) | 政策、批准、费用确认、续租／换货、委托、原操作与结果读取 | [企业工作流 Controller](../../src/http-enterprise-workflows.controller.ts)及客户 Controller；[续租协调器](../../../../apps/miniprogram/src/core/enterprise-extension-operation.ts)、[换货申请](../../../../apps/miniprogram/src/core/enterprise-exchange-request.ts)、[费用确认](../../../../apps/miniprogram/src/core/enterprise-exchange-confirmation.ts)与原结算页 |
| [merchant](merchant.ts) | 公开服务、微信小程序渠道启动、公开文档与登录后的配置 | 客户 Controller → 原渠道与公开投影；[原商户缓存](../../../../apps/miniprogram/src/core/merchant.ts)与文档页 |
| [orders](orders.ts) | 建单、统一本人索引、订单／履约／资金、取消、续租与检查费用响应 | 客户 Controller → 客户应用及原 Core；结算、订单与续租页 |
| [payments](payments.ts) | 能力与小程序支付单创建、读取、查单、关闭 | 客户 Controller → 原支付服务；[微信支付宿主](../../../../apps/miniprogram/src/core/payment.ts)与支付页 |
| [profile](profile.ts) | 资料、会员、权益、资质与文件会话／下载地址 | 客户 Controller → 原会员与文件应用；资料、会员与资质页 |

本人订单索引、地址、资料、会员方案／分配和资质列表保留原租户级分面，权益等请求沿当前经营空间。企业请求继续使用原客户运输与服务端专用授权，原 query/body、URL 编码、操作键及字段投影保持。

## 幂等、恢复与读取寿命

建单、取消、续租和费用响应沿调用方原幂等键。小程序支付单的键继续位于原 body，微信 JSAPI 参数、SDK 调起及服务端付款结果核对由原支付宿主完成。资料部分更新沿微信支持的原 PUT 别名。

企业写入保留 `replayAfterRefresh: false`。未知结果沿原操作和可信收据读取，原结束请求沿既有结束键；持久化引用、独占门闸和读取前后复验由上述原操作协调器维护。

原 request 负责上下文变化后的迟到响应丢弃，页面和协调器负责 hide/unload 的寿命复验。旧 orders 入口保留六个原 AI 宿主请求，沿原权限和同一运输执行。

## 验证入口

必要类型检查核对七组工厂与原 API 消费者；定向冒烟对照原请求路径、选项、返回与错误，并复用[原小程序测试](../../../../tests/miniprogram-static.test.cjs)的运输、范围、支付单和缓存断言。正式包出口、类型解析和微信构建由实际宿主接线核定，真实 HTTP、微信、数据库与供应商证据按对应环境取得。
