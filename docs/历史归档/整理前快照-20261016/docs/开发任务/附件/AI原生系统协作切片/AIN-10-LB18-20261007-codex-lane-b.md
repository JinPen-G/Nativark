# LB18 服务端人类确认生产与既有记忆消费

固定f647199c无冲突整合为2a145957；47c53ee6/79ed6cc8/13c42cf3/35bc84ad/6a4d8acc及LB15～17全部保留。仅本树施工，无MERGE_HEAD/WIP冲突；进程列表存在其他会话，但未观察到本树竞争修改，不以进程名称断言其他会话停工。

新增knowledge/PersistentMemoryConsentService.confirm：只接memoryId/expectedRevision/operationId/期限，不接caller身份、scope或“已批准”。复用AiTaskCurrentIdentityAuthority → 实际AuthService.resolveAccessContext → 必需MemoryAuthorizationPort.confirm → Prisma现有AiStructuredMemory与AiHumanConfirmation → 原memoryConfirmationHash/JSON绑定 → StructuredMemoryService.change与原事务确认复验。只支持现有operator/staff workspace人类身份，无客户端/automation伪兼容。

确认生产在Serializable事务中按owner/scope/revision/status条件锁定原记忆，保存内容、ACL、audience、期限绑定；同操作读回原证明，不造另一确认。另一payload冲突、删除后不复活。COMMIT应答不明返回result_unknown，不能用新ID重试。证明生产与记忆确认是两个持久边界，不宣称原子整体；中断后只能同operationId核对/接续。没有注册Controller/工具/生产根模块。

定向测试tests/ai-native-memory-lane-b-consent.test.cjs调用真实身份resolver、确认服务、PrismaStructuredMemoryRepository、StructuredMemoryService；AuthService数据库执行、动作政策与DB事务是明确替身，不是正式ACL接通。覆盖生产/消费、同操作重放、篡改期限拒绝、会话撤销、删除后不复活。红测0pass/1fail/exit1（生产服务不存在）；实现中修复联合类型access诊断及原ID规则禁止冒号的问题。最终1pass/0fail/cancel/skip/todo，exit0。ts-node使用真实本树类型并启用transpileOnly:false；不是全API构建。

命令node --test tests/ai-native-memory-lane-b-consent.test.cjs；固定无效DATABASE_URL、绝对本树prisma-offline-preload.cjs及lane-b-local-runtime.cjs，AI_OFFLINE_AUDIT为本树output/lb18-audit。diff --check退出0。

正式MemoryAuthorization动作政策仍由主线提供，缺依赖拒绝；代码没有猜权限码、owner全权或默认权益。文档ACL与有界文件读取/知识文件资源归属入口仍缺，不能把本片称整个知识线生产接通。真实MySQL锁/并发/HTTP/模型未验；无.env、服务、共享生成物、推送、main或部署操作。按功能优先只做本片定向冒烟，深度竞态回归后补，不宣称AIN结项。
