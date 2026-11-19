# Rental 与工单公共后台示范

本应用将 Rental 的业务页面与工单的列表、新建、详情和配置页登记到同一公共后台。登录、公共设置、菜单、面包屑、主操作、主题和请求缓存由公共应用供给。[组合入口](src/main.tsx) · [公共页面合同](../../packages/core-contracts/README.md#声明页面与操作) · [公共应用](../../packages/platform-admin/src/application.tsx)

## 装配

1. 按宿主锁文件准备依赖与 Rental、`example-tickets` 两个固定标准包，API 使用相同的包版本、来源与摘要。
2. 将 `CORE_DEPLOYMENT_LOCK` 指向同一固定部署锁，`cores` 显式包含这两个包。构建逐包校验实际字节，并核对底座及所选数据能力的 `coreDeploymentHostVersions`。[构建入口](vite.config.ts) · [包校验](../../packages/core-contracts/src/install.ts) · [部署合同](../../packages/core-contracts/src/update.ts)
3. 在具备对应环境的工程中执行 `npm run build -w @rental-os/example-multi-core-admin`，本地开发使用 `npm run dev -w @rental-os/example-multi-core-admin`。Web API 基址由 `VITE_API_BASE_URL` 提供，默认 `/api`，开发端口默认 `5179`。
4. SaaS 管理员授权租户使用两个 Core，租户管理员通过公共成员 Core 分配页分别分配成员。每个 Core 继续校验自己的业务权限和就绪条件。[授权页面](../../packages/platform-admin/src/CoreAccessPage.tsx)

## 源码职责

- [main](src/main.tsx)创建唯一 `createRentalBrowserAdminSession`，将两份真实页面贡献放入同一注册表，再交给 `createPlatformAdminApplication`。公共应用与 Rental 正文使用同一 runtime、会话代次和 QueryClient。
- [MultiCoreShell](src/MultiCoreShell.tsx)持续挂载正式 Rental 薄壳和通知 Provider。当前获权 Rental 页面显示经营空间选择，工单与公共页显示公共上下文。Core 撤权后的当前目录更新关闭相应菜单、动作和通知读取，工单原操作状态沿同一正文保留。
- [Rental 导航](../../packages/rental-core/admin/browser-navigation.ts)维护原深链接、通知对象定位及已验证的 `rental-workspace` 投影。工单按租户范围进入正式路由，缺经营空间的成员仍可使用获权工单和适用公共设置。
- [Rental 贡献](../../packages/rental-core/admin/index.tsx)与[工单贡献](../../packages/example-tickets-core/admin/index.tsx)提供真实正文及类型化动作，原写入、权限、历史与 unknown 核对规则沿各自实现运行。

源码取出时包含本应用、`config/environment.cjs` 及其类型声明、公共 `core-contracts`、`platform-contracts`、`platform-admin`、`shared`、`ui-arc`、`ui-motiq` 与两个 Core 的已选依赖闭包。依赖声明见[应用包](package.json)，构建接点使用公共正式出口。

## 验证边界

本片验收分别记录必要类型检查、真实页面源码内存构建与离线授权、范围、导航和生命周期冒烟。部署锁、已安装包解析、服务端 Core 目录及就绪响应使用明确 fixture。真实双 Core API 装配、持久化、浏览器实页、干净标准包安装与正式多 Core 验收由对应宿主阶段继续完成。
