# Rental Core 协作接续

更新时间：2026-11-12。

> 本轮由负责人通过PM正式授权Core研发负责人在指定工作树恢复核心开发。主线为品类治理原CAT-GOV-01～14全部收口，同时独立核实本册原十二项CLOSE及对企业/AI的必要Core接点；不混算进度、不扩大为PCH。日常任务分支精确提交/普通推送持续获准；每个可独立验证阶段交固定SHA，由PM串行收回main，不等待两个完整任务。对外仅向PM提交一次必要的完整阶段、真实依赖/阻塞及需判断的问题，不抄送AI、企业、QA、OP或助手，不因收到消息自行回信/转发；跨域窗口和QA分派由PM协调。禁止新增/扩写测试脚本，采用已有定向冒烟、短命令及必要类型检查；本轮不含真实环境、依赖安装、迁移、部署或生产启用许可。

## 1. 目标与依据

按[需求](<Rental Core-需求.md>)和[原12项CLOSE任务](<Rental Core-开发任务.md>)完成通用租赁闭环；完整业务条款仍见[平台需求](../管理后台/管理后台-需求.md)。[记录](<Rental Core-开发记录.md>)承接证据入口，不另造总计划。

品类定义/发布/采用/动态编码见子目录[品类治理接续](品类治理/品类治理-协作接续.md)；跨行业Core接入见[平台专项](../平台底座/Core接入/平台Core接入-协作接续.md)。两者不能替代原CLOSE工作。

## 2. 现场和写入归属

- 唯一开发树为`D:/工作文件/rental-OS/worktree/rental-core`，分支`codex/rental-core`。本阶段从已推送`48e1b68075dda80743a0abb082d2c41ec83d0671`接续PM指定的[续租原夹具及保证金来源核查](<Rental Core-开发记录.md#extension-services-fixture-guarantee-sources-20261112>)，原12项复验通过，新空快照及历史缺失分别保留。原[治理请求副本](<Rental Core-开发记录.md#governance-input-detached-20261112>)由QA接续审查，原创建整组3/6失败及867份API来源保留。前片[履约来源与原tx](<Rental Core-开发记录.md#fulfillment-issue-transaction-participant-20261112>)已固定，正式ResourcePorts/临近政策/宿主、开业counter/参加者仍由PM协调，当前履约保持not_captured。原九项同client的main固定结果`e96e3e9a1952c813d1d6e6d9a4b12f3a77dfd186`及原reader证据保留。Core继续原08及动态组合经营，企业/QA与共同文件由PM协调。
- Core负责人可写Core专属实现、shared对应领域协议和必要既有接点；共同总入口先报具体字段/路径，由PM指定唯一作者。AI runner和企业政策/审批内部实现归各自研发，企业端消费原Core，不复制账本或计价逻辑。本轮无额外助手。
- PM已明确三份Core配置/快照/回填文件的配置revision及读取窗口，固定源码`5e8d52325b37cf6b613c103b2e291b25843e35ec`已普通推送核远端，阶段证据见[当前配置行来源](<Rental Core-开发记录.md#configuration-row-revision-core-source-20261112>)。两模型的`configurationRevision Int @default(1)`及DDL由AI作者应用，本树未改Schema或生成Client；Core用原行读取修订。分配服务已在原聚合提交前接可选fulfillment参加者，并明确结构化来源生命周期；AI参加者/存储仅按指定两blob接入，ResourcePorts和事件模型算法仍归原作者，宿主/共同装配由PM指定唯一作者。
- 分配/业务服务的原事务`readRecordedFulfillmentIssue`与原`readTenantReadinessSource`两个只读合同的`fe65ac652076d5bed4c9ca439d50b563c61d17aa`证据保留，见[只读来源阶段](<Rental Core-开发记录.md#core-failure-read-ports-20261112>)；九项随后支持同client，履约本片仅对有效结构化原因及正数活动分配授源。ResourcePorts不得重入扫描/新开业务事务，不以独立观察或同client冒充快照；缺正式临近政策/事实/授权保持不捕获。
- 主树、AI及企业树的并行成果保留，不追活动HEAD、不夹带他人WIP。固定整合按来源SHA及受影响路径核对；原63项审查全文仍见[平台开发记录](../管理后台/管理后台-开发记录.md#review-63)，不由旧状态推定当前已完成。
- 旧阶段25份清单是主树 `D:/工作文件/rental-OS/output/category-governance` 的唯一跨树原稿，本树26处现行链接已按PM安排改相对主仓库路径；另2处历史附件缺失保留，本树新证据仍在本树同名目录。原检查器继续将跨树路径列为`link-outside`，本片单独核固定原稿，不复制副本或放松规则。PM收回main时须按目标文档位置调整相对层级，见[原稿记录](<Rental Core-开发记录.md#evidence-original-location-20261112>)。
- Shared202文件保持，本树当前API867份自持JS：c24固定构建及原输入捕获、当前履约/固定AI必要emit，原结果/失败保留；最终三份实际保护文件和Shared运行时核对见[履约阶段](<Rental Core-开发记录.md#fulfillment-issue-transaction-participant-20261112>)，不当作完整构建/真库/HTTP/宿主/发布验收。原c24的862文件、采用输入4文件、治理验证2文件及当前履约8文件均已归集主仓库原任务责任目录、未删除；清单分别从原[构建](<Rental Core-开发记录.md#api-current-build-cleanup-20261112>)、[输入](<Rental Core-开发记录.md#adoption-input-capture-20261112>)及履约阶段定位。原任务暂存不存在，工具只读使用，同树包别名不跨树共享。

## 3. 下一入口与原缺口

原续租服务夹具已完成PM指定修复及12项复验，阶段证据和保证金缺件见[当前记录](<Rental Core-开发记录.md#extension-services-fixture-guarantee-sources-20261112>)。Core继续原08、治理发布和动态组合主线。原九项同client、结构化履约来源及recordIssue原tx参加者已固定；正式ResourcePorts/已发布临近政策/宿主、开业counter与写入参加者由PM协调，缺依赖保持not_captured。保证金来源合同须包含实际付款/授权人、原事件/供应商引用、合同/币种及原路径退款/释放，企业保证金变化执行仍不可用。新增一个空audit和空缓存目录已归集至当前阶段的唯一清单，原暂存不存在，旧残留及工具恢复后的清理责任保留。

1. 沿[品类治理接续](品类治理/品类治理-协作接续.md)推进治理发布、新编码/新空间及端消费，08存量主链独立必做。当前治理已复用原Auth平台身份/权限，由Core承担Serializable与前后检查，见[当前阶段](品类治理/品类治理-开发记录.md#governance-current-authority-20261111)；真实锁/发布/恢复继续未验。
   写锁`9380d1bab`及读口`forWorkspace`固定源码`cb96a636b61497243d75032e98d0e301ff3d31a0`均已普通推送核远端，拒绝坏采用修订，保留初始0/历史明确版本并先捕获同一次绑定。API类型、原四品类对齐及限定5组通过，见[当前解析阶段](<Rental Core-开发记录.md#workspace-resolver-binding-20261112>)。PM固定main `307abf572`只收前片12行guard，必要unique/草稿context helper及消费片另交；真实并发/恢复待原门槛。
   AIN-17下一最小口：按固定配置行合同由唯一作者应用两列/DDL，消费`readOpeningConfiguration`的真实profile修订/来源及顶层settingsRevision；ResourcePorts使用已新增的原事务问题读取和锁外原九项来源。六类配置补落已共用原事务，开业配置投影可传原client，原九项独立观察仍不是同事务总版本；继续核业务/会员来源和实际参加者，不能在`recordIssue`持锁时重入扫描/另开业务事务，缺临近政策/事实/当前授权保持not_captured。正常/空update/并发/饱和/回滚及真实重放仍需证据。
2. 原十二项CLOSE首轮静态核实见[本轮记录](<Rental Core-开发记录.md#core-resume-20261110>)：实际用量/完整免赔、非实物/停租/结算后追加及真实预授权仍有实现缺口，其余保留原真实证据门槛。旧状态仅是2026-10-18口径，不新增分数，不计入CAT-GOV分母。
3. 企业作者消费[固定换货端口](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts)和[企业参与合同](../../apps/api/src/modules/rental-core/approved-exchange-transaction.ports.ts)，Core/本人原身份与K/C边界保持。照片已有原5组正常消费及本7组恢复限定结果，完成失败保留原占用/目标、失应答及票据过期均不重传；证据唯一见[恢复阶段](<Rental Core-开发记录.md#exchange-photo-core-recovery-20261112>)。下一口由企业唯一作者接HTTP/DI/实际消费者，并按原门槛核真实权限/事务/存储/宿主；未冻结照片不可接受，原11组替身不替代实际企业参与者或正式验收。本树继续品类治理主线。
4. ECP-10 maturity第一阶段源码`2f1a34897614c413ba1aeebed1d8ee3687571b05`已固定推送，Core纯decoder/原ID及原服务actor-time绑定完成类型与源码/当前包限定7组；原整组Tenant父锁fixture失败保留，见[原核定证据阶段](<Rental Core-开发记录.md#corporate-maturity-evidence-20261112>)。旧双时间、未知/null版本不降级及原operator/staff门闸保持。第二阶段单ledger finance字段/coverage方案归记录，企业port/Shared窗口尚未开放，继续CAT-GOV主线；原statement/历史空间/混合guarantee缺口保留。
5. 非关键路径CLOSE依原任务留后续，保持用量/免赔、特殊结案、停租、车辆后发现费用、真实保证金及安全的完整门槛。历史CORE-019片不覆盖存量账务、企业原回款冲销或真实供应商保证金。

## 4. 验证与交付边界

代码/类型、离线行为、真实事务、供应商、后台/微信宿主及正式放行分别登记。缺原事实/权限保持拒绝或待核对；不以模拟或缺金额=零补生产依赖。本树已自持Client/Shared/API产物并取得类型及定向离线证据；[规则/日历草稿接点](品类治理/品类治理-开发记录.md#bound-draft-category-context-20261111)也已复核，原场景失败及真实验收缺口保留，不能计为CLOSE完成。记录与接续同步实际证据，不用阶段提交、默认关闭或测试数量判完成；本轮前像由开工Git提交保全。
