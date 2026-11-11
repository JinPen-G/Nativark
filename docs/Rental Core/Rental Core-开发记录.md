# Rental Core 开发记录

建立日期：2026-10-31。来源：原2026-10-18 CLOSE任务、平台正式需求及平台开发记录。本册补齐专项证据入口，不把历史状态重新判定为当前完成度。

[需求](<Rental Core-需求.md>) · [开发任务](<Rental Core-开发任务.md>) · [协作接续](<Rental Core-协作接续.md>)

<a id="pm-core-intake-and-dependencies-20261112"></a>
## PM固定阶段依赖核查与跨专项来源协调（2026-11-12）

本次核定四个实际Git工作树，main已将企业原补款固定`846d16e89`收回为`9b616d8e5d5932bffdc26eabce8ab3a47b1627da`，将AI原展示固定`7332875c9`收回为`0e9f9394225feea9190eb437afccee1b18764572`，两次普通推送后均回读GitHub包含。对应独立模拟/类型及未验环境分别见[企业原补款](../企业客户后台/企业客户后台-开发记录.md#ecp-main-consumed-extension-integration-20261112)与[AI展示](<../AI Native/AI Native-开发记录.md#ain12-main-display-integration-20261112>)，不计作Core原任务完成度。

Core固定`a0a0451754d77b7454de4dad9f5044a4e70c3949`的15源码/4文档已核在实际任务远端。main试应用这一增量时，五个源码冲突暴露未收前置：草稿仍用原lockActiveCategoryBinding，来源已改lockCategoryContext；治理尚缺versionValidation及Auth/Platform装配；默认配置仓储缺readDefaultWorkspaceInitialization；原事实仓储缺readQuotedInspectionTemplates；续租reader缺原订单/报价/配置同源核查。四份文档也冲突。冲突不能只取来源正文，否则把父阶段和未收口counter检查点一并带入。

PM已核归属后仅撤回本次19个候选路径到上述固定main，未重置分支、清理工作树或覆盖其他成果。main六项他人WIP逐哈希保持、暂存区与冲突均清空。a0编码片和后继`619f50c5a04f2af805f84f3977e78dc4683cfb81`必选/历史Hook片继续保留在任务分支，尚未合main。要求Core作者在既有记录给出b6aa09ad3治理、16d080e48续租、9331582b7历史检查、00f19015a草稿、f0e69b960默认初始化等最小固定前置及原证据，区分5e8d52325/fe65ac652未收口的配置/资源检查点；按固定依赖顺序串行核收，作者继续自己的树。

已明确下一核心优先：当前采用回执片收口后，Core提供AIN-17此前已批准的四入口真实configurationRevision/settingsRevision、原业务同事务可选参加者及必要backfill兼容。allocation原recordIssue不能重入scan/另开事务，只有Core真实可证明的资源不足及已发布临近政策才捕获；profile默认/非默认、state scoped版本和九项独立读取分别有界，缺行不造版1、updatedAt/seed不充总版本。AI-RD继续私有store/桥接和18授权消费者，由其协调两助手，PM只向RD协调。

企业三端新增服务又暴露准确Core来源缺口：两个新续租报价无选中服务时目前省略serviceSnapshots，原测试第160行也期待undefined；新企业投影只读持久化快照，不能由零金额/当前catalog补齐。因此已交Core最小新报价窗口，核真实适用及强制服务规则后才记录明确空数组；有服务继续原费用/容量/版本/条款/计划。line_cancellation等复用不隐式新增服务，旧订单/报价/consumed批准/原键及指纹不回填，旧缺数组仍unavailable。原第252行旧订单不凭空补数组门槛保留；原测试/runner/断言不改，不排除类型或skip伪造绿色。

企业作者继续已批服务选择/正常有服务/拒绝恢复片，原缺空快照留记录，不等待Core整项。另核准其网站换货进度、小程序换货与订单三处仅补consumed状态显示，approved才可确认的原门闸及Core执行保持。新Shared/schema/公开入口或其他范围须报精确窗口。此次PM未读环境、启停服务、安装依赖、访问真实业务或生成产物，未创建临时文件/新后台进程；旧集中待清理残留未删除。原CLOSE/CAT完整门槛与百分比待核实保持。

<a id="workspace-resolver-main-integration-20261112"></a>
## PM固定当前品类读取修订校验整合（2026-11-12）

巡检在四个实际登记工作树核对分支、HEAD、索引、merge/cherry-pick、上游及GitHub。main起点为已推送的`3a06c8861a25398072c98f8da4e3733c25b5b6a3`，Core可独立交付来源为已核远端的`cb96a636b61497243d75032e98d0e301ff3d31a0`。只收本提交`rental-category-resolver.service.ts`的`forWorkspace`差异，完整目标文件与固定来源Git blob一致；不收Core配置counter、唯一声明/草稿锁辅助函数或其他父提交。来源原阶段及未验事项可在[固定Core记录](https://github.com/JinPen-G/rental-OS/blob/cb96a636b61497243d75032e98d0e301ff3d31a0/docs/Rental%20Core/Rental%20Core-%E5%BC%80%E5%8F%91%E8%AE%B0%E5%BD%95.md#workspace-resolver-binding-20261112)核对。

读取正文前拒绝缺失/非法版本ID、非字符串编码及非负安全整数以外的采用修订，合法初始0保留。版本ID/修订在异步读取同一不可变正文前捕获，避免观察对象后续变化造成版本正文与返回绑定混杂；历史`forVersion`不读取当前空间最新版。与前一写锁修复共同维护读写合法性，当前授权与业务提交点复验不变。

PM独立将原`category-version-resolver.test.cjs`通过内存TS映射指向main实际源码，完整原解析/空间/历史版本/客户公开投影断言退出0，原文件和断言未改。五组限定调用退出0，覆盖当前/事务内/历史读取区分、初始0、损坏修订在版本IO前拒绝、缺绑定身份拒绝及异步正文读取不混入后继绑定；脚本SHA-256为`85ccaeca39f690aa51dd626fe3bc08ec7515a4d19c824e003a53e97baadf5ee8`。原API tsconfig、TypeScript5.9.3、895根`--noEmit --incremental false`诊断0。最终源码SHA-256为`cd7d9fe043a43046c950b48f9e14a4e4b82e4cbd8a07d9de62c3ac4ffe5e9a32`，与作者阶段证据相同。纯排版在核对时恢复固定来源，不改变测试逻辑。

SQL/事务/授权来源为明确fixture，不将原用例或类型检查作为真实DB/并发/完整CAT-GOV验收。六份变更记录/接续无新增链接错误，Core记录及三份接续无链接错误，原品类记录两项与后台记录267项历史断链保持。各Node使用原offline preload、固定不可达数据库和关闭缓存，audit0，验证目录未创建，子进程全部退出。main六项他人WIP逐文件SHA-256保持，另外三树继续独占研发。AI Native的12/17/18生产者、公开消费者和原人类grant仍在WIP；企业本单材料选择继续推进；没有据此新增任务或提高完成度。Core继续原同源定义、全部写入口/08存量采用及已协调的财务原核定读源。

<a id="active-binding-main-integration-20261112"></a>
## PM固定采用修订校验整合（2026-11-12）

来源源码`9380d1bab95e2d78ecb64d0390cfcd03af2ca0f4`及记录固定`709c69b58f288deed3d31c8387c888f3e6ef2153`已核在任务远端，main起点为已推送的`3cf502b7cc7e6443d6ebeaee2442cc2a6e24816e`。本片只取`category-active-write.ts`的12行差异，`lockActiveCategoryBinding`完整函数与固定来源一致；main未有的原UniqueClaims/Context辅助函数和配置修订/Outbox祖先不随此片收回。非法期望修订在取锁前拒绝，存储缺值/负值/字符串/非整数/重复空间行在读版本或返回可信binding前拒绝，合法初始0保留；原锁序、权限和后续字段/媒体规则不改。

PM独立以main真实源码复核原`config-workspace-scope.test.cjs`三项和四组限定行为，均退出0；四组覆盖正常0/后继、损坏存储修订、非法期望值在锁前拒绝及缺失/重复/坏状态行不读版本。四组脚本SHA-256为`89f7d7f4d46dde4fb5367851c2c5ede042e9517d9b1b17d4626c6acadc92a97e`，main目标源码SHA-256为`a54d36bb6dedc8cdf63d247dc8db2e547c4df79f2d0ee33ad988676ec8da002a`。原API tsconfig、TypeScript5.9.3、895根`--noEmit --incremental false`诊断0。旧`category-active-write.test.cjs`仍在第20行的锁次数断言失败：既有Tenant父锁使实际为两次，期望为一次；main原基线和本片结果完全相同，未改原断言/测试或删除父锁来补绿，其后断言不称本次已验证。

仅使用既有fixture的查询行与限定内存调用，SQL/Auth/事务仍为替身，不证明真库、并发、配置恢复全集或完整CAT-GOV/CLOSE验收。五份变更文档链接无新增错误，Core记录/两份接续无链接错误，原CAT记录两项及后台记录267项断链保留。各Node沿原preload、不可达数据库和关闭缓存，audit0，未创建本任务目录，进程已退出；main六项他人WIP保留。照片四模块已经随企业片进入main，七组恢复及消费者证据见[企业固定整合](<../企业客户后台/企业客户后台-开发记录.md#ecp-main-exchange-photo-integration-20261112>)，不重复复制唯一原证据。

Core继续原同源品类/全部写入口/08存量采用及CLOSE核心。企业财务核定来源已定位到原`recordMaturity`/`operationLog`/`readMaturity`，尚需专用当前企业/空间投影及原审计actor绑定；原operator/staff财务授权保持，正式账单、历史跨空间权威范围与混合保证金来源未齐，不自造数据。

<a id="approved-exchange-main-integration-20261111"></a>

## PM固定换货Core接点整合（2026-11-11）

本阶段从main固定`44dc16a4ba816db6ed1de2c53a6a717b880a60f4`收回Core源码`0947a6eb82cd1e725073131dc11f78a0fc94bf49`的16文件增量及四份记录/接续固定`2a2c9ae647c55343fb6f39a6e73e12e7489c0c54`。只接换货执行、具体检查同意、原键读取及租赁比较合同；企业参与者、HTTP/DI、专用照片冻结仍由原作者继续，未从活动HEAD取代码。两个迁移文件已入源码，未执行。

四份文档冲突由固定来源核对后解开：main在共同基线之后没有这些文档的独有阶段记录，保留来源中的完整历史正文，再补本段整合边界。Core其他旧阶段源码未随本片收回；其中两条尚不存在于main的源码链接改指来源固定GitHub提交，不用文档完整推定代码已齐。两份原历史附件缺失保留。

PM对main组合再次固化Shared/API/Admin/网站的`tsc -p <对应tsconfig> --noEmit --pretty false`结果，四项退出0；Shared编译状态仅写本任务临时目录，API关闭增量写入，原Shared运行JS/声明和Client受保护文件哈希保持。后台第一次命令解析`typescript/bin/tsc`时被TypeScript7包出口拒绝，编译未启动；改按原包`package.json`的既有bin定位，后台7.0.2/noEmit退出0，仅复验这一项。原离线preload、固定不可用数据库URL与独占写入根均启用，Node网络/环境读取审计0；该守卫不覆盖TypeScript7原生编译器的系统调用，已核既有启动器并只传noEmit，不把审计0当全机隔离。

实际源码短调用14项通过：相同经营事实仅查询切点变化仍可比较，金额、币种、日历日期/倍率、规则、来源版本和历史分段变化仍被识别；原K无记录保持不可重试，持久关联缺原收据、错误键、撤权或读取未知均拒绝，不调用报价、执行、库存或额度写入。SQL、当前授权和收据仓储为明确替身，未覆盖成功回放、企业最终消费、真实事务或供应商。第一次调用因验证数据共用日历数组而同时修改了历史事实，比较按预期拒绝；只修正验证输入，原实现与断言未放宽。Core原五项3过/2失败与DTO32项/API契约476项的原基线仍见下方来源记录，不写整组通过。

本机25份固定阶段最小JSON证据（共856,362字节）已核归属后同卷迁入main唯一`output/category-governance/`，逐文件SHA-256/字节数一致，原位置已迁出；没有复制整目录、依赖、Client或构建环境。这些原始证据不随Git上传，源码及本段结论由固定提交追溯。main原六项他人WIP逐文件哈希保持，未夹入暂存。原CAT-GOV/CLOSE/ECP门槛和百分比均保持，源码整合不等于完整业务验收。

四册本次292条链接及新增阶段锚点已定向核对，新增问题0、两处原历史附件缺失保留。固定来源含CRLF行尾，差异格式按`cr-at-eol`识别原行尾，同时保留空白检查，没有重写源码/历史正文或改Git配置。删除本任务暂存的原生PowerShell命令被自动审批在执行前以`blocked by policy`拒绝；核明已退出的五份状态/证据文件及本次TypeScript生成的Node缓存后，6文件共1,489,169字节已同卷归入[唯一待清理清单](../../output/.cleanup-pending/main/pm-core-exchange-integration/cleanup.json)，原临时目录已迁出、逐文件哈希一致，尚未删除。首次归集核对因发现缓存目录而中止且未移动，核明缓存归属后完成；不换壳/工具绕过删除限制。清单与临时残留不提交Git，旧待清理项仍依原清单。

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
| Shared/API/Admin/网站类型 | Shared完整编译退出0，仅对应租赁合同 JS/声明改变；三个端 noEmit退出0。见[Shared](../../output/category-governance/approved-exchange-shared-20261111.json)、[三个端类型](../../output/category-governance/approved-exchange-final-types-20261111.json) |
| 实际服务限定调用 | 11组通过，覆盖实际报价/Core/准备/同意/政策/幂等、同事务消费、原键/TTL、未知、撤权、坏C、币种/保证金及收据失败；SQL/Auth/配置/资源、已批准行和事务/时钟为明确替身。另保留两次本次调用准备失败：变量尚未声明、共享模板引用被重复添加照片字段；补正调用数据后通过，未改原测试/断言。见[限定调用](../../output/category-governance/approved-exchange-behavior-20261111.json) |
| 原换货五项 | 3过/2失败，退出1，无skip/todo。`:232`的会员替身缺合法空间品类，先报“已存品类编码缺少兼容解释”；`:328`的Controller夹具未装配原预览服务。原测试、Controller及身份文件未改 |
| 静态契约 | 路由649条退出0；全域DTO覆盖32项问题，新增三个DTO没有对应失败；全域API契约476项，与固定已编译基线逐条新增/移除0。旧415/507结果留历史，不能覆盖当前 TS 优先读取结果。见[契约与原冒烟](../../output/category-governance/approved-exchange-contracts-smoke-20261111.json) |
| 固定 API 构建 | 完整编译`0947a6eb8`退出0，863份JS、13份变更及其余原产物哈希核对一致；三份工作区照片WIP从固定提交读取，不编入该包。Shared/Client保护哈希不变，audit 0、暂存删除。见[固定构建](../../output/category-governance/approved-exchange-build-0947a6eb8-20261111.json)；这是本树受管研发产物，不是部署或照片/HTTP验收 |

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
| Shared正式产物与API类型 | Shared完整编译202文件、API noEmit退出0，audit 0；仅更新`core.d.ts`和另一声明的`currency`字段排列，运行JS未变，Client schema hash未变。见[类型/逐文件清单](../../output/category-governance/enterprise-core-read-types-2-20261111.json) |
| 当前源服务短调用 | 9组通过、退出0，原Core端口/企业资格/资金/结算服务参与；现金、核销、冲销、缺配置历史、无授信、跨空间来源、权限撤销及个人订单拒绝覆盖。SQL、会话与存储为明确替身，业务写入0，不证明真实资格/锁或并发。见[行为证据](../../output/category-governance/enterprise-core-read-behavior-20261111.json) |
| 原企业授权测试 | `node --test tests/enterprise-portal-access.test.cjs`退出1，7项6过/1失败；`:99`加载原workflow schema时，VM依赖替身缺`@rental-os/shared`。断言/测试未改，失败保留，不写整组通过 |
| 当前API构建 | 完整编译退出0、857份JS逐文件一致，仅新增本端口产物；Shared原收据模块与Client受保护哈希未变，audit 0。见[构建清单](../../output/category-governance/enterprise-core-mini-build-20261111.json)；客户构建及源码安全失败唯一记在[品类阶段](品类治理/品类治理-开发记录.md#client-receipt-runtime-wip-20261111) |

首次Shared核对因声明文件变化超出预定范围而停止，API检查未执行，未移动产物，见[原失败](../../output/category-governance/enterprise-core-read-types-20261111.json)。随后定位为另一声明的字段排列及本次新领域类型，核对完整本树产物后再验证。递归清理组合命令曾被自动审批返回`blocked by policy`，未执行且无具体理由；之后按已核定任务文件逐项删除并核实，无新增残留。所有本片临时构建、声明、缓存和日志已固化最小证据并删除，未安装依赖、读环境、迁移、合main或开放生产。

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
