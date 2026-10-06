# AIN-10 Lane B 13：结构化记忆收据 audience 绑定

前置 `13c42cf3`。知识文档收据已绑定 actor/audience 后，本片把同一原则应用到结构化记忆的 propose/modify/confirm/delete 操作摘要。原实现的内存与 Prisma receipt 虽按 owner/scope 隔离，但同一 owner 在不同 audience 下的相同 operationId/载荷会得到同一 fingerprint。

## 实现

- 复用知识目录的 `operationFingerprint`，将服务端解析的 scope、actor、audience 与 memory 操作载荷绑定。
- `StructuredMemoryService` 的 propose 与 change（包含修改、确认、删除）统一使用该摘要；不增加客户端字段、不改变确认记录或 Prisma schema。
- 仍保留 owner、scope、revision、ACL、confirmation 和有效期的既有事务校验；不同 audience 只能冲突，不能被当成既有主体的重放。

## 红测与验证

- 红测 `node --test tests/ai-native-memory-lane-b-receipt-subject.test.cjs`：pass0/fail1/skip0/todo0，退出1；原实现缺失预期 conflict，确认跨 audience receipt 重放。
- 修复后记忆/确认/Prisma 适配回归：`node --test tests/ai-native-memory-lane-b-receipt-subject.test.cjs tests/ai-native-memory-confirmation.test.cjs tests/ai-native-memory-service.test.cjs tests/ai-native-memory-prisma-repository.test.cjs`：52 pass、0 fail、0 skip、0 todo，退出0。
- 知识目录隔离 TypeScript：沿用本树固定 preload 的 `node tests/fixtures/ai-native/knowledge-service.cjs`，zero diagnostics，退出0。
- `git diff --check`：退出0。

## 证据等级与未验项

- 证据：实际 StructuredMemoryService、PrismaMemoryRepository 适配行为、确认记录事务替身；固定无效 DATABASE_URL、本树 preload/audit，网络拦截无尝试。
- 未验：真实 MySQL 并发/迁移部署、历史 receipt 兼容策略、真实 ACL/文件/索引、HTTP、模型、支付、浏览器/设备及生产环境。
- 记忆来源和业务权限仍依赖主线正式适配；不把 preference 或本地 receipt 当授权。作者完成待独立复核，不宣称 AIN-10/24 或整体专项完成。
