# AI Native：当前协作接续

更新：2026-11-12。负责人已明确继续专项，以完整实现、必要模拟冒烟和复核作为本轮研发验收；真实环境由负责人自行操作。正式依据仍为[需求 v1.15](<AI Native-需求.md>)、[任务 v1.19](<AI Native-开发任务.md>)。任务百分比只维护任务册，本文只定位当前工作。

## 当前目标与现场

在 `D:/工作文件/rental-OS/worktree/ai-native`、`codex/ai-native` 完成原 AIN/ENTRY 核心范围。2026-11-12 恢复时 AI 本地及 GitHub 均为 `ce8697ad8f3253085d215de5860e3cd53c6b38ef`，23 项未提交成果逐项核明作者，索引、MERGE_HEAD、CHERRY_PICK_HEAD 为空。main 由 PM 串行集成，使用前重新核对。不能追活动 HEAD 或将旧 SHA 当重置目标。

开业/资源/经营待办已在未完检查点 `ea9a3ec2b` 同步任务分支，开业导航与原字段接线分别推送 `c53e3bded` 和 `270fbb7af`，PM 按固定依赖闭包整合，不整收混有未完事件的检查点。[检查点与前置补正](<AI Native-开发记录.md#ain-opening-automation-checkpoint-20261112>)保留原依据。AIN-13 自身实现与模拟证据已具备，但前置 AIN-12 全文未齐，原 100% 结论已纠正；不回退已完成源码。PM 交付的 OP SecretBox 固定修复已按[正常 Nest 与 AI 配置兼容核验](<AI Native-开发记录.md#ain-secret-box-nest-compatibility-20261112>)接入并推送 `b408e806349f2dfc743a1a6dbc9df8dad2858c37`，GitHub 已核一致。QA 指出的任务中心受控展开回归已按[有限交互核验](<AI Native-开发记录.md#ain-task-center-section-regression-20261112>)修复；后台其余原缺口继续推进。

原接续完整字节保存在 Git `026e8e3ef` 的同路径，不另复制附件。三树/五树整合、模型/运行器/审批/知识/预算、原订单与开业启动观察的既有证据仍在[开发记录](<AI Native-开发记录.md>)；旧输出只按主仓库 `D:/工作文件/rental-OS/output` 的实际路径只读查证，不复制到工作树。

## 写入归属与协作

三人在同一 AI 树按文件分工。AI-RD 独占 Git 索引、提交、推送、四册、shared 总出口、Guard、AppModule、OpenAPI 及生产组合入口。助手完成后用 `git hash-object -w -- <具体文件>` 固定 blob，交路径、原任务与最小证据，然后继续不冲突任务。只有完整交付、公共冲突或需负责人解决的阻塞才合并报告，不发送心跳和过程日志。

| 负责人 | 当前范围 |
| --- | --- |
| AI-RD／`01a1be68-da55-7f13-9536-79be07cb2093` | 持有 AIN-19 历史缺依据采用修复及 AIN-12 模型控制四源、后台七源和原选单到 linked reprepare 公共接线，独立验证后分阶段提交。AIN-15 三叶和 AIN-20 漏交样式已核作者及冻结 blob。AIN-17 等 Core 正式来源。QA、公共依赖及 main 整合仅经 PM 协调。 |
| AI-dev1／`01a1bf34-f061-74c2-b588-3e21385c4b49` | 模型控制私有四源已固定交 Root，连续原回答及公开解释/排版模拟已交。当前只读定位一次 `overhead.timeDebt` unknown 的原 charge、Run、租约和 wall/monotonic 计量因果，正常复跑不能关闭该问题。 |
| AI-dev2／`01a1bf35-1ee5-7400-a97d-c0ebf5f9482c` | AIN-12 后台七源已冻结交 Root。当前核 AIN-25 模型控制新 Run 的首字来源，已交封闭合同、原 operationId 与原控制收据接点建议，等 Root 公共窗口后接 feature-local 消费。quote-goal 三叶及员工 index.wxss 均已核原作者并冻结交 Root。 |
| main／PM | 主仓库串行集成的唯一作者。可独立验证且固定提交已推送的阶段由 PM 按依赖串行收 main；完整任务仍按原门槛，不以切片提高完成度。AI 不争 main 索引或覆盖 PM/企业/Core WIP，检查点不整树回收，助手继续施工。 |

公共窗口不得夹带企业端的 ClientApiService.readOrderSubmission、企业 reader/controller/GET 和后台企业材料。PM 已将 `openapi-document.ts` 的企业申请/专用凭证登记、`enterprise-workflows.ts` 的 payment_proof/企业消息及 `file-storage.runtime.service.ts` 的 enterprise-payment-proof 区域交企业 RD。AI 本片保留其写权，确需重叠增量先交 PM 串行协调。Core 订单、资金、品类与配置权威仍由原专项负责，AI 不重建这些规则。

## 当前收口入口

1. **AIN-12 后台任务中心。** [原展示生产/读取/实际消费者](<AI Native-开发记录.md#ain12-original-display-pipeline-20261112>)的 25 源已推 `7332875c9`，PM 已收 main `0e9f93942`。随后[原字段→候选→可信原问题→原回答](<AI Native-开发记录.md#ain12-original-field-human-input-20261112>)已完成实际公开组合模拟和固定类型；首轮字段在原模型计划前冻结，原 null witness 不补签，合法草稿保留，unknown 沿原输入收据。尚缺首轮以外的真实字段 lineage、已准备条件到既有 linked 重新准备的右侧消费，以及排版/重新解释的同 Task 控制准入。停止复用原 TaskCancellation 的请求取消/原收据，不另造执行器。新的模型控制须专用 operator origin reader 与原操作记录，不用假回答/new Task 重置资源，也不全局放开客户/图片/语音共享的回答 lineage 或普通终态。Root 拥有这些组合接点；先复用原 Gateway/运行器/草稿和业务链，不另造状态机。旧 modelResult/closeUnstarted Guard 大小写匹配已修，无需重做。
2. **AIN-14 开业诊断。** TaskOpeningProposalApplication、aiTaskOpeningProposals、task-opening-proposal-session、TaskOpeningProposals 已接普通四分区的原材料→显式预览→关联新 R1→AI 提案与原操作读回；仅保存 AI 提案，不直接保存活动配置/发布。Root 已接 Controller/Guard/provider/OpenAPI/shared/TaskCenter。第三方配置读通过原 integration 权限，只返回有界字段存在性和原检测/修订元数据；普通开业角色不会得到第三方配置，读取不解密或探测。[注册人工导航与重复查询修复](<AI Native-开发记录.md#ain14-integration-navigation-20261112>)已完成 Root 实际组合模拟：变化重确认及撤权/隐藏/旧 epoch 拒绝，原资源授权不再重复生成完整集成材料。最后按空租户、部分开业、未交付能力、mock/失败、旧规则及并发变化逐项核；AIN-12 未满足前不宣布整项 100%。
3. **AIN-18 经营待办。** Root 已接独立 automationReviewGrant 发布来源、原权限/CAS/TTL/收据和标准 provider/Controller/Guard；grant 启用及 close 丢 ACK 后只读原操作的实际模拟已通过。后台三文件冻结 blob 为 `8bb90e17af6085795f9ce803266d4ed73f0b8447`、`a682b46028320b7756275245c385abef46a0a96f`、`fd6ad0456c4fbf91225c2caf469136f92218f34a`。AutomationReviewSection/TaskCenter 已挂接；交付/归还走原订单，通知走原治理页，退款只读原 GET，opening 走原受权配置；打开入口、关闭待办和事实解决分别判断。退款 accepted 不称 succeeded，不在读取时 refresh 或重退。尚待最终固定组合/API/session/组件核接与 AIN-17 前置；原模型解释宿主未接时须明确不可用，不能走 AUTOMATION owner 的普通 TaskCenter。
4. **AIN-15 自然语言报价。** 原新材料关联、Core 候选/选单、完整比较、新批准与单次开单已由[关联再准备阶段](<AI Native-开发记录.md#ain-linked-requote-consumer-20261111>)核接，unknown 不换原操作，变更不挪用旧批准。dev2 三份 goal leaf 只让目标原文进入原冻结模型输入并投影受权候选，不能自动选同名客户、商品或付款人。Root 补 SceneRequest/模型/Reader 正式接线；企业本人入口及四品类目标代表过程继续按原范围收口，不让 operator 冒充企业员工。
5. **员工与客户。** [员工原结果定位](<AI Native-开发记录.md#ain-staff-original-result-reference-20261111>)和显式首次准入已核接。AIN-19 默认 StaffFactory→原 Core 单分配项→图片/音频 Task/单账→保存/当前复核及明确采用，已按[固定闭包](<AI Native-开发记录.md#ain-inspection-core-basis-review-20261112>)通过必要模拟和类型；原 Core 日期围栏补片 `5b51b90dd01feae189d06d8c66d59875c8172401` 已包含。旧输入不补签，新明确缺依据及已移除证据不可直接采用；后端原门槛由 PM 安排 QA 核定。AIN-20 的 22 个员工消费者已按[媒体与复核阶段](<AI Native-开发记录.md#ain-staff-media-review-consumer-20261112>)交回 Root，dev2 转后台模型控制；[原上传观察后端](<AI Native-开发记录.md#ain-staff-upload-observation-20261112>)已推 `b704dddf9`，[原生成器/本地合同](<AI Native-开发记录.md#ain-staff-upload-native-contract-20261112>)已核，继续实际页面恢复，不得 runtime require shared、新键重发或借 knowledge 权限。客户[报价两端](<AI Native-开发记录.md#ain-client-quote-consumers-20261111>)和[原订单任务](<AI Native-开发记录.md#ain-client-task-consumer-closeout-20261111>)已固定；其余 audience、跨 surface、匿名/企业及媒体弱网按原 ENTRY 范围核定。

日历 24 源及规则 19 源/3 公共注册已分别在[日历核接](<AI Native-开发记录.md#ain-calendar-source-consumer-closeout-20261111>)、[规则核接](<AI Native-开发记录.md#ain-rule-source-intake-20261111>)保留完整证据。会员姓名和通知首次 start/原历史也已接原权限及收据，不重复施工；AIN-16 余范围仍须逐字段和实际写入/发布边界核实。

上传观察的幂等键兼容已按[原键兼容与恢复](<AI Native-开发记录.md#ain-staff-upload-key-compatibility-20261112>)修复并推送 `b690e4f3751bcaa1beac30cde88b55ea596ec1de`。[默认识别 Core 依据与保存后复核](<AI Native-开发记录.md#ain-inspection-core-basis-review-20261112>)和[媒体消费](<AI Native-开发记录.md#ain-staff-media-review-consumer-20261112>)已交 PM，55 schema 和原 22 源保留。QA 新发现的历史省略 `candidateBasis` 采用漏洞已按[最小门禁修复](<AI Native-开发记录.md#ain-inspection-legacy-adoption-p2-20261112>)完成模拟与类型验证，独立交 PM 复验。

AIN-12 的公共生产接线和 dev1 四私有源已在[未完检查点](<AI Native-开发记录.md#ain12-model-control-checkpoint-20261112>)固定。报价观察 requestId 指纹、回答后继 preparationDefinition 和字段 witness 的四源 WIP 已核冻结 blob，连续三条原回答后同 Task 解释/排版的助手实际组合已通过。Root 继续最终生产组合与后台七源、任务中心原选单到 linked reprepare 的消费者复验，并核清 `timeDebt` 那次 unknown。原回答收据、资源 lineage 和 Task 累计额度仍由原服务负责，未知原操作只读核对。

## AIN-17 等待的 Core 固定来源

原参加者、来源字段、原 tx、去重及 `not_captured`/unknown 语义已按[固定接口交付](<AI Native-开发记录.md#ain-resource-outbox-core-contract-20261112>)核定，源为 `b690e4f3751bcaa1beac30cde88b55ea596ec1de` 的指定两文件，不整取检查点。AI-RD 仅交 PM，由 PM 向 Core 定向协调原保存事务和正式结构化不足来源；不解析自由文本或让 Core 等待整项事件工作全部完成。

AI scoped 资源存储冻结 blob `1a06a119dd798d1dfa8b43beeb826ff2e5a63f40`，schema 检查点见[原记录](<AI Native-开发记录.md#ain17-resource-schema-checkpoint-20261112>)。新增配置行 revision、scoped settings 键和 Outbox 资源/FK 列只是持久化基础，没有执行 DDL，不等于事件生产闭环。

Core 只读合同固定源码 `fe65ac652076d5bed4c9ca439d50b563c61d17aa`、记录 `5983acd3af5c3457dade88fc32515c9a2efc493f`：allocation.readRecordedFulfillmentIssue 在调用方原 tx 只读 assignment 修订/startAt/location/issue_recorded；business.readTenantReadinessSource 返回九项原判定、独立读取观察窗口和真实 categoryBinding。须核 PM 是否已收 main，以及配置 counter/同事务来源的完整后继，不能从旧检查点猜已齐。

所需原窗口保持：allocation.scanOrder/recordIssue 原保存事务参加者；config.upsertProfile 的真实档案 configurationRevision；business.persistBusinessConfig 原 settingsRevision 和开业分区事件；state.saveCoreState 的空间快照原子 revision、scoped tx 及必要 backfill 兼容。没有行不补版本 1，独立九读不称单事务快照。任意 issue_recorded 不能直接当 shortage，须由 Core 正式判定；临近阈值/政策未发布保持 not_captured/unavailable，不能解析旧 issue 文本或造默认政策。原通知/退款明确失败和归还异常、有限重试/原收据保持。

## 其余未完与验证边界

- 原 05/06/07/10/11 已按模拟研发口径核闭。13 已交自身功能证据，当前等待 12 全文前置。19～28 的识别、员工/客户/平台、安全、SLO、组合验收和交付范围仍按[原任务](<AI Native-开发任务.md>)及[实施摘要](<AI Native-开发记录.md#原28项当前实施摘要>)逐项核定；不能把旧真实测试要求当研发阻塞，也不取消功能或部署/回退准备。
- AIN-25 首字/首卡已有原宿主片，完整容量/背压/公平性/告警等继续按原门槛；客户端观察不成为业务或财务事实。QA P1/P3 当前权限和 P2 原澄清同键读取已收口，证据见原记录，不重开已解决问题。
- [客户小程序类型告警对照](<AI Native-开发记录.md#ain-client-mini-type-evidence-20261112>)已从固定 AI/main 源完成原 107 入口检查：完整共享声明解析后，AI 0 诊断，main 基线仅两处 consumed 标签；不得凭不完整虚拟依赖的 unknown 告警批量改会话或强断言。两标签由 PM 企业后继处理，dev2 核其验证器差异。
- 新树稀疏检出，不复制依赖、output 或环境。验证只读使用主仓库受管依赖；TypeScript 5.9.3 从 ts-node 解析，Prisma 只读 `apps/api/node_modules/@prisma/client` 的已生成入口，不能误用根未生成壳或旧临时树路径。源码与生成 schema 须按当前检查内容核对，不覆盖共享产物。
- 离线使用本树原 prisma-offline-preload、固定不可达 DATABASE_URL；审计/写根/TEMP/TMP 指向本树单一任务目录，能纯内存就不创建目录。创建者负责 finally 清理，不遗留脚本、生成 client/dist 或后台资源。
- 禁止读 .env、安装、启停服务、真实业务 HTTP/DB/DNS/模型/资金/存储、迁移和部署。模型、DB、React 或 HTTP 替身必须明确标模拟。每片只做必要冒烟/类型，不新增或扩写测试脚本、不删断言、不 skip/todo 补绿。
- 既有 order-history 的 reads.length===1 与当前前后双读不符，失败保留，不压平生产一致性或宣称该套全绿。当前 `docs:check` 实际保留 4 处既有缺链（导航历史 3、稀疏示例 1），没有新增链接或任务算术错误；历史原文保留，不伪造附件补绿。
