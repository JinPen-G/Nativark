# 公共 SaaS 服务

`@rental-os/platform-server` 是不依赖 Rental 的公共身份、会话、租户 / 人员角色管理与外观实现。宿主提供唯一持久化实例，公共服务不导入 Prisma 模型或具体 Core。原 API 路径通过本包窄子出口再导出，Rental 认证仍继承同一会话实现。[包与子出口](package.json) · [公共合同](../platform-contracts/README.md)

| 阅读步骤 | 源码与职责 |
| --- | --- |
| HTTP 与准入 | [模块](src/platform-server.module.ts)、[公共政策](src/platform-http-policy.ts)、[Guard](src/platform-auth.guard.ts)；未知方法/路径拒绝，行业 HTTP 由受控宿主显式供给 |
| 公共会话 | [公共认证](src/modules/auth/platform-auth.service.ts)、[共享会话算法](src/modules/auth/auth-session.service.ts)；原签名、失败保护、单次刷新和改密 |
| 身份存储 | [仓储](src/modules/platform/platform-identity.repository.ts)、[认证来源](src/modules/platform/platform-authentication.source.ts)、[窄存储端口](src/modules/platform/platform-auth-data-store.ts)；平台账号、角色和会话，业务表不进入端口 |
| 公共管理 | [应用服务](src/modules/platform/platform-management.service.ts)、[仓储](src/modules/platform/platform-management.repository.ts)、[存储端口](src/modules/platform/platform-management.store.ts)、[主体围栏](src/modules/platform/platform-principal.authority.ts)；SaaS与租户管理分开，当前原会话 / 角色在同事务复验 |
| 部署初始化 | [公共初始化](src/modules/platform/platform-initialization.ts)；首次创建SaaS主体，重复执行不重置账号，不运行Core初始化 |
| 统一期限 | [只读来源](src/modules/subscription/subscription-reader.ts)、[同源状态投影](src/modules/subscription/subscription-state.ts)、[周年/时区](src/modules/subscription/subscription-term.ts)；当前期限与排期，原Rental服务和新Core共同消费 |
| 公共设置 | [租户外观](src/modules/client/tenant-appearance-profile.service.ts)、[本人外观](src/modules/client/account-appearance.service.ts)、[存储端口](src/modules/platform/platform-appearance-data-store.ts)；修订冲突、省略与清空沿原语义 |
| 接口资料与响应 | [OpenAPI](src/platform-openapi.ts)、[响应信封](src/common/request-id.interceptor.ts)；同一公共政策生成接口资料，信封保持 `data` / `requestId` |
| 直接消费者 | [无 Core 宿主](../../apps/platform-api/README.md)、[Rental 兼容认证](../../apps/api/src/modules/auth/README.md) |

公共 HTTP 清单、访问类别、权限和文档来自同一份政策。构建后执行 `npm run api:document:platform` 输出同版本 OpenAPI JSON；此命令不启动服务、不读环境文件或数据库。HTTP 文档也由宿主在 `/api/openapi.json` 提供。接口存在不代表 Core 工具已发布或当前主体有业务权限。

```ts
import { PlatformServerModule } from "@rental-os/platform-server";

// database 是宿主真实公共存储，不是默认成功或行业数据库替身。
const platform = PlatformServerModule.register({
  imports: [PublicDatabaseModule],
  inject: [PublicDatabase],
  useFactory: (database: PublicDatabase) => database,
});
```

注册时公共认证与外观指向同一实例。HTTP 中间件使用 [同一个 ALS](src/common/request-identity.ts)，公共新会话不签发业务空间。保留旧 `wid` 的有效签名仍须与原会话一致；进入公共面不从旧 ID 恢复业务权限。Rental 专属范围继续由原认证适配解析。

登录、刷新与改密沿原认证算法；刷新旧会话的撤销与新会话创建同事务，改密和会话撤销同事务。租户外观权限沿 `system:integration:manage`，本人外观仅取当前签名主体；SaaS 身份不能借公共设置接口代替租户操作。旧品牌读取由 Rental 组合另外注入，公共服务不查询客户端业务表。

公共管理使用原 `system:tenant:manage/bootstrap`、`system:user:manage` 与 `system:role:manage`。租户成员管理还要求当前租户管理员或明确全租户数据范围；固定全权角色和SaaS身份不能经普通角色输入创建。权限码须已登记，角色不自动赋予Core使用权。管理员创建、状态与密码重置、权限修改和对应审计同事务，唯一键 / 事务冲突明确返回，错误不重做。本人资料只改姓名和联系方式。

`readPublicSubscriptionTerm(transaction, tenantId)` 在调用方原事务读取当前统一期限和已到生效点的排期，不物化排期、不新建订阅。明确到期拒绝新业务；历史未登记状态保持原“待确认”的兼容，不因此视为永久或批量停业。原订阅办理继续消费相同状态/周年算法，金额、收费和已发布功能规则由原SUB实现裁定。此入口不赋予Core使用权或绕过冻结。

构建使用本包 `build`，类型使用本包 `lint`。已有 [登录保护](../../tests/auth-login-lockout.test.cjs)、[外观](../../tests/admin-appearance-settings.test.cjs) 和 [MCP 原审计](../../tests/mcp-original-audit.test.cjs) 保留；命令先核读写及隔离要求。[验证规则](../../AGENTS.md#修改验证与交付)

当前独立宿主已有公共初始化、认证、人员 / 角色 / 租户管理、外观和健康 / 文档链，订阅 / 基础集成及 Core 主装配继续按 [PCH 接续](../../docs/平台底座/Core接入/平台Core接入-协作接续.md) 交付。类型及离线行为不等于真实数据库、HTTP、浏览器或部署通过。
