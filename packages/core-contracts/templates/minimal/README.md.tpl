# {{CORE_ID}}

由 Zelo 最小 Core 生成器创建，npm 包为 `{{PACKAGE_NAME}}`。依赖来源固定于 [底座提交 {{PLATFORM_SHA}}]({{PLATFORM_URL}}/packages/core-contracts/README.md)，具体版本、公开手册摘要与命名空间保存在 [core.scaffold.json](core.scaffold.json)。不依赖维护者的私有资料。

这是可编译、可生成标准包的开发骨架：已有列表读口、同源 HTTP/OpenAPI、页面贡献工厂和独立表迁移。真实存储/授权适配、Nest 挂载与页面组件须由开发者继续实现；未提供权威时不可用，没有默认账号、角色、业务 Seed、通配权限或 AI 工具。

## 准备与开发

在上述固定底座的独占开发工作区中，将 `{{TARGET}}` 显式加入根 `package.json` 的 `workspaces`，核对同版根锁文件后准备依赖。包里的 `@rental-os/core-contracts` 来自该工作区同一固定源码；不要把同名 npm 版本当作已发布公共包，也不要链接另一棵活动工作树的依赖或产物。生成器不修改根 workspace/锁、不安装依赖。

获得安装授权后，沿底座 npm 锁文件流程更新所选组合的锁并安装。准备完成后，在工作区根执行：

```sh
npm run build -w @rental-os/core-contracts
npm run lint -w {{PACKAGE_NAME}}
npm run build -w {{PACKAGE_NAME}}
node packages/core-contracts/dist/capabilities.js --repo {{TARGET}} --query ItemService --json
```

| 修改内容 | 入口与限制 |
| --- | --- |
| 业务字段 | [contracts](src/contracts.ts) 是唯一 schema；本样例只读前50条，查询不接收 tenantId |
| 服务/存储 | [service](src/service.ts) 要求真实 `ItemExecution`；授权与数据读取须同范围，返回前复核当前授权 |
| 绑定/就绪 | [server](src/server.ts) 消费宿主当前绑定与数据就绪权威，不伪造 ready |
| HTTP/API 文档 | [http](src/http.ts) 同源生成政策、处理器及 OpenAPI；宿主注册 Guard 政策，并将处理器挂载到同一方法/路径 |
| 后台页面 | [admin](src/admin.ts) 接收真实组件；在组件内复用平台 `CorePage`/`CoreList`/`useCoreRequest`，列表/详情/表单动作按业务继续实现 |
| 清单/迁移 | [manifest](src/manifest.ts)、[迁移](migrations/001-items.sql)；变更未发行迁移后同步 SHA-256，已应用迁移只能追加 |

服务读取只接受原宿主认证得到的 `CorePrincipal`。宿主必须核当前租户 Core 授权、成员分配、精确 `{{CORE_ID}}:item:read` 权限及对象范围，并保持原 Auth/Guard/事务机制。声明或登记权限不授予角色。API 成功正文由宿主包进原 `{ data, requestId }` 信封；异常沿原宿主映射为明确的拒绝或不可用。

已有可运行业务参考为同版[工单 Core]({{PLATFORM_URL}}/packages/example-tickets-core/README.md)、[API 宿主]({{PLATFORM_URL}}/apps/example-tickets-api/README.md)和[后台宿主]({{PLATFORM_URL}}/apps/example-tickets-admin/README.md)。只在明确允许的宿主装配位置登记贡献，不复制底座或改内部 Guard。

## 标准包

实现所需适配后，提交本 Core 源码并固定完整 SHA。`package.json.version` 与 `CORE_VERSION` 保持一致；以下命令中的 Core 仓库/提交属于本项目，不能用底座提交代替。第三个参数为创建本项目时同源的公开接入 README，按保存的摘要核验。

```sh
npm run pack:core -w {{PACKAGE_NAME}} -- <Core仓库HTTPS地址> <完整Core提交> <同源底座packages/core-contracts/README.md绝对路径> <已存在父目录中的新包.tgz>
```

打包复用正式 `corePackageFiles`、`inspectCorePackageFiles`、`renderCoreGuide` 和 `createCoreArchive`，只收集清单声明文件，拒绝覆盖既有包。不创建候选、不装配、不迁移、不授予权限。需要单独读取元数据时使用 `npm run metadata -w {{PACKAGE_NAME}} -- manifest <Core仓库HTTPS地址> <完整Core提交>` 或 `-- openapi`。

后续沿底座正式检查/准备入口执行，宿主版本来自所选固定发行：

```sh
node packages/core-contracts/dist/check.js <解包目录> --host <宿主版本JSON> --json
node packages/core-contracts/dist/prepare-install.js <新包.tgz> <SHA256> <既有独占待部署根目录> <宿主版本JSON>
```

静态检查成功仅说明文件与合同一致。独立交付还需完成真实持久化、页面操作、权限拒绝、部署准入、租户授权、成员分配及必要绑定；再核停用/重开保留数据和原撤权。迁移名称固定为 `core.{{CORE_ID}}.items.initial`，表名为 `{{TABLE}}`；迁移执行由获准环境处理。重复生成会拒绝已有目录和身份，不能用重生成代替版本升级。
