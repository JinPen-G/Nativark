# Rental Core 协作接续

更新时间：2026-11-12。

> 本轮由负责人通过PM正式授权Core研发负责人在指定工作树恢复核心开发。主线为品类治理原CAT-GOV-01～14全部收口，同时独立核实本册原十二项CLOSE及对企业/AI的必要Core接点；不混算进度、不扩大为PCH。日常任务分支精确提交/普通推送持续获准；每个可独立验证阶段交固定SHA，由PM串行收回main，不等待两个完整任务。对外仅向PM提交一次必要的完整阶段、真实依赖/阻塞及需判断的问题，不抄送AI、企业、QA、OP或助手，不因收到消息自行回信/转发；跨域窗口和QA分派由PM协调。禁止新增/扩写测试脚本，采用已有定向冒烟、短命令及必要类型检查；本轮不含真实环境、依赖安装、迁移、部署或生产启用许可。

## 1. 目标与依据

按[需求](<Rental Core-需求.md>)和[原12项CLOSE任务](<Rental Core-开发任务.md>)完成通用租赁闭环；完整业务条款仍见[平台需求](../管理后台/管理后台-需求.md)。[记录](<Rental Core-开发记录.md>)承接证据入口，不另造总计划。

品类定义/发布/采用/动态编码见子目录[品类治理接续](品类治理/品类治理-协作接续.md)；跨行业Core接入见[平台专项](../平台底座/Core接入/平台Core接入-协作接续.md)。两者不能替代原CLOSE工作。

## 2. 现场和写入归属

- 唯一开发树：`D:/工作文件/rental-OS/worktree/rental-core`，分支`codex/rental-core`。reader6d35/800a及时间补片`5b51b90dd01feae189d06d8c66d59875c8172401`已推送核GitHub，QA/集成结论由PM转交后核定。当前[原九项同client来源](<Rental Core-开发记录.md#readiness-original-transaction-20261112>)四源码已完成类型、原17项及限定验证，含PM仅授权的membership.countPlans两行，源码固定`483b887dc23dd252ecb423806ac5030204c39812`。无merge/cherry-pick；当前API已从固定c24源码更新为866文件，见[构建及退出残留](<Rental Core-开发记录.md#api-current-build-cleanup-20261112>)。原四入口捕获/真实counter/资源短缺参加者未齐；main固定来源和企业/AI公共消费仍按原作者协调，不追活动WIP或处理负责人接管空目录。
- Core负责人可写Core专属实现、shared对应领域协议和必要既有接点；共同总入口先报具体字段/路径，由PM指定唯一作者。AI runner和企业政策/审批内部实现归各自研发，企业端消费原Core，不复制账本或计价逻辑。本轮无额外助手。
- PM已明确三份Core配置/快照/回填文件的配置revision及读取窗口，固定源码`5e8d52325b37cf6b613c103b2e291b25843e35ec`已普通推送核远端，阶段证据见[当前配置行来源](<Rental Core-开发记录.md#configuration-row-revision-core-source-20261112>)。两模型的`configurationRevision Int @default(1)`及DDL由AI作者应用，本树未改Schema或生成Client；Core用原行而非缓存/品类字符串猜修订。验证暂存已核实删除。PM另准分配服务`recordIssue`原事务参加者及业务配置/九项源的最小片，尚未接入；AI的OutboxParticipant/ResourcePorts和事件模型仍归AI作者，main HTTP/构建由PM独占。
- 分配/业务服务的原事务`readRecordedFulfillmentIssue`与写锁外`readTenantReadinessSource`两个只读合同固定源码`fe65ac652076d5bed4c9ca439d50b563c61d17aa`已普通推送核远端，不改原扫描、登记或九项算法。API类型、原分配14断言/开业读取17项及新读取5组通过，暂存已核实删除，见[只读来源阶段](<Rental Core-开发记录.md#core-failure-read-ports-20261112>)。ResourcePorts不得重入扫描/新开业务事务，不以独立观察冒充快照；可选参加者未接入，缺正式临近政策/事实/授权不捕获。
- 主树、AI及企业树的并行成果保留，不追活动HEAD、不夹带他人WIP。固定整合按来源SHA及受影响路径核对；原63项审查全文仍见[平台开发记录](../管理后台/管理后台-开发记录.md#review-63)，不由旧状态推定当前已完成。
- 旧阶段25份清单是主树 `D:/工作文件/rental-OS/output/category-governance` 的唯一跨树原稿，本树26处现行链接已按PM安排改相对主仓库路径；另2处历史附件缺失保留，本树新证据仍在本树同名目录。原检查器继续将跨树路径列为`link-outside`，本片单独核固定原稿，不复制副本或放松规则。PM收回main时须按目标文档位置调整相对层级，见[原稿记录](<Rental Core-开发记录.md#evidence-original-location-20261112>)。
- Shared202文件保持，本树当前API为c24固定源码的866份自持JS，包含原批次/续租、R08、快照、完整配置补落及原九项/reader/委托封存补片，四项Shared/Client保护未变。原各阶段结果/失败保留，包不计CLOSE或真库/HTTP/宿主/发布完成。上次退出暂存已安全移至主仓库统一待清理目录，862文件尚未删除；责任清单和实际构建范围唯一见[当前阶段](<Rental Core-开发记录.md#api-current-build-cleanup-20261112>)。工具只读使用，同树包别名不跨树共享。

## 3. 下一入口与原缺口

当前[原九项同client来源](<Rental Core-开发记录.md#readiness-original-transaction-20261112>)由PM协调固定消费：Core/业务/会员及绑定前后读复用服务器原tx，原tenant方案总体、无tx独立调用及九项判定不变；同client不当总修订或快照栅栏。下一为四入口真实counter/相关变更、结构化resource_shortage及原tx参加者；assignment.issueSource窄窗口等待PM核准，缺正式临近政策/当前授权保持not_captured，不在写锁里重入scanOrder或新开业务事务。reader原字段/冻结历史逻辑与全局键保持，单目标不当目录覆盖。AI/企业/公共消费和真实环境仍按原分工，CAT-GOV/CLOSE原门槛不变。暂存已归集未删除，工具恢复后优先沿原责任清单处理，不继续堆建同类临时环境。

1. 沿[品类治理接续](品类治理/品类治理-协作接续.md)推进治理发布、新编码/新空间及端消费，08存量主链独立必做。当前治理已复用原Auth平台身份/权限，由Core承担Serializable与前后检查，见[当前阶段](品类治理/品类治理-开发记录.md#governance-current-authority-20261111)；真实锁/发布/恢复继续未验。
   写锁`9380d1bab`及读口`forWorkspace`固定源码`cb96a636b61497243d75032e98d0e301ff3d31a0`均已普通推送核远端，拒绝坏采用修订，保留初始0/历史明确版本并先捕获同一次绑定。API类型、原四品类对齐及限定5组通过，见[当前解析阶段](<Rental Core-开发记录.md#workspace-resolver-binding-20261112>)。PM固定main `307abf572`只收前片12行guard，必要unique/草稿context helper及消费片另交；真实并发/恢复待原门槛。
   AIN-17下一最小口：按固定配置行合同由唯一作者应用两列/DDL，消费`readOpeningConfiguration`的真实profile修订/来源及顶层settingsRevision；ResourcePorts使用已新增的原事务问题读取和锁外原九项来源。六类配置补落已共用原事务，开业配置投影可传原client，原九项独立观察仍不是同事务总版本；继续核业务/会员来源和实际参加者，不能在`recordIssue`持锁时重入扫描/另开业务事务，缺临近政策/事实/当前授权保持not_captured。正常/空update/并发/饱和/回滚及真实重放仍需证据。
2. 原十二项CLOSE首轮静态核实见[本轮记录](<Rental Core-开发记录.md#core-resume-20261110>)：实际用量/完整免赔、非实物/停租/结算后追加及真实预授权仍有实现缺口，其余保留原真实证据门槛。旧状态仅是2026-10-18口径，不新增分数，不计入CAT-GOV分母。
3. 企业作者消费[固定换货端口](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts)和[企业参与合同](../../apps/api/src/modules/rental-core/approved-exchange-transaction.ports.ts)，Core/本人原身份与K/C边界保持。照片已有原5组正常消费及本7组恢复限定结果，完成失败保留原占用/目标、失应答及票据过期均不重传；证据唯一见[恢复阶段](<Rental Core-开发记录.md#exchange-photo-core-recovery-20261112>)。下一口由企业唯一作者接HTTP/DI/实际消费者，并按原门槛核真实权限/事务/存储/宿主；未冻结照片不可接受，原11组替身不替代实际企业参与者或正式验收。本树继续品类治理主线。
4. ECP-10 maturity第一阶段源码`2f1a34897614c413ba1aeebed1d8ee3687571b05`已固定推送，Core纯decoder/原ID及原服务actor-time绑定完成类型与源码/当前包限定7组；原整组Tenant父锁fixture失败保留，见[原核定证据阶段](<Rental Core-开发记录.md#corporate-maturity-evidence-20261112>)。旧双时间、未知/null版本不降级及原operator/staff门闸保持。第二阶段单ledger finance字段/coverage方案归记录，企业port/Shared窗口尚未开放，继续CAT-GOV主线；原statement/历史空间/混合guarantee缺口保留。
5. 非关键路径CLOSE依原任务留后续，保持用量/免赔、特殊结案、停租、车辆后发现费用、真实保证金及安全的完整门槛。历史CORE-019片不覆盖存量账务、企业原回款冲销或真实供应商保证金。

## 4. 验证与交付边界

代码/类型、离线行为、真实事务、供应商、后台/微信宿主及正式放行分别登记。缺原事实/权限保持拒绝或待核对；不以模拟或缺金额=零补生产依赖。本树已自持Client/Shared/API产物并取得类型及定向离线证据；[规则/日历草稿接点](品类治理/品类治理-开发记录.md#bound-draft-category-context-20261111)也已复核，原场景失败及真实验收缺口保留，不能计为CLOSE完成。记录与接续同步实际证据，不用阶段提交、默认关闭或测试数量判完成；本轮前像由开工Git提交保全。
