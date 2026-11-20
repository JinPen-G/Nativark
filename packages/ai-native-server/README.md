# AI Native 服务端

本包承接原 AI Native 的请求工厂、Runtime、任务仓储、唯一 Gateway、模型财务账、知识与正文保留，以及 Rental 业务失败出箱参加者。旧入口再导出同一实现，宿主使用同一身份、Core、文件权威和数据库；状态机、工具发布、批准、金额规则与原结果语义沿原合同。导入和构造不发起模型请求或数据库连接。

完整原组合从 [服务装配](../../apps/api/src/application-services.module.ts)和 [兼容别名](../../apps/api/src/ai-native-legacy.providers.ts)提供同一服务实例。独立宿主的实际开放能力随其正式装配核定，工具描述和类型存在不代表已授权。

## 入口与调用方

| 入口 | 职责与边界 |
| --- | --- |
| [runtime/ai-native-application.providers](src/runtime/ai-native-application.providers.ts) | 原请求与服务工厂的装配入口。宿主提供同一公共身份、Core、文件和数据库实例，当前权限及真实依赖决定可用性。 |
| [runtime/rental-adapters](src/runtime/rental-adapters/prisma.service.ts) | 旧类令牌与窄类型接点，宿主通过 useExisting 绑定同一实例。 |
| [runtime/task-transaction-authority](src/runtime/task-transaction-authority.ts) | 原任务事务内复验当前主体与原对象；已派发结果沿原 lease、dispatch token、收据和 CAS 收口。 |
| [runtime/task-provider-dispatch](src/runtime/task-provider-dispatch.ts) | Vault 等待后、唯一模型运输前核对当前任务权威，外部请求位于短事务之外。 |
| [runtime/privacy/prisma-ai-body-storage](src/runtime/privacy/prisma-ai-body-storage.ts) | 沿所选 Client、原密文和同一事务维护 AI 正文视图。 |
| [runtime/contracts/http-openapi](src/runtime/contracts/http-openapi.ts) | 原 AI 操作及 schema 单源，实际发布范围由宿主挂载与权限政策决定。 |
| [business-events/prisma-business-failure-outbox](src/business-events/prisma-business-failure-outbox.ts) | `PrismaBusinessFailureOutbox` 参加原检查、退款、通知事实事务。真实失败才写出箱，存储失败继续使业务事务失败；沿用原去重与历史事件失效规则。 |
| [business-events/return-exception-source](src/business-events/return-exception-source.ts) | `returnExceptionSource` 核对原检查版本、唯一异常 ID、原审核状态和来源指纹。缺历史依据不补造失败事件。 |
| [privacy/notification-draft-reader](src/privacy/notification-draft-reader.ts) | 校验原草稿、不可变元数据和 `AiDataErasure` 收据。`createNotificationDraftBodyRetentionReader` 仅使用 `aiDataErasure.findUnique`，不写入正文或删除账。 |
| [privacy/retention-policy](src/privacy/retention-policy.ts) | 原 `AI_RETENTION_POLICY` 与 `retentionDeadline`。策略版本、期限和未决效果约束保持原值。 |
| [task-errors](src/task-errors.ts) | `AiTaskRepositoryError` 的唯一类身份，供旧仓储与独立读取器共同抛出和识别。 |
| [knowledge-fingerprint](src/knowledge-fingerprint.ts) | 原 `fingerprint`：对 `JSON.stringify` 的结果取 SHA-256，保留属性顺序。它与正式 `requestFingerprint` 的排序语义不同。 |

完整 Rental 宿主把同一个 `PrismaBusinessFailureOutbox` 实例交给事实仓储，事务参加者直接使用收到的 transaction。检查、退款和通知链需要真实 AI 表及该实例；不能用空函数、内存替身或缺省成功填补。原 `fulfillment` / `opening` 扩展仍由 `BusinessFailureResourcePorts` 提供真实业务观察和存储能力，提取并不替宿主补齐这些端口。

Rental 的通知缓存和草稿仓储通过 `@rental-os/rental-core/notification-draft` 消费以下组合：

```ts
const retention = {
  state: notificationDraftRetentionState,
  receiptId: notificationDraftRetentionReceiptId,
  createReader: createNotificationDraftBodyRetentionReader,
} satisfies RentalNotificationDraftRetention;
```

读取正常未删除草稿时允许返回 `null`；已删除草稿必须能核对真实删除收据。缺表、缺收据、跨空间、错误来源哈希、超前删除时间，以及已记录删除但恢复了旧密文的行都保持不可用。读取不会重放删除或修改恢复结果。

## 数据与兼容归属

宿主选择 [公共数据](../../apps/platform-api/prisma/schema.prisma)、[Rental 数据](../rental-core/prisma/schema.prisma)及 [AI Native 数据贡献](../ai-native-data/README.md)，使用其组合生成的唯一 Prisma Client。生成和数据准备属于宿主，版本、锁和物理观察仍按正式数据部署流程裁定；本包不执行迁移、不声明数据库已就绪。

旧 [出箱入口](../../apps/api/src/modules/ai-native/business-events/prisma-business-failure-outbox.ts)、[归还异常入口](../../apps/api/src/modules/ai-native/business-events/return-exception-source.ts)、[Task 仓储错误](../../apps/api/src/modules/ai-native/ai-task.repository.ts)和[保留策略](../../apps/api/src/modules/ai-native/privacy/retention-policy.ts)再导出同一对象，保留错误 `instanceof` 和出箱 Symbol 身份。

原 [通知正文维护者](src/runtime/privacy/retention-notification-draft.ts)继续拥有授权重查、scope 锁、未决效果核对、原密文校验、正文 CAS、快照清理和删除账写入。它只复用本包的 reader、`metadataSchema`、`sameReceipt` 及原 ID / scope / hash 校验；这些纯函数不授予清理权限。维护服务、知识服务、任务执行器和模型财务账使用迁入的原实现，旧路径不保留第二份逻辑。

Prisma 类型由所选宿主生成。SQL、Decimal、空值和错误类来自 [公共运行库](../platform-server/src/prisma-runtime.ts)，JSON 输入使用 [Rental 空值桥](../rental-core/src/prisma-null-values.ts)连接所选 Client 的精确类型；运行时不加载默认生成 Client。

原 [业务事件合同验证](../../tests/ai-native-events-contracts.test.cjs)仍经兼容入口消费唯一实现。[原场景事务验证](test/original-scene-transactions.test.cjs)覆盖同一权限与原业务参加者。离线核验应使用本仓库原守卫、当前所选 schema 的官方 DMMF / 类型及事务 fixture；真实数据库约束、迁移、外部投递和正式宿主运行需分别验收。
