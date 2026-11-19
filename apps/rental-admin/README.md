# Rental 独立管理后台

这个宿主把所选 Rental 标准包的十二组业务页面接入公共管理应用。登录、主题、语言、公共设置、导航、休息与通知控件沿公共后台运行，业务页面取得同一浏览器会话、请求和 QueryClient。[应用入口](src/main.tsx) · [浏览器供给](../../packages/rental-core/admin/browser/README.md) · [页面贡献](../../packages/rental-core/admin/README.md)

## 构建与运行

先在宿主准备锁文件对应的依赖与 Rental 标准包，将 `CORE_DEPLOYMENT_LOCK` 指向与 API 相同的固定部署锁。构建入口核对所选包、清单与公共版本，要求锁内包含一个 Rental Core，随后向应用提供 `virtual:core-manifest`。安装包核验通过 `coreDeploymentHostVersions(lock)` 读取底座和显式选装数据能力的同一版本视图。[构建配置](vite.config.ts) · [标准包核验](../../packages/core-contracts/src/install.ts) · [宿主版本视图](../../packages/core-contracts/src/data-capability.ts)

```powershell
npm run lint -w @rental-os/rental-admin
npm run build -w @rental-os/rental-admin
npm run dev -w @rental-os/rental-admin
```

开发端口默认 `5178`，可用进程变量 `PORT` 配置。API 公开基址与代理沿公共环境配置。`ai-offline` 构建模式使用既有离线环境分支。[包命令](package.json) · [环境加载](../../config/environment.cjs)

## 源码取出范围

源码宿主的构建组合包含以下入口。公共包和 Rental 标准包按同一部署锁准备，第三方依赖沿应用包及 Core 的直接依赖声明和锁文件安装。

| 位置 | 构建职责 |
| --- | --- |
| `apps/rental-admin/` | 应用、空间选择、登记导航和 Vite 装配 |
| `packages/core-contracts/`、`packages/platform-contracts/` | 当前注册、范围、部署锁及公共运行时合同 |
| `packages/platform-admin/` | 公共应用、UI、样式及构建适配 |
| `packages/ui-arc/`、`packages/ui-motiq/` | 公共组件使用的保留源码、样式与许可 |
| `packages/rental-core/` | 十二组 31 页、通知、浏览器会话及所选标准包的领域运行时出口 |
| `config/environment.cjs` | 公开构建参数和原环境加载入口 |

Runtime 导入沿各包正式出口解析。公共 UI 的来源别名由 `platformAdminVite()` 定位到保留组件及公共适配器。日期、订单表格、HTTP 兼容处理和原动效的直接依赖分别由 `dayjs`、`@tanstack/react-table`、`axios` 和 `motion` 提供。[公共构建入口](../../packages/platform-admin/config/vite.ts) · [Core 依赖](../../packages/rental-core/package.json) · [UIArc 来源](../../packages/ui-arc/README.md) · [表格动效来源](../../packages/ui-motiq/README.md)

## 身份、范围与导航

`createRentalBrowserAdminSession` 供给唯一会话与查询缓存，`createRentalBrowserAdminHost` 将它接入各组页面。空间选择来自已验证会话的经营空间列表，切换调用原 `switchWorkspace`，由该方法采用服务端响应、取消旧请求并推进缓存代次。[外壳供给](src/RentalShell.tsx) · [原会话](../../packages/rental-core/admin/browser-auth-store.ts)

租户级会员页面与客户端渠道使用租户范围。订单、工单、商品资产、报表、开业及其他经营空间页面使用当前 `rental-workspace` 容器。页面范围复用会员原范围声明，Core 分配与精确页面权限继续读取当前服务端使用目录。[范围与链接映射](src/navigation.ts) · [会员范围](../../packages/rental-core/admin/membership/pages.ts) · [公共范围路由](../../packages/platform-admin/src/core/CoreRoutes.tsx)

直接打开旧链接时，应用在创建公共 Router 前定位登记目标。消息内的打开记录动作同时核对当前 Core 使用权。查询参数与锚点随已登记目标保留，最终业务动作仍由所属页面与服务端核验。

| 旧入口 | 登记入口 |
| --- | --- |
| `/rental/orders/:id` | `/cores/rental/orders/:id` |
| `/rental/work-orders/:workOrderId` | `/cores/rental/work-orders/:workOrderId` |
| `/membership/personal/:customerId` | `/cores/rental/membership/personal/:customerId` |
| `/tenant/client-channel` | `/cores/rental/client-channel` |
| `/tenant/readiness` | `/cores/rental/readiness` |
| `/workbench` | `/cores/rental/workbench` |

## 通知与可选扩展

宿主使用 Rental 通知工厂供给原待办与内联工单操作，读取和操作同时核对当前登记页面使用权，Core 目录更新后重渲染 Provider。个人已读、稍后和归档按本人、租户及经营空间保存在本机，声音范围与同一公共 UI Provider 匹配。[通知供给](../../packages/rental-core/admin/browser-notifications/README.md)

原组合后台通过可选接点提供 Operator 与确认摘要。此独立入口按浏览器宿主默认配置呈现订单 AI 辅助的未装配状态，普通业务页与工单操作各自按实际权限运行。扩展输入从浏览器宿主和通知工厂的正式类型取得。

## 验证入口

必要类型检查覆盖独立入口、构建配置、公共壳接点、Rental 通知与页面贡献。Core 自身的类型入口直接复用公共包配置并包含浏览器通知。定向离线验证覆盖实际工厂、登记导航、会员与经营空间差异、同一缓存和声音范围、个人状态及工单修订与结果未知锁。内存构建核对真实页面、归档 JavaScript、公共 UI 和样式的编译闭包，使用的依赖映射、部署锁和安装包 fixture 随验证证据说明。浏览器、真实 HTTP、数据库、干净标准包安装与正式发布分别取得宿主证据。[Core 类型入口](../../packages/rental-core/admin/tsconfig.json)
