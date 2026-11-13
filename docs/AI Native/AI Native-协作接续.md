# AI Native：当前协作接续

更新：2026-11-13。负责人已明确继续专项，以完整实现、必要模拟冒烟和复核作为本轮研发验收；真实环境由负责人自行操作。正式依据仍为[需求 v1.15](<AI Native-需求.md>)、[任务 v1.19](<AI Native-开发任务.md>)。任务百分比只维护任务册，本文只定位当前工作。

## 当前目标与现场

在 `D:/工作文件/rental-OS/worktree/ai-native`、`codex/ai-native` 完成原 AIN/ENTRY 核心范围。2026-11-13 首次修改前核对 AI 本地及 GitHub 均为 `7e4d1aaef2df3c3aebe5c02f95adc56a759a964d`；随后模型控制和首字阶段分别推 `c4b26faf29a241e602c28914edf7e646cf225be0`、`07d2ae645b1aaac632bfa0dc0df5bae981f3c91c` 并回读一致。Copilot/参数接续十四源已按固定索引收口，两个助手转独占后继。main 由 PM 串行集成，使用前重新核对，不能追活动 HEAD 或将旧 SHA 当重置目标。

PM 指定 main `2a5c56471abb5714f80715e2cfa0aa236f003f51` 的[固定前置闭包](<AI Native-开发记录.md#ain12-fixed-main-closure-20261113>)已推 630，5426 十四源的主树页面后继已推 `d201979963e4f4474acd23ff1981ad81930fdfcd`，均在 codex/ai-native-main-closure-20261113 并回读一致。公共 AppModule/index 用精确 hunk，首候选 Guard 保持原 main，后继仅补 createTask 原登记，TaskCenter 保留 main 原展开/权限与旁支。该分支仅作 PM 整合候选，AI 施工仍在原树。PM 串行收每个 QA 通过的可独立阶段，任务进度仍按原全文。

开业确定性正文已推 `e4a9d5779174908ac8108d306cbed691f1252cc8`，GitHub 回读一致。QA 的 publication 时间 P2 已按[同一当前窗口及事务复核](<AI Native-开发记录.md#ain12-publication-window-p2-20261113>)完成四源/必要模拟；固定 d201 后继 `fc808e7af723ae6bca6d9d756d4d7c1b9f78fe71` 已推同一整合分支并回读一致，待 PM/QA 复验，原停止交付与任务取消语义继续核明。

规则摘要、任务筛选、通知冲突及[运行中草稿](<AI Native-开发记录.md#ain12-unsent-draft-retention-20261113>)均已核接/推送。[日历采用来源与提案历史差异](<AI Native-开发记录.md#ain14-calendar-and-saved-proposal-20261113>)已推 `955daa676e5dfb8b314302c9d0102280feb3e2d3` 并回读 GitHub 一致。[模型确认与聊天展示消费者](<AI Native-开发记录.md#ain12-model-confirmation-and-chat-display-20261113>)已推 `f398f7f80560d77caee1eccd826b1b276960e0d6` 并回读一致。[任务中心恢复/接管](<AI Native-开发记录.md#ain12-task-center-recovery-20261113>)已推 `74367697d17beea451033f8a9d4e459228fc01af` 并回读 GitHub 一致。[对话取消与停止展示入口](<AI Native-开发记录.md#ain12-explicit-cancellation-entry-20261113>)已完成固定模拟/类型；当前继续订单三步最终展示/重生成、独立原读取和跨轮上下文。

开业/资源/经营待办已在未完检查点 `ea9a3ec2b` 同步任务分支，开业导航与原字段接线分别推送 `c53e3bded` 和 `270fbb7af`，PM 按固定依赖闭包整合，不整收混有未完事件的检查点。[检查点与前置补正](<AI Native-开发记录.md#ain-opening-automation-checkpoint-20261112>)保留原依据。AIN-13 自身实现与模拟证据已具备，但前置 AIN-12 全文未齐，原 100% 结论已纠正；不回退已完成源码。PM 交付的 OP SecretBox 固定修复已按[正常 Nest 与 AI 配置兼容核验](<AI Native-开发记录.md#ain-secret-box-nest-compatibility-20261112>)接入并推送 `b408e806349f2dfc743a1a6dbc9df8dad2858c37`，GitHub 已核一致。QA 指出的任务中心受控展开回归已按[有限交互核验](<AI Native-开发记录.md#ain-task-center-section-regression-20261112>)修复；后台其余原缺口继续推进。

原接续完整字节保存在 Git `026e8e3ef` 的同路径，不另复制附件。三树/五树整合、模型/运行器/审批/知识/预算、原订单与开业启动观察的既有证据仍在[开发记录](<AI Native-开发记录.md>)；旧输出只按主仓库 `D:/工作文件/rental-OS/output` 的实际路径只读查证，不复制到工作树。

## 写入归属与协作

AI 树按文件分工。AI-RD 独占 Git 索引、提交、推送、四册、shared 总出口、Guard、AppModule、OpenAPI 及生产组合入口。助手完成后用 `git hash-object -w -- <具体文件>` 固定 blob，将路径、原任务与最小证据留本对话，由 AI-RD 主动读取。按负责人本日更新的消息纪律，不主动向 PM 或其他对话报告阶段、SHA 或一般阻塞；PM 主动读取原记录，只有当前具体消息明确要求时回复一次。必要具体派工仍由 AI-RD 负责，不层层转发通知。

| 负责人 | 当前范围 |
| --- | --- |
| AI-RD／`01a1be68-da55-7f13-9536-79be07cb2093` | 独占四册/索引、公共装配、TaskCenter、TaskHumanApproval。恢复十八源已按固定窄片核接；继续订单最终答复 provider/公共读取与历史 selection 真依赖。AIN-13 自身证据已具备，AIN-15 三叶和员工样式待核，AIN-17 等 Core 正式来源。 |
| AI-dev1／`01a1bf34-f061-74c2-b588-3e21385c4b49` | 恢复/接管已交回，停止语义已核明。独占 workbench-model-control.repository/source/contract 三源，补严格订单三步最终 answer 的同 Task 控制 lineage，保留原资源账、CAS/unknown；Root 接公共 application 和 reader。 |
| AI-dev2／`01a1bf35-1ee5-7400-a97d-c0ebf5f9482c` | 恢复消费者已交回。优先核原订单最终答复的独立只读装配，解决停用执行配置后原 readAnswer 不可用；先给精确依赖供 Root 定写权，不构造假 Gateway。AIN-25 大范围核查暂缓。 |
| 内部日历/上下文助手 | 历史与恢复前缀已收口。首次耗时耗尽后不再申请同租约 finish 的单源修复已冻结交回；overhead 门禁和 UNKNOWN 占用不变，原慢读具体来源仍待原证据。 |
| 内部对话助手 | 严格最终答复 adapter/reader/前端定位三叶已冻结。现获原订单场景及 persisted-model-order-runner 的最终 answer 展示生产窗口，保留已固定恢复 CAS；只在原发布时签无 tools witness，Root 接 provider、公共 display 定位和真实 readAnswer 消费。 |
| main／PM | 主仓库串行集成的唯一作者。可独立验证且固定提交已推送的阶段由 PM 按依赖串行收 main；完整任务仍按原门槛，不以切片提高完成度。AI 不争 main 索引或覆盖 PM/企业/Core WIP，检查点不整树回收，助手继续施工。 |

公共窗口不得夹带企业端的 ClientApiService.readOrderSubmission、企业 reader/controller/GET 和后台企业材料。PM 已将 `openapi-document.ts` 的企业申请/专用凭证登记、`enterprise-workflows.ts` 的 payment_proof/企业消息及 `file-storage.runtime.service.ts` 的 enterprise-payment-proof 区域交企业 RD。AI 本片保留其写权，确需重叠增量先交 PM 串行协调。Core 订单、资金、品类与配置权威仍由原专项负责，AI 不重建这些规则。

## 当前收口入口

1. **AIN-12 后台任务中心。** [原展示生产/读取/实际消费者](<AI Native-开发记录.md#ain12-original-display-pipeline-20261112>)、[原字段与可信问题](<AI Native-开发记录.md#ain12-original-field-human-input-20261112>)、[同 Task 控制及后继](<AI Native-开发记录.md#ain12-model-control-consumer-20261113>)均保留固定证据。[Copilot 当前订单及参数接续](<AI Native-开发记录.md#ain12-copilot-and-parameter-consumer-20261113>)十四源已具备必要模拟，完整字段在原一次受权读取提供，原问题与命名参数分开，可信采用后走原 linked reprepare，起始 candidate 使用已消费原回答。Copilot 只传登记 orderId，经原 Guard/Task/Core，原会话转接复用旧引用。create-task 漏登已补，切步骤/对象/身份撤旧定位。QA 时间 P2 已由[四源当前窗口修复](<AI Native-开发记录.md#ain12-publication-window-p2-20261113>)核明五种定向模拟与类型，原 K 读取独立，fc808 候选待 PM/QA 复验。停止回复/停止交付与 TaskCancellation 的实际关系仍按原条款核定，不能把阶段提交计作新任务。

   [列表筛选](<AI Native-开发记录.md#ain12-task-list-filters-20261113>)、[运行中草稿](<AI Native-开发记录.md#ain12-unsent-draft-retention-20261113>)及[原模型确认/聊天展示消费者](<AI Native-开发记录.md#ain12-model-confirmation-and-chat-display-20261113>)均已具备必要模拟/类型。[恢复/接管五路及后台消费者](<AI Native-开发记录.md#ain12-task-center-recovery-20261113>)已核原 Run/计划/CAS、配置关闭读写分离和 unknown 原收据；不对专用业务/模型控制 Run 冒用宿主。原订单三步最终 answer 的严格 adapter/reader 及原发布 witness 已固定，Root 核标准 provider/真实 readAnswer 公共消费，dev1 补其同 Task 重新解释/排版，dev2 核停用后的独立原读；不能简单取同 Run 最后结果。历史生产四源已冻结，Root 补标准 selection 依赖及恢复定位的刷新后继兼容；订单专用三步材料/最终 snapshot 的历史包另接，不把通用 prepareHeldRun 通过当作专用链也通过。[停止交付与任务取消](<AI Native-开发记录.md#ain12-explicit-cancellation-entry-20261113>)已复用原组件、原请求和原收据核定，保留明确语义。
2. **AIN-14 开业诊断。** 原四分区材料→预览→关联 R1→提案/原操作、integration 有界元数据及注册人工导航已有固定证据。[确定性正文](<AI Native-开发记录.md#ain14-opening-authoritative-text-20261113>)与[Core 原规则摘要](<AI Native-开发记录.md#ain14-core-summary-projection-20261113>)已核。[日历采用来源与已保存提案差异](<AI Native-开发记录.md#ain14-calendar-and-saved-proposal-20261113>)已由 Root 核接：消费 Core da3002b2，同年换版失效/仅观察时钟变化保持，旧提案差异不被当前配置覆盖；Core 前置由 PM 串行整合，不整覆盖 AI 树。原五条及 AIN-12 前置继续核定。
3. **AIN-18 经营待办。** Root 已接独立 automationReviewGrant 发布来源、原权限/CAS/TTL/收据和标准 provider/Controller/Guard；grant 启用及 close 丢 ACK 后只读原操作的实际模拟已通过。后台三文件冻结 blob 为 `8bb90e17af6085795f9ce803266d4ed73f0b8447`、`a682b46028320b7756275245c385abef46a0a96f`、`fd6ad0456c4fbf91225c2caf469136f92218f34a`。AutomationReviewSection/TaskCenter 已挂接；交付/归还走原订单，通知走原治理页，退款只读原 GET，opening 走原受权配置；打开入口、关闭待办和事实解决分别判断。退款 accepted 不称 succeeded，不在读取时 refresh 或重退。尚待最终固定组合/API/session/组件核接与 AIN-17 前置；原模型解释宿主未接时须明确不可用，不能走 AUTOMATION owner 的普通 TaskCenter。
4. **AIN-15 自然语言报价。** 原新材料关联、Core 候选/选单、完整比较、新批准与单次开单已由[关联再准备阶段](<AI Native-开发记录.md#ain-linked-requote-consumer-20261111>)核接，unknown 不换原操作，变更不挪用旧批准。dev2 三份 goal leaf 只让目标原文进入原冻结模型输入并投影受权候选，不能自动选同名客户、商品或付款人。Root 补 SceneRequest/模型/Reader 正式接线；企业本人入口及四品类目标代表过程继续按原范围收口，不让 operator 冒充企业员工。
5. **员工与客户。** [员工原结果定位](<AI Native-开发记录.md#ain-staff-original-result-reference-20261111>)和显式首次准入已核接。AIN-19 默认 StaffFactory→原 Core 单分配项→图片/音频 Task/单账→保存/当前复核及明确采用，已按[固定闭包](<AI Native-开发记录.md#ain-inspection-core-basis-review-20261112>)通过必要模拟和类型；原 Core 日期围栏补片 `5b51b90dd01feae189d06d8c66d59875c8172401` 已包含。旧输入不补签，新明确缺依据及已移除证据不可直接采用；后端原门槛由 PM 安排 QA 核定。AIN-20 的 22 个员工消费者已按[媒体与复核阶段](<AI Native-开发记录.md#ain-staff-media-review-consumer-20261112>)交回 Root，dev2 转后台模型控制；[原上传观察后端](<AI Native-开发记录.md#ain-staff-upload-observation-20261112>)已推 `b704dddf9`，[原生成器/本地合同](<AI Native-开发记录.md#ain-staff-upload-native-contract-20261112>)已核，继续实际页面恢复，不得 runtime require shared、新键重发或借 knowledge 权限。客户[报价两端](<AI Native-开发记录.md#ain-client-quote-consumers-20261111>)和[原订单任务](<AI Native-开发记录.md#ain-client-task-consumer-closeout-20261111>)已固定；其余 audience、跨 surface、匿名/企业及媒体弱网按原 ENTRY 范围核定。

日历 24 源及规则 19 源/3 公共注册已分别在[日历核接](<AI Native-开发记录.md#ain-calendar-source-consumer-closeout-20261111>)、[规则核接](<AI Native-开发记录.md#ain-rule-source-intake-20261111>)保留完整证据。会员姓名和通知首次 start/原历史也已接原权限及收据；[通知冲突刷新与作用空间](<AI Native-开发记录.md#ain16-notification-conflict-refresh-20261113>)三源已由 Root 核接必要模拟/类型，原五条全文与 AIN-14 前置继续核定。

上传观察的幂等键兼容已按[原键兼容与恢复](<AI Native-开发记录.md#ain-staff-upload-key-compatibility-20261112>)修复并推送 `b690e4f3751bcaa1beac30cde88b55ea596ec1de`。[默认识别 Core 依据与保存后复核](<AI Native-开发记录.md#ain-inspection-core-basis-review-20261112>)和[媒体消费](<AI Native-开发记录.md#ain-staff-media-review-consumer-20261112>)已交 PM，55 schema 和原 22 源保留。QA 新发现的历史省略 `candidateBasis` 采用漏洞已按[最小门禁修复](<AI Native-开发记录.md#ain-inspection-legacy-adoption-p2-20261112>)完成模拟与类型验证，独立交 PM 复验。

AIN-12 的公共接线检查点及其反例原位保留，[阶段收口](<AI Native-开发记录.md#ain12-model-control-consumer-20261113>)记录最终源码、后台消费者与模拟。[同能力历史进入原模型](<AI Native-开发记录.md#ain12-authorized-conversation-history-20261113>)已推 `636ca2c0fe319185a7dae87c2c5a3c44078f5700` 并回读一致；订单专用链另接。[恢复前缀遇未注册后继的计时收尾](<AI Native-开发记录.md#ain12-recovery-prefix-measurement-20261113>)已修复并独立通过原反例与类型，缺释放回执仍 unknown。[首次窗口耗尽的原失败保留](<AI Native-开发记录.md#ain12-original-time-limit-cause-20261113>)已核同一租约不再申请 finish，UNKNOWN 与释放原收据不变；原历史那次具体慢读没有失败当次采样，未以正常重跑关闭。原回答收据、资源 lineage 和 Task 累计额度仍由原服务负责，未知原操作只读核对。

## AIN-17 等待的 Core 固定来源

原参加者、来源字段、原 tx、去重及 `not_captured`/unknown 语义已按[固定接口交付](<AI Native-开发记录.md#ain-resource-outbox-core-contract-20261112>)核定，源为 `b690e4f3751bcaa1beac30cde88b55ea596ec1de` 的指定两文件，不整取检查点。AI-RD 仅交 PM，由 PM 向 Core 定向协调原保存事务和正式结构化不足来源；不解析自由文本或让 Core 等待整项事件工作全部完成。

AI scoped 资源存储冻结 blob `1a06a119dd798d1dfa8b43beeb826ff2e5a63f40`，schema 检查点见[原记录](<AI Native-开发记录.md#ain17-resource-schema-checkpoint-20261112>)。新增配置行 revision、scoped settings 键和 Outbox 资源/FK 列只是持久化基础，没有执行 DDL，不等于事件生产闭环。

Core 只读合同固定源码 `fe65ac652076d5bed4c9ca439d50b563c61d17aa`、记录 `5983acd3af5c3457dade88fc32515c9a2efc493f`：allocation.readRecordedFulfillmentIssue 在调用方原 tx 只读 assignment 修订/startAt/location/issue_recorded；business.readTenantReadinessSource 返回九项原判定、独立读取观察窗口和真实 categoryBinding。须核 PM 是否已收 main，以及配置 counter/同事务来源的完整后继，不能从旧检查点猜已齐。

所需原窗口保持：allocation.scanOrder/recordIssue 原保存事务参加者；config.upsertProfile 的真实档案 configurationRevision；business.persistBusinessConfig 原 settingsRevision 和开业分区事件；state.saveCoreState 的空间快照原子 revision、scoped tx 及必要 backfill 兼容。没有行不补版本 1，独立九读不称单事务快照。任意 issue_recorded 不能直接当 shortage，须由 Core 正式判定；临近阈值/政策未发布保持 not_captured/unavailable，不能解析旧 issue 文本或造默认政策。原通知/退款明确失败和归还异常、有限重试/原收据保持。

## 其余未完与验证边界

- 原 05/06/07/10/11 已按模拟研发口径核闭。13 已交自身功能证据，当前等待 12 全文前置。19～28 的识别、员工/客户/平台、安全、SLO、组合验收和交付范围仍按[原任务](<AI Native-开发任务.md>)及[实施摘要](<AI Native-开发记录.md#原28项当前实施摘要>)逐项核定；不能把旧真实测试要求当研发阻塞，也不取消功能或部署/回退准备。
- [AIN-25 原模型控制首字与读回](<AI Native-开发记录.md#ain25-model-control-visible-20261113>)已接封闭 trigger、原 operationId/new Run/result 和标准报告来源。Reader 的缓存时间先于 await 授权已修，原窗口上界保留，推进时钟组合与样本通过。完整容量/背压/公平性/告警等继续按原门槛；客户端观察沿原诊断标签。QA P1/P3 当前权限和 P2 原澄清同键读取已收口，证据见原记录，不重开已解决问题。
- [客户小程序类型告警对照](<AI Native-开发记录.md#ain-client-mini-type-evidence-20261112>)已从固定 AI/main 源完成原 107 入口检查：完整共享声明解析后，AI 0 诊断，main 基线仅两处 consumed 标签；不得凭不完整虚拟依赖的 unknown 告警批量改会话或强断言。两标签由 PM 企业后继处理，dev2 核其验证器差异。
- 新树稀疏检出，不复制依赖、output 或环境。验证只读使用主仓库受管依赖；TypeScript 5.9.3 从 ts-node 解析，Prisma 只读 `apps/api/node_modules/@prisma/client` 的已生成入口，不能误用根未生成壳或旧临时树路径。源码与生成 schema 须按当前检查内容核对，不覆盖共享产物。
- 离线使用本树原 prisma-offline-preload、固定不可达 DATABASE_URL；审计/写根/TEMP/TMP 指向本树单一任务目录，能纯内存就不创建目录。创建者负责 finally 清理，不遗留脚本、生成 client/dist 或后台资源。
- 禁止读 .env、安装、启停服务、真实业务 HTTP/DB/DNS/模型/资金/存储、迁移和部署。模型、DB、React 或 HTTP 替身必须明确标模拟。每片只做必要冒烟/类型，不新增或扩写测试脚本、不删断言、不 skip/todo 补绿。
- 既有 order-history 的 reads.length===1 与当前前后双读不符，失败保留，不压平生产一致性或宣称该套全绿。当前 `docs:check` 实际保留 4 处既有缺链（导航历史 3、稀疏示例 1），没有新增链接或任务算术错误；历史原文保留，不伪造附件补绿。
