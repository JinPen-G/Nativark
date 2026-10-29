# Harness 插件：当前协作接续

> 专项：Rental OS Harness 插件；更新时间：2026-10-29。
> 当前状态：2026-10-29负责人要求收口并重启电脑，停止新增实现；未提交成果 / 全部output保留，恢复后先核对本树归属。
> 当前依据：[需求v1.1](Harness插件-需求.md)与[开发任务v1.1](Harness插件-开发任务.md)。当前已有独立Bundle、私有内存OAuth、单refresh、原命令session绑定、host / 临时loopback回调及精确Agent / Session同源指引，通过真实profile / Loader及外部替身的离线装配；原公开MCP工具桥及原AgentLoop的指引 / 事实续轮、日志重建和256 KiB中立材料限制已有离线组合；缺LlmRuntime时相关读取不发布，断开后的同一Session仍检查。人主动列出 / 选择可选MCP模板已接原消息 / 日志，未提交正文在取消 / 断开 / Agent销毁 / 重载 / 模型服务移除后不进入模型；模板来源在重载后仍触发材料上限。尚未真实安装、登录联调或开放生产业务Tools。两专项继续共同推进首片，实际命令与失败 / 通过见开发记录。
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
| 分支 / HEAD | `ai/ai-native-contracts-s01-20261002` / `0f59d1d4`，仅定位，不作reset / 同步目标 |
| Git状态 | 开工暂存为空，无MERGE_HEAD / CHERRY_PICK_HEAD；同树服务端线持续有WIP，接手重核 |
| 当前文档 | 插件v1.1四册消费MCP v1.0；任务百分比以原任务表为准，G门证据见开发记录；正式0/10，不继承AGC或MCP实现进度 |
| 当前工程 | `clients/harness-plugin/`已有Bundle / patch / 四项函数导出及status / check / oauth-check / login / disconnect，显式readPrompts配置后可prompts列目录或prompt选择一模板提交原用户消息；私有内存OAuth仅供原命令会话的一条官方SDK连接；明确host / loopback回调模式，不写共享credentials。固定Host0.2.1-rc.2、共享Cordis / commands。MCP已有introspection及受控只读注册，生产原权限 / 计量 / 字段和工具未接 |
| 原生MCP核查 | 已有tools / resources / instructions与HTTP接点；所读transport仅config.headers，OAuth / refresh / 安全凭据及SDK重试未据此验收 |
| 输出边界 | 静态HTML与交互预览权限不同，未按Rental材料要求做真实Host验证；服务器64 KiB输出不代表任意Host总上下文受控；原llm/stream已检查256 KiB中立请求，原工具声明 / 调用记录及rental-prompt来源消息可在重载后重新收紧检查，无登录也不恢复授权；后续文件 / 图片 / 供应商线包、目的地和全部重放仍未覆盖 |
| 旧客户端WIP | 工作台5源码及`tests/agent-desktop.test.cjs`中断修改原样保留，未补类型 / 当前构建 / 真实宿主，不计插件交付 |
| 并行范围 | API / shared / OpenAPI / tests、API依赖 / 根锁及AI Native四册由服务端线负责，本会话不改或暂存 |
| 保全与证据 | 当前指纹和静态结果在`output/harness-oauth-session-20261028-m3kvbehy/`，编译 / profile在`output/harness-plugin-loader-*`；最新`harness-explicit-prompts-final-20261029-1.log`包含人类模板列表 / 原消息选择、版本拒绝、在途取消 / Agent销毁 / 重载、Prompt-only材料重建及真实Loader / AgentRegistry / ToolRuntime / LlmRuntime / AgentLoop / MCP工具桥 / SystemPrompt / strict编译 / 声明消费、断开与模型服务移除组合，MCP指引和完整输出证据见两专项开发记录。日志均在原安装output的logs；重启收口静态结果`restart-closeout-static-20261029-1.json`核对34文件 / 145本地链接 / 9项冻结 / audit无记录 / 暂存为空 |

既有Harness源码 / build、目录人工预览及旧测试属于原专项，不证明MCP授权、工具消费或自主呈现已接通。旧`human_preview / not_sent`不可直接作为MCP输出，旧`rentalDesktop` / `sidebar.rental.*`不可当原版依赖。

## 3. 下一联合切片

已有登录前发现、OAuth元数据核验及私有标准客户端授权链；兼容声明不证明登记，synthetic AS的token与握手不证明生产grant。最新临时loopback模式通过真实Loader / strict编译和外部监听替身，单session / refresh / 401不重发 / unknown限制保留。MCP只读注册 / 完整响应限制亦有真实SDK离线证据，实际命令与剩余门槛见两专项开发记录。

负责人已明确继续解决接入缺口并设置持续目标。客户端已新增进程内私有OAuth登录 / 单refresh / 原session绑定 / disconnect及独立官方SDK MCP连接，复用现有Host数字loopback callback与系统浏览器，不改Harness主程序 / 不写共享credentials。原MCP工厂没有注入点的问题由该唯一连接适配承担，不另挂静态headers驱动；未知签发不重试、不同会话不能借用，原MCP工具桥后续仍复用。类型 / Loader离线通过，但浏览器 / listener / AS均是外部替身，不称真实登录。

剩余：①原服务端AS / 固定grant / 当前Guard、持久目标及字段发布适配未交付且公共文件归原作者；②临时模式虽不依赖Electron file/IPC或WebServer，真实OS端口 / 浏览器 / Electron组合及远端Web仍未验；③长期安全凭据 / 跨重启恢复、恶意同进程插件隔离未满足，当前只私有短期内存，重启重登不等于unknown核对。RFC7662不映射原业务身份。原公开工具桥已接精确活跃Agent / Session的只读发现 / 调用、子Agent继承过滤、原执行器拒绝和释放；尚无生产业务发布。原llm/stream中立请求256 KiB检查及原AgentLoop续轮已接，原工具记录可在重载 / 重建请求时重新触发检查；它不保证后续Provider线包、图片 / 文件扩张、目的地或全部重建Session。下一入口为上述固定生产者及所需发送 / 重放控制，不把握手、局部上限或synthetic原计量当整体完成。

原MCP客户端仍缺实际OAuth接点，原Web权限链会再次解析Web session；须由原身份作者补固定grant / 当前Guard及ALS适配，不透传MCP token或只填上下文。MCP可选Prompts已沿两代SDK获取，插件新增默认关闭的显式人类命令消费；列表不读正文 / 不发模型，选择经原runMaintenance / followup形成一条有来源 / 版本的普通用户消息，不自动采用或替换SystemPrompt。原Loop验证Tools / instructions不依赖它；未提交模板的取消 / 断开 / Agent销毁 / 服务移除 / 重载迟到拒绝已有屏障证据，已提交普通历史不承诺删除或免除模型费用。同源instructions已沿原SystemPrompt验证精确Agent / Session组装、字面变量、更新 / 撤回 / 失败和卸载移除，原AgentLoop以脚本模型验证同源指引与工具事实进入原日志 / 下一请求，序列化事件可重建消息；真实模型采用、磁盘持久化 / 跨重启和全部材料生命周期未验。后续MCP-04计量、05字段、06目录及AGP-04～07按固定子交付接通，两侧10共用首片证据；不抢写活动公共出口。

原对话modelResult已在MCP形成不自动发布的只读候选，实际包出口 / 两代SDK证据见MCP记录。本端真实输入schema仍被原Harness校验器拒绝，不削约束、不注册业务；原AS / Guard / 原字段 / 持久计量未齐，AIN-02全端冻结没有本端确认。重启后继续先核对固定生产者，不按peer通知自动修改shared、装配前端或启用服务。

目标：后台开通 → OAuth登录 / 同意 → Harness当前会话与空间 → MCP Tools发现 / 目录查询 → 自主安全结果 → 撤权拒绝。不先做固定UI、插件私有API或完整渲染平台，不等全部可选MCP能力 / 其他Host / 报价建单；所需安全前置缺失则不开放。

当前原MCP授权 / 安全存储 / scope / 重试接点需要核验；不足时补受支持的标准MCP客户端适配，不用长期headers / Web token兜底。原生覆盖项有真实证据后可免新增代码，不以空包或“无需开发”计完成。并行使用独立树，公共文件只接原唯一作者固定成果。

## 4. 接手限制

先读根[AGENTS](../../AGENTS.md)、[README](../../README.md)、插件与MCP两专项正式依据 / 接续，动任何模块前读其已有规则。原AGC封存和源码暂停保持；不向其他会话发消息、不建心跳、不清理WIP、依赖、下载或隔离产物。

本轮已授权开发及必要离线验证，不授权安装、启服务、读`.env`、真实网络 / DB / 模型、迁移、签名、部署、合main、提交或推送。新增包依赖安装、公共装配及真实运行仍按负责人明确范围执行。
