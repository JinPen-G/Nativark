# 报价来源纠正与正式原请求依赖

前片：9689e64d。当前接回原经营 composition，不改主线或公共模型。

## 实际修复

inputSources 原实现把候选 ID/字段存在当作 explicit_user_selection/input，confirmed=true，与注释及正式要求相反。已在真实 Guard/Core 组合测试留红（pass 0 / fail 1 / skip 0 / todo 0，退出 1），再修为 supplied_candidate/server_resolved_candidate，confirmed=false，confirmationEvidence=not_loaded。没有人类动作收据时不得标已确认，也不猜服务器默认值。输入在 await 前快照，输出深冻结并绑定输入指纹。

最终 Node --test tests/ai-native-lane-a-first-batch-quote.test.cjs：pass 4 / fail 0 / skip 0 / todo 0，退出 0。API tsc --noEmit --incremental false：退出 0。使用与前片相同的离线 preload、固定无效 DATABASE_URL、本树 audit。未做真库/模型/HTTP/生产验收。

## 给主线的最小持久依赖请求（建议，不在本树改 schema）

核查两树 schema：AiTaskActionInput 外键要求 scopeId/taskId/runId；AiTaskInputRequest 是已完成步骤后的澄清等待。AiTaskCreationRepository.create 却需创建前 inputRef/inputRevision/inputHash，由 AiTaskCreationAuthority.resolve 受权解析。不能先造任务绕过原输入授权，也不能把请求塞到日志、预算表或内存 Map。

建议追加 AiTaskOriginalRequest（名称由主线定）：

- id UUID；scopeId 外键 AiScope；audience、ownerKind、ownerId，sceneCode VarChar(128)、sceneVersion VarChar(64)。
- requestKey VarChar(128)；revision UnsignedInt；payload Json（仅有限业务输入，字节上限）；contentHash Char(64)；authorizationBindingHash Char(64)；policyRevision UnsignedInt；expiresAt、createdAt DateTime(3)。禁止保存凭据、可变调用上下文授权成功标记。
- 唯一键 (scopeId,audience,ownerKind,ownerId,requestKey)，复合唯一 (scopeId,id,revision,contentHash) 用于精确引用。原内容只追加不可变，不 update payload；修改使用新 requestKey/新引用，不静默改在途输入。
- 读取按当前 owner/audience/scope 及原业务资源权限；创建前和创建事务内复核当前场景政策、资源和身份。scene policy 目前 AiTaskPlanPolicy.sceneCode 容量 64 与 task.sceneCode 128 不同，主线需确定统一受支持长度，不在本线私改。
- 事务保存原请求，COMMIT 应答丢失只能按同一受权 requestKey 精确读回，比对 payload/hash；相同键异载荷冲突，不换键重试。task metadata 继续用已有 creationKey 唯一约束及 creation repository，不复制任务状态机。

正式依赖需主线提供隔离生成类型和追加迁移，以及当前身份/场景启停政策可复核来源。收到后本线才可完成实际 Prisma 原请求生产者、creation authority 与受权读取。未提供前创建链保持 unavailable。

## 其他精确依赖

- 主线 order-task-input.composition.ts 的 composePersistedOrderTaskInput 确实存在，但本线尚无此文件，且该源读取既有 task/run/action，不解决首个原请求。接入应使用负责人给出的固定提交，不追活动 HEAD。
- 还需要冻结的原请求创建/读取公共 DTO 才能增加受权 API；不能发布本线私有同名 DTO。
- Runtime 替换可复用原请求、受权业务 facts 和不可变内容包；持久结果、lease/fencing 由原运行器适配。Provider 替换仍只发生唯一 Gateway 内，不改变此层权限/请求/审批。当前未安装或接入框架。

剩余队列：正式原请求持久化/创建；订单与开业场景任务启动；批准建单组合；公共 API 与原操作恢复。上述依赖缺失不得标已闭环。前序纯准备能力仍保留。
