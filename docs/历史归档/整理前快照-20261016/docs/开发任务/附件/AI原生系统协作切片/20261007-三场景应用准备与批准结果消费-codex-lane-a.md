# 三场景应用准备与批准结果消费

基线 41c67389；本片只写 scenes、本线 composition、测试夹具及本记录。

## 入口

composeAiAuthorizedBusinessTools(...).scenes：prepareOrderExplanation({requestKey,orderId,question})、prepareOpeningDiagnosis({requestKey,sections})、prepareQuoteClarification({requestKey,candidate})。

实际组合当前 Auth/Guard/ALS、订单最少问题事实、开业分区清单与报价澄清；原请求内容快照绑定服务器解析的 owner/audience/scope，contentHash 不含时间，不作为授权凭证。输出深冻结有字节上限；开业只输出明确选定分区，底层现有上下文仍组合读取，未宣称分区查询下推。未知分区/重复分区、外部 actor/creationAllowed、价格覆写拒绝。

三入口均返回 prepared_not_persisted：没有 inputRef、revision、taskId，不创建任务/报价，不调用模型。真实原请求表与当前场景创建政策缺失仍是硬阻塞。

composeAiBusinessOrderApplication(dependencies) 消费原 composePersistedApprovedOrder，prepare 不批准；submit/reconcile 只接受 AIN-07 原命令，所有政策、快照、审批消费、Core 原子事务及结果读取仍在原实现。只返回订单 id/status/quoteId 与受控资源引用，资金/履约不推断。AI_RESULT_UNKNOWN 保留 reconcile + retryable:false，不自动重发或换键。无依赖则 AI_RESOURCE_UNAVAILABLE。

本线工具 composition 的可选 approvedOrder 复用该入口，并强制使用顶层同一 guard/credentials，不能从请求体传入。测试依赖中的原始任务输入为离线外部来源替身，不证明首次原请求生产完成。

AiBusinessScenesModule.register(dependencies) 为可显式导入的 Nest provider（AI_BUSINESS_SCENES），不含 controller，不注册 AppModule/Cron/HTTP，不自动读业务或创建任务。模块 provider 测试直接执行工厂，不宣称完整 Nest 启动/HTTP 验收。

## 验证

初始新场景入口红测 pass 0 / fail 3 / skip 0 / todo 0，退出 1。实现三场景后定向通过；随后新增批准消费与模块测试是实现后冒烟，不伪称都先留红。

最终命令（均带下列 preload/environment）：

node --test tests/ai-native-lane-a-scene-requests.test.cjs tests/ai-native-lane-a-business-approved.test.cjs：pass 8 / fail 0 / skip 0 / todo 0，退出 0。

node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"：退出 0。git diff --check：退出 0。

preload=--require ./tests/fixtures/ai-native/prisma-offline-preload.cjs；DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a/output/lane-a-scenes-audit.jsonl。

## 后续接线

已核对获授权固定依赖 04eac695c8cd677446839b987b226134420e662d 尚未在本树，仅差该 1 个主线提交。收口本片后同步该固定提交，接真实 composePersistedOrderTaskInput，不追移动主线 HEAD。创建前原请求持久化与冻结公共 HTTP DTO 仍不能由此替代。

Runtime 可替换边界：场景只返回本系统事实/原请求内容材料，持久任务/lease/恢复归原 runner，批准事务归 AIN-07；未来 Runtime 只调整对应装配。Provider 类型不进入本层，模型仍唯一 Gateway/预算单账。本片没有接框架/SDK。未验真实 DB、模型、HTTP、生产；不宣布 AIN 整项完成。
