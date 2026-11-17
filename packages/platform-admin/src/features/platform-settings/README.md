# 公共组织与安全界面

本模块持有原组织列表、编辑表单、安全基线设置和运维概览。公共应用与原后台从同一出口消费组件、请求方法和双语文案，宿主供给当前会话、请求、查询缓存及 UIArc 适配。[正式包出口](../../../package.json) · [公共应用](../../application.tsx) · [请求与会话](../../runtime/index.ts)

## 阅读与接入

| 入口 | 职责 |
| --- | --- |
| [页面与客户端出口](index.ts) | `OrganizationsPage`、`PlatformSecuritySettings`、`PlatformSecurityOverview` 和公共客户端 |
| [组织列表与编辑器](OrganizationsPage.tsx) | 原名称、编码、类型、父组织和状态字段；`embedded` 模式供原组织页签使用 |
| [安全设置与概览](PlatformSecuritySettings.tsx) | 原登录限流、密码策略、脱敏和二次确认配置，沿原表单分区、校验及重新读取确认 |
| [六个原接口](client.ts) | 复用宿主请求，保留路径、payload、操作人字段及失败 Promise；读取传递取消信号 |
| [路由和可见性](platformSettingsAccess.ts) | 组织读取与全租户维护分别判定，安全基线读取与 SaaS 保存分别判定 |
| [双语文案](messages.ts) | 原组织和安全词条迁入公共语言提供者，租户录入事实保持原值 |
| [原样式](PlatformSettings.module.css) | 原四个布局类的唯一源码，原后台 CSS module 通过 `composes` 消费同一出口 |

公共应用将组织页接在 `/settings/organizations`，安全基线页接在原 `/platform/system`。菜单和直接页面使用同源可见性检查。个人改密继续走 `/settings/security` 的原账号安全页。[公共应用注册](../../application.tsx) · [个人改密](../../session-pages.tsx)

原 [组织与权限页](../../../../../apps/admin/src/features/platform/PlatformPage.tsx) 在组织页签嵌入同一组件，账号、角色及审计仍沿原页面。原 [安全设置入口](../../../../../apps/admin/src/features/platform/PlatformSecuritySettings.tsx) 再导出公共组件，[原 API](../../../../../apps/admin/src/api/platform.ts) 将六个对应方法委托公共客户端。官方日历与公共安全共用原布局类，兼容 CSS module 继续提供原类名。[原样式入口](../../../../../apps/admin/src/features/platform/PlatformSettings.module.css)

## 状态和提交边界

读取缓存包含当前会话代次，身份变化沿宿主取消请求及清除缓存。组织页使用原姓名和编码筛选、表格、状态开关及编辑弹窗。缺组织维护权限时保留受权只读列表，维护仍由服务端复验当前租户、全租户与完整地点范围。

表单保存按钮与回车提交共用同一 Promise，并使用原 `useServerFormSync` 保留未保存草稿、检测服务端变化。请求失败保留输入。保存已经取得服务端结果而后续刷新失败时，分别显示保存结果及读取失败。组织编辑器保留弹窗退出生命周期，安全页保留显式重新读取确认。[原表单同步](../../app/useServerFormSync.ts) · [原保存适配](../../components/ui/ActionButton.tsx)

安全数值输入继续采用原界面校验，服务端五个数值沿原有限且非负规则。二次确认页保留原预留能力提示，业务动作的批准及执行继续由所属服务裁定。[公共服务与验证边界](../../../../platform-server/src/modules/platform/README.md)

## 验证

定向验证覆盖六个接口的路径、字段、信号与失败 Promise，组织读取/维护、地点范围及 SaaS 安全保存的可见性矩阵，原兼容入口、个人改密职责和共同提交声明。Vite 的 CSS 编译入口核对原四个类与公共样式同源，词条逐项核对原值。[组件与隔离规则](../../../../../apps/admin/AGENTS.md) · [项目验证规则](../../../../../AGENTS.md#修改验证与交付)

类型、声明与 CSS 编译各自提供定向证据。浏览器、Portal、实际回车和快速点击、窄窗口、完整主题及真实接口仍沿专项接续验收。[PCH 当前入口](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)
