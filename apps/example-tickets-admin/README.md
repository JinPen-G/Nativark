# 工单后台示范宿主

本应用将公共后台与一个标准工单 Core 组合。登录、设置、侧栏、面包屑、铃铛、休息、面板和页面主按钮都来自公共包；Core 只提供自己的四个页面。默认零 Core 的同源应用见[公共后台](../platform-admin/README.md)。

本宿主在原详情扩展位置选择[可选 AI 状态区](src/tickets-ai.tsx)，分别读取内置工单任务和外部MCP读取状态。未装配的API明确显示未配置；失败或刷新期间不继续显示旧“可用”。页面不自动创建任务、批准或执行，不把状态当权限。当前内置业务示例不调用模型，外部MCP的客户端模型由使用者自付；[完整接入与未验边界](../../packages/example-tickets-core/examples/ai-integration/README.md)分别说明。

选装AI宿主时，同一详情的[原任务操作](src/tickets-ai-task.tsx)依次提供准备工单事实、创建原任务、准备提案、人类批准/拒绝、明确执行及原结果核对。批准展示原标题、说明、受派成员与修订；批准完成不会自动执行。页面从`@rental-os/example-tickets-core/ai-http`读取与HTTP/OpenAPI同源的闭合合同，不加载服务端AI Runtime。

本标签的`sessionStorage`只保留按当前租户、用户和工单隔离的原操作/输入/Task/Run引用及待核对阶段；不保存工单正文、批准或凭据。刷新或重新进入只读取原结果，写请求关闭认证重发。存储不可用则停止新写入；当前身份/范围失效中止等待并拒绝迟到响应。原响应不明时继续保留引用，不由缺记录推导重试许可。业务收据确认与任务计量是否完整分别显示，普通工单动作仍沿原入口。

## 接入只看这三处

选装MCP标准包时，清单明确选择`dist-mcp/index-mcp.mjs`才注册“外部读取授权”页面。原登录用户在`/cores/example-tickets/mcp-authorization`核对注册客户端、回调及scope，明确同意后读取原grant，审核实际工单字段并绑定原目标，再返回原客户端。页面不注册客户端、不替租户发布、不自动批准/签发/重发，原用量与撤回沿同一授权记录读取。详情的MCP状态不猜测最近grant；持有明确grant的人工页才显示该对象的当前读取条件。[宿主配置](../example-tickets-api/README.md#启动与人工授权)

1. [main](src/main.tsx)取得工单页面贡献，调用 `registerCoreAdminPages`，将注册表和唯一会话交给 `createPlatformAdminApplication`。菜单、直接路由与面包屑共用该注册表，无须修改公共应用内部。
2. [工单页面](../../packages/example-tickets-core/admin/index.tsx)从 `@rental-os/platform-admin/core` 使用 `CorePage`、`useCoreForm`、`CoreList` 和 `useCoreRequest`。页面声明名称、权限、父级和操作，框架复用原设计与请求围栏。
3. [Vite配置](vite.config.ts)用 `CORE_DEPLOYMENT_LOCK` 核已准备标准包的标识、版本、固定来源和摘要，仅将核定清单交给前端。API 使用同一包与锁，[服务端说明](../example-tickets-api/README.md)负责数据库和授权步骤。

## 本地使用

在独立宿主中按服务端五步取得同一公共 Client、完整工单标准包、部署锁及已登记权限的独立 API。npm workspace 实际解析到 `packages/example-tickets-core`，该目录的完整声明文件来自同一待部署包，后端运行包也保留这份标准包。前端消费其 `admin`、`contracts`、`http` 正式出口，构建核清单与完整声明字节，缺 `core.manifest.json` 或摘要不符时给出错误。[服务端五步](../example-tickets-api/README.md#单工单的五步) · [实际包核验](vite.config.ts)

PowerShell 在当前进程选择与 API 相同的部署锁，再构建和启动后台。

```powershell
$env:CORE_DEPLOYMENT_LOCK = 'C:\my-host\prepared-tickets\core.deployment.lock.json'
npm run build -w @rental-os/example-tickets-admin
npm run dev -w @rental-os/example-tickets-admin
```

Bash 使用 `export CORE_DEPLOYMENT_LOCK=/my-host/prepared-tickets/core.deployment.lock.json`。开发端口由当前进程 `PORT` 指定，默认5177。`CORE_DEPLOYMENT_LOCK`由当前进程读取，`VITE_API_BASE_URL`默认 `/api`，开发 `API_PROXY_TARGET`指向同一工单 API。Vite沿[公共环境读取器](../../config/environment.cjs)处理公开白名单，部署 Web 供给同源 API 或受控反向代理。dev / build / lint 的前置沿本宿主 [package scripts](package.json)构建公共 core-host 及其依赖，所选包字节在组合前核验。

部署时先按服务端说明登记同一Core包的权限，并由当前 SaaS 管理者读回所选 Core 的部署准入与修订。初次业务以已核定的 `accepting` 状态进入，unknown 的具体读取和显式登记顺序见[服务端步骤](../example-tickets-api/README.md#登记授权与使用)。登录后，SaaS管理员在“租户 Core 授权”选择租户和工单Core开通；租户管理员在“角色权限”创建精确工单角色，在“人员管理”创建或编辑成员并选择角色，再到“成员 Core 分配”分配Core。管理员需给自己分配后再进入“工单设置”。设置完成后可按当前业务角色创建、分派、处理和关闭工单。没有成员分配时不会出现业务菜单，直接地址仍受当前授权与就绪检查；服务端继续复核每次业务请求。未知结果保留原操作键，只读取原收据。

## 验证入口

必要类型使用[现有内存类型入口](../../scripts/check-selected-prisma-types.cjs)的 `--mode platform --config apps/example-tickets-admin/tsconfig.json`，页面声明、保存和列表例子从[公开五步手册](../../packages/core-contracts/README.md#五步快速接入)及[工单四页](../../packages/example-tickets-core/admin/index.tsx)读取。源码声明和 fixture 构建、同包材料核验、真实安装与浏览器验收分别登记，API 原结果及权限拒绝证据沿[服务端验证入口](../example-tickets-api/README.md#验证入口与前置卡点)定位。
