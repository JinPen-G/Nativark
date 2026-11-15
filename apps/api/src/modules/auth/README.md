# 认证与公共会话

公共宿主和 Rental 组合共用 [AuthSessionService](auth-session.service.ts) 的签名、登录失败保护、刷新轮换、改密及原会话撤销。业务范围不在公共服务中推断，宿主显式装配对应认证适配。

| 宿主 | 认证适配 | 身份与范围 |
| --- | --- | --- |
| 公共底座 | [PlatformAuthService](platform-auth.service.ts) | 租户、原账号与当前角色；operator 登录不要求业务空间，未装配 Core 不签发业务范围 |
| Rental 组合 | [AuthService](auth.service.ts) | 使用同一签名和原会话，继续按原成员关系解析 Rental 空间、品类、能力与地点范围；staff 沿原专用分面 |

[公共 HTTP 控制器](auth-session.controller.ts) 和 [公共 DTO](auth-session.dto.ts) 提供登录、本人资料、会话上下文、刷新、退出和改密。Rental 的 [兼容控制器](auth.controller.ts) 继承这些方法，仅增加原演示维护与空间切换；主宿主只登记一个对应控制器。旧 DTO 与 LoginDto 导入继续再导出同一声明。

读取路线为 HTTP / Guard → 认证适配 → 公共会话服务 → [平台身份仓储](../platform/platform-identity.repository.ts) → 原账号 / 角色 / auth_sessions。公共身份、设置和运行时常量从 `@rental-os/platform-contracts` 的 [唯一源码](../../../../../packages/platform-contracts/src/index.ts) 消费；原 `@rental-os/shared` 与其 `platform` 子出口兼容再导出。公共实际服务在 [platform-server](../../../../../packages/platform-server/README.md)，原认证路径保留窄出口转接。

公共认证的 [持久化来源](../platform/platform-authentication.source.ts) 只读公共账号、租户和 [安全配置](../platform/platform-security-baseline.ts)，沿原语义保存认证审计。公共新会话不带业务空间；仍关联旧 Core 空间的有效签名会话仅可作为公共身份读取，刷新后移除旧业务范围，不据此授予业务权限。Core 授权、成员分配及业务就绪由 [Core 宿主](../core-host/README.md) 另行核验。

登录失败保护使用原带密钥摘要、共享持久计数及 CAS；refreshToken 单次消费和新会话在同一事务提交。签名、刷新 token 哈希及角色映射保持原行为，客户端字段不能自授 tenant、audience、角色或 workspace。

可信委托仍沿 [原主体票据](trusted-workspace-principal.ts) 和 [浏览器会话证据](trusted-browser-principal.ts) 在原授权回调的事务和寿命内读取；票据不能转成 Web token，也不能脱离原 AuthService 实例复用。[原 Guard](../../common/api-auth.guard.ts) 与 [ALS](../../common/request-identity.ts) 继续处理 Rental 的当前权限、地点及空间；[员工认证](staff-auth.controller.ts) 和客户认证分面保持各自授权，公共 operator 适配不会将它们合并。

外观来源经 [公共存储端口](../platform/platform-appearance-data-store.ts) 注入。Rental 组合单独提供旧客户端品牌读取，公共底座不为保存外观查询客户端业务表；省略、显式清空、原修订与失败反馈仍沿原外观服务。

原验证入口为 [登录失败保护](../../../../../tests/auth-login-lockout.test.cjs)、[外观设置](../../../../../tests/admin-appearance-settings.test.cjs) 和 [可信主体 / Guard](../../../../../tests/mcp-trusted-principal.test.cjs)。命令先按 [根规则](../../../../../AGENTS.md#修改验证与交付) 核读写和隔离前置，离线服务行为与实际 HTTP / 数据库分别取证。当前已有 [独立公共宿主](../../../../platform-api/README.md) 的 schema、构建与认证 / 外观装配，真实运行、完整公共管理界面及标准包运行装配仍按 [PCH 接续](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md) 继续交付。
