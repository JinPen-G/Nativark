# 公共字典、编号与筛选预设

本模块持有原租户字典维护、编号规则维护和取号实现。公共宿主通过原会话、当前租户及两个原工具权限访问，原 Rental 组合通过薄适配消费同一服务与纯逻辑。数据继续保存在原 `SystemParameterSet`，合同使用平台合同包的原正式类型。[合同](../../../../platform-contracts/src/index.ts) · [公共身份围栏](../platform/platform-principal.authority.ts)

## 调用链

| 入口 | 职责与消费者 |
| --- | --- |
| [正式模块出口](index.ts) | 服务、Controller、存储类型、HTTP 声明与原格式函数 |
| [Controller](platform-tools.controller.ts) | 原五个 HTTP 操作，路径编码覆盖请求体编码 |
| [DTO](platform-tools.dto.ts) | 原四个请求类，保持嵌套字典项、日期、周期和数值校验 |
| [服务](platform-tools.service.ts) | 原主体授权、当前租户读写、取号、提交前复验及同事务审计 |
| [仓储](platform-tools.repository.ts) | 当前租户的最高生效版本，保留历史、草稿及其他 JSON 字段 |
| [私有存储端口](platform-tools.store.ts) | 原身份、配置和审计操作，由宿主同一数据库实现 |
| [原纯逻辑](platform-tools.values.ts) | 字典正规化、规则正规化、格式与递增，供原演示内存分支消费 |
| [HTTP 政策](platform-tools-http-policy.ts) | 两个原权限、五个原路径及租户 audience 边界 |
| [OpenAPI 字段](platform-tools-openapi.ts) | 宿主组合需要的请求与响应 schema |

原 [PlatformService](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/platform/platform.service.ts) 的 MySQL 分支委托五个同名公共方法。`listDictionaries(defaults?)` 与 `listNumberRules(defaults?)` 允许可信 Rental 适配传入原默认资料，其他方法的原请求及结果保持。原 [Controller](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/platform/platform.controller.ts) 保留窄入口，独立公共宿主注册本模块 Controller，各组合按实际装配选择唯一 HTTP 执行者。宿主通过原 `PLATFORM_AUTH_DATA_STORE` 注入相同数据库。[公共页面](../../../../platform-admin/src/features/platform-tools/README.md)

原三个默认字典和五条默认编号含租赁业务语义，继续留在 Rental 适配及初始化来源。零 Core 公共缺省为空。仓库搜索中，五个方法的业务入口均经原平台 Controller，未发现 Rental 订单或合同服务调用此取号器。现有业务自己的编号算法继续由原领域负责。[原默认资料](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/platform/platform.service.ts) · [原初始化](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/prisma/seed.ts)

## 范围、原子性与历史

字典使用 `system:dictionary:manage`，编号使用 `system:number-rule:manage`。租户管理员及原有效通配权限沿原授权生效，SaaS 账号拒绝租户工具。原 Guard 对这两类配置没有另设 `all` 或全部地点门槛，公共服务保留对应工具权限在当前租户内的语义。当前账号、角色、会话、租户状态及签名范围由公共主体围栏在事务中核对。[原 Guard](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/common/api-auth.guard.ts)

每次操作采用 Serializable 事务，先锁原 Tenant 父记录，再沿原公共身份围栏锁定和复验账号、会话、角色及权限。取号、规则保存、配置写入与审计共用此事务。取号递增在锁内读取最新序列，保存省略当前流水时同样在锁内保留原值。审计失败、提交前撤权、配置版本/状态变化和数据库冲突均使本事务失败，调用方重新读取核对，取号失败后是否已提交沿原结果处理。

读取显式包含当前租户、原 module 和 `EFFECTIVE`，按 `versionNo` 降序。写入使用读取到的生效行 id、租户、module、版本及状态匹配，保留其他 JSON 字段。没有生效行时在已有最大版本之后创建生效记录，保留同键草稿。历史 JSON null 和缺字段沿原缺省读取，无法核对的结构拒绝。原规则编码、序列、启停、审计动作和字段保留，保存先正规化编码再查现有规则，防止空格或大小写造成序号回退。

格式保持原前缀、连字符、日期和 `padStart` 算法，日期使用宿主本地时间。`resetCycle` 沿原行为保存，取号连续递增。安全整数边界在递增前拒绝，避免 JavaScript 精度造成重复流水。显式提交 `currentSequence` 继续沿原维护合同处理，页面省略未提供编辑控件的该字段，防止旧页面快照覆盖新取号结果。

## 验证入口

定向验证复用原离线守卫、类型检查器和主体/事务 fixture，通过短 stdin 执行，临时目录集中到本树 `output/.tmp` 并由退出清理释放。正常与拒绝范围覆盖当前租户、原格式、正规化、并发递增、规则保存、历史生效行/草稿/JSON、审计与撤权回滚、DTO 及 HTTP 声明。[项目验证规则](../../../../../AGENTS.md#修改验证与交付)

fixture 中的事务与锁用于验证参加者调用及提交边界。真实 MySQL 锁竞争、HTTP、浏览器和完整组合运行由专项原验收入口接续。[当前专项入口](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)

## 筛选预设

筛选预设保存当前租户的 UI 筛选偏好。原已登录运营账号可访问，SaaS 账号沿原 Guard 条件拒绝。数据使用公共 schema 中既有的 `FilterPreset`，租户内共享预设，原名称唯一键为 `tenantId/scopeKey/name`。预设内容由消费页面解释，业务读取继续经过对应接口的原权限和范围检查。[原 Guard](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/common/api-auth.guard.ts) · [公共模型](../../../../../apps/platform-api/prisma/schema.prisma)

| 入口 | 职责 |
| --- | --- |
| [Controller](filter-presets.controller.ts) | 原 GET/POST 集合、PUT 默认与 DELETE 单条路径 |
| [DTO](filter-presets.dto.ts) | 原保存字段及可选 operator 校验，使用正式平台合同 |
| [服务](filter-presets.service.ts) | 当前 operator 主体、同租户规范化、提交前复验及审计 |
| [仓储](filter-presets.repository.ts) | 默认优先/更新时间排序、原 ID 与名称唯一键、同 scope 清默认及删除 |
| [存储端口](filter-presets.store.ts) | 原身份、真实 FilterPreset 操作与同事务 OperationLog，由宿主数据库实现 |
| [HTTP 声明](filter-presets-http-policy.ts) | 四个原路径、self 准入和实际参数位置 |
| [OpenAPI 字段](filter-presets-openapi.ts) | 原 DTO、返回投影及删除结果，供宿主组合 |

服务强制使用当前主体的租户，查询和保存中的 `tenantId` 按原普通租户分支覆盖。单条读写都限定原 ID 与该租户。同名保存命中原唯一键并保留 ID，传入 ID 不存在时拒绝。名称去首尾空格后为 1 至 40 字符，description 去空白，filters 沿原 JSON 克隆，isDefault 转为布尔值。保存的 operator 去空白后使用当前显示名或原“营运端”缺省，默认和删除操作沿原 operator 回退规则。原 orders、vehicles、members、corporates、stations、vehicle-transfer 六个 `rental-os.*` scope 保持；新 scope 必须由受控宿主源码登记。未登记的 contracts 等历史值仍可随原行读取，默认与删除按原 scope 操作，不据此新增写入范围。[正式合同](../../../../platform-contracts/src/index.ts)

每次调用复用公共主体围栏，先锁原 Tenant、账号、会话和角色，在同一 Serializable 事务内执行预设操作和原审计动作，并在返回前复验主体。保存默认和设为默认仅清除同租户同 scope 的默认标记。历史 JSON 为 null、数组或标量时，返回投影沿原仓储表示为空 filters 对象，其他原字段保持。原审计动作及 detail 字段保留，新增可信主体 userId。原仓储的事务外日志与默认/删除前读合入该事务，审计失败、撤权或数据库冲突均整体失败。唯一名称和事务冲突返回可重读核对的 Conflict，服务每次调用执行一次事务。

### 宿主接入

宿主将 `PlatformFilterPresetDatabase` 合入同一公共数据库端口，沿已有 `PLATFORM_AUTH_DATA_STORE` 注入实例，并注册 `PlatformFilterPresetService` 与 `PlatformFilterPresetController`。原组合的 `PlatformService` MySQL 分支经 `PlatformRepository` 将四个同名方法委托给该实例，原演示内存适配继续由原宿主管理。原根模块登记唯一公共服务，使用同一 `PrismaService`，各组合选择一个实际 HTTP Controller，保留原客户端入口。[公共装配](../../platform-server.module.ts) · [原根装配](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/application-services.module.ts) · [原平台服务](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/platform/platform.service.ts) · [实际客户端](../../../../platform-admin/src/features/platform-tools/client.ts)

公共政策聚合合入 `PLATFORM_FILTER_PRESET_HTTP_OPERATIONS`，正式 tools 出口暴露服务、Controller、DTO、存储类型、受控登记和 OpenAPI 工厂。四个原操作和新增范围目录都使用原自助 `self`，服务继续核当前 operator 会话并拒绝 SaaS 身份。公共 Guard 的默认拒绝要求方法和路径准确登记。原组合保留 filter-presets 的已登录自助白名单，独立宿主经同一 Guard/ALS 与公共主体围栏进入。[公共政策](../../platform-http-policy.ts) · [公共 Guard](../../platform-auth.guard.ts) · [现有模块出口](index.ts)

新 Core 用两个步骤复用预设，无需修改底座内部：

1. Core 导出固定声明，例如 `{ coreId: "example-tickets", scopes: ["example-tickets.tickets"] }`。宿主可信组合文件直接导入，通过 `PlatformServerModule.register({ ..., filterPresetContributions: [contribution] })` 传入。每个 Core 只登记一次，scope 必须位于自己的 `coreId.` 命名空间，重复、越界和历史命名空间冒用均在装配时拒绝。未传贡献时只保留原六范围。
2. Core 页面以同一个常量调用公共 `saveFilterPreset` / `filterPresets`。自行组合接口文档时，传同一贡献给 `createPlatformOpenApi({ filterPresetContributions: [contribution] })`；缺省公共文档由模块自动同源生成。公共工具页通过 GET `/platform/filter-presets/scopes` 读取真实登记列表，用原选择器展示；范围读取失败沿原 QueryState 显示并允许显式重读，不回退任意客户端白名单。

[工单声明](../../../../example-tickets-core/src/server.ts)与[实际工单宿主](../../../../../apps/example-tickets-api/src/app.module.ts)提供完整装配例子。登记只提供租户内共享 UI 偏好，不注册业务路由、不授予 Core/成员权限，也不能读取业务数据；业务页面的实际查询仍走各自原授权。停用或移除贡献不会删除历史预设；无 scope 的列表、按原 ID 设默认和删除继续保留历史处理语义。

GET `/platform/filter-presets` 的 tenantId/scopeKey 在 query。POST 同路径使用保存 DTO。PUT `/platform/filter-presets/:id/default` 的可选 operator 在 body。DELETE `/platform/filter-presets/:id` 的可选 operator 在 query，返回原 id/deleted。公共与原组合均消费同一服务；原 MySQL 适配缺少该服务时明确拒绝，不回退到演示内存。

实际后台客户端复用这四条路径，默认和删除对原 ID 编码，operator 分别进入 body 与 query。三个写方法均沿原客户端设置 `retryAuthentication: false`，读取继续支持原会话刷新。工具页的预设管理沿已登录租户身份，页面导航继续沿原工具可见条件。[页面](../../../../platform-admin/src/features/platform-tools/PlatformToolsPage.tsx) · [可见条件](../../../../platform-admin/src/features/platform-tools/platformToolsAccess.ts)

定向验证使用原源码加载器、公共主体/事务的明确内存 fixture 和短 stdin，核原算法、当前租户、真实 DTO/Controller 元数据与失败回滚。必要类型沿所选公共 40 模型的原检查器，同时核真实 PrismaClient/TransactionClient 对存储端口的赋值。真实 MySQL 锁竞争、已部署 HTTP 与原页面交互分别沿实际宿主验收。[源码加载器](../../../../../scripts/controller-sources.cjs) · [所选类型检查器](../../../../../scripts/check-selected-prisma-types.cjs)
