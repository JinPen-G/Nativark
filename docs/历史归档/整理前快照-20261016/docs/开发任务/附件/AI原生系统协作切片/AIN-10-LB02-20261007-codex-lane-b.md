# Lane B 02：记忆确认撤销传播

前置 `50615b3c`，同一 lane-b 树/分支；没有修改主线、shared、schema、审批或公共鉴权。

## 红测与修复

实际 StructuredMemoryService 的两个失败：最终 repository.read 等待期间撤销确认仍返回 confirmed 偏好；authorize 等待期间替换 audience 能落库。数据库和当前权限端口为显式合成替身，没有替代记忆服务。

修复：隔离授权上下文、请求及 grant，并复核等待期间指纹；最终记忆读回后重新核验人类确认记录，返回独立快照。这是顺序当前状态复验，不宣称原子撤销或生产授权完整。确认凭证写入/审批消费规则没有变化。

## 实际验证

所有 Node 使用 LB01 中两个 preload、固定无效 DATABASE_URL、绝对本树 output/lane-b-memory-{red,green}.audit；真实网络尝试断言为空。

- 红测 `node --test tests/ai-native-memory-lane-b-revocation.test.cjs`：pass0/fail2/skip0，退出1。
- 绿测 `node --test --test-concurrency=2 tests/ai-native-memory-lane-b-revocation.test.cjs tests/ai-native-memory-service.test.cjs tests/ai-native-memory-prisma-repository.test.cjs tests/ai-native-knowledge-flow.test.cjs`：pass74/fail0/skip0/todo0，退出0。包括实际知识目录 strict TypeScript noEmit 与 shared 导入检查；未执行全 API build。
- `git diff --check`：退出0。

归属文件：structured-memory.service.ts、本片新增测试及本记录。不把 LB01 185 与本片 74 相加为全量结果。

未验：真实当前身份/ACL生产者、共享数据库事务/并发、人类确认服务真实入口、HTTP、模型、浏览器和设备。修改/删除的正式服务行为已由原 memory-service 回归覆盖，本轮没有新增路由或永真授权。独立 Review 待主线；不宣称任何 AIN 项完成。
