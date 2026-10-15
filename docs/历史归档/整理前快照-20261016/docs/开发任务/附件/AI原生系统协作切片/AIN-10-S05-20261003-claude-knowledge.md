# AIN-10/S05 Gateway上下文与知识服务组合

2026-10-03，作者Codex，经负责人接手知识线授权。在原独立树 `D:/工作文件/rental-OS/.worktrees/claude-ai-native-knowledge-20261003`、分支 `ai/ai-native-knowledge-20261003` 施工；起始HEAD `6bbd4c3`，包含原Claude S01/S02/S03及接手续交S04。未改主Claude、网关或main工作树，未改中央记录与28项任务状态。仅本片4个白名单新增文件：knowledge-gateway-context.ts、knowledge.module.ts、ai-native-knowledge-flow.test.cjs、本记录。

## 实现

- KnowledgeGatewayContext调用真实retrieval/source/memory服务。只向AiGatewayPortDraft提交AiGatewayIntentDraft，sceneCode与输出预算来自服务端显式policy；Agent不读取协议、供应商、模型、地址或密钥，两种AI模式仍由Gateway决定。
- 查询1000字符；召回最多20项、每项2000字符、片段合计12000字符；偏好/事实各最多4项；序列化上下文24000字符/65536字节。公开请求为严格白名单，不接受endpoint/provider/key/tools/权限字段。
- 固定系统提示与知识正文分离。源文字、查询、事实引用及已确认偏好只进入user数据消息；正文不定义执行工具、收件人、权限或地址。proposed偏好不进入模型。历史missing/legacy_current_fallback原basis不修造成当前完整事实。
- 生成前后再次核对当前授权grant、片段/来源版本/ACL/可见性及已确认记忆。生成期间withdraw/delete/ACL改变/确认撤销或修改后，旧输出不返回；撤回后的索引删除失败也不能恢复可见性。
- no_results/not_ready/failed/unavailable不调用Gateway。Gateway异常脱敏；unknown要求reconcile、不自动重试；文本完成必须匹配request/version且无工具请求，不执行任何业务动作。此为文本上下文生成，不实现stream工具运行。
- KnowledgeModule.register仅显式DynamicModule与工厂；必需授权、仓储、文件、索引、检索、内容、确认、Gateway及有界缓存policy。没有内存库/allow-all/默认供应商生产fallback，没有Controller/AppModule/任务启动接线。

## 调用与证据层级

flow测试实际经过create -> real UTF8 parser -> index.request/runPending -> publish/runPending -> retrieval -> source/cache -> propose/confirm/read -> context.generate。内存repo、授权策略、文件/搜索/索引/确认记录及Gateway是受控替身；不seed一个假的indexed head替代本片发布链。Gateway捕获的真实Intent以当前公共C03 schema校验；正常mock与failed/unknown示例匹配公共结果schema，不声称真实模型调用。

跨租户/空间、客户/员工/SaaS、own与selected空集由合成当前授权端口刻画；未调用真实Guard或HTTP。候选scope负例验证实际服务拒绝；缓存body授权与确认revision有特意替换服务方法的unsafe mutant，基准拒绝而绕过后oracle能观察错误完成。变异只存于单测试fixture，未改生产鉴权算法，不将mutant成功计为产品安全通过。

## 本轮命令与结果

工作目录均为本知识树，导入项目之前拦截socket/fetch/DNS/TLS/UDP，连接尝试0；无.env、DB、安装依赖、服务、模型或支付。

1. `node --test tests/ai-native-knowledge-flow.test.cjs`：新增24项（首轮23项中22过/1失败，见下；随后23项全过，再增加1项身份范围回归）。最终纳入组合命令24/24、退出0。
2. `node --test tests/ai-native-knowledge-lifecycle.test.cjs tests/ai-native-knowledge-access.test.cjs tests/ai-native-knowledge-cache.test.cjs tests/ai-native-knowledge-parser.test.cjs tests/ai-native-memory-service.test.cjs tests/ai-native-knowledge-flow.test.cjs tests/ai-native-knowledge-contracts.test.cjs`：88/88、退出0，无skip/todo，包括真实strict noEmit和C06消费者契约。
3. `node tests/fixtures/ai-native/knowledge-service.cjs --build`：退出0，knowledge所有TS及其公共类型依赖零诊断、真实emit至本树ignored `apps/api/dist/knowledge-isolated`。这是隔离知识模块构建，非完整API构建或部署验证。
4. `node --test tests/ai-native-gateway-contracts.test.cjs`：27/27、退出0，C03闭合引用/双模式/Intent/结果/能力/usage/真实TS消费者回归。
5. `git diff --check`：退出0。加入白名单后另检查cached diff与最终status，未知文件不附带提交。

## 失败过程与修正

- 初次strict noEmit的三项诊断：泛型parse辅助函数对于Zod.default推断输入类型，memoryIds/facts可能undefined。改本片入口safeParse并使用输出data；没有改公共/helper契约、类型断言或开启transpileOnly。
- 首轮flow 22/23通过，历史组合例invalid_input。原因是测试reason使用公共枚举外的historical_snapshot_missing；按既有snapshot_missing更正合成输入，未放宽生产schema。复跑通过。
- 正常mock结果补齐公共actual/usage，加入schema正例；故意恶意toolRequests仍作为无效供应商结果负例而非合法模型行为。

## 限制与主协调者后续接线

作者自复查，待非作者独立复核。未运行真实DB、HTTP/Guard、文件存储、分布式索引、实际Gateway/router、真实模型、浏览器/微信宿主/真机、外部支付及生产灰度。

授权端口必须来自AIN-04可信principal，不接受请求体context作为授权；内存auth不证明平台权限正确。仓储CAS/版本唯一性/确认提交一致性需真实adapter实现。外部index必须fence operation/version/ACL/generation，失败重试待主任务接线。

前后重验证降低迟到结果风险，但多个await不是跨资源原子授权/租约；若业务要求在最后核对到发送之间也不可撤权，需要主协调者实现版本租约/原子快照或输出提交门控。本片不称完整原子授权。

系统提示防止知识成为代码指令的结构化分离，不证明模型抵御全部提示注入或每条输出事实正确；真实模型评测/输出引用与业务事实校验属后续任务。本文本入口不授予Tools/订单/库存/计费/资金写入能力。敏感附件正文入库前的脱敏/数据政策、真实确认记录、保留/物理删除政策仍需生产边界落实。

仅完成派工S05的内部服务与离线证据，不宣布AIN-10整项、R08/R17或专项28项完成。
