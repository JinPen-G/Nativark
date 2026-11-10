# Harness 插件：当前协作接续

> 更新日期：2026-11-10。插件0.1.8固定成果已合入`D:/工作文件/rental-OS`的`main`；原循环和分树施工保持停止。正式依据仍为[需求](Harness插件-需求.md)及[开发任务](Harness插件-开发任务.md)，本次来源、验证与门槛复核见[记录](Harness插件-开发记录.md#agp-main-consolidation-20261110)。

## 1. 当前目标与职责

本阶段完成已有成果整合，并按负责人授权提交/普通推送。清理前的插件构建证据保留；恢复后MCP四组离线冒烟通过，但完整主工程复验仍受本地依赖缺件阻塞，见[恢复后回执](../../output/other-worktrees-consolidation-20261110/validation/post-recovery/summary.json)。后续业务首片仍为后台开通→OAuth→当前会话/空间→同一MCP发现/目录→自主安全结果与撤权拒绝，不恢复旧Goal或自动进入新功能。

原Harness MCP客户端仍是唯一业务通路；插件只补OAuth/连接、会话、状态和指引，不建AgentLoop、业务API或第二renderer。服务端MCP负责原身份、grant、字段、累计计量、批准/Core与收据；本地用户模型自付，真正云委托仍走原Gateway和单账。客户端状态不自授权。

## 2. 主树与固定证据

当前源码入口为main。固定源提交`c6b7872435e42cde484f068969e32f3bacd900ca`已进入祖先链；[逐树核对](../../output/other-worktrees-consolidation-20261110/source-and-archive-final-audit.json)确认冻结后无新增差异。原工作目录按负责人授权移除，旧失败和全部保全原稿保持在D盘档案；实际清理与Windows残留保留位置见[清理回执](../../output/other-worktrees-consolidation-20261110/worktree-removal-result.json)，最终提交与远端核对见[交付回执](../../output/other-worktrees-consolidation-20261110/final-receipt.json)。

原0.1.8 tarball及清单、0.1.7/更早包、Loader日志在D盘[固定档案](../../output/other-worktrees-consolidation-20261110/peer-results/claude-harness-plugin-20261104-verified.zip)内。0.1.8 SHA-256为`1edaed7fd9f2a4f44ff46568cc5cea0a540a7bfdc89b69a2986659e9771b2239`；[16份包源核对](../../output/other-worktrees-consolidation-20261110/harness-package-source-audit.json)与main等价。旧Loader19/19为11月6日证据，本次只重新构建/类型核对，不称新宿主安装验收。覆盖前接续见[前像](../../output/other-worktrees-consolidation-20261110/main-docs-before/manifest.json)。

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

本次main插件strict/声明构建通过，实际使用固定Host公开类型、SDK2.2.0与声明的Zod4.4.3；现有第三方依赖仅从旧树只读解析，生成物在main私有output。未安装、替换用户profile或复制别树生成物冒充main。原19/19保留其HTTP/AS/浏览器/模型夹具边界，不等于真实用户安装、GUI、业务发布或整项完成。

后续从main、原MCP固定交付和上述未完项接手；各项跨原G门后只改唯一任务表。当前已明确授权本阶段提交/合main/普通推送，其余真实.env、安装、启服务、真实外联/DB、迁移、签名、部署、生产启用及工作树删除不自动执行。旧AGC仍封存。
