# Harness 插件：当前协作接续

> 专项：Rental OS Harness 插件；更新时间：2026-11-06。
> 当前状态：本次已收口，十分钟循环已按用户`/loop clear`取消，不自动进入下一片。MCP分类率桶原生SQL片仅有核查与前像，未实现`--traffic-meter`、改测试或启库，见[MCP收口](../MCP服务/MCP服务-开发记录.md#当前收口2026-11-06)。插件仍0.1.8／19/19，未改源码／包或重跑Loader。MCP已供给原认证JSON-RPC发现类实际限流，见[MCP当前阶段](../MCP服务/MCP服务-开发记录.md#阶段原认证协议发现实际限流2026-11-06)：原Core同store／grant／Auth与class桶，按actual body.method逐request计量，原parsedBody仍交SDK validator／列表／代次，Header不能给工具体发现豁免。实际Core／SDK1/1及strict声明通过；缺policy／超限／原字节越界拒绝，close等原准备，SQL／commit／policy仍夹具，未由Harness消费／生产发布。目录自动与本人收据类已接；人工复核／匿名可信来源及全原策略、Resources／其他业务／副作用和完整活动、wire-release／Nest／UI／Host安装仍缺，原目标／预算／hold与收据历史保持，任务表未整项跨门。无新DDL／安装／外联、迁移或提交，实库失败与WIP保留。
> 正式依据：[需求v1.1](Harness插件-需求.md)、[开发任务v1.1](Harness插件-开发任务.md)。任务百分比只以原任务表为准；本片无整项跨原G门，正式验收仍0/10。MCP生产者由同一开发线按独立[MCP任务](../MCP服务/MCP服务-开发任务.md)和[接续](../MCP服务/MCP服务-协作接续.md)推进；插件仍只消费，不重复实现服务端政策或继承MCP进度。
> 本树离线Host / SDK / TS / Node已有独立副本，原件及历史失败保留，不是新安装许可。用户2026-11-06新增授权所有隔离库测试，可自行执行本树经核实的独立MySQL实例 / 自建空测试库、测试DDL及仅本次实例停止，无需逐次问；不授权生产 / 共享库或原库导出。其余仍不读`.env`、安装依赖 / 用户profile、启应用 / 浏览器、访问真实HTTP / DNS / 模型 / 支付 / 对象存储，不做生产迁移、提交 / 合main / 推送、签名、部署 / 启用或未知现场清理；原已核对错误junction修正事实保持，未知WIP不动。

## 1. 当前目标与职责

首片目标保持：后台开通 → OAuth登录 / 同意 → Harness当前会话与经营空间 → 同一MCP Tools发现 / 有界目录查询 → 自主安全结果 → 撤权 / 过期 / 越权拒绝。不等待全部可选Resources / Prompts、其他Host或报价建单；必需安全生产者缺失则不开放，不造假前置。

- 原Harness MCP客户端是唯一业务通路。Rental Bundle只补必要OAuth / 凭据、连接、会话 / 空间、状态及同源指引，不建插件私有业务API或第二份native工具。原生与增强不同时持有 / 刷新 / 驱动同一连接。
- MCP及原作者唯一负责身份 / grant、后台开通、当前Guard / ALS、字段 / 能力发布、持久目标 / 累计计量、Core / 批准 / 原收据。插件只消费，客户端字段、scope、缓存、instructions和安装均不自授权。
- Harness原Agent自主选择文字、表格、图表、报告和合规展示文件；插件不造AgentLoop、renderer、固定业务表单或后台副本。真实客户选择 / 核对 / 批准回原可信Web，生成页面或聊天确认不替人批准。
- 本地模型由用户配置并自付，不交本地Key；实际云任务沿原Gateway / 财务单账，任务累计资源另计。原服务端 / Web / 官网 / 小程序 / 巡检 / 协作继续并存，未登录只禁Rental业务，不停止个人功能。

## 2. 工作树、归属与产物

| 项目 | 当前现场 |
| --- | --- |
| 工作树 | `D:/工作文件/rental-OS/.claude/worktrees/claude-harness-plugin-20261104`；源基线为原`claude-ai-native-foundation`，原树保留，插件不再回写其源码 |
| 分支 / 基线HEAD | `ai/harness-plugin-20261104` / `a064c473279fa58973ffc5f52fd2d6479e496512`，按原树固定HEAD建立，不取main或活动HEAD；未提交基线见[清单](../../output/harness-worktree-base-20261104-9c03g31v/baseline.json) |
| Git现场 | 暂存为空，未提交。原树2,150个源码WIP条目及305份引用证据按冻结指纹迁入；非插件改动只是原基线，不认领、不夹带提交。当前0.1.8仍是未提交源码，不称HEAD已包含；本树测试依赖已按明确许可独立复制，原件不动，部分复制及失败现场保留 |
| 当前写入者 | 本会话联合维护MCP／插件，当前写入已收口，不泛发消息。本次只更新MCP开发记录及两专项接续，见[收口](../MCP服务/MCP服务-开发记录.md#当前收口2026-11-06)；所有业务／测试源码、插件包及任务表保持。上一完成片为原认证协议发现类；分类率桶原生SQL片尚未实现或运行，不接续为已完成。人工复核／匿名可信来源、Resources／副作用、完整活动、Nest／UI／全原策略及Harness消费仍缺。实库失败与WIP保留，未重启MySQL、Loader或打包 |
| 排除范围 | 本次仅收口三份现行文档，不改任何业务／测试源码、schema或包；MCP三份OAuth源码及tests/mcp-foundation.test.cjs他作者WIP不认领。原catalog authority／可用性授权与资源／Core库存／Guard、grant管理／目录组合／receipt／grant控面／host／client rate service／Prisma schema、read-tools／整次计量／日志／DDL／goal准备和source／adoption／settlement／bindings／预算SQL／context／目录资源／router、配置／facts／occupancy／scope、原请求／policy／订单前片、其他API／订阅／shared／OpenAPI／根lock／后台／AI Native文档／插件与SDK vendor不改；实库失败与此前成果保持 |
| 当前候选 | [0.1.8预构建tarball](../../output/harness-plugin-loader-eQR5Kx/delivery/rental-os-harness-plugin-0.1.8.tgz)、[清单](../../output/harness-plugin-loader-eQR5Kx/delivery/bundle-manifest.json)，SHA-256 `1edaed7fd9f2a4f44ff46568cc5cea0a540a7bfdc89b69a2986659e9771b2239`；同一次本树Loader组合生成 / 消费并交用户，不重复打包。Host固定`0.2.1-rc.2`、官方SDK`2.2.0`、现代协议pin`2026-07-28` |
| 旧成果 | 原树全部旧包 / 失败日志 / output / 依赖与WIP不移动、不清理；本树保留引用证据的固定副本，包括[0.1.7候选](../../output/harness-plugin-loader-Gq1ngA/delivery/rental-os-harness-plugin-0.1.7.tgz)、[0.1.6候选](../../output/harness-plugin-loader-pD4WV7/delivery/rental-os-harness-plugin-0.1.6.tgz)、[0.1.5候选](../../output/harness-plugin-loader-Z42mYi/delivery/rental-os-harness-plugin-0.1.5.tgz)及此前成果，不冒充0.1.8或本片新验证 |
| 本片保全 / 验证 | 十一份[前像](../../output/harness-tools-publication-status-20261106-1/hashes.json)、[19/19最终定向组合](../../output/agent-desktop-install-20261023-q16gtnf6/logs/harness-tools-publication-status-final-20261106-1.log)与[阶段记录](Harness插件-开发记录.md#阶段工具发布状态准确消费2026-11-06)保留首次测试语法失败，不把分次合算。双语状态 / command日志、零新网络 / 模型及pending / empty / 撤回已验，不冒充生产权限。工作树冻结基线 / 迁入及[独立工具链收据](../../output/harness-toolchain-copy-20261104-53ex9x2s/result-hoisted.json)、旧候选和失败现场保留 |

## 3. 已接通的客户端接点

[插件README](../../clients/harness-plugin/README.md)说明实际消费者和限制；完整阶段证据只在原记录维护。

1. 独立Bundle / patch / `name / inject / Config / apply`及原人类命令，预构建归档无相邻源码或第二份Cordis。默认零自动OAuth / 模型请求。原PluginManager无HMR时停用只保存，旧入口仍运行；重读磁盘profile重启后才移除，再启用 / 重启只恢复一份，不自动授权或重放，个人文件 / 依赖 / 测试历史保留。不是用户安装 / 升级验收。
2. 私有内存OAuth / PKCE、一次交换 / 单refresh、精确Agent / Session、host及临时数字loopback回调；0.1.7在原请求截止内准备凭据，SDK回调不另开刷新，取消的等待者不迟到派发。取消 / 断开 / 清理失败和unknown不重发。0.1.5在发起登录前捕获owner，独立`agents`监听覆盖无Tools / Prompts / Resources的连接和待交换登录；销毁只影响该owner，原工具消费者只撤回自己的注册。真实AgentHandle不等待异步disposed监听器，远端撤销 / 恢复由连接自身结算，断开 / Bundle关闭复用在途关闭；不能把Agent销毁等同远端已撤销。Agents服务移除关闭本实例，恢复服务不复活旧连接；缺服务不新增纯OAuth的LlmRuntime / Tools前置。
3. 官方客户端版本读取实际包声明，缺声明加载失败；固定现代协议收到旧版only / -32022时拒绝，不fallback或清可能已签发的unknown。公开SDK错误的粗原因仅本次unknown owner内存可查，status / check / login / disconnect保留原核对要求；其他Session及新Loader不取得原因。0.1.6仅对校验通过且正常清理 / 恢复结算的access_denied显示双语明确拒绝，零码交换、不自动重登、不回显错误说明 / URL；清理失败、其他AS错误及可能签发仍unknown，不新增解锁 / 重试入口。
4. 原storageDomain只持久`clear / unresolved`，登录前占用，成功连接仍保留；初始化close、迟到clear单次补写、写后失应答及共用disposal已有原JSON离线组合。恢复补写失败明确unknown，但磁盘可能仍clear，后继实例不保证阻塞；不删除标记、换profile或自报核对解锁。
5. 原公开Tools桥只对精确Agent / Session发布已获准只读定义，原继承层过滤子Agent、旧执行器仍拒绝；同源instructions沿原SystemPrompt精确加载 / 更新 / 撤回。人主动选择可选模板或精确text/plain资源，共用原maintenance / inbox / AgentLoop / 日志，只形成有来源普通消息，列表不读正文 / 发模型；取消 / 断开 / 销毁 / 重载 / LlmRuntime移除不提交迟到正文。不注册继承式Resources provider或将Resources当Tools schema旁路。
6. 原`llm/stream`先检查完整中立请求，再逐次展开原file文本句柄投影，二者各256 KiB，不读文件正文 / 改日志 / 去重。同一已绑定Session及日志中的Rental Tools / Prompt / Resource / system指引来源可在重载后收紧材料检查，不恢复授权。双语隐私 / 普通副本 / 费用提醒只入原人类command/done，不入模型，也不是可信Web同意或全局发送前过滤。

## 4. 下一入口与未完成门槛

先按固定生产者和原Host公开能力选择可实施消费者，不能用synthetic成功、内部接口、测试数或默认关闭补正式门槛。

| 原任务 | 下一入口 / 必须保留的缺口 |
| --- | --- |
| AGP-02 / 03 | 等原作者固定可发布的安全授权摘要、空间、固定可信Action、生产grant / 当前Guard / ALS及撤销合同。MCP service构造器、registration / introspection、metadata和本地connected不是后台开通 / 生产身份。现有Web链会再次解析Web session，不透传MCP token或借管理员身份 |
| AGP-03完整恢复 | 长期安全凭据、可信原grant核对解除、跨进程锁 / 崩溃窗（含clear到补写之间）、存储丢失 / 配置变化 / 持续故障及所有清理变体未齐。原短期内存不隔离恶意同进程插件 / OS管理员；重启重登不等于核对unknown，RFC7009接受不证明整个grant独立核实撤销 |
| AGP-04 / 07 | 原目录输入runtime / 结果类型及内部结果runtime已由[shared正式出口](../../packages/shared/src/ai-catalog-read.ts)供给，实际API同实例校验与NodeNext消费见[MCP阶段](../MCP服务/MCP服务-开发记录.md#阶段原目录结果公共运行时校验2026-11-06)。这不是完整MCP输入 / 输出wire或字段发布；实际工具 / 版本 / release / 目标仍未齐，Host对未支持schema保持UNSUPPORTED_SCHEMA，不删约束、注册或改走Resources。公开运输名仍受48字符限制，Host publicToolName未公开导出，不私造截断 / hash或深导入 |
| AGP-05 | 最终Provider线包、目的地 / redirect、图片 / 检查后路径变化、摘要 / 派生 / 导出及全部重放未控制。普通Host历史 / 其他插件 / 外部模型 / 用户副本不可承诺回收；30天业务缓存 / 7天临时附件、失焦 / 隐藏 / 退出用途及清理失败恢复等完整受控生命周期未齐，严格资料保持不可用。旧人工目录复核5秒 / 至迟3秒续查、材料30秒 / 来源首次60秒的原约束保留，不称新插件已接 |
| AGP-06 | MCP已补持久关联 / 原输入source与累计预算，见[阶段](../MCP服务/MCP服务-开发记录.md#阶段原目标调用持久关联2026-11-06)，但真实前台目标作者 / 请求locator、四类可信计量 / 完整活跃口径、原操作键 / 本人索引和精确业务收据及Harness引用消费者仍未齐。Gateway calls不等于业务calls，不建local Map账本、不交lease、不用新连接 / token / ID重置；unknown只按原关联核对，超时 / 断线 / 取消 / TTL不是回滚证明 |
| AGP-08 / 09 | 原可信选择 / Core报价 / 提案 / 批准 / 唯一建单及有限云协同消费者未接。MCP原结果 / Task恢复 / operation / list / 选择 / 提案 / readResult为不发布的只读候选，原Reader及正式ESM证据见[MCP记录](../MCP服务/MCP服务-开发记录.md)；Host schema和身份 / 字段 / 累计计量缺口保持，不调用可能执行的reconcile，不从主线通知继承批准或发布授权 |
| AGP-01 / 10 | G1～G3既有Bundle证据保持；真实用户原版CLI安装、升级替换、完整Host / schema / Web / 服务组合和原生呈现安全模式未验。静态HTML与交互预览不同，不因iframe或生成文件存在视为隔离；缺严格控制退安全文本或拒绝，不关闭保护或另造renderer |

原目录人工预览、定制壳 / workbench / `rentalDesktop` / `sidebar.rental.*`和旧AGC源码 / 测试全保留，不能作为原版插件依赖或当前验收。原工作台五源码与`tests/agent-desktop.test.cjs`中断WIP未认领、未补本片类型 / 构建。AIN-02冻结、主线审核v2 / 设置恢复 / releaseUnstarted只是原线事实，不代表Harness业务接通。

## 5. 验证与接手边界

- 继续先核实际目录 / 分支 / HEAD / status / 暂存 / 操作状态及并行作者，读根[AGENTS](../../AGENTS.md)、[README](../../README.md)、本专项正式依据及原MCP接续。只能接原作者固定成果，不追活动HEAD或抢写公共文件。
- 本树已有原离线runner、独立Node24.21.0 / npm CLI及本片所需固定Host / SDK / TS产物，6,094份文件 / 135包、498个本树可读目标链接已核对；初期长路径 / 错junction / hoist失败及部分文件全部保留，以[最终收据](../../output/harness-toolchain-copy-20261104-53ex9x2s/result-hoisted.json)和实际Loader组合为准，不以早期不充分检查宣称环境可用。验证沿本树preload、固定无效DATABASE_URL、绝对audit / writeRoot / TEMP / cache；不从原树运行后冒认，不擅自安装、联网或复制共享Prisma / shared产物绕保护，不跑根lint / build重建shared。
- 当前通过区分为全插件strict / 公开声明、离线实际归档 / profile / Loader / Registry / AgentLoop / SDK组合。HTTP / AS / grant / Web同意 / 浏览器 / listener / 模型是明确外部夹具，不等于真实用户安装、OS / GUI、数据库 / 外部服务、正式业务验收或发布；不要求用户手工代验未验证部分。
- 各完整阶段按原连续G门逐项核对，有证据跨档才改原任务百分比；未跨档留原记录。阶段证据写原开发记录，接续只覆盖当前目标 / 归属 / 缺口 / 下一入口，精简前像已保全，不另建第五册、临时主计划或修复流水队列。
