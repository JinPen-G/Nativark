# 运营账号与邮箱邀请

`TenantAccessPages` 保留原账号、角色及经营空间授权流程。`OperatorInvitations` 复用本地 UI 对话还原的 UIARC [Invite people](https://uiarc.dev/components/blocks/invite-people)，逐人角色对应租户基础角色，共用空间配置对应本批成员授权。新增运营账号为页头主动作，邀请入口留在列表工具区。前端省略无真实依据的席位容量与重发功能。

`tenantMessagingApi` → `TenantOperatorInvitationsController` → `TenantOperatorInvitationsService` → 原 `PlatformRepository` 账号/授权事务及 `TenantEmailRuntimeService`。发送前查当前租户邮箱登录账号，包含停用账号，已有账号或有效邀请均停止发送。邀请只保存凭证哈希和待接受授权，接受时复验邀请人当前权限、角色和空间，再同事务创建账号与成员。固定全权基础角色沿原账号管理流程授予。

每次提交保留原操作键。投递超时只核对原记录，未知结果不自动重发。SMTP 受理不代表送达。匿名接受页面的令牌来自 URL fragment，仅读取和提交给原认证入口，接受结果未知后引导登录核对。

`invitation-source` 保存固定来源的最小运行闭包。原样 CSS、图标和状态机留存，宿主改动为统一减少动态、语言、主题/字体，以及可选席位和重发控制。来源清单固定树哈希为 `7c116b812eca1eb2c232028619a312ad0561fb85d42b3c653c039107624799df`。组件来自公开编译预览还原，官方受保护 Pro TSX 未取得。未接入示例成功、示例成员或容量数据。原项目来源和许可见 [UIArc 组件库](../../../../../packages/ui-arc/README.md)。

邀请表单保留原组件的内距及邀请状态区边界，空间授权按可用宽度重排。宿主通过 `footerSlot` 将邮件预览放在发送按钮同行，完整邮件在独立预览窗口读取，关闭后保留本批邮箱与授权选择。`showTeam` 用于省略没有成员头像数据的团队展示。按钮高度沿共享默认控件尺寸，输入和弹层圆角读取当前账号外观设置。

数据库依赖 `20261115110000_tenant_operator_email_invitations`，客服另依赖 `20261115111000_tenant_support_email_inbox`。开发提交包含迁移文件，应用迁移和真实 SMTP/IMAP 联调分别需要运行环境授权。部署还需配置 `ADMIN_PUBLIC_URL`，仅允许正式 HTTPS 或开发本机地址。
