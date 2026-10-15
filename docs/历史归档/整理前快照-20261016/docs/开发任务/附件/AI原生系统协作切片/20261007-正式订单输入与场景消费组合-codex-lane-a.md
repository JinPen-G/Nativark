# 正式订单输入与场景消费组合（Codex A）

## 固定依赖与实际实现

施工树 codex-ai-native-lane-a，分支 ai/codex-ai-native-lane-a-20261007。继承 c061bae1；仅合入获授权固定提交 04eac695c8cd677446839b987b226134420e662d，合并提交 5e0580dc；未追主线活动 HEAD，没有改其他树。

新增 `scenes/persisted-order-scene.composition.ts` 的 `composeAiPersistedOrderScene`：实际组合主线 `composePersistedOrderTaskInput` 和原 AIN-07 `composePersistedApprovedOrder` 的业务消费层。输入发布、计划保存、步骤登记、提案准备、提交与核对均委托原实现。禁止传入替代 inputSource，审批消费者强制读取同一正式持久原输入。

依赖类型直接复用两个原 composition，不建立公共 DTO。依赖需提供同一个 PrismaClient、AuthService、SubscriptionService、Guard、当前 credentials，以及原 Core confirmation（normalizeOrderInput/createApprovedOrder/assertOrderMatchesQuote）、Core 受权查询、quoteFacts、工具版本、scene 和时钟。未提供正式服务不得使用测试来源装配生产。

`AiBusinessScenesModule.registerPersistedOrder(dependencies)` 导出 `AI_PERSISTED_ORDER_SCENE`。注册及执行 provider factory 都不读取、不提供政策、不领取执行权、不产生审批。没有 controller/AppModule/worker。

## 最小宿主调用顺序

1. 已有合法 task/run 是前提；首次创建前原请求仍未提供，不能先造空任务绕过。
2. 服务端预先提供正式启用政策；外部请求不能自行调用 policy.put 启用能力。runner 通过原 tasks.claimRun 领取租约。
3. `publishInput({taskId,registrationRef,expectedTaskRevision,lease,input})`：原 Core 规范化、当前原业务 Guard、持久原输入与策略证明。
4. `savePlan(plan,lease)`、`registerStep(command)`：原计划/登记端口；登记不是执行。使用登记返回的 **runRevision** 更新后续 lease 命令，不能沿用旧 revision。
5. 步骤开始仍归 runner；本组件不直接写 RUNNING。
6. `prepare(originalCommand)` 消费持久 inputSource，创建原 pending proposal，不批准。
7. 人工批准由原人类审批入口完成；`submit(originalApprovedCommand)` 才消费原批准事务。用户确认报价不是批准建单。
8. `reconcile(sameOriginalCommand)` 只核对原操作。unknown 不自动 submit、不换键、不从最新订单反推原结果。committed 仅返回当前可读订单最小引用，收款、交付和任务终态不推断。

输入发布应答丢失：沿原发布端口以同 registrationRef/同载荷核对；原实现拒绝异载荷。准备应答不明：原 immutable proposal 身份及当前授权重新核对；不自动审批。提交未知：原 reconcile。没有本线自建重试循环。

## 验证及真实失败

首次入口红测是模块缺失：Node pass 0 / fail 1（文件加载失败）/ skip 0 / todo 0，退出 1，不称预算/审批缺陷红测。

后续组合测试揭示两处夹具/调用假设问题：没有 Membership 依赖的 Core 不补 bookingIdentity；登记会推进 run revision，后续 prepare 必须使用返回值。分别按实际 Core 规范化结果、正式登记 runRevision 修正测试，未放宽生产权限。

串行数据库替身不能将授权的独立读事务排在自身未结束的写事务后：该次测试无输出挂起，手动中断退出 1。现按既有 approved-order-persisted 夹具方法使用 AsyncLocalStorage，仅将独立授权读委托已提交数据；不宣称 MySQL 行锁/隔离级别行为通过。

测试驱动真实 Auth/Guard/ALS、正式发布源、计划仓储、步骤登记、正式 inputSource 与原提案准备。预置 task/run、政策目录、业务事实和 DB 是离线替身；RUNNING 由测试模拟 runner 已开始边界。验证无默认读写、同源输入、没有人类批准则拒绝执行、撤权后拒绝旧输入及提案准备。未宣称本片从首次请求开始端到端建单。原批准消费成功/unknown 用本线既有实际审批/Core 服务测试单独验证。

环境（完整前缀）：

```powershell
$env:DATABASE_URL='mysql://offline:offline@127.0.0.1:1/rental_os_offline'
$env:AI_OFFLINE_AUDIT='D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a/output/lane-a-scenes-audit.jsonl'
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-persisted-order-scene.test.cjs tests/ai-native-order-task-input.test.cjs tests/ai-native-lane-a-business-approved.test.cjs tests/ai-native-lane-a-scene-requests.test.cjs
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"
git diff --check
```

最终定向回归 pass 15 / fail 0 / skip 0 / todo 0，退出 0；API TypeScript 退出 0；diff check 退出 0。没有扩大到全专项回归，没有 Prisma 生成、真实 DB/HTTP/模型/支付、生产启动或宿主验收。

## 八包逐项状态与准确剩余依赖

| 工作包 | 实际状态 | 剩余依赖 |
|---|---|---|
| 一 首次原请求生产 | 严格当前受权场景材料已有；持久生产未完成 | 原请求表/唯一约束/隔离生成类型、当前 scene creation policy；具体补丁见 20261007-报价来源纠正与原请求依赖-codex-lane-a.md |
| 二 原请求读取与修改重发 | 既有订单 task/run 的正式输入可读、不可变；首次原请求读取未完成 | 与一相同；不能把 AiTaskActionInput 当创建前存储 |
| 三 订单解释正式任务 | 最少受权事实与稳定场景材料已组合，来源重开已受权 | 一、正式原请求 creation authority、主线收集/冻结 intent/调用登记和 runner plan 启动装配 |
| 四 开业正式任务 | 明确分区材料、差异候选与复查已有，不执行配置写入 | 一、正式开业计划、差异 proposal 目标/版本/读写端口；不借 order.commit 修改配置 |
| 五 报价到批准建单 | 已有 task/run 的正式输入→计划→登记→原 AIN07 prepare 接通；原 submit/reconcile 可调用 | 首请求依赖一；人类选择/批准真实宿主及 runner 开始/暂停/恢复归主线；不代管 |
| 六 API/模块 | 显式 business 模块及 persisted order provider 已接通，默认无动作 | 冻结原请求 create/read/reissue/reconcile 公共 DTO/合法 Controller 装配；没有私造 HTTP |
| 七 恢复/并发 | 固定依赖的原输入 immutable/同键核对/旧政策拒绝回归通过，原批准未知保留 | 首请求收据恢复依赖一；任务应答/计划启动恢复归 AIN06；不能称三场景恢复全验 |
| 八 可替换性交付 | 本文、既有业务入口及固定提交记录已交付 | 未满足的以上公共接口不能改文案标完成 |

本轮只读核查最新主线 schema 同样不存在创建前原请求模型。AiTaskActionInput 仍要求 task/run；AiTaskInputRequest 是澄清等待；AiTaskCreationRepository.create 需要受权 inputRef/revision/hash。故一至四的正式启动不能在本线范围合法绕过。历史报价 unknown 仍缺 Core 原操作键精确核对；企业资格、检查争议、单风险详情和通用差异持久化仍沿原记录保持 unavailable。

Runtime 替换只替换主线编排/执行适配；本服务保留原请求/计划/登记引用和 AIN07/Core 原子提交点，不导入节点对象。Provider 替换独立留在唯一 Gateway/财务单账；本层没有 SDK 类型、价格计算或派发器。迁移需保持 task/run/action/inputRef/fingerprint/proposal/approval 原关联及 unknown 语义；回退不删除原输入/收据，不重派未知动作。当前未安装框架或迁移 SDK。

本线可做的本片装配已完成；正式首次任务生产、HTTP、三场景模型运行不算完成。剩余公共依赖须主线提供固定交付后续接，不擅改 schema/shared/runner/审批活动文件，不追加空接口冒充闭环。
