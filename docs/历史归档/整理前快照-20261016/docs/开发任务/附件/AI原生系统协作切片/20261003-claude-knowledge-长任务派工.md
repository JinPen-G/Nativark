# 第二个 Claude 长任务包：知识、来源与结构化记忆（2026-10-03）

负责人可把本文件作为新Claude会话任务提示。依据负责人“让另一个Claude参与，按主开发分配开发”的明确要求，主开发Claude分配知识与记忆线；经负责人转交后生效。阅读主对话只帮助熟悉，不授予主协调权、不接管其代码或公共文档。以下5个里程碑连续推进，每片独立提交后继续下一片，不需逐片等派工。

## 0. 先熟悉与报告，再在明确范围内开工

1. 项目 `D:\工作文件\rental-OS`；阅读适用AGENTS，以及当前专项需求、开发任务、最近实现切片（AIN-02/S03、S09、S10，AIN-03/S01）。读主对话核对用户最新指令，不以旧台账中“仅租户自配”等被覆盖的历史稿为准。
2. **最新产品口径**：平台统一AI + 租户BYOK双轨。新租户默认Rental OS AI，旧配置保留tenant_managed；上层Agent只声明能力，Gateway统一路由；不得固定供应商/模型/Base URL。密钥不进入知识、记忆、模型消息、日志或前端。
3. **当前归属**：主Claude负责shared/OpenAPI/Prisma/迁移、任务运行/租约/审批/授权应用入口和集成。Codex负责网关/router/capability/transport/protocol/config及负责人另授的需求/开发文档。本会话只负责新knowledge子目录及下列测试/记录。不要改两者文件。
4. 建议你自行创建专用worktree：`D:\工作文件\rental-OS\.worktrees\claude-ai-native-knowledge-20261003`，非main分支 `ai/ai-native-knowledge-20261003`，起点 **de6fd4bd900d31569adf1b3276d377e9198fab8d**。派工时该目录/分支不存在，knowledge子目录两边也未占用；开工再次核对。如工具创建不同路径，明确登记实际路径；不要重用主Claude树或Codex树。
5. 只读核对起点及未提交占用，简短报告实际树/branch/HEAD/文件范围，然后直接按本授权开发，无需再让负责人逐项确认。遇所有权冲突只停冲突部分，不强制覆盖。可以读其他树的已提交交接，但不改其内容。
6. 基线含共享C06及相关契约，唯一公共入口是 `@rental-os/shared`：AiKnowledgeDocumentDraft / Chunk / Source / Recall、AiMemoryDraft / Change、AiExecutionContext、AiFactReference、AiGatewayPortDraft / Intent。公共schema已保义发布OpenAPI但仍为draft，不表示真实授权/模型调用已交付。需要扩公共字段时提出最小补丁建议，不私自修改或复制同名DTO。

## 1. 精确文件白名单

可以新建下列 `apps/api/src/modules/ai-native/knowledge/` 内部文件：
- `knowledge.ports.ts`
- `knowledge-errors.ts`
- `knowledge-validation.ts`
- `knowledge-document.service.ts`
- `knowledge-publication.service.ts`
- `knowledge-retrieval.service.ts`
- `knowledge-source.service.ts`
- `knowledge-cache.ts`
- `knowledge-index-coordinator.ts`
- `knowledge-text-parser.ts`
- `structured-memory.service.ts`
- `knowledge-gateway-context.ts`
- `knowledge.module.ts`

测试新建：
- `tests/ai-native-knowledge-lifecycle.test.cjs`
- `tests/ai-native-knowledge-access.test.cjs`
- `tests/ai-native-knowledge-cache.test.cjs`
- `tests/ai-native-knowledge-parser.test.cjs`
- `tests/ai-native-memory-service.test.cjs`
- `tests/ai-native-knowledge-flow.test.cjs`
- `tests/fixtures/ai-native/knowledge-service.cjs`

记录新建：
- `docs/开发任务/附件/AI原生系统协作切片/AIN-10-S01-20261003-claude-knowledge.md` 至 `AIN-10-S05-20261003-claude-knowledge.md`
- `docs/开发任务/附件/AI原生系统协作切片/AIN-10-知识线交接-20261003-claude-knowledge.md`

只新增这些路径，不改旧测试/旧fixture、shared、OpenAPI、Prisma/迁移、package/lock、AppModule、Controller、公共Guard/SecretBox/文件服务、网关、任务/审批模块、前端及三份主文档。内部ports允许定义repo/parser/clock/授权等注入接口，不可伪装成另一套公共协议。若某新文件路径已被另一作者使用，报告并暂缓该文件。

## 2. AIN-10/S01：文档/版本生命周期与受限内部仓储端口

- 先设计明确仓储接口，不用Record<any>万能库，不提供任意SQL或任意URL下载。真实DB adapter交主Claude，本轮只做应用服务+测试替身；生产缺仓储或授权必须fail-closed。
- 复用C06文档/版本/owner/scope/ACL revision与attachmentId，正文来源只接受已授权文件资源引用；不接用户自填filesystem路径、http URL或raw API Key。
- 实现草稿创建、解析请求、发布/撤回/删除tombstone的有界生命周期；乐观revision/不可变版本、重复请求/冲突、失败留证，明确发布与索引ready分开。
- 发布要求解析/索引状态满足且版本未变，不能靠public flag任意开放；过期/撤回/删除默认不可召回。schema合法不等于有权发布。
- 授权回调为必需：每次服务调用根据可信principal和资源重新验证，不把创建时context、文件owner或缓存当永久授权。只表达授权端口契约，不重写原Guard逻辑。
- 删除对话或文档不删除业务事实/订单/资金/合法审计。被引用旧文档版本的保留/删除不能偷偷变更；最少metadata tombstone，留存政策未明确不做生产采集/物理删除。
- 用真实服务方法+内存repo做测试，清楚表明CAS/唯一性是端口预期，不声称真实DB已保证。

## 3. AIN-10/S02：授权检索、来源访问与不泄漏错误

- 候选检索先传服务端scope/ACL约束到repository，返回候选仍校验归属/有效期/状态；禁止先拿跨租户全文发送模型后再过滤。scope不要默认扩大，workspace缺失不回退默认空间，platform不默认读租户内容。
- 同租户不同workspace、operator/staff/client/SaaS/automation隔离；客户只访问明确公开或本人资源，员工按权限/地点约束，角色规则由必需授权端口提供，不猜用户可见范围。
- 正文读取、snippet、来源resolve和下载引用分别重授权。引用ID不是访问令牌；ACL变更后不能沿用旧片段。对越权返回统一不可访问，不泄露隐藏对象是否存在、标题/数量/摘要。
- 复用AiKnowledgeRecallDraft、Source、AiFactReference：实时业务事实不塞进SOP索引，历史snapshot/missing/legacy_current_fallback保持原basis，不“修复”成当前规则。
- 明确ready/no_results/not_ready/failed/unavailable，不把拒绝对象当“全系统无记录”。片段有严格数量/字符上限，结果来源版本可核查。
- 测试允许→撤权、同租户跨空间、平台对租户、员工地点缩小、客户跨人、旧引用、同ID不同scope、不存在与不可访问不泄漏区别。

## 4. AIN-10/S03：有界缓存与撤回/删除传播

- 缓存不能产生授权：每次hit仍调用当前授权与可见性/版本检查。缓存key至少包含scope、主体/身份相关访问key、documentVersion和ACL修订；禁止只按documentId或query全局共享。
- 只有授权后的最少结果允许进入缓存；显式最大entries/字节/TTL，注入clock便于测试，不启后台定时器。0/未配置不能变无限容量。
- 文档withdraw/delete、ACL修订、重新发布/索引变化触发失效；index coordinator用显式版本/operationId接端口，处理重复/乱序请求，不能老索引回写覆盖新tombstone。
- publish/delete与索引异步失败时明确pending/failed，读取仍从真实文档状态门控。不要虚构跨系统事务或“立即删除所有索引成功”；失败待重试/人工出口明确。
- 测试缓存miss/hit、TTL边界、容量淘汰、跨tenant/audience、撤权hit拒绝、撤回传播失败仍不可见、迟到index结果不复活文档。内存测试不是真实分布式一致性验收。

## 5. AIN-10/S04：受限文本解析 + 结构化偏好记忆

- 首批解析只接受明确UTF-8纯文本/Markdown白名单；没有解析器的PDF/Office/图片等报告unsupported，不写假解析成功，不为这些安装新依赖。
- 严格字节/字符/块数/单片段限制，非法UTF-8/空内容/过大输入返回结构化错误；Markdown按文本处理，绝不执行HTML/JS/链接，不自动下载图片或include文件。
- 保留稳定段落/section定位和版本，让Source能回到原文本。不能以文件名字决定身份范围；输入始终untrusted_data。注入文本保留为数据，但不要声称“解析测试通过=模型能抵御所有提示注入”。
- 结构化记忆只处理C06允许的locale/履约地点/display_density等固定偏好；proposed/confirmed/deleted、revision、expiry、owner/scope、confirmationRecordId可核验。
- confirm必须查询服务端真实确认记录并检验actor/scope/content/revision，不接受请求中任意confirmationRecordId就批准；不能存永久授权、密钥、整段聊天或自由JSON。
- 地点偏好不等于业务地点授权，实际业务工具仍重新校验；偏好更改使旧确认失效。修改/删除需要当前owner授权，拒绝跨人/跨租户和重放不一致payload。
- 若公共契约缺确认关联的必需字段，用内部必需port解析/校验，不伪造完整确认实现；记录公共补丁建议交主Claude。

## 6. AIN-10/S05：Gateway上下文拼装 + 真实服务组合测试

- 知识上下文由已授权结果最少化拼装，source引用与文字成对，强制大小/条数上限；不把正文插成system/developer指令，不让文档定义工具/权限/recipient/endpoint。
- 输出使用AiGatewayIntentDraft并声明required/optional能力；不包含provider/model/Base URL/key或审批权。业务事实不足时明确empty/missing，不能凭知识推断库存/价格/退款完成。
- 需要生成文本时只通过注入AiGatewayPortDraft，不直接使用厂商SDK/fetch。测试使用fake Gateway捕获实际入参，不发送模型请求；没有Gateway端口不得假返回自然语言成功。
- `knowledge.module.ts`只提供显式动态模块/工厂和必需端口校验，不加入AppModule/Controller，不启动任务，不给生产提供MemoryRepository/allow-all默认值。
- 真实文档服务+检索+来源+cache+memory组合跑跨租户、撤回、删除、重放、ACL变更、provider不可用、超限、恶意文本。授权端口对请求context伪造/过期的处理规则明确交AIN-04，测试不能把fixture授权当平台授权验收。
- 真正noEmit类型/构建及受影响原契约测试；对scope过滤、撤权cache-hit、确认revision至少有有意义的负例/变异敏感测试，不能只验证fixture字段存在。

## 7. 不可越过的边界与交接

- 不读.env或真实密钥/客户数据；不连数据库、不建库、不执行迁移、不启动服务、不使用真实DNS/网络/模型/支付；不安装依赖，不采购、不部署/启生产、不合main/推送。
- 所有测试在加载项目模块前拦截socket/fetch/DNS，输入合成。使用自己的shared构建及依赖解析；不得修改根目录或主Claude树的node_modules产物。不要用npm exec/npx隐式安装可执行文件。
- 审查/测试分层：静态、类型、服务单元、契约、内存依赖、真实DB、HTTP/Guard、真实模型分别记录。transpileOnly不算类型检查，cache测试不等于授权链路真实通过。基础设施缺失写清，不冒称独立review。
- 每片自己复查和必要回归后提交，主Claude后续独立核验组合；不要自行修改原28项完成率或把AIN-10整体宣布完成。六/五片数量不是验收分母。
- 提交范围只有白名单，每片记录实际HEAD、方法、命令/输出、未运行层级、残留资源、未解决接口建议。所有新的API/DB/前端接线交主Claude协调，不顺手扩范围。
- 完成一片继续下一片；遇权限/公共文件冲突或外部阻塞，继续其他合法工作。最终交付5个SHA、文件清单、测试证据、端口接线清单及后续限制，经负责人转交；不要向主Claude或Codex会话直接发消息。
