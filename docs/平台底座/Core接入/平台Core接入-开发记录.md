# 平台 Core 接入开发记录

建立日期：2026-10-31。

> 本册记录 PCH-01～12 拆分阶段的成果、缺口和证据。研发进度由原任务门槛核收，当前写入范围和下一入口由协作接续维护。[开发任务](平台Core接入-开发任务.md) · [协作接续](平台Core接入-协作接续.md)

## 1. 依据与来源

- [需求v1.5](平台Core接入-需求.md)、[开发任务v1.5](平台Core接入-开发任务.md)。
- [接口与生命周期设计](平台Core接入-开发任务.md#contract-design)、[接入指南](平台Core接入-开发任务.md#integration-guide)：正式设计与接入路线，实际实现、验证层级及发行状态从本册固定阶段读取。
- 历史版本与原始接入设计见[初次修订前像](历史归档/需求澄清/2026-11-09/manifest.json)，现行依据使用上述v1.5正文。各次修订前像沿对应阶段固定Git引用。
- 原[AI Native通用SaaS未来方案](../未来规划/平台底座-通用化与开源方案.md)继续保留，承接关系已标注；原文与入口修订前像见[方案基线](历史归档/方案基线/2026-10-31/README.md)。

<a id="core-rental-customer-governance-20261118"></a>

## Rental客户治理、合并与头像单源（2026-11-18）

固定父版f9d3233bfa0622193f079ef9ca65bfa6f6202170已普通推送并实际远端回读。本片由RD继续客户闭包，dev1通知目录/台账和dev2订单页面按约定路径在制；公共出口、主提供者、资料及索引仍由RD负责，订单包配置在制差异按内容单独保留。

[客户治理](../../../packages/rental-core/src/mysql-customer-governance.ts)、[合并/注销检查](../../../packages/rental-core/src/mysql-customer-merge.ts)和[经营分析](../../../packages/rental-core/src/mysql-customer-insights.ts)成为Rental包内唯一实现，[私有参加者](../../../packages/rental-core/src/customer-governance-ports.ts)只供给实际消费的MySQL表、同一主档/状态写入者和注销检查。原平台目录三个路径变为Nest接线或正式再导出；公共身份SystemUserRow从platform-contracts取得，业务合同从同一Rental定义取得，当前ALS从公共request-identity使用。

主档/会员按租户共享，原空间/地点、本人订单、敏感资料/审计权限及资料返回字段保持。账号与会员状态独立，状态/历史/CAS、企业授权失效及租户父锁→客户锁顺序不变。合并仍只写原映射、被合并状态和历史，不迁移订单/资金引用或合并会员权益；注销沿原全租户在途订单、租金/押金/预授权、待退款、风险和授信事实核验，缺注销检查继续拒绝，人工确认不能绕过真实阻断。

[头像实现](../../../packages/rental-core/src/mysql-customer-avatar.ts)与[两条原HTTP](../../../packages/rental-core/src/http-customer-avatar.controller.ts)归Rental。原路径转接同一类，[主HTTP提供者](../../../apps/api/src/modules/rental-core/rental-http.providers.ts)以useExisting绑定同一头像实例。保留原位图内容/5MB、路径限制、参数化SQL、I/O后当前记录复验、失败新文件清理及生产未装配受控存储拒绝；没有因抽包开放新的本地写入回退。SDK新增七个私有/HTTP子出口，领域根合同继续不加载ORM或文件系统。

静态逐项对照原父版，治理35、合并6、分析1、头像5及头像HTTP2，共49个方法/函数正文一致；只调整归属、引用、构造参加者与Nest别名。头像上传字段、原2个HTTP方法及装饰器保持。

一次必要冒烟进程21528退出0、stderr空，使用实际TypeScript产物、原Nest薄接线和从主提供者源码抽取的实际别名：同一注销/头像实例、缺注销能力拒绝、原全租户在途角色检查、阻断前不写状态、CAS0拒绝、脱敏与跨租户拒绝通过。头像格式拒绝、原管理URL/返回头、读取时替换拒绝、SQL失败后清理以及生产拒绝通过。SQL、对象字节/文件I/O均为明确fixture，10次原raw-query回调，Nest context已close，磁盘写入/真实网络0。

复用原[customer-insights](../../../tests/customer-insights.test.cjs)三用例，3通过/0失败/0跳过/0todo。只更新两处实际源码与依赖定位，并补原夹具缺失的getRequestIdentity及可信用户标识，全部assert调用保持。补夹具前在父版原服务复现相同TypeError，未将其解释为搬迁新增业务失败；没有执行customer-operations/customer-merge-closure的真库脚本或读取其.env。

必要类型沿实际配置及官方Prisma5.22 WASM/generator在内存取得238模型/35枚举、31,201,337字节声明。先核Rental七个正式根618源0诊断，再以真实SDK声明核原六个提供者/Controller根1839源0诊断，最终进程43540退出0、stderr空。公共合同11根205源、Core合同36/220、Core宿主8/210、公共服务97/916、Rental305/1099、shared130/367、MCP59/495，全部声明生成0诊断且无磁盘产物；其中通知源码仍为作者在制，不将本片视为其完整阶段验收。

前几次检查保留失败：4784在作者新增通知源码缺正式公共合同时退出1；2692核出本片shared局部类型导入漏项和内存声明方案的composite/incremental冲突；17060缺Core宿主实际声明，产生五条跨rootDir诊断。已补真实类型导入及声明依赖，隔离编译不写buildinfo、产品tsconfig未变；没有过滤诊断、放宽类型或改原业务规则来变绿。

dev1所需[通知合同](../../../packages/platform-contracts/src/notifications.ts)单源迁入原五项声明，根合同及[原shared/infrastructure](../../../packages/shared/src/infrastructure.ts)兼容再导出，字段/联合类型与父版相同。公共 /notifications 台账出口已由RD在工作区登记，原通知服务/仓储及该实现等待作者完成必要冒烟后另片固定；不能将模拟通知登记解释为真实发送。对应SDK/模块导读及API说明v1.26同步，五份资料1628链接/169锚点0问题，限定格式检查随精确提交核验。初次文档核对在1000ms工具上限超时并重置内核，改为30秒上限并缓存锚点后同范围通过；未创建临时文件。

按原G1～G4复核，PCH-04所有audience入口和撤权范围仍须齐套，PCH-05排空/历史执行依赖与PCH-06事件/作业/回调的真实接点及可实施合同仍未复核齐，本片不据局部迁移提高百分比。Rental其余企业治理/结算、标准装配、数据/迁移/Seed、其他页面/端、AI和作业继续；无Core实际运行、干净安装、多真实Core、独立升级回退及完整验收仍无本片证据。新增永久测试脚本0，本片验证worker全部退出、临时文件/Client/dist输出0，两个既有残留仍沿原待清理清单受阻。

<a id="core-public-file-ledger-20261118"></a>

## 公共文件台账与原集成委托（2026-11-18）

dev1已明确停写并固定公共台账、原集成服务/仓储及原安全用例四路径，RD核定字节后登记同一 `/files` 出口并收口资料。固定父版9c5ddeef527cfff65fec715b494e73395ee10917已普通推送、真实远端回读一致；订单在制源码、其正式出口/导航及主按钮接线另片保留，不夹入本次文件阶段。

[FileLedgerApplication](../../../packages/platform-server/src/modules/files/file-ledger.ts)持有原租户内文件列表、受保护投影与模拟元数据。真实业务权威通过当前范围键和filterReadable供给，存储等待后保留原复核；缺权威拒绝列表。原[IntegrationsService](../../../apps/api/src/modules/integrations/integrations.service.ts)委托同一实例，保留原模拟列表Map/初始数据和创建日志。原[仓储](../../../apps/api/src/modules/integrations/integrations.repository.ts)转接createSimulationFileAsset，当前租户、字段/默认/原标识、日志错误传播与原专用场景拒绝保持。公共模块没有Rental枚举，业务排除场景由宿主传入。

模拟元数据继续在原应用入口拒绝生产模式，实际对象上传沿FileStorageApplication原键/冻结/激活链。日志失败不删除已经写入的原事实，不将模拟返回解释为对象已上传。公共元数据投影不返回storageKey/publicUrl；实名客户、承运空间/订单、知识及专用证据继续沿真实Rental/AI参加者裁定，台账登记不取得额外业务权限。

作者报告公共台账、原完整文件生命周期、集成安全/内存隔离及原HTTP的SQL/内存创建/日志回调冒烟均通过，验证目录与Nest context已清理；本片复用这些已有行为证据，RD未重复整套用例。RD逐项核除台账外的32个服务方法、16个仓储方法及20个模块辅助函数正文，与固定父版相同；原安全用例97处assert调用保持97，只更新实际源码/参加者定位。

RD补核公共 `/files` 正式出口类型。首轮进程39628退出1、九条TS6059均来自把公共合同源码映射到另一个包的rootDir内；没有改产品tsconfig或过滤诊断。随后沿原包配置先将公共合同声明生成到内存，再消费正式.d.ts：进程10068退出0、stderr空，合同10根204源/10声明，文件出口1根596源均0诊断。磁盘Client/dist/shim/临时文件输出0，此证据是SDK类型闭包，不能当作完整API或真实数据库运行。

四份作者成果的固定SHA-256依次为：台账cf9a1acae032b8498d4a16fa1ac403dc84f94819a0bf2779dfceb6cf27f68c72；原服务1e1b09c6e9f991a1db3a2d7501065aa8f72b98ab3c26caf8a2d6e455316b7a75；原仓储672bbed2df03f8660976f61fcc0bbcb8b3fba8b9ea88efb91c00227a18c45324；安全用例f96a53c41e463059d047bdb4c27e740fecf8e330727efadecf93c2216ef235ff。路径顺序见上文与[原用例](../../../tests/integrations-security.test.cjs)，提交前再次核字节身份；Git固定成果作为原文，不另复制保全包。

[文件接入说明](../../../packages/platform-server/src/modules/files/README.md#core-接入)、平台服务导读及API说明v1.25同步正式入口和模拟/真实边界。开发者提供实际存储、业务权威与日志回调即可复用列表，附件仍沿原三步接入。五份本片资料1244链接/167锚点0问题，四份作者成果提交前哈希再次一致；限定CRLF格式检查随精确提交执行。当前完整公共事件/作业与Rental标准装配尚未收口，本片未跨PCH-06下一档；真实HTTP/数据库/对象云、无Core实际运行和完整安装验收继续保留。新增永久测试脚本0，旧待清理残留沿原责任清单受阻，未创建新的依赖环境或业务服务。

<a id="core-public-order-operation-boundary-20261118"></a>

## 公共原操作请求、引用与页头定位（2026-11-18）

固定父版187d93f3ae0b795f1de7f71ef47244a6ac9b63ec已普通推送并实际远端回读；同次GitHub main仍为ba1de9f91860c4e73503eded4e1d05d2307b0e28，已在任务祖先。本片先补dev2订单页面需要的公共接点，订单包及dev1文件台账各自的在制成果按约定路径保留，RD只统一公共出口、装配和索引。

[请求合同](../../../packages/platform-admin/src/runtime/index.ts)新增可选retryAuthentication，明确false沿原单次派发；[公共HTTP](../../../packages/platform-admin/src/runtime/browser-http.ts)在唯一客户端中映射原私有_authRetry标记，并从Axios配置移除公共选项。默认401仍只刷新一次，明确false不刷新后重发；原取消信号、会话代次及500/网络不重试语义保留，不将unknown解释为回滚。

[公共引用库](../../../packages/platform-admin/src/operation-reference.ts)实际迁入原非敏感操作引用算法，[原AI设置入口](../../../apps/admin/src/features/ai-native/settings-operation-reference.ts)改为/forms正式出口的窄转接，保留旧导出、错误标识、1024字符限制及不能覆盖较早未决引用的语义。原两份恢复用例只调整实际源码定位，断言保留，没有新增测试脚本。[公共页头](../../../packages/platform-admin/src/core/CorePage.tsx)在实际已授权动作外层提供当前page.key/action.id两项定位标识，禁用入口可聚焦，原确认/校验/真实Promise和权限复验正文不变；定位不自动执行。

一次TypeScript5.9.3定向检查沿实际配置和只读原依赖运行，进程5284退出0、stderr空：公共runtime/forms/CorePage六根1388源、Rental后台四十一根1460源、旧导航/引用转接十根1535源均0诊断。后两组合包含当前在制订单源码，证明当前工作区类型，不将其视为已提交完整订单阶段。编译配置中的正式包出口只在内存映射同源源码，未生成Client、dist或磁盘shim。

一次原请求/引用冒烟进程34264退出0、stderr空，实际本地TypeScript产物配实际Axios及明确transport fixture。默认请求两次派发/一次刷新，单次请求一次派发/零刷新/原会话失效一次；公共retryAuthentication没有传入Axios配置。引用首次保留、原键读取、禁止较新键覆盖、损坏/不可用存储阻止新操作及原键清除通过，去注释后的迁移前后JavaScript产物相等。首次REPL执行在字符串代码生成阶段被运行环境拒绝，随后沿既有stdin Node入口核验，没有在项目落地新运行器。Tooltip按已安装CLI的6.6.0 info/demo核对原生span触发方式，局部lint为0问题、无跳过、非partial。两份仅改源码定位的原恢复用例分别node --check退出0，未执行其整份业务场景。三份本片资料1141链接/167锚点0问题，稀疏未检目标按当前固定Git对象定位。

旧列表用例第349行要求page-top-gap为var(--space-1)，已在固定main及当前[规范3.3](../../公共技术资料/界面规范/管理后台-界面规范.md#33-间距与对齐)核到pageTop=0；4px属于contextOpticalInset。该问题是旧预期与锁定依据不符，不通过改规范或生产几何处理。原订单用例由dev2按该依据收口，本片没有把其整份失败记为通过。

负责人再次明确其他聊天模型/推理设置由其控制，并要求结束电脑操作黄色边框。RD不再使用要求填写设置参数且校验失败的消息入口，具体依赖与结束各自电脑操作会话的要求写共享接续。两次工具调用均在参数校验阶段拒绝，没有成功发送消息；本片未打开电脑捕获，其他会话结束状态尚未核定。

本片完整交付公共接点及简单接入说明，未跨PCH-07下一档；完整订单装配、Rental标准包与其余原任务继续。新增永久测试脚本、磁盘临时产物和业务服务均0；两个既有待清理残留仍沿原责任清单受阻。本片没有浏览器、真实HTTP/数据库、安装、独立更新或正式验收证据，中文提交普通推送后以真实远端回读核收。

<a id="core-rental-files-http-20261118"></a>

## Rental文件HTTP与原服务别名（2026-11-18）

固定父版f146ce9e18f533fd3b291d57938535157b5da3bd已普通推送并回读。dev1完成原文件Controller、两项专用DTO、有限HTTP参加者和旧路径转接，原入口曾因缺正式包出口受阻；RD登记三个出口、[四项原服务别名](../../../apps/api/src/modules/files/file-http.providers.ts)和AppModule接线后完成必要原入口核验。dev2订单在制成果及其他原消费者用例另片保留，共同索引仍由RD负责。

[文件HTTP](../../../packages/rental-core/src/http-files.controller.ts)保留原列表、上传/完成、清理、下载及实名/承运专用路由，14方法正文与装饰器逐项对照父版一致，包含12个HTTP操作。[专用DTO](../../../packages/rental-core/src/http-file.dto.ts)只含两项原文件描述，公共创建/完成DTO继续来自platform-server；原Staff观察解析正文不变。[有限参加者](../../../packages/rental-core/src/http-file-applications.ts)由宿主供给同一IntegrationsService、FileStorageRuntimeService、Prisma和CustomerOperationsService。原[Controller出口](../../../apps/api/src/modules/files/files.controller.ts)转接同一类，主AppModule只追加这份provider列表，没有重复Controller或第二个存储/清理执行者。

必要TypeScript5.9.3由stdin `node --no-compilation-cache -` 执行，原AppModule及provider两根2393源0诊断，进程38372退出0。当前238/33模型Prisma5.22官方声明留内存，磁盘生成0，stderr空。一次实际Nest入口冒烟19548退出0、stderr空，核原Controller同源、四别名指向原提供实例、列表委托、承运订单/空间及原键传递、实名客户权威先于下载；容器已close。业务方法/SQL/身份仍为明确fixture，磁盘输出及真实网络0，不是完整HTTP或数据库验收。

两专用DTO字段/装饰器与父版一致，原Staff解析未变化；原customer-identity-verification用例仅由作者改三处实际源码定位，全部原断言保留，本片未重复执行整份用例。作者包内SDK冒烟沿原已通过证据复用，原入口缺出口问题由本片接线解除。Rental导读及API说明v1.24同步三个正式出口与简明接线步骤；五份资料定向核1643链接、200锚点与122表格，0问题，三个正式出口/类型映射与原依赖/lock一致。精确暂存只含本片13路径，限定CRLF空白检查沿本片执行。

新增永久测试脚本0，RD本片没有安装、环境文件、磁盘生成物或业务服务。真实HTTP/MySQL、对象存储、完整标准安装及独立审查未验；作者在用验证目录由作者按既有规则退出清理。公共文件台账/其余基础服务、Rental标准主装配和数据/迁移/Seed继续交付，PCH原任务未据本片跨下一档。正式阶段版本由包含本节的Git提交定位。

收尾再次核定两项本会话旧残留：840文件/91,808,304字节环境与1个0字节guard，原生PowerShell只读数量/体积及0链接检查退出0。随后同一原生删除入口被自动审批在创建进程前拒绝，原因blocked by policy；命令内进程/路径复验未执行，没有改用其他工具删除。两份原责任清单已更新最近尝试时间2026-11-18T11:02:22.523Z，当前仍已归集但未删除，未宣称释放空间。本片所有内存类型/冒烟worker已退出，未新增同类环境。

并行订单前端仍在制：dev2报告66组行操作、930单元格及两种表格已对照冻结源码，但整份旧列表脚本在公共壳4px断言与当前0px规范/实现处失败，已保留原断言。RD本片只读取作者状态，尚未复核该固定基线与具体规范条款；本片文件HTTP通过不替代订单阶段核收，该未完项继续由接续承接。

<a id="core-rental-membership-http-state-20261118"></a>

## Rental会员HTTP、客户状态与门户授权（2026-11-18）

固定父版d1884e3cb4d57ed6f22c9762924729d1b30d67d8已普通推送并回读实际远端。RD继续会员闭包，dev1文件HTTP、dev2订单前端及其原消费者用例按共享路径保留，未夹入本片；索引和共同出口仍由RD维护。

[客户状态仓储](../../../packages/rental-core/src/mysql-customer-operations.ts)持有原客户锁、账号/会员状态CAS、状态历史、风险及敏感访问审计，主档写入仍委托同一客户仓储。[门户应用](../../../packages/rental-core/src/mysql-enterprise-portal.ts)持有原开通、动作授予、当前有效关系修订和审计收据。有限MySQL视图留私有适配，平台公共合同不加载这些生成模型。[会员HTTP](../../../packages/rental-core/src/http-membership.controller.ts)与[会员请求验证类](../../../packages/rental-core/src/http-membership-request.dto.ts)使用包内同一声明，门户三类由[对应请求出口](../../../packages/rental-core/src/http-enterprise-portal-request.dto.ts)提供。会员14类与门户3类合计17类，原34个HTTP操作、参数装饰器、字段及验证保持。原Controller/DTO窄转接同一类，[两项HTTP令牌](../../../packages/rental-core/src/http-membership-applications.ts)由[原provider列表](../../../apps/api/src/modules/rental-core/rental-http.providers.ts)以useExisting绑定同一会员和门户实例；原主AppModule继续消费这份列表，不重复登记Controller或业务服务。

对照父版，状态仓储19项、门户8项、Controller37项方法正文一致；34个HTTP方法及17类DTO装饰器/字段对应原源码。根存储与调用方事务使用同一有限存储视图，既有事务实例未换包装。CAS影响0行不写状态历史，成功后按原顺序写历史；敏感资料读取审计独立保存。门户旧操作只回原收据，不重置当前修订或恢复被撤销的动作授予；企业订单和资金仍另核原资格。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 当前类型 | stdin `node --no-compilation-cache -`，TypeScript5.9.3；实际HTTP provider、会员Controller、状态治理/合并和微信认证五根/1903源0诊断，进程11928退出0。Prisma5.22官方内存声明沿当前238/33模型生成，磁盘输出0，stderr空 |
| 一次定向冒烟 | stdin进程40796退出0；真实同源状态类、主体锁/风险、CAS0/1及历史失败传播、独立敏感审计通过。复用原门户修订冲突/已提交键回放一段的全部断言，两项真实Nest别名和Controller共用原实例；跨租户读取0、缺经营空间/缺门户参加者拒绝及DTO同源/合法非法值通过。容器已close，磁盘输出及真实网络0 |
| 首轮与复验 | 初次类型进程26424退出1、一诊断，私有db入口尚未接受原根存储投影；只补同一有限存储类型后复验通过。冒烟33264在加载原完整provider列表时缺Prisma.Decimal退出1；补既有官方SQL运行时Decimal及DMMF枚举后只复验本片，产品源码未因此改动 |

原enterprise-portal-access用例只更新实际SDK源码及依赖定位，保留原断言并核旧Controller正式转接；本次只执行上述原门户行为段，未称整份用例通过。模块导读与API说明v1.23同步正式出口、同实例接线及简明接入步骤。新增永久测试脚本0，没有安装、环境文件、磁盘客户端或业务服务；SQL/存储/事务和认证上下文为明确fixture，真实HTTP/MySQL、浏览器、完整独立装配/安装及审查未验。

PCH-06/08仍需客户治理/合并、事件作业与标准总装配、独立schema/迁移/Seed及全功能消费者汇集，尚未据本片跨下一档。六份资料定向核1652链接、200锚点与122表格，0问题；六个正式出口/类型映射和原依赖/lock一致。精确暂存只含本片20路径，限定CRLF空白检查沿本片执行。最终阶段版本由包含本节的Git提交定位。

<a id="core-rental-membership-application-20261118"></a>

## Rental会员应用与同事务参加者（2026-11-18）

固定父版5d7899af36ef19a298744032389329285cbb2c56已普通推送并读取实际任务远端，已包含的main为ba1de9f91860c4e73503eded4e1d05d2307b0e28。RD收口会员应用、正式出口与资料；dev1文件HTTP和dev2订单前端在制成果按共享路径保留，未夹入本片。负责人再次明确其他对话的模型及推理设置不得由RD或助手修改，调配仅涉及任务和文件边界。

[会员应用](../../../packages/rental-core/src/mysql-membership.ts)持有原注册审核、租户共享会员、空间资质、方案版本与授予、当前企业关系和报价权益的单源逻辑。[私有参加者](../../../packages/rental-core/src/membership-ports.ts)要求同一存储、客户锁/风险/状态、客户主档、统一注册与企业政策；[状态及审计输入](../../../packages/rental-core/src/customer-operations-ports.ts)由所属Rental域唯一声明，生成模型只留私有MySQL接点。原[会员provider](../../../apps/api/src/modules/platform/membership.service.ts)薄适配同一个Core类，保留原五个构造位置及真实直接构造缺省。原[状态仓储](../../../apps/api/src/modules/platform/customer-operations.repository.ts)此片只转接两个输入声明，其实现仍待下一片迁入。原会员Controller、客户、AI候选、报价及订单消费同一实例与合同。

对照固定父版，57项会员方法及三个辅助函数在类型擦除后正文相同；客户锁、当前权限、空间/租户范围、历史快照、原修订与同事务写入顺序保持。原Member/MembershipPlan只解释历史，此流程不作新旧双写。正式 `/mysql-membership`、`/membership-ports` 和 `/customer-operations-ports` 的exports/typesVersions与实际源码对应，依赖/peer与锁文件未变。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 当前类型 | stdin `node --no-compilation-cache -`，TypeScript5.9.3；旧会员provider、Controller、状态仓储及AI候选四根/1890源0诊断，进程33180退出0，stderr空。Prisma5.22官方内存声明为组合238模型/35枚举与公共33模型/14枚举，31,201,345/2,177,556字节，磁盘生成0 |
| 一次会员冒烟 | stdin进程11128退出0，实际旧provider继承同一个Core类；开放企业风险/无风险、客户主体锁缺失、原manual注册缺省及无审核权限写入0通过。存储、锁和事务是明确fixture，网络调用及磁盘输出0，stderr空 |
| 首轮与修复 | 类型进程41904退出1、六诊断；CRLF文本替换漏删五个旧import及原Injectable装饰器。只清除迁入后遗留引用、统一新源码换行后复验本片通过，没有放宽端口或业务规则。后续注释仅说明当前表写入与历史表不双写，行为未变 |

模块导读及客户端API说明v1.22同步实际SDK、参加者和消费者路径；PCH四册沿原门槛维护，本片没有新增永久测试脚本、安装、环境文件、业务服务或磁盘构建产物。真实HTTP/MySQL并发、会员重启恢复、完整Core装配/安装及独立审查未验。PCH-06/08仍缺状态治理、异步接点与标准总装配、独立schema/迁移/Seed，尚未据本片跨下一档。六份资料定向核1889链接、203锚点与121表格，0问题；正式出口、三个原辅助函数及包依赖/锁一致。精确暂存范围只含会员片，限定CRLF空白检查沿本片执行。最终阶段版本由包含本节的Git提交定位。

<a id="core-rental-file-runtime-20261118"></a>

## Rental文件应用与原宿主边界（2026-11-18）

固定父版1e5d23f589237ecd63574d4889e749880f2bdfa6已普通推送并读取实际任务远端；已包含的main仍为ba1de9f91860c4e73503eded4e1d05d2307b0e28。dev1完成文件编排后保留三份已验证字节，RD登记正式出口并同步资料；dev2的订单在制成果按共享边界保留，索引由RD统一维护。其他对话的模型和推理设置由负责人管理，消息工具参数校验失败未执行发送，RD停用该入口，以共享接续协调当前窗口。

[Rental文件应用](../../../packages/rental-core/src/file-application-runtime.ts)持有原创建、原键观察、完成、专用证据、下载及按租户清理编排。正式 `/file-application-runtime` 的JS/声明与typesVersions同源，领域根出口不加载本私有MySQL/Nest适配。原[Runtime](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)仅供给同一存储、配置、Auth/ACL、原知识修订及检查解析器并登记唯一定时器。[AI清理参加者](../../../apps/api/src/modules/integrations/file-ai-retention.participant.ts)保留原政策、同事务确认与unknown收据；失应答只核原对象。公共文件应用的根store只要求本文件能力，业务回调仍取得调用方完整原事务。

RD对照固定父版，38项原可执行正文在类型擦除及精确参加者名称映射后一致。35项归Rental兼容应用，两个定时器生命周期和AI擦除入口归原宿主；原合法任意module/scene、历史缺项、固定Staff tuple及knowledge/unknown仍由真实原权威判断，未新增宽松fallback或收窄旧合法输入。三文件SHA-256分别为Rental应用89e61565354c56927c1968ba76e4ccb68258692c21da87bab9676e9459163780、宿主d3d01d913956e1f6559902cf4e0782de39fdedd912b1f914bf3dd44bfda374db、AI参加者0c7a4407d0abb3f4dc0556f294ab3b7dcced40ed0501849e79ef960062fe310b。

必要TypeScript5.9.3经stdin进程32720退出0，实际Runtime/AI参加者/包内应用三根1885源零诊断。Prisma5.22官方内存声明由组合238模型/35枚举及公共33模型/14枚举生成31,201,345/2,177,556字节，磁盘输出0。正文对照辅助工具初次只处理class声明，未识别装饰器转换的class表达式；改为对实际方法正文独立擦除类型后38项一致，产品源码未改。作者沿正式出口核实际主装配三根2383源及声明单根948源，均零诊断；217份声明仅留内存，原宿主加载的是同一个Rental类。原 integrations-security 用例退出0，仅补三处实际源码读取路径，全部原断言保留；这是原安全静态用例与装配证据，未扩成真实文件业务或HTTP验收。作者明确停写三份Runtime源码及该用例，验证目录已删除，RD未重复扩大测试。

本片同步Rental及原业务导读、公共文件接入和API说明v1.21；六份资料1826链接、168锚点及101表格定向核验无问题。正式出口及声明映射已核，包依赖与原锁文件未变，精确暂存12路径的限定CRLF空白检查退出0；原HTTP字段、权限码及收据状态保持。没有新增永久测试脚本、安装、环境文件或业务服务；真实HTTP/MySQL并发/对象存储、完整标准包安装及独立审查未验。PCH-06/08仍缺完整会员、异步与标准主装配及独立数据/迁移/Seed，尚未据本片跨下一档。最终阶段版本由包含本节的Git提交定位。

<a id="core-rental-client-channels-20261118"></a>

## Rental渠道配置与原HTTP接线（2026-11-18）

固定父版755816bf6b8da1312dc4cca480f96a2aa413453d已普通推送并读取真实远端；main仍为已包含的ba1de9f91860c4e73503eded4e1d05d2307b0e28。RD持有渠道、共同出口/AppModule与四册；dev1的文件Runtime和dev2的订单成果按共享路径保留，索引仍由RD统一操作。

[十五个渠道合同](../../../packages/rental-core/src/channel-contracts.ts)、[十一请求类](../../../packages/rental-core/src/http-channel.dto.ts)、[三渠道Controller](../../../packages/rental-core/src/http-channels.controller.ts)及客户端/官网/微信配置三服务实际迁入Rental包。原shared和API九路径薄适配同一实现；[四个应用令牌](../../../packages/rental-core/src/http-channel-applications.ts)由[原Nest provider](../../../apps/api/src/modules/client/channel-http.providers.ts)通过useExisting供给原配置/图片实例，AppModule只追加同一组别名。发布经营空间、默认服务、官网目录和微信客户绑定属于Rental；品牌/圆角同步写原公共外观事实。通用Core作者沿平台合同使用自身页面/配置，不必实现Rental渠道。

对照固定父版，三服务19/18/7项方法与辅助函数正文共44项相同；只变存储/公共依赖来源与Nest接线。原三个HTTP共八方法的正文/路由/装饰器及十一DTO字段/嵌套装饰器保持。原预读修订比较、Serializable渠道事务、原审计顺序、内容/地址校验、密钥只写不读、AppID已有身份保护与单次凭据测试不变。私有MySQL端口采用当前生成模型的有限Pick，公共Core合同与领域根出口不加载Prisma/Nest/React运行时。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 当前类型 | stdin TypeScript5.9.3，实际provider与三旧Controller四根/1097源0诊断，进程38300退出0。Prisma5.22官方内存声明为组合238模型/35枚举和公共33模型/14枚举，31,201,345/2,177,556字节，磁盘生成0 |
| 原保存用例 | 复用client-channel原两段保存用例及全部原断言，正常保存、跨租户发布/默认服务拒绝、颜色/内容/品类及旧修订拒绝通过；原文件其他十五段未执行。外链DNS使用明确公网解析fixture，未调用真实DNS |
| DTO/凭证/Nest | stdin进程41624退出0；原三DTO出口是同一类，真实class-validator正常请求通过；已绑定AppID更换和SaaS租户写入拒绝，密钥不返响应，凭据仅调用一次fixture。实际Nest容器三Controller/四别名共用同一提供实例，退出close，未监听HTTP |
| 首轮与复验 | 首轮类型3诊断源于使用了不存在的微信出口及错误审计类名，改用原integration-wechat/PlatformOperationLogService后仅复验本片。第一次冒烟26636两段原正文已通过，但Windows loader路径未归一导致同一服务被编译成两个类，Nest别名失败；只修验证缓存路径，复验DTO/凭证/Nest范围，产品源码未改 |
| 边界 | 数据库/事务、审计和微信凭据均为明确fixture。原修订检查的真库并发、真实HTTP/DNS/微信、标准包安装、升级及独立审查未验；没有新增永久测试脚本、依赖、环境文件、磁盘产物或后台业务服务 |

模块导读、API说明v1.20和接续同步正式SDK与真实调用链。四份资料1517链接、162锚点及100表格定向核验0问题；十一DTO类及八HTTP方法/装饰器逐项AST对照父版一致，八个正式出口与源码/typesVersions对应，依赖/peer/meta与lock未变且一致。精确暂存26路径后的限定CRLF空白检查退出0。PCH-06/08仍缺完整异步/回调、会员及标准主装配、独立schema/迁移/Seed；按原门槛尚未跨下一档，阶段版本由包含本节的Git提交定位。

<a id="core-public-record-kanban-work-orders-20261118"></a>

## 公共详情/看板与Rental养护页面（2026-11-18）

固定父版 f252100c2196334c581048704f1296aebf2a365d 已实际推送并回读，三人按共享树路径分工施工。RD抽取公共呈现，dev2完成养护页后停写并交付；Runtime和公共文件存储类型属于dev1下一片，订单新文件属于dev2下一片，精确暂存保留这些在制差异。

原详情布局/展开、22份看板/来源及构建适配共27文件实际迁入[platform-admin](../../../packages/platform-admin/README.md)。25文件原SHA-256相同，包含全部保留运行时、CSS、JSON及来源；两处实际适配为Bridge的同一语言Context相对路径，以及详情布局的品牌/页头/内容栈扩展。原布局/返回/事实分组和看板交互保持，旧入口窄转接，旧CSS类通过composes复用公共同名样式。公共 `/ui` 正式供给详情/内容栈、事实/可选展开、QueryState、内容切换、列表控件和看板；`/vite`登记原严格看板适配一次，原后台移除重复登记。CorePage增加当前对象标题/摘要及动作图标、danger、pending和等待文案，仍由当前页/权限及真实Promise决定行为，原Arc spinner/success与vendor没有改写。

[Rental养护贡献](../../../packages/rental-core/admin/work-orders/README.md)持有列表、看板、详情/历史/处置及六类表单，声明rental:work-orders/work-order-detail两页。原营运入口供给实际Auth、经营空间、当前权限及旧深链接；原api/rentalCore对应十二方法转接同一工厂。页面从公共CorePage、useCoreForm和UI接入，双入口提交共用同一Promise，校验完成后再次核当前对象/弹窗/会话。原 navigation 通过纯 `/admin/work-orders/pages` 出口读取路径、双语页名和分组，原 AppRouter/AppShell 消费同一 APP_ROUTES；旧 URL、图标、权限码及 history 参数不变。兼容权限表由页面声明单源供给；前端所需平台/React/路由/Query/antd/图标同伴依赖和 lock 同步声明为可选，领域根出口不加载它们。标准Core授权映射与完整组合仍是后续入口。

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 公共必要类型 | stdin实际TypeScript5.9.3，platform-admin 295根/2563源0诊断，进程36012终态退出0，磁盘输出0 |
| 公共一次呈现冒烟 | stdin进程8408退出0；实际CorePage/ActionButton/详情/严格看板适配核动态页名/摘要、图标/danger/pending、当前撤权与卸载拒绝、同一确认及命令Promise、原返回/内容栈、原hash及坏归档拒绝。React/权限为明确fixture，无DOM或网络 |
| 无Core内存构建 | Vite8.2.1实际公共应用，进程26072退出0：4产物、11008模块、7,368,193字节，未引入apps/admin或shared业务源码，磁盘输出0。首轮因只读主树依赖未定位antd/Tailwind CSS而失败；仅补验证映射后复验，产品源码未改 |
| dev2必要类型 | 当前正式出口/tsconfig下，公共合同10根/204源、Rental前端十三领域出口13根/220源、Core合同36根/220源、Rental前端10根/1419源及原后台654根/4315源均0诊断。130份JS/声明内存产物已释放，磁盘生成0 |
| dev2一次原冒烟 | node --no-compilation-cache --test tests/admin-work-order-board.test.cjs退出0，原4组、0skip/todo；保留流转/排序/退出与原键盘断言，仅调整真实源码定位，新增重复提交和迟到校验断言。首次2!==1复现两个提交入口各发一次请求，六表单改用同一公共useCoreForm后相关复验通过 |
| 请求与组件 | dev2 stdin对照固定父版的十二方法/16输入、原Promise身份及四读取取消信号通过，退出0；作者Form lint与RD ActionButton/CorePage两文件antd lint均0问题、无partial/skipped |
| 最终导航接线 | 原 navigation 和养护适配两根加八个原 ambient 声明，10根/1574源0诊断，进程40788退出0、磁盘输出0；原4组冒烟在补正式 pages 依赖定位后进程42036退出0，全部原断言保留、0skip/todo。首次定向类型漏原 ambient 声明产生80诊断，仅补原 d.ts 后复验通过 |
| 兼容 CSS | Vite 内存实际编译旧 CSS 与公共 CSS，两模块/两产物/2278字节，九个类全部包含公共同名类，进程30312退出0、磁盘输出0。PostCSS 仍给出缺 from 选项告警；当前两份 CSS 无资源 URL，本片未据此改写原插件 |

呈现冒烟首轮CSS-module fixture缺ES模块身份，RecordDetailStack的className读为undefined；补fixture后只复验同一冒烟通过，没有修改产品样式。当前源码与模块说明、正式出口、能力索引可发现路径和简单接入步骤同片核定。六份资料定向核1622链接、180锚点和103表格，0问题；25份原稿摘要保留，两包依赖/peer/meta与lock一致。正式出口与实际源码定位一致，精确暂存64路径后的限定CRLF空白检查退出0。

本片没有新增永久测试脚本、安装、环境文件、业务服务或磁盘构建产物。浏览器/窄屏/实际动作动效、真实HTTP/数据库、标准Rental授权与完整安装未验。原PCH-07仍缺发现/安装与版本管理UI及完整宿主验证，06/08仍缺统一数据/事件作业合同与标准总装配，未据本片提升原任务百分比。正式版本由包含本节的Git提交定位。

<a id="core-rental-enterprise-file-binding-20261118"></a>

## Rental企业回款文件绑定（2026-11-18）

固定父版 bfa75b23ea406af522888a235a120ee9ab6c21b0 已核实际任务远端，main ba1de9f91860c4e73503eded4e1d05d2307b0e28 已包含。dev1 完成约定两路径后停写，RD核实其字节、正式出口及资料后统一提交；公共呈现与dev2养护页面的在制成果另片保存。

[企业绑定参加者](../../../packages/rental-core/src/file-application-enterprise-payment-proof.ts)持有原创建准入、完成绑定、metadata投影及重放比较。原[Runtime](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)仅对应四块委托；四块AST逐项一致，其余34个方法、构造依赖及装饰器AST保留。专用企业入口供给服务端原订单依据，客户端metadata不能覆盖；其他旧合法module/scene与历史回执继续兼容。

作者用既有stdin离线入口完成一次真实 EnterpriseWorkflowsController→Runtime→参加者冒烟，dev1-enterprise-payment-proof-final-consumer-check退出0、stderr空、守卫无违规。实际三根消费者1889源及新入口声明单根922源均0诊断。涵盖创建/完成/原键、客户端伪造依据覆盖、上传者/空间/对象修订及当前grant撤销拒绝、原冻结摘要、PUT失应答后freeze_pending保留原键/对象、TTL后只读原目标完成、不同checksum拒绝及其他旧合法场景兼容。首轮TS2304为移除仍被原下载拒绝使用的场景常量导入；恢复原导入后只复验上述范围通过，没有新增业务规则。

RD回读停写源码SHA-256与作者证据一致：Runtime dcbdd7a44dcfd5a0846373cac8d4874ff95e4fb95253cb1e12c4711e7c1557ba；参加者52af7524661d0003dc8b1e99fb82ba5465cfd56ff76fa136eae32f0a77334823。正式exports/typesVersions同源，依赖与lock未变。模块导读、API说明v1.19和接续同步实际入口；五份资料1501链接、160锚点及98表格定向核验0问题，限定CRLF空白检查退出0。

作者output/.tmp/dev1-enterprise-payment-proof已删除，短命Node已退出，无新增永久测试脚本。数据库、当前政策及对象传输是明确fixture；真实HTTP、MySQL并发、对象云和微信未验。原PCH门槛尚未跨下一档，完整Rental主装配、数据/迁移/Seed、AI/作业与各端继续交付，正式版本以包含本节的Git提交定位。

<a id="core-rental-wechat-file-readers-20261118"></a>

## 微信客户认证与Rental文件读取（2026-11-18）

固定父版56d8b970aa82dfdf9f9114bddc134fc524993aee已核实际任务远端，main仍为已包含的ba1de9f91860c4e73503eded4e1d05d2307b0e28，暂存区空，无合并/拣选。RD持有微信与共同出口/资料，dev1完成三文件后停写；固定原文从父版读取，不重复复制。负责人已明确RD统一调配dev1、dev2共用本树；dev2独占Rental养护工单前端及对应API方法，公共组件、CorePage、配置、装配、schema、四册及索引仍由RD维护。

[微信客户认证](../../../packages/rental-core/src/mysql-client-wechat-auth.ts)及[私有参加者](../../../packages/rental-core/src/client-wechat-ports.ts)归Rental；[受控运输](../../../packages/platform-server/src/modules/integrations/wechat-mini-program.adapter.ts)归公共服务。原两路径分别供给八项原Nest依赖和再导出同一运输/错误类，AppID缓存、原一次凭据刷新、当前会话绑定和客户注册规则保持。

[企业凭证/检查字节](../../../packages/rental-core/src/file-application-rental-evidence.ts)与[员工原键观察](../../../packages/rental-core/src/file-application-staff-observation.ts)归Rental，原[Runtime](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)四个公开方法薄委托，私有企业字节方法也归包内。当前上传者/空间、原冻结内容和完整字节、企业HTTP读取前后授权、受控检查输入及迟到stream释放均保留；观察不给续签或重试依据。其他创建/完成、知识及专用权威由原参加者继续处理。

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 微信固定正文/类型 | 对照父版，两组各9个方法/辅助函数正文完全一致；TypeScript5.9.3实际8根/2375源0诊断，进程37864终态退出0。Prisma5.22官方内存声明由238/35与公共33/14生成，31,201,345/2,177,556字节，磁盘输出0 |
| 微信一次冒烟 | stdin进程35300终态退出0；同一运输/错误类、AppID缓存、一次凭据刷新、同一客户和当前会话、跨App水印写前拒绝、其他客户冲突不覆盖、已登录code错误400且不重试。private call与事务为明确fixture，真实HTTP/DNS未执行 |
| 作者文件类型 | dev1-rental-file-readers-targeted-types退出0；四个真实消费者根1901源0诊断，新包两根声明654源0诊断，最后Runtime构造清理只复验单根1862源0诊断 |
| 作者一次原消费者冒烟 | dev1-rental-file-readers-accepted-smoke退出0；实际Nest/原Runtime五Staff tuple、原键/原始body拒绝/撤权/旧凭证/PUT unknown链，企业两角色原HTTP读取涵盖上传者/空间/原hash、超限/不完整、文件和申请返回前复验及缓存头 |
| 原检查消费者 | 原ai-native-inspection-media-submission三个相关用例正文复用，实际受控S3 producer、取消后迟到stream关闭、原evidence→Runtime→冻结输入3/3通过，0skip/0todo |
| 固定映射及未通过范围 | 五个迁入方法按端口/owner类型映射AST相同，其余34个Runtime方法完整AST未变。临时S3域名断言漏桶前缀，按实际签名修正；检查fixture补原238模型DMMF。额外API声明输出试跑曾报85项本片外导出诊断，该扩展范围未通过，不与本片定向类型混称全绿 |
| 清理与未验 | 作者output/.tmp/dev1-rental-file-readers已删除，离线守卫无网络/.env/越界写事件；RD全部编译/冒烟内存输出，无新增永久测试脚本。真实HTTP/MySQL并发/对象云/微信宿主、完整安装与独立审查未验 |

RD核定三个停写源码sha256依次为Runtime 7ad37b79e5da0b0901a9bfb9d32dcc91c30ad5b05a2b31bf8fa55b0174db438d、rental-evidence 0e807818c5d1ccf9fb1a0543c9e7133e2429a94df8bd27b3701a9b5e39df93f8、staff-observation 9c79abd2829e7eeae1c057a8d0dd1a02720c2ea92579dde939a7001a13f57826，与作者固定证据一致。两包五个正式子出口/typesVersions同源；依赖未变，lock不改。[公共模块](../../../packages/platform-server/src/modules/integrations/README.md)、[Rental导读](../../../packages/rental-core/README.md)、[原业务入口](../../../apps/api/src/modules/rental-core/README.md)及[API说明v1.18](../../公共技术资料/接口说明/客户端-API说明.md)同步实际入口。七份资料定向核1839链接、166锚点及100表格，0问题；五个正式出口、实际源码与typesVersions对应，两包依赖/peer/meta与lock一致。出口检查首轮误把合法的./前缀差异视为不等，更正检查后通过，产品源码未改。限定CRLF差异在本片精确暂存前核收。

本阶段按原PCH门槛复核仍未跨下一档；完整Rental标准装配、数据/迁移/Seed、各端/AI/作业及安装更新验收继续交付，不按迁入文件数提高进度。阶段版本以包含本节的Git提交定位，普通推送后读取实际远端。当前施工窗口及未完项由接续唯一维护。

<a id="core-rental-staff-http-20261118"></a>

## Rental员工认证与附件HTTP（2026-11-18）

dev1完成共享树中约定的11个Staff/共用DTO路径后明确停写，RD统一包出口、AppModule、资料、索引与提交；原文由固定父版694ae834323669fffd584d2b8f5137fdda7da178保全。[员工认证](../../../packages/rental-core/src/http-staff-auth.controller.ts)与[附件HTTP](../../../packages/rental-core/src/http-staff-uploads.controller.ts)实际归Rental，旧两个Controller只再导出同一类。[观察合同](../../../packages/rental-core/src/staff-upload-observation.ts)为纯声明，原shared兼容再导出，Ajv/schema与原始body解析仍由原宿主供给。

[实际Staff接线](../../../apps/api/src/modules/files/staff-http.providers.ts)以useExisting复用原Auth、Prisma及文件；缺原检查权威时绑定仍拒绝。7个认证方法固定staff audience，员工不因此取得营运或其他Core权限。上传/完成两DTO从公共/file-dto复用同一运行时类，原Auth DTO转接同一类；字段、装饰器、校验顺序保持。五组tuple继续核地点、交接阶段、本人上传、原键/检查及原冻结对象，原始req.body额外selector即使被whitelist剥离，也不能变成合法请求。

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 作者类型终态 | 原验证进程终态回收为2360源/0诊断/退出0；正式exports/typesVersions落盘后仅复验实际2根/2369源，0诊断/退出0，不补进程内出口。RD客户片的AppModule 7根/2370源也覆盖本片实际接线 |
| 一次原消费者冒烟 | dev1-staff-http-original-consumer-smoke经stdin退出0；实际Nest application context核Auth/Prisma/Storage均为原同实例，7个Auth方法固定staff及原异常，7+5 HTTP路由和参数DTO元数据逐项对照父版相同 |
| 原上传与拒绝 | 五tuple经原Runtime及实际Rental ACL核创建/完成/下载/原键观察、历史缺metadata兼容、权限/地点/会话撤销、事务回滚、PUT失应答后只读原冻结对象；真实ValidationPipe剥离原始body多余selector后仍拒绝，缺检查参加者拒绝及bind原方法透传通过 |
| 固定正文 | 原7+10方法、共用DTO字段/装饰器、原Ajv/parser/schema一致。仅注入解析器、私有请求/公共owner类型替换；原权限、SQL选择条件、状态、原键、期限与副作用不改。RD重复定位核7个Auth正文完全一致、上传10正文除两处类型及解析器引用外一致 |
| 清理与限制 | 作者限定CRLF空白检查退出0，output/.tmp/dev1-staff-http已删除，无网络、环境文件或越界写守卫事件。数据库/并发、文件提供者为明确fixture；真实HTTP、MySQL并发、微信宿主和对象存储未验，无新增永久测试脚本 |

六份同片资料定向核对1752链接、162锚点及98表格，0问题；四份只调整源码定位的原脚本经node --check均退出0。两包依赖/peer/meta与锁文件一致，12个新正式子出口与源码/typesVersions逐项匹配，39路径限定CRLF空白检查通过，正式需求/任务与固定父版原文保持。本片与[客户认证/HTTP](#core-rental-client-auth-http-20261118)共同收口。[Rental导读](../../../packages/rental-core/README.md)、[原业务导读](../../../apps/api/src/modules/rental-core/README.md)、[公共文件说明](../../../packages/platform-server/src/modules/files/README.md)与接续同步实际入口。PCH-06/08的完整标准主装配、授权等价映射、数据/迁移/Seed及事件/作业/回调仍未完成，本片不替代原整项验收或提高原进度。固定阶段提交以包含本节的Git版本定位，普通推送后回读实际远端。

下一窄窗口已释放给dev1：迁入原Runtime中企业授权/回款凭证字节读取、Staff原键观察和检查字节读取，Rental新文件持有原实现，Runtime仅对应委托；README、包出口、AppModule、索引和四册仍由RD负责。知识/隐私的原业务权威边界保留，未知结果只核原事实。

<a id="core-rental-client-auth-http-20261118"></a>

## Rental客户认证、统一注册与HTTP（2026-11-18）

本片在共享树codex/platform-core-extraction继续施工，固定父版694ae834323669fffd584d2b8f5137fdda7da178与实际任务远端一致；实际main仍为已包含的ba1de9f91860c4e73503eded4e1d05d2307b0e28。暂存区空，无合并/拣选现场。RD完成客户片，dev1继续约定Staff文件；AppModule、包出口、索引和四册由RD统一维护，旧原文与接续直接引用固定父版。

[客户HTTP](../../../packages/rental-core/src/http-client.controller.ts)、[认证](../../../packages/rental-core/src/mysql-client-auth.ts)、[统一注册](../../../packages/rental-core/src/mysql-customer-registration.ts)、[注册事务](../../../packages/rental-core/src/mysql-customer-registration-transaction.ts)、[限流](../../../packages/rental-core/src/mysql-client-rate-limit.ts)及[官网图片](../../../packages/rental-core/src/mysql-client-website-assets.ts)实际归Rental，原路径为窄Nest适配/再导出。[八项HTTP接点](../../../packages/rental-core/src/http-client-applications.ts)由[原宿主](../../../apps/api/src/modules/client/client-http.providers.ts)以useExisting供给同一业务、Auth、微信、地址、注销、企业和Guard；原AppModule登记一次，保留八项参数顺序与Optional。敏感资料在读取后仍复验原会话绑定，本人/企业audience没有转成营运授权。

客户认证保留原JWT用途、签名/过期、密码依据、用途证明、会员/账号及refresh一次消费。旧Auth适配保留五项构造位置和同一数据源的缺省客户/注册实例；包内实际实现要求真实客户、注册及短信参加者。[私有端口](../../../packages/rental-core/src/client-session-ports.ts)只暴露本片实际使用的模型/事务能力，MySQL生成类型不进入平台公共合同。后台和自助注册共用同一实现及原客户锁，Serializable只对P2002/P2034按原上限重试；其他错误原样传播。原数据库配额、来源地址、唯一清理实例、图片格式/2MB/租户边界均保留。

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 固定正文 | 对照694ae父版，Auth25方法及3自由函数、注册1方法、限流11方法/辅助函数、客户HTTP83方法/辅助函数正文一致；官网字节算法保持。变动为实例接线、正式出口与职责说明 |
| 必要类型 | node --no-compilation-cache -经stdin，退出0；AppModule、实际HTTP/providers、原Auth/注册/限流/官网共7根/2370源，TypeScript5.9.3零诊断。Prisma5.22官方内存声明由组合238模型/35枚举及公共33/14生成，31,201,345/2,177,556字节，磁盘生成0 |
| 原消费者 | client-api-security与customer-registration-unified两份原用例及全部原断言通过，后者保留9段原行为。静态读取仅将原Controller/Auth/限流实现定位改到Rental包；client-order-document、enterprise-portal-access、integrations-security三份本片只修源码位置，未另运行其全套 |
| 补充会话/HTTP冒烟 | 仅复验补充范围，最终退出0；原JWT/密码依据、refresh只消费一次、临时密码改密恢复、logout拒绝原会话、八项实际注入token、PUT/PATCH引用同一DTO类、资料返回前绑定改变拒绝/稳定绑定成功，以及原有限冲突重试通过 |
| 首轮问题 | 类型首轮3诊断是私有端口漏queryRaw与clientWechatIdentity，准确补齐后复验同一范围。离线加载夹具先漏35个真实枚举且在加载期误挡纯IP校验，补原枚举并仅允许纯函数，DNS调用仍拒绝。两原用例通过后的补充夹具把根存储与事务设为同对象，触发原issueSession的正当递归；更正不同对象后只复验补充范围。前次worker整体退出1的事实保留，不将已通过用例与后续失败混称整段退出0 |

模块导读、[客户端API说明v1.17](../../../docs/公共技术资料/接口说明/客户端-API说明.md)及接续同片导航实际HTTP→应用→私有存储/参加者，原v1路径、字段、DTO与OpenAPI业务规则没有改动。验证全部使用明确数据库、短信、事务和Guard fixture；没有真实HTTP/MySQL/微信、浏览器、安装、迁移或独立审查，也没有新增永久测试脚本、临时环境或后台业务服务。

本片继续完善PCH-06/08的实际服务和消费者。完整事件/作业/回调、Rental标准主装配、原授权等价映射及独立schema/迁移/Seed仍是未完项，不能据局部迁入和冒烟跨原下一档。知识2/6、外观16/17、API614项及旧待清理环境保持原问题归属。中文阶段提交与普通推送在必要资料核对后完成，固定提交由包含本节的Git版本定位。

<a id="core-rental-private-exchange-files-20261118"></a>

## Rental专用换货影像的文件适配（2026-11-18）

客户应用/Staff私有片19d36232c352a07318f73e0a22f4b2ba692aa1d0已普通推送并读取真实远端确认。本片dev1在共享树完成并停写专用影像、原Runtime和Rental导读三路径，RD完整读取后登记/file-application-exchange-inspection正式exports/typesVersions、核对并统一提交。没有改动主AppModule、Guard或数据库结构，原方案及旧接续由该固定父版保全。

[专用文件适配](../../../packages/rental-core/src/file-application-exchange-inspection.ts)持有六个原公开方法及两个私有检查，原Runtime保留同签名薄委托。它消费同一文件配置、公共上传事实/签名/受限字节运输及原readInspectionMedia，业务调用方保留订单/来源授权和原事务。冻结先持久化唯一目标再PUT，失应答只读取该目标及原摘要；TTL不删除专用依据，完成仍核资产/会话CAS和同事务事实，已接受照片只返回受限字节。[原业务消费](../../../packages/rental-core/src/mysql-exchange-inspection-media.ts) · [原Runtime](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)

RD对照固定父版，八个方法正文只将原公共原语改为受限ports委托、retentionLocationHash改为其原单源fileStorageLocationHash及媒体reader委托，归一化后全部一致。对象键、摘要、状态、字段、TTL、提交和读取顺序保留。dev1原Runtime、换货Media和Consent三根/1855源0诊断；一次原Runtime定向stdin冒烟退出0，跨空间/专用隔离、TTL保留、PUT失应答后只读原冻结目标及完成后同摘要读回通过。作者起初按待登记目标使用进程内映射，正式exports/typesVersions落盘后已补核真实子出口解析并加载实际实现，退出0，无临时残留；这属于正式源码出口验证，干净标准包安装仍未验。

作者离线守卫无违规、专用临时目录已删除；RD没有新增测试脚本、依赖、生成物或后台服务。数据库/并发和对象运输为明确fixture，真实HTTP/MySQL/对象存储与完整业务验收未做。四份同片资料核对1645链接、158锚点与87表格，0问题；正式出口和限定CRLF空白检查通过。模块导读与本册/接续同步，PCH-06/08仍缺完整事件/作业/回调、标准装配和相关实际消费者，未跨原下一档。阶段中文提交、普通推送并回读真实任务远端，固定提交由包含本节的Git版本定位；下一片dev1转Staff HTTP，RD继续客户认证及HTTP。

<a id="core-rental-client-application-20261118"></a>

## Rental客户应用与Staff私有文件权威（2026-11-18）

共享树分支codex/platform-core-extraction、HEAD及真实任务远端均核为dc9ed9183b99f0bbb9e1fc9c2a5c4bfa9908fe1f，暂存区空，无MERGE_HEAD/CHERRY_PICK_HEAD；真实main仍为已包含的ba1de9f91860c4e73503eded4e1d05d2307b0e28。客户应用为RD接续成果，dev1明确停写Staff私有参加者及地点六路径，RD统一登记正式出口、核对、资料和提交。原源码及旧接续由本片固定父版保全，不再复制历史稿。

[客户应用](../../../packages/rental-core/src/mysql-client-application.ts)及[客户目录字段投影](../../../packages/rental-core/src/category-client-projection.ts)实际迁入Rental包，原API路径为窄Nest兼容类/再导出。[私有参加者](../../../packages/rental-core/src/client-application-ports.ts)供给同一数据库、客户Auth、会员、核心/订单、资金/容量、文件/付款、地址和企业结算；原18项构造依赖、Optional声明与顺序保留。95个方法中94个正文不变，检查费用响应只把原每次新建PrismaBusinessFailureOutbox的调用改为宿主供给的同事务inspection回调；包内不加载AI运行时，原更新修订和出箱顺序不变。两个原自由函数及四个目录投影函数沿原实现。一次性报价地址的六字段证据归/client-contracts单源，原shared的AiBookingOneTimeAddressEvidence继承该声明，原AI客户场景继续使用同一字段与运行时schema。

[Staff文件参加者](../../../packages/rental-core/src/file-application-participant.ts)与[业务地点投影](../../../packages/rental-core/src/business-location-scope.ts)同源迁入Rental私有包。原Runtime仅改端口类型来源，RENTAL_FILE_AUTHORITY令牌和延迟Auth接线保留；五组固定tuple仍经原StaffController、当前Auth主体lease、地点/组织和业务文件ACL。主体锁先于配置锁，历史原键/文件描述从持久事实读取；其他旧合法module/scene与不匹配历史沿原兼容编排，不按payload创建权威。包配置的五个新正式子出口及typesVersions落盘，无新增依赖。[原Runtime](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts) · [原Staff入口](../../../apps/api/src/modules/files/staff-uploads.controller.ts)

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 客户类型与直接消费者 | node --no-compilation-cache -经stdin，退出0；客户应用/端口/投影、原ClientApiService/Controller及AI client-scene共6根/1857源0诊断。TypeScript5.9.3及Prisma5.22官方WASM/generator，从238模型/35枚举与公共33模型/14枚举生成31,201,345/2,177,556字节声明，全部留内存 |
| 一次客户应用冒烟 | 退出0；复用client-mini-program-api原5个用例及全部原断言，验证数据库分页/本人最少投影、逐行跨租户/同事拒绝、取消/续租前及回放复验、已取消/已付原结果、五类付款查写本人门禁。另核实际兼容类18项参加者顺序、检查出箱同tx、新实例及出箱失败回滚/不发布缓存，成功返回原批准金额20；数据库、幂等事务及出箱为明确fixture，网络请求/磁盘产物0 |
| Staff正式装配与原消费者 | dev1沿已落盘的正式包出口复验AppModule单根，2354源0诊断、退出0；原Staff Runtime/Controller五类创建/完成/下载、原键只读观察、旧metadata缺项、撤权/会话/地点拒绝、主体先于配置锁、回滚和PUT失应答后原目标恢复冒烟退出0。两次原离线守卫无违规，专用临时目录已删除，复用通过证据不再扩大测试 |
| 固定正文及测试定位 | RD核Staff12方法、地点1函数、Runtime41方法及1自由函数、目录4函数正文与dc9父版一致。原客户测试将hasOwnProperty改为可调用且等于包内同一updateProfile，两个PUT/PATCH原调用和其余断言保留；这是继承位置修正，未删有效行为断言 |
| 首轮失败与更正 | 客户首轮6项诊断，定位为两个待登记正式出口、错误指纹/客户合同出口及未实例化的事务泛型；正式登记及准确类型修正后只复验同一6根，0诊断。初次读取TypeScript误走任务树无依赖入口，改为只读现有锁定依赖；未安装或复制依赖、client或dist |

[Rental包导读](../../../packages/rental-core/README.md#使用与构建)、[原业务导读](../../../apps/api/src/modules/rental-core/README.md)及[客户API说明v1.16](../../../docs/公共技术资料/接口说明/客户端-API说明.md)同片导航实际SDK、Controller→应用→存储/参加者。原HTTP v1路径/字段、DTO、金额及业务状态未调整；正式需求/任务未改。当前PCH-08仍缺剩余客户/员工HTTP、认证/渠道、完整标准装配和数据/迁移/Seed、客户端及AI/作业接点，未跨原下一档。真实HTTP/MySQL/对象服务、浏览器/微信、干净安装与独立升级/回退/接手仍未验，不将本片离线结果称为完整兼容验收。原知识2/6、外观静态失败、API614项及旧待清理环境继续引用原问题。

七份同片资料定向核对退出0，1746链接、196锚点和120表格无问题；包依赖/peer/meta与锁文件一致，正式需求/任务原文保持，限定CRLF空白检查通过。本片统一中文提交、普通推送后读取真实任务远端，固定提交由包含本节的Git版本定位。RD验证全部内存且进程已退出，没有新永久测试脚本、依赖环境或业务服务；dev1继续下一片换货专用影像，Runtime/README在本片固定后按约定释放，索引/包配置/四册仍由RD维护。

<a id="core-rental-client-address-closure-20261118"></a>

## Rental客户地址、历史快照与本人注销（2026-11-18）

继续共享树施工前，已核分支codex/platform-core-extraction、HEAD与真实任务远端均为5173681861de7c8e391ed418cdb88fca91fac521，暂存区空，无合并/拣选现场；真实main仍为已包含的ba1de9f91860c4e73503eded4e1d05d2307b0e28。中断前PID5000已不在运行，旧输出因内核重置丢失，不补作成功证据。本片客户八路径为RD未完成果，dev1继续约定的Rental文件/地点适配，Git索引和公共配置仍由RD负责。

[地址与交付快照](../../../packages/rental-core/src/mysql-client-delivery-address.ts)、[本人注销](../../../packages/rental-core/src/mysql-client-account-closure.ts)及[精确配送区域](../../../packages/rental-core/src/client-delivery-service-area.ts)实际迁入Rental包，原三路径成为窄Nest适配/再导出。私有[参加者](../../../packages/rental-core/src/client-lifecycle-ports.ts)只要求原地址/快照表与事务、当前配置、客户Auth、状态门禁及公共审计，不引入第二个数据库或认证实例。四项正式子出口与typesVersions同步，依赖未变化。原客户Controller/服务及AI场景继续消费相同签名。

地址保存保留Serializable事务、默认地址规则、本人归属及原修订/CAS；报价按原键固定快照，地址后续修改/删除不覆盖它，订单绑定不覆盖已有订单。客户视图脱敏，运营读取仍核原租户/空间。本人注销保留企业账号拒绝、人工核对确认及证明→会员→账号→会话→审计顺序；已消费证明或已关闭状态不因后续失败自动重发/恢复。[模块导读](../../../packages/rental-core/README.md#使用与构建)、[原业务入口](../../../apps/api/src/modules/rental-core/README.md)及[客户API说明](../../../docs/公共技术资料/接口说明/客户端-API说明.md)同片更新，原API v1路径/字段不变。

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 原逻辑对照与一次冒烟 | node --no-compilation-cache -经stdin运行，最终退出0；17个方法/函数正文与517368186固定原源码一致。实际包类及原Nest兼容类覆盖默认地址、坐标精度、旧修订/CAS、跨客户/企业拒绝、配送精确匹配、同报价原快照、订单不改绑、客户脱敏/运营空间，以及注销成功顺序和各步骤失败停下、不自动重做 |
| 必要类型与直接消费者 | TypeScript5.9.3内存noEmit，最终退出0；四包内源码、三原适配及ClientApiController/ClientApiService共9根/1855源0诊断。Prisma5.22官方WASM/generator从原238模型/35枚举及公共33模型/14枚举生成声明，31,201,345/2,177,556字节全部留内存，没有写client或dist |
| 首轮失败及修复 | 首次内存依赖映射未覆盖node_modules根目录，2350项诊断；修正只读映射后仅剩审计类型导入名错误。本片实际改为正式PlatformOperationLogService类型，原业务正文不变，随后上述9根复验通过。冒烟初次把原ClientAuth当相对源码加载导致未声明依赖，只更正DI fixture查找顺序后同一冒烟通过 |
| 验证限制 | Prisma Decimal/错误类与Nest异常复用现有真实运行库；数据库、事务及Auth/状态参加者为明确fixture，未实例化Client、读取环境文件、联网或执行迁移。旧完整服务区脚本的同步配置假设不作为本片通过证据；没有新增永久测试脚本或临时环境 |

七份同片资料定向核对退出0，1717链接、192锚点及119表格无问题；正式需求/任务与固定父版原文一致，新增永久测试0，限定CRLF空白检查通过。当前没有跨原下一进度档。PCH-08仍需完整客户/员工HTTP、Core标准主装配、数据/迁移/Seed、页面及AI/作业实际接点；本片正常/拒绝和类型不代替整项兼容验收。原知识2/6、外观静态失败、API614项问题及既有待清理残留继续沿原记录承接。阶段提交由包含本节的固定Git版本定位，普通推送后以实际远端回读核定；本次两个stdin验证进程均退出，无新临时产物或业务服务。

<a id="core-public-file-application-staff-20261118"></a>

## 公共文件应用与原Staff实际消费者（2026-11-18）

清理/下载已在3ce760ce6212164d018b273dbbae25c46e957594普通推送并实际远端回读。RD完整核公共应用三文件、Staff真实参加者和原Runtime三入口后补正式出口、主Provider与三步接入说明；dev1按约定接Staff并停写，双方在共享树按文件边界完成同一切片。旧原文及接续由该固定父版保全。

[FileStorageApplication](../../../packages/platform-server/src/modules/files/file-storage.application.ts)从/files提供创建、原回执、完成、下载及按租户清理，消费[权威合同](../../../packages/platform-server/src/modules/files/file-storage-authority.ts)和[窄文件事务](../../../packages/platform-server/src/modules/files/file-storage.application-store.ts)。module/type/scene精确登记真实业务参加者，登记本身不授予权限；原键、15分钟有效期、配置指纹、元数据保护、唯一冻结目标及同事务激活保留。知识或专用来源通过原回执、受控字节、激活前后与失应答参加者裁定，不用通用文件表替代领域绑定。新Core从正式包接入，无需导入旧API运行时。[三步接入与调用](../../../packages/platform-server/src/modules/files/README.md#core-接入)

[Staff参加者](../../../apps/api/src/modules/integrations/rental-file-application.participant.ts)仅接可信staff及rental-core下pickup-evidence、return-evidence、handover-signature、offline-payment-proof、work-order-evidence五组原tuple。沿原Auth主体lease→配置锁顺序，当前角色、地点组织投影、领域对象/阶段与原FileBusinessAccessService复验，外部等待及提交前继续核同一lease；foreign transaction、缺会话/地点/Auth和撤权拒绝。新上传核Controller供给的阶段/批次/地点，旧回执严格按原键、文件描述、上传者和当前对象范围读持久事实，缺后加metadata字段不会凭空改写或拒绝旧依据。[原Staff Controller](../../../apps/api/src/modules/files/staff-uploads.controller.ts)及观察原键、检查绑定均未改。

[原Runtime](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)只在createUploadSession、completeUpload、downloadUrl中为可信staff+固定tuple分流到公共应用，其他37个原方法正文与固定父版逐字一致。其他operator/client合法任意module/scene及不匹配历史记录继续原真实兼容编排，不从payload动态创建权威，不全量收窄原DTO。[组合装配](../../../apps/api/src/app.module.ts)登记RENTAL_FILE_AUTHORITY窄token，只注入ModuleRef；调用主体锁时才取原同一AuthService并传原事务，避免Auth→Platform→Rental→文件已有构造链形成回环。缺原实例或授权失败向上返回，不构造空lease或备用Auth。

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 作者最终类型 | dev1-staff-file-application-runtime-types退出0，两根/1858源0诊断，公共33/组合238模型官方声明。token只依赖原Auth类型，公共应用无apps/api反向导入 |
| 原Staff/Runtime一次冒烟 | dev1-staff-file-application-runtime-smoke最终退出0，实际Runtime及原StaffController五组场景create/complete/download、原键observe、归一化文件名/MIME及同key回放、缺Auth/撤权/地点/会话、foreign tx、最终lease失败回滚、operator旧合法输入兼容及一次PUT失应答后仅读原freeze_pending目标均通过；主体→配置锁序保留 |
| RD实际Provider冒烟 | stdin读取AppModule实际factory后在内存转译调用，构造时零get，业务调用取原Auth一次、透传原tx/lease及this，缺实例/主体拒绝传播；其余37方法AST正文核对通过。ModuleRef/Auth与事务为明确fixture，未实例化全Nest宿主 |
| 首轮问题 | 参加者按sessionId重建回执未带metadata，现从原幂等键和资产读取原阶段依据，不用本次payload补历史。作者临时路径正则转义语法错、RD跨VM原型和跨调用计数fixture断言均仅更正stdin脚本，生产源码未因此修改；最后只复验相关冒烟 |
| 资料与资源 | 公共应用/事务/authority context正式出口与三步说明同步；源码短头、模块导读和原四册随片维护。作者guard/stderr为空，taskTemp已删除；RD所有新增验证在内存，没有新永久测试、依赖安装或业务服务 |

数据库、Auth lease/ModuleRef及对象传输仍为明确fixture；没有真实HTTP、Nest完整宿主、MySQL、对象云或干净安装证据。Staff权威当前仍由原API适配提供，Rental私有文件适配、客户/营运完整迁移及公共可靠事件/作业接点继续交付；真实多Core安装、独立更新/回退与接手也未完成。PCH-03/06/08未跨下一档，原问题与集中待清理责任清单由当前接续承接。

RD六份资料定向检查退出0，1176本地链接/186锚点/0问题，稀疏目标按固定Git定位；限定CRLF空白检查退出0。实际AppModule追加单根消费者类型由dev1补核，结果未返回前保留待核状态，不以factory fixture替代完整装配类型。当前11路径检查点仅包含本片公共应用/出口、原Staff参加者/Runtime、AppModule与四份资料，下一Rental私有文件或客户源码排除；正式需求/任务无差异。

<a id="core-public-file-cleanup-download-20261118"></a>

## 公共文件按租户清理与受保护下载（2026-11-18）

创建、原回执、33模型/八迁移与配置围栏已在768716af91120408067a662bfc02d8657742b4b4普通推送，RD本次实际远端回读为同一提交。dev1交出cleanup/download五路径后停写，RD完整核对两份公共实现、原运行时委托与模块导读，再单独固定此片。新公共应用三文件及Staff参加者保留在工作区，原文和旧接续由上述固定父版保全。

[FileStorageCleanup](../../../packages/platform-server/src/modules/files/file-cleanup.ts)持有原三个按租户清理算法。[原运行时](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)继续持有唯一计时器、全租户发现和专用保留场景，只委托相同数据库和对象提供者。完成暂存对象在DELETE前持久化原unknown收据，失应答只HEAD原键，原已完成文件和证据保持。原过期session→asset两写从数组事务改为同一callback事务，按原顺序、条件与提交点提交或回滚，事务内没有对象网络；此改变已按共享分工核定。缺租户在查询前拒绝，冻结和专用保留场景继续排除，原两项staging marker值不变。

[issueFileDownloadReference](../../../packages/platform-server/src/modules/files/file-download.ts)接原FileBusinessAccessService和必须成功的访问审计。原资产/业务/存储绑定及当前权限在配置、ACL或审计等待后复核，模拟引用仍要求宿主明确允许；原专用资料、公开商品图及客户敏感附件继续由原入口或Rental ACL裁定。正式/files出口提供清理、下载及窄参加者类型，公共层没有Rental场景枚举或另一个扫描执行者。[源码路线](../../../packages/platform-server/src/modules/files/README.md) · [公共包](../../../packages/platform-server/README.md)

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 作者一次定向类型 | dev1实际原Runtime及公共出口四根/1840源，复用官方238/33模型声明，最终退出0、0诊断。首轮completedAt可空类型问题已修为Date或null，保留原存储语义 |
| 作者原生命周期冒烟 | 短stdin复用原file-storage-lifecycle.test.cjs，十段全部通过，原用例本片未改；覆盖原回执、ACL、冻结/unknown、过期及完成暂存清理和专用保留。知识原全套2/6未重跑 |
| RD源码与消费者核对 | 两份公共实现完整读取，三个清理方法和下载委托核对；原计时器、全租户发现、专用分支及提供者仍在原宿主。复用作者同片类型/冒烟证据，没有再运行完整API或同一生命周期 |
| 资料与资源 | 作者20个导读链接/格式通过，stderr与守卫违规为空，临时目录已删除。RD同片更新模块导读、包说明和原记录/接续，必要链接与CRLF空白检查随提交核定；没有新增永久测试脚本、安装或业务服务 |

这份证据使用明确数据库、事务、Auth与对象传输fixture，没有真实MySQL、对象云、HTTP、浏览器或干净安装。公共应用正式出口、Staff实际参加者接线、其他合法历史输入兼容和知识/专用绑定仍继续完成；公共异步接点、Rental标准装配/数据/各端/AI尚未全部迁移，PCH-03/06/08未跨下一档。原问题与集中待清理责任清单继续由当前接续承接。

RD定向资料检查退出0，六份资料1162本地链接/184锚点/0问题，稀疏目标按固定Git定位。原需求/任务无差异，当前固定main ba1de9f91860c4e73503eded4e1d05d2307b0e28为任务HEAD祖先；限定CRLF空白检查退出0。提交仅此片五路径与包说明、原记录/接续共八路径，新公共应用与Staff参加者不进入此提交。

<a id="core-public-file-upload-data-20261118"></a>

## 公共文件创建、原回执、数据与存储配置围栏（2026-11-18）

固定父版91f07d0f4e8dd0db2b1f34bb29480c5792ddfdbd已普通推送并真实远端回读。dev1交出上传五路径后停写，RD固定其索引；其后cleanup/download三项重叠工作区保持下一独立片，不覆盖已固定上传源码。RD并行追加公共文件模型、迁移、数据计划及零Core配置接线，dev1将原Rental文件依赖核验抽为公共两函数。原文与完整旧接续由固定父版保全。

[公共创建](../../../packages/platform-server/src/modules/files/file-upload-session.ts)保持原file_/session标识、一次15分钟有效期、原默认真实配置、380字符定位限制、配置锁→当前授权/引用复验→pending事实的同事务顺序。[原回执/续签](../../../packages/platform-server/src/modules/files/file-upload-receipt.ts)保持租户/文件/会话及配置指纹、原键和原有效期；仅仍有效pending可以取得原暂存PUT，终态、过期或freeze_pending只返回原回执。原创建入口保留专用场景/企业证明/知识准入、原键匹配、P2002重读及知识写入尝试/result_unknown解释，普通引用在配置读取后建立事实前再复验一次。知识专用回执/激活绑定及共享客户与空间业务判断仍由原参加者负责，公共模块没有Rental枚举。[原真实委托](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)

[公共schema](../../../apps/platform-api/prisma/schema.prisma)追加原FileAsset与FileUploadSession及Tenant关系，原字段、默认、字符串状态、JSON、原ID/唯一键/索引及删除/更新规则保持；只省略所属AI检查反向关系。新[文件迁移](../../../apps/platform-api/prisma/migrations/20261118010000_public_files/migration.sql)复用原三迁移的四段文件语句，LF固定2748字节，SHA-256为f64d360bd77e354f95217f31ccb7e340bd8b9d00f82a7a025539d51de2731d38。原组合schema及历史链不改写。[数据计划](../../../apps/platform-api/src/platform-data.ts)升至0.1.4/八迁移，33公共模型/14枚举；结构预期为33表/341列/85索引/7 CHECK/27外键。原七迁移前缀及结构保持，外键解析只补原SQL中引用表与列括号间的合法空格，不忽略未知DDL。

空Core目录不能证明没有文件依赖。[公共只读围栏](../../../packages/platform-server/src/modules/files/file-integration-dependencies.ts)从正式/file-integration-dependencies接原配置同一事务，查询限定当前租户/提供者。停用保留原四类asset状态及pending/cleanup会话，并显式保护freeze_pending和任何非空cleanupError；位置变更保留原非deleted文件与cleanupError依据，补freeze_pending。这样即使原asset已deleted或缺失，未知清理/冻结仍保留恢复通道。原[Rental参加者](../../../apps/api/src/modules/integrations/rental-integration-business.participant.ts)的文件分支及[零Core装配](../../../apps/platform-api/src/core-assembly.ts)共用此核验，结算与payment/sms正文保持，空范围查询前拒绝，DB错误原样抛出。33模型本身不开放零Core通用上传或替代附件ACL。

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 上传作者类型/原冒烟 | node --no-compilation-cache - dev1-public-file-upload-ports-types退出0，两入口/585源0诊断；entry-types四入口/1838源0诊断，当时公共声明31模型。entry-smoke原完整lifecycle十段通过，创建/原键、生产模拟拒绝、原回执/有效期/配置变化及ACL/冻结/unknown/专用检查均保留，未改原用例适应本片 |
| 知识相关参加者 | upload-knowledge-participant-smoke四组通过，实际创建/完成→公共内核，synthetic知识/传输fixture；成功绑定、撤权/无效字节零PUT、实际COMMIT后丢响应仍result_unknown且同key一原会话、原读取不发PUT票据/访问对象、写入前撤权不建事实。原知识全套2/6未重跑 |
| 新公共数据类型 | node --no-compilation-cache - packages/platform-core-host/tsconfig.json apps/platform-api/tsconfig.json apps/example-tickets-api/tsconfig.json，stdin复用原只读类型入口，退出0、stderr空；Core宿主22根/957源、公共API7根/966源、工单API6根/982源0诊断。Prisma5.22官方内存声明33模型/14枚举、2177548字节、生成写入0。新增配置围栏后同命令仅传公共API配置：7根/967源0诊断，未重复其他两个配置 |
| 一次数据/部署准备 | node --no-compilation-cache -，stdin公共数据/部署准备冒烟最终退出0：两模型字段与原源一致、原七迁移结构不变、缺cleanup列/错误CASCADE拒绝、SQL摘要变化及未知DDL拒绝，零Core完整八迁移准备11个内存文件。information_schema与发行资料为明确fixture，15次fixture查询，无DDL、网络、客户端实例化或磁盘写入。首轮把关系字段计入物理列而断言19!==20，修正原19/15实际列数后只复验同一冒烟，未改产品源码 |
| 文件围栏作者 | dev1-public-file-integration-types退出0，原238/公共33模型，两根/737源0诊断；integration-smoke核参数化tenant/provider、状态/cleanupError、允许/拒绝、空范围零查询、DB错误、identity资产短路及Rental同事务委托。结算方法及payment/sms两个分支AST正文逐字一致 |
| 一次公共/原接线 | node --no-compilation-cache -，stdin公共/原文件配置围栏冒烟退出0，实际core-assembly与原Rental委托共用核验，空事实允许、active/冻结/unknown清理及位置变更拒绝，原SQL参数/事务保留、DB错误传播、非file规则不变；24次raw-query fixture回调。公共数据库模块为未实例化fixture，业务数据库/网络/磁盘写入0 |
| 资料与资源 | 作者上传18导读链接及围栏diff检查通过，stderr/守卫违规为空，taskTemp均finally删除。RD更新数据/宿主/模块导读及原四册；上传导读只在索引补公共数据/围栏说明，工作区cleanup说明单独保留，没有永久测试脚本、安装或后台服务 |

没有执行公共迁移、生成磁盘Client、真实MySQL/对象云/HTTP/浏览器或干净安装。真实文件业务权威、完整公共文件应用/HTTP、Rental标准装配/数据/各端及事件作业仍待交付，按原PCH-03/06/08门槛未跨下一档。原外观/API问题、知识2/6与旧清理残留继续承接；版本/结构预检和待部署文件不等于实际更新或恢复通过。

最终六份资料1113本地链接/145锚点/0问题，文件导读从上传版本索引读取，稀疏目标以固定Git定位。18路径精确暂存，上传五路径源码及补数据/围栏后的导读blob保持；下一cleanup和新应用文件排除。新迁移暂存字节与固定摘要一致，新子出口/声明对应，依赖与根lock保持。CRLF空白检查使用原限定配置退出0，中文提交/普通推送后实际回读。

<a id="core-public-file-freeze-20261118"></a>

## 原文件完成链的公共冻结内核与生命周期核验（2026-11-18）

工具与文件首片已在1eea4a677a8e7ba2e3785a5779d67ce613db833f普通推送并实际远端回读，原13路径首片由该固定提交保全。dev1交出五路径冻结组后停写，RD核完整内核与原实际委托、分类计数和TTL证据不变断言，再单独固化；新的原上传回执/创建文件不进入本片。

[freezeFileUploadContent](../../../packages/platform-server/src/modules/files/file-content-freeze.ts)实际承接原completeUpload的63行冻结逻辑，原[完成入口](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)用29行参加者委托同一实现。原v2暂存依据、配置/位置摘要、实际字节SHA-256、当前资产/会话指纹、同事务配置锁与CAS保留；先提交唯一freeze_pending目标，再发送一次PUT，恢复从原持久状态判断，仅读取原目标，不重分配键或重读暂存。原知识授权在占用前复验，专用字节读取及精确长度由原知识参加者提供，最终激活、知识绑定和后续复验留原完成事务。专用检查、隐私擦除及企业证据没有变成通用执行入口。[模块与调用链](../../../packages/platform-server/src/modules/files/README.md)

原生命周期fixture两项失败均在开工源码基线复现。第一项把暂存GET、冻结PUT和目标GET都计入byteRequests，得到3!==1；现保留byteRequests===1只计原暂存GET，另核冻结PUT与原目标GET各1。第二项期望TTL后回到pending_upload，但原inspectExchangeInspectionUpload在PUT前已经持久化freeze_pending及唯一目标，通用清理明确排除专用场景；现先核原冻结状态、共同目标、摘要及proof对应证据，再逐字段核TTL清理前后资产/会话全量快照不变，人为expiresAt改动单独保存/恢复。未改生产状态或回退unknown，原保护意图变为直接的不变断言。[原生命周期用例](../../../tests/file-storage-lifecycle.test.cjs) · [首片失败与基线](#core-public-file-primitives-20261118)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 冻结内核类型 | node --no-compilation-cache - dev1-public-file-freeze-core-types，1入口/582源0诊断；dev1-public-file-freeze-entry-types，runtime/index/内核3入口/1836源0诊断。复用已交证据，没有再扩大完整API类型 |
| 原冻结与知识参加者 | dev1-public-file-freeze-entry-smoke复用原593～783全部冻结/cleanup断言，实际completeUpload→公共内核通过；knowledge-participant-smoke两组经实际创建/完成入口核成功、撤权与无效字节零PUT，知识及传输为明确synthetic fixture |
| 原完整生命周期 | dev1-public-file-freeze-lifecycle-smoke最终退出0，执行到file storage lifecycle tests passed；本人绑定、竞争、业务ACL、资格事务、不可变冻结、PUT/COMMIT unknown、撤权/过期、completed暂存清理及专用检查/通用隔离/TTL等十段全部通过。stderr与守卫违规为空，没有新增永久测试脚本 |
| 更正前失败保留 | 分类计数后完整用例退出1，暴露旧freeze_pending!==pending_upload；恢复三个原源码开工快照后同样失败。更正前的3!==1与状态失败保留在本段及首片记录，不改断言为实际值3或改变生产状态迁就fixture |
| 资料与资源 | 作者16个导读链接及diff检查通过，taskTemp不存在，本片临时产物已由finally清理。RD核完整内核/实际委托/五路径交付，更新公共包及原PCH资料，按固定版本定向核链接与CRLF空白格式 |

知识全套原2通过/6失败独立承接，本片只复验相关参加者，不重跑或改知识依赖。没有真实MySQL、对象云、HTTP、浏览器、完整文件公共宿主或独立安装证据。当前公共数据仍31模型/14枚举、七迁移、0.1.3，DDL未执行。按原PCH-03/06/08门槛复核未跨下一档；原上传创建/续签、cleanup/download及标准宿主继续由共享分工推进。

<a id="core-public-tools-20261118"></a>

## 公共字典、编号与原后台同源工具接入（2026-11-18）

固定父版40aecca483ff58f1f9da1d82882d1b61183bce7b已普通推送并真实远端回读，包含当天固定main ba1de9f91860c4e73503eded4e1d05d2307b0e28。RD与dev1在唯一共享树按文件分工，dev1交出10份服务源码及6份页面源码和两份原薄适配后停写；RD接正式出口、唯一服务与原Controller、公共应用、语言、权限目录及两套OpenAPI。索引由RD统一操作，后续文件冻结与回执源码不夹入本片。原文及完整旧接续由固定父版保全。

[公共工具服务](../../../packages/platform-server/src/modules/platform-tools/README.md)通过同一数据库、当前会话/角色与原工具权限访问租户最高EFFECTIVE配置，Tenant父锁早于主体和配置操作。规则保存、取号与审计同一Serializable事务，提交前复验当前权限；配置CAS、审计或撤权失败不自动重发。保留草稿、历史版本及其他JSON，缺生效行在最大版本后建立。公共缺省为空，原Rental三组字典、五条编号及原演示次序留在可信适配；原仓储五个重复工具方法及两项私有格式函数已移除，初始化模板保留。

编号沿原前缀、日期、连字符和padStart算法，resetCycle维持原连续计数行为。保存先正规化编码，在锁内保留省略的最新流水；安全整数边界拒绝继续递增。原内存分支消费同一纯函数，保持原tenant_001演示审计。工具HTTP不另加全租户数据或全部地点门槛，SaaS拒绝租户工具，权限元数据补录不自动授予角色。[服务](../../../packages/platform-server/src/modules/platform-tools/platform-tools.service.ts) · [原格式与正规化](../../../packages/platform-server/src/modules/platform-tools/platform-tools.values.ts)

[公共工具页](../../../packages/platform-admin/src/features/platform-tools/README.md)及原后台复用两个页签、原表单和取号结果；五个原API委托宿主唯一客户端。零Core可从空列表填写首项六字段建立第一组字典。编号页面省略没有编辑控件的currentSequence，保存与回车共用同一Promise，成功和随后刷新失败分开反馈，草稿、取消和身份代次沿原边界。52个公共词条包含原后台实际迁出的41项，原英文值逐项一致。

正式服务出口为/tools与/tools-dto，呈现出口为/platform-tools及/platform-tools/client。五操作进入公共政策/Guard和公共/原组合OpenAPI，保留saveDictionaryGroup等原operationId；七个旧schema名称引用同一公共对象，四个原DTO为同一公共类再导出。独立宿主登记公共Controller，原组合只登记原Controller与唯一公共服务，原PlatformService的五方法委托同一实例。[政策](../../../packages/platform-server/src/modules/platform-tools/platform-tools-http-policy.ts) · [schema](../../../packages/platform-server/src/modules/platform-tools/platform-tools-openapi.ts) · [原装配](../../../apps/api/src/app.module.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 作者服务与页面 | node --no-compilation-cache - dev1-public-tools-types：服务9入口/738源0诊断；同次页面1诊断，修正展开对象后dev1-public-tools-ui-types及first-dictionary-ui-types为8入口/1530源0诊断。公共类型中的readonly enum另由RD用展开数组保持DTO枚举元数据 |
| 作者一次行为核验 | dev1-public-tools-smoke共10组通过，包括12并发唯一流水、当前租户/版本/草稿/JSON、权限、审计/撤权/CAS回滚、DTO/schema/Nest/client；锁与数据库为明确fixture。first-dictionary-smoke四组通过，真实Hook提交→公共客户端→公共服务，React/query/宿主为fixture；覆盖首项、同Promise、拒绝、旧项与词条 |
| 最终服务类型 | node --no-compilation-cache - pch-tools-final-api-types退出0、stderr空：公共服务84根/900源、Rental251根/1029源、公共API7根/966源、原API1033根/2607源，全部0诊断。TS5.9.3；Prisma5.22官方内存声明对应原238模型/35枚举及公共31模型/14枚举，生成写入0 |
| 最终页面类型 | pch-tools-final-ui-types退出0、stderr空：公共后台283根/2548源、零CoreWeb5根/2549源、原后台661根/4307源，全部0诊断；两个公共配置行业源码0、写入0 |
| 一次主装配冒烟 | pch-tools-smoke退出0、stderr空；实际TS/Nest切片核唯一数据库/工具/管理实例、原五方法委托、原3/5与公共空缺省、真实内存正规化/流水保留、四DTO同一、五政策/两文档/七schema、两个权限目录及Guard允许own scope而拒绝缺权限/SaaS。业务查询、网络、数据库客户端实例化及磁盘写入均0 |
| 工具与资料 | antd lint0；初次CommonJS加载CLI报ERR_REQUIRE_ASYNC_MODULE后改ESM执行，未安装或联网。作者31链接通过；模块导读、宿主和PCH资料随本片更新。最终定向链接、出口/lock与索引空白检查另随提交核验，不以类型结果代替真实运行 |

本片主实现、正常/拒绝和直接消费者已有证据，完整PCH-03/04/06/07/08还缺Rental标准装配/数据/页面/AI/作业、真实无Core运行、多Core、干净安装及独立升级/回退；按原连续门槛复核未跨下一档。所有新增验证为必要短stdin或作者既有入口，无永久测试脚本、新依赖环境或后台业务服务。真实MySQL锁竞争、HTTP、浏览器/Portal/回车快速点击、窄窗口及完整宿主未验。

工具与文件首片合并资料定向核验为11份/1604本地链接/170锚点/0问题；文件导读从已固定首片暂存blob读取，稀疏目标按固定Git定位。13份首片索引与作者交出字节一致，两份原CRLF经Git转换为LF，正规化后一致；后续冻结工作区不覆盖这些暂存blob。空白检查保留原PlatformService的CRLF，使用git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check；不修改源码换行或忽略实际尾部空白。

<a id="core-public-file-primitives-20261118"></a>

## 公共文件原语、元数据与Rental附件权限（2026-11-18）

同一固定父版40aecca保全原文件及业务授权实现。dev1交出13路径首片，RD在索引固定该版本；后续冻结内核的工作区改动保留为下一片，不覆盖首片暂存blob。首片只将原公共字节、文件表和Rental附件规则迁为单源，没有新增公共文件HTTP、schema或DDL。

[公共文件模块](../../../packages/platform-server/src/modules/files/README.md)持有九项原字节/格式/限长读取与对象处理、当前租户元数据/会话读取及同事务persistUploadFacts。[原运行时](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)继承公共原语，内部仓储与Rental业务引用使用同一Prisma；原[IntegrationsRepository](../../../apps/api/src/modules/integrations/integrations.repository.ts)委托公共元数据存储。metadata沿原对象过滤表达式和原内容保存，原存储键、字段投影、超时/取消和精确字节校验保留；首片37个尚未迁入方法正文与固定父版一致。

[Rental附件规则](../../../packages/rental-core/src/file-access.ts)及[实际参加者](../../../packages/rental-core/src/file-access-ports.ts)持有原业务ACL、引用存在性、商品公开图及客户敏感材料判断，原[业务ACL服务](../../../apps/api/src/modules/files/file-business-access.service.ts)仅供给原事实、报价和敏感资料参加者。未知业务、租户/空间越界拒绝。Files、Staff、知识与专用检查Controller及当前授权原位保留，通用存储不能获得任意业务权限。正式出口为platform-server/files与rental-core/file-access，声明映射与现有依赖对应。

| 首片必要验证 | 实际结果与边界 |
| --- | --- |
| 作者类型 | dev1-public-files-primitives-types为17入口/1892源0诊断，metadata-types为1入口/571源0诊断。首轮四诊断含三项metadata顶层null过宽，收窄为原对象；另一项是工具DTO枚举readonly，由RD修正为原运行时数组 |
| 一次端口冒烟 | dev1-public-files-port-smoke五组通过：精确字节、取消/超时、原metadata/actor/key/tenant与安全投影、原同事务失败、Rental引用/未知拒绝。SQL、业务、配置和传输为明确fixture |
| 原生命周期首片结果 | dev1-public-files-primitives-smoke退出1。前九段通过，最后原805行byteRequests===1得到3；恢复三个原源码开工快照也得到同一3!==1。首轮资格fixture漏categoryCode，同开工源码也失败，首片仅补原110行CAMERA且保留原assert，该段随后通过。此版本未改最终计数断言，不能称完整生命周期通过 |
| 知识原套件 | 原ai-native-knowledge-lane-b-file-runtime为2通过/6失败/0 skip/todo；恢复三个原源码开工快照仍同2/6。失败为Memory的AI_RESOURCE_UNAVAILABLE、首建result_unknown及后四项KnowledgeSensitiveReadAudit unavailable。保留知识实现和原断言，不能用本片局部绿色替代知识验收 |
| 资料与临时产物 | 作者15本地链接及格式通过。类型/冒烟复用既有离线守卫，临时目录在finally删除，没有永久测试脚本、新安装、外部业务连接或后台服务。RD复用本节同期完整类型结果，不重复扩大全套回归 |

生命周期计数旧fixture将暂存GET、唯一冻结PUT和原目标GET混为同一byteRequests，后续冻结片按真实三类操作分别核验；专用冻结意图不应因TTL变回pending。这两项更正及后续原完整用例结果在下一完整阶段保留，首片失败证据不覆盖。知识2/6、完整文件公共编排/数据/宿主、真实云与MySQL仍为未完项。当前公共数据仍31模型/14枚举、七迁移、0.1.3，没有执行DDL或覆盖旧库。

<a id="core-public-organizations-security-20261118"></a>

## 公共组织、安全管理与原后台同源接入（2026-11-18）

固定父版2a7462312d1912995b37fd670cfda61e730d9878已普通推送并实际远端回读，包含当天核定main ba1de9f91860c4e73503eded4e1d05d2307b0e28。dev1交出稳定11文件服务组与16文件页面组并停写、释放共同文件窗口，RD在同一共享树接原主装配、兼容委托、正式出口及两套接口资料。原文和完整旧接续在固定父版保全，本片不重建历史副本。

[公共管理模块](../../../packages/platform-server/src/modules/platform/README.md)持有当前主体、组织投影、组织维护与全平台安全配置。原[AppModule](../../../apps/api/src/app.module.ts)将PLATFORM_AUTH_DATA_STORE绑定到唯一PrismaService，并提供同一PlatformManagementService；原[PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)追加该依赖，六个持久化管理方法委托公共实例，原位置构造与内存演示分支保留。缺管理实例明确503。认证前读取仍从固定tenant_platform的最新EFFECTIVE system-rules读取，不要求ALS会话；管理HTTP读取另经当前主体围栏，原[认证仓储](../../../packages/platform-server/src/modules/platform/platform-authentication.source.ts)与[平台仓储](../../../apps/api/src/modules/platform/platform.repository.ts)共用同一只读算法。

组织维护保留当前租户、原账号管理权限、全租户数据及完整地点范围；组织读取只返回连续启用的受权子树。安全保存保留原有限非负数值、平台主体锁、生效版本与其他JSON字段，更新/审计同事务，返回前复验当前权限。原二次确认MVP管理工具结果保留，业务批准与执行仍消费其正式授权/收据。[公共服务](../../../packages/platform-server/src/modules/platform/platform-management.service.ts) · [仓储](../../../packages/platform-server/src/modules/platform/platform-management.repository.ts)

[公共组织与安全页面](../../../packages/platform-admin/src/features/platform-settings/README.md)在同一应用登记/settings/organizations和原/platform/system，个人改密继续/settings/security。原组织页签嵌入同一组件，原安全/概览入口再导出；六个原请求委托宿主唯一客户端，保留字段、信号与失败Promise。58项原英文映射迁出且原值不变，另补5项提示；四类原CSS通过正式样式出口及composes复用。共同提交Promise、当前身份/权限复核、草稿保留与保存后读取失败分别处理。

[七操作/五路径](../../../packages/platform-server/src/modules/platform/platform-settings-http-policy.ts)与[schema](../../../packages/platform-server/src/modules/platform/platform-settings-openapi.ts)同时进入公共Guard/OpenAPI及原组合文档。原七份重复操作描述改用同一来源，保留原operationId及四份DTO类身份；原组织写入文档的system:org:manage修为实际system:user:manage，tenantId查询按正式声明提供。新增窄出口/typesVersions与原实际源码对应，宿主无需复制公共设置实现。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 作者服务端证据 | node --no-compilation-cache - dev1-public-settings-types，9入口/719源/0诊断、退出0；dev1-public-settings-smoke最终退出0，复用原access-data-scope-regression的组织子树/投影/内存/Prisma断言，同进程12组核公共主体、CRUD/跨租户/范围、审计与撤权回滚、安全原版本/其他字段/历史草稿/JSON null/首次保存/同键冲突、原数值/MVP结果及Nest同一实例。准确命令与结果从dev1原会话2026-11-18 05:40的交付消息复核，不重复执行原用例 |
| 作者页面证据 | node --no-compilation-cache - dev1-public-settings-ui-types，15入口/2664源/0诊断；dev1-public-settings-ui-smoke核六原接口/payload/signal/失败Promise、权限矩阵、路由和共同submit声明、63项实际翻译及Vite preprocessCSS同源类继承，均退出0。原6个组织及8个安全Form.Item结构/校验保持，antd6.6.0定向lint issues=[]/partial=false，22个模块链接通过 |
| 最终服务与宿主类型 | node --no-compilation-cache - packages/platform-server/tsconfig.json apps/platform-api/tsconfig.json apps/api/tsconfig.json，stdin实际TS5.9.3；公共服务71根/887源、公共API7根/957源、原API1033根/2590源均0诊断，退出0、stderr空。Prisma5.22官方WASM/generator在内存生成原238模型/35枚举31,201,337字节声明及公共31模型/14枚举2,006,058字节声明，磁盘写入0 |
| 最终前端类型 | node --no-compilation-cache - packages/platform-admin/tsconfig.json apps/platform-admin/tsconfig.json apps/admin/tsconfig.json，公共包278根/2543源、零CoreWeb5根/2544源、原后台661根/4302源均0诊断，退出0、stderr空；公共两配置行业源码0，写入0 |
| RD同实例冒烟 | node --no-compilation-cache -，stdin实际当前TS/Nest切片与明确存储/委托fixture；唯一数据库与管理实例、原六方法委托、认证前两次固定平台读取、缺实例503、原内存兼容、四DTO类同一性、七操作/两文档/schema及查询、公共同路径Guard允许/拒绝通过，退出0、stderr空。数据库客户端实例化0、网络0、磁盘写入0；两次读取仅为明确fixture |
| 保留的验证问题 | 作者服务冒烟前三次因Module变量重名、同步异常断言、missing fixture复用已有编码失败；页面前两轮141/9诊断来自验证器Node解析及CSS出口误当TS。RD最初直接API检查因缺生成客户端产生3927级联诊断，换官方内存声明后通过；接线冒烟先后缺.d.ts源码定位及Prisma fixture的$Enums，修验证器后通过。未改产品源码或放宽原断言迁就这些失败 |
| 工具与运行边界 | 作者antd CLI首次info自动尝试3次fetch均被离线守卫阻断，按真实NO_UPDATE_CHECK入口关闭后完成后续查询/lint；保留原问题。服务/页面临时目录已删除，RD验证全在内存，无永久测试脚本或新增依赖。真实HTTP、DB并发、浏览器/Portal/回车快速点击、窄窗口、完整主题与完整宿主未验 |
| 最终资料与出口 | 九份资料1211个本地链接、168个锚点引用均可定位，问题0；稀疏未检目标按固定Git定位。服务五个、前端三个新正式出口与实际源码及声明映射对应，两包依赖/peer与根lock一致；定向空白检查退出0 |

公共服务、公共前端、两个零Core宿主及根README同步实际能力入口。按PCH-03/04/06/07/08原门槛复核，本片未跨下一档：完整Rental装配/数据/页面/AI/作业、干净包安装、多真实Core、真实无Core运行与独立更新/回退仍缺。dev1接续公共字典与编号，RD统一索引、交叉文件和四册；本片只暂存组织/安全完整组及对应资料，不夹带后续WIP。整体614项API合同问题、旧外观失败与清理残留继续承接。最终链接、格式、包/lock对应与普通推送以包含本节的固定提交和实际远端回读核定。

<a id="core-rental-enterprise-http-20261118"></a>

## Rental企业HTTP与客户请求校验单源接入（2026-11-18）

固定父版b7585e30e8d1dfe01cf020ab9ed87052dfd55736已普通推送并实际远端回读，包含当天核定main ba1de9f91860c4e73503eded4e1d05d2307b0e28。RD在共享树迁入四个企业Controller、六份企业DTO及一份客户DTO；dev1公共组织/安全11文件组已完成作者验证并停写，待RD另片接主装配，不进入本片提交。原文和完整旧接续由固定父版保全。

[企业HTTP](../../../packages/rental-core/src/http-enterprise-applications.ts)以21项窄接点描述实际参加者，四个Controller持有原客户读取、商户审核/执行、行政交接和客户工作流。[原AppModule](../../../apps/api/src/app.module.ts)消费[企业接线](../../../apps/api/src/modules/enterprise/enterprise-http.providers.ts)的同一实例别名，生成模型只留私有适配。原11路径均变为正式再导出，12个新增子出口与typesVersions对应。客户/营运两套鉴权、文件前后复验、专用支付证明、财务导出撤权拒绝、原操作键/收据和可选财务装配保持；注册HTTP不授予业务权限。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 原正文与元数据 | 四Controller共153方法正文、165方法HTTP装饰器逐项一致，实际操作数为8/22/4/115，总149；七份DTO共84类正文与固定父版一致，仅迁移类型/常量的所属导入。没有改字段、金额、修订、嵌套验证或原异常 |
| 当前类型 | node --no-compilation-cache - packages/rental-core/tsconfig.json apps/api/tsconfig.json，经stdin复用只读内存入口；Rental247根/1023源、原API1033根/2586源均0诊断、退出0、stderr空。TS5.9.3，原238模型/35枚举由Prisma5.22官方WASM/generator生成31,201,337字节声明，生成/构建磁盘写入0 |
| 一次定向冒烟 | node --no-compilation-cache -，stdin实际转译当前源码及明确fixture；四新旧Controller对象同一，21别名的实际Nest切片共用同一数据库，每个原fixture生命周期一次。缺客户/错误页码、文件配置不可用、附件关联改变不释放、财务导出撤权及营运数据范围拒绝、缺可选财务依赖不可用、原DTO正常/拒绝和兼容类同一性通过，退出0、stderr空 |
| 首轮类型与修复 | 首轮17诊断，其中4为验证器将Prisma runtime定位到物理依赖绝对路径造成声明不可命名；修正虚拟正式包路径及packageId。其余为DTO所属子出口及批准换货实现/事务类型引用，按实际单源修正，不扩根出口或改原方法正文 |
| 首轮冒烟与修复 | 可选财务接口为async，初次以assert.throws检查导致失败及未处理拒绝；改为await assert.rejects后通过，产品源码未因此变动。没有新增永久测试脚本，未为测试数量扩大原回归 |
| 资料与环境 | Rental包与原业务导读、PCH记录/接续同步；静态正文、实际Nest、类型与真实运行分开记录。SQL/业务/身份/文件为明确fixture，本次数据库查询0、写入0、网络0、实例化数据库客户端0、临时文件0 |
| 最终资料与出口 | 四份资料1530个本地链接、149个锚点引用均可定位，问题0；稀疏未检目标以固定Git树定位。12个新增正式子出口与声明映射对应，依赖及peer与根lock一致；精确暂存后检查空白格式 |

当前类型使用dev1稳定组织/安全源码，但公共/原管理接线沿下一阶段核收。整体API原614项合同问题及后续未执行检查保留；149操作元数据不证明完整OpenAPI配对。仍缺其余客户/员工入口、标准Rental装配、数据/迁移/Seed、页面/客户端、AI/作业及干净安装/更新/真实宿主。按PCH-03/04/06/07/08原门槛复核，本片未跨下一档。精确暂存本片并核格式/链接，中文普通推送后实际回读；旧清理残留、外观失败和历史缺链沿接续承接。

<a id="core-main-ai-delivery-20261118"></a>

## 固定最新main的AI Native交付与入口接续（2026-11-18）

公共集成前端a3b9215a6e87caa57e9eee18592140660d94abbf已普通推送并实际远端回读。随后接入当天固定main ba1de9f91860c4e73503eded4e1d05d2307b0e28，合并提交b973a983fc8dde6011bea8ca5acf19cd7fe26be8；相对已接7d49c26共八文件，涉及Operator原会话/Copilot三处入口、AI隐私模块导读、AI四册中的三份及总导航。固定来源与合并后的八份blob逐一核对，不追AI研发活动HEAD。

索引在合并前为空，八路径与dev1组织/安全未完组无交叉；共享WIP继续保留，主树与其他专项索引未操作。原后台受影响消费者执行node --no-compilation-cache - pch-main-admin-types，661根/4296源/0诊断、退出0、写入0。沿上游固定阶段保留其原测试与未验边界，没有在PCH重复全量AI验收或把AI完成度移作PCH进度。

本片只核当前消费者类型、固定原文及对应资料链接/格式；没有读.env、安装、启动服务、实际HTTP/数据库/浏览器、迁移或发布。完整旧接续在固定a3b9215保全，两份PCH记录/接续精确提交，dev1代码不夹带；中文普通推送后读取真实任务远端。下一入口为公共组织/安全同实例装配和Rental企业HTTP，完整任务门槛与旧问题继续承接。

<a id="core-public-integration-ui-20261118"></a>

## 公共第三方设置页与同源后台接入（2026-11-18）

固定父版8a2e5db74d425b19da0e0649101efa9a9f73c44c保全原文、资源和完整旧接续，开工时与真实任务远端相同。dev1交出22路径页面组并停写，RD核源组、接公共应用路由、补公共双语和正式呈现出口；dev1组织/安全未完组仍在共享树，不进入本片提交。当天另核真实main为ba1de9f91860c4e73503eded4e1d05d2307b0e28，其固定变化待本片上传后接续。

[公共集成页](../../../packages/platform-admin/src/features/integrations/README.md)持有原目录、分类/搜索、卡片/目录切换、配置抽屉、默认选择、草稿同步及保存/测试反馈。[请求工厂](../../../packages/platform-admin/src/features/integrations/client.ts)只消费宿主唯一请求，原Rental API/页面转接同一实现。[公共应用](../../../packages/platform-admin/src/application.tsx)实际登记原/tenant/integrations的菜单和受保护路由；沿原租户平台管理员、明确system:integration:manage或*判定，SaaS身份不进入租户配置。页面可见性不替代服务端Guard、当前租户、修订与历史依赖核验。

[集成文案](../../../packages/platform-admin/src/features/integrations/messages.ts)从原Rental字典迁入86项英文映射，另补18项供应商提示，由公共语言Provider单份加载；原5712键与当前Rental5626键加迁出86项逐项比较，原键值差异0。记录事实与浮层退出的实际实现补到正式/shell和/ui出口，原两个缺失源码出口的消费者改用这些正式入口，正文和样式未变。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 作者定向验证 | node --no-compilation-cache - dev1-integration-ui-types，6入口/1503源/0诊断；dev1-integration-ui-smoke核原三个接口、payload、失败Promise与租户权限，均退出0；42本地链接及差异格式通过。复用作者已完成冒烟，不重复添加测试脚本 |
| 同版本最终类型 | node --no-compilation-cache - pch-integration-final-types，TS5.9.3，公共包272根/2537源、零CoreWeb5根/2538源、原后台661根/4296源均0诊断、退出0、stderr空；公共两配置行业源码0、写入0，包解析消费本树正式出口 |
| 原资源与语言 | 三份原目录CSS/类名与固定Git原文CRLF规范化后相同；作者22路径交付组核现存19/删除3。全部原英文键值一致；语言核验首次因重复解析字典导致REPL超时，已改为各文件只解析一次后完成，没有重复写入或篡改旧映射 |
| 首轮类型与修复 | 原后台3诊断定位RecordFacts和useModalDismissal旧转接缺正式出口，改为真实/shell与/ui后消除。验证器另4诊断来自虚拟workspace相对解析，按本树真实包位置修验证器，未改源码迁就检查 |
| 资料和交付 | 公共包、零Core、集成模块README及根组成表同步，PCH记录/接续仍按四册；精确暂存作者页面组与RD本片，排除组织/安全WIP。链接/格式与真实远端结果由包含本节的固定提交定位 |
| 环境 | 类型及核对全在内存或只读Git，未安装、读.env、生成共享client/dist或启动服务；接口/权限冒烟使用明确fixture，没有浏览器、真实HTTP/数据库或供应商证据 |

复核PCH-01/02/03/04/07/08原门槛，本片未跨下一档：完整发现/安装界面、Rental标准包/全端、异步/AI及正式宿主尚未完成。现有源文件说明、请求和模块阅读入口随实现同步；dev1继续组织/安全，RD接其原主装配与继续Rental剩余HTTP/数据。旧外观失败、合同614项问题、历史缺链及两项集中待清理残留沿接续承接。没有新增临时环境或业务进程，中文提交普通推送后实际回读任务远端。

<a id="core-public-official-calendars-20261118"></a>

## 公共官方日历来源与实际数据计划接线（2026-11-18）

固定父版48a52786a5f5bd4fd01dc99a30f5e516d57d3795与当天真实任务远端一致，包含main7d49c26c9423f2400a233275e84cca5cb4127fa3。dev1在共享树迁入公共来源服务、HTTP、DTO、私有存储及数据定义；RD供给公共合同、原Rental兼容出口、主装配、Guard/OpenAPI消费者并修复结构解析。索引、PCH四册及上传统一由RD负责。原源码和完整接续通过固定父版保全，不重复复制。

[公共来源模块](../../../packages/platform-server/src/modules/official-calendars/README.md)持有来源主档、年度版本追加及原快照读取；[公共来源合同](../../../packages/platform-contracts/src/official-calendar.ts)保留原日期代码和六项来源声明，原Rental/shared再导出同名类型。[公共主装配](../../../packages/platform-server/src/platform-server.module.ts)将同一数据库供给来源存储，以同一应用实例服务维护HTTP和冻结六方法reader；[原组合](../../../apps/api/src/app.module.ts)及[Rental接线](../../../apps/api/src/modules/rental-core/rental-http.providers.ts)复用该实例。业务读取接点不提供save/register，来源维护仍要求原SaaS身份及system:calendar-source:manage；各Core自行裁定业务日历、营业及价格。

公共和原组合OpenAPI共用五个操作、三条路径与七项schema。原路径/operationId/权限保持，来源版本列表补齐原可选整数year过滤，主档名称、ID及HTTPS字段与DTO同步。两表最终快照/sequence/唯一键及RESTRICT外键进入独立公共链，数据版本0.1.3；原组合历史迁移没有变化。[数据计划](../../../apps/platform-api/src/platform-data.ts)核七份原文摘要后形成31表预期。此前构造计划在集成表的建表内换行外键处退出1；[结构解析器](../../../packages/platform-core-host/src/mysql-structure.ts)现与ALTER共用原外键解析，保留引用和删除/更新规则，未知DDL仍拒绝。未执行迁移或写入成功账。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 原正文与字段 | 固定e1104f4b4f5677bfac8fd1370b53c4c58db6c612的来源服务11方法、Controller5方法，可执行正文均一致；三类DTO原字段/装饰器约束保留，日期类型改为公共声明，六项来源合同已沿双向类型夹具核兼容 |
| 定向冒烟 | `node --no-compilation-cache - pch-official-calendar-smoke`，stdin复用原内存加载入口，退出0、stderr空；两个实际Nest切片核同一应用/数据库、旧新Controller同一类、冻结reader及原Rental别名。普通租户通配/SaaS无权限拒绝、有权限允许，原来源快照、停用禁新/历史读取、DTO正常/拒绝及两文档year/操作/schema同源通过 |
| 数据计划 | 同一冒烟实际读取七份SQL及摘要，生成31表预期；集成建表内外键指向Tenant并保留CASCADE，未知DROP拒绝。新增官方来源SQL SHA-256为5a9cbd12aeb905da46d332a028460e6f4bc30d96a7b7381c45c497d472d8e568，原组合迁移差异为空 |
| 同版本类型 | `node --no-compilation-cache - api`，十配置均0诊断，Rental235根/984源/470输出、原API1032根/2560源/2064输出；`node --no-compilation-cache - pch-public-calendar-api-types`，公共依赖及独立API均0诊断，宿主7根/794源/14输出，公共schema31模型/14枚举 |
| 资料与格式 | 本片九份模块/现行资料1626本地链接、151锚点，0问题；稀疏未检目标按固定Git定位，不代替全库检查。七个公共来源子出口、公共合同出口与typesVersions/lock同源，精确暂存后核差异格式 |
| 首轮失败与修复 | 冒烟装载曾猜错正式子出口，随后组合顺序及缺原Prisma枚举使装载失败，均未进入业务断言；按实际根出口、原加载顺序及官方schema枚举修复。新增year查询的字典推断曾产生1个类型诊断，改为同源Schema字典后消除，不放宽字段或运行权限 |
| 环境与未验 | TS5.9.3、Prisma5.22官方WASM/generator，声明/JS与fixture留内存。来源存储/事务/身份为明确fixture，未实例化数据库客户端、访问网络、读.env、启动服务或安装依赖；不是干净安装、真实HTTP/数据库或浏览器验收 |

模块职责、公共出口、原业务采用及数据读取导读同步。公共集成JSON的作者完整命令同时补回[原阶段](#core-public-integration-json-20261118)，不重复跑已通过的四份入口。完整公共页面/组织/安全、Rental标准装配、独立包数据和客户端、无Core真实运行及安装/升级/接手仍未完成；复核PCH-01/02/03/04/06/07/08原门槛，本片未跨下一档。定向资料/格式及远端结果由包含本节的提交定位；旧清理、外观失败及历史缺链沿接续保留。

<a id="core-public-integration-json-20261118"></a>

## 公共集成测试账与宿主JSON空值适配（2026-11-18）

固定父版e1104f4b4f5677bfac8fd1370b53c4c58db6c612已普通推送并实际远端回读。dev1在共享树完成并停写八文件JSON修复组，RD逐项核对源码差异后统一固化；公共集成页面和官方日历在各自文件继续施工，本片不夹带其未完内容。原文及旧接续由固定父版保全，不新增副本。

[公共集成存储](../../../packages/platform-server/src/modules/integrations/integration-store.ts)以updateTestConfiguration表达原连接测试账CAS，[公共应用](../../../packages/platform-server/src/modules/integrations/tenant-integration.service.ts)保留租户、配置ID、修订时间、启用/默认、设置、凭据密文、秘密字段及原测试占用条件。[原组合适配](../../../apps/api/src/modules/integrations/tenant-integration.service.ts)和[公共数据库](../../../apps/platform-api/src/database.ts)分别用本宿主生成客户端的JsonNull映射逻辑JSON null；空对象/空数组仍按原值比较。其余存储方法和调用方事务由同一Prisma实例供给，公共服务不再携带另一生成客户端的空值单例类型。

修改范围为上述四份源码、两份集成模块README及原[安全检查](../../../tests/integrations-security.test.cjs)/[连接与修订](../../../tests/tenant-integration-connectivity.test.cjs)。原安全断言改为读取实际迁入实现，支付/文件的断言补齐固定主线已存在的funding_failed、配置修订与专用文件权限分支；原有效断言保留，未删除或skip/todo变绿。连接夹具核原JsonNull比较，并补null与空对象/空数组不同的最小反例，没有新增脚本。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 作者固定冒烟 | dev1交付四次独立stdin命令 `node --no-compilation-cache - dev1-integration-integrations-security`、`dev1-integration-integrations-memory-scope`、`dev1-integration-tenant-integration-connectivity`、`dev1-integration-tenant-integration-default`；分别内存加载原安全、租户隔离、连接与修订、默认/历史依赖入口，均退出0、stderr空、离线守卫无违规；没有重跑或称独立审查 |
| 作者定向类型 | `node --no-compilation-cache - dev1-integration-store-types`，4入口/586源/0诊断、退出0，原临时目录已删除；不是实际HTTP/数据库/Provider或并发库验证 |
| 同版本类型 | RD的[主/业务HTTP十配置类型](#core-rental-main-http-20261118)已使用本组稳定实现，均0诊断；公共日历合同三配置检查再次消费同一JSON存储，公共服务68根/884源/136输出、Rental235根/984源/470输出均0诊断，产物留内存 |
| 源码与退出 | RD逐项核八文件差异并保存内存SHA-256核对集合，提交前确认未变；模块导读同步原CAS和两宿主映射。具体链接/格式及上传结果由包含本节的固定提交定位 |
| 未验 | SQL/事务/配置/探针为明确fixture，未运行真实供应商、HTTP、数据库并发或公共迁移；公共集成页面及完整宿主接线沿后续阶段核收 |

本片移除已定位的生成客户端耦合，不放宽停用、凭据修改、历史依赖或当前授权。剩余公共页面/日历/组织/安全、Rental标准装配、真实无Core运行及独立安装/升级/接手仍未完成，原PCH本片未跨下一档。没有新增临时环境或业务服务；旧清理、外观失败及历史缺链沿现行接续承接。索引和中文提交/普通推送由RD执行，随后读取真实任务远端。

<a id="core-rental-main-http-20261118"></a>

## Rental核心履约与业务HTTP单源接入（2026-11-18）

固定父版77166afdec23889e534fd3271d3fb2465183d346保全原Controller、接线及完整接续，开工时与实际任务远端相同；当前已包含当天真实main7d49c26c9423f2400a233275e84cca5cb4127fa3。RD与dev1共用原施工树，本片由RD维护Rental HTTP及PCH四册，dev1在非交叉文件推进公共集成与日历；索引由RD统一负责，未夹带其未完页面。

[核心Controller](../../../packages/rental-core/src/http-core.controller.ts)与[业务Controller](../../../packages/rental-core/src/http-business.controller.ts)实际迁入Rental包，旧API两路径仅正式再导出同一类。[应用接点](../../../packages/rental-core/src/http-applications.ts)限定本链实际服务、MySQL视图和明确令牌，[原宿主接线](../../../apps/api/src/modules/rental-core/rental-http.providers.ts)通过19项useExisting及一个可选检查事件方法投影绑定原参加者。原17项/6项构造位置、可选性与HTTP装饰器保持；没有创建第二个业务服务、数据源或原出箱生命周期执行者。公共日志复用platform-server单源，会员/企业结算及官方来源日历仍由实际所有者提供。

原两个Controller共214个方法，其中212个正文与固定父版一致；两处context调用改为[同一快照接点](../../../packages/rental-core/src/http-context.ts)，使用必需的原readBusinessContext与refreshWorkspaceContext，不再重复拼配置或为缺必需服务制造fallback。两份显式操作键解析合为一份，保持原191字符边界；每个动作的默认键、无键、回放和unknown处理仍由原正文决定。原Guard/ALS、当前权限、资金、冻结依据、事务与原收据未改写。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 正文与元数据 | 核心133方法、业务81方法，212正文一致、2处context共用；全部HTTP装饰器一致，实际Nest读取110/74条路由元数据 |
| 首轮类型 | 首次完整类型5诊断，定位公共日志类名、三处ReturnType服务类型引用及freezeOrderSettlement实际boolean返回；改为同源出口和本链精确类型后消除，没有放宽契约 |
| 完整类型与一次冒烟 | `node --no-compilation-cache -`，stdin复用现有内存编译入口并追加本片短冒烟，退出0；十配置均0诊断，Rental235根/982源/470输出、API1032根/2552源/2064输出 |
| 实际Nest组合 | 两个明确fixture容器覆盖原有/缺少可选事件、20接点、旧新Controller对象同一、构造Inject、原实例生命周期只一次、同事务/ALS与业务快照、资产读取委托以及191/192操作键；退出0，无数据库查询和网络 |
| 资料与出口 | 四份本片资料1477本地链接/138锚点无问题；四项新增正式出口的JS/声明与typesVersions对应，peer/meta与lock一致，正式需求/任务无差异，精确暂存后差异格式检查退出0 |
| 环境 | TS5.9.3、原238模型由Prisma5.22官方WASM/generator在内存生成；声明/JS和短核对均留内存，无新增永久测试脚本或临时环境，没有安装/生成共享client/dist、真实HTTP/数据库、浏览器或服务启动 |

源码职责、正式HTTP子出口和原宿主接线已随[Rental包导读](../../../packages/rental-core/README.md)及[原业务导读](../../../apps/api/src/modules/rental-core/README.md)更新。包新增四个正式出口，文件上传适配沿原可选peer与lock版本。此前整体API检查614项问题及未执行的链式后续检查沿[前片](#core-rental-http-entry-20261118)保留，本片元数据及类型不证明OpenAPI全部配对。剩余企业/客户等Controller、业务会员/结算服务、数据/迁移/Seed、页面客户端、AI/作业和完整标准Core装配继续处理，PCH本片未跨下一档。固定交付由包含本节的Git提交定位，中文提交普通推送后实际远端回读；旧清理、外观失败与历史缺链沿当前接续承接。

<a id="core-main-acceptance-docs-20261118"></a>

## 固定最新main验收资料接续（2026-11-18）

Rental HTTP切片2290a1f11e113b6a1c04bac2dd9706b2caf35e88已普通推送并实际远端回读。随后在同一任务分支归并当天核定的main7d49c26c9423f2400a233275e84cca5cb4127fa3，合并提交d32dd1938278fb10136997b8ad4013c222777a3a。相对已接1d53ada2bb79a220e4d99f75f27508bfac5360a5仅改变AI Native三册，没有源代码、合同、配置或迁移变化。三份合并后blob与固定main逐份一致：接续3e1516fd7882afd125ab2404e225928e1b29e81b、任务bb5f0592c1e592316fb1761d5e87152a96f18a9a、记录1f75c3d3d3884ea34bad72d2411b18ea62005df8。

Git索引由RD统一操作，dev1公共集成的未提交源码和测试差异保留，没有切换分支、写主树或覆盖其文件。PCH原需求/任务保持，AI Native验收成果不转作PCH完成度；本片只核固定Git原文、资料链接及格式，不因纯文档合并重复业务冒烟。当前源码继续向Rental主/业务Controller与公共集成页面推进，整体API检查和真实宿主未验边界沿[HTTP阶段](#core-rental-http-entry-20261118)保留。没有新增临时环境、生成物或后台进程。

首次扩查全部上游AI记录触发30秒工具超时，未形成验证结果；工作区/索引重新核对无丢失。收窄至本片两册，复用原文档检查器及固定Git定位，899本地链接/130锚点无问题，差异格式检查退出0。上游三份原文仍以逐份blob一致性证明完整迁入，不把本片定向检查称作全库文档通过。

<a id="core-rental-http-entry-20261118"></a>

## Rental空间能力与员工收款HTTP单源接入（2026-11-18）

固定父版d08dc345983672850a8c13728b0f9add987ad287保全原Controller、DTO及完整接续，已实际远端回读。RD与dev1继续共用原施工树；本片由RD迁入两条Rental HTTP链，dev1在非交叉文件修公共集成和接公共页面。当天真实main为7d49c26c9423f2400a233275e84cca5cb4127fa3，相对已接1d53ada2bb79a220e4d99f75f27508bfac5360a5只改AI Native三册；待本片固化后按固定版本归并，不整取其他树WIP。

[空间能力Controller](../../../packages/rental-core/src/http-workspace-capabilities.controller.ts)、[员工收款Controller](../../../packages/rental-core/src/http-staff-payments.controller.ts)及[空间能力DTO](../../../packages/rental-core/src/http-workspace-capability.dto.ts)实际迁入Rental包，原三路径仅再导出同一类。[HTTP服务接点](../../../packages/rental-core/src/http-service-ports.ts)只给出本链实际方法与两个令牌，[原AppModule](../../../apps/api/src/app.module.ts)通过useExisting提供原服务实例。原8条路径、10个方法正文/HTTP装饰器和DTO校验保持；原Guard/ALS、员工地点范围、操作人、业务事务、审计和原收据沿原链裁定，无Core公共宿主不登记这些Controller。

现有API合同/权限检查原先只读旧Controller正文。新增共用[源码发现接点](../../../scripts/controller-sources.cjs)，沿本仓库正式包出口、再导出和继承读取实际实现，两个原检查复用此入口；不执行Controller/Core或加载宿主。原合同、schema引用、权限及Seed断言未删除或放宽。发现81份实际源码，包含两个迁出Controller、公共认证父类、订阅/集成和Core管理转接。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| HTTP包级冒烟 | 复用既有stdin内存入口，退出0；实际Nest路径/Inject元数据、原服务委托、缺空间拒绝、空地点范围、同一ALS及旧新Controller对象同一性通过。服务/身份为明确fixture，无数据库查询 |
| 完整类型与原用例 | `node --no-compilation-cache - api tests/workspace-capability.test.cjs`，退出0；十配置0诊断，Rental231根/958源/462输出、API1031根/2548源/2062输出。原空间能力用例全部通过，未新增永久测试脚本 |
| 共同版本 | 上述完整类型使用dev1当前已稳定的集成JSON存储修复；编译前后11份HTTP/存储接点正文一致。修复由所属宿主映射本schema的JsonNull，保留原测试配置CAS；其独立阶段由dev1交付后统一固化 |
| 失败与缺口 | 首轮完整类型2处集成JsonNull诊断已由dev1修；仅三包装载原用例的早期虚拟依赖解析失败保留。现有API合同检查仍退出1，报告614项：包括符号/单引号路径尚未识别及其他未配对路径；本片8条路由没有缺合同/缺Controller报告。链式后续DTO/权限/客户写归属检查未执行，不称整体合同检查通过 |
| 资料与出口 | 六份现行/模块资料1547个本地链接、173个锚点，0问题；2个DTO类正文与固定父版一致，4个新增出口的JS/声明及typesVersions解析到同一产物，差异格式检查退出0 |
| 环境 | 原238模型由Prisma5.22官方WASM/generator在内存生成，TS5.9.3；源码/声明/JS和短核对均留内存。没有安装、生成共享client/dist、真实HTTP/数据库、浏览器、迁移或服务启动 |

源码职责、正式出口及实际接线同步到[Rental包导读](../../../packages/rental-core/README.md)和[原业务导读](../../../apps/api/src/modules/rental-core/README.md)。完整Rental主/业务Controller、各端、schema/迁移/Seed、标准装配与AI/作业仍待收口；API源码发现的非字面量路径缺口纳入后续接口规范化。原PCH本片未跨下一档，需求/任务身份与规则保持。旧清理受阻、外观失败及历史缺链沿现行接续承接，不以局部通过证明全功能或正式验收。固定提交由包含本节的Git提交定位，普通推送后读取真实远端。

<a id="core-shared-dev1-migration-20261118"></a>

## 副手成果迁入与共享工作树协作（2026-11-18）

负责人明确要求RD与dev1共用本树持续完成原PCH拆分，并允许双方为具体冲突和阻塞直接协商。本轮施工方式覆盖任务册第2节“并行作者必须独立工作树”的旧约束；正式需求、任务编号/范围/依赖/顺序和G1～G4门槛保持。迁入前RD固定提交c6351b288a08ae80a17cf36f7cb1c4cc715bef00及旧接续由Git保全，当日实际远端main为1d53ada2bb79a220e4d99f75f27508bfac5360a5，已在本树祖先。

dev1已确认旧树停写、未完成写操作0、运行验证进程0。其[公共订阅服务](../../../packages/platform-server/src/modules/subscription/README.md)与[订阅后台](../../../packages/platform-admin/src/features/subscription/README.md)固定交付ee3295d07ab96c5a1a8d75cf9efb2412b3ead63e迁入为98949e534effa193ab96ddce898f70d85b1c10f9，原API与后台继续转接同一实现。29模型、6份迁移的[公共schema](../../../apps/platform-api/prisma/schema.prisma)现包含统一订阅办理、第三方配置和适配日志；原组合schema及已应用迁移未改写，新增公共迁移仍未执行。

基础集成尚未完成。旧树24份已跟踪差异与19份新增文件先保存为未完检查点719cb92e919b140027cc56e10434e9ec77db5a09，普通推送退出0，实际远端回读相同；再迁入为af89920dd4df3dca12cd2e3e6add14491ff7f425。[公共集成](../../../packages/platform-server/src/modules/integrations/README.md)持有配置/凭据/短信/对象存储接点，[原Rental参加者](../../../apps/api/src/modules/integrations/rental-integration-business.participant.ts)保护原支付、短信、文件依赖；完整类型、集成冒烟、公共后台及示范宿主接线由共享施工继续核验，不能把检查点当完整公共能力。

| 迁入/退出核对 | 实际结果与边界 |
| --- | --- |
| 成果去向 | 起点48a5至源检查点共129个变更路径，121个同内容或同移除，8个明确合并当前AppModule/OpenAPI、模块导读、正式包出口及权限兼容；19个新增文件均在，缺失0 |
| 包出口与权限 | 合并原精确后台兼容出口及新增订阅出口；原权限算法一致，新common路径转接同一正式实现，JSON同名出口去重，原精确或*语义保持 |
| 格式/合同修正 | 来源检查点保留4处混合换行空白问题，本树只规范该文件换行，可执行正文一致；首轮公共合同3诊断来自本包自引用，改用同一Provider的相对导入/再导出后消除 |
| 必要类型 | 复用既有全内存入口，`node --no-compilation-cache - api-rental-only`，退出0；公共合同9根/203源/18输出、公共服务61根/849源/122输出、Rental227根/954源/454输出，均0诊断；TS5.9.3与原238模型Prisma5.22官方内存声明 |
| 冒烟边界 | 来源订阅提交记录58/58为原作者固定证据；RD首轮十配置/一份订阅用例被上述合同诊断中止，未执行到用例。修后本片只完成三配置类型，完整API/公共宿主/前端类型及实际订阅和集成冒烟仍由后续切片核验 |
| 资料与差异 | 六份现行/模块资料952个本地链接、130个锚点，0问题；git diff --check退出0。需求和任务无差异，验证未新建脚本或临时环境 |
| 旧树移除 | 原C:/Users/Penn/.codex/worktrees/saas-platform-dev1/rental-OS为4,308文件/46,105,313字节、0链接；核绝对目标、清洁状态、忽略文件为空、固定HEAD与无在用进程后，原生PowerShell内调用Git worktree remove，退出0；旧目录和Git登记均已不存在，源任务分支及固定Git成果仍保留 |

共享施工目录为C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS、分支codex/platform-core-extraction。RD独占Git索引、提交/普通推送及PCH四册，继续Rental/Controller/客户端/数据与总装配；dev1持续负责公共订阅/基础集成的API/UI/数据及模块导读，后续补公共组织/其余安全。双方按文件分工，共同文件先约具体短窗口，真实冲突直接单点协商。dev1的attach_worktree因聊天归属核验失败未完成UI关联，但已显式在共享目录核验分支与HEAD；所有命令必须指定共享workdir，不再使用已移除旧树，不为工具关联失败新建或复制工作树。

本片没有新增测试脚本、安装依赖、临时验证目录或后台业务服务，原worker均已退出。SQL/事务/身份及供应商仍未取真实环境证据，原任务未跨下一档。完整Rental标准包、无Core真实运行、双Core、干净安装、独立更新/回退/接手及独立审查沿下列现行缺口承接；旧清理待办、外观1失败和缺失历史附件保留。共享分工的持续目标通过负责人指定的dev1聊天下发，其他专项和PM/QA未通知。

<a id="core-rental-enterprise-approval-runtime-20261117"></a>

## Rental企业批准、明确委托与续租事务收口（2026-11-17）

固定父版6d142a6bd96b829c0f124308d8f0dd9d1cd8e6d2保全原服务与完整接续，开工回读任务远端为同一SHA；实际main为1d53ada2bb79a220e4d99f75f27508bfac5360a5，已在本树祖先。副手继续在自己的树处理公共订阅/基础集成，本片只修改本对话Rental切片及原资料。

[预约批准](../../../packages/rental-core/src/mysql-enterprise-approval.ts)、[续租费用批准](../../../packages/rental-core/src/mysql-enterprise-extension-approval.ts)、[换货费用批准](../../../packages/rental-core/src/mysql-enterprise-exchange-approval.ts)、[企业商户委托](../../../packages/rental-core/src/mysql-enterprise-merchant-delegation.ts)及[明确委托提交](../../../packages/rental-core/src/mysql-enterprise-merchant-order-submission.ts)实际迁入Rental包，旧Nest路径只供给原七/七/十/七/四项依赖。原申请/审核、费用确认、本人具体检查同意、商户履约和资金分别裁定；原D/K、订单锁、批准消费和收据保留同一事务，unknown不换键重发。五服务共78个方法正文与固定父版一致，没有删除方法或新增另一份执行者。

[私有参加者](../../../packages/rental-core/src/enterprise-approval-ports.ts)只描述本链需要的存储、客户API、Core与原幂等方法。事务绑定明确为原Prisma.TransactionClient，MySQL子出口由宿主生成模型和Nest依赖供给；领域根出口及公共Core清单不加载此链。原Controller/DTO/OpenAPI仍使用原路径、权限及字段，本片未改HTTP合同；源码职责和接入说明随[Rental包导读](../../../packages/rental-core/README.md)及[原业务导读](../../../apps/api/src/modules/rental-core/README.md)同步。

必要冒烟核定两处真实调用问题，固定父版和main3e0b2c72865fa0a21053f26608bda878861c9f90均有原调用：续租报价上下文未把已有事务传给持久原报价读取；客户层在Core生效已经占用授信后又调用同一占用。现[报价服务](../../../packages/rental-core/src/mysql-business-runtime.ts)显式传入tx，原报价/价格读取及配置仍在调用方事务；[客户API](../../../apps/api/src/modules/client/client-api.service.ts)保留Core生效结果，只办理自己的服务容量，不重复调用授信。计价算法、金额、原批准和资金门禁没有改写。原测试保持所有有效断言，其中同事务读取断言和四个业务事件的精确计数证明这两处调用已修正。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 迁移正文/注入 | 17/16/26/17/2个方法，共78个正文与固定父版一致；五个原构造的依赖顺序保留，包内同事务端口只映射实际类型 |
| 早期类型失败 | 首次独立包31诊断，原泛型事务缺实际类型、检查原收据端口缺readReceipt；补真实参加者后0诊断，没有放宽类型 |
| 原冒烟失败保留 | 原两文件共42例，首轮15通过/27失败；夹具缺原币种、普通报价委托查询、当前订单/完整配置来源、Core资金/授信和客户getOrder等实际接点。第二轮37/5、第三轮39/3；后两轮还核定漏传事务与重复授信实际问题，未将其冒充夹具问题。定向修夹具、原目标文件位置及这两处生产调用，原有效断言保留 |
| 完整API类型及冒烟 | `node --no-compilation-cache - api-approval-final tests/enterprise-approval.test.cjs tests/enterprise-extension-approval.test.cjs`，stdin复用既有内存验证入口，退出0。十配置均0诊断，Rental227根/953源/454输出，API1030根/2521源/2060输出；原42/42、fail/skip/todo/cancelled均0 |
| 数据与环境 | 原238模型由Prisma5.22官方WASM/generator内存生成，TS5.9.3；SQL/锁/资金/授信来源仍为明确fixture，产物留内存，无安装、真实HTTP/数据库、迁移或服务启动 |
| 资料/包/退出 | 六份阶段及模块文档1519个本地链接、169个锚点引用，0问题；包194个出口及五项新增服务的JS/类型对应核实，peer与lock一致，需求/任务无差异，`git diff --check`退出0。worker已退出，output/.tmp为空 |

未新增永久测试脚本，只调整两份现有定向验证的真实源码定位与必要夹具。42项证明本片离线正常/拒绝、原键/失应答、回滚、当前授权、费用确认和代表性客户端行为，不能证明完整Core装配、真实存储或所有客户端正常。PCH-08的完整服务/Controller、schema/迁移/Seed、页面/客户端及AI/作业还需收口，原任务本片未跨下一档；需求/任务v1.5、编号、依赖、顺序及计分保持。

两份旧临时残留仍沿[责任与处理记录](#core-main-notification-sync-20261117)承接。2026-11-17T15:47:41.734Z原生PowerShell安全删除命令仍在启动前被自动审批以blocked by policy拒绝，命令内预检查没有执行；另行只读核实840文件/91,808,304字节与1个0字节guard.log，均0链接，责任清单已更新。没有换壳/工具删除，不能称已释放空间。完整无Core运行、干净安装、更新恢复、多真实Core、浏览器及独立接手/审查仍未验。固定交付由包含本节的提交定位，普通推送后再读取实际任务远端。

<a id="core-main-notification-sync-20261117"></a>

## 固定主线通知草稿、委托与后台兼容接续（2026-11-17）

固定父版85780491bb9e5df0ce2b0ad3550345e71dabe63f已普通推送并实际远端回读，保全原实现和完整接续。本片在独占任务树归并固定main3e0b2c72865fa0a21053f26608bda878861c9f90，九处冲突逐项保留上游功能及已迁出单源；主树和副手树未写入。源码阶段提交372327384c4b466241bf0f62ed8fe705a15cd8ac，普通推送退出0，实际远端回读为同一SHA。随后顺序归并固定main1d53ada2bb79a220e4d99f75f27508bfac5360a5，只新增AI Native三册的两项文档提交；这三份blob与固定main一致，其余源码无差异，不因文档整合重复业务测试。

[报价/营销聚合](../../../packages/rental-core/src/mysql-business-runtime.ts)、[报价事实](../../../packages/rental-core/src/mysql-business-facts.ts)和[恢复快照](../../../packages/rental-core/src/mysql-state.ts)接住上游通知草稿准备/保存/原结果、报价提交前回调及恢复正文剥离。原业务API保持14项构造依赖，适配层供给原[正文保留读取器](../../../apps/api/src/modules/ai-native/privacy/retention-notification-draft.ts)，Core不反向导入API源码。清理策略、删除账及原校验仍由维护服务裁定，缺读取器明确不可用。

[草稿合同](../../../packages/rental-core/src/notification-draft.ts)、[核验缓存](../../../packages/rental-core/src/notification-log-cache.ts)和[恢复投影](../../../packages/rental-core/src/notification-snapshot.ts)由三个正式子出口提供，原路径窄转接同一对象。原结果按当前范围/权限读取原行及删除账；缓存仅包含核验过的不可变无正文metadata，WeakSet标记不随反序列化传播。保存恢复副本再次剥离草稿正文，普通发送记录保持原值。原结果读取不发送、不写入、不换键重做。

[订单确认](../../../packages/rental-core/src/mysql-order-confirmation.ts)、[原委托来源](../../../packages/rental-core/src/enterprise-order-delegation-source.ts)及[同源委托合同](../../../packages/rental-core/src/enterprise-order-delegation.ts)接住个人付款委托、提交资格复验与委托匹配。原新业务裁定/事务和个人付款、企业付款的不同条件保持。公共[权限匹配](../../../packages/platform-server/src/permission-match.ts)迁为单源，原API再导出；[AppModule](../../../apps/api/src/app.module.ts)同时保留原外观provider和新增AI Native接线。

公共后台补齐原panelRightOpen/panelRightClose实际图标及AnimatedIcon登记，旧路径再导出同一组件，两份源码SHA-256分别为0c49f2e1bedf44f7220f1ce4deb35667bcb711e18b677c5e922130e5511d0d08、cb36d9c4f9a22250ab73c43c27e9b62750a6ff4ba4cae8a95a4d97875a28e4b9，与固定main及既有来源记录一致。

后台完整类型进一步暴露旧`/source/*`目标缺少扩展名的真实出口问题。标准TypeScript解析确实不能找到theme等原组件，之前带源码映射的验证不足以证明这一边界。现将193个实际兼容路径在[包配置](../../../packages/platform-admin/package.json)中精确映射文件及扩展名；14个公共正式出口保持，原页面不改导入名。统一能力索引跳过这些重复兼容路径，继续从正式UI/Core等入口发现功能。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 主线业务正文 | 19个受影响方法与固定main的可执行正文一致，仅映射包内类型和真实参加者；没有重写草稿、委托、锁/事务或原收据算法 |
| 后端与原企业冒烟 | `node --no-compilation-cache - api tests/enterprise-workflows.test.cjs` 的十配置0诊断，原101/101、0fail/skip/todo/cancelled；原238模型由Prisma5.22官方WASM/generator内存生成，TS5.9.3，原API1030根/2515源/2060输出 |
| 单次定向行为 | `node --no-compilation-cache - api-main-sync-behavior` 经stdin复用实际编译的API薄适配、Rental、SecretBox、ALS和原维护读取器，退出0、1/1；保留/删除原结果、无正文缓存、品牌不可复制、坏删除账/跨范围/缺权限/缺行拒绝、两类unconfigured委托差异通过，原读取writes=0。SQL/身份/存储为明确fixture，无HTTP |
| 正式前端类型 | 修正依赖顺序及真实出口后，`node --no-compilation-cache - api-frontend` 的七配置退出0；公共后台237根/2499源、原后台661根/4259源均0诊断，声明/JS留内存，未使用源码出口替身 |
| 前置失败保留 | 前三次前端准备漏前置合同或platform-server声明；补完整顺序后原后台3679诊断，定位为兼容出口缺扩展名。修实际包配置后一次定向复验通过，未放宽类型或原业务断言 |
| 资料与收尾 | 六份阶段/模块文档1468本地链接、129锚点引用，0问题；现有文档检查器及固定Git定位稀疏目标，未改检查器。差异空白检查退出0，修掉本片一行空白。原PCH需求/任务与lock无差异，output/.tmp为空，验证进程已退出 |

原需求/任务v1.5、编号、顺序、依赖及原分档保持；本片未跨下一档。源码头及[Rental导读](../../../packages/rental-core/README.md)、[原业务导读](../../../apps/api/src/modules/rental-core/README.md)、[公共服务](../../../packages/platform-server/README.md)与[公共后台](../../../packages/platform-admin/README.md)同步说明真实接点。未新增永久测试脚本、依赖环境、共享生成物或业务服务；前后端验证进程均已退出。真实数据库/HTTP/浏览器、干净安装、升级恢复、完整无Core运行、多Core及独立审查仍未验，旧外观及历史附件问题继续保留。

负责人指定的dev1已实际在独立树进行公共订阅及基础集成；最近一次紧凑快照确认公共合同、服务、后台与独立API类型通过，原API参加者接线继续验证。此片不整取其活动WIP，固定交付由本对话读取后按差异整合。

两处旧残留的原生PowerShell删除再次在启动前被自动审批以blocked by policy拒绝，命令内预检查未执行；责任清单最近尝试时间更新为2026-11-17T13:53:33.619Z。未换壳/工具绕过，两处仍为已归集、删除受阻，不能称释放空间。本片没有新建依赖环境或临时文件。

<a id="core-rental-enterprise-workflow-runtime-20261117"></a>

## Rental 企业申请、管理请求与原任务投影（2026-11-17）

固定父版48a5ecac5a1a1c6d974e183260a7895e5fe10c56已普通推送并实际远端回读，保全原服务、客户/费用合同和完整接续；实际远端main62ca183f10b7c316ab63c28ef6d04ee88d06488b已在任务祖先。[企业申请](../../../packages/rental-core/src/mysql-enterprise-application.ts)、[管理请求](../../../packages/rental-core/src/mysql-enterprise-management-request.ts)、[企业待办](../../../packages/rental-core/src/mysql-enterprise-task-center.ts)、[行政交接](../../../packages/rental-core/src/mysql-enterprise-rental-handoff.ts)和[成员审计](../../../packages/rental-core/src/mysql-enterprise-membership-audit.ts)成为Rental包实际单源，原API保留原Nest依赖类型/顺序并供给同一实例。

[付款证明来源](../../../packages/rental-core/src/enterprise-payment-proof-source.ts)及[管理员交接收据投影](../../../packages/rental-core/src/enterprise-transfer-receipt-projection.ts)随链迁入；付款证明仍核原订单修订、冻结文件及当前客户/商户权限，管理审核不改变政策、授信或确认资金到账。待办从持久原申请/批准/收据形成，行政交接不改订单或主体，读取后继续核当前作用域。[私有参加者](../../../packages/rental-core/src/enterprise-workflow-ports.ts)只列实际批准list与客户原交接材料，存储继续使用原实例，保留事务/非事务身份比较与锁顺序。

[客户API合同](../../../packages/rental-core/src/client-contracts.ts)、[续租费用合同](../../../packages/rental-core/src/enterprise-expense.ts)和[换货费用合同](../../../packages/rental-core/src/enterprise-exchange.ts)由纯业务出口维护，原shared兼容再导出全部声明与运行时常量。公共品牌/文件形状继续复用platform-contracts，客户端入口不加载MySQL或Nest。原Controller、DTO与OpenAPI路径未改变，入口和schema链接已同步到[包导读](../../../packages/rental-core/README.md)及[原业务导读](../../../apps/api/src/modules/rental-core/README.md)。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 原业务正文 | 七份实现共97个方法/函数及构造正文与固定父版一致；原授权、主体映射、材料、Tenant锁、事务、幂等、历史投影和原收据不变 |
| 合同与正式出口 | 客户105、续租21、换货12个非import/转接声明正文相同；11个新增正式子出口及typesVersions指向实际产物，运行依赖/peer/lock不变 |
| 必要类型 | `node --no-compilation-cache - api-enterprise-projections tests/enterprise-workflows.test.cjs` 的十配置均0诊断，包含公共包、Rental/shared、MCP和原API直接消费者；原238模型由Prisma5.22官方WASM/generator在内存生成，TS5.9.3。Rental为218根/943源/436内存输出 |
| 原冒烟 | 最终 `node --no-compilation-cache - api-enterprise-smoke tests/enterprise-workflows.test.cjs` 退出0，原101/101、0fail/skip/todo/cancelled。复用既有夹具及内存产物，涵盖审批、重复键、回滚、后续撤权、原反馈/付款证明、任务/审计及行政交接；SQL/存储/事务是明确fixture，非真库/HTTP |
| 文档/格式与原接线 | `node --no-compilation-cache -` 定向四份文档1366本地链接/123锚点，0问题；五个原Nest构造的参数名/类型/顺序/Optional一致。`git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 退出0，正式需求/任务及lock无差异 |

首轮类型检查发现批准视图来源与一个包内自引用缺项，修正为唯一正式来源；随后十配置类型通过。首次冒烟98/101，三例是原shared运行时投影改由独立VM递归加载后产生不同对象原型，业务正文不变；仅把既有loader映射到同一正式运行时，再做上述复验。测试只新增七个源码定位及同源运行时映射，共10行，业务断言全部保留，没有新增测试脚本或skip/todo。

父版完整PCH依据与任务身份、依赖、顺序继续保留；本片未跨下一档。Rental费用批准/委托、Controller、数据/迁移/Seed、页面/客户端、标准装配及AI/作业的完整组合仍待推进，浏览器、真实数据库/HTTP、干净安装、独立更新/回退/接手和审查未验。当前worker已退出，output/.tmp为空；旧两处集中待清理及外观/历史附件问题沿原接续保留，不以本片通过掩盖。

本片已在 codex/platform-core-extraction 提交 ce322abb312ad134c101f14abb4e5094a52b6c19，普通推送退出0，实际远端分支回读为同一SHA；工作树与索引干净，main仍为上述固定版本。

负责人已自行创建并明确指定副手 `[Saas 底座]-dev1`（01a1e8ef-3ca4-7b10-ac1f-7055cde66798）。本对话经一次单点交接工具成功下发固定48a5基线及独立工作树要求，已观察该任务开始；副手先做完整公共订阅，再做基础集成，公共源码/包导出/装配必要差异在其独立树维护。实际Git登记已确认副手树为 C:/Users/Penn/.codex/worktrees/saas-platform-dev1/rental-OS、分支 codex/saas-platform-dev1，起点48a5保持；本对话继续Rental并维护PCH四册，主动读取其首个固定交付后整合。未通知PM/QA或其他对话，没有重建已有聊天或派额外助手。

<a id="core-rental-enterprise-policy-members-20261117"></a>

## Rental 企业政策、成员邀请与管理员交接（2026-11-17）

固定父版d46319b85cdad81f66c2b69e3e8ca57729ab5a24已普通推送并实际远端回读，保存原服务、合同和完整接续；main62ca183f10b7c316ab63c28ef6d04ee88d06488b在任务祖先。[企业政策](../../../packages/rental-core/src/mysql-enterprise-policy.ts)、[邀请/成员与管理员交接](../../../packages/rental-core/src/mysql-enterprise-members.ts)、[管理员连续性](../../../packages/rental-core/src/enterprise-administrator-continuity.ts)及[原委托来源](../../../packages/rental-core/src/enterprise-order-delegation-source.ts)成为Rental包单源。旧API的政策/成员provider只供给原三项/四项Nest依赖，其他旧路径再导出同一读取；保留同一存储实例及原事务，不通过克隆视图破坏政策的实例身份判断。

[政策合同](../../../packages/rental-core/src/enterprise-policy.ts)、[交接K/C结果](../../../packages/rental-core/src/enterprise-transfer-decision.ts)、[委托合同](../../../packages/rental-core/src/enterprise-order-delegation.ts)及[客户服务项/续租请求](../../../packages/rental-core/src/client-order-requests.ts)迁入纯业务出口，原shared再导出同一声明/运行时。后两项客户接口只移动原字段，未新增或改写请求；公共人员合同仍来自platform-contracts。MySQL私有视图只列实际查询、事务及业务表，资格和关系写入分别接原requireAction与saveEnterpriseRelation，不把企业客户成员作为公共租户后台人员，也不向通用Core合同开放Prisma。

| 必要核对 | 实际结果与边界 |
| --- | --- |
| 业务正文 | 政策24、成员39、连续性2、委托来源2，共67个方法/函数正文与固定父版一致；原限额、一次性原码、告知、Tenant锁/修订、最后管理员保护、当前关系/动作、批准和原K/C不变 |
| 合同与旧入口 | 三份合同全部声明/函数及两个客户接口字段一致；原Nest构造参数类型/顺序保持，八个新正式子出口及typesVersions均指向实际源码；运行依赖、peer与lock未改 |
| 原基线 | 父版原政策11项及原工作流101项分别通过，沿[政策夹具](#core-enterprise-policy-fixture-20261117)和[工作流基线](#core-enterprise-workflow-fixture-20261117)固定证据；不是默认推断原全部业务正常 |
| 候选行为 | node --no-compilation-cache - api-enterprise-policy-members-candidate tests/enterprise-policy.test.cjs tests/enterprise-workflows.test.cjs，PID18440退出0、stderr空，112/112、0 fail/skip/todo/cancelled；只修原用例源码/依赖定位，73/862处断言及11/104处原test声明保持。缺交接运行时的原503反例仍拒绝且不写 |
| 正式类型 | 官方Prisma5.22原238模型、TS5.9.3，十个正式配置0诊断；Rental207根/932源/414输出，完整原API988根/2451源/1976输出；声明/JS均留内存，未写共享client/dist |
| 资料与收尾 | 四份本片模块导读/记录/接续定向检查1326个本地链接、121个锚点，0问题；git diff --check退出0，正式需求/任务无差异。worker18440已退出，无新增临时环境或后台服务 |

首轮PID53284在Rental类型阶段退出1，发现ClientOrderExtensionRequest仍属于shared/client，未进入业务测试。定位后把它与原服务项字段迁入Rental纯合同并保留兼容出口，再用同一入口复验通过。stdin复用原验证入口，SHA-256 f7fbc5a38ad010ed28d18208bd28d807750ee3e839841c716d5e0f77c2a68579，没有新增测试脚本、依赖环境或临时目录。

SQL执行、锁、行、事务及授权数据仍为明确fixture；实际服务与原Controller/DTO消费不等于真实MySQL/HTTP、完整Nest宿主、浏览器或标准包安装。源码职责、Rental/原API导读和当前接续同片更新；下一步继续企业申请/管理请求/任务中心、费用批准与委托、Controller及剩余业务，然后数据/迁移/Seed、页面/客户端/作业/AI和标准Rental装配。公共组织/完整订阅/集成、无Core真实运行、多真实Core、独立升级/回退/接手与审查仍未齐。按原G1～G4复核未跨下一档，正式需求/任务保持，不按移动文件或用例数计分。

原两处集中待清理残留与责任清单保留，本次原生PowerShell删除仍在启动前被自动审批以blocked by policy拒绝，没有换壳/工具绕过；不能称已删除。阶段结束精确暂存、中文提交并普通推送当前任务分支，上传后读取实际远端，不合main或发布。

<a id="core-enterprise-workflow-fixture-20261117"></a>

## 原企业工作流验证入口与SQL绑定夹具（2026-11-17）

固定生产源码为709c943e7aaf47752570e49df7c75a74c5476193，实际任务分支和远端相同，main62ca183f10b7c316ab63c28ef6d04ee88d06488b已在祖先。本片只修[原工作流用例](../../../tests/enterprise-workflows.test.cjs)的源码/依赖定位及夹具，企业政策、申请、成员、管理员交接和Controller均未改。原ALS、命令、客户主档及资格读取跟随已迁移单源实现，VM继续使用原可控时钟；工作流写入边界改为本树output/.tmp/enterprise-workflows。

初次运行先暴露旧Nest转接定位、Optional装饰器和企业读取依赖缺项；进入原101项后，PID55272与单次输入诊断PID55760均退出1，36通过/65失败。诊断证实Prisma.sql把参数放在SQL对象内部，而夹具读取空的rest参数；sqlParts已经解析出正确绑定，只是调用方没有使用。仅修正读写夹具消费解析后的values，保留全部SQL谓词和业务断言，PID37976成为93通过/8失败。七份只读审计夹具再补明确audit:read动作，PID43344为94通过/7失败；最后补同一客户audience及有界workspace动作接口，原撤权变量继续驱动前后资格。发布品类夹具只承认本用例vehicle的published事实，并断言published/legacy_baseline过滤，不放行任意品类。

最终node --no-compilation-cache - api-enterprise-source-before tests/enterprise-workflows.test.cjs，PID47920退出0、stderr空，101/101、0 fail/skip/todo/cancelled；101个原用例和业务拒绝、撤权、同键、并发、原收据及回滚断言保留。覆盖私有申请/主体认领、邀请限额与一次性原码、成员及管理员当前关系、已接受交接、独立拒绝K/C、原反馈/读取审计与有界列表。它是SQL/锁/存储/事务明确fixture的离线证据，不是真实数据库、HTTP、浏览器或完整宿主验收。

官方Prisma5.22原238模型、TS5.9.3，四个正式配置0诊断；Rental199根/924源/398输出，公共服务39根/825源/78输出，声明/JS留内存。迁移前必要完整API类型亦已通过：988根/2443源/1976输出，十个配置0诊断；该次因夹具装载失败退出1，不能把它写为工作流通过。复用stdin检查SHA-256为f7fbc5a38ad010ed28d18208bd28d807750ee3e839841c716d5e0f77c2a68579，没有新增测试脚本、依赖、临时目录或后台服务。

本片为企业政策、成员/申请及管理员连续性迁移的前后对照准备。原PCH门槛未跨下一档，正式需求/任务正文保持；完整Rental包、公共组织/订阅/集成、数据与标准装配和全功能验收继续实施。接续核定PID47920已结束且退出0；104处原test声明及859处原assert调用保留，增加三处夹具参数断言，无skip/todo。两份记录/接续824本地链接、116锚点0问题，diff --check退出0。旧两处集中残留的原生PowerShell删除仍在启动前被自动审批以blocked by policy拒绝，责任清单最近尝试为2026-11-17T08:47:09.724Z；当前验证不使用旧环境，没有换工具绕过，不能称已删除。中文提交和普通推送当前任务分支，实际远端回读后再迁移服务。

<a id="core-rental-customer-master-20261117"></a>

## Rental 客户主档、会员及唯一写入归属（2026-11-17）

固定父版0629bdfe89e48f83beae105a0e09bd51f48933d8已提交、普通推送并实际远端回读，保存本片原仓储和完整接续；main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍在任务祖先。原[客户仓储](../../../packages/rental-core/src/mysql-customer-master.ts)实际迁入Rental包，[MySQL视图](../../../packages/rental-core/src/customer-master-storage.ts)只消费五个客户模型、企业关系表及其原调用方事务；原API类只供给同一PrismaService，并保留原完整事务类型别名。客户合同已由Rental维护，本片不新增跨Core共享客户模型或通用客户权限。

30个执行单元与固定父版正文相同，保留租户共享主档/唯一会员、手机号复用、当前ALS创建归属、掩码及三态账号摘要、原普通资料单调修订/姓名CAS、合并CAS、实名事实专用入口和账号/会员预期状态。注册重试不激活已受限会员，后台口令重置不解除暂停；原Prisma唯一键冲突只读取赢家，其他错误继续抛出。企业关系同毫秒/时钟回退仍推进原修订，个人/企业状态和合并在原事务失效迁移企业授权，不重绑旧政策/批准，不改订单或资金历史。[原注册链](../../../apps/api/src/modules/platform/customer-registration.service.ts) · [原客户/会员消费](../../../apps/api/src/modules/platform/membership.service.ts) · [企业成员消费](../../../apps/api/src/modules/enterprise/enterprise-members.service.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 原注册基线 | node --no-compilation-cache - api-customer-master-baseline tests/customer-registration-unified.test.cjs，PID38860退出0、stderr空，九组原直接断言均通过 |
| 同入口候选 | api-customer-master-candidate，PID34172退出0、stderr空，同样九组全部通过；原脚本无修改，覆盖后台/客户端注册、账号/会员与审核复用、锁后状态、只新增导入和普通资料CAS |
| 正式类型与产物 | 官方Prisma5.22原238模型、TS5.9.3，十个正式配置0诊断；Rental199根/924源/398输出，API988根/2443源/1976输出；声明/JS留内存，未写共享client/dist |
| 写入口归属检查 | node scripts/validate-customer-write-ownership.cjs退出0；扫描1187个文件，五模型16处写调用全部在新唯一仓储。原规则同步扫描API和Rental包，模型/写方法正则保持 |
| 检查负例 | 对旧API provider和Rental合同文件分别注入一处旁路客户写入的内存fixture，原检查器均退出1并定位对应文件；未改磁盘源码或新增测试脚本 |
| 源码/兼容出口 | 30单元正文相同，原单参数Nest注入及旧方法签名/导出保持；两个正式子出口/typesVersions有实际源码，原依赖和lock无差异。Controller/DTO/OpenAPI/AppModule/schema/迁移/Seed未改 |

注册数据库、锁、事务及行行为仍为明确fixture；同一源码、真实密码/ALS和服务执行不等于真实MySQL并发/约束、HTTP、完整Nest宿主或浏览器验收。本片未运行读取.env的客户主档/管理端真库脚本，未做标准包安装、多真实Core、升级/回退、独立接手或审查。继续企业政策/成员/工作流服务及剩余Controller、数据/迁移/Seed、客户端/作业/AI和标准Rental装配；完整公共组织/订阅/集成及05/06/07范围仍未齐，按原G1～G4复核未跨下一档，正式需求/任务保持。

源码短头、原不变逻辑说明和两个模块导读与当前接续同片更新；包MySQL私有适配仍使用原Prisma类型/runtime，不从领域根出口加载或泄漏到公共Core清单。所有worker已退出，output/.tmp无新增产物；旧两处残留和原责任清单沿前片保留，原生删除的自动审批拒绝不冒称已清理。定向九份文档1521本地链接/176锚点/102表格0问题，原换行约束下diff --check退出0。中文提交普通推送当前任务分支，上传后读取实际远端，不合main或发布。

<a id="core-enterprise-policy-fixture-20261117"></a>

## 原企业政策验证夹具与发布品类依据（2026-11-17）

固定源码为4ad41ac71b950229c6003d7e3266d3fa4a70a266，任务分支与GitHub实际远端一致，main62ca183f10b7c316ab63c28ef6d04ee88d06488b已在祖先。本片只修[原企业政策用例](../../../tests/enterprise-policy.test.cjs)的真实依赖与品类目录fixture，生产政策/客户写入和原HTTP语义未改；原夹具从正式请求指纹、已迁移的原命令/收据及品类身份出口读取同一实现，不再把Nest兼容provider当作领域实现直接求值。

发布品类fixture只在原 published / legacy_baseline 条件下返回当前目录命中数，并断言原状态集合；不默认承认任意品类、空间或企业权限。原11项检查与拒绝断言保留，覆盖商户/企业/成员政策交集、告知版本、当前有效个人账号/会员、关系修订、原金额/币种、缺逐单Core参加者拒绝及已提交原键结果回读。原收据读取在当前权限撤销后仍只释放本主体的原结果，不重新保存政策或开放新业务。

node --no-compilation-cache - api-enterprise-policy-fixture-final tests/enterprise-policy.test.cjs，PID24572退出0、stderr空，11/11、0 fail/skip/todo/cancelled。官方Prisma5.22原238模型和TypeScript5.9.3，十个正式配置0诊断；Rental197根/922源/394输出，API988根/2441源/1976输出，JS/声明均留内存；stdin SHA-256 f7fbc5a38ad010ed28d18208bd28d807750ee3e839841c716d5e0f77c2a68579。SQL、目录、账号/关系和事务均为明确fixture，没有真实HTTP/数据库、完整宿主、包安装、浏览器或独立审查证据，没有新增测试脚本。

本片为继续迁移Rental客户/会员唯一仓储和企业政策/成员链的验证入口准备。按原G1～G4复核未跨下一档，正式需求/任务身份、依赖、顺序及百分比保持；当前接续覆盖下一入口，原完整接续由上述固定Git保存。所有验证worker已退出，output/.tmp无新增产物；原两处已集中待清理残留及自动审批拒绝沿原manifest保留，不冒称已删除。定向九份文档1505本地链接/175锚点/101表格0问题，原换行约束下diff --check退出0。原生PowerShell删除再次在启动前被自动审批以blocked by policy拒绝，原两份清单更新最近尝试时间为2026-11-17T05:11:14.566Z，预检查未执行且没有换壳/工具绕过。以中文提交并普通推送既有任务分支，上传后读取实际远端。

<a id="core-rental-enterprise-reads-20261117"></a>

## Rental 企业资格、订单/财务读取与公共审计归属（2026-11-17）

固定父版89a840a4c28116d26b060c3b025ff34fc102eb0a已提交、普通推送并实际远端回读，保存原企业服务、合同和完整接续；main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍在任务祖先。[企业资格](../../../packages/rental-core/src/mysql-enterprise-access.ts)、[订单读取](../../../packages/rental-core/src/mysql-enterprise-orders.ts)、[历史/财务投影](../../../packages/rental-core/src/mysql-enterprise-finance.ts)、[原命令](../../../packages/rental-core/src/mysql-enterprise-command.ts)和[读取审计](../../../packages/rental-core/src/mysql-enterprise-reader-audit.ts)成为Rental包内单源。原客户Auth继续产生相同可信上下文，原Nest provider供给同一数据库、资金和授信参加者，其他旧路径再导出同一实现。[私有读取/事务视图](../../../packages/rental-core/src/enterprise-read-storage.ts) · [客户上下文](../../../packages/rental-core/src/client-context.ts) · [原HTTP入口](../../../apps/api/src/modules/enterprise/enterprise-read.controller.ts)

企业合同和工作流纯规则从 /enterprise、/enterprise-workflows 提供，原shared兼容再导出；原哈希/JSON解释单源放在 /enterprise-receipt。资格仍核个人客户、有效客户账号/会话、两个会员关系、企业管理成员、明确入口/动作与当前关系修订，读取前后再次核验当前空间和权限。订单只投影原企业归属及告知字段，纯个人订单和其他商户不可见；缺原金额、保证金或账单不补零或生成事实。原企业账户历史涉及其他空间时明确不可用，不用当前空间的小计代替权威全账。原命令保持Tenant父锁、同事务操作键/请求指纹及已提交结果回读，不重放业务。

[公共日志](../../../packages/platform-server/src/common/operation-log.service.ts)从 /operation-log 提供不依赖Prisma模型的窄存储视图，沿原ALS取业务空间、递归脱敏与requireSuccess要求；旧可选rentalOrderId只兼容原审计行，不要求业务表或授权任何Core。原API日志继承同一基础方法，其OAuth/MCP/Core原收据的严格事务方法继续原位执行，普通最佳努力日志不能代替它们。企业敏感读取只有原审计持久化成功、最终资格仍有效才释放数据，审计成功不证明新业务或付款成功。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 同范围原实现 | node --no-compilation-cache - api-enterprise-read-baseline tests/enterprise-portal-access.test.cjs，PID45148退出0、stderr空；7项原入口加7项必要stdin边界共14/14、0 fail/skip/todo/cancelled |
| 同范围候选 | api-enterprise-read-candidate，PID39776退出0、stderr空；同样14/14。stdin SHA-256 f7fbc5a38ad010ed28d18208bd28d807750ee3e839841c716d5e0f77c2a68579，所有JS/声明留内存 |
| 运行正文与兼容 | 五服务及工作流共70执行单元与父版相同，公共日志三个方法在类名/私有可见性迁移后正文相同；原hash/JSON序列化和客户上下文字段保留。原Controller/DTO/OpenAPI/AppModule/schema/迁移/Seed无差异 |
| 正式类型 | Prisma5.22原238模型、TypeScript5.9.3，十个正式配置0诊断；Rental197根/922源/394输出，公共服务39根/825源/78输出，API988根/2441源/1976输出 |
| 原验证入口 | 只改原enterprise-portal-access四行依赖/源码定位，保留七项原断言；新边界以stdin运行，无新增测试脚本。覆盖IO撤权/错误audience、缺保证金、未核实现金、跨空间账户历史、审计失败/最终撤权、嵌套脱敏和原命令同键/不同输入拒绝 |

数据库行、SQL执行、事务、资金/授信和日志持久化均为明确fixture；实际编译的原Auth/ALS与服务运行不等于真实HTTP/数据库/浏览器或完整Nest宿主。标准包安装、多真实Core、独立升级/回退/接手及审查仍未验。剩余企业政策/成员/工作流服务、Controller、数据/迁移/Seed、页面/客户端/作业/AI与标准Rental装配继续推进；完整公共组织/订阅/集成及05/06/07范围未齐，按原G1～G4复核未跨下一档，不改需求/任务身份、依赖、顺序或百分比。

源码短头、Rental/原API/公共服务导读、根入口与当前接续同片更新；定向九份文档1503本地链接/174锚点/101表格0问题，新正式出口/typesVersions均有实际源码，运行依赖和lock未变；git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check退出0。两个验证worker已退出，output/.tmp无新增产物。原两处残留仍为840文件/91,808,304字节及1个0字节guard.log；同一原生PowerShell删除再次在启动前被自动审批以blocked by policy拒绝，原清单最近尝试更新为2026-11-17T03:57:10.973Z，此前只读已核0链接且当前不使用。没有换壳/工具绕过，不称已删除或释放空间。中文提交并普通推送既有任务分支，上传后读取实际远端，不合main或发布。

<a id="core-enterprise-access-fixture-20261117"></a>

## 原企业入口验证夹具与跨领域schema组合（2026-11-17）

固定源码为3df9fa9b2fde646e18193b90fc91ab785016f34d，任务分支与GitHub实际远端相同，main62ca183f10b7c316ab63c28ef6d04ee88d06488b已在祖先；本片仅修[原企业入口用例](../../../tests/enterprise-portal-access.test.cjs)并登记验证。原服务的Prisma SQL runtime显式提供到VM夹具；OpenAPI验证复用原合同检查器的ts-node加载方式，企业schema的跨领域引用在实际OPENAPI_COMPONENT_SCHEMAS中核对，继续遍历全部企业投影并保留原路由/权限/撤权/原收据断言。没有改生产代码、HTTP资料或新增测试脚本。

补证过程中先后定位到VM漏shared/schema依赖，以及只在企业子集核对Rental换货检查材料引用的问题，原失败保留（PID53360、5400、49588、41760均退出1，七项6过/1失败）。最后node --no-compilation-cache - api-enterprise-source-before tests/enterprise-portal-access.test.cjs，PID34260退出0、stderr空，7/7、0 fail/skip/todo/cancelled；与原固定服务配合，覆盖显式入口动作、跨商户/企业拒绝、成员最小投影、IO撤权、原配置修订与原收据、七项HTTP及当前会话/关系SQL门禁。四个正式配置0诊断，Prisma5.22原238模型声明、TS5.9.3及JS均留内存；SQL/成员/会话/事务仍为明确fixture，无真实HTTP/数据库/浏览器或完整宿主证明。

本片为进入企业读取拆分前的必要夹具保全，PCH正式任务仍未跨下一门槛；完整Rental包、公共能力、多Core和安装/更新验收沿当前接续继续。定向九份文档1473本地链接/174锚点/100表格0问题，git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check退出0，正式需求/任务无差异；所有worker退出，output/.tmp无新增产物；两处旧残留再次被原生删除的自动审批在启动前拒绝，原manifest更新为2026-11-17T00:32:31.651Z，只读核840文件/91,808,304字节和1个0字节文件、均无链接，不声称删除。

<a id="core-rental-recovery-payments-20261117"></a>

## Rental 历史回填、员工收款与归还计价归属（2026-11-17）

固定父版8f284b668f9f5b758e499abe732fee81883a31b1已提交、普通推送并实际回读，保存本片五份原实现及完整接续；实际main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍在任务祖先。[快照回填](../../../packages/rental-core/src/mysql-snapshot-backfill.ts)、[员工收款](../../../packages/rental-core/src/mysql-staff-payments.ts)、[请求DTO](../../../packages/rental-core/src/http-staff-payment.dto.ts)、[归还价格来源](../../../packages/rental-core/src/return-pricing.ts)和[原债权核定收据](../../../packages/rental-core/src/corporate-maturity-receipt.ts)成为包内唯一实现；旧两个服务供给原二项/三项Nest依赖，其余旧入口仅再导出同一类/规则。[私有回填存储](../../../packages/rental-core/src/snapshot-backfill-storage.ts)与[员工收款接点](../../../packages/rental-core/src/staff-payment-storage.ts)复用原数据源和调用方事务，领域根出口不加载这些MySQL服务。

回填保留原完整主键/复合键比较、父记录业务键映射、只插缺项/不覆盖已有事实、原品类来源/采用修订与配置行修订；原ReadCommitted、60秒上限和启动登记顺序保持。单空间错误可见并隔离，回填不调用报价、履约、支付或重放业务。原历史字段缺省映射保持，不能据此声称旧快照必然完整或成为新的历史/金额推断规则。员工登记只占待确认金额，确认复用同一资金事务及原staff-offline键；租户父锁→登记/订单锁、当前地点、原凭证/余额和当前收款方式保持，已确认结果须核原资金收据，配置变化或订单完成不重收。归还继续绑定实际分配与不可变换货/续租段，缺历史/币种/金额不以现价或零额替代；到期核定保留原哈希命名空间、新版审计时间绑定和旧版独立时钟。

### 原夹具失败与修正

node --no-compilation-cache - api-recovery-payments-baseline + 下列五份原入口，PID46340退出1、stderr空：143项Node测试133通过/10失败，资金门禁另9项直接异步断言通过。失败均在原库存用例：8项未识别现行Tenant共享父锁，2项冻结检查模板缺tenantId/categoryCode/name。仅补[原库存夹具](../../../tests/rental-inventory-review.test.cjs)：一个13行的明确父锁包装只接受本用例租户并断言SQL参数，原订单/资产/处置锁序及全部断言保留；冻结模板补其原所属元数据，不改生产规则。原18项数量保持，96处原assert均保留并增加1处租户参数断言。只复验该失败入口，PID3632退出0、18/18、0 fail/skip/todo/cancelled。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 迁移候选与原消费者 | mode=api-recovery-payments-candidate，PID31076退出0、stderr空；五份原入口143项全过，另4项最小stdin恢复/到期收据检查与1项原员工静态断言通过，合计148/148、0 fail/skip/todo/cancelled；原资金门禁9项也通过，stdin SHA-256 0021f8fe43f16f6428960fbd5785c1c472576e038ed6891cebe4f5b8c8b24fa8 |
| 恢复最小行为 | 完整键区别同数量外来行、空快照不称完整、memory不登记回填、原日历投影/重复无写、fixture失败回滚、缺租户/空间、异品类及已采用来源拒绝；原到期收据版本/原主体/时间绑定和历史独立时钟通过。SQL/事务/物理存储均为明确fixture |
| 原员工静态片 | 只将[既有脚本](../../../tests/staff-miniprogram-static.test.cjs)的收款源码定位改为实际包内实现，保留原全部断言；该1项经同一worker运行。未检出的员工页面从固定Git8f284b668读取原四份源码，不代表微信宿主验收；首次REPL字符串求值受运行上下文限制后改走已有离线worker，没有新增运行器/文件 |
| 单源正文与元数据 | 五文件23执行单元与父版相同，DTO字段/装饰器保持，两个旧Nest构造依赖与原登记次序保持；原Controller/OpenAPI/AppModule/schema/迁移/Seed无差异 |
| 类型及内存产物 | 官方Prisma5.22原238模型、TS5.9.3，十个正式配置0诊断；Rental187根/911源/374输出，原API988根/2430源/1976输出。声明/JS均留内存，未写共享client/dist |
| 正式出口/包配置 | 五个新增正式子出口/typesVersions有实际源码，原依赖和lock未变；MySQL私有视图继续使用Prisma模型/runtime，不向公共Core清单泄漏这些类型 |

五份原入口为[资金门禁](../../../tests/rental-funding-gates.test.cjs)、[企业应收](../../../tests/rental-order-receivable.test.cjs)、[库存恢复](../../../tests/rental-inventory-review.test.cjs)、[分段换货价格](../../../tests/rental-exchange-segment-pricing.test.cjs)和[换货归还计价](../../../tests/rental-exchange-return-pricing.test.cjs)。只修现有fixture和实际源码定位，没有新增测试脚本或扩大到真实资金/数据库。原Auth/核心/资金及仓储使用实际编译实现；上述类型、静态与离线行为不代表完整Nest宿主、真实HTTP/数据库/浏览器/微信、标准包安装/升级回退、独立接手或审查。

Rental仍缺企业读取/剩余Controller、数据/迁移/Seed、页面/其余客户端和标准装配，完整公共组织/订阅/集成及05/06/07门槛未齐；按原G1～G4核定未跨下一档，需求/任务编号/依赖/顺序/百分比保持。源码短头、两份模块导读、根入口与接续同片更新，定向九份文档1471链接/173锚点/100表格0问题；git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check退出0。默认检查曾将原cjs的CRLF判作行尾空白，按原换行保持并仍检查实际尾空格，不修改仓库配置。所有worker退出，output/.tmp空，无新脚本/环境/后台服务；原两处残留仍集中待清理，原生PowerShell删除再次被自动审批在启动前以blocked by policy拒绝，责任清单已更新，不换壳/工具绕过。中文提交到既有任务分支、普通推送并读取实际远端，不合main或发布。

<a id="core-rental-category-adoption-20261117"></a>

## Rental 采用准备、最终提交与完整配置闭包（2026-11-17）

固定父版f9fc5bfca84a61202aa6a53803a9e67013d8fd79已普通推送并实际回读，保存前一治理成果和本片原文/完整接续；实际main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍为祖先。[采用准备](../../../packages/rental-core/src/mysql-category-preparation.ts)、[最终采用](../../../packages/rental-core/src/mysql-category-adoption.ts)及20份辅助构成22文件的包内唯一闭包。两个旧服务保留原六项Nest供给，其他旧路径只再导出各自同一实现。实际[Auth/商业/收据接点](../../../packages/rental-core/src/category-adoption-ports.ts)只描述本链需要的方法，公共Core合同不引入这些MySQL私有类型。[源码路线](../../../packages/rental-core/README.md#阅读路线) · [原HTTP入口](../../../apps/api/src/modules/rental-core/category-adoption-preparation.controller.ts)

准备/分页/批次保存只写预备集合和原批次回执，不激活实体、能力或切换绑定。保持完整输入冻结、旧客户端与v2集合边界、来源/准备修订、显式撤回/重建与原批次指纹；重复只读原结果，当前受权操作者才能查原批次。最终采用仍用原ReadCommitted和等待/执行上限，按原身份→商业目录→品类/政策→空间锁顺序，实际候选完整校验后提交实体/唯一声明/能力/绑定/审计/原收据，提交前最终复验会话。成功/失败均保留准备，恢复旧品类不删除新字段，不重写报价/订单历史。原测试开关与生产限制保持。

[共同配置读取](../../../packages/rental-core/src/category-adoption-compatibility-reader.ts)与[最终校验](../../../packages/rental-core/src/category-adoption-final-compatibility.ts)继续覆盖当前/排期价格、规则、正式DTO、检查、条件能力、营销/商品/履约关联、服务容量及库侧行数/JSON大小；不拿先前预览或当前默认配置替代实际事务与历史依据。[唯一字段变化](../../../packages/rental-core/src/category-adoption-entity-writer.ts)只重建受影响声明，交换同事务完成；[批次辅助](../../../packages/rental-core/src/category-preparation-batches.ts)只合并明确准备字段，[商业映射](../../../packages/rental-core/src/category-adoption-commercial.ts)来自代码登记，不新创收费项。缺当前认证、权益或依据继续拒绝。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 原实现基线 | node --no-compilation-cache - api-category-adoption-before + 下列十份原入口，PID49384退出0、stderr空；25项Node测试全过，另外七份原入口的直接断言/异步检查全部执行通过 |
| 同入口候选 | mode=api-category-adoption-candidate，PID1552退出0、stderr空；同样25/25、0 fail/skip/todo/cancelled及其余原检查通过。没有修改这十份原测试/fixture或新增脚本，stdin SHA-256 b2a243f5251d507c38eed8a1bad5d35182502fb43a2065a2181001a2cc3ded1a |
| 执行与装配对照 | 22文件55执行单元正文与固定父版相同；两个原六项design:paramtypes、原收据Inject索引1及准备Optional索引4/5的转译元数据一致 |
| 官方类型/内存产物 | Prisma5.22原238模型、TS5.9.3，十个正式配置0诊断；Rental180根/904源/360输出，原API988根/2423源/1976输出；生成声明/JS均留内存 |
| 正式接点/资料 | 23个新子出口/typesVersions对应实际源码，包运行依赖未变；API Controller/DTO/OpenAPI及AppModule登记未改，领域根出口不加载上述MySQL服务 |

原验证入口为[采用应用](../../../tests/category-adoption-application.test.cjs)、[当前授权](../../../tests/category-adoption-access.test.cjs)、[批次服务](../../../tests/category-preparation-batch-service.test.cjs)、[批次合并](../../../tests/category-preparation-batches.test.cjs)、[候选](../../../tests/category-adoption-candidates.test.cjs)、[业务兼容](../../../tests/category-adoption-business-compatibility.test.cjs)、[共同读取](../../../tests/category-adoption-compatibility-reader.test.cjs)、[能力写入](../../../tests/category-adoption-capability-writer.test.cjs)、[唯一声明](../../../tests/category-adoption-unique-plan.test.cjs)、[商业依赖](../../../tests/category-adoption-commercial.test.cjs)。覆盖1001实体分批→采用、同键并发与原收据、恢复及历史保持、权限/期限/来源变化、最终失败回滚、当前/未来配置及关联和唯一声明保留，SQL/数据库锁/事务/商业数据是明确fixture，原Auth与服务/仓储运行实际编译实现。

本片有原消费者/自动化/类型证据，但不是完整Nest宿主、真实HTTP/数据库/浏览器、标准包干净安装、多真实Core、独立升级回退、接手或独立审查。Rental剩余Controller/服务、schema/迁移/Seed、页面/客户端/作业/AI及完整标准装配未完成，公共组织/订阅/集成和05/06/07完整范围亦未齐；按原门槛复核仍未跨下一档，需求/任务身份/依赖/顺序/百分比保持。

源码说明、两份模块导读、根入口及当前接续同片更新；定向九份文档1443本地链接/173锚点/99表格0问题，git diff --check退出0；需求/任务和十份原测试均无差异。两个worker均退出，output/.tmp无新增产物；旧两处残留仍集中待清理，原自动审批拒绝/manifest沿前片保留，不冒称空间释放。中文提交普通推送当前任务分支并真实回读，不合main或发布。

<a id="core-rental-category-governance-20261117"></a>

## Rental 品类治理与配置辅助独立归属（2026-11-17）

固定父版c1b802e55e40f1ca41344d57d0b4b64402c6e85d已提交、普通推送并实际回读；main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍在任务祖先。原[治理服务](../../../packages/rental-core/src/mysql-category-governance.ts)、[创建模板](../../../packages/rental-core/src/category-creation-templates.ts)及[定义差异](../../../packages/rental-core/src/category-definition-diff.ts)成为Rental包内唯一实现；旧服务保留原四项Nest依赖和Optional身份接点，两份旧辅助路径只再导出正式子出口。Controller、DTO、HTTP/OpenAPI和主provider登记未改。[实际私有接点](../../../packages/rental-core/src/category-governance-storage.ts) · [包接入路线](../../../packages/rental-core/README.md#使用与构建) · [原治理Controller](../../../apps/api/src/modules/rental-core/category-governance.controller.ts)

保留Serializable、maxWait10000/timeout30000、原Web签名/会话与当前SaaS账号前后复验，身份/角色读取先于品类/版本锁。草稿按修订CAS，发布正文和原审计不可变，发布后独立维护采用政策；原创建/发布重复请求只读原收据，不重新发布、采用或初始化。模板/差异只操作配置副本，不读商户事实或添加算法。私有存储和身份接口只描述本链方法；该MySQL服务仍使用原Prisma生成模型与Nest异常，公共Core清单及Rental领域根出口不加载它。

### 基线失败与夹具修正

node --no-compilation-cache - api-category-governance-before + tests/category-governance.test.cjs、tests/category-creation.test.cjs，PID41396退出1：纯治理断言通过，创建六项3通过/3失败。两项缺原认证/当前账号接点，另一项复制发布版本缺structureVersion；与固定主线8b64f8efa的原身份事务及b6aa09ad3的版本解码要求核定，不降低生产校验。[原创建用例](../../../tests/category-creation.test.cjs)

仅补原夹具：账号含tenantId，签名/可信Web会话用实际Auth方法，账号/会话行及商业数据库是明确替身；事务断言完整Serializable参数，复制来源补实际structureVersion=1。原最后调用断言改为现行合同的五次认证事务，同时继续断言只有一次identity/draft/audit；没有删断言或skip/todo。其他三项仍保持原输入/算法/DTO断言，拒绝分支现在在真实签名验证后运行，不能用缺认证先失败冒充业务拒绝。生产权限、锁、SQL、字段、保存与恢复正文未改。

| 必要核验 | 实际结果与边界 |
| --- | --- |
| 修正夹具后的原实现基线 | mode=api-category-governance-fixture-baseline，PID42720退出0；创建6/6、0 fail/skip/todo/cancelled，纯治理输入/权限/开通范围断言通过 |
| 同夹具迁移候选 | mode=api-category-governance-candidate，PID52672退出0、stderr空；同样6/6及纯治理断言通过。stdin SHA-256 b2a243f5251d507c38eed8a1bad5d35182502fb43a2065a2181001a2cc3ded1a，声明/JS全内存 |
| 固定执行正文 | 治理30、定义差异1、模板/组合3共34执行单元与父版相同，配置常量/schema保持；只变正式导入、私有类型和Nest接线位置 |
| 实际类型与产物 | 官方Prisma5.22原238模型、TypeScript5.9.3，十个正式配置0诊断；Rental157根/881源/314输出，原API988根/2400源/1976输出 |
| 装配/出口 | 原四项design:paramtypes及Optional索引2/3的转译元数据相同，三个新增正式子出口/typesVersions有实际源码；原AppModule/Controller/OpenAPI无差异，包依赖未变 |

本片不增加测试脚本。SQL、账号/会话行、事务和发布/创建存储均为明确fixture；类型/离线行为及元数据不是完整Nest宿主、真实HTTP/数据库/浏览器、实际安装、独立更新或审查证明。PCH-08仍缺剩余采用/服务/Controller、标准装配、数据/迁移/Seed、页面/客户端及AI/作业，05/06/07与公共组织/订阅/集成亦未满足完整下一档，因此不改正式需求、任务身份/依赖/百分比。

源码头、Rental/原API模块导读、根入口及接续同片更新。定向九份文档1398本地链接/171锚点/98表格0问题，git diff --check退出0；正式需求/任务无差异。worker全部退出，output/.tmp无新增产物；两处旧残留继续集中待清理，原自动审批拒绝和责任manifest沿前一阶段保留，不声称已删除或释放空间。中文提交当前任务分支、普通推送后实际回读，不合main或发布。

<a id="core-rental-bound-drafts-settings-20261117"></a>

## Rental 绑定规则/日历草稿与批准设置归属（2026-11-17）

固定父版db9d1716327b2ab9b1b365f9c50ffcb38e0e5b81已提交并真实远端回读，保存原四项实现与原失败检查点。实际迁入[规则草稿](../../../packages/rental-core/src/bound-rule-draft.ts)、[日历草稿](../../../packages/rental-core/src/bound-calendar-draft.ts)、[批准设置](../../../packages/rental-core/src/mysql-approved-settings.ts)及[设置授权桥](../../../packages/rental-core/src/approved-settings-route-authority.ts)，四个旧API路径仅再导出同一类/错误/schema。新[私有存储视图](../../../packages/rental-core/src/bound-draft-storage.ts)只描述本链的表和原事务/业务参加者，原AI/批准应用继续使用原构造和当前Guard，不新建执行者或HTTP路由。[包接入路线](../../../packages/rental-core/README.md#使用与构建) · [原消费者路线](../../../apps/api/src/modules/rental-core/README.md)

保留Tenant父锁→空间/品类锁、完整候选reviewHash、原规则版本链、精确日历revision/规则JSON CAS、业务草稿和原收据同事务及提交后的当前复验/缓存刷新。已发布规则只恢复为新草稿；保存不发布、不创建AI任务或批准。设置保留当前真实Guard/凭据与staff/operator指纹，通知白名单、配置CAS、批准消费和收据同事务；历史材料/原结果不要求重新执行。原非关键缓存刷新失败继续通过cacheRefreshed=false明确返回，不伪造配置回滚。[原AI规则](../../../apps/api/src/modules/ai-native/scenes/opening-rule-draft.composition.ts) · [原AI日历](../../../apps/api/src/modules/ai-native/scenes/opening-calendar-draft.composition.ts) · [原设置应用](../../../apps/api/src/modules/ai-native/approval-execution/approved-settings-application.composition.ts)

包新增四个正式子出口和声明/typesVersions，新增与原API一致的可选Nest core peer并精确同步lock；公共领域根出口不导入这组MySQL/路由服务。该私有适配仍使用Prisma生成模型、原SQL runtime及Nest ExecutionContext，不能称完全去ORM/框架依赖；公共Core接入清单不暴露这些类型。官方日历源是原平台级资源，留待公共资源片处理，不随Rental覆盖/草稿迁移。[原官方资源](../../../apps/api/src/modules/rental-core/official-calendar-source.service.ts)

### 原失败核定与必要验证

在原请求夹具补两张收据表之后，两项已采用样例接同一序列化存储上的真实RentalCategoryResolver，读取原categoryVersionId/adoptionRevision，不给生产校验或权限加兜底。PID47008运行原六项草稿，十配置0诊断，3通过/3失败。两个旧用例仍期待冲突只抛错/零记录；已沿固定main来源75f86be57e772218774080d0d337dde6536b26df及[原拒绝收据阶段](../../AI%20Native/AI%20Native-开发记录.md#ain16-original-draft-rejection-refresh-20261113)核定，当前合同返回rejected_no_commit且必须保留原拒绝账。第三项旧日历预览将AI_REVISION_CONFLICT包装为PROVIDER_UNAVAILABLE，原路径问题继续保留，未改生产包装、断言或记为通过。[原六项用例](../../../tests/ai-native-plan-input-source.test.cjs)

本片必要验证复用原夹具、三项原正常用例及stdin内两项当前拒绝合同探针，断言完整业务/AI行不变、仅一张拒绝收据、同键与原读取返回同一拒绝、不能重做。两项探针没有落成新测试脚本；不把它们说成原六项全绿。原设置冒烟继续覆盖通知限定、当前Guard/品类、版本/CAS、原participant同事务、unknown回读和历史幂等，SQL/认证/批准参加者均是明确fixture。[原设置验证](../../../tests/category-config-write.test.cjs)

| 实际命令/核验 | 结果与证明范围 |
| --- | --- |
| node --no-compilation-cache - api-draft-settings-current-contract-baseline + 两份原入口，stdin SHA-256 f1307d2cb72999c2f635f204bc7025aa0aacf3dd7e27e95e995cb3a59b2d63a2 | PID52536退出0；三项原正常链及两项当前拒绝探针5/5，原设置冒烟通过；没有业务网络或真库 |
| 同一stdin与入口，mode=current-contract-candidate | PID11560退出0；同样5/5及设置冒烟通过。只读主树依赖，所有声明/JS留内存 |
| 同值隔离级别与原SQL tag规范化后对照固定父版 | 30执行单元正文相等（规则7/日历7/设置15/授权1）；四项草稿schema初始化表达式相等 |
| 官方Prisma5.22的238模型声明/TypeScript5.9.3与十个正式配置 | 0诊断；Rental153根/877源/306输出，API988根/2396源/1976输出；公共包和正式直接消费者均编译 |
| 正式出口/声明、lock与领域根依赖核验 | 四个新子出口对应实际源码/声明目标，optional peer与lock相等；根出口无MySQL服务import |

类型和离线行为不代表照片IO、真实HTTP/数据库/浏览器、完整Nest宿主、干净安装、多真实Core、升级/回退、独立接手或审查通过。原旧三项草稿结果及其他已登记失败/未验保留，未放宽原规范或用源码等价代替完整验收。PCH本片仍未跨下一门槛，任务身份/依赖/顺序/百分比保持；剩余Rental服务/Controller、schema/迁移/Seed、页面/客户端/作业/AI及公共组织/订阅/集成继续推进。

定向九份文档1380个本地链接/171个锚点/97个表格0问题，差异格式核验退出0；原需求/任务无差异。

源码头、模块README、根阅读入口与接续同片更新。所有本片worker退出、output/.tmp无新增文件；旧两处残留仍集中待清理，删除审批拒绝与责任manifest沿[检查点](#core-rental-draft-fixture-checkpoint-20261117)保留，不称已删除或释放空间。阶段仅中文提交当前任务分支，普通推送后回读实际远端，未合main或发布。

<a id="core-rental-draft-fixture-checkpoint-20261117"></a>

## 原草稿回归夹具与底层冲突检查点（2026-11-17）

固定父版5f4e283f7558a45e24f97038f11995bc8d499d09保存原规则/日历绑定草稿、批准设置和路由授权四份实现；本检查点只补原AI请求夹具的两张收据表及失败证据，生产源码尚未迁移。本树/目标任务分支与实际远端相同，main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍为祖先。原接续直接引用固定Git，不另存副本。

[原请求夹具](../../../tests/fixtures/ai-native/lane-a-original-request.cjs)的序列化存储初始集合补operationLog、rentalCalendarOverrideAuditEntry两张明确空表，供原[草稿拒绝收据](../../../apps/api/src/modules/ai-native/original-draft-rejection.store.ts)读取。未改测试断言、权限、服务或错误映射；空表只代表该样例未记录原操作，不代表授权、提交或真实数据库。

继续沿已有内存stdin worker运行十配置及[原六项草稿消费者](../../../tests/ai-native-plan-input-source.test.cjs)，Prisma5.22官方238模型/TS5.9.3、产物均留内存。PID45112退出1，十配置0诊断，六项1通过/5失败。随后PID34688仅在内存编译的[路由授权](../../../apps/api/src/modules/ai-native/business-read-route.authority.ts)错误映射前打印错误名称/短消息/码/状态，退出1，仍1通过/5失败；没有改磁盘生产实现、凭据或断言。下层409为“Core品类上下文缺少当前绑定来源”，另外两项日历旧路径将AI_REVISION_CONFLICT包装为PROVIDER_UNAVAILABLE；不能把所有失败直接称为旧问题或通过。

已沿[当前绑定锁](../../../packages/rental-core/src/mysql-category-write.ts)、[真实Core报价配置](../../../packages/rental-core/src/mysql-core-runtime.ts)和[品类解析器](../../../packages/rental-core/src/category-runtime.ts)核查：草稿样例写入adoptionRevision=1的已采用绑定，但Core创建时没有categoryResolver，故读取配置仍缺当前categoryVersionId/adoptionRevision。下一步给这两个明确样例接入同一序列化存储上的真实RentalCategoryResolver，保留生产提交前的绑定复验，再判断日历其他失败。候选五份包源码只在内存准备，30执行单元与原文相等，未据此称迁移或消费者通过。

原设置保存用例category-config-write前阶段通过，仅作为原设置行为证据。当前检查点未跨PCH下一门槛；完整Rental装配/数据/页面/AI、公共组织/订阅/集成、真实HTTP/数据库/浏览器、干净包安装、升级回退及独立接手/审查仍未验。所有本片worker退出，output/.tmp无新增文件；没有安装、生成落盘、环境读取或网络业务请求。

定向九份文档1350个本地链接/171个锚点/96个表格0问题，git diff --check退出0；它们只证明文档与本片差异格式，不替代业务通过。

两份旧残留原生PowerShell删除再次在启动前被自动审批以blocked by policy拒绝，命令内预检查未执行。保留主仓库output/.cleanup-pending/pch-preparation下原platform-host-integration与rental-business-facts责任manifest；随后只读核定文件数/体积及链接，再更新最近尝试时间。未换壳或工具绕过，归集不代表删除或空间释放。

<a id="core-rental-inspection-applications-20261117"></a>

## Rental 客户检查同意与批准换货执行独立归属（2026-11-17）

固定父版480e1f3f60fb7f375490fd870e8124af4dc97dc1已普通推送并回读，保存本片原服务、完整接续与检查准备/影像成果；真实远端main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍在任务祖先。原客户检查同意与最终批准执行实际迁入Rental包，旧路径仅保留原四项/八项Nest参加者的供给及正式再导出。Controller、企业申请/营运执行与原批准服务继续消费同一入口，业务规则、HTTP、schema和已应用迁移没有改变。[客户同意实现](../../../packages/rental-core/src/mysql-exchange-inspection-consent.ts) · [批准执行实现](../../../packages/rental-core/src/mysql-approved-exchange-execution.ts) · [私有身份/文件接点](../../../packages/rental-core/src/exchange-inspection-ports.ts) · [执行参加者](../../../packages/rental-core/src/approved-exchange-execution-ports.ts)

同意保留原ClientAuth/ALS、本人订单/当前会员与会话、Tenant父锁→订单锁、具体检查材料hash、冻结照片读取前后复验、同意与原幂等收据同事务。完整客户上下文按原对象保留，私有类型只声明必要投影，不复制手机号/微信身份或凭据。文件缺失仍拒绝照片读取；原文件服务实际IO未替换。[原客户provider](../../../apps/api/src/modules/rental-core/rental-exchange-inspection-consent.service.ts) · [ClientAuth](../../../apps/api/src/modules/client/client-auth.service.ts)

批准执行保留同一Core/检查/幂等/企业政策和授信实例，原ReadCommitted、maxWait10000、timeout30000，原价格意图先核验再附可信检查/同意。Core变更、授信、批准消费、执行和幂等收据在调用方同一事务提交，事务内失败回滚；只有提交确认后才刷新并发布。executeInTransaction不另开COMMIT，外层持有者负责提交后发布。original只核原K、批准消费、本人具体同意及正式变更；不存在或损坏不重做。批准的旧TTL不阻断已消费历史读取，修改原到期字段则破坏原hash，继续拒绝。[原执行provider](../../../apps/api/src/modules/rental-core/rental-approved-exchange.service.ts) · [企业营运直接消费者](../../../apps/api/src/modules/enterprise/enterprise-merchant.controller.ts) · [唯一批准权威](../../../packages/rental-core/src/mysql-approved-exchange.ts)

企业政策SQL类型从生成Prisma方法签名改为相同参数化Sql/模板和PromiseLike的私有结构端口，解除生成Client依赖；运行时批准代码和WeakMap未改。两个正式MySQL子出口/typesVersions对应实际源码，根/纯合同不加载应用或私有数据库服务。源码头、模块导读和原API路线同片同步，完整HTTP字段继续引用原OpenAPI，不另维护一套DTO或第五册。[正式包](../../../packages/rental-core/package.json) · [企业政策接点](../../../packages/rental-core/src/approved-exchange-policy.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 修改前离线基线 | node --no-compilation-cache - api-exchange-inspection-applications-baseline，PID27604退出1：3项中2通过/1失败。失败来自探针直接改写原expiresAt而触发历史hash拒绝，生产源码未改；将探针改为Node Date时钟推进60001ms，PID43760退出0、stderr空，3/3通过。两个基线结果保留，不修改业务以迁就夹具 |
| 同探针候选 | node --no-compilation-cache - api-exchange-inspection-applications-candidate，PID57244退出0、stderr空，3/3、0 fail/skip/todo/cancelled。覆盖原同意/同键、暂停后历史、撤权、客户/订单/材料拒绝及收据回滚；批准执行一次、同事务消费/授信/收据、到期后原结果不再prepare/price/apply、政策/授信/收据失败回滚及提交后刷新失败仍读原键 |
| 固定执行正文 | 客户同意10单元、批准执行9单元共19一致；只将官方原RENTING和ReadCommitted常量规范为同值字符串后对照，SQL、锁、权限、金额、原请求、消费及恢复正文保持 |
| 类型与内存产物 | TS5.9.3、Prisma5.22官方原238模型声明，十配置零诊断；Rental148根/871源/296输出、原API988根/2391源/1976输出。声明和JS全部内存，未写客户端或dist |
| 装配与文档 | 原两个provider的4/8项design:paramtypes及Optional索引3一致；包出口/typesVersions/lock、原Controller与HTTP声明、定向文档链接/锚点/表格及git diff --check核定，新增测试文件0 |

SQL/存储、客户认证、Core变更/授信和事务为明确fixture，运行的是实际同意/批准执行应用、原幂等及唯一WeakMap核验。照片正向字节链、完整Nest宿主、真实HTTP/数据库/浏览器、干净标准包安装/升级和独立审查均未执行。19单元相等与离线通过不代替这些验收。PCH-08仍缺剩余服务/Controller、标准装配、数据/迁移/Seed、页面/客户端、作业与AI；05/06/07等完整范围和公共组织/订阅/集成亦未齐，本片未跨原下一门槛。

本片没有新增临时环境或磁盘测试脚本，两个基线和候选worker均已退出，output/.tmp无新产物。两份旧残留清单已更新到2026-11-16T20:09:52.447Z，同一原生删除工具仍在启动前拒绝blocked by policy；840文件/91,808,304字节及1个0字节guard.log仍在集中待清理区、0链接，不声称已释放空间。失败及责任清单位置沿[原清理记录](平台Core接入-开发记录.md#core-rental-recovery-receipts-20261116)保留，不换壳/工具绕过。

本片中文提交普通推送codex/platform-core-extraction，固定成果由包含本节的Git提交定位并以真实远端回读确认；不合main或发布。源职责、正式出口及简单接入资料随片维护。

<a id="core-rental-inspection-runtime-20261117"></a>

## Rental 换货检查准备与专用影像独立归属（2026-11-17）

固定父版7fae0de571664b2edc3782bae06d671f5a838e6c已普通推送并回读，包含已修正的七项原检查夹具和本次修改前完整接续。实际远端main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍在本树祖先。原检查准备、影像服务、两个读辅助及严格DTO实际迁入Rental包，旧API保留Nest provider或同一对象再导出；Controller、企业批准、客户检查同意和执行参加者继续消费原签名。[准备实现](../../../packages/rental-core/src/mysql-exchange-inspection-preparation.ts) · [影像实现](../../../packages/rental-core/src/mysql-exchange-inspection-media.ts) · [私有接点](../../../packages/rental-core/src/exchange-inspection-ports.ts) · [准备/照片消费](../../../packages/rental-core/src/exchange-inspection-preparation.read.ts) · [原影像读取](../../../packages/rental-core/src/exchange-inspection-media.read.ts) · [严格DTO](../../../packages/rental-core/src/exchange-inspection-preparation.dto.ts)

准备保留原operator和租户/空间/地点/组织复验、Tenant父锁→原订单锁、同事务准备/照片消费/原幂等收据。原键回放不重新试算，执行前重读原模板、订单修订与照片依据。影像保留原声明/计划、同事务文件和来源绑定、完成占用先提交、单次暂存读取/冻结及原目标reconcile；权限、修订、占用或绑定变化继续拒绝，unknown不换键、不另申请上传票据。文件参加者通过TPlan保留完整原计划对象，供应商私有配置不进入公共合同/清单或HTTP结果。当前文件服务的真实存储和冻结实现没有替换。[原文件参加者](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts) · [准备provider](../../../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.service.ts) · [影像provider](../../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.service.ts)

公共组织子树与地点交集的原纯算法单源迁入platform-server的/organization-location-scope，旧路径再导出同一函数。调用方先限定租户，缺失/停用组织返回空集合；租户/业务地点映射仍由原所有者读取，显式地点配置只缩小范围。本片新增五个Rental正式出口和一个公共算法出口，typesVersions对应实际源码，根及纯合同不加载这些MySQL服务；私有存储只描述本链SQL和文件关联读方法，不依赖生成模型或携带全库Client。[公共范围实现](../../../packages/platform-server/src/common/organization-location-scope.ts) · [原范围出口](../../../apps/api/src/common/organization-location-scope.ts) · [包接入导读](../../../packages/rental-core/README.md)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版执行正文对照 | 准备15、媒体11、准备读5、媒体读4、公共范围2，共37个执行单元一致；只将原Prisma隔离级别常量规范为相同ReadCommitted字符串后对照，未改锁、SQL、权限、照片消费或恢复分支 |
| 同七项原检查消费者前后对照 | node --no-compilation-cache - api-exchange-inspection-baseline/candidate，PID51940/56880均退出0、stderr空，前后7/7、0 fail/skip/todo/cancelled；夹具在候选片没有修改。原旧夹具的3通过/4失败沿前一阶段保留，其他企业用例未执行 |
| 类型与内存产物 | TS5.9.3、Prisma5.22官方原238模型声明；最终十配置零诊断。Rental145根/868源/290输出、公共服务38根/824源/76输出、原API988根/2388源/1976输出，全部声明/JS留内存 |
| 元数据与原范围断言 | 两个旧provider的五项/三项design:paramtypes转译结果与父版一致；九个DTO类的原文只改变类型导入，ValidationPipe的原嵌套/白名单断言通过。node --no-compilation-cache -纯范围短探针PID46456退出0，复用原范围脚本的4个断言，旧出口等于同一函数；未运行整份范围脚本或实际Nest宿主 |
| 接口资料与格式 | 原HTTP八项检查/影像路由及DTO/OpenAPI字段保持，SDK正式出口和源码导读同片更新；定向文档链接/锚点/表格、包出口/typesVersions、package/lock依赖一致性及git diff --check通过，新增测试文件0 |

本片没有新增类型或业务失败。PCH-08仍缺检查同意/最终批准执行等剩余Controller/服务、标准Core主装配、schema/迁移/Seed、页面/客户端、作业与AI适配；公共组织管理、安全、完整订阅/集成、实际安装/更新、多真实Core、独立接手和审查也未齐，故未跨原下一门槛。源码职责、私有文件计划和事务/unknown原因同步备注，完整API字段继续引用原接口声明，不另维护同名DTO或第五册。[原八项API](../../../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.schemas.ts)

验证使用原离线preload和端口1 URL，SQL/仓储/事务及对象字节为明确fixture，没有.env、安装、真实HTTP/数据库/供应商/模型、服务或迁移；所有本片worker已退出，output/.tmp无新增产物。两个旧待清理任务只读复核仍为840文件/91,808,304字节环境和1个0字节日志、0链接，沿原自动审批拒绝及责任清单保留，不改工具绕过删除禁令、不声称释放空间。旧外观、导航/MCP附件及DTO十处缺口继续保留。

中文提交只包含本片源码、正式出口和现有资料，普通推送codex/platform-core-extraction并实际回读；固定版本由包含本节的Git提交定位，不合main或发布。下一步继续检查同意与批准执行等原参加者，再形成完整Rental标准装配和可独立取出的业务包；完整运行/安装/升级及正式验收尚未完成。

<a id="core-rental-inspection-fixture-20261117"></a>

## Rental 换货检查与影像原消费者基线修正（2026-11-17）

固定生产源码为3c0c09dd0fa32161c3bfd78f0c88ea0c84231016，检查准备/媒体服务本片没有修改。跨日接续重新核定本树分支、空索引、无合并/拣选和实际远端；main62ca183f10b7c316ab63c28ef6d04ee88d06488b仍在祖先，任务分支已同步。先收口归属明确的原测试夹具，再进入生产迁移。[原七项检查用例](../../../tests/enterprise-extension-approval.test.cjs) · [原检查服务](../../../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.service.ts) · [原媒体服务](../../../apps/api/src/modules/rental-core/rental-exchange-inspection-media.service.ts)

原七项检查/影像用例在修改生产源码前出现3通过/4失败，PID4332退出1。旧夹具缺少reconcileExchangeInspectionUpload，未模拟原文件服务已提交的不可变冻结证据；另一个拒绝断言调用只读requirements，实际应检验prepare对未核验必需照片的拒绝。修正遵循原文件服务的暂存→冻结意图提交→原目标核对→同事务完成顺序，保留操作键、权限、绑定、CAS、首响应丢失、到期与损坏占用断言。存储与对象字节仍为显式fixture，没有对真实文件服务或供应商进行验收。[文件冻结/恢复实现](../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts) · [原冻结合同](../../../packages/platform-contracts/src/file-content-binding.ts)

夹具现在区分已登记冻结目标可核对、没有冻结证据仍unknown，以及订单修订变化拒绝恢复；恢复只观察原目标，不增加暂存读取、不另申请上传票据。完成结果只模拟原六个公开字段。原VM加载器支持正式包和Prisma SQL runtime，离线写入根改为output/.tmp/enterprise-workflows；未新增脚本或删除测试，没有skip/todo。[严格DTO](../../../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.dto.ts)

必要复验使用node --no-compilation-cache - api-exchange-inspection-baseline，PID51940退出0、stderr空。以TS AST仅选择原七个test注册，保留辅助代码、断言与源码变更检测；其他企业审批用例未执行，不能称整份脚本全绿。七项7/7、0 fail/skip/todo/cancelled；TS5.9.3、Prisma5.22官方原238模型声明，十配置零诊断，Rental139根/861源/278输出、原API988根/2381源/1976输出，全部编译声明/JS留内存。采用原离线preload和端口1 URL，拒绝.env、真实网络、Prisma实例化与磁盘写入。

本片只提交原夹具及记录/接续，中文提交到codex/platform-core-extraction、普通推送后实际回读；固定提交由包含本节的Git版本定位。原需求/任务及百分比不变，没有把用例修正计入研发升档。PID51940已退出，output/.tmp无新增产物；既有两个待清理任务仍按原责任清单处理。下一步把同一检查准备、媒体、DTO与读辅助迁入Rental包，使用相同七项夹具做前后对照，保持原文件和当前授权参加者。

<a id="core-rental-exchange-documents-20261117"></a>

## Rental 换货试算与不可变订单凭证独立归属（2026-11-17）

固定父版c31f0886df45fd2d7a7285920a91609f3c9b86df已普通推送并回读；实际远端main62ca183f10b7c316ab63c28ef6d04ee88d06488b在本树祖先，开工时本树干净、无合并/拣选。原换货候选/试算、客户凭证纯渲染、不可变归档及历史读取实际迁入Rental包，旧API只供给同一Nest依赖或再导出。候选与凭证合同也成为包内单源，原shared及营运/企业/客户/后台消费者继续使用原字段。[试算](../../../packages/rental-core/src/mysql-exchange-preview.ts) · [私有服务与事务](../../../packages/rental-core/src/exchange-preview-ports.ts) · [候选合同](../../../packages/rental-core/src/exchange-choices.ts) · [凭证合同](../../../packages/rental-core/src/document-contracts.ts) · [纯渲染](../../../packages/rental-core/src/document-renderer.ts) · [归档与历史](../../../packages/rental-core/src/mysql-documents.ts) · [快照存储](../../../packages/rental-core/src/document-storage.ts)

试算继续锁原订单、读取同一业务配置组合、校验整行/库存方式/地点/资产候选并按原冻结价格段重价；需容量的新服务缺组件时拒绝，费用批准、换货提交与收付款不在试算执行。凭证逐字段释放客户可读事实并转义HTML，内容hash与四类模板保持；同内容复用原不可变版本，订单事实变化追加版本。竞争只捕获同一Prisma SQL runtime的原P2002错误并重读原赢家，其他错误或未读到赢家继续抛出。历史先读取当前订单核空间，含资金版本仍核当前财务权限，不按当前价格/商品重造历史。[原试算provider](../../../apps/api/src/modules/rental-core/rental-exchange-preview.service.ts) · [原凭证provider](../../../apps/api/src/modules/rental-core/rental-document.service.ts) · [原渲染出口](../../../apps/api/src/modules/rental-core/rental-document-renderer.ts)

新增/exchange-choices、/document-contracts、/document-renderer、/mysql-exchange-preview与/mysql-documents正式出口及对应typesVersions。领域根和纯合同不导入Nest/生成模型/数据库，私有MySQL视图仅供给本表方法和实际服务；纯渲染构造保留原Optional兼容，生产归档仍须实际存储。原Controller路由/Guard、DTO/OpenAPI及各端字段不改，API与模块SDK分别定位；客户和企业audience不因共用实现取得营运权限。[营运文档API](../../../apps/api/src/modules/rental-core/rental-core.controller.ts) · [客户文档API](../../../apps/api/src/modules/client/client-api.controller.ts) · [企业候选API](../../../apps/api/src/modules/enterprise/enterprise-workflows.controller.ts) · [原OpenAPI](../../../apps/api/src/contracts/openapi-document.ts) · [模块接入导读](../../../packages/rental-core/README.md)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版执行正文对照 | 换货4、渲染14、凭证7，共25个执行单元一致；仅统一Prisma错误类的导入别名后对照。构造顺序/Optional另以实际编译元数据核对，没有调整价格、金额、权限或快照算法 |
| 原三份用例前后对照，stdin内存编译/装载 | node --no-compilation-cache - api-document-exchange-baseline与api-document-exchange-candidate，PID52200/57308均退出0、stderr空。两份凭证脚本全部原断言通过，换货计价Node套件93/93，0 fail/skip/todo/cancelled；原三份脚本未修改 |
| 兼容入口与快照竞争短探针 | node --no-compilation-cache - api-document-exchange-boundary，PID55268退出0；两个Node用例2/2，0 fail/skip/todo/cancelled。旧试算/凭证/渲染共用相同包内方法，五项试算依赖及第4号Optional、三项凭证依赖及第2号Optional保持；真实应用在显式fixture上读唯一键赢家、无赢家拒绝、非Prisma/其他存储错误原样保留 |
| 必要类型/内存产物 | TS5.9.3与Prisma5.22官方原238模型声明，最终十配置零诊断；Rental139根/861源/278输出，原API988根/2381源/1976输出。全部JS/声明留内存，不安装或覆盖生成客户端 |
| 文档/出口/格式 | 根和模块导读、原记录/接续同步；五个正式出口及typesVersions对应源码，package与lock依赖/peer/meta一致，lock和原需求/任务未改。定向链接/锚点/表格与git diff --check通过；新增测试文件0 |

本片没有新的源码或行为失败。PCH-08仍缺完整Controller/标准Core主装配、初始化/数据/迁移/Seed、页面/客户端和作业/AI行业适配；原05/06生命周期及公共服务/异步接点也未覆盖完整范围，故没有跨原下一门槛。公共组织、安全、完整订阅/集成、标准包干净安装、多真实Core、独立更新/回退、接手与独立审查继续按原任务推进，不以迁出文件数或局部绿色计分。

全部验证使用原离线preload和端口1数据库URL，SQL/仓储/事务为明确fixture，没有环境文件、真实HTTP/数据库/供应商/模型、服务或迁移。三个worker均退出，output/.tmp为空。2026-11-17同一原生PowerShell Remove-Item命令在启动前被自动审批以blocked by policy拒绝，命令内路径/进程预检查未执行；随后只读核定原归属与0链接，仍有840文件/91,808,304字节环境及1个0字节日志。两份原责任清单已更新尝试时间为2026-11-16T17:55:15.279Z，继续集中于主树output/.cleanup-pending/pch-preparation下原任务目录，不使用旧环境、不换壳或工具绕过，也未释放空间。旧外观、导航/MCP附件及DTO十处缺口保留。

中文阶段提交只包含本片源码、出口和现有资料，普通推送codex/platform-core-extraction并回读实际远端，由包含本节的Git版本定位；不合main或发布。下一步迁出换货检查准备/媒体参加者及剩余HTTP服务，继续形成可独立取出的完整Rental标准包。真实环境、完整安装/升级和正式验收未完成。

<a id="core-rental-report-jobs-20261117"></a>

## Rental 工作台、经营报表与到期作业独立归属（2026-11-17）

固定父版f775a6924cfdb9a6ce46e74b6b8903764490f92a已普通推送并回读，跨日核定实际远端main仍为62ca183f10b7c316ab63c28ef6d04ee88d06488b且在本树祖先。原工作台、CSV、报表仓储和到期作业实际迁入Rental包，旧API仅再导出或供给同一Nest依赖。报表只接订单聚合/分页、资产与数量库存快照；作业只接空间遍历/命名锁及原Core、业务、幂等、容量、企业核销和支付方法。[工作台](../../../packages/rental-core/src/workbench.ts) · [报表](../../../packages/rental-core/src/mysql-reports.ts) · [只读视图](../../../packages/rental-core/src/report-storage.ts) · [CSV](../../../packages/rental-core/src/report-csv.ts) · [作业](../../../packages/rental-core/src/mysql-due-jobs.ts) · [作业依赖](../../../packages/rental-core/src/due-job-ports.ts)

工作台保留原待办类型、角色/可见订单过滤和退款依据。报表仍按租户/空间及当前地点过滤，草稿排除，单趟分页累加异常/占用，当前库存快照不冒充历史利用率；AI固定5000单上限，超量、重复游标证据或计数不符拒绝，不返回部分总数。CSV渲染同一报表并保留币种、筛选、文本处理和历史口径说明。五项到期任务保留原顺序、60秒计时/销毁、同连接GET_LOCK/任务/RELEASE_LOCK及空间ALS，内部业务仍用原短事务/操作键，失败释放锁并继续其他任务。付款过期按原渠道核验，unknown不重做；原Optional参加者不被空成功替换。[原报表接线](../../../apps/api/src/modules/rental-core/rental-workspace-report.repository.ts) · [原作业接线](../../../apps/api/src/modules/rental-core/rental-due-job.scheduler.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版正文对照 | 工作台9、CSV3、报表13及作业17个函数/方法执行单元完全一致；仅迁移导入、事务类型和Nest接线，类型端口排版不改变运行时 |
| stdin内存编译/装载：node --no-compilation-cache - api-report-jobs-final | 最终PID40644退出0、stderr空；TS5.9.3与Prisma5.22官方原238模型声明，十配置零诊断。Rental132根/854源/264输出，原API988根/2374源/1976输出，无磁盘生成物 |
| 原工作台与作业用例 | rental-workbench-todos及rental-due-job-scheduler原脚本未改、全部断言通过；覆盖订单/工单角色、可见通知、未持锁跳过、异常释放、后续空间继续和启动/销毁。计时器只在fixture验证中短暂建立并立即销毁，没有后台任务残留 |
| 原Nest/报表短探针 | 两个Node用例2/2，0 fail/skip/todo/cancelled；报表与作业继承同一包内方法，原七项注入顺序和5/6号Optional元数据保持。实际仓储在明确fixture上通过金额/税/异常/续租占用/库存快照、租户/地点条件、CSV及扫描溢出/重复ID/本人范围/非法日期拒绝 |
| 文档/出口/归属 | 根和模块导读、记录/接续定向链接、锚点及表格检查通过，四个正式出口与typesVersions一致，git diff --check退出0；原需求/任务及lock、测试脚本不改，新增测试文件0 |

本片没有新的类型或行为失败。原report-workspace-operations与report-workspace-dimensions均读取.env并实例化实际PrismaClient，未获真库执行授权，未运行；短探针不能代替两份真实报表验收。[真库经营报表入口](../../../tests/report-workspace-operations.test.cjs) · [真库维度入口](../../../tests/report-workspace-dimensions.test.cjs) · [原离线作业](../../../tests/rental-due-job-scheduler.test.cjs) · [原工作台](../../../tests/rental-workbench-todos.test.cjs)

标准Rental主装配、其余Controller/服务、数据/迁移/Seed、页面/客户端及AI行业适配仍未完成。作业归属与单次provider登记已保持，租户Core停新/历史收尾和完整移除预检仍须正式装配验证；不能把本片迁移视为原06/08整项完成。源码职责、复杂锁/历史原因及模块接入说明同片维护。[当前模块导读](../../../packages/rental-core/README.md)

验证全部留内存，SQL/仓储/事务为明确fixture，没有安装、.env读取、真实服务/业务网络/数据库或供应商调用；PID40644已结束，output/.tmp为空。2026-11-17核定原840文件/91,808,304字节环境和1个空日志的路径、归属、0链接及无本任务在用进程后，同一原生PowerShell Remove-Item仍在启动前被自动审批以blocked by policy拒绝。残留继续集中在主树output/.cleanup-pending/pch-preparation下原两个任务目录，两份责任manifest的尝试时间更新为2026-11-16T16:22:14.918Z，没有换壳/工具绕过或声称已释放空间。旧外观、导航/MCP附件和DTO十处缺口继续保留。

中文阶段提交只包含本片源码、包出口和现有资料，普通推送codex/platform-core-extraction并回读实际远端，由包含本节的Git版本定位，不合main或发布。下一入口为剩余Rental HTTP/服务与标准装配，真实环境、完整包安装/独立更新/接手和审查仍未验。

<a id="core-rental-request-dto-20261116"></a>

## Rental 业务请求、订单请求与共享企业告知 DTO（2026-11-16）

固定父版606b67b8b8c6e44d04c4aad63a14c97f8a3daff3已普通推送并回读实际远端，main62ca仍在本树祖先。原Core请求14类、订单请求52类与企业告知1类实际迁入Rental包，共67个运行时类，其中63个正式导出、4个内部嵌套类。原API路径再导出同一对象，企业和客户预约继续使用同一个告知类，不新增另一套字段声明或校验。[Core请求](../../../packages/rental-core/src/core-request.dto.ts) · [订单请求](../../../packages/rental-core/src/order-request.dto.ts) · [企业告知](../../../packages/rental-core/src/enterprise-disclosure.dto.ts)

新增/core-dto、/order-dto和/enterprise-disclosure-dto正式出口及typesVersions。请求字段、Type/ValidateNested、条件校验、过滤/分页转换与原装饰器元数据保持；ValidationPipe仍按原transform/whitelist配置运行，非法嵌套输入拒绝，订单终态/金额/免审核字段不会成为受信输入。企业告知仅表达原版本与确认，不授予企业或业务权限。源码备注及模块导读说明reflect-metadata和装饰器构建前置，完整字段来源仍是正式DTO/合同。[原HTTP入口](../../../apps/api/src/modules/rental-core/rental-order-request.dto.ts) · [企业再导出](../../../apps/api/src/modules/enterprise/enterprise-request.dto.ts) · [客户消费者](../../../apps/api/src/modules/client/client-request.dto.ts) · [接入说明](../../../packages/rental-core/README.md)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版运行时对照 | Core与订单DTO的CommonJS正文/装饰器元数据规范化后完全一致；仅移除require行及统一原shared/告知模块别名，原67类及4个内部类均保留 |
| `node --no-compilation-cache - api-dto-validation`＋四份原用例，stdin内存编译/装载 | 最终PID48344退出0、stderr空；TS5.9.3和Prisma5.22官方原238模型声明，十配置零诊断。Rental126根/848源/252输出，原API988根/2368源/1976输出，无生成物写入 |
| 原事务顺序/检查证据/资源/读数消费者 | 原事务顺序7场景和三份静态用例通过；55个原断言期待值/消息及重复次数保留。只更新读取实际实现的路径、补必须读到真实DTO的断言和原续租夹具allocations空列表，不删断言或放宽生产逻辑 |
| 实际DTO/ValidationPipe短探针 | 两个Node用例2/2，0 fail/skip/todo/cancelled；62个Core/订单公开DTO及告知类的新旧对象相同。嵌套行/企业和客户告知转换、非法数量/照片长度/告知类型拒绝、终态及跨租户字段剥离、force-release原因和pendingFeeOnly原转换通过 |
| 原字段门禁前后对照 | 原validate-dto-coverage代码经stdin/内存CompilerHost运行，固定父版与候选均退出1、同样10个问题；规范化原/新文件路径后完全一致，没有新增字段缺失。八个AI类、企业委托引用及OfflineDepositEvidenceDto的原implements/命名缺口继续保留，不以兼容再导出空文件制造假绿 |
| 文档/出口/格式 | 九份资料的本地链接、锚点与表格定向核对通过；三个正式出口与本版源码/声明对应，依赖锁不变，git diff --check退出0。原任务编号、依赖、顺序及验收保持，新增测试文件0 |

失败保留。修改DTO前的固定606b检查PID52876退出1，三份检查静态用例读取已迁出的旧服务/事实文件，分别找不到读数生成、资源范围校验和追加修正正文。本片把路径指向真实mysql-core-runtime/mysql-core-facts，原断言完整保留。首次候选PID17500退出1，新探针误把67个总类数当公开导出数，同时原续租夹具漏allocations列表导致some读取错误；已修正数量核对和夹具，在同一范围复验，实际字段/业务服务不改。

本片收口未跨原下一门槛。Rental完整Controller/标准装配、数据/迁移/Seed、页面/客户端、其余作业及AI接点仍缺，公共组织/订阅/集成也未全部独立；原05/06/08～12完整范围保留，不以DTO类型或局部通过升档。真实HTTP/数据库/浏览器、标准包干净安装、独立更新/回退、接手及独立审查仍未验。

所有新验证留在内存，SQL/仓储和事务为明确fixture，无安装、.env、服务或业务网络调用；PID48344已结束，output/.tmp为空。原840文件/91,808,304字节环境和1个空日志仍集中待清理，本日原生PowerShell删除审批拒绝与责任清单沿[确认阶段](#core-rental-order-confirmation-20261116)保留，没有换壳/工具绕过。旧外观和导航/MCP附件缺口继续登记。中文阶段提交只含本片源码、必要旧用例和现有导读/记录/接续，普通推送codex/platform-core-extraction并读取实际远端；由包含本节的Git版本定位，不合main或发布。

<a id="core-rental-allocation-runtime-20261116"></a>

## Rental 配货、办理锁、自动扫描与经营空间边界（2026-11-16）

固定父版322f7228c4e0117d75cd82b8a676ef75985aa198已普通推送并回读实际远端，main62ca在本树祖先，包含原配货/空间源码及接续原文。14个配货方法、原办理锁/记录异常/自动扫描及两个经营空间边界函数实际迁入Rental包，旧API成为四项依赖的Nest接线和空间函数再导出。私有存储复用原事实/配置模型视图，仅补配货本身使用的allocation计数方法；失败事件窄端口只传原事务、范围和订单引用。[配货实现](../../../packages/rental-core/src/mysql-allocation.ts) · [私有接点](../../../packages/rental-core/src/allocation-storage.ts) · [空间边界](../../../packages/rental-core/src/mysql-workspace-scope.ts)

原资产/数量/缓冲判定、固定资源锁序、历史allocated/释放行、预分配/改配/锁定/释放和人工保护保持。办理锁既有事务参与、过期接手和带原因人工解除/双重审计保留。自动扫描仍检查已有分配，实际自动变更只在原配置开启时发生；并发防重、逐单事务、失败修订核对和finally释放running标记未改。原AppModule仍只登记一处配货provider，AI通过原moduleRef读取该实例，未增加第二个作业执行者。[Nest兼容入口](../../../apps/api/src/modules/rental-core/rental-allocation.service.ts) · [当前装配](../../../apps/api/src/app.module.ts) · [AI直接消费者](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)

`readRecordedFulfillmentIssue`继续投影原已记录异常及来源修订，不触发扫描、资源锁、模型或新事务，也不以当前可用库存重造历史原因。失败事件仍在原聚合写入后参加同一事务，缺事件适配保持未捕获，不由Rental伪造成功。经营空间解析优先读取公共Auth/ALS并核目标租户，原初始化/恢复只读已有default标记，缺空间拒绝；请求授权仍由原Guard先裁定。跨空间配置写入使用同一断言，不按全局id覆盖其他租户。新增 /mysql-allocation 与 /mysql-workspace-scope 正式出口，旧宿主事务别名原位绑定Prisma，领域根出口不加载私有适配。[原空间入口](../../../apps/api/src/modules/rental-core/workspace-scope.ts) · [模块接入说明](../../../packages/rental-core/README.md)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版执行正文/运行时对照 | 14个配货方法和2个空间函数规范化后完全一致；类型导入整理及缩短注释不改变编译运行时，原锁、状态、金额/数量和错误分支保留 |
| `node --no-compilation-cache - api-allocation-current`＋四份原用例，stdin内存编译/装载 | PID20684退出0、stderr空；TS5.9.3及Prisma5.22官方原238模型声明，十配置零诊断。Rental123根/845源/246输出，原API988根/2365源/1976输出，没有写生成物 |
| 原配货、交接锁、空间与履约消费者 | 配货政策16个原断言、经营空间4个原场景通过；原交接锁/履约Node测试11/11，0 fail/skip/todo/cancelled。覆盖跨租户空间、当前停用拒绝、原释放/物理归还及双重审计，四份原脚本均未修改 |
| 注入和直接注册静态核对 | 原四项依赖顺序、第四项Optional/Inject编译元数据保持；原AppModule一处provider、Controller/换货/AI同一签名。原60秒unref计时与销毁钩子正文一致；本片未启动真实计时作业或宿主 |
| 文档/出口/格式 | 现有九份资料1186个本地链接、166个锚点引用和91个表格，0问题；两个正式出口与typesVersions一致，git diff --check退出0。原需求/任务、锁文件和其他专项源码不改，新增测试文件0 |

本片没有新的行为失败或测试豁免。源码备注和模块导读随实现更新，复杂分支继续解释锁序、历史依据和事件提交原因。原11项Node测试及短声明/正文核对不是实际配货数据库或多实例作业验收；rental-allocation-persistence要求专用真库，本片未执行。标准Core数据/迁移/Seed、Controller、页面/客户端、其余作业/回调、AI行业适配和正式Rental装配仍未完成，PCH-08及其他原任务未跨下一门槛，不按文件/断言数升档。

验证产物均在内存，SQL、仓储、配置和事务仍是明确fixture，无依赖安装、.env读取、真实服务/HTTP/数据库或供应商调用；output/.tmp无新增残留，PID20684已结束。原840文件/91,808,304字节临时环境与1个空日志继续已集中待清理，本日原生PowerShell删除审批拒绝与责任清单见[确认阶段](#core-rental-order-confirmation-20261116)，没有换壳/工具绕过。旧外观、导航/MCP附件及DTO关联缺口继续保留。

中文阶段提交只含本片源码、包出口和现有导读/记录/接续，普通推送codex/platform-core-extraction并回读实际目标远端；由包含本节的Git版本定位，不合main或发布。下一入口是剩余Rental服务/Controller及标准装配，不再复制已迁入实现。

<a id="core-rental-order-confirmation-20261116"></a>

## Rental 订单确认、批准参加者与商户委托独立归属（2026-11-16）

固定父版ef08a7628ce476265292e15067702241d70c98b8已普通推送并回读实际远端，main62ca仍在本树祖先。订单确认实际实现、同事务批准合同、商户封存来源及报价Auth/ALS接线单源迁入Rental包；原确认provider供给同一12项依赖，企业与AI批准消费者保持原签名。原委托入口只实例化Prisma事务类型，构造器、校验函数和三个WeakMap仍是包内同一运行时对象。[确认实现](../../../packages/rental-core/src/mysql-order-confirmation.ts) · [实际参加者](../../../packages/rental-core/src/order-confirmation-ports.ts) · [批准合同](../../../packages/rental-core/src/approved-order-transaction.ports.ts) · [商户封存](../../../packages/rental-core/src/merchant-delegation.ts)

新订单继续使用原ReadCommitted事务及父锁→客户/企业→空间/库存锁序，客户资格、责任主体、地点/经营者和企业政策在提交点重读，报价消费、券、服务容量、订单、幂等和批准一起提交。批准的原等待/执行上限保留，原批准历史读取保持RepeatableRead。回放结果交给原调用方抑制重复通知；同键竞争或409只在原指纹与持久订单一致时回放，unknown不重新建单。注释只缩短旧测试/日期流水，保留并发原因及原409分支。[确认Nest接线](../../../apps/api/src/modules/rental-core/rental-order-confirmation.service.ts) · [企业直接消费者](../../../apps/api/src/modules/enterprise/enterprise-merchant-order-submission.service.ts)

商户委托仍由原私有来源所有者供给，封存绑定当前营运身份、原D/K、请求指纹和同一回调；复制JSON、换身份或替换参加者不能取得权限。已消费/过期委托核对原关联和原收据，不进入新提交准备，收据不可见时仍只按原批准消费链接读取。新 /approved-order-ports、/mysql-order-confirmation、/merchant-delegation、/server-quote-access 出口与typesVersions逐项一致，根领域出口不加载这些私有适配；公共接入合同不带Prisma类型。[包说明](../../../packages/rental-core/README.md) · [原模块导读](../../../apps/api/src/modules/rental-core/README.md)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版执行正文对照 | 确认12个方法/辅助函数、商户9个、报价接线2个执行单元一致；只规范化原Prisma错误/隔离级别运行时引用和类型擦除。合同字段/品牌标记保留，事务按宿主实例化 |
| `node --no-compilation-cache - api-order-confirmation-final`＋三份原用例，stdin内存编译/装载 | 最终PID47984退出0、stderr空。TS5.9.3及Prisma5.22官方原238模型声明，十配置零诊断；Rental120根/842源/240输出，原API988根/2362源/1976输出。没有写生成物 |
| 原确认报价范围、履约准入及批准事务 | 报价定价组不可替换断言通过；原Node测试28/28通过，加两个短stdin探针共30/30，0 fail/skip/todo/cancelled。覆盖当前停用/撤权、历史物理归还、批准同事务、订单/批准失败回滚、失应答、原键及原消费恢复 |
| 实际Nest与封存探针 | 原12个注入项及6个Optional项、同一继承实例通过；封存正向历史读取、JSON/换身份/换回调拒绝、收据缺失时原消费关联及unknown通过。历史路径新准备/订单事务次数均0；Nest只有显式依赖fixture，未连接数据库 |
| 原夹具前后核对 | 原58个断言期待值/消息及重复次数完整保留；仅补可信身份、租户父锁、当前创建绑定、事务编号和原两种隔离级别fixture。未删断言或修改生产门禁，新增测试文件0 |
| 文档/正式出口/格式 | 九份资料1162个本地链接、165个锚点引用及90个表格，0问题；四个出口与typesVersions一致。git diff --check退出0，需求/任务编号、依赖及验收不变 |

失败过程保留。独立类型预检曾发现Hook事务未实例化，已改为同一TTransaction；完整候选PID41040退出1，发现原企业入口仍以非泛型声明委托端口，已在原兼容出口绑定Prisma事务类型。固定ef08仅覆盖原确认/委托/报价三模块的父版运行PID31060退出1，原28项22通过/6失败，原因是旧批准夹具缺可信身份和父锁；当前其他依赖保持同一版本，不能将其称为完整父版全仓回归。补齐后首次候选PID28688仍有两个新探针错误（Optional登记顺序、authority参数下标）及一个新增fixture错误（误把原批准读取RepeatableRead限定为ReadCommitted），已修正验证层并在同一范围复验，生产事务/权限未放宽。[原批准用例](../../../tests/ai-native-fork-execution-approved-core.test.cjs)

本片收口不改变原任务分档。PCH-08仍缺完整Rental标准装配、配货/Controller、schema/迁移/Seed、页面/客户端、作业及AI接点；原05/06/09～12的完整门槛保留。真实HTTP/数据库/浏览器、标准包安装、独立升级回退、接手及独立审查未验。customer-operations与order-close-concurrency需要真实库，本片未执行；企业执行旧脚本的磁盘输出/加载兼容缺口也不据本片探针冒称通过。

所有新验证通过stdin、内存编译及明确SQL/事务/政策fixture完成，无安装、.env读取、真实服务或网络，output/.tmp为空，无新后台业务进程。旧公共临时环境840文件/91,808,304字节及空日志1文件/0字节仍已归集待清理，2026-11-16T14:07:44.776Z核绝对路径、归属、0链接和无使用进程后，同一原生PowerShell删除再次在启动前被自动审批以blocked by policy拒绝，两份原责任manifest已更新；没有换壳/工具绕过或宣称释放空间。原外观静态失败、总导航三附件、MCP五旧隔离附件与DTO十处关联缺口继续按既有阶段保留。

阶段提交仅含本片源码、包出口、必要原夹具和已有导读/记录/接续，中文提交到codex/platform-core-extraction，普通推送后读取实际目标远端；提交由包含本节的Git版本定位。本片不合main，不发布Core。

<a id="core-rental-business-runtime-20261116"></a>

## Rental 报价、营销聚合及配置 DTO 独立归属（2026-11-16）

固定父版3c00f3a1c36d64cef1a3fb985f2b676b99adf671已普通推送并实际远端回读，main62ca在本树祖先，包含本片修改前的源码、夹具和接续原文。原报价/营销服务的218个方法及14个命名辅助函数实际迁入Rental包；旧API保留44行Nest接线，供给原14项依赖和两个继承初始化钩子。配置、事实、恢复、能力和容量继续使用包内单源，会员、企业币种、密文及短信经实际窄端口供给。[报价/营销实现](../../../packages/rental-core/src/mysql-business-runtime.ts) · [宿主端口](../../../packages/rental-core/src/business-runtime-ports.ts) · [原Nest入口](../../../apps/api/src/modules/rental-core/rental-business.service.ts)

私有出口 @rental-os/rental-core/mysql-business-runtime 保留调用方真实事务类型及模块级续租ALS，当前身份仍从唯一公共ALS读取。detached报价配置视图只做原身份比较，不发布未提交缓存；原SQL、金额、锁、指纹、历史价格及营销来源不变。通知attempts、认领租约和最终回执分别记录，unknown只查询原投递，不重发。供应商算法、nonce、凭据与HTTP仍在原集成服务。[公共通知结果](../../../packages/platform-server/src/common/notification-delivery.ts) · [Provider标识](../../../packages/platform-contracts/src/integration-provider.ts)

五项通知结果声明及错误类成为公共服务单源，八种Provider标识成为公共合同单源，原IntegrationRuntime/shared再导出同一声明。配置DTO从正式 /configuration-dto 导入，旧API再导出同一61个运行时类；原字段、嵌套Type/ValidateNested和装饰器元数据保留，Rental构建明确启用原两项装饰器编译选项。宿主先按原Nest启动加载reflect-metadata。源码说明移除关于自动推断嵌套类的过期说法，权限、批准、业务规则和保存仍由原服务执行。[DTO源码](../../../packages/rental-core/src/config-request.dto.ts) · [原HTTP入口](../../../apps/api/src/modules/rental-core/rental-config-request.dto.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版正文/DTO | 232个可执行单元在规范化正式导入、原Prisma常量、装饰器自引用别名和透明括号后一致；DTO使用相同编译选项并规范化唯一合同导入后，82,999字符的JS及装饰器元数据完全一致；五项通知声明正文一致 |
| 独立包与完整API类型 | TS5.9.3、Prisma5.22官方内存声明覆盖原238模型；最终42280的十配置零诊断。Rental115根/837源/230输出，API988根/2358源/1976输出，JS/声明全部内存 |
| 原报价/营销消费者 | node --no-compilation-cache - api-business-v1-consumer tests/rental-business-v1.test.cjs，43564退出0、stderr为空，达到原完整成功标记；149个原断言的期待值与消息保留，新增3个明确库存分页fixture的租户/空间/limit断言，未增加测试文件或用例 |
| 原初始化、通知及换货/续租 | node --no-compilation-cache - api-business-runtime-final tests/rental-business-initialization-refresh.test.cjs tests/rental-notification-lease.test.cjs tests/rental-exchange-segment-pricing.test.cjs，42280退出0、stderr为空；初始化/刷新交错成功，通知租约/回执4组及34个原断言保留，换货/续租93项全过，0fail/cancelled/skip/todo |
| 实际Nest与运行时类 | 同一42280核原14项Inject依赖为同一实例，两个初始化钩子继承包内函数，trace为restore→config→facts→core→workspaces；61个DTO原路径与正式出口对象相同，嵌套坏输入拒绝，通知unknown错误类身份相同；实际Nest容器只接明确空fixture |
| 门禁继承与白名单 | 现有DTO检查器扫描API/公共服务/Rental实际所有者，递归检查继承字段，只认可class-validator装饰器；缺可选字段、仅Type装饰器分别拒绝，字符串属性名正确识别。实际AiTaskCalendarDraftSaveDto的继承字段经whitelist全部保留，坏taskId拒绝，没有放宽字段规则 |
| DTO全局门禁 | 27992用固定3c检查器和原配置DTO复现73处，扩实际所有者后原规则74处，修继承误判后11处；公共PlatformUserStatusDto关联正式SaveSystemUserRequest的isActive字段后，42280中仍退出1、10处原未关联契约问题。消费者退出0和门禁退出1分别保留，不能称contract:validate全绿 |
| 原通知安全与MCP来源 | 7个实际通知源安全断言通过。完整安全用例95个原断言与MCP身份fixture27个原断言保留，仅调整迁后实际源及泛型片段；未执行会落地产物的完整MCPfixture构建/审计 |
| 出口/依赖与资料 | Rental94出口/93子路径typesVersions、公共合同7/6、公共服务26/25逐一对应正式源码和声明；两个可选校验peer取原API版本，锁文件匹配。根入口、三包README和原API导读同步，接入者按正式出口与宿主端口阅读 |
| 定向文档与格式 | 九份资料1135本地链接、165锚点及89表格，0问题；稀疏目标以固定Git定位，git diff --check退出0。正式需求/任务全文、原编号/依赖/百分比无差异 |

保留原失败及修复范围。41684有12个类型错误，来自计价出口、通知hasEnabledProvider和报价contacts端口缺项；49980有2个原helper alias遗漏，补实际接点后31340及最终十配置通过。原业务和通知fixture把已经异步的档案/设置当同步值，现等待真实读取并保留原期待值/消息及throws/rejects语义；50360随后因缺listItemGroupsPage失败，52096仅恢复3c原业务服务仍在同位置复现，其他模块使用本版字节，不冒称整仓旧版。只补明确有界的当前商品fixture后43564通过，生产缺库存门禁未改。

31988在原DTO检查处退出1，后续消费者尚未执行；修继承检查后27992继续暴露验证夹具未加载reflect-metadata，补原宿主初始化前置再完成42280。一次验证输出句柄丢失时，先只读确认原进程退出再重试，没有并行重复环境、额外IO或假称那次通过。

剩余10个DTO门禁项集中在[member-name六个类](../../../apps/api/src/modules/ai-native/member-name.dto.ts)、[task-rule-draft两个类](../../../apps/api/src/modules/ai-native/task-rule-draft.dto.ts)、[企业订单委托引用类](../../../apps/api/src/modules/enterprise/enterprise-order-delegation.dto.ts)和[OfflineDepositEvidenceDto](../../../apps/api/src/modules/rental-core/rental-order-request.dto.ts)。它们是原契约关联/嵌套命名缺口；继承字段不丢失已有实际验证，不把门禁问题当作业务字段已经被剥离。按所属源码切片补正式关联，不能豁免类、吞错误或修改需求来变绿。

PCH原G1～G4未跨下一档，百分比/依赖/顺序不改。下一入口为配货、订单确认及其真实企业授权/原批准事务，再到Controller与标准Core装配；完整Rental数据/迁移/Seed、页面/客户端、作业/AI及公共组织/订阅/基础集成、真实无Core/多Core运行、干净安装、分别更新/回退和独立接手/审查仍缺。[接入路线](../../../packages/rental-core/README.md#使用与构建)

全部新验证复用既有worker经stdin编译/加载，原离线preload、固定offline地址及本树单一output/.tmp边界保留，输出均内存；没有安装、落地client、共享dist写入、新环境或后台业务进程。SQL/事务/库存/会员、Nest空数据及Provider结果均为明确fixture，不证明真实HTTP/数据库/浏览器/供应商、完整安装或正式验收。收尾再次核定原待清理840文件/91,808,304字节环境和0字节日志，无链接与使用进程；原生PowerShell Remove-Item仍在启动前被自动审批以blocked by policy拒绝，两个原责任manifest更新最近尝试，残留仍集中待清理，没有换壳/工具绕过。[原清理证据](#core-rental-recovery-receipts-20261116)

阶段源码由包含本节的Git提交定位，中文提交并普通推送codex/platform-core-extraction后实际远端回读；main及其他工作树未写。

<a id="core-rental-main-runtime-20261116"></a>

## Rental 主核心聚合与原Nest兼容入口（2026-11-16）

固定父版 `a3e4df454bdf4f6e07dd74f6fe95bdd414da90d9` 已普通推送并实际远端回读，包含本片修改前的源码、夹具与接续原文，main62ca在本树祖先。原6606行主核心服务的实际实现迁入Rental包，旧API只保留43行Nest接线，原203个方法、10个辅助函数及超时原因常量保持同一实现。核心/事实仓储、恢复、Hook、资金、容量与品类解析来自包内单源，会员、企业政策/授信、文件及企业续租报价通过实际窄端口供给。[核心聚合](../../../packages/rental-core/src/mysql-core-runtime.ts) · [宿主接点](../../../packages/rental-core/src/core-runtime-ports.ts) · [原Nest入口](../../../apps/api/src/modules/rental-core/rental-core.service.ts)

新私有出口 `@rental-os/rental-core/mysql-core-runtime` 使用调用方真实事务类型，与原Auth/Guard共用正式公共ALS；公共Core清单与领域根出口不携带这些MySQL视图。原13项构造依赖、Inject/Optional元数据和两阶段初始化继承，配置预热仍在全部回填之后。当前配置读取保留作用域、绑定与修订；事务内读取只返回分离视图，不发布未提交缓存。没有重复注册provider、重建租户或另造身份上下文。

公共上传/完成/下载的八项文件声明从原shared/infrastructure移入 `@rental-os/platform-contracts/files`，原路径和总出口再导出同一声明，DTO/OpenAPI与客户端字段不变。Core文件端口只返回使用到的ID/下载地址，原文件服务仍裁定对象归属、ACL、冻结和实际IO。生产图片仍要求真实文件服务；开发本地路径、上传失败补偿和删除pending沿原算法。[公共文件合同](../../../packages/platform-contracts/src/files.ts) · [原共享出口](../../../packages/shared/src/infrastructure.ts)

同片修正三处说明。旧订单无能力快照实际返回空执行名单，不回退执行当前新增能力；factContext已先核当前持久档案和经营设置，只有明确演示/内存宿主才补落原配置与样本；同步状态说明移除易过期的调用数量。未借注释整理改报价、资金、状态、锁、幂等或历史算法。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版正文与文件字段 | 规范化CRLF及原Prisma.sql/join别名后，203个方法与10个辅助函数的可执行正文完全一致；八项文件声明正文一致，原金额、SQL、历史与状态条件未改 |
| 独立包与完整API类型 | TS5.9.3、锁定Prisma5.22官方内存声明覆盖原238模型；十配置零诊断。Rental112根/676源/224输出，API988根/2353源/1976输出，JS/声明全部内存 |
| 原Core及配置采用 | `node --no-compilation-cache - api-core-main-compatibility tests/rental-core-v01.test.cjs tests/rental-exchange-segment-pricing.test.cjs tests/category-adoption-context-refresh.test.cjs`，28968的原Core达到完整成功标记，七项配置采用用例通过；合并Node用例100项87过/13失败，退出1，失败全部来自旧换货夹具。原Core标记中提及的真库链并未在本片执行 |
| 固定父版换货对照 | `api-core-main-baseline`，11192退出1；仅内存恢复父版主服务原实现，93项80过/13失败，与迁后13个失败名称完全一致。其他包使用本版实际编译字节，不冒称整仓旧版或真库对照 |
| 原换货最终复验 | `node --no-compilation-cache - api-core-main-final-tests tests/rental-exchange-segment-pricing.test.cjs`，31460退出0、stderr为空；93项全部通过，0fail/cancelled/skip/todo。覆盖原价格段/稳定行、重复换货、独立/整期续租、分批归还、费用审核、当前会员与履约拒绝及命名公开schema |
| 真实Nest继承与生命周期 | 49088中实际Nest容器核原13项Inject依赖为同一实例，核心方法继承包内函数；trace为restore→backfill-start→profiles→backfilled→preheat，各关键钩子一次且预热晚于回填。该进程整体退出1来自当时四个旧夹具缺项，Nest核对本身通过；数据源为明确空fixture，没有HTTP/数据库/文件IO |
| 正式出口与依赖 | Rental92正式出口/91子路径typesVersions、公共合同6出口/5子路径均对应实际源与JS/声明；依赖锁全文与父版相同。领域根入口不加载MySQL或服务端身份适配 |
| 源码与接入资料 | 根入口、Rental包导读、公共合同导读和原API模块说明随片更新，实际接口来源与构造路线可定位；正式需求/任务身份及百分比按原门槛保留 |

原换货758个断言逐个正文保留，新添12个范围/事务断言，仍是原93个用例，没有新增测试文件、skip或生产fallback。只补明确的当前空间品类/原SQL active状态、服务目录空集合、型号库存字段及标准库存依据，并让原Controller实际消费RentalExchangePreviewService；配置读取与数据库仍是明确fixture。中间复验47500的82过/11失败及49088的89过/4失败保留：均继续暴露部分续租夹具缺必需services集合，补明确空集合后最终93项通过。首轮2640类型检查的六个合同/事务reader遗漏错误也保留；补原检查常量/品类目录出口、推荐版本reader和当前能力读取后9604三配置及最终十配置通过，没有放宽接口或强转为全库类型。

本片复核PCH原G1～G4门槛未跨下一档。报价/营销主业务服务、配货/确认、Controller、独立schema/迁移/Seed、页面/客户端、作业/AI与标准Core装配仍须迁移；公共组织/安全/订阅办理/基础集成及真实无Core/多Core运行、安装、分别更新/回退和独立接手/审查仍未齐备，不能用正文一致或93项局部通过判完整拆分完成。[接入路线](../../../packages/rental-core/README.md#使用与构建)

全部新验证通过既有worker的stdin与内存模块执行；原离线preload、固定offline地址和本树单一output/.tmp写界保留，没有安装、落地client、共享dist写入、新临时环境或后台业务进程。原Core图片IO为明确内存fixture，退出剩余0、磁盘写入0；当前目录为空。SQL/事务/会员/配置是明确fixture，真实HTTP/数据库/浏览器/供应商、完整Core安装/独立更新及接手/审查未验。

本日再次核定旧840文件/91,808,304字节环境与1个0字节日志的绝对路径、归属、无链接及无使用进程，原生PowerShell删除仍被自动审批在启动前以blocked by policy拒绝；两个原责任manifest已补最近尝试，残留仍在统一待清理根，没有换壳/工具绕过或称已释放空间。[原清理证据](#core-rental-recovery-receipts-20261116)

阶段源码由包含本节的Git提交定位，中文提交并普通推送codex/platform-core-extraction后读取实际远端；main及其他工作树未写。

<a id="core-rental-approval-file-basis-20261116"></a>

## Rental 原批准、检查同意与公共文件冻结边界（2026-11-16）

固定父版 `af8258a656ebcae9eee521d170ed796ae3088a8c` 已普通推送并实际远端回读，main62ca在本树祖先。原换货批准核验、检查材料/同意读取、设置批准合同与输入schema实际移入Rental包，shared/API旧路径再导出同一声明。文件冻结与稳定存储位置校验归公共合同包，原文件服务继续裁定当前业务ACL和实际IO。[原批准](../../../packages/rental-core/src/mysql-approved-exchange.ts) · [政策接点](../../../packages/rental-core/src/approved-exchange-policy.ts) · [检查合同](../../../packages/rental-core/src/exchange-inspection-preparation.ts) · [同意依据](../../../packages/rental-core/src/exchange-inspection-consent-basis.ts) · [设置合同](../../../packages/rental-core/src/approved-settings-ports.ts) · [输入校验](../../../packages/rental-core/src/approved-settings-validation.ts) · [文件冻结](../../../packages/platform-contracts/src/file-content-binding.ts)

费用确认、客户对具体检查/交付的同意与正式执行分别核验。唯一WeakMap只保存原事务内验证出的依据，换事务、换操作者、改输入或伪造JSON不能消费；执行前后核原费用、当前企业政策及客户同意关联。已消费批准的恢复只读原关联和费用收据，不重新报价或按今日TTL重授新支出。设置参与者以泛型表达调用方事务，原API别名实例化为本宿主Prisma事务；公共声明不泄漏生成类型。换货私有SQL与企业政策只声明实际使用的接点。

Rental换货批准使用正式 `@rental-os/platform-server/request-identity`，与原Guard/API共用唯一ALS；这项可选服务端peer只在该子出口加载，领域根合同仍可由浏览器消费。本包prebuild/prelint沿公共服务→Rental顺序，公共服务自身先构建公共合同，无反向依赖或新增存储。文件位置引用只含稳定ID/provider/settings，不含凭据或供应商客户端，文件存在和旧active状态不被升级成冻结证据。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 拆前/拆后正文 | 文件冻结2函数、换货批准8函数及检查同意原12方法/函数在规范化换行和正式导入后正文一致；原schema、检查准备比较与企业意图声明单源迁移，未改SQL、原指纹、金额、状态或TTL语义 |
| 独立包及完整API类型 | TS5.9.3、Prisma5.22官方内存声明覆盖原238模型；十项配置零诊断。Rental110根/672源/220输出，API988根/2351源/1976输出；原Controller/DTO/企业与AI消费者编译通过，输出均内存 |
| 原批准/文件行为 | `node --no-compilation-cache - api-approval-behavior`，9840退出0、stderr为空；实际编译模块验证冻结摘要/路径/位置、严格设置schema、同意材料/收据、事务/操作者/输入与原消费恢复。SQL/企业政策为明确fixture，不代表真实授权库或对象存储 |
| 原Core消费者 | 16620中原Core完整IIFE达到原成功标记，品类/配置隔离、动态字段和型号图片断言通过；该合并进程退出1来自旧换货夹具缺库存reader，未把整个合并运行写成通过。图片IO为明确内存fixture，退出清理剩余0、磁盘写入0 |
| 原换货消费者 | 38036仅复验 `tests/rental-order-exchange.test.cjs`，退出0、stderr为空，原替换目标/原目标/冻结价格与金额断言通过。只补等待原异步读取及当前库存/服务和同一调用方事务fixture，移除原Core用例未被引用的cameraContext准备对象，原断言保留，没有生产fallback |
| 正式出口/依赖/资料 | 6个Rental子出口及1个公共文件子出口对应实际JS/声明；唯一契约与原共享总出口兼容。源码说明、根入口、两包README和原API导读随片更新；HTTP/DTO/OpenAPI的业务路径与字段保持 |

保留拆前失败。35884在主服务尚未移动前退出1，旧Core配置读取把Promise当对象，旧换货把Promise放入报价快照触发DataCloneError。补await后16620的Core达到完整成功标记，换货继续暴露缺当前库存reader；19228补库存后退出1，指出缺当前服务权威和原事务。现只给旧换货用例补明确受限的配置来源与同一fixture事务，无服务时返回该fixture的真实空集合，未知/越界不放行；最终原换货单次复验通过。类型首轮33项缺原换货/企业协议来源的错误也保留，补齐其原单源归属后十配置通过，不新造同名DTO。

PCH原门槛未跨下一档，原任务百分比/依赖不改。完整主领域服务、Controller、独立schema/迁移/Seed、页面/作业/AI及标准装配，公共生命周期/事务和真实安装/更新/接手仍缺；下一入口为主核心服务13项真实依赖及兼容Nest接线。[接入路线](../../../packages/rental-core/README.md#使用与构建)

本片没有新增测试文件或运行器；复用已有内存worker经stdin编译并执行必要原消费者/短检查。原离线preload、固定offline地址与本树output/.tmp边界保留，JS/声明/图片fixture均内存，目录为空，验证进程退出；没有安装、落地client或新临时环境。SQL/政策/事务/图片IO是明确fixture，真实HTTP/数据库/浏览器/供应商、完整Core安装/独立更新及接手/审查未验。原待清理环境和0字节日志、删除审批拒绝与责任manifest沿[前片](#core-rental-service-capacity-20261116)保留，不换工具绕过。

阶段源码由包含本节的Git提交定位，中文提交并普通推送codex/platform-core-extraction后实际远端回读；main及其他工作树未写。

<a id="core-rental-corporate-receivables-20261116"></a>

## Rental 企业应收、现金核销与原回款收据迁移（2026-11-16）

固定父版 `8fcb5344481c2efd9a604d907c806bdf983d5f9c` 已普通推送并实际远端回读，main62ca在本树祖先。原企业应收仓储、完整账读取、总回款/逐单核销/冲销规则与原结算快照校验实际移入Rental包，旧API只保留原Nest一参数构造或窄正式再导出。资金服务与企业业务沿同一数据源和原事务消费，平台人员与权限仍由原正式入口核验。[应收实现](../../../packages/rental-core/src/mysql-order-receivables.ts) · [完整原账](../../../packages/rental-core/src/mysql-corporate-ledger.ts) · [回款收据](../../../packages/rental-core/src/corporate-payment-receipts.ts) · [冻结结算](../../../packages/rental-core/src/corporate-settlement-basis.ts) · [私有存储](../../../packages/rental-core/src/corporate-receivable-storage.ts)

企业回款分配不再次计为现金收入，原按单/账期、付款主体、空间和币种沿冻结依据读取。原授信账户锁内按500行读取完整账，页大小不是账户上限；校验全部回款与逐单分配及冲销来源，不能以孤立delta证明已付款。新实款核销只随同一资金/订单事务调整债权，旧差异拒绝核销、不扫描补账；退款和晚到实款保留原资金来源与收据。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版正文 | 四模块10个方法/函数正文一致；回款模块全部可执行语句（含两个冲销键箭头）及冻结结算模块也一致。只规范化原SQL/Decimal/隔离常量、正式导入和换行，未改金额/来源/状态规则 |
| 独立包及完整API类型 | TS5.9.3、锁定Prisma5.22官方内存声明覆盖原238模型；十项配置零诊断。Rental103根/664源/206输出，API988根/2343源/1976输出，编译与声明全部内存 |
| 原直接消费者 | `node --no-compilation-cache - api-receivable tests/rental-order-receivable.test.cjs`，37856退出0、stderr为空；原27项Node用例全部通过，0fail/cancelled/skip/todo，没有新增脚本或另造运行器 |
| 资金/企业原链 | 覆盖最后一分钱及超额拒绝、多单稳定锁/原分配、账超过500行仍完整、冲销保留债权原日期、晚到实款/退款、实款与企业回款不同到达顺序、原键回放及资金/债权失败回滚；原供应商结果和事务是明确fixture，没有付款网络调用 |
| 原接口与展示 | 原财务权限码、命名OpenAPI、可选企业回款金额、后台现金/企业核销区分和服务端结算文档通过。后台组件只做实际源码的静态HTML渲染，不代表浏览器交互或部署通过 |
| 出口/依赖 | 新四个正式子出口分别对应JS/声明，85正式出口/84子路径typesVersions一致；私有账读取只要求原SQL事务，应收存储只列原本表方法。依赖/peer/lock及HTTP/DTO业务语义未改 |
| 资料与差异格式 | 七份现行资料1019本地链接、157锚点和85表格无问题，稀疏目标按固定父版定位；git diff --check退出0，正式需求/任务及lock没有差异 |

保留拆分前失败。四模块尚未迁移时先运行同一原[应收用例](../../../tests/rental-order-receivable.test.cjs)，50112退出1，27项中1通过/26失败，均被旧[夹具](../../../tests/helpers/order-receivable-fixture.cjs)缺原Tenant共享父锁阻止。现只补原父锁SQL、租户参数和明确原行返回，未知SQL仍报错；全部金额、权限、历史、回放和回滚断言保留。最终单次运行全部27项通过，没有用生产fallback、删断言或skip处理。

源码头、根入口、模块导读及接入方式随片维护。已启用企业业务的宿主将同一原应收仓储交给资金服务，原企业授信/人员授权/财务入口和外部付款仍按所属域处理；公共Core合同不泄漏本私有MySQL类型。PCH原门槛未跨下一档，完整主领域服务/Controller、数据/页面/作业/AI及标准装配、公共事务/生命周期和真实消费者仍缺。下一入口为主核心/业务服务与配货/确认实际接点。[包阅读入口](../../../packages/rental-core/README.md#使用与构建)

原离线preload在编译前加载，固定offline地址，审计/TEMP/TMP/cache限定本树单一output/.tmp，未产生审计文件、目录为空；进程已退出，JS/声明均内存，没有安装、生成落地client、复制依赖或新残留。SQL/锁/事务/回滚为明确fixture，不证明真实数据库/并发。真实HTTP/数据库/浏览器/供应商、标准包安装/更新回退、独立接手/审查仍未验。

原环境840文件/91,808,304字节及1个0字节日志仍集中待清理；本次同一原生删除自动审批拒绝和责任manifest沿[容量阶段](#core-rental-service-capacity-20261116)保留，没有换工具绕过。旧外观失败和历史缺链继续保留。阶段源码由包含本节的Git提交定位，普通推送codex/platform-core-extraction后实际远端回读；main与其他工作树未写。

<a id="core-rental-service-capacity-20261116"></a>

## Rental 服务容量与原发生项收据迁移（2026-11-16）

固定父版 `e70b4306223491d79a9635d4761e18db8943262e` 已普通推送并实际远端回读，main62ca在本树祖先。服务容量实际移入Rental包，旧API保留原一参数Nest构造，供给同一Prisma数据源及每次请求的原Auth/ALS身份与空间解析。品类绑定锁直接复用包内原实现；没有新增锁算法或将整库写权放入公共Core合同。[容量实现](../../../packages/rental-core/src/mysql-service-capacity.ts) · [私有存储/身份接点](../../../packages/rental-core/src/service-capacity-storage.ts) · [原Nest接线](../../../apps/api/src/modules/rental-core/rental-service-capacity.service.ts)

报价只读观察保留原RepeatableRead、服务/地点/窗口校验、同窗口数量汇总和指纹，明确不新预留、不锁写、不维护超时账。原编辑与维护路径继续使用ReadCommitted；预留/确认/取消、换货锁后读取、部分履约/部分释放及归还结算继续参与调用方原事务。原容量CAS、桶计数、收据键和历史匹配保持，窗口停用不阻止释放本单原占用；服务计划时点不冒充实际完成。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版正文 | 22个方法的编译后正文一致，规范化两份宿主接点、原SQL runtime别名、隔离级别常量及换行；原条件、数量、状态与SQL锁顺序保持 |
| 独立包及完整API类型 | Prisma5.22官方内存声明覆盖原238模型，TS5.9.3；十项配置零诊断。Rental98根/659源/196输出，API988根/2338源/1976输出；JS/声明全部内存 |
| 原直接消费者 | 首轮24764中原预留/换货用例、发生项9组和履约17组通过；写入用例因旧父锁夹具失败，保留退出1。只复验写入和必要接点，最终37744退出0、stderr为空；不是将首轮全体写成通过 |
| 固定版本失败定位 | 42656以父版实际容量源码覆盖同一内存组合，仅运行旧写入用例，同样退出1并复现两个space-lock；旧夹具未区分Tenant共享父锁和空间锁。现补原父锁SQL/租户参数及先后断言，原空间/容量行锁、当前地点、停用与历史断言全部保留 |
| 原身份/空间与只读观察 | 同一最终进程7个接点边界通过，4次原RR事务；容量够/不足、无身份/跨租户、无效发生项、事务末空间变化及坏原账分别处理。实际编译服务只接显式fixture，任何写锁/预留/维护都会抛错，原数据源/事务传递已核 |
| 出口与文档 | 新/mysql-service-capacity与真实声明对应，81正式出口/80子路径typesVersions，依赖/peer/lock没有差异。源码头、根入口、模块导读和本记录随片维护，原HTTP/DTO/OpenAPI语义保持 |
| 资料与差异格式 | 七份现行资料997本地链接、155锚点和84表格无问题，稀疏目标按固定父版定位；git diff --check退出0，正式需求/任务及lock没有差异 |

验证复用[原容量写入](../../../tests/category-service-capacity-write.test.cjs)、[预留/换货](../../../tests/category-service-capacity-reserve.test.cjs)、[发生项](../../../tests/rental-service-occurrence.test.cjs)和[履约](../../../tests/rental-service-execution.test.cjs)。已有worker经stdin运行`node --no-compilation-cache - api-capacity <四份原用例>`，失败后只运行写入和容量接点；固定父版以`api-capacity-baseline`定位夹具。没有新增测试文件或运行器。[原真库容量测试](../../../tests/rental-service-capacity.test.cjs)先读.env，[容量争抢](../../../tests/rental-service-capacity-contention.test.cjs)需专用克隆库，只读源码、没有执行。

原离线preload在编译前加载，固定offline地址与本树单一output/.tmp，审计文件未产生且目录为空；没有安装、落地client、复制依赖或新增临时环境。SQL、锁、事务和回滚都是明确fixture，不能替代真实并发/持久化。HTTP/数据库/浏览器/供应商、标准包安装/独立更新/接手及审查仍未验。

本次重核原840文件/91,808,304字节环境和1个0字节日志的绝对路径、归属、链接及使用进程后，同一原生PowerShell删除仍在启动前被自动审批以blocked by policy拒绝，两个责任manifest已更新；没有换工具绕过。残留仍在统一待清理区，前片失败记录与旧外观/历史缺链保留。

PCH原门槛未跨下一档：完整主领域服务/Controller、数据/页面/作业/AI与标准装配、公共事务/生命周期及真实消费者仍缺，原任务身份/依赖/百分比保持。下一入口沿企业应收和原回款收据再推进主服务，不丢调用方事务。阶段源码由包含本节的Git提交定位，普通推送codex/platform-core-extraction后实际回读；main和其他树未写。

<a id="core-rental-funding-runtime-20261116"></a>

## Rental 资金事实与门禁服务迁移（2026-11-16）

固定父版 `9ddc6e3ac91a762987f860409649d6a2119fc7f7` 已普通推送并实际回读，main62ca在本树祖先。原资金服务和事件算法实际移入Rental包，API只保留原Nest构造接线，供给同一数据库、每次请求的Auth/ALS完整身份、原订单可见范围及企业应收参与者。原DI可选应收、方法签名与调用方事务保持。[资金服务](../../../packages/rental-core/src/mysql-funding.ts) · [事件规则](../../../packages/rental-core/src/funding-events.ts) · [本表与宿主接点](../../../packages/rental-core/src/funding-storage.ts) · [原Nest接线](../../../apps/api/src/modules/rental-core/rental-funding.service.ts)

资金服务保留订单共享父锁/行锁、余额与收退款/保证金门禁、续租增额、实款与演练分账、线下原登记/凭证、同键回放、企业回款分配和现金核销。调用方已有事务原样参与；自开事务保持原ReadCommitted，解释读取保持原RepeatableRead与有界结果。SQL和Decimal使用同一原runtime，领域总出口不加载数据库适配；外部支付仍由原核验运行器执行，缺原供应商证据或应收接点不补零、不重做。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版方法/规则正文 | 资金服务19方法及资金事件7函数/完整可执行语句一致；规范化SQL/Decimal和隔离级别常量、正式导入与两个身份/范围接点，未改余额、金额、原键或状态规则 |
| 独立包及完整API类型 | Prisma5.22官方内存声明覆盖原238模型，TS5.9.3；十项配置零诊断。Rental96根/657源/192输出，API988根/2336源/1976输出；编译、JS和声明全部内存 |
| 原资金事件与门禁消费者 | 原事件8组通过；门禁复验进程51684退出0、stderr为空，原9组全部通过，含线下押金凭证与审计失败回滚、领取/关闭/确认、实款/演练、旧确认关联、员工部分实收及原外部退款幂等。外部退款结果和事务是明确fixture，无网络 |
| 完整身份与有界资金解释 | 同一复验进程5个必要边界通过，核原可见where、take201及RepeatableRead/maxWait/timeout；无财务权、跨租户、原金额缺失和读取后额外身份字段变化均拒绝。原完整对象供给没有字段投影，预授权保持unavailable，不制造结算结果 |
| 正式出口/依赖 | 新增/mysql-funding与/funding-events，80正式出口及79子路径typesVersions一致；依赖/peer和lock不变，原API/DTO/OpenAPI的HTTP行为未改 |
| 定向文档及差异格式 | 七份现行资料978本地链接、155锚点和83表格无问题，稀疏目标按固定Git定位；git diff --check退出0，正式需求/任务及lock没有差异 |

原消费者为[资金事件](../../../tests/rental-funding-events.test.cjs)和[资金门禁](../../../tests/rental-funding-gates.test.cjs)。复用既有内存worker经stdin运行`node --no-compilation-cache - api-funding <两份原用例>`，失败后只复验门禁及新接点；没有新增测试文件或运行器。原[真库资金测试](../../../tests/rental-funding-service.test.cjs)会先读.env、连专用库，本片只读脚本源码，没有执行，不能用离线结果替代其持久化/并发验收。

保留首轮失败：门禁夹具把收款设置锁定读取返回成资金事件，原收款准入明确报“经营空间收款设置尚不可用”。已核19方法及原接点正文一致，只在原夹具补当前收款设置行和原表/共享锁/租户空间参数断言；全部资金、回放、拒绝及回滚断言保留，生产方法没有fallback或放宽。

模块导读和源码接点随片维护，Core作者从正式子出口与[包导读](../../../packages/rental-core/README.md#使用与构建)定位。PCH原门槛未跨下一档：完整领域服务/Controller、数据/页面/作业/AI与标准装配、公共事务/生命周期和真实消费者仍未完整。原任务身份、依赖和百分比保持。接续下一入口为服务容量、主领域服务和标准Core装配。

原preload在编译前加载，offline地址固定，审计/TEMP/TMP/cache指向本树独占output/.tmp，目录为空且未产生审计文件；没有生成落地client、安装、复制依赖或新临时产物。真实HTTP/数据库/浏览器/供应商、完整包安装/更新和独立审查未验。原840文件/91,808,304字节环境及1个0字节日志仍集中待清理，原生删除审批拒绝与责任manifest沿[前片](#core-rental-domain-rules-20261116)读取，没有换工具绕过或新建同类环境。旧外观失败与历史缺链保留。

阶段源码由包含本节的Git提交定位，普通推送codex/platform-core-extraction后读取真实远端。main及其他工作树未写入。

<a id="core-rental-domain-rules-20261116"></a>

## Rental 检查、换货、续租与资金规则归属（2026-11-16）

固定父版 `4973f8c2d27a474bec125ff9fdeeb299bf91159b` 已普通推送并真实远端回读，main仍为62ca且在本树祖先。31份实际业务规则移入Rental包，旧API路径再导出同一实现；检查必填/观察/证据与冻结模板、换货价格/会员/券/优惠、续租与重定价、服务目录/发生项/取消、资格/资产有效期、日历/调价/资金规则及示范数据按自身正式子出口读取。[包导读](../../../packages/rental-core/README.md#阅读路线) · [服务目录](../../../packages/rental-core/src/service-catalog.ts) · [换货检查](../../../packages/rental-core/src/exchange-inspection.ts) · [资金规则](../../../packages/rental-core/src/security-deposit.ts)

报价访问明确接收原宿主每次请求的已验证身份与地点范围，原API保留函数签名；来源快照不是使用权，客户本人、成员/组织/地点范围仍按原规则裁定。线下收款方式只接调用方原资金事务的锁定读取，使用同一Prisma SQL runtime，保留当前空间设置共享锁、旧缺省、配置异常和禁止方式的原结果。公共请求指纹使用正式公共子出口，纯规则不反向依赖shared或API源码。[报价规则](../../../packages/rental-core/src/quote-access.ts) · [报价兼容入口](../../../apps/api/src/modules/rental-core/rental-quote-access.ts) · [收款方式](../../../packages/rental-core/src/mysql-offline-payment-method.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版可执行正文对照 | 31模块、114个函数/方法，以及箭头与常量的全部可执行语句一致；仅规范化正式导入、SQL runtime别名、换行及两份明确接点的注入。原金额、时段、资格、冻结依据和异常正文保持 |
| 独立包及完整API类型 | 锁定Prisma5.22官方WASM/generator为当前238模型生成内存声明，TS5.9.3；十项配置零诊断。Rental93根/654源/186输出、shared122根/340源/245输出、API988根/2333源/1976输出；输出全部内存 |
| 七份原直接消费者 | 服务目录、优惠取舍、押金/预授权、订单报价范围、资产有效期、检查证据及换货检查最终通过。最初同跑七份，实际失败后只复验换货；最后进程37036退出0、stderr为空，换货原6项Node用例及原IIFE通过，无skip/todo/cancelled |
| 两份新正式接点 | 进程18888退出0，31个身份/报价范围及收款准入正常/拒绝边界通过；10次锁定读取核原表、共享锁和租户/空间参数。SQL结果是明确fixture，无网络 |
| 正式出口及依赖 | 78个正式出口与77个子路径typesVersions对应，原依赖/可选peer不变，lock无差异；领域根出口不加载MySQL适配。本片没有HTTP/DTO业务合同变化，原Controller、Guard及OpenAPI继续消费同一规则 |
| 定向文档及差异格式 | 七份现行资料959本地链接、153锚点和82表格无问题；默认git diff --check退出0。正式需求/任务没有差异，全局旧缺链继续保留 |

原消费者入口为[服务目录](../../../tests/rental-service-catalog.test.cjs)、[优惠取舍](../../../tests/rental-discount-selection.test.cjs)、[资金规则](../../../tests/rental-security-deposit.test.cjs)、[报价范围](../../../tests/rental-order-quote-scope.test.cjs)、[资产有效期](../../../tests/rental-asset-validity.test.cjs)、[检查证据](../../../tests/rental-inspection-evidence.test.cjs)及[换货检查](../../../tests/rental-exchange-inspection.test.cjs)。验证使用已有内存worker，经标准输入运行`node --no-compilation-cache - api-rules <七份原用例>`，失败后运行`api-rule-current tests/rental-exchange-inspection.test.cjs`；两接点以同一worker的独立包范围`api-rule-contacts`核验，不新增测试文件或运行器。

保留失败过程。首轮原换货夹具未模拟订单缺副本时读取关联原报价的既有分支，另一个消费者要求实体shared/Prisma产物；固定父版497的31份原规则覆盖回同一内存组合后，缺报价夹具失败复现。只在原用例补关联报价的租户/空间、品类版本和原订单修订断言及无原报价返回，保留原缺历史拒绝断言。内存验证对实际编译shared字节提供明确虚拟路径，并将原API本地Prisma路径映射到同一离线SQL/Decimal/enum fixture；修正解析器自身缺模块递归后复验，不复制依赖、生成客户端或放宽生产读取。

本片源码与模块导读同步说明职责和关键限制，原函数/状态机/计价逻辑复用。PCH原门槛未跨下一档：完整Rental领域服务/Controller/数据/作业/AI与标准装配、公共事务/生命周期及全链消费者仍缺，原任务身份/依赖/百分比保持。当前接入入口继续沿[五步指南](平台Core接入-开发任务.md#core-quick-start)与正式包说明读取。

没有浏览器、真实HTTP/数据库/供应商、完整包安装/更新或独立审查证据。原离线preload在编译前加载，固定offline地址；审计/TEMP/TMP/cache指向本树独占output/.tmp，未产生审计文件，目录仍为空；JS/声明全部内存，SQL/锁/事务与回滚是明确fixture。

原待清理环境840文件/91,808,304字节和唯一空guard.log的1文件/0字节仍在统一待清理区。再次核定绝对路径、归属、文件/体积、无链接及无使用进程后，同一原生PowerShell删除在启动前被自动审批以blocked by policy拒绝；两份责任manifest已更新，没有换壳/工具绕过。位置分别为D:/工作文件/rental-OS/output/.cleanup-pending/pch-preparation/platform-host-integration/manifest.json及rental-business-facts/manifest.json。既有外观静态失败、总导航三份历史附件和MCP五份隔离附件缺失继续保留，本片不据局部结果宣称全绿。

阶段提交由包含本节的Git版本定位，普通推送codex/platform-core-extraction后实际回读；main及其他树未写入。后续先迁移资金服务的原事实/应收接点，再推进主领域服务与标准Core装配。

<a id="core-rental-core-facts-20261116"></a>

## Rental 订单、库存与检查事实仓储迁移（2026-11-16）

固定父版 `7447555e21c951b1b71aa1b14497d5d179722f09` 已普通推送并真实远端回读，main仍为62ca且在本树祖先。完整核心事实仓储实际移入Rental包；原API保留薄Nest provider，供给原Auth/ALS完整身份、空间/地点范围、原组织算法、检查事件和同一数据库事务。[实际仓储](../../../packages/rental-core/src/mysql-core-facts.ts) · [本表视图与宿主接点](../../../packages/rental-core/src/core-fact-storage.ts) · [原provider](../../../apps/api/src/modules/rental-core/rental-core-fact.repository.ts)

本片包含订单聚合/列表及有界历史读取、预占/分配、资产与状态历史、库存作业与来源流水、归还处置/恢复/核销、工单、检查与更正、续租及换货事实。原Tenant共享锁→订单/资产→处置/工单的锁序、调用方事务、Decimal/JSON空值、订单与库存一起提交、原幂等和历史快照保持。手工维护不释放独立维护/停用限制，工单取消不恢复异常库存；读数更正追加历史，不改写原检查事实或已有归还引用的基线。

冻结检查与单件配货依据也移入Rental MySQL子出口；业务规则中的读数、占用、承运期间、排序/编号、规则缺省、工单处理人范围和金额函数成为单源，旧API路径再导出。`defaultRentalNoShowRule` 从原shared文件迁入Rental合同，shared兼容再导出原函数。当前身份接点返回原完整对象，没有字段投影，冻结指纹与前后范围复验仍涵盖原全部字段。私有MySQL适配继续使用所选宿主schema的生成类型和原SQL runtime，公共Core合同与领域根出口不加载数据库客户端。[身份接点](../../../packages/rental-core/src/fact-request-context.ts) · [冻结检查](../../../packages/rental-core/src/mysql-order-inspection-basis.ts) · [配货依据](../../../packages/rental-core/src/mysql-order-allocation-pickup.ts) · [规则入口](../../../packages/rental-core/README.md)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版正文对照 | 核心事实83项、十份规则/冻结读取33项及原缺省函数1项，共117个方法/函数的编译后正文一致；仅规范化正式导入/runtime别名及存储、身份/范围、组织算法、事件和两处冻结读取接点。五项行投影由any改为真实数据库payload，编译后正文仍一致，未改变业务算法 |
| 正式配置与当前schema内存编译 | 公共合同5根/199源/10输出，Rental62根/623源/124输出，shared122根/340源/245输出，完整API988根/2302源/1976输出，均0诊断；共十项配置通过。当前238模型由锁定Prisma5.22官方WASM/generator内存供给，TS5.9.3，主树依赖只读复用，JS/声明未写磁盘 |
| 六份原直接消费者 | `node --no-compilation-cache - api-core-facts` 执行原rental-order-number、rental-asset-status-history、rental-stock-operations、rental-stock-disposition、rental-work-order和rental-usage-reading-validation。最终进程43976退出0、stderr为空；资产5项、库存作业6项、处置5项、工单8项及编号/检查读数IIFE通过，保留全部原断言 |
| 受影响行为 | 核原日期/空间/租户与编号上限、资产初建/状态/独立待检来源、库存同键与调拨守恒/隔离底线、处置恢复与唯一核销流水、工单状态/锁后事实及检查不可改写/更正历史。SQL、存储、锁、事务及回滚均为明确fixture，不替代真实数据库验收 |
| 原离线守卫与收尾 | 原prisma-offline-preload在内存编译前加载；固定offline数据库地址，审计/TEMP/TMP/缓存限定本树独占output/.tmp。未预建空日志；最终审计文件不存在且临时目录为空，进程已退出，无新增临时目录、依赖副本、生成物或后台业务服务 |

初次快速类型检查漏掉括号接收者上的inspectionRecord.create，且Rental本地合同尚无原缺省函数；补真实表方法与单源函数后通过。首轮完整类型通过，但两个旧用例用Object.create绕过构造而缺少宿主接点。改为真实构造后定位两处夹具漏掉原Tenant共享锁；固定744仓储本来就执行该锁，83项正文对照一致。只补真实构造、父锁语义及租户参数断言，再执行最终六份用例；没有添加生产fallback、删除断言或放宽权限。

源码职责、五项行投影类型、模块README、原业务导读及根入口同片维护。HTTP路由、DTO/OpenAPI、历史迁移和客户端协议未变，本片没有重写API文档字段或新增测试脚本/第五册。完整Rental业务服务/Controller、独立schema/迁移/Seed、页面/客户端、作业/AI及正式标准Core装配仍缺；公共组织/完整订阅/集成、无Core真实运行、多Core真实并存、独立安装/更新回退/接手和审查继续沿原门槛。PCH各项未跨下一档，需求和任务身份/依赖/计分保持；旧外观与历史缺链不由本片关闭。

固定源码与资料由包含本节的Git提交定位，提交只含本任务源码、两份原夹具及必要导读/记录/接续，普通推送到codex/platform-core-extraction后真实回读。旧环境840文件/91,808,304字节和旧0字节日志仍在统一待清理区，责任清单沿当前接续保留；原生删除受阻的历史不被本片覆盖，没有换工具绕过。

最终定向文档核对7份、907个本地链接、150个锚点引用和81个表格，问题0；稀疏目标用固定744 Git树定位。47个正式包出口及typesVersions对应真实源码，依赖/peer与锁文件一致；正式需求/任务无差异，默认差异格式检查退出0。冻结读取首轮正文核对的两项差异来自检查脚本对范围接点重复加this，修正内存规范化后117项一致，没有据检查脚本改动业务源码。

<a id="core-rental-business-facts-20261116"></a>

## Rental 报价、券、奖励与通知事实迁移（2026-11-16）

固定父版 `9c433ce9bc4bc1df4b0cf2998a5d5047a17b3bea` 已普通推送并从真实远端回读，main仍为62ca并在本树祖先。原业务事实仓储实际迁入Rental包，旧API保留薄Nest provider，供给原当前空间、每次生成的订单可见范围、有界库存配置reader、原通知事件及同一数据源和事务。[事实实现](../../../packages/rental-core/src/mysql-business-facts.ts) · [本表视图与宿主接点](../../../packages/rental-core/src/business-fact-storage.ts) · [原provider](../../../apps/api/src/modules/rental-core/rental-business-fact.repository.ts)

报价、券占用/核销与模板预算、奖励/权益余额、推荐及租赁通知保持Rental归属。首次报价提交继续锁原经营空间并核当前履约、能力和库存对象，已保存报价读取原来源、金额、消费依据和历史快照，不补入当前配置。券与余额写入使用原调用方事务和Decimal精度；通知流水先持久化，原事件与事实在同一事务提交，投递认领只占租约，原结果更新才递增尝试次数。租约过期只是调度候选，不证明可以重新发送，外部短信和批准仍由原业务服务处理。

报价能力事实和库存依据移入正式 `/mysql-quote-capabilities` 与 `/quote-inventory-basis`。原商品有界查询/投影三类型进入既有 `/configuration-basis` 单源，核心配置仓储保留兼容类型再导出。私有MySQL声明只包含本仓储实际表方法，当前仍使用原组合schema的生成类型；公共Core合同与Rental根出口不加载生成模型或数据库客户端。[能力事实](../../../packages/rental-core/src/mysql-quote-capabilities.ts) · [库存依据](../../../packages/rental-core/src/quote-inventory-basis.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版逻辑对照 | 事实仓储44项、报价能力2项、库存4项，共50个方法/函数正文一致；仅规范化正式合同/runtime别名及存储、范围/可见性、配置reader和原事件接点。未改报价、金额、券或通知算法 |
| 正式配置与当前schema的内存编译 | 公共合同5根/199源/10输出，Rental48根/609源/96输出，shared122根/340源/245输出，完整API988根/2288源/1976输出，均0诊断；共十项配置通过。当前238模型由锁定Prisma5.22官方WASM/generator在内存供给，TS5.9.3，主树依赖只读复用，JS/声明未写磁盘 |
| 原直接消费者 | `node --no-compilation-cache - api-business-facts` 执行原sms-rate-limit、category-capability-conditions、rental-quote-recovery-review和rental-fulfillment-admission四份用例。退出0、stderr为空；24个原Node用例和3个必要边界用例，共27 pass/0 fail/skip/todo/cancelled，原短信限流IIFE通过 |
| 本片必要边界 | 本版实际仓储核券预算条件更新、原空间/事务、Decimal、次数上限及竞争失败；通知核同事务事件、重复键与其他错误区别、事件失败传播和fixture回滚；认领核租约/尝试CAS，原结果更新累计attempts并释放租约，公开日志不含收件人密文。SQL、存储、事务及回滚均为明确fixture，不替代真实数据库验收 |
| 原离线守卫 | 使用本树原prisma-offline-preload，固定offline数据库地址，审计/TEMP/TMP/缓存指向单一临时目录，守卫违规0；未读取环境文件、实例化数据库客户端或访问网络 |

初次类型检查定位runtime DbNull与生成客户端私有类型标记不同，直接类型转换仍有TS2352。锁定官方generator明确将 `Prisma.DbNull` 赋为同一 `objectEnumValues.instances.DbNull`，私有适配仅对齐该单例的名义类型，不创建空值替身、不加载生成Client。最终完整类型通过，原空值语义保持。

旧报价恢复夹具没有提供原新报价必需的库存依据和有界SQL读取；核对固定父版已有同一提交检查后补齐，仅对JSON空值使用原DbNull投影，Decimal保留真实类。全部来源/地址/租金不可改写断言保持。原integration-security两条attempts静态断言改读迁移后的唯一源码并定向核验，不将此静态段当作完整供应商测试通过。

源码职责头、Rental模块README、原业务导读与根入口同片更新，未新增测试脚本或第五册。本片仍缺完整Rental业务/数据/页面/作业/AI与标准主装配，以及完整公共组织/订阅/集成、真实HTTP/数据库/浏览器、干净包安装/独立更新回退、接手与审查。按原门槛复核未跨下一档，正式需求和任务进度保持；旧外观静态失败、历史附件和统一待清理环境保留原归属。下一入口为完整订单/资产/库存事实仓储及原服务链。源码固定版本由包含本节的提交定位，普通推送至原任务分支并以实际远端回读核定。

最终定向文档检查7份、875个本地链接、150个锚点引用及80个表格，问题0；未检目标按固定Git定位。锁文件与包依赖/peer一致，默认diff检查退出0，原两条attempts静态断言保留并通过。接续按当前实际边界精简，完整前像保存在固定9c同路径，未解决事项均保留当前入口或原阶段证据。

本片Node进程53004已退出，编译/声明/业务夹具全部内存。唯一空审计日志的原生PowerShell删除在启动前被自动审批以 `blocked by policy` 拒绝；按已授权原生Move-Item归集到统一待清理区，原临时目录已移除。责任清单为 `D:/工作文件/rental-OS/output/.cleanup-pending/pch-preparation/rental-business-facts/manifest.json`，残留1个文件/0字节，状态已归集、未删除；没有换壳/工具绕过。旧公共宿主环境继续沿原责任清单处理，没有新增依赖副本或后台业务服务。

<a id="core-rental-core-configuration-20261116"></a>

## Rental 核心配置、品类写入与履约准入迁移（2026-11-16）

固定父版 `70139e810f92a1942b2cf41b3670dcfe04e3618b` 已普通推送并从真实远端回读，main仍为62ca且在本树祖先。原核心配置仓储实际移入Rental包，原API路径成为薄Nest provider，供给原Auth/ALS身份、空间/地点范围、原配置事件及同一事务。当前品类绑定/唯一属性写入、采用政策、属性校验和履约准入也移入同一包，旧路径再导出正式实现。[核心配置](../../../packages/rental-core/src/mysql-core-configuration.ts) · [私有存储与宿主接点](../../../packages/rental-core/src/core-configuration-storage.ts) · [原provider](../../../apps/api/src/modules/rental-core/rental-core-config.repository.ts)

本片保留档案与默认经营空间、业务设置、地点/主体、商品/套装、定价组、券模板和检查模板的原读写，以及报价/开业/报表的有界当前配置读取。默认空间只在首次创建时初始化当时成员，既有空间不补回撤销成员、不切换旧品类/绑定；档案/快照和设置修订CAS、配额/预算、唯一属性、状态复验和外层事务保持。当前父锁→空间锁、发布版本/采用范围及原初始化审计继续由实际Rental实现执行。[绑定写入](../../../packages/rental-core/src/mysql-category-write.ts) · [采用政策](../../../packages/rental-core/src/mysql-category-policy.ts) · [属性](../../../packages/rental-core/src/category-attributes.ts) · [履约准入](../../../packages/rental-core/src/mysql-fulfillment-admission.ts)

`RentalBusinessContext`、`RentalUniqueAttributeClaim` 和 `VersionedBusinessSettings` 从原私有同名定义移入既有 `/configuration-basis`，原消费者保留类型别名/兼容出口。私有MySQL视图只包含本仓储实际使用的方法；公共账号只读取findMany、组织只读取findFirst，成员初始化只提供原workspaceMember写入。生成模型仍仅进入私有适配声明，SQL/Decimal/异常沿原Prisma runtime；领域根出口和公共Core合同不加载这些适配。当前声明仍依赖原组合schema，完整Rental schema/迁移和标准装配尚未交付。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 原逻辑正文对照 | 核心配置45项、品类写入4项、采用政策2项、履约1项、属性5项，共57个方法/函数正文对照父版一致；仅规范化正式合同/runtime导入别名及存储、身份/范围/事件接点。第一次比较的6项差异来自shared→Rental正式合同别名，核对同一声明后通过，没有改业务算法 |
| 正式配置及当前schema的内存编译 | 公共合同5根/199源/10输出，Rental44根/605源/88输出，shared122根/340源/245输出，完整API988根/2284源/1976输出，均0诊断；共十项配置通过。当前238模型由锁定Prisma5.22官方WASM/generator内存供给，TS5.9.3，主树依赖只读复用，JS/声明均未写磁盘 |
| 当前六份原消费者 | `node --no-compilation-cache - api-core-configuration-current` 执行原config-write、space-initialization、pricing-group-lock、fulfillment-admission、config-workspace-scope和adoption-access用例。最终退出0、stderr为空；Node test 32 pass/0 fail/skip/todo/cancelled，范围脚本3项和配置/批准设置IIFE全部通过。SQL/存储/事务/批准参与者均为明确fixture |
| 固定父版失败对照 | 替换五份原API实现为固定70139正文，运行最初四份用例，仍为21例12 pass/9 fail，另有config-write锁序IIFE失败；初次当前版复现相同失败。修夹具前保留证据，没有把未执行的后续批准设置算通过 |
| 夹具修正与后续失败 | 明确Tenant共享锁及租户参数，保留原空间/身份锁和拒绝断言；将异步配置读取改为await，补当前主体状态、正式库存依据/有界读取及完整原批次回执。批准设置夹具允许原RepeatableRead历史回读，并断言不修改设置/批准。中间复验32例28 pass/4 fail且批准设置未过，定位缺项后定向复验；未删除断言、跳过用例或修改生产权限/异常 |
| 原批准/unknown与离线隔离 | 实际Core/配置仓储/Guard的限定通知修改、版本/CAS、同事务参与者、失应答回读与历史幂等通过；未注册工具拒绝分支按当前真实登记状态执行，不伪造登记或宣称完整AI执行验收。使用原prisma-offline-preload，固定offline数据库地址、审计/TEMP/TMP/缓存指向本树单一临时目录，守卫违规0 |

源码头和默认空间说明修正为实际职责，去掉过期阶段/测试派生说明，保留并发和历史兼容原因。模块README、原业务导读和根入口同片更新；未新增测试脚本或第五册。配置验证的唯一临时目录已核定范围、无链接及空目录后删除，Node验证进程已退出，没有新增依赖副本、生成物或业务服务。旧公共宿主环境840文件/91,808,304字节仍在统一待清理区，本日原生删除被自动审批以 `blocked by policy` 拒绝，责任清单与原阶段证据保留，未换工具绕过。

按原门槛复核，本片增加真实Rental包消费者与配置兼容证据，但Rental标准主装配、全部业务/数据/页面/作业/AI、完整公共组织/订阅/集成、真实HTTP/数据库/浏览器、独立安装/升级回退/接手及审查仍缺。PCH各项未跨下一档，正式需求和任务百分比保持原值；旧外观静态失败、总导航历史附件和其他未验项不由本片关闭。下一入口是报价、券、奖励、推荐和通知投递的业务事实仓储及其原当前/历史依据。源码固定版本由包含本节的提交定位，普通推送至原任务分支并以实际远端回读核定。

最终定向文档检查7份、905个本地链接、200个锚点引用和78个表格，问题0；稀疏未检目标按固定Git树/原文定位。正式需求/任务无差异，原编号/依赖/计分未改，锁文件的依赖与peer声明一致。默认格式检查最初将两条混合CRLF新增行报告为尾空白；仅整理本片类型导入与换行后复核，未改仓库Git配置。

<a id="core-rental-business-configuration-20261116"></a>

## Rental 业务配置仓储与规则版本链迁移（2026-11-16）

固定父版 `99d6af9bca28dc5030908593830518be0fa4161d` 已普通推送并真实远端回读，当天main仍为62ca并已纳入。原业务配置仓储实际移入Rental包，API原路径成为薄Nest provider，供给当前Auth/ALS身份、真实空间解析、当前品类绑定锁、原配置事件和同一数据库事务。[配置实现](../../../packages/rental-core/src/mysql-business-configuration.ts) · [存储与宿主接点](../../../packages/rental-core/src/business-configuration-storage.ts) · [原provider](../../../apps/api/src/modules/rental-core/rental-business-config.repository.ts)

本片保留原定价/优惠/增值服务、规则/日历版本和通知模板读写，以及开业/报价的有限事实投影。配置事务、审计、旧绑定拒绝、已发布正文不可覆盖及历史来源保持。存储视图仅含实际配置表和SQL读取；经营空间只提供findMany/findFirst，成员只提供原开业账号count，不向Core通用边界开放人员写入。40个方法/函数的编译后正文对照父版一致，仅替换存储、身份/范围/绑定/事件接点及原runtime别名。

绑定修订和读取上限移入 `/configuration-basis` 单源，规则版本链移入 `/rule-version-chain`，原API均再导出。规则链源码除合同导入外与父版一致，9个普通函数正文对照一致；箭头函数、常量、租期时点匹配、未来版本、发布/编辑/作废限制及新版本号规则均保持。[共同依据](../../../packages/rental-core/src/configuration-basis.ts) · [规则链](../../../packages/rental-core/src/rule-version-chain.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 正式配置与当前schema的内存编译 | 公共合同5根/199源/10输出，Rental38根/599源/76输出，shared122根/340源/245输出，完整API988根/2278源/1976输出，均0诊断。共十项配置通过，当前238模型仍由锁定Prisma5.22官方WASM/generator在内存供给；最终收窄公共表读方法后单独复核类型通过 |
| 原采用上下文 | `category-adoption-context-refresh.test.cjs` 的7例pass/0 fail/skip/todo/cancelled，当前提交后重读、冻结旧上下文、空/缺配置、当前地点投影和AI读取原快照断言保持 |
| 原配置写入消费者 | `node --no-compilation-cache - api-business-configuration` 执行原calendar/price/rule/marketing四份用例，最终退出0、stderr为空。原锁序、外层事务、旧绑定、服务适用条件、规则历史正文/审计范围、日历编辑/发布/替代及失效空间拒绝断言全部通过，SQL/存储/事务为明确fixture |
| 原规则版本链 | 短stdin作用于本版实际编译JS，执行原 `rental-rule-version-chain.test.cjs` 原文，11组断言全部通过、退出0。覆盖历史/未来租期、缺版本/同点冲突、展示状态、发布/编辑/作废限制、新号及发布预览 |

首次类型检查定位生成客户端与runtime声明对DbNull使用不同名义类型。运行时保留同一个 `objectEnumValues.instances.DbNull`，私有适配按所选schema的官方空值声明映射，不改空值或日历写入结果。声明期使用的ORM模型仅在此私有MySQL视图；运行时未导入生成客户端，公开Core合同及领域总出口不加载这些模型。zod采用仓库已有锁定3.25.76并登记依赖，无安装/升级。源码构建目前仍需原组合schema的生成声明，完整Rental schema与迁移链尚未独立，README同步核定先generate再构建的实际顺序。

四份原写入夹具首次将Tenant共享父锁和空间锁都记为lock而失败。按真实父锁SQL及租户参数分别处理后，原空间锁/版本/事务/审计断言保持并通过，没有删除断言或关闭父锁。规则纯函数一次性加载检查首次出现递归模块加载，预先取得既有依赖对象后完成原断言。原初始化时钟用例仍含同步getProfile等旧假设，本片没有执行或冒称通过。

源码职责头、正式出口、Rental/原业务导读、根入口及PCH接续同片维护；7份定向文档891个本地链接/199个锚点/77个表格核对通过，0个问题。`git diff --check`首次指出原混合换行文件中新加两条导出行的CR字符，仅修正这两行后复验，最终退出0。原需求/任务正文和进度保持，未用本片文件或方法数升档。本片没有新增测试脚本、依赖环境、临时文件或后台业务服务。真实数据库/HTTP/浏览器、完整Core数据/迁移/Seed与业务/页面/作业/AI装配、独立包安装/更新/回退、接手及独立审查仍待交付。旧统一环境清理审批拒绝、外观静态失败和历史缺失附件继续沿原摘要处理。下一入口为Rental Core配置仓储和业务事实仓储，继续同步简明资料。

<a id="core-rental-action-transactions-20261116"></a>

## Rental 业务动作事务执行器与共享父锁迁移（2026-11-16）

固定父版 `e99dc2e5d3711ca31d082c12fa2df7b5ef64855a` 已普通推送并真实远端回读，main仍为62ca并在任务分支祖先。本片将原业务动作执行器及Tenant共享父锁实际移入Rental包，旧API路径保留窄Nest provider和正式再导出。原API供给同一Prisma事务与幂等仓储，Nest继续只登记一个执行者。[动作实现](../../../packages/rental-core/src/mysql-idempotent-actions.ts) · [私有事务端口](../../../packages/rental-core/src/idempotent-action-storage.ts) · [共享父锁](../../../packages/rental-core/src/mysql-business-fence.ts) · [原provider](../../../apps/api/src/modules/rental-core/rental-idempotent-action.service.ts)

`/mysql-idempotent-actions` 保留事务外预检、事务内重查、原收据只读、回放与首次提交区分，以及唯一约束/写冲突/业务冲突的原处理；`executeInTransaction` 只参与调用者现有事务。`/mysql-business-fence` 保留原Tenant共享父锁与企业政策写入围栏，当前身份、Core准入、角色及业务对象授权仍由原链裁定。原事务端口仅声明实际使用的ReadCommitted能力，生成模型及全库客户端不进入公共Core合同。原5个执行方法与1个父锁函数的编译后正文对照父版一致，仅变更私有事务接点和原runtime别名。原重试次数3/退避25ms保持，修正与现实现不一致的“一轮”和mock通知注释。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 正式配置与当前schema的内存编译 | 公共合同5根/199源/10输出，Rental34根/580源/68输出，shared122根/340源/245输出，完整API988根/2274源/1976输出，均0诊断。共十项配置通过，当前238模型仍由锁定Prisma5.22官方WASM/generator在内存供给 |
| 原履约/收据直接消费者 | `node --no-compilation-cache - api-actions tests/rental-service-execution.test.cjs` 退出0，原17项全部通过，stderr为空；原同键事务窗口、丢响应、后继状态、当前范围、原段/篡改/unknown和客户端操作定位断言保持 |
| 未覆盖错误与事务边界 | 短stdin使用本版实际JS与原runtime错误类，7项通过、退出0。P2002读取原赢家并核指纹，异输入不回放；P2034最多4次事务尝试且保留原键，已提交赢家不二次执行；未分类unknown保留原错误并只尝试一次；现有事务无嵌套提交，收据失败抛给原调用者；缺Tenant拒绝。存储/事务是明确fixture |

实际包出口、源码职责头、Rental/原业务导读和根README同片维护。7份定向文档872个本地链接/198个锚点/76个表格核对通过，0个问题，未检出目标以固定Git定位。当前两份旧企业组合用例有自己的离线preload/写入围栏及封闭源码加载器，本片没有运行或冒称其通过；完整企业/AI及历史消费者仍按最终功能对照核收。原需求/任务及进度保持，完整Rental初始化/配置/事实仓储、数据/迁移/Seed、页面/作业/AI标准装配及公共组织/订阅/集成继续交付，未跨下一档。

本片没有新增测试脚本、依赖环境、临时文件或后台业务服务，全部编译/直接检查产物留内存。真实MySQL/HTTP/浏览器、干净标准包安装、独立更新/回退、独立接手及独立审查仍未验。旧统一临时环境删除仍由[快照阶段](#core-rental-recovery-receipts-20261116)的责任清单和审批拒绝处理，旧外观静态失败及历史附件缺失保留。下一入口为持久配置/事实仓储及完整业务装配，继续同步简明接入资料。

<a id="core-rental-recovery-receipts-20261116"></a>

## Rental 恢复快照与原操作收据迁移（2026-11-16）

固定父版 `5a11747214560c0b52368bdd112cf4bcc1dfbf95` 已普通推送并真实远端回读，当天实际 main 为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`，已在任务分支祖先。本片承接父版后的快照/幂等仓储差异，旧原文直接由固定 Git 保存，原 API 保留窄 Nest provider 和正式再导出。

Rental 包实际持有 `/mysql-state` 和 `/mysql-idempotency` 的唯一实现。私有 MySQL 适配使用可选 `@prisma/client` peer 的原 SQL/JSON runtime，不加载生成模型或实例化客户端；公开平台/Core合同和 Rental 领域根出口不加载它。宿主供给本表存储、真实范围解析、当前品类锁、原事件捕获与同一数据库事务。[快照实现](../../../packages/rental-core/src/mysql-state.ts) · [快照端口](../../../packages/rental-core/src/state-storage.ts) · [收据实现](../../../packages/rental-core/src/mysql-idempotency.ts) · [收据端口](../../../packages/rental-core/src/idempotency-storage.ts)

快照保留初建修订1、不变不写、变更CAS、影响行数及修订上限检查，已持久档案沿原配置仓储保留。锁前分离快照载荷，等待锁时缓存变化不能改写本次输入；业务事务调用者仍拥有提交/回滚，原事件捕获沿同一事务。收据按租户/空间/动作/原键定位，写入必须使用业务事务，同键异输入拒绝，缺安全保留依据时不按年龄删除。恢复副本不替代正式业务事实、原授权或重放依据。[原快照适配](../../../apps/api/src/modules/rental-core/rental-state.repository.ts) · [原收据适配](../../../apps/api/src/modules/rental-core/rental-idempotency.repository.ts)

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 固定父版方法正文对照 | 快照8个、收据4个方法/函数的编译后正文一致，仅更换存储、范围、品类锁、事件接点及原SQL runtime别名；Git换行差异按JS模板实际换行语义核对 |
| 真实tsconfig与当前schema的内存编译 | 公共合同5根/199源/10输出，Rental31根/577源/62输出，shared122根/340源/245输出，完整API988根/2271源/1976输出，均0诊断；Core/公共宿主、工单及MCP声明闭包共十项配置通过，当前238模型由锁定Prisma5.22官方WASM/generator在内存供给 |
| 快照与收据直接边界 | `node --no-compilation-cache -` 退出0；快照14个边界通过，覆盖初建/不变/递增、非法修订/结构/变更依据、跨租户/重复行、修订上限、影响行数错误、载荷分离、调用方事务及事件失败。收据两空间同键各自独立、跨租户不命中、原事务写入、异输入冲突及按年龄删除拒绝通过。SQL/存储/回滚为明确fixture |
| 原采用上下文与初始化刷新 | 原 `category-adoption-context-refresh.test.cjs` 的7例pass/0 fail/skip/todo/cancelled；`rental-business-initialization-refresh.test.cjs` 原断言通过，覆盖提交后重读、冻结旧上下文、当前地点投影、权威缺规则拒绝及排队保存的空间身份 |
| 原实际服务履约/收据消费者 | `node --no-compilation-cache - api-snapshot tests/rental-service-execution.test.cjs` 最终退出0，原17项全部通过，stderr为空。覆盖分次履约、退款审核/原金额、事务窗口回滚、丢响应/后继状态/关单后的原段收据、unknown/篡改不重做、当前范围及客户端原操作定位 |

首次完整类型检查定位原事件捕获会返回结果集合，新接点却要求void；仓储只等待完成，改为不解释返回值的 `PromiseLike<unknown>`。原消费者首次被离线Prisma fixture缺事务隔离枚举阻止，按当前schema的官方生成声明补齐后，上下文与初始化用例通过。履约收据夹具随后缺原Tenant共享父锁查询，使用固定父版两仓储复现相同失败；仅补真实查询与参数断言，原业务/收据/撤权/回滚断言均保留后17项通过。没有增加测试脚本或改产品授权。一次性直接检查因REPL不允许字符串代码生成而未执行，转为标准输入实际完成。

源码职责头、Rental包/原业务导读和根入口同片维护，包出口与lock一致。7份定向文档858个本地链接/196个锚点/75个表格核对通过，0个问题；未检出链接以固定Git核定，不能当成当前运行文件。原 `node scripts/validate-docs.cjs` 退出1，17项中14项是稀疏未检出目标，固定Git定位后仅剩总导航第54行三份既有历史附件缺失；检查器及引用未改。`git diff --check` 退出0。原需求/任务正文及进度保持，完整Rental注册/授权映射、持久业务与配置、数据/迁移/Seed、页面/作业/AI及公共组织/订阅/集成仍未交付，不以本片方法数或局部用例升档。固定提交和普通推送由包含本节的提交定位，远端回读结果留本对话。

本片所有新验证均在stdin/内存完成，无新依赖环境、临时文件或后台业务服务。2026-11-16再次核定旧统一待清理环境的绝对路径、840文件/91,808,304字节、无链接及无使用进程后，原生PowerShell删除仍在启动前被自动审批以 `blocked by policy` 拒绝；原责任manifest更新最近尝试，环境仍在原归集目录。真实数据库/HTTP/浏览器、干净标准包安装、独立更新/回退、独立接手和审查继续待验；旧外观静态失败及历史附件缺失沿原摘要保留。下一入口为原业务动作事务执行器和持久配置/事实仓储，同时补完整公共能力。

<a id="core-rental-workspace-capability-20261116"></a>

## Rental 空间能力服务与实例仓储迁移（2026-11-16）

固定父版 `139432c3d3c3722704c69dfa0fc99e299630b6d8` 已普通推送并真实远端回读，远端main仍为62ca且已包含在本树。本片将原空间能力服务及实例/生命周期审计仓储实际移入Rental包，API的Nest provider供给原数据源、Auth/ALS空间解析、品类绑定锁和调用方事务。[服务](../../../packages/rental-core/src/workspace-capabilities.ts) · [仓储](../../../packages/rental-core/src/workspace-capability-repository.ts) · [原适配](../../../apps/api/src/modules/rental-core/workspace-capability.repository.ts)

服务只消费10个明确仓储方法，事务作为原调用方上下文转交。18个服务方法的可执行正文对照父版一致。仓储11个方法中，当前空间、范围和运行模式3项读取改由原宿主查询接点供给，其余实例/审计、配置/修订、初始化、重试和行投影正文一致。当前范围和绑定仍从原服务端来源读取。[服务端口](../../../packages/rental-core/src/workspace-capability-port.ts) · [存储视图](../../../packages/rental-core/src/workspace-capability-storage.ts)

Rental27根/572源/54输出，公共合同5根/199源/10输出，shared122根/340源/245输出及完整API988根/2267源/1976输出均0诊断，其他Core/公共宿主和MCP声明闭包同步通过。共十项真实tsconfig在内存编译，当前238模型仍由官方Prisma 5.22声明供给，产物全部留内存。

`node --no-compilation-cache - api ...` 使用本版编译JS执行原空间能力、品类能力写入、预备配置、采用能力writer和Hook执行器五份用例，最终全部通过，stderr为空，进程退出0。覆盖启用/暂停/停用、未实现及无默认配置拒绝、基础能力与扩展分离、配置/实现版本、修订冲突、重复初始化、原事务审计、快照冻结和缺执行版本拒绝。首次写入用例将原Tenant父锁和空间锁统一记为同一个标签而失败，夹具分别核验真实父锁参数后恢复原空间锁断言，原断言保持。另有本版16个专业属性边界通过。

空间能力和仓储的正式子出口、原业务入口与Rental模块导读同片更新。6份定向文档753个本地链接/178个锚点检查退出0，正式需求/任务保持，`git diff --check`退出0。没有新增测试脚本、依赖环境或后台业务服务。SQL/事务与存储仍为明确fixture，真实MySQL、HTTP、浏览器、标准包安装和独立更新待验。完整Rental业务/数据/页面/作业/AI及公共组织/订阅/集成继续交付，原任务未跨下一档，旧外观/历史附件和统一待清理问题继续沿当前摘要处理。下一入口为租赁持久业务与初始化/配置提交接点。

<a id="core-rental-category-runtime-20261116"></a>

## Rental 品类解析、身份投影与专业属性规则（2026-11-16）

固定父版 `eb8d8ff6514df26f516939184d78f73e21d5fb50` 已普通推送并真实远端回读。本片从该独占树继续迁移原品类解析、身份及扩展一致性实现，存储读取沿原数据源及调用方事务。API原路径保留Nest provider和正式转接，原开通/采用政策及历史引用保持。[Rental 包](../../../packages/rental-core/README.md) · [原业务入口](../../../apps/api/src/modules/rental-core/README.md)

`/category-runtime` 提供已发布正文、原版本、推荐版本、当前绑定和开通选项解析，`/category-identity` 提供四个旧别名及已发布名称投影，`/extensions` 提供原能力与计费策略门禁。空间默认展示名称移入Rental根出口，shared再导出同一常量。6个解析/读取方法、6个身份方法和2个扩展方法的可执行正文逐项对照父版一致，原SQL查询及字段投影保持。[解析](../../../packages/rental-core/src/category-runtime.ts) · [只读端口](../../../packages/rental-core/src/category-storage.ts) · [身份](../../../packages/rental-core/src/category-identity.ts)

首次独立类型检查定位展示常量及开通类型来自不同旧出口，按真实所有者转接到同包。身份读取恢复原JSON值投影。完整API随后定位事务端口多要求未使用的目录方法，收窄到各调用实际需要的读取项。开通查询使用封闭对象类型，使原Prisma条件类型保留`include`关系结果，源中说明原因。修正后公共合同5根/199源/10输出、Rental23根/568源/46输出、shared122根/340源/245输出、MCP59根/469源/118输出及完整API988根/2263源/1976输出均0诊断。共十项真实配置在内存编译，当前238模型仍由官方Prisma 5.22声明供给。

原行为复验首次为23例18通过/5失败，并出现原型夹具私有缓存未初始化、历史检查缺冻结依据和Core两处品类编码分支的异步失败。在固定父版替换原解析/身份/扩展实现后复现相同结果，确认既有夹具与源码问题。原夹具补齐实例构造、当前绑定快照、档案修订读锁、默认空间读取和原检查快照，原断言保留。原扩展检查定位改为真实合同和已移动执行器源码，继续检查原四条通用流程。

露营容量和工程载荷校验从通用商品保存移入Rental的显式专业规则登记，调用位置及原条件/异常保持。16个正常/拒绝边界通过，原扩展扫描确认通用流程无品类编码硬分支。[专业属性规则](../../../packages/rental-core/src/item-group-validation.ts)

最终 `node --no-compilation-cache - api ...` 执行本版实际编译JS，23 pass/0 fail/skip/todo/cancelled，原品类解析及扩展一致性独立用例全部通过，stderr为空，进程退出0。覆盖当前绑定/历史版本、非法正文、动态身份、开通推荐与试点筛选、跨租户、冻结检查、初始化事务与提交后缓存、缺依赖及原能力版本门禁。SQL/存储仍为明确fixture，原Prisma实例化、网络、环境文件和磁盘写入均受本次验证拒绝。

7份定向文档830个本地链接/194个锚点检查退出0，正式需求/任务原文保持。`git diff --check`首次定位原混合换行源码中新加两行的CR字符，按原行级范围修正后退出0。

本片没有新增测试脚本或临时环境，源码/SDK出口和模块导读同片维护。Rental完整业务/数据/页面/作业/AI标准装配、公共组织/订阅/集成及真实安装/运行/更新回退仍缺，原PCH任务未跨下一档。旧外观静态失败、历史附件及原统一待清理环境继续沿当前摘要处理。下一入口为当前空间能力服务及持久业务接点。

<a id="core-rental-capability-runtime-20261116"></a>

## Rental 能力执行、条件依据与审计端口迁移（2026-11-16）

固定父版本 `a540c4d322863fb90c4d2acbb452b6d4a9432964` 已在任务远端。当天实际回读 main 为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`，任务分支已包含该基线，工作树及暂存区归属核对完成。本片承接父版尚未提交的执行器工作，源码旧原文由固定 Git 保存。

Rental 包实际承接能力执行器、条件快照、品类治理合同与审计仓储。实例读取和审计写入分别通过窄端口供给，`evaluate` 转交原调用方事务。原 API 的 Nest provider 从原服务和同一数据源提供实例读取及本表读写方法，AppModule 继续只登记一个执行者。内置组合移入 `/capabilities`，显式登记 5 个模块及摄影旧交接版本，共 6 个执行版本。[Rental 导读](../../../packages/rental-core/README.md) · [原业务消费者](../../../apps/api/src/modules/rental-core/README.md)

原请求指纹移入公共正式子出口，API 原路径转接同一函数。指纹、品类治理合同和条件规则除导入外逐项 AST 对照一致，执行器 14 个方法及审计仓储 3 个方法的可执行逻辑与父版一致。审计类原注释将全部写入描述为事务内写入，已按实际 `recordOutcome` 与 `recordRejection` 两条路径修正说明。[公共指纹](../../../packages/platform-contracts/src/request-fingerprint.ts) · [审计源码](../../../packages/rental-core/src/capability-audit.ts)

| 必要验证 | 实际结果 |
| --- | --- |
| 正式 tsconfig 与本版 JS/声明的内存编译 | TS 5.9.3 下，公共合同 5 根/199 源/10 输出，Rental 17 根/562 源/34 输出，shared 122 根/339 源/245 输出，均 0 诊断。Core 合同/宿主、公共服务/宿主、工单及 MCP 声明闭包一并通过 |
| 当前 schema 与完整 API | 锁定 Prisma 5.22 官方 WASM 校验当前 238 个模型，官方 generator 在内存生成声明。完整原 API 988 根/2257 源/1976 输出，0 诊断，全部输出留内存 |
| 原执行器和条件用例 | `node --no-compilation-cache -` 在内存提供本版实际编译 JS，执行原两份用例原文。能力执行器全部原断言通过，条件套件 10 pass/0 fail/skip/todo/cancelled，覆盖历史版本、缺实例/实现拒绝、条件真/假/缺证据、冻结商品与报价提交点复验 |
| 审计与内置登记 | 本版实际仓储与父版编译仓储的三种读写行为一致，放行仅使用调用方事务，拒绝追加和历史读取保持原数据源及字段投影。事务 writer 失败向原调用者抛出，6 个内置版本登记通过，重复登记拒绝 |

内存编译首次缺根依赖目录映射和 shared composite 配置，修正验证宿主后完成上述真实配置检查。官方声明首次超出 stdout 缓冲，改为内存压缩传输。原用例装配首次受字符串替换及 Prisma 测试命名空间缺项阻止，修正传输并从当前官方 schema/原 runtime 供给枚举、Decimal 与 SQL 类型后通过，原测试和断言原文保留。最后宿主窄端口复验触及工具时间上限并重置内存会话，改用可观察的 stdin Node 进程后，十项配置及两份原用例均退出0。Prisma 实例化、网络、环境文件读取及磁盘写入由本次行为验证拒绝，存储/事务仍为明确 fixture。

完整 API 检查同时定位 MCP 的 Node10 声明入口缺失，100 处原 API 消费为类型导入。补齐与原 `exports` 对应的 `typesVersions` 和根声明，MCP 59 根/468 源/118 输出及完整 API 通过，原运行时出口沿用同一构建文件。公共/Rental/MCP 模块导读、原业务入口与根 README 同片更新。

9份定向文档的1117个本地链接/243个锚点完成检查，新问题0，正式需求/任务原文与锁文件一致。完整定向检查退出1，MCP原导读仍有5个父版已存在的缺失附件，位于 `output/mcp-isolated-mysql-ypJWY6/receipt.json`、`mcp-isolated-mysql-gOX5jK/receipt.json`、`mcp-isolated-mysql-6eTqCq/receipt.json`、`mcp-isolated-mysql-G1SlwT/receipt.json` 及其 `store-build/scope.json`，材料去向由原MCP记录核明。本树直接运行 `node scripts/validate-docs.cjs` 退出1，17个问题中14个为稀疏未检出目标，按固定Git定位后剩总导航3份既有历史附件缺失。原检查器、引用和失败保持，`git diff --check` 退出0。

2026-11-16 再次核定旧临时环境的绝对路径、归属、840 文件/91,808,304 字节及无链接/任务进程后，用原生 PowerShell 删除仍在启动前被自动审批拒绝，原因 `blocked by policy`。原统一待清理 manifest 更新最近尝试，环境仍在原归集位置。本次其余验证均在 stdin/内存完成。

本片沿原 G1～G4 复核任务，Rental 完整注册/授权映射、持久业务/数据/页面/作业/AI装配与兼容更新仍缺，任务尚未跨下一档。真实标准包安装、HTTP/DB/浏览器、迁移、独立更新/回退、独立接手和审查继续待验。下一入口为 Rental 品类解析/当前实例与持久业务的正式接点，同时补完整公共组织/订阅/集成。旧外观静态用例失败及总导航三份历史附件保持原归属。

<a id="core-rental-capability-modules-20261115"></a>

## Rental 品类能力实现迁入独立包（2026-11-15）

父版本 `578185f199e3c9a777a11b45662005451726b867` 已普通推送并真实远端回读，main仍为62ca。[Rental包](../../../packages/rental-core/README.md)承接5个真实能力工厂/判定实现，旧 `capabilities/*` 路径转接各自正式子出口。模块只依赖本包领域合同，通用套装继续复用同包摄影旧实现；5份源码逐文对照父版，仅改变合同导入，没有调整算法、门槛、版本或兼容分支。

原[能力登记器](../../../apps/api/src/modules/rental-core/capability-hook.registrar.ts)继续单次登记摄影兼容、摄影当前/旧交接、通用套装及露营清点/清洁，不增加隐式自注册或第二执行者。原Hook执行器仍核空间实例、当前必需能力和历史版本，原仓储/同事务审计继续存在；本片没有把缺执行器/缺实例默认成允许。

必要验证按真实tsconfig和本版声明在内存顺序构建platform-contracts/rental-core/shared：4根/198源/8输出、12根/556源/24输出和122根/338源/244输出，均0诊断。原计价/器材与摄影兼容、摄影套装交接、露营清点清洁五份用例原文直接作用于本版编译JS，全部原断言通过。覆盖兼容/警告/阻止、明确确认和证据、旧快照兼容、非套装放行、免检阻止、缺件与清洁异常；不等同原执行器真实数据库/事务或整项品类验收。当前238模型schema官方内存声明支持的全原API988根/2261源0诊断，67项根合同运行时导出和shared同一对象对照保持通过。

15份定向文档964个本地链接/214个锚点及原需求/任务未改检查退出0，`git diff --check`退出0。没有新增测试脚本、临时环境、依赖安装或后台服务。下一入口继续Rental执行器/仓储的正式端口和持久化归属，并补完整公共能力；完整Core标准装配、授权映射、各端、AI/作业、数据/迁移和真实更新回退仍缺，原任务未跨档。旧失败与统一待清理项继续开放。

<a id="core-rental-pricing-equipment-20261115"></a>

## Rental 计价与器材运行时单源迁移（2026-11-15）

父版本 `91b5e1f3baafece4acc1611ad999d465de655b35` 已普通推送并真实远端回读。[原计价策略](../../../packages/rental-core/src/pricing.ts)和[原器材富化](../../../packages/rental-core/src/equipment.ts)实际移入Rental包，旧API路径仅转接正式 `/pricing`、`/equipment`。只把原shared和营业日依赖改为本包相对单源；没有重算金额、调整单位/时区/历史版本、改品类行为或加入新的缺数据兜底。

两服务端子出口使用可选 `@nestjs/common` peer保留原BadRequest/Conflict错误类型；根合同和营业日出口不加载Nest。源码构建需该peer，宿主兼容版本与lock已登记，包不增加Prisma/平台业务服务依赖。器材投影保留执行版本声明字段、原属性副本与缺商品明确拒绝。

按真实tsconfig和正式已生成声明顺序，在内存构建platform-contracts/rental-core/shared，分别4根/198源/8输出、7根/551源/14输出及122根/338源/244输出，均0诊断。随后将原计价策略及器材测试原文作用于本版实际编译JS，全部原断言通过：单位/日界/非法输入/阶梯/封顶、缺商品拒绝、属性副本、资产覆盖与标识保留。测试原ts-node注册代码保持，目标模块由内存本版产物提供；不是磁盘包安装、真实HTTP/DB或完整租赁业务验收。原67项根运行时导出及旧shared同一对象对照仍通过。

当前238模型schema官方内存声明支持的全原API类型988根/2256源0诊断；两份运行时源码除导入/职责头外对照父版一致，lock一致。15份文档954个本地链接/213个锚点及原需求/任务未改检查退出0，`git diff --check`退出0。无新测试脚本、依赖安装、临时目录或后台服务。完整Rental数据/持久服务/页面/作业/AI/授权装配和公共能力仍未完，原任务未跨档；后续继续真实服务适配与原权限/事务兼容，原失败、真实验收和统一待清理项保持开放。

<a id="core-rental-domain-package-20261115"></a>

## Rental 领域合同与营业日实际迁入独立包（2026-11-15）

父版本 `aa1c370b03ce40f9b6e0801c3b3fe7ad17e1091f` 已普通推送并真实远端回读，main仍为62ca。[Rental独立包](../../../packages/rental-core/README.md)实际承接原shared领域合同、品类标识与API营业日源码，旧路径保留窄正式转接，不复制维护第二份实现。公共底座不依赖本包；新包只依赖正式公共合同，没有shared、Nest、Prisma或AI依赖。shared/API登记真实依赖、构建顺序和锁文件，使用新包JS/声明。

原合同有两处内联类型引用企业预约依据，最初只查顶层import遗漏，类型检查直接拒绝。按实际闭包将原告知确认/预约冻结类型及审批模式单源移入新包，企业政策再引用/导出；没有把整套企业工作流拉入租赁根出口，也没有复制结构或变更字段语义。营业日的时区、日界、营业时段及历史说明原文保留，只改类型导入；品类格式不作为注册/采用依据。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| 实际tsconfig与正式产物依赖的内存构建 | platform-contracts 4根/198源/8输出、rental-core 5根/202源/10输出、shared 122根/338源/244输出，均0诊断。按真实rootDir和声明依赖顺序构建，所有产物仅在内存，无shim、安装或生成物写入 |
| 新包实际JS与父版原合同编译字节执行对照 | 67项运行时导出的键、常量值及函数一致；旧shared/core出口引用与新包严格同一对象，不只是结构类似 |
| TS5.9.3全原后台/API消费者 | 原后台642根/4215源0诊断；当前238模型schema用锁定Prisma5.22 WASM及官方generator在内存生成声明，原API988根/2254源0诊断，无实际Client/环境/数据库连接 |
| 原计价策略、检查资源、用量纠正入口 | 均退出0，保留原断言。计价覆盖单位/边界/非法输入/阶梯价/封顶与计算说明，实际消费新营业日；两份检查静态用例只改合同源码定位，不等同业务运行 |

计价首次执行被仓库既有受控 `packages/shared/src/core.js` 优先遮住当前TS源码，导致品类pattern未取到；没有改断言、预载成功常量或删除历史文件，将原ts-node源码测试明确 `preferTsExts: true` 后通过。同名JS/映射在父版Git可定位，完整源码/构建产物所有权清理仍需PCH-01最终对照，不把这些历史文件假称本轮新增垃圾。另三份原企业用例的源码加载器只登记新单源路径，未更改测试、断言、权限或离线围栏；未执行这些需要各自原离线环境的整套用例。

类型验证第一次展开shared composite工程源码时产生验证配置/rootDir诊断，修正内存检查配置后通过；正式包真实配置另由上表独立验证，没有放宽产品配置。三份迁移源码除声明的导入外逐文对照一致，六份既有测试2792处测试/断言调用原文保留，锁文件一致。15份定向文档948个本地链接/212个锚点及原需求/任务未改核对通过，退出0；`git diff --check`退出0。所有新增验证经stdin/内存执行，没有新建测试脚本、临时环境或后台进程。

完整Rental服务/Controller、schema/迁移/Seed、页面/客户端、作业/AI及标准Core清单/授权适配尚未迁完，本包目前不是可完整安装的Rental交付。下一入口继续其运行时和持久化/权限兼容，同时补完整公共能力；原任务计分未跨档，真实环境与原独立验收仍开放。

<a id="core-public-self-security-20261115"></a>

## 公共本人安全入口与强制改密共用（2026-11-15）

父版本 `9821c1bbce696801b6ce5b3f6272ae84e1073ff7` 已普通推送并真实远端回读。公共[应用](../../../packages/platform-admin/src/application.tsx)增加无需Core或管理角色的本人安全路由，仍由受保护布局校验会话；[原改密表单](../../../packages/platform-admin/src/session-pages.tsx)增加嵌入形式，强制首次改密保留原完整面板和验证规则。两者共用原 `session.changePassword`，不新增密码保存或认证执行者。

按钮/回车保留同一Promise，HTTP只发当前/新密码，不发送确认字段；密码草稿和提交中复用原离开保护，成功清空表单，失败保留输入。会话撤销/轮换、当前身份和缓存代次沿原认证客户端处理，不写密码缓存或存储。

必要验证使用TS5.9.3 compiler API/noEmit：公共包235根/2495源、零Core Web5根/2496源及工单Web3根/2500源均0诊断。实际改密组件配明确Hook/UI/callback fixture核实同一Promise、字段投影、草稿/提交保护、成功清空、失败保留与强制/嵌入两形式，退出0；antd 6.6.0 lint退出0、0问题。未连接真实HTTP/DB或浏览器，不把表单验证当密码轮换验收。没有新增测试脚本、临时环境或后台进程。

零Core Vite内存构建4产物/2319模块/6,811,907字节，无原业务后台/shared行业源码；13份定向文档910个本地链接/209个锚点、锁文件和需求/任务未改核对通过，退出0，`git diff --check`退出0。下一入口为完整公共组织/订阅/基础集成及Rental独立包；本片未跨原任务门槛，真实运行、更新回退、旧失败及统一待清理责任继续开放。

<a id="core-public-access-actions-20261115"></a>

## 公共成员口令恢复与普通角色删除（2026-11-15）

固定父版本 `60e2e6b2621f72b46841ee21a8c6e38794a0f972` 已普通推送并真实远端回读。公共[管理页面](../../../packages/platform-admin/src/features/access/PublicManagementPages.tsx)与[路由](../../../packages/platform-admin/src/application.tsx)接原成员重置/角色删除接口，服务端原事务/审计和权限政策不变。目录对象之外、当前本人、非租户管理员操作管理员账号及固定/通配角色拒绝；已分配普通角色仍由服务端当前关联核定。

原ConfirmAction返回实际命令Promise，同步双触发只发一次；失败锁住再次确认，必须明确重读当前目录。重置失应答后的新重置会替换此前口令，页面明确说明，不自动重放或假造旧密码。成功结果与目录刷新独立，刷新显式throwOnError并单独提示，删除后对象消失不遮住原结果。同步修正创建/编辑结果：一次性口令在QueryState外显示，已保存Form不再连带禁用复制控件，按钮/输入在确认后卸载而非继续可提交。临时口令不写查询缓存、浏览器存储或日志。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| TS5.9.3 compiler API/noEmit | 公共包235根/2495源、零Core Web5根/2496源、工单Web3根/2500源，均0诊断，无生成物写入 |
| 零Core Vite内存构建 | 4产物/2319模块/6,810,948字节，无原业务后台/shared行业源码，未运行正式环境配置或浏览器 |
| 实际组件/回调、权限及原固定角色模型，明确Hook/UI/query/session fixture | 重置同一Promise、原POST/DELETE路径、本人/管理员/未知对象拒绝、固定/通配角色拒绝、失败不自动重发、临时口令不缓存、刷新失败保留已确认结果及删除对象消失仍显示结果通过；租户创建/资料/状态原fixture复验通过。第一次验证在组件求值后才换真实模型，修fixture加载顺序后通过，未改产品判定 |
| antd 6.6.0 lint | 修改页面0问题；没有新增测试脚本、安装依赖、临时目录或后台进程 |

13份定向文档907个本地链接/208个锚点、锁文件及原需求/任务未改核对通过，退出0；`git diff --check`退出0。真实浏览器/HTTP/数据库和完整公共安全功能仍未验，原任务未跨档。下一入口为本人安全入口与公共组织/订阅/集成，随后继续Rental可独立包及真实更新/恢复验收。旧失败与统一待清理责任保持开放。

<a id="core-public-tenant-pages-20261115"></a>

## SaaS 无 Core 租户管理页面（2026-11-15）

父版本 `f59449e5c3cbd361ebe2e353bda3526854d03851` 已普通推送并真实远端回读，main仍为62ca。[公共管理页面](../../../packages/platform-admin/src/features/access/PublicManagementPages.tsx)与[应用路由](../../../packages/platform-admin/src/application.tsx)增加租户目录、创建、资料及状态四条路由，共用已有目录/表单保存链。原Rental含品类/空间的租户入口原位保留，不以公共创建替代原业务初始化。

SaaS租户管理权控制目录、资料和状态；新增入口与直接URL另核初始化权，其他audience不会挂载目录查询。公共创建只发送租户与管理员资料，返回临时密码只在当前结果显示/复制，不写缓存。详情明确只发名称/简称；状态单独PUT并要求本次原因，冻结/停用/恢复沿原公共服务与同事务审计/会话处理，不授予或恢复已停用Core。公共人员/角色页面继续消费同一编辑器。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| TS5.9.3 compiler API/noEmit | 公共包235根/2495源、零Core Web5根/2496源、工单Web3根/2500源，均0诊断。只读依赖与源码出口映射在内存，不写生成物 |
| 零Core Vite内存构建 | 4产物/2319模块/6,804,340字节，无原业务后台/shared行业源码，未运行实际Vite配置或浏览器 |
| 实际租户组件/编辑器与权限函数，明确Hook/UI/query/session fixture | SaaS/租户audience区分、初始化权单独核验；创建无业务字段、按钮双触发同一请求、详情仅允许字段、状态原路径/新原因、未知失败禁自动重发和当前页口令通过。初次fixture遍历未读取Alert.description，修验证visitor后通过；不是真实React/HTTP/DB |
| antd 6.6.0 info/demo/lint | 按实际Form/Select属性编写，修改页面lint 0问题；无依赖安装升级 |

13份定向文档904个本地链接/207个锚点、锁文件及原需求/任务未改核对通过，退出0；`git diff --check`退出0。源码与模块说明同步，没有新增测试脚本、临时文件或后台进程。完整公共组织/安全/订阅/集成及Rental独立包仍缺，本片不提升原任务计分。下一入口为账号重置口令/普通角色删除，再继续完整公共能力和业务包。真实环境、原独立验收及旧失败/待清理项仍开放。

<a id="core-public-access-pages-20261115"></a>

## 公共人员/角色页面及原权限组件共用（2026-11-15）

固定父版本 `bbf08040821d2eb88fdf2b118c0f08e1638ab01c` 已推送并真实远端回读，main仍为62ca。本片在[公共应用](../../../packages/platform-admin/src/application.tsx)接入人员/角色目录、新建与详情六条路由；菜单和直接地址使用当前服务端身份、tenant audience及原管理权限。没有Core也能维护公共成员和角色，角色权限与Core使用权仍分别配置。

[页面实现](../../../packages/platform-admin/src/features/access/PublicManagementPages.tsx)消费原公共HTTP合同、完整授权目录、列表过滤及表单同步；保留角色scope/业务范围/按钮权限、人员组织/角色/管理员标记，普通新角色不默认Rental范围。固定管理员角色只读，管理员账号仅租户管理员可编辑，当前本人不能停用；角色选择另核角色管理权。按钮/回车共用Promise，草稿和进行中操作受原离开保护，失败须明确重读核对。已记录后目录刷新失败单独提示，不把成功当unknown。创建临时口令只在当前保存结果显示/复制，不进入查询缓存或存储。

原[权限编辑器与草稿模型](../../../packages/platform-admin/src/access.ts)实际迁入公共包，旧后台保留窄出口和原业务页面；原CSS/公开渲染来源/类名映射保持单源，[来源原文](../../../packages/platform-admin/src/features/access/roles-source/SOURCE.md)及CSS摘要保留。原历史来源入口保留短跳转，父版原文在Git。原Checkbox尊重父Form的禁用状态，固定角色及保存中不能通过权限勾选修改；原Rental字典不改，公共包复用实际所需44项原翻译。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| TS5.9.3 compiler API/noEmit，源码出口与只读现有依赖映射在内存 | 公共前端235根/2495源、原后台642根/4211源、工单Web3根/2500源，均0诊断。未写dist/Client或安装依赖 |
| 零Core/工单Vite内存构建 | 各4产物、2319/2321模块，均无原apps/admin或shared行业源码；工单清单仍是明确fixture，不代表正式包安装/构建配置门禁或浏览器验收 |
| 原admin-permission-matrix测试 | 原7例全过，0失败/跳过/todo/cancelled；仅更新真实源码及mock依赖位置，归一对照原测试/断言不变。初次只读依赖解析失败，修验证路径后通过 |
| 实际页面/保存回调，明确Hook/UI/query/session fixture | 防重复提交、失败禁重发、已记录后刷新失败、角色隐藏字段保留、固定角色只读和临时口令当前页面显示通过；不是真实React浏览器、HTTP、事务或数据库验收 |
| antd 6.6.0 lint与原组件来源核对 | 编辑页/权限编辑器0问题；UIArc审计123条、99个UI出口、badHashes为0；迁移的来源/类名/CSS对照父版一致，仅Git换行差异 |

13份定向文档901个本地链接/206个锚点、锁文件及原需求/任务未改核对通过，退出0；`git diff --check`退出0。没有新增测试脚本、临时环境或后台进程。任务门槛复核未跨档，完整公共组织/安全/订阅/集成、Rental包与真实运行/更新回退仍缺，不提升原任务计分。下一入口为SaaS租户创建/编辑/启停及账号恢复；旧失败和统一待清理责任继续保留。

<a id="core-permission-registration-20261115"></a>

## 所选 Core 权限的显式部署登记（2026-11-15）

固定父版本 `3fdba3176c19a610ea75d29951c35b606e6e3687` 已推送并真实远端回读，主线仍为62ca。本片补齐原普通角色接口缺少Core权限目录的实际接点；公共API只接受已登记精确权限，不能用页面声明或管理员通配符替代普通成员角色配置。

[正式登记函数](../../../packages/platform-core-host/src/platform-core-permissions.ts)接受所选Core唯一清单和窄Permission事务，先核清单/重复Core及全部现存码的归属与类型，再登记带Core命名空间的ACTION元数据。重复执行保留原ID/RolePermission，名称可随兼容版本更新，其他Core和不再声明的历史权限保留。冲突先拒绝，函数不创建角色、分配Core或改成员授权。宿主须在Serializable事务调用，数据库失败沿原事务回滚，不自动重试。

[工单部署命令](../../../apps/example-tickets-api/src/register-permissions.ts)从显式进程配置取得同一锁/包，先核ID/版本/来源/摘要，再建立独立公共Client登记六项权限，退出始终断开。不加载.env，不启动HTTP或执行DDL；只在部署人员明确运行时写目录。实际命令和预期结果补入[宿主说明](../../../apps/example-tickets-api/README.md)，Core作者维护清单即可，不复制Seed。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| TS5.9.3 compiler API/noEmit；本机Prisma5.22 WASM与官方generator在内存生成当前公共schema声明 | 公共Core宿主22根/882源0诊断，完整工单API6根/908源0诊断，窄新命令890源0诊断。源码依赖映射在内存展开，验证rootDir设仓库根；初次沿单包rootDir产生跨包路径诊断，修验证配置后通过。未改实际构建配置、写Client或安装依赖 |
| 实际清单→权限登记函数，显式存储fixture | 六声明登记；重复保留ID/更新名称；其他Core/历史保留；空Core无写；重复/无效清单、原归属或BUTTON类型冲突在修改前拒绝。无实际DB或角色授予 |
| 实际部署CLI与实际登记函数，显式包/文件/事务fixture | 包拒绝发生在创建Client前；一次Serializable事务登记六项；模拟第二条失败整笔不提交，成功/失败均断开Client；失败只输出稳定码，不泄漏驱动消息。不是MySQL事务或实际标准包安装验收 |

10份定向文档829链接/166锚点、锁文件及需求/任务未改核对通过，差异格式检查退出0。没有新增测试脚本、临时目录或后台进程；未运行会连接数据库的正式登记命令。下一入口为公共人员/角色编辑UI及完整公共服务，后续仍须Rental独立包、真实安装/运行、隔离/恢复、更新回退与独立接手。原PCH进度保留，旧失败和待清理责任不由本片关闭。

<a id="core-access-directory-ui-20261115"></a>

## 公共后台租户 Core 授权与成员目录接线（2026-11-15）

父版本 `8cdb4b397296b088ed270e6a09f707c915732b67` 已普通推送，实际远端同版；main仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。本片在同一独占树将既有授权面板接到[公共应用](../../../packages/platform-admin/src/application.tsx)，未改原业务授权政策。

[Core管理页面](../../../packages/platform-admin/src/CoreAccessPage.tsx)分别提供 SaaS“租户 Core 授权”和租户“成员 Core 分配”。前者从公共租户目录及受控注册目录选择，后者从本租户真实成员及当前服务端assignable选择；管理者未分配给自己时仍可管理其他成员。地址参数只定位这些已读对象，目录之外的对象不挂载授权命令；查询失败关闭操作。菜单和直接URL共用[当前身份口径](../../../packages/platform-admin/src/application-access.ts)，非管理者/错误audience/本人范围不发起管理查询。

授权变更继续复用原面板、修订、同键收据和unknown只读核对，增加原离页保护；同一路由切换对象也经Router阻止提交中离开，未知结果的原编号仍存sessionStorage。本人分配变更沿原目录与Core缓存失效；不会自动给其他成员分配或改变角色。首页和默认侧面板分别提示租户未开通、成员未分配及SaaS管理入口，零Core保持准确空态。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| stdin TS5.9.3/noEmit，只读既有依赖 | 公共后台229根/2,488源、原后台642根/4,206源、工单Web3根/2,494源0诊断。初次误引用不存在的CoreSessionSummary类型，已改为正式CoreSessionContext推导，不新增同名私有合同 |
| 实际页面组合、目录queryFn与可见性函数，显式hook/UI/API fixture | SaaS读真实路径tenants及registered；租户读users和assignable，自己无业务分配仍可管理；目录外URL不挂命令；未验证/错误audience/own范围不读目录；服务端canManageMembers=false不查询成员。无React DOM、浏览器或网络 |
| Vite8.2.1/Rolldown + Tailwind内存构建 | 零Core4产物/2,309模块/6,721,805字节；工单4产物/2,311模块/6,786,395字节；均不含原apps/admin或packages/shared。配置/环境关闭、write:false；工单清单明确fixture，非实际包安装/磁盘门禁验收 |
| antd6.6.0 Select API/demo核对及定向lint | Core管理页、原授权面板、公共壳均0问题；首次lint误传两文件，分别运行后退出0。无新测试脚本 |

8份文档777链接/163锚点、锁文件一致性及正式需求/任务未改核对通过。完整人员/角色UI、Core权限登记的部署入口、公共订阅/组织/安全/集成、Rental独立包以及原任务真实环境/更新回退/接手仍待交付；没有将本片当PCH完整主实现或提升原百分比。真实HTTP/数据库授权提交、浏览器搜索/Portal/切换保护和持久化重读均未验。所有验证内存完成，无新增临时目录或进程；本片再次尝试核定原待清理环境归属/范围/链接/进程后用原生PowerShell删除，命令仍在启动前被自动审批拒绝blocked by policy，环境存在性另行只读确认，不称已删除。旧外观断言失败继续保留。

<a id="core-tickets-admin-host-20261115"></a>

## 工单 Web 声明接入同一公共应用（2026-11-15）

固定父版本 `6df3006cc72d0d8ac34f1a6701f51dd025f694b2` 已普通推送并回读同版，实际远端 main 仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。本片承接本树已明确归属的前端组合修改，未操作其他树或主线索引。

[公共应用](../../../packages/platform-admin/src/application.tsx)实际承接原零Core App及设置页面，提供正式 `/application` 工厂。零Core宿主只提供品牌和唯一会话；[工单Web宿主](../../../apps/example-tickets-admin/README.md)另传通过标准注册的四页贡献。菜单、Data Router直接路由与面包屑消费同一注册表，Core复用原主操作/表单/列表与请求，不修改公共内部路由。工单后台peer和类型入口改为独立公共前端，原Rental后台继续消费原兼容接点。

前后端标准包核验收束为 `/install` 的 `requireCorePackagePin`，核实际包标识、实现版本、固定来源和归档摘要。工单Vite配置要求显式部署锁，并核已准备标准包后才生成前端清单模块；源码工作区没有标准清单时拒绝，不生成假发行或自动授权。后台、Core与宿主导读已同步最小文件、命令和失败入口。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| stdin TypeScript 5.9.3，noEmit、只读现有依赖 | 公共后台227根/2,486源、工单Web 3根/2,492源、Core合同36根/220源、原后台642根/4,205源均0诊断；工单admin 2根/1,376源、零Core Web 5根/2,488源0诊断。服务端核包薄适配及其205源0诊断；初次验证误沿合同rootDir，改内存验证rootDir后通过，未改源码类型规则 |
| Vite8.2.1/Rolldown + Tailwind内存构建 | 零Core 4产物/2,305模块/6,693,455字节；工单4产物/2,307模块/6,760,975字节；均无原apps/admin或packages/shared模块。configFile/envDir/publicDir关闭、write:false；工单virtual清单明确fixture，未执行真实配置的磁盘标准包门禁，不是干净安装证据 |
| 实际工单四页贡献→注册→公共应用路由树→React Router匹配 | 列表、设置、新建和带对象参数的详情直接地址均匹配正确声明；菜单/面包屑同源，缺create权限拒绝该页面，缺成员Core项时业务菜单为空，零Core无业务路由。UI与会话为显式stub，无React渲染、浏览器或HTTP |
| 实际包静态检查、归档及固定包核验 | 显式内存文件系统fixture中，同包接受、错摘要及改代码拒绝，未执行包入口。前后端共用同一方法；当前Core文件已变化，不沿用旧32文件包摘要充当本版发行 |

定向文档核对8份、771链接、163锚点均可在本树或固定Git定位，工作区锁文件与包声明一致，正式需求/任务正文未变，差异格式检查退出0。首次文档核对因Git文件清单超过Node默认buffer失败，提高验证读取上限后通过，未改变检查范围或删引用。

主实现尚缺完整公共管理/授权UI，原Rental独立包、真实干净安装、HTTP/数据库/浏览器、原功能前后对照、独立更新回退和接手仍未验。本片不满足PCH下一档完整范围，原百分比保留。没有新增测试脚本、依赖安装、临时环境或后台服务；原待清理环境及旧外观静态断言失败沿原证据保留。

<a id="core-zero-admin-host-20261115"></a>

## 零 Core Web 宿主与原认证客户端共用（2026-11-15）

公共前端抽取已提交 `cfa7993ea35783716c768e95094d29a9f65006d0`，普通推送后真实远端任务分支同版，工作树当时干净；本片在该父版本继续。main实际远端仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`，未进入其他作者树。

[独立公共Web](../../../apps/platform-admin/README.md)已有实际HTML、启动、路由、公共认证/改密与本人资料/账户主题色/租户名称/品牌名设置，默认不导入任何Core。完整原外壳与公共组件由正式包提供，权限过滤沿原当前主体及公共服务权限口径，普通账号不因此获得管理权。原Rental的HTTP改成窄存储/空间投影适配，同一公共客户端执行刷新锁、请求信封、取消和401清理；原存储key/跨标签锁名称、刷新收据监听与空间投影保留。公共响应信封移至platform-contracts，shared再导出唯一声明。

公共会话仅由原服务端登录、刷新及上下文响应验证；storage变化先失效和清缓存再读服务端，不将缓存当授权。身份/权限变化使旧页面及原请求失效。设置复用原草稿同步/离页保护与SaveButton，按钮/回车共用当前Promise，保留expectedRevision；后台读取不覆盖草稿，重新读取需明确确认，保存结果不明先核原设置。公共设置只覆盖本片有限字段，完整人员/角色、订阅、安全、组织、集成和Core管理UI继续按原任务交付。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| stdin TypeScript compiler API，5.9.3，当前公共合同源码/只读受管依赖，无emit | 公共后台224根/2,483源、零Core Web 6根/2,487源、原后台642根/4,205源均0诊断；公共合同4根/198源0诊断。最终复验零Core Web/原后台仍0诊断，622处本地文档链接可定位，锁文件元数据一致，差异格式通过 |
| 实际公共Web Vite 8.2.1/Rolldown + Tailwind 内存构建 | HTML/JS/CSS共4产物、2,304模块、6,683,479字节，无apps/admin或packages/shared模块；envDir/configFile/publicDir关闭，write:false，无服务/网络/文件产物。依赖/合同源码在验证进程中映射，不是干净安装或真实运行证据 |
| 原 `category-preparation-admin-fields` 中传输段，仍运行原断言 | query/session分别取消、完整返回及settled释放监听器通过。只把源码定位改到公共工厂内原request函数；未删断言、未执行该脚本其他领域场景，不称全脚本通过 |
| 实际Axios拦截器 + 显式内存adapter | 两并发请求仅一次刷新、原回放可返回；等待刷新时取消拒绝回放；500写入仅一次，不清理或自动重做；零网络 |
| 实际公共会话 + Axios显式fixture | 登录/稳定快照/退出中迟到验证拒绝/storage即刻失效再由服务端响应验证通过，退出原刷新会话仅一次；零网络，不是浏览器/真HTTP |
| `antd lint` 登录/改密与公共设置 | 两处均0问题，退出0；原vendor未修改，新增测试脚本0个 |

本片没有安装依赖、加载.env、启服务、连数据库/外部供应商、执行迁移或浏览器验收。真实登录与保存/重启读取、跨租户、完整原功能回归、工单正式前端接线与标准包独立安装均未验，原PCH下一档缺口保留。所有本片验证在内存完成，原840文件/91,808,304字节待清理责任清单继续沿接续§4，不称已删除。

<a id="core-public-admin-boundary-20261115"></a>

## 公共后台源码单源迁移检查点（2026-11-15）

固定父版本为 `c1eeb3b1ffa7b87578742b834976fc0186fc6c5e`，当天实际远端任务分支同版，main `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 已包含；暂存区无其他成果，无合并/挑选状态。本片仍只在负责人授权的独占树施工。

公共呈现实际移入 [platform-admin](../../../packages/platform-admin/README.md)，包含原 UIArc 适配、主题/语言/音效、侧栏/工作区/页头、休息与通知，以及原 Core 页面/表单/列表/授权面板。旧后台路径窄转接同一实现，Auth/HTTP/业务导航及通知详情仍由原宿主提供。公共运行时只消费服务端验证后的会话、唯一请求与查询代次，不读取业务凭据，不提供业务授权。

新 [PlatformShell](../../../packages/platform-admin/src/PlatformShell.tsx) 组合原外壳与正式页面注册表，菜单/面包屑按当前 Core 目录过滤；零 Core 保留公共外壳、铃铛、休息和面板，并提示联系管理员。Core 页面、主操作、原生表单关联和请求围栏使用同一公共适配。这个壳尚未进入独立无 Core Web 宿主；原 Rental 仍消费原 AppShell，不能以公共组件存在宣称独立后台已可运行。

查询缓存沿原时序抽成单一工厂。原 `AdminBusinessUiScope` 补齐当前权限/资料范围/地点范围/组织身份，防止迁移后列表实时状态弱化。原业务语言字典 5,712 项键值逐项相等；公共字典只含公共呈现，允许宿主追加。公共样式和动效构建适配单源，原后台保留 Rental 页面专属样式。34份移动保留源码/来源/许可与固定父版本相等，仅允许 Git 文本换行差异；通知保留源码已恢复原字节，别名适配共用动效 Hook。

| 必要验证 | 实际结果与边界 |
| --- | --- |
| stdin TypeScript compiler API，5.9.3，只读复用已有依赖，虚拟解析，无 emit | 公共后台217根/2,474源、原后台642根/4,200源、Core合同36根/220源均0诊断；同一切片最终复验公共后台和原后台均保持0诊断，未输出编译文件 |
| 实际 `createAdminSessionQueries` 内存编译后执行 | 原请求 signal 中止、新代次与新 signal、旧缓存清除通过；未发 HTTP |
| 实际 Vite 8.2.1/Rolldown + Tailwind 4.3.3，`configFile:false/envDir:false/publicDir:false/write:false` | 公共 JS/CSS组合3产物、2,225模块、7,308,945字节；模块列表无 apps/admin 或 packages/shared。只读依赖路径及合同源码在验证进程内明确映射，未安装或磁盘输出，不是标准包干净安装证据 |
| 初次 Vite 内存构建 | 失败，验证依赖解析缺本树 node_modules、子出口别名前缀以及 CSS 多入口配置；修正仅内存验证配置后通过，源码正常构建仍依赖按锁文件准备的本树依赖 |
| 原组件只读审计，增加公共真实源码入口 | 123条/263唯一来源文件，badHashes=0，99项公共 UI 导出、60条有直接引用；不代表所有引用分支运行通过 |
| `antd lint` 公共 PlatformShell | 0问题，退出0；未改第三方 vendor，未新增测试脚本 |

原公共服务、完整订阅/组织/集成，独立无Core前端宿主、工单前端标准出口/实际宿主、Rental独立包与完整真实功能回归、浏览器/数据库/HTTP、升级回退及独立接手均继续缺失。原外观17例中1个旧静态断言失败继续保留，当前公共前端类型/构建不关闭该问题。605处本地文档链接均可在当前检出或固定Git定位，锁文件工作区元数据与包声明一致，暂存差异格式检查通过。PCH未跨下一原门槛，不调进度。

补记同一固定父版本的工单标准包验证。32文件/46,867字节，SHA-256 `a22f242b7dccb6a43110c64385ba22ad45be8dc3dca6fc2d55698e566c15846d`。实际编译字节、清单/声明/API/指南/迁移及篡改拒绝通过，严格门禁后实际 Nest 组合一个数据库 provider/8工单政策，组合未查询数据库。文件系统明确为内存 fixture；没有真实磁盘安装、HTTP或数据库验收。

本片验证均为 stdin/内存，无依赖环境复制或新测试脚本。原公共宿主临时环境删除仍被自动审批在启动前拒绝，现归集状态和责任清单沿接续§4，未重复创建同类环境；不能称全部临时产物已删除。

## 2. 文档定界与接手准备阶段（2026-10-31）

### 2.1 授权与成果

负责人要求先整理两个层级的文档：平台底座可接入CRM/TMS等其他业务Core；Rental Core内部继续通过品类治理适配不同租赁类型。授权范围为文档完善及提前准备接手资料，不包含工程抽离、恢复CAT-GOV施工、连库/启服务、安装、迁移、提交或发布。

本阶段建立独立PCH四册，补充接口/生命周期设计和可操作接手步骤、错误/事务/权限/历史/停用要求；原CAT-GOV四册保留独立身份并完善，原14项、22项验收及原百分比保留，不把PCH计入旧任务。负责人随后明确要求按归属整理目录，调整如下：

| 原位置/内容 | 新位置/归并决定 |
| --- | --- |
| `docs/品类治理/` | 整体移至`docs/Rental Core/品类治理/`；原CLOSE业务闭环任务不与CAT-GOV合并，增加Rental Core目录入口 |
| 本轮新建`docs/平台Core接入/` | 移至`docs/平台底座/Core接入/`，增加平台底座目录入口 |
| 原AI Native目录中的通用SaaS底座方案 | 移至[平台底座未来规划](../未来规划/平台底座-通用化与开源方案.md)并改名；工程需求/接入/验收归并PCH，保留外部宿主及开源产品化前置，初版原文保全 |
| 现行README、总导航及相关专项链接 | 按新位置更新，旧目录不留第二套现行正文；历史快照内部链接保持原字节，由原source路径解释 |

原AI Native Runtime/SDK方案、SaaS订阅和租赁平台总业务需求仍独立，未按名字机械归并。原方案章节→现行归属映射见新未来方案§1。所有业务代码、测试和未知WIP未修改；搬迁的原设计/部署文件及历史快照保持原内容。

工作树：`D:/工作文件/rental-OS/.claude/worktrees/core-platform-docs`；分支：`docs/core-platform-boundaries-20261031`；固定基线：`6820e06e9daef877637bc2de4effba2bfa0713b1`。这里只定位证据，不是reset目标或主线已整合声明。文档树从固定提交建立，未复制主树并行代码WIP。

### 2.2 现有接点及缺口

前置只读核查覆盖当时主工作树；本阶段固定提交建立文档树并定向核对相关接点。下表说明静态依赖，不替代全量审计、实际运行或独立接入验证。

| 场景 | 当前实际入口/消费者 | 可复用与未实现边界 |
| --- | --- | --- |
| 应用装配 | [AppModule](../../../apps/api/src/app.module.ts)注册平台和Rental具体服务 | 有集中装配入口；未形成跨业务Core的独立宿主合同 |
| 租户/空间创建 | [PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)、[PlatformRepository](../../../apps/api/src/modules/platform/platform.repository.ts)调用租赁注册、品类版本和采用政策 | 有同事务回调；平台生命周期仍绑定Rental模型，不能直接换CRM适配 |
| 身份和权限 | [AuthService](../../../apps/api/src/modules/auth/auth.service.ts)、[ApiAuthGuard](../../../apps/api/src/common/api-auth.guard.ts)消费租赁品类/能力及业务路径 | 当前授权/隔离需保留；公共上下文与业务策略分派尚需解耦 |
| UI装配 | [navigation](../../../apps/admin/src/app/navigation.tsx)、[AppRouter](../../../apps/admin/src/app/AppRouter.tsx)包含Rental能力类型及逐页静态挂载 | 可复用壳和统一路由描述；没有已交付的跨Core页面模块接口 |
| 租赁扩展 | [capability-hook.runtime](../../../apps/api/src/modules/rental-core/capability-hook.runtime.ts)登记租赁Hook与实现版本 | 是行业内扩展，不是业务Core装配；CAT-GOV继续负责品类定义/采用 |
| AI通用机制与业务适配 | [应用providers](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[runner端口](../../../apps/api/src/modules/ai-native/runner/ai-task-runner.ports.ts)、[预算适配](../../../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts) | 已有端口分工；装配依赖租赁服务、预算仍导入Rental指纹工具，runner合同还含Prisma类型；不等于独立可用底座 |
| 数据与共享合同 | [Prisma](../../../apps/api/prisma/schema.prisma)、[shared出口](../../../packages/shared/src/index.ts) | 同库/共包可暂保留；尚无Core数据所有权/公共合同独立构建及非Rental宿主证据 |

### 2.3 未完成交付

- PCH-01/02：全面依赖/所有权清单、真实消费者、正式合同唯一出口、样例边界及存储/事务决策仍待实施阶段核实。
- PCH-03～08：无Rental宿主、授权/生命周期/服务/UI边界和Rental重新接入没有工程交付。
- PCH-09/10：非Rental AI适配、持久化样例及独立接手试验未完成；不继承原AI/MCP成果的完成度。
- PCH-11/12：指南是提前准备版本，尚无实际包/构建/运行组合；合同测试、真实环境、兼容回退和独立审查未完成。

### 2.4 验证边界

本阶段只验证文档链接、格式、任务/验收映射、修订前像与原范围保留。业务源码、迁移及仓库检查器未修改；未运行应用、业务测试、Prisma、数据库、模型、MCP Host或供应商联调。没有独立代码审查，文档一致性检查不能提升PCH或CAT-GOV研发百分比。

| 实际命令/核对 | 退出码/结果 | 证明范围 |
| --- | --- | --- |
| `npm run docs:check` | 1；11份白名单文档，3个旧归档链接缺失 | 固定提交不包含`docs/历史归档/`的原全量快照/整合前文件；未删除引用或造文件变绿 |
| `node output/core-docs-20261031/verify-docs.cjs` | 最终0；27份现行/索引文档、555个链接，0个本次新增问题；53个已有缺失引用单列 | 按修订前文本和固定Git文件清单证明缺失归档/本地日志早已不在此基线；不是全库链接通过 |
| 同一定向核对 | 7份修订前像SHA-256/字节数一致；原14任务正文/依赖/百分比及22验收保留；PCH12项齐全 | 迁移后的原实施设计/部署检查与Git正文仅Windows换行差异；相邻7份专项只改链接目标 |
| `git diff --check` | 0 | 已跟踪文档差异的空白格式；新增文档表列数由定向核对覆盖 |
| `node output/core-docs-20261031/check-moved-references.cjs` | 0；57份现行文档无已搬迁目录的旧引用 | 不扫描历史原文，不检查外网；最初内联命令因shell转义失败，改成本地脚本后通过 |
| 独立文档一致性检查 | 指定6份文档，未发现必须修复的文句冲突 | 只检查两层边界、依赖、设计/实现区分及安全/历史/unknown要求；不是代码审查或运行验收 |

定向检查首轮退出1，列出原附件缺失，并把Git LF与工作区CRLF误判成两份原设计变更；随后仅修正本地核对方式：原附件按修订前同目标且不在固定提交中单列，原设计按规范化换行比较。未改变仓库`validate-docs.cjs`或业务断言，没有通过删除原附件引用掩盖问题。临时整理/验证脚本、保全及报告留在本树`output/core-docs-20261031/`，不作为平台能力产物或提交范围。未运行`test:docs`，因为仓库检查器没有改动。

旧归档和本地验证日志需后续由资料所有者核对是否纳入可携带证据；本次未读取或复制其他工作树的未跟踪成果。

### 2.5 文档提交与主线整合授权

负责人在本阶段整理完成后明确要求：“把这次文档改动提交并合入main，别带上其他改动”。授权仅为本片文档固定提交和本地主线整合，不扩展到代码、测试、迁移、其他WIP、推送或部署。提交前再次核对暂存区、目标文档与main未提交归属；主线的其他修改保持原位，不用stash/reset/clean处理。本片独立文档一致性检查已完成，原`docs:check`缺历史附件边界继续保留，不作为提交后已修复。

提交前发现Git默认换行归一会让快照工作区CRLF与暂存blob的LF不同，两个历史快照目录各增加仅针对原文文件的局部`.gitattributes -text`，重新暂存并按blob核对manifest哈希，保证主线检出后仍可验证原字节。没有修改全仓库换行配置或历史正文。

## 3. 后续记录规则

每个完整阶段记录任务ID、固定源码/合同、真实入口和直接消费者、数据/权限/事务边界、已做/剩余、实际命令与退出码、验证层级和残留。近期保留最近一个月，超期先移入本专项`历史归档/开发过程/YYYY-MM.md`再移出近期区，未解决事项保留摘要；不另建“最新总计划”或逐次修复流水。

<a id="core-contract-first-20261114"></a>

## 底座拆分开工：独立清单合同与兼容指纹抽取（2026-11-14）

### 授权、主线与写入范围

负责人明确“开始拆吧”，并要求持续维护接入手册、使用最新 main、只做必要测试且写入规则。复用 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS`，从当时实际远端/main `4720db2a8aa1d4c82e3cdabe62ef062dc06c3768` 新建 `codex/platform-core-extraction`。原准备树干净、暂存区为空、无合并/拣选状态，原 `1663171c1` 已在主线，未复制环境或旧工作目录。

负责人提醒后再次 `git fetch origin main` 并核对 `ls-remote`。主线后继 `6ca19ac34a3260405ba24388a4aa2a933450e70b` 只涉及后台语言/主题图标及原记录，执行 `git merge --ff-only` 前进到该版本，17 个本片已有修改/新增文件的 SHA-256 前后相同。源码与 schema 清单按该新基线核定；后续阶段开始前继续读取实际 main，只整合已提交固定增量，保护本片 WIP。

PM 随后明确本片唯一窗口：`packages/core-contracts`、必要根 lock 条目、`common/request-fingerprint.ts`、`operation-log.service.ts`、`integrations/file-content-binding.ts` 及 Rental 幂等仓储的等价兼容再导出。shared 总 index、OpenAPI、AuthGuard、AppModule/AI providers 与 AI 任务目录仍归 AI/PM 既有窗口。AI 不需停工或同步改旧出口；下一片的公共接点先列于原接续，由 PM 主动核定。当前消息未要求回复，没有跨对话通报。

### 01：实际依赖、数据与消费者基线

以新基线 Git 文件集检索源码类文件，得到 9,789 项，其中保留的上游 Harness 为 6,133 项，剩余 3,656 项是自有/引入组件/原型/测试的待归属集合，不能全部当自有代码。API 964、shared 144、后台 665、客户小程序 202、员工小程序 205、客户网站 71、企业门户 44、MCP 59、Harness 插件 12、脚本 46、测试/fixture 793；其他组件、营销站和原型沿原目录保留。此为全文件集合与模块定位，尚非逐文件逻辑、注释和接口全覆盖验收。schema 有 238 个模型、259 份历史 SQL 迁移，未执行或改写。

用 TypeScript AST 读取固定 API/shared 源码的 import 和可静态识别的仓储调用。指向 `rental-core/` 的 import 声明包括组合 AppModule 41、common 2、OpenAPI 1、Auth 8、平台域 16、订阅 1、文件 3、集成 9、客户 API 16、企业 41、AI 474。数量含类型引用，不代表全部都是错误依赖；AppModule 的显式组合、Core 业务适配和公共内部依赖须分别判断。没有依靠该计数删除文件或改业务。

| 实际链路 | 原行为、数据所有者与第一处要拆的连接 | 本片结果及后续验证 |
| --- | --- | --- |
| [启动](../../../apps/api/src/main.ts) → [AppModule](../../../apps/api/src/app.module.ts) → 各服务 | 当前启动执行环境加载与监听，组合直接注册 Rental/AI/企业及公共服务；不适合作为离线导入入口 | 本片不加载启动。03 后续拆受控宿主，保留原组合及单一作业执行者 |
| [Auth](../../../apps/api/src/modules/auth/auth.service.ts) → [平台仓储](../../../apps/api/src/modules/platform/platform.repository.ts) → 会话/ALS | `findUserForLogin` 查询 tenant 时带 rentalProfile；Auth 注入 WorkspaceCapabilityService；可信主体、会话与当前角色来源必须保留 | 登录/租户普通设置仍依赖 Rental。下一片先固定公共身份与 Rental 业务范围适配，不删原 Guard 条件 |
| [平台服务](../../../apps/api/src/modules/platform/platform.service.ts) → `bootstrapTenant/createTenantBusinessWorkspace` | 创建租赁租户/空间使用同事务 Rental 初始化回调；缺回调明确拒绝，提交后才刷新缓存 | 原行为保持。将公共租户初始化与 Rental 绑定分开需独立入口和同事务合同，不能直接把回调改成可选成功 |
| [订阅](../../../apps/api/src/modules/subscription/subscription.service.ts) → 租户统一期限/权益 | Subscription/FeatureGrant/Event 属平台商业事实；品类可用性另引用 Rental category-identity | 保留统一期限、善后及撤权。行业可用性后续经已登记适配供给，不复制收费模型 |
| 平台仓储 → 用户/角色/组织；会员与企业结算 → Rental 事实 | Tenant/User/AuthSession/Role/Permission/OperationLog 等是公共候选；BusinessWorkspace/WorkspaceMember、租赁客户会员/企业资格/授信与订单仍有业务约束 | 核出平台目录还写 RentalOrder、品类采用与会员业务。后续逐所有者分离，不能整目录搬成通用层 |
| [审计](../../../apps/api/src/common/operation-log.service.ts) / [文件绑定](../../../apps/api/src/modules/integrations/file-content-binding.ts) → 请求指纹 | 两者为计算摘要反向 import Rental 幂等仓储，加载了无关 ORM/业务依赖 | 本片改到纯公共函数；原仓储保留相同路径导出，已存指纹不变 |
| [文件 ACL](../../../apps/api/src/modules/files/file-business-access.service.ts) / [支付运行时](../../../apps/api/src/modules/integrations/payment.runtime.service.ts) | 存储运输与业务归属相邻；Rental 金额、原订单/文件授权、回调账由原业务裁定 | 本片仅抽指纹，不改 payment/file-storage 的企业/AI 活动区域。后续逐业务回调与 ACL 接点拆分 |
| [Rental](../../../apps/api/src/modules/rental-core/rental-core.service.ts) / [业务服务](../../../apps/api/src/modules/rental-core/rental-business.service.ts) → 原仓储/快照/作业 | 配置、报价/库存/资金、历史版本与原幂等归 Rental；[到期调度](../../../apps/api/src/modules/rental-core/rental-due-job.scheduler.ts)在原事务/锁中执行 | 仅保留幂等函数旧出口；算法、事务和原标识未变。原报价配置混用及 fixture 问题仍在 Rental 原接续 |
| [后台导航](../../../apps/admin/src/app/navigation.tsx) / [路由](../../../apps/admin/src/app/AppRouter.tsx) → [会话](../../../apps/admin/src/features/auth/authStore.ts) / [缓存](../../../apps/admin/src/app/queryClient.ts) | 当前壳识别 Rental 品类/能力，Vite/tsconfig 仍指 shared 源码；会话/租户/空间变化清理并隔离迟到响应 | 本片未改 UI。07 需扩 Core 命名空间并保留旧深链接、主题/语言和未保存保护 |
| [客户 API](../../../apps/api/src/modules/client/client-api.service.ts) / [企业](../../../apps/api/src/modules/enterprise/enterprise-read.controller.ts) → 网站/门户/小程序 | 现有客户端继续通过原 audience、会员/企业授权和受权订单投影使用 Rental；不能改成租户员工授权 | 作为后续兼容消费者，源码基线已定位，本片未做宿主/浏览器复验 |
| [AI 组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts) → 原工具/批准/执行/恢复；MCP/Harness消费 | 现有大量指纹引用仍走旧 Rental 出口；它们包含原任务/账/收据语义 | 本片兼容再导出足以保持引用；AI原15/25继续其窗口，不对其批量改 import 或扩大测试 |
| [shared](../../../packages/shared/src/index.ts) → DTO/[OpenAPI](../../../apps/api/src/contracts/openapi-document.ts)/各端 | shared 同时包含运行时和 Rental/AI 合同，platform.ts 仍引用 Core 类型；不能视为纯平台包 | 新跨业务清单归独立正式包，不复制旧 DTO；新包不反向依赖 shared。原HTTP语义/操作保持 |

上述原功能状态一律区分来源和层级：未运行当前场景记未验，原专项记录中的成功只作固定证据入口；已知失败仍由原专项维护。本片不声称“现有所有功能已验证正常”。后续登录、租户/角色/订阅、Core授权、业务/各端、AI/回调/作业每个受影响切片必须取得前后对照。

最小非租赁样例冻结为简单工单：以租户为范围，不引入经营空间/资金/库存；对象包含标题、说明、创建者、受派成员、`open/in_progress/closed` 状态和修订。基本流程为创建→分派→开始处理→关闭，管理者按角色查看/分派本租户工单，普通成员只读本人创建或获分派对象，正式状态更新需当前授权及修订；同键提交读原收据。样例实际持久化、UI、同租户多 Core 授权与停用恢复待10，当前测试中的 `example-tickets` 仅为清单夹具，不冒充该业务样例。

### 02：已落地的正式契约与兼容抽取

- 新建 [core-contracts](../../../packages/core-contracts/README.md)，正式包名 `@rental-os/core-contracts`，`0.1.0`，唯一字段来源为 [manifest schema](../../../packages/core-contracts/src/manifest.ts)，类型由 Zod 推导。独立包只依赖既有固定 Zod，不引用 shared/Rental/Nest/Prisma；根 lock 只增该 workspace 及其链接，既有依赖记录逐项相同。技术命名沿现有 scope，品牌讨论不触发本片全量改名。
- [版本与组合检查](../../../packages/core-contracts/src/compatibility.ts)区分底座、合同、Core、数据和 Node；首版兼容范围为确定三段数字版本的闭开区间，支持空/单/多 Core 组合，拒绝重复标识、未知必需能力和不兼容版本。Core 单独升级不修改其他版本，实际迁移/部署仍待后续实现。
- 清单包含包内入口、可选后台/AI/OpenAPI/作业/事件、权限资源/动作、自有 tenant/container 范围、来源和迁移摘要。[对象引用](../../../packages/core-contracts/src/reference.ts)用元组表示 Core/租户/容器/对象边界，只作定位，不授予权限或替换历史幂等键。
- [只读目录检查](../../../packages/core-contracts/src/package.ts)及[命令](../../../packages/core-contracts/src/check.ts)检查声明和文件、迁移摘要及指定宿主兼容，输出可读/JSON 与稳定退出码；不加载 Core 代码。下载/安全解压、完整包摘要锁定、实际模块合同/装配、权限/生命周期/事务及 HTTP 贡献尚未交付，不能称可安装业务 SDK。
- [请求指纹](../../../apps/api/src/common/request-fingerprint.ts)从原 Rental 仓储等价移出，函数正文与新基线逐字符（只归一换行）相同；审计和文件绑定改消费公共入口，Rental 原路径再导出。既有 JSON/排序/异常语义全部保留，不借抽离修历史指纹算法。
- [接入说明](../../../packages/core-contracts/README.md)与命令同片交付，明确当前可执行的清单/目录检查、错误定位、版本与源码路线。完整五步手册仍在原任务内维护，后续依据实际可运行宿主/样例生成随包指南；不另建手写第五册，不让 Agent 将待开发步骤当成已可执行命令。
- 根 [AGENTS](../../../AGENTS.md#修改验证与交付)按负责人要求强化“只做必要测试，不编写大量测试脚本”。本片清除自己新写的单独运行器，保留一个合同测试文件及全部有效断言；该检查没有已有入口可替代。原业务测试不新增/扩写；指纹对照通过 stdin 短命令完成。

### 实际验证、缺口与交付边界

| 验证 | 实际结果 | 证明范围 |
| --- | --- | --- |
| `node --no-compilation-cache --test packages/core-contracts/test/core-contracts.test.cjs` | 8组通过，退出0 | 使用本树实际 TS 编译产物，类型/反向行业依赖、版本/范围/对象隔离、目录/链接/摘要和CLI；没有租户/持久化/业务成功假设 |
| `node --no-compilation-cache -` 指纹前后对照 | 退出0，22个输入/异常对照与原函数正文相同，文件绑定实际消费者结果相同 | 新旧摘要字节、边界输入、异常类型与原出口；未执行资金或任务 |
| `node --no-compilation-cache -` 公共指纹类型检查 | 退出0 | 新公共文件完整类型；不等同全API/客户端组合构建 |
| `node --no-compilation-cache -` 原仓储出口导入 | 退出0，新旧出口为同一个函数，未加载Prisma | 通过既有ts-node只读编译、不启用测试装饰器元数据；验证原导入路径兼容，不等同Nest生产装配 |
| lock JSON逐项对照 | 退出0，只增两个workspace记录 | 既有依赖/锁定未改变；本片未安装依赖 |
| Git状态与更新 | 远端main核定为`6ca19ac34`，本树从4720快进且WIP哈希保持 | 只更改独占分支；main索引和其他树未写 |
| `node --no-compilation-cache -` 文档定向核对 | 退出0，4份改动文档191本地链接/26锚点无新增问题；任务正文与进度原文未变 | 复用原检查器API，稀疏树外目标以同一固定Git树只读核定；不改检查规则 |
| 原 `validate-docs.cjs` 白名单逻辑，固定Git补足稀疏目标 | 11份可读，3个既有历史附件缺失 | 缺失仍为总导航第54行原三附件；未删引用、伪造历史或称全库文档通过 |
| 原 `mcp-original-audit.test.cjs` 的隔离执行/退出清理 | 执行前被自动审批拒绝，返回 `blocked by policy`，无进程退出码 | 命令未启动，`output/.tmp/pch-fingerprint`不存在；本片原MCP审计回归未验，没有换壳/绕过拒绝 |

测试只读使用主树已有且与锁文件匹配的 TypeScript 5.9.3、Zod 3.25.76、@types/node 22.20.1，经本轮命令的 `NODE_PATH` 定位，无跨树 junction 或复制 node_modules，产品/测试代码不硬编码其他树路径。正式声明仍使用 npm workspace 和锁文件。全部测试编译与夹具集中在本树 `output/.tmp/core-contracts`，测试 `after` 清理并确认移除；stdin核对不落脚本。不读取 `.env`、不连接数据库/供应商/模型、不启动服务，没有新后台进程。

本片是01/02的首个独立实现阶段。完整数据所有者/迁移链、所有消费者逐项核验和业务基线尚未完成，02的运行模块/当前授权/生命周期/受限事务及真实双Core消费者也未齐；因此不凭新增文件或8组测试提高原任务百分比，仍由原门槛核收。完整API构建、真实持久化/浏览器、独立接手、迁移/恢复和独立审查未实施。后续公共窗口与具体下游入口见现行接续。

阶段代码、根规则与接入说明固定于 `a8da7ae1e47b289e9b8cc72f607b74e14cbdf4b6`，包含19份明确归属文件；`git push -u origin codex/platform-core-extraction` 成功，随后 `git ls-remote --heads origin codex/platform-core-extraction` 回读为同一SHA。提交时主线基线为`6ca19ac34`，本树工作区/索引干净。没有合入main或通知其他对话；当前记录/接续的固定证据补记另随文档提交上传。

<a id="core-admin-contract-20261114"></a>

## Core页面单源声明合同（2026-11-14）

本地打包/待部署准备固定于 `25c713a5b8a5d217bb0a6213c4f5978163d6a5d3` 并已推送回读。本片沿v1.4最少声明要求，在独占[admin合同](../../../packages/core-contracts/src/admin.ts)增加路由/名称/菜单/父级/权限的唯一schema和类型，以及组件引用、页面操作类型、注册与本地路径解析。操作分为navigate/open/command/save，真实处理方法和Form仍由Core代码提供；没有通用表达式执行器或第二套按钮实现。

`registerCoreAdminPages`在清单后台贡献存在且Core/版本相符时注册，检查本Core页面ID/同形路径/权限目录、父级缺失与循环；跨Core同名页面使用各自命名空间。组件引用不调用，错误不返回部分表。`resolveCorePageLocation`只解析已登记目标和完整参数，并编码对象ID，未知/额外参数、路径控制值明确拒绝。注册表不授予权限；原路由/Guard/页面生命周期仍须按07接线。

原单一合同入口含新增完整类型，8组通过/退出0；stdin核对空/双Core、同源名称/菜单、编码参数、未知目标、重复/同形/循环、未知权限及外部/重复参数路径拒绝（退出0），组件调用计数为0。现有测试文件未扩写，临时编译目录由原after清理。模块说明含最小真实schema例子、四类操作语义和当前未接线声明；React自动呈现/主按钮/表单/默认页面及真实租户权限尚未完成，不能将合同通过计为07宿主验收。

<a id="core-public-auth-extraction-20261115"></a>

## 公共身份、认证与原Rental兼容抽取（2026-11-15）

负责人明确“你这个工作树只有你，授权你全权负责”，解除本树PCH公共文件唯一作者窗口的阻塞；随后再次确认最终交付为可单独取出的Core包和底座源码，无Core底座可以独立构建、启动、登录和保存公共设置。此结果按原R01/A01与R11交付，不以隐藏菜单或全量构建后缺业务贡献替代。工作树仍为C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS，分支codex/platform-core-extraction，基线d170a5fa8db1cb56d166fb05246790c0ead29539；实际main62ca在祖先且远端核定，未操作main索引或其他树。原阻塞全文保留在固定d170及下节历史记录。

[公共身份声明](../../../packages/shared/src/platform-identity.ts)从原platform唯一声明抽50项身份、人员/角色、设置和运行时常量，新增正式@rental-os/shared/platform子出口，原platform及总index兼容再导出。Rental扩展继续原声明，不复制公共DTO；公共出口没有Core/行业import。

[身份仓储](../../../apps/api/src/modules/platform/platform-identity.repository.ts)从原仓储移出15个账号/会话/角色映射方法，原PlatformRepository继承同一实现；findTenantByCode/findUserForLogin和认证租户读取不include Rental档案/订单。公共身份不据租户存在声明已开通业务，Core使用权继续由授权目录裁定。原账号状态、角色投影、哈希、轮换及撤权保持。[公共认证](../../../apps/api/src/modules/auth/auth-session.service.ts)抽原21个签名/刷新/改密/保护方法及5个状态字段，Rental AuthService继承且保留原空间/品类/可信主体/员工分面；[PlatformAuthService](../../../apps/api/src/modules/auth/platform-auth.service.ts)只签operator公共身份，无Core不造空间或业务授权。

公共[认证控制器/DTO](../../../apps/api/src/modules/auth/auth-session.controller.ts)由原Rental控制器继承，旧LoginDto及请求DTO出口继续兼容。实际Nest测试容器已核原AuthService注入及8条继承/扩展路径均唯一，没有在主应用同时登记两个Controller。原安全默认与合并规则抽到[同一公共实现](../../../apps/api/src/modules/platform/platform-security-baseline.ts)，原平台保存继续原位。[外观存储](../../../apps/api/src/modules/platform/platform-appearance-data-store.ts)使用平台窄端口；原AppModule显式注入唯一数据库及旧客户端品牌读取，公共宿主不依赖旧客户端表。省略/清空/旧修订、首次保存品牌保留沿原服务。源码导读见[认证README](../../../apps/api/src/modules/auth/README.md)。

验证经stdin和本树单一output/.tmp/platform-auth-integration，复用已核锁定TypeScript5.9.3、Prisma5.22和已有Nest工具；无依赖安装或业务连接。最小生成准备曾因缺CLI wasm退出1，补同版本必要Wasm后实际Prisma generate退出0，238模型schema与原基线相同，原离线preload/audit违规0。五包真实声明及完整API核987根/2,186源0诊断；前一类型检查误给API开启声明输出出现非可命名类型，改回原API编译选项后只留下真实兼容诊断并修复，无产品断言放宽。

实际公共认证服务在明确平台表夹具下核登录/上下文、单次并发刷新、改密撤销、当前账号冻结和双租户隔离，退出0；未提供任何业务表。原固定d170仓储与当前角色投影、活跃/停用角色、相同令牌签名字节/验证和登录保护摘要对照通过。原tests/auth-login-lockout.test.cjs实际执行退出0，包含共享计数、阈值、清除、禁用策略、唯一/CAS冲突及内存路径；依赖定位缺项的失败仅修验证路径后复验。

原tests/admin-appearance-settings.test.cjs实际17例，16通过/1失败，cancelled/skipped/todo均0，所有服务/事务例通过。失败为最后页面静态断言禁止外观页name=themeColor，而固定d170页面早已提供账户主题色；基线与当前页面归一换行SHA-256均5f1474b2a254ef3b785d9ae9daa8001335b383bdc6c0e1294fd629161c867ee5。本片未改该页面或断言，保留旧失败，不宣称全绿。定向文档核595链接/155锚点，Harness README在当前稀疏检出中缺失但固定Git可读取，属于已登记未检出来源；正式需求/任务归一换行正文未修改。测试仅为显式legacy读取调整原夹具，MCP夹具只增加正式平台子出口解析，无新增测试脚本。

本片尚未装配独立公共AppModule/Guard或独立schema/迁移/Seed，未取得真实无CoreHTTP/数据库/浏览器、完整多Core/原Rental业务、安装更新/回退/独立接手/审查证据；原任务未跨下一档。下一片继续真实公共宿主、正式Core主应用及其同源OpenAPI/前端消费者。临时生成工具/Client/声明/运行共享产物与缓存共527文件、73349425字节，核绝对归属/无链接后全部删除，任务目录不存在，output/.tmp条目为0。仅留本节最小证据，没有新增服务进程或重复环境。

<a id="core-tickets-independent-host-20261115"></a>

## 工单标准平台适配与独立示范宿主（2026-11-15）

公共期限/物理计划已提交并远端回读df06578b2c8b79c7e8aef8ac91d3de819a9860a2，订阅声明末尾格式收尾f78e5bb3fe866743f7ec96f33283888e82651ef8同样上传。工作区/索引干净后开启本片，独占树和既有main62ca保持。

[工单platform-host](../../../packages/example-tickets-core/src/platform-host.ts)从原行业API组合抽为实际标准包子出口。消费公共身份、有限SQL、当前Core/成员/角色、原绑定、统一期限和同事务审计；原original-tickets-host仅转接同一实现和原订阅政策，领域状态/金额/权限及原收据规则不变。示范Core源码和清单新增实际适配文件/声明，领域总出口仍不导入Nest/Prisma/平台适配。公共业务审计只记Core原操作引用，在调用方同事务保存；业务正文留Core。

[公共依赖工厂](../../../apps/platform-api/src/core-dependencies.ts)、数据库和数据计划提供宿主正式子出口，不让新Core深层导入或复制公共源码。新增[工单独立示范宿主](../../../apps/example-tickets-api/README.md)及3个主源码入口，公共无Core构建不引用本应用或工单包。Nest应用公共/Core/工单共享唯一数据库provider与生命周期，标准Core和8条工单HTTP由同一实际工厂装配，不让父本地provider自动进入子模块。[工单Factory](../../../packages/example-tickets-core/src/nest.ts)从导出的实际依赖消费同一业务实例。

[严格包核验](../../../apps/example-tickets-api/src/deployment-package.ts)要求当前依赖中的Core是所选标准包：ID/版本/来源和重建归档摘要必须与固定锁一致。没有清单的作者源码树或来源/字节变化拒绝启动，不伪装成已安装。示范组合按真实公共物理计划与工单物理reader读取原Prisma账/执行状态，新业务期限来自公共reader；实际锁的包发行/数据库尚未验。

[迁移组合](../../../packages/core-contracts/src/deployment.ts)提供正式Core Prisma迁移名称和版本锁/包字节校验，只返回新文件Map；[示范准备命令](../../../apps/example-tickets-api/src/prepare-deployment.ts)将实际平台发行+已准备工单包生成新独占目录，成功显示pending。公共4份+Core1份SQL原字节保留，Core原账名固定core.example-tickets.tickets.initial且运行观察消费同源函数，目录排序和声明顺序不一致拒绝。命令不安装/执行迁移，不覆盖用户目录/活动组合；失败只清自己刚创建的候选。根构建/类型入口与lock/可选peer元数据同片维护。

| 验证 | 证据与边界 |
| --- | --- |
| 当前公共/工单/原API类型，实际Prisma内存声明 | 8包零诊断；公共7根/757源、工单宿主5根/772源、原API988根/2,204源零诊断，退出0，内存编译无磁盘产物/守卫违规。首次验证转接声明的相对Client位置没给内存同源映射，补验证解析后通过，未造产品shim |
| 实际工单Nest组合（严格包校验加入前） | 唯一公共DB供公共和业务、8政策/Controller和51同源API操作，组合零DB读取；固定来源/锁为显式offline fixture。严格包门禁加入后的干净标准包容器尚待实际包阶段，不沿用成已验 |
| 工单实际平台适配/MySQL/领域服务 | 创建和同键原结果、Core停用拒绝普通get但原收据按本人/对象受控可读、成员撤权、统一期限到期拒绝新建、审计失败回滚通过，退出0；SQL/availability为明确fixture，未连库 |
| 部署组合短命令 | 公共4+Core1准确SQL、确定原账名称/排序和坏包摘要拒绝通过，退出0；包内入口是明确静态fixture，不当可运行发行 |
| Root lock和3workspace | 新示范应用依赖、原工单新增可选peer以及公共宿主元数据匹配；未安装/网络获取包 |

首次新工单适配缺类型import/全局只读SQL接口，修真实端口后类型通过；不存在CorePackagePin类型按正式部署锁元素类型引用；实际部署组合的source索引/摘要检查保持原标准。没有新增测试脚本或删除原断言。独立包运行、真实DB/HTTP/完整四页后台、标准包安装/迁移/独立接手、双真实Core及升级回退/审查仍未验。

下一入口先从固定提交真实编译工单标准包，严格门禁后组合/授权/业务与迁移准备有限验证，再接公共后台壳和原Rental可取出包。当前原任务未因示范目录或51接口自动跨档；PCH-03/04/10完整门槛仍有上述缺口。旧唯一待清理环境自动删除拒绝继续保留，本片验证仅内存，没有新增临时环境/进程。源码/README/接口与原四册按同一切片提交普通推送，main未集成。

<a id="core-public-data-term-20261115"></a>

## 公共统一期限与真实物理数据观察（2026-11-15）

公共Core主装配提交3d306de05b861dd90c0465c4da9161c8b7351f09，首次push因schannel TLS handshake失败，远端仍8ea；原普通push重试成功，真实远端回读3d306de05、main62ca，工作区/索引收口后再开启本片。没有换远端/关闭TLS或强推。

[订阅公共合同](../../../packages/platform-contracts/src/subscription.ts)从原shared订阅声明移为单源，原shared继续再导出，原基础版/PRO、金额可空、期限和请求字段不变。[状态/排期投影](../../../packages/platform-server/src/modules/subscription/subscription-state.ts)与[周年/服务时区](../../../packages/platform-server/src/modules/subscription/subscription-term.ts)抽原算法，原SubscriptionService消费同一函数。订阅办理、专业功能/品类与收费政策仍在原服务，未重建收费机制。原正式SUB四册及进度保持。

[公共期限reader](../../../packages/platform-server/src/modules/subscription/subscription-reader.ts)在调用方原事务读取租户当前订阅和已到期排期，返回原revision与newBusinessAllowed；明确到期停止新业务，历史未登记保持原“待确认”兼容，不批量停業、不伪装永久、不自动创建期限或物化排期。公共Core装配消费该真实reader，替换此前零Core拒绝占位；零Core目录仍不开放业务。参数/提醒阈值与原SubscriptionService沿同一解析，原排期/未登记政策保留。

公共schema增加两个原订阅期限模型及三个原enum，当前22公共模型/9enum；字段、表名、精度/可空、期限与关系来自原schema。公共独立迁移引用原SUB两份不可变SQL的期限表/外键和追加列，新库链不覆盖旧组合库，也不创建收费/期限数据。新SQL SHA-256为ff2ca9614628d7b5282c22293bb81b8c6e70ce0d3d69be2da301fc0a89e7449b。

[平台数据计划](../../../apps/platform-api/src/platform-data.ts)明确0.1.0基线和4份迁移原文/Prisma名称，读取源码时逐份验证固定SHA-256，不从文件存在推导就绪。[结构预期](../../../packages/platform-core-host/src/mysql-structure.ts)只解析本链实际使用的CREATE/ADD COLUMN/FK，未知DDL拒绝；[物理reader](../../../packages/platform-core-host/src/mysql-physical.ts)读取information_schema实际表/引擎/排序/195列/53索引/7CHECK/18外键，核类型、可空、默认值、键和受执行约束。CHECK保留NULL/范围与and/or括号优先级，不能通过去括号改变语义。原Prisma账/迁移状态仍由既有mysql-deployment提供，真实查询失败不变成空成功。计划已提供，选中Core总组合消费及真实DB未验。

| 验证 | 结果与边界 |
| --- | --- |
| 状态算法原固定3d306/当前对照与公共reader | 正常/过期/待生效/未登记同原投影；排期接续/revision、明确到期拒绝及缺租户拒绝通过，不写订阅 |
| 原saas-subscription-service.test.cjs有效断言 | 20例全通过，fail/skip/todo/cancelled0，退出0；通过stdin实际载入原用例与当前服务/DTO，ts-node仅外部装载钩子，原声明/生成enum沿锁定来源。未新增脚本/改断言，未执行DB |
| 平台结构/实际metadata读取 | 固定4SQL解析22表/195列/53索引/7CHECK/18FK；正常和缺表/列型/键/CHECK停执/错约束/FK/默认值7类拒绝，BETWEEN等价且括号优先级差异拒绝，退出0；metadata为明确fixture，不称真库就绪 |
| 实际平台数据计划 | 4份源码摘要/版本/原Prisma名称核定，计划调用退出0，只读文件，没有物理库访问 |
| 原离线守卫下Prisma schema/WASM+官方生成类型与8包/两宿主 | 公共22/原238模型实际解析；8包零诊断；公共6根/756源、原988根/2,209源零诊断，命令退出0，守卫违规0，无新磁盘Client/dist/缓存/进程。仅在内存生成，不复制旧环境 |

首次结构解析漏掉原SQL索引名与括号间空格，修解析器接受原已使用语法后通过；原订阅测试装载第一轮漏新公共包映射，在唯一已有产物加只读解析后复验通过，没有新安装或产物。源代码期限/申请/订阅业务规则未改变，原失败/未验仍归原专项。

下一入口继续完整公共订阅管理/基础集成、所选工单Core实际受控锁/物理观察/授权业务HTTP与后台，再处理Rental可取出的包、多Core/AI、安装更新/回退与独立接手。本片不是全部订阅或全部平台完成；真实DB/HTTP/浏览器、旧库迁移/回退、独立审查/发布未验。原任务没有因22模型或20测试数自动升档。

期限/物理阶段df06578b2c8b79c7e8aef8ac91d3de819a9860a2已推送且真实回读。新增订阅声明继承原文件末尾空行，暂存空白检查报告该一处；后续仅裁掉末尾多余空行并复查，不改声明或业务，补证与原阶段一起保留。

本片只有内存验证，output/.tmp无新增文件，唯一既有91,808,304字节待清理环境及责任清单继续受自动审批blocked by policy；没有重复副本或绕过删除限制。资料与源码同片提交普通推送，固定结果在本对话/本记录承接。

<a id="core-public-assembly-20261115"></a>

## 公共Core宿主包与独立主装配（2026-11-15）

上阶段公共管理已提交8ea7953a0178c4c1b7a4e2ccc7dfa7ab351f1e21并普通推送，真实远端回读同一SHA、工作区/索引干净；main62ca仍在祖先。此片在原独占树继续，未接管其他树或main索引。

[platform-core-host](../../../packages/platform-core-host/README.md)为标准Core与公共SaaS的独立适配包。原8个管理/目录/范围/移除组合与4个HTTP/模块源码移到正式包，原路径只保留窄子出口或原订阅/审计薄适配；公共包不导入原API、shared行业合同、Rental、Prisma生成模型。事务按实际Tx受限公开SQL和公共身份，原租户/角色锁、Core锁、当前权限/统一期限及提交点复验保留。原工单继续消费相同身份与使用权，新旧不并行执行。

[公共AppModule](../../../apps/platform-api/src/app.module.ts)和[Core工厂](../../../apps/platform-api/src/core-assembly.ts)消费同一公共数据库，登记CoreHostModule、标准Controller、Guard准入与同源OpenAPI。默认目录明确零Core，本人目录不查授权表即可返回空集合，未知业务拒绝；选中Core须提供受控部署锁/实际数据观察及真实新业务订阅端口。默认零Core的拒绝不会被记成已提供完整订阅服务。原组合总AppModule仍未消费新Core管理，Rental保留原业务Guard/HTTP。

原Core授权/绑定两份SQL已按原生Move-Item单份移入公共宿主Prisma链，Git原字节及SHA-256相同。授权迁移ef03bb4bae3ff0337213cb1f87aa2ebeb8338faec016be05de645dfea54c2411，绑定迁移5666ecd0d42099cf0865e8d8116709d3f7a07c77d360972cbe5866f15fa1a8bb；SQL执行状态尚未核定，没有连库或应用迁移。公共schema新增六个所属平台的授权/成员/绑定/原操作模型，当前20模型/6enum无行业表。迁移字节用局部gitattributes固定；旧238模型schema/历史迁移未改写，已有组合库只能引入获准增量，不使用公共新库基线覆盖。

[Core主HTTP政策](../../../packages/platform-core-host/src/platform-core-http.ts)消费单源管理/本人目录/范围声明，具体Core业务从已登记http读取，错误按当前拒绝/不可用/冲突映射。原收据仍只读核同一原键及主体，不借当前状态推断旧操作结果或可重发。OpenAPI组合43操作/35路径与公共同源字段一致，无缺schema引用、重复operationId或隐式行业文档。

| 验证 | 实际证据与边界 |
| --- | --- |
| 5个公共/标准包独立类型 | platform-contracts1、platform-server33、core-contracts35、core-host8、platform-core-host19根，零诊断；正式出口无反向行业/生成模型依赖 |
| 当前schema实际Prisma内存验证/生成类型 | 复用原Prisma5.22CLI内的schema WASM和官方client generator，20及238模型均解析；声明/JS只在内存，没有新Client/dist或复制环境。schema/类型不是实际迁移或DB运行证明 |
| 当前独立宿主与原API类型 | 公共5根/748源和原988根/2,203源按当前官方生成声明及8包正式输出核对，命令退出0、全部零诊断、离线守卫违规0且无磁盘输出。此前旧生成物核两者零诊断只作为兼容补证，不冒充当前20模型产物 |
| 实际PublicAppModule/Nest容器 | 唯一DB、标准Core应用/Controller和Guard provider实际装配，签名零Core目录返回空集合且零Core/Rental业务表查询；未知绑定同步拒绝，容器关闭。DB为明确offline fixture，不启动HTTP |
| 标准Core原SQL/服务正常与拒绝 | 两个显式登记Core可分别授权但不自动分配成员；本人目录/业务HTTP仅本成员Core，旧修订拒绝，同键返回原收据；停用/重开保留同一绑定，成员撤权不随重开恢复；审计失败整笔授权/收据回滚通过。部署可用性/SQL为明确fixture，不声称双真实业务或真库安装通过 |
| 同源OpenAPI及锁 | 43操作/35路径、引用/operationId唯一；新workspace与两个API依赖锁元数据一致，未安装依赖 |

验证短命令最初出现fixture的return1拼写及未知绑定同步异常误用assert.rejects，修验证写法后正常/拒绝通过，未改产品断言。短schema/类型命令首次处理MCP exports条件时误读type，改验证按真实exports类型读取后继续，不修改包规则。本阶段没有新增测试脚本、跳过断言或扩大普通业务回归。

03/04主组合已进一步落地，但03仍缺完整公共服务/后台及选中Core运行，04仍缺原Rental主装配和真实多端授权；05/06完整排空/回调/历史和事务接点、08行业可取出的包、09AI正向隔离、10/11真实样例/独立接手与12回退/审查仍未齐。原任务不按源码数量升档，默认零Core、类型或fixture不代替全部A01/A03/A10。下一片提供真实公共订阅/数据物理观察及选中工单装配，再接完整公共后台和Rental包。

旧840文件/91,808,304字节临时环境归集后再次原生删除仍在启动前被自动审批拒绝blocked by policy，责任清单更新为已归集/删除受阻；未换壳绕过、不复制回来。此片验证仅内存，所有句柄终态后核output/.tmp无新增文件/进程，清理剩余继续保留。源码/模块导读/原四册与迁移归属随片提交普通上传，真实环境/HTTP/发布及main未执行。

<a id="core-public-management-20261115"></a>

## 无Core公共初始化、租户及人员角色管理（2026-11-15）

上阶段独立公共包/宿主已由1da9d90c10a19818991e5e9119398773435897ef提交，普通push成功，ls-remote真实回读为同一SHA；工作区/索引收口干净。main62ca仍在祖先且远端未前进。本阶段只在相同独占树推进，原schema/迁移与业务算法未改。

[公共初始化](../../../packages/platform-server/src/modules/platform/platform-initialization.ts)及[显式命令](../../../apps/platform-api/src/initialize.ts)提供实际SaaS主体、公共权限/角色和账号；口令由SEED_PLATFORM_PASSWORD进程输入，至少8位并含字母/数字，首次登录必须改密。重复执行只核原管理员可用，不重设口令/角色或恢复停用账号。缺账号明确冲突，不用已有租户当初始化成功。命令不输出口令/连接串，只公布已知输入约束或稳定驱动错误码；没有实际连接或执行该命令。

[公共管理Controller](../../../packages/platform-server/src/modules/platform/platform-management.controller.ts)→[应用服务](../../../packages/platform-server/src/modules/platform/platform-management.service.ts)→[仓储](../../../packages/platform-server/src/modules/platform/platform-management.repository.ts)→[窄存储](../../../packages/platform-server/src/modules/platform/platform-management.store.ts)已进独立模块。提供公共租户创建/资料/启停、本租户资料、本人资料、成员创建编辑/启停/重置、角色编辑/删除和已登记权限树。租户创建同事务建根组织、固定管理员角色、账号和审计，不建Rental空间/品类或给成员分配Core；临时密码只在对应创建/重置响应返回，不进审计。

当前SaaS管理与tenant管理保持分面；人员角色写入要求原租户管理员或明确全租户权限，固定全权角色不能普通编辑/删除，普通角色不能保存通配或未登记权限码，角色/组织/账号必须同租户。租户停用撤销该租户会话；成员停用/改密撤销原会话，历史与角色/Core事实不删除。与原行业人员入口并存，未把原空间覆盖角色变成公共授权。[原DTO](../../../apps/api/src/modules/platform/platform-request.dto.ts)将四项公共输入再导出同一类，业务DTO留原位。

[公共身份围栏](../../../packages/platform-server/src/modules/platform/platform-principal.authority.ts)从原Core适配抽出且无Prisma/行业依赖，锁序仍为租户/账号/会话/角色/权限，当前状态与自然期限在原事务中复验；OriginalCorePrincipalAuthority仅保留正式子出口别名。原SQLTenant.status明确处理小写存储枚举。公共Auth返回内部签名wid证据，公共Guard的workspace仍为空；围栏比较原会话签名证据，而非把旧wid当业务范围，原Rental Guard继续其原workspace证据。staff/client或请求主体不一致拒绝。下游Core管理/工单真实消费者通过完整API类型核定。

| 验证 | 结果和边界 |
| --- | --- |
| 当前公共合同、服务、宿主类型/编译 | 1根/195源、33根/815源、4根/690源，零诊断；编译JS/声明只留内存，无新dist/临时目录。宿主消费本树既有14模型真实Client声明，主Client只读复用上阶段唯一已归集成果，不复制回工作树 |
| 原完整API类型 | 987根/2,175源零诊断；原Core管理/绑定/工单消费新的公共身份围栏及同源DTO。首轮CorePrincipal的三audience类型不兼容，修为输入可表达三分面并在原身份检查拒绝非operator，未改权限规则 |
| 实际Nest公共模块+真实服务/Controller，明确离线平台表fixture | 初始化不重置、零Core租户创建、审计失败整笔回滚、成员/角色创建读写和固定/未登记/跨租户拒绝、本人资料保存读回、签名旧wid与公共workspace隔离、重置不记密码、租户冻结通过；未启动HTTP/真库 |
| 原身份/初始化拒绝定向检查 | 已存在但停用的SaaS账号拒绝初始化，不重置；当前主体撤权、staff输入及旧会话wid不符拒绝。首次fixture忽略isActive查询使拒绝断言失败，修fixture查询语义后通过，无产品放宽 |
| 同源HTTP/接口资料/DTO | Controller实际Nest元数据与政策/OpenAPI30操作/22路径一一对应，operationId及路径参数唯一、所有schema引用可解析；原DTO有效枚举正常/未知拒绝。初次metadata包含Nest默认尾斜杠，改验证路径归一后通过，未变路由 |
| 事务端口对真实14模型Client | 直接赋值类型零诊断；首轮create输入误含update专用tokenVersion.increment，改窄create输入，未造Prisma shim或绕过公共出口 |

验收仍缺独立HTTP/真库/完整后台、公共组织设置/安全和订阅/基础集成、Core主组合和安装、多Core/停用恢复、Rental可取出包、AI适配及全功能/迁移回退/独立接手/审查。本阶段没有把局部30接口和fixture当全部公共需求完成，原任务无新增跨档。所有正常路径及拒绝证据如上，仅做必要短命令和原类型，没有新增测试脚本或删除旧断言。

上阶段91,808,304字节的唯一临时环境仍在统一待清理根，删除自动审批拒绝历史与manifest见前阶段；本阶段复用声明只读，不新增/复制环境或后台进程。后续工具恢复先处理既有残留。当前源码/导读/接口资料随本阶段中文提交普通推送，真实远端回读后在本对话登记，main未集成。

<a id="core-public-host-packages-20261115"></a>

## 独立公共契约、服务包与无Core API宿主（2026-11-15）

本阶段基于已上传c4eef110e5f02e3985afdf94599cdd2a1cdb803c；真实远端main仍为62ca183f10b7c316ab63c28ef6d04ee88d06488b并在本树祖先。负责人已授权本树全权PCH施工，写入只在codex/platform-core-extraction，原公共窗口不再是阻塞。旧main、其他树和索引未操作。

- [platform-contracts](../../../packages/platform-contracts/README.md)成为50项公共声明的唯一实际源码，运行依赖为0；原shared/platform与总出口再导出同一声明。没有复制行业实体或为无Core创建业务类型。
- [platform-server](../../../packages/platform-server/README.md)接收19个原公共源码，原API路径只通过正式窄子出口兼容；公共仓储/认证/外观不导入Prisma、shared或行业API。存储以结构化PromiseLike端口接真实公共Client及原组合Client，改密与会话撤销保留同一callback事务，刷新单次消费保持原实现。
- [公共宿主](../../../apps/platform-api/README.md)显式装配唯一数据库、认证/外观、Guard/ALS、健康及文档。公共HTTP政策同源提供10路径/12操作，未登记Core/Rental/AI路由拒绝。当前Core HTTP只留明确可选接点，未接完整管理/多Core装配。
- [独立schema](../../../apps/platform-api/prisma/schema.prisma)有14公共模型/6enum，无Rental业务表或外键；保留原公共表名、账号/角色ID及可空历史关联。Client独立输出generated/client，编译后的宿主从本目录读取，未覆盖原生成物。新公共库迁移基线由实际离线migrate diff产生，旧238模型schema及原迁移链归一换行核定未变，不把新链用在已有组合库。
- 根脚本提供独立生成/构建/类型/迁移入口，公共OpenAPI可从同版本编译声明输出；模块README与原认证导读同片更新。当前没有公共Seed及完整人员/角色/订阅/基础集成实现，未提供假登录或默认管理员来补齐门槛。
- 原Core管理raw SQL读取Tenant.status实际为MySQL小写映射，已改在存储边界明确比较active/frozen/disabled；启用只接受active，原冻结/停用目标允许获权停用/只读收尾，未知状态拒绝，不默认active。原MCP fixture仅补正式公共包编译/子出口消费，原断言未删改，没有新增测试脚本。

| 实际验证 | 结果 | 边界 |
| --- | --- | --- |
| 原离线preload下的Prisma generate | 公共14模型及原238模型分别退出0，audit违规0 | 最小CLI/Wasm/runtime独占放同一临时目录，实际生成类型；未执行DB迁移或连接 |
| 实际migrate diff from-empty/to-schema script | 退出0，14表SQL落正式公共基线 | 结构SQL生成，不是应用/回退/真库验收 |
| 公共合同及服务包独立TypeScript编译 | 1及25根，0诊断，实际声明/JS输出 | 不加载旧shared/CoreHost/Rental/Prisma；无业务反向依赖 |
| 新公共宿主类型 | 3根/682源，0诊断 | 使用本树实际14模型Client声明，解析映射不造shim；实际宿主启动未验 |
| 原shared及完整API类型 | shared122根/331源；API987根/2,178源，0诊断 | 消费当前正式公共包和本树原Client；首轮验证错误禁用composite的incremental，修验证选项后通过，无产品规则放宽 |
| 实际Nest公共模块容器 | 唯一数据库/外观token、认证注入及12操作唯一通过，容器正常关闭 | 原Nest实际DI，不启动HTTP，数据库为显式offline fixture |
| 实际公共Controller/Guard/服务行为 | 无业务表fixture下登录/上下文、同ALS无workspace、外观规范化保存/再读、旧修订拒绝、原刷新撤销、未知Core/Rental/AI拒绝，退出0 | 不是实际HTTP/真库持久化；两租户/角色完整管理仍待后续 |
| 原raw SQL租户状态适配 | active/frozen/disabled/未知与启用/停用共8路径通过 | 执行真实适配、明确SQL fixture；未连接MySQL |
| 原mcp-original-audit.test.cjs | 3通过，fail/skip/todo/cancelled0，退出0，audit违规0 | 真实原服务/回调及现有断言，原fixture编译消费新包；不是OAuth/HTTP完整端到端 |
| 公共OpenAPI与lock定向核对 | 10路径/12operationId唯一、schema引用全可解析、无Rental；5workspace依赖和3新增link一致 | 离线资料/锁元数据，不是安装/发行 |

公共schema SHA-256为28d7cf037b4fd1c9f7114334e33e32e60cbb1e403d4e26f3180c1596e39ed235；正式基线SQL为b220ba5046f16900f7d475351ec466ae56c8b9c02cc5de703c8ded83784a710a。原schema归一换行与c4eef110e一致；初次原字节比较仅因既有CRLF返回false，随后按原换行规则核明，不声称原字节相同。

PCH-03满足G1的真实接点/消费者与可实施合同：独立公共包、窄存储、宿主/Guard、公共schema和原兼容消费者明确，登记25%。G2仍缺完整公共初始化/管理、Core主装配和本项正常/拒绝组合，G3/4未跨；其余任务没有因本次类型/文档数量自动升档。原外观页面最后静态断言的既有失败、所有未知/未验和原专项需求继续保留。

下一片先补独立公共初始化、租户/本人/成员角色等公共管理，沿现有正式字段和权限；再提取Core管理窄订阅/审计/事务接点及同源HTTP，公共签名wid证据与业务workspace分开复核。随后接完整后台壳、Rental可取出的包、工单/多Core、AI可选授权、安装更新和独立接手。真实HTTP/数据库/浏览器、业务全功能、迁移回退、独立审查和发布未验，不称目标完成。

定向文档检查9份/730本地链接/177锚点退出0，原12任务身份/依赖和需求正文保留。原docs:check在稀疏树退出1、17缺链，其中14目标已在固定Git但未检出；复用原检查器并以固定Git存在性补稀疏目标后只剩总导航第54行3个既有历史附件缺失，未删引用或改检查器。差异空白检查退出0。

临时环境原集中output/.tmp/platform-host-integration，最终840文件/91,808,304字节、无链接、验证进程均终态。原生删除在启动前被自动审批拒绝，原因blocked by policy；未换壳/工具绕过。按强制清理规则核定Git主树与绝对源/目标后，原生Move-Item同一份环境成功归集至D:/工作文件/rental-OS/output/.cleanup-pending/pch-preparation/platform-host-integration/environment，源目录已迁出且目标文件数/体积核对。统一责任清单位于同任务manifest.json，状态已归集，创建者为本会话；仍未删除，工具恢复后优先处理，不提交残留或清单。没有依赖安装、环境文件读取、业务连接、服务启动或main集成。

<a id="core-public-window-baseline-20261115"></a>

## 主接线窗口与既有公共差异归属核定（2026-11-15）

起点为已上传并回读的 `e56f8ab801ef1e59dee6ba625d1259f0b0036688`，实际远端main仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 且在本树祖先。工作区/索引干净，无合并/拣选，任务临时根为空；前一目标轮已完成MCP定向验证及提交，属于进展。本轮只读核定剩余主线和既有差异，不重复已通过的包/类型/审计验证或新增外围接入实现。

原公共装配源码中没有CoreHostModule/composeOriginalCoreApplication、Core管理HTTP政策/同源OpenAPI生成器或Core页面注册/路由消费，PlatformRepository的findTenantByCode/findUserForLogin仍include rentalProfile/category并返回rental_core。实际无Core公共登录/保存、当前多Core业务和Rental重新装配仍未完成；类型、独立适配与标准包不能代替这条链路。

精确核对 [公共候选窗口](#core-package-cli-public-entry-20261115) 的10个文件与main，5处已有55新增/5删除均来自固定 `982043aba913745c6d0e258b2d74ca1efb9a98d4` 的UX-TENANT-NAME-01检查点。Auth两处租户简称投影、PlatformService/Repository归一/保存/审计、shared平台简称合同及OpenAPI四个Tenant schema为已授权成果；没有借简称窗口完成Core主接线。后续PCH需从含该检查点的当前任务基线继续，保留省略/null/空字符串、审计和原字段语义，不能误称公共文件相对main完全无差异或按旧main覆盖。

主树当前索引空，上述服务端候选没有未提交WIP，但后台壳/页头/样式/业务页及其他专项仍有他人活动成果。PM现有turn已completed/notLoaded，没有针对本次主接线的新窗口或回复许可；文件暂时干净和对话终态不自动授予共享文件写权。当前Auth/Platform、Guard/RequestIdentity、shared正式平台出口、AppModule/OpenAPI窗口仍待负责人或PM核定，原主schema/迁移/Seed及AppShell/AppRouter/navigation按各自后续窗口办理。

现在需要的可执行入口仍是公共身份/租户投影与Rental兼容转接 → 原Auth/Guard/ALS受控分派 → 原服务单实例装配与同源API/后台消费。完整公共文件/方法及行为条件保留原候选表，不另建第五册、不擅改需求/任务、真实环境或合main授权。当前轮新增证据明确了实际基线和必要写权，后续没有相应窗口时不能用外围检查代替主拆分进展。

本节与接续经4份文档582个链接/157个锚点/49个表格、旧记录全文和正式需求/任务保全核对退出0，差异格式退出0；中文提交普通推送并回读，任务研发门槛不升档。没有新增测试脚本、生成环境、服务或临时残留，未主动跨对话发送消息。

收口后的阻塞复核：固定 `78bd9f115f1d08fcca69bde07b24c87eff13649b` 与实际任务远端一致，main仍62ca；工作区/索引干净，无合并/拣选，临时根条目0。前述公共写入窗口在连续目标续接中仍未核定，原主入口未消费Core接点，也没有正在运行的依赖作业可等待。已完成的独占成果及必要验证全部上传，继续主拆分须负责人或PM明确上述公共文件归属；本轮将持续目标登记为阻塞，保留完整PCH范围和原门槛，不能把重复核查或记录维护计为工程推进。恢复时先核新授权、最新main和并行WIP，再沿原公共候选顺序实施。

<a id="core-original-mcp-audit-20261115"></a>

## 公共指纹抽离后的原MCP审计定向复验（2026-11-15）

固定任务源码 `99267bf4f572e29e14c0924f35cb9132cd0ef868` 已普通推送并真实回读，main仍62ca且在本树祖先；工作区/索引干净，无合并/拣选。上一阶段已补齐当前API类型，本片补 [开工阶段](#core-contract-first-20261114) 曾被自动审批拒绝的原MCP审计定向运行，不修改产品、测试、Auth/Guard或主装配，也不扩展为MCP专项验收。

`node --no-compilation-cache -` 从stdin在本树唯一 `output/.tmp/pch-fingerprint` 准备audit及缓存，子进程实际执行原 `node --no-compilation-cache --test tests/mcp-original-audit.test.cjs`，退出0，3用例通过、fail/cancelled/skipped/todo均0。测试源码SHA-256为 `3d624247d66b391b8549efb84e3bd14b6e7fdea3683005f96ddd69c7ad7948d6`，原断言未改。使用原 [MCP身份夹具](../../../tests/fixtures/mcp/original-identity.cjs) 的工具链/输出目录参数，只读受管依赖；原 [离线preload](../../../tests/fixtures/ai-native/prisma-offline-preload.cjs)、无业务连接DSN及TEMP/TMP/写缓存均限制在本任务目录，守卫违规0。

实际 [OperationLogService](../../../apps/api/src/common/operation-log.service.ts) 与 [原OAuth审计回调](../../../apps/api/src/modules/auth/original-mcp-oauth-audit.ts) 的原scope/事件引用、可变Web ALS隔离、非法字段/accessor拒绝、原生写入失败、缺审计收据以及原grant/consent关联核对均通过。夹具采用明确的Prisma读写和Nest适配替身，不证明真实事务持久化、OAuth端到端、HTTP、业务工具授权或完整MCP可用；公共指纹自身的新旧22例仍沿开工阶段证据引用。

本任务编译、夹具和缓存在finally核绝对路径、归属与无链接后全部删除，核任务目录不存在、临时根为空，父命令退出0。没有新增测试脚本、依赖安装、服务、Prisma生成或真实数据库/模型/供应商调用。原运行拒绝历史保留，本片将这一指定用例的当前离线运行缺口补齐，不由三个用例宣布全功能正常或提升原PCH门槛。

仅维护本记录与接续，4份文档579个链接/154个锚点/49个表格、旧阶段全文及正式需求/任务保全核对退出0，差异格式退出0；中文提交普通推送任务分支并回读远端，记录版本由包含本节的Git提交定位。主公共身份/租户/装配、真实无Core登录/设置、Rental兼容、双Core持久化和独立接手仍按原公共窗口继续交付。

<a id="core-api-types-current-schema-20261115"></a>

## 当前schema与服务端接入适配的完整类型核对（2026-11-15）

固定任务源码 `57a6e673779cec3969a4ba1321f8fcce8f94ff53` 已普通推送并真实回读，main仍62ca且在本树祖先；工作区/索引干净，无合并/拣选。上一包/CLI阶段完成交付，当前目标轮继续补 [原授权管理阶段](#core-access-panels-receipts-20261115) 曾因自动审批拒绝而未取得的完整API类型证据。只做验证及原记录/接续维护，不修改主Auth/平台/Guard/shared总出口/AppModule或其他作者WIP。

`node --no-compilation-cache -` 在本树唯一 `output/.tmp/core-management-receipt` 中准备锁定Prisma5.22.0的最小生成工具链，没有复制整个node_modules、创建junction或读取其他树生成Client。按当前schema只给临时generator添加本目录output，datasource保持原MySQL定义；固定无业务连接DSN、原 [离线preload](../../../tests/fixtures/ai-native/prisma-offline-preload.cjs)、AI_OFFLINE_WRITE_ROOT/audit与TEMP/TMP/缓存均指本目录。实际Prisma generate子进程退出0，238模型的schema归一换行SHA-256为 `848c44e6a12091b85013c4babf9aae52ad8fa1697e2de1031626c57ac50d6f6f`，守卫违规0、没有环境文件加载。

使用这次生成的声明与实际Runtime类型，在内存按各包真实tsconfig依次编译shared121根、core-contracts35根、core-host8根、example-tickets-core11根、mcp-server59根，均0诊断。正式包出口/子出口及NodeNext类型条件由原包元数据解析，编译声明在内存，不依赖别树dist。随后按API真实tsconfig检查978根/2,176源，0诊断；命令退出0。当前CoreHost模块/原主体/绑定/工单适配与主工程schema的类型兼容因此已有证据，不把它称为主应用已登记、无Core构建或运行验收。

生成前后核受管Prisma引擎和包元数据摘要相同，原源码及schema未修改。生成工具、Client、缓存、临时schema/audit及所有一次性文件在finally核绝对路径、归属/无链接后删除，核目录不存在及任务临时根条目数0。没有新增测试脚本、依赖安装、服务、真实DB/HTTP/模型/供应商调用或迁移执行；内存API检查不读取环境或实例化业务服务。独立审查、完整业务行为和浏览器不在本片证据内。

原PCH门槛未跨档，主公共接线、平台独立schema/迁移/Seed、Rental兼容、无Core登录/设置和完整双Core运行仍需原窗口交付。4份文档573个链接/152个锚点/49个表格、全部旧阶段与正式需求/任务保全核对退出0，差异格式退出0；中文提交普通推送任务分支后回读固定版本，记录提交由包含本节的Git对象定位。原拒绝历史保持，当次当前API类型缺口由本节补齐，原MCP业务审计拒绝项和真实环境未验继续保留。

<a id="core-package-current-cli-20261115"></a>

## 当前工单标准包与随包资料的实际命令复验（2026-11-15）

固定源码 `5deaf63d80eb0fc294af8014efffaf637b6570fe` 已推送并真实回读，main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 且在本树祖先；工作区/索引干净，无合并/拣选。本片补齐 [随包资料阶段](#core-package-document-links-20261115) 此前因自动审批拒绝而未执行的实际包/CLI验证，沿原离线编译、标准命令及finally清理方法执行，未修改产品或绕过原检查。

`node --no-compilation-cache -` 在本树唯一 `output/.tmp/core-document-links` 中按真实tsconfig编译合同35根/工单11根，0诊断。临时合同包保留原package.json和相对exports，编译产物来自本树固定源码；依赖只读复用受管安装，Prisma仅使用事务类型声明替身，没有生成Client、复制整套依赖或读取环境文件。实际Node子进程执行 [metadata package](../../../packages/example-tickets-core/src/metadata.ts)、[prepare-install](../../../packages/core-contracts/src/prepare-install.ts)、重复prepare-install及 [check --host --json](../../../packages/core-contracts/src/check.ts) 均退出0。重复打包到同一文件退出1/EEXIST，原包摘要保持。

标准包30文件、44,879字节，SHA-256为 `98dc10837615965f073a732032dc4a7d14831aa314f224f4b8da54687a2fc5a1`；Core与底座来源均固定上述5de版本，实现版仍为开发中的0.1.0，未创建公开发行。原包摘要、包检查的package-static/compatibilityChecked、首次prepared与重复already_prepared核同，部署状态均为pending。随包OpenAPI包含8个实际声明操作，CORE_GUIDE直接链接本包API/入口，README源码引用固定到5de提交；本片验证这些实际文件，不借旧b7e包证据推定当前版本通过。

编译、输入JSON、测试包及待部署准备文件均在同一任务临时目录，finally核绝对路径、归属及无链接后删除，命令退出0；随后核目录不存在、任务临时根条目数0。没有启动业务服务、执行迁移或授权Core，没有真实GitHub Release下载、数据库、HTTP、后台或独立接手证据。包准备通过不能替代干净宿主的安装、注册、租户授权、成员分配及持久化业务链。

证据仅补本记录与接续，正式需求/任务及原门槛保持。4份文档569个链接/149个锚点/49个表格、旧阶段原文与正式需求/任务保全核对退出0，差异格式退出0；中文提交普通推送后回读任务分支，记录提交由包含本节的Git对象定位。此前标准包验证的拒绝历史原位保留，当前包/CLI未验缺口由本节证据补齐；完整API离线生成和原MCP验证的拒绝项仍按各自阶段保留，不能由本片关闭。

<a id="core-access-refresh-receipt-20261115"></a>

## Core授权结果、当前目录刷新与缓存隔离（2026-11-15）

本片起点为已上传并真实回读的 `59e93640425fcd1aadfd8219eccf5391d5013c8a`，main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 且已在本树祖先。开工工作区/索引干净，无合并/拣选；写入限独占admin/core及已有模块说明/本记录/接续。上一目标轮已交付范围更新兼容，属于进展，自动续接没有取得Auth/Platform/shared/Guard/主装配公共窗口。

实际 [CoreAccessPanel](../../../apps/admin/src/core/CoreAccessPanel.tsx) 重现已确认变更后状态读取抛错，却显示“未能确认本次操作结果”，原核对编号已经清理；同时原面板未刷新本人的Core目录。此次把可信变更及原收据确认移出读取失败的catch，当前状态和目录刷新单独收敛。Query.refetch返回isError也判为读取失败，界面常显“操作已记录，最新状态尚未读到”，暂停新变更并提供只读重试，不重新判unknown或重发授权。

本人租户授权或Core分配变化先取消变更前的目录请求，只撤去目标Core的旧可用条目，清理目标Core的业务、当前范围和绑定查询，再从原目录读取。不给其他成员/租户的管理动作清理本人的数据，不从变更收据补授权；其他Core缓存保留。目录读取本身失败仍按 [useCoreSession](../../../apps/admin/src/core/useCoreSession.ts) 的原可信查询规则处理，不能把缓存保全等同所有页面继续可用。原动作、读取、原结果核对分别标识，同步同动作共用原Promise，不同动作明确等待拒绝，避免用另一动作成功冒充已完成。

`node --no-compilation-cache -` 经stdin按真实tsconfig内存编译合同35根及前端10指定根/1,487源，0诊断、退出0；最后动作分型与旧目录取消改动后复验仍通过。只读受管依赖，正式合同声明在内存，未构建落盘或修改原公共组件。实际面板转译源码配合真实TanStack QueryClient/QueryObserver核对，按钮同步重复1次变更、不同动作拒合并；已确认后refetch的isError/目录失败单独提示，重试仅重新读取，unknown/缺收据/错键继续保留原编号、取得原收据才清理。当前租户/本人目标Core的目录及缓存变化、其他Core/其他成员/其他租户保留、英文提示和会话变化拒绝旧结果均通过，退出0。

实际查询库额外重现无缓存时invalidate会复用变更前在途目录，旧授权可能回填。按同一已获权目录键先cancelQueries，再撤旧条目和刷新，最终离线复验确认新读取发生且迟到旧结果不回填。初版reset整份目录会暂时清空所有Core，改为仅撤目标条目后核其余Core目录/缓存保留；产品不放宽查询失败、服务端授权或历史/unknown规则。上述React Hook/JSX和数据为离线输入，无真实React DOM、Portal、HTTP、数据库、跨设备撤权或完整后台验收证据。

已有 [接入说明](../../../apps/admin/src/core/README.md#管理core开通与成员分配) 同片更新确认结果、只读恢复、目标缓存与目录边界，没有新增第五册或测试脚本。5份文档586个链接/146个锚点/50个表格、旧阶段正文和正式需求/任务保全核对退出0，差异格式退出0；本树任务临时根为空，没有新增依赖、Client生成、临时文件或后台进程。原PCH门槛未跨档，中文提交普通推送任务分支后回读固定版本，提交由包含本节的Git对象定位。

主线只读复核仍没有消费CoreHostModule、Core管理HTTP政策、Core页面路由/导航；PlatformRepository登录/租户投影仍include Rental档案/品类。后续独立宿主必须沿 [公共服务端窗口](#core-package-cli-public-entry-20261115) 抽公共投影/身份及原主装配，真实schema/迁移/后台壳按各自窗口接线。本片不能代替主拆分、全功能对照、真实运行/升级、独立接手或主线集成；此前自动审批拒绝的实际打包和完整API验证保持原未验范围。

<a id="core-update-scope-compatibility-20261115"></a>

## 普通Core更新保留业务范围与原绑定（2026-11-15）

本片起点 `e9429debe28682f8945e81afec67397e5da9536d` 已推送并回读，实际远端main仍62ca且在本树祖先；工作区/索引干净，无合并/拣选。上一目标轮已交付原绑定可读修正，属于进展。公共服务端窗口没有新授权，继续独占合同中的实际升级缺口，不将自动续接当共享文件写入许可。

按真实 [planCoreUpdate](../../../packages/core-contracts/src/update.ts) 重现同Core的小版本更新：实现/提交/摘要前进、数据和迁移不变，但scope从tenant改为project容器时仍返回candidate。后续范围/绑定服务会拒绝原租户绑定，普通更新成功的预检与原绑定保留要求不一致。正式R04/R12及 [范围迁移边界](平台Core接入-开发任务.md#independent-upgrades) 已要求保留原业务范围与绑定，改变业务容器属于专门迁移。

预检在所选Core的原清单与候选清单之间核对scope，租户/容器互换及容器类型变化返回 `scope_changed`，字段定位 `release.manifest.scope`。使用原同源元数据比较，不新增版本轴、迁移执行器或宽泛兜底；同范围正常修复、平台更新、其他Core与用户配置保持原语义。源码注释解释原绑定为何不能直接套新范围，契约README同步实际错误处理步骤。

`node --no-compilation-cache -` 按真实tsconfig内存编译合同35根，0诊断、退出0；实际编译产物核对三类范围变化均拒绝，输入未修改。同tenant/同project正常修复、前进迁移、底座单独更新和unknown迁移与固定前像结果完全相同，未选择Core/平台版本保持。另一stdin运行实际plan-update命令转译源码，JSON单份结果与文本原因都包含scope_changed并设置退出码1，验证命令退出0；输入文件读取及stdout是离线替身，没有真实CLI子进程、版本更新或迁移执行证据。

本片没有新增测试脚本、临时文件、构建落盘、依赖或后台进程。5份文档623个链接/153个锚点/55个表格、旧记录全文和正式需求/任务保全核对退出0，差异格式退出0，任务临时根为空；按原任务门槛不升档。仅交付合同源码、原模块README及本记录/接续；中文提交普通推送后回读固定任务分支。独立宿主主接线、真库/浏览器、实际发行/更新和独立接手仍待完成，自动审批拒绝的实际打包/完整API验证沿原记录保留。

<a id="core-tickets-binding-readability-20261115"></a>

## 工单兼容更新与原绑定可读范围（2026-11-15）

本片从已上传并回读的 `34b44a49fb108547cb05cf4e8ea799514efb6911` 继续，实际远端main仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b` 且在本树祖先。4份已核归属的工单源码WIP在原独占树收口；暂存区为空，无合并/拣选，不进入尚未开放的Auth/Platform/shared总出口/Guard/AppModule及后台壳窗口。

实际 [CoreBindingService](../../../packages/core-host/src/binding.ts) 已按清单可读范围复用原绑定，但 [工单服务端](../../../packages/example-tickets-core/src/server.ts) 和 [原业务组合](../../../apps/api/src/modules/core-host/original-tickets-host.ts) 原先只接受绑定版精确等于当前数据版。此次从 [工单合同](../../../packages/example-tickets-core/src/contracts.ts) 正式导出 `TICKETS_DATA_READABLE`，清单、就绪读取和原业务适配共同消费；原可读范围数值不变。原绑定的初始化版与当前物理库/迁移观察分别核验，不修改实现版、迁移SQL、业务权限、订阅、事务或历史收据。

`node --no-compilation-cache -` 经stdin按真实tsconfig内存编译合同35根/宿主8根/工单11根，0诊断、退出0；依赖只读复用受管安装，正式合同声明产物在内存，Prisma仅事务类型声明替身。最初验证映射遗漏TypeScript声明导致19诊断、退出1，补正确声明路径后复验通过，未改产品或放宽检查。该证据不含原完整API类型或生成Client。

实际工单server/manifest、部署目录及CoreBindingService的离线输入退出0。可读上下界分别为ready/unavailable；一个标明为离线的0.1.1候选实现/数据继续使用0.1.0、revision=7及原bindingId，初始化和绑定写入均0。新设置收据保留旧绑定版及本次执行版，同键重读不增加收据，撤权和unknown迁移拒绝。首次unknown输入遗漏必需migration导致schema拒绝、退出1，补真实合同所需字段后验证原迁移拒绝通过；不把该候选当真实升级、发行或完整planCoreUpdate验收。

另一stdin定向验证实际原工单工厂 → ALS签名身份 → 原权限/人员锁 → Core租户授权/成员分配 → 部署迁移 → 原绑定 → 工单读取，退出0。0.1.0/0.1.9绑定可读，0.0.9/0.2.0拒绝且未读取业务；未完迁移、成员撤权、租户Core停用、缺业务权限、账号失效及签名租户不符均拒绝。停用后本人原收据仍可按原规则核对，bindingId/revision不变，业务写入、审计写入、生成Client加载均0。SQL事务和数据是离线输入，不证明真实数据库、HTTP、后台或权限部署已验收。

两份已有模块README同步说明原绑定/可读范围/物理版本/执行版本及恢复边界，不另建接入手册原稿。正式PCH门槛未跨档；下一关键主线仍为 [公共服务端窗口](#core-package-cli-public-entry-20261115) 中的公共身份/租户投影、Auth/Guard与原主装配，不能以本片兼容修正代替无Core运行。此前实际打包/清理和完整API离线生成遭自动审批拒绝的未验范围继续保留。

本片无新增测试脚本、临时目录、依赖、客户端生成或后台进程。6份相关文档620个链接/153个锚点/51个表格、旧阶段原文与正式需求/任务保全核对退出0，差异格式退出0；最初stdin文档命令多写括号、退出1，修命令后通过，未改检查器或删引用。精确暂存这4份源码、两份模块README及原记录/接续，中文提交并普通推送后回读任务分支。固定版本由包含本节的Git提交定位，主线集成和真实独立宿主验收仍待完成。

<a id="core-tickets-detail-actions-20261115"></a>

## 工单详情分派表单与原操作核对（2026-11-15）

本片从已上传并回读的 `fd0247bd3c7fd5e2b4d0427ab51ac1ebf57b89b4`继续，main仍62ca。写入限独占工单admin页及已有模块说明/本记录/接续，不进入公共Auth/平台/Guard/shared/AppModule或原后台壳；实际公共窗口仍未开放。上一原身份片已交付，当前不是新运行授权。

[详情页](../../../packages/example-tickets-core/admin/index.tsx)的分派表单改用原useCoreForm，按钮与回车共用submit，去掉本页另存dirty状态。工单对象key隔离编辑器；同页分派/开始/关闭等待只合并同动作和同schema输入，不拿另一请求成功替代当前动作。unknown用同步原操作引用阻止未重渲染旧回调再次发送，仅提供原键读取；记录最近已确认修订，当前详情落后时先重读。处理/关闭成功不清分派草稿，分派原收据确认也须当前受派者输入仍与原操作相同才清稿。

业务响应先校验可信原收据，再将相关查询标脏并只refetch当前详情。TanStack的refetch返回isError时明确判读取失败；保存已记录结果与随后读取错误分开，刷新失败不把原业务改成unknown、不重发，页面显示中英文重新读取提示并暂停新动作。重读成功恢复当前资料，原对象/权限/幂等和领域状态规则未改。

`node --no-compilation-cache -`经stdin对实际详情页与useCoreForm/原schema运行定向离线输入，按钮/回车一POST、同Promise、不同动作/输入拒合并、unknown旧回调不重发、原收据缺失/错键拒绝、等待中另一个受派者草稿保留、处理/关闭原结果不清分派草稿、刷新isError提示和只读恢复、撤权及对象key均通过，退出0。前端12指定根/1,498源与合同35根内存类型0诊断。后续刷新语义调整后相关行为和类型再次退出0；离线Hook/组件替身不是原React DOM、Portal、浏览器或真实HTTP/数据库证据。

本片复用上一阶段已经读取的后台规则、Form/SaveButton和查询库源码，未新增测试脚本、依赖、临时目录、Client或后台进程。两份模块资料同步解释实际表单/unknown/刷新边界。正式任务门槛未跨档，原公共主接线、真实持久化/浏览器、独立接手和全部原功能对照继续待交付。阶段中文提交普通推送任务分支并回读远端，固定版本由包含本节的提交定位。

收口核对六份相关文档597个本地链接/147个锚点/52个表格，新增问题0，正式需求/任务及旧阶段原文保全检查退出0；差异格式退出0。仅暂存本片工单admin源码、两份已有模块README和本记录/接续，当前任务临时根为空。完整API、实际React/Portal/浏览器、数据库与主线集成仍未验，不由本片类型/离线验证代替。

<a id="core-principal-sql-runtime-20261115"></a>

## Core原身份SQL模板依赖解耦（2026-11-15）

本片起点为已推送并回读的 `2ec5e40f82ab36b65c5cbb8420943d317f7f9bc5`，main仍62ca且已在本树祖先。工作区/索引干净、无合并/拣选；PM当前任务已结束且没有新公共文件授权，未把自动目标续接当Auth/Platform/shared总出口/Guard/AppModule窗口。

[OriginalCorePrincipalAuthority](../../../apps/api/src/modules/core-host/original-core-principal.ts)为5处参数化模板运行时import顶层Prisma，从而加载组合库生成Client。此次仅改为type-import事务模型与现有 `@prisma/client/runtime/library` 的sqltag。原Prisma5生成器源码将Prisma.sql再导出为runtime.sqltag，已有MySQL适配也使用相同Runtime；不更换ORM、生成器或驱动，不改变SQL/值、人员/租户/角色锁顺序及返回前的会话期限复核。

`node --no-compilation-cache -`经stdin对固定前像和本片真实转译代码运行同一实际ALS/SQL Runtime输入，15条正常/拒绝/恢复对照完全相同，包括角色/权限固定顺序、签名主体不符、跨分面、过期/锁后到期、撤销/切换会话、账号失效、目标不存在/冻结以及停用成员撤回。实际转译输出5处模板使用sqltag、顶层Client加载计数0，查询/返回/异常状态和消息均与前像一致，退出0。测试事务输入是离线替身，无数据库/HTTP/生产授权证据。

函数业务正文按原前像仅替换Prisma.sql引用后核同；原RequestIdentity、平台仓储/服务/会话、公共合同和主装配未改。本片没有生成客户端或安装/运行环境，完整API新版本类型仍沿原被拒绝项保持未验，不用转译/SQL等价证据替代。必要源码说明和原模块导读同步，无新增测试脚本、临时目录、依赖或后台进程。五份相关文档565个本地链接/139个锚点、正式需求/任务及旧阶段正文保全核对退出0，差异格式退出0。原PCH门槛不变；中文提交普通推送任务分支并回读远端，固定版本由包含本节的提交定位。

<a id="core-list-pagination-20261115"></a>

## Core标准列表与工单同范围分页（2026-11-15）

从已普通推送并回读的 `0990e14c1195ec3cdc325f83e7ab51c3cc49770b`继续，main仍62ca且已在本树祖先。原后台规则、现有Table/QueryState/分页及工单权限链核定后，沿独占admin/core和工单样例实现本片；未进入Auth/平台/shared总出口/Guard/主装配或主树WIP。复用已装antd离线CLI核Table6.6.0 API与基本例子，无安装/网络。

[CoreList](../../../apps/admin/src/core/CoreList.tsx)通过正式admin/core出口组合原ListSection、Table和QueryState，只收业务列/rowKey、同范围rows/total、查询键和分页状态。服务端一页不二次本地截取或排序；首次加载保留表头/筛选及原数据区骨架，首次读取失败不冒充刷新，旧行读取中/失败暂停操作。空末页根据真实total只读回有效页，条数变化沿原Table回首页。没有新Table/分页样式或通用业务查询引擎。

[工单唯一合同](../../../packages/example-tickets-core/src/contracts.ts)增加TicketPageQuerySchema/TicketPageSchema及类型；原ListTickets数组和10万offset限制保留，新分页入口独立接受安全整数offset。[MySQL](../../../packages/example-tickets-core/src/mysql.ts)用同一个visibleWhere供旧列表与新分页，单条CTE的可见集合被正文和COUNT共同使用，租户/成员创建者或受派者/状态条件一致；LEFT JOIN保留空末页总数，严格工单对象不带total。read.all仍只读本租户，读取不写业务/收据/审计。

[领域服务](../../../packages/example-tickets-core/src/service.ts)→[Nest](../../../packages/example-tickets-core/src/nest.ts)新增page，复用当前read准入；[HTTP/OpenAPI](../../../packages/example-tickets-core/src/http.ts)从同源声明生成8政策/7路径8操作。未知audience和参数沿原拒绝，旧GET tickets及正式原收据不改。[工单页面](../../../packages/example-tickets-core/admin/index.tsx)实际改用CoreList和/ticket-pages，默认20、状态筛选回首页、offset/limit进入同一Core会话查询键，移除本页私拼分页按钮。

必要验证经stdin/内存。合同35根、工单11根0诊断；前端14指定根/1,498源0诊断。实际SQL适配→领域→Nest核同范围总数/正文、bigint、空末页/零总数、缺总数/超精度拒绝、旧offset兼容、非法参数/客户分面拒绝以及同源政策/OpenAPI通过。CoreList→原QueryState/Table核首次骨架/首次网络失败、已读后刷新失败、分页/总数/末页只读纠正及零总数通过；工单TicketsPage→CoreList另核正式路径、页码/条数、筛选回首页、查询键与新建导航通过。均退出0，没有真实HTTP/数据库/浏览器证据。

早期验证把8操作与7路径混算退出1，修计数后通过。收口复核发现总数仍可能带入严格工单解析，分离后非空/空末页定向复验退出0，未放宽schema。原 `audit-admin-components.cjs --json`只读核263个来源文件，badHashes为0。源码说明、最小列表例子与API表同步；没有新增测试脚本、临时环境、依赖、Client生成或服务。公共主接线和实际持久化/浏览器/无Core宿主仍未验，原任务门槛不变。

最终合同35根/工单11根类型复验退出0；七份相关文档652个本地链接/155个锚点/58个表格、旧阶段及正式需求/任务原文保全检查退出0，差异格式退出0。实际能力索引4,503条、issues为0，CoreList用途、正式导入及工单admin直接消费者可定位，新增GET ticket-pages指到实际Nest page方法；索引是源码发现证据，不是接口已部署。阶段中文提交普通推送任务分支并回读真实远端，固定版本由包含本节的提交定位；工作树只保留正式成果，任务临时目录为空。

<a id="core-package-document-links-20261115"></a>

## 随包指南入口与固定源码链接（2026-11-15）

起点为已上传并回读的 `d989f46b833282e50f2ca5f268b8be5316c86629`，main仍62ca且已在本树祖先；开工时本树工作区/索引干净，无合并/拣选。公共服务端窗口没有新增授权，本片限独占Core合同、工单打包消费者及已有说明/记录/接续。

实际生成原指南核对12处链接，当前五步都是固定章节引用，没有已失效相对链；缺口是包内API/源码入口只有文字路径。[renderCoreGuide](../../../packages/core-contracts/src/guide.ts)新增服务端/后台/API及按清单存在的AI/作业/事件入口链接，README/LICENSE保留在本包，原五步、Agent模板与尚未完成宿主的支持状态保留。正式 `pinCoreDocumentationLinks`按原源码文件定位本地资料链接到固定提交，保留外链、围栏和行内代码，整篇README可保留本页锚点；越出源码根拒绝。生成过程不访问网络或执行文档命令。

[工单打包](../../../packages/example-tickets-core/src/package.ts)复用同一正式出口，移除本包重复的README链接转换；清单/API生成、文件集合、摘要和大小/路径检查继续原规则。源码说明与两包README同步，没有新增第五册或另写指南原稿。

`node --no-compilation-cache -`经stdin按真实tsconfig内存编译合同35根/工单11根，0诊断；实际生成指南17处链接，其中5处包内入口均属于corePackageFiles声明集合。工单README30处链接按固定来源生成；锚点/相对源码/含空格/外链/围栏/行内示例、可选贡献、越界与缺原章节反例通过，退出0。此证据为生成器及打包消费者的类型/链接，不代表本版本实际文件打包、安装或独立接手完成。

临时编译目录、实际工单打包及finally清理命令被自动审批在启动前拒绝，返回 `blocked by policy`。现场确认 `output/.tmp/core-document-links`未创建，未换壳、改清理方法或使用别树产物绕过；当前打包函数/归档内字节及实际CLI的新版本复验保持未验，旧b7e固定证据沿原阶段引用。完整包复验待执行条件恢复，内存生成结果不关闭该缺口。

本片无新增测试脚本、临时目录、依赖或后台进程，正式任务门槛未跨档。六份相关文档618个本地链接/153个锚点/57个表格、旧阶段及正式任务/需求原文保全核对退出0，差异格式退出0。阶段中文提交普通推送任务分支并回读远端，固定版本由包含本节的提交定位；原主Auth/平台/Guard/装配、全功能对照、数据库/浏览器、独立接手及主线集成继续待交付。

<a id="core-form-submission-20261115"></a>

## Core表单提交与工单新建页消费（2026-11-15）

本片起点为已推送并回读 `5d8baee8c256b6fd34b06c0fe3213f6d6ddfc233`，main仍62ca。沿独占admin/core和工单样例落实最少页面声明，不改原壳/顶栏/组件vendor或公共服务端窗口。写前复核原后台规则、界面规范及Form/SaveButton/保存快照的实际链；复用antd技能的已装离线CLI核Form6.6.0 API及基础示例，没有安装或更新依赖。

[useCoreForm](../../../apps/admin/src/core/useCoreForm.ts)消费原FormInstance、CorePageHost、保存快照和原反馈，新增正式admin/core出口。原Form/SaveButton校验后共用submit，同输入重入返回同Promise，不同输入等待；提交前和结果返回核当前页面/权限，成功只清本次对应草稿，异步校验和等待期间新输入继续dirty。原onFinish不等待Promise，Hook事件出口负责失败反馈，submit仍真实拒绝；dirty/busy/error及markClean供页面使用，后者仅由业务可信原结果确认时调用。没有通用JSON执行或业务错误猜测/自动重试。

[工单新建页](../../../packages/example-tickets-core/admin/index.tsx)实际消费该出口与formProps，移除本页重复提交Promise/等待和dirty管理。工单保留唯一schema转换、原operationId、明确提交前拒绝及unknown核对；成功/unknown同步引用分别阻止未重渲染时重复创建或重发，同一原收据取得后才清草稿和进入原工单。顶部仍使用CorePage原SaveButton，不复制样式。

必要类型经stdin/内存读取本树源码与已有只读依赖，14指定前端根/1,497源、0诊断；合同35根内存声明同时通过。实际Hook和原ServerFormSnapshot离线核对同Promise/按钮回车一请求、不同输入等待、失败保留、恢复原值、校验/等待中新输入、撤权/离页、一次失败反馈及可信结果清稿通过。真实工单新建页→Hook→原schema/请求替身另核一POST、同步完成拒重复、unknown重渲染前拒重发、缺收据保持阻断、两次原键只读及草稿解除，退出0。离线Hook/组件输入不是React DOM、原portal或实际浏览器验收。

最初类型映射误读React运行文件并漏Vite/Animate UI正式类型，验证退出1；只修读取映射后0诊断。工单组件输入漏Input.TextArea替身退出1，补验证输入后通过；产品类型、业务拒绝和原断言未放宽。现有接入手册补实际最小Hook/表单例子及unknown边界，能力索引沿正式出口发现，无新逐文件台账。新增测试脚本、临时目录、依赖、Client生成及后台进程为0；完整主Router/Guard、浏览器回车/portal/无Core运行仍待原窗口和验收，任务门槛未跨档。

收口复核避免订阅原SaveButton通知误清校验中新字段：Hook按本次已校验输入自行维护草稿，继续调用原通知；顶部动作明确关联editor.busy。改后相关Hook反例和前端类型复验退出0，仍1,497源/0诊断。实际开发索引4,493条/0 issues，useCoreForm唯一正式导入为 `@rental-os/admin/core`，直接消费者定位工单admin；用途说明附于函数。七份相关文档633个链接/152个锚点/58个表格、旧阶段及需求/任务保全检查退出0，差异格式退出0。阶段中文提交普通推送任务分支并回读远端，原测试成果按固定版本复用，无新增环境或残留。

<a id="core-tickets-removal-data-20261115"></a>

## 工单移除依赖读取与原宿主消费（2026-11-15）

原账/物理观察阶段已普通推送并回读 `f877570796a4a586a30c825cb0f9c0fb0d289506`，main仍62ca。本片在独占工单MySQL/服务端贡献、原core-host工单适配及已有模块说明中接通实际移除阻碍，不修改公共窗口或原平台/Core业务规则。

[readTicketsRemoval](../../../packages/example-tickets-core/src/mysql.ts)先复用真实3表结构检查，再以一条参数化SELECT EXISTS读取未关闭工单、保留工单和原操作收据的存在性，部署检查全Core，可选租户只限定观察。未关闭返回in_flight，历史/收据返回history；缺结构unknown，不完整存在性或驱动失败明确报错。没有明细数据输出、业务写入、关闭/取消/清表或停用操作，保留历史不阻止停用。

[服务端贡献](../../../packages/example-tickets-core/src/server.ts)允许真实authority提供assessRemoval，缺少时仍保持原缺检查器拒绝。[原工单工厂](../../../apps/api/src/modules/core-host/original-tickets-host.ts)绑定本MySQL读取，组合时不查询或建立业务事务。[CoreRemovalService](../../../packages/core-host/src/removal.ts)继续汇合平台实际停新/完整依赖；空Core数据仍不能绕过平台未停新或依赖不完整，原历史存在时不可移除代码。

`node --no-compilation-cache -`按真实tsconfig内存编译合同35根、宿主8根、工单11根，0诊断；从唯一工单迁移SQL解析3表/17列/2CHECK/复合键作为离线结构输入，实际SQL读取→服务端贡献→CoreRemovalService及原工厂消费验证退出0。空/未关闭/历史/收据、指定租户三处参数、非法租户读前拒绝、缺结构unknown、不完整结果拒绝、平台accepting和complete=false均通过。原工厂实际转译源码在只读依赖替身下提供检查，组合和检查没有业务事务；这不是全API类型或真实授权/DB证据。

首次离线输入解析漏列COLLATE，命令退出1，修验证解析后复验退出0，产品规则和原断言未放宽。必要源码备注和工单/原适配说明同步；本片无新增测试脚本、临时目录、依赖、Client生成或后台进程。前片原8组合同行为证据沿f877固定版本复用，未扩大回归。七份文档599个本地链接/144个锚点、旧阶段正文及正式需求/任务保全核对退出0，差异格式检查退出0。阶段中文提交普通推送任务分支、回读远端；正式任务门槛不变，真实移除流程/原平台Source/主应用运行仍未验。

<a id="core-mysql-data-observation-20261115"></a>

## 原Prisma迁移账、工单物理观察与部署准入（2026-11-15）

起点为已推送并回读的 `fbbb3babeb8d36fd7f37f7d05d15c104263d4ece`，main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`且已在本树祖先。本片完成前像WIP的真实读取与消费者验证，只改独占Core合同/宿主/工单模块及本记录/接续；公共Auth/Platform/shared总出口/Guard/AppModule窗口仍未取得，不将自动目标续接当其授权。

[物理观察合同](../../../packages/core-contracts/src/update.ts)仅增加数据所有者读取实际结构后返回的版本/时间/SHA-256，不泄漏Prisma。[MySQL观察](../../../packages/core-host/src/mysql-deployment.ts)通过正式Node子出口读取原 `_prisma_migrations`，按模块对应原migration_name，保留原checksum与执行顺序、不按清单重排。rolled-back不算应用，未结束按原logs为failed或unknown，未读取applied_steps_count去猜DDL进度。缺/损坏/重复Core证据只使所属观察不可用，公共平台缺观察拒绝新Core准入；驱动错误向上传递。没有新迁移账、DDL、Client生成或默认成功。

[部署目录](../../../packages/core-host/src/deployment.ts)传入目标Core给Source，普通准入只读平台与目标Core，省略目标时读取全组合供升级预检。原无参数Source仍可供给完整观察，既有消费者保持兼容；实际MySQLSource减少无关结构查询，目标Core可用性不必读取另一Core的故障元数据。

[工单MySQL](../../../packages/example-tickets-core/src/mysql.ts)已有 `readTicketsPhysicalData`实际生产者，读取三表、17列、关键复合索引、2个受执行CHECK和2列原操作FK。核类型/空值/排序规则/事务引擎及键顺序，允许非唯一调优索引，额外唯一/业务约束不冒充同版。简单CHECK按有限表达式结构解析，支持冗余括号、MySQL `_utf8mb4`及本版字符包装，拒绝把 `revision >= (1 and revision) <= ...`误当正确上下限。元数据bigint摘要保留原整数。物理结构满足后才返回本数据版本；仍需原完整迁移账匹配才能放行。

`node --no-compilation-cache -`经stdin按各包真实tsconfig内存编译：合同35根、宿主8根、工单11根，0诊断。实际产物消费原SQL Runtime→工单结构读取→原账Source→部署目录requireAvailable及planCoreUpdate，正常组合通过；14种结构拒绝、原摘要不匹配、缺收据、unknown/failed、rolled-back、重复、损坏、原账顺序、平台缺观察/未完及双Core隔离通过。缺表/坏收据的工单不影响另一已就绪Core；没有业务方法、真实HTTP/DB或供应商调用。

首次类型命令遗漏工单原装饰器与正式子出口，退出1；修验证配置后0诊断，后续行为命令误写升级函数名退出1，核正式 `planCoreUpdate` 后完整复验退出0。产品校验和原断言未放宽。必要源码说明和两包简明接入例子同步，主公共物理检查/迁移映射与运行组合仍按后续唯一作者窗口；本片不证明全平台代码可理解性或独立宿主已完成，原任务门槛未跨档。

目标读取优化后再次按真实tsconfig内存编译三包，仍35/8/11根、0诊断；实际目录准入仅查询平台和目标Core的原账及结构，另一Core结构读取抛错不影响目标准入，全组合升级检查仍报告该错误。原checksum/缺收据/unknown/failed/rolled-back/重复、平台未完和目标缺观察的相关路径复验退出0。

原 `node --no-compilation-cache --test packages/core-contracts/test/core-contracts.test.cjs`退出0，8组通过，skip/todo为0，临时编译/夹具由原after删除并核实不存在。七份相关文档的本地链接/锚点/表格和旧阶段正文保全检查退出0，格式检查退出0；正式需求/任务未改，门槛仍8.33%。本片新增测试脚本、常驻临时目录、依赖安装、生成客户端和后台进程为0。阶段中文提交普通推送当前任务分支并读取真实远端，固定版本由包含本阶段记录的提交定位；实际数据库/宿主运行及主线集成未验。

<a id="core-tickets-first-setup-20261115"></a>

## 工单首次设置与标准绑定页面消费（2026-11-15）

原公共服务端窗口核对固定 `32e4202cb1b31c121a857720d36ae56b527d555f` 已上传并回读，main仍62ca。本次自动续接没有收到对上一轮公共文件窗口问题的回答，沿独占admin/core、Core合同和工单样例继续完成可独立交付的实际接入缺口，不进入原Auth/Guard/AppModule/shared总出口或main活动WIP。

[useCoreBinding](../../../apps/admin/src/core/useCoreBinding.ts)消费原绑定/当前事实/收据HTTP，先核当前租户管理权、成员Core使用权与实际绑定，首次配置调用原服务，已有绑定直接复用。未知结果保留原键只读核对，sessionStorage仅保存Core/容器/operationId，不保存初始化配置或权限；范围/身份代次变化拒绝旧响应，同步双击共用一个Promise。当前绑定跨租户/范围拒绝，成功刷新绑定后仅将范围查询标脏，下一访问重新核实际就绪，避免设置响应途中重挂旧页。

[工单设置页](../../../packages/example-tickets-core/admin/index.tsx)作为第四个页面贡献，声明purpose=configuration并给出中英文单源名称，使用CorePage原主按钮；工单无额外配置，首次设置只调用平台绑定。未获租户管理权不提供写入动作，已设置返回工单导航；未知只提供原设置读取。主路由/Guard仍未装配，不能称完整可运行工单接入。[源码索引](../../../packages/core-contracts/src/repository-index.ts)同步解析正式CorePageText，配置页双语名称和purpose准确可发现。

stdin必要类型：Core合同35根、工单11根、前端3指定根/1,491源0诊断。真实Hook源码经离线输入核一次初始化、重入只读/缺收据不重发、不保存配置、原收据匹配、已有revision=7不重新初始化、同步双击同Promise、会话切换拒旧结果和管理撤权均通过；两个独立新操作各发送1次，原结果读取2次，没有真实HTTP/DB/浏览器。早期核对将同步拒绝当Promise拒绝、脚本module变量遮蔽及顶层await格式误用退出1，修核对脚本后通过，产品业务校验/原断言未放宽。

工单四页按原registerCoreAdminPages核对，设置purpose/英文标题、首次初始化动作、未知仅原收据和已有绑定导航通过；登记不执行业务。当前实际索引4,486条、issues0，3,632条缺直接用途说明及5条动态元数据仍保留。配置路径准确为 `/cores/example-tickets/setup`，注册状态仍source；无Core全平台源码/运行/接口验收未完成。

实际短说明同步平台绑定Hook和工单“开通→成员分配→首次设置→业务”路径，原三页旧锚点保留。主公共文件窗口仍是后续独立宿主必要条件，上一轮已交付具体范围待负责人/PM核定，不重复索取权限或跨对话通知。当前PCH门槛未跨下一档，验证经stdin/内存，不新增测试脚本、服务或生成环境。

原8组合同测试退出0、skip/todo为0；六份相关文档564个链接/136个章节锚点定向核对退出0，新增问题0，正式需求/任务百分比不变。差异格式检查退出0，原测试临时编译/夹具已清理确认，其他新增临时目录/服务进程为0。阶段中文提交普通推送后读取真实远端固定版本。

<a id="core-package-cli-public-entry-20261115"></a>

## 固定工单包命令实测与下一公共服务端入口（2026-11-15）

工单包及Git根定位固定于 `9a31c9c08c6b9478f491c6b18d173a02d2015568`、`b7e95bd13562f752ff48dd6f2983061c7c2a5c2b`，均已普通推送并读取真实远端确认。当前main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。按固定b7e版本对实际编译文件和正式包元数据完成独立Node子进程核对，没有用facade成功替代本次命令结果。

在本树唯一 `output/.tmp/example-tickets-package`编译合同35根和工单11根，0类型诊断；临时contract包保留原package.json/相对exports，不复制依赖。实际执行metadata package、prepare-install、重复prepare-install及check --host --json均退出0，重复输出同一包退出1/EEXIST且原包保留。完整工单包30文件、35,640字节，SHA-256为 `785ff9c6e7a87f07df5c68ef0ef6301295dc39f58b4eeca8b4067f023ae895cd`，Core/底座来源固定b7e，README/手册引用固定源码。准备状态仍为pending，不是运行安装、租户授权或真实业务验收。

第一轮子进程核对的临时包布局误将exports改成绝对路径，Node返回ERR_INVALID_PACKAGE_TARGET，退出1；只修临时布局为真实包内相对出口后复验通过，产品包元数据未改。失败的101文件694,348字节、成功的131文件903,322字节均在同一任务目录finally核绝对归属/无链接后删除，并确认目录不存在；没有累计环境、重复压缩包、node_modules或进程。

### 需要核定的公共服务端窗口

当前非冲突实现已提供统一原应用/Nest装配、HTTP政策、授权/绑定/原结果、本人Core目录/真实范围和页面接入；继续创建脱离原主应用的入口不能完成PCH-03。正式依据和当前接续均要求公共文件由唯一作者持有，当前未收到新的窗口授权。下列范围是根据main62ca源码核出的下一实施入口，不是已经修改或取得写入权。

| 公共文件与原方法 | 已核实际依赖及应交付的行为 |
| --- | --- |
| [PlatformRepository](../../../apps/api/src/modules/platform/platform.repository.ts)：findUserForLogin/findTenantByCode/getTenant及原账号/会话映射 | 登录和公共租户读取仍include rentalProfile/category，租户摘要还统计Rental订单。先抽公共身份/租户投影及人员/会话仓储，Rental档案/空间/订单由显式业务适配补充，保留原password/账号状态/角色/撤权/审计和旧调用者行为 |
| [PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)：findUserForLogin/findTenantByIdForAuth/listUserWorkspaces/resolveSessionWorkspaceId及bootstrapTenant | 原通用服务仍注入Rental、持有演示品类/权限并在初始化中调用Rental。公共身份和租户创建须可不加载行业表/Seed；原Rental初始化走显式Core绑定与同事务适配，不能把原回调改可选成功或用合成空间补运行 |
| [AuthService](../../../apps/api/src/modules/auth/auth.service.ts)：login/issueSession/buildLoginResponse/getSessionContext/resolveAccessContext | 原签名/会话/轮换继续复用。品类、空间和capability组装拆为Rental贡献；无Core operator会话合法且公共设置可用，staff/client仍按原专用身份，旧wid/会话切换、撤权及旧Rental角色映射不放宽 |
| [ApiAuthGuard](../../../apps/api/src/common/api-auth.guard.ts)及[请求身份](../../../apps/api/src/common/request-identity.ts) | 当前普通请求默认用Rental空间user，新Core公共管理/业务须使用原同一签名上下文的tenantUser，并保留原accessSession/wid一致性。精确消费Core管理政策、会话GET、范围POST及http注册目录；未知路径/分面拒绝，原Rental/locationScope政策继续原位 |
| [共享平台合同](../../../packages/shared/src/platform.ts)/[包出口](../../../packages/shared/package.json)/[shared总出口](../../../packages/shared/src/index.ts) | 平台文件仍含行业枚举并type-import core。独立平台身份/租户/人员合同从唯一原声明抽取，旧出口兼容再导出，独立构建用正式中性出口，不复制DTO或按类型检查使用私有路径 |
| [AppModule](../../../apps/api/src/app.module.ts)/[OpenAPI总组合](../../../apps/api/src/contracts/openapi-document.ts) | 原根模块仍直接登记行业Controller/作业及原服务。以原实例的明确模块出口装配CoreHostModule和选中业务HTTP，统一消费同源OpenAPI，无Core不加载未选Core或行业作业；避免子模块重复创建Auth/DB或循环引用 |

主schema/迁移/Seed的全量抽离、前端AppShell/AppRouter/navigation及主品牌/UI活动WIP属于后续单独窗口，当前不抢改。上述服务端窗口取得后，先交公共投影/接口与Rental兼容转接，再推进独立模块/构建，随后原Guard/装配接线；真实数据库/服务/浏览器、迁移执行及合main仍按目标环境另行授权。原任务、前置和验收不因窗口准备而改变。

此处仅补本片实际命令证据与公共依赖，需求/任务百分比保持8.33%的原G1登记。本轮未主动跨对话发消息，完整范围留原记录和接续供负责人/PM读取；没有把PM的历史窗口或他人活动HEAD当新授权。

四册516个本地链接/130个章节锚点定向核对退出0，新增错误0；正式需求/任务正文和8.33%门槛登记不变，差异格式检查退出0。当前任务树新增验证临时目录已全部删除、无新增服务进程，未触碰main索引或后台作者WIP。证据/接续随本阶段中文提交普通推送并读取真实远端确认；共享服务端作者窗口仍需负责人或PM对当前具体范围核定。

<a id="core-tickets-package-20261115"></a>

## 实际工单标准包、同源资料与待部署准备（2026-11-15）

移除预检片固定 `7f7ea9634574683757d88c662324ed234da63ee5` 已普通推送并真实回读，main仍62ca。本片以实际工单编译产物验证标准包，不使用原格式夹具代替业务样例。源码/合同独占范围及现有版本/迁移保持，未发布正式发行。

[packTicketsPackage](../../../packages/example-tickets-core/src/package.ts)按唯一清单收集实际编译入口、后台TSX、迁移和许可，生成固定来源清单、同源OpenAPI和CORE_GUIDE.md。包README的源码/底座相对链接转换为固定源码引用，原README不另写一份。Node专用出口与CLI不进入领域运行入口，Core业务不因打包加载Node文件系统/归档依赖。

[metadata package](../../../packages/example-tickets-core/src/metadata.ts)增加同源标准包命令，pack:core前置构建当前Core/合同并检查固定提交与当前源码差异，拒绝未提交源码冒充发行。新.tgz使用wx写入、输出父目录无链接，失败不覆盖原包；准备仍沿平台同一inspect/archive/prepare链，结果准确为deployment=pending。最短命令及独立发行调用说明写[示范README](../../../packages/example-tickets-core/README.md#构建与打包)。

stdin内存类型退出0，Core合同35根/宿主7根/工单11根0诊断。实际编译集合形成30份声明文件，最终35,617字节标准归档，相同输入两次SHA-256相同；全部正式exports入口存在，迁移摘要一致，标准包静态检查通过。固定任务册生成的模板实际正文存在，包README无失效本地相对源码链接。最初额外断言误要求生成指南保留任务册内部core-agent-template锚点而退出1，核原生成器明确只抽正文后按真实模板正文复验通过，没有修改产品规则或已有测试掩盖失败。

实际packTicketsPackage→标准archive读回→prepareCoreInstall在本树单一 `output/.tmp/example-tickets-package`完成，prepared→同包already_prepared核字节复用；篡改已准备README拒绝覆盖，缺dist/http.js拒绝打包。没有网络、业务模块执行、迁移或运行安装，包完整性不等于干净宿主已授权可用。本次仅测编译包及待部署文件准备，真实GitHub发行/下载、主宿主/Guard、实际数据库/浏览器和独立接手继续待验。

临时目录只含本次stage/pending文件，finally核真实绝对路径/普通文件/无链接后删除并确认不存在，未保存重复整包、依赖或环境。打包节点源码纳入现有样例正式出口，不新增测试运行器/脚本；代码/API/简单手册随片更新。当前PCH门槛未跨下一档，固定来源字节为本次工作区核对输入而非正式发布包，最后提交后需按该固定来源再构建。

Core合同/宿主/示范包补正式typesVersions，Node10/CommonJS和NodeNext从实际包exports元数据解析；35/7/11根编译以发布元数据定位，私有Core别名为0。CLI通过stdin文件facade核单份JSON、源码差异先拒绝、wx新包写入及写失败清理，退出0，facade与真实包/prepare证据分别记录。最后一次包验证的57份临时文件294,913字节已删除并确认；未复制依赖或安装工具，package-lock的依赖元数据不变。

原8组合同测试退出0、skip/todo为0；六份相关文档591个链接/142个章节锚点定向核对退出0，新增问题0，原需求/任务及百分比保持。差异格式检查退出0。固定成果随中文提交普通推送，真实远端回读后继续按该提交准备正式发行，当前没有真实GitHub Release或运行安装验收。

后续实际隔离构建核对准备中，将metadata包命令的仓库根定位改为git rev-parse --show-toplevel，避免自定义编译目录依赖两级父路径假设。stdin命令facade核固定Git原文和根定位退出0；不改打包/授权语义，源码根变更随本阶段补充提交上传，真实子进程验证在该固定提交后进行。

<a id="core-removal-preflight-20261115"></a>

## Core移除依赖预检与原SaaS身份复核（2026-11-15）

HTTP政策片固定 `d34db2491f140e54bd7e9c0fa52183459642feb2` 已上传并真实回读，main仍62ca。本片按原05生命周期范围实现只读移除检查，沿独占合同/宿主/API Core适配提供实际消费者；不把部署级移除与租户停用、成员撤权或订阅到期混同。

[CoreRemovalService](../../../packages/core-host/src/removal.ts)汇合Core自有assessRemoval和平台准入/任务/回调/作业/历史依赖观察。缺Core检查器、准入accepting/unknown及平台依赖未完整核对都blocked，原结果不得借超时/无活动进程推断未执行。错误结构/错误Core原操作拒绝。只有stopped、完整及零阻碍时clear；clear是当前只读预检，不执行停新/排空/删除/迁移或授权部署。

[正式观察合同](../../../packages/core-contracts/src/lifecycle.ts)复用原blockers并增加平台观察及预检投影，HTTP/OpenAPI增加十一管理操作中的removal/read。[原reader](../../../apps/api/src/modules/core-host/original-core-removal.ts)在检查前后复核原SaaS主体及租户管理权，跨Core检查不持人员锁；应用工厂只在真实platformRemoval Source提供时组合，缺依赖Controller503，普通业务不被迫安装空适配。

stdin内存类型/实际服务与原主体核对退出0，合同35根、宿主7根、HTTP4根0诊断。缺检查器blocked、完整停新无阻碍clear、unknown/未停新/不完整多阻碍、错误贡献/异Core原操作拒绝通过；平台当前观察在Core检查后读取。原SaaS ALS/主体检查前后8次原账号读取、SQL/审计写入0，检查中角色撤回拒绝，缺平台reader503通过。OpenAPI十一操作同源生成，返回clear的限制明确写入资料。

真实平台排空、停止新准入、AI/回调/作业/历史各所有者的完整依赖Source、实际数据库/HTTP和部署移除尚未完成。工单未提供移除检查器时准确blocked，不写恒真检查。原完整API类型仍沿前片审批拒绝边界，当前PCH进度未跨下一档，主共享入口授权未扩大。代码及短说明同片维护，验证经stdin/内存无新增测试脚本或运行环境。

原8组合同测试退出0、skip/todo为0；七份相关文档607个链接/138个锚点定向核对退出0，新增问题0，正式需求/任务及百分比不变。差异格式检查退出0，原测试临时编译/夹具已清理核实，无新增进程或生成环境。固定成果随包含本节的中文Git提交上传，并以真实远端回读确认。

<a id="core-http-policy-registration-20261115"></a>

## Core HTTP政策标准登记与原身份准入（2026-11-15）

统一应用工厂固定 `d32735f01dabf5a148c29b281285e596c837d480` 已推送并真实回读，main仍62ca。本片沿独占Core合同/宿主、工单样例及API Core适配，将新Core HTTP方法/权限政策留在Core自身合同，避免每次业务开发修改底座Guard判断。

[HTTP政策合同](../../../packages/core-contracts/src/http.ts)定义Core/版本及自身路由、audiences、精确权限、business/original_receipt和新业务标记。registerCoreHttpRoutes只登记当前贡献，未知路由/分面不返回政策；重复、版本不符、权限未声明和同形/静态参数重叠拒绝。匹配沿原Express大小写与隐式HEAD，GET/HEAD重叠禁止；返回目录隔离副本、方法在组合后固定。旧Rental例外继续原兼容政策，不能由新Core自行占用。

[工单TICKETS_HTTP](../../../packages/example-tickets-core/src/http.ts)同时生成七条HTTP政策和[同源OpenAPI](../../../packages/example-tickets-core/src/openapi.ts)扩展，创建为新业务，收据为原结果读取，其余沿原业务。Nest方法/参数/schema及工单领域行为保持，没有额外手写权限表。

[实际部署目录](../../../packages/core-host/src/deployment.ts)接受可选HTTP贡献并核当前Core/版本/声明集合；没HTTP的Core可以省略，未登记路径仍拒绝。原应用工厂供给该同一目录及[authorizeHttp](../../../apps/api/src/modules/core-host/original-core-http-access.ts)，主Guard在原签名/ALS后消费当前租户主体、精确角色权、Core/成员授权及原订阅停新。原结果粗准入不要求重开业务，最终本人操作和对象可见性仍交原Core收据服务。当前只实现operator，staff/client需自身固定身份适配，清单不自授权。

stdin内存类型与实际合同/原主体调用退出0：合同35根、宿主6根、工单10根和HTTP4根均0诊断。7条工单HTTP/OpenAPI权限/分面/用途/新业务元数据一致，空目录/错误Core/版本/未知权限/路径/分面、重叠GET/HEAD及目录外部修改拒绝通过。末尾控制字符不匹配，GET的HEAD沿同一权限。

沿实际原ALS/主体/授权/订阅适配的离线SQL驱动，正常新建、过期新建403、旧只读、停用仅原收据、角色撤回和未知路由在SQL前拒绝均通过；31次SQL读取、2次新业务期限读取、SQL/审计写入0。原收据最终范围由工单原服务继续核定，当前没有真实Guard调用或DB/HTTP运行证据。

模块说明同步最短Core贡献和宿主接入步骤。主Auth/Guard、AppModule、数据迁移账及后台壳仍待已登记公共窗口；不以政策存在替代已接线接口，不改原业务、AI专项或原任务范围，当前PCH进度未跨下一档。验证经stdin/内存，没有新测试脚本、临时目录、服务或模型调用。

原8组合同测试退出0、skip/todo为0；八份相关文档621个链接/139个章节锚点定向核对退出0，新增问题0，正式需求/任务和已登记进度不变。差异格式检查退出0，原测试临时编译/夹具已删除确认，未新增生成Client或后台进程。中文提交/任务分支普通推送后读取真实远端固定版本。

<a id="core-application-assembly-20261115"></a>

## 原Core应用统一装配与Nest依赖可见性（2026-11-15）

原G1复核固定 `a64aa357ac72bb62085558fe58816dea79260a44` 已上传并回读，当前main仍 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。本片沿原API Core适配独占范围实现真实应用组合；原AppModule、Auth/Guard、主schema及后台壳公共窗口未扩大，其他作者WIP保留。

[composeOriginalCoreApplication](../../../apps/api/src/modules/core-host/original-core-application.ts)组合已有原管理、绑定、当前事实、SaaS目录、成员目录与范围读取，统一使用原数据库、人员仓储、订阅、审计和一个受控部署目录。组合期间无数据库查询、初始化或作业启动。行业业务仍在所属Core组合，通用装配不自动引入工单/Rental。

[CoreHostModule](../../../apps/api/src/modules/core-host/core-host.module.ts)将三个Controller装配到原Nest容器，单一工厂提供同一应用实例；子provider从该实例取得管理、成员目录和范围reader。CoreManagementHttpApplication改为公共Core应用服务的必要方法集合，HTTP层不依赖原ORM适配的ReturnType。原三个单独DynamicModule入口仍可用，不与总模块重复挂相同Controller。

实际核出Nest模块可见性要求：父AppModule的本地provider不会自动供给子模块。主窗口须将既有原实例通过导出模块提供给CoreHostModule的imports/inject，不能另建Auth/数据库/审计，不能把原类名存在视为已装配。实际短接入例子及边界已写[本模块说明](../../../apps/api/src/modules/core-host/README.md#从一个应用工厂装配)。

| 必要验证 | 实际结果及边界 |
| --- | --- |
| `node --no-compilation-cache -`内存类型 | 退出0；Core合同34根/宿主6根/HTTP模块4根580源0诊断，HTTP闭包不读取原Prisma模型；全API类型仍沿此前审批拒绝保持未验 |
| 实际Nest TestingModule容器与三Controller | 退出0；应用工厂1次，Controller3个解析到同一实例；管理/会话/范围调用传递正确，缺原依赖导出时明确解析失败；容器close完成，没有监听HTTP端口或启动服务 |
| 实际原应用工厂/原ALS/主体与离线事务输入 | 退出0；组合时数据库/用户读取0、写入0；实际原主体链9次账号读取、25次SQL读取、SQL/审计写入0；空Core会话、SaaS目录、当前事实和原收据缺失准确，租户访问SaaS目录403 |

上述运行只读复用已锁定依赖，Prisma仅使用原runtime SQL模板，没有生成/读取别树Client、连接真实库、读取环境文件或启动服务。测试/核对经stdin和内存编译，未新增测试脚本和一次性磁盘目录。原全API离线生成审批拒绝、主Guard接线、主模块服务导出、原授权/绑定迁移账、完整无Core运行、Rental兼容和实际浏览器仍待后续公共片，当前原PCH进度未跨下一档。

五份相关文档514个链接/124个章节锚点定向核对退出0，新问题0；正式需求/任务与原进度不变，差异格式检查退出0。没有临时目录、进程或生成客户端产物。本片固定版本由包含本节的中文Git提交定位，任务分支普通推送后读取真实远端确认。

<a id="pch-identity-page-gate-20261115"></a>

## 身份与后台页面原G1门槛复核（2026-11-15）

声明路由片固定 `3cc35e9050dd58381d54ec0d1708e85e58faa613` 已普通推送并实际回读一致，main62ca已在本树。按原G1“获准实施后完成该项真实接点/消费者及可实施合同复核”核收04/07各25%。这不是G2主实现或G3正式装配完成，原A03/A07和完整专项验收仍未收口。01/02原G1保持，12项等权覆盖率从4.17%更新为8.33%；任务ID/范围/依赖/顺序和每档25%不改。

| 原任务 | G1固定证据与真实消费者 | 未跨下一档的缺口 |
| --- | --- | --- |
| PCH-04 | [原Auth/Guard/ALS及数据连接](#core-ownership-baseline-20261114)、[原主体/当前管理权](#core-original-management-20261115)、租户授权/成员分配及原收据的唯一合同与MySQL应用服务、[当前成员目录](#core-session-directory-20261115)、[Core范围读取](#core-scope-readiness-20261115)和工单真实主体消费已可定位；原audience/租户/会话/角色、目标成员、Core命名空间及返前复验均有正式接点 | 原Auth/Guard消费租户公共主体与新Core路由、Rental存量映射、实际迁移/部署、API/客户端/作业/AI直接URL的完整正常/拒绝链和所需真实环境未完成；G2/G3/G4不凭独立适配通过提前判定 |
| PCH-07 | [原后台壳/导航/缓存消费者](#core-ownership-baseline-20261114)已定位；独占CorePage/Route消费原PageHeading/WorkspaceHeader和ActionButton/SaveButton/ConfirmAction，授权面、会话/范围Hook、[单源菜单/面包屑及详情参数](#core-declarative-routes-20261115)和工单三页面按同一正式合同核对；普通业务/配置purpose及来源/授权/就绪分别表达 | 原壳/Rental/AI静态依赖抽离、主Router/菜单/面包屑/租户账号页挂载、发现安装与版本界面、无Core真实登录和公共设置保存、中英文/窄屏/Portal/回车/异步动作实页及完整验收未完成；不把局部React消费者当全后台主实现 |

03尚缺实际无Core公共宿主及选中Core构建配置的完整合同/消费者复核；05/06尚缺排空/移除、事件作业/回调、文件ACL等公共接点消费；08/09尚缺Rental真实重新装配和可选AI隔离；10/11/12的样例/资料虽随片准备，其干净组合、独立接手/更新/完整兼容和原审查仍有直接缺口。本次不按新增代码/测试数提高这些任务。

当前Guard精确缺口已核源码：`requiredPermissions`未消费十条Core管理合同，SaaS允许路径也未登记；Core会话GET和范围POST须作为原已登录operator自助政策精确登记。`canActivate`当前普通请求选择accessContext.user（Rental空间角色），Core公共管理应使用同一已签名上下文的tenantUser并保留accessSession/wid一致性、撤权与未知路径拒绝。旧Rental仍沿原空间和locationScope，不借Core接口放宽。所需Auth/Guard窗口和下面装配表由PM核定唯一作者，当前没有抢改共享文件。

主装配需把Core管理、会话、范围三个DynamicModule与真实原服务/部署锁组合；工单HTTP另按其七条操作登记，OpenAPI总组合消费对应单源生成器。DB最小片仅登记平台Core授权/绑定独立迁移账和选中工单迁移，不重放原历史SQL或执行Seed。前端最小片为原Routes展开createCoreRouteElements、原壳消费coreNavigationEntries/coreBreadcrumbEntries、原租户/账号页挂载授权面；原AppShell/BusinessShell/PageHeader/designTokens等在main仍有后台作者WIP，需先固定作者交接。

本次仅门槛复核及原三册当前现场同步，没有新业务源码、生成环境或服务操作。固定记录提供证据与缺口，不扩大共享文件授权。正式任务日常仅更改有据百分比及汇总。

四册485个链接及121个章节锚点定向核对退出0，新增错误0；12任务的ID/交付/前置/需求/验收列与前一固定版本一致，仅04/07百分比及算术汇总更新。12项等权 `(25+25+25+25)/12=8.33%`，正式验收仍0/12。差异格式检查退出0，无新增临时文件/进程，文档阶段中文提交及任务分支普通推送并回读真实远端。

<a id="core-declarative-routes-20261115"></a>

## Core路由、导航与详情参数的声明消费（2026-11-15）

范围就绪片固定 `756a53ed34b370ce9edf9ee1131c65e71c321fe1` 已普通推送并真实回读，main仍62ca。本片沿独占合同/admin/core及工单样例消费现有Router、会话和范围Hook，不改AppShell/AppRouter/navigation等原公共文件。

[createCoreRouteElements](../../../apps/admin/src/core/CoreRoutes.tsx)从受控页面登记生成原Route元素，先核本人Core/页面权限，再读真实范围和就绪。无权/失败不挂载业务正文，普通业务要求ready；Core可明确声明自己的configuration页面，在已获权且范围读取成功的未绑定/缺配置状态进入，动作和正式写入仍独立授权。主壳、PageHeading/WorkspaceHeader及原按钮继续使用，不创建第二套后台框架。

原Router匹配的登记参数通过可选routeParams和CorePageHost.params提供，真实binding通过同一host提供。当前授权修订、角色权限、绑定、容器和路由对象进入业务代次，变化时清理旧页动作/表单。工单 `createTicketsAdmin()`默认详情直接读取登记ticketId，不再要求作者手写宿主详情注入；旧可选详情组件仍兼容。

[导航生成](../../../packages/core-contracts/src/navigation.ts)从同一页面名称/菜单/父级及当前本人Core权限生成菜单和面包屑。参数详情不直接成为菜单，未获权Core不出现，父页无权仅显示名称不带链接。配置purpose进入同源开发资料；正式页面声明没有执行JSON表达式或另存一套菜单字段。

stdin内存编译/实际合同及路由调用退出0，Core合同34根、工单10根和前端3指定根/1,489源类型0诊断。无/已获权Core菜单、同源父级、无权父链接去除、已匹配详情参数、真实绑定供给、绑定修订变化更换页代次、无权不挂业务、未绑定配置页可进入及失败范围不挂载均通过。实际调用的是源码的原Route元素和适配方法，运行器只提供离线Hook输入；没有真实浏览器、主装配或Portal/Router宿主证据。

模块说明提供最短宿主装配与Core详情用法，主公共窗口仍须一次性消费新Route元素及导航/面包屑，不将新增Core的业务接入责任下放为修改底座内部。完整后台壳/无Core登录和设置、原Rental兼容、真实数据/浏览器与独立接手仍未完成，后续原任务门槛不凭本片代码增加。

原8组合同测试退出0、skip/todo为0；七份相关文档575个本地链接/125个章节锚点核对退出0，新增错误0，正式需求/任务正文保持。差异格式检查退出0，原测试临时编译/夹具已删除核实，没有新增测试脚本或服务进程。固定成果由包含本节的中文Git提交定位，任务分支普通推送后读取真实远端确认。

<a id="core-scope-readiness-20261115"></a>

## Core自身范围与真实就绪读取（2026-11-15）

会话目录片固定 `e127cef166395c6bdfa6ffb3a9142ac518208ffe` 已普通推送并回读一致，main仍62ca。本片按原02/04/05/07接点，在原独占合同/API Core适配/admin/core交付范围/就绪读取，公共入口窗口未扩大。

[范围合同](../../../packages/core-contracts/src/scope-http.ts)和服务端CoreScopeResolutionSchema提供唯一输入/输出及同源OpenAPI。当前operator只传Core及可选自身容器，原租户来自会话；unbound与真实bound/readiness分开。Core范围结构、历史绑定数据版本和就绪结果均沿正式合同验证，不使用静态清单或恒真适配证明业务可用。

[原范围组合](../../../apps/api/src/modules/core-host/original-core-scope.ts)在短事务先核原会话和当前Core/成员使用权，结束锁事务后调用Core自有resolveScope/readReadiness，再复核当前身份、授权和绑定。Core的绑定必须属于当前租户/范围，读取期间绑定修订/数据版本变化返回冲突。Core可能自持事务，跨该调用不持外层人员/授权锁，避免现有工单范围适配嵌套死锁；最终业务调用仍独立复验。对应[Controller](../../../apps/api/src/modules/core-host/core-scope.controller.ts)和OpenAPI只提供读取，不执行初始化。

[useCoreScope](../../../apps/admin/src/core/useCoreScope.ts)与原HTTP复用原认证/会话代次及范围查询键；响应不符当前租户/Core/容器明确拒绝。未验证或失败读取不返回旧绑定/ready，真实绑定且Core声明ready时才给出ready；页面角色仍由useCoreSession判定。相关模块说明和短接入用法同片维护。

stdin内存编译/实际组合定向验证退出0，合同33根/宿主6根类型0诊断；ready/配置缺项/未绑定、缺成员在调用Core前拒绝、跨租户/错误容器/异范围绑定拒绝、绑定并发变更冲突、未知范围结构及错误就绪贡献拒绝通过。Core调用均在父锁事务之外，11次绑定读取/11次lease复核；补充历史绑定0.2.0超出当前可读范围的拒绝通过，没有真实DB或业务写入。

前端正式Core入口2根/1,484源0类型诊断，Hook实际调用的ready、未验证/失败隐藏及异租户响应拒绝通过。开发索引当前4,458条、issues0，3,611条无直接用途和5条动态元数据缺口保留；新范围POST标记source。原完整API离线生成被审批拒绝的前片边界继续保留，当前Controller只做语法/登记定向核对，没有新完整API类型或浏览器证据。

下一公共入口为CoreScopeHttpModule.register(reader)、原Guard对应精确只读政策、OpenAPI总组合及主后台壳/路由消费当前目录、范围和就绪。无Core真实独立构建/登录/保存、完整Rental兼容、生命周期及独立接手仍未完成，不以新包和离线结果提升原后续任务门槛。

原唯一8组合同测试退出0、skip/todo为0；七份相关文档571个链接及120个章节锚点定向核对退出0，新增错误0，正式需求/任务正文保留。差异格式检查退出0，合同临时编译/夹具已由原after删除并核实；没有新增一次性脚本、进程或生成环境。本片固定版本由包含本节的中文Git提交定位，普通推送后读取实际远端确认。

<a id="core-session-directory-20261115"></a>

## 登录成员的Core目录与管理候选（2026-11-15）

授权管理片固定 `f97bb4c220100bf9c22c76428170077c116706c6` 已推送并读取实际远端一致，main仍62ca。本片继续在原独占Core合同、API适配和admin/core提供登录后目录消费，不修改原Auth/Guard、主装配、schema和后台作者WIP。

[会话目录合同](../../../packages/core-contracts/src/session-http.ts)通过正式出口提供当前租户/成员、已开通且本人获分配Core、原授权修订、精确业务权限及租户管理分配候选。只读GET不接收客户端主体字段；空Core目录合法。新增`canUseCorePage`只判断成员使用权与精确页面权限，数据范围/绑定/业务就绪仍由自身宿主接点核验。OpenAPI从同源schema生成，现有十个管理操作保持。

[原会话读取](../../../apps/api/src/modules/core-host/original-core-session.ts)复用OriginalCorePrincipalAuthority及原人员/角色锁，本租户授权和本人分配按复合条件读取；只登记获权Core，不返回平台通配符或其他Core权限。当前租户管理者另外读取已开通Core的分配候选，候选不是本人业务权。返回前复核同一会话及权限，等待期间撤回管理/业务权限会收窄输出。空受控组合不查询Core授权表、写入为0。[独立Controller](../../../apps/api/src/modules/core-host/core-session.controller.ts)由CoreSessionHttpModule.register(reader)装配。

[useCoreSession](../../../apps/admin/src/core/useCoreSession.ts)和[原HTTP消费](../../../apps/admin/src/core/management-client.ts)把当前目录接到原认证/查询缓存；tenant/member/session代次进入查询键，未验证会话和失败读取不暴露旧目录供页面授权。后台可据准确目录提示联系SaaS开通或联系租户管理者分配，Core配置/就绪另核。原AppShell/AppRouter仍需按公共窗口消费，目录源码存在不表示无Core后台已经实际运行。

stdin内存编译/实际函数调用退出0，合同32根0诊断；本人Core/精确页面权限、管理候选隔离、返回前撤权、成员撤回隐藏、空组合不查询Core表均通过，8次授权SQL读取、5次原lease返回前复核、写入0。OpenAPI生成及严格错误范围核对通过。原会话authority沿已验证实现复用，当前新reader验证使用离线事务输入，没有真实DB或新API全量类型证据。

前端正式Core入口2根/1,482源类型0诊断；单源GET路径与Hook核对退出0，未验证/失败读取均隐藏目录，精确权限判定成立。实际开发索引重新读取4,451条，issues0，5条动态元数据及3,604条无直接用途说明继续待整理；新GET明确标记为source，未冒称主应用登记。现有测试脚本未新增，验证经stdin内存运行，没有创建临时环境或进程。

下一公共接点为原Guard显式登记当前GET自助政策、AppModule提供原reader、OpenAPI总组合消费同源生成器、后台主路由/菜单消费当前Core目录及实际绑定/就绪。完整API离线生成仍沿前片审批拒绝边界保持未验，真实数据库/浏览器/无Core运行、完整Rental兼容和独立接手仍未完成，原PCH进度未跨下一档。

原8组合同测试退出0、skip/todo为0；七份相关文档559个链接和118个章节锚点定向核对退出0，新增错误0，正式需求/任务正文保持原值。差异格式检查退出0，原合同临时编译/夹具由原after删除并核实，本片无新增临时目录或进程。固定提交由包含本节的中文Git提交定位，普通推送后读取真实远端确认。

<a id="core-access-panels-receipts-20261115"></a>

## Core授权管理面与原操作只读核对（2026-11-15）

索引覆盖/部署快照片固定 `6ccf30ab8ef52df83db4a49e17af17330f3ef885` 已普通推送并读取真实远端一致，main仍62ca。本片沿已授权的独占core-contracts/core-host、API Core适配与admin/core施工，主壳/主路由/AuthGuard/AppModule/原schema未取得新的公共窗口。

[管理服务](../../../packages/core-host/src/access.ts)新增租户授权和成员分配两种本人原operationId读取，复用同一当前管理lease。原主体、目标租户/Core、成员、操作类型与原键分别核对；已停用的部署不要求重新开通才能查原结果。MySQL只锁已有锁行并读原收据，不创建锁/事实/收据/审计。`unavailable`只表示原结果暂未取得，不证明未提交。两个新HTTP输入/输出在[单源合同](../../../packages/core-contracts/src/management-http.ts)定义，[Controller](../../../apps/api/src/modules/core-host/core-management.controller.ts)和OpenAPI生成器同步消费，现有八条路径保留，增加两条原结果读取。

[CoreAccessPanel](../../../apps/admin/src/core/CoreAccessPanel.tsx)提供可嵌入原租户资料和成员资料的两个聚焦管理面，通过[正式admin/core出口](../../../apps/admin/src/core/index.ts)供宿主消费。可见面沿原已验证会话/SaaS或租户管理权；先读当前事实及修订，开通/分配使用原ActionButton，停用/撤回使用原ConfirmAction。按钮成功只来自真实Promise，原结果和当前状态分开显示，不复制样式或加第二个路由离开拦截器。

[管理HTTP消费](../../../apps/admin/src/core/management-client.ts)复用原认证/刷新/信封和当前会话代次，发送前解析输入、读取后解析响应。页面发送前保存原请求定位到本标签sessionStorage，以原主体/租户/对象/Core隔离；缓存不授予权限。网络/未知结果后只读原操作，刷新或重新进入恢复核对引用；收据暂缺继续锁住新的变更，匹配原键/对象/修订/状态后清除引用并另读当前事实。明确提交前拒绝才解除本次核对引用。主应用没有原宿主接线时不能将面板显示为可办理。

| 必要验证 | 实际结果及边界 |
| --- | --- |
| `node --no-compilation-cache -`合同/宿主内存类型与真实MySQL适配读取 | 退出0，31/6根0诊断；原结果两种读取、缺收据、异主体/异成员拒绝和当前管理撤权通过，10次SQL读取、3次lease返回前复核、写入0、审计新增0；没有真实数据库连接 |
| 同源HTTP/OpenAPI及Controller定向核对 | 退出0，十条原合同路径和Controller登记一致，OpenAPI十操作同源生成；Controller语法0诊断，完整API新版本类型未取得 |
| admin/core正式消费者类型闭包 | 退出0，2个指定根/1,480源0诊断；先前稀疏Vite声明解析缺失和查询联合类型/HTTP方法大小写错误已定位并修复后复验，未放宽类型或删除规则 |
| 原源码经stdin内存编译的HTTP与组件调用 | 退出0，错误/跨租户字段/迟到会话/预中止零调用验证通过；网络未知只发送1次，页面重建只读核对，缺收据保持引用，第2次原收据匹配后清除引用并刷新当前状态1次；当前权限撤回呈现拒绝，实际浏览器未验 |
| 原唯一合同测试 | 退出0，8组通过，skip/todo为0；没有新增或扩写测试脚本，原临时编译/夹具已删除核实 |

全API离线Prisma生成/类型及退出清理的单一命令在启动前被自动审批拒绝，返回`blocked by policy`，无进程退出码；`output/.tmp/core-management-receipt`未创建并已核实。本片不换壳、替换生成器或使用主树生成Client绕过拒绝，完整API类型保持未验。antd技能的CLI在本机未找到，按本轮禁止安装规则改读已锁定6.6.0类型和现有适配源码，不安装/升级工具。

主Guard、AppModule/OpenAPI总组合、实际存储/迁移账、原租户/账号页挂载、当前获权Core目录与绑定配置页、真实浏览器/数据库/无Core运行仍有缺口。当前面板输入来自实际目录，不提供自造默认Core或成员。原PCH门槛尚未跨下一档；代码、模块说明、API资料及本册同片维护，临时验证脚本均经stdin、不落地。

八份现行/模块说明定向核对562个链接及117个章节锚点，退出0，新增错误0；正式需求/任务正文、12项任务身份和原百分比保留。差异格式检查退出0，原合同测试临时目录已删除，审批拒绝的临时目录从未创建；本片未新增后台进程、一次性脚本或重复环境。该阶段由包含本节的中文Git提交定位，普通推送并回读远端后在本对话保留固定SHA。

<a id="core-index-deployment-snapshot-20261115"></a>

## 开发索引覆盖范围与部署目录快照（2026-11-15）

当前事实读取固定 `de60b689910847e0680a74e7bc77c410394b058c` 已推送并读取真实远端一致，main仍为 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`。本片只改独占Core合同/宿主和对应说明，原公共文件窗口继续按接续办理。

[源码索引](../../../packages/core-contracts/src/repository-index.ts)将Git跟踪的workspace和独立客户端包清单与实际检出范围核对。未检出的包列为notPresent，已检出但未进入workspace扫描的独立包列为partial，不能以当前目录存在就认定全平台已覆盖。Git检出同时提供workingTreeChanged，明确当前源码可能包含未提交修改；`--check`发现issues、partial或notPresent时退出1，普通查询仍可取得已读取能力。实际用法同步到[契约包说明](../../../packages/core-contracts/README.md#找到平台已有的功能)。

[部署目录](../../../packages/core-host/src/deployment.ts)在组合时解析清单快照、保存绑定原服务实例的方法引用，并为目录调用方返回隔离清单。原输入、返回Map及其中的清单被修改时，不改变当前部署登记；Core仓储与业务状态仍由原服务实时读取。此处固定登记版本和方法，实际升级通过重新核定组合完成。用途及限制同步到[宿主说明](../../../packages/core-host/README.md#当前部署注册)。

| 必要核对 | 实际结果及边界 |
| --- | --- |
| `node --no-compilation-cache --test packages/core-contracts/test/core-contracts.test.cjs`，NODE_PATH只读定位已锁定依赖 | 退出0，原8组全部通过，skip/todo为0；临时编译/夹具由原after删除并确认 |
| `node --no-compilation-cache -`内存编译与实际源码查询 | 退出0，CoreContracts31根/CoreHost6根均0类型诊断；4,435条，issues为0，5条动态元数据和3,589条无直接用途说明仍待整理，SaveButton单项JSON为1,690字节 |
| 同一查询覆盖与CLI核对 | 六个未检出包分别为enterprise-portal、miniprogram、staff-miniprogram、tenant-website、website-next及harness-plugin；全部明确标记，workingTreeChanged=true；精确Auth接口查询的检查模式退出1且JSON可解析 |
| 同一部署目录反例 | 修改原输入/返回Map/嵌套清单后登记保持；替换原方法后仍调用组合时方法，原实例的实时状态仍可变化；初始化一次，空组合及目标Core独立拒绝通过 |

最初内存类型核对缺少稀疏树的Prisma运行时声明映射，退出1；随后只读引用已锁定的library.d.ts完成0诊断。CLI内存运行器一度把Node内置模块误当编译文件，退出1；仅修核对加载器的内置模块分支后复验通过。没有修改产品校验或已有断言来隐藏失败。persistent Node工具在初始化内核前返回路径不存在，本片最终经stdin完成验证，未依赖该工具建立环境。

本片未新增测试脚本、依赖安装、Prisma生成、服务进程或数据库调用；stdin编译和目录核对只保留内存结果。未检出及动态元数据不等于已完成全平台说明。真实主应用装配、无Core运行、浏览器、数据库、独立接手及原后续任务验收继续列为缺口，原PCH进度未跨下一档。

六份相关文档定向核对522个本地链接和113个章节锚点，退出0，新增错误为0，正式需求/任务正文及12项进度保持原值。原`docs:check`退出1，稀疏树17处缺链中的14处在固定Git中存在，另外3处仍是总导航第54行既有历史附件缺失；固定Git补足范围后白名单核查只余原3处。定向核对曾因全仓文件列表超过Node默认缓冲区而退出1，改为按链接查固定Git对象后通过，未修改检查器。差异格式检查退出0，原测试临时目录已删除核实，本片无新增临时残留。

<a id="core-management-current-reads-20261115"></a>

## Core管理当前事实与修订读取（2026-11-15）

源码导读/直接消费者索引固定 `7064f15787d03a256523d7217e7df8b6563b4094` 已推送回读。管理变更必须取得当前授权/成员分配/绑定修订，本片补[原管理读取](../../../apps/api/src/modules/core-host/original-core-management-reads.ts)，输入/输出与三个HTTP路径沿原[单源合同](../../../packages/core-contracts/src/management-http.ts)登记，Controller和OpenAPI生成自动消费。

SaaS管理者可读指定租户Core授权，原租户管理者仅能读本租户成员及范围绑定。当前会话/人员/角色先锁，读取事实后再核当前权限和自然期限。停用及撤回事实保留原修订，缺记录返回unavailable。绑定定位带Core/租户/容器，读取未初始化或提交业务。

stdin运行真实原ALS、身份和读取组合，离线事务驱动核授权修订7、成员撤回修订4、绑定修订1、缺记录、分面越权拒绝、已撤销会话拒绝及零写，退出0。实际OpenAPI自动生成8条管理路径，新接口资料与原schema一致。主AppModule/Guard和后台消费仍待公共窗口，真实HTTP/DB证据按宿主阶段取得。

Shared121/合同31/宿主6/工单10/MCP59和API970根/2,163源完整类型0诊断。Prisma本树schema独占无引擎生成退出0/守卫0违规，35个临时文件38,375,949字节finally删除并确认目录不存在。4份文档425条链接定向新错0，diff检查退出0，新增测试脚本和服务为0。

<a id="core-source-reading-20261115"></a>

## 源码模块导读与直接消费者发现（2026-11-15）

仓库索引固定 `9197c04319a9f834c3c1003c8dd654a25782f838` 已推送回读。负责人要求全平台源码可读及开发Agent快速接手，本片在真实模块补[Auth](../../../apps/api/src/modules/auth/README.md)、[平台](../../../apps/api/src/modules/platform/README.md)、[Rental](../../../apps/api/src/modules/rental-core/README.md)与[AI Native](../../../apps/api/src/modules/ai-native/README.md)源码导读，分别链接实际入口→应用/领域服务→仓储/外部适配→消费者与验证。正式需求、进度和活动问题沿原四册，模块README说明稳定用途和约束。

能力索引增加公共导出直接import计数和前5个源码引用，复用TypeScript符号解析，源码入口及最近模块导读一起返回。源码模块索引包含原Core适配，5条新管理HTTP可从同一查询发现。当前扫描4,426条唯一条目/解析错误0，SaveButton正式出口直接导入48处，例子包含CorePage和工单页面，精确查询1,218字节；Auth API带准确模块导读，core-host模块及5管理API查询通过。上述为源码依赖定位，动态调用/真实运行仍由原链取证。

31根合同类型0诊断；stdin实际读取器和查询核定入口、直接导入、模块说明与新接口，退出0。首个短校验变量遮蔽Node module导致未启动，改变量名后运行通过。本片仅静态解析与文档，不启动服务、不生成Client或安装依赖；新增运行脚本/测试文件为0。

7份文档470条链接定向新错0，原8组合同退出0，diff空白检查退出0。源码导读只说明当前真实入口与边界，原业务实现和锁定技术规范继续原位。所有核对经stdin/内存和原合同独占目录，退出清理已核实。

<a id="core-github-repository-20261115"></a>

## 固定GitHub仓库清单与多Core索引（2026-11-15）

门槛/提交前期限片固定 `df7aaa0f270ed72164defaf93b8263b81a847b38` 已普通推送并真实远端核同，当前main仍62ca。按原02/03/07/11发现范围补 [GitHub仓库读取](../../../packages/core-contracts/src/github-repository.ts)，单Core读取根core.manifest.json，多Core根core.index.json使用唯一id/相对路径清单，schema在该正式Node出口维护，最多20Core。

读取公开仓库元数据→固定默认分支当前commit→带ref读取根索引及Core清单，核Contents普通文件/路径/大小/编码及Git Blob摘要。所有清单解析沿CoreManifestSchema，ID/来源与仓库索引匹配；默认只取元数据，显式--releases时复用原固定Release接口核Tag/提交/资产，仍标记未审核/包未检查。源码发行可早于目录维护提交，manifest.source.commit与所选Release一致后取得发行候选。

整仓状态与单Core状态分别表达，某个清单坏Blob或限流保留其他Core的有效资料。读取器支持no_manifest/invalid/partial、metadata_only/source_only/release_available/unavailable和原retryAfter。GitHubHTTP错误增加可判定status，404表示确实缺文件或发行，其余失败准确保留。CLI和简明手册同步作者根索引格式、单/多CoreTag及按需查看发行步骤。

31根合同类型0诊断，stdin内存编译运行实际读取器核单/多Core固定commit、Contents摘要/路径、缺清单/未发行、固定发行资料、429限流及坏Blob/越界拒绝，退出0。追加部分清单失败核其他结果保留，退出0。真实公开测试发行下载/安装仍未执行，当前验证使用受控HTTP响应输入。

原8组合同退出0，4份文档475条本地链接定向新错0，原12任务行/进度一致，diff检查退出0。新增正式Node出口与CLI一起维护，验证只在stdin/内存及原测试临时目录，原after清理已核实，新增测试脚本/服务/依赖为0。

<a id="pch-first-gate-20261115"></a>

## 首批工程门槛与提交前会话期限复核（2026-11-15）

Core管理HTTP固定 `3e8843239ca243bdf8eed87fac1309c63fea2a73` 已普通推送并读取真实远端一致。按原G1定义复核01/02真实接点、消费者与可实施合同，01/02各登记25%，12项等权覆盖率4.17%。正式A01～A12尚未完整验收，运行、独立接手和发布各按其原阶段门槛核收。

| 原任务与门槛 | 当前固定依据 | 后续缺口 |
| --- | --- | --- |
| PCH-01 G1 | [原数据/迁移/消费者及六公共片](#core-ownership-baseline-20261114)、受控无/单/双Core组合、原已支持/失败/未验链、[工单领域与边界](#core-tickets-domain-20261114)、[页面/API真实消费者](#core-tickets-admin-20261114)及最新main62ca恢复条件可定位 | 全平台逐模块整改、前后真实行为/构建对照及完整迁移账归属仍按后续门槛完成 |
| PCH-02 G1 | 唯一清单/版本/对象/服务/页面合同，租户授权/成员分配/绑定的正式类型和MySQL适配，[原身份/审计组合](#core-original-management-20261115)、[工单原授权消费](#core-original-binding-tickets-20261115)、[部署锁](#core-deployed-catalogue-20261115)及[管理HTTP](#core-management-http-20261115)按同一合同编译和必要行为验证 | Rental完整适配、主Guard/应用/后台及无Core独立构建尚未接通，完整标准冻结/生产消费者和验收仍有缺口 |

最终会话期限在原主体适配等待账号查询返回后再次核对，原数据库会话到期与访问令牌到期都准确拒绝。绑定和工单在等待当前Core/部署/订阅数据后再核相同lease，防止等待跨过自然期限而提交。本片只调整当前提交边界的必要复核，原身份签名/会话撤销/授权事实沿原来源保持。

持续任务的当前公共依赖仍集中在已登记六片。现有实现已提供可直接消费的Core管理政策/Controller、实际目录/原主体/绑定/工单组合及API生成器。原PlatformService/Repository、Auth/Guard、主AppModule/schema与后台外壳的窗口由PM逐片核定；当前接续记录准确接点供其读取，其他作者WIP有独立归属。

实际原主体正常lease、等待账号返回后访问期限到期及数据库会话期限到期均按原方法验证，退出0。Shared121/合同30/宿主6/工单10/MCP59及API969根/2,162源类型0诊断，Prisma独占生成0/守卫0违规，35文件38,375,949字节finally删除并确认。3份文档422条链接和12任务行算术通过，diff检查退出0。本片仅改原主体的必要提交点及原三册，新增测试脚本为0。

<a id="core-management-http-20261115"></a>

## Core管理单源HTTP与接口资料（2026-11-15）

部署目录固定 `416fb603dcc85da6b41b4a3a12693f3b254e23de` 已推送并实际远端回读一致。本片新增[管理HTTP合同](../../../packages/core-contracts/src/management-http.ts)及[同源OpenAPI生成](../../../packages/core-contracts/src/management-openapi.ts)，提供当前注册目录、租户授权、成员分配、初始化绑定、原收据只读五个操作。方法/路径、请求/响应、管理分面和权限来自同一正式声明，Controller与资料共用，成功信封沿原data/requestId。

独占API模块新增[Controller/受控模块](../../../apps/api/src/modules/core-host/core-management.controller.ts)消费原管理/绑定服务，以及[原目录读取](../../../apps/api/src/modules/core-host/original-core-catalogue.ts)锁当前SaaS主体/角色并投影正式显示字段。schema/权限/冲突/不可用分别有已知状态，未知错误沿原链抛出。原AppModule/Guard/OpenAPI总组合尚未取得新窗口，此片只提供其正式消费者；主Guard准确方法/路径政策可直接消费 `coreManagementHttpPolicy`。

30根合同类型0诊断，5路径/9schema及政策映射同源核对通过，绑定配置由Core唯一schema处理。stdin实际Controller与Nest元数据核5条登记路径、服务主体传递、schema400/权限403/冲突409/不可用503及模块绑定，退出0。目录读取实际原ALS/主体链核SaaS可读、租户管理员拒绝和显示投影，退出0；首读严格summary收到完整manifest报未知字段，修为明确选字段投影后通过，原严格schema保持。

API969根/2,162个源文件、Shared121/合同30/宿主6/工单10/MCP59根均0诊断，Prisma独占无引擎生成0/守卫0违规。所有生成器/Client临时文件35个38,375,949字节finally删除并确认不存在。真实主路由/服务/数据库/页面验收继续待宿主接线，原测试数量保持必要范围。

原8组合同退出0，4份文档407条链接新错0，diff空白检查退出0。目录投影修正后复核真实原主体读取，新增函数仅使用正式清单类型及同一summary schema。暂存范围为本片正式合同、Controller/原读取和模块说明及原记录/接续。

<a id="core-deployed-catalogue-20261115"></a>

## 受控部署注册与实际迁移可用性（2026-11-15）

原绑定/工单消费固定 `47764b60edbbc87e8d686e18e3926d9cace02153` 已推送回读。继续独占core-host新增[实际部署目录](../../../packages/core-host/src/deployment.ts)，消费原CoreDeploymentLock、受控服务端注册和数据观察合同。服务端集合与锁逐清单/来源/版本核同，部署目录供授权、初始化和业务使用当前availability；空Core组合合法。

`requireRegistered`只核受控装配事实，数据未就绪时撤回/停用仍可核已注册Core。`requireAvailable`读取原数据所有者的实际观察，平台与目标Core的版本、完整不可变迁移链和ready执行状态全部一致后允许新准入。某Core未完成迁移不阻断无关Core，平台公共迁移未完成则准确拒绝各Core。原包下载/准备和部署授权继续分别记事实。

必要类型合同28根/宿主6根0诊断，stdin运行真实目录核空/双Core、锁与实现集合冲突、未知Core、目标unknown/平台failed拒绝、其他Core仍可用和注册事实保留，退出0。实际数据观察在本片验证中为离线输入，真实DB来源、装配生命周期、Core管理HTTP/UI与无Core独立运行继续按PCH宿主窗口推进。没有新增测试脚本、安装依赖或临时环境。

3份文档356条本地链接定向核对新错0，diff检查退出0。本片正式包出口同步，暂存仅此源码与原记录/接续/模块说明，实际固定提交由包含本节的Git提交定位，普通推送后以远端回读核定。

<a id="core-original-binding-tickets-20261115"></a>

## 绑定及工单样例消费原主体、使用权和订阅（2026-11-15）

原Core管理适配固定 `05700e055763b36b9e66c713dd67bce048fd1ecc` 已推送回读。此片继续独占原Core模块，[当前使用权适配](../../../apps/api/src/modules/core-host/original-core-access.ts)读取真实租户Core授权、成员分配及绑定，输入始终来自原主体事务。新业务期限复用原SubscriptionService在同一事务的只读投影，现有到期/历史政策保持原来源。

[原绑定组合](../../../apps/api/src/modules/core-host/original-core-bindings.ts)接原租户管理权、Core/成员授权及订阅。容器型Core需自己的同事务范围/归属适配，缺失拒绝初始化；租户范围轻量Core直接消费公共范围。初始化和原OperationLog审计同事务，停用后原收据仍由当前有权管理者只读核对。

[工单宿主组合](../../../apps/api/src/modules/core-host/original-tickets-host.ts)接真实工单服务/MySQL与原身份、当前Core/成员使用权、业务权限和绑定数据版本。创建、分派、处理/关闭和原收据继续由工单领域决定，受派者必须是本租户有效获权成员。停用关闭普通查询和新动作，原收据只核本人原操作/当前对象权限；订阅到期仅沿原规则停止新增，已获权处理/关闭继续自身状态校验。原审计增加通用Core业务关联方法，Core适配映射自身对象，公共审计无工单实体依赖。

stdin运行实际原ALS/主体、绑定/工单组合、MySQL适配、原审计及领域服务，使用离线驱动/事务替身。绑定缺成员/到期拒绝，首次原审计与绑定一致，停用后只读原收据、重开不初始化通过。工单创建→分派→开始→关闭、到期停新/旧处理、停用普通读取拒绝、原收据零写及审计失败回滚通过，均退出0。首个绑定fixture未按operationId过滤返回错误原收据，修正离线存储映射后通过，生产原键校验保持。

本片原AppModule/Guard路由和正式数据迁移链仍待公共窗口。API必要示范包依赖与构建前置已同步，源码/说明及接口资料沿同版本合同维护，真实服务、DB锁和完整独立无Core运行须所属宿主阶段取证。必要类型与定向链接结果随本阶段收口。

收口类型为Shared121根、合同28根、宿主5根、工单10根、MCP59根及API967根/2,157个源文件0诊断，Prisma本树schema独占生成退出0/守卫0违规，声明全部在内存编译。finally删除35个临时文件38,375,949字节并确认目录不存在。3份文档348条链接新错0，root lock只新增API对示范包的依赖，diff空白检查退出0。无新增测试脚本、后台进程或外部业务访问。

<a id="core-original-management-20261115"></a>

## Core管理接原身份、角色与同事务审计（2026-11-15）

绑定服务及私有事务句柄固定 `80cc539cccd80d81a6c6767a29133308bb90473c` 已推送回读。本片继续非冲突源码，在API新增[原Core管理模块](../../../apps/api/src/modules/core-host/README.md)，只读消费原ALS和 `PlatformRepository.findUserById`，原OperationLog唯一窗口增加同事务Core管理收据方法。API包声明及root lock增加既有独立Core包依赖，dev/build/lint前置构建这些正式包。

原主体适配锁当前租户/人员/会话/角色与权限，复用原平台租户角色映射；提交前复核相同会话、令牌期限及管理权。租户授权要求当前SaaS管理者，成员分配要求原全租户管理权及本租户成员。目标成员已停用时允许撤回，目标租户冻结后SaaS仍可关闭Core，当前操作者不可停用或越权。Core权/业务范围继续由实际注册、授予、成员和部署来源决定。

`composeOriginalCoreManagement`连接实际CoreAccessService/MySQL适配，原审计使用本事务OperationLog写入，失败回滚Core授权与原收据。stdin运行实际原ALS/主体/管理组合与审计方法，核会话撤销/自然到期、锁顺序、停用成员撤回、冻结目标关闭、租户管理员不可授租户Core、SaaS授权及审计失败回滚，退出0。驱动和数据库为离线事务替身，真实Guard路由与DB锁仍待公共装配。

验证使用本树schema生成独占Prisma5.22无引擎Client，生成器必要文件/缓存全部位于 `output/.tmp/core-original-authority`。前两次缺包解析/Runtime声明均已退出清理，第三次用户缓存写入尝试被守卫阻止；显式APPDATA/LOCALAPPDATA后最终生成退出0、守卫0违规。先内存生成Shared/合同/宿主/MCP正式声明再核API，避免将MCP源码穿进API的rootDir。所有生成/临时验证资料随finally清理，未改产品类型配置或共享Client。

原AppModule/Guard、平台基础投影/创建和主schema仍待原公共窗口；本片交付真实原身份适配源码及消费者组合，尚未将其开放成可办理HTTP/后台入口。当前运行与数据库恢复的证据沿main62ca原阶段引用。

收口类型检查Shared121根、合同28根、宿主5根、MCP59根及API964根/2,145个源文件均0诊断，全部声明在内存生成。Prisma独占无引擎生成退出0/守卫0违规，finally删除35文件38,375,949字节并确认目录不存在。3份文档340条链接新错0，API依赖与lock一致，diff检查退出0；主线/独占树原输出和Client没有改写。

<a id="core-binding-runtime-20261115"></a>

## Core首次绑定、初始化和原操作事务（2026-11-15）

最新main运行修复的纳入及升级观察已固定在 `f510d3793b194823f767516ffdf6b658b3ecc770`，普通推送和真实远端回读一致。本片沿PCH独占core-host及公共core-contracts窗口，补[初始化输入](../../../packages/core-contracts/src/lifecycle.ts)、[绑定应用服务](../../../packages/core-host/src/binding.ts)和[MySQL私有适配](../../../packages/core-host/src/mysql-bindings.ts)。旧平台/Auth/Guard/AppModule和他人后台WIP继续按原窗口维护。

初始化输入租户从原主体确定，Core/容器须与清单范围一致。原操作键和输入指纹区分重复/冲突，首次在当前原授权锁下调用Core唯一初始化schema，业务、绑定、原收据及原审计同事务。已有绑定再次进入时复用，数据版本按当前Core可读区间核验；已有配置调整走Core本身接口，无初始化器的轻量Core可直接保存受权绑定。原收据查询专门复核当前读取权限和主体，缺收据为unavailable。

MySQL依次锁原身份，再锁tenant/Core，再核当前授权和Core范围；相同Core锁与授权管理复用。事务句柄保存在私有WeakMap，Core私有适配只能解析同一scope，回调退出即作废。两张[独立绑定迁移](../../../apps/platform-api/prisma/migrations/20261115020000_core_bindings/migration.sql)随原001排序，范围摘要保留tenant/Core/容器边界，绑定及JSON原收据同事务保存。代码只交迁移源码，原迁移部署链仍由数据所有者核定。

必要类型为合同28根、宿主5根0诊断。stdin运行真实绑定服务核首次/相同键重读/重开不初始化、不同输入拒绝、原收据与缺失、当前撤权/期限失败回滚、Core初始化失败、无初始化器可用及输入跨租户拒绝；MySQL实际适配核原人员→Core锁→授权→业务/回执/审计→最终复验，事务句柄跨范围/过期拒绝，原收据读取0写，均退出0。首个内存声明校验因Windows路径和virtual dist目录未映射报28个导出/驱动声明诊断，修正只读校验映射后0；行为检查将同步schema抛错误用rejects，改为按实际入口throws核对后通过，产品授权规则未放宽。

验证使用离线事务/授权存储替身，原身份/部署生产者、真实事务/DB锁、管理HTTP/UI与业务就绪读取继续待公共接线。源码、合同及接入说明同片维护，原测试和定向链接结果在收口时记录。所有验证经stdin/内存及原合同临时目录，沿原after清理，未新增测试脚本或运行环境。

收口核对原8组合同通过/退出0，3份文档345条链接新错0，core-host锁文件依赖元数据逐项一致，新迁移LF字节一致。`git -c core.whitespace=cr-at-eol diff --check`退出0；本片产物只含正式源码、迁移和原文档，临时目录已不存在。

<a id="core-main-runtime-sync-20261115"></a>

## 最新 main 运行修复同步与升级观察（2026-11-15）

能力索引片固定为 `df10b7b972c954b8fff9903b48c06f73ec1e1400`，普通推送后实际远端一致。跨日再次核工作区、索引、HEAD和GitHub，按负责人及PM当前固定同步要求纳入main `62ca183f10b7c316ab63c28ef6d04ee88d06488b`，父为275064d40。合并提交 `854b2990dcf089b0e14c0517404400447270c17f` 已上传并回读一致，四个产品文件与原固定来源正文核同。管理后台记录顶部双方新增阶段冲突，完整保留简称字段及数据库恢复两段原证据，当前接续合并保留双方未完项。

原CHECK布尔修复、可信MySQL metadata引号包装及有界unsigned bigint修订读取随原源码纳入。真实260迁移/物理约束/14配置行转换/API运行证据继续由[主线恢复阶段](../../管理后台/管理后台-开发记录.md#main-database-runtime-upgrade-20261114)维护，旧迁移原文及checksum保留。能力索引在新组合源码28根类型0诊断、4,385条唯一记录及解析缺口0，退出0。本树只同步已提交源码，当前服务与真库证据仍来自PM原环境。

升级预检承接原DDL部分失败的恢复条件。[迁移执行观察](../../../packages/core-contracts/src/update.ts)增加明确ready/running/failed/unknown状态，以及原迁移标识/摘要、已知语句进度、物理回读摘要和固定恢复SQL来源。预检对任何模块未完成状态返回 `migration_incomplete`，包括本次未选择更新的其他Core。原观察字段向后兼容，新宿主须从所属迁移账明确提供状态，恢复后先核完整物理结构与原收据再重新观察。

旧观察与正常ready通过，前三ALTER已提交/第四失败、unknown/running及未选择Core失败均由真实schema和计划器拒绝，非法语句进度/ready额外字段拒绝。28根合同类型0诊断，原8组测试退出0，3份文档371条链接定向核对新错0，diff空白检查退出0。验证只使用stdin、内存及原测试独占临时目录，after清理已确认。此片纯预检读取输入，目标环境恢复、resolve/deploy和物理检查由原所有者按授权完成。

<a id="core-capability-index-20261114"></a>

## 开发 Agent 统一能力索引与接入查询（2026-11-14）

负责人提出所有功能组件应有注册入口，便于 Agent 知道已有功能和源码位置，并要求继续实施。本片据此补需求/任务v1.5，沿原01/02/11细化统一发现、正式来源、分类查询及独立接手定位。修订前两册固定在 `c72d1718df470e73f48ef657d469fc2e4fdd9037`，原12项任务身份、前置、顺序和G1～G4计分仍为原表。Core授权/成员分配独立层已随该提交普通推送并读取真实远端一致。

开发目录由正式来源汇集的实现选择在本片确定。新[索引合同与查询](../../../packages/core-contracts/src/development.ts)通过 `@rental-os/core-contracts/development` 出口提供，模块归属、源码/文档引用、导入/HTTP/页面入口及原元数据保持可机器读取。[只读扫描器](../../../packages/core-contracts/src/repository-index.ts)消费当前workspace包出口、TypeScript声明/JSDoc、Controller和共享常量、AppModule明确登记、原APP_ROUTES、Core页面贡献及UIArc来源，原注册源继续维护自己的规则。

[查询命令](../../../packages/core-contracts/src/capabilities.ts)支持关键词、种类、归属、标识及分页，默认20项、上限100项，标准输出可为单份JSON。来源标记working-tree和Git修订，覆盖输出压缩为摘要及具体缺口。`describeCoreDevelopmentCapabilities`从同一Core清单、页面/OpenAPI贡献生成Core目录。[源码读取器](../../../packages/core-contracts/src/repository-source.ts)复用仓库路径边界，只解析本仓声明，TypeScript为已锁定开发工具；函数调用保持未解析，Object.freeze仅语法读取参数。源码描述、明确宿主装配与当前运行授权分别标记，原AI基线及MCP工具发布继续由其原专项维护。

根README、[契约包说明](../../../packages/core-contracts/README.md#找到平台已有的功能)、原任务[能力索引](平台Core接入-开发任务.md#capability-index)、五步指南及随包指南生成器同步提供查询步骤。Core作者可查SaveButton/CorePage等实际导入及源码说明，工单3页/7接口可从同一个入口发现。

必要类型核对28根文件0诊断，原8组合同比对通过/退出0，唯一测试文件只增加编译器依赖的只读解析路径。stdin以内存真实编译和加载运行扫描，4,385条唯一条目，含1,049个API、99个UI出口、3,032个公共导出、123个UIArc来源、23个模块和59个页面；解析错误0，实际扫描期间写文件0、实际环境/输出目录读取0。SaveButton查询1,368字节，精确标识/分类/归属/分页与非法limit拒绝通过，实际工单清单+OpenAPI生成8条目录，随包指南含查询命令和固定文档锚点，均退出0。

最初扫描尚未读取Object.freeze常量和vendor类型，350个来源/路径缺口据实际原因修复。进一步发现21条重复路由源码，原AI通过观测/执行控制器继承及互斥装配消费这些声明；目录将同路径多个源码来源合并并保留显式AppModule出处。曾因重复标识校验退出1，修复后全索引唯一。5条静态元数据有运行表达式，原两个品类页面menu开关和工单三页面权限函数通过 `unresolvedMetadata` 明确标记。

源码用途梳理仍有实质缺口。当前3,547条索引条目未直接提供JSDoc描述，涉及类型/接口/页面和保留源码，目录给出准确入口，后续沿原4.3按关键职责和模块说明整改。当前扫描覆盖实际检出资料，其他未检出客户端、任意动态注册、完整OpenAPI字段/所有请求消费者、运行工具可用性及独立接手仍需所属切片核收。索引数量、源码存在和静态通过各有自己的证据范围。

验证经stdin/内存和原测试临时目录执行，原after已删除 `output/.tmp/core-contracts`。扫描期间只读取业务源码；同源目录另以内存编译运行工单元数据生成器核对。旧空目录的原生PowerShell清理在本片恢复可执行，核定两个绝对路径在独占树内、无链接且为空后按子目录→父目录删除，随后核实原路径均不存在。唯一待清理责任清单及已空的任务子目录也核对作者后移除，历史审批失败证据继续保留在工单阶段原记录。

本片没有新增测试脚本、依赖、服务或真实DB访问。下一片先纳入PM指定main修复 `62ca183f10b7c316ab63c28ef6d04ee88d06488b`，随后接真实公共宿主/当前授权与注册消费。

6份文档535条链接、106个锚点和57张表定向检查通过，12条任务行内容与原固定版本一致。新增主线修复锚点按62ca固定记录核验，随后纳入该提交。实际CLI以内存编译执行输出单份JSON，SaveButton精确两条入口、退出0。`npm run docs:check`在本稀疏树退出1，17个缺链包含14个固定Git中存在但未检出的目标和总导航3份既有历史附件；定向补核新增错误0，检查器覆盖边界保持原规则。

<a id="core-host-access-20261114"></a>

## 平台 Core 授权与成员分配应用层（2026-11-14）

前片工单三页面/请求/原收据已固定为 `45714bb998bb13d64c62f9a7cbd515c42e1e338d`，中文提交、普通推送及真实远端回读一致。继续PCH独占模块/非冲突源，新增[core-host](../../../packages/core-host/README.md)与必要root lock条目，稀疏检出只增加该包；原平台用户、Auth/Guard、schema/迁移链、AppModule与后台公共WIP没有改动。

[应用服务](../../../packages/core-host/src/access.ts)消费已有生命周期schema，将租户Core开通/停用与成员分配/撤回分别保存，原管理者/目标租户/成员由宿主当前authority验证。新开通核真实注册及部署可用，不自动分配或初始化；撤回允许业务已不可用，重开不恢复成员主动撤权、不续订阅。原操作键和修订控制重复及并发，历史收据不回写当前状态。

[MySQL适配](../../../packages/core-host/src/mysql.ts)与[四表独立迁移](../../../apps/platform-api/prisma/migrations/20261115010000_core_access/migration.sql)只拥有平台Core管理事实，未引用Rental/AI表。原人员/租户/角色先锁，再取得tenant/Core锁，变更、原收据和原审计同事务，最后复核原lease期限；管理权限不足在任何SQL前拒绝。SQL参数化，读取bigint修订经正式schema安全整数核对。真正原身份/部署生产者和HTTP/UI仍待公共窗口，不能用布尔字段或替身宣称已开放管理。

必要检查为3根源码类型0诊断；stdin运行真实服务核单/双Core独立授权、开通不自动分配、成员撤回/停用重开保留、旧收据不改当前修订、同键冲突、越权/跨租户字段拒绝、审计/期限失败回滚及部署不可用仍可撤回；真实MySQL适配另核参数化tenant/Core、authority先于SQL、原收据/审计/最终复核顺序及拒绝零SQL，均退出0。使用离线授权/存储/事务替身，不证明真实DB锁、原Auth或业务运行。没有新测试脚本、依赖/临时文件、服务或数据库访问，已知两个空目录原位审批阻塞仍未清理。

接入说明与源码同片解释公共服务边界、输入唯一来源、锁序、构建和未接线项。后续真实基础投影/公共租户创建→身份范围→授权/绑定事务→原AppModule/后台消费的顺序仍沿原六片候选；此次只交独立应用层，没有抢写尚未核定的公共入口。

3份文档319条链接定向核对新错误0，root lock原全部条目不变、只新增该包workspace及链接两项；`git -c core.whitespace=cr-at-eol diff --check`退出0。

<a id="core-tickets-admin-20261114"></a>

## 工单页面消费公共壳与原收据读取（2026-11-14）

期限复核片 `093458c448a27c8aa1591ed44d3dc8f990fcbcbc` 已推送并回读，继续独占 `apps/admin/src/core`/工单包及必要包元数据。原后台壳、AppRouter/导航、Auth/Guard/主OpenAPI仍未修改；main原后台作者的顶栏/样式与PM原本机迁移恢复继续独立，本片不访问其业务服务或共享库。

[工单后台](../../../packages/example-tickets-core/admin/index.tsx)提供列表、创建和详情三个真实页面组件/注册贡献，通过正式 `@rental-os/admin/core` 源码出口消费CorePage、原Table/Form/SaveButton/QueryState/离页保护，不加样式或复制壳。原admin包只新增该出口，现有企业读取经固定Git核无包深层导入，不扩大成UI重构；工单按所需peer使用React/React Query，包清单增加实际后台TSX入口，仍由受控宿主构建。

通用[Core请求适配](../../../apps/admin/src/core/useCoreRequest.ts)复用原HTTP认证/信封，限定本Core内路径和参数，生成Core/宿主身份/页面代次查询键。离页/代次变更中止原请求，返回后核当前会话/页面权限，StrictMode清理再挂载重新建信号，不继续使用已中止信号。它不是服务端授权，也不能以请求取消判断写入未发生。

工单列表用原表格/筛选与显式分页，新建/处理/关闭由CorePage声明当前主操作，分派用原Form/SaveButton。首次示范受派者填写正式成员ID，真实成员选择目录尚待公共适配。写入中保留表单和单次Promise，已知本Core提交前拒绝允许核正输入；网络/未知结果保留原操作键并常显提示，不能自动换键重做。

新增原操作只读入口 `GET operations/{operationId}` 与 `TicketsService.receipt`，只返回当前本人及对象范围允许的recorded原收据或unavailable；未查到不能推断未执行。页面核对只走GET，不再调用原写入。服务端固定purpose=original_receipt与普通business分开供宿主处理停用/到期善后，客户端不能选择；真实授权适配仍须实现。API同源映射现有7操作/6路径，文档同步原RequestIdInterceptor的 `{data,requestId}` 信封；判别联合导出复用唯一schema。

验证范围：后台和工单合并650根/3994源类型0诊断，独立页面tsconfig 11根/1490源0诊断，服务端10根0诊断；原合同8组通过含新增联合schema类型。AntD6.6原Table API/示例已查，新页面与CorePage lint均零问题。stdin核实际hook的Core前缀/路径拒绝、离页/会话/权限迟到响应、StrictMode/旧generation拒绝；实际页面JSX核未知创建转只读GET、unavailable不重发、已记录进入原对象、已知拒绝保持可编辑及3页注册；实际服务/Controller核原收据零写入、当前主体/对象可见性、7操作及信封文档，均退出0。上述为hook/HTTP/事务facade和静态类型，未冒充真实React挂载、Form回车、浏览器样式、原Guard或数据库通过。没有新增测试脚本、依赖副本、服务或临时文件，原合同测试产物已清理。

[平台接入说明](../../../apps/admin/src/core/README.md)及[样例手册](../../../packages/example-tickets-core/README.md)同片给出正式出口、三页面、缓存/请求、只读核对和原业务限制。实际主应用装配/数据迁移/当前授权、无Core及双Core界面/持久化、停用恢复和独立接手仍未完成；两个空目录原位审批阻塞继续按原责任清单维护。

5份文档380条链接定向核对新错误0，包peer/正式出口与lock一致，需求/原任务未变，`git -c core.whitespace=cr-at-eol diff --check`退出0。最终补齐分派草稿和核对中离页保护后，页面独立tsconfig复验仍11根/1490源0诊断；原收据/普通访问purpose分开也经最终服务端类型与短命令核对，退出0。

<a id="core-tickets-package-20261114"></a>

## 工单编译包闭包与提交前期限复核（2026-11-14）

HTTP片已固定上传 `7c779091231c7236d088e72d8763443d7fb19914` 并回读GitHub。基于该提交执行原TypeScript配置的真实program.emit，core-contracts先编译24根/48产物，工单从其声明产物编译10根/20产物，全部在内存writeFile回调，不落dist、不建依赖副本或临时目录。将真实输出、同源OpenAPI、迁移、LICENSE/README及固定任务生成指南按清单组成27文件包；标准包检查、USTAR/gzip往返及重复确定性均通过。该固定版本内存包23451字节、SHA-256 `e3eef62338c363642d2f0f43d2be2980a1ed73dcc8190fbb7c0e0a53daf94f38`；它是构建/格式闭包证据，没有保存为发行物或证明实际安装可用。

事务复核发现锁行不能冻结时间，因此在[MySQL适配](../../../packages/example-tickets-core/src/mysql.ts)增加authority同次授权返回的`revalidate()`，在领域/收据/审计之后、事务返回之前复核原会话/订阅期限。失效抛错令同事务回滚，不借另一主体重新授权。10根最终类型0诊断；stdin核真实适配的auth→锁→work→revalidate顺序及过期不提交，退出0。接口仍需原真实授权实现，未运行数据库。包说明同步该必需接点，前述包摘要只对应改动前固定版本，不套用到新版本。

<a id="core-tickets-http-20261114"></a>

## 工单 HTTP 与同源 API 文档（2026-11-14）

工单领域片固定 `f4e43b7e6849748118ef5a7c07666f4d91491740` 已提交推送并回读GitHub，main仍 `275064d40`。本片仅继续独占合同包、工单包与根lock必要peer项，未修改原AppModule/Guard/OpenAPI总组合、schema或后台壳。新增[HTTP合同](../../../packages/example-tickets-core/src/http.ts)、[Nest适配](../../../packages/example-tickets-core/src/nest.ts)、[OpenAPI生成](../../../packages/example-tickets-core/src/openapi.ts)和[元数据命令](../../../packages/example-tickets-core/src/metadata.ts)。

同一HTTP映射供给6个Controller方法的路径和生成文档，数据字段仍来自原工单Zod schema；公共[简单schema转换](../../../packages/core-contracts/src/schema.ts)只支持已明确的Zod3基础字段，未知refine/transform等拒绝，不静默漏约束。OpenAPI包含实际权限码、参数/请求/响应、原操作/修订及400/401/403/404/409/500语义；源码入口与构建后命令可导出同版本离线JSON，未将文档生成视为HTTP已上线。

Nest模块显式接业务service和原可信principal accessor，租户/创建者不取body。路径ticketId与body分开严格校验，重复/数组/空数字等查询不隐式变成合法值。已知输入/领域冲突映射明确状态，未知数据库/宿主错误保持抛出；原全局Guard默认拒绝仍有效，未经正式注册不放行新路由。私有nestjs peer入口与领域公共出口分离，未创建另一套认证或业务事务。

必要验证：新增10根Core源码类型0诊断；原单一合同入口8组通过含全部合同类型。首次schema转换器的穷尽分支读取never字段触发TS2339，修复后复验通过；离线边界核对又把正整数的语义从minimum0/exclusive转换成明确minimum1并保留严格性，再验通过。stdin读取真实Nest装饰器元数据，对照6方法/5路径、HTTP200、权限码/文档schema及当前主体/路径/body、400/409和未知异常传播；同时核文档默认值/可空、窄数字约束与不支持schema拒绝，退出0。元数据命令纯JSON与0/1退出也经实际源码核对，退出0。未新增测试脚本、启动Nest、查询数据库或执行模型；原合同验证临时目录已删除。

包说明与合同手册同步更新准确命令、输入/错误及未接线范围；工单清单现声明实际OpenAPI文件，打包前须由命令生成，不使用手写空文档。实际宿主权限适配、原主应用注册/文档组合、工单页面/持久化和无Core/双Core验证继续待交付。原MCP未验和两个空目录审批拒绝仍分别见原记录，不借本片类型通过关闭。

4份文档361条链接定向核对新错误0，工单peer依赖与lock一致，正式需求/任务正文未变；`git -c core.whitespace=cr-at-eol diff --check`退出0。

<a id="core-tickets-domain-20261114"></a>

## 非租赁工单领域与 MySQL 适配（2026-11-14）

前片React适配已中文提交并上传 `595edf963e992530b19a8a56f49c80cc14757844`，GitHub真实远端回读一致、起点干净，main仍为已包含的 `275064d40`。沿原PCH独占模块/非冲突源授权新增 [example-tickets-core](../../../packages/example-tickets-core/README.md) 和根lock必要workspace条目；没有改公共Auth/Guard/AppModule/schema/迁移链或活动后台壳，原PCH任务身份/百分比不按代码数量变更。

这是原已冻结的非租赁工单样例实现，不再只是包格式夹具。[领域合同](../../../packages/example-tickets-core/src/contracts.ts)/[服务](../../../packages/example-tickets-core/src/service.ts)提供创建、分派、开始处理、关闭、读取及原操作回执。租户为唯一业务范围、普通成员只读创建/受派对象，管理者仍须具体业务权限；状态只open/in_progress/closed，更新核修订。同键同输入复核当前授权/可见范围后读原结果，同键变化拒绝；原收据不被当前状态替换。

[MySQL适配](../../../packages/example-tickets-core/src/mysql.ts)提供实际参数化SQL和Prisma兼容窄事务入口，[独立迁移](../../../packages/example-tickets-core/migrations/001-tickets.sql)只归该Core，不进入原公共组合迁移链。执行器先由真实宿主authority锁人员/授权及受派者，再取本租户Core写锁，业务/原回执/原平台审计同一事务；异常抛出回滚。领域出口不泄漏Prisma，私有mysql仅用已有驱动Runtime/SQL模板、不依赖生成的Rental模型。首次类型检查暴露主依赖目录未生成Prisma组合client，因而收窄为实际用到的驱动接口，不生成/复制另树Client或补假模型。

[服务端贡献](../../../packages/example-tickets-core/src/server.ts)消费正式CorePrincipal/Binding，拒绝错误Core/租户/容器，读取当前绑定数据版本；[清单生成](../../../packages/example-tickets-core/src/manifest.ts)注入真实固定来源、声明权限和不可变迁移摘要，独立实现/数据常量分别维护。没有业务初始化、AI或伪HTTP/页面贡献。没有移除检查器时不能据此移除历史执行者。包说明随片记录实际方法/权限/锁顺序/迁移/构建和待接线范围。

必要验证为6根新源码完整类型0诊断、反向行业/宿主导入0；stdin运行真实领域、MySQL适配与标准注册器，离线事务/权限替身覆盖完整创建→分派→处理→关闭、原收据、状态/修订/成员/租户/audience拒绝、撤权先于业务查询、审计失败回滚、参数化SQL及迁移摘要，退出0。替身不证明真实DB锁/原授权或持久化恢复，也不证明HTTP/UI已接通；真实宿主authority、迁移应用、Controller/页面、双Core组合及独立接手继续待交付。没有新增测试脚本、安装依赖、启动服务或连接业务库。

3份文档306条链接定向核对新错误0；root lock原所有条目逐项保持，只增本Core workspace和链接两项，包依赖一致；需求/任务原文未变，`git -c core.whitespace=cr-at-eol diff --check`退出0。构建产物未复制或落地，无新增测试/诊断文件。

临时残留：新增MySQL文件最初放在独占API适配目录，随后用apply_patch移入本Core，留下两个空目录。安全核定后原生PowerShell删除命令在执行前被自动审批拒绝（`blocked by policy`），没有退出码；未换工具/壳或移动以绕过。零文件/零字节的两目录仍在原位，唯一责任清单为主树 `output/.cleanup-pending/pch-preparation/tickets-core-empty-dirs/manifest.json`，记录原路径、归属和恢复条件，未提交Git。其余本任务验证临时目录仍已删除，不能把本片空目录说成已清理。

<a id="core-react-page-adapter-20261114"></a>

## Core 页面声明复用原 React 组件（2026-11-14）

Topic片已提交上传 `0ea168622c90301a4e431220acc68ead74d037c2`，真实远端回读一致。复核PM原当前派工的“PCH独占清单、模块合同及非冲突源继续”，本片仅新增[CorePage适配](../../../apps/admin/src/core/CorePage.tsx)/[正式出口](../../../apps/admin/src/core/index.ts)/[源码说明](../../../apps/admin/src/core/README.md)，以及未有活动WIP的admin包配置和根lock单一依赖项；原AppShell/BusinessShell/PageHeader/顶栏/样式正由main后台作者修改，均只读，不覆盖。shared总index、Auth/Guard/原AppModule及AI目录没有扩大修改。

CorePage消费原 `@rental-os/core-contracts` 的页面和动作类型，标题从当前注册项取得；按钮按navigate/open/command/save选择原Button、ActionButton、ConfirmAction和SaveButton，经原PageHeading/WorkspaceHeader呈现。没有新样式、vendor修改、UI框架或页面JSON解释器。动态权限由宿主当前回调供给，执行前重验、无权正文不挂载；路由对象/身份代次变化释放旧页，确认等待/离页回调不持有旧授权，最多一个主操作、操作ID唯一。真正授权/缓存失效仍由后端和原宿主负责，不能使用恒真回调装配生产。

表单保留真实Form、validateFields及mutateAsync，原SaveButton继续同步防重复、关联原Form与保存快照；非保存动作不假显示保存成功。普通错误走原反馈，字段错误留原Form，确认走原原位状态；业务拒绝/unknown由各Core类型化API抛错与原收据处理，不猜测任意响应或自动重发。接入指南给出路由单源、打开编辑器和保存的短例子，未实现的业务方法明确标注。

admin增加对本仓合同包的正式依赖，predev/prebuild/prelint先构建本树合同产物，不增加Vite深层源码别名；安装依赖、应用启动和本树dist构建本片未执行。最终完整类型使用TypeScript CompilerHost只读依赖映射，648根/3989源、0诊断；首轮验证映射重复识别React产生21条ref类型错误，统一只读真实路径后通过，未改产品类型约束或原组件。AntD6.6 Form/Button API与Form例子已查，新组件lint0问题，原263 vendor哈希异常0。

stdin核对实际CorePage JSX的四类组件选择、受控导航、打开不提交、确认同一Promise、当前撤权、原Form/值传递、离页拒绝、无权页和单主按钮，退出0。另直接核对原SaveButton/ActionButton的校验顺序、真实Promise、防重复、原form ID/native submit防双发及失败不记保存，退出0。这些使用hook/宿主facade，是离线行为证据，未证明真实React挂载、portal/回车、浏览器样式或服务端授权。没有新增测试脚本或临时文件，原已清理目录保持不存在。

4份文档的326个本地链接/44个锚点定向通过，admin包与root lock依赖一致，原需求/任务正文未改；`git -c core.whitespace=cr-at-eol diff --check`退出0。最终反馈回调补齐后，完整648根类型复验仍0诊断，新组件AntD lint仍零问题。

**剩余接线：** 原AppRouter/导航须在公共窗口供给真实Core注册/授权/成员分配、lifetimeKey、可访问目标和缓存代次，再以轻量工单真实业务页核对原壳。当前新增适配尚未有已装配路由消费者，仍不能称无Core/多Core后台完成或独立前端包已发布；列表/详情模式继续复用原组件，后续按实际重复需求补最短接入面。PCH-07原前置/完整门槛保留，本片不以类型通过计整项完成。

<a id="core-github-discovery-20261114"></a>

## Topic 发现与离线查询状态（2026-11-14）

固定Release片已提交并上传 `96ce79dac0211bec335e46ea0d9f0ba223e82dda`，实际远端回读一致、工作树干净、main `275064d40`仍已包含。继续原包独占窗口，为后续PCH-07发现面提供[Topic查询](../../../packages/core-contracts/src/github-discovery.ts)；[只读传输](../../../packages/core-contracts/src/github-http.ts)从原Release实现移出后两者共用，没有第二套下载或本机凭据通道。

查询仅在公开未归档仓库的 `nativark-core` Topic中按名称/简介检索，拒绝原始查询表达式；每页20、上限1000符合GitHub官方[仓库搜索](https://docs.github.com/en/rest/search/search#search-repositories)。返回查询时间、来源/许可、下一页和不完整标记，候选明确为unreviewed/unchecked，不从标签推断Core身份或可安装性。单实例保存最近50页、5分钟缓存，并发同查询复用读取；手动刷新可跳过缓存。失败返回unavailable和准确原因，若有旧页只附stale原时间，不伪造成功空列表、不影响已安装组合；调用者不能通过修改返回对象污染缓存。

原GitHub命令新增discover，实际实现/命令/缓存生命周期及展示要求同步[接入说明](../../../packages/core-contracts/README.md#发现公开-core-仓库)。原单一合同入口8组/完整类型通过；stdin核固定Topic/分页、上限/查询拒绝、fresh/cache/stale/离线/限流/格式错误、并发去重/返回隔离和原Release解析均退出0。全部HTTP为离线响应，不把搜索逻辑验证当作真实GitHub结果或后台界面通过；没有新增测试脚本、依赖、网络业务访问或后台进程，原测试临时目录已删除。

CLI失败JSON/退出1、缓存容量淘汰和时钟回拨刷新另以stdin核对，退出0。3份文档324条链接定向核对新错误0，需求/任务原文不变；原白名单仍仅总导航3个既有历史缺失，`git -c core.whitespace=cr-at-eol diff --check`退出0。

独占范围的目录发现和固定包准备继续分开。仓库根清单/同仓索引到发行的核对、安装状态/授权/版本管理界面及真实部署仍待宿主公共窗口；不得用本片替代完整PCH-03/07/10/12。再次尝试只读浏览器仍在初始化返回kernel assets路径缺失，未获得实页；营运商简称实际宽度仍由原后台记录承接，不以离线字宽代替。

<a id="core-github-release-20261114"></a>

## 固定 GitHub Release 与本地准备共链（2026-11-14）

阶段基线为已上传并回读的 `2cf775ce9664c7666666d32622c311466bb9777d`，当日再次读取实际远端main仍为 `275064d40a3977542a530158974070e8b6c337ca`，本树已包含该提交。修改仅限独占 `packages/core-contracts` 和原PCH记录/接续；无合并、拣选或他人WIP，完整宿主/后台公共窗口继续沿原候选表。

[GitHub入口](../../../packages/core-contracts/src/github.ts)与[命令](../../../packages/core-contracts/src/github-release.ts)为公开仓库提供显式inspect/prepare。Tag固定为 `v<版本>`，同仓多Core为 `<Core ID>/v<版本>`；资产固定 `<Core ID>-<版本>.tgz`。inspect解析真正的Tag引用和附注对象，锁定仓库、提交、Core/实现版本、Release/资产ID、字节数与GitHub SHA-256；不将活动分支target_commitish当提交，不读本机环境/凭据。

prepare在下载前后复核固定资料，限制时间、字节数和GitHub HTTPS下载跳转，然后复用原[安装准备](../../../packages/core-contracts/src/install.ts)。新增可选预期来源输入在任何候选写入前核对清单ID/版本/仓库/提交；未传时旧本地入口语义不变。重复仍核原字节、被用户修改仍拒绝，结果仅deployment=pending。网络、限流、Tag移动、替换资产、未知摘要、错误来源和包检查失败均不改变活动组合；响应体/签名URL不写错误日志。

必要验证和边界：

- 原单一合同测试退出0，8组通过；包含全部新增源码类型及反向依赖检查，没有新增或扩写测试脚本。
- stdin离线HTTP响应＋实际文件准备退出0，覆盖轻量/附注Tag、同仓Tag、200/302下载、重复、移动Tag/替换资产/来源不符、无摘要、限流/离线、非GitHub/非HTTPS跳转、用户修改拒绝；没有对外下载Core。夹具入口抛错，用于确认检查/准备没有加载包代码，不是非租赁业务实现。
- 读取中断、取消已失败的响应、过大JSON和CLI实际schema/分支/纯JSON/退出码用stdin定向复验，退出0；取消错误不覆盖原HTTP/网络诊断。CLI文件读取facade只证明参数和调用映射，不能代替真实GitHub发行运行。
- 查阅GitHub官方[Release](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)、[资产](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)、[引用](https://docs.github.com/en/rest/git/refs#get-a-reference)及[附注Tag](https://docs.github.com/en/rest/git/tags#get-a-tag)。Tavily搜索/提取均因额度返回432，改为直接读取官方公开文档；refs首次连接EOF后重试200。这是文档研究，不是标准Core发行下载验收。
- `output/.tmp/core-contracts` 与 `output/.tmp/core-github-release` 均经finally清理并核实不存在，无新服务、依赖副本、数据库/模型或发布操作。
- 定向5份文档核对388个本地链接、71个锚点、47个表格，新错误0；需求/任务原文及12行原任务不变。原白名单的3个总导航历史附件缺失仍在，未以删引用或改检查器处理。`git -c core.whitespace=cr-at-eol diff --check`退出0。

[接入说明](../../../packages/core-contracts/README.md#从-github-固定发行准备)同片加入作者包名/Tag/发布步骤及部署者两条命令、来源锁、结果和错误处理。Topic搜索/缓存/界面、受控组合构建、真实部署注册、非租赁持久化和独立安装/更新验收仍待交付；没有用下载或格式夹具关闭PCH-03/10/12。原PCH完整G1接点/消费者尚未齐，本片不以源码或用例数量计分。

<a id="core-local-package-install-20261114"></a>

## Core 本地打包与安装准备（2026-11-14）

沿原独占合同包完成PCH-03可独立的文件准备切片。此前新增营运商简称最小窗口的检查点已固定于 `982043aba913745c6d0e258b2d74ca1efb9a98d4` 并推送/回读一致，其类型/数据/源码证据与剩余实测宽度只见[后台原记录](../../管理后台/管理后台-开发记录.md#operator-short-name-foundation-20261114)，不挪作PCH研发完成。

[包检查](../../../packages/core-contracts/src/package.ts)将目录读取和内存文件快照接到同一清单/文件/迁移/OpenAPI检查，保留原入口/错误/CLI语义。新打包只读取清单明确声明的入口、资源、迁移及文档；额外源码/构建材料须显式声明，禁止读取实际环境/Git元数据/依赖目录。[安装准备](../../../packages/core-contracts/src/install.ts)与[打包命令](../../../packages/core-contracts/src/pack.ts)/[准备命令](../../../packages/core-contracts/src/prepare-install.ts)使用原USTAR+gzip格式和整包摘要；不下载安装依赖、不执行Core源码或修改活动组合。

安装先完成摘要/格式/兼容/包内容检查，再在部署者指定的既有独占根创建暂存，完整写入后发布以Core/版本/完整摘要确定的候选目录。成功只为prepared/deployment=pending；重复请求逐文件对照原字节后返回already_prepared，原目录被修改、缺件或带链接时拒绝覆盖。失败经finally核定路径后清理本次暂存，当前运行目录、授权/绑定、数据库和其他候选保持。精确的单文件输出采用wx，失败删除自己刚创建的半包，已有输出文件从不覆盖。

必要验证复用原单一合同测试（8组与新增完整类型通过，退出0）；stdin在 `output/.tmp/core-package-install` 编译并创建最小格式fixture，实际运行目录打包、待部署写入、重复导入、已有用户改动保留、坏摘要/缺兼容/未声明文件拒绝，以及pack/prepare两条CLI（退出0）。包内服务代码为抛错哨兵，验证未被执行。其余未声明文件未被纳入，原包重复输出被拒绝且字节保持。该临时目录含源码产物/包/解包文件，finally已全部删除并核实；没有新增测试脚本或后台进程。

当前属于本地可复现文件准备；宿主装配、注册/租户授权/成员分配、Core持久化业务、远端Release/Topic、实际升级/迁移、独立接手仍未验。接入说明同片给出路径、命令、输入、JSON状态、退出码和下一步，不把准备成功显示为业务已启用；PCH原门槛不凭文件操作通过提高。

<a id="core-declarative-pages-20261114"></a>

## 完整后台外壳与声明式业务页面澄清（2026-11-14）

负责人在持续拆分过程中明确：左侧菜单区域、右侧内容面包屑整行、铃铛/休息/收展都属于底座，无业务Core时保留；Core只提供业务菜单、正文和业务主按钮。随后要求开发者在对应路由页面声明主操作，即使用已设计好的按钮与交互，并将减少重复工作的原则推广到其他常见页面能力。以上为本次修订依据，无需重问已确认产品意图。

需求/任务升为v1.4，新增需求1.9、扩充原R07/R11/A07/A11，以及原02/07/11、任务[页面声明合同](平台Core接入-开发任务.md#declarative-page-contract)、五步入口和Agent模板；原12项任务行、编号、依赖、顺序和百分比不变。要求覆盖单源路由/菜单/面包屑/标题、页面主次动作、原保存/确认语义、标准列表/详情/表单、请求/错误/权限状态与可选通知文件接点；特殊业务可提供正文，仍复用公共壳。公共设置自身的保存仍可用，“无业务主按钮”不删除公共设置操作。无Core保留辅助面板收展及未开通信息，不开放通用业务Agent。

只读追踪固定main源码：[BusinessShell](../../../apps/admin/src/components/BusinessShell.tsx)拥有侧栏/页头/内容/动作插槽，[AppShell](../../../apps/admin/src/components/AppShell.tsx)传入实际面包屑与休息/铃铛/右面板；[PageHeader](../../../apps/admin/src/components/PageHeader.tsx)→[WorkspaceHeader](../../../apps/admin/src/components/workspace/WorkspaceHeader.tsx)已将页面标题/操作送入顶部，[ActionButton/SaveButton](../../../apps/admin/src/components/ui/ActionButton.tsx)有原异步状态、表单校验与回车关联。继续封装这些真实入口，不复制按钮或另建框架。当前PageHeader仍导入固定导航/认证，通知Provider直接读取Rental待办与AI演示，Copilot可用性依workspace，故尚无跨Core独立页面SDK；前端源码本片只读。

待07的具体文件补充到原公共候选：BusinessShell/WorkspaceHeader/PageHeader及按钮的正式出口、AppShell中的注册组合、navigation/AppRouter与认证缓存、NotificationProvider业务来源和RestProvider公共身份边界、CopilotLayout外壳/业务内容分离。原后台作者的主题/布局/表单/动效源保留，由PM协调唯一改动窗口；不向其他对话主动发消息，也不通过新页面旁路宣称完成。

修订前两册及接续原文保存于 `d01561912cc6644776cbceea4971508eeb4c99ba`。该提交已合入最新main `ee281955161ffcf9b9d166be45972d48fbe0191f` 的两份服务恢复记录，合入前后本片五个包/指南WIP的SHA-256全部相同，随后普通推送并回读远端为d01561912。原main运行/数据库待迁移问题沿管理后台原记录保留；本片没有代执行真实迁移。

本阶段5份现行文档/模块说明定向检查371个本地/外链声明、66个本地锚点和45张表，新增问题0；外链仅核语法，未访问网络。原12项任务行逐字对照相同，依赖/百分比不变；`git diff --check`退出0。没有页面运行、独立接手或真实授权验证，不以文档确认记07完成。

<a id="core-guide-archive-20261114"></a>

## 随包指南生成与标准归档原语（2026-11-14）

上一阶段独立升级预检固定于 `6ba45c0bb59c454bf261a757912344dfbc4626f3`，已推并核定实际远端。本片[指南生成](../../../packages/core-contracts/src/guide.ts)从原任务快速入口与Agent模板取文、补Core实际入口和固定版本链接；[命令](../../../packages/core-contracts/src/generate-guide.ts)使用本地指定提交的任务原文，将生成内容输出到stdout，不覆盖已有Core文档。缺锚点拒绝，不手写第二份长期指南；正式宿主未接线仍明确标记，不把五步设计称现成SDK。

[归档原语](../../../packages/core-contracts/src/archive.ts)采用USTAR+gzip、固定顺序/权限/时间，整个包SHA-256固定。通过Node专用`@rental-os/core-contracts/archive`出口使用；只支持普通文件、UTF-8及有界包大小，不收PAX/软硬链接/目录记录、重复/越界路径、实际环境配置或node_modules。先校验整包摘要和解压上限，解析只返回内存文件；不写解包目录、不下载、不安装或执行Core。实际打包目录入口及待安装区写入继续后续交付。未增加压缩依赖或安装包，使用Node原生gzip。

原单一合同入口包含新增源码完整类型，8组通过/退出0。stdin核对相同输入包字节一致、UTF-8/空文件往返、错误摘要/越界/链接/大小写/父子路径冲突/截断拒绝，以及固定任务原文生成指南、元数据转义、缺锚点拒绝和固定链接（退出0）。未新增测试脚本或落地压缩包；本树合同临时目录已删除。此为归档原语/资料生成证据，完整安装、干净宿主及独立接手未验。

<a id="core-update-preflight-20261114"></a>

## 底座与单 Core 独立升级预检（2026-11-14）

归属基线及公共候选已固定于 `b8ffed04f3baec2d7592631765ca3d5e037fa97d`，普通推送及真实远端回读一致。本片继续独占合同包，落实PCH-02/03的独立版本锁定和候选预检，不接管当前Auth/Guard/AppModule等公共窗口。

[升级合同](../../../packages/core-contracts/src/update.ts)提供底座发行、Core包固定资料、部署锁、单对象更新请求及实际数据观察schema。提交/摘要/来源/data定义复用[唯一清单](../../../packages/core-contracts/src/manifest.ts)，迁移schema从原清单抽出复用，保持原字段与错误定位。锁记录不接受用户配置/Key/授权，不设隐式更新全部模块；同版本来源/摘要/元数据变化、来源替换、降版和重复Core明确拒绝。

`planCoreUpdate`复制当前锁，只替换所选底座或一个Core；检查全组合所需合同/运行/能力、实际数据版本和已应用迁移摘要。已发布迁移必须是新链不变的前缀。新迁移只在实际状态等于当前完整基线、数据版本前进时列为migration_required；其他Core待迁移、历史矛盾/缺失或缺观察时拒绝。已应用新链且数据目标一致可继续准备程序候选；不重做迁移。owner显式区分platform与core:id，Core恰好名为platform也不混用。

[只读命令](../../../packages/core-contracts/src/plan-update.ts)接三份JSON并输出人读/机器读结果，退出0/1/2区分预检通过、业务兼容拒绝与用法/输入读取错误。没有下载、解压、加载Core、读取业务环境、写锁/配置、应用迁移或切换运行；`candidate`与`migration_required`均不表示升级已执行。真实数据观察生产者、安装准备、用户文件冲突、历史执行者及迁移/回退仍待03/06/12接线。

实际验证：首次原合同入口类型检查发现`checkCoreCombination`返回对象误作迭代器（TS2488），before hook失败、业务8组未执行；改为迭代issues后复验8组通过/退出0，最终一次包含全部新源码类型。stdin短命令核对底座/单Core分别更新、其他模块与原输入不变、版本/来源/重复发行/缺数据拒绝、前进迁移、已应用读回、错误摘要/版本及platform同名隔离（退出0）；CLI用真实schema/计划器与内存只读文件facade核对三输入、纯JSON、0/1/2退出（退出0），这不是外部文件安装或真实迁移证明。未新增/扩写测试脚本，无临时独立运行器。

[接入说明](../../../packages/core-contracts/README.md)同片给出可执行预检命令、输入唯一来源、结果/错误处理及下一执行边界。原任务仍需真实生产者、独立宿主、授权/生命周期、完整消费者及独立升级结果，不因纯预检跨档；持续目标继续推进。

<a id="core-ownership-baseline-20261114"></a>

## 原组合的数据归属与下一公共片（2026-11-14）

服务端合同固定于 `953fccad0ad538d0dc27aad8df717ba52297baa7`，普通推送成功并由`ls-remote`回读一致。本阶段继续以已包含的main `6ca19ac34a3260405ba24388a4aa2a933450e70b`为原行为基线，源代码读取来自本树已核定文件及该固定Git对象，不读取其他研发活动WIP。以下为待实现连接的范围冻结；每片的实际运行结果仍须另取，不能将静态归属盘点当作全功能通过。

### 数据所有者及独立构建的最小范围

核读[Prisma模型](../../../apps/api/prisma/schema.prisma)、原仓储调用、原生SQL和实际服务。当前238个模型分为公共候选29、AI86、Rental及客户端110、企业Rental扩展12、营销申请1；这是所有模型的排查分组，部分通用运输和业务政策共处的表须继续拆字段/适配，不能按前缀自动搬表。AST扫描找到了12个企业模型没有delegate调用，随后确认企业大量使用原生SQL；这不是未使用代码或可删表证据。

| 数据集合与唯一所有者 | 生产者、直接消费者及拆分方式 |
| --- | --- |
| 平台身份：Tenant、OrganizationUnit、User、AuthSession、AuthLoginFailure、Role、Permission、UserRole、RolePermission | [平台仓储](../../../apps/api/src/modules/platform/platform.repository.ts)与[Auth](../../../apps/api/src/modules/auth/auth.service.ts)拥有登录/角色/会话写入；Guard、AI可信主体及所有业务调用方消费。公共查询只投影账户/租户/角色；当前Tenant/User/Organization反向Rental关系、会话currentWorkspaceId等由组合schema/适配维护。不能复制另一套用户或令牌服务来做无Core登录 |
| 公共设置：UserAppearancePreference、TenantAppearanceProfile、SystemParameterSet、FilterPreset | [账号外观](../../../apps/api/src/modules/client/account-appearance.service.ts)、[租户外观](../../../apps/api/src/modules/client/tenant-appearance-profile.service.ts)及平台仓储。外观虽在client目录仍属公共面；租户外观首次保存会读旧ClientChannelProfile补旧值，需将此历史读取交Rental兼容适配；不能在无Core宿主上查询不存在的渠道表。参数/筛选模板保留原用户与租户范围，业务参数由所属Core管理 |
| 平台订阅：TenantSubscription、TenantSubscriptionSegment、SubscriptionFeatureCatalog、TenantFeatureGrant、SubscriptionRequest、SubscriptionEvent、SubscriptionStandardPrice | [SubscriptionService](../../../apps/api/src/modules/subscription/subscription.service.ts)唯一计算统一期限及办理事实；Core消费当前期限/权益，品类身份由Rental适配供给。新Core授权不改这些期限或恢复主动撤权 |
| 公共运输与审计：OperationLog、FileAsset、FileUploadSession、NotificationTemplate、NotificationSendLog、ExternalAdapterLog、TenantIntegrationConfig、AsyncJob、DocumentPrintJob | [审计](../../../apps/api/src/common/operation-log.service.ts)、[集成目录](../../../apps/api/src/modules/integrations)、[文件ACL](../../../apps/api/src/modules/files/file-business-access.service.ts)、jobs/notifications原入口。存储/发送/排队机制公共；businessType、模板内容、上传场景及业务文件ACL仍归Core，需登记处理器。FileAsset等字段含workspace/业务关联，不能仅搬类就视为无Rental依赖。原收据与任务引用、延迟回调执行者保持 |
| Rental配置与经营范围：全部Rental模型、BusinessWorkspace、WorkspaceMember、TenantRentalProfile、WorkspaceCapabilityInstance/AuditEntry、CapabilityHookAuditEntry、OfficialCalendarSource/Version | 原[Rental服务](../../../apps/api/src/modules/rental-core/rental-core.service.ts)、[能力服务](../../../apps/api/src/modules/rental-core/workspace-capability.service.ts)及品类解析/治理所有。经营空间单品类、成员角色覆盖/地点过滤保留，包装成Core范围适配；工单不继承这组表。日历来源及原历史快照继续按Rental原所有者维护 |
| Rental客户/企业事实：Customer开头全部模型、企业12模型 | 平台目录内[会员](../../../apps/api/src/modules/platform/membership.service.ts)、[客户仓储](../../../apps/api/src/modules/platform/shared-customer.repository.ts)、[企业结算](../../../apps/api/src/modules/platform/customer-corporate-settlement.service.ts)及[企业扩展](../../../apps/api/src/modules/enterprise)真实读写；保持租户级会员与企业关系、空间级订单/资金范围的区别。其他Core不得因同名customer复用其表；当前企业审批/收据端口仍归ECP/Core原作者 |
| Rental客户端渠道：ClientChannelProfile/Workspace、WebsiteChannelProfile/Asset、MiniProgramChannel、ClientWechatIdentity、ClientRegistrationChallenge、ClientAuthSession、ClientApiRateBucket、ClientOrderDeliverySnapshot及CustomerDeliveryAddress | [client目录](../../../apps/api/src/modules/client)维护现有客户身份、发布空间、网站/小程序和本人订单链。渠道配置有租赁发布空间及默认空间，保留在Rental接入；WebsiteAsset存在公共品牌使用候选，提取其字节运输需沿当前上传/公开读取契约核查，不能让公共Logo强依赖Rental表 |
| Rental设备及支付事实：TBoxDevice、PaymentWebhookEvent、PaymentReconciliationBatch/Line及Rental支付/资金模型 | 设备/支付运输可通过窄端口复用，当前命令与资金引用属于Rental；回调须定位原订单/支付操作，不能由请求自报coreId路由。支付/退款/对账unknown保留原审计和恢复，不能换Core重复执行 |
| AI：Ai开头86模型 | 原[AI组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)与领域仓储/原生SQL所有；通用任务、Gateway/预算与行业动作适配逐片分离。当前表广泛包含workspace/原业务引用，不能先重命名或重建；无AI宿主不依赖其模型/初始化。有AI时保留历史任务、工具/批准版本、账及原收据 |
| 营销：DemoRequest | [演示申请模块](../../../apps/api/src/modules/demo-requests)及营销网站所有；属于可选营销能力，无Core公共登录不以申请模块为必需依赖 |

259份现有迁移中，多份同一SQL同时涉及公共表、Rental外键/业务表或AI关系；例如[初始迁移](../../../apps/api/prisma/migrations/20260608000100_init_store_rental_schema/migration.sql)与[Rental初版](../../../apps/api/prisma/migrations/20260813000100_add_rental_core_v1/migration.sql)。对旧表的创建/移除和重命名保持历史原文，不能按文件名前缀裁剪后在已有库重放。索引型SQL也须登记归属，已补核[AI检查索引](../../../apps/api/prisma/migrations/20261007211000_ai_inspection_submission_index/migration.sql)与[资产锁查询索引](../../../apps/api/prisma/migrations/20261101010000_asset_hold_current_read_indexes/migration.sql)。

实施方向为分别生成公共及所选Core的受限数据适配/构建，再由同进程组合明确持有实际事务。公共schema不声明未选Core的导航关系；旧组合保留原表名/ID/FK和历史迁移链。新空库的公共基线与既有组合的增量演进是两条明确入口，不能以旧完整链先建全部Rental表再隐藏来证明无Core。实际schema拆分/组合生成、迁移账归属和真库演练待06/12固定窗口，当前未产生或执行SQL。

### 原功能与所有直接消费面的去向

| 基线功能、角色与实际入口 | 固定合同/数据及必要验证入口 | 当前证据与下一切片 |
| --- | --- | --- |
| SaaS/租户登录、退出、本人安全、当前会话：[Auth](../../../apps/api/src/modules/auth/auth.controller.ts)与[Guard](../../../apps/api/src/common/api-auth.guard.ts) | 原AuthUser/LoginResponse、用户/角色/AuthSession；[登录锁定](../../../tests/auth-login-lockout.test.cjs)、[租户权限](../../../tests/tenant-admin-privilege-write.test.cjs)、[租户成员政策](../../../tests/tenant-membership-policy.test.cjs) | 当前未运行这些整链；04拆基础身份/业务范围，保留签名、audience、撤权、空间修订及原可信票据 |
| SaaS租户管理、租户账号/角色/组织和公共参数：[平台Controller](../../../apps/api/src/modules/platform/platform.controller.ts) | 原TenantSummary/SystemUser/Role、参数和操作日志；[租户访问原子性](../../../tests/tenant-access-atomic.test.cjs)、[公共SaaS](../../../tests/saas-foundation.test.cjs) | 当前listTenants带Rental订单/空间统计，bootstrap要求品类并写门店角色。03/04新公共创建入口只建原平台事实；旧租赁bootstrap继续原同事务编排，不能把回调改为可选成功 |
| 租户与账号外观/语言、公共后台框架：[租户外观](../../../apps/api/src/modules/client/tenant-appearance-profile.controller.ts)、[会话状态](../../../apps/admin/src/features/auth/authStore.ts) | 原appearance合同/乐观锁、公共外观表；[外观检查](../../../tests/admin-appearance-settings.test.cjs)、[品牌检查](../../../tests/admin-branding.test.cjs) | main语言/主题已集成固定原作者成果，当前不重复宣称实页验收。07保留React/UIArc、声音、主题/语言，拆旧渠道补值与新Core可见性 |
| 订阅/续费申请/期限/额外权益：[订阅目录](../../../apps/api/src/modules/subscription) | [共享订阅合同](../../../packages/shared/src/subscription.ts)与统一期限表；[订阅服务](../../../tests/saas-subscription-service.test.cjs)、[日历](../../../tests/saas-subscription-calendar.test.cjs) | 原SubscriptionService读取品类身份；06经登记适配消费，期限/未知历史政策保持，不新增收费模型 |
| Rental配置/品类/商品/资产/报价/订单/履约/检查/资金：[原业务](../../../apps/api/src/modules/rental-core/rental-business.service.ts) | 原core运行时、不可变版本/快照与仓储；[Core](../../../tests/rental-core-v01.test.cjs)、[业务](../../../tests/rental-business-v1.test.cjs)、[定价](../../../tests/rental-pricing-strategy.test.cjs)、原各业务专用用例 | 08按受影响功能取前后对照；原接续明确库存/恢复fixture、续租脚本历史改写及真库缺口，保留归属。当前新合同未触及业务算法，不能关闭这些问题 |
| 租赁企业后台、本人客户网站/小程序、员工端：[企业](../../../apps/api/src/modules/enterprise)、[Client API](../../../apps/api/src/modules/client/client-api.service.ts) | 原企业grant/审批/财务投影、客户/员工audience；[企业政策](../../../tests/enterprise-policy.test.cjs)、[企业消费](../../../tests/enterprise-consumers.test.cjs)、[客户渠道](../../../tests/client-channel.test.cjs)、[员工小程序](../../../tests/staff-miniprogram-static.test.cjs) | ECP原固定接线证据可追溯；真实历史空间/账单/保证金及小程序基线类型失败仍未验/未解。本片不把普通客户改成租户员工权限 |
| AI任务/工具、MCP/Harness：[AI组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[MCP包](../../../packages/mcp-server)、[Harness插件](../../../clients/harness-plugin/README.md) | 原工具目录/批准/任务/账/收据；[原审计](../../../tests/mcp-original-audit.test.cjs)、原AI定向入口 | 09只改已固定Core接点；AI15/25活动成果由原作者完成。本片原MCP运行回归曾被自动审批拒绝，仍未验；现有AI默认关闭不能替代正向验收 |
| 文件/通知/支付回调/作业/打印：[集成目录](../../../apps/api/src/modules/integrations)、[ACL](../../../apps/api/src/modules/files/file-business-access.service.ts)、[到期作业](../../../apps/api/src/modules/rental-core/rental-due-job.scheduler.ts) | 原上传/运输/支付引用、租户/空间权限和幂等；[文件生命周期](../../../tests/file-storage-lifecycle.test.cjs)、[支付回调](../../../tests/payment-callback-integrity.test.cjs)、[通知租约](../../../tests/rental-notification-lease.test.cjs)、[作业调度](../../../tests/rental-due-job-scheduler.test.cjs) | 原运输与业务解释混合；06/08登记原执行者，保留迟到/重复/unknown，不因停用统一丢弃原收尾 |
| 页面、API、shared、构建/离线资料：[原OpenAPI](../../../apps/api/src/contracts/openapi-document.ts)、[后台路由](../../../apps/admin/src/app/AppRouter.tsx)、[shared](../../../packages/shared/src/index.ts) | 原API/DTO/权限静态脚本、各包tsconfig和构建。后台shared源码别名及查询epoch见[queryClient](../../../apps/admin/src/app/queryClient.ts) | 现有API语义/operationId/schema/深链接保留；新Core贡献走独立合同。07增加Core/容器缓存隔离；03组合构建不能继续通过shared总出口把Rental带入无Core宿主 |

全Git源码集合还包括`packages/ui-arc/ui-motiq/ui-tablecn/web-client`、营销站及克隆参考工程、保留Harness上游、测试/fixture和脚本。按已有来源/许可识别vendor/原型/生成物，保留唯一原稿；不能把源码扩展名总数当自有文件数，也不按“无delegate引用”删SQL消费者。实际逐模块注释/死分支/错误处理整改随所属切片进行，本表是覆盖清单，不是整库代码质量已经验收。

### 可交接的公共文件最小候选

以下候选基于本节main和服务端合同固定提交，供PM为具体片指定唯一作者；在取得窗口前不写公共入口。每片先保持Rental旧消费者，然后接新Core，合并时仍取最新main并核增量。

| 顺序 | 精确文件/方法 | 所需改动与退出条件 |
| --- | --- | --- |
| 1 | `platform.repository.ts` 的 `listTenants/findTenantByCode/findUserForLogin/toTenantSummary`；对应PlatformService薄转发 | 基础租户与用户投影不查询rentalProfile/业务计数；Rental提供已注册可选投影。既有租赁响应字段和值保持，无Core返回真实公共身份而非虚构品类 |
| 2 | `platform.repository.ts` 的 `bootstrapTenant` / `platform.service.ts` 同方法及原DTO/Controller局部 | 独立公共创建入口复用原密码、用户/组织/角色/参数/审计；旧带品类bootstrap保留完整同事务Rental初始化。公共创建不种门店/业务模板；当前旧模板回执还描述演示车辆/订单，须与实际写入核同再整理，不能复制进公共入口 |
| 3 | `auth.service.ts` 的 `resolveAccessContext/issueSession/buildLoginResponse/getSessionContext/getCategoryContext`，`api-auth.guard.ts` 对应范围/策略；原ALS最小附加Core范围 | 拆公共认证和每Core范围提供者，保留原签名/租户/成员/撤权/并发时点；采用独立合同的CorePrincipal/Scope/Binding，客户端自报coreId不授权。原workspace兼容字段和可信票据留Rental映射；新Core不继承默认经营空间 |
| 4 | 原schema/迁移与原人员角色服务局部 | 新增部署/Core授权/成员分配/绑定/原操作记录，使用复合唯一键及当前修订；授权不扩成全员。初始化先锁当前授权，再锁绑定/原操作，写Core与审计，同事务提交后才发布缓存；完整Prisma只留私有组合适配 |
| 5 | `app.module.ts` 最小受控装配；独立平台/选中Core数据及包配置 | 消费`registerCoreServers`和显式模块引用，只有通过兼容/数据检查才允许新准入；空组合不加载Rental/AI代码/作业/表。原组合保持唯一执行者；只建另一个能登录的旁路服务不能代替原公共代码抽离 |
| 6 | `openapi-document.ts`、shared正式出口及后台Auth/路由/导航局部 | 原接口身份归属先分组，再消费新`composeCoreOpenApi`；旧Rental例外逐项固定。公共后台消费真实授权/成员分配/就绪，不把前端可见性当鉴权；旧缓存epoch与未保存保护保留 |

现有技术指南§4.1/4.2将经营workspace/品类/capability写为所有经营API前提，§4.3只指shared总出口；与已批准PCH多行业合同存在适用范围差异。Rental原边界继续有效，新增Core采用自己的范围与独立正式合同。待相关实现片同步公共指南时明确将旧条款限定到Rental，不暗中按新源码改锁定规范。

本阶段AST/SQL短命令退出0，覆盖模型和原API Controller/方法及跨模块调用定位；AST不覆盖动态SQL/字符串拼接/运行分支，已用实际企业SQL和索引SQL补核其局限。没有新增测试脚本、完整环境副本、SQL执行、业务网络或后台进程。本片仍需在实际公共窗口内取行为基线、完成迁移/构建决策及真实消费者验证；原任务不按盘点数量跨档。

<a id="core-server-contract-20261114"></a>

## Core 服务端注册与生命周期合同（2026-11-14）

负责人要求设定持续目标并完成原 PCH-01～12 拆分。目标已建立，工程继续同一独占树和 `codex/platform-core-extraction`，本片基线为已推送 `8d0abba954a31f8aee36cdcd97eb710466e783dc`；当日 `git fetch origin main` 与 `git ls-remote --heads origin main codex/platform-core-extraction` 核定 main 仍为 `6ca19ac34a3260405ba24388a4aa2a933450e70b`，本树已包含该版本，工作区/索引起点干净且无合并/拣选状态。目标不扩大既有公共文件写入窗口或真实环境权限。

[生命周期合同](../../../packages/core-contracts/src/lifecycle.ts)将平台持有的租户Core授权、成员分配、业务绑定和原操作引用分别定义为唯一schema/推导类型。保存记录修订从1开始，变更请求0表示不存在；成员分配请求不接受租户字段，管理范围由原认证确定。Core就绪明确为ready、configuration_required（非空缺项）或unavailable，授权/注册不替代就绪；无Core独立期限、收费或自动恢复成员权限字段。初始化、持久化、当前撤权与同事务审计尚待真实宿主供给，schema不是认证凭证。

[服务端合同](../../../packages/core-contracts/src/server.ts)定义受控组合传入的真实服务实例和最小范围/生命周期接点。`registerCoreServers`核对唯一ID、宿主兼容、清单/实现版本及必需函数；空组合合法，错误不返回部分注册表，注册过程中不执行Core函数、不加载路径、不授予使用权。业务命令和HTTP/AI/作业仍经所属Core原正式入口，不引入万能`execute(action, JSON)`。

`defineCoreInitializer`将Core自己的schema解析集中在初始化输入边界，下游取得已验证类型。可选初始化只表示Core是否需要初始领域事实，宿主仍须真实写入绑定与审计。`CoreTransaction`仅为受限、回调内句柄合同；后续适配须在运行时核对所属Core/当前事务与有效期，不把类型标记或完整Prisma client当安全隔离。缺少`assessRemoval`时不能批准代码移除；unknown/在途/回调/作业/历史依赖均显式表达，重新开通不重放原操作。

实际复核原[Auth/可信主体](../../../apps/api/src/modules/auth/auth.service.ts)、[请求身份](../../../apps/api/src/common/request-identity.ts)、[平台仓储](../../../apps/api/src/modules/platform/platform.repository.ts)及[订阅](../../../apps/api/src/modules/subscription/subscription.service.ts)：登录仍加载Rental档案，Auth仍注入空间能力，初始化仍在原事务内调用Rental，期限仍由原SubscriptionService计算。新合同没有替换这些生产路径。后续候选须保留原Auth/Guard/ALS、原租户和角色映射，并将Rental范围/品类逻辑收在适配器中；不能用当前schema通过称无Core已可登录。

必要验证使用原单一合同入口（8组、退出0，含新增源码类型与反向依赖检查），以及一次stdin运行时核对（退出0）：空/双Core、同ID、身份/实现版本冲突、缺必需函数/错误可选贡献、不执行生命周期函数；授权禁额外到期日、持久修订不能为0、成员请求禁自报租户；缺项非空；初始化错误输入不进领域回调且每次只解析一次。此为离线合同证据，不是真实授权、初始化事务或服务器组合验收。未新增测试脚本，原单一入口退出时清理本树临时产物；stdin不落文件。

[模块接入说明](../../../packages/core-contracts/README.md)与源码同片维护函数、职责、调用顺序和未接线范围。完整数据/消费者基线及真实双Core消费者尚未齐，02的身份/公共服务/事件与正式运行接点继续待交付，原任务门槛本片不跨档。公共文件候选与待授权接线见现行接续；首段原MCP审计的自动审批拒绝继续保留，未以本片合同核对替代该回归。

本片3份文档定向本地链接检查退出0，原需求/任务正文对照未变，原白名单仍只有总导航第54行3个历史附件缺失。首次临时核对因全库`ls-tree`输出超过Node默认缓冲而退出1，未改源码；只调整stdin读取缓冲后复核退出0，没有新增脚本或落地清单。`git diff --check`退出0，`output/.tmp/core-contracts`确认已删除，无新服务或其他一次性产物。

<a id="core-openapi-contract-20261114"></a>

## Core API 文档贡献与独立组合（2026-11-14）

继续同一 PCH-02 独占包窗口，基线为已推送的 `bb850efcd5b614efe2379137ecd0ae4791e08231`；实际远端 main 仍为 `6ca19ac34`。本片不修改原 `openapi-document.ts`、Guard、AppModule 或 AI 工作目录，先交付可供宿主消费的独立接口文档接点。

[OpenAPI 合同](../../../packages/core-contracts/src/openapi.ts)导出 `CoreOpenApiContributionSchema`、`checkCoreOpenApi`、`composeCoreOpenApi`。Core 声明包内 JSON，使用 OpenAPI 3.0 的 paths 和 schemas；新路径为 `/api/cores/<id>/...`，operationId/schema 采用 `<id>.` 命名空间。每项操作要求用途、响应和显式security；其余字段按标准文档语义保留。这里只验证归属、最小文档约束与组合冲突，不自建一套完整OpenAPI验证器，也不替代Controller/DTO验证。

组合器创建原平台文档的副本，按所选Core组合；重复Core、同形路径（包含只改参数名）、operationId/schema冲突、缺失或隐式跨Core schema引用均返回具体问题，失败不发布部分文档。引用只在本Core或平台公共schema解析，不自动请求外部URL。例子/default/enum中的业务值以及名为`$ref`的业务属性不会被误当作外部文档引用。

[目录检查](../../../packages/core-contracts/src/package.ts)已实际消费该合同：若清单声明OpenAPI，则只读取JSON并校验，不执行Core入口。迁移/OpenAPI单文件读取上限为32MiB，其他业务入口只查文件元信息。原Rental路径可以由受控宿主提供精确METHOD/path白名单，Core本身不能新增豁免；原operationId/schema兼容映射、主应用JSON入口和离线导出仍待正式迁移片核定，不宣称现有API已解耦。

[接入说明](../../../packages/core-contracts/README.md)同片加入“给Core附上API说明”，解释文件、命名、鉴权声明、引用、组合器与失败结果。当前完整业务手册仍从原任务五步入口展开，运行SDK/授权/样例未实现的步骤继续明确标注。

必要验证只复用原单一合同测试及stdin短命令：`node --no-compilation-cache --test packages/core-contracts/test/core-contracts.test.cjs`（退出0、8组，包含新增文件完整类型与独立导入）；`node --no-compilation-cache -`内存核对空/双Core、冲突、宿主旧路由白名单、跨Core/外部引用和原文不变（退出0）；另以文件读取facade确认包检查实际读取API JSON、拒绝损坏/错误归属且不读取服务器代码（退出0）；修正文档例子引用后短命令复验业务`$ref`与真实嵌套引用（退出0）。本片没有新增或扩写测试脚本、依赖安装、网络/业务调用或后台进程；已有合同测试临时目录清理确认不存在。

这些结果为合同/类型/离线组合证据。真实平台生产者、Rental与非租赁API完整迁移、当前权限和公开文档覆盖待公共窗口；02尚未完成全部必需合同，原任务百分比本片不变。首段原MCP审计被自动审批拒绝的未验项继续保留，不用本片API检查关闭。


## 四册归并（2026-10-31）

接口与生命周期设计、接入指南归入开发任务的[实施设计](平台Core接入-开发任务.md#contract-design)与[接入步骤](平台Core接入-开发任务.md#integration-guide)，协作接续只维护当前入口。原文及修改前像见[归档清单](历史归档/四册整理/2026-10-31/manifest.json)。PCH-11的可操作资料和独立接手门槛不变；本次没有交付SDK/样例，不提高12项百分比。

<a id="pch-frozen-main-20261114"></a>
## 最新底座文档与保留品牌资产的固定合并（2026-11-14）

负责人要求合入所有冻结树，并同步昨晚已确认的项目名与README。固定来源为 `1663171c1b505cbb824d4895d0b74678443d8daa`，含原Nativark/MIT、N方案和Core两方案22份保留资产以及v1.3标准化六文档。README、LICENSE与许可元数据已经等同main，合并保留现有版本；PCH尚未启动工程，原任务不因文档/素材合并加分。两个记录/接续冲突按职责归并：保留main全部集成证据，补来源三段原文，接续使用已批准v1.3现场。

负责人当前暂选Preview同款黑白图形作为运行默认标志，后台作者单独适配；本片只保留N/A/B唯一原稿，不将任何候选直接换成应用默认。尚未确认的新名称讨论不替换本片已冻结Nativark名称。原技术包/API/数据标识与业务功能保持，未执行部署/迁移。

最终合并使用本片固定Git第二父提交，原开发树及AI活动WIP不写入；验证为六份文档链接/原内容与22资产字节核对，后续最终main按负责人安排交QA一次review。

<a id="nativark-logo-n-retained-20261114"></a>

## Nativark 静态标志 N 方案保留（2026-11-14）

负责人要求参考其 Preview 标志制作静态 SVG，提供黑白和彩色版本。实际参考页面为 `http://127.0.0.1:5264/index.html`，标题为“Preview · Logo 动效”；本阶段读取层叠圆角卡片、粗轮廓及蓝色渐变的视觉特征，手工绘制三块错位圆角模块、前景 N 字母和承载托座。N 是助手自行取 Nativark 首字母加入的品牌识别。

负责人随后指出底座承载的对象应是 Core，并要求“先保留现在的这个”。本阶段完整保留当前 N 方案，作为后续可对照的初版原稿；负责人尚未确认最终标志。承载对象表达 Core 的反馈留作后续设计依据。

唯一资产集合位于本任务树 `assets/01_Logo/`，包含[彩色 SVG](../../../assets/01_Logo/nativark-logo-color.svg)、[黑色 SVG](../../../assets/01_Logo/nativark-logo-black.svg)、[白色 SVG](../../../assets/01_Logo/nativark-logo-white.svg)、[彩色 PNG](../../../assets/01_Logo/nativark-logo-color.png)、[黑色 PNG](../../../assets/01_Logo/nativark-logo-black.png)、[白色 PNG](../../../assets/01_Logo/nativark-logo-white.png)及[三色对比图](../../../assets/01_Logo/nativark-logo-preview.png)。三份 SVG 均为 512×512 透明背景静态矢量，PNG 为对应透明导出，对比图为 960×320。原七份文件完整保留，未另建重复副本。

| SVG 原稿 | 字节数 | SHA-256 |
| --- | --- | --- |
| `nativark-logo-color.svg` | 2133 | `142ca0c20889c29b2cd423b824701dd6a6217d3ff88485293dd4a39d6054feae` |
| `nativark-logo-black.svg` | 2737 | `ce4bdcd113a81ace09d7acc5c1ff7178be0afe4db495aafbf3de74af7d07ce20` |
| `nativark-logo-white.svg` | 2737 | `dc227261b7c9a0ac488225cd8b6c24f16d6681f6b7d584948c6f1634e27746c9` |

复用宿主已有 sharp 导出 PNG，并实际查看三色对比图。`node --no-compilation-cache -` 经 stdin 核对 SVG 静态内容、尺寸、内部引用及 PNG 像素，退出 0；PNG 与对应 SVG 内存渲染相同，四角透明，黑白版轮廓一致。PowerShell 使用禁用外部解析器的 `System.Xml.XmlDocument` 读取三份 SVG，退出 0。参考页临时标签已关闭，原减少动态效果设置已恢复；本任务未新增临时目录、诊断脚本或后台进程。

本阶段复用 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS`，任务分支 `codex/nativark-logo`，固定父版本为已上传的 README/MIT 提交 `d4ea8aa340a77e996bb5c54f76e2f98b9fdedb43`。实际远端核对确认父版本在 `codex/nativark-mit`，logo 分支开工时尚无远端提交，暂存区干净且无合并/拣选现场。七份资产原被既有 `.gitignore` 的本地设计原稿规则忽略，作为明确要求的交付物精确强制暂存，忽略规则不变。

交付范围为七份资产及原开发记录、接续。`node --no-compilation-cache -` 定向文档检查退出 0，核对两份文档的 92 个本地链接、15 个锚点引用和 10 个表格，原开发记录全文及接续的产品边界、原下一入口保留，正式需求/任务和 README/MIT 文件无新增差异；稀疏检出外的链接目标依据固定父版本 Git 树核验。`git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 退出 0。固定提交以包含本节的 Git 对象定位，按持续授权普通推送 `codex/nativark-logo` 后回读实际远端，在本对话登记 SHA。品牌资产不计 PCH 工程进度。

<a id="nativark-logo-core-options-20261114"></a>

## Nativark 承载 Core 的两版静态标志（2026-11-14）

负责人明确要求“保留所有成果，再给我设计两版给我选择”。本阶段在同一品牌设计工作树和 `codex/nativark-logo` 分支继续，以已上传的 N 方案固定提交 `633fdf889fe2db46bf99b15d4bf2da53b851a7d6` 为父版本。开工核对确认本地与实际远端任务分支一致，工作区/暂存区干净且无合并/拣选现场。已有 README/MIT、N 方案七份文件及原记录保留在 Git 原位置；两版以新文件名增加。

两版都将被承载对象画为业务 Core，以独立中心核识别每个模块，沿用实际 Preview 参考页的圆角、粗轮廓和蓝色渐变。A“模块托座”使用三个错位圆角模块和正面托座，保留卡片层叠感；B“Core 平台”使用三个等距立方 Core 和一块厚实公共平台，形成不同的立体轮廓。均为本阶段手工绘制的纯静态矢量，待负责人选择。

| 方案 | 彩色 SVG | 黑色 SVG | 白色 SVG | 对照预览 |
| --- | --- | --- | --- | --- |
| A · 模块托座 | [彩色](../../../assets/01_Logo/nativark-core-dock-color.svg) | [黑色](../../../assets/01_Logo/nativark-core-dock-black.svg) | [白色](../../../assets/01_Logo/nativark-core-dock-white.svg) | [黑／彩／白](../../../assets/01_Logo/nativark-core-dock-preview.png) |
| B · Core 平台 | [彩色](../../../assets/01_Logo/nativark-core-isometric-color.svg) | [黑色](../../../assets/01_Logo/nativark-core-isometric-black.svg) | [白色](../../../assets/01_Logo/nativark-core-isometric-white.svg) | [黑／彩／白](../../../assets/01_Logo/nativark-core-isometric-preview.png) |

每版附有三份对应的透明 PNG。六份 SVG 与六份 PNG 为 512×512，两张对照图为 960×320。尺寸、设计来源、N 方案原始哈希及本阶段十四份导出的字节数/SHA-256统一见[资产清单](../../../assets/01_Logo/nativark-logo-options.json)，该 JSON 是实际资产清单，不新增专项第五册或重复原稿。旧七份成果均与固定父版本 Git blob 逐字节相等。

复用宿主已有 sharp 渲染，不安装项目依赖。实际查看两张对照图后，`node --no-compilation-cache -` 经 stdin 核对六份 SVG 的尺寸、唯一 ID、内部引用、无脚本/动画/外部资源及清单哈希，退出 0；对应 PNG 与 SVG 内存渲染逐像素相等、四角透明、黑白版轮廓一致。PowerShell 以禁用外部解析器的 `System.Xml.XmlDocument` 解析六份 SVG，退出 0。生成中定位到 A 彩色 SVG 的内部 ID 重复，修为独立平台 ID 后定向验证通过，视觉像素未变。

继续使用同一个 Creative Production board `890e57af-654c-44e6-8a39-09d14e2d53f6`，保留原三项并追加六个新预览；六项 complete 回执均对应原 board 和预定 item，revision 12～17，未另建看板。全部导出位于唯一 `assets/01_Logo/`，过程脚本经 stdin 执行，本阶段未创建临时目录、下载/安装依赖或后台进程。

交付范围为十五份新增资产（六份 SVG、六份 PNG、两张预览、一份清单）及原开发记录、接续。`node --no-compilation-cache -` 定向文档检查退出 0，核对两份文档的 103 个本地链接、17 个锚点引用及 11 个表格，原开发记录全文和接续中的产品边界、PCH 下一入口完整保留；稀疏树外目标按固定父版本 Git 树核验。差异格式检查 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 退出 0。精确暂存明确交付文件，不改忽略规则。原需求/任务、工程进度及其他作者文件不变；最终标志待负责人选择。暂存后核对资产字节及清单哈希，按持续授权普通推送当前任务分支后回读真实远端，固定 SHA 留在本对话。

<a id="core-standardization-20261114"></a>

## Core 标准化、兼容拆分与简明接入资料（2026-11-14）

### 本轮需求与处理决定

负责人准备拆分 Core 与底座，要求保住现在所有功能、同时标准化 Core 接入并留下简单的说明，能把说明交给开发 Agent 快速做出 Core；随后补充 GitHub 标签发现/下载安装、全平台源码梳理和文件备注、避免无依据防御与简洁高效实现、完整API说明、无Core可保存公共设置、轻量工单/工作流Core，以及底座跟随上游和Core独立更新，并询问AI Native未完成的影响。本轮按原“先分析并完善文档”继续准备，已将这些要求纳入未来实施范围；本轮尚未启动源码修改。

| 事项 | 本次落位 |
| --- | --- |
| 现有功能继续正常 | R09/A09、任务01/08/12与4.1；建立有实际结果的全功能清单，按切片核对原正常、既有失败和未验项 |
| 推荐的拆分方式 | 同仓分模块，先正式合同和兼容适配、再逐段替换连接；每段保持原业务，事务/数据/权限和唯一执行者持续可核对 |
| AI Native尚未完成 | R08、任务4.2/09；不等AI全专项完成，已支持功能保兼容，未完功能留原任务，只等待实际需要的固定接点 |
| Core标准化 | R02、任务02/03/5.8；清单、正式出口、最少必需贡献和可选扩展、版本/来源与统一校验相互一致 |
| 简单的Agent接入说明 | R10/R11、任务10/11和五步快速入口/Agent模板；实际命令与最小样例随实现补齐，由独立接手者验证 |
| GitHub发现与安装 | R11/R12/A12及03/07/10～12；Topic用于发现，固定Release包用于安装，下载/部署/注册/租户授权分别记事实 |
| 全平台可理解性 | R01/R11、任务01/11/4.3；全量自有代码盘点、模块/关键文件职责及复杂逻辑说明，第三方/生成物/历史归属明确 |
| 简洁高效实现 | R09、任务4.3；处理重复/无效包装、吞错和无依据兜底，保留边界校验、授权/幂等/并发/事务与恢复保障，优化用实际证据证明 |
| API资料 | R11、任务02/11/4.4；平台/Core可组合OpenAPI、同版本离线文档、schema/例子与源码/消费者一致性，HTTP与模块SDK分别说明 |
| 无Core基本功能与轻量Core | R01/R10及1.8、任务01/03/07/10；租户登录和公共设置真实保存/隔离，最小非租赁样例优先简单工单，通用流程引擎不内置 |
| 底座上游更新与Core单独更新 | R02/R12、任务02/03/06/10～12及5.9；版本分离、兼容预检、用户Core/配置/数据保留、迁移与恢复，分别验证底座升级和单Core升级 |
| 范围变化 | 根据本轮补充将轻量发现/分发/受控安装及独立更新纳入首期，明确全平台代码/API可理解性；付费交易、热加载、远程服务化不随之引入 |

需求/任务升至v1.3，沿原PCH-01～12细化交付，原12行任务表、编号/依赖/顺序、G1～G4评分和现有百分比保持。平台索引增加快速入口；未来方案v1.5校正已转入PCH的分发、代码/API资料和独立更新范围及已确认Nativark/MIT依据。源码文件职责、复杂边界说明和API例子随实现同片更新，指南从任务内设章节及正式合同生成随包文件，不新增第五册。原R01～R12/A01～A12身份保留，验收按负责人本轮扩展补充。

### 外部参考的核实

实际使用 Tavily 检索与读取负责人给出的[Magpie首页](https://usemagpie.ai/zh/)、官方[插件开发文档](https://usemagpie.ai/docs/plugins)及[社区插件样例](https://github.com/magpie-community/plugins)。官方文档有最小示例、模块/Hook说明、测试、发布与上架规则；其GitHub发现使用仓库Topic `magpie-plugin`，归入未审核来源，根package.json与可加载入口有明确要求。Topic不是版本Tag，也不等于直接批准执行。

Nativark借鉴清晰入口、按需参考、最小样例和机器检查的开发体验；选择 `nativark-core` Topic作为本项目发现约定，Release/版本Tag/提交与摘要锁定安装包。这是本轮提出的Nativark设计，并非Magpie当前实现的照抄；不会采用其模型供应商插件/中间件的运行与错误放行规则来替代服务端Core授权。先做本地标准包、再接Release下载、最后接发现界面。未下载安装或运行Magpie，未改变本项目Topic或创建公开发行。

### 固定来源与现有工程证据

主树当次固定HEAD/实际远端main为 `de9458d0470ee5deace40b7211d0c7ec3f868e00`，仅只读核对；六项既有WIP归其他作者，main索引未改。原文档工作树 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS` 的 `codex/nativark-logo` 在 `8f4c45b3a5f637256afac9363ca13a4cd2232a5c` 与实际远端一致且干净；从该固定父版本新建 `codex/core-standardization`，复用既有稀疏树，不复制主树/依赖。

开始修订前，需求、任务、平台索引及未来方案与固定main正文一致；本树保留完整品牌阶段原记录，main另有PM的README/MIT归并记录。因此本轮不整取main或其他活动HEAD。该归并原文直接见[固定main中的许可归并](https://github.com/JinPen-G/Nativark/blob/de9458d0470ee5deace40b7211d0c7ec3f868e00/docs/%E5%B9%B3%E5%8F%B0%E5%BA%95%E5%BA%A7/Core%E6%8E%A5%E5%85%A5/%E5%B9%B3%E5%8F%B0Core%E6%8E%A5%E5%85%A5-%E5%BC%80%E5%8F%91%E8%AE%B0%E5%BD%95.md#nativark-mit-main-integration-20261114)，不复制历史原文。PM后续仅集成本轮六份文档增量，按职责合并记录与接续，不把旧品牌分支整片覆盖main。

| 固定源码接点 | 本轮观察 |
| --- | --- |
| [AppModule](../../../apps/api/src/app.module.ts)、[PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)、[PlatformRepository](../../../apps/api/src/modules/platform/platform.repository.ts) | 宿主仍组合Rental服务；租户/空间初始化在原事务中调用initializeTenant/registerWorkspace，仓储引用品类政策；先抽合同与有限事务接点 |
| [AuthService](../../../apps/api/src/modules/auth/auth.service.ts)、[ApiAuthGuard](../../../apps/api/src/common/api-auth.guard.ts) | 当前仍引用WorkspaceCapabilityService；需移出Rental策略并保留原授权、撤权及audience |
| [navigation](../../../apps/admin/src/app/navigation.tsx)、[AppRouter](../../../apps/admin/src/app/AppRouter.tsx)、[Vite](../../../apps/admin/vite.config.ts) | 导航含RentalCategoryCode，路由lazy加载具体租赁页；Vite仍穿透shared源码，页面贡献与正式产物边界需一起实现 |
| [AI应用组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[runner端口](../../../apps/api/src/modules/ai-native/runner/ai-task-runner.ports.ts)、[预算适配](../../../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts) | 应用组合使用Rental业务服务，runner公共结果仍含Prisma类型，预算指纹引用Rental文件；不能只挪目录声称AI已解耦 |
| [shared出口](../../../packages/shared/src/index.ts)、[AI应用组合](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[查询缓存](../../../apps/admin/src/app/queryClient.ts) | 当前源码已有公共入口职责和缓存隔离原因等说明，说明规则仍有实际使用；本轮只抽样，不声称全平台注释已规范 |
| [OpenAPI组合](../../../apps/api/src/contracts/openapi-document.ts)、[文档Controller](../../../apps/api/src/modules/openapi/openapi.controller.ts)、[API启动](../../../apps/api/src/main.ts) | 当前通过/api/openapi.json输出组合合同，入口仍引用Rental和AI等具体schema；需拆为平台/Core贡献并保持原HTTP兼容 |
| [技术开发指南](../../公共技术资料/开发指南/项目-开发指南.md) | 现有2.5及源码说明规则要求模块路线、关键文件职责和复杂逻辑原因；本轮补充全量梳理/简洁实现/API同步的PCH验收，不擅改锁定通用规范 |
| [现有脚本](../../../package.json)及[文档检查器](../../../scripts/validate-docs.cjs) | 根构建仍串联shared/MCP/API/admin；定向业务命令中有构建与环境依赖。本轮只运行文档静态核对，不运行这些业务命令 |

以上为固定Git对象的定向观察，不是全仓消费者盘点或实际运行验收。PCH-01仍须在工程开工时用当前获准基线补全并验证功能清单，02仍须冻结真实字段、包路径/格式、命令及兼容合同；标准包、安装器、发现页面和SDK尚未实现。

### 验证与待交付边界

本轮只改PCH四册、平台索引及未来方案共六份Markdown。`node --no-compilation-cache -` 经stdin复用现有检查器并定向核对，退出0：六份文档的239个本地链接、64个锚点引用、37个表格通过；原12行任务表、全部任务详情、G1～G4计分及R01～R12/A01～A12身份保留，原R03～R07正文未改，历史阶段正文除现行版本导航外完整保留。稀疏树未展开的链接目标按固定父版本Git树及blob核验。

两轮12份原文快照的字节数/SHA-256与manifest一致，22份品牌成果与父版本逐字节相等。11份白名单文档按同一固定基线比对，前后均为5处既有缺链：总导航的3份历史附件和AI Native接续的2份output证据，无新增错误；这不是全库文档检查通过，也未修改检查器或删除缺失引用。`git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 退出0。未运行包含构建/环境依赖的业务命令。

验证脚本全部经stdin执行；本树没有本轮新增的临时目录、依赖、生成物或后台进程，`output`与`node_modules`均不存在。历史文档与品牌交付物有明确保留用途，继续原位保存，不复制到其他目录。提交前只暂存上述六份文档，并核对暂存差异与原任务/历史保全边界。

工程仍缺完整功能/源码基线、逐模块整理和源码说明核收、版本化API贡献与离线产物、标准源码合同、独立宿主/多Core授权、持久化样例与第三方安装、底座/Core独立更新、AI适配、独立Agent接手及迁移/回退验证。本轮没有依赖安装、应用/数据库/模型/供应商运行、代码抽离或独立工程审查，不调整PCH研发百分比。提交与普通推送按根持续授权办理，任务分支 `codex/core-standardization`，上传后回读GitHub并在本对话登记固定SHA；不主动跨对话发送报告。

<a id="pch-preparation-main-integration-20261113"></a>

## PCH 准备文档的 main 归并与独立复核（2026-11-13）

PM 在主线 `1e010786a99cf180bce79cb797e48cdf14fc44fe` 之后收回已推送的固定文档 `557a4d07d950f812efded6e690513f5a19b8dce8`。两份记录/接续的主线前像与来源父版本逐 blob 相同；来源记录本身保存 CRLF，工作副本与源对象归一换行后正文相同，本文仍由 Git 固定来源保全原字节。保留原准备阶段及历史证据，不覆盖需求/任务、平台索引与未来方案。原十二项任务仍为 0%，全面清单、正式源码合同及公共窗口尚待原实施授权，不把文档归并计为工程完成。

QA 主审和独立一致性复核确认 77 处文档链接、10 处锚点及 12 份历史前像字节/SHA-256 匹配；需求、任务、索引及未来方案与 main 同 blob。文档最终验证 `node --no-compilation-cache -` 退出 0，stdin SHA-256 `5e77dbf360403f74fb112da6a14ee2ddcb9f7fe3df0af8192efbd114ede1e0a3`（包含另列 OPS 文档检查）。本次归并后的新增链接和差异格式定向核对，无新增链接错误。

本片只改现有[开发记录](平台Core接入-开发记录.md)与[协作接续](平台Core接入-协作接续.md)。没有安装依赖、启应用、读实际环境、连接数据库/供应商或执行迁移/部署，源码装配、独立构建、真实持久化、浏览器和工程验收仍未实施。六项其他作者 WIP 保持，无新增临时目录或进程。实际提交以包含本段的 Git 对象为准，普通推送后回读 GitHub。

<a id="scope-clarification-20261109"></a>

## 需求澄清与实施文档完善（2026-11-09）

### 范围与决定

负责人要求复核原拆分规划，并先后允许两轮、每轮最多五个问题确认边界。第一轮在`D:/工作文件/rental-OS`的main核对，HEAD为`44129cd00`；未进入源码实施。管理后台源码及其他专项已有WIP保留，六份平台底座文档初次开工时无未提交差异，暂存区为空且无合并/拣选现场。第二轮补充前重查HEAD为`ba107abe8b4a42bdc44efe2caaddfa44c651a8a9`，六份文档含本会话第一轮未提交成果，其他并行修改保持原位；暂存区及合并/拣选现场仍为空。以上均为定位证据，不授权接管其他写入。

| 已明确的事项 | 本次落位 |
| --- | --- |
| 产品定位为比脚手架更完整、AI开发友好的AI原生SaaS底座 | 需求§1.1及R11；开发任务01/02/11与接入指南。实际公共能力、正式合同、样例和独立接手一起验收 |
| 无Core时只需平台正常启动、登录、进入公共后台并提示联系管理员授权 | 需求R01/R07/A01；不把早期讨论中的“无Core通用问答、内容整理与任务产品”纳入交付，以负责人后续明确纠正为准 |
| 新Core与旧Core可并存，注册后由SaaS管理员授权租户 | 需求R02～R04及A02～A04；任务03～05/07/10。首期扩为同部署、同租户多Core，注册、授权、就绪和用户权限分开 |
| 各Core独立定义业务分区 | 需求R03/R05与接口上下文；Rental经营空间/品类/地点保留在Rental内，不强制CRM等沿用 |
| AI工具可选，不提供不阻止普通后台使用 | 需求R08/A08；任务09/10及指南步骤七。Agent不得绕过缺失工具查询/操作该Core |
| 跨Core数据互通留后续具体场景 | 需求§1.5及[未来方案](../未来规划/平台底座-通用化与开源方案.md#cross-core-collaboration)。首期只固定命名空间、引用、受控调用及事件接点 |
| 仓库组织由负责人交给工程判断 | 采用首期同仓独立模块、独立构建及正式出口，边界稳定后按独立维护/发行需要拆仓；同仓不免除反向依赖检查，不捆绑拆库/拆服务 |
| 首期沿用租户统一期限，Core分别开通/停用 | 需求R04/A04及任务05；采用讨论中的简化建议，并核对原SaaS需求§4已有统一期限。Core不另设有效期，续费不恢复主动停用或成员撤权，不改原收费规则 |
| 多Core的入口形式均可，由实现阶段选择 | 需求R07/A07及任务07；切换或业务分组均可，当前Core清晰、权限/状态/缓存隔离，不锁定唯一UI形式 |
| 租户联系管理员，首期由SaaS管理员直接办理Core开通 | 需求§1.4/R04及任务05/07；不新增Core申请流，不取消原订阅升级/续费申请 |
| Core停用后保留业务数据 | 需求R04/A04及生命周期设计；保留配置与原绑定，重新授权按当前条件恢复，必要历史/在途善后仍受控，不重放旧操作 |
| 租户管理员可给成员分配不同Core | 需求R03/R07/R08及任务04/07/09；成员范围只能来自租户获权集合，普通后台与Agent一致复验，Core内部角色和数据权限继续独立生效 |

本次更新PCH四册、平台底座索引和未来方案共六份现行文档。第一轮需求/任务为v1.1、未来方案为v1.3，第二轮补充后分别为v1.2和v1.4；保留原PCH编号、依赖、顺序、门槛计分及百分比，不改变其他专项任务身份。验收覆盖无Core、单Core、同租户双Core、不同租户/成员授权、单Core停用重开、统一期限及有/无AI工具组合；没有登记研发完成。

### 现有证据与剩余工作

- 根[package.json](../../../package.json)使用npm workspaces，主要构建串联shared/API/admin；[admin Vite配置](../../../apps/admin/vite.config.ts)及类型配置仍直接引用shared源码。当前工程适合先建立同仓模块和产物边界，不能把现有workspace列表当作独立Core已交付。
- [平台空间创建](../../../apps/api/src/modules/platform/platform.service.ts)仍在事务回调中调用Rental注册与品类能力初始化；Auth/Guard和后台导航仍含Rental专属依赖。[AI预算适配](../../../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts)仍引用Rental请求指纹工具，runner端口仍有Prisma类型。本次仅静态复核，未修改或运行这些链路。
- PCH-01/02仍须完成全面消费者/数据归属盘点，确定实际包出口、构建、注册/授权存储与事务合同；03～12的独立宿主、多Core准入、UI/AI适配、样例、独立接手、迁移和回退仍待实施。旧记录中的原未完项继续保留。
- 修订前六份完整原文及SHA-256/字节数存于[保全清单](历史归档/需求澄清/2026-11-09/manifest.json)，原链接按source路径解释；局部`.gitattributes -text`用于保留历史字节。本次未覆盖旧档案，也未复制其他工作树产物。
- 第二轮补充前再次保存六份工作区原文至[第二轮前像](历史归档/需求澄清/2026-11-09/第二轮补充前/manifest.json)，其中包括第一轮未提交成果，不能按manifest中的Git基线宣称已提交。已复核原[SaaS订阅需求§4](../../SaaS订阅/SaaS订阅-需求.md#4-订阅有效期与使用状态)的统一期限、到期善后和冻结独立性；成员Core分配限定租户成员，不改变客户及企业客户的专用授权。

### 第一轮验证

| 实际命令/核对 | 退出码/结果 | 证明范围 |
| --- | --- | --- |
| 修改前`npm run docs:check` | 1；11份白名单文档，3个既有历史附件链接缺失 | 缺失位于总导航第54行，分别为10月16日快照索引及两份旧租赁平台文档；保留原引用 |
| 六份修订前像复制与SHA-256核对 | 0；6/6字节一致 | 仅证明原文保全，不证明任何工程能力 |
| `node -`（stdin定向检查，复用`scripts/validate-docs.cjs`） | 0；六份现行/六份前像及归档README，215个本地链接、31个锚点引用、34个表格检查，0个问题；6/6前像哈希一致 | 计数包含基线比较；PCH的12项编号、原依赖/顺序、百分比和需求/验收映射保持，12条需求/验收身份齐全；不验证业务实现 |
| 修订后`npm run docs:check` | 1；仍为修改前同样的3个历史附件缺失，无新增错误 | 只覆盖原11份白名单，不能代替本片定向检查；未删除历史引用或改校验器变绿 |
| `git diff --check -- docs/平台底座` | 0 | 本片已跟踪文档差异的空白格式；Git的LF/CRLF提示不表示修改了历史字节 |

业务源码、脚本和其他专项正式文档未修改；校验器没有变更，不运行`test:docs`。未运行构建、应用、Prisma、数据库、浏览器、模型或供应商验证。未作独立审查；文档一致性不能替代研发、业务验收或发布。

### 第二轮补充验证

补充前重读项目入口、规则、四册和校验器，并核对原订阅正式规则及当前授权/Core静态依赖。

- `node -`保全第二轮补充前六份工作区原文并核对SHA-256，退出0，6/6字节一致；未覆盖第一轮前像。
- `node -`定向检查，复用`scripts/validate-docs.cjs`的链接解析和校验，退出0：六份现行文档、两份归档索引及12份前像，共339个本地链接、50个锚点引用、53个表格，无发现问题；12/12前像哈希和字节数一致。PCH的12项任务编号、顺序、依赖、百分比及需求/验收映射与两轮前像一致，12条需求/验收身份保留。
- 补充前后`npm run docs:check`均退出1，仍为总导航第54行同样的三个历史附件缺失，无新增错误；未改总导航、历史引用或校验器。此命令只覆盖原11份白名单。
- `git diff --check -- docs/平台底座`退出0；只证明本片已跟踪差异的空白格式，新增归档索引另经定向链接检查。

本阶段仅修改六份现行Markdown及新增历史保全。原任务仍为0%，业务源码、迁移和其他专项资料未改；没有构建、数据库、浏览器、模型、外部服务或独立审查证据，未提交或发布。

<a id="pch-preparation-20261112"></a>

## 恢复核对与 PCH-01/02 实施准备（2026-11-12～13）

### 授权、固定基线与已有文档收口

负责人要求恢复开工，PM指定本会话继续原PCH需求澄清与实施准备，写入仍限文档阶段。本次核定原两轮决定、PCH-01/02所需最小范围及公共文件依赖；代码抽离、依赖安装、应用/数据库/供应商验证和main整合均未执行。源码阶段及公共文件唯一作者由PM另行明确。

只读基线为 `2a5c56471abb5714f80715e2cfa0aa236f003f51`，开工时main及GitHub实际main均为此提交，暂存区为空，无合并/拣选现场；主树他人WIP保留。两轮六份现行文档及12份原文前像已由 `d1ae52df6d8207e913d6e49fde1dd28c7c962bc3` 收入Git且为本基线祖先，不能继续把11月9日“未提交”当作当前状态。后续 `eae7bb1c143607211c1569447ff2d110a6d56144` 在记录开头恢复了两行旧版本标签；本次改为指向历史前像，现行正式依据仍为需求/任务v1.2。历史阶段原记录不改写。

本次旧接续直接以固定基线中的Git原文保全，不新增历史副本。原PCH编号、顺序、依赖、门槛、需求/验收映射及百分比保持；本片准备不计PCH-01/02研发完成。两轮产品决定已与[澄清记录](#scope-clarification-20261109)、需求v1.2及任务v1.2逐项核对，无需重新询问产品问题：无Core公共后台、多Core、注册→租户授权→成员分配、统一期限、停用保留及按当前条件恢复、可选AI、自有业务分区和未来跨Core边界均保留。

### 固定源码入口与待冻结边界

下表来自上述固定提交的定向静态核对，是PCH-01/02的起查清单，不是全面消费者清单或已实现合同。

| 范围 | 真实入口和直接消费者 | 首个应固定的内容 |
| --- | --- | --- |
| 构建与宿主 | [根脚本](../../../package.json)、[API包](../../../apps/api/package.json)、[AppModule](../../../apps/api/src/app.module.ts)、[启动入口](../../../apps/api/src/main.ts) | 当前主构建为shared→MCP server→API→admin；AppModule集中装配具体Rental服务。将显式组合与公共内部依赖区分，公共启动不加载未选Core；环境读取/启动副作用保持原边界 |
| 登录、权限与上下文 | [AuthService](../../../apps/api/src/modules/auth/auth.service.ts)→[ApiAuthGuard](../../../apps/api/src/common/api-auth.guard.ts)→[RequestIdentity/ALS](../../../apps/api/src/common/request-identity.ts) | Auth/Guard仍消费WorkspaceCapabilityService；身份含可信workspace/dataScope/locationScope。先列全部当前消费者及audience，再确定Core范围解析接点；不把currentWorkspace改名成currentCore或移除现有校验 |
| 租户/业务初始化 | [PlatformService](../../../apps/api/src/modules/platform/platform.service.ts)→[PlatformRepository](../../../apps/api/src/modules/platform/platform.repository.ts)→Rental初始化 | bootstrapTenant事务回调调用initializeTenant，createTenantBusinessWorkspace调用registerWorkspace及必选能力初始化；仓储也直接引用Rental品类采用政策。授权、成员分配、业务绑定/就绪、原操作和审计分别建模，保留事务/锁顺序及提交后缓存发布 |
| 期限与权益 | [SubscriptionService](../../../apps/api/src/modules/subscription/subscription.service.ts)、[期限规则](../../../apps/api/src/modules/subscription/subscription-term.ts)、[shared订阅合同](../../../packages/shared/src/subscription.ts)→Guard及授权入口 | 租户统一期限和原收费规则复用；当前服务还引用Rental品类身份，需区分通用期限机制和行业权益。续费不恢复主动停用或成员撤权 |
| 数据与迁移 | [schema](../../../apps/api/prisma/schema.prisma)、[迁移目录](../../../apps/api/prisma/migrations)、[Seed](../../../apps/api/prisma/seed.ts) | Tenant/User/AuthSession/Role为公共身份候选；BusinessWorkspace/WorkspaceMember含Rental品类与空间关系，不能作为通用Core授权表直接复用。逐表确认读写所有者、复合键、存量映射和迁移顺序；公共初始化与Rental Seed分别负责 |
| 共享正式出口 | [shared出口](../../../packages/shared/src/index.ts)、[包出口配置](../../../packages/shared/package.json)→API DTO/[OpenAPI](../../../apps/api/src/contracts/openapi-document.ts)及各端 | shared同时导出类型和运行时代码；API消费产物，后台[Vite](../../../apps/admin/vite.config.ts)仍别名到源码。冻结合同版本、命名空间、错误语义和兼容出口，列出DTO/schema/OpenAPI/客户端对应关系 |
| 后台壳与缓存 | [navigation](../../../apps/admin/src/app/navigation.tsx)、[AppRouter](../../../apps/admin/src/app/AppRouter.tsx)、[authStore](../../../apps/admin/src/features/auth/authStore.ts)→[queryClient](../../../apps/admin/src/app/queryClient.ts) | 当前导航/页面含Rental，缓存按会话/租户/空间清除并中止旧请求；Core准入变化须复用这些防迟到机制并补业务命名空间。界面可切换或分组，直接URL/API仍服务端鉴权 |
| AI适配 | [应用providers](../../../apps/api/src/modules/ai-native/ai-native-application.providers.ts)、[预算适配](../../../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts)、[runner端口](../../../apps/api/src/modules/ai-native/runner/ai-task-runner.ports.ts) | 组合引用Rental执行者，预算指纹依赖Rental文件，runner边界有Prisma类型。由AI原作者提供固定适配子交付；无Core不开放通用Agent，缺AI工具仅阻止对应Core的Agent访问 |
| Rental兼容 | [品类解析](../../../apps/api/src/modules/rental-core/rental-category-resolver.service.ts)、[空间能力](../../../apps/api/src/modules/rental-core/workspace-capability.service.ts)、[Hook运行时](../../../apps/api/src/modules/rental-core/capability-hook.runtime.ts)及原订单/库存/资金链 | CAT-GOV仍是Rental内部扩展；初始化、品类采用、报价→下单→履约→结算及原收据按已支持场景保留。原未完项仍归原专项，不用假授权或全部unavailable证明兼容 |

数据归属还须沿真实读写补齐：租赁会员、企业租赁资格/授信、订单、库存及资金事实留原领域；文件/通知/审计的基础机制可以共用，但业务ACL、投影与事件事实仍由所属Core裁定。AI预算账与任务资源账也不混用。不能因文件位于platform或使用相同客户ID而成为跨Core公共数据。

### 最小工作树与公共文件安排

- 文档准备使用独占任务树及 `codex/pch-preparation` 分支；仅改本册和接续，需求、任务、平台索引及未来方案保持原文。树路径、检出范围及验证见本阶段交付项。源码只读取固定提交，不复制其他研发树的WIP、依赖、生成物或环境文件。
- PCH-01/02源码阶段建议只设一个PCH作者工作树，按PM指定固定基线扩展；无需先拆出多个子树。01可直接按Git对象逐项盘点。02涉及真实合同编译时再准备根package/lock/tsconfig、shared、MCP server、API公共模块及其完整导入闭包、admin壳/配置/UIArc、对应现有验证与fixture；当前单体装配下不能只拷两个入口文件就声称可构建。安装与运行按后续实际授权办理。
- PCH新增合同模块/适配文件可以独占，但具体路径与导出须在02冻结。现有公共文件只按PM安排的唯一作者窗口修改；文档中的候选路径不是写入授权。

| 公共窗口 | 最小交付与先后 | 归属安排 |
| --- | --- | --- |
| shared总出口/包配置、DTO/OpenAPI | 01消费者清单→02版本化合同及生产者/消费者映射；随后03/04使用 | PM指定一名集成作者；企业/Core/AI已获准的领域合同片段仍归原作者，不整取活动HEAD |
| AuthService、ApiAuthGuard、RequestIdentity及身份合同 | 02明确最小身份/范围解析及授权事实→04真实接线；原audience/撤权/ALS不放宽 | 先由PM核定共同身份文件窗口；AI和企业既有鉴权片段仅接收固定成果 |
| PlatformService/Repository、订阅、schema/迁移/Seed | 01数据所有者和提交点→02授权/绑定/事务设计→04/05/06；原人员/商业锁早于品类/空间锁 | 平台事务、迁移各指定唯一作者，Rental初始化与品类政策由原Core作者负责，避免在Core回调逆序取得人员/商业锁 |
| AppModule、根构建/锁文件、配置入口 | 02明确组合和出口→03真实宿主；保留OP配置以及企业/AI已登记项 | PM安排唯一装配作者，配置改动与OP固定交接 |
| navigation/AppRouter、authStore/queryClient及后台公共壳 | 02页面/上下文合同→03/04固定接点、05固定生命周期→07 | 与现有UI作者协调具体窗口；Rental页面不由PCH文档作者接管，写前读取admin规则与界面规范 |
| AI应用组合、预算和runner接点 | 02/04/06与08的正式出口固定后→09 | AI-RD负责内部实现和助手分工；本会话只向PM交所需合同，不直接派AI助手 |

### 原任务顺序与验证组合

1. **PCH-01先形成可冻结清单：** 标注每项import/注入、数据读写、事件/作业/回调、UI/API/各端消费者与作者；区分公共宿主、Rental适配和合理组合。补完现有代表链及原未完项，确认无Core、Rental单Core、非租赁单Core、双Core的组合边界。
2. **PCH-02消费01固定清单：** 确定同仓模块/正式出口、Core标识与版本、注册/租户授权/成员分配/绑定/就绪独立事实、资源范围、错误和冲突、初始化事务/锁、审计/原操作及迁移兼容。选择有限事务接点，不向公共合同暴露全库Prisma Client或框架类型；Rental与非租赁消费者必须能消费同一合同。
3. **后续仍沿原依赖：** 03/04基于02固定子交付，05/06固定初始化与授权事务，07消费真实上下文；08保留Rental，09按原前置接可选AI，10/11验证样例与独立接手，12收口兼容/回退/审查。无需等待CAT-GOV或AI全专项100%，也不能绕过实际所需子交付。

最小非租赁样例建议为“项目事项登记”：独立项目分区与记录持久化，覆盖创建→读取→状态变更→进程重启后读取，成员可访问不同项目；无需资金、库存或外部供应商。这是01待冻结的实现候选，不新增完整项目管理产品，不提前记样例完成；AI可选验证仍按09/10另行满足。

| 验证组合 | 必须观察的行为 |
| --- | --- |
| 无Core／已装配但租户未获权 | 独立构建/启动/登录与公共后台可用，提示联系管理员；不加载未选Core迁移/Seed/作业，不开放通用Agent |
| Rental单Core／非租赁单Core | 自身业务分区、正式入口和真实持久化可用；Rental存量授权、业务事实与原收据等价 |
| 双Core及另一租户仅单Core | 同宿主同租户并存、同ID不串数据；不同租户/成员只见获权集合，新Core不默认分配全员 |
| 成员撤权／旧修订／迟到响应 | 页面、直接URL/API与Agent都复验；旧会话/缓存/请求不能继续泄露或新办业务 |
| 单Core停用→重开／统一期限到期→续费 | 数据/配置/绑定和原收据保留，其他Core可用；重开核当前条件，不初始化或重放旧操作，续费不解除主动停用/成员撤权 |
| 有／无AI工具 | 普通业务均按权限可用；Agent只调用明确发布且当前获权工具，部分工具不扩大为全Core操作 |
| 在途、unknown及回退 | 按原身份/操作/收据受控收尾；停用、超时、重开均不证明可以换键重做；迁移/兼容和旧程序回退另取真实证据 |

已有验证可从[租户权限测试](../../../tests/tenant-access-atomic.test.cjs)、[空间范围](../../../tests/rental-workspace-scope.test.cjs)、[订阅服务](../../../tests/saas-subscription-service.test.cjs)、[品类/订阅身份](../../../tests/category-subscription-identity.test.cjs)及原Core/AI定向入口选取。逐个先读脚本：其中tenant-access-atomic会读取环境配置并要求DATABASE_URL，不能按名字当离线测试。现有脚本并未覆盖尚不存在的PCH宿主/授权合同，本轮未运行业务测试。

### 交付、验证与剩余项

PCH-01全面清单/样例冻结及PCH-02正式源码合同尚未交付；公共文件作者窗口和源码固定基线仍待PM安排，独立接手者、真实运行/持久化、浏览器、模型、迁移回退及独立审查仍未完成。本片只完成启动前的定向核对和顺序准备；原工程缺口继续保留。

文档树为 `C:/Users/Penn/.codex/worktrees/pch-preparation/rental-OS`，分支 `codex/pch-preparation`，仅稀疏检出 `docs`、`scripts` 及根级受版本控制文件。跨日后已于2026-11-13重新核对本树HEAD、工作区/暂存区及GitHub实际main，仍为上述固定基线；该任务分支此前无远端提交。没有复制依赖、构建产物、环境文件或整套主树。

| 实际命令/核对 | 结果 | 证明范围 |
| --- | --- | --- |
| `git ls-remote --heads origin main codex/pch-preparation`、`git merge-base --is-ancestor d1ae52df6d8207e913d6e49fde1dd28c7c962bc3 2a5c56471abb5714f80715e2cfa0aa236f003f51` | 退出0；主线固定基线与既有文档祖先核实 | 文档已进入Git/远端历史；本次不替他人推主线 |
| `node -`原文及固定差异核对 | 12/12前像字节数/SHA-256一致；五份现行正文与d1ae版本一致，记录的旧标签回入已明确 | 最初六份blob直接相等检查退出1，定位为记录变化及换行差异，未据此误报六份字节一致 |
| `npm run docs:check`（主树只读运行） | 退出1；11份白名单文档，仍为总导航第54行三个历史附件缺失 | 未修改检查器、引用或历史附件，不代表全库文档通过 |
| `node -`定向文档检查 | 退出0；六份现行、两份归档索引及12份前像，共372个本地链接、51个锚点引用、57个表格，无问题；12项任务身份/进度及四份未改文档一致 | 复用现有校验器；稀疏树未检出的链接目标依据固定Git树存在性及blob核验，非当前文件/运行验收。原阶段记录正文完整保留 |
| `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check -- docs/平台底座` | 退出0；按现有CRLF检查空白，未修改仓库配置 | 默认 `git diff --check` 曾将记录新增行的CRLF报作尾空白；保留原换行方式，仍检查行尾空格、空文件尾与tab前空格 |

本片仅两份Markdown变化；记录/接续按原四册维护，没有新增第五册、测试脚本、临时验证目录、后台进程或历史重复副本。文档任务树作为后续交付入口保留；验证脚本均经stdin运行。应用创建工具的完成状态未返回，挂接重试报“Cannot verify that this ownerless worktree belongs to this task”；已另以Git核对本次新建路径、固定HEAD、干净索引且无创建/合并/拣选锁，再在此树显式操作。应用挂接仍待确认，不影响通过独立Git分支交付；不要重复创建工作树。

提交只包含本片两份文档，普通推送目标为上述任务分支，固定提交和远端回读结果通过本阶段PM单点交付登记。main合入由PM安排，本片不合main。没有代码、运行、真库、模型、供应商、迁移回退、独立接手或独立审查证据。

<a id="nativark-mit-main-integration-20261114"></a>

## Nativark README 与许可固定成果归并 main（2026-11-14）

负责人已在底座对话确认 Nativark 开源品牌、底座主体及 MIT，PM本次按巡检/阶段收回授权整合已推 `d4ea8aa340a77e996bb5c54f76e2f98b9fdedb43`。固定来源仅六文件；main取标准LICENSE、底座视角README、根package.json和package-lock.json的license元数据，并归并下述原阶段记录及当前接续。依赖、脚本、工作区、原业务和租户后台品牌不改；标志仍待负责人在A/B中选择，原稿保留任务分支，不在本片替换应用Logo。

集成起点main `43d2f88c58a87a49d07bd347e18e44d32adbd1f8`。四份文件blob与固定来源一致；package前后JSON只新增license，README本地链接、原技术入口锚点及既有白名单差异检查核定。原PCH-01/02及后续工程仍未实施，不把许可/文档记为Core拆分完成。测试/服务/业务HTTP/DB/模型/迁移/部署均未运行，无新增临时文件或进程，中文提交普通推送并回读GitHub，保留全部main并行WIP。

<a id="nativark-mit-20261114"></a>

## Nativark 底座 README 与 MIT 许可（2026-11-14）

负责人确认开源品牌为 Nativark，并明确要求为仓库加入 MIT 许可证。GitHub 公开仓库接口已确认名称为 `JinPen-G/Nativark`、默认分支为 `main`。本轮复用原文档工作树，按已核实的固定主线 `9fb20dd236143f9b4c502bf7651b94ecc6bced8f` 建立 `codex/nativark-mit`，开工时该提交与实际远端 main 相同，工作区与暂存区干净，无合并或拣选现场。

根目录新增标准 [MIT 许可证](../../../LICENSE)，版权署名采用 `Copyright (c) 2026 Nativark contributors`。根 README 的许可段指向该许可证，根 package.json 和 package-lock.json 的根包元数据同步 `license=MIT`。第三方组件、素材与上游源码仍按各自版权及许可声明使用，具体来源沿根 README 的第三方内容入口查阅。

负责人进一步明确开源主体为底座，Rental Core 将作为第一个业务 Core 示范开源。本阶段据此重写根 README，介绍 Nativark 公共能力、目标架构、Core 注册与授权、可选 AI 工具、示范业务、开发目录、当前组合运行步骤和贡献入口。独立宿主及多 Core 接入的目标放在设计语境中，当前命令对应现有组合工程。原技术资料使用的项目组成、环境要求、配置、验证等章节锚点继续可定位。

改写前根 README 在固定主线 `9fb20dd236143f9b4c502bf7651b94ecc6bced8f` 中保全。本轮只补 MIT 段的中间稿也保存为 Git blob `1ebc5137612438606813eab415856c4a0413fc6d`。本阶段修改集中在根 LICENSE、README、package.json、package-lock.json 及本专项记录、接续。

最终使用 `node --no-compilation-cache -` 经 stdin 复用现有文档检查器，退出 0。三份改动文档的 160 个本地链接、28 个锚点引用和 18 个表格核对通过，原 README 的项目组成、环境要求、配置、验证、贡献和许可章节入口保留。稀疏检出中未展开的目标以固定基线 Git 树与 blob 核验。11 份白名单文档仍有五处基线缺链，分别为总导航的三份历史附件和 AI Native 接续的两份 output 证据，本次新增错误为 0。

MIT 正文与已有标准文本比对通过，版权署名为本阶段选定的 `Nativark contributors`。根 package.json 和 package-lock.json 仅新增根包许可字段，依赖配置一致。原阶段记录、正式需求和任务正文逐项比对保留，第三方许可及来源入口可定位。差异格式检查采用 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check`，按原换行方式核对新增文本。

本阶段只交付文档、许可证和包许可元数据。验证脚本通过 stdin 执行，本任务没有创建临时目录或后台进程。提交范围为本阶段六份文件，固定提交由包含本节的 Git 提交定位，普通推送目标为 `codex/nativark-mit`，上传后以实际远端分支回读核定并在本对话保留结果。主线归并按现有负责人流程办理。
