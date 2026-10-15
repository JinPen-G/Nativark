# CB08/CB09 原事件到人类办理

前置 `9106ad97`，仅B树/原分支。复用现有真实失败事务Outbox、独立自动主体/政策、prepare/create/reconcile、人类close/feedback/operation；不重造事件表/去重/执行器。

## 实际功能与入口

缺口是宿主只有原失败eventId，却只能用已知inputRef调用人类办理。新增现有 `HumanAutomationReviewService.forEvent({eventId,limit,after?})`：

- 当前身份与scope→原事件读取权限/原业务资源→数据库scope+event条件、id稳定排序、最多10条加1探测→逐项原review.read授权与任务/input关联验证→返回前身份、事件状态/fence及原业务来源复验。
- 返回原通知/退款资源引用，当前来源事实，已存在输入的冻结模式（shadow/manual_confirmation）、原政策版本引用、任务/运行引用、review状态与下一步。无输入明确not_observed，无总数、无通知正文/供应商异常；空结果不证明操作未执行，不默认disabled或成功。
- creation_unknown下一步read_original_creation；closed下一步read_review_operation；其余人工审阅。所有返回executionPermission=false/businessActionRequested=false。冻结模式不是当前模式或执行许可。
- 无写入、不创建任务、不发通知/退款、不调用Gateway。历史办理只要求当前原资源读取权限，不依赖已失效的旧automation政策；真正close/feedback仍须原独立grant。

已在 `composeBusinessFailureEvents(...).reviews`、`composeBusinessFailureAutomation(...).reviews` 与 `BusinessFailureEventsModule` 导出的原同一服务可调用，无孤立类、无新HTTP/后台worker。

消费者：原业务失败eventId→forEvent→选择原inputRef→read→明确close/feedback（原expectedRevision/eventFence/taskId/grant）→operation按原operationKey核对。自动主体disabled/正式权益或预算/计划政策缺失时，原automation.prepare仍拒绝；人类原业务流程不靠自动主体放行。

## 一次定向冒烟与类型

仅复用 `tests/ai-native-events-contracts.test.cjs` 原CB08/CB09组合项，未新增测试脚本。加入无输入零写入、shadow任务ACK丢失的原引用发现、政策停用/业务已恢复后的历史closed办理、撤权拒绝、正式management流程产生manual_confirmation输入的实际读取。

命令：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='CB08/CB09' tests/ai-native-events-contracts.test.cjs`。

固定无效DATABASE_URL；AI_OFFLINE_AUDIT/TEMP/TMP均在本树output/inspection-lb05-tmp。先红pass0/fail1/skip0/todo0 exit1（forEvent缺失）；实现后pass1/fail0/skip0/todo0 exit0；补manual_confirmation既有办理流程后仅同一项复验pass1/fail0/skip0/todo0 exit0，不累加为全量结果。API原tsconfig noEmit程序检查0诊断 exit0（本树私有Prisma/shared源码路径，未生成共享产物）；diff-check exit0。

## 依赖与未验

正式Auth/Guard、原订单读取及订阅服务通过既有组合注入；独立自动主体/政策/预算/计划及人类review grant须可信置备，缺则拒绝，测试置备不等于生产已有。测试实际驱动原通知/退款失败生产者及自动化/任务仓储服务，但DB/业务传输为离线替身，不是真MySQL锁、外部通知/支付或模型验收。

未启worker、自动执行、生产HTTP/UI；未知原任务不重派，不把close当取消远端任务。Runtime/Provider迁移仍独立且未实施；本次只读消费复用原event/input/task/operation，不引框架状态。未改Core、Gateway、Auth、runner、审批、shared/schema或中央文档。
