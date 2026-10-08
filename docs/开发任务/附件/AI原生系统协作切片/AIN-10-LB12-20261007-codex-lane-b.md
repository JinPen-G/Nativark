# AIN-10 Lane B 12：知识操作收据主体绑定

前置 `79ed6cc8`。本片补齐知识写操作幂等收据的主体边界。原实现的 operation fingerprint 只包含业务输入；同一 workspace 内若两个已授权主体提交相同 `documentId/operationId/输入`，后来的主体可以命中前一主体的 receipt 并被当成自己的重放。

## 实现

- 新增 `operationFingerprint`，将服务端解析出的 scope、actor 和 audience 与操作载荷绑定后再计算不可逆摘要。
- 文档创建、修订、解析，发布/撤回/删除以及索引/ACL 变更使用统一主体绑定摘要；没有新增客户端可伪造字段，也没有修改 Prisma schema/迁移。
- 保留 receipt 的 scope/document/operationId CAS；同主体同载荷仍可重放，不同主体即使输入相同也得到 conflict。

## 红测与验证

- 红测 `node --test tests/ai-native-knowledge-lane-b-receipt-subject.test.cjs`：pass0/fail1/skip0/todo0，退出1；原实现缺失预期 conflict，确认跨主体 receipt 重放。
- 修复后同一测试：pass1/fail0/skip0/todo0，退出0；实际调用 `KnowledgeDocumentService.create`、授权替身和内存事务仓储。
- 知识目录隔离 TypeScript：`node tests/fixtures/ai-native/knowledge-service.cjs` 输出 zero diagnostics，退出0。
- 主体绑定相关实际回归：`node --test` 12 个知识服务/仓储/协议测试文件，共 128 pass、0 fail、0 skip、0 todo，退出0。
- `git diff --check`：退出0。

## 证据等级与未验项

- 证据：离线实际服务、受控授权与内存事务仓储、知识目录隔离类型检查；固定无效 DATABASE_URL、本树 preload/audit，网络拦截无尝试。
- 未验：真实数据库迁移/并发锁、历史旧 receipt 的部署兼容策略、真实文件/ACL/索引服务、HTTP、模型、支付、浏览器/设备和生产部署。
- 仍未实现的正式来源适配、内容生命周期装配和跨进程缓存广播保持 unavailable；作者完成待独立复核，不宣称 AIN-10/24 或整体专项完成。
