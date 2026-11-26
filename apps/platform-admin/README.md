# 无 Core 公共后台

本应用只依赖公共合同、公共 React 后台和对应[公共 API](../platform-api/README.md)。默认不安装或装配任何业务 Core，原 Rental 后台继续使用自己的组合入口。

## 阅读入口

- [默认入口](src/start.tsx)选择空 Core；[main](src/main.tsx)加载正式公共样式与动效，挂载同一个[公共 App](src/App.tsx)。公共应用沿验证后的身份过滤菜单与直接地址。
- [session](src/session.ts)创建唯一浏览器会话，实际逻辑在[公共会话](../../packages/platform-admin/src/runtime/browser-session.ts)及[HTTP客户端](../../packages/platform-admin/src/runtime/browser-http.ts)。登录、刷新、改密、退出和 storage 失效共用原取消/代次边界。
- [公共SettingsPage](../../packages/platform-admin/src/SettingsPage.tsx)调用本人资料、账户主题色、租户名称和品牌名 API。租户本人资料页只编辑名称，SaaS“租户管理”还提供后台简称。保存等待原 Promise，租户外观携带原 `expectedRevision`，本人资料、账户主题与租户名称使用草稿同步保护。后台读取保留草稿，明确重新读取才放弃草稿。设置保存显式禁止401后刷新重发；失败保留草稿，重新读取原设置核对后再保存。菜单隐藏不能替代服务端授权。
- [Vite配置](vite.config.ts)复用公共适配与原环境白名单。开发端口5176，API代理使用原配置，Core代码不决定代理或读取秘密。

## 选装公共 AI 管理

如果 API 已在同一部署选择[公共 AI 管理](../platform-api/README.md#选装公共-ai-管理)，在 Web 组合安装同源的公共 AI 后台源码包 `0.2.1`，执行 `npm run build:ai -w @rental-os/platform-admin-app`。产物在 `dist-ai`。原应用、会话、路由及视觉规范保持，通过已有 `/platform/ai` 权限入口提供原模型、费率、预算和额度页面；页面启用不会授予权限。默认 `build` 不需要安装 AI 源码包。[选装接点](src/start-ai.tsx)
- 公共应用内置[Core管理目录](../../packages/platform-admin/src/CoreAccessPage.tsx)。SaaS管理员选择租户开通Core，租户管理员选择真实成员分配已开通Core；两层授权分别保存。无Core部署保留目录入口和准确空态。
- “Core 包管理”位于 `/platform/core-packages`，同一应用工厂按当前 SaaS 管理权限提供菜单和受保护页面，普通租户及撤权会话在管理查询挂载前拒绝。页面复用原会话、QueryClient 和完整外壳，零 Core 显示实际空注册目录，缺部署或包证据显示不可用。原后台的同名入口通过正式公共出口消费同一页面，品牌沿原解析传入。[页面与客户端](../../packages/platform-admin/src/features/core-packages/README.md)
- [人员/角色页面](../../packages/platform-admin/src/features/access/PublicManagementPages.tsx)读取公共目录并创建/编辑，角色权限复用原搜索编辑器。无Core也可维护公共角色；Core业务权限需先由部署入口按清单登记。
- 人员目录的“邀请成员”读取当前租户受权的基础角色和组织，不查询 Rental 空间；关闭弹窗保留原邀请请求，结果待核对时只读取原键。[成员邀请接线](../../packages/platform-admin/src/features/access/PublicMemberInvitations.tsx)
- 公开 `/invite` 从原邮件凭证预览并接受邀请，使用独立匿名客户端；随后进入 `/login/:tenantCode`，预填对应租户编码。已登录其他租户仍能进入该登录页，服务端继续核验账号和密码。[邀请页面](../../packages/platform-admin/src/features/messaging/AcceptOperatorInvitationPage.tsx)
- “账号安全”使用当前密码修改本人口令，复用首次改密同一表单和原会话轮换；密码输入不进入公共设置保存接口、缓存或浏览器存储。
- 人员目录的“重置密码”和普通角色的“删除”进入独立确认页，复用原服务端接口；当前本人、固定角色和越权管理员账号不可操作。保存结果与后续读取分开，一次性口令可在当前页复制。
- SaaS“租户管理”可创建无Core租户、修改资料及单独变更状态；创建需租户初始化权限，冻结/停用沿原服务端撤销会话，恢复保留Core及成员设置。创建临时密码只在当前保存结果显示。
- “第三方服务”复用[公共集成页](../../packages/platform-admin/src/features/integrations/README.md)，路径沿原 `/tenant/integrations`。同一应用工厂提供菜单和受保护路由，页面按当前租户身份及原集成权限开放；目录、配置保存和连接测试共用唯一请求与缓存边界。短信、支付和云存储仅显示服务端实际提供的能力。
- “寄件中心”和“客服中心”位于 `/settings/dispatch` 与 `/settings/support`，读取当前租户的原投递记录和邮件；客服同步等待原请求，未确认结果不自动重做。[公共消息页面](../../packages/platform-admin/src/features/messaging/README.md)
- “组织管理”位于 `/settings/organizations`，复用原组织列表、筛选、编辑和状态操作；受权只读与全租户维护分别开放。[公共组织页面](../../packages/platform-admin/src/features/platform-settings/README.md)
- “安全基线”沿原 `/platform/system` 提供原登录限流、密码策略、脱敏和二次确认配置，读取与 SaaS 保存分别授权，保存失败保留草稿并明确重读核对。个人改密使用上方“账号安全”。[同源页面与请求](../../packages/platform-admin/src/features/platform-settings/index.ts)
- “平台工具”位于 `/platform/tools`，字典与编号分别按当前权限显示，复用同一公共页签、表单及取号结果。零 Core 租户可从空列表创建第一组字典或编号规则；编号保存保留服务端最新流水。[页面与请求](../../packages/platform-admin/src/features/platform-tools/README.md)

## 本地使用

从[公共 API 五步](../platform-api/README.md#默认零-core-的五步)取得已构建、迁移和初始化的独立 API，在所选源码根目录继续。

| 步骤 | 操作 | 应看到什么 |
| --- | --- | --- |
| 1 | 按同一发行锁准备依赖和 API，保留本树公共 Client | Web 前置公共包可构建，登录请求指向该独立 API |
| 2 | 提供公开 API 基址与开发代理，构建本宿主 | 产物为本宿主 dist，页面与公共运行时来自同一公共包 |
| 3 | 启动 Web，使用初始化账号登录并完成首次改密 | SaaS 可创建租户，租户公共设置按角色开放，首页与业务目录显示真实空态 |

`VITE_API_BASE_URL` 默认 `/api`，`API_PROXY_TARGET` 指向同一 API 服务。开发端口由当前进程 `PORT` 指定，默认 5176。Vite 沿[原环境读取器](../../config/environment.cjs)读取配置，仅向浏览器注入公开白名单。部署 Web 时提供同源 API 或受控反向代理。[实际配置](vite.config.ts)

```sh
npm run build -w @rental-os/platform-admin-app
npm run dev -w @rental-os/platform-admin-app
```

workspace 名来自本宿主 [package.json](package.json)，可直接用于完整检出和零 Core 源码发行。

平台账号可登录公共后台；租户管理员或普通账号的可见设置由原权限决定，临时密码先完成改密。未开通 Core 的首页提示联系管理员，侧栏、面包屑/页名、铃铛和面板仍存在。休息入口向已验证租户会话开放，SaaS 账号隐藏该入口。通知默认为空，不提供无 Core 通用业务 Agent。休息组件沿原本地媒体与选择文件行为，默认录音没有随包分发，缺失保持真实失败。

dev、build 和 lint 的前置脚本构建 `@rental-os/platform-core-host`，准备包管理的同版本协议运行时。对应公共 API 已装配十二个包管理接口。发行与候选存储使用宿主配置的绝对 `CORE_PACKAGE_STORAGE_ROOT`，默认零 Core 的实际版本、部署材料和候选规划按可用证据显示 `unavailable`。[服务端配置与前置](../platform-api/README.md)

当前入口已有类型、认证请求围栏和下方零 Core 浏览器/真实保存回读证据，完整公共管理与业务 Core 页面分别验收。公共实现与边界从[后台模块导读](../../packages/platform-admin/README.md)读取。构建命令不是安装、迁移或启服务的授权。

## 验证入口

零 Core 源码发行已在独立依赖根实际构建，并由 headless Chromium 149 连接同根公共 API 和专用 MySQL 验证。真实登录后可见原侧栏、面包屑/页名与空 Core 提示；侧栏收展、Core面板开关、休息时长选择、通知弹层、本人资料保存后刷新、中英文切换及600px英文窄屏面板均通过。浏览器异常与外部请求为零。API/数据库重启后本人、租户、品牌和主题等已保存快照保持；这里只核所列行为，其他公共页面、Core业务主操作与多Core切换另行验证。[服务端组合与前置](../platform-api/README.md#验证入口)

必要类型沿[现有内存类型入口](../../scripts/check-selected-prisma-types.cjs)，选择 `--mode platform --config apps/platform-admin/tsconfig.json`。公共应用的[同一注册和会话出口](../../packages/platform-admin/README.md)提供默认路由、权限与请求验证路线，运行包证据见[公共 API](../platform-api/README.md#验证入口)。浏览器首次改密、公共保存重读、窄屏与双语验收使用各自真实环境证据。
