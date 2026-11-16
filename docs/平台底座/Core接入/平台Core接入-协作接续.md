# 平台 Core 接入当前协作接续

更新时间：2026-11-16。

> 负责人已授权本对话全权负责独占工作树及PCH拆分所需公共文件，持续完成PCH-01～12。无Core独立运行、完整Rental标准包及全功能验收仍未完成。正式依据为[需求v1.5](平台Core接入-需求.md)与[开发任务v1.5](平台Core接入-开发任务.md)，进度只由原G1～G4门槛核收。

## 1. 当前目标与施工范围

建设对开发者和开发AI友好的AI Native SaaS底座。没有Core也能启动、登录、维护公共设置并使用完整后台外壳；没有Core不开放通用Agent任务。侧栏、内容容器、面包屑/页名整行、铃铛、休息和面板收展归底座，Core声明自己的路由、页面、主操作和数据方法，复用原React/UIArc、表单/列表与请求反馈。[声明式页面合同](平台Core接入-开发任务.md#declarative-page-contract)

开发者受控注册Core→SaaS管理员授权租户→租户管理员分配成员→按业务角色和范围使用。同部署、同租户多Core并存，新Core不默认分配全员。Core共用租户订阅期限，分别开通/停用；停用保留配置、数据、原绑定和收据，重开核当前条件，不重复初始化或重放。续费不恢复主动停用、成员撤权或账号冻结。各Core自定义业务分区；客户等其他audience沿原专用授权，历史/在途/unknown按原权限收尾。

Core的AI工具可选，缺工具时普通后台仍可用，Agent不能访问该Core。未来跨Core协作通过明确对象引用/接口/事件实现，本期不开放共享业务表或隐含读权。先交标准本地包，再接固定GitHub Release获取及Topic发现；底座与Core分别更新，保留下游业务、配置、数据和授权。[包标准](平台Core接入-开发任务.md#core-package-standard) · [独立更新](平台Core接入-开发任务.md#independent-upgrades)

唯一施工树为 C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS，分支 codex/platform-core-extraction。本树由本对话唯一写入；允许修改PCH所需Auth/Guard/ALS、正式包出口、主装配/OpenAPI、schema/迁移/Seed与后台外壳。main索引和其他树仍归其作者。最近实际远端main为62ca183f10b7c316ab63c28ef6d04ee88d06488b，已在本树祖先；新增固定main按差异核对后整合，不追其他专项活动HEAD。[固定主线与记录保全](平台Core接入-开发记录.md#core-main-runtime-sync-20261115)

本次业务请求DTO的固定父版为606b67b8b8c6e44d04c4aad63a14c97f8a3daff3，包含本次修改前的完整接续原文，直接用Git定位，不重复备份。阶段实现、验证及具体源码提交沿[开发记录](平台Core接入-开发记录.md#core-rental-request-dto-20261116)读取。需求/任务身份、依赖、顺序和正式业务规则保持批准依据；品牌原稿及许可固定来源也在Git。[MIT来源](平台Core接入-开发记录.md#nativark-mit-20261114) · [品牌保留稿](平台Core接入-开发记录.md#nativark-logo-core-options-20261114)

## 2. 已有实际接点

| 模块 | 当前实现及证据入口 |
| --- | --- |
| 公共合同/服务与无Core API | [platform-contracts](../../../packages/platform-contracts/README.md)、[platform-server](../../../packages/platform-server/README.md)、[platform-api](../../../apps/platform-api/README.md)持有认证、会话、外观、初始化、租户/人员角色及公共HTTP；22公共模型/4份迁移和独立构建已提供。原API窄转接同一实现，原组合schema/迁移保留。[公共宿主](平台Core接入-开发记录.md#core-public-host-packages-20261115) · [初始化/管理](平台Core接入-开发记录.md#core-public-management-20261115) |
| 标准Core宿主 | [core-contracts](../../../packages/core-contracts/README.md)、core-host与[platform-core-host](../../../packages/platform-core-host/README.md)提供正式清单、授权/分配、绑定/原收据、本人目录、范围/就绪、HTTP政策和移除预检。独立公共主装配消费同源Guard/OpenAPI，原Rental总装配仍需迁移。[公共主接点](平台Core接入-开发记录.md#core-public-assembly-20261115) |
| 期限与实际数据观察 | 公共统一订阅期限reader、固定公共SQL/结构检查、工单实际物理reader及原Prisma账已提供，目录/升级预检消费真实证据接点。当前数据库/迁移尚未实际执行，清单不能补成功。[期限/公共数据](平台Core接入-开发记录.md#core-public-data-term-20261115) · [工单物理与原账](平台Core接入-开发记录.md#core-mysql-data-observation-20261115) |
| 公共后台 | [platform-admin](../../../packages/platform-admin/README.md)持有原外壳/UIArc、主题/语言/音效、通知/休息/面板、页面/表单/列表和稳定会话/请求/缓存端口；[零Core Web](../../../apps/platform-admin/README.md)与[工单Web](../../../apps/example-tickets-admin/README.md)复用同一应用工厂。Core目录/授权面板、人员角色、租户创建/资料/状态及本人安全已接公共页面。[目录](平台Core接入-开发记录.md#core-access-directory-ui-20261115) · [人员角色](平台Core接入-开发记录.md#core-public-access-pages-20261115) · [租户页面](平台Core接入-开发记录.md#core-public-tenant-pages-20261115) · [恢复口令/角色删除](平台Core接入-开发记录.md#core-public-access-actions-20261115) · [本人安全](平台Core接入-开发记录.md#core-public-self-security-20261115) |
| 非租赁示范 | [工单Core](../../../packages/example-tickets-core/README.md)有独立领域/MySQL迁移、8条业务HTTP政策、原收据与四页声明。API/Web共用标准包与版本锁核验、公共数据库和权限；所选权限登记只写元数据，不授予角色或Core。[独立宿主](平台Core接入-开发记录.md#core-tickets-independent-host-20261115) · [权限登记](平台Core接入-开发记录.md#core-permission-registration-20261115) |
| Rental包与兼容入口 | [rental-core](../../../packages/rental-core/README.md)已持有原主核心与报价/营销聚合、订单确认/商户委托、配货/办理锁/自动扫描及经营空间边界、配置与业务请求DTO、合同、品类解析/身份、计价/器材、能力/审计/实例、恢复快照/原收据、业务动作事务和核心/业务配置，以及订单/资产/库存/处置/工单/检查/续租换货及报价/券/奖励/通知事实。原shared/API消费同一实现；资金事实/门禁与原事件、企业应收/原回款收据、服务容量、原批准/检查同意、检查/换货/续租及服务规则也成为包内单源，完整服务/数据/页面/作业/AI和标准主装配继续迁移。[原业务导读](../../../apps/api/src/modules/rental-core/README.md) · [核心事实阶段](平台Core接入-开发记录.md#core-rental-core-facts-20261116) |

以上已有类型、静态、内存构建、实际Nest容器或离线行为证据，具体层级从各阶段记录读取。它们不代表浏览器、真实HTTP/数据库、完整安装或正式验收通过。

## 3. 下一实施入口与未完项

1. 继续完成Rental独立包。核心/报价营销、配置与业务请求DTO、订单确认/批准/商户委托、配货/办理锁/自动扫描及经营空间边界已单源迁入；事实/配置/恢复/收据、资金/容量/企业核销及原冻结规则也有正式出口。下一步迁入剩余服务和Controller，再形成标准Core装配、schema/迁移/Seed、页面/客户端、其余作业/回调及AI接点。会员、企业政策、文件与当前授权仍由原宿主供给实际参加者，不能以空适配替代；保留原权限码、标识、金额、锁、事务、幂等和历史依据，事件/作业只有一个执行者。[完整兼容清单](平台Core接入-开发记录.md#core-ownership-baseline-20261114) · [原主核心](平台Core接入-开发记录.md#core-rental-core-facts-20261116) · [确认/委托](平台Core接入-开发记录.md#core-rental-order-confirmation-20261116) · [配货/扫描](平台Core接入-开发记录.md#core-rental-allocation-runtime-20261116)
2. 公共组织、安全、完整订阅办理和基础集成尚未全部独立；补实际API/UI与数据所有权，不能将已有认证、基本资料或期限reader当作完整公共能力。原有效会话的wid必须作为签名证据核验，不在公共业务workspace恢复Rental权限；原简称省略/null/空字符串及审计兼容保持。[公共兼容基线](平台Core接入-开发记录.md#core-public-window-baseline-20261115) · [原身份SQL](平台Core接入-开发记录.md#core-principal-sql-runtime-20261115) · [公共认证](平台Core接入-开发记录.md#core-public-auth-extraction-20261115)
3. 完成原Rental主AppModule/Guard与各audience接线。主provider通过明确imports/exports供给同一数据库、人员、订阅、审计和部署目录，总Core模块与单独模块不重复登记Controller。标准HTTP从所选Core贡献生成，未知政策拒绝；staff/client沿各自正式授权，不按operator使用权直接放行。[统一装配](平台Core接入-开发记录.md#core-application-assembly-20261115) · [HTTP政策](平台Core接入-开发记录.md#core-http-policy-registration-20261115)
4. 生命周期仍须实际核租户授权、成员分配、原绑定/初始化、停新、排空和代码移除。当前授权结果与随后读取错误分开，unknown只读原键；撤权先取消旧请求、清除目标Core缓存。Core绑定/当前范围/实际就绪分别读取，跨事务不逆序持父锁。移除预检clear不执行删除，缺业务/AI/回调/作业/历史依赖证据不得移除。[结果读取/缓存](平台Core接入-开发记录.md#core-access-refresh-receipt-20261115) · [范围/就绪](平台Core接入-开发记录.md#core-scope-readiness-20261115) · [移除预检](平台Core接入-开发记录.md#core-removal-preflight-20261115) · [工单移除依赖](平台Core接入-开发记录.md#core-tickets-removal-data-20261115)
5. 实际安装/部署消费同一固定标准包和版本锁；源码目录缺标准清单须拒绝。迁移prepare仍pending，不写成功账或执行DDL。工单旧绑定/初始化版保持可读，普通准入核完整迁移/物理库；普通更新拒绝租户/容器范围转换及容器类型改名，改变范围须专门迁移。[包与命令](平台Core接入-开发记录.md#core-package-current-cli-20261115) · [原绑定兼容](平台Core接入-开发记录.md#core-tickets-binding-readability-20261115) · [更新范围](平台Core接入-开发记录.md#core-update-scope-compatibility-20261115)
6. 继续按原03/04→05/06及07固定上下文→08推进；09消费稳定的正式业务接点，不等待AI Native全项完成。AI行业reader/工具/执行者和通用Runtime分离，保留唯一Gateway、财务预算单账、独立任务资源、批准和原收据/恢复。缺真实依赖保持不可用，不能靠全部关闭或恒真替身验收。[AI并行边界](平台Core接入-开发任务.md#ai-parallel-boundary)
7. 后台仍须浏览器核完整外壳、直接URL、当前权限、中英文/窄窗口、主按钮动态清理、Portal/回车/离页、单次提交、分页及迟到响应。只改Core和受控装配完成样例扩展，不复制壳/样式或自写网络层。[表单](平台Core接入-开发记录.md#core-form-submission-20261115) · [详情](平台Core接入-开发记录.md#core-tickets-detail-actions-20261115) · [列表分页](平台Core接入-开发记录.md#core-list-pagination-20261115)
8. GitHub固定Release/仓库清单/多Core索引/Topic查询已有共用准备链，发现和安装管理UI、真实远端获取与实际部署仍未完成。无网络不阻断已安装Core，来源/许可/兼容、仅源码/可安装、待部署和运行版本分别显示。[固定仓库索引](平台Core接入-开发记录.md#core-github-repository-20261115) · [Topic](平台Core接入-开发记录.md#core-github-discovery-20261114)
9. 10～12仍缺干净宿主安装→注册→授权/分配→持久化业务、多真实Core/同ID隔离/停用恢复、无Core真实运行、独立Agent接手、底座与Core分别升级/回退、配置/定制/数据保留及独立审查。按完整功能清单汇集前后证据，代码合并/版本预检不证明实际升级恢复。[五步指南](平台Core接入-开发任务.md#core-quick-start) · [Agent模板](平台Core接入-开发任务.md#core-agent-template)

## 4. 源码与接入资料

每片同步实际源码职责、复杂事务/历史原因、模块导读、正式API资料及接入步骤。开发Agent从[统一能力查询](../../../packages/core-contracts/README.md#找到平台已有的功能)定位正式导入、页面/API及源码；动态登记、完整API字段、六个未检出应用/客户端和用途说明缺口仍须处理，索引issues=0不代表全部源码规范化。[覆盖/部署快照](平台Core接入-开发记录.md#core-index-deployment-snapshot-20261115) · [源码导读](平台Core接入-开发记录.md#core-source-reading-20261115)

只做对应改动的必要测试，复用既有用例与短stdin，不新增成批脚本，不删断言、skip/todo或放宽权限。原四册维护，记录放完整阶段证据，任务只更新跨档进度，接续覆盖当前现场。本树不主动跨对话通知，PM按规则读取。其他Rental品类治理、AI Native、MCP/Harness和Runtime/SDK专项仍按各自正式依据核收，不重派或继承进度。

## 5. 验证边界与保留问题

业务请求DTO的67类（63公开/4内部）及装饰器与固定父版一致，最终十配置零诊断；四份原用例通过，55个原断言保留。实际ValidationPipe与同一DTO对象两个短探针通过，原字段门禁前后同样10处缺口，首次数量核对/旧夹具失败见记录。前一配货/空间、确认及原事务证据继续可读。所有验证留内存，SQL/仓储和事务为明确fixture，output/.tmp为空，无新临时环境或实际IO。真实HTTP/数据库/浏览器/供应商、完整Core包安装/更新、接手和审查仍未验，旧外观/文档/临时环境及空日志问题沿原责任清单保留。[当前证据](平台Core接入-开发记录.md#core-rental-request-dto-20261116)

未经进一步授权，不安装依赖、读.env、启真实服务、访问业务HTTP/DB/模型/供应商、执行迁移、合main或发布。中文提交到当前任务分支、普通推送后读取实际远端。正式需求/任务与已应用历史迁移保持，旧原文优先引用固定Git。

旧公共宿主临时环境已归集到 D:/工作文件/rental-OS/output/.cleanup-pending/pch-preparation/platform-host-integration/environment，840文件/91,808,304字节，责任清单为同任务manifest.json。本日核路径、归属、链接与进程后，原生PowerShell删除仍被自动审批在启动前以blocked by policy拒绝；没有换壳/工具绕过，工具恢复后由本会话优先处理，不能称已释放空间。[清理证据](平台Core接入-开发记录.md#core-rental-recovery-receipts-20261116)

旧外观测试17例16过/1个静态失败、总导航三份历史附件及MCP导读五个原隔离附件缺失继续保留；近期全局文档检查的稀疏未检目标须按固定Git定位，不删除引用或修改检查器掩盖。原授权/生成/MCP检查的审批拒绝历史保留，后来定向补证不能冒称完整宿主验收。[当前MCP审计](平台Core接入-开发记录.md#core-original-mcp-audit-20261115) · [导读缺链](平台Core接入-开发记录.md#core-rental-capability-runtime-20261116)

初版与两轮原文分别见[方案基线](历史归档/方案基线/2026-10-31/README.md)、[初次前像](历史归档/需求澄清/2026-11-09/manifest.json)、[第二轮前像](历史归档/需求澄清/2026-11-09/第二轮补充前/manifest.json)。旧未知产物/恢复资料与他人成果不纳入本任务清理。
