# Rental 客户小程序业务客户端

[正式模块入口](index.ts)提供七组业务请求工厂、客户认证工厂及七个 AI 请求工厂。原小程序 [api 入口](../../../../apps/miniprogram/src/api/orders.ts)注入 [request](../../../../apps/miniprogram/src/core/http.ts)，继续导出原方法和返回类型。合同沿 Rental 包内的[客户声明](../../src/client-contracts.ts)、[租赁声明](../../src/contracts.ts)和企业声明单源消费。

## 宿主接入

```ts
import { createRentalMiniProgramOrdersApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "./core/http";

const orders = createRentalMiniProgramOrdersApi({ request });
```

[端口](ports.ts)保持原请求选项。宿主 request 使用原 `/api/client/v1`、客户会话、响应解包、错误实例、刷新策略和范围复验。每次调用使用运输当前身份；[session](../../../../apps/miniprogram/src/core/session.ts)负责服务切换与单调上下文版本。

[目录工厂](catalog.ts)还注入公开 `tenantCode` 配置对象、原 `contractMissing` 和 `featureUnavailable`；[商户工厂](merchant.ts)注入公开 `tenantCode/appId` 配置对象与原 `contractMissing`。配置沿宿主对象读取，游客目录、渠道启动和文档的原参数与缺能力提示保持。

[认证工厂](auth.ts)使用同一正式出口的 `createRentalMiniProgramAuthApi`。宿主供给公开渠道配置、原 request/错误转换、当前服务、refresh token、会话保存和退出清理；页面通过原 `adoptSession` 采用服务端登录或注册结果。切服务、微信一次凭证、本人注销和退出沿原权限、范围与重放策略。[认证端口与用法](auth/README.md) · [原认证适配](../../../../apps/miniprogram/src/api/auth.ts)

## 请求归属与调用链

| 工厂 | 原请求范围 | 服务端入口与直接消费者 |
| --- | --- | --- |
| [addresses](addresses.ts) | 本人地址列表、保存、删除，沿 `scope: tenant` | [客户 Controller](../../src/http-client.controller.ts) → [客户地址仓储](../../src/mysql-client-delivery-address.ts)；地址页与结算页 |
| [catalog](catalog.ts) | 登录／游客目录、可用性、报价、原报价与优惠券 | 客户 Controller → [客户应用](../../src/mysql-client-application.ts)；[原目录缓存](../../../../apps/miniprogram/src/core/catalogStore.ts)与结算页 |
| [enterprise](enterprise.ts) | 政策、批准、费用确认、续租／换货、委托、原操作与结果读取 | [企业工作流 Controller](../../src/http-enterprise-workflows.controller.ts)及客户 Controller；[续租协调器](../../../../apps/miniprogram/src/core/enterprise-extension-operation.ts)、[换货申请](../../../../apps/miniprogram/src/core/enterprise-exchange-request.ts)、[费用确认](../../../../apps/miniprogram/src/core/enterprise-exchange-confirmation.ts)与原结算页 |
| [merchant](merchant.ts) | 公开服务、微信小程序渠道启动、公开文档与登录后的配置 | 客户 Controller → 原渠道与公开投影；[原商户缓存](../../../../apps/miniprogram/src/core/merchant.ts)与文档页 |
| [orders](orders.ts) | 建单、统一本人索引、订单／履约／资金、取消、续租、检查费用响应及六个原 AI 预约请求 | 客户 Controller → 客户应用及原 Core；[原预约宿主](../../../../apps/miniprogram/src/components/ai-native/booking-host.factory.ts)、结算、订单与续租页 |
| [payments](payments.ts) | 能力与小程序支付单创建、读取、查单、关闭 | 客户 Controller → 原支付服务；[微信支付宿主](../../../../apps/miniprogram/src/core/payment.ts)与支付页 |
| [profile](profile.ts) | 资料、会员、权益、资质与文件会话／下载地址 | 客户 Controller → 原会员与文件应用；资料、会员与资质页 |

本人订单索引、地址、资料、会员方案／分配和资质列表保留原租户级分面，权益等请求沿当前经营空间。企业请求继续使用原客户运输与服务端专用授权，原 query/body、URL 编码、操作键及字段投影保持。

## 幂等、恢复与读取寿命

建单、取消、续租和费用响应沿调用方原幂等键。小程序支付单的键继续位于原 body，微信 JSAPI 参数、SDK 调起及服务端付款结果核对由原支付宿主完成。资料部分更新沿微信支持的原 PUT 别名。

企业写入保留 `replayAfterRefresh: false`。未知结果沿原操作和可信收据读取，原结束请求沿既有结束键；持久化引用、独占门闸和读取前后复验由上述原操作协调器维护。

原 request 负责上下文变化后的迟到响应丢弃，页面和协调器负责 hide/unload 的寿命复验。六个原 AI 预约请求由订单工厂提供，原 orders 入口供给同一 request 并窄导出。能力、交接、接受观察、接受与提交保留 `replayAfterRefresh: false`，原提交结果读取保留原请求选项。能力观察、接受、正式提交与原结果读取分别沿原服务端合同执行，宿主绑定和默认开关由原预约宿主维护。

## AI 请求接入

原 API 供给同一客户 `request` 与已生成的 Native 校验器，工厂只消费正式 Shared 导出定义的必需 `contracts`。真实合同分别来自原 [客户 Native 运行时](../../../../apps/miniprogram/src/vendor/shared-ai-client/index.d.ts)及 [Action 运行时声明](../../../../apps/miniprogram/src/components/ai-native/entry-action-runtime.d.ts)，宿主按实际导出注入原值。

| 工厂 | 宿主供给及原消费者 |
| --- | --- |
| [ai-tasks](ai-tasks.ts) | 原任务、材料、输入和订单导航请求；[任务适配](../../../../apps/miniprogram/src/api/ai-tasks.ts)供给原运输与校验，[订单页](../../../../apps/miniprogram/src/pages/order/index.ts)和原任务会话消费 |
| [ai-task-cancellation](ai-task-cancellation.ts) | 注入同一任务实例，`readCreation` 保持同一函数引用；[取消适配](../../../../apps/miniprogram/src/api/ai-task-cancellation.ts)及[取消会话](../../../../apps/miniprogram/src/components/ai-native/client-task-cancellation-session.ts)读取原取消与结算收据 |
| [ai-quotes](ai-quotes.ts) | 原报价参数、确认、草稿选择、交接及原操作读取；[报价适配](../../../../apps/miniprogram/src/api/ai-quotes.ts)及[预约宿主](../../../../apps/miniprogram/src/components/ai-native/booking-host.factory.ts)消费 |
| [ai-public](ai-public.ts) | 还需原公开配置对象，核对请求的租户编码；匿名与登录后继续沿原 `auth` 和 `publicSessionCredential`，[公开适配](../../../../apps/miniprogram/src/api/ai-public.ts)供给 |
| [ai-goals](ai-goals.ts) | 注入同一任务实例与调用方 `current`，每次 await 前后核对页面寿命和原 signal；[目标适配](../../../../apps/miniprogram/src/api/ai-goals.ts)及[目标选择器](../../../../apps/miniprogram/src/components/ai-native/ai-goal-picker/index.ts)消费 |
| [ai-booking-transfers](ai-booking-transfers.ts) | 调用方供给原上下文 `current`，转移签发、消费和收据读取均保留原前后复验；[转移适配](../../../../apps/miniprogram/src/api/ai-booking-transfers.ts)及[原转移会话](../../../../apps/miniprogram/src/components/ai-native/client-booking-transfer-session.ts)消费 |
| [ai-entry-actions](ai-entry-actions.ts) | 同一会话对象、上下文版本、公开配置和服务器时钟；[动作适配](../../../../apps/miniprogram/src/api/ai-entry-actions.ts)导出原捕获及 API 创建函数，[原动作组件](../../../../apps/miniprogram/src/components/ai-native/ai-entry-actions/index.ts)消费 |

Action 端口返回原会话对象，完整客户与服务投影和对象引用继续参加复验。宿主不得重新投影或复制会话。原动作来源、对象关联、数量、去重、过期和支付字段校验保持。AI POST 保留原超时及 `replayAfterRefresh: false`，unknown 仍沿原操作读取。业务执行、页面挂接及服务端授权分别沿原入口。

## 原生编译与微信打包

准备项目锁定依赖后，使用原微信宿主构建入口。

```bash
npm run build:miniprogram
npm run typecheck -w @rental-os/miniprogram
```

[原生配置](../../tsconfig.native-clients.json)定义 `dist-clients/` 的 CommonJS 和声明，正式入口为 `dist-clients/clients/miniprogram/index.js` 及同名声明。微信构建在本树单一任务临时目录中编译当前 Shared 声明及完整 Native 工厂，并按实际包声明映射到私有产物。七组业务工厂、七个 AI 请求工厂、原 16 方法认证及六个 AI 预约请求消费同一入口，原 time 出口按实际引用打包。构建和 `--check` 退出时释放私有声明与 Native 产物。

[公共打包函数](../../../../scripts/miniprogram-shared-types.cjs)读取已声明入口，将实际 CommonJS 闭包与原 MIT 许可写入微信发布包的 `vendor/rental-core/`，并改写原宿主的正式包导入。正文解析器和六个原收据／服务选择函数沿 Shared 正式出口追到当前平台／Core 源码，复用原函数体。原 AI webpack 只接受既有 Shared/Zod 和五个已核定 Core 源文件。最终所有 JS 的 `require` 均须解析到本包 JS/JSON；缺出口、缺文件、外部／动态依赖或新 Core 依赖会停止构建。[微信构建入口](../../../../apps/miniprogram/scripts/build.cjs) · [AI 运行时](../../../../scripts/miniprogram-ai-runtime.cjs)

发布仍用 `npm run build:miniprogram:release`，沿原公开 API、商户与 AppID 配置。隔离验证可在原命令后传 `--out-dir`，目标限于本树 `output/.tmp/<任务>/<客户端>`；失败清除本次输出，成功产物由创建者按交付用途保留或清理。真实微信、业务认证与原结果恢复按对应环境验收。

## 验证入口

必要类型检查核对七组业务工厂、七个 AI 请求工厂、认证工厂及原 API 消费者；定向冒烟对照原请求路径、选项、返回与错误，并复用[原小程序测试](../../../../tests/miniprogram-static.test.cjs)的运输、范围、支付单和缓存断言。认证片已核原 16 方法、会话采用与退出清理，正式 Native 声明与原客户宿主类型通过；这份证据不代替加入认证后的完整微信发布包验证。正式包出口、类型解析和微信构建由实际宿主接线核定，真实 HTTP、微信、数据库与供应商证据按对应环境取得。
