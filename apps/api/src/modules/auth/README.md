# 认证与当前请求身份

[AuthController](auth.controller.ts)提供原营运登录、刷新、退出、密码和当前会话接口，[AuthService](auth.service.ts)校验签名及持久会话，调用原平台账号/角色来源。管理者、员工和客户各有自己的audience，当前业务范围由原服务端映射。

登录从租户编码/账号及原密码校验开始，登录失败计数沿原持久或明确演示来源。访问令牌绑定user/tenant/session/audience及当时workspace，刷新单次消费旧会话，退出撤销原会话。切换原Rental经营空间时重核成员资格，旧请求保留原目标，不能移到新空间继续执行。[请求DTO](auth-request.dto.ts) · [会话持久来源](../platform/platform.repository.ts)

普通调用沿 Controller → AuthService → PlatformService/Repository → 当前用户角色和AuthSession。可信委托沿原回调内的不可伪造单次票据，票据的事务与寿命在本Auth实例校验。Core管理适配读取原Guard已核身份和会话，再在同一事务锁当前权限，业务动作继续由所属Core裁定。[原Guard](../../common/api-auth.guard.ts) · [ALS上下文](../../common/request-identity.ts) · [Core身份适配](../core-host/original-core-principal.ts)

当前组合仍包含Rental经营范围和可选能力、外观服务。公共身份与业务范围的拆分接点及消费者沿PCH既有任务维护，新增Core使用独立当前范围，原Rental会话和客户端语义继续自己的兼容链。[Core接入任务](../../../../../docs/平台底座/Core接入/平台Core接入-开发任务.md#contract-design)

读取接口资料从原[OpenAPI](../../contracts/openapi-document.ts)定位method/path和schema，关键验收入口为[登录锁定](../../../../../tests/auth-login-lockout.test.cjs)、[租户权限](../../../../../tests/tenant-admin-privilege-write.test.cjs)、[租户成员政策](../../../../../tests/tenant-membership-policy.test.cjs)。命令按本次改动和授权环境执行，真实会话/浏览器/数据库分别取证。
