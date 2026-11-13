# AI Native：当前协作接续

更新：2026-11-14。负责人已明确继续专项，以完整实现、必要模拟冒烟和复核作为本轮研发验收；真实环境由负责人自行操作。正式依据仍为[需求 v1.15](<AI Native-需求.md>)、[任务 v1.19](<AI Native-开发任务.md>)。任务百分比只维护任务册，本文只定位当前工作。

## 当前目标与现场

在 `D:/工作文件/rental-OS/worktree/ai-native`、`codex/ai-native` 完成原 AIN/ENTRY 核心范围。[标准资源／原事务捕获／停用历史](<AI Native-开发记录.md#ain17-standard-resource-capture-history-20261114>)已推 `585b36eb670feb792b62e1cf010ffffc838e2696`，AIN-17全文仍待核定。[AIN-19整项](<AI Native-开发记录.md#ain19-source-text-simulated-whole-closeout-20261114>)已推 `2ec20f9c81f79d7a172409f619c50f3ec91d55de`，[AIN-20整项](<AI Native-开发记录.md#ain20-signature-reopen-simulated-whole-closeout-20261114>)已推 `7a451591c54decf911560f079e246f021b301ea4`，均回读GitHub一致，19／20构成本批两项新100%集成节点。PM指定main `1cb43939bcc25ed1930563aa19b3d507e9b08965` 的[12／13最终最小闭包](<AI Native-开发记录.md#ain12-13-current-main-fixed-closure-20261114>)已推整合分支 `9512e3a786cced8b32812e5121141187012da001`并回读一致；原检查收据／开业renderer和后台WIP保留，105源完整API／后台类型及原订单控制／前端消费模拟通过，未新建树／复制环境／写main。dev1两私有AUTOMATION解释叶已冻，Root Gateway单次派发／结账已有模拟，但实际宿主的模型步骤、CALLS和过期原账三个公共接点仍缺；Root接，dev1只读复验。dev2继续AIN-25取消／恢复测量和原收据具体缺口只读定位。两助手都有实际工具执行，不等提交或main，AI不争main索引／不将旧SHA当重置目标。

PM 指定 main `2a5c56471abb5714f80715e2cfa0aa236f003f51` 的[固定前置闭包](<AI Native-开发记录.md#ain12-fixed-main-closure-20261113>)已推 630，5426 十四源的主树页面后继已推 `d201979963e4f4474acd23ff1981ad81930fdfcd`，均在 codex/ai-native-main-closure-20261113 并回读一致。公共 AppModule/index 用精确 hunk，首候选 Guard 保持原 main，后继仅补 createTask 原登记，TaskCenter 保留 main 原展开/权限与旁支。该分支仅作 PM 整合候选，AI 施工仍在原树。PM 串行收每个 QA 通过的可独立阶段，任务进度仍按原全文。

开业确定性正文已推 `e4a9d5779174908ac8108d306cbed691f1252cc8`，GitHub 回读一致。QA 的 publication 时间 P2 已按[同一当前窗口及事务复核](<AI Native-开发记录.md#ain12-publication-window-p2-20261113>)完成四源/必要模拟；固定 d201 后继 `fc808e7af723ae6bca6d9d756d4d7c1b9f78fe71` 已推同一整合分支并回读一致，供 PM 按固定前置整合。原停止交付与任务取消语义已由后继入口和收据模拟核明。

规则摘要、任务筛选、通知冲突及[运行中草稿](<AI Native-开发记录.md#ain12-unsent-draft-retention-20261113>)均已核接/推送。[日历采用来源与提案历史差异](<AI Native-开发记录.md#ain14-calendar-and-saved-proposal-20261113>)已推 `955daa676e5dfb8b314302c9d0102280feb3e2d3` 并回读 GitHub 一致。[模型确认与聊天展示消费者](<AI Native-开发记录.md#ain12-model-confirmation-and-chat-display-20261113>)已推 `f398f7f80560d77caee1eccd826b1b276960e0d6` 并回读一致。[任务中心恢复/接管](<AI Native-开发记录.md#ain12-task-center-recovery-20261113>)已推 `74367697d17beea451033f8a9d4e459228fc01af` 并回读 GitHub 一致。[对话取消与停止展示入口](<AI Native-开发记录.md#ain12-explicit-cancellation-entry-20261113>)、跨轮受权上下文和最终订单三步展示/控制均已完成核接；沿固定证据维护，不重复施工。

开业/资源/经营待办已在未完检查点 `ea9a3ec2b` 同步任务分支，开业导航与原字段接线分别推送 `c53e3bded` 和 `270fbb7af`，PM 按固定依赖闭包整合，不整收混有未完事件的检查点。[检查点与前置补正](<AI Native-开发记录.md#ain-opening-automation-checkpoint-20261112>)保留原依据；AIN-13 此前因 AIN-12 未齐撤回的 G4，现按实际完成前置恢复。PM 交付的 OP SecretBox 固定修复已按[正常 Nest 与 AI 配置兼容核验](<AI Native-开发记录.md#ain-secret-box-nest-compatibility-20261112>)接入并推送 `b408e806349f2dfc743a1a6dbc9df8dad2858c37`，GitHub 已核一致。QA 指出的任务中心受控展开回归已按[有限交互核验](<AI Native-开发记录.md#ain-task-center-section-regression-20261112>)修复。

原接续完整字节保存在 Git `026e8e3ef` 的同路径，不另复制附件。三树/五树整合、模型/运行器/审批/知识/预算、原订单与开业启动观察的既有证据仍在[开发记录](<AI Native-开发记录.md>)；旧输出只按主仓库 `D:/工作文件/rental-OS/output` 的实际路径只读查证，不复制到工作树。

## 写入归属与协作

AI 树按文件分工。AI-RD 独占 Git 索引、提交、推送、四册、shared 总出口、Guard、AppModule、OpenAPI 及生产组合入口。助手完成后用 `git hash-object -w -- <具体文件>` 固定 blob，将路径、原任务与最小证据留本对话，由 AI-RD 主动读取。按负责人本日更新的消息纪律，不主动向 PM 或其他对话报告阶段、SHA 或一般阻塞；PM 主动读取原记录，只有当前具体消息明确要求时回复一次。必要具体派工仍由 AI-RD 负责，不层层转发通知。

| 负责人 | 当前范围 |
| --- | --- |
| AI-RD／`01a1be68-da55-7f13-9536-79be07cb2093` | 19／20已推，本批节点登记；PM固定1cb43939的12／13最小闭包9512已推／回读／类型及必要模拟通过，仅Git对象／内存。继续经营模型步骤／CALLS／过期原账公共接点及HTTP／provider消费者，真实完整宿主未完。独占四册／索引、公共装配／合同；AIN-15三叶和员工样式待核不夹带。 |
| AI-dev1／`01a1bf34-f061-74c2-b588-3e21385c4b49` | 原AUTOMATION两私有叶已冻结交权：authority708b048d、compositionb9764562。五类原事件、旧政策原读和unknown原键恢复／类型已有证据；实际Root Gateway注册调用已一次派发／结账，但完整宿主仍缺模型步骤主体、CALLS结算、current-human原财务读取三个公共接点。公共源由Root修，dev1只读必要复验，不改已交两叶、不新增测试或业务动作、不等main。 |
| AI-dev2／`01a1bf35-1ee5-7400-a97d-c0ebf5f9482c` | 原文／置信六源、原签名四源及19／20独立全文已交回。取消收口收据单源9703cc4a已交权，Root核同并独立模拟／类型通过，证据见[原收据修复](<AI Native-开发记录.md#ain25-original-worker-cancel-receipt-20261114>)。继续只读定位取消／恢复的持久证据及AIN-25最小指标接点，已交源码冻结；公共合同／索引／四册归Root，不新增测试、不等main。 |
| 内部开业助手／`/root/opening_core_closeout` | AIN-14品类/能力12源及独立全文结论已交回，Root核blob和必要实际provider模拟通过。既有Core治理两源来源/类型因果已只读核清，Root按固定提交同步本树；当前无活动写权。 |
| 内部日历/上下文助手 | 原时间耗尽收口单源已推；报价待确认 reader 两源已冻结交回并由 Root 独立复验，原 AIN-12 全文结论已交回，无活动写权。原慢读证据与 UNKNOWN 不被正向模拟关闭。 |
| 内部对话助手 | 原订单最终 display/history 已交回，确定性摘要单叶已交权；Root 补冻结 observedAt、公共 packet 与可信宿主。当前无活动写入范围。 |
| main／PM | 主仓库串行集成的唯一作者。可独立验证且固定提交已推送的阶段由 PM 按依赖串行收 main；完整任务仍按原门槛，不以切片提高完成度。AI 不争 main 索引或覆盖 PM/企业/Core WIP，检查点不整树回收，助手继续施工。 |

公共窗口不得夹带企业端的 ClientApiService.readOrderSubmission、企业 reader/controller/GET 和后台企业材料。PM 已将 `openapi-document.ts` 的企业申请/专用凭证登记、`enterprise-workflows.ts` 的 payment_proof/企业消息及 `file-storage.runtime.service.ts` 的 enterprise-payment-proof 区域交企业 RD。AI 本片保留其写权，确需重叠增量先交 PM 串行协调。Core 订单、资金、品类与配置权威仍由原专项负责，AI 不重建这些规则。

负责人 2026-11-13 已要求更新三人的目标，以上为现行执行范围。AI-RD 和 dev1 的 Goal 实核 active；dev2 的旧 Goal 仍显示 blocked，但已按新授权恢复实际工具执行。当前接口不能改写未完 Goal 或恢复 blocked，未将旧目标虚标完成；已向负责人说明需在 dev2 原目标卡继续，当前源码施工仍按新分工推进。原任务全文、生产装配、必要模拟和类型齐备才计100%，两个补丁不当两项任务。只做核心功能，不新增/扩写测试脚本；实际环境由负责人自测。助手结果由 AI-RD 主动读取，完整交付与具体阻塞留原对话，不发一般进度、回执或跨对话通知。

负责人已更新持续目标：每次开始任务先主动核两助手的实际回合，未开始或断流后需恢复原任务并确认新工具执行，不能仅发送消息就称已启动。2026-11-13 原两助手分别遇EOF与HTML应答再次失败，已单点发送继续；新回合 `01a1d505-a90a-70e0-8480-8757f2d0d475`、`01a1d505-f566-7fe1-9099-2c525dc96d11` 均已出现实际工具进展。内部开业助手同次断流后也已恢复原范围，不改模型或供应商设置。

## 当前收口入口

1. **AIN-12/13 已完成本轮研发验收。** [全文核定](<AI Native-开发记录.md#ain12-13-simulated-whole-closeout-20261113>)按原门槛对应会话/上下文、可信动态展示、字段/审批、取消/恢复/控制及设置；[最终阶段](<AI Native-开发记录.md#ain12-order-chat-current-result-20261113>)固定 `ade6dd10b`，模型原账与业务效果分别判断，最后报价三问题均已修复复验。后续任务复用这些固定接点，main 集成由 PM 处理；实际环境测试与 AIN-25 旧性能证据另列，不重开已闭的实现缺口。
2. **AIN-14 已完成本轮研发验收。** [品类/能力全文收口](<AI Native-开发记录.md#ain14-category-capability-whole-closeout-20261113>)补齐原受权版本和能力状态、五处标准装配及后台消费；Root独立provider模拟和固定闭包类型通过。原四分区材料→预览→关联R1→提案/原操作、第三方元数据与人工导航、规则摘要、日历采用和已保存提案差异均有固定证据，依赖06/08/10/12齐备。后续复用其原材料/提案，不把诊断已闭当作AIN-16实际写入、发布或采用完成；真实环境由负责人自测。
3. **AIN-18 经营待办。** Root 已接独立 automationReviewGrant 发布来源、原权限/CAS/TTL/收据和标准 provider/Controller/Guard；grant 启用及 close 丢 ACK 后只读原操作的实际模拟已通过。后台三文件冻结 blob 为 `8bb90e17af6085795f9ce803266d4ed73f0b8447`、`a682b46028320b7756275245c385abef46a0a96f`、`fd6ad0456c4fbf91225c2caf469136f92218f34a`。AutomationReviewSection/TaskCenter 已挂接；交付/归还走原订单，通知走原治理页，退款只读原 GET，opening 走原受权配置；打开入口、关闭待办和事实解决分别判断。退款 accepted 不称 succeeded，不在读取时 refresh 或重退。尚待最终固定组合/API/session/组件核接与 AIN-17 前置；原模型解释宿主未接时须明确不可用，不能走 AUTOMATION owner 的普通 TaskCenter。
4. **AIN-15 自然语言报价。** 原新材料关联、Core 候选/选单、完整比较、新批准与单次开单已由[关联再准备阶段](<AI Native-开发记录.md#ain-linked-requote-consumer-20261111>)核接，unknown 不换原操作，变更不挪用旧批准。dev2 三份 goal leaf 只让目标原文进入原冻结模型输入并投影受权候选，不能自动选同名客户、商品或付款人。Root 补 SceneRequest/模型/Reader 正式接线；企业本人入口及四品类目标代表过程继续按原范围收口，不让 operator 冒充企业员工。
5. **员工与客户。** [员工原结果定位](<AI Native-开发记录.md#ain-staff-original-result-reference-20261111>)和显式首次准入已核接。AIN-19已按[原五条及完整前置](<AI Native-开发记录.md#ain19-source-text-simulated-whole-closeout-20261114>)完成本轮模拟研发验收，复用原StaffFactory／Core单分配项／Task／单账，新增原文／置信仅为候选数据。AIN-20的媒体／原上传观察／人工最终值／签名／Core提交及原键恢复，加本片[重开签名和全文复验](<AI Native-开发记录.md#ain20-signature-reopen-simulated-whole-closeout-20261114>)已完成；后续复用这些固定接点，不runtime require shared、不换unknown原键、不借knowledge权限。旧输入不补签，缺依据／证据移除／撤权不授采用。客户[报价两端](<AI Native-开发记录.md#ain-client-quote-consumers-20261111>)和[原订单任务](<AI Native-开发记录.md#ain-client-task-consumer-closeout-20261111>)已固定；其余audience、跨surface、匿名／企业及媒体弱网按原ENTRY范围核定。

日历 24 源及规则 19 源/3 公共注册已分别在[日历核接](<AI Native-开发记录.md#ain-calendar-source-consumer-closeout-20261111>)、[规则核接](<AI Native-开发记录.md#ain-rule-source-intake-20261111>)保留完整证据。会员姓名和通知首次 start/原历史也已接原权限及收据；[通知冲突刷新与作用空间](<AI Native-开发记录.md#ain16-notification-conflict-refresh-20261113>)三源已由 Root 核接必要模拟/类型，原五条全文与 AIN-14 前置继续核定。

[规则/日历拒绝后端](<AI Native-开发记录.md#ain16-original-draft-rejection-refresh-20261113>)及[九源消费者](<AI Native-开发记录.md#ain16-draft-rejection-consumer-20261113>)已上传。[姓名/通知后端](<AI Native-开发记录.md#ain16-name-notification-reconfirmation-backend-20261113>)、初次CAS及[十源消费者](<AI Native-开发记录.md#ain16-name-notification-reconfirmation-consumer-20261114>)固定核接并推送，原终结、到期原读、新变更／新审核和丢应答恢复通过必要模拟／类型。[AIN-16全文](<AI Native-开发记录.md#ain16-simulated-whole-closeout-20261114>)及原依赖已核闭，后续复用原入口；unknown不当未提交，保存草稿不当发布，不借本项扩大敏感字段或配置权限。

[经营原人工操作恢复](<AI Native-开发记录.md#ain17-original-human-operation-recovery-20261113>)、[固定事件批次](<AI Native-开发记录.md#ain17-durable-pending-batch-consumer-20261113>)与原Task创建收据均已上传。[原grant恢复](<AI Native-开发记录.md#ain18-original-grant-recovery-20261114>)保留原preparedRef。标准ResourcePorts、runtime临近政策及同原保存事务的资源生产已按[当前阶段](<AI Native-开发记录.md#ain17-standard-resource-capture-history-20261114>)接通模拟，尚待最终固定提交与全文核定；原待办当前源不可读仍可独立历史读取但不授新动作，有限地点计数不造整空间缺项。dev1两个私有模型宿主继续，Root补公共自动主体；原unknown不换键，不从issue自由文本、done=false或旧时间推定缺项。

上传观察的幂等键兼容已按[原键兼容与恢复](<AI Native-开发记录.md#ain-staff-upload-key-compatibility-20261112>)修复并推送 `b690e4f3751bcaa1beac30cde88b55ea596ec1de`。[默认识别 Core 依据与保存后复核](<AI Native-开发记录.md#ain-inspection-core-basis-review-20261112>)和[媒体消费](<AI Native-开发记录.md#ain-staff-media-review-consumer-20261112>)已交 PM，55 schema 和原 22 源保留。QA 新发现的历史省略 `candidateBasis` 采用漏洞已按[最小门禁修复](<AI Native-开发记录.md#ain-inspection-legacy-adoption-p2-20261112>)完成模拟与类型验证，独立交 PM 复验。

AIN-12 的公共接线检查点及其反例原位保留，[阶段收口](<AI Native-开发记录.md#ain12-model-control-consumer-20261113>)记录最终源码、后台消费者与模拟。[同能力历史进入原模型](<AI Native-开发记录.md#ain12-authorized-conversation-history-20261113>)已推 `636ca2c0fe319185a7dae87c2c5a3c44078f5700` 并回读一致；订单专用链另接。[恢复前缀遇未注册后继的计时收尾](<AI Native-开发记录.md#ain12-recovery-prefix-measurement-20261113>)已修复并独立通过原反例与类型，缺释放回执仍 unknown。[首次窗口耗尽的原失败保留](<AI Native-开发记录.md#ain12-original-time-limit-cause-20261113>)已核同一租约不再申请 finish，UNKNOWN 与释放原收据不变；原历史那次具体慢读没有失败当次采样，未以正常重跑关闭。原回答收据、资源 lineage 和 Task 累计额度仍由原服务负责，未知原操作只读核对。

## AIN-17 等待的 Core 固定来源

原参加者、来源字段、原 tx、去重及 `not_captured`/unknown 语义已按[固定接口交付](<AI Native-开发记录.md#ain-resource-outbox-core-contract-20261112>)核定，源为 `b690e4f3751bcaa1beac30cde88b55ea596ec1de` 的指定两文件，不整取检查点。AI-RD 仅交 PM，由 PM 向 Core 定向协调原保存事务和正式结构化不足来源；不解析自由文本或让 Core 等待整项事件工作全部完成。

AI scoped 资源存储冻结 blob `1a06a119dd798d1dfa8b43beeb826ff2e5a63f40`，schema 检查点见[原记录](<AI Native-开发记录.md#ain17-resource-schema-checkpoint-20261112>)。新增配置行 revision、scoped settings 键和 Outbox 资源/FK 列只是持久化基础，没有执行 DDL，不等于事件生产闭环。

Core 只读合同固定源码 `fe65ac652076d5bed4c9ca439d50b563c61d17aa`、记录 `5983acd3af5c3457dade88fc32515c9a2efc493f`：allocation.readRecordedFulfillmentIssue 在调用方原 tx 只读 assignment 修订/startAt/location/issue_recorded；business.readTenantReadinessSource 返回九项原判定、独立读取观察窗口和真实 categoryBinding。须核 PM 是否已收 main，以及配置 counter/同事务来源的完整后继，不能从旧检查点猜已齐。

所需原窗口保持：allocation.scanOrder/recordIssue 原保存事务参加者；config.upsertProfile 的真实档案 configurationRevision；business.persistBusinessConfig 原 settingsRevision 和开业分区事件；state.saveCoreState 的空间快照原子 revision、scoped tx 及必要 backfill 兼容。没有行不补版本 1，独立九读不称单事务快照。任意 issue_recorded 不能直接当 shortage，须由 Core 正式判定；临近阈值/政策未发布保持 not_captured/unavailable，不能解析旧 issue 文本或造默认政策。原通知/退款明确失败和归还异常、有限重试/原收据保持。

## 其余未完与验证边界

- 原05/06/07/10/11/12/13/14/16已按模拟研发口径核闭；17/18仍有具体事件生产与消费者工作。19～28 的识别、员工/客户/平台、安全、SLO、组合验收和交付范围仍按[原任务](<AI Native-开发任务.md>)及[实施摘要](<AI Native-开发记录.md#原28项当前实施摘要>)逐项核定；不能把旧真实测试要求当研发阻塞，也不取消功能或部署/回退准备。
- [原worker取消收口收据](<AI Native-开发记录.md#ain25-original-worker-cancel-receipt-20261114>)已独立修复／复验，原请求与settlement分开，停用原读保留，未知不换键；取消／恢复测量、容量／公平性及告警尚未因此完成。原模型控制首字与读回仍沿[既有观察来源](<AI Native-开发记录.md#ain25-model-control-visible-20261113>)核对。Reader 的缓存时间先于 await 授权已修，原窗口上界保留，推进时钟组合与样本通过；客户端观察沿原诊断标签。QA P1/P3 当前权限和 P2 原澄清同键读取已收口，证据见原记录，不重开已解决问题。
- [客户小程序类型告警对照](<AI Native-开发记录.md#ain-client-mini-type-evidence-20261112>)已从固定 AI/main 源完成原 107 入口检查：完整共享声明解析后，AI 0 诊断，main 基线仅两处 consumed 标签；不得凭不完整虚拟依赖的 unknown 告警批量改会话或强断言。两标签由 PM 企业后继处理，dev2 核其验证器差异。
- 新树稀疏检出，不复制依赖、output 或环境。验证只读使用主仓库受管依赖；TypeScript 5.9.3 从 ts-node 解析，Prisma 只读 `apps/api/node_modules/@prisma/client` 的已生成入口，不能误用根未生成壳或旧临时树路径。源码与生成 schema 须按当前检查内容核对，不覆盖共享产物。
- 离线使用本树原 prisma-offline-preload、固定不可达 DATABASE_URL；审计/写根/TEMP/TMP 指向本树单一任务目录，能纯内存就不创建目录。创建者负责 finally 清理，不遗留脚本、生成 client/dist 或后台资源。
- 禁止读 .env、安装、启停服务、真实业务 HTTP/DB/DNS/模型/资金/存储、迁移和部署。模型、DB、React 或 HTTP 替身必须明确标模拟。每片只做必要冒烟/类型，不新增或扩写测试脚本、不删断言、不 skip/todo 补绿。
- 既有 order-history 的 reads.length===1 与当前前后双读不符，失败保留，不压平生产一致性或宣称该套全绿。当前 `docs:check` 实际保留 4 处既有缺链（导航历史 3、稀疏示例 1），没有新增链接或任务算术错误；历史原文保留，不伪造附件补绿。
