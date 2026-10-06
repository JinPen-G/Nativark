# Lane B 07：文档读取上下文快照

前置 `521aef78`。本片修复知识文档 `load` 在授权完成后使用可变 caller scope 的问题，未改公共授权入口或其他 lane。

## 红测与修复

实际 `KnowledgeDocumentService.read/load` 红测：在 repository.read 等待/调用期间替换 workspace，原实现会用替换后的 scope 继续读取；当另一记录拥有相同 documentId 时可返回错误 scope 的记录。修复为：复制 context/scope 作为此次读取输入，记录 caller context 指纹，授权与 repository.read 都只用快照；每个 await 边界检查 caller 未改变；返回记录深复制。

## 验证

- 红测 `node --test tests/ai-native-knowledge-lane-b-load-snapshot.test.cjs`：pass1/fail1/skip0，退出1；其中无外部同 ID 记录的场景原本已拒绝，新增同 ID 跨 scope 场景实际复现泄露。
- 绿测 `node --test --test-concurrency=2 tests/ai-native-knowledge-lane-b-load-snapshot.test.cjs tests/ai-native-knowledge-access.test.cjs tests/ai-native-knowledge-flow.test.cjs tests/ai-native-knowledge-cache.test.cjs tests/ai-native-knowledge-persistent-content.test.cjs tests/ai-native-knowledge-lifecycle.test.cjs`：pass68/fail0/skip0/todo0，退出0。
- 知识严格 TS noEmit、shared/Prisma 本树解析检查在回归中通过；未执行普通 API build。
- `git diff --check`：提交前退出0。

使用两个离线 preload、固定无效数据库 URL、本树 audit output；网络尝试无记录。证据是实际 knowledge service + 持久内容替身，不是真实 Auth/Guard、MySQL 并发、HTTP 或生产撤权推送。待主线独立复核，不宣称 AIN-10/24 完成。
