# 平台 Core 接入当前协作接续

更新时间：2026-11-18。

> 负责人已授权RD统一调配dev1、dev2，三人共用本树持续完成PCH-01～12；冲突由RD核定来源和唯一写入者，Git索引、提交推送和PCH四册由RD统一负责。无Core独立运行、完整Rental标准包及全功能验收仍未完成。正式依据为[需求v1.5](平台Core接入-需求.md)与[开发任务v1.5](平台Core接入-开发任务.md)，进度只由原G1～G4门槛核收。

## 1. 当前目标与施工范围

建设对开发者和开发AI友好的AI Native SaaS底座。没有Core也能启动、登录、维护公共设置并使用完整后台外壳；没有Core不开放通用Agent任务。侧栏、内容容器、面包屑/页名整行、铃铛、休息和面板收展归底座，Core声明自己的路由、页面、主操作和数据方法，复用原React/UIArc、表单/列表与请求反馈。[声明式页面合同](平台Core接入-开发任务.md#declarative-page-contract)

开发者受控注册Core→SaaS管理员授权租户→租户管理员分配成员→按业务角色和范围使用。同部署、同租户多Core并存，新Core不默认分配全员。Core共用租户订阅期限，分别开通/停用；停用保留配置、数据、原绑定和收据，重开核当前条件，不重复初始化或重放。续费不恢复主动停用、成员撤权或账号冻结。各Core自定义业务分区；客户等其他audience沿原专用授权，历史/在途/unknown按原权限收尾。

Core的AI工具可选，缺工具时普通后台仍可用，Agent不能访问该Core。未来跨Core协作通过明确对象引用/接口/事件实现，本期不开放共享业务表或隐含读权。先交标准本地包，再接固定GitHub Release获取及Topic发现；底座与Core分别更新，保留下游业务、配置、数据和授权。[包标准](平台Core接入-开发任务.md#core-package-standard) · [独立更新](平台Core接入-开发任务.md#independent-upgrades)

唯一施工树为 C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS，分支 codex/platform-core-extraction。本树由RD、dev1、dev2按文件分工写入；允许修改PCH所需Auth/Guard/ALS、正式包出口、主装配/OpenAPI、schema/迁移/Seed与后台外壳。main索引和其他树仍归其作者。当天真实远端main为7cf0c4c0401203707fd44f1b3841f3e306264629，已核其25路径与原在制差异没有交叉；九处冲突由RD将主线补片移到公共单源、保留旧转接与两侧记录，当前正在收口合并。公共/零Core/原管理后台类型通过，主线音效、咖啡图标及顶栏读取顺序沿同一实现。[主线公共壳证据](平台Core接入-开发记录.md#core-main-public-shell-20261118) · [此前主线AI接点](平台Core接入-开发记录.md#core-main-ai-delivery-20261118)

负责人已将 `[Saas 底座]-dev1` 迁入共享施工，原成果与未完检查点均已保全并迁入；旧树目录及Git登记已移除，源分支留存。Git索引、提交/推送、四册和主装配由RD统一负责，dev1按约定文件边界持续抽取公共能力，实际冲突直接协商。其他对话的模型及推理设置只由负责人修改，RD及助手均不得调整；不为发送消息填写这些设置参数。负责人要求关闭电脑操作造成的黄色边框，三人须结束各自已开启的computer-use会话，不再通过桌面界面发送协作消息或操作聊天设置。当前消息接口参数校验失败，RD停用该入口；作者从本接续和固定提交读取文件窗口及具体依赖。attach_worktree的UI归属关联仍未核定，双方所有命令均显式指定本节唯一共享路径。[迁入与共享证据](平台Core接入-开发记录.md#core-shared-dev1-migration-20261118)

渠道合同/请求类、客户端/官网/微信配置三服务及三Controller已单源迁入，原HTTP别名复用同一实例；必要类型及两段原保存/DTO/凭证/Nest冒烟通过，固定版本由[渠道阶段](平台Core接入-开发记录.md#core-rental-client-channels-20261118)定位。会员应用57方法及三个辅助函数已迁入Rental，原provider供给同一客户/注册/风险/企业政策；四根1890源类型和一次同源类/风险/权限冒烟通过，客户状态仓储、门户授权、会员34个HTTP操作与17请求类也已迁入；五根1903源类型及一次原门户收据/状态CAS/同实例Nest/DTO冒烟通过。客户治理、合并/注销检查、经营分析及头像已单源迁入，原Nest接线复用同一服务；企业客户治理与结算应用继续，原状态/权限及收据保持。[客户治理阶段](平台Core接入-开发记录.md#core-rental-customer-governance-20261118)[会员HTTP/状态阶段](平台Core接入-开发记录.md#core-rental-membership-http-state-20261118) · [会员应用阶段](平台Core接入-开发记录.md#core-rental-membership-application-20261118) 当前Rental主/业务、空间能力、员工收款及四个企业Controller已持有包内单源实现；企业HTTP固定2a7462312d1912995b37fd670cfda61e730d9878已普通推送并回读。客户HTTP与认证/注册已迁入，继续Staff、剩余客户渠道与文件参加者，再形成标准主装配与数据/迁移/Seed。费用批准/商户委托、工作流、客户主档/会员、资格、恢复/收款和品类采用的实现及未解决事项引用原阶段记录，原行为、事务、原操作与收据沿固定证据保护。[主/业务HTTP](平台Core接入-开发记录.md#core-rental-main-http-20261118) · [企业HTTP](平台Core接入-开发记录.md#core-rental-enterprise-http-20261118) · [批准链](平台Core接入-开发记录.md#core-rental-enterprise-approval-runtime-20261117) · [工作流](平台Core接入-开发记录.md#core-rental-enterprise-workflow-runtime-20261117) · [客户主档](平台Core接入-开发记录.md#core-rental-customer-master-20261117) · [政策/成员](平台Core接入-开发记录.md#core-rental-enterprise-policy-members-20261117) · [企业读取](平台Core接入-开发记录.md#core-rental-enterprise-reads-20261117) · [恢复/收款](平台Core接入-开发记录.md#core-rental-recovery-payments-20261117) · [采用闭包](平台Core接入-开发记录.md#core-rental-category-adoption-20261117)

公共创建/回执/续签、33公共模型/八迁移/0.1.4数据计划及配置围栏已在768716af上传，cleanup/download已在3ce760ce6212164d018b273dbbae25c46e957594上传并真实远端回读。公共应用、正式/files出口、三步说明及Staff真实参加者已接原Runtime五组场景，类型和一次原消费者冒烟通过。AppModule以RENTAL_FILE_AUTHORITY窄token延迟取原Auth，主体锁先于配置锁；缺真实权威的受控staff tuple失败关闭，其他旧合法module/scene和不匹配历史沿原真实兼容编排。dev1两路径已停写，继续Rental私有文件适配；RD继续客户服务/HTTP和标准装配。共同出口、主装配、schema和四册仍由RD负责。[公共应用/Staff](平台Core接入-开发记录.md#core-public-file-application-staff-20261118) · [清理/下载](平台Core接入-开发记录.md#core-public-file-cleanup-download-20261118) · [创建/数据/围栏](平台Core接入-开发记录.md#core-public-file-upload-data-20261118) · [公共工具](平台Core接入-开发记录.md#core-public-tools-20261118) · [组织/安全](平台Core接入-开发记录.md#core-public-organizations-security-20261118)

客户地址/交付快照、本人注销及精确配送区域已迁入Rental包，原17个正文、9根/1855源类型和一次实际兼容类冒烟通过。客户业务应用及目录字段也已单源迁入，原95方法/18实例顺序保持，检查费用响应通过原同事务出箱；6根/1857源类型及本人订单/回放/付款和出箱冒烟通过。Staff权威和地点函数已入Rental私有包，沿正式出口的AppModule单根2354源0诊断，原Staff五组场景通过。以上已在19d36232c352a07318f73e0a22f4b2ba692aa1d0普通推送并实际远端回读。换货专用影像六个公开方法及两个私有检查已归Rental，原Runtime只委托同一实现；原目标恢复、TTL保留和同事务CAS冒烟通过，正式子出口解析/加载也已补核。客户Controller、Auth/统一注册、限流及官网图片已成为Rental单源；实际AppModule/providers共7根/2370源0诊断，两原消费者及补充会话/HTTP冒烟通过。Staff认证/附件HTTP及共用DTO已完成，原7+5路径、staff身份与五组场景沿实际Nest容器/原消费者冒烟核验。客户与Staff本片一起收口，固定版本由对应记录定位；dev1继续企业凭证/Staff观察/检查字节读取私有适配，RD继续渠道与标准数据装配，共同出口、AppModule、索引/四册由RD维护。[员工HTTP证据](平台Core接入-开发记录.md#core-rental-staff-http-20261118)[客户认证/HTTP证据](平台Core接入-开发记录.md#core-rental-client-auth-http-20261118)[专用影像证据](平台Core接入-开发记录.md#core-rental-private-exchange-files-20261118) · [客户应用/Staff私有证据](平台Core接入-开发记录.md#core-rental-client-application-20261118) · [客户地址/注销](平台Core接入-开发记录.md#core-rental-client-address-closure-20261118)

## 2. 已有实际接点

| 模块 | 当前实现及证据入口 |
| --- | --- |
| 公共合同/服务与无Core API | [platform-contracts](../../../packages/platform-contracts/README.md)、[platform-server](../../../packages/platform-server/README.md)、[platform-api](../../../apps/platform-api/README.md)持有认证、会话、外观、初始化、租户/人员角色、订阅、集成与官方来源公共HTTP；35公共模型/九迁移/0.1.5计划已提供，当前核摘要/结构及待部署组合，没有执行迁移。文件与通知各两表归公共，业务文件HTTP仍须真实权威；适配日志复用公共集成表。原API窄转接同一实现，原组合schema/历史迁移保留。[公共宿主](平台Core接入-开发记录.md#core-public-host-packages-20261115) · [文件数据](平台Core接入-开发记录.md#core-public-file-upload-data-20261118) · [通知数据](平台Core接入-开发记录.md#core-public-notification-ledger-20261118) |
| 标准Core宿主 | [core-contracts](../../../packages/core-contracts/README.md)、core-host与[platform-core-host](../../../packages/platform-core-host/README.md)提供正式清单、授权/分配、绑定/原收据、本人目录、范围/就绪、HTTP政策和移除预检。独立公共主装配消费同源Guard/OpenAPI，原Rental总装配仍需迁移。[公共主接点](平台Core接入-开发记录.md#core-public-assembly-20261115) |
| 期限与实际数据观察 | 公共统一订阅期限reader、固定公共SQL/结构检查、工单实际物理reader及原Prisma账已提供，目录/升级预检消费真实证据接点。当前数据库/迁移尚未实际执行，清单不能补成功。[期限/公共数据](平台Core接入-开发记录.md#core-public-data-term-20261115) · [工单物理与原账](平台Core接入-开发记录.md#core-mysql-data-observation-20261115) |
| 公共后台 | [platform-admin](../../../packages/platform-admin/README.md)持有原外壳/UIArc、主题/语言/音效、通知/休息/面板、页面/表单/列表和稳定会话/请求/缓存端口；[零Core Web](../../../apps/platform-admin/README.md)与[工单Web](../../../apps/example-tickets-admin/README.md)复用同一应用工厂。Core目录/授权、租户/人员角色、本人安全及组织/安全/订阅/集成已接公共页面。[目录](平台Core接入-开发记录.md#core-access-directory-ui-20261115) · [人员角色](平台Core接入-开发记录.md#core-public-access-pages-20261115) · [租户页面](平台Core接入-开发记录.md#core-public-tenant-pages-20261115) · [恢复口令/角色删除](平台Core接入-开发记录.md#core-public-access-actions-20261115) · [本人安全](平台Core接入-开发记录.md#core-public-self-security-20261115) · [组织/安全](平台Core接入-开发记录.md#core-public-organizations-security-20261118) |
| 公共工具与文件边界 | [字典/编号](../../../packages/platform-server/src/modules/platform-tools/README.md)与[同源页面](../../../packages/platform-admin/src/features/platform-tools/README.md)已接公共/原宿主，公共缺省与Rental默认分开，规则/取号同事务。[公共文件应用](../../../packages/platform-server/src/modules/files/README.md#core-接入)已提供正式入口、事务/权威合同及三步说明，原Staff五组场景实际消费；[Rental附件ACL](../../../packages/rental-core/src/file-access.ts)、原键/冻结/清理/下载及配置围栏保持单源。其他audience与私有Core装配继续交付。[应用/Staff](平台Core接入-开发记录.md#core-public-file-application-staff-20261118) · [文件数据/围栏](平台Core接入-开发记录.md#core-public-file-upload-data-20261118) |
| 非租赁示范 | [工单Core](../../../packages/example-tickets-core/README.md)有独立领域/MySQL迁移、8条业务HTTP政策、原收据与四页声明。API/Web共用标准包与版本锁核验、公共数据库和权限；所选权限登记只写元数据，不授予角色或Core。[独立宿主](平台Core接入-开发记录.md#core-tickets-independent-host-20261115) · [权限登记](平台Core接入-开发记录.md#core-permission-registration-20261115) |
| Rental包与兼容入口 | [rental-core](../../../packages/rental-core/README.md)已持有原主核心与报价/营销聚合、订单确认/商户委托、配货/办理锁/自动扫描、工作台/经营报表/到期作业、换货试算/检查准备/专用影像/客户同意与批准执行/不可变凭证及经营空间边界、配置与业务请求DTO、合同、品类解析/身份、计价/器材、能力/审计/实例、恢复快照/原收据、业务动作事务和核心/业务配置，以及订单/资产/库存/处置/工单/检查/续租换货及报价/券/奖励/通知事实。原shared/API消费同一实现；资金事实/门禁与原事件、企业应收/原回款收据、服务容量、原批准/检查同意、检查/换货/续租及服务规则也成为包内单源，完整服务/数据/页面/作业/AI和标准主装配继续迁移。[原业务导读](../../../apps/api/src/modules/rental-core/README.md) · [核心事实阶段](平台Core接入-开发记录.md#core-rental-core-facts-20261116) |

以上已有类型、静态、内存构建、实际Nest容器或离线行为证据，具体层级从各阶段记录读取。它们不代表浏览器、真实HTTP/数据库、完整安装或正式验收通过。

## 3. 下一实施入口与未完项

1. 继续完成Rental独立包。核心/报价营销、配置与业务请求DTO、订单确认/批准/商户委托、配货/办理锁/自动扫描、工作台/经营报表/到期作业、具体检查同意/批准执行、规则/日历绑定草稿、批准设置、品类草稿/发布/开通政策、采用准备/最终提交及经营空间边界已单源迁入；事实/配置/恢复/收据、资金/容量/企业核销及原冻结规则也有正式出口。企业政策、邀请/成员及管理员交接、申请/管理请求/任务中心、行政交接及成员审计已完成单源迁移，费用批准/委托已完成单源迁移，主/企业/客户HTTP已迁入，渠道配置、会员与门户HTTP及客户状态仓储已单源迁入，客户治理/合并、经营分析与头像已单源迁入，原同一实例、49项正文及必要类型/冒烟见[客户治理阶段](平台Core接入-开发记录.md#core-rental-customer-governance-20261118)；继续企业客户治理/结算及文件参加者，再形成标准Core装配、schema/迁移/Seed、页面/客户端、其余作业/回调及AI接点。客户主档/会员唯一写入、企业政策与资格由Rental包提供，会员/门户应用与客户状态仓储已归Rental，客户治理/合并已供给同一主档/状态写入者与原注销检查；企业治理/结算、文件与原Auth仍须实际参加者，不能以空适配替代；保留原权限码、标识、金额、锁、事务、幂等和历史依据，事件/作业只有一个执行者。[完整兼容清单](平台Core接入-开发记录.md#core-ownership-baseline-20261114) · [原主核心](平台Core接入-开发记录.md#core-rental-core-facts-20261116) · [确认/委托](平台Core接入-开发记录.md#core-rental-order-confirmation-20261116) · [配货/扫描](平台Core接入-开发记录.md#core-rental-allocation-runtime-20261116)
2. 文件创建/回执、冻结、清理/下载、完整Rental兼容编排及Staff/企业专用参加者已单源接入，公共DTO与原HTTP复用同一数据库、当前身份及原服务别名。公共文件台账已在f9d3233bfa0622193f079ef9ca65bfa6f6202170普通推送并回读，RD已补/files正式出口、原类型闭包及API/简单说明，本阶段由[文件台账记录](平台Core接入-开发记录.md#core-public-file-ledger-20261118)固定；公共原操作请求、引用与主按钮定位已在9c5ddeef527cfff65fec715b494e73395ee10917普通推送并回读。[公共接点](平台Core接入-开发记录.md#core-public-order-operation-boundary-20261118)

   通知五项合同与公共台账已从platform-contracts/notifications及platform-server/notifications单源提供，原集成五个服务/六个仓储方法已委托；作者固定五路径及必要冒烟/声明结果，RD补35模型/九迁移、正式出口与三步接入并收口。原业务消息/默认模板由Rental宿主提供，新默认模板按租户派生主键，已有ID保持；模拟登记不当真实发送。[当前固定通知片](平台Core接入-开发记录.md#core-public-notification-ledger-20261118)

   dev1已在packages/platform-server/src/modules/jobs下完成公共JobLedgerApplication/Repository及窄存储端口，原当前租户、字段、queued事实和随后日志失败的冒烟通过。下一依赖是RD将AsyncJobSummary/CreateAsyncJobRequest从原shared单源迁入公共/jobs合同并登记服务正式出口；随后释放原integrations的listJobs/createJob委托窗口。通知固定五路径暂不再写；schema、主装配和其余设备/导入导出/打印由RD维护，runJob沿原唯一执行者，不建立第二套调度器或替代AI Runtime。优先真实调用方与一次必要冒烟，不新增成批脚本。

   文件仍保留原合法module/scene与历史记录兼容，知识ACL/清理收据由原AI参加者提供，实名/承运/检查/企业证据沿真实Rental裁定；unknown只核原键和目标，不因TTL重传。计时器与租户发现只有原宿主一份，当前35模型/九迁移不开放零Core通用上传HTTP。Staff五组真实参加者、主体锁早于配置锁以及四项原服务useExisting别名继续复用。[Staff接入](平台Core接入-开发记录.md#core-public-file-application-staff-20261118) · [完整文件运行时](平台Core接入-开发记录.md#core-rental-file-runtime-20261118) · [文件HTTP](平台Core接入-开发记录.md#core-rental-files-http-20261118)

   dev2继续订单列表/详情及最小业务闭包到packages/rental-core/admin/orders。四个正式出口、统一Rental页面贡献与同源导航当前在制，原api/rentalCore.ts养护十二方法保留；nav/AppRouter和包配置由RD维护。旧宿主已消费runtime.request的retryAuthentication:false与/forms原引用库；CorePage用data-core-page=当前page.key、data-core-action=原action.id标记获权入口，深链接只定位/聚焦，禁用原因仍可读取。原service-execution直接读取引用算法须定位公共operation-reference.ts并保留断言。当前订单固定后继续原新建订单及必要选择/校验闭包，旧URL、当前权限、金额、原键/历史和异步编辑代次保持；不复制壳、样式或第二套请求。[当前订单源码](../../../packages/rental-core/admin/orders/README.md) · [已固定养护](平台Core接入-开发记录.md#core-public-record-kanban-work-orders-20261118)

3. 完成原Rental主AppModule/Guard与各audience接线。主provider通过明确imports/exports供给同一数据库、人员、订阅、审计和部署目录，总Core模块与单独模块不重复登记Controller。标准HTTP从所选Core贡献生成，未知政策拒绝；staff/client沿各自正式授权，不按operator使用权直接放行。[统一装配](平台Core接入-开发记录.md#core-application-assembly-20261115) · [HTTP政策](平台Core接入-开发记录.md#core-http-policy-registration-20261115)
4. 生命周期仍须实际核租户授权、成员分配、原绑定/初始化、停新、排空和代码移除。当前授权结果与随后读取错误分开，unknown只读原键；撤权先取消旧请求、清除目标Core缓存。Core绑定/当前范围/实际就绪分别读取，跨事务不逆序持父锁。移除预检clear不执行删除，缺业务/AI/回调/作业/历史依赖证据不得移除。[结果读取/缓存](平台Core接入-开发记录.md#core-access-refresh-receipt-20261115) · [范围/就绪](平台Core接入-开发记录.md#core-scope-readiness-20261115) · [移除预检](平台Core接入-开发记录.md#core-removal-preflight-20261115) · [工单移除依赖](平台Core接入-开发记录.md#core-tickets-removal-data-20261115)
5. 实际安装/部署消费同一固定标准包和版本锁；源码目录缺标准清单须拒绝。迁移prepare仍pending，不写成功账或执行DDL。工单旧绑定/初始化版保持可读，普通准入核完整迁移/物理库；普通更新拒绝租户/容器范围转换及容器类型改名，改变范围须专门迁移。[包与命令](平台Core接入-开发记录.md#core-package-current-cli-20261115) · [原绑定兼容](平台Core接入-开发记录.md#core-tickets-binding-readability-20261115) · [更新范围](平台Core接入-开发记录.md#core-update-scope-compatibility-20261115)
6. 继续按原03/04→05/06及07固定上下文→08推进；09消费稳定的正式业务接点，不等待AI Native全项完成。AI行业reader/工具/执行者和通用Runtime分离，保留唯一Gateway、财务预算单账、独立任务资源、批准和原收据/恢复。缺真实依赖保持不可用，不能靠全部关闭或恒真替身验收。[AI并行边界](平台Core接入-开发任务.md#ai-parallel-boundary)
7. 后台仍须浏览器核完整外壳、直接URL、当前权限、中英文/窄窗口、主按钮动态清理、Portal/回车/离页、单次提交、分页及迟到响应。只改Core和受控装配完成样例扩展，不复制壳/样式或自写网络层。[表单](平台Core接入-开发记录.md#core-form-submission-20261115) · [详情](平台Core接入-开发记录.md#core-tickets-detail-actions-20261115) · [列表分页](平台Core接入-开发记录.md#core-list-pagination-20261115)
8. GitHub固定Release/仓库清单/多Core索引/Topic查询已有共用准备链，发现和安装管理UI、真实远端获取与实际部署仍未完成。无网络不阻断已安装Core，来源/许可/兼容、仅源码/可安装、待部署和运行版本分别显示。[固定仓库索引](平台Core接入-开发记录.md#core-github-repository-20261115) · [Topic](平台Core接入-开发记录.md#core-github-discovery-20261114)
9. 10～12仍缺干净宿主安装→注册→授权/分配→持久化业务、多真实Core/同ID隔离/停用恢复、无Core真实运行、独立Agent接手、底座与Core分别升级/回退、配置/定制/数据保留及独立审查。按完整功能清单汇集前后证据，代码合并/版本预检不证明实际升级恢复。[五步指南](平台Core接入-开发任务.md#core-quick-start) · [Agent模板](平台Core接入-开发任务.md#core-agent-template)

## 4. 源码与接入资料

每片同步实际源码职责、复杂事务/历史原因、模块导读、正式API资料及接入步骤。开发Agent从[统一能力查询](../../../packages/core-contracts/README.md#找到平台已有的功能)定位正式导入、页面/API及源码；动态登记、完整API字段、六个未检出应用/客户端和用途说明缺口仍须处理，索引issues=0不代表全部源码规范化。[覆盖/部署快照](平台Core接入-开发记录.md#core-index-deployment-snapshot-20261115) · [源码导读](平台Core接入-开发记录.md#core-source-reading-20261115)

只做对应改动的必要测试，复用既有用例与短stdin，不新增成批脚本，不删断言、skip/todo或放宽权限。原四册维护，记录放完整阶段证据，任务只更新跨档进度，接续覆盖当前现场。本次负责人已明确允许RD/dev1/dev2按任务持续单点协作，结果和必要冲突写原记录；PM按规则读取，不主动群发或重复通知。其他Rental品类治理、AI Native、MCP/Harness和Runtime/SDK专项仍按各自正式依据核收，不重派或继承进度。

## 5. 验证边界与保留问题

最新main的公共补片已通过工作区必要类型与一次原音效/密度冒烟，六份TS/TSX正文及咖啡源码与固定main一致。40px选择轨道及同一顶栏时间沿主线保全，后台规则中36px轨道/单独时间行的描述仍须核统一依据，不能以搬迁宣称实页或规范验收。当前Node会话没有开启桌面捕获，其他旧computer-use会话的释放未取得证据。[主线公共壳](平台Core接入-开发记录.md#core-main-public-shell-20261118)

通知SDK沿作者正式声明/下游零诊断与一次原消费者冒烟收口。RD公共数据进程43776退出0，官方Prisma核35模型/14枚举，实际计划核35表/367列/92索引/7CHECK/29外键；15次明确物理库fixture查询核正常/缺列/错误外键，摘要变化和未知DDL拒绝，零Core产生12份内存待部署文件。未执行迁移或真实服务，通知HTTP在独立宿主的接线继续；六份资料1272本地链接/178锚点0问题。[本片证据](平台Core接入-开发记录.md#core-public-notification-ledger-20261118)

客户应用6根/1857源及Staff正式AppModule单根2354源0诊断，两者均用当前238/33模型官方内存声明。客户原5用例、18实例顺序、同事务检查出箱失败回滚及Staff五场景冒烟通过；数据库、事务/Auth lease及对象传输仍为明确fixture，没有真实HTTP/数据库/对象服务或完整Nest运行验收。原95个客户方法只有出箱一行转为实际宿主回调，Staff12方法、地点函数和Runtime正文保持。客户测试仅修继承后的同源方法定位，不删除原调用/行为断言，新增永久测试脚本0。[客户应用/Staff证据](平台Core接入-开发记录.md#core-rental-client-application-20261118)

公共应用/Staff最终两根/1858源0诊断，原Runtime/Staff五组create/complete/download及原回执、历史、权限/地点/会话拒绝、同事务回滚和单次PUT unknown恢复冒烟通过；RD实际延迟factory与其余37方法AST核对通过。ModuleRef/Auth、数据库/锁及对象传输为明确fixture，没有完整Nest宿主或真实服务验收。创建/回执、cleanup/download、33模型/迁移准备及配置围栏的同片通过证据继续复用，不重复知识全套。原知识2/6、19!==20列计数、旧计数/TTL、回执metadata和stdin fixture失败及更正原因在原阶段保留。公共工具、组织/安全及集成/日历/JSON沿固定证据复用。完整旧接续由3ce760ce保全，具体命令见原记录。[应用/Staff](平台Core接入-开发记录.md#core-public-file-application-staff-20261118) · [清理/下载](平台Core接入-开发记录.md#core-public-file-cleanup-download-20261118) · [文件数据/围栏](平台Core接入-开发记录.md#core-public-file-upload-data-20261118) · [工具](平台Core接入-开发记录.md#core-public-tools-20261118) · [原HTTP614项问题](平台Core接入-开发记录.md#core-rental-http-entry-20261118)

当前批准链78个方法正文保留，原42/42批准、续租和换货冒烟及十配置类型通过，未新增永久测试脚本。首轮31个端口类型诊断、42例的15/27、37/5和39/3失败及两处实际调用问题保留在当前记录；未放宽原有效断言。原主线片19个方法、101/101工作流、通知/委托原读取writes=0及七配置前端0诊断沿固定证据保留，后台兼容出口及此前3679诊断也可追溯。SQL/锁/事务/身份/资金/存储仍为明确fixture，真实HTTP/数据库/浏览器/微信、完整Nest宿主/安装/更新、独立接手及审查未验。申请/任务、恢复/资金、原创建/草稿及日历PROVIDER_UNAVAILABLE旧问题均沿原记录承接。当前worker已退出，本片输出留内存，没有新增临时环境或业务服务。[当前批准证据](平台Core接入-开发记录.md#core-rental-enterprise-approval-runtime-20261117) · [原主线证据](平台Core接入-开发记录.md#core-main-notification-sync-20261117) · [申请/任务](平台Core接入-开发记录.md#core-rental-enterprise-workflow-runtime-20261117) · [恢复/收款](平台Core接入-开发记录.md#core-rental-recovery-payments-20261117)

未经进一步授权，不安装依赖、读.env、启真实服务、访问业务HTTP/DB/模型/供应商、执行迁移、合main或发布。中文提交到当前任务分支、普通推送后读取实际远端。正式需求/任务与已应用历史迁移保持，旧原文优先引用固定Git。

旧公共宿主临时环境已归集到 D:/工作文件/rental-OS/output/.cleanup-pending/pch-preparation/platform-host-integration/environment，840文件/91,808,304字节，责任清单为同任务manifest.json。另一个原任务目录rental-business-facts/residual仍有1个0字节guard.log及原责任清单。2026-11-18再次使用原生PowerShell删除，仍被自动审批在创建进程前以blocked by policy拒绝，命令内进程/路径复验没有执行。此前同一原生入口已实际只读核840文件/91,808,304字节、1文件/0字节及两处0链接；本片所有验证worker已退出，没有使用旧环境。两份责任清单最近尝试时间为2026-11-18T11:02:22.523Z，状态仍为已归集、删除受阻。没有换壳/工具绕过，工具恢复后由本会话优先处理，不能称已释放空间。[当前清理尝试](平台Core接入-开发记录.md#core-rental-files-http-20261118) · [原清理证据](平台Core接入-开发记录.md#core-rental-recovery-receipts-20261116)

dev2订单列表/详情已固定，作者对照原冻结源码的66组行操作、930个单元格及两种表格呈现，原检查/影像消费者6/6、请求兼容8/8和17个导读链接通过。RD已核constructor回退属于抽取时遗漏原词条检查的新增回归，公共函数已恢复；一次原翻译区段冒烟及单根197源类型通过，dev2标准完整列表复验退出0，原三个断言保留。[翻译修复](平台Core接入-开发记录.md#core-public-locale-compatibility-20261118) 原间距4px问题已定位固定main的pageTop=0与contextOpticalInset=var(--space-1)，规范3.3/3.4保持。dev2继续在约定业务路径迁移新建订单与服务端报价/客户委托闭包，通知/公共数据及Git索引仍由RD负责。

旧外观测试17例16过/1个静态失败及MCP导读五个原隔离附件缺失继续保留。总导航原三份历史附件入口已由本日固定main改为删除前Git引用，本轮仅核当前导航，未再运行全局CLI。稀疏未检目标须按固定Git定位，不删除引用或修改检查器掩盖。原授权/生成/MCP检查的审批拒绝历史保留，后来定向补证不能冒称完整宿主验收。[当前MCP审计](平台Core接入-开发记录.md#core-original-mcp-audit-20261115) · [导读缺链](平台Core接入-开发记录.md#core-rental-capability-runtime-20261116)

初版与两轮原文分别见[方案基线](历史归档/方案基线/2026-10-31/README.md)、[初次前像](历史归档/需求澄清/2026-11-09/manifest.json)、[第二轮前像](历史归档/需求澄清/2026-11-09/第二轮补充前/manifest.json)。旧未知产物/恢复资料与他人成果不纳入本任务清理。
