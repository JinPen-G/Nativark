# 公共平台与 Core 宿主

`@rental-os/platform-core-host` 把标准 Core 授权、绑定和 HTTP 接到真实公共身份、当前角色、有限数据库事务、订阅与审计。它不依赖 `apps/api`、Rental、shared 行业合同或生成的 Prisma 模型。具体 Core 和所需数据观察由宿主显式选择。[正式出口](package.json) · [公共身份服务](../platform-server/README.md) · [Core 合同](../core-contracts/README.md)

| 阅读路线 | 源码与职责 |
| --- | --- |
| 受控组合 | [应用工厂](src/platform-core-application.ts)、[Nest模块](src/core-host.module.ts)；一个实际工厂供给管理、本人目录和范围读取 |
| 真实依赖 | [窄端口](src/ports.ts)；公共主体仓储、同一SQL事务、新业务订阅政策及同事务审计 |
| 授权与绑定 | [授权](src/platform-core-management.ts)、[绑定](src/platform-core-bindings.ts)、[使用权](src/platform-core-access.ts)；复用当前主体、租户Core授权、成员分配与原绑定 |
| 当前读取 | [目录](src/platform-core-session.ts)、[范围](src/platform-core-scope.ts)、[管理事实](src/platform-core-management-reads.ts)；当前角色和修订在返回前复验 |
| HTTP和资料 | [准入与OpenAPI组合](src/platform-core-http.ts)、[业务粗准入](src/platform-core-http-access.ts)、[Controller](src/core-management.controller.ts)；政策/字段沿唯一合同，具体对象和提交点仍由所属Core核验 |
| 移除与审计 | [移除预检](src/platform-core-removal.ts)、[审计](src/platform-core-audit.ts)；缺平台依赖读取拒绝移除，原收据的引用同事务保存 |
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

`createEmptyCoreCatalogue()` 表示宿主明确选择零Core，返回空目录并拒绝所有Core准入。它不生成业务表、默认授权或可用数据。当前公共宿主已使用此组合，本人目录无需查询Core授权表即可返回合法空集合。选中Core须改用 `createCoreDeployedCatalogue` 并提供真实数据观察，不能继续用空目录或默认成功适配。[部署目录](../core-host/README.md)

标准管理流为注册 → SaaS授权租户 → 租户管理员分配成员 → 绑定 / 配置 → 普通业务。新Core不自动分配给所有成员，Core开通与业务角色分别核验。单Core停用保留成员记录、绑定、配置及原收据；重新开通按当前条件恢复，不重放初始化或业务。已撤回的成员分配不会随重开自动恢复。

身份围栏复用 [公共原会话](../platform-server/src/modules/platform/platform-principal.authority.ts)，锁原账号 / 角色 / 租户后进入Core锁。旧签名wid只作为原会话一致性证据；公共workspace为空，业务容器仍由Core自身解析。租户和成员撤权、角色变化、令牌到期及提交条件分别复验。原收据只读核对原主体/原键，不用当前状态代替原结果。

公共平台的授权与绑定迁移单份归 [公共宿主迁移链](../../apps/platform-api/README.md)，原SQL字节保留。这里不自动应用迁移；原组合库须按固定数据版本和部署顺序引入相同增量，不能使用新公共基线覆盖已有库。Core自身迁移继续归Core。[授权SQL](../../apps/platform-api/prisma/migrations/20261115010000_core_access/migration.sql) · [绑定SQL](../../apps/platform-api/prisma/migrations/20261115020000_core_bindings/migration.sql)

`createPlatformCoreOpenApi` 先组合标准平台管理 / 目录 / 范围资料，再调用原Core贡献检查；业务路径/schema保留各Core命名空间，缺引用或冲突拒绝。公共宿主通过同一 `/api/openapi.json` 返回组合资料；原Rental文档与客户端路径继续由其兼容装配维护。

本包已有类型、实际Nest容器、明确离线SQL下的授权/成员/绑定/收据与停用恢复证据。真实数据库、选中Core业务HTTP/页面、安装升级和完整独立接手仍按 [PCH](../../docs/平台底座/Core接入/平台Core接入-协作接续.md) 交付，不能将这些定向验证写成全部运行完成。
