# AI Native 服务端参加者

本包承接原 AI Native 的业务失败出箱和通知草稿正文保留读取器。实现仍使用原事实、原权限来源、原收据和调用方事务；导入和构造不会启动 Runtime、Worker、清理任务、Gateway 或数据库连接。

## 入口与调用方

| 入口 | 职责与边界 |
| --- | --- |
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

原 [通知正文维护者](../../apps/api/src/modules/ai-native/privacy/retention-notification-draft.ts)继续拥有授权重查、scope 锁、未决效果核对、原密文校验、正文 CAS、快照清理和删除账写入。它只复用本包的 reader、`metadataSchema`、`sameReceipt` 及原 ID / scope / hash 校验；这些纯函数不授予清理权限。原维护服务、知识服务、任务执行器和模型财务账不在本包内重新实现。

原 [业务事件合同验证](../../tests/ai-native-events-contracts.test.cjs)仍经兼容入口消费唯一实现。离线核验应使用本仓库原守卫、当前所选 schema 的官方 DMMF / 类型及事务 fixture；真实数据库约束、迁移、外部投递和正式宿主运行需分别验收。
