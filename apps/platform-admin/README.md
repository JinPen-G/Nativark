# 无 Core 公共后台

本应用只依赖公共合同、公共 React 后台和对应[公共 API](../platform-api/README.md)。默认不安装或装配任何业务 Core，原 Rental 后台继续使用自己的组合入口。

## 阅读入口

- [main](src/main.tsx)加载正式公共样式和动效，挂载[App](src/App.tsx)。后者选择空Core组合，公共应用沿验证后的身份过滤菜单与直接地址。
- [session](src/session.ts)创建唯一浏览器会话，实际逻辑在[公共会话](../../packages/platform-admin/src/runtime/browser-session.ts)及[HTTP客户端](../../packages/platform-admin/src/runtime/browser-http.ts)。登录、刷新、改密、退出和 storage 失效共用原取消/代次边界。
- [公共SettingsPage](../../packages/platform-admin/src/SettingsPage.tsx)调用本人资料、账户主题色、租户名称和品牌名 API。保存等待原 Promise、保留原修订号，后台读取保留草稿，明确重新读取才放弃草稿。菜单隐藏不能替代服务端授权。
- [Vite配置](vite.config.ts)复用公共适配与原环境白名单。开发端口5176，API代理使用原配置，Core代码不决定代理或读取秘密。
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

在已经按根锁文件准备依赖的独立检出中，按[公共API说明](../platform-api/README.md)配置自己的库、迁移、初始化及API。再运行以下命令。

```bash
npm run build:platform-admin
npm run dev:platform-admin
```

平台账号可登录公共后台；租户管理员或普通账号的可见设置由原权限决定，临时密码先完成改密。未开通 Core 的首页提示联系管理员，侧栏、面包屑/页名、铃铛、休息和面板仍存在。通知默认为空，不提供无 Core 通用业务 Agent。休息组件沿原本地媒体与选择文件行为，默认录音没有随包分发，缺失保持真实失败。

dev、build 和 lint 的前置脚本构建 `@rental-os/platform-core-host`，准备包管理的同版本协议运行时。对应公共 API 已装配十二个包管理接口。发行与候选存储使用宿主配置的绝对 `CORE_PACKAGE_STORAGE_ROOT`，默认零 Core 的实际版本、部署材料和候选规划按可用证据显示 `unavailable`。[服务端配置与前置](../platform-api/README.md)

当前入口已有类型与认证请求围栏的离线证据，浏览器、真实 HTTP/数据库保存重读及完整公共管理功能仍待验。公共实现与边界从[后台模块导读](../../packages/platform-admin/README.md)读取。构建命令不是安装、迁移或启服务的授权。
