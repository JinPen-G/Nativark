# AIN-10 LB16 解析pending收据不冒充完成重放

红测驱动真实KnowledgeDocumentService，数据库替身模拟pending标记已提交但COMMIT应答丢失。首调用正确result_unknown，重放旧实现却正常返回pending记录；红测pass0/fail1/skip0/todo0，退出1。修复：同操作收据仍带parseOperationId时返回KnowledgeCommitUnknownError(result_unknown,nextAction:reconcile)，不再读文件、不重派解析、不写新收据。解析已完成的重放和明确failed后的新操作重试语义不变；未知pending的正式核对/恢复入口仍未接通，不能当作已完成。

验证命令（本树两offline preload、固定无效DATABASE_URL、本树绝对output/lb16-audit）：node --test --test-concurrency=2 tests/ai-native-knowledge-lane-b-parse-unknown.test.cjs tests/ai-native-knowledge-lifecycle.test.cjs tests/ai-native-knowledge-prisma-repository.test.cjs tests/ai-native-knowledge-persistent-content.test.cjs。

结果52 pass/0 fail/0 cancelled/0 skip/0 todo，退出0；包含真实PrismaKnowledgeRepository的CAS/收据/unknown/rollback和实际持久组合的撤回、ACL、索引重放及应答丢失。新中断测试的数据库为内存事务替身，不是MySQL COMMIT宕机证据。知识目录strict noEmit随生命周期测试通过，diff --check退出0。全API类型另记最终交接。

正式ACL/文件/确认生产依赖见LB15。未读.env、未启动服务、未连DB/HTTP/模型/支付、未执行迁移、未修改共享生成物。作者完成待主线独立复核，不宣称AIN-10/24完成。
