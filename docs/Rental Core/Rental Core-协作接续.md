# Rental Core 协作接续

更新时间：2026-11-12。

> 本轮由负责人通过PM正式授权Core研发负责人在指定工作树恢复核心开发。主线为品类治理原CAT-GOV-01～14全部收口，同时独立核实本册原十二项CLOSE及对企业/AI的必要Core接点；不混算进度、不扩大为PCH。日常任务分支精确提交/普通推送持续获准；最新安排为每个可独立验证阶段交固定SHA，由PM串行收回main，不等待两个完整任务。禁止新增/扩写测试脚本，采用已有定向冒烟、短命令及必要类型检查；本轮不含真实环境、依赖安装、迁移、部署或生产启用许可。

## 1. 目标与依据

按[需求](<Rental Core-需求.md>)和[原12项CLOSE任务](<Rental Core-开发任务.md>)完成通用租赁闭环；完整业务条款仍见[平台需求](../管理后台/管理后台-需求.md)。[记录](<Rental Core-开发记录.md>)承接证据入口，不另造总计划。

品类定义/发布/采用/动态编码见子目录[品类治理接续](品类治理/品类治理-协作接续.md)；跨行业Core接入见[平台专项](../平台底座/Core接入/平台Core接入-协作接续.md)。两者不能替代原CLOSE工作。

## 2. 现场和写入归属

- 唯一开发树：`D:/工作文件/rental-OS/worktree/rental-core`，分支`codex/rental-core`。本片开工/GitHub核对`5983acd3af5c3457dade88fc32515c9a2efc493f`，无merge/cherry-pick。照片固定源码`e2a1a2b9d`、前置`0947a6eb8`，原5组正常消费及本7组完成失败/失应答/过期恢复均取得限定证据，见[照片恢复阶段](<Rental Core-开发记录.md#exchange-photo-core-recovery-20261112>)；HTTP/DI/浏览器和真实事务/存储仍未验。企业作者独占本人photo GET/DI/受权Blob及准备面板接线，不改四个冻结模块。不得回main施工、重建旧C树或处理负责人接管的空目录。
- Core负责人可写Core专属实现、shared对应领域协议和必要既有接点；共同总入口先报具体字段/路径，由PM指定唯一作者。AI runner和企业政策/审批内部实现归各自研发，企业端消费原Core，不复制账本或计价逻辑。本轮无额外助手。
- PM已明确三份Core配置/快照/回填文件的配置revision及读取窗口，固定源码`5e8d52325b37cf6b613c103b2e291b25843e35ec`已普通推送核远端，阶段证据见[当前配置行来源](<Rental Core-开发记录.md#configuration-row-revision-core-source-20261112>)。两模型的`configurationRevision Int @default(1)`及DDL由AI作者应用，本树未改Schema或生成Client；Core用原行而非缓存/品类字符串猜修订。验证暂存已核实删除。PM另准分配服务`recordIssue`原事务参加者及业务配置/九项源的最小片，尚未接入；AI的OutboxParticipant/ResourcePorts和事件模型仍归AI作者，main HTTP/构建由PM独占。
- 分配/业务服务的原事务`readRecordedFulfillmentIssue`与写锁外`readTenantReadinessSource`两个只读合同固定源码`fe65ac652076d5bed4c9ca439d50b563c61d17aa`已普通推送核远端，不改原扫描、登记或九项算法。API类型、原分配14断言/开业读取17项及新读取5组通过，暂存已核实删除，见[只读来源阶段](<Rental Core-开发记录.md#core-failure-read-ports-20261112>)。ResourcePorts不得重入扫描/新开业务事务，不以独立观察冒充快照；可选参加者未接入，缺正式临近政策/事实/授权不捕获。
- 主树、AI及企业树的并行成果保留，不追活动HEAD、不夹带他人WIP。固定整合按来源SHA及受影响路径核对；原63项审查全文仍见[平台开发记录](../管理后台/管理后台-开发记录.md#review-63)，不由旧状态推定当前已完成。
- 旧阶段25份清单是主树 `D:/工作文件/rental-OS/output/category-governance` 的唯一跨树原稿，本树26处现行链接已按PM安排改相对主仓库路径；另2处历史附件缺失保留，本树新证据仍在本树同名目录。原检查器继续将跨树路径列为`link-outside`，本片单独核固定原稿，不复制副本或放松规则。PM收回main时须按目标文档位置调整相对层级，见[原稿记录](<Rental Core-开发记录.md#evidence-original-location-20261112>)。
- PM固定维护`6b2dd0a`已在本树整合；Shared202文件保持，API863文件仍为固定`3efc62884`照片构建，本片配置行修订未编入，见[原构建](<Rental Core-开发记录.md#exchange-photo-freeze-20261111>)。旧换货/客户端/采用及其他失败继续保留，不计CLOSE进度。工具只读使用，同树包别名不跨树共享；本片API类型/原配置范围3项/来源读取3组通过，原开业整组5过/8失败。照片原5组限定消费有效，真实HTTP/DI/库/宿主/供应商仍未验。

## 3. 下一入口与原缺口

1. 沿[品类治理接续](品类治理/品类治理-协作接续.md)推进治理发布、新编码/新空间及端消费，08存量主链独立必做。当前治理已复用原Auth平台身份/权限，由Core承担Serializable与前后检查，见[当前阶段](品类治理/品类治理-开发记录.md#governance-current-authority-20261111)；真实锁/发布/恢复继续未验。
   AIN-17下一最小口：按固定配置行合同由唯一作者应用两列/DDL，消费`readOpeningConfiguration`的真实profile修订/来源及顶层settingsRevision；ResourcePorts使用已新增的原事务问题读取和锁外原九项来源。业务配置只有价格子段共用事务，九项不是同事务快照；继续核实际参加者，不能在`recordIssue`持锁时重入扫描/另开业务事务，缺临近政策/事实/当前授权保持not_captured。正常/空update/并发/饱和/回滚及真实重放仍需证据。
2. 原十二项CLOSE首轮静态核实见[本轮记录](<Rental Core-开发记录.md#core-resume-20261110>)：实际用量/完整免赔、非实物/停租/结算后追加及真实预授权仍有实现缺口，其余保留原真实证据门槛。旧状态仅是2026-10-18口径，不新增分数，不计入CAT-GOV分母。
3. 企业作者消费[固定换货端口](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts)和[企业参与合同](../../apps/api/src/modules/rental-core/approved-exchange-transaction.ports.ts)，Core/本人原身份与K/C边界保持。照片已有原5组正常消费及本7组恢复限定结果，完成失败保留原占用/目标、失应答及票据过期均不重传；证据唯一见[恢复阶段](<Rental Core-开发记录.md#exchange-photo-core-recovery-20261112>)。下一口由企业唯一作者接HTTP/DI/实际消费者，并按原门槛核真实权限/事务/存储/宿主；未冻结照片不可接受，原11组替身不替代实际企业参与者或正式验收。本树继续品类治理主线。
4. ECP-09/10的[Core当前空间读端口](../../apps/api/src/modules/rental-core/rental-enterprise-read.port.ts)及原48行共享投影仍归Core；PM已按固定`527e731c8`逐blob核实，声明企业17f4f9887及前置已收回并核GitHub main `917a92a1a41caadc1180e8c8b2c8dc0b596c748f`，未取活动换货代码。其DI/登记/消费者已有源码和离线结果，真实HTTP、完整ECP仍待验；本树不追活动main。历史跨空间、全账户其他空间、正式账单/核定到期及保证金专用读源仍不可用，不另算账。企业 `readerCursor/readerAudit` 仅其既有审计段，不占本片租赁合同。按负责人明确交接给企业可消费固定SHA；不以他树环境许可运行本树服务。
5. 非关键路径CLOSE依原任务留后续，保持用量/免赔、特殊结案、停租、车辆后发现费用、真实保证金及安全的完整门槛。历史CORE-019片不覆盖存量账务、企业原回款冲销或真实供应商保证金。

## 4. 验证与交付边界

代码/类型、离线行为、真实事务、供应商、后台/微信宿主及正式放行分别登记。缺原事实/权限保持拒绝或待核对；不以模拟或缺金额=零补生产依赖。本树已自持Client/Shared/API产物并取得类型及定向离线证据；[规则/日历草稿接点](品类治理/品类治理-开发记录.md#bound-draft-category-context-20261111)也已复核，原场景失败及真实验收缺口保留，不能计为CLOSE完成。记录与接续同步实际证据，不用阶段提交、默认关闭或测试数量判完成；本轮前像由开工Git提交保全。
