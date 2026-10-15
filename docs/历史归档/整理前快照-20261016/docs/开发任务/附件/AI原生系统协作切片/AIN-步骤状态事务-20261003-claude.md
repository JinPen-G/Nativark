# 主线步骤状态与事件原子提交（2026-10-03）

## 本片已实现

主Claude亲自实现 `AiStepTransitionRepository`，在既有AiTask/AiRun/AiStep/AiTaskEvent模型上持久化步骤转换。不是Core业务写入器，不执行模型或工具，不默认启用任何入口。

- 命令只接受taskId、stepId、task/step revision、evidenceId、reason和租约。不能从调用方接收outcome/facts/actor/scope/clock。
- 必需 `AiStepTransitionAuthority.resolve` 读取当前身份与不可变服务端结果/核对证据；无默认实现。初次读取和任务/run行锁后分别调用，校验授权标识、权限scope、证据revision/期限和完整前后步骤状态一致。
- 消费既有C01/C04 JSON Schema做严格校验：不强转字段、不移除额外字段；未知结果必须possible、不可重试、下一步reconcile。复用已有纯状态机决定允许的转换，不另造状态语义。
- 前一状态精确对应库中step身份、tool/version、actionId、requestFingerprint、run、sequence、revision、status/effect、errorCode/resultRef；重试或核对不能换动作身份。
- 所有写入在一个有界Serializable事务：task revision+cursor CAS获得task行锁 → 读取step → 原run租约revision/fence CAS → 当前授权与证据复验 → 用新时钟复查锁后租约有效期 → step CAS → event追加。
- 任务CANCEL_REQUESTED/WAITING_EXTERNAL允许记录已有动作核对，不允许新start/retry；取消标记不能消除。终态、queued、等待输入/确认不接受本片步骤转换。
- 成功结果只持久化resultRef，失败/未知保存安全errorCode；业务facts和原始错误不写wire事件。committed必须至少有current/snapshot依据，仅missing/legacy fallback不能作为提交证明；所有fact scope必须与授权scope一致。
- 返回C04 step.changed事件及新的run revision，轮询通过真实AiTaskEventRepository读回，不暴露内部证据/actor封套。
- 提交确认不明统一返回AI_STORAGE_UNAVAILABLE，不自动重试；测试明确覆盖「写入可能已生效但响应失败」，不承诺回滚。

## 实际证据

- 初始API noEmit曾因验证后unknown未被Ajv类型收窄报2条TS2322；已改为在严格运行时验证后使用已声明的authority返回类型，没有关闭typecheck、没有手写Prisma Delegate。
- 初版新增定向测试97/97通过；自查补了权限快照变化、重授权时间戳、缺失/legacy提交依据约束与回归。
- 最终全部52个AI测试文件 **914/914通过，0 fail/cancel/skip/todo**；全量API TypeScript noEmit通过。
- 命令：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-concurrency=1 tests/ai-native-*.test.cjs`，设置固定无效DATABASE_URL和AI_OFFLINE_AUDIT。
- 两轮审计无外联或.env读取拦截记录；git diff --check通过；schema和migrations与HEAD无差异。
- 新测试替身实际执行生产生成的Prisma条件，覆盖五种主体/audience、越租户/空间、当前和过期租约、旧fence/holder、重授权变化、动作指纹、状态非法路径、CAS零匹配、事务各阶段失败、一次提交确认丢失、事件读回。删除两次run写入的fence谓词会破坏旧worker拒绝oracle。
- 自查与自动化证据，不声称独立审查已通过。完整测试数量含旧KNOWN GAP与descriptor，不等于914个真实生产场景验收。

## 不冒充完成的边界

现有逻辑step需要下一片登记路径创建；本片没有伪造新增step事件，也没有声称步骤登记完成。Authority是必需安全端口，其真实Auth/Core结果读取适配尚未落地，因此没有注册AppModule/Controller/worker。

这只保证步骤元数据与事件同事务，不声称Core订单/支付/库存业务提交与该事务已经原子接通。真实MySQL锁/隔离并发、HTTP Guard组合、真实模型/支付、浏览器/设备均未运行。所有AI工具仍保持未交付/未启用状态。

## 最新协作约束

负责人明确最重要部分由主Claude亲自做。B03修订版只向Codex分配16项次级配套/复现/只读实现，撤回早期B03对关键授权、Gateway dispatch/预算运行逻辑的修改权；B02源代码仅抽查，未合入或宣布验收。Prisma交付暂冻结，本轮双方不写schema/迁移。原中央记录的旧未提交文档不纳入本片。
