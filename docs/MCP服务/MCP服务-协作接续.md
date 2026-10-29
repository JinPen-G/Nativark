# MCP 服务：当前协作接续

> 专项：Rental OS MCP 服务；更新时间：2026-10-29。
> 当前状态：负责人于2026-10-29要求收口并重启电脑，本片已保全，暂停新实现；恢复后先核对本树现场与写入归属。受保护运输、固定AS introspection、原授权只读注册、普通JSON快照 / 字段 / 完整响应限制、同源instructions及可选版本化Prompts已有离线证据；真实生产者尚未接通，业务首片未闭合。依据为[需求v1.0](MCP服务-需求.md)与[开发任务v1.0](MCP服务-开发任务.md)，实际验证见[开发记录](MCP服务-开发记录.md)。开发授权不扩展到安装、启服务、真实联调、迁移或发布。
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
| 分支 / HEAD | `ai/ai-native-contracts-s01-20261002` / `0f59d1d4`，只定位不作reset目标 |
| Git状态 | 开工暂存为空，无MERGE_HEAD / CHERRY_PICK_HEAD；同树服务端作者仍有API / shared / OpenAPI / tests / 依赖 / AI Native文档WIP，接手须重新核对 |
| 文档 | 本专项四册v1.0；MCP-01～10登记0%，正式0/10，不能用文档或旧SDK依赖计完成 |
| 当前实现 | `packages/mcp-server/`提供受保护fetch / RFC9728 / 标准挑战、固定AS introspection、可注入原发布 / 权限 / 持久计量 / 投影的只读注册、版本化instructions / 可选Prompts及15秒 / 64 KiB完整响应限制。客户端私有内存OAuth、一次refresh、原session和host / 临时loopback回调已有Loader离线证据。另有conversation-result-read子出口，消费shared原对话modelResult并校验原关联后交原release，构造不发布；无API装配、生产AS / 固定grant / 真实原业务适配或实际业务发布 |
| Harness已读接点 | 原mcp-client有发现 / tools / resources / instructions及Streamable HTTP；所读transport仅配置headers，OAuth / refresh / 安全凭据及业务重试仍待真实消费核验 |
| 旧研究 | 原MCP v0.3正文继续留原路径作为研究历史，当前正式任务已独立，不再执行旧P1～P7建议表 |
| 本轮范围 | 新`packages/mcp-server/`、`clients/harness-plugin/`、`tests/mcp-foundation.test.cjs`及两专项记录 / 接续；未改API公共装配、Guard、shared出口、根lock、原AGC或6项暂停客户端WIP |
| 保全与证据 | 改向前像继续保留在`output/mcp-first-docs-20261028-e3npzky8/`；当前`output/harness-oauth-session-20261028-m3kvbehy/restart-closeout-static-20261029-1.json`核对34文件 / 145本地链接 / 9项冻结 / audit无记录 / 暂存空；原结果最新mcp-original-result-final-20261029-1.log退出0、2 pass，源码 / private编译 / 正式出口通过；最新6源strict类型及主体 / 只读 / 指引SDK证据见开发记录。隔离编译包出口 / NodeNext消费者 / 两代SDK日志为`mcp-prompts-final-20261029-1.log`，实际调用synthetic只读 / 严格JSON投影及可选Prompts，不当依赖安装或分发；未清理旧output / 依赖 / Prisma产物 |

本树官方SDK2.2.0已通过进程内2026-07-28及2025-11-25发现 / Tools空列表 / 拒绝行为；不是完整协议一致性验收。原版Harness Host、真实OAuth / 数据库 / 模型与生产部署未验。本包依赖未安装、根lock未更新，测试明确使用既有Harness SDK，不能当root安装 / 产物就绪。

## 3. 下一实施入口

MCP-01 / AGP-01协议与发现已有代码及真实SDK证据，OAuth客户端已有授权码 / S256 / 单refresh到握手的离线组合；不是生产登录或grant。MCP-03只读注册已经过真实两代SDK验证，完整重复包装超限实际503、私有字段不返回、旧缓存撤回拒绝及读后身份失效已覆盖。完整client / 工具字段 / 材料合同和固定原身份生产者未齐，阶段证据及未跨档门槛见开发记录。

MCP-02原OAuth AS / 固定grant及当前Guard / ALS仍缺真实生产者，公共Auth / Guard由原服务端作者维护，不接管或用Web可变session替代。当前RFC7662固定AS introspection无active缓存，必需可信subject与client / scope / audience / expiry复核及请求取消转发；内部不可变主体引用交原providers消费，两代SDK已验证。同client / scopes而subject变化在发布 / 读后 / 返回前仍拒绝；这不映射业务身份或开工具。客户端已用私有进程内OAuth / 单refresh / 原session绑定连接官方SDK，未改原Host / credentials；实际原版安装、纯Electron回调、长期安全凭据与真实AS仍未验。

负责人设置持续目标：问题记录并告知后转做无阻塞项。版本化instructions及可选Prompts已通过真实两代SDK / 编译包出口，当前均以synthetic政策provider验证，生产审查文字未交付；Prompts只提供无业务参数的当前起步指引，不自动成为Host SystemPrompt，缺许可 / 撤回 / 版本冲突拒绝。Harness已接显式人类列表 / 选择：列表零正文 / 模型，选择形成一条有来源 / 版本的原用户消息，取消 / 断开 / Agent销毁 / 重载 / 模型服务移除的未提交迟到正文拒绝；消费与日志证据见插件记录，不重复记MCP实现或生产进度。Harness原SystemPrompt已验证精确Agent / Session消费、更新、撤回和释放；当前无生产批准文字。Harness原公开MCP工具桥已接只读消费和精确Agent / Session释放，真实业务provider仍缺；原AgentLoop / MCP续轮、中立模型材料256 KiB及同一Session断开后检查已有离线证据；最终Provider线包 / 目的地、磁盘 / fork / 跨重启仍未保证。下一入口为固定原身份 / 发布 / 字段 / 持久目标生产者及所需发送 / 恢复控制，缺前置不开放真实业务，不以synthetic provider或本地Map补齐，不重复native通路。

原结果候选已在`packages/mcp-server/src/conversation-result-read.ts`，验证入口为`tests/mcp-foundation.test.cjs`的original conversation result / compiled MCP package。最新mcp-original-result-final-20261029-1.log退出0、2 pass，含私有shared / MCP严格编译、真实包出口与两代SDK；原业务 / 政策仍为替身，未发模型。当前具体缺项：原对话组合只有Web Bearer重解析，没有MCP原身份适配；AiOrderExplainRequestDraft / Input在API组件而非shared，须原作者固定供给或正式出口；完整Web schema发现超64 KiB，MCP必须原字段作者另给闭合投影schema，不裁剪原事实；原Harness不支持实际输入schema部分约束，当前不发布给该Host，不宣称全端冻结。原Reader仍负责Run / 来源 / 当前权限复验，不接管API / shared作者WIP。

随后接04持久目标、05正式字段政策及06原有界目录，AGP-04～07消费，两侧10收集真实首片证据。根依赖 / lock与API装配需要另核授权和写入归属，不因本片绕开它们就宣称已集成。

首片目标：后台开通 → OAuth同意 → Harness会话绑定 → Tools发现 / 目录调用 → 自主安全结果 → 撤权、过期和越权拒绝。不等报价 / 建单、可选Prompts / Resources或全部其他Host；这些后续仍按任务验收，不从整体范围删除。

固定公共合同必须来自原唯一作者；MCP生产者不依赖整个插件工程，AGP不反向重写服务端。并行须独立工作树。任何真实依赖未齐按对应能力不可用处理，不用恒真身份、空成功或静态token冒充闭环。

## 4. 接手限制

先读根[AGENTS](../../AGENTS.md)、[README](../../README.md)、本专项四册及插件当前接续；修改后端 / shared / 后台 / Harness前读其具体规则、消费者和验证入口。旧AGC暂停不因本接续解除。

本轮已授权两专项开发和必要离线验证，但不扩展到安装、启服务、读取环境、真实HTTP / DNS / DB / 模型、迁移、提交、合main、推送、签名或发布。不向其他对话发消息、不建心跳、不抢写同树公共文件、不清理任何未确认成果。
