# AI Native：当前协作接续

> 更新日期：2026-11-11。负责人已明确恢复 AI Native 专项研发，由 AI-RD 负责、AI-dev1 与 AI-dev2 协作，唯一开发目录为 `D:/工作文件/rental-OS/worktree/ai-native`，分支 `codex/ai-native`。旧暂停和旧工作树派工不再是本轮停止指令；外部业务访问与生产开放仍须原授权。覆盖前原文保留在 Git 提交 `859ad9abdccd017de3dd24bf7767ffb16a311a7a` 的本文件，历史未完项全文仍见[开发记录](<AI Native-开发记录.md#ain-three-tree-preserved-open-items-20261109>)。

## 当前目标与结果

目标为完成原 AIN-01～28 及 ENTRY-01～18 的正式开发任务，优先可用的核心场景和真实生产装配；不新增边缘功能、Reserved 范围或测试脚本，仅做必要冒烟与类型检查。任务百分比仍按原门槛和实际证据维护，不以代码提交、局部修补或缺依赖的替身结果计100%。

本次从已上传的 `859ad9abdccd017de3dd24bf7767ffb16a311a7a` 开工；此前三树/五树整合成果均沿 main 历史继承，旧 AI 主树和残留目录已经移除。main 的原WIP及PM当前环境/治理修复均不混入本专项提交，PM集成期间本树继续独立开发。历史 `output` 证据统一在主仓库 `D:/工作文件/rental-OS/output` 对应路径只读查阅，未复制到新工作树。本批固定消费者、恢复宿主及实际失败见[未完成检查点](<AI Native-开发记录.md#ain-core-checkpoint-20261111>)。

检查点已上传为 `dac1c9d65`，固定main环境/治理修复同步为 `d7929c439`。核心13个配置token现有真实部署发布来源，原规则列表桥和已审材料hash接点已补，见[本阶段记录](<AI Native-开发记录.md#ain-runtime-publication-20261111>)；实际部署配置未启用。main当前由PM处理独立休息播放器，不改其AppShell/locale/管理后台四册或启停在用服务。

原订单人工交接、显式只读政策、首字/首卡宿主，以及原报价再准备、optional runId、订单材料、会员和日历消费者都已进入main。企业成员/门户、MCP/Harness和网站按固定快照核接，文档树已在祖先链。冻结后无新增源码/status差异，七份原稿档案哈希匹配；来源和实际归档位置见[逐树核对](../../output/other-worktrees-consolidation-20261110/source-and-archive-final-audit.json)。旧设计、日志和隔离产物不替代运行依赖或业务验收。

修复、验证及历史失败见[本阶段记录](<AI Native-开发记录.md#ain-main-consolidation-20261110>)和[验证回执](../../output/other-worktrees-consolidation-20261110/validation/summary.json)。原Guard/ALS、当前范围、Core事实、独立批准及unknown原收据边界保持；本次不据合并新增AIN/ENTRY的100%，进度只在[任务册](<AI Native-开发任务.md>)维护。

## 主树与写入归属

三人在同一 AI Native 工作树按文件分工；根索引、提交与推送只由 AI-RD 操作。助手用 `git hash-object -w -- <拥有的具体文件>` 保存完成片的固定 blob 并回报路径、原任务ID和验证边界，随后继续不冲突的下一项；AI-RD 按固定对象核接，不要求助手停下等待提交或合并。

| 位置 | 当前职责 |
| --- | --- |
| AI-RD／`01a1be68-da55-7f13-9536-79be07cb2093` | AIN-15 报价再准备、TaskHumanApproval/任务中心公共消费者、AI 专项契约/装配和四册；负责独立核接、提交推送与每两项合main |
| AI-dev1／`01a1bf34-f061-74c2-b588-3e21385c4b49` | 订单11文件、规则8文件、日历2文件均已冻结；继续AIN-15新材料关联请求，拥有QuoteReprepare/session、报价选单shared/schema/专属API及对应human-quote/request-bound方法；总注册/TaskHumanApproval/locale归AI-RD |
| AI-dev2／`01a1bf35-1ee5-7400-a97d-c0ebf5f9482c` | 原runner9文件、初始签发2文件及ordinary-read单文件已冻结；继续WAITING_INPUT原等待仍有效、短操作政策过期的专用提交/继续准入，不扩成通用续期 |
| `D:/工作文件/rental-OS`／`main` | 仅作跨专项整合入口；当前PM处理环境/治理修复，合并串行；各专项开发继续，保留所有已核及未核WIP |

三人的本轮持续目标均已建立为 active。阻塞或完成须立即给出具体入口、原任务号、固定对象与实际结果，由 AI-RD 决定解决者或接续任务。shared 总出口、OpenAPI总入口、Prisma schema、AuthGuard、AppModule 等跨专项公共文件须与 PM 协调唯一作者；Core交易、资金和品类事实由 Core 专项提供，AI 不重建这些业务权威。

每个完成阶段立即提交并推送 `codex/ai-native`；累计新增两项正式任务达到100%后，AI-RD 将核定的固定提交合入main并推送。按原任务表中的唯一 AIN/ENTRY 任务ID计数，不把两个patch或冒烟用例当两项任务。合并前核对固定来源SHA、预期main SHA、影响文件和完成任务ID，确认无其他集成或索引争用；有争用只暂停该次集成。当前本轮新增完整任务为0，待合批次为空，距下次批次还需2项。

## 后续核心入口及未完项

1. **原AIN-15报价再准备：** 后端只读定位和[会话WIP](../../apps/admin/src/features/ai-native/quote-reprepare-session.ts)已保留、类型通过；服务端原再准备→新批准→Core单次订单→丢失应答原收据链通过本次离线冒烟。仍缺新材料发起、完整前端选择/对比及其端到端消费。不要让用户手填Step/ActionInput/planHash；unknown只核原操作，不换键重发。入口和前像在`output/ain-human-reprepare-locator-core-20261110/`，前置正向链见[原报价选单阶段](<AI Native-开发记录.md#ain-conversation-quote-selection-core-20261109>)。
2. **原AIN-13/ENTRY-05人工交接及只读政策：** 新代码已合回，完整消费者行为尚未独立收口。仅显式管理员配置原read_metadata/read_events/read_step_terminal政策，不自动种政策、不授模型或Core执行；保留原CAS、TTL、当前权限及三项独立原收据，部分/unknown不得重发。侧树原验证结果与候选均在主树成果档案内，不能借作者的绿色替代主树验收。
3. **原AIN-25：** 真实首字/首卡组件及关闭、重开、React效果重放代码已回收，一组离线宿主冒烟通过；真实浏览器可见性、完整场景、容量/SLO、队列/背压/公平性/告警仍需原门槛。客户端报告不成为经营或计费事实；原11同账与累计资源要求保持。
4. **其余原任务：** 05→06→07完整供应商/能力/往返及故障前置、12/13～16完整Agent和多角色资料隔离、17～28可靠事件/知识隐私/员工与平台治理/组合灰度及交付缺口均保留，详见[原28项摘要](<AI Native-开发记录.md#原28项当前实施摘要>)和[完整未完原文](<AI Native-开发记录.md#ain-three-tree-preserved-open-items-20261109>)。不重开已有100%条目，不新增Reserved或边缘能力。
5. **客户与ENTRY：** 当前两端三Action以原证据为准；六不可用Action、其他audience、匿名/企业、跨surface重绑定、媒体弱网及真实设备仍需完成。详见[ENTRY摘要](<AI Native-开发记录.md#entry-增量实施摘要>)，不以档案/报告数量或本次局部绿色加分。
6. **当前核心准入接线：** 原发布政策/本人/业务权限的专用CAS参加者已接模型明确start及新规则R1准备，规则真实消费者已独立通过原操作恢复的离线闭环。ordinary-read单文件已交付，负责人下一步接独立三路由/现有读取消费者和新storage命名空间；原manager管理入口不降权。完整新材料报价关联入口、已有任务合法观察接线与等待后继续仍待收口，metadata准入不等于Run领取、业务批准或Core执行。

以上保留原任务范围、编号、依赖和验收；恢复功能施工须沿负责人当次授权。每个完整核心切片只做必要定向冒烟和类型检查，跨原G1～G4门槛后维护唯一任务表；未跨档的缺口留记录，不能把合并或档案数量当100%。

## 验证与资源边界

新树为稀疏源码检出，没有复制 node_modules、output 或环境文件。现已核实可向上只读解析TypeScript5.9.3、ts-node10.9.2及其source-map-support、Nest10.4.22、React/ReactDOM与Zod；主仓库API本地生成Prisma5.22 Client的schema与本树规范化内容一致，可只读用于类型检查。根node_modules的Prisma仍是未生成壳，不能误用；既有step-repository冒烟要求本树output内私有Client，本轮未复制或新生成，不假路径跳过所有权断言。

离线命令沿本树原 preload 和固定不可达 DATABASE_URL，写入只在本树单一任务临时目录，退出清理；能纯内存完成的冒烟不落临时文件。旧整合、企业/MCP/网站及员工类型结果只作历史证据，本轮未重新验证部分保持未验。禁止新增或扩写测试脚本，也不得删断言、skip/todo 或弱化权限换绿色。

类型、构建和定向离线行为不代表真实宿主、数据库、供应商、整项G4或发布通过；本专项没有安装、启服务、浏览器/微信、真实HTTP/DB/DNS/模型/支付/对象存储、迁移或部署。PM主仓库服务恢复不是本树验收。原9项离线冒烟有1项待修，不宣称全部通过；验证与审计纯内存完成，临时目录不存在。旧环境和失败证据保持，文档导航三条既有历史缺链不伪造补绿。
