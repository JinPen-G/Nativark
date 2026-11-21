# Rental 官网认证与本人资料

本模块提供 `createRentalWebsiteAuthClient(ports)` 与 `createRentalWebsiteAccountClient(ports)`。原官网保留公开 POST、公共客户会话、AuthBridge 和读取寿命，通过两个工厂消费同一认证与资料实现。[源码](../auth.ts) · [原官网接线](../../../../../apps/tenant-website/src/data/authClient.ts)

## 认证接入

从 `@rental-os/rental-core/clients/website` 导入工厂，注入宿主原公开请求、登录、退出与原引用清理。

```ts
import { createRentalWebsiteAuthClient } from "@rental-os/rental-core/clients/website";

const authApi = createRentalWebsiteAuthClient({
  clientV1,
  postPublic,
  customerLogin,
  logoutCustomerSession,
  minimizeRecovery: () => minimizeClientRecoveryStorage(localStorage),
});
```

`clientV1` 沿原网关前缀构成 `/api/client/v1`。`postPublic<T>(path, payload)` 使用原 JSON POST 和响应解包，登录与退出使用公共 web-client 的真实租户会话、Web Lock 和刷新账。宿主负责环境基址、Storage 和会话订阅。[公共会话](../../../../web-client/src/session.ts) · [原引用清理](../../../../../apps/tenant-website/src/data/clientRecoveryStorage.ts)

| 原方法 | 真实运输与字段 |
| --- | --- |
| `createChallenge` | 原 POST `/auth/challenges`，保留商户、标识、登录／注册用途和原幂等键，固定 `method: sms` |
| `verifyChallenge` | 原 POST `/auth/registration/challenges/{challengeId}/verify`，编码原 ID，提交原验证码 |
| `smsLogin` | 原 `customerLogin` 使用 `/auth/sms-login` 和原短期证明 |
| `passwordLogin` | 原 `customerLogin` 使用 `/auth/login` 和原口令输入 |
| `register` | 原 POST `/auth/register`，保留本人输入、证明、原幂等键及协议版本／同意时间 |
| `logout` | 原 `logoutCustomerSession`，在 `finally` 清理为最小原引用，原退出错误继续传播 |

`createChallenge` 返回原 `ClientRegistrationChallengeResponse`，页面消费原状态、期限、投递方式和服务端冷却。同一请求的恢复保留原键，`provider_pending`、过期或终态回执由页面明确分流。原期限和未知投递不能触发自动换键。

`smsLogin(input, isCurrent?)` 和 `passwordLogin(input, isCurrent?)` 的第二参数是页面的当前请求检查。公共会话协调器在取得原锁及返回后核对该检查和本人代次，再采用服务端会话；页面失效不派发或采用旧请求。它只保护结果归属，身份仍由服务端验证。未传该参数的原消费者保留原调用方式，短信证明不因此获得重放能力。

方法 → 原客户 HTTP → 原客户认证／注册服务 → 当前租户、渠道、空间、资格及供应商裁定。验证码证明的用途、消费与幂等由原服务端校验。[客户 HTTP](../../../src/http-client.controller.ts) · [客户认证](../../../src/mysql-client-auth.ts)

## 本人资料接入

`createRentalWebsiteAccountClient` 接收原 `authedJson`、当前商户读取、空间切换、`captureOwnProfileReadSession`、`readOnce` 与错误工厂。`readOnce(path, init)` 使用宿主原 `parse(await authedFetch(path, init, false))`，保持资料 GET 的一次观察语义和原错误实例。[原会话围栏与接线](../../../../../apps/tenant-website/src/data/authClient.ts)

`me` 沿原 JSON 运输读取 `/auth/me`。`switchWorkspace` 经当前 AuthBridge 商户和原 `switchCustomerWorkspace` 完成服务端切换，缺当前商户沿原错误拒绝。当前身份与服务端绑定空间由公共会话和原客户业务复验。[官网会话消费者](../../../../../apps/tenant-website/src/AuthContext.tsx)

`profile(signal?)` 在发出前及解析返回后核对捕获的本人／空间和当前会话，原 15 秒取消、调用方 AbortSignal 及退出清理保持。返回值逐字段核验，只释放 `OwnProfileReadView` 的个人资料、脱敏标识和当前空间。资料型别、本人或空间不符时沿原 401／502 拒绝，联系人和企业主体材料继续由各自业务入口读取。[资料合同](../../../src/client-contracts.ts) · [原个人页面](../../../../../apps/tenant-website/src/pages/AccountPage.tsx)

## 合同与兼容

请求和本人资料类型从本包客户合同做窄投影，验证码返回复用完整原响应。验证码请求使用现有 `ClientChallengeRequest` 的 `purpose`，真实 `/auth/challenges` 经同一合同的 DTO 校验，旧 `registration/challenges` 沿原注册用途。原官网注册返回声明要求 `customerId`，本模块用正式响应的 `Required<Pick<...>>` 保留这一消费形状，缺字段仍由原登录页拒绝。[客户合同](../../../src/client-contracts.ts) · [客户 DTO](../../../src/http-client-request.dto.ts) · [原登录页](../../../../../apps/tenant-website/src/pages/LoginPage.tsx)

AuthBridge、三个 `capture*`、原 JSON／Fetch 请求层及 AI／Booking 宿主方法继续由原官网接线。认证与读取工厂每次调用宿主真实端口，原 Storage 命名空间、刷新与租户身份来自同一公共会话。[原官网接线](../../../../../apps/tenant-website/src/data/authClient.ts)

## 验证入口

必要类型检查核对两个工厂、原薄入口和原消费者。一次原入口冒烟对照六个认证方法的路径、输入、结果、错误及退出清理，并核对本人资料前后围栏、取消和最少字段。原公共会话测试提供登录、刷新和退出的真实运输替身。[客户端类型](../../tsconfig.json) · [官网类型](../../../../../apps/tenant-website/tsconfig.json) · [原会话测试](../../../../../tests/web-client-session.test.cjs)

包构建、浏览器、真实 HTTP、供应商和数据库证据按实际宿主分别核验。
