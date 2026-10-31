# Harness 插件：当前协作接续

> 专项：Rental OS Harness 插件；更新时间：2026-11-01。
> 当前状态：负责人最新要求“你先收口”，本会话已暂停功能写入；持续目标尚未完成，恢复须负责人明确授权。MCP侧原结果、Task恢复、精确原操作收据及原对话有界分页只读候选已有编译包 / 原reader证据；插件材料检查已覆盖纯自动指引历史，原Harness仍拒绝这些实际输入schema，业务工具未开放。本批WIP和全部output保留，接手重核本树归属，不因目标接管主线公共文件或未经授权联调 / 发布。
> 当前依据：[需求v1.1](Harness插件-需求.md)与[开发任务v1.1](Harness插件-开发任务.md)。当前已有独立Bundle、私有内存OAuth、单refresh、原命令session绑定、host / 临时loopback回调及精确Agent / Session同源指引，通过真实profile / Loader及外部替身的离线装配；原公开MCP工具桥及原AgentLoop的指引 / 事实续轮、日志重建和256 KiB中立材料限制已有离线组合；缺LlmRuntime时相关读取不发布，断开后的同一Session仍检查。人主动列出 / 选择可选MCP模板与精确text/plain资源已接同一连接和原消息 / 日志，模板 / 资源共用唯一maintenance操作，未提交正文在取消 / 断开 / Agent销毁 / 重载 / 模型服务移除后不进入模型；来源在重载后仍触发材料上限。已有0.1.1预构建候选tarball / 校验清单，并由真实profile / Loader消费解包后的正式入口；尚未通过原安装命令装到用户独立Harness、登录联调或开放生产业务Tools。两专项保留共同首片目标，当前暂停实施；实际命令与失败 / 通过见开发记录。
> MCP生产者及当前现场见[MCP开发任务](../MCP服务/MCP服务-开发任务.md)与[接续](../MCP服务/MCP服务-协作接续.md)。原「Agent接入改造」v1.5两册在原目录封存保留，未恢复旧客户端实施。

## 1. 当前边界

1. 原Harness MCP客户端是唯一业务通路，直接连接Rental MCP服务。原生能力足够可先直连，Rental Bundle只补必要OAuth / 安全凭据、空间 / 会话绑定、连接状态及提示词体验，不成为MCP服务的强制前置。
2. 不再做插件专用业务API，不另注册native同名工具，不让原生与增强两个驱动重复持有 / 刷新同一连接或执行同一动作。OAuth控制面和可信人类Web仍走正式接口，不属第二业务通路。
3. MCP统一负责服务端身份 / grant、后台开通、字段 / 能力发布、原计量、原业务适配和版本化业务说明。AGP只消费，不重建服务端或重复计完成。不同client / 用户 / 空间独立grant，未登录只禁Rental，不禁Harness个人功能。
4. Harness自主选择文字、表格、图表、报告和合规展示文件。MCP给事实、Tools说明 / instructions / 可选Prompts；插件只补实际缺少的会话加载和Host能力说明，不造固定业务页或renderer。Prompts不保证自动进系统提示词，权限不靠提示词执行。
5. 真实客户选择、正式核对及批准沿原可信Web，Core和原执行器决定业务结果。模型Key仍用户在Host配置自付，实际云任务沿原Gateway / 单账；Web / 官网 / 小程序 / 巡检 / 协作继续并存。

## 2. 本树现场与缺口

| 项目 | 当前记录 |
| --- | --- |
| 工作树 | `D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation` |
| 分支 / HEAD | `ai/ai-native-contracts-s01-20261002` / `69c6c89e`，仅定位，不作reset / 追HEAD同步目标 |
| Git状态 | 当前核对暂存为空，无MERGE_HEAD / CHERRY_PICK_HEAD；旧成果由整合线0864c097 / 088153af保全整合，本会话未执行该提交 / 合并。本批MCP快照 / 适配、对应测试和说明 / 两专项记录接续未提交，接手重核同树并行归属 |
| 当前文档 | 插件v1.1四册消费MCP v1.0；任务百分比以原任务表为准，G门证据见开发记录；正式0/10，不继承AGC或MCP实现进度 |
| 当前工程 | `clients/harness-plugin/`已有Bundle / patch / 四项函数导出及status / check / oauth-check / login / disconnect，显式readPrompts / readResources配置后可列目录或按名称选择一个模板 / 精确text/plain资源提交原用户消息；私有内存OAuth仅供原命令会话的一条官方SDK连接；明确host / loopback回调模式，不写共享credentials。固定Host0.2.1-rc.2、共享Cordis / commands。MCP已有introspection及受控只读注册，生产原权限 / 计量 / 字段和工具未接 |
| 原生MCP核查 | 已有tools / resources / instructions与HTTP接点；所读transport仅config.headers，OAuth / refresh / 安全凭据及SDK重试未据此验收 |
| 输出边界 | 静态HTML与交互预览权限不同，未按Rental材料要求做真实Host验证；服务器64 KiB输出不代表任意Host总上下文受控；原llm/stream已检查256 KiB中立请求，原工具声明 / 调用记录、rental-prompt / rental-resource来源消息及system文字中的版本化Rental指引可在重载后重新收紧检查，无登录也不恢复授权；后续文件 / 图片 / 供应商线包、目的地和全部重放仍未覆盖 |
| 旧客户端WIP | 工作台5源码及`tests/agent-desktop.test.cjs`中断修改原样保留，未补类型 / 当前构建 / 真实宿主，不计插件交付 |
| 并行范围 | 本会话限本树MCP / Harness插件、既有对应测试和两专项说明 / 记录 / 接续。MCP可选Resources、插件显式资源选择、协议固定及输入错误安全外发均已收口。最新只读核查原执行入口，未新增源码 / 测试；负责人要求收口后不继续开发。两份接续前像在[收口保全](../../output/mcp-harness-paused-20261101-2i71e_s2/)，插件0.1.1、原0.1.0及旧产物保留；API / shared / OpenAPI、知识附件 / 文件存储、其他测试、依赖 / 根锁和AI Native四册归原作者，主树权限 / Core / 支付及后台 / 租户官网不接管或暂存 |
| 保全与证据 | 17份前像在[保全目录](../../output/harness-resource-selection-closeout-20261031-1dqrvekf/)，最新输入错误片七份前像见[MCP保全](../../output/mcp-input-error-closeout-20261031-hthswluh/)，修前路径回显 / 修后源码和正式ESM3 pass见MCP记录；静态 / 冻结 / audit结果文件为`output/harness-oauth-session-20261028-m3kvbehy/mcp-input-error-static-20261031-1.json`。[0.1.1候选包](../../output/harness-plugin-resource-package-20261031-4rtwpztq/bundle/rental-os-harness-plugin-0.1.1.tgz)与[清单](../../output/harness-plugin-resource-package-20261031-4rtwpztq/bundle/bundle-manifest.json)已交用户，SHA-256 `f2b9e47c220c0f839f52de43b14f5752c1bbb0b3c6bd9bc7c9e72c98d55b77a9`同[最终原Loader / Loop](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-selection-final-20261031-4.log)归档，退出0、1 pass，含strict / 声明、同源资源、取消 / 重载 / 服务移除及全部既有组合；[打包](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-resource-package-20261031-1.log)退出0。MCP此前Resources两代SDK / 正式ESM2 pass见MCP记录，未重复正常回归。原0.1.0及所有失败 / output保留；实际Tools schema仍拒绝，Web / store / grant为外部夹具，不声称用户原版安装、生产真库或业务开放 |

既有Harness源码 / build、目录人工预览及旧测试属于原专项，不证明MCP授权、工具消费或自主呈现已接通。旧`human_preview / not_sent`不可直接作为MCP输出，旧`rentalDesktop` / `sidebar.rental.*`不可当原版依赖。

## 3. 恢复后的联合切片

已有登录前发现、OAuth元数据核验及私有标准客户端授权链；兼容声明不证明登记，synthetic AS的token与握手不证明生产grant。最新临时loopback模式通过真实Loader / strict编译和外部监听替身，单session / refresh / 401不重发 / unknown限制保留。MCP只读注册 / 完整响应限制亦有真实SDK离线证据，实际命令与剩余门槛见两专项开发记录。

原接入缺口和持续目标保留，当前暂停；以下实现与缺口只供负责人授权恢复后接手。客户端已新增进程内私有OAuth登录 / 单refresh / 原session绑定 / disconnect及独立官方SDK MCP连接，复用现有Host数字loopback callback与系统浏览器，不改Harness主程序 / 不写共享credentials。原MCP工厂没有注入点的问题由该唯一连接适配承担，不另挂静态headers驱动；未知签发不重试、不同会话不能借用，原MCP工具桥后续仍复用。类型 / Loader离线通过，但浏览器 / listener / AS均是外部替身，不称真实登录。

剩余：①原服务端AS / 固定grant / 当前Guard、持久目标及字段发布适配未交付且公共文件归原作者；②临时模式虽不依赖Electron file/IPC或WebServer，真实OS端口 / 浏览器 / Electron组合及远端Web仍未验；③长期安全凭据 / 跨重启恢复、恶意同进程插件隔离未满足，当前只私有短期内存，重启重登不等于unknown核对。RFC7662不映射原业务身份。原公开工具桥已接精确活跃Agent / Session的只读发现 / 调用、子Agent继承过滤、原执行器拒绝和释放；尚无生产业务发布。原llm/stream中立请求256 KiB检查及原AgentLoop续轮已接，原工具记录可在重载 / 重建请求时重新触发检查；它不保证后续Provider线包、图片 / 文件扩张、目的地或全部重建Session。下一入口为上述固定生产者及所需发送 / 重放控制，不把握手、局部上限或synthetic原计量当整体完成。

原MCP客户端仍缺实际OAuth接点，原Web权限链会再次解析Web session；须由原身份作者补固定grant / 当前Guard及ALS适配，不透传MCP token或只填上下文。MCP可选Prompts已沿两代SDK获取，插件新增默认关闭的显式人类命令消费；列表不读正文 / 不发模型，选择经原runMaintenance / followup形成一条有来源 / 版本的普通用户消息，不自动采用或替换SystemPrompt。原Loop验证Tools / instructions不依赖它；未提交模板的取消 / 断开 / Agent销毁 / 服务移除 / 重载迟到拒绝已有屏障证据，已提交普通历史不承诺删除或免除模型费用。同源instructions已沿原SystemPrompt验证精确Agent / Session组装、字面变量、更新 / 撤回 / 失败和卸载移除，原AgentLoop以脚本模型验证同源指引与工具事实进入原日志 / 下一请求，序列化事件可重建消息；真实模型采用、磁盘持久化 / 跨重启和全部材料生命周期未验。后续MCP-04计量、05字段、06目录及AGP-04～07按固定子交付接通，两侧10共用首片证据；不抢写活动公共出口。

原对话modelResult候选在MCP侧已补稳定普通JSON输入 / 完整结果快照，并经编译包实际调用原对话 / scene结果服务 / artifact仓储；unknown空正文、原哈希 / Run错配、换用户 / 空间及读后失权拒绝，读取不追加任务 / run。原Web身份 / DB和MCP政策仍为明确夹具，私有结果128 KiB不扩大MCP外发或Host材料上限，实际证据见MCP记录。本端仍拒绝真实输入的UNSUPPORTED_SCHEMA，不削约束、不注册业务；原AS / 固定身份 / 原字段 / 持久计量未齐，AIN-02全端冻结没有本端确认。原请求Task / 步骤恢复状态另有独立MCP只读候选，保留not_observed / unknown / 原核对指引，不增加执行动作；实际原request-bound reader验证、Host仍拒绝真实schema的证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)。精确原操作收据已在MCP形成不发布候选，只读原键 / 不重发，证据见MCP记录，本端未注册或计作消费。原可信选择read亦有MCP只读子出口，原引用 / hash与当前读权已验证，不查询个人候选、不保存选择，Host实际schema仍拒绝、未消费发布，证据见MCP记录。原选单提案read亦已沿MCP正式ESM / 原请求绑定reader验证Core事实及拒绝，不提供决定 / lease，Host schema仍不兼容且未注册；当前原字段 / 计量 / 身份缺口保持。原选单readResult已有独立MCP只读子出口，经原Task / 批准消费 / Core收据服务验证committed / unknown / not_observed；不接执行 / reconcile，实际Host schema仍不支持且未注册，身份 / 字段 / 持久计量缺口保持，证据见MCP记录。下一入口仍按固定生产者及Host支持条件推进；主线审核v2、设置原键恢复和releaseUnstarted通知不构成本端消费 / 验收，不追活动WIP、不修改shared或接管其他前端 / 启用服务。

MCP可选Resources已有精确text/plain说明 / 原引用读取和原权限 / 计量 / release编排，源码 / 正式ESM两代SDK验证见MCP记录；本端已通过同一私有连接作显式人类资源列表 / 名称选择，沿原maintenance / inbox / Loop交付有来源text/plain消息；没有注册原mcpResources继承式provider或第二份Tools，模型自主Resources访问仍未验收。精确Agent / Session、取消 / 断开 / 重载 / 模型服务移除及来源重建后的材料检查已有原Loader证据，不把Resources变成原Tools schema的通用JSON旁路；严格资料缺Host控制证据仍拒绝。当前原工具桥对不支持输出会降通用JSON、PTC类型降unknown / Any，本端不凭该行为删除原约束开放。

目标：后台开通 → OAuth登录 / 同意 → Harness当前会话与空间 → MCP Tools发现 / 目录查询 → 自主安全结果 → 撤权拒绝。不先做固定UI、插件私有API或完整渲染平台，不等全部可选MCP能力 / 其他Host / 报价建单；所需安全前置缺失则不开放。

七项原业务码及原R0 / R1 / R2的固定运输映射见MCP子出口，目录运输名已沿原Host夹具消费，但当前原工具版本、实际目录schema / reader未齐，不凭名称或风险标签开放。当前工具名称仍限48字符，原HostpublicToolName未公开导出，不自写截断 / 哈希或深导入；目录原输入 / 投影公共schema与生产字段政策缺失，不能用旧人工预览结果代替。MCP已固定工具及指引provider方法，说明 / 正文按普通JSON数据描述符捕获，当前动态政策仍逐次生效；本端原Host消费通过，客户端不修改旧定义模拟新发布。MCP service已把当前RFC8414 AS发布、public client预登记 / S256校验、标准授权code / denial、持久一次码 / token及资源回读统一装配，原Loader已消费；原store / Web同意 / grant仍为外部夹具，不代表生产AS或真实用户同意。原Host浏览器替身消费303回调，登录discovery / 交换及disconnect已消费运输，后续并发refresh仍用原专门夹具。返回前登记变化拒绝迟到token，不证明签发回滚，停用client的原撤销入口仍保留；原Task的Gateway calls也不等于业务调用目标，本端不借lease或自造计数器。当前原MCP授权 / 安全存储 / scope / 重试接点需要核验；不足时补受支持的标准MCP客户端适配，不用长期headers / Web token兜底。原生覆盖项有真实证据后可免新增代码，不以空包或“无需开发”计完成。并行使用独立树，公共文件只接原唯一作者固定成果。

## 4. 接手限制

先读根[AGENTS](../../AGENTS.md)、[README](../../README.md)、插件与MCP两专项正式依据 / 接续，动任何模块前读其已有规则。原AGC封存和源码暂停保持；不向其他会话发消息、不建心跳、不清理WIP、依赖、下载或隔离产物。

负责人2026-11-01要求先收口，当前功能开发暂停；旧持续目标和Stop hook不恢复写入。恢复须重新确认本树归属和负责人授权；安装、启服务、读`.env`、真实网络 / DB / 模型、迁移、签名、部署、合main、提交或推送均未授权。
