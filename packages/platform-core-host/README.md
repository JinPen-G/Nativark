# 公共平台与 Core 宿主

`@rental-os/platform-core-host` 把标准 Core 授权、绑定和 HTTP 接到真实公共身份、当前角色、有限数据库事务、订阅与审计。它不依赖 `apps/api`、Rental、shared 行业合同或生成的 Prisma 模型。具体 Core 和所需数据观察由宿主显式选择。[正式出口](package.json) · [公共身份服务](../platform-server/README.md) · [Core 合同](../core-contracts/README.md)

| 阅读路线 | 源码与职责 |
| --- | --- |
| 受控组合 | [应用工厂](src/platform-core-application.ts)、[Nest模块](src/core-host.module.ts)；一个实际工厂供给管理、本人目录和范围读取 |
| 真实依赖 | [窄端口](src/ports.ts)；公共主体仓储、同一SQL事务、新业务订阅政策及同事务审计 |
| 授权与绑定 | [授权](src/platform-core-management.ts)、[绑定](src/platform-core-bindings.ts)、[使用权](src/platform-core-access.ts)；复用当前主体、租户Core授权、成员分配与原绑定 |
| 部署权限登记 | [登记函数](src/platform-core-permissions.ts)只消费所选Core清单及窄Permission事务；登记业务角色可选择的精确权限，保留原ID/关联，冲突先拒绝 |
| 当前读取 | [目录](src/platform-core-session.ts)、[范围](src/platform-core-scope.ts)、[管理事实](src/platform-core-management-reads.ts)；当前角色和修订在返回前复验 |
| HTTP和资料 | [准入与OpenAPI组合](src/platform-core-http.ts)、[业务粗准入](src/platform-core-http-access.ts)、[Controller](src/core-management.controller.ts)；政策/字段沿唯一合同，具体对象和提交点仍由所属Core核验 |
| Core包管理 | [公共装配](src/core-package-assembly.ts)、[提交意图审计](src/core-package-audit.ts)、[接口资料](src/core-packages/openapi.ts)供给发现、固定发行、包预检、候选及原结果读取 |
| 移除与审计 | [移除预检](src/platform-core-removal.ts)、[审计](src/platform-core-audit.ts)；缺平台依赖读取拒绝移除，原收据的引用同事务保存 |
| MySQL结构观察 | [不可变SQL预期](src/mysql-structure.ts)、[实际物理读取](src/mysql-physical.ts)；核表/列/默认值/键/CHECK/外键，缺数据保持不可用 |
| 直接消费者 | [公共宿主](../../apps/platform-api/src/core-assembly.ts)、[原组合兼容适配](../../apps/api/src/modules/core-host/README.md) |

```ts
import { composePlatformCoreApplication, createPlatformCoreHttpAccess, CoreHostModule } from "@rental-os/platform-core-host";

const application = composePlatformCoreApplication({
  database, users, term, audit, catalogue,
});
const coreModule = CoreHostModule.register({ useFactory: () => application });
const access = createPlatformCoreHttpAccess(application);
```

`database` 和 `users` 是宿主实际公共存储及当前身份，`term.requireNewBusiness` 消费真实统一订阅规则，`audit` 在同一事务保存关联，`catalogue` 是固定受控服务和真实物理 / 迁移观察的目录。字段从端口源码读取。Core 新增只在自己的包与宿主装配登记，不给公共Guard增加行业分支。Nest子模块须通过 imports/export 提供注入依赖；父模块的本地provider不会自动进入子模块。

SQL宿主通过 `deploymentForTransaction(tx)` 将同一固定目录的部署观察绑定到当前事务。授权、成员分配、初始化、业务范围与HTTP准入在持主体锁时复用该事务，不另占根连接；非SQL宿主仍可使用原可用性对象。实际组合见[Rental宿主](../../apps/rental-api/src/assembly.ts)与[单工单宿主](../../apps/example-tickets-api/src/assembly.ts)。

`createEmptyCoreCatalogue()` 表示宿主明确选择零Core，返回空目录并拒绝所有Core准入。它不生成业务表、默认授权或可用数据。当前公共宿主已使用此组合，本人目录无需查询Core授权表即可返回合法空集合。选中Core须改用 `createCoreDeployedCatalogue` 并提供真实数据观察，不能继续用空目录或默认成功适配。[部署目录](../core-host/README.md)

标准管理流为注册 → SaaS授权租户 → 租户管理员分配成员 → 绑定 / 配置 → 普通业务。新Core不自动分配给所有成员，Core开通与业务角色分别核验。单Core停用保留成员记录、绑定、配置及原收据；重新开通按当前条件恢复，不重放初始化或业务。已撤回的成员分配不会随重开自动恢复。

## 部署准入与存量切换

[部署准入服务](src/platform-core-admission.ts) 使用当前 SaaS 主体及 `system:tenant:manage` 管理同一公共数据库内的 Core 准入。`accepting` 允许继续按原授权检查普通业务，`stopped` 关闭新绑定、普通业务和新的任务准入；缺失、损坏或读失败是 `unknown`，拒绝新准入。三者都不代表物理数据就绪、租户授权或已经排空。原 [availability](../core-host/src/deployment.ts) 继续只核注册和实际数据；已派发结果、原收据和精确登记的善后仍由原对象与权限裁定。

管理端消费 [唯一 HTTP 合同](../core-contracts/src/management-http.ts) 的 `readAdmission`、`changeAdmission`、`readAdmissionOperation`。首次登记用 `expectedRevision: 0` 和唯一 `operationId` 明确提交目标状态；此后以当前修订做比较更新。应答未知只读原操作，后续状态已变化也返回原不可变收据，未观察到收据不证明未提交。停止、重开及首次登记都不修改租户授权、成员分配、绑定或业务数据，也不触发初始化。

状态复用原公共 `SystemParameterSet`：固定平台租户和 `core-deployment-admission:<coreId>` 模块，版本 1 是当前记录，后续版本保存不可变原收据。控制写先锁原管理主体与平台 Tenant，再锁当前记录；当前状态、原收据和 `OperationLog` 同事务提交。业务通过 [同事务 SQL reader](../core-host/src/mysql-deployment-admission.ts) 持当前记录共享锁直到原提交，不能用另一连接、缓存或进程变量代替。同库 replica 共用同一逻辑部署；升级的发行 SHA 不作为状态 key。原收据版本使用有符号 Int，达到上限拒绝写入，不回绕。

既有部署接入时按以下顺序进行，不能把缺行补成默认开放，也不能直接把尚未登记状态的宿主切到现有流量：

1. 保持原宿主处理现有业务，固定实际发行、已选择 Core、数据观察和原活动／主动停用依据。逐 Core 核定要保留的状态；单租户停用、订阅到期、进程停止或队列为空都不能代替部署状态。缺少可信依据时保留旧组合并核清，不批量停用现有租户。
2. 在同库受控候选中仅开放当前 SaaS 管理接点，由原管理身份逐 Core 登记明确状态，保存操作键并读回原收据及当前修订。已有记录按原状态和修订继续，禁止覆盖 `stopped` 或重放旧初始化。此步不需要新表、迁移或业务 seed。
3. 使用 [Rental 原授权对照与单项接管](../rental-core/README.md#历史与业务收尾) 核定原权限等价映射；保留已关闭授权、已撤回成员及原绑定，差异通过原受控事务处理。新 Core 继续按独立授权和初始化办理。
4. 核定 API、worker、AI 和前端均消费同一持久准入后再切换业务流量；各 Core 普通入口、原收据和收尾分别冒烟。旧进程未全部退出业务消费前，不能宣称部署停新已覆盖全部执行者。失败保留原组合和同一状态／操作记录，不能删记录或自动开放来回退。

会话目录投影当前准入及修订，保留原授权与权限配置；页面及缓存依此撤下普通业务。服务端仍在原事务复核，隐藏菜单不能代替门禁。真实 MySQL 锁等待、实际切换和业务运行须在部署环境按原权限验证。[持久状态回归](../core-host/test/deployment-admission.test.cjs)

成员分配沿公共人员管理的同一权限规则：租户管理员，或当前租户内具有全部数据范围及 `system:user:manage`（或原 `*`）权限的营运主体。会话目录、管理读取和写入均使用同一正式权限匹配函数，并保留原身份、租户锁及返回前复验；`core:rental:*` 等业务权限不能取得公共人员管理权。[公共权限规则](../platform-server/src/modules/platform/platform-permissions.ts) · [唯一匹配函数](../platform-server/src/permission-match.ts)

部署者在核定标准包并应用所选迁移后，显式调用 `registerPlatformCorePermissions(tx, manifests)`，`tx`须来自同一公共库的Serializable事务。它先核全部清单、重复Core与现存权限归属/类型，再登记 `${coreId}:${resource}:${action}`，供原权限树和角色接口消费；不会创建角色、授予成员、初始化Core或删除历史权限。兼容升级可更新声明名称并保留原权限ID/角色关系。不同模块或原BUTTON占用同码时停止，先核清来源。[工单部署命令](../../apps/example-tickets-api/src/register-permissions.ts)展示实际调用。

所选 Core 可通过第三参数提供固定 `CorePermissionRegistrationParticipant`，每项登记仍须唯一对应已核定清单中的权限声明。Rental 宿主使用 `registerPlatformCorePermissions(tx, manifests, [createRentalPermissionRegistrationParticipant()])`，从原业务声明提供旧码、名称、说明及 ACTION / BUTTON 类型。其他 Core 继续登记规范码。全部清单、参加者、重复码和历史归属在首项写入前核对，已存在的权限 ID 与模块保留。[Rental 参加者](../rental-core/src/public-management-compatibility.ts)

身份围栏复用 [公共原会话](../platform-server/src/modules/platform/platform-principal.authority.ts)，锁原账号 / 角色 / 租户后进入Core锁。旧签名wid只作为原会话一致性证据；公共workspace为空，业务容器仍由Core自身解析。租户和成员撤权、角色变化、令牌到期及提交条件分别复验。原收据只读核对原主体/原键，不用当前状态代替原结果。

公共平台的授权与绑定迁移单份归 [公共宿主迁移链](../../apps/platform-api/README.md)，原SQL字节保留。这里不自动应用迁移；原组合库须按固定数据版本和部署顺序引入相同增量，不能使用新公共基线覆盖已有库。Core自身迁移继续归Core。[授权SQL](../../apps/platform-api/prisma/migrations/20261115010000_core_access/migration.sql) · [绑定SQL](../../apps/platform-api/prisma/migrations/20261115020000_core_bindings/migration.sql)

公共宿主的 [数据计划](../../apps/platform-api/src/platform-data.ts) 核固定迁移摘要后提供 `readPhysical`，用于 `createMysqlCoreDeploymentObservation` 读取原Prisma账与实际结构。预期从已登记SQL构造，建表内与后续ALTER的外键共用同一解析，保留引用列和删除/更新规则；未知DDL明确报错。实际MySQL元数据须匹配，不能直接返回清单版本。CHECK保留布尔优先级/NULL/范围含义，额外唯一键或未执行约束不会被当成当前数据版本。 MySQL返回的已知字符集简单字面量可使用转义定界引号；读取器只还原这层格式，保留字面量值及ASCII/BINARY语义，内部未知转义仍拒绝。构造计划只读源码，真正的物理读取需要数据库许可。

结构解释器支持固定迁移使用的列与表注释、独立索引、列修改、默认值移除及 CHECK / 外键增删；引号内的逗号和分号保持原含义。CHECK 使用有限表达式解析，覆盖原 JSON、长度、正则、CAST 和范围约束，保留业务字符串大小写、BINARY 及混合 AND / OR 的优先级。MySQL 显示附加的 utf8mb4 修饰可以归一，DECIMAL 默认值因列精度补齐的小数位按精确字符串数值比较，例如 `0` 与 `0.00` 相同；不同数值、NULL、文本及 ENUM 默认值仍区分，不使用浮点运算。生成默认表达式中的业务字面量仍须精确匹配。未支持的函数、索引表达式、可执行 SQL 注释和数据回填均拒绝进入结构预期；数据回填及迁移账必须由对应部署方案另行核定。

文件、通知、作业及公共邮件数据沿公共宿主的同一迁移链维护，版本和摘要从数据计划读取。引用表名和列括号间的合法空格沿原SQL识别，约束语义及未知DDL拒绝保持。文件/上传两表保留原清理状态和键，缺列、错误外键或迁移摘要变化不能取得当前观察。标准部署准备消费同一完整迁移链，输出仍是待部署文件。[文件迁移](../../apps/platform-api/prisma/migrations/20261118010000_public_files/migration.sql)

所选Core在自己的迁移中给公共表追加外键时，宿主通过 `mysqlForeignKeyExtension(statement)` 解析固定SQL，再把结果交给 `createPublicPlatformDataPlan(extensions)`。`extendMysqlPublicForeignKeys` 返回新的预期，不修改公共基线；只接受已存在的公共列和唯一的约束名称。物理观察继续核对目标表/列、删除和更新规则，缺少约束或出现未声明约束均不就绪。Prisma关系源码沿[公共组合入口](../core-contracts/README.md#组合-prisma-源码)追加。

`createPlatformCoreOpenApi` 先组合标准平台管理 / 目录 / 范围资料，再调用原Core贡献检查；业务路径/schema保留各Core命名空间，缺引用或冲突拒绝。公共宿主通过同一 `/api/openapi.json` 返回组合资料；原Rental文档与客户端路径继续由其兼容装配维护。

## Core 包管理接入

`composePlatformCorePackageAssembly` 共用当前 Core 应用的 `database`、`users` 和 `catalogue`，由 `CorePackageAssemblyModule.register` 在同一 Nest 容器供给四组 Controller。通过 `createPlatformCorePackageAssemblyHttpAccess(packages, coreHttp)` 合并原 Core 准入，再交给唯一 `coreHttpProvider`。当前主体经过原签名 Guard 和应用事务复验，重复或未登记路径拒绝。[完整读取路线](src/core-packages/README.md)

宿主使用 `createPlatformCorePackageAudit<HostTransaction>()` 写入原 `operationLog` 事务。发行与候选发布前记录 `requested` 提交意图并复验当前主体，文件发布后的提交失应答或撤权沿原引用 / SHA 返回 `unknown`。发行引用与候选分别保存到 `storageDirectory/releases` 和 `storageDirectory/candidates`。根目录使用宿主配置的绝对路径，部署方须预先准备普通目录与服务账户访问权。[发行存储](src/core-package-selection/README.md) · [候选准备](src/core-package-preparation/README.md)

`localArtifacts` 供给已下载的固定包，`deployment` 供给实际活动组合、使用包和原迁移账，`materials` 供给该组合的完整原包与迁移。未供给的来源保留 `unavailable`。旧 API 兼容许可通过 `legacyApiRoutes` 从宿主可信策略按 Core ID 供给精确的 `METHOD /api/path` 集合，同一集合用于下载检查、预检、迁移组合和候选写入。请求与包清单的额外许可字段沿原严格 schema 拒绝。[预检端口](src/core-package-preflight/README.md)

配置 `storageDirectory` 时，本地包默认从 `archives/index.json` 的正式登记读取，归档位于同一普通目录。部署人员准备 `.tgz`、原完整发行投影和唯一引用，后台通过“使用已下载包”进入原校验链。首次成功读取固定本进程登记，原文件路径和字节每次复核；宿主显式提供 `localArtifacts` 时消费该来源。[登记与读取](src/core-package-preflight/README.md)

`createPublicCorePackageDeploymentSources` 为零 Core 标准底座读取启动锁及本地底座引用。宿主从当前运行入口固定底座根和六个服务端模块目录，读取器核当前 Node / 已加载合同版本，复用原发行检查及 `readPackageArtifacts` 核完整标准包，再核数据计划与锁定合同。版本读取委托原 `createMysqlCoreDeploymentObservation`，候选材料供给同一原迁移字节。缺证据、目录/源码差异及原账失败保留不可用，启动锁固定到本次进程。[源码](src/core-package-deployment.ts) · [默认宿主配置](../../apps/platform-api/README.md)

装配四组模块后，调用 `createPlatformCorePackageOpenApi(createPlatformCoreOpenApi(createPlatformOpenApi()))` 组合实际接口资料，路径或 schema 冲突立即拒绝。浏览器从正式协议子出口读取路径常量，五个 Web 宿主在 dev、build 和 lint 前构建本包，准备同版本运行时出口。[公共 API 装配](../../apps/platform-api/src/app.module.ts) · [页面接入](../platform-admin/src/features/core-packages/README.md)

纯 MySQL 数据计划从 `@rental-os/platform-core-host/mysql-structure` 与 `@rental-os/platform-core-host/mysql-physical` 消费结构解析和物理读取，两个窄出口直接对应原实现，类型与运行时出口保持同版本。[结构解析](src/mysql-structure.ts) · [物理读取](src/mysql-physical.ts)

本包已有类型、实际Nest容器、明确离线SQL下的授权/成员/绑定/收据与停用恢复证据。真实数据库、选中Core业务HTTP/页面、安装升级和完整独立接手尚未验收。
