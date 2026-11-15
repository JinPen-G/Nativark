# 工单后台示范宿主

本应用将公共后台与一个标准工单 Core 组合。登录、设置、侧栏、面包屑、铃铛、休息、面板和页面主按钮都来自公共包；Core 只提供自己的四个页面。默认零 Core 的同源应用见[公共后台](../platform-admin/README.md)。

## 接入只看这三处

1. [main](src/main.tsx)取得工单页面贡献，调用 `registerCoreAdminPages`，将注册表和唯一会话交给 `createPlatformAdminApplication`。菜单、直接路由与面包屑共用该注册表，无须修改公共应用内部。
2. [工单页面](../../packages/example-tickets-core/admin/index.tsx)从 `@rental-os/platform-admin/core` 使用 `CorePage`、`useCoreForm`、`CoreList` 和 `useCoreRequest`。页面声明名称、权限、父级和操作，框架复用原设计与请求围栏。
3. [Vite配置](vite.config.ts)用 `CORE_DEPLOYMENT_LOCK` 核已准备标准包的标识、版本、固定来源和摘要，仅将核定清单交给前端。API 使用同一包与锁，[服务端说明](../example-tickets-api/README.md)负责数据库和授权步骤。

## 本地使用

先在独立检出中按根锁文件准备依赖，按服务端说明准备并安装所选工单标准包、部署锁与数据库。源码工作区只有编译入口时还不是标准包；缺少 `core.manifest.json` 或摘要不符会停止构建，应重新核对包和锁。

PowerShell 在当前进程选择与 API 相同的部署锁，再构建和启动后台。

```powershell
$env:CORE_DEPLOYMENT_LOCK = 'C:\my-host\core-deployment.json'
npm run build:example-tickets-admin
npm run dev:example-tickets-admin
```

Bash 使用 `export CORE_DEPLOYMENT_LOCK=/my-host/core-deployment.json`。开发端口5177，API代理沿原公共环境白名单配置。

登录后，SaaS管理员在“租户 Core 授权”选择租户和工单Core开通；租户管理员在“成员 Core 分配”选择成员分配Core。业务角色另经角色接口办理，完整角色编辑UI继续交付。管理员需给自己分配后再进入“工单设置”。设置完成后可按当前业务角色创建、分派、处理和关闭工单。没有成员分配时不会出现业务菜单，直接地址仍受当前授权与就绪检查；服务端继续复核每次业务请求。未知结果保留原操作键，只读取原收据。

本片已做类型、内存构建和声明路由/权限过滤验证。构建验证显式使用清单 fixture，尚未验证磁盘标准包安装、真实 HTTP/数据库、浏览器或完整公共管理。证据和剩余项见[开发记录](../../docs/平台底座/Core接入/平台Core接入-开发记录.md#core-tickets-admin-host-20261115)。
