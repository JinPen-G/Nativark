# AI Native：执行线移交报告（原任务计数授权 + 多轮澄清收口）

> 交付对象：Codex（复核/整合作者）。交付者：Claude A（执行线）。日期：2026-10-25。
> 基线：主线 `411c6e35`；本批固定提交（顺序即依赖序）：`e3fb03b0` → `22f2a061`（记录）→ `fd67186f` → `9b0245e4`（记录）→ `288f8f8e`（记录）。树 `claude-ai-native-lane-a` / `ai/claude-ai-native-lane-a-20261007`，工作树干净，8 条历史 stash 与全部 output 保留。
> 本报告只描述本批增量与复核边界；中央接续、正式需求、任务百分比未由本片改动。

## 一、本批做了什么（三个产品提交）

### e3fb03b0 — 原任务内部正式计数授权与可信上界发布链

1. `InputCountTokensService.taskCount`：为一个**已注册原调用**的冻结输入计数。门 = 原 invocation 行（注册时持久化，先于任何预留）+ 该调用自身的 `transition_task` 动作政策（`composePersistedTaskAuthorization().execution.authorize`，双快照 + 读后复核）。**全程不咨询 settings_write**；`count()`（管理入口）与其 settings_write 门原样保留，`sceneCode === undefined` 时管理入口显式 UNAVAILABLE。
2. 多场景：服务不再绑定工厂 sceneCode。场景/配置/输入指纹/计划依据全部取自服务端持久 invocation 行（注册时已对照宿主场景政策校验），一个服务可服务全部宿主场景。
3. `TaskInputBoundPublisher.publish`：以同一 transition_task 许可，从持久计数收据发布原 invocation 的可信输入上界（写 `aiGatewayInputBoundRecord`，幂等键 `(scope, invocation)`）。语义镜像管理发布：证据双读前先核绑定；同键异载荷 = IDEMPOTENCY_CONFLICT；非 P2002 创建失败/丢应答 = PENDING_RECONCILIATION，绝不二次发布。
4. `CountingTaskModelInvocationPreparation`：recorded 宿主的准备装饰器（注册 → 计数 → 发布）。计数 unknown → 抛 `AI_RESULT_UNKNOWN`（保持 runner 未知语义，绝不重派发）；确定失败（供应商 401/4xx）→ `AI_RESOURCE_UNAVAILABLE`；重试经原键重放观察而非重发（注册重放也在计数前即抛 unknown）。
5. 宿主接线：`composeCurrentAuthorizedTaskModelInput` 新增可选 `inputCounting.preparation(inner)`，包裹既有 `PrismaTaskGatewayInvocationPreparation`。**calls 宿主不提供即不计数**；是否提供是 recorded 宿主的服务端显式决策。
6. 组合：`composeTaskInputCountingChain(input)`（要求 `taskExecution`，sceneCode 可省）一次装配 taskCount + publisher + preparation。既有 `composeInputCountingPricing`（管理链）要求 sceneCode 不变。
7. 冻结读取：`TaskModelGatewayInputSource.readFrozenCountingInput` 支持 invocationId 定位（callId 分支原样）；场景钉、owner 核验、执行门、冻结指纹复核全部保留。

### fd67186f — 超限澄清的有界连续轮（事项12）

`originalQuoteAnswerContract` 新增可选 `alreadyOffered` 集合：一轮映射超过八字段上限时，**未问过的字段排前**，已问的按原序随后（重答仍重绑该轮）；8 字段上限不变。场景输入源 `originalInputSource.resolve` 从持久回答历史推导已问集合传入。多行/组合不支持仍走具体限制的 context 契约 + 人工路径；轮数仍受 `maxCalls` 与既有 answer 历史约束。

## 二、实际调用入口与生产顺序

recorded 宿主的每步生产顺序（全部既有结构，本批只插入计数/发布两步）：

```
step start（RUNNING）
→ invocations.prepare：TaskModelGatewayInputSource.resolve（冻结输入）
   → PrismaGatewayInvocationBindings.register —— invocation 行持久化（先于预留）
→ [本批新增] chain.taskCount({invocationId})
   —— 原 invocation 行 + transition_task 门 → 冻结输入序列化（先于预留拒绝不支持组合）
   → 派生 countCallId 的 calls 预留（原单账） → claim（唯一 INSERT） → dispatch → POST count_tokens
   → 收据（OperationLog）→ 预留按收据结算/unknown
→ [本批新增] chain.publish({invocationId})
   —— resolveForReserve 绑定复核 → 价格读取 → 收据证据 → aiGatewayInputBoundRecord
→ budget reserve：recorded quote（PrismaGatewayRecordedPricing.quote 消费已发布上界）
→ dispatch → 生成调用（原 invocation 自己的预留/收据）
```

计数与生成为**两个真实请求**：各自派生/原始 callId、各自预留与收据、共用原单账；计数不触碰生成预留，生成不消费计数预留。

## 三、正常 / 关键拒绝 / unknown 结果（冒烟实证）

冒烟：`output/input-counting-20261025/task-chain-smoke.cjs`（任务链）、`output/multiround-batch-20261025/item12-rotation-smoke.cjs`（轮转）、`output/input-counting-20261024/count-tokens-smoke.cjs`（管理链回归，本批更新其 textDispatch 断言为主线新契约 `not_attested`）。三者本树离线全绿。

- **正常**：双场景（order_explanation + quote_clarification）经同一服务计数均 observed；预留 settled（calls、派生 id、计数价版本）；发布后 `PrismaGatewayRecordedPricing.quote` 得 `tokens = 1234 + 64`；发布幂等重放同 id。
- **关键拒绝**：他主体 → FORBIDDEN；`transition_task` 政策过期 → 拒绝（authorize 包装映射为 AI_RESOURCE_UNAVAILABLE）；绑定变更后重放 → IDEMPOTENCY_CONFLICT；不支持协议/媒体/schema 在任何预留前 CAPABILITY_UNSUPPORTED/UNAVAILABLE；无 settings 授权时管理 count → UNAVAILABLE。
- **unknown**：传输超时 → 收据 unknown、预留 pending_reconciliation、发布 UNAVAILABLE、装饰器抛 AI_RESULT_UNKNOWN；原键重放/observeCountKey/readCountReceipt 按原键恢复原事实，不换 ID 重发。
- **轮转**：八字段上限保持；第 8 个新字段轮入替换文本 fallback；全部已问轮按原序重绑不发明文本逃逸；应答不改写原候选对象（代际分离）；新候选对象携带本轮 selectionRevision（版本绑定）。

## 四、两轮评审结论

评审由 A 作者执行（两轮子代理均因配额上限未完成，改为主持人两轮直查；第一轮攻击面+测试实证，第二轮重构 diff 转写核查）。结论：**0 P0 / 0 P1 / 3 P2**，无需修复：

1. 轮转饿死理论：>8 映射字段且已问字段持续排后——受 `maxCalls` 轮数上限与 context 契约人工路径收敛，P2。
2. 发布创建的非 P2002 失败并入 PENDING_RECONCILIATION（镜像管理流语义），原始错误细节不透出，P2。
3. taskGate 每次计数调用 `execution.authorize` 至多 5 次（入口双读+recheck），均为有界离线读，P2。

测试证据核验：任务链冒烟确实无 settings 授权（服务授权即真实 admission 源，settings 分支未被任务路径触及）；T4 过期拒绝走真实 transition 政策翻转；双场景为两个真实 invocation sceneCode；textDispatch 断言更新对应主线新契约非弱化。

## 五、主线依赖与建议接点

本批不改 AppModule/中央 provider/shared 出口/OpenAPI/schema 迁移/Gateway 核心/财务预算核心。标准装配需主线在 recorded 宿主服务端 DI 处显式提供 `composeTaskInputCountingChain` 的输入（`taskExecution` 取 `composePersistedTaskAuthorization(...).execution`，其余与既有计数组合一致）并把 `.preparation(...)` 接到模型宿主的 invocations 准备。**没有提供该装配前，recorded 宿主因缺上界照旧拒绝——这是现行 fail-closed，不是本批回归。**

## 六、未验边界

真实 tokenizer/供应商计数收据（当前仅 anthropic_messages 的 count_tokens 端点实现）；标准装配后 recorded 宿主的正向全链；真实 MySQL/供应商/浏览器/微信；适用 G4 与独立验收。原 28 项与 ENTRY 百分比未由本片调整（见开发记录 2026-10-25 三段）。
