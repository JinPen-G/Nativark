# Rental 员工小程序认证

[认证工厂](../auth.ts)从 `@rental-os/rental-core/clients/staff` 提供 `createRentalStaffAuthApi` 与 `RentalStaffAuthPorts`，原[员工入口](../../../../../apps/staff-miniprogram/src/api/auth.ts)继续具名导出 `login`、`logout`、`switchWorkspace` 和 `changePassword`。

宿主传入[原 Staff request](../../../../../apps/staff-miniprogram/src/core/http.ts)与[原会话](../../../../../apps/staff-miniprogram/src/core/session.ts)的 `refreshToken`、`saveSession`、`clearSession`。请求基址、Staff audience、刷新及迟到身份围栏沿宿主运输；本工厂使用原认证路径和选项。

登录对租户编码和账号调用原 `trim()`，密码原样提交，成功后保存同一响应。退出沿原 refresh token 发送租户范围请求并关闭认证重放，撤销失败仍清理本机会话。切空间只在服务端成功后保存原响应，空 refresh token 的保留沿原会话实现；改密继续使用原租户范围。

调用链为原页面 → 薄入口 → 本工厂 → Staff request/会话 → [员工认证 HTTP](../../../src/http-staff-auth.controller.ts) → [原认证服务](../../../src/auth-service.ts)。员工登录响应沿[Rental 认证合同](../../../src/auth-contracts.ts)，改密字段沿平台正式合同，原权限与成员资格仍由服务端裁定。

定向验证核对四个方法正文、请求/结果、登录与空间切换采用、退出失败后的本机清理；[原员工测试](../../../../../tests/staff-miniprogram-static.test.cjs)保留会话、范围和刷新断言。类型沿[原生客户端配置](../../../tsconfig.native-clients.json)及员工宿主配置。微信真实宿主、认证 HTTP 和数据库需对应环境证据。
