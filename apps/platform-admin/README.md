# 无 Core 公共后台

本应用只依赖公共合同、公共 React 后台和对应[公共 API](../platform-api/README.md)。默认不安装或装配任何业务 Core，原 Rental 后台继续使用自己的组合入口。

## 阅读入口

- [main](src/main.tsx)加载正式公共样式和动效，挂载[App](src/App.tsx)。后者选择空Core组合，公共应用沿验证后的身份过滤菜单与直接地址。
- [session](src/session.ts)创建唯一浏览器会话，实际逻辑在[公共会话](../../packages/platform-admin/src/runtime/browser-session.ts)及[HTTP客户端](../../packages/platform-admin/src/runtime/browser-http.ts)。登录、刷新、改密、退出和 storage 失效共用原取消/代次边界。
- [公共SettingsPage](../../packages/platform-admin/src/SettingsPage.tsx)调用本人资料、账户主题色、租户名称和品牌名 API。保存等待原 Promise、保留原修订号，后台读取保留草稿，明确重新读取才放弃草稿。菜单隐藏不能替代服务端授权。
- [Vite配置](vite.config.ts)复用公共适配与原环境白名单。开发端口5176，API代理使用原配置，Core代码不决定代理或读取秘密。
- 公共应用内置[Core管理目录](../../packages/platform-admin/src/CoreAccessPage.tsx)。SaaS管理员选择租户开通Core，租户管理员选择真实成员分配已开通Core；两层授权分别保存。无Core部署保留目录入口和准确空态。
- [人员/角色页面](../../packages/platform-admin/src/features/access/PublicManagementPages.tsx)读取公共目录并创建/编辑，角色权限复用原搜索编辑器。无Core也可维护公共角色；Core业务权限需先由部署入口按清单登记。

## 本地使用

在已经按根锁文件准备依赖的独立检出中，按[公共API说明](../platform-api/README.md)配置自己的库、迁移、初始化及API。再运行以下命令。

```bash
npm run build:platform-admin
npm run dev:platform-admin
```

平台账号可登录公共后台；租户管理员或普通账号的可见设置由原权限决定，临时密码先完成改密。未开通 Core 的首页提示联系管理员，侧栏、面包屑/页名、铃铛、休息和面板仍存在。通知默认为空，不提供无 Core 通用业务 Agent。休息组件沿原本地媒体与选择文件行为，默认录音没有随包分发，缺失保持真实失败。

当前源码/类型、Vite内存构建和认证请求围栏已核，浏览器、真实 HTTP/数据库保存重读及完整公共管理功能仍待验。实际证据见[PCH记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-zero-admin-host-20261115)。构建命令不是安装、迁移或启服务的授权。
