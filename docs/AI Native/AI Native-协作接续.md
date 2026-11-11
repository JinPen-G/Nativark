# AI Native：当前协作接续

> 更新日期：2026-11-12。负责人已明确恢复 AI Native 专项研发，由 AI-RD 负责、AI-dev1 与 AI-dev2 协作，唯一开发目录为 `D:/工作文件/rental-OS/worktree/ai-native`，分支 `codex/ai-native`。旧暂停和旧工作树派工不再是本轮停止指令；本轮研发按模拟冒烟验收，真实测试由负责人自行操作，生产开放仍须原授权。覆盖前原文保留在固定main `9b616d8e5d5932bffdc26eabce8ab3a47b1627da`的本文件，历史未完项全文仍见[开发记录](<AI Native-开发记录.md#ain-three-tree-preserved-open-items-20261109>)。

## 当前目标与结果

目标为完成原 AIN-01～28 及 ENTRY-01～18 的正式开发任务，优先可用的核心场景和实际生产装配；不新增边缘功能、Reserved 范围或测试脚本，仅做必要模拟冒烟与类型检查。按负责人新决定及需求v1.15/任务v1.19，真实测试由负责人自行操作，不再阻塞研发100%；功能范围、原任务代码依赖和独立复核仍须齐备，不以提交或局部绿色计整项完成。

AIN-05、06、07、10及11已完成整项模拟研发收口，分别见[05](<AI Native-开发记录.md#ain05-simulated-whole-closeout-20261111>)、[06](<AI Native-开发记录.md#ain06-simulated-whole-closeout-20261111>)、[07](<AI Native-开发记录.md#ain07-simulated-whole-closeout-20261111>)、[10](<AI Native-开发记录.md#ain10-simulated-whole-closeout-20261111>)、[11](<AI Native-开发记录.md#ain11-simulated-whole-closeout-20261111>)，均已由PM固定核接main。QA P1/P3和P2两原缺陷已分别推送f86b81aea/ef15308df并独立差异收main6fce308c/3a06c8861。AIN-12原展示25源固定7332875c9由PM串行核接，生成、原witness/Gateway、公开只读及TaskCenter消费已有整链模拟，原字段/重新准备/完整控制仍未齐；17等Core原配置counter/同事务真实源，18继续原grant/办理/复查；13/14两消费hash修复已冻结待Root核接。员工16文件仍冻结，真实测试交负责人自行操作。

本次从已上传的 `859ad9abdccd017de3dd24bf7767ffb16a311a7a` 开工；此前三树/五树整合成果均沿 main 历史继承，旧 AI 主树和残留目录已经移除。main 的原WIP及PM当前环境/治理修复均不混入本专项提交，PM集成期间本树继续独立开发。历史 `output` 证据统一在主仓库 `D:/工作文件/rental-OS/output` 对应路径只读查阅，未复制到新工作树。本批固定消费者、恢复宿主及实际失败见[未完成检查点](<AI Native-开发记录.md#ain-core-checkpoint-20261111>)。

检查点已上传为 `dac1c9d65`，固定main环境/治理修复同步为 `d7929c439`，核心提供者/初始准入/规则及日历消费者已上传 `13e1d6189`。核心13个配置token现有真实部署发布来源，见[该阶段记录](<AI Native-开发记录.md#ain-runtime-publication-20261111>)；[普通用户原读取续期](<AI Native-开发记录.md#ain-original-read-policy-20261111>)已上传 `2d9ce0543`。[关联新材料到新批准/Core订单](<AI Native-开发记录.md#ain-linked-requote-consumer-20261111>)已上传 `80eeb52f5`；[有效原等待的提交/继续准入](<AI Native-开发记录.md#ain-original-input-admission-20261111>)已上传 `acfa35b4d`；[原选单审批/继续/再准备及实际TaskCenter消费](<AI Native-开发记录.md#ain-quote-approval-policy-consumer-20261111>)已上传 `6bedbdebe`。[通知设置已发布等待的批准/继续](<AI Native-开发记录.md#ain-settings-approval-policy-consumer-20261111>)已上传 `a10993dcd`；[普通用户首次start完整服务端生命周期](<AI Native-开发记录.md#ain-settings-initial-lifecycle-20261111>)已上传 `88920a307`，后台首次创建和过期政策后的原读取已完成本片核接，见[通知入口与历史收据](<AI Native-开发记录.md#ain-notification-consumer-history-20261111>)。[客户原报价预约HTTP接续和受控mini公共合同运行时](<AI Native-开发记录.md#ain-client-original-quote-booking-http-20261111>)已上传 `869fa6e88`；[两端实际消费者](<AI Native-开发记录.md#ain-client-quote-consumers-20261111>)的原读、定位覆盖及Core归还地点问题已修复，当前真实源码链冒烟通过。实际部署配置未启用。main当前由PM处理独立休息播放器，不改其AppShell/locale/管理后台四册或启停在用服务。

原订单人工交接、显式只读政策、首字/首卡宿主，以及原报价再准备、optional runId、订单材料、会员和日历消费者都已进入main。企业成员/门户、MCP/Harness和网站按固定快照核接，文档树已在祖先链。冻结后无新增源码/status差异，七份原稿档案哈希匹配；来源和实际归档位置见[逐树核对](../../output/other-worktrees-consolidation-20261110/source-and-archive-final-audit.json)。旧设计、日志和隔离产物不替代运行依赖或业务验收。

修复、验证及历史失败见[本阶段记录](<AI Native-开发记录.md#ain-main-consolidation-20261110>)和[验证回执](../../output/other-worktrees-consolidation-20261110/validation/summary.json)。原Guard/ALS、当前范围、Core事实、独立批准及unknown原收据边界保持；本次不据合并新增AIN/ENTRY的100%，进度只在[任务册](<AI Native-开发任务.md>)维护。

## 主树与写入归属

三人在同一 AI Native 工作树按文件分工；根索引、提交与推送只由 AI-RD 操作。助手用 `git hash-object -w -- <拥有的具体文件>` 保存完成片的固定 blob 并回报路径、原任务ID和验证边界，随后继续不冲突的下一项；AI-RD 按固定对象核接，不要求助手停下等待提交或合并。

| 位置 | 当前职责 |
| --- | --- |
| AI-RD／`01a1be68-da55-7f13-9536-79be07cb2093` | QA两独立片已推/收main；负责12原witness/Gateway/公开/TaskCenter25源切片固定提交与剩余字段/原控制，17实际Core源/scoped存储/传桥，18真实grant政策/public/factory/办理挂接；四册与索引唯一作者，不夹其他活动WIP |
| AI-dev1／`01a1bf34-f061-74c2-b588-3e21385c4b49` | 12七源、13/14 ReadinessDiagnosticsCard/ConversationOrderHandoff已冻结；现独占aiConversations.ts及conversation-opening-execution-session.ts，修minimal original ref错调完整create-command reconcile的实际开业启动/历史源读取，保持firstStart/同键/前后来源与scope。测试/runner不改 |
| AI-dev2／`01a1bf35-1ee5-7400-a97d-c0ebf5f9482c` | 17原五源/store/政策队列六源及18三前端均冻结；18 HumanReview及grant私有两源也已交回Root（f2b86f49/bd11c96b）。Root需接独立runtime publication政策、shared/public/factory与当前policy端口；缺permission/TTL不猜、不从GET推写权，AUTOMATION owner不放宽 |
| `D:/工作文件/rental-OS`／`main` | PM独占集成，05/06及07/10/11、QA两原AI片均已核收；固定7332875c9仅27文件独立核接，不收794724cd1资源schema检查点或活动WIP。六项他人成果保持，Core读取/counter另等固定完整源 |

三人按负责人明确恢复的原目标持续施工，工具旧失败/旧goal标记不代替实际执行状态。助手只在需要负责人决策的真实阻塞、公共符号冲突或完整阶段冻结交付时合并发送简短消息；不重复心跳、过程日志和旧证据，可自行解决的失败自行处理。shared总出口、OpenAPI总入口、Prisma schema、AuthGuard、AppModule等跨专项公共文件须与PM协调唯一作者；企业端已获准的ClientApiService.readOrderSubmission第二次读取、AppModule/OpenAPI企业reader/controller/三条GET及后台企业政策材料片段保持其归属。Core交易、资金和品类事实由Core专项提供，AI不重建这些业务权威。

每个可独立验证阶段立即提交推送`codex/ai-native`，由PM按固定成果串行核接main，不再等待两项100%；巡检按PM当前3小时安排，不把patch/冒烟当任务。05/06及07/10/11、QA两原AI片均已收回并核GitHub；固定7332875c9的27文件按本次差异独立整合，main原schema与六项他人成果保持，见[展示整合证据](<AI Native-开发记录.md#ain12-main-display-integration-20261112>)。后继6d4dda8af与活动WIP另片核验；来源、main、文件、WIP与索引须实核，助手继续独占开发。

## AIN-17最小Core接点窗口

本树[AI树资源schema检查点](https://github.com/JinPen-G/rental-OS/blob/f86b81aeacda3806ee0a5ae2ddd02e8349eff9d3/docs/AI%20Native/AI%20Native-%E5%BC%80%E5%8F%91%E8%AE%B0%E5%BD%95.md#ain17-resource-schema-checkpoint-20261112)已离线验证，未执行DDL。新模型字段：TenantRentalProfile/RentalCoreStateSnapshot.configurationRevision；RentalTenantBusinessSettings新增tenantId/workspaceId复合唯一键，沿已有settingsRevision；AiBusinessFailureOutbox新增fulfillmentOrderId、configurationKind/Id、profileTenantId/snapshotWorkspaceId/settingsWorkspaceId三个配置FK列（正式列名均以前缀configuration开头）、sectionCode、dueAt、locationId、sourceHash、sourcePolicyId/Revision。原C08 number版本与旧三类资源列不改。

| 原Core入口 | 所需最小改动及消费者 |
| --- | --- |
| [rental-allocation.service.ts](../../apps/api/src/modules/rental-core/rental-allocation.service.ts) 的 scanOrder → recordIssue → facts.saveOrderAggregate(order,[],tx) | 在原assignment修订及业务tx内追加可选fulfillment Outbox参加者；只用当前Core可交付判定、实际startAt/fulfillmentLocationId和已发布临近政策。消费者为原BusinessFailure候选/人工复查/自动化准入，不另设轮询或调度事实 |
| [rental-core-config.repository.ts](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts) 的 upsertProfile 原tx/default-workspace分支 | 真实档案行的原子configurationRevision推进与可选opening参加者；非默认分支不修改既有默认档案、不制造缺行事件。readReadinessCoreFacts/readOpeningConfigurationFacts仍是有界R0原读取来源 |
| [rental-business.service.ts](../../apps/api/src/modules/rental-core/rental-business.service.ts) 的 persistBusinessConfig 原tx及 readTenantReadiness | 复用原business settings修订，在原提交内追加相应开业分区事件；读取九项R0的完整basis重核，禁止state/seedState或updatedAt伪造总版本 |
| [rental-state.repository.ts](../../apps/api/src/modules/rental-core/rental-state.repository.ts) 的 saveCoreState | 前三入口之外确需的最小仓储接点：空间快照原子configurationRevision、scoped原tx及可选opening参加者。仅快照行版本，不当作九项总版本；缺快照不补版1 |

上述Core最小窗口已由PM核准交Core实现，含必要snapshot-backfill兼容；AI等固定原合同，不提前修改权威提交者。Root组合真实readFulfillment/readOpening与dev2私有存储，补human-automation request/provider；原五类policy/review/queue闭合片已冻结待独立核接。发布阈值未提供保持not_captured/unavailable，不能编造policy；九项独立读取不冒称单事务快照。schema检查点和存储冻结均不代表AIN-17整项完成。

Core只读合同已固定源码`fe65ac652076d5bed4c9ca439d50b563c61d17aa`、记录`5983acd3af5c3457dade88fc32515c9a2efc493f`，Root已只读核方法：allocation.readRecordedFulfillmentIssue(tenantId,orderId,tx)只读原业务tx中的实际assignment修订/startAt/location及issue_recorded，不scan、不开新事务；business.readTenantReadinessSource(tenantId)返回九项原判定、独立持久读观察窗口和真实存在的categoryBinding，不补默认版1。这些源尚未由PM核收main，配置counter原提交链仍按Core`5e8d52325/61fece91`检查点等待固定完整实现。桥接还须核issue_recorded能否按Core正式判定得到resource shortage，不能靠解析历史issue文本或直接把任意issue映成shortage；临近政策缺失仍不捕获。

## 当前QA与展示接续

[P1/P3固定修复及边界](<AI Native-开发记录.md#ain-qa-current-permission-20261112>)已收main`6fce308c4`。P2固定`ef15308df`完成Controller/API/session两个丢应答窗口，PM按本提交两源码差异串行收回，沿[原阶段](<AI Native-开发记录.md#ain-qa-clarified-quote-receipt-20261112>)核证。原`scene-answer:${inputRef}:${receiptId}`仍是澄清报价及选单的唯一读取依据，关闭模型后只读同键、缺失保持unknown，不用普通inputRef/contentHash键替换或恢复新执行。

P1/P3已推送f86b81aea并由PM独立差异核入main6fce308c，dev1零初始政策8+3+5 CAS/一次Core的原通知链也通过。[P2](<AI Native-开发记录.md#ain-qa-clarified-quote-receipt-20261112>)已完成Root原报价/选单同键、精确reference/存储指纹及必要类型，dev1已独立核quote/selection两丢应答的实际Controller/API/session、当前owner/space/撤权、source/hash及unknown反例；按provider/readers两源码和原记录/接续立即固定交付，由PM只收本差异。12生成/公开接点、17资源和18人工消费者WIP分别保留，不随本P2合入。

AIN-12[原展示生产/读取/TaskCenter消费25源](<AI Native-开发记录.md#ain12-original-display-pipeline-20261112>)已核实际Guard、Controller/信封、API/session和固定类型，待本片立即固定上传/PM核接。非null字段basis、可信人类输入/重新准备、重排/重新解释和两入口原办理控制仍未齐，不增加100%；普通历史无witness不得补签。新未发布display-revalidate/display-source已用小写path适配原Guard，旧modelResult/closeUnstarted会话公共路径匹配需PM最小Guard窗口核定，不以新path通过冒充旧路由全通过。


## 后续核心入口及未完项

1. **原AIN-15报价再准备：** [新材料原请求、Core候选/报价/选单、完整比较及新批准](<AI Native-开发记录.md#ain-linked-requote-consumer-20261111>)已接回现有前端和module，原unknown拒绝、丢应答只读恢复及Core单次订单经本片离线核接。原前像仍在`output/ain-human-reprepare-locator-core-20261110/`，此前选单链见[原阶段](<AI Native-开发记录.md#ain-conversation-quote-selection-core-20261109>)。剩余是客户/企业的真实授权入口及原全品类、真库和人工等价门槛；当前Core明确不允许operator冒充企业员工委托，不能移除付款者拒绝或伪造客户身份来补绿。
2. **原AIN-13/ENTRY-05人工交接及只读政策：** 订单v2事实/来源消费者已核接，ordinary-read现在允许当前本人按原业务资源读权明确续期三项读取政策，原manager管理路径保持独立。创建过期/执行关闭不挡合法原读；无必要资源依据仍拒绝。没有在读取时自动种政策或授模型/Core执行；原CAS、TTL、三项独立收据及partial/unknown不重发保持。本片原Controller→实际API/session链已独立验证，真实浏览器与整项门槛仍未代验。
3. **原AIN-25：** 真实首字/首卡组件及关闭、重开、React效果重放代码已回收，一组离线宿主冒烟通过；真实浏览器可见性、完整场景、容量/SLO、队列/背压/公平性/告警仍需原门槛。客户端报告不成为经营或计费事实；原11同账与累计资源要求保持。
4. **其余原任务：** 05/06/07/10/11已按当前完整实现及模拟研发门槛核闭，不再沿旧真实测试前置重复阻挡。当前明确核心缺口为12的隔离展示/封闭桥与真实Artifact/context/字段生产、17的两类实际资源/版本/同事务来源；13～16完整目标入口和多角色、19～28员工/平台/安全/容量/组合灰度及交付范围仍逐项核定。详见[原28项摘要](<AI Native-开发记录.md#原28项当前实施摘要>)与[原未完依据](<AI Native-开发记录.md#ain-three-tree-preserved-open-items-20261109>)；旧真实验证要求转负责人实测，不取消代码、授权与原业务范围，不新增Reserved或边缘能力。
5. **客户与ENTRY：** [报价两端消费者](<AI Native-开发记录.md#ain-client-quote-consumers-20261111>)和[客户实际Task/取消/事件](<AI Native-开发记录.md#ain-client-task-consumer-closeout-20261111>)已核接，保持原固定订单解释；原mini合同/有效原问题/原时间账的证据保留在各阶段。员工[显式首次准入](<AI Native-开发记录.md#ain-staff-initial-start-admission-20261111>)已上传 `6dc1419d6`；[原结果定位与正式装配](<AI Native-开发记录.md#ain-staff-original-result-reference-20261111>)已完成5文件固定核对和独立离线组，原wire为21旧合同、9 taskContracts/52 schemas。私有员工页面/session继续由dev2收口，须沿已交准入验证完整首次调用及原候选消费；原unknown只读，清除已不需要的本地正文。其他Action/audience、匿名/企业、跨surface、媒体弱网和真实设备仍见[ENTRY摘要](<AI Native-开发记录.md#entry-增量实施摘要>)，未据局部组增加整项进度。
6. **当前核心准入接线：** 初始CAS参加者已接模型明确start、新规则R1准备和新材料关联任务；ordinary-read、有效WAITING_INPUT、原选单订单批准/继续/再准备及原notifications确认等待的3/5项准入均已完成相应实际消费核接。TaskCenter明确写先核当前本人原来源，纯读取不签；真实过期、已消费或unknown不重做。settings首次start现已接原创建/change收据，零预置目标政策的公开Controller/Guard链通过8+3+5 CAS及一次Core设置提交，见[本片记录](<AI Native-开发记录.md#ain-settings-initial-lifecycle-20261111>)。后台原通知变更准备/创建/start消费者及TaskCenter实际挂接已完成，原政策过期后的result/confirmation/snapshot/events四读已通过当前Core/创建收据权威；StrictMode会话重放和隐藏后的迟到结果已修复，见[阶段记录](<AI Native-开发记录.md#ain-notification-consumer-history-20261111>)。会员姓名原ID入口已随 `b67e9255f` 核接；AIN-14日历接回及当前问题见下项，其余原范围继续按原门槛核定，不据局部片宣布整项完成。

7. **日历与规则入口：** 日历24文件已完成[负责人核心核接](<AI Native-开发记录.md#ain-calendar-source-consumer-closeout-20261111>)，规则19文件加3个公共注册已完成[规则整链独立核接](<AI Native-开发记录.md#ain-rule-source-intake-20261111>)。两者按稳定对象保留原journal，Core证实后才可精确结束原轮次；原body、角色、版本、R1/Core边界和原收据恢复均已核。写权均回Root，原14/16全文其余范围仍按新研发验收逐项确认。

以上保留原任务范围、编号、依赖和验收；恢复功能施工须沿负责人当次授权。每个完整核心切片只做必要定向冒烟和类型检查，跨原G1～G4门槛后维护唯一任务表；未跨档的缺口留记录，不能把合并或档案数量当100%。

## 验证与资源边界

新树为稀疏源码检出，没有复制 node_modules、output 或环境文件。现已核实可向上只读解析TypeScript5.9.3、ts-node10.9.2及其source-map-support、Nest10.4.22、React/ReactDOM与Zod；主仓库API本地生成Prisma5.22 Client的schema与本树规范化内容一致，可只读用于类型检查。根node_modules的Prisma仍是未生成壳，不能误用；既有step-repository冒烟要求本树output内私有Client，本轮未复制或新生成，不假路径跳过所有权断言。

离线命令沿本树原 preload 和固定不可达 DATABASE_URL，写入只在本树单一任务临时目录，退出清理；能纯内存完成的冒烟不落临时文件。旧整合、企业/MCP/网站及员工类型结果只作历史证据，本轮未重新验证部分保持未验。禁止新增或扩写测试脚本，也不得删断言、skip/todo 或弱化权限换绿色。

模拟冒烟只记模拟证据；完整实现、装配及复核满足现行G4后可记研发100%，不冒称真实宿主、数据库、供应商或发布通过。本专项不执行真实环境测试，交负责人自行操作；没有安装、启服务、真实外部连接、迁移或部署。PM主仓库服务恢复不是本树验收。先前9项离线组的1项失败保留在原检查点；本轮客户恢复及通知原读的实际复验见对应阶段记录，不合并不同批次声称全量通过。验证与审计纯内存完成，临时目录不存在。当前文档检查6处既有缺链（导航归档3、稀疏站点演示1、主仓库历史产物2），本片没有新增；旧环境和失败证据保持，不伪造附件补绿。
