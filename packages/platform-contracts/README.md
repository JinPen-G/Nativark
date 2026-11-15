# 公共 SaaS 契约

`@rental-os/platform-contracts` 提供租户、账号、角色、认证、公共设置及原SaaS订阅的正式类型和运行时常量。此包没有运行依赖，不加载 Core、ORM 或 Web 框架。[唯一源码](src/index.ts) · [订阅合同](src/subscription.ts) · [包出口](package.json)

```ts
import { TenantStatus, type PlatformSessionContextResponse } from "@rental-os/platform-contracts";
```

原 `@rental-os/shared` 和 `@rental-os/shared/platform` 再导出同一声明，保留 Rental 与各端既有导入。新增公共消费者使用本包，行业字段继续由所属 Core 契约扩展。[原兼容出口](../shared/src/platform-identity.ts)

订阅可从 `@rental-os/platform-contracts/subscription` 单独导入。原 `@rental-os/shared` 继续再导出同一枚举和字段，基础版/PRO、统一期限、金额可空及原请求语义沿SUB专项。Core开通、成员分配和业务权限不由套餐字段代替。

服务端通过 `@rental-os/platform-contracts/request-fingerprint` 使用原确定性 SHA-256 算法。平台审计、文件绑定和 Core 幂等共用这一实现，原 API 路径转接同一函数。该 Node 子出口按需加载，根合同继续用于浏览器及业务类型消费。[指纹源码](src/request-fingerprint.ts) · [原 API 接点](../../apps/api/src/common/request-fingerprint.ts)

阅读时从正式类型到 [公共服务](../platform-server/README.md)，再到 [公共宿主](../../apps/platform-api/README.md)。`PlatformTenantSummary.enabledBusinessLines` 是兼容字段，公共身份返回空集合；实际 Core 使用权从当前部署、租户授权及成员分配读取。租户、角色或公共文档存在不会赋予业务工具权限。

构建使用 `npm run build -w @rental-os/platform-contracts`，类型检查使用本包 `lint`。字段变化须核原 shared 出口、生产者、HTTP DTO / OpenAPI 及直接消费者，按 [项目规则](../../AGENTS.md#业务与安全边界) 保存兼容与验证证据。
