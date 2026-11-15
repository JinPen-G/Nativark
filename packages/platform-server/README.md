# 公共 SaaS 服务

`@rental-os/platform-server` 是不依赖 Rental 的公共身份、会话与外观实现。宿主提供唯一持久化实例，公共服务不导入 Prisma 模型或具体 Core。原 API 路径通过本包窄子出口再导出，Rental 认证仍继承同一会话实现。[包与子出口](package.json) · [公共合同](../platform-contracts/README.md)

| 阅读步骤 | 源码与职责 |
| --- | --- |
| HTTP 与准入 | [模块](src/platform-server.module.ts)、[公共政策](src/platform-http-policy.ts)、[Guard](src/platform-auth.guard.ts)；未知方法/路径拒绝，行业 HTTP 由受控宿主显式供给 |
| 公共会话 | [公共认证](src/modules/auth/platform-auth.service.ts)、[共享会话算法](src/modules/auth/auth-session.service.ts)；原签名、失败保护、单次刷新和改密 |
| 身份存储 | [仓储](src/modules/platform/platform-identity.repository.ts)、[认证来源](src/modules/platform/platform-authentication.source.ts)、[窄存储端口](src/modules/platform/platform-auth-data-store.ts)；平台账号、角色和会话，业务表不进入端口 |
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

构建使用本包 `build`，类型使用本包 `lint`。已有 [登录保护](../../tests/auth-login-lockout.test.cjs)、[外观](../../tests/admin-appearance-settings.test.cjs) 和 [MCP 原审计](../../tests/mcp-original-audit.test.cjs) 保留；命令先核读写及隔离要求。[验证规则](../../AGENTS.md#修改验证与交付)

当前独立宿主已有认证、外观和健康 / 文档链，公共初始化、完整人员 / 角色 / 订阅 / 基础集成及 Core 主装配继续按 [PCH 接续](../../docs/平台底座/Core接入/平台Core接入-协作接续.md) 交付。类型及离线行为不等于真实数据库、HTTP、浏览器或部署通过。
