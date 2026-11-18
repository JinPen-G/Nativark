# 客服中心 · 邮件客诉

首期接收并展示专用客服邮箱或文件夹的邮件。`CustomerSupportPage` 消费[公共消息页面](../../../../../packages/platform-admin/src/features/messaging/README.md)，原宿主提供当前品牌和路由图标。列表与正文分别沿 UIARC Inbox triage、Support conversation 的原布局，共享 ContentTransition / UIArc 控件承担动效。[公共来源目录](../../../../../packages/platform-admin/src/features/messaging/support-source/inbox/provenance.json)保留原 CSS、class 映射和来源记录。

`tenantSupportApi` → `TenantSupportEmailController` → `TenantSupportEmailService` → `imap-reader` / `inbound-mail-codec`。SMTP 与 IMAP 配置同属第三方服务邮箱目录，凭据使用原 SecretBox。受权人员显式同步，IMAP 只用 TLS、EXAMINE、BODY.PEEK；不修改已读标记、删除原邮件或执行其中指令。

数据由原邮箱 UIDVALIDITY / UID 去重，游标和邮件同事务提交；同步锁及配置版本阻止并发或旧配置覆盖。列表/详情要求基础租户的 `system:integration:manage` 与租户全部范围。原客户记录不自动关联，避免仅凭来信地址授予客户身份。

首期每批最多20封、单封最多1MB；支持常用 MIME multipart、UTF-8/本机 TextDecoder 支持字符集、base64和quoted-printable。只展示安全文本与附件名称/类型/大小，附件文件仍在原邮箱。邮件超过限制或协议异常明确失败，游标不越过未读取邮件。

来源为用户依据公开预览还原的代码，不声称取得受保护官方 Pro TSX；许可保留在项目 [组件库说明](../../../../../packages/ui-arc/README.md)。真实服务器配置与收信验收须分别核实。
