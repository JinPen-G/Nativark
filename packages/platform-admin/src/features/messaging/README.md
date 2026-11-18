# 公共邀请、寄件与客服邮件

`AcceptOperatorInvitationPage`、`OperatorInvitations`、`TenantDispatchPage` 和 `CustomerSupportPage` 复用原 React / UIArc 表单、列表、抽屉、邮件布局与共享动效。原后台的邀请、寄件、客服入口消费这些组件。

## 接入

1. 使用 `@rental-os/platform-admin/messaging` 的正式出口。公共应用工厂已登记 `/invite`、`/login/:tenantCode` 和邮件目录，公共 locale 已接入 `messagingMessages`；宿主只需提供品牌和同一个浏览器会话。已有自定义路由宿主可按下面示例挂载，登录表单接收路由中的租户编码。
2. 由原 `AdminRuntimeProvider` 和 UI / locale 宿主包裹受权页面。菜单、直接 URL 与人员邀请入口共同使用[消息可见性](messagingAccess.ts)的 `hasTenantMessagingPermission`，沿原 `tenantMembership` 基础成员投影读取完整租户范围、管理员及通配权限。寄件与客服要求 `system:integration:manage`，邀请要求 `system:user:manage`。当前 Core 的角色和范围独立管理，服务端继续核对当前权限。
3. 人员页面向 `OperatorInvitations` 提供当前服务端角色与组织。公共缺省邀请显式提交 `workspaceAccesses: []`。Core 通过 `businessAccess.render` 提供受控范围配置，`requiredMessage` 指定缺少范围时的校验信息。Rental 宿主沿原经营空间列表供给角色、数据和地点范围。
4. 匿名 `/invite` 路由提供 `createOperatorInvitationApi(baseURL)`、品牌名及可选品牌图标。接受页从 fragment 读取原凭证，inspect 支持取消，accept 使用原 20 秒时限。匿名客户端清空租户 / 空间认证头，接受结果未确认时通过租户登录核对。

```tsx
import {
  AcceptOperatorInvitationPage,
  OperatorInvitations,
  createOperatorInvitationApi
} from "@rental-os/platform-admin/messaging";

const invitationApi = createOperatorInvitationApi("/api");

<AcceptOperatorInvitationPage api={invitationApi} brandName="Nativark" />;
<OperatorInvitations open={open} onClose={close} roles={roles} organizations={organizations} />;
```

`renderHeader` 让原路由供给当前品牌和图标，受权数据与页面工具由公共页面提供。缺省页头使用公共 `PageHeading`。Core 的业务词典沿原贡献机制接入。

## 请求与结果

[请求工厂](client.ts)沿宿主唯一认证请求发送，读取方法传递查询取消信号。邀请提交保留原 55 秒时限，邮箱同步保留原 110 秒时限，宿主将 `MessagingRequestOptions.timeout` 传给现有客户端。

[邀请表单](OperatorInvitations.tsx)在按宿主实例、租户和账号隔离的内存记录中，按邮箱保存原请求。关闭重开、路由重挂载及 Core / 会话代次切换后，同一主体继续读取原 `idempotencyKey`。网络、408 或 5xx 的未确认结果保留原键。4xx 确定拒绝且原键读取为 404 后才释放该邮箱尝试。取消批次停止后续提交，原已提交项沿原键核对，撤回等待真实确认和原 API。选人、组织或业务配置变动会失效此前的邮件预览，迟到响应按配置代次核对。

[接受页](AcceptOperatorInvitationPage.tsx)让 SaveButton 与回车共用同一次提交 Promise。成功清空表单和内存凭证，显示基础成员授权并进入租户登录。密码长度、字母 / 数字 / 特殊字符和确认密码沿原校验。

[寄件目录](TenantDispatchPage.tsx)与[详情](DispatchDetail.tsx)继续消费原渠道、状态、来源及分页。历史正文和模板保留原缺失状态。邮件预览使用空 sandbox 和 `no-referrer`，HTML 来自服务端安全模板。

[客服邮件](CustomerSupportPage.tsx)保留原搜索防抖、键盘选择、分页、正文和附件元数据。同步完成与随后列表刷新分别反馈。查询键、页面草稿及迟到结果按当前会话代次隔离。

## 来源与验证入口

[Invite people 来源](invitation-source/components/invite-people/provenance.json)、[Inbox 来源](support-source/inbox/provenance.json)和[Conversation 来源](support-source/conversation/provenance.json)保留原还原出处、哈希及许可说明。来源中的视觉检查属于原组件还原阶段，本模块的浏览器及真实邮箱验收另行记录。共享组件入口和许可见[UIArc 组件库](../../../../ui-arc/README.md)。

后台类型配置见[platform-admin tsconfig](../../../tsconfig.json)。原邮件、邀请、投递和恢复的离线用例见[消息用例](../../../../../tests/tenant-messaging.test.cjs)。实际 HTTP / 邮箱运输沿服务端[公共消息模块](../../../../platform-server/src/modules/messaging/README.md)接入。
