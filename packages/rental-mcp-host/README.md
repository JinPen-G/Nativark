# Rental MCP 宿主参加者

本包提供 Rental 的原 OAuth、Web 控制面、受控读取和事务审计组合。宿主显式选择 MCP 时，使用同一 Rental 认证、Guard、Native 数据库及 Core 准入来源。普通 Rental 和无 Core 公共宿主沿各自的构建入口运行。

## 接入顺序

1. 先准备所选 Rental＋AI 数据、固定部署锁及对应的 Prisma Client。这个包使用同一所选 Client 的声明与原事务。
2. 从 `@rental-os/rental-mcp-host` 取得 `createOriginalMcpHost`。它接收已声明的 MCP 服务配置、正式运输工厂和宿主的实际 Auth、空间管理、日志及原数据来源。
3. 在受控启动源码中实现 `bootstrapRentalAiMcp` 的 `createOriginalHost(host, dependencies)`，从 `host.rental.auth`、`host.guard` 和 `dependencies.database` 绑定当前实例。使用本包的原工厂返回同一个 MCP 总路由。
4. 宿主将该路由交给标准 Node HTTP 适配。原始流先进入 MCP 处理器，随后才进入 Nest 的 body parser、CORS 和普通业务链。退出时先等待 MCP 排空，再关闭 AI 和数据库。

配置、参数类型和来源由正式出口提供。可选的审查、MFA、工具发布、字段释放与计量来源按已有业务政策接入，原请求每次复验当前授权。启动与构建步骤见 [Rental 宿主说明](../../apps/rental-api/README.md#可选-mcp-http-参加者)。

## 源码路线

| 接点 | 正式入口与实现 | 职责 |
| --- | --- | --- |
| 总装配 | 根出口的 [createOriginalMcpHost](src/original-mcp-host.ts) | 固定同一 issuer、resource、scope 和互异路由，组合原控制面及统一关闭链 |
| OAuth 生命周期 | `/original-mcp-oauth-core` 的 [OAuth Core](src/original-mcp-oauth-core.ts) | 在同一 Native 数据库中维护 consent、grant、code、token 和原已完成读取计量 |
| 当前身份 | [浏览器主体](src/original-mcp-browser-identity.ts)、[grant 主体](src/original-mcp-grant-identity.ts)、[读取上下文](src/original-mcp-read-context.ts) | 复用原 Auth/ALS 与短租约，绑定当前主体、空间及原授权 |
| Core 与业务读取 | 根出口的 `createOriginalMcpCoreAccess`、`/original-mcp-catalog-read-tools` | 复验成员、绑定、期限、物理数据与部署停新，消费原 Guard 和业务字段来源 |
| Web 管理 | [grant](src/original-mcp-grant-control-plane.ts)、[admission](src/original-mcp-admission-control-plane.ts)、[review](src/original-mcp-review-control-plane.ts)、[subject](src/original-mcp-subject-control-plane.ts) | 按原 Web 身份办理当前租户/平台的授权、审查和主体管理 |
| 原目标与收据 | [catalog goal](src/original-mcp-catalog-goal-control-plane.ts)、[目标验证](src/original-mcp-catalog-goal-intent-authority.ts)、[目录资源](src/original-mcp-catalog-resources.ts) | 沿原操作、原修订与当前授权读取和推进目标 |
| 原请求保存与核对 | `/original-mcp-request-authority` 的 [资源权威](src/original-mcp-request-authority.ts)、`/original-mcp-request-participant` 的 [参加者](src/original-mcp-request-participant.ts)、`/original-mcp-request-save-audit` 的 [关联审计](src/original-mcp-request-save-audit.ts) | 在调用方同一 Native 内保存与审计；提交不明时只核对原键，不创建 Task 或重发操作 |
| 可用量与订单历史 | `/original-mcp-availability-read-authority` 的 [专属授权](src/original-mcp-availability-read-authority.ts)、`/original-mcp-availability-resources` 的 [库存事实](src/original-mcp-availability-resources.ts)、`/original-mcp-order-status-resources` 的 [订单资源](src/original-mcp-order-status-resources.ts) | 复验原 POST / GET Guard、scope、当前主体和同一事务；历史报价、检查、款项的缺项沿原投影表示 |
| 空间管理 | `/workspace-management` 的 [权威适配](src/workspace-management.ts) | 从宿主的真实账号仓储、空间投影与配置，在原事务复验管理范围 |
| 严格事务审计 | `/operation-log` 的 [OperationLogService](src/operation-log.service.ts) | 将原授权、请求、目标和绑定事件与原业务事实一并提交 |

旧组合宿主的 `apps/api/src/modules/auth/original-mcp-*.ts` 通过正式出口消费这些相同实现。运输、协议和 SQL 仓储继续由 [MCP 服务包](../mcp-server/README.md)提供，业务对象及最终裁定沿 [Rental Core](../rental-core/README.md)读取。

## 构建与验证

本包采用 NodeNext，保留正式 ESM 运输的加载方式。构建时沿宿主的 `RENTAL_PRISMA_CLIENT` 使用已生成的 Rental＋AI Client。包出口、依赖和前置链以 [package.json](package.json)与[所选编译器](../../scripts/build-selected-prisma.cjs)为准。

运行时复用宿主的数据库实例。审计中的 Prisma 引用仅用于所选 Client 的类型约束，原 `OPERATOR` 存储值保持一致，加载本包不会再载入默认生成 Client。

必要源码类型可以使用原内存入口检查。

```powershell
node scripts/check-selected-prisma-types.cjs --deps '已有node_modules的绝对目录' --mode rental-ai --config packages/rental-mcp-host/tsconfig.json
```

原行为入口包括 [Web consent](../../tests/mcp-web-consent.test.cjs)、[原事务审计](../../tests/mcp-original-audit.test.cjs)、[可信主体](../../tests/mcp-trusted-principal.test.cjs)与[空间管理](../../tests/mcp-workspace-management.test.cjs)。各入口的依赖、写入范围和清理方式见 [MCP 验证约定](../mcp-server/README.md#验证入口与证据范围)。实际启用组合还须核定所选 SQL、真实身份政策、TLS、代理和客户端运行。

本包的自有源码采用 MIT。分发时保留 [许可证](LICENSE)和所消费包的来源声明。
