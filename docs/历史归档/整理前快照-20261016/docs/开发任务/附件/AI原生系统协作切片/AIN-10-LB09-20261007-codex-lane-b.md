# Lane B 09：撤权后的本地正文缓存清除

前置 `c5eedc51`。此前缓存命中每次都重新授权，已能阻止 revoked body 泄露，但拒绝后旧 chunk 仍在当前进程缓存中保留。按 AIN-10 的撤权/撤回传播要求，本片在 `KnowledgeSourceService.readChunk` 的拒绝路径清除当前 context scope + document 的 cache 条目，不清理其他文档或租户。

## 红测与验证

- 红测 `node --test tests/ai-native-knowledge-lane-b-cache-eviction.test.cjs`：pass0/fail1/skip0，退出1，原缓存条目为2而预期拒绝后仅保留另一文档1条。
- 修复后回归 `node --test --test-concurrency=2 tests/ai-native-knowledge-lane-b-cache-eviction.test.cjs tests/ai-native-knowledge-cache.test.cjs tests/ai-native-knowledge-access.test.cjs tests/ai-native-knowledge-flow.test.cjs tests/ai-native-knowledge-persistent-content.test.cjs`：pass57/fail0/skip0/todo0，退出0。
- 真实测试驱动 KnowledgeSourceService/KnowledgeCache/持久内容替身；网络尝试为空。严格知识 TS noEmit 与本树依赖解析在回归中通过。
- 运行命令使用固定无效 DATABASE_URL、两个 offline preload 和本树绝对 audit；不访问真实 DB/HTTP/模型。
- `git diff --check` 提交前退出0。

本片只保证当前进程 cache 的 scoped eviction；不声称分布式缓存广播、外部索引物理删除或真实 ACL producer 已接线。待主线独立复核，不宣称 AIN-10/24 完成。
