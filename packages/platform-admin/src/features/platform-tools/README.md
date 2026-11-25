# 公共平台工具页面

本模块持有原平台治理和文件与任务两组页面：字典、编号、筛选预设、文件、打印任务、异步任务和通知记录。原后台和公共宿主使用同一组件、当前会话、请求、缓存、语言及 UIArc 适配。[模块出口](index.ts) · [宿主端口](../../runtime/index.ts) · [字典与编号服务](../../../../platform-server/src/modules/platform-tools/README.md)

| 入口 | 用途 |
| --- | --- |
| [页面及页签](PlatformToolsPage.tsx) | `PlatformToolsPage` 提供公共页面，`usePlatformToolsTabs()` 返回 `items` 与 `overlay` 供原治理页签嵌入 |
| [客户端](client.ts) | 十九个原方法、路径和 payload，读取传递取消信号，写入等待真实 Promise |
| [可见性](platformToolsAccess.ts) | 原 `/platform/tools` 路径和各自权限，SaaS 账号显示原租户工具说明并且不发起租户查询 |
| [双语词条](messages.ts) | 原英语值与新增错误/刷新提示，供两个宿主语言表合并 |

原 [平台工具页](../../../../../apps/admin/src/features/platform/PlatformToolsPage.tsx) 再导出同一完整页面。原 [API](../../../../../apps/admin/src/api/platformOps.ts) 的十九个对应方法委托公共客户端。[公共应用接点](../../application.tsx)

字典页保留原四个组信息字段，编辑已有组时保留原字典项数组。新组通过原 Form.List 输入首个字典项的编码、显示名称、值、排序、启停和备注，空编码/名称/值沿原表单和服务端校验拒绝，零 Core 租户可从空列表创建第一组字典。编号页保留原编码、名称、模块、前缀、日期格式、流水长度、重置周期与启停字段。编号表单没有当前流水编辑控件，保存省略该字段，由服务在事务锁内保留最新流水。

筛选预设保留原作用域、名称、说明、JSON 和默认开关；文件保留业务归属、名称、MIME、大小和上传场景；打印保留文档类型、模板及业务归属；异步任务保留类型、业务归属及计划时间。沿原 600 宽侧窗或对话框、表格列、默认值、状态和操作图标。文件提供方、打印及作业是否实际可执行由服务端决定，页面不补造成功。

字典和编号沿各自原权限；文件与任务沿 `tenantMembership` 的全租户 `system:integration:manage` 投影。筛选预设是已登录租户用户的自助设置，不因此给所有用户新增工具导航。服务端仍须复验当前主体、租户、数据范围及文件 ACL。[原消息权限投影](../messaging/messagingAccess.ts)

查询键包含当前会话代次，各工具分别判定原权限后启动查询，读取错误通过原 QueryState 反馈。保存按钮和回车共用单个 Promise；筛选、文件和任务编辑器还按打开代次隔离校验、关闭和保存回调，退出动画不清除新开的草稿。字典和编号表单由原 `useServerFormSync` 保留草稿并检测服务端变化。取号保留原链接按钮，取得服务端结果后显示可复制编号，再刷新当前流水。保存成功与刷新失败分别反馈。

全部十一个写方法设置 `retryAuthentication: false`，401直接返回本次失败，不刷新凭据后重发写入；八个读取方法仍可沿原会话刷新重读。网络结果不明按原设置、文件或作业事实核对，不自动补发写入。实际请求范围见[客户端](client.ts)：`/platform/dictionaries`、`/platform/number-rules`、`/platform/filter-presets`、`/files`、`/notifications/templates`、`/notifications/logs`、`/jobs`、`/jobs/print` 及各自明确的子操作。HTTP 宿主必须沿[公共服务装配](../../../../platform-server/src/platform-server.module.ts)接通相同路径。

定向验证复用[既有源码加载入口](../../../../../tests/admin-work-order-board.test.cjs)，核对接口、取消信号、失败 Promise、原页签与字段、当前权限、单次提交及旧回调拒绝。类型和离线组件夹具各有边界；浏览器、Portal、实际回车/快速点击、窄窗口、完整主题和真实接口继续在原宿主验收。[项目规则](../../../../../AGENTS.md#修改验证与交付) · [Core接入手册](../../../../core-contracts/README.md#五步快速接入)
