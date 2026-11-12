# Rental Core 开发记录

建立日期：2026-10-31。来源：原2026-10-18 CLOSE任务、平台正式需求及平台开发记录。本册补齐专项证据入口，不把历史状态重新判定为当前完成度。

[需求](<Rental Core-需求.md>) · [开发任务](<Rental Core-开发任务.md>) · [协作接续](<Rental Core-协作接续.md>)

<a id="merchant-delegation-core-proof-type-20261112"></a>

## 商户单次委托的Core内部证明类型（2026-11-12）

按PM确认的唯一作者窗口，从已核GitHub的`045ff2114b1a25943419b88dd153e7d94685fd18`接续，先独立交[原五阶段参加者类型](../../apps/api/src/modules/rental-core/approved-order-transaction.ports.ts)的`ApprovedOrderBinding.merchantDelegation`可选字段，不改变authorize/recover/prepare/commit/replay签名或普通批准语义。`ApprovedOrderMerchantDelegation`含version/purpose、D、sourceHash/basisHash/requestHash、quoteId、原签发expectedRevision、personalCustomerId/corporateCustomerId及原operator actorUserId；tenant/workspace和K仍在原binding。当前源版本只接受原签发1，consumed/revoked当前2不替代它。

证明带模块私有unique-symbol类型标记，仅Core由真实私有读结果/原请求校验后封存注入。类型转换、HTTP/Shared DTO或普通callback自填字段不获得运行时来源；企业政策必须使用Core运行时`assertCoreMerchantDelegationProof(proof, binding)`校验原proof对象，再逐字段核持久源和当前operator。原binding复制给五阶段参加者只携带投影，不以其JSON复制作为授权。这一运行时接点与确认服务仍是本树WIP，待对应固定实现，不声明类型本身已完成执行链。

现有API原noEmit退出0、audit0，含当前Core实现WIP，类型hash/命令与退出清理唯一见[类型证据](../../output/category-governance/merchant-delegation-core-types-20261112.json)。本阶段仅提交类型和既有记录/接续；确认服务与sealed端口未混入类型片，也未生成新包或改企业政策/共同入口。企业私有读取已固定`86dc23917336b35b1842c2873ed6ac0c7790549d`：read返回原request/hash、issuedRevision/state/当前revision，prepare复用read后去掉state/issuedRevision并保留原prepared形状。Core沿该固定来源完成执行/原结果，恢复不走新prepare、不改ALS userId；完整正常、失应答、TTL及当前权限/原Core事务验证仍未完成。

<a id="business-config-original-transaction-20261112"></a>

## 业务配置补落的完整原事务（2026-11-12）

从已核GitHub的`6390f89a9d38b499ca8d43a3b38dccef0641e13c`接续，固定源码`045ff2114b1a25943419b88dd153e7d94685fd18`已普通推送核远端；按PM的AIN-17 Core窗口只改[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)和[业务配置仓储](../../apps/api/src/modules/rental-core/rental-business-config.repository.ts)。`persistBusinessConfig`把基础价格及初始价格版本、优惠、服务及版本、日历、规则、通知模板六类补落纳入同一ReadCommitted事务，先持原Tenant/空间品类锁；新增事务参数沿原方法追加，范围读取也使用同一client，不从根连接逃出。直接消费者仍为`persistScope`和首次报价的原配置补落；普通发布/资金/客户入口及Shared/DI未改，不声明已接入Outbox。

等锁前固定六类配置并拒绝其他商户行。保存期间输入变化在提交前拒绝并回滚，新的输入保留；提交应答期间又变化，则明确保存后冲突，保留已提交事实及新输入，调用方不把它标作已保存，也不假称事务回滚。`configPersisted`仍仅在完整返回后设置，初始价格不单独成为可见前缀，原报价/金额算法与历史版本保护不变。

API原noEmit与最终完整emit退出0；原`config-workspace-scope.test.cjs`3项退出0。原日历脚本源码装配只补合成Tenant父锁叶子，其全部修订/审计/发布范围原断言退出0；未改测试文件。原续租配置fixture的实际服务/六类仓储限定调用退出0：同一tx、末段失败/提交前输入变化回滚及标记未完成、提交后变化保留已提交事实/新输入、初始价格版本同提交、重复persist不重初始化、原报价不变。首次数据库替身不能克隆Prisma.Decimal的失败保留，改为原JSON表达后只复验相关调用；SQL/锁/授权/回滚仍为替身，不当作真库证据。

当前864份自持API完整编译并逐文件核对，累计更新业务配置/业务服务及此前R08 Core/快照共4份，Shared/Client四项保护hash未变。最终提交后复核补入业务服务，其他863文件保持；命令、源码/文件hash、失败及清理状态唯一见[阶段证据](../../output/category-governance/business-config-original-transaction-20261112.json)。最终864份退出文件/缓存及40个目录、其余本片退出暂存已删除。原真库价格版本入口读取环境/连接专用库，未获许可未执行；原0/14完整结项及CLOSE门槛不变，真实配置行counter/开业分区、资源短缺和四入口参加者仍未齐。

PM新增的下一Core独占窗口为[订单确认服务](../../apps/api/src/modules/rental-core/rental-order-confirmation.service.ts)与一份Core sealed商户委托authority/端口，必要时仅扩[原参加者合同](../../apps/api/src/modules/rental-core/approved-order-transaction.ports.ts)的服务端字段；公共AppModule/shared-index/OpenAPI、商户Controller/admin由企业作者负责。依据固定企业源`7179bafb0f6fea09e1832ea75ddf2a0a610c28f6`及恢复补片`a130e89fb6c54ff4789a57830b2a028ffa41f7d0`，当前只读核准入口，不继承整个父提交或改企业政策。企业另获准固定私有`readMerchantDelegatedSubmission(actorAuth, reference)`补片，Core等待其固定来源后消费原descriptor/state/状态修订，不以公开view补request，不另建公共Core源合同。下一片保持operator Auth/Guard/ALS、不可变个人使用人、D/K/原quote/签发修订/指纹及同一参加者；执行严格issued/签发修订/期限，原结果用私有read与recover/replay，consumed状态修订和自然TTL不触发新准备，源/批准/订单/Core收据同事务。完成后再继续AIN-17/CAT-GOV，不扩常设或私人保证金委托。

<a id="snapshot-original-transaction-20261112"></a>

## Core快照的原事务复用与固定输入（2026-11-12）

按PM核准的AIN-17四入口顺序，从已核GitHub的`5d6c6dffdfaf11b0bc6d759ab87ae983d31edd0c`接续，源码固定`6390f89a9d38b499ca8d43a3b38dccef0641e13c`并已普通推送核远端；仅改[快照仓储](../../apps/api/src/modules/rental-core/rental-state.repository.ts)。`saveCoreState`允许服务端调用者传入原事务，绑定锁、快照读取及原行CAS在该事务执行，不另开事务/自行提交；未传事务时仍由仓储拥有原ReadCommitted事务。原CoreService恢复备份调用保持，正式宿主尚未消费新增事务参数，不声明四入口参加者已接通。

在第一次等待数据库前固定JSON快照；绑定依据、新建行内容与替换SQL使用同一次输入。修复原新建分支在等锁后再次序列化活缓存、可能混入后继改动的问题；明确档案保留、合法修订范围、无变化不写和饱和拒绝仍沿原CAS，不改Schema/Client或历史事实。

当前API原noEmit退出0。复用原采用fixture的数据库行和回滚装配，限定实际仓储调用退出0：原事务不嵌套、独立调用只开一次、等待时修改原输入不污染新建快照、无变化不写、外空间/饱和/陈旧绑定及坏快照拒绝、原所有者回滚。仅补当前合成Tenant父锁与快照SQL叶子；不解释MySQL表达式、不证明真实锁/DDL/权限。原`tests/rental-state-persistence.test.cjs`在`:37`同步读取`getProfile`、期待camera而得到undefined处退出1，未跑到重启恢复断言；原测试未改。命令、源码hash和原失败唯一见[事务证据](../../output/category-governance/core-snapshot-original-transaction-20261112.json)，audit0；5份退出文件/缓存及3个目录已删除，未生成新API包。

**四入口参加者待核的最小合同：** 以下是实际缺口及交PM/AI唯一作者核定的字段/提交点，不是已实现接口或新增任务。

| Core入口 | 原事务来源与下一接点 |
| --- | --- |
| `recordIssue` | 原订单/assignment修订、订单更新时间、起租时点和地点；`resource_shortage`须由Core实际资源判定，现有`issue_recorded`不能按自由文本转成缺货。保存原订单后、提交前调用参加者，问题恢复须使旧来源失效 |
| `upsertProfile` | tenant/workspace、默认或非默认范围、实际`configurationSource/configurationRevision`及是否修改；非默认兼容行空update和重复回填不触发默认档案事件 |
| `persistBusinessConfig` | 所有实际配置和初始价格版本先复用原tx，完成后提供原设置行`settingsRevision`与各规则/日历/价格引用；设置修订不充当九项配置总修订，不回读另一个事务的R0来源 |
| `saveCoreState` | 本片已支持原tx及固定输入；下一步提供实际行修订/相关配置变更依据后接参加者，普通订单/资金备份变化不冒充开业配置改变 |

参加者只在原事务登记待处理事实；缺当前授权、正式临近政策或可靠来源保持not_captured，不能外调模型/通知/扫描全部业务。已接入参加者的写入失败须传播给原事务所有者回滚，不吞成捕获成功。Core提供领域来源合同，AI负责既有Outbox/ResourcePorts适配，公共符号和宿主DI须由PM指定唯一作者；本片没有改AI接口、装配或新增恒真依赖。原CAT-GOV/CLOSE完整门槛不变，08原子采用及两新编码不同组合经营仍必做。

<a id="exchange-guarantee-current-gate-20261112"></a>

## 普通换货纯保证金增额的企业门闸（2026-11-12）

按PM明确窗口，从已推送并回读一致的续租片`3ed71c1ade0fc3447d26608ea3b108dcc024e863`接续，源码固定`5d6c6dffdfaf11b0bc6d759ab87ae983d31edd0c`并已普通推送核远端；仅改[Core正式换货](../../apps/api/src/modules/rental-core/rental-core.service.ts)的新增义务条件。租金补差、押金增额或预授权增额任一为正时，普通入口复用原`assertEnterpriseNewExpense`，继续把本次Core报价的`additionalAmount`作为原第五参数，明确0也保留。保证金增额不计入租金授信，租金核减不抵消保证金增额；未扩[企业政策](../../apps/api/src/modules/enterprise/enterprise-policy.service.ts)签名。

直接消费者仍为CoreController普通换货及[批准换货服务](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts)。批准专用路径原sealed authority及事务、范围、订单、输入、C/K核验保持；本片不新增本人委托接口或声明其完整执行链。普通入口需当前企业关系和当前政策，逐单批准不能复用原订单批准，伪造authority不能替代核验。

使用原换货fixture、Shared正式摄影定义及实际PreviewService/BusinessService得到两份正常报价：仅押金+100和仅预授权+100，均租金补差0。限定调用覆盖逐单批准拒绝、免逐单模式继续按0复核、当前企业关系停用及伪造authority拒绝，退出0、无业务前缀写入。仅时钟、SQL/当前关系与库存为替身；在陈旧修订处停止的调用不证明后续库存、收款、批准消费或真实事务。前两次分别因手造预览缺`additionalAmount`及旧fixture缺完整品类字段失败，原失败保留，未改生产门闸/测试断言。命令与结果唯一见[门闸证据](../../output/category-governance/exchange-guarantee-gate-20261112.json)。

当前API原`--noEmit --incremental false --pretty false`退出0、audit0，源码hash固定；各次退出暂存已删除。本片未生成新运行包，原864文件研发包只覆盖已提交续租片。CLOSE-CORP/GUARANTEE、CAT-GOV-04/13及企业委托的真实权限、事务、HTTP/宿主与原完整验收仍未收口，不更新完整结项比例。下一优先为AIN-17四入口真实counter/同事务参加者。

<a id="extension-service-empty-snapshots-20261112"></a>

## 新续租的服务解析与明确空快照（2026-11-12）

按PM明确窗口，从已核GitHub的`b659aa857088e01cab277d4270390e9845eeaead`接续，源码固定`3ed71c1ade0fc3447d26608ea3b108dcc024e863`，已普通推送并回读一致；只改[报价服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)与[事实仓储](../../apps/api/src/modules/rental-core/rental-core-fact.repository.ts)。新增时段独立续租及普通原价全租期补差均解析本空间服务目录，即使请求未选服务也检查必选规则；明确无新增服务返回`[]`，不调用空服务容量检查。已有核减/重价模式保持原语义，不隐式追加服务。

新续租持久化保留解析所得的空数组；旧`undefined/null`仍写`Prisma.DbNull`，不由金额补快照，不改原订单服务发生项。直接消费者为CoreController续租预览/申请、ClientApiService本人及企业续租报价/核对和Core批准生效；沿原报价、服务容量及幂等链，未扩Shared、DTO、OpenAPI或企业政策签名。

原续租服务fixture的限定装配覆盖两种模式：无新增服务的报价及持久化、遗漏必选拒绝、已选择零价必选服务保留、已有核减模式和旧缺失保留、原报价不变，退出0；实际批准申请保存空快照和原预览指纹的限定调用退出0。仅补原异步getter与同空间库存读取夹具，SQL/授权/事务/批准仍为替身。API原tsconfig完整emit退出0，864份自持JS逐文件核对，更新本片2份，四项Shared/Client保护未变；当前源码hash与构建清单一致。命令、首次失败、源码及产物hash唯一见[阶段证据](../../output/category-governance/extension-service-snapshots-20261112.json)。

原`tests/rental-extension-services.test.cjs`直接运行仍在旧同步getter导致的`defaultUnit`处退出1；限定调用保留`:160`期待`undefined`、实际`[]`的原断言失败，不修改测试或回退已批准的空快照语义。固化证据后867份退出文件/缓存及42个暂存目录已删除。原CAT-GOV-04/13动作矩阵和CLOSE/企业完整验收仍需真实事务、权限及消费者证据；本片不抬完整结项比例，R08后续Core源码尚未纳入本次包验证。

<a id="fixed-category-prerequisites-20261112"></a>

## a0编码及619执行依赖的固定前置核收顺序（2026-11-12）

按PM反馈，以固定main `0e9f9394225feea9190eb437afccee1b18764572`作只读对照。本树a0/619已推送不代表可把整份文件覆盖main；同文件里的父功能和counter检查点须分开。以下是可按自身固定差异核收的功能片及依赖入口，不声明原CAT/CLOSE整项完成，不重跑已绿组、不复制环境。

| 建议顺序/固定源码 | 最小功能与源码范围 | 原验证入口/边界 |
| --- | --- | --- |
| 1：8b64f8efa2146ddb53a9e5de8f95f53d926d9cc3 → b6aa09ad368bf55697e67867f9958e57049a5621 | governance.service/controller原SaaS身份头及AuthService/PlatformRepository同事务复验，再接versionValidation/统一业务解码、来源差异和开放资格；原Auth方法须已在宿主存在 | [治理原身份阶段](品类治理/品类治理-开发记录.md#governance-current-authority-20261111)、[结构阶段](品类治理/品类治理-开发记录.md#governance-version-structure-20261111)；原治理脚本及类型、限定真实签名/角色读取替身。不是只复制新增method |
| 2：8fb37b4e4a3b455c143eead3cae95d6ce2b8116d；40eaeb8983955acd5eacaee6b877a4d18567bed9 | 配置仓储/Core/state恢复的本空间profile读取/保存及保留边界，再核缺已提交档案不补模板；这些实际档案接点是下面初始化/续租所需基础 | [空间档案](品类治理/品类治理-开发记录.md#workspace-profile-persistence-20261111)、[缺档案](品类治理/品类治理-开发记录.md#committed-profile-presence-20261111)；原config-workspace-scope、初始化刷新及限定保存/缺源调用。counter未进入此片 |
| 3：f0e69b9600cbb8110bcc0d8b0ede09bbf894477b | CoreConfigStore的readDefaultWorkspaceInitialization合同、仓储实现及Core.initializeTenant原事务重入；缺资料拒绝、原默认绑定不被推荐覆盖 | [默认重入阶段](品类治理/品类治理-开发记录.md#default-initialization-reentry-20261111)；10组有限调用、配置范围3项，原初始化夹具缺读接点失败保留。选版前宿主人员/商业锁缺口另由原平台作者闭合 |
| 4：16d080e48c5ad507f847e4f7b422eb1610725434 | config.loadWorkspace同空间档案及成员/组成读取；business.quoteEnterpriseExtension原订单/报价/配置同源校验。依赖真实本空间profile读取，不带5e counter | [续租同源阶段](品类治理/品类治理-开发记录.md#extension-scoped-config-20261111)；配置范围3项/限定来源通过，原renewal-repricing旧同步getter夹具失败。未执行金额全链或真库 |
| 5：9331582b7506eede97c8ef02c19d8b5528601249 | fact.readQuotedInspectionTemplates、Core检查恢复/本批换货范围、frozen模板解码、R0 order-inspection-basis引用恢复，共4源码文件 | [历史检查阶段](品类治理/品类治理-开发记录.md#historical-inspection-source-20261111)；原inspection-resource/core-closure及限定恢复/空/坏/跨范围通过，exchange-inspection查询记录器一处失败保留。关联原报价JOIN须一起收 |
| 6：00f19015a6751b1847d2c1d9a991ef37cc6aaa24 | category-active-write的lockCategoryContext及规则/日历绑定草稿两个消费者，复验绑定ID/修订/正文；不能只替换main原lockActiveCategoryBinding调用 | [绑定草稿阶段](品类治理/品类治理-开发记录.md#bound-draft-category-context-20261111)；原规则/日历及限定锁口/类型，旧缺标记/别名夹具失败保留。e82的replaceCategoryUniqueClaims不是此helper的函数依赖，同文件不整包带入 |
| 7：cb96a636b61497243d75032e98d0e301ff3d31a0 → a0a0451754d77b7454de4dad9f5044a4e70c3949 → 619f50c5a04f2af805f84f3977e78dc4683cfb81 | 确认主树已收forWorkspace绑定修订片，再按a0自身编码差异接上面已核功能，最后接Runtime/Core/business必选及历史Hook依赖。a0为15源码编码差异，619为3源码执行差异 | [编码](品类治理/品类治理-开发记录.md#canonical-category-code-20261112)、[执行依赖](品类治理/品类治理-开发记录.md#capability-runtime-admission-20261112)；类型/原Hook/限定调用通过，原7项5过/2失败及17项11过/6失败分别保留 |

`34df464ecd3e8f8b5a59fca187eef25b90f5868c`的已发布原收据审计校验另可按[发布回读](品类治理/品类治理-开发记录.md#publication-receipt-integrity-20261111)独立核收；它不是a0编码函数的直接前置。`e82aac6fb75f3749b61db2076038ee6026091fee`的唯一声明/回填helper只随其真实型号/资产/回填消费者另片核，不能借00f/a0收完整父文件。

**继续留作未收口检查点：** `5e8d52325b37cf6b613c103b2e291b25843e35ec`及其记录检查点`61fece91ae007ed42b02b7c96c1f1ab0d1b0140e`涉及配置行counter/回填；`fe65ac652076d5bed4c9ca439d50b563c61d17aa`仅原事务issue_recorded及九项独立读。两者不能标作已经接入四入口参加者、完整短缺判定或同事务开业总版；列/DDL/正式政策及真实资源仍缺相应证据。PM按上述功能差异串行，若应用需counter段即暂停该段核收并另报最小依赖。本树不追main活动HEAD、不改main工作区。

<a id="preparation-receipt-validation-core-20261112"></a>

## 原批次回执校验收口与Core提交链接续（2026-11-12）

两份Core源码完成原批次JSON/标识绑定校验，原写入重试的资格/来源门槛保持，独立历史GET继续原授权；原消息兼容及错误顺序尝试均按原测试纠正，详见[唯一品类记录](品类治理/品类治理-开发记录.md#preparation-receipt-validation-20261112)。API864文件完整编译/逐文件核对，2份更新，原两批次脚本与限定坏回执检查通过；各次暂存已删除，CLOSE/CAT完整门槛不变。

PM最新指定下一优先：原scanOrder→recordIssue→saveOrderAggregate同事务履约参加者；upsertProfile真实配置行counter/默认与非默认边界及开业参加者；persistBusinessConfig原tx及settingsRevision/开业分区参加者；saveCoreState原tx/scoped原子counter与必要回填兼容。先固定最小内部字段合同和Core可证明的resource_shortage判定，供PM与AI-RD读取；缺已发布临近政策不捕获，不解析issue文本、不把九项独立读取当单事务总版本。公共符号/装配新增须另报具体窗口，原真实环境许可未增加。

<a id="capability-runtime-admission-core-20261112"></a>

## 必选与历史能力的执行依赖（2026-11-12）

本片支撑原CAT-GOV-03/04/10/13，CLOSE任务身份和进度不变。共用运行时、Core及报价服务修复普通必选缺执行器、已启用实例缺全部登记版本的略过路径；续租按原动作版本/实例执行，两个新空间初始化入口在创建资料/配置/缓存前检查实际执行依赖。详细事实和唯一证据见[品类阶段](品类治理/品类治理-开发记录.md#capability-runtime-admission-20261112)，不复制另一份台账。

当前API864份JS完整编译并逐文件核对，更新3份，其余861份对应a0编码阶段清单；四项Shared/Client保护未变。准入/初始化短调用和原Hook脚本退出0，原组合/初始化/字段17项11过/6失败，前置缺口与断言保留。864份退出暂存文件及42个目录、追加短调用暂存均已删除。本树研发包仍不是真库、供应商、浏览器/微信、独立Review或最终冻结经营证据。

<a id="canonical-category-code-core-20261112"></a>

## 品类身份读写解码与当前API产物（2026-11-12）

本片只支撑原CAT-GOV同源身份及历史/采用入口，CLOSE分母和进度不变。Core内部15份源码去除未登记的大小写推断，复用正式编码解码及四个旧Prisma别名；准备/治理、检查与资质、原报价关联、启动和能力读取沿同一规则。实际修正、固定源码/构建hash和原失败唯一见[品类阶段](品类治理/品类治理-开发记录.md#canonical-category-code-20261112)，不重复维护另一份流水或测试台账。

本树API864份JS已完整编译并逐文件核对，更新15份，其余849份对应原2f1a34897清单，四项Shared/Client保护不变。编码正负调用及四品类合同对齐退出0；原7项冒烟5过/2失败，分别是旧单锁预期和缺权威配置读取器，原断言及生产门闸保留。852份退出暂存文件/缓存和42个目录已删除；不计真实DB/宿主或最终冻结构建，原maturity/照片及其他已登记证据继续保留。

<a id="api-current-core-build-20261112"></a>

## 当前Core与核定到期源码的自持API构建（2026-11-12）

固定来源`2f1a34897614c413ba1aeebed1d8ee3687571b05`已普通推送核远端，包含解析器`cb96a636b`及此前配置行修订/只读来源，本片没有新增源码/Schema/Client变更。先核原863文件照片包逐文件与原清单一致、dist未跟踪且无链接、Shared/Client四个保护文件hash未变，再在唯一任务暂存由原tsconfig完整编译并逐文件迁入本树自持API目录。

`tsc --sourceMap false --incremental false --pretty false`退出0，864份JS每文件安装hash与编译结果一致；更新8份原模块，新增1份maturity纯decoder，其余855份原产物不变。原Shared正式出口/租赁合同及Client schema/归属标记四hash保护通过；没有复制别树产物、启动应用或连接环境。唯一[构建清单](../../output/category-governance/api-build-maturity-2f1a34897-20261112.json)保留来源、命令、hash、文件差异及退出清理状态；这只是本树研发包，不是原CAT-A14/A22最终冻结/真库/宿主或发布证据。

当前编译包的CorporateSettlementService/纯decoder/ALS复用原到期fixture，7组限定调用退出0、audit 0，见[包内到期消费](../../output/category-governance/api-maturity-runtime-final-20261112.json)。原ID/旧双时间/原键恢复、未知version/actor-time/金额拒绝及原财务门闸保持。第一次包内装配混用src ALS与dist服务导致财务门闸拒绝，改为同一包上下文后只复验相关调用；[首次运行观察](../../output/category-governance/api-maturity-runtime-checks-20261112.json)保留，没有改授权/断言或把源码别名称为包消费。

原`node tests/category-version-resolver.test.cjs`用这个当前包退出1，`:156`的Object.create(Core.prototype)未初始化configurationReadsByWorkspace，调用已提交配置读取时访问get失败；其后断言不计通过，没有为夹具懒造生产字段/删断言。原主树不同固定基线的源码映射结果不替代本树整组证据。文档351链接/新锚点无新增问题、原28项分类保留；固化证据后7份本片退出日志/缓存及41个编译/任务目录已删除，暂存路径不存在，864份自持研发产物保留。后续仍须原真实DB/全部实例/各端与两新编码不同组合经营，CLOSE和CAT-GOV分母/完整门槛不变。

<a id="corporate-maturity-evidence-20261112"></a>

## 原财务核定到期收据的纯解码与审计绑定（2026-11-12）

关联CLOSE-CORP-VERIFY及企业ECP-10必要来源，不计CAT-GOV进度。本片从已核GitHub的`8daf022680c8afc42d6e96a8cd4cb5d20c9fb7c1`接续，源码检查点`2f1a34897614c413ba1aeebed1d8ee3687571b05`已独立提交/普通推送核远端；PM准许两源码窗口：[Core纯解码器](../../apps/api/src/modules/rental-core/rental-corporate-maturity-receipt.ts)和[原CorporateSettlementService](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)的maturity委托/收据写入。没有改operator/staff财务授权、其他资金动作、原键、ledger/operationLog/锁序、Schema/Client或企业响应投影。

`corporateCreditMaturityAuditId`保留原SHA-256(JSON.stringify(["corporate.credit.maturity", tenantId, customerId, ledgerId]))字节；`readCorporateCreditMaturityEvidence(log, ledger)`纯读原正债权/原核定审计，返回原Shared receipt及内部audit来源。核原ID/action、tenant/customer/workspace/order/ledger/currency/原Decimal金额精度/basis/key，绑定audit.userId与detail.recordedBy，缺actor/time或矛盾明确不可核验。decoder不查当前用户状态、不读配置或计算dueAt；原操作人后来停用不否定历史审计，当前读取资格仍由原服务前后复验。

旧记录无auditBindingVersion时保留原detail.recordedAt和原audit.createdAt两处时间，不要求应用/DB毫秒相等、不编时差阈值或回写；新核定用同一个服务端Date写两处，并在原JSON存`corporate-credit-maturity-audit-1`绑定版本，严格复核一致。版本属性存在但null/undefined/未知均不可当legacy；只有确定原审计行不存在才沿原readMaturity返回未核定，有行但缺证据仍抛不可核验。原合法收据同键回放不重写/换ID/改旧时间。

原API `--noEmit --incremental false --pretty false`退出0；原credit fixture的7组限定实际服务/decoder调用退出0、audit 0：ID原字节、新写/read/replay一条收据、legacy双时间保留、版本/新时间矛盾、actor/主体/金额缺失、当前撤权/client audience门闸、无行与不可核验区分。源码/fixture/调用hash及原失败唯一见[最终阶段证据](../../output/category-governance/corporate-maturity-final-20261112.json)。限定装配仅补当前合成tenant的原父锁返回，其他未知SQL仍拒绝，固定原生Date使原fixture返回与明确写入时间一致；真实SQL/Auth/事务仍为替身，不证明真库/供应商/企业消费。

原`node tests/corporate-credit-settlement.test.cjs`退出1，FakeDb:117不识别既有Tenant LOCK IN SHARE MODE，停在新maturity场景之前；原资金/receipt断言及父锁未改，失败缩入上述最终清单，不记整组通过。没有新增/扩写测试脚本或反复建环境；固化原失败/最终结果/hash后2份本片重复证据删除，10份退出日志/缓存及任务目录删除，暂存路径不存在。本片未生成API/Client产物，原863文件包不能当作新decoder验证。

第二阶段待确认的最小投影：仅在`rental-enterprise-read.port.ts`和Shared `core.ts`提供当前企业finance资格下的单ledger原核定明细，调用方scope绑定tenant/corporateCustomer/workspace、原正债权及真正企业承担订单；读取前后复验原客户会话/permissionRevision。字段限workspaceId、ledgerId、orderId、currency、dueAt、basisRef、原auditId/auditCreatedAt及bindingVersion；coverage固定current_trusted_workspace_only，明确determined/not_determined/unavailable，缺审计不补当前时间/人物，不出自由财务原因、操作键或原operator ID。单债权明细不冒充完整账户/账单/历史空间清单，不重算应收/到期/保证金；对应DTO/OpenAPI/消费者由PM另指唯一作者。公共企业投影尚未开放，原statement/跨历史space/混合payer-guarantee缺口保留。

<a id="workspace-resolver-binding-20261112"></a>

## 唯一品类读取入口的绑定修订与异步一致性（2026-11-12）

关联CAT-GOV-03/04/08及CAT-A01/A08/A10/A17。本片从已核GitHub的`a060f8b928ca3494e399af3f42418cef2c594b5a`接续，源码检查点`cb96a636b61497243d75032e98d0e301ff3d31a0`已独立提交/普通推送核远端，只改[品类解析器](../../apps/api/src/modules/rental-core/rental-category-resolver.service.ts)的`forWorkspace`和现有记录/接续。前片共用写锁已拒绝坏采用修订，但这个元数据/业务读取入口仍直接返回存储值，读写准入不一致。

现在在读取正文前验证真实版本ID/编码及非负安全整数采用修订；缺失/字符串/负值/非整数拒绝，合法初始0保留。先捕获观察到的版本ID/修订，再等待同一不可变正文，避免异步返回混入后来改变的绑定字段。历史`forVersion`继续按原业务明确版本读取，不绑定空间最新版；原当前授权和业务提交点复验保持，无写入/取锁/缓存或政策重建。

原API `--noEmit --incremental false --pretty false`、`node tests/rental-category-core-alignment.test.cjs`均退出0；原resolver fixture的5组限定调用退出0：当前/事务内/历史版本区分、初始0、坏修订不读版本、坏身份不输出、异步正文不混后继绑定。命令/源码/fixture hash和输出见[阶段证据](../../output/category-governance/workspace-resolver-binding-checks-20261112.json)。fixture仅返回指定行，不解释SQL，不证明真实DB/权限/并发；原完整resolver脚本仍用旧API产物，本片不将其当作新源码整组结果，没有改用例/断言。文档344链接/新锚点无新增问题，原28项分类保留；证据固化后8份本片日志/缓存及任务目录删除，暂存路径不存在。

PM通知guard `9380d1bab`已按12行增量收固定main `307abf572701f7ad7d3b4a0e0d82710ea528e37f`；本树仅读取该固定文件核清依赖，没有追活动main。父辅助函数不在该增量中：`replaceCategoryUniqueClaims`来源`e82aac6fb75f3749b61db2076038ee6026091fee`，由型号配置仓储、资产事实仓储和回填真调用；`lockCategoryContext`来源`00f19015a6751b1847d2c1d9a991ef37cc6aaa24`，由规则/日历绑定草稿真调用。按消费片另交函数/必要imports及原调用方，不整包带入父提交/counter/schema。

这两helper分别须保持原tenant→workspace→entity事务内唯一声明替换/冲突回滚，以及原Auth+绑定ID/修订+完整正文的一致性核对。前者依赖已有unique表/规范化口径，不能将冲突吞为skip或分开释放旧声明；后者不授权限、不从持资源锁的事务逆取父锁。完整真库/并发/存量采用门槛仍待验，本片不增加CAT-GOV/CLOSE完整结项或待核实百分比。

<a id="active-binding-revision-guard-20261112"></a>

## 当前品类绑定修订损坏时拒绝共用写入口（2026-11-12）

关联CAT-GOV-03/08及原CAT-A06/A08/A10/A17。本片从已核GitHub的`c3c93d0fafafdf0de07ce70dd1e0ce17314c2a9e`接续，源码检查点`9380d1bab95e2d78ecb64d0390cfcd03af2ca0f4`已普通推送并回读任务远端一致，只改[共用活动绑定锁](../../apps/api/src/modules/rental-core/category-active-write.ts)及既有记录/接续。原`lockActiveCategoryBinding`只比较绑定ID，未核存储的`categoryAdoptionRevision`合法性；负值/缺失值可能通过无期望绑定的初始路径，被配置或恢复快照入口继续消费。

现在先拒绝不完整/非法期望绑定，再沿原租户父锁→空间锁读取；存储行必须唯一、有效active状态、完整编码/版本ID和非负安全整数采用修订。坏值/多行不能进入版本读取或返回可信binding；合法初始0及后继修订保留，未改锁序、权限、版本正文或采用事务。

原API `--noEmit --incremental false --pretty false`退出0，原配置空间范围3项通过，原scope fixture的4组限定调用通过：合法0/后继、存储缺失/字符串/负值/非整数、期望坏值在取锁前拒绝、坏状态/缺版本/重复行不读版本。源码hash、命令/退出码及边界见[阶段证据](../../output/category-governance/active-binding-revision-checks-20261112.json)。fixture只返回查询行，不解释SQL或证明真库/并发/权限；未改测试或断言，完整门槛及待核实百分比不变。定向文档342链接/新锚点无新增问题，28处原分类保留；证据固化后8份本片日志/缓存和任务目录已删除，暂存路径不存在。

PM指定的企业后继只读来源核查：原财务核定到期事实实际为[CustomerCorporateSettlementService](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)的`recordMaturity`→`operationLog`→`readMaturity`（不是readCreditMaturity）。原收据绑定tenant/workspace/order/ledger/customer/currency/正债权金额，记录actor、dueAt及basisRef；读取前后复验营运财务资格，但该公共入口只接受operator/staff，不可借身份供企业客户端调用。原decoder只检查detail.recordedBy/recordedAt非空/时间合法，尚未核与log.userId/原审计时间的绑定。

可行最小下一接口：在[RentalEnterpriseReadPort](../../apps/api/src/modules/rental-core/rental-enterprise-read.port.ts)提供当前受权空间/企业/原正债权的maturity读取，复用原企业finance权限与会话前后复核，读取原核定收据、共享`CustomerCorporateCreditMaturityReceipt`语义；不自算dueAt、重核定或复制账务。需唯一作者先收口原收据纯读取/actor绑定接点，并协调shared企业投影currently-unavailable分支的最小契约/消费者窗口，本片未改Platform或Shared。

PM后继要求的确定窗口提案（仅设计，公共改码权未开放）：先开两份源码——新增Core纯函数文件`apps/api/src/modules/rental-core/rental-corporate-maturity-receipt.ts`，集中原deterministic audit ID与`readCorporateCreditMaturityEvidence(log, ledger)`；修改原`customer-corporate-settlement.service.ts`的`maturityId`/`maturityReceipt`委托、`recordMaturity`收据写入，以及`readMaturity`/到期准入对同一decoder的消费。decoder无Auth/IO/事务/当前配置，不生成到期日，仍复用原Shared收据类型；营运operator/staff财务门闸、原idempotencyKey/operationLog/ledger锁不改。

旧记录兼容提案：核原ID/action/tenant/customer/workspace/order/正债权ledger/currency/原金额/basis，original audit `userId`须与detail.recordedBy一致，历史操作人后来停用不否定原审计。`createdAt`是可信审计时间，旧detail.recordedAt保留原文并分别标来源，不要求毫秒相等、不编时钟误差阈值。新写入以一个原服务端Date同时写detail.recordedAt与OperationLog.createdAt，增加JSON内审计绑定版本后严格复核；不改Schema、不批量改旧审计。缺userId/createdAt或actor/主体矛盾是已有收据不可核验，不补当前人/当前时间、不当作未核定；只有确定原核定行不存在才明确未核定。未知绑定版本不按legacy忽略。

企业投影后续单独确认窗口：`rental-enterprise-read.port.ts`新增按当前企业finance资格的单ledger原核定读口，取本空间原正债权及真正企业承担订单，复验原客户会话/权限修订；Shared `core.ts`中只扩maturities安全分支和审计来源元数据，消费者/DTO/OpenAPI由PM指定唯一作者。不借operator身份，不把整个客户账或历史空间开放给当前企业会话；原收据中的自由财务原因/操作键不直接进入企业页面。缺完整事实返回unavailable，未核定单独表达。本提案没有实施这些公共/企业改动，也没有修改原测试。

正式账单仍无确认的生产者：当前schema只有企业invoice资料、债权ledger及渠道`PaymentReconciliationLine.statementStatus`，后者不是企业账单；原任务归ECP-10/CLOSE-CORP-VERIFY及原CORP-SETTLE账务接点。历史跨空间授权事实仍仅当前原订单主体/会话空间，不能以会员空间或新租赁allowlist补范围。原payer/guarantee只认可原订单主体、membershipSnapshot及实际资金/供应商记录；混合承担和保证金专用读源未接，继续unavailable，不造账单/账户或改营运授权。

<a id="exchange-photo-core-recovery-20261112"></a>

## 照片完成失败、失应答与过期原来源恢复（2026-11-12）

从已核GitHub的`5983acd3af5c3457dade88fc32515c9a2efc493f`接续，本片未改生产源码或原测试/断言。照片四个生产模块与固定`e2a1a2b9ddc209e763c9bf050eceafbfa1be872d`逐文件Git差异为空；前置正式检查准备/本人同意/原K/C执行合同仍见`0947a6eb82cd1e725073131dc11f78a0fc94bf49`的[原Core阶段](#approved-exchange-core-port-20261111)。交付该固定照片源码及必要前置，不拿本树配置修订/只读合同替代照片依赖。

原七组Core恢复调用现已退出0、audit 0，唯一[阶段证据](../../output/category-governance/exchange-photo-core-recovery-final-20261112.json)保留原调用摘要、源码/fixture及命令hash、首次失败与最终结果。实际Core/media/FileStorage服务参加，SQL/Auth/配置/库存/事务和对象传输仍为明确替身，不证明真库、供应商、HTTP/DI或宿主。

已验证：完成收据写入失败时文件/来源完成状态一起回滚，保留原占用和冻结目标；撤权不再请求对象，订单修订变化不能完成或重传；PUT失应答后即使暂存已变，只GET原冻结字节恢复；Core已经提交但返回丢失时按原收据读取、不再IO；没有原冻结意图仍unknown，不重读暂存或PUT；原目标在票据过期后缺失也不能分配新目标/重传。同一次过期检查保留completed来源原键可读且无再次派发。没有换原键、删冻结依据、改业务期限或补造费用/企业批准，原K/C恢复边界不变。

时间替身最终采用原生OriginalDate的Proxy：仅无参构造和now使用指定时间，构造返回原生实例，保留prototype/parse/UTC，finally恢复global.Date。之前缺TS注册的加载失败，以及继承Date/内存SQL时间原型与structuredClone结果不一致造成的末组比较失败，均已缩为阶段证据的失败摘要；没有删改原断言或为了夹具修改生产代码。原分段计价fixture hash `24a8c79d3fa686a9291e3c9acdbf55c1e42d326a970ab7f8a5a761f70c18a0fa`、原文件fixture hash `0c4a7a211d869575ca88c9a4988a16cef85698861438acd77d72177003089d69`不变。最终清单固化后，4份本片重复尝试JSON按hash核对删除；8份退出日志/缓存与任务目录已删除，暂存路径不存在，只保留唯一阶段证据及定向文档检查结果。

原5组正常消费与本7组恢复分开留证；两者不关闭完整CAT-GOV/CLOSE/ECP验收。企业作者继续独占本人photo GET/DI/受权Blob和准备面板接线，真实事务/存储/权限及宿主仍待原门槛；本树转回品类同源定义、历史动作、所有写入口及08存量采用主线，不等待17接点回收或新增模型执行许可。

<a id="core-failure-read-ports-20261112"></a>

## 履约已记录问题与原九项开业的只读来源（2026-11-12）

从已核GitHub的`61fece91ae007ed42b02b7c96c1f1ab0d1b0140e`接续，源码检查点`fe65ac652076d5bed4c9ca439d50b563c61d17aa`已普通推送并回读任务远端一致，PM明确的分配服务/业务服务窗口仅新增无副作用读取合同。没有改原扫描、问题登记、配置持久化或九项判定，没有接入Outbox参加者、改变人工经营事实、生成Client、改事件Schema或调用模型。此前配置行修订源码仍固定在[配置阶段](#configuration-row-revision-core-source-20261112)。

[分配服务](../../apps/api/src/modules/rental-core/rental-allocation.service.ts)的`readRecordedFulfillmentIssue(tenantId, orderId, tx)`必须使用调用方原事务，复用原事实仓储的订单可见范围并前后核对ALS。它只返回原订单ID、真实assignment修订、订单更新时间/起租时点/地点及已登记问题标记，不返回自由问题文本或完整分配资料；缺订单/问题、非待履约阶段、非法修订/时间不补来源。读取不调用`scanOrder`/`recordIssue`、不锁新资源或开事务，不重新计算实时可交付，也不从分配偏好编临近履约阈值。ResourcePorts须结合正式政策和当前授权判定捕获，缺项保持not_captured。

[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)的`readTenantReadinessSource(tenantId)`在业务写锁外调用原`readTenantReadiness`→`renderTenantReadiness`，保留原九项结果；只增加读取起止窗口、`independent_persisted_reads`声明和存在时的真实品类绑定ID/采用修订，前后复验绑定及范围。旧显式legacy宿主不补绑定ID或版1；该结果不宣称事务快照，不写配置/事件，不取代原[Core配置行来源](#configuration-row-revision-core-source-20261112)。原只读调用者继续使用原方法和结果形状。

| 验证 | 实际结果与边界 |
| --- | --- |
| API类型 | 原tsconfig的`--noEmit --incremental false --pretty false`退出0，见[原入口核对](../../output/category-governance/core-failure-source-original-checks-20261112.json) |
| 原分配/开业读取 | `node tests/rental-allocation.test.cjs`退出0、原14个断言通过；`node --test tests/ai-native-ain08-opening-read.test.cjs`退出0、17项通过，没有改原用例/断言。仅该两份原入口，不覆盖前片开业配置13项的5过/8失败 |
| 新读取合同限定调用 | [原fixture限定调用](../../output/category-governance/core-failure-source-bounded-20261112.json)退出0、5组通过：原事务问题及重复读取不改修订/不扫描写入，缺问题/非法修订不补来源，迟到范围变化/外租户原行拒绝；开业合同保留原九项和独立观察、旧宿主不补绑定，最后一次绑定变化拒绝。实际Core服务参加，原fact/query/事务为明确替身，不解释SQL或证明真实Auth/DB/政策/捕获/模型执行 |

原离线preload、固定不可用DB URL及同一任务暂存/缓存，audit 0。两个原fixture与输入/输出在清单可追踪，没有新增测试脚本。验证进程退出，11份本片日志/缓存及2个任务目录在证据固化后删除，原暂存路径不存在。本片源码尚未编入原863文件API包，不沿用该包作新接点证据；完整品类/AI/CLOSE门槛不变。

下一接点：AI作者在其ResourcePorts消费原事务问题读取及锁外开业来源，先排除在`recordIssue`里重入扫描/另开业务事务的锁环。`persistBusinessConfig`仍只有价格子段共用事务，不提前捕获其余配置尚未提交的九项状态。Core可选参加者尚未接入，需要明确其当前政策/授权、无副作用读源、原事务写入及失败处理；读取可用不等于已捕获，不补默认临近政策/资源ID/修订或让模型改变配置、资源与资金。

<a id="configuration-row-revision-core-source-20261112"></a>

## 配置行修订与原开业读取来源（2026-11-12）

从已核GitHub的`ec42c7bdc7e87628ecedd345009b7405982b0044`接续，源码检查点为`5e8d52325b37cf6b613c103b2e291b25843e35ec`，已普通推送并回读GitHub任务分支一致。PM明确指定[配置仓储](../../apps/api/src/modules/rental-core/rental-core-config.repository.ts)、[快照仓储](../../apps/api/src/modules/rental-core/rental-state.repository.ts)和[原回填](../../apps/api/src/modules/rental-core/rental-snapshot-backfill.service.ts)的独占窗口。本片只改这三份Core源码及既有记录/接续，服务端Schema/DDL归AI作者；未修改AI/企业/照片模块、公共入口、Shared、原测试或正式任务。

`TenantRentalProfile.configurationRevision`和`RentalCoreStateSnapshot.configurationRevision`的最小合同均为数据库`Int`、初始创建/结构迁移存储值1，合法范围1～2147483647。它们是各自原行的修订，原`configVersion`品类字符串和快照`state`正文保持原意；不能将字符串/JSON强转修订，读取缺列、缺行或不合法值不补1。发生实际修改时在原写事务内读取当前修订并CAS递增，饱和拒绝修改；相同内容、非默认档案空update及重复回填不凭空增版。结构迁移产生的1只表示开始跟踪该当前行，不证明任何历史报价/品类版本。

已核写入口：默认档案在`upsertProfile`原事务内维护正文/修订；非默认空间保持兼容档案create/空update，自己的显式档案与`saveCoreState`共用快照行CAS。普通快照继续保留已提交的显式档案，只按原绑定更新标记；实际快照正文变化才增加该行修订，不将它当作全部规范化配置的总版本。比较在MySQL中对JSON作二进制比较，避免大小写变化被数据库排序规则忽略；相同档案保留原编辑时间。回填和Seed仍只补缺失兼容档案，回填复验实际存储修订，既有行不覆盖。没有复制/生成Client，本树Schema未改，真实执行必须先由唯一作者应用这两列及DDL。

[原Core开业配置读取](../../apps/api/src/modules/rental-core/rental-core.service.ts)的`readOpeningConfiguration`已经透传仓储结果，本片不改Service：`profile.configurationRevision`及`profile.configurationSource`分别来自当前默认档案行或本空间快照行，来源值为`TenantRentalProfile`/`RentalCoreStateSnapshot`；`settingsRevision`位于读取结果顶层，来自原经营设置行，设置正文及原单位/方式规范化合同不变。缺档案仍为原`profile:null`，不能为签名补来源。原九项判定唯一在[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)的`readTenantReadiness`→`renderTenantReadiness`：workspace_profile、accounts_roles、fulfillment_network、business_rule、business_calendar、item_groups、pricing_groups_rates、price_version、membership_base。没有另造readiness算法，也不把九项独立读取称为单事务快照。

| 验证 | 实际结果与边界 |
| --- | --- |
| 当前API类型 | 原tsconfig的`--noEmit --incremental false --pretty false`退出0，当前三份源文件hash见[最终核对](../../output/category-governance/configuration-row-revision-final-checks-20261112.json)。首次设置修订误放正文造成类型失败，已改为原读取元数据层；[首次类型证据](../../output/category-governance/configuration-row-revision-types-20261112.json)保留 |
| 原配置空间范围 | `node tests/config-workspace-scope.test.cjs`退出0，原3项通过；未改原断言，见[原配置核对](../../output/category-governance/configuration-row-revision-checks-20261112.json) |
| 当前开业来源限定读取 | 原开业fixture的3组限定调用退出0：保留品类字符串/真实数值修订、拒绝缺失/字符串/非法/超范围修订、只投影两种来源并不读取聚合。见[读取证据](../../output/category-governance/configuration-row-revision-reader-20261112.json)。实际Core/config读取参加；fixture只返回指定查询行，不解释SQL，不证明真实授权、DDL、事务或AI签名 |
| 原开业整组 | 原入口`node --test tests/ai-native-ain08-opening-configuration.test.cjs`退出1，13项5过/8失败：原元数据fixture未提供新增行修订，原风险读取2次与旧1次预期仍失败。原[失败及输出](../../output/category-governance/configuration-row-revision-final-checks-20261112.json)保留；未弱化读取、改fixture/断言或记整组通过 |
| 命令及检查范围错误 | 首次整组额外注册ts-node使编译后的JS再次被当TS检查；改回原自注册入口。限定读取首轮正则误把`JSON_EXTRACT(cs.state,...)`当作裸聚合列，改为仅检查真实裸列/全量SELECT后复验；原失败仍在上述清单。没有改原测试脚本 |

上述有效Node使用原离线preload、固定不可用DB URL、本树同一暂存和写缓存，audit 0。验证进程已退出，2450份本片日志/缓存及5个任务目录在证据固化后逐文件/空目录删除，原暂存路径不存在；只保留上述最小清单，没有复制产物。API产物仍为原863文件照片构建，本片配置修订源码尚未编入，不拿旧包验证新来源。配置写入的正常/无变化、并发CAS、饱和、失败回滚和重放仍缺真库证据；本片不计原CAT-GOV/CLOSE完整结项或提高待核实百分比。

PM后续另准[分配服务](../../apps/api/src/modules/rental-core/rental-allocation.service.ts)的`recordIssue`原事务参加者，以及业务配置/九项源的最小窗口。源码已确认`persistBusinessConfig`只有初始价格计划/价格版本共用事务，其余配置分别写入；`readTenantReadiness`是独立读取。不能在持业务锁时重新调用`scanOrder`或开新业务事务捕获，也不补临近政策/默认阈值。后续先提供无副作用的原来源合同并核AI参加者/ResourcePorts，缺事实/政策/授权保持not_captured；这两处参加者尚未在本片接入。

本片照片完成收据失败/失应答恢复命令未取得有效业务结果：外层工具定位/传递失败，原历史日志的普通读取又被在用文件锁阻断，均不计通过。实际暂存发现一次被离线守卫阻止的目录外写入尝试；递归清理被自动审批以`blocked by policy`拒绝后，已用同一PowerShell入口逐文件/空目录安全回收并核实，见[失败观察](../../output/category-governance/exchange-photo-core-recovery-2-20261112.json)。原5组照片消费证据不变，恢复仍待下一限定调用；没有读环境、启服务、真实DB/存储或合main。

<a id="evidence-original-location-20261112"></a>

## 旧证据唯一原稿的跨树现行链接（2026-11-12）

按PM本次明确安排，只修复两份开发记录中25份旧JSON的26处现行引用；原文已由`86c356619570aa083b937d93fff9c58c92e4d500`保全。实际Git登记确认主仓库为`D:/工作文件/rental-OS`，固定合入提交`ca1c6a9fca1bfe8c9aa8465b4eed88189a17501f`可读取，没有追活动主树施工。

这25份JSON是主仓库`output/category-governance`中的唯一跨树原稿，本树当前链接明确指向该位置，逐个核对为普通文件且可读取；未复制证据、运行产物或环境。Core记录使用`../../../../output/category-governance`，品类记录使用`../../../../../output/category-governance`；本树新增照片消费/构建证据仍使用本树原目录。历史两份附件缺失保留，链接修复不代表业务或历史附件验收。

原`validate-docs`按“不得离开当前工作树”将这26处显式跨树引用列为`link-outside`，不会自动变绿；本次沿PM授权对固定唯一原稿作单独路径/普通文件核对，不修改检查器或通用规则。PM收回文档至main时须按main文档所在目录恢复仓库内相对路径，并复核仍指向同一原稿；不能直接照搬本树跨树层级。当前业务进度、原任务和其他WIP不变。

<a id="exchange-photo-core-consumption-20261112"></a>

## 换货照片的 Core 完成与本人读取限定消费（2026-11-12）

从已核 GitHub 的 `5c755c64920217328cea504acde2c19c19296759` 接续，工作树/暂存区干净，无 merge/cherry-pick，恢复后未发现本任务验证残留。沿[照片源码检查点](#exchange-photo-freeze-20261111)复用原分段计价与文件 fixture，本片没有修改生产源码、测试文件/断言、公共登记或正式任务。

实际 Core/预览/准备、专用影像、本人同意和文件服务参与5组限定调用：影像经一次暂存 GET、唯一目标 PUT、目标 GET 完成，原键重复调用不再请求字节；原准备接受该原来源并记录唯一消费，本人从该准备读取精确照片字节；IO期间撤销原客户、改变原订单修订，以及跨空间请求均被拒绝。`boolean false` 检查值保留，没有补造费用确认、企业批准或执行成功。

命令使用原离线 preload、固定不可用数据库 URL、同一任务暂存和 TS 优先解析，退出0、audit 0。原初始化 Call ID、5组输出、源码提交与边界见[消费清单](../../output/category-governance/exchange-photo-core-calls-20261112.json)。原 SQL/Auth/配置/库存/事务和对象传输为明确替身；本次证明服务限定消费，不证明真实数据库权限/事务、对象存储、HTTP/DI、页面或微信宿主。Core完成收据失败与失应答的恢复应用尚未在本次5组中验证，沿原完整门槛继续核对。

两份既有 fixture 的SHA-256保持：分段计价 `24a8c79d3fa686a9291e3c9acdbf55c1e42d326a970ab7f8a5a761f70c18a0fa`，文件 `0c4a7a211d869575ca88c9a4988a16cef85698861438acd77d72177003089d69`。证据已固化，暂存删除、验证进程退出；API仍为[当前固定构建](#exchange-photo-freeze-20261111)的863份受管文件。本片不提高CAT-GOV/CLOSE/ECP百分比或完整结项，不合main、不执行真实环境。

<a id="exchange-photo-freeze-20261111"></a>

## 换货照片的原内容冻结与核对接点（2026-11-11）

本片从已回读 GitHub 的 `2a2c9ae647c55343fb6f39a6e73e12e7489c0c54` 接续，源码检查点固定 `e2a1a2b9ddc209e763c9bf050eceafbfa1be872d`，已普通推送并回读 `codex/rental-core` 一致。在唯一工作树保全原照片 WIP及未验接点；没有合 main、修改企业内部实现、公共登记或正式任务。四份源文件哈希与下列行为及类型清单一致；检查点不代表完成应用/本人照片消费者或真实验收。原 CAT-GOV/CLOSE/ECP 完整门槛及百分比保持。

[文件生产者](../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)复用原 v2 的 `blob` 暂存路径和冻结格式：读取有界实际字节并验证图片，先同事务保存唯一冻结目标，再向该目标 PUT 并读回原内容摘要。失应答后的 `reconcileExchangeInspectionUpload` 只 GET 已保存目标，不重读暂存、不重传或分配新目标；目标缺失仍不可用。冻结证据同时核对来源、摘要、大小、类型和尺寸，读取期间文件/会话或配置变化拒绝。旧非受控暂存路径在读取字节前阻断，原记录不重写。

[Core 原来源读取](../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.read.ts)保留初始绑定，并识别同一原完成占用对应的冻结中/已完成文件；[完成服务](../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.service.ts)仅首次获确认的占用执行暂存读取和 PUT，其余调用核对原目标。正式完成、Core 来源结果与当前订单修订仍在原事务复验。[本人同意服务](../../apps/api/src/modules/rental-core/rental-exchange-inspection-consent.service.ts)新增 `photo` 接点，只允许原本人会话、当前订单和指定准备哈希中的已接受照片，文件 IO 前后复核原客户、材料、订单及照片来源；只返回有界字节和摘要，缺文件供应拒绝。该本人读取接点尚无正常 HTTP/DI/页面消费证据，不写全链通过。

| 验证 | 实际结果与边界 |
| --- | --- |
| 既有文件 fixture 的限定调用 | 5组退出0：一次 GET/PUT/GET 冻结、过期后只读原目标、完成与精确字节/坏元数据拒绝、PUT 成功但失应答的原目标恢复、缺目标不另写。实际 FileStorageRuntimeService；原内存文件/会话/配置/事务及对象传输是明确替身，未证明真实存储或事务。见[清单](../../output/category-governance/exchange-photo-freeze-bounded-2-20261111.json) |
| API 类型 | 原 tsconfig 的 `--noEmit --incremental false --pretty false` 退出0，四份源码哈希与行为清单一致。见[类型](../../output/category-governance/exchange-photo-api-types-2-20261111.json)。首次类型核对时仍为旧API包，不将它作新行为证据 |
| 当前 API 构建 | 从固定`3efc62884b303c3c0127e9aeb578cb9ece9d9b3e`完整编译，含照片源码检查点`e2a1a2b9d`；863份JS逐文件哈希一致，只更新四个照片模块，其余859份原产物、Shared正式出口/租赁合同和Client schema/归属文件哈希不变。见[固定构建清单](../../output/category-governance/api-build-photo-e2a1a2b9d-20261111.json)。audit 0、暂存已删除；仅本树研发产物，不是HTTP/DI/本人照片正常消费、真实库/存储、宿主或正式发布验收 |
| 原文件生命周期整组 | `node tests/file-storage-lifecycle.test.cjs` 退出1，`:567` 在会员替身缺合法空间品类时先报“已存品类编码缺少兼容解释”，尚未运行后面的专用照片断言。原失败唯一位于主树 `output/category-governance/exchange-photo-file-lifecycle-original-2-20261111.json`；此前证据目录不存在的保存失败不计验证通过。测试/断言未改 |
| 首次限定调用失败 | 原专用计划使用文件名暂存键，不符合原冻结校验器的 `blob` 格式，导致冻结后回读拒绝。见[原失败](../../output/category-governance/exchange-photo-freeze-bounded-20261111.json)。修复生产者路径后仅复验相关调用，没有放松原冻结校验或修改夹具 |

以上 Node 沿原离线 preload、固定不可用数据库 URL 和单一任务暂存执行，audit 均为0；证据先保存，随后暂存删除，验证进程已退出。既有文件 fixture SHA-256 保持 `0c4a7a211d869575ca88c9a4988a16cef85698861438acd77d72177003089d69`。没有读取环境、启服务、连接真实库/存储、执行迁移或开放生产。Core 完成应用的真实事务、本人照片正常读取/HTTP/DI和浏览器消费仍须原条件验证。

四份记录/接续的首轮定向链接检查退出0，检查300链接、本片8链接及6个照片阶段锚点；与固定开工版本逐项新增问题0，见[文档清单](../../output/category-governance/exchange-photo-docs-20261111.json)。当前本树仍有28处旧链接缺失：26处指向25份已集中于主树 `D:/工作文件/rental-OS/output/category-governance` 的旧清单，逐个核实主树文件存在；另2处历史附件缺失保留。旧清单不复制回工作树填绿，按此唯一位置读取，本片新证据仍在本树同名目录。补充唯一位置后的9个本片链接/8个阶段锚点另作最终核对；上述结果不等于四册无缺失或完整文档验收。

原11组 Core限定调用没有另造测试文件：fixture 来自[既有分段计价测试](../../tests/rental-exchange-segment-pricing.test.cjs)，原命令保留在会话日志 `C:/Users/Penn/.codex/sessions/2026/11/09/rollout-2026-11-09T12-28-01-01a1be90-2a5b-77a2-a995-66f3d56e96f2.jsonl` 的21325～21690行。初始化 Call ID `call_zEFTQ6XYui52iwluruhJtMjd`，实际执行 `call_JnWueM6RWqsHPxqnP0SUHINi`，原K/TTL回读 `call_L6GHSu9L1uIljNOWsUkHup30`，汇总 `call_Cqw0R96teXxkcq8Ci3eGEg43`；原交互会话9008已退出，不能当活进程重启。企业参与者在该原调用中是明确替身，企业作者需消费实际 `prepare/commit/replay`，不将其当企业完整业务或独立审查证据。

<a id="approved-exchange-core-port-20261111"></a>

## 企业换货执行与原收据 Core 接点（2026-11-11）

固定源码为 `0947a6eb82cd1e725073131dc11f78a0fc94bf49`，位于 `codex/rental-core`，已普通推送并于2026-11-11 21:09 +08:00回读GitHub任务分支一致，按负责人委托已交企业作者消费。该片从当天已核 GitHub 的 `dfb65aabb` 开始，仅提交16份 Core/租赁合同及增量迁移；照片冻结后续三份 WIP 未夹入。按负责人最新安排，每个可独立验证的阶段交固定 SHA，由 PM 串行收回 main，不等待两个完整正式任务。本片不更新 CAT-GOV/CLOSE/ECP 的完整结项或估算百分比。

[执行服务](../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts)提供 `execute`、`executeInTransaction` 和按原键读取的 `original`。前者拥有原事务，第二个复用企业应用的外层事务；[企业参与合同](../../apps/api/src/modules/rental-core/approved-exchange-transaction.ports.ts)的 `prepare/commit/replay` 使用同一个事务和不可替换的绑定。参与者不提供价格或检查授权；[Core核验](../../apps/api/src/modules/rental-core/rental-approved-exchange-authorization.ts)独立读取本次批准、本人原费用确认、具体检查同意、订单修订和当前企业/非自审资格。原币种、库存、领取检查、交付 Hook、服务、额度及差额继续由原 Core 决定，保证金变化缺正式支持时拒绝。

[本人检查同意](../../apps/api/src/modules/rental-core/rental-exchange-inspection-consent.service.ts)提供 `material/confirm/original`，沿原 ClientAuth/ALS 和本人订单谓词；安全材料不带完整价格/规则正文、商户原因或存储凭据。费用确认不能替代具体检查同意。商户执行仍使用原营运 Auth 和当前范围，不把客户身份改成 operator。批准消费、正式换货、Core原幂等记录和持久 K/C 关联在同一事务提交；提交失应答、实例重建及批准旧 TTL 到期后仅核原收据，不重新报价、换键或重做。原键读取从服务器保存的原请求恢复，无须客户端缓存自由原因。

[租赁合同](../../packages/shared/src/rental-exchange-inspection-preparation.ts)沿既有总出口供给类型及 `rentalExchangePreviewComparable`/`rentalExchangeExecutionBasisComparable`。比较仅排除本次查询时点及生成说明，保留金额、单位、日历日期/倍率、来源版本和原历史分段；没有价格保证或执行授权。企业作者应在其 `EnterpriseExchangeApprovalService.priceBasis` 消费同一合同，避免旧“只去 effectiveFrom”比较让相同价格的一分钟后试算失效。本片未改企业服务、页面、总出口、AppModule/Guard或公共 OpenAPI 文件。

[照片接受](../../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.read.ts)核对原来源、内容冻结、字段/模板/意图、当前订单修订及唯一准备使用关系；暂存对象即使已有一次 GET 哈希也不可接受。[原来源读取](../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.read.ts)保留初始绑定，完成结果另读不可变对象。`0947a6eb8` 的专用上传生产者尚未接内容冻结，因此必需照片路径继续不可用，不用测试冻结行冒充真实照片完成。后续冻结/原目标核对正在 `file-storage.runtime.service.ts` 和两个 Core media 文件施工，未验证、未包含于此固定片。

两个新增迁移仅提供照片使用/本人同意与原换货执行关联，未执行；Prisma schema/Client未改。HTTP/DI及企业最终提交、事务参与者和消费者仍由 PM 协调各自唯一作者；本片可供其固定消费，不能计作企业换货全链或正式宿主通过。

| 验证 | 实际结果与证据 |
| --- | --- |
| Shared/API/Admin/网站类型 | Shared完整编译退出0，仅对应租赁合同 JS/声明改变；三个端 noEmit退出0。见[Shared](../../../../output/category-governance/approved-exchange-shared-20261111.json)、[三个端类型](../../../../output/category-governance/approved-exchange-final-types-20261111.json) |
| 实际服务限定调用 | 11组通过，覆盖实际报价/Core/准备/同意/政策/幂等、同事务消费、原键/TTL、未知、撤权、坏C、币种/保证金及收据失败；SQL/Auth/配置/资源、已批准行和事务/时钟为明确替身。另保留两次本次调用准备失败：变量尚未声明、共享模板引用被重复添加照片字段；补正调用数据后通过，未改原测试/断言。见[限定调用](../../../../output/category-governance/approved-exchange-behavior-20261111.json) |
| 原换货五项 | 3过/2失败，退出1，无skip/todo。`:232`的会员替身缺合法空间品类，先报“已存品类编码缺少兼容解释”；`:328`的Controller夹具未装配原预览服务。原测试、Controller及身份文件未改 |
| 静态契约 | 路由649条退出0；全域DTO覆盖32项问题，新增三个DTO没有对应失败；全域API契约476项，与固定已编译基线逐条新增/移除0。旧415/507结果留历史，不能覆盖当前 TS 优先读取结果。见[契约与原冒烟](../../../../output/category-governance/approved-exchange-contracts-smoke-20261111.json) |
| 固定 API 构建 | 完整编译`0947a6eb8`退出0，863份JS、13份变更及其余原产物哈希核对一致；三份工作区照片WIP从固定提交读取，不编入该包。Shared/Client保护哈希不变，audit 0、暂存删除。见[固定构建](../../../../output/category-governance/approved-exchange-build-0947a6eb8-20261111.json)；这是本树受管研发产物，不是部署或照片/HTTP验收 |

以上 Node 均使用原离线 preload、固定不可用数据库地址和单一任务暂存，audit 0；暂存、交互验证进程已退出删除。第一次长组合命令被自动审批拒绝且未执行，随后分小步验证/清理成功；原 CLI `NODE_OPTIONS` 参数错误退出9亦保留并已清理。没有读取环境、启服务、访问真实库/供应商、安装依赖、合main或开放生产。两份media文件的暂存版本逐字节匹配已验证哈希，再提交固定片；活动冻结代码保留原位，不reset或覆盖。上传与企业交接按固定SHA登记，main集成由PM处理。

四份记录/接续已定向核289个本地链接、44个片段，新增问题0，原两份历史附件缺失保留；初次误判历史缺失为新增的检查结果也保留在 `approved-exchange-docs-20261111.json`，按原固定基线核对后的结果为 `approved-exchange-docs-2-20261111.json`。文档格式退出0，没有改正式需求/任务或以局部绿色判结项。

<a id="enterprise-read-current-workspace-20261111"></a>

## 企业当前空间的历史与财务读接点（2026-11-11）

按PM指定的ECP-09/10必要Core依赖交付。唯一树为`D:/工作文件/rental-OS/worktree/rental-core`、分支`codex/rental-core`；本片开工及实际远端为`f548a88788d9bdccc717dc19d7c0c2004c8ce5da`，已有两份本任务Core/领域合同WIP接着收口。实现固定提交`527e731c88bf104a963b1a21e3723b829a585edc`已普通推送，2026-11-11 13:25 +08:00回读GitHub任务分支一致；没有合main。没有修改企业作者的订单回读、AppModule/OpenAPI、后台政策或内部审批窗口；原CLOSE与CAT-GOV任务、百分比及分母保持。

[RentalEnterpriseReadPort](../../apps/api/src/modules/rental-core/rental-enterprise-read.port.ts)直接复用[原企业资格服务](../../apps/api/src/modules/client/enterprise-access.service.ts)，并在读取前后复验原客户ALS、个人身份、会话、当前可信空间、企业管理关系及逐动作授权。构造器明确供应原[资金服务](../../apps/api/src/modules/rental-core/rental-funding.service.ts)与[企业结算服务](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)；缺供应保持不可用，不提供恒真授权回调、不生成operator/staff身份。

| Core出口 | 实际结果与边界 |
| --- | --- |
| `historicalWorkspaceBasis` | 读取当前可信空间的原企业承担、或具原告知依据的企业优惠自费订单空间事实。覆盖明确为`current_trusted_workspace_only`；历史跨空间权威授权来源未接，不从新租赁白名单或请求space数组自授权限 |
| `orderFinancialProjection` | 仅原企业承担订单；原Tenant父锁→订单→企业账务锁，ReadCommitted。复用原实款余额、完整ledger与payment/allocation/reversal校验，现金和逐单核销分开，不增加一份收款收入；拒绝流水范围不一致，模拟/未核实现金保持不可用，投影不含私人付款工具、操作人或自由原因 |
| `corporateFinancialProjection` | 复用原账户摘要，不另算总账。租户级账户涉及其他空间或无可授权空间的历史事实时不可用，不返回当前空间小计冒充全账户；缺授信配置先读原ledger，有历史事实则待核对，仅两者均缺才显示未配置 |

[Shared领域合同](../../packages/shared/src/core.ts)新增`RentalEnterpriseHistoryWorkspaceBasis`、`RentalEnterpriseOrderFinancialProjection`、`RentalEnterpriseCorporateFinancialProjection`，沿原`core`正式出口复用，没有改总出口文件、身份/Guard或schema。**该端口尚未接HTTP/DI**，企业作者需按固定合同装配并验证自己的消费者。正式账单没有实际供应源；财务核定到期和保证金仍缺企业专用读取接点，分别保持unavailable。保证金/账单缺口仍归原CLOSE-GUARANTEE、CLOSE-CORP-VERIFY/CORP-SETTLE，不以本片代替完整验收。

实际验证使用本树原离线preload、固定不可用数据库地址及单一任务暂存，没有启服务或连接真实数据库：

| 验证 | 实际结果 |
| --- | --- |
| Shared正式产物与API类型 | Shared完整编译202文件、API noEmit退出0，audit 0；仅更新`core.d.ts`和另一声明的`currency`字段排列，运行JS未变，Client schema hash未变。见[类型/逐文件清单](../../../../output/category-governance/enterprise-core-read-types-2-20261111.json) |
| 当前源服务短调用 | 9组通过、退出0，原Core端口/企业资格/资金/结算服务参与；现金、核销、冲销、缺配置历史、无授信、跨空间来源、权限撤销及个人订单拒绝覆盖。SQL、会话与存储为明确替身，业务写入0，不证明真实资格/锁或并发。见[行为证据](../../../../output/category-governance/enterprise-core-read-behavior-20261111.json) |
| 原企业授权测试 | `node --test tests/enterprise-portal-access.test.cjs`退出1，7项6过/1失败；`:99`加载原workflow schema时，VM依赖替身缺`@rental-os/shared`。断言/测试未改，失败保留，不写整组通过 |
| 当前API构建 | 完整编译退出0、857份JS逐文件一致，仅新增本端口产物；Shared原收据模块与Client受保护哈希未变，audit 0。见[构建清单](../../../../output/category-governance/enterprise-core-mini-build-20261111.json)；客户构建及源码安全失败唯一记在[品类阶段](品类治理/品类治理-开发记录.md#client-receipt-runtime-wip-20261111) |

首次Shared核对因声明文件变化超出预定范围而停止，API检查未执行，未移动产物，见[原失败](../../../../output/category-governance/enterprise-core-read-types-20261111.json)。随后定位为另一声明的字段排列及本次新领域类型，核对完整本树产物后再验证。递归清理组合命令曾被自动审批返回`blocked by policy`，未执行且无具体理由；之后按已核定任务文件逐项删除并核实，无新增残留。所有本片临时构建、声明、缓存和日志已固化最小证据并删除，未安装依赖、读环境、迁移、合main或开放生产。

收口定向核对四份记录/接续269个本地链接、44个片段，新增问题0、两处旧附件缺失保留；格式检查退出0，证据为`output/category-governance/enterprise-core-read-docs-20261111.json`。Core端口源码hash与行为/构建清单一致，任务暂存不存在。正式依据、原测试与其他作者窗口未改。

本片可交付当前空间读依赖，历史跨空间、正式账单/核定到期/保证金、HTTP消费者、真实事务/宿主及独立Review继续未完成。原CLOSE完整门槛及CAT-GOV的两个动态编码/不同组合冻结经营没有新结项，不估算实现百分比。

## 当前收款方式与原收据的Core接点（2026-11-11）

原CLOSE-MONEY-VERIFY与品类治理的共用证据见[收款方式阶段](品类治理/品类治理-开发记录.md#offline-payment-current-admission-20261111)：登记/资金提交读取当前空间设置并持锁，原收据先于新准入；父锁先于员工登记/订单锁。API类型、原资金算法与当前服务短调用通过；原企业账务27项1过/26失败，既有Tenant父锁查询夹具未登记，未改测试/企业实现。真实事务、供应商和完整账务门槛仍缺，不更新原CLOSE进度。

## 历史检查依据的Core接点修复（2026-11-11）

CLOSE-INSPECTION-VERIFY与品类治理CAT-GOV-04共用实现证据：[历史检查阶段](品类治理/品类治理-开发记录.md#historical-inspection-source-20261111)。旧订单缺复制快照时，从同空间/同品类版本的关联原报价恢复字段和R0引用；缺资料不套当前模板，替换商品本批继续用原换货独立依据。API编译/原资源与关闭门禁/实际服务短调用退出0；原换货检查6项5过/1失败，查询夹具和真库/宿主缺口保留。不把这一修复计成CLOSE完整验收，不更新原百分比或扩大其他CLOSE任务。

<a id="core-resume-20261110"></a>

## Core恢复研发与原CLOSE核实入口（2026-11-10）

负责人通过PM正式下发Core研发；唯一树`D:/工作文件/rental-OS/worktree/rental-core`、分支`codex/rental-core`、开工及实际远端SHA为`859ad9abdccd017de3dd24bf7767ffb16a311a7a`，开工工作区/暂存区干净，无merge/cherry-pick。持续目标主线为CAT-GOV全部收口，原CLOSE十二项单独核实及必要接点单独交付，不移转任务或进度。本轮前像由该Git提交保全；旧树目录删除不再接续。

首片修复品类初始化/当前配置链，证据唯一见[品类治理阶段](品类治理/品类治理-开发记录.md#core-resume-20261110)，不作为CLOSE结项。当前无本树独立依赖及运行产物，共同工具链由PM协调；禁止新增/扩写测试脚本，仅既有定向冒烟、短命令及必要类型检查。

原CLOSE表保持2026-10-18口径，不把“待验收”写为实现齐全。已对当前[Core订单服务](../../apps/api/src/modules/rental-core/rental-core.service.ts)、[业务服务](../../apps/api/src/modules/rental-core/rental-business.service.ts)、[资金服务](../../apps/api/src/modules/rental-core/rental-funding.service.ts)、[企业债权](../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)、[支付适配](../../apps/api/src/modules/integrations/payment.runtime.service.ts)、[到期作业](../../apps/api/src/modules/rental-core/rental-due-job.scheduler.ts)及对应域合同做首轮静态复核，结果如下；不是全链或真实环境验收，不新增分数。

| 原CLOSE任务 | 当前可定位的实现 | 完整门槛与当前缺口 |
| --- | --- | --- |
| CLOSE-MONEY-VERIFY | 原支付意图、验签回调、原键查询/退款与Core资金事件路径仍在 | 本轮未跑取消/核减后到账、跨支付单超收、分笔/并发退款及供应商恢复；旧观察不能直接视为当前通过 |
| CLOSE-CORP-VERIFY | 债权占用/结转、总回款与逐单allocation、原回款冲销读取在原企业结算服务 | 原账空间/财务权限、FIFO/历史债权、并发回款及订单总账勾稽未实测；账单/指定订单需求依原任务 |
| CLOSE-USAGE | `createInspection`记录分配项读数/基线，`correctInspectionUsage`保存修正 | 已核的归还费用输入仍仅逾期/损坏/早退/承运调整，未接完整实际用量补退裁定；联合基线修正及变更去重仍缺 |
| CLOSE-WAIVER | 原发生项、事故时点/依据、初审金额及客户承担上限；`selectDamageWaiver`只解释冻结快照 | 未形成结构化责任/排除、同发生项累计额度和取消后历史有效区间的完整合同链；不能借当前服务或默认上限补旧事实 |
| CLOSE-INSPECTION-VERIFY | 检查、异常审核及客户确认/申诉，关闭前共用`inspectionClosureError` | 连续申诉/核减上调、原上限保护、缺真实响应补录和并发事务仍须原真库/客户场景 |
| CLOSE-NONRETURN | 已核关闭入口仅允许已归还待结算，资源/费用/资金域可复用 | 未在已核入口找到责任→非实物处置→争议/补退→特殊结案的完整接线；不以普通归还关闭替代 |
| CLOSE-OFFRENT | 普通换货、异常裁定与费用审核已有原链 | 实际停租区间、责任、冻结减免及租金/服务/运输分别裁定的完整链未找到，不直接按换货完成计分 |
| CLOSE-VEHICLE-AFTER | 当前Core关闭门禁、费用与保证金事件仍可定位 | 已完成后追加费用、保留/到期释放、通知及申诉闭环未找到；地区/合同依据继续待核，不推定保留天数 |
| CLOSE-GUARANTEE | 押金与预授权事件区分，资金解释保留历史未核验标记 | `readOrderExplanationFacts`明确返回`no_verified_provider_preauthorization_port`；真实冻结/转扣/释放/过期/对账仍缺，不能以内部事件替代 |
| CLOSE-SAFETY | 当前资格检查及车辆/工程资产已填写有效期的校验存在 | `assetValidityError`缺日期仍不拦，资格由已发布规则控制；四品类法律强制/高风险要求及地区映射未完整核验 |
| CLOSE-NOTICE-VERIFY | 到期作业注册原通知重试，任务按job/tenant/workspace命名锁组织 | 失败补录、关闭、冷启动、多实例与生产模拟禁止均未在本轮运行；受理/送达/已读事实仍须区分 |
| CLOSE-QUARANTINE-VERIFY | 分配项、分批归还、处置/工单及缓冲门在原Core/事实仓储 | 混合库存、多预占/同资源多异常、无法定位时本批保守隔离与恢复的原真库结果未取得 |

企业/AI接点另核：企业ECP-07/08消费已有[批准订单事务](../../apps/api/src/modules/rental-core/approved-order-transaction.ports.ts)的prepare/commit/recover/replay，原企业批准服务把消费与Core订单放同事务，未发现需要重建订单事务接口。ECP-09/10财务读取有实际接入缺口：`financialAccount/listLedger`仍要求营运人员财务身份，[客户资金入口](../../apps/api/src/modules/client/client-api.service.ts)先检查本人订单，资金解释只支持operator/staff。企业管理员须经其专用企业授权获得Core最小订单/资金/债权投影，不能自造营运身份或放宽本人入口；当前缺接点由PM协调合同与唯一作者。实际预授权仍不可用，不能补零或供应商成功。

本轮不改企业策略/审批或AI runner，不新增共同入口。非当前关键路径CLOSE保留原依赖，通用单件/数量新品类链不因此引入用量/车辆专用前置；CLOSE证据与CAT-GOV进度分别维护。

## 1. 既有基线与未完成分类

原任务登记：MONEY/CORP/INSPECTION/NOTICE/QUARANTINE为“待验收”，USAGE/WAIVER为“进行中”，NONRETURN/OFFRENT/VEHICLE-AFTER/GUARANTEE/SAFETY为“未完成”。这些是2026-10-18原记录，不是本次重验结果；原任务未提供可靠百分比，不估分。

- 用量仍缺实际结算、基线联合修正、补退审核和分批/续租/换货完整去重。
- 免赔仍缺结构化责任/范围/累计额度、有效区间和重新裁定的完整业务；事故字段已有接线不等于合同全链完成。
- 特殊结案、故障停租、车辆后发现费用、真实保证金和安全准入仍须逐项实现/验证，不用普通归还和模拟资金替代。
- 原“待验收”任务须先查缺实现与缺证据；历史回归、源码已存在或接口可见不能认定全部交付。

## 2. 共用阶段证据唯一来源

2026-10-30～31跨后台/API/AI的活动修复已有统一作者和记录，本册引用而不复制另一套修复队列或状态表：

- [平台原业务缺口分类](../管理后台/管理后台-开发记录.md#当前业务闭环缺口分类2026-10-18)：原CLOSE关联范围。
- [完整63项活动审查基线](../管理后台/管理后台-开发记录.md#review-63)：35个CORE问题及共享授权/资金问题，完整反例、处理与存量恢复边界保留在现行记录，不是历史废弃项。
- [企业债权与订单资金勾稽阶段](../管理后台/管理后台-开发记录.md#core-019-stage)：来源会话提供的CORE-019实现与离线结果；不等于真MySQL/实际保证金/存量账务全部验收。
- [平台开发记录](../管理后台/管理后台-开发记录.md)：已有换货、续租、归还、服务、授信、FIFO、资格等完整阶段及日志；本次原有WIP全文保留。
- [品类治理记录](品类治理/品类治理-开发记录.md)：CAT-GOV版本及动态品类证据，不计入CLOSE完成。

原任务末尾的`AdminLoginHighlightDto`全量契约问题仅是2026-10-18观察。本轮没有重跑契约检查，不据此认定仍在或已修复；不把旧观察继续写成开发任务的当前现场。

## 3. 四册补齐（2026-10-31）

负责人授权main文档规范化。原Rental目录README吸收到需求/接续，原文见[归档清单](历史归档/四册整理/2026-10-31/manifest.json)。补需求、记录、接续，在任务中补职责链与原12项验证映射；不更改原CLOSE编号/范围/顺序/状态/验收，不新增研发分母。

本轮未修改业务代码、执行业务测试/类型检查、启服务、读环境、连库、迁移或发布。各项实际验收仍按原要求及后续明确授权；本轮只做文档链接、结构、原内容保留和归档哈希检查。

## 4. 后续维护

新增完整功能阶段在所属原记录保留唯一证据，跨专项用链接关联；记录实际命令、退出码、原键/事务及真实/替身边界。最近一个月保留近期阶段，超期先归档原文，未解决事项仍留当前摘要。原未知WIP、失败日志、隔离产物不因补册清理。
