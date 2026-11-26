# CRM 管理端宿主

本应用只选择独立 CRM Core。登录、公共设置、侧栏、面包屑、主题、会话、HTTP 客户端和查询缓存由 `@rental-os/platform-admin` 提供，CRM 配置页从 `@rental-os/crm-core/admin` 装配。业务规则与授权仍由 CRM API 和公共身份服务裁定。

## 装配入口

- [main.tsx](src/main.tsx)：注册 CRM 页面贡献，并创建唯一公共浏览器会话与后台应用。当前 Core 提供 `/cores/crm/settings` 配置页；宿主不复制页面或业务实现。
- [vite.config.ts](vite.config.ts)：读取显式部署锁，经 `requireCorePackagePin` 核对实际安装标准包的身份、版本、源码来源及完整摘要，再把清单交给前端。仅接受一个 `crm` Core，拒绝其他 Core 和未接入的数据能力；同时确认 npm 的后台正式出口就是清单声明入口。
- [CRM 页面](../../packages/crm-core/admin/index.tsx)：首次绑定、日常设置与原操作核对的唯一呈现。公共页面接入和会话约束见[平台 SDK](../../packages/platform-admin/src/core/README.md)。

## 构建与运行

先按 [CRM API](../crm-api/README.md) 准备同一标准包、部署锁及实际数据库和授权。npm 解析的 `@rental-os/crm-core` 必须是该固定完整包，含 `core.manifest.json`、编译产物、后台入口、资料及迁移；只构建源码或仅有相同版本号不满足完整包校验。不要覆盖正在使用的源码目录来补齐包材料。

在已准备依赖和固定材料的宿主中，使用当前进程变量选择与 API 相同的锁和地址：

```powershell
$env:CORE_DEPLOYMENT_LOCK = 'C:\crm-host\prepared\core.deployment.lock.json'
$env:API_PROXY_TARGET = 'http://127.0.0.1:3000'
npm run build -w @rental-os/crm-admin
npm run dev -w @rental-os/crm-admin
```

`CORE_DEPLOYMENT_LOCK` 为构建必填，不进入浏览器。`PORT` 默认 `5180`；`VITE_API_BASE_URL` 默认 `/api`；开发代理由 `API_PROXY_TARGET` 指向同一 CRM API。部署 Web 使用同源 API 或受控反向代理。环境加载复用[公共读取器](../../config/environment.cjs)的公开字段白名单，正常 dev/build 会读取项目环境文件；`ai-offline` 模式关闭此环境文件读取，但仍要求真实固定包和锁。

`predev/prebuild/prelint` 会构建公共 Core 宿主依赖；`build` 还会生成 Web 产物。运行前应核对本应用 [package scripts](package.json)，这些命令不负责安装、迁移或启用生产功能。

完成服务端准备后，依次由 SaaS 管理者登记部署准入并开通租户 CRM，由租户管理者分配 CRM 成员和业务角色。首次绑定要求租户管理者本人也有 CRM 成员分配；日常维护要求 `crm:settings:manage`。未分配时菜单与直接地址均受公共会话目录限制，服务端对每个操作重新核权。未知结果保留原操作键，仅通过原收据核对。

本入口当前装配 CRM 配置页。Agent 页面、持续执行和对应宿主能力属于后续明确实现范围；导入后台或注册页面不会启用模型、后台任务或自动外发。

## 验证入口

离线源码类型检查复用现有入口，不加载 Vite 配置、不读取环境文件、不启动服务或生成磁盘产物：

```powershell
node scripts/check-selected-prisma-types.cjs --deps '<已有 node_modules 绝对路径>' --mode platform --config apps/crm-admin/tsconfig.json
```

类型检查不能代替固定标准包字节检查、实际 Web 构建、浏览器登录、首次绑定和保存验收。实际宿主还需覆盖缺包/错锁拒绝、无成员分配、无设置权限、切换身份、停止 CRM 新业务、原操作收据恢复，以及与公共后台共存的路径。
