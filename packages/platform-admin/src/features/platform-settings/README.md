# 公共平台管理界面

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
| [平台参数](PlatformSystemPage.tsx)、[平台运维](PlatformOperationsPage.tsx) | 原页头、AI 配置入口与安全分区，沿原 SaaS 参数权限呈现 |
| [组织与权限组合](PlatformPage.tsx)、[组合客户端](platform-console-client.ts) | 原账号、组织、角色与审计页签；保持原 SaaS 页面准入，不因通配角色开放租户管理接口 |
| [演示预约](DemoRequestsPage.tsx)、[只读客户端](demo-requests-client.ts) | 原分页、搜索、列表及 640px 详情侧窗，读取当前受权列表行 |
| [公共官方日历](OfficialCalendarSourcePage.tsx)、[客户端](official-calendar-client.ts) | 原来源登记、年度版本与日期编辑，520px 来源弹窗和 760px 年度侧窗 |
| [日期字段](OfficialCalendarDatesField.tsx)、[数据算法](official-calendar-dates.ts) | 原逐条与 JSON 双编辑；保留已有补充字段、草稿和保存生命周期 |

公共应用将组织页接在 `/settings/organizations`，平台参数、运维、预约和日历分别使用原 `/platform/system`、`/platform/operations`、`/platform/demo-requests` 和 `/platform/official-calendars`。菜单和直接页面使用同源可见性检查；原 `/system-rules`、`/security-baseline` 等深链接定位同一已登记页面。个人改密继续走 `/settings/security` 的原账号安全页。[公共应用注册](../../application.tsx) · [原菜单及兼容路径](../../application-navigation.tsx) · [个人改密](../../session-pages.tsx)

原 [组织与权限页](../../../../../apps/admin/src/features/platform/PlatformPage.tsx)、[平台参数](../../../../../apps/admin/src/features/platform/PlatformSystemPage.tsx)、[运维](../../../../../apps/admin/src/features/platform/PlatformOperationsPage.tsx)、[预约](../../../../../apps/admin/src/features/platform/DemoRequestsPage.tsx)和[官方日历](../../../../../apps/admin/src/features/platform/OfficialCalendarSourcePage.tsx)窄转接同一页面。原 [安全设置入口](../../../../../apps/admin/src/features/platform/PlatformSecuritySettings.tsx) 再导出公共组件，[原 API](../../../../../apps/admin/src/api/platform.ts) 将六个对应方法委托公共客户端。官方日历与公共安全共用原布局类，兼容 CSS module 继续提供原类名。[原样式入口](../../../../../apps/admin/src/features/platform/PlatformSettings.module.css)

SaaS 页面沿原 `hasPermission` 规则：租户、日历和预约使用平台分面；参数和 AI 仍需明确权限或通配权限。`system:user:manage` 不属于原 SaaS 页面许可，组织与权限深链接保持原拒绝，平台治理页保留原说明块并不读取租户工具。页面可见性不改变后端 allowlist。[同源可见性](../../application-access.ts) · [治理页](../platform-tools/PlatformToolsPage.tsx)

## 状态和提交边界

读取缓存包含当前会话代次，身份变化沿宿主取消请求及清除缓存。组织页使用原姓名和编码筛选、表格、状态开关及编辑弹窗。缺组织维护权限时保留受权只读列表，维护仍由服务端复验当前租户、全租户与完整地点范围。

组织与安全页头沿[原品牌解析](../../app/branding.ts)读取当前租户及用户品牌。组织保存失败保留原消息反馈和表单输入；安全页继续保留原分区内的错误提示，不重复增加组织表单错误块。

表单保存按钮与回车提交共用同一 Promise，并使用原 `useServerFormSync` 保留未保存草稿、检测服务端变化。请求失败保留输入。保存已经取得服务端结果而后续刷新失败时，分别显示保存结果及读取失败。组织编辑器保留弹窗退出生命周期，安全页保留显式重新读取确认。[原表单同步](../../app/useServerFormSync.ts) · [原保存适配](../../components/ui/ActionButton.tsx)

安全数值输入继续采用原界面校验，服务端五个数值沿原有限且非负规则。二次确认页保留原预留能力提示，业务动作的批准及执行继续由所属服务裁定。[公共服务与验证边界](../../../../platform-server/src/modules/platform/README.md)

## 验证

定向验证覆盖六个接口的路径、字段、信号与失败 Promise，组织读取/维护、地点范围及 SaaS 安全保存的可见性矩阵，原兼容入口、个人改密职责和共同提交声明。Vite 的 CSS 编译入口核对原四个类与公共样式同源，词条逐项核对原值。[组件与隔离规则](../../../../../apps/admin/AGENTS.md) · [项目验证规则](../../../../../AGENTS.md#修改验证与交付)

类型、声明与 CSS 编译各自提供定向证据。实际接口和页面使用所属宿主的注册及当前授权；独立运行从[公共后台宿主](../../../../../apps/platform-admin/README.md)和[公共 API](../../../../../apps/platform-api/README.md)进入。
