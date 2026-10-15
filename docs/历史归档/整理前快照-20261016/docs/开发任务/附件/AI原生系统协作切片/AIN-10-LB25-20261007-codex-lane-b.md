# LB25 当前已确认偏好集合（包E）

PersistentMemoryConsentService.confirmedPreferences({limit})先解析当前身份及正式read动作授权，在Prisma按tenant/workspace、subject/owner和confirmed/未过期条件有界枚举，ID升序最多100候选。每项交给原StructuredMemoryService.read复验当前动作、确认记录audience、状态、内容、revision、ACL、期限，返回前逐项再读；不是owner匹配即授权。proposed/deleted/expired/另一audience/已撤销项不输出。

最多50项最小结构化投影，semantics:preference_not_authority；不是永久授权，不覆盖Core/预算/审批。truncated仅按已验证可见项计算，不返回其他主体数量。coverage:bounded_window、pagination:unavailable；尚无audience持久查询列/正式可见性枚举，故不伪造可靠跨窗口分页或完整偏好总数。单项不可用不返回其标识/拒绝计数，空窗口不代表数据库没有任何其他偏好。

一次定向冒烟node --test tests/ai-native-memory-lane-b-preferences.test.cjs：1pass/0fail/cancel/skip/todo、exit0。实际当前身份resolver、确认生产/Prisma仓储/偏好服务；证明operator仅见自身audience的已确认项，proposed及staff确认不混入，撤销后旧偏好排除、当前会话撤销拒绝。执行DB/Auth/动作政策为明确替身，ts-node真实类型检查，diff --check退出0。固定offline环境、本树output/lb25-audit。

正式MemoryAuthorization仍必需，缺失不提供默认实现。真实MySQL/HTTP/多实例未验；未读.env、启服务、联网、迁移、共享生成、推送/main/部署。不称AIN整项完成。
