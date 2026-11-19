# 公共身份、组织与安全管理

本模块提供公共身份读取、租户和人员角色管理、组织管理及全平台安全配置。宿主从正式包出口导入服务，供给唯一数据库实例，通过同一个请求上下文执行管理操作。[公共服务入口](../../../README.md) · [正式包出口](../../../package.json) · [请求上下文](../../common/request-identity.ts)

## 调用链与授权

| 阅读顺序 | 入口与职责 |
| --- | --- |
| HTTP 输入 | [Controller](platform-management.controller.ts) 与 [DTO](platform-management.dto.ts) 接收原字段和路径参数 |
| 接口声明 | [七个组织与安全操作](platform-settings-http-policy.ts) 和 [OpenAPI schema](platform-settings-openapi.ts) 提供五条路径及 `tenantId` 查询定义，由宿主并入同源公共政策和文档 |
| 应用服务 | [PlatformManagementService](platform-management.service.ts) 取得当前主体，锁定原会话、租户、账号和角色，执行事务并在返回前复验权限 |
| 主体围栏 | [PlatformPrincipalAuthority](platform-principal.authority.ts) 验证 operator audience、原会话有效期、签名空间证据和当前持久化权限 |
| 仓储与持久化 | [PlatformManagementRepository](platform-management.repository.ts) 通过 [存储端口](platform-management.store.ts) 读取及维护公共表，写入和原审计在同一 Serializable 事务 |
| 组织范围 | [原数据投影](../../common/platform-data-permission.ts) 和 [启用组织子树](../../common/organization-location-scope.ts) 将读取限制在当前租户及受权组织范围 |
| 认证前安全读取 | [PlatformAuthenticationRepository](platform-authentication.source.ts) 委托 [readPlatformSecurityBaseline](platform-security-baseline.ts)，显式读取 `tenant_platform` 的最新 EFFECTIVE `system-rules` |
| 直接消费者 | [公共宿主](../../../../../apps/platform-api/README.md) 和 [原 PlatformService](../../../../../apps/api/src/modules/platform/platform.service.ts) 使用同一公共实现及数据库 |

角色列表沿原账号管理或角色管理权限读取本租户角色，支持人员表单和邀请中的角色选择；基础成员仍需要全租户数据范围。创建、修改和删除角色继续要求角色管理权限，选择一个角色不会自动授予成员业务 Core。公共 Guard、管理服务的事务前后复验与 OpenAPI 使用同一读取权限声明，文档中的 `x-requiredPermissions` 按 `x-permissionMatch: any` 匹配。[读取声明](platform-permissions.ts) · [公共政策](../../platform-http-policy.ts)

组织读取沿原 `system:user:manage` 及数据投影。组织范围账号只读取当前组织连续启用的子树，缺失或停用组织返回空集合。组织维护要求当前租户、账号管理权限、全租户数据范围及完整地点范围。SaaS 组织接口按原准入拒绝，查询参数仅参与原租户投影。

全平台安全保存要求当前 SaaS 身份及 `system:params:manage`，通过平台租户锁串行化，在写入点匹配原行 ID、版本和生效状态。更新保留原生效版本及 JSON 中其他字段，历史 JSON null 使用原缺省语义。五个数值沿原有限且非负的规则，小数继续兼容。唯一键和事务冲突明确返回，由调用方重读核对。

二次确认管理工具保留原演示确认码 `000000` 和返回消息。实际业务批准与执行继续消费各自的正式授权及收据。[原管理工具](platform-management.service.ts) · [原响应字段](platform-settings-openapi.ts)

## 宿主装配与方法对应

`PlatformManagementService` 的构造依赖为 `PLATFORM_AUTH_DATA_STORE`，类型为 `PlatformManagementDatabase`。宿主使用原 Prisma 实例供给该 token，并将同一服务实例注入原业务适配。内部仓储与主体围栏由该服务创建。[数据库 token](platform-auth-data-store.ts) · [公共模块装配](../../platform-server.module.ts)

| 原方法 | 公共接点 |
| --- | --- |
| `listOrganizations(tenantId, currentUser)` | `PlatformManagementService.listOrganizations(tenantId)`，当前主体从原 ALS 及持久化复验取得 |
| `saveOrganization(input, currentUser)` | `PlatformManagementService.saveOrganization(input)` |
| `setOrganizationStatus(id, status, operator, currentUser)` | `PlatformManagementService.setOrganizationStatus(id, status, operator)` |
| 管理 HTTP 的 `getSecurityBaseline()` | `PlatformManagementService.readSecurityBaseline()` |
| 认证前 `getSecurityBaseline()` | `PlatformAuthenticationRepository.getSecurityBaseline()` 或 `readPlatformSecurityBaseline(database)` |
| `saveSecurityBaseline(input, currentUser)` | `PlatformManagementService.saveSecurityBaseline(input)` |
| `checkSecondConfirmation(action, confirmationCode)` | `PlatformManagementService.checkSecondConfirmation(action, confirmationCode)` |

认证前读取使用已供给的原数据库，管理读取使用当前原会话围栏。原内存演示入口及其调用方沿原适配保留。正式公共导入通过本包出口登记，宿主同时组合公共 HTTP 政策、查询和 schema。[包出口](../../../package.json) · [公共政策](../../platform-http-policy.ts) · [公共文档](../../platform-openapi.ts)

## 验证入口

原 [组织范围回归](../../../../../tests/access-data-scope-regression.test.cjs) 包含启用子树、缺失组织、数据投影、内存及 Prisma 入口断言。定向验证还需覆盖公共当前主体、组织维护和审计回滚、提交前撤权、安全历史版本及其他字段保留、JSON null、同键冲突和原二次确认结果。Nest 容器可核对 Controller 与服务及数据库实例一致。[验证与隔离规则](../../../../../AGENTS.md#修改验证与交付)

类型、明确 fixture 与 Nest 容器分别记录证据。真实 HTTP、数据库并发、浏览器及完整宿主验收按所选部署组合办理。[公共宿主](../../../../../apps/platform-api/README.md)
