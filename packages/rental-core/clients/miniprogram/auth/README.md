# Rental 客户小程序认证

[认证工厂](../auth.ts)提供原 16 个认证与会话采用方法，从 `@rental-os/rental-core/clients/miniprogram` 导入 `createRentalMiniProgramAuthApi`。原[小程序入口](../../../../../apps/miniprogram/src/api/auth.ts)传入公开渠道配置、原请求、错误转换及会话操作，页面继续使用原具名方法。

`RentalMiniProgramAuthPorts` 的 `request` 使用[原客户运输](../../../../../apps/miniprogram/src/core/http.ts)，负责原认证、范围、刷新及迟到结果隔离。`publicConfig` 使用宿主登记的商户与 AppID；`currentServiceCode`、`refreshToken`、`saveSession` 和 `clearSession` 沿[原会话](../../../../../apps/miniprogram/src/core/session.ts)。`contractMissing` 与 `featureUnavailable` 沿[原错误转换](../../../../../apps/miniprogram/src/contracts/planned.ts)，微信渠道缺失继续显示原备用登录提示。

密码、短信和微信登录、用途验证码与注册均沿原客户路径和输入，服务选择字段仍为 `workspaceCode`。微信绑定的一次凭证及本人注销继续关闭认证重放；本人状态、改密、注销预览和注销验证码保持租户范围。退出尝试撤销原 refresh token 后清本机会话；切服务只采用服务端换发结果；登录与注册由页面调用 `adoptSession` 后采用原会话。

调用链为原页面 → 薄入口 → 本工厂 → 原客户 request/会话 → [客户 HTTP](../../../src/http-client.controller.ts) → 原客户认证与本人注销服务。客户端输入和本地会话采用沿原服务端权限与事实核验。

## 注销验证码恢复

`closureChallenge` 使用 `POST /api/client/v1/auth/closure/challenge`，对象和手机号由服务端当前本人会话决定。首次发送前，宿主保存本人和租户对应的请求键；丢应答或重启后使用同一键读取原挑战。

```ts
// requestKey 在首次请求前持久保存；恢复时从原记录读取。
await auth.closureChallenge({ idempotencyKey: requestKey });
await auth.closureChallenge({ idempotencyKey: requestKey, recoverOnly: true });
```

`recoverOnly: true` 在原记录不存在时返回 404，不创建或发送新验证码。页面核对响应的 `status`、`expiresAt` 和 `deliveryMode`；`provider_pending` 表示投递结果未确认，仍保留原键。冷却或过期后也不自动换键。用户明确选择重新获取时，才保存新的独立请求键；[原注销页面](../../../../../apps/miniprogram/src/pages/closure/index.ts)提供恢复与重新获取两个动作。

旧 `closureChallenge()` 无正文调用继续有效，服务端沿当前会话读取原挑战，包括旧按分钟生成的键。两种调用均关闭认证自动重放。字段以[客户合同](../../../src/client-contracts.ts)和[同源 DTO](../../../src/http-client-request.dto.ts)为准，OpenAPI 的请求正文可省略。

定向验证复用原 16 方法的请求和结果，核对会话采用、退出失败、微信备用入口及错误对象。原[小程序验证入口](../../../../../tests/miniprogram-static.test.cjs)继续核对运输与服务切换，类型沿[原生客户端配置](../../../tsconfig.native-clients.json)和宿主配置。微信宿主、真实认证与数据库需对应环境证据。
