# 运营账号与邮箱邀请

`TenantAccessPages` 是旧组合薄入口，[公共账号列表和侧窗](../../../../../packages/platform-admin/src/features/access/PublicOperationsAccountPage.tsx)与[公共角色页](../../../../../packages/platform-admin/src/features/access/PublicRolePermissionPage.tsx)保留原流程，经营空间授权由[同源 Rental 管理适配](../../../../../packages/rental-core/admin/access/README.md)提供。`OperatorInvitations` 向[公共邀请表单](../../../../../packages/platform-admin/src/features/messaging/README.md)提供真实经营空间及受控角色 / 数据 / 地点配置。逐人角色对应租户基础角色，共用空间配置对应本批成员授权。新增运营账号为页头主动作，邀请入口留在列表工具区。

`tenantMessagingApi` → `TenantOperatorInvitationsController` → `TenantOperatorInvitationsService` → 原 `PlatformRepository` 账号/授权事务及 `TenantEmailRuntimeService`。发送前查当前租户邮箱登录账号，包含停用账号，已有账号或有效邀请均停止发送。邀请只保存凭证哈希和待接受授权，接受时复验邀请人当前权限、角色和空间，再同事务创建账号与成员。固定全权基础角色沿原账号管理流程授予。

每次提交保留原操作键。投递超时只核对原记录，未知结果不自动重发。SMTP 受理不代表送达。匿名接受页面的令牌来自 URL fragment，仅读取和提交给原认证入口。接受结果未知后可用原凭证读取最小接受结果和登录入口；已接受邀请的重复提交只返回原结果，不重建账号、重设密码或再授予权限。历史接受事实不代表当前账号仍有权限。

[公共 invitation-source](../../../../../packages/platform-admin/src/features/messaging/invitation-source/components/invite-people/provenance.json)保存固定来源的最小运行闭包。原样 CSS、图标和状态机留存，宿主适配包括共享动效偏好、语言、主题 / 字体及可选席位和重发端口。来源清单固定树哈希为 `7c116b812eca1eb2c232028619a312ad0561fb85d42b3c653c039107624799df`。组件还原依据公开编译预览，来源和许可见 [UIArc 组件库](../../../../../packages/ui-arc/README.md)。

邀请表单保留原组件的内距及邀请状态区边界，空间授权按可用宽度重排。宿主通过 `footerSlot` 将邮件预览放在发送按钮同行，完整邮件在独立预览窗口读取，关闭后保留本批邮箱与授权选择。`showTeam` 用于省略没有成员头像数据的团队展示。按钮高度沿共享默认控件尺寸，输入和弹层圆角读取当前账号外观设置。

数据库依赖 `20261115110000_tenant_operator_email_invitations`，客服另依赖 `20261115111000_tenant_support_email_inbox`。开发提交包含迁移文件，应用迁移和真实 SMTP/IMAP 联调分别需要运行环境授权。部署还需配置 `ADMIN_PUBLIC_URL`，仅允许正式 HTTPS 或开发本机地址。
