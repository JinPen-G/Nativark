# MCP 服务：开发记录

> 专项：Rental OS MCP 服务；建立日期：2026-10-28。
> 正式范围见[需求](MCP服务-需求.md)，研发进度唯一见[开发任务](MCP服务-开发任务.md)，当前现场见[协作接续](MCP服务-协作接续.md)。按功能阶段记录，不复制原AI Native、AGC或AGP历史作为本专项实现。

## 阶段：原对话模型结果的标准只读候选（2026-10-29）

- MCP-06 / 09新增[原结果适配](../../packages/mcp-server/src/conversation-result-read.ts)及独立包子出口，从`@rental-os/shared`正式出口消费ain-conversation-draft-2的modelResult输入 / 完整返回schema与原类型；不修改shared / API / schema / 原Host。固定名称、原reader、原组件补充及外发schema必须由原作者显式提供，构造不自动注册，publication / 原Controller等价authority / 持久accounting / 外发release仍必需。没有HTTP代理、Web token透传、任务 / 模型 / Core写入或新状态机。
- 输入按公共严格schema拒绝身份、reader / 模型 / tool名和未知字段；返回先完整结构校验，再核对conversationId / admissionKey、原request / inputRef / capabilityVersion、taskId及精确resultId。available保留未验证模型文本与候选非批准语义；unknown / failed / stale不补正文、不自动重试。material_erased只准原erased分支、null结果和原Task定位，不恢复材料。原reader仍须负责真实权限、Run / 来源及读前后关联复验，此候选不能替代它。
- 实际发现三个生产前置：①原对话HTTP组合重新解析Web Bearer，没有MCP固定grant到原Guard / ALS适配；②完整结果引用AiOrderExplainRequestDraft / AiOrderExplainInput，当前只有原API组件定义，shared未发布，故只能装配原作者固定组件，缺组件拒绝；③完整Web schema传递依赖使Tools发现超过64 KiB。改为私下校验完整原结果、公告原字段作者的独立闭合投影schema，未删除约束、提高上限或裁剪事实。原Harness校验器仍对真实输入schema报UNSUPPORTED_SCHEMA，不为启用该Host移除限制。
- 既有offline runner执行`node --test --test-name-pattern 'original conversation result|compiled MCP package' tests/mcp-foundation.test.cjs`。日志mcp-original-result-20261029-1～4均退出1，分别暴露缺原组件、隔离编译zod类型路径、SDK JSON Schema扩展类型、完整发现超限及夹具误用active订单状态；定向修正本片适配 / 夹具，保留失败和output。第5轮退出0；最新[收口日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-result-final-20261029-1.log)退出0、2 pass / 0 fail / cancelled / skip / todo。两代真实SDK覆盖三场景unknown / failed / stale、order available、erased、严格输入、原关联错误在release前拒绝、撤回缓存、晚到取消及2,000字符限制不截断。没有生成模型答案或真实DB / HTTP。
- 当前shared全部源和MCP全部源严格编译到私有output，外部NodeNext消费者从shared运行时出口和MCP子出口取得生成声明与产物，不修改public dist / installed client、不复制依赖、不安装 / 更新lock；编译包消费重复相同两代SDK拒绝 / 正常断言。测试原reader / authority / accounting / release为明确替身，外发schema内observation是测试专用透传，不是生产字段政策。原组件在测试只读加载原API定义，不在产品深导入API或伪造同名DTO。
- 本次按负责人“收口，重启电脑”暂停继续开发，源码 / 测试 / 四册及所有失败日志 / 隔离产物留在本树未提交，HEAD仍0f59d1d4、暂存空。重启后先核对归属，再处理原身份 / 发布 / 字段 / 持久计量和正式组件出口，缺前置保持不发布。MCP-01～10原登记0%、正式0/10不变；AGP没有原结果业务消费或全端冻结确认，不向其他会话发消息。未安装 / 启服务 / 外联 / 迁移 / 提交 / 合main / 推送，没有独立审查。

## 阶段：首个Host显式模板消费者（2026-10-29）

Harness已消费原标准Prompts：人主动列表只读目录 / 版本、不发模型；主动选择从同一当前连接取模板，经原Agent空闲维护占用提交一条有来源 / 版本的原用户消息，原Loop与日志可重建。精确Agent / Session、版本 / 完整文字及取消 / 断开 / Agent销毁 / 模型服务移除 / 插件重载拒绝迟到正文，实际实现及失败修正见[插件阶段记录](../Harness插件/Harness插件-开发记录.md)。原offline runner执行`node --test tests/harness-plugin.test.cjs`，[最终日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-explicit-prompts-final-20261029-1.log)退出0、1 pass / 0 fail / cancelled / skip / todo，含当前插件strict / 声明及原Loader / AgentLoop / 官方SDK。没有修改MCP服务源码、另造Prompt发布或自动SystemPrompt；服务端发布 / 前后验权仍由原实现负责，AGP消费不重复计MCP实现。真实政策provider / AS / grant / 原Guard / 字段 / 原计量及生产模板仍缺，真实模型 / GUI未验；MCP-01～10原登记及正式0/10保持，未安装 / 外联 / 迁移 / 提交 / 推送。

## 阶段：可选版本化Prompts与独立Host采用（2026-10-29）

- MCP-03 / 05新增内部`McpPromptsProvider`及`prompts.ts`，通过官方SDK类型化`prompts/list / prompts/get`处理器发布最多50个当前获准模板。原provider按同一可信subject / client / resource / scopes分别过滤目录、读取当前审查文字；获取前后重读发布目录并复核身份，撤回 / 描述或版本变化 / 正文版本不一致 / 缺正文整项拒绝。没有业务参数、reader / Core、Task、云模型或第二批准能力；非空arguments / cursor及未知名称为安全InvalidParams。
- 正文与说明复用原instructions格式和完整2,000字符限制，整包同受15秒 / 64 KiB及返回前身份检查。仅显式provider启用Prompts，未配置不声明；不发布listChanged、Resources、completion或任意提示词代理。标准Prompt user消息不是强制SystemPrompt，现行Harness工具桥不自动读取或采用；Tools / instructions不依赖这项可选能力，未自行批准生产提示词或字段。
- 原offline runner执行`node --test --test-name-pattern 'optional prompts|versioned instructions' tests/mcp-foundation.test.cjs`，[第二轮日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-prompts-20261029-2.log)退出0、2 pass / 0 fail / skip / todo；[6源strict类型](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-prompts-types-20261029-2.log)退出0、0诊断。覆盖真实现代 / 旧版SDK当前列表 / 正文、版本更新 / 撤回、非法参数零正文读取、2,000字符精确与超限、50 / 51项、重复名称、合法单项但完整响应超限503、私密provider错误及迟到取消。
- [当前编译包 / Prompts组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-prompts-artifact-20261029-1.log)退出0、2 pass：从真实包出口编译并加载NodeNext消费者，在两代SDK取得同一版本化Prompt及synthetic只读事实；现代取消单独观察原请求signal中止，旧版关闭端点后观察原shutdown中止，迟到provider完成用屏障等待，没有sleep / 自动重试或放宽限额。[Harness组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-optional-prompts-20261029-1.log)退出0、1 pass，含当前strict编译 / 声明及原Loop / MCP / 材料检查，确认服务端声明Prompts后Tools继续驱动原Loop，Prompt正文零读取 / 零注入。
- 第一轮退出1：取消后立即断言provider signal已中止不适用于旧版stateless，它的取消通知不能中止另一个请求实例。实现补SDK处理器`mcpReq.signal`与原端点signal交集；测试分别验证现代请求取消及旧版原端点关闭，不把客户端取消当远端停止证据。旧请求仍由15秒截止 / shutdown限制，取消不推定未消耗。第一轮类型退出0；失败及全部output保留。补充正文读取后同client / scope但subject变化拒绝503的断言；身份复验后再次检查取消，已取消时不发起provider读取。最新[收口组合日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-prompts-final-20261029-1.log)退出0、2 pass，包含当前全源编译 / NodeNext包出口与两代SDK，不把之前绿色当最新源码证据。
- 当前仅传输 / 发布消费者实现，原政策provider为明确synthetic；真实AS / fixed grant / 原Guard、字段 / 来源 / 用途发布、持久目标和生产模板仍缺。Prompt UI及真实模型采用未验。按原任务G门，MCP-05全项仍缺正式字段 / 来源政策设计，MCP-03固定认证 / 公共业务schema依赖未齐；本子片不按测试数提高完整任务百分比，AGP-01及其余原登记保持。未修改正式需求 / 验收、API / shared / Prisma / lock / 原AGC / Harness / vendor，未安装、启服务、外联、迁移、提交或推送，没有独立审查。

## 阶段：释放JSON不静默改写事实（2026-10-29）

- MCP-05返回包装改为先按普通JSON数据描述符取得一份独立快照，再生成同源文本 / structuredContent；非有限数字、负零、undefined / bigint、自定义对象、getter / toJSON、稀疏数组、隐藏 / symbol字段和循环整项不可用，不执行自定义转换，也不把缺值或异常金额改成null / 零。复用对象引用不等于循环，合法重复事实仍按每份表示计量；2,000字符 / 50条及32,000投影 / 64 KiB整包上限不变。
- 本树shared没有可复用公共JSON快照出口；未安装依赖或借Host util使MCP服务反向依赖整个Harness。此处只验证原release返回的未知JSON材料，不在原业务DTO重建精度工具或金额算法。原字段许可和原reader前置仍未接，严格序列化不是数据释放许可。
- 原offline runner执行`node --test --test-name-pattern 'released JSON|read registration' tests/mcp-foundation.test.cjs`，[JSON释放日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-json-release-20261029-1.log)退出0，2 pass / 0 fail / skip / todo。真实两代SDK覆盖合法重复 / null / 布尔值、11种非法投影整项拒绝、getter / toJSON零调用、无私人错误、原边界及schema仍有效；不是业务金额 / 真实库验收。[5源strict类型日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-json-release-types-20261029-1.log)退出0、0诊断；[Harness消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-json-release-consumer-20261029-1.log)退出0，当前原Loop / SDK / 材料 / 生命周期组合通过，非真实外部业务。
- API / shared / 原AGC / Prisma / lock / vendor未写，没有安装、启服务、外联、迁移、提交或推送。MCP-05正式字段 / 用途 / 来源与期限生产者仍缺，不按包装子片或测试数量提高完整任务档位。

## 阶段：编译包出口与两代SDK消费（2026-10-29）

- 既有MCP测试新增隔离产物路径，按当前`tsconfig / package.json`严格编译全部源码至独立`output/mcp-package-consumer-*`，不写公共dist、复制依赖或更新根lock。NodeNext外部消费者从真实`@rental-os/mcp-server`包出口读取生成声明，消费endpoint / verifier / 内部subject / instructions契约，再加载已编译消费者和包产物；运行阶段不源码转译、不深导入本包src。测试resolver只为该产物的外部SDK进口定位本树既有公开安装。
- 原offline runner执行`node --test --test-name-pattern 'compiled MCP package' tests/mcp-foundation.test.cjs`，[产物消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-package-consumer-20261029-1.log)退出0，1 pass / 0 fail / skip / todo。全源 / 声明strict编译、实际ESM出口、匿名401、可信subject内部消费与现代 / 旧版SDK认证发现、空Tools正常返回通过；无实际业务工具、端口、HTTP外联 / 模型 / 数据库。空列表不当业务成功。随后最新只读产物消费[日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-package-read-consumer-20261029-1.log)退出0，当前严格JSON快照 / 主体引用编译产物经两代SDK实际调用synthetic只读工具，断言冻结主体进入原adapter、释放结果无私人字段；正常投影不是生产字段许可。
- 尚非root依赖安装、tarball / 用户profile分发、真实AS / 原身份 / 持久目标 / 字段 / Core或完整协议验收；MCP-01 / 03 / 10按原连续G门不凭编译产物补齐未交付合同或生产前置。未安装 / 改lock、启服务、迁移、提交、推送或独立审查，全部隔离产物保留。

## 阶段：可信主体引用与响应前同一身份（2026-10-29）

- MCP-02资源验证契约新增必需`subject`，RFC7662返回同一可信AS的`sub`；它不是业务角色、Web token或模型自报actor。该内部不透明主体与token / client / resource / scopes形成不可变请求引用，交给原发布 / authority / accounting / release及instructions provider，避免原适配只能重新解析token或丢失被验证主体。原Guard / ALS映射、固定tenant / workspace / grant及撤销生产者仍未实现，缺前置不开放业务。
- SDK认证对象由本端私有WeakMap关联该引用，不保存token全局索引或额外协议身份字段；本端预先写相同resourceMetadataUrl，避免官方Bearer helper为追加metadata复制认证对象。通过真实两代SDK验证内部引用消费，不改SDK / vendor。注册前、执行前 / 读后和整包返回前比较subject / client / resource / scopes及当前expiry；同client / scopes但subject变化整项拒绝，未发送事实，不能用client一致替代主体一致。
- [定向MCP日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-subject-20261029-1.log)：原offline runner执行`node --test --test-name-pattern 'resource audience|RFC7662|read registration|trusted subjects|versioned instructions|both supported' tests/mcp-foundation.test.cjs`，退出0，6 pass / 0 fail / skip / todo。覆盖必需主体、introspection只输出内部可信字段、两代注册 / 指引provider得到同一冻结引用、发布阶段换主体零reader、投影后换主体安全503且无事实 / 私人主体泄漏；既有有界投影 / 发布撤回与协议亦通过。
- [5源类型日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-subject-types-20261029-1.log)退出0，TypeScript6.0.3 strict noEmit、0诊断。[Harness消费日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-subject-consumer-20261029-1.log)退出0，当前插件strict编译 / 声明、真实Loader / MCP / 原AgentLoop / 材料限制及释放组合通过；测试verifier同步新增synthetic subject，不用假原Guard补生产依赖。
- 此片仅修MCP内部可信身份传递，不增加公共业务DTO、AS实现、持久授权或后台开通，也不更改正式需求 / 原任务验收。MCP-02完整G1固定grant / 原权限设计仍缺，任务不因内部引用或测试数量跨档；API / shared / Prisma / lock及他线成果未写，没有安装、启服务、真实HTTP / DB / 模型、迁移、提交、推送或独立审查。

## 阶段：首个Host模型材料与原日志消费（2026-10-29）

- 本片不改MCP生产者，Harness原AgentLoop用脚本模型驱动已发布只读MCP，再把同源指引及释放事实送入下一轮中立模型请求；原Session事件可序列化重建相同消息。真实Loop / LlmRuntime / Loader及SDK是原实现，模型、HTTP / AS / listener与业务providers为明确外部替身，不代表真实业务授权或模型自主呈现通过。
- AGP从原`llm/stream`接入256 KiB中立材料限制，同一Session在本插件加载时断开后仍检查；原请求保留工具声明 / 调用记录时，重载后无登录 / 无initiator也重新收紧检查，但不恢复授权。LlmRuntime缺失 / 移除同时阻止读工具发布。最新命令、退出0证据及服务组合首轮夹具失败见[插件开发记录](../Harness插件/Harness插件-开发记录.md)，不重复计服务端建设。最终Provider线包、文件 / 图片扩张、目的地、磁盘与跨重启 / fork恢复仍未保证。
- MCP-05只可消费原负责人明确批准的外部释放类别；严格目的地 / 逐次授权 / 强制到期证据缺失继续不可用。原AS / 固定grant / Guard、持久目标与正式字段schema未齐，不以Host局部上限、脚本模型或可重建日志开放生产工具。未安装、启服务、真实HTTP / DB / 模型、迁移、提交或推送，完整任务登记不从消费者证据自动提高。

## 阶段：Harness原工具桥客户端消费（2026-10-29）

- 本轮未改MCP服务端实现，AGP-04复用原公开工具桥 / ToolRuntime / AgentRegistry消费受保护MCP，只读列表 / 调用及当前撤回通过真实SDK。精确Agent / Session绑定、子Agent与旧引用拒绝、无自动重发、在途取消 / 迟到及卸载证据见[插件开发记录](../Harness插件/Harness插件-开发记录.md)，不重复记服务端实现或当成真实原权限通过。
- 首片生产AS / 固定grant / 原Guard / 持久目标 / 字段schema仍未交付，业务不得发布。新发现兼容缺口：Harness原schema子集不支持minimum / minLength等约束，消费者拒绝而非去约束；业务合同须由原作者共同固定，不能在MCP / 插件私造同名DTO绕公共出口。256 KiB模型材料和真实模型 / Host仍未验。
- 本轮只插件源码、manifest、既有测试及两专项记录 / 接续变更；未改API / shared / lock、未安装 / 启服务 / 外联 / 迁移 / 提交或推送。完整G门依赖未齐，MCP / AGP任务登记不因局部消费者绿色自动提高。

## 阶段：字段与列表上限、单份释放快照（2026-10-29）

- MCP-03 / 05只读投影沿正式限制递归检查：每个外发字符串最多2,000字符、数组最多50条，超过整项不可用。先序列化已释放对象为一份JSON快照，再由同一快照生成文本与structuredContent；原provider后续可变对象不造成两份不同结果。投影32,000字节和整包65,536字节检查仍分别保留，不拿字段合法代替当前释放政策，也不允许reader全量读后只过滤输出。
- 原组合只增加必要边界：精确2,000字符 / 50条可返回且text与structured相等，2,001字符 / 51条拒绝；分字段合法但总投影或重复包装超限仍拒绝，真实现代与旧版SDK一致。`node --test --test-name-pattern 'read registration' tests/mcp-foundation.test.cjs`日志`mcp-output-fields-20261029-1.log`退出0；5源strict noEmit日志`mcp-output-fields-types-20261029-1.log`退出0、0诊断。没有扩大回归、删除断言或放宽schema。
- 同一输出schema实例同时用于SDK公告与返回前验证；无效释放结果在本地转安全错误，不能让SDK校验明细回显私人字段。追加非法输出回归后`mcp-output-schema-20261029-1.log`退出0，5源strict noEmit的`mcp-output-schema-types-20261029-1.log`退出0、0诊断；不另写第二套schema或降级放宽。
- 生产原权限、持久目标、字段 / 来源政策和业务schema依旧未接；没有真实目录注册、数据库 / 模型 / 发布或独立审查。源码限制不代表整项验收，任务档位未跨完整门槛；下一入口见接续。

## 阶段：版本化服务器指引与首个Host消费（2026-10-29）

- MCP-05新增内部`instructions` provider，原政策作者交付审查后的当前外发文字 / 版本；未认证不读取，undefined为未发布，坏版本 / 完整2,000字符超限或失败不可用。完整归属 / 版本文字也计入文本上限，并沿15秒 / 64 KiB整包及最终资源复验。没有自行批准字段 / 提示词、注册Prompts / Resources、调用模型或建立任务。
- 真实官方SDK分别从现代discover与旧版initialize取得同一版本；更新读取当前值、撤回不保留、私有provider错误不返回。`node --test --test-name-pattern 'versioned instructions' tests/mcp-foundation.test.cjs`最终日志`mcp-instructions-20261029-3.log`退出0；最新5源strict noEmit日志`mcp-instructions-types-20261029-2.log`退出0、0诊断。此前`mcp-instructions-20261029-1.log`对指引与只读注册两组合退出0。
- AGP使用原`SystemPrompt`消费同源指引，精确Agent及其原Session一致才出现在组装中，更新 / 撤回 / 失败 / 断开 / 卸载处理见[插件记录](../Harness插件/Harness插件-开发记录.md)。实际模型请求持久重建与真实采用未验，不把组装验证当完整模型或数据治理通过。
- 静态收口：`python -I output/harness-oauth-session-20261028-m3kvbehy/check-current-instructions.py current-static-20261029-1.json`退出0：29份当前源码 / 配置 / 文档、106个本地文件链接、9项冻结指纹未变、4份相关offline audit无记录、暂存为空。定向`git diff --check`退出0；全树检查曾报告他线rootlock两行空白，未抢写修正。HEAD仍`0f59d1d4`，未提交。
- 仍缺生产AS / grant、原权限适配、持久目标、发布政策及正式业务schema；MCP-05主投影生产者未齐，不以传输辅助接口提高完整任务档位。后继接真实固定生产者和原工具桥；生产依赖不明确时记录后跳过，不使用占位许可。原需求 / 任务编号和验收不改，未安装、启服务、迁移、提交或推送。

## 阶段：原授权只读注册与完整响应限制（2026-10-29）

- MCP-03注册编排已接官方SDK：每项只读要求原发布 / Controller等价权限与ALS / 持久计量 / 外发投影四个provider，输入和输出使用原作者闭合schema。当前发布过滤列表，缓存名称直接调用仍复验；原权限 → 原计量 → reader → 投影，文本及structuredContent只送投影。没有消费原目录或开放生产Tools，synthetic测试不代替原Guard、持久目标或字段许可。
- 首次认证、工具执行与完整响应共用最长15秒信号；最终整包在发送前再次核验当前资源身份、expiry及scope，最多65,536 UTF-8字节。投影32,000字节只提前拒绝；JSON转义 / 文本 / structuredContent重复超过完整上限返回安全503，不截断成业务成功。资源验证失败、安全错误和缺依赖均不返回原私人资料。
- 实际命令经原offline runner：`node --test --test-name-pattern 'read registration' tests/mcp-foundation.test.cjs`日志`mcp-read-registration-20261029-3.log`退出0，1组合通过，包含真实现代及旧版SDK列表 / 调用、非法输入、发布撤回、权限 / 计量 / 投影顺序、私有字段、投影及重复包装超限、读后身份失效。第二轮所选迟到身份路径通过，整包断言退出1：实际SDK已返回503，但其错误文本不包含状态码；改在HTTP适配直接断言503后复验，未改变生产拒绝或放宽上限。最新`check-types.cjs`日志`mcp-read-tools-types-20261029-2.log`退出0：4源strict noEmit、0诊断。
- 不到G1完整合同门槛：真实AS / 固定grant / 当前原身份适配、持久目标和获准字段schema仍缺，MCP-01 / 02 / 04 / 05 / 06不因注册层或测试数量跨档。原能力映射及公共schema由原作者维护，未抢写API / shared / lock。MCP-03的固定认证出口未齐，注册组合证据不冒充完整装配。下一入口为Harness单连接的原公开工具桥消费，缺完整前置仍不启用真实业务。
- 原临时loopback客户端模式已在真实Loader及外部监听替身验证，详见[插件记录](../Harness插件/Harness插件-开发记录.md)；未实际监听端口、开浏览器、连AS / 数据库 / 模型。没有安装、迁移、提交或推送，没有独立审查或正式验收。

## 阶段：固定AS资源身份验证与取消（2026-10-29）

- `packages/mcp-server`新增RFC7662 introspection verifier，经固定HTTPS AS端点、显式客户端认证和client / scope白名单，每次请求重新读取active / issuer / 单resource audience / subject / expiry，不缓存有效身份，不发行token、不映射或绕开原业务Guard。AS提供当前grant / client / tenant停用证据仍是生产依赖；缺失不开放业务。
- 原`ResourceTokenVerifier`增可选signal，兼容旧单参数消费者；入口转发请求 / 关闭 / 截止信号，新适配拒绝迟到结果并取消有界读取。安全错误区分invalid401与证据不可用500，未知异常仍不输出AS正文、凭据或subject。配置与HTTP边界拒绝重定向 / 超限 / 重试，无环境读取或新依赖。
- `node --test tests/mcp-foundation.test.cjs`经既有offline runner，日志`mcp-introspection-20261029-1.log`退出0，11 pass / 0 fail / skip / todo；真实官方SDK运输与新增当前active / 无缓存 / allowlist / 拒绝 / 字节 / 取消路径通过。私有`check-types.cjs`对3源strict noEmit退出0；实际日志`mcp-introspection-types-20261029-1.log`。插件既有Loader消费在MCP出口拆分后复验日志`harness-oauth-introspection-consumer-20261029-1.log`退出0。全部仅HTTP进程内替身，不是生产AS / 真库授权验收。
- 本片完成资源认证适配，未接原Guard / fixed grant / 后台政策 / 持久目标准入 / 字段目录，不把认证当业务授权。客户端Token私有内存边界沿前阶段；原API / shared / lock / AGC / Harness源码不改。没有安装、启服务、迁移、提交或推送。继续无阻塞的工具注册 / 版本化安全输出接点，实际业务仍要求全部原生产者。

## 阶段：首个客户端OAuth标准连接（2026-10-29）

- Harness已实现私有进程内OAuth / S256 / callback / exchange / 单refresh / 原session绑定和专用官方SDK握手，禁止自动重新授权 / 重发，没有业务工具。真实Loader与外部HTTP / 浏览器 / listener替身通过，详见[插件记录](../Harness插件/Harness插件-开发记录.md)；不是Rental AS / grant或服务端身份完成。
- `packages/mcp-server`仍未接真实AS和grant，原公共Auth / Guard / schema / 装配归服务端作者。本轮不伪造授权、不写共享凭据，后继先补可独立实现的资源验证与取消 / 当前身份交付，再按明确归属接原权限；MCP计量 / 字段 / 业务工具依赖不跳过。用户持续目标允许记录问题后做无阻塞项，不自动授予安装 / 迁移 / 真实联调或公共文件抢写。

## 阶段：授权前置核验与生产者缺口（2026-10-28）

- Harness消费者新增标准OAuth元数据核验命令，检查明确配置的issuer、public client回调格式、S256 / scope和精确端点，结果不代表远端登记或grant有效。官方SDK的RFC8414 / OIDC读取、拒绝与取消已通过真实Loader离线组合；完整命令 / 退出码见[插件记录](../Harness插件/Harness插件-开发记录.md)。原MCP基础9/9回归通过，`packages/mcp-server/`本轮没有修改，不计新增服务端实现。
- 原`AuthService.resolveAccessContext`仍从Web session取当前空间；`ApiAuthGuard`及内部业务authority会再次验Web身份。当前未找到MCP OAuth AS / grant持久化，已有Web token不作替代；Auth / Guard / schema / 公共装配继续由原服务端作者持有，本轮未接管。
- Harness原HTTP transport缺动态OAuth注入点，默认credentials文件和共享读取接口不足以隔离通用工具。本轮不造私有API、假AS或静态token演示。MCP-02真实AS / 固定grant / 当前身份适配、AGP安全凭据与单连接接点仍为联合阻塞，不能只承诺下一轮补登录而继续堆检查器。未安装、启服务、连外部环境、迁移、提交或推送，任务登记不变。

## 阶段：Harness消费者接入原Bundle与Loader（2026-10-28）

- 本轮沿原MCP统一通路，只推进Harness消费者：独立Bundle / patch / Loader四项导出及原人类命令`/rental`接入，配置 / 检查反馈不进模型，仍仅登录前发现而非OAuth或业务授权。`packages/mcp-server/`及`tests/mcp-foundation.test.cjs`保持上片实现，没有新开MCP能力或借Web凭据。
- 真实profile解析、Loader、CommandRuntime、SessionStore与编译包消费验证通过；HTTP和正向身份仍是进程内替身，没有端口 / GUI / 真实服务。完整命令与失败 / 通过、产物和未验边界见[插件开发记录](../Harness插件/Harness插件-开发记录.md)，不重复记服务端进度。
- MCP下一缺口仍为原OAuth / grant / 当前Guard、正式字段释放及持久目标计量；不能把Bundle可加载、空Tools或发现成功当作授权已完成。未安装依赖、改根锁、修改并行API / shared / OpenAPI、迁移、提交或推送。

## 阶段：受保护MCP协议入口与登录前发现（2026-10-28）

- 负责人明确开始按两专项文档推进开发。本片新增独立`packages/mcp-server/`和`clients/harness-plugin/`接入模块及一份`tests/mcp-foundation.test.cjs`，不修改正在并行写入的API装配、Guard、shared出口、OpenAPI或根锁文件。原AGC与6项暂停客户端WIP保持，开工指纹在`output/mcp-foundation-20261028-9j4ghqjm/`。
- 服务端使用本树已有官方`@modelcontextprotocol/server` 2.2.0，提供不监听端口的`createProtectedMcpEndpoint().fetch(Request)`：显式开关、HTTPS / 精确路径 / Origin、标准Bearer挑战、RFC9728资源元数据、resource / 到期复核、请求字节上限和取消 / 关闭后的迟到拒绝。未提供原身份验证器返回503；不伪造AS元数据、不发行token、不提供业务工具，认证后的空Tools只验证标准运输。
- 客户端使用官方client 2.2.0解析资源发现，限制到配置资源和精确metadata地址、预期issuer及header凭据方式；不带凭据、禁止重定向 / 额外回退、限制声明和流式字节、取消释放读取。成功只为`authorization_required`，未取得登录或业务资格。
- 已核对原Auth / Guard / ALS和目录路径：现有Web会话由session当前空间决定，业务reader权威入口还会再次解析Web凭据；不能用MCP token伪装operator或仅填ALS。原`AiCatalogReadFactsService` / `listItemGroupsPage`可后续复用，但MCP grant、正式外部字段政策和原持久目标计量仍未接通，因此不注册目录工具、不借原`human_preview / not_sent`许可。
- 仅新package声明固定SDK / TypeScript6.0.3 / Node类型22.20.1，未安装或更新根lock；当前不是root工作区安装 / 产物就绪。测试与私有类型检查明确从本树Harness已安装SDK解析，生产源仅按包出口导入，没有复制生成物或相邻源码深层运行依赖。`clients/harness-plugin`尚无Bundle manifest或原Host注册，不称已可安装。

### 实际验证

全部Node命令经已有`output/agent-desktop-install-20261023-q16gtnf6/run-offline.py`，固定Node24.21.0、原offline preload / 无效DATABASE_URL及本树绝对audit / TEMP / cache。HTTP使用`Request / Response`进程内适配，无socket、DNS、数据库或模型调用；正向身份为明确synthetic verifier，不是生产授权。

- `node --test tests/mcp-foundation.test.cjs`首轮退出1：根实际TypeScript7.0.2不再提供旧compiler API，测试transpile入口失败；改用已有Harness TypeScript6.0.3后第二轮8 pass / 0 fail / 0 skip / 0 todo，退出0。首轮失败保留，未修改权限或断言变绿。
- 后续仅复验修改范围：`node --test --test-name-pattern 'refuses disabled|standard challenge|negotiates both|client metadata stream' tests/mcp-foundation.test.cjs`为4 pass；进一步关闭Promise / 字节上限捕获后，`--test-name-pattern 'late identity|client discovery rejects|client metadata stream'`为3 pass，均退出0。新增流取消用明确开始 / 结束信号，无固定sleep。真实官方SDK分别断言协商2026-07-28和2025-11-25、空Tools及业务调用拒绝，不是手写协议替身。
- `node output/mcp-foundation-20261028-9j4ghqjm/check-types.cjs`最终两个真实源根strict noEmit、0诊断，TypeScript6.0.3，退出0；只做私有解析映射，不覆盖公共dist。日志为既有安装目录`logs/mcp-foundation-*.log`，本片audit日志未产生拒绝记录。中间SDK json模式提示已通过使用原auto响应模式消除，不是隐藏日志。

### 尚未完成

未装配到API监听器、未建立原OAuth AS / grant / 后台治理、未接原权限链或安全凭据存储，未接原业务工具 / 累计计量 / 字段许可，也未完成真实Harness连接或Bundle安装。验证器等待有界且迟到拒绝，不意味着不合作的验证器或HTTP适配已真正停止；生产仍须补真实截止与清理。

下一片为MCP-02原OAuth / grant与Controller等价授权的实际适配，同时衔接AGP-03安全凭据 / 原连接入口；原公共文件仍须核对归属，不能替他线写入。尚未达到MCP-01或AGP-01整个G1范围，不改任务0% / 正式0/10。未安装、启服务、读环境、联网、迁移、提交或推送；没有独立安全审查或生产验收。

## 阶段：MCP优先与Harness联合首片立项（2026-10-28）

- 负责人在确认“插件授权 / 数据 / 提示词、Harness自主呈现”之后，明确采用MCP共建方向并要求同步插件和MCP的需求 / 开发文档。新建`docs/MCP服务/`四册v1.0；插件两册升v1.1，MCP首片优先、Harness首个客户端，原AGC两册和历史继续封存。
- 服务端协议、OAuth / grant / 后台、现行工具 / 字段投影、原目标计量与业务适配统一归MCP-01～10及原作者。AGP仍保留01～10，但只负责Host消费、必要连接授权适配、会话指引和原生呈现，不另造私有业务API或重复native工具。两专项首片共同安排、验收分母独立，登记均为0% / 0/10，不以此立项计进度。
- 原`docs/Agent接入改造/MCP服务-接入方案.md`v0.3研究正文原样保留，头部增加当前依据指向；其P1～P7仅历史建议，正式映射见本册任务。旧协议 / 客户端命令沿当时研究解释，本轮没有联网复查或执行。
- 只读核对Harness原`mcp-client` README、transport和instructions接点：已有标准运输 / tools / instructions，但所读HTTP工厂仅传config.headers；不能宣称OAuth / 安全refresh、凭据及当前业务限额已满足。已把原生优先、只补必要标准MCP客户端适配、单驱动及SDK重试核查列为联合任务，不为演示复制Web token。
- 明确服务端输出与Host整体模型上下文的控制范围：MCP保证自身64 KiB结果及服务端累计；Harness可控组装仍有256 KiB门槛，不假称MCP可计量任意Host全部上下文。Tools / instructions / 可选Prompts分开，Prompts不保证自动加载，模型忽略指引仍不得越权。
- 本轮工作树基线`0f59d1d4`，开工暂存为空且无合并 / 摘取中状态。前像与指纹保全在`output/mcp-first-docs-20261028-e3npzky8/`；原AGC五份文档和暂停客户端六项源码 / 测试不修改，不接管同树API / shared / OpenAPI / tests / 依赖及AI Native文档WIP。

### 文档核查

- `python -I output/mcp-first-docs-20261028-e3npzky8/check-docs.py static-check-2.json`退出0：10份文档、152个本地链接 / 3个锚点有效，两专项各10项需求 / 任务 / 验收编号连续，包含阶段追加条件的20项依赖图无环；11项冻结文件、6份前像、原AGC两册v1.5指纹及旧MCP研究正文 / 插件历史保持。
- 首轮`static-check.json`退出1：检查脚本用字面短语匹配漏掉需求中的同义表达，且依赖解析未完整识别紧邻中文的编号和跨专项省略前缀。修正脚本并将一处阶段依赖明确写为`AGP-08`后复核通过，没有为变绿删除需求或放宽业务规则。
- `git diff --check -- docs/Harness插件 docs/MCP服务 docs/Agent接入改造/MCP服务-接入方案.md docs/文档导航.md`退出0，Git仅提示后续LF / CRLF转换；未跟踪的新文档已由Python逐文件检查，不用Git忽略未跟踪内容代替验证。未作独立审查或产品验收。

### 已做与剩余

已完成正式文档和职责 / 依赖设计。尚无本专项MCP Server、OAuth / grant生产者、Host授权适配、实际业务工具或跨Host验收；下一实现从MCP-01 / AGP-01固定合同，接02～06适用只读安全链及Harness消费者，不开始报价 / 建单或开放字段。

本阶段仅文档核查；未安装依赖、修改产品源码、启服务、读取环境、连接真实HTTP / DB / 模型、执行迁移、提交或推送。不是独立安全审查、正式业务验收或上线许可。
