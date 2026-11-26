# CRM API 宿主

本应用在组合层显式选择 `@rental-os/crm-core`，复用公共平台的身份、Guard、请求上下文、数据库、Core 准入与成员分配。CRM 业务、SQL、迁移和页面仍由独立 Core 包持有；公共底座不反向导入 CRM，也不依赖 Rental 数据。

## 入口与事务

- [main.ts](src/main.ts)读取进程指定的部署锁，检查 Node 与合同版本后启动 Nest；API 前缀为 `/api`。入口不读取环境文件，不执行迁移。
- [assembly.ts](src/assembly.ts)核对实际安装的完整标准包与公共数据基线，组合公共 Core 服务和 CRM。HTTP 绑定与 CRM 初始化使用同一个 `composePlatformCoreBindings` 实例，原 opaque 事务句柄经该实例解析；事务中的部署观察复用原连接。
- [app.module.ts](src/app.module.ts)连接公共 Auth/Guard、CRM HTTP、同源 OpenAPI 和权限目录。宿主仅登记清单中的权限元数据，不自动授予任何角色、租户或成员。
- [lifecycle.ts](src/lifecycle.ts)持有唯一数据库生命周期：停止接收新请求，等权限初始化、Guard 和完整处理器结束，HTTP 关闭后断库。客户端放弃响应不取消已派发的业务操作。
- [CRM Core](../../packages/crm-core/README.md)提供业务实现，[CRM 管理端](../crm-admin/README.md)提供独立 Web 装配。

当前宿主提供首次绑定、配置及原操作核对的装配。客户、线索、商机、自动化和 Agent 随对应 Core 切片实现；本入口尚未装配模型或后台执行器。租户 CRM 的公共 AI 范围和持久化参加者仍需接入，不可借用 Rental workspace 或另建模型网关。

## 固定材料与准备

宿主只接受一个租户范围的 `crm` Core，不接受额外 Core 或未装配的数据能力。部署须使用同一组固定材料：公共底座发行 JSON、完整 CRM 标准包、由二者生成的 `core.deployment.lock.json`。实际 npm 解析的 CRM 包须含清单声明的编译入口、后台源码、API 资料和原始迁移，并通过 `requireCorePackagePin` 完整摘要核验；仅有源码、版本号或单独的 `dist` 不足以启动。

先按[公开接入手册](../../packages/core-contracts/README.md)和[平台 API](../platform-api/README.md)准备固定公共包、公共数据库 Client 与依赖，再构建本宿主。`build` 仅编译本应用，不重建已核定的 CRM 包。标准 CRM 包的生成入口见其 README；应在独立准备目录安装和核验，不能覆盖正在使用的包字节来临时补齐材料。

```powershell
npm run build -w @rental-os/crm-api
node apps/crm-api/dist/prepare-deployment.js '<固定底座发行JSON>' '<完整CRM包目录>' '<新部署目录>'
```

[prepare-deployment.ts](src/prepare-deployment.ts)只在新的目标目录生成固定部署锁和公共＋CRM Prisma 迁移组合，不执行安装、迁移或数据库连接。生成目录是部署材料，尚未代表数据库已就绪。部署者须另行执行原受控迁移流程，并核定公共表、CRM 三表和迁移账。

## 启动与开通

环境值由部署方通过进程提供。`DATABASE_URL`、`AUTH_TOKEN_SECRET`、`CORE_DEPLOYMENT_LOCK` 必填；`API_PORT` 默认 `3000`，`TRUST_PROXY_HOPS` 默认 `0`，只接受范围内的十进制整数。`DATABASE_CONNECT_ON_START=true` 可显式提前连接，权限目录初始化本身也会访问数据库。`CORE_PACKAGE_STORAGE_ROOT` 指定公共包管理材料目录。

```powershell
$env:CORE_DEPLOYMENT_LOCK = 'C:\crm-host\prepared\core.deployment.lock.json'
npm run start -w @rental-os/crm-api
```

权限登记在启动时只执行一次，也可由部署者显式运行 `npm run register:permissions -w @rental-os/crm-api`。该命令核固定包并同步清单权限，结束时释放连接；它不授予角色、不迁移、不启用 CRM。

部署者完成真实数据库准备后，SaaS 管理者登记部署准入并给租户开通 CRM，租户管理者分配 CRM 成员及业务角色。首次绑定还要求操作者具备公共租户管理资格且本人已分配 CRM；日常配置另核 `crm:settings:manage`。授权收回、CRM 停用、修订冲突和未知结果均由原服务边界处理。未知结果只用原操作键核对收据，不能换键重发。

宿主挂接公共 Core 包管理 HTTP 和 OpenAPI，但默认组合未提供部署执行器或编译材料读取器，安装/升级执行保持不可用。可由受控组合通过 `CrmCorePackageOptions` 注入实际实现；不能将页面或接口存在当作升级链路已接通。完整发行打包、升级与恢复属于后续交付。

## 验证范围

源码类型检查使用现有离线入口，不加载启动文件、环境文件或真实数据库：

```powershell
node scripts/check-selected-prisma-types.cjs --deps '<已有 node_modules 绝对路径>' --mode platform --config apps/crm-api/tsconfig.json
```

Core 的 SQL、事务与绑定行为继续使用其现有内存测试。生命周期可用受控数据库/权限端口验证排空和失败行为，但这些证据不替代真实 Auth、MySQL、迁移、标准包启动或浏览器首次配置验收。本阶段没有独立运行包发布证据。
