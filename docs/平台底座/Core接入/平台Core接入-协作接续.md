# 平台 Core 接入当前协作接续

更新时间：2026-11-18。

> 负责人已授权RD与dev1共用本树持续完成PCH-01～12，并允许双方就具体冲突/阻塞直接协商；Git索引、提交推送和PCH四册由RD统一负责。无Core独立运行、完整Rental标准包及全功能验收仍未完成。正式依据为[需求v1.5](平台Core接入-需求.md)与[开发任务v1.5](平台Core接入-开发任务.md)，进度只由原G1～G4门槛核收。

## 1. 当前目标与施工范围

建设对开发者和开发AI友好的AI Native SaaS底座。没有Core也能启动、登录、维护公共设置并使用完整后台外壳；没有Core不开放通用Agent任务。侧栏、内容容器、面包屑/页名整行、铃铛、休息和面板收展归底座，Core声明自己的路由、页面、主操作和数据方法，复用原React/UIArc、表单/列表与请求反馈。[声明式页面合同](平台Core接入-开发任务.md#declarative-page-contract)

开发者受控注册Core→SaaS管理员授权租户→租户管理员分配成员→按业务角色和范围使用。同部署、同租户多Core并存，新Core不默认分配全员。Core共用租户订阅期限，分别开通/停用；停用保留配置、数据、原绑定和收据，重开核当前条件，不重复初始化或重放。续费不恢复主动停用、成员撤权或账号冻结。各Core自定义业务分区；客户等其他audience沿原专用授权，历史/在途/unknown按原权限收尾。

Core的AI工具可选，缺工具时普通后台仍可用，Agent不能访问该Core。未来跨Core协作通过明确对象引用/接口/事件实现，本期不开放共享业务表或隐含读权。先交标准本地包，再接固定GitHub Release获取及Topic发现；底座与Core分别更新，保留下游业务、配置、数据和授权。[包标准](平台Core接入-开发任务.md#core-package-standard) · [独立更新](平台Core接入-开发任务.md#independent-upgrades)

唯一施工树为 C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS，分支 codex/platform-core-extraction。本树由RD与dev1按文件分工写入；允许修改PCH所需Auth/Guard/ALS、正式包出口、主装配/OpenAPI、schema/迁移/Seed与后台外壳。main索引和其他树仍归其作者。已接住当天固定main7d49c26c9423f2400a233275e84cca5cb4127fa3；相对已接1d53ada2bb79a220e4d99f75f27508bfac5360a5只改AI Native三册，三份blob逐一与上游相等。HTTP源码切片2290a1f11e113b6a1c04bac2dd9706b2caf35e88已普通推送并实际远端回读，随后合并d32dd1938278fb10136997b8ad4013c222777a3a保留dev1全部公共集成WIP；未追其他专项活动HEAD。[当前固定主线](平台Core接入-开发记录.md#core-main-acceptance-docs-20261118)

通知草稿/原删除收据、报价提交前回调、个人付款委托与恢复正文剥离已接到Rental包，公共权限匹配、面板图标及193个精确兼容出口保留。原维护读取器由宿主真实供给，缓存只有核验过的不可变无正文引用。费用批准与商户委托的五个服务现也归Rental单源，旧Nest构造顺序保持，78个方法正文与固定父版一致；续租持久报价明确参加已有事务，客户层不重复调用Core授信占用。原42项批准/续租/换货冒烟及十配置类型通过，下一步迁入Controller与客户端；当前切片固定父版6d142a6bd96b829c0f124308d8f0dd9d1cd8e6d2保存原文和完整旧接续。[当前批准链](平台Core接入-开发记录.md#core-rental-enterprise-approval-runtime-20261117) · [原主线兼容](平台Core接入-开发记录.md#core-main-notification-sync-20261117)

企业资格、订单/财务读取、原命令/审计、客户主档/会员、政策及成员交接已单源迁入Rental包，公共日志基础写入/脱敏在platform-server。企业申请、管理请求、任务中心、行政交接、付款证明和成员审计现也迁入Rental，原API只供给同一实例；客户各端、续租/换货费用合同由纯业务出口维护。本片97个方法/函数正文及138个合同声明正文一致，原101项工作流冒烟和十配置类型通过。下一步继续剩余Controller和客户端，再处理数据/迁移/Seed和标准装配。父版48a5ecac5a1a1c6d974e183260a7895e5fe10c56保全本片原文/完整接续。[当前申请/任务阶段](平台Core接入-开发记录.md#core-rental-enterprise-workflow-runtime-20261117)[当前政策/成员阶段](平台Core接入-开发记录.md#core-rental-enterprise-policy-members-20261117) · [客户主档](平台Core接入-开发记录.md#core-rental-customer-master-20261117) · [企业读取](平台Core接入-开发记录.md#core-rental-enterprise-reads-20261117) · [原工作流基线](平台Core接入-开发记录.md#core-enterprise-workflow-fixture-20261117)。官方日历源按公共能力处理，原恢复/收款与采用未完项沿阶段证据承接。[恢复/收款](平台Core接入-开发记录.md#core-rental-recovery-payments-20261117) · [采用闭包](平台Core接入-开发记录.md#core-rental-category-adoption-20261117)。正式需求/任务身份、依赖、顺序和业务规则沿批准依据，MIT与品牌原稿引用固定Git。

负责人已将 `[Saas 底座]-dev1` 迁入共享施工。原订阅ee3295及基础集成未完检查点719cb92e919b140027cc56e10434e9ec77db5a09均已保全并迁入；旧树目录及Git登记已移除，源分支留存。dev1持续完成公共订阅/基础集成API/UI/数据和模块导读，随后补公共组织/其余安全；RD继续Rental并统一索引、提交/推送及PCH四册。共同文件先约具体窗口，双方直接处理真实冲突。attach_worktree因归属校验未完成UI关联，但共享目录/分支已通过显式workdir核实；今后所有命令固定到本节唯一施工路径。[迁入与共享证据](平台Core接入-开发记录.md#core-shared-dev1-migration-20261118)

主/业务、空间能力和员工收款HTTP已单源迁入Rental包，原API只再导出同一Controller。主/业务原214方法中212正文一致、2处context改用同一快照/刷新接点，原装饰器、17项/6项构造依赖、默认键及原事务保持；统一接线复用原实例，可选检查事件只投影方法，避免重复生命周期。十配置类型和一次实际Nest冒烟通过，固定提交e1104f4b4f5677bfac8fd1370b53c4c58db6c612已普通推送并实际回读；下一入口为其余企业/客户Controller及客户端。整体API合同检查仍有614项未配对/未识别路径，接口规范化须处理，元数据/类型不证明API齐全。dev1稳定JSON存储修复组已停写并确认四份原冒烟退出0，RD完成八文件核对并按独立阶段固化，完整类型依赖明确。[主/业务HTTP](平台Core接入-开发记录.md#core-rental-main-http-20261118) · [JSON存储](平台Core接入-开发记录.md#core-public-integration-json-20261118) · [原HTTP检查失败](平台Core接入-开发记录.md#core-rental-http-entry-20261118)

当前JSON修复固定提交为48a52786a5f5bd4fd01dc99a30f5e516d57d3795，已实际远端回读，作者四份原冒烟和定向类型完整命令已补回原阶段。公共官方日历来源也已接入同一公共/原组合实例，业务侧仅消费冻结读取器；公共和组合OpenAPI复用原五操作/三路径及year查询。公共schema为31模型/七迁移，数据版本0.1.3，建表外键解析阻塞已修复；定向Nest冒烟、原正文核对及公共/原API类型通过。dev1公共集成页面组待准确清单统一固化，随后继续组织/其余安全；RD继续Rental剩余HTTP/数据及标准装配。本片原文和完整旧接续引用固定父版48a52786，不另留副本。[当前日历与数据计划](平台Core接入-开发记录.md#core-public-official-calendars-20261118)

## 2. 已有实际接点

| 模块 | 当前实现及证据入口 |
| --- | --- |
| 公共合同/服务与无Core API | [platform-contracts](../../../packages/platform-contracts/README.md)、[platform-server](../../../packages/platform-server/README.md)、[platform-api](../../../apps/platform-api/README.md)持有认证、会话、外观、初始化、租户/人员角色、订阅、集成与官方来源公共HTTP；31公共模型/七份迁移已提供，当前仅核摘要/结构计划，没有执行迁移。原API窄转接同一实现，原组合schema/历史迁移保留。[公共宿主](平台Core接入-开发记录.md#core-public-host-packages-20261115) · [当前日历](平台Core接入-开发记录.md#core-public-official-calendars-20261118) |
| 标准Core宿主 | [core-contracts](../../../packages/core-contracts/README.md)、core-host与[platform-core-host](../../../packages/platform-core-host/README.md)提供正式清单、授权/分配、绑定/原收据、本人目录、范围/就绪、HTTP政策和移除预检。独立公共主装配消费同源Guard/OpenAPI，原Rental总装配仍需迁移。[公共主接点](平台Core接入-开发记录.md#core-public-assembly-20261115) |
| 期限与实际数据观察 | 公共统一订阅期限reader、固定公共SQL/结构检查、工单实际物理reader及原Prisma账已提供，目录/升级预检消费真实证据接点。当前数据库/迁移尚未实际执行，清单不能补成功。[期限/公共数据](平台Core接入-开发记录.md#core-public-data-term-20261115) · [工单物理与原账](平台Core接入-开发记录.md#core-mysql-data-observation-20261115) |
| 公共后台 | [platform-admin](../../../packages/platform-admin/README.md)持有原外壳/UIArc、主题/语言/音效、通知/休息/面板、页面/表单/列表和稳定会话/请求/缓存端口；[零Core Web](../../../apps/platform-admin/README.md)与[工单Web](../../../apps/example-tickets-admin/README.md)复用同一应用工厂。Core目录/授权面板、人员角色、租户创建/资料/状态及本人安全已接公共页面。[目录](平台Core接入-开发记录.md#core-access-directory-ui-20261115) · [人员角色](平台Core接入-开发记录.md#core-public-access-pages-20261115) · [租户页面](平台Core接入-开发记录.md#core-public-tenant-pages-20261115) · [恢复口令/角色删除](平台Core接入-开发记录.md#core-public-access-actions-20261115) · [本人安全](平台Core接入-开发记录.md#core-public-self-security-20261115) |
| 非租赁示范 | [工单Core](../../../packages/example-tickets-core/README.md)有独立领域/MySQL迁移、8条业务HTTP政策、原收据与四页声明。API/Web共用标准包与版本锁核验、公共数据库和权限；所选权限登记只写元数据，不授予角色或Core。[独立宿主](平台Core接入-开发记录.md#core-tickets-independent-host-20261115) · [权限登记](平台Core接入-开发记录.md#core-permission-registration-20261115) |
| Rental包与兼容入口 | [rental-core](../../../packages/rental-core/README.md)已持有原主核心与报价/营销聚合、订单确认/商户委托、配货/办理锁/自动扫描、工作台/经营报表/到期作业、换货试算/检查准备/专用影像/客户同意与批准执行/不可变凭证及经营空间边界、配置与业务请求DTO、合同、品类解析/身份、计价/器材、能力/审计/实例、恢复快照/原收据、业务动作事务和核心/业务配置，以及订单/资产/库存/处置/工单/检查/续租换货及报价/券/奖励/通知事实。原shared/API消费同一实现；资金事实/门禁与原事件、企业应收/原回款收据、服务容量、原批准/检查同意、检查/换货/续租及服务规则也成为包内单源，完整服务/数据/页面/作业/AI和标准主装配继续迁移。[原业务导读](../../../apps/api/src/modules/rental-core/README.md) · [核心事实阶段](平台Core接入-开发记录.md#core-rental-core-facts-20261116) |

以上已有类型、静态、内存构建、实际Nest容器或离线行为证据，具体层级从各阶段记录读取。它们不代表浏览器、真实HTTP/数据库、完整安装或正式验收通过。

## 3. 下一实施入口与未完项

1. 继续完成Rental独立包。核心/报价营销、配置与业务请求DTO、订单确认/批准/商户委托、配货/办理锁/自动扫描、工作台/经营报表/到期作业、具体检查同意/批准执行、规则/日历绑定草稿、批准设置、品类草稿/发布/开通政策、采用准备/最终提交及经营空间边界已单源迁入；事实/配置/恢复/收据、资金/容量/企业核销及原冻结规则也有正式出口。企业政策、邀请/成员及管理员交接、申请/管理请求/任务中心、行政交接及成员审计已完成单源迁移，费用批准/委托已完成单源迁移，下一步迁入Controller和客户端，再形成标准Core装配、schema/迁移/Seed、页面/客户端、其余作业/回调及AI接点。客户主档/会员唯一写入、企业政策与资格由Rental包提供，会员业务服务、文件与原Auth仍由宿主供给实际参加者，不能以空适配替代；保留原权限码、标识、金额、锁、事务、幂等和历史依据，事件/作业只有一个执行者。[完整兼容清单](平台Core接入-开发记录.md#core-ownership-baseline-20261114) · [原主核心](平台Core接入-开发记录.md#core-rental-core-facts-20261116) · [确认/委托](平台Core接入-开发记录.md#core-rental-order-confirmation-20261116) · [配货/扫描](平台Core接入-开发记录.md#core-rental-allocation-runtime-20261116)
2. dev1继续公共组织/其余安全及公共页面装配；订阅办理/API/UI、集成服务/合同/schema及官方来源服务/HTTP/数据已迁入，JSON修复已固定上传。公共集成页面组已完成作者定向类型/冒烟，待其准确文件组与证据统一固化，不能按整个status夹带。RD维护公共装配交叉文件、源/字段文档及Rental只读适配；建表内外键解析已修复。公共页面、示范宿主和数据必须实际接线，不能把类型或期限reader当作完整公共能力。原有效会话的wid必须作为签名证据核验，不在公共业务workspace恢复Rental权限；原简称省略/null/空字符串及审计兼容保持。[当前日历](平台Core接入-开发记录.md#core-public-official-calendars-20261118) · [公共兼容基线](平台Core接入-开发记录.md#core-public-window-baseline-20261115) · [原身份SQL](平台Core接入-开发记录.md#core-principal-sql-runtime-20261115) · [公共认证](平台Core接入-开发记录.md#core-public-auth-extraction-20261115)
3. 完成原Rental主AppModule/Guard与各audience接线。主provider通过明确imports/exports供给同一数据库、人员、订阅、审计和部署目录，总Core模块与单独模块不重复登记Controller。标准HTTP从所选Core贡献生成，未知政策拒绝；staff/client沿各自正式授权，不按operator使用权直接放行。[统一装配](平台Core接入-开发记录.md#core-application-assembly-20261115) · [HTTP政策](平台Core接入-开发记录.md#core-http-policy-registration-20261115)
4. 生命周期仍须实际核租户授权、成员分配、原绑定/初始化、停新、排空和代码移除。当前授权结果与随后读取错误分开，unknown只读原键；撤权先取消旧请求、清除目标Core缓存。Core绑定/当前范围/实际就绪分别读取，跨事务不逆序持父锁。移除预检clear不执行删除，缺业务/AI/回调/作业/历史依赖证据不得移除。[结果读取/缓存](平台Core接入-开发记录.md#core-access-refresh-receipt-20261115) · [范围/就绪](平台Core接入-开发记录.md#core-scope-readiness-20261115) · [移除预检](平台Core接入-开发记录.md#core-removal-preflight-20261115) · [工单移除依赖](平台Core接入-开发记录.md#core-tickets-removal-data-20261115)
5. 实际安装/部署消费同一固定标准包和版本锁；源码目录缺标准清单须拒绝。迁移prepare仍pending，不写成功账或执行DDL。工单旧绑定/初始化版保持可读，普通准入核完整迁移/物理库；普通更新拒绝租户/容器范围转换及容器类型改名，改变范围须专门迁移。[包与命令](平台Core接入-开发记录.md#core-package-current-cli-20261115) · [原绑定兼容](平台Core接入-开发记录.md#core-tickets-binding-readability-20261115) · [更新范围](平台Core接入-开发记录.md#core-update-scope-compatibility-20261115)
6. 继续按原03/04→05/06及07固定上下文→08推进；09消费稳定的正式业务接点，不等待AI Native全项完成。AI行业reader/工具/执行者和通用Runtime分离，保留唯一Gateway、财务预算单账、独立任务资源、批准和原收据/恢复。缺真实依赖保持不可用，不能靠全部关闭或恒真替身验收。[AI并行边界](平台Core接入-开发任务.md#ai-parallel-boundary)
7. 后台仍须浏览器核完整外壳、直接URL、当前权限、中英文/窄窗口、主按钮动态清理、Portal/回车/离页、单次提交、分页及迟到响应。只改Core和受控装配完成样例扩展，不复制壳/样式或自写网络层。[表单](平台Core接入-开发记录.md#core-form-submission-20261115) · [详情](平台Core接入-开发记录.md#core-tickets-detail-actions-20261115) · [列表分页](平台Core接入-开发记录.md#core-list-pagination-20261115)
8. GitHub固定Release/仓库清单/多Core索引/Topic查询已有共用准备链，发现和安装管理UI、真实远端获取与实际部署仍未完成。无网络不阻断已安装Core，来源/许可/兼容、仅源码/可安装、待部署和运行版本分别显示。[固定仓库索引](平台Core接入-开发记录.md#core-github-repository-20261115) · [Topic](平台Core接入-开发记录.md#core-github-discovery-20261114)
9. 10～12仍缺干净宿主安装→注册→授权/分配→持久化业务、多真实Core/同ID隔离/停用恢复、无Core真实运行、独立Agent接手、底座与Core分别升级/回退、配置/定制/数据保留及独立审查。按完整功能清单汇集前后证据，代码合并/版本预检不证明实际升级恢复。[五步指南](平台Core接入-开发任务.md#core-quick-start) · [Agent模板](平台Core接入-开发任务.md#core-agent-template)

## 4. 源码与接入资料

每片同步实际源码职责、复杂事务/历史原因、模块导读、正式API资料及接入步骤。开发Agent从[统一能力查询](../../../packages/core-contracts/README.md#找到平台已有的功能)定位正式导入、页面/API及源码；动态登记、完整API字段、六个未检出应用/客户端和用途说明缺口仍须处理，索引issues=0不代表全部源码规范化。[覆盖/部署快照](平台Core接入-开发记录.md#core-index-deployment-snapshot-20261115) · [源码导读](平台Core接入-开发记录.md#core-source-reading-20261115)

只做对应改动的必要测试，复用既有用例与短stdin，不新增成批脚本，不删断言、skip/todo或放宽权限。原四册维护，记录放完整阶段证据，任务只更新跨档进度，接续覆盖当前现场。本次负责人已明确允许RD/dev1持续单点协作，结果和必要冲突写原记录；PM按规则读取，不主动群发或重复通知。其他Rental品类治理、AI Native、MCP/Harness和Runtime/SDK专项仍按各自正式依据核收，不重派或继承进度。

## 5. 验证边界与保留问题

当前日历切片一次定向Nest冒烟和公共/原API类型均退出0，原服务11方法/Controller5方法可执行正文保持；七份实际迁移摘要和31表计划核对通过，source/事务/身份为明确fixture，没有数据库客户端或网络。初次装载/枚举与查询字典类型问题已修，记录保留失败原因。JSON固定阶段的四份原冒烟和定向类型由dev1交付，未重复执行；其公共页面组继续统一固化。原主/业务HTTP完整类型和冒烟证据保留，整体合同614项问题及未执行的链式后续检查仍需处理。共享迁入129路径无缺失，旧树已移除；原文/完整旧接续由48a52786保全。[当前日历证据](平台Core接入-开发记录.md#core-public-official-calendars-20261118) · [JSON证据](平台Core接入-开发记录.md#core-public-integration-json-20261118) · [主/业务HTTP证据](平台Core接入-开发记录.md#core-rental-main-http-20261118) · [迁入证据](平台Core接入-开发记录.md#core-shared-dev1-migration-20261118) · [原HTTP证据](平台Core接入-开发记录.md#core-rental-http-entry-20261118)

当前批准链78个方法正文保留，原42/42批准、续租和换货冒烟及十配置类型通过，未新增永久测试脚本。首轮31个端口类型诊断、42例的15/27、37/5和39/3失败及两处实际调用问题保留在当前记录；未放宽原有效断言。原主线片19个方法、101/101工作流、通知/委托原读取writes=0及七配置前端0诊断沿固定证据保留，后台兼容出口及此前3679诊断也可追溯。SQL/锁/事务/身份/资金/存储仍为明确fixture，真实HTTP/数据库/浏览器/微信、完整Nest宿主/安装/更新、独立接手及审查未验。申请/任务、恢复/资金、原创建/草稿及日历PROVIDER_UNAVAILABLE旧问题均沿原记录承接。当前worker已退出，本片输出留内存，没有新增临时环境或业务服务。[当前批准证据](平台Core接入-开发记录.md#core-rental-enterprise-approval-runtime-20261117) · [原主线证据](平台Core接入-开发记录.md#core-main-notification-sync-20261117) · [申请/任务](平台Core接入-开发记录.md#core-rental-enterprise-workflow-runtime-20261117) · [恢复/收款](平台Core接入-开发记录.md#core-rental-recovery-payments-20261117)

未经进一步授权，不安装依赖、读.env、启真实服务、访问业务HTTP/DB/模型/供应商、执行迁移、合main或发布。中文提交到当前任务分支、普通推送后读取实际远端。正式需求/任务与已应用历史迁移保持，旧原文优先引用固定Git。

旧公共宿主临时环境已归集到 D:/工作文件/rental-OS/output/.cleanup-pending/pch-preparation/platform-host-integration/environment，840文件/91,808,304字节，责任清单为同任务manifest.json。另一个原任务目录rental-business-facts/residual仍有1个0字节guard.log及原责任清单。2026-11-17原生PowerShell删除命令仍被自动审批在启动前以blocked by policy拒绝，命令内预检查也未执行；原文件数/体积及0链接已有只读证据，当前没有使用旧环境的任务进程，两份清单最近尝试时间为2026-11-17T15:47:41.734Z，本次另行只读核实文件数/体积和0链接。没有换壳/工具绕过，工具恢复后由本会话优先处理，不能称已释放空间。[当前清理尝试](平台Core接入-开发记录.md#core-rental-enterprise-approval-runtime-20261117) · [原清理证据](平台Core接入-开发记录.md#core-rental-recovery-receipts-20261116)

旧外观测试17例16过/1个静态失败、总导航三份历史附件及MCP导读五个原隔离附件缺失继续保留；近期全局文档检查的稀疏未检目标须按固定Git定位，不删除引用或修改检查器掩盖。原授权/生成/MCP检查的审批拒绝历史保留，后来定向补证不能冒称完整宿主验收。[当前MCP审计](平台Core接入-开发记录.md#core-original-mcp-audit-20261115) · [导读缺链](平台Core接入-开发记录.md#core-rental-capability-runtime-20261116)

初版与两轮原文分别见[方案基线](历史归档/方案基线/2026-10-31/README.md)、[初次前像](历史归档/需求澄清/2026-11-09/manifest.json)、[第二轮前像](历史归档/需求澄清/2026-11-09/第二轮补充前/manifest.json)。旧未知产物/恢复资料与他人成果不纳入本任务清理。
