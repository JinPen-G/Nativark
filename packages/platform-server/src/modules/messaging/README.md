# 公共消息应用

公共模块持有运营邀请、寄件中心和客服邮件的应用编排，以及服务端邀请模板和缺表错误映射。当前主体沿公共 ALS 读取，宿主提供真实权限、业务范围、存储和审计。SMTP、IMAP 与 MIME 复用已有集成实现。

## 三步接入

1. 从 `@rental-os/platform-server/messaging` 导入所需应用及存储端口，消息请求和响应复用 `@rental-os/platform-contracts/tenant-messaging`。按 [messaging-store.ts](messaging-store.ts) 提供实际使用的公共表委托与参数化 SQL。事务回调传递原宿主事务对象。
2. 邀请应用使用 `TenantInvitationAuthority` 核验当前租户管理权限、角色及业务范围，并在接受邀请的原事务内创建账号和授权。客服应用使用原管理权威、`TenantEmailRuntimeService` 和成功必需的操作审计。寄件应用通过 `TenantDispatchBusinessParticipant` 接入业务查询和详情，业务查询与公共来源进入同一 SQL UNION，共用过滤、全局排序、分页和总数。
3. 将宿主原 Controller 委托给同一应用实例。保留原邀请操作键、投递台账和邮箱 UID 游标。邀请提交后通过 `readByKey` 核对原结果，客服同步显式调用 `sync`。

## 应用与边界

| 入口 | 存储及真实参加者 | 关键行为 |
| --- | --- | --- |
| [运营邀请](tenant-operator-invitations.service.ts) | 公共邀请台账、账号只读检查、原权限与账号授权权威、配置和邮件运行时 | 先查重，事务锁租户及邀请，SMTP 出站前登记 `delivery_uncertain`，一次性令牌与账号授权同事务提交 |
| [寄件中心](tenant-dispatch.service.ts) | 公共通知和验证码日志、可选业务寄件参加者、原管理权限及审计 | 全局 SQL 分页，原状态归一化，详情经成功必需的审计后投影 |
| [客服邮件](tenant-support-email.service.ts) | 公共邮件和邮箱台账、原配置及管理权限、IMAP 和审计 | 连接 fingerprint、120 秒租约、UIDVALIDITY/UID 去重，配置复核后同事务保存邮件及游标，仅释放本次租约 |

公开预览使用 [固定模板](tenant-mail-templates.ts) 转义事实并隐藏激活链接。客服正文和附件只返回安全文本及元数据。缺表映射由 [存储检查](tenant-messaging-storage.ts) 提供。

## 原宿主与验证

原 [邀请适配](../../../../../apps/api/src/modules/notifications/tenant-operator-invitations.service.ts)、[寄件适配](../../../../../apps/api/src/modules/notifications/tenant-dispatch.service.ts) 和 [客服适配](../../../../../apps/api/src/modules/notifications/tenant-support-email.service.ts) 保留原构造依赖和 HTTP 消费入口。Rental 日志与经营空间的联接留在寄件宿主参加者，权限和账号写入沿原账户仓储执行。

行为验证复用 [tenant-messaging.test.cjs](../../../../../tests/tenant-messaging.test.cjs)，按原离线隔离入口执行。类型和离线行为、实际邮箱、真实数据库及宿主验收分别取证。
