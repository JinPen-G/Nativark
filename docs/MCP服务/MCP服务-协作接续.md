# MCP 服务：当前协作接续

> 专项：Rental OS MCP 服务；更新时间：2026-11-01。
> 当前状态：负责人最新要求“你先收口”，本会话已停写功能，仅完成现场接续；持续目标尚未完成，恢复开发须负责人明确授权。精确原对话操作收据、原对话有界分页、Task / 步骤恢复观察及原结果只读候选已沿编译包 / 原reader定向验证。固定grant到原身份、持久目标和字段政策仍未接通，业务首片未闭合；缺收据和恢复指引不授权执行 / 取消 / 重发，不接主线活动releaseUnstarted增量。依据为[需求v1.0](MCP服务-需求.md)与[开发任务v1.0](MCP服务-开发任务.md)，实际证据 / 未验边界见[开发记录](MCP服务-开发记录.md)。目标不授予主树写权，安装、服务、真实联调、迁移、提交或发布仍须明确授权。
> Harness消费者见[插件接续](../Harness插件/Harness插件-协作接续.md)。原「Agent接入改造」v1.5及源码仍封存保留，未恢复实施。

## 1. 当前决定

1. 标准MCP从第一片就是Harness业务通路，不做“插件专用API先行、MCP以后套壳”。服务端身份 / grant、后台治理、字段投影、原计量、业务映射和说明只实现一次；不同client独立授权，不共用token。
2. Harness先核对原生直连，Rental插件只补必要OAuth / 凭据、连接与会话 / 空间、提示词体验，不重复注册业务工具。原生足够不强制安装插件；不足仍经标准MCP，不用Web token或明文静态headers兜底。
3. 服务端给事实、工具和版本化业务指引，Harness及其他Agent自主分析 / 呈现。Tools描述 / server instructions / 可选Prompts各有采用边界，不能假设Prompts自动成为系统提示词；不另造固定业务卡片或renderer。
4. 权限、字段、当前对象、资源和必要批准由原服务端执行；提示词忽略或模型生成页面不能扩大权力。原可信Web负责真实选择 / 正式核对，Core及原执行器负责正式结果。
5. 查询不暗中发云模型，本地模型各用户自配自付；有限云任务沿原Gateway / 单账，原Web / 官网 / 小程序 / 巡检 / 协作继续并行。

## 2. 现场与证据边界

| 项目 | 当前现场 |
| --- | --- |
| 工作树 | `D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation` |
| 分支 / HEAD | `ai/ai-native-contracts-s01-20261002` / `69c6c89e`，只定位不作reset / 追HEAD同步目标 |
| Git状态 | 当前核对暂存为空，无MERGE_HEAD / CHERRY_PICK_HEAD；之前成果已由整合线在0864c097 / 088153af保全整合。本批MCP适配 / 快照、对应测试和说明 / 两专项记录接续留未提交；同树可有其他作者，接手仍重核归属，不抢写公共文件 |
| 文档 | 本专项四册v1.0；MCP-01～10登记0%，正式0/10，不能用文档或旧SDK依赖计完成 |
| 当前实现 | `packages/mcp-server/service`已统一装配原同意 / 同仓储的AS控制面与MCP资源入口，原宿主仍须供给生产者、TLS / API与业务权限；不监听或读环境。`packages/mcp-server/`提供受保护fetch / RFC9728 / 标准挑战、固定AS introspection、可注入原发布 / 权限 / 持久计量 / 投影的只读注册、版本化instructions / 可选Prompts、精确text/plain Resources与15秒 / 64 KiB完整响应限制。conversation-result-read、original-task-recovery-read、conversation-operation-read、conversation-list-read、quote-selection-read、selected-proposal-read及selected-order-result-read子出口捕获普通JSON输入 / 完整观察快照，经公共schema / 原关联校验后交原release，构造不发布。authorization-server-metadata、public-client-authorization / endpoint、authorization-code-binding及oauth-token-endpoint子出口提供当前AS元数据 / 登记预检查、标准回调、原码S256绑定与token / 撤销控制面；persistent-oauth-tokens提供原事务码消费 / refresh轮换撤销与当前资源回读主实现，原store / grant仍需生产适配；capability-mapping子出口固定七项原业务码到运输名，四读与报价 / 提案保存 / 原批准建单分开，映射不注册或授权；包内共用原schema装配不删约束，编译包已在离线夹具执行原对话 / 结果服务 / artifact和原Task恢复状态读取；无生产API装配、MCP固定身份 / grant、持久计量 / 字段生产者或业务发布 |
| Harness已读接点 | 原mcp-client有发现 / tools / resources / instructions及Streamable HTTP；所读transport仅配置headers，OAuth / refresh / 安全凭据及业务重试仍待真实消费核验 |
| 旧研究 | 原MCP v0.3正文继续留原路径作为研究历史，当前正式任务已独立，不再执行旧P1～P7建议表 |
| 本轮范围 | 本树MCP / Harness插件及既有对应测试和两专项说明 / 记录 / 接续；已交Resources消费、0.1.1候选、协议固定及输入错误安全外发均已记录；负责人要求收口后停止功能写入。本次原批准执行接点仅只读核查，未新增源码 / 测试，未接Core直调。两份停写前像在[收口保全](../../output/mcp-harness-paused-20261101-2i71e_s2/)，全部旧产物保留。不写主树、API / Guard / Core / 支付、知识附件 / 文件存储、shared / OpenAPI / lock、后台 / 租户官网或原AGC冻结成果 |
| 保全与证据 | 输入错误片七份前像在[保全目录](../../output/mcp-input-error-closeout-20261031-hthswluh/)，旧协议 / Resources / 插件前像与全部output保留。[修前错误外发](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-input-error-before-20261031-1.log)退出1、1 fail，SDK错误实际回显输入字段路径；[修后源码 / 正式ESM](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-input-error-fixed-20261031-1.log)退出0、3 pass，含全MCP / shared strict、协议固定及既有原reader / OAuth / Resources组合。插件源码未改，0.1.1包 / 原Loader证据见插件记录，未重复正常Host回归。原providers仍为外部夹具，非生产Guard / 字段或持久计量；实际Tools schema仍拒绝，无用户原版安装或业务开放。静态 / 冻结 / audit结果文件为`output/harness-oauth-session-20261028-m3kvbehy/mcp-input-error-static-20261031-1.json` |

本树官方SDK2.2.0已通过进程内2026-07-28及2025-11-25发现 / Tools / 拒绝行为；实例显式固定两代，未声明请求版本头拒绝 / 零reader，旧initialize仅反提议声明旧版。不是完整协议一致性验收。原版Harness Host、真实OAuth / 数据库 / 模型与生产部署未验。本包依赖未安装、根lock未更新，测试明确使用既有Harness SDK，不能当root安装 / 产物就绪。

## 3. 恢复后的实施入口

MCP-01 / AGP-01协议与发现已有代码及真实SDK证据，OAuth客户端已有授权码 / S256 / 单refresh到握手的离线组合；不是生产登录或grant。MCP-03只读注册已经过真实两代SDK验证，完整重复包装超限实际503、私有字段不返回、旧缓存撤回拒绝及读后身份失效已覆盖。输入校验保留完整schema / 原validator，失败issues只给安全说明；拒绝路径不进原权限 / 计量 / reader，SDK不再回显调用方字段路径。七项原业务码的运输映射及原R0 / R1 / R2已有固定子出口及两代SDK / 原Host名称消费证据，当前原工具 / schema版本不能以映射或历史baseline版本替代；完整client / 工具字段 / 材料合同和固定原身份生产者仍未齐，阶段证据及未跨档门槛见开发记录。

原宿主下一装配入口为[createRentalMcpService](../../packages/mcp-server/src/service.ts)，以同一原serializable仓储连接控制面 / 资源验证，固定端点 / scope与close取消；目前没有原生产登记 / Web同意 / grant / 当前Guard / 目标 / 字段适配，不因构造器存在开放。MCP-02已有authorization-server-metadata当前AS的RFC8414受控发布、public-client-authorization预检查 / public-client-authorization-endpoint标准code或denial回调及oauth-token-endpoint交换 / refresh / 撤销运输子出口；后者只调用一次原AS，严格输出、返回前复验当前登记，停用 / 过期client仍可请求原AS撤销已知token。取消或登记变化不证明签发回滚，不重发。persistent-oauth-authorization已补原已完成可信同意后的唯一随机码 / 原授权摘要关联，persistent-oauth-tokens补原事务内码消费 / token摘要存储 / refresh轮换复用撤销及当前access回读；存储锁 / CAS、原同意 / grant / 当前权限由外部owner必需注入，无默认store、grant创建或同意页。access存在但family记录缺失保持unavailable；原grant authority的undefined只表示已确认无当前grant，证据不可读必须拒绝而非伪称失效。原生产仓储 / OAuth AS登录同意 / 固定grant及当前Guard / ALS仍缺真实生产者，公共Auth / Guard由原服务端作者维护，不接管或用Web可变session替代。当前RFC7662固定AS introspection无active缓存，必需可信subject与client / scope / audience / expiry复核及请求取消转发；内部不可变主体引用交原providers消费，两代SDK已验证。同client / scopes而subject变化在发布 / 读后 / 返回前仍拒绝；这不映射业务身份或开工具。客户端已用私有进程内OAuth / 单refresh / 原session绑定连接官方SDK，未改原Host / credentials；实际原版安装、纯Electron回调、长期安全凭据与真实AS仍未验。

可选Resources已补当前精确URI目录和text/plain说明 / 原结果文字引用的标准读路径，原权限 / 持久计量 / release缺一拒绝，返回前复验描述符及资源身份，现代零TTL、不支持模板 / 订阅 / 通知；实际源码 / 正式ESM两代SDK证据见开发记录。当前没有生产资源发布。插件已沿同一私有连接显式列目录 / 按名称选择资源，以普通有来源消息交原maintenance / inbox / Loop；精确Agent / Session、取消 / 断开 / 重载 / 模型服务移除及来源重建后的材料上限已有原Loader证据。原Harness公开mcpResources.register的继承式provider未注册，模型自主资源访问、最终Provider线包 / 目的地及全部重放仍缺控制证据。不将资源形式包装原业务绕Tools schema或前台目标准入；首片仍以目录Tools为目标，不等可选Resources才交付。

恢复实施后沿原持续目标推进；当前收口暂停，不因问题记录或Stop hook转做新项。版本化instructions及可选Prompts已通过真实两代SDK / 编译包出口，当前均以synthetic政策provider验证，生产审查文字未交付；Prompts只提供无业务参数的当前起步指引，不自动成为Host SystemPrompt，缺许可 / 撤回 / 版本冲突拒绝。Harness已接显式人类列表 / 选择：列表零正文 / 模型，选择形成一条有来源 / 版本的原用户消息，取消 / 断开 / Agent销毁 / 重载 / 模型服务移除的未提交迟到正文拒绝；消费与日志证据见插件记录，不重复记MCP实现或生产进度。Harness原SystemPrompt已验证精确Agent / Session消费、更新、撤回和释放；当前无生产批准文字。Harness原公开MCP工具桥已接只读消费和精确Agent / Session释放，真实业务provider仍缺；原AgentLoop / MCP续轮、中立模型材料256 KiB及同一Session断开后检查已有离线证据；最终Provider线包 / 目的地、磁盘 / fork / 跨重启仍未保证。下一入口为固定原身份 / 发布 / 字段 / 持久目标生产者及所需发送 / 恢复控制，缺前置不开放真实业务，不以synthetic provider或本地Map补齐，不重复native通路。

原结果候选的当前入口为[conversation-result-read](../../packages/mcp-server/src/conversation-result-read.ts)，验证为[既有测试](../../tests/mcp-foundation.test.cjs)的original conversation result / compiled MCP package。当前普通JSON快照先于异步校验，原私有输入32 KiB / 完整结果128 KiB与后续外发上限分离；编译包实际调用原对话应用和原scene / artifact reader，unknown空正文、哈希 / Run错配、换用户 / 空间及读后失权拒绝，读取前后状态无变化。原Web身份 / 数据库与MCP发布 / 权限 / 计量 / 释放仍是明确夹具，API执行为transpileOnly，不是生产身份或API严格类型证据。当前缺项：MCP到原Guard / ALS的固定身份出口；AiOrderExplainRequestDraft / Input原组件正式供给；原字段作者闭合投影schema / 来源 / 期限及持久目标准入。完整Web schema发现超64 KiB，不能裁剪原事实迁就发现；Harness原校验器不支持实际输入部分约束，保持拒绝 / 不发布，不宣称全端冻结。原Reader仍负责Run / 来源 / 当前权限复验，不接管API / shared作者或主树Core / 支付整改。

原Task恢复观察候选入口为[original-task-recovery-read](../../packages/mcp-server/src/original-task-recovery-read.ts)，只消费原请求引用与AI_SCENE_REQUEST_HTTP_CONTRACTS.recovery，不接Task / Run选择或恢复动作。缺Task不推定未执行，unknown保留原action与核对指引；原返回没有inputRef，关联须由原reader复验。两代SDK / 编译包已实际调用原request-bound readRecovery / Task权限与步骤查询，哈希 / 跨用户空间 / 读后失权拒绝且状态不变。生产固定身份 / 字段 / 持久目标及实际Host支持仍缺，不发布；主线审批v2 / releaseUnstarted等活动增量只作待核验通知，不追活动HEAD或修改公共契约。

精确原操作收据候选见[conversation-operation-read](../../packages/mcp-server/src/conversation-operation-read.ts)，只按operationKey读取原operation契约并核对返回原键。当前两代SDK / 编译包实际调用原readOperation仓储，正常 / not_observed和读后失权拒绝无存储变更；缺收据不重发，Host schema与生产前置仍未齐。[原操作验证日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-operation-20261031-1.log)退出0、2 pass，含三项候选与MCP / shared strict。[原对话list候选](../../packages/mcp-server/src/conversation-list-read.ts)亦已沿两代SDK验证单页1～20条、原游标、无总量语义与读后失权；[分页日志](../../output/agent-desktop-install-20261023-q16gtnf6/logs/mcp-original-page-20261031-1.log)退出0、2 pass，包含四项候选与当前全源编译。它不是本人业务操作索引完成。下一入口为04持久目标、05正式字段政策及06原有界目录，AGP-04～07消费，两侧10收集真实首片证据。当前原只读候选构造时固定reader，修改binding.read不改变已构造执行者；端点工具定义 / schema及provider方法亦固定，原当前政策仍逐次读取。instructions / Prompts的原方法同样固定，获准字段在异步复验前按普通JSON数据描述符形成快照，getter / 继承字段 / 对象字符串转换拒绝，动态发布 / 撤回仍逐次读取。目录首片尚缺原API持有的aiCatalogReadInputSchema / AiCatalogReadProjection公共运行时出口与正式外发合同，不复用旧human_preview / not_sent。Host原名超过48字符的公开命名映射出口也未交付，不深导入或私造规则。根依赖 / lock与API装配需要另核授权和写入归属，不因本片绕开它们就宣称已集成。

原可信选择收据候选见[quote-selection-read](../../packages/mcp-server/src/quote-selection-read.ts)，只消费原read / selectionId / inputRef，保留selected_not_approved / expired / superseded及not_granted，不保存、查询个人候选或替人选择。原请求绑定仓储已沿正式ESM验证关联 / hash、跨用户 / 空间及查询后失权拒绝、存储不变；字段 / 持久目标 / 固定MCP身份及Host schema仍缺，不注册，完整选择报价链未完成。

原选单提案候选见[selected-proposal-read](../../packages/mcp-server/src/selected-proposal-read.ts)，只读原选择 / proposal修订与hash，不提供决定 / lease / 执行；原请求绑定审批reader的Core金额 / 币种、旧修订、跨用户 / 空间及查后失权已有正式ESM证据，存储不变。私有scope / snapshot不自动外发，字段 / 计量 / 固定身份仍缺、Host schema拒绝，未注册或作为完整报价提案验收。

原选单执行结果候选见[selected-order-result-read](../../packages/mcp-server/src/selected-order-result-read.ts)，只消费原readResult / 选择证明，不接可能取得执行lease的reconcile。原Task / 批准消费 / Core收据关联已沿正式ESM实际验证，unknown / not_observed不重发，原用户 / 空间、selection / Run / 哈希及读后失权拒绝、存储不变；原Web / DB为夹具、API为transpileOnly。Host仍不支持实际schema，不注册；MCP固定身份 / 字段 / 持久目标和完整批准执行 / 云发起仍缺，详细证据见开发记录。

原Task资源calls只计Gateway invocation，确定性读沿steps / active_ms / output_bytes且写入需Run lease；不能将该账本冒充MCP业务调用累计，不能交lease给客户端。当前仍需原作者固定前台持久目标 / 调用关联和四类计量，缺项不接local Map或重新initialize。

首片目标：后台开通 → OAuth同意 → Harness会话绑定 → Tools发现 / 目录调用 → 自主安全结果 → 撤权、过期和越权拒绝。不等报价 / 建单、可选Prompts / Resources或全部其他Host；这些后续仍按任务验收，不从整体范围删除。

固定公共合同必须来自原唯一作者；MCP生产者不依赖整个插件工程，AGP不反向重写服务端。并行须独立工作树。任何真实依赖未齐按对应能力不可用处理，不用恒真身份、空成功或静态token冒充闭环。

## 4. 接手限制

先读根[AGENTS](../../AGENTS.md)、[README](../../README.md)、本专项四册及插件当前接续；修改后端 / shared / 后台 / Harness前读其具体规则、消费者和验证入口。旧AGC暂停不因本接续解除。

负责人2026-11-01要求先收口，当前功能开发暂停；旧持续目标和Stop hook不自动恢复写入。恢复后仍须核对本树并行归属，安装、启服务、读取环境、真实HTTP / DNS / DB / 模型、迁移、提交、合main、推送、签名或发布均不在当前授权内。不向其他对话发消息、不建心跳、不抢写同树公共文件、不清理任何未确认成果。
