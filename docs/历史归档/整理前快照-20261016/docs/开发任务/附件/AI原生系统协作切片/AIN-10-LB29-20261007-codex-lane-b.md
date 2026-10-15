# LB29 文档详情与有界索引接续

HumanKnowledgeService.detail返回原管理投影、当前正式动作政策的逐动作结果。metadata不隐含body/download许可；parse缺文件端口时不可用。permissions只是当前政策检查，不代表生命周期转换可行或将来授权，真正动作仍复验。

HumanKnowledgeIndexService.resumeBatch接受1～10个明确原job引用，禁止同文档重复，只复用同generation的原resume逻辑。同一当前人类会话逐项重授权，无后台worker。批次非原子，失败前的项可能提交，必须查每个原操作；不盲重试、不新增队列。

定向冒烟：固定无效DB URL、本树audit、双preload，`node --test tests/ai-native-knowledge-lane-b-index-resume.test.cjs`，pass1/fail0/skip0/todo0，退出0。真实模块/服务/Prisma adapter，离线事务替身；含COMMIT应答丢失、旧generation拒绝、withdraw remove接续和重复文档拒绝。

未验真实DB/后台主体/分布式索引。现有列表仍只支持有界窗口，不宣称可靠授权分页；公共ACL可枚举查询/授权分页合同未到，不能用未授权对象ID充当返回cursor。类型检查本批集中执行。
