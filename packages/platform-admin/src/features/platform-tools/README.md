# 公共字典与编号页面

本模块从原平台工具页抽取两个原页签、列表、表单及取号结果弹窗。原后台和公共宿主使用同一组件、当前会话、请求、缓存、语言及 UIArc 适配。[模块出口](index.ts) · [宿主端口](../../runtime/index.ts) · [服务与数据](../../../../platform-server/src/modules/platform-tools/README.md)

| 入口 | 用途 |
| --- | --- |
| [页面及页签](PlatformToolsPage.tsx) | `PlatformToolsPage` 提供公共页面，`usePlatformToolsTabs()` 返回 `items` 与 `overlay` 供原治理页签嵌入 |
| [客户端](client.ts) | 五个原方法、路径和 payload，读取传递取消信号，写入等待真实 Promise |
| [可见性](platformToolsAccess.ts) | 原 `/platform/tools` 路径和字典/编号各自权限，SaaS 账号拒绝租户工具 |
| [双语词条](messages.ts) | 原英语值与新增错误/刷新提示，供两个宿主语言表合并 |

原 [平台工具页](../../../../../apps/admin/src/features/platform/PlatformToolsPage.tsx) 在原治理页签中消费同一 `items`，在原页面挂载 `overlay`。筛选预设、文件、打印、通知及作业仍由原页面管理。原 [API](../../../../../apps/admin/src/api/platformOps.ts) 的五个对应方法委托公共客户端。[公共应用接点](../../application.tsx)

字典页保留原四个组信息字段，编辑已有组时保留原字典项数组。新组通过原 Form.List 输入首个字典项的编码、显示名称、值、排序、启停和备注，空编码/名称/值沿原表单和服务端校验拒绝，零 Core 租户可从空列表创建第一组字典。编号页保留原编码、名称、模块、前缀、日期格式、流水长度、重置周期与启停字段。编号表单没有当前流水编辑控件，保存省略该字段，由服务在事务锁内保留最新流水。

查询键包含当前会话代次，各工具分别判定原权限后启动查询，读取错误通过原 QueryState 反馈。保存按钮和回车共用单个 Promise，取号使用原 ActionButton 并等待服务端结果。切换身份后旧响应不显示成功，表单由原 `useServerFormSync` 保留草稿并检测服务端变化。取号成功显示原可复制编号，然后刷新当前流水，刷新失败单独提示。

定向验证核对原五个接口、payload、取消信号、失败 Promise、权限矩阵、词条及原表单字段。类型与离线声明证据随本专项阶段收口，浏览器、Portal、真实回车/快速点击、窄窗口、完整主题和真实接口继续在原宿主验收。[项目规则](../../../../../AGENTS.md#修改验证与交付) · [当前专项](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)
