# 公共消息应用

公共模块持有运营邀请、寄件中心和客服邮件的应用编排，以及服务端邀请模板和缺表错误映射。当前主体沿公共 ALS 读取，宿主提供真实权限、业务范围、存储和审计。SMTP、IMAP 与 MIME 复用已有集成实现。

## 三步接入

1. 从 `@rental-os/platform-server/messaging` 导入所需应用及存储端口，消息请求和响应复用 `@rental-os/platform-contracts/tenant-messaging`。按 [messaging-store.ts](messaging-store.ts) 提供实际使用的公共表委托与参数化 SQL。事务回调传递原宿主事务对象。
2. 邀请应用使用 `TenantInvitationAuthority` 核验当前租户管理权限、角色及业务范围，并在接受邀请的原事务内创建账号和授权。客服应用使用原管理权威、`TenantEmailRuntimeService` 和成功必需的操作审计。寄件应用通过 `TenantDispatchBusinessParticipant` 接入业务查询和详情，业务查询与公共来源进入同一 SQL UNION，共用过滤、全局排序、分页和总数。
3. 使用 [TenantMessagingHttpModule](tenant-messaging-http.module.ts) 的 `register({ imports, inject, useFactory })` 提供这三个已有应用实例。Factory 返回 [TenantMessagingHttpApplications](tenant-messaging-http.application.ts) 的 `invitations`、`dispatch`、`support`，四个 Controller 共用它们。保留原邀请操作键、投递台账和邮箱 UID 游标，邀请提交后通过 `readByKey` 核对原结果，客服同步显式调用 `sync`。

邀请存储的租户读取使用一个精确 `code/name/status` select，真实 Prisma delegate 可直接满足端口。已接受邀请仍只投影原租户编码和提示，租户当前状态不改变原接受结果。

## HTTP、请求与接口资料

[HTTP 政策](tenant-messaging-http-policy.ts) 持有 13 个操作的原方法、路径、权限和输入输出名称。宿主将其加入公共 Guard 的同源政策，将 [OpenAPI schemas](tenant-messaging-openapi.ts) 加入同版本文档。操作中已有 `parameters` 时直接使用这组完整元数据，它保留寄件详情的必需 `channel` 和 `source` 枚举。POST 成功状态为 201，GET 为 200。公开 `inspect` 和 `accept` 仅通过 POST 提交原一次性凭证，Controller 先调用原 IP 限流。

查重、邮件预览和邀请 `inspect` 在同源政策中标记 `effect: "read"`，OpenAPI 按该字段表达其读取行为。邀请提交、撤回、接受和邮箱同步沿原应用办理写入。

[公共请求 DTO](tenant-messaging-request.dto.ts) 要求显式提供 `workspaceAccesses` 数组，允许空数组邀请租户基础成员。非空业务范围继续由实际宿主权威核验，接受邀请时与账号授权在原事务中提交。原 Rental 请求适配保留至少一个经营空间以及原嵌套范围 DTO，公共 Controller 和原邀请 Controller 分别使用对应请求类。

公共文档使用 `TENANT_MESSAGING_OPENAPI_SCHEMAS` 的 `Messaging.` 命名空间和空业务范围规则。组合宿主可调用 `createTenantMessagingOpenApiSchemas("", 1)` 生成原名称及至少一个经营空间的兼容投影，并从同源 HTTP 政策生成原 operationId 和参数。

## 应用与边界

| 入口 | 存储及真实参加者 | 关键行为 |
| --- | --- | --- |
| [运营邀请](tenant-operator-invitations.service.ts) | 公共邀请台账、账号只读检查、原权限与账号授权权威、配置和邮件运行时 | 先查重，事务锁租户及邀请，SMTP 出站前登记 `delivery_uncertain`，一次性令牌与账号授权同事务提交 |
| [寄件中心](tenant-dispatch.service.ts) | 公共通知和验证码日志、可选业务寄件参加者、原管理权限及审计 | 全局 SQL 分页，原状态归一化，详情经成功必需的审计后投影 |
| [客服邮件](tenant-support-email.service.ts) | 公共邮件和邮箱台账、原配置及管理权限、IMAP 和审计 | 连接 fingerprint、120 秒租约、UIDVALIDITY/UID 去重，配置复核后同事务保存邮件及游标，仅释放本次租约 |

原凭证读取已接受邀请时，先核对原 `acceptedUserId` 和有效 `acceptedAt`，仅返回租户编码、提示及 `status: "accepted"`。该原结果在邀请有效期结束后仍可读取。待接受邀请保留当前授权复验，账号与权限在原事务提交；并发锁定后已接受则读取原结果。

异常邮件提示、`support.email.import.quarantined` 审计和 UID 游标在同一事务提交。审计失败回滚邮件及游标，已存 UID 跳过重复提示和审计。同步结果分别计数 `imported` 和 `quarantined`。验证码寄件只有原成功日志映射为 `sent`，失败状态与结构化失败证据一致时映射为 `failed`，其余沿 `delivery_uncertain` 核对原操作。

公开预览使用 [固定模板](tenant-mail-templates.ts) 转义事实并隐藏激活链接。客服正文和附件只返回安全文本及元数据。缺表映射由 [存储检查](tenant-messaging-storage.ts) 提供。

## 原宿主与验证

原 [邀请适配](../../../../../apps/api/src/modules/notifications/tenant-operator-invitations.service.ts)、[寄件适配](../../../../../apps/api/src/modules/notifications/tenant-dispatch.service.ts) 和 [客服适配](../../../../../apps/api/src/modules/notifications/tenant-support-email.service.ts) 保留原构造依赖。三个租户管理 Controller 继承公共 HTTP，邀请创建和预览使用原请求适配，公开接受入口使用公共同源请求类。Rental 日志与经营空间的联接留在寄件宿主参加者，权限和账号写入沿原账户仓储执行。

行为验证复用 [tenant-messaging.test.cjs](../../../../../tests/tenant-messaging.test.cjs)，按原离线隔离入口执行。类型和离线行为、实际邮箱、真实数据库及宿主验收分别取证。
