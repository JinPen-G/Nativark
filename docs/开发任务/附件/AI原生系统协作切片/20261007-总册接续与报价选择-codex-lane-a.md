## CA08 持久客户材料与原操作收据（20261008）

从b8e5e455续接，主线确认A客户场景、新专用repository及独占追加迁移20261008140000_ai_client_scene_materials。移除旧Map，不并行保留缓存方案。新增PrismaClientSceneMaterialRepository，以既有Prisma参数化$queryRaw/$executeRaw/事务访问ai_client_scene_materials，不需要新增delegate或生成client；scope定位仅取当前tenant/workspace及已发布关系，授权仍由原ClientAuth/Guard、channelBootstrap/ClientApi资源读取完成。

唯一表最小字段：id，tenantId/workspaceId，channel，principalKind(personal/corporate)，principalHash/bindingHash/publicationHash，operationKey/inputHash/materialHash，command/material/publication JSON，revision=1，createdAt/expiresAt。主键id；唯一tenantId+workspaceId+channel+principalHash+operationKey；scope+expiry索引；复合FK到business_workspaces(tenantId,id)，RESTRICT更新/删除。operationKey区分大小写且不修剪/接受空白，SQL为bin collation，参数全部绑定。只追加新迁移文件，不改历史迁移或schema.prisma；主线最终补Prisma模型/联合校验，本树未执行迁移，也不把rawSQL替身验收称真库。

持久prepare改为严格{operationKey,command:{kind,...}}，不替客户临时造key。principalHash取当前真实客户ID/类型/原sessionId与scope/channel/appId的不可逆摘要；不保存Bearer或单独原session明文。bindingHash另绑定本次完整身份和发布投影，material仍只存原ClientApi有界白名单投影（可能含本人customerId/订单号等正式客户字段），不把内部客户/库存/成本/审核源存入。相同key同inputHash读原行并当前重授权；异hash冲突，不更新原行；写入/COMMIT应答不确定报AI_CLIENT_RESULT_UNKNOWN、retryable=false、nextAction=readOperation，不在异常路径重新INSERT。新增readOperation使用原key和command核对：无可观测原行保持unknown，有行也须当前身份/发布/本人资源/输入及正文hash复验；readSource按原id和当前不可逆主体精确查询，校验原冻结行前后未变。

重建应用实例仍从数据库读同一材料/operation。保存、读操作、重开都在同请求ClientAuth/Guard会话内，前后复验scope实际ID、发布空间和客户身份；正文变化、切会话/企业类型、注销、停发布或超出五分钟有效期均不能读旧内容。五分钟只是读取有效期；没有删除/清理器，过期行不当成不存在或自动换key重写。保存后的复验失败也不声称未保存，仍需原operation核对。原进程Map引用不做自动迁移。

匿名边界按主线收紧：没有真实匿名会话生产者，不构造共同guest持久principal或历史归属。新增readPublic仅当前Guard授权的catalog/help，无materialRef，声明persistentOperations=unavailable_anonymous_session_missing；匿名不能prepare/readOperation/readSource。登录客户可主动准备属于自身当前会话的材料，但这不转移旧匿名材料。客户task/model/事件/下载/正式历史迁移继续unavailable，取消仍只给既有人工API入口，未执行订单/支付副作用。

复用原client scene单项，未加测试文件/矩阵/独立审查。实际ClientAuth/Guard/ClientApi及新repository/事务SQL/应用被驱动；DB行、COMMIT回包、Core及底层客户投影为声明替身。新增验证跨实例同id读回、同key重放零新增写、同key异命令冲突、未观测operation不假成功、丢ACK后原key读回且不新增写、操作键大小写区分、无guest行/Bearer/session明文字段、企业/会话/停发布/expiry拒绝且过期不删除。匿名公开读与原会员本人资源测试保留。

相同严格离线环境与本树cache/tmp，配置audit为output/ca-client-persistent.audit及output/ca-client-persistent-types.audit。已核对preload只在拒绝操作时追加记录，本轮两个拒绝审计文件均未生成：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='client scene authenticates' tests/ai-native-lane-a-original-scene-host.test.cjs`

首轮1pass/0fail/0skip/0todo、退出0；必要API源码noEmit 0diagnostics、diff0。无真实MySQL/DDL/FK/并发锁验收，不生成shared或Prisma产物，不安装/启服务/.env/外联/迁移/推送；旧生成失败的lock/previous/temp/output保全。

Runtime迁移只映射materialRef、operationKey/inputHash、saved/unknown、revision/expiry与readOperation，不得把材料收据当任务成功/执行许可或创建另一套task/run；重建/回退不能丢原operation后换key补跑。Provider SDK仍在唯一Gateway transport边界，客户模型正式授权缺失所以本包不调用；Auth/原ClientApi资源权限/审批/Core/单账均不迁入第三方。回退可停新持久prepare并保留原受权readOperation/readSource；不得删除本表“恢复”Map，不自动迁移匿名或复用旧会话凭据。正式公共叶子需要反映新的显式operationKey和匿名readPublic区分，不能沿用上一片进程引用的耐久性声明。

## CA08 客户请求材料与同会话来源（20261008）

开工d432b7dd，源码干净、无MERGE_HEAD/CHERRY_PICK_HEAD；主线确认只认领client-scene.composition.ts、新scenes/client-request.application.ts、既有original-scene-host客户用例及本记录。复用composeAiClientScenes/createAiGuardedClientSession与ClientApiService现有投影；原读者仅补profile、publicDocument(help)、previewCancellation及对应Guard路由，不新造Client/Auth/企业鉴权或修改前端。

composeRequestBoundClientApplication(dependencies,serverConfiguration)只提供prepare(request,command)/readSource(request,{materialRef})。服务器固定enabled/tenantCode/serviceCode/channel/appId，body严格只允许catalog/help/profile/order/cancellation_preview；不接受actor/scope/tenant/发布证明、任务ID或raw办理命令。匿名通过原ApiAuthGuard的公开路径/IP策略后只读已发布目录/帮助；登录路径只接ClientAuthService客户令牌、当前active会员和本人订单规则，不复用operator/staff身份。企业账号仍按原clientOwnsOrder，不因付款企业或同事身份扩大订单范围。

每次读取前后复验正式channelBootstrap中的发布服务和当前客户会话；不返回bootstrap的adminLogin/平台设置，仅保留选中服务的公开字段。冻结ClientApi原客户投影（正文≤65536 UTF-8字节）和本次绑定hash，返回随机materialRef；实例内最多128条，引用有效五分钟、访问时惰性清理或容量淘汰，不声称到点物理删除，不持久化Bearer/session令牌，不冒充原AI任务历史。readSource只能使用实例已签发引用，先比对原客户/企业类型/会话/空间/渠道绑定，再重读同一固定操作并核对正文hash；会话变化、停发布、数据改变、过期或重启丢引用均拒绝，不换源补旧结果。取消预览仅忽略calculatedAt观察时点作比较，金额/币种/estimated状态不忽略；返回仍是原冻结材料，另给verifiedAt。

办理出口仅取消预览成功后给既有POST /api/client/v1/orders/:id/cancel及必填reason，明确显式人工动作、not_attempted；没有cancelOrder/支付/退款/资料写入方法，付款只能原收银台及回调。匿名读只可用已发布空间；本AI门面停发布即不可用，但未修改原客户端售后API的既有可用规则。下载/事件未取得正式客户投影合同，不转发原HTML、任意附件或模型URL，capabilities明确unavailable。

复用原客户单项用例，不加测试文件：实际ClientAuthService签发/解析客户令牌、ApiAuthGuard客户分支与ClientApiService渠道bootstrap/publicDocument/publicCatalog门、profile/getOrder/previewCancellation投影被驱动。DB行、Core订单/目录/取消费事实、个人profileRow/currentWorkspace及buildCatalog底层投影是显式替身；不是完整Core价目或真实DB/HTTP/存储验收。用例覆盖公开帮助/目录、匿名不可读资料、本人订单与字段剔除、企业不得读同事订单、取消估价与真实路由材料、旧引用不跨客户类型/会话/停发布/TTL、taskId注入拒绝、原Guard安全策略未就绪拒绝与原读后注销拒绝。

沿用严格离线环境，audit为output/ca-client-request.audit，命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='client scene authenticates' tests/ai-native-lane-a-original-scene-host.test.cjs`

首次1/1通过；随后核对并补齐匿名原Guard路径（不改Guard）与同用例断言，最终同项1pass/0fail/0skip/0todo、退出0，不累计为两项。必要API源码noEmit 0diagnostics，diff0，type/smoke audit无阻断；未扩审查/矩阵。无schema/shared出口/client生成/迁移/启服务/安装/真实外联；旧output/生成锁/previous/temp全部保留。

精确主线缺口：task-current-identity.authority.ts:18/27仅operator/staff→user；task-request/original-request.authority.ts:28-31/55-56的creationRules/current同样限定该身份；public-ai-gateway.service.ts:62-63禁止客户执行。因此tasks/models/historyMigration保持unavailable，不把customer伪造成user、不按taskId接管匿名历史。实时报价/建单、持久客户端材料/原会话显式迁移、事件/下载的客户端来源合同也未在本包建立；公开目录价目不称实时报价。若主线发布公共叶子，可从本应用的严格Command（五种kind）、materialRef/expire/source/hash/人工handoff及不可用能力声明提取，需先保留instance-local语义，不能直接宣称durable任务合同。

Runtime独立替换只消费本应用的受权冻结材料/人工出口；这128条短期引用是本进程读回能力，不是外部引擎state、长期记忆或授权记录，迁移不可重建另一客户旧引用。Provider SDK边界仍唯一Gateway transport，但当前客户执行未获准所以完全不调用；不能为“可替换”安装SDK或启第二预算账。回退停装本应用并使用原客户端读/办理入口，原Auth/会员关系/订单/支付事实不变；进程引用失效须用户重新读取，不能静默回填为历史成功。R04正式澄清仍外部阻塞，与本客户只读材料包无依赖。

## CA05/09 新人类材料到正式重新准备（20261008）

开工HEAD为044252be，只有保留output，无MERGE_HEAD/CHERRY_PICK_HEAD；主线确认A场景独占。固定依赖e510edd264c722fa4b7759dbf8a22c87fd18ffcc只接c31d9199八个生产文件与2754cac0附件绑定fixture精确更正；647119a901bd400c0d8e8edbeb10ad264f9ad666只接7b6513e6正式工厂、held-lease源及原request-bound审批三个生产文件。两次索引与固定源比对一致，未搬07测试链、原A blob或schema。主线已有等价前置，不需重摘这两个依赖提交。

A新增reprepareSelectedProposal/readSelectedReprepareReceipt：先用既有selectedReview绑定旧选择、提案和持久原输入，严格解析公开AiApprovalReprepareCommandDraft，拒绝旧task/原请求复用为replacement；调用07原reprepare/原收据，不手写SUPERSEDED/审批/订单。仅prepared后以新选择证明重新绑定新proposal，并返回公开review（generatedText=null、无内部facts）和原收据，之后再次核对旧引用；unknown不冒充未提交或自动重试。

composeRequestBoundHumanQuoteOrder及原registerRequestBoundApplication可接第三个服务器配置{holderId,creationRules,memberships}，固定holder/规则副本，通过07 composeFormalApprovedOrderReprepareServices创建同请求originals和事务内selection/只读held lease。配置启用时拒绝另塞reprepareServices；不接受body里的lease/fence，不额外claim，不新增controller或自动注册。未提供正式工厂仍unavailable；再次决定仍调用原decideSelectedProposal，人类决定不自动提交Core。

仅复用既有human-quote-selection测试与lane-a-selected-order夹具加一项功能冒烟：真实原请求save/createTask、重新发材料关系、持久选择、claimRun CAS、原选中input发布/plan/registration、07事务、新公开提案、丢失COMMIT应答后的原readReceipt、同操作重放、再次人工决定。DB、Core报价事实/目录和RUNNING/步骤启动状态为明确替身，非真实worker/MySQL锁验收；原审批/重新准备收据未手写。验证两个原请求/两个选择、一条reprepare收据、旧SUPERSEDED、两个人类决定且零订单，并验证缺工厂/私带lease/缺header/注销拒绝。

严格离线环境同前，audit为output/ca-selected-reprepare.audit，命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='selected new human materials' tests/ai-native-lane-a-human-quote-selection.test.cjs`

首次0pass/1fail：A旧fixture未声明AiRun的leaseOwnerId/leaseExpiresAt=null，也未在关系过滤中展开run.task，真实claimRun CAS正确拒绝。只补DB默认值及关系匹配，再复验同一项1pass/0fail/0skip/0todo、退出0。最终必要API源码noEmit为0diagnostics；diff0，type/smoke audit无阻断，不扩矩阵或再派审查。c31仓储使用既有参数化$queryRaw/$executeRaw，不依赖新增Prisma delegate；本树schema/client仍原版本未同步，表DDL/联合schema验收留在主线，不把离线rawSQL替身称迁移通过。旧生成锁、previous、temp、output保持，无安装/启服务/.env/真实外联/共享生成物写入/迁移/推送。

Runtime映射：保存operationKey、旧task/proposal/hash与新task/run/selection/input/planHash；只有原receipt.state=prepared才进入review_and_decide，unknown指向read_reprepare_receipt而非新key重派。held lease来自07真实只读源，不把外部引擎暂停/确认状态当许可；没有正式持有者则不可用。Provider SDK不参与重新准备事务，仍在唯一Gateway后独立替换，不改变Auth、人工决定、Core和预算单账。回退停止新场景装配，保留原材料/收据/旧SUPERSEDED及新提案，不撤销已记录决定或双跑准备；接口/耦合/单边切换的共通规则见下节。非订单配置/客户资料仍缺领域revision-CAS及operationKey收据，不用order.commit或任意patch替代。

## CA03/09 模型运行与结果的请求绑定应用（20261008）

从已交2db337fd4ff591be6c2627b00c9bb14785e0e34c继续；主线确认request-bound-scenes.application.ts、original-scenes.module.ts与A测试本轮独占。新增composeRequestBoundOriginalSceneModel和独立AI_ORIGINAL_SCENE_MODEL_REQUESTS/registerRequestBoundModel，只提供请求绑定服务器门面，不注册controller/AppModule或启动worker/HTTP。

沿用bindRequests：读取请求Bearer，await前克隆命令/固定requestId，在独立ALS按同一请求凭据构造原composeAiOriginalSceneModel；同步runServices(input)工厂收到同一dependencies及已绑定credentials，用于构造原inputSource/financialEvidence。host在门面装配时克隆冻结，不能从body指定；调用完成即使工厂保存了credentials引用也不能继续取得凭据。门面只委派原start/readInput/resume/reconcile/requestCancel/readModelResult/reopenModelSource，不公开runtime、prepareHeldRun、createApplication或Core提交。原raw registerModel不变，不另claim、建单账或绕过既有plan/step/fence/未知结果规则。

两份既有A测试/夹具增加request-bound模型组合：真实Bearer、Auth/Guard、原请求、原QUEUED应用、知识/人工确认、PrismaGatewayInvocationBindings及按本请求工厂新建的PrismaGatewayAccountingFacts；数据库、知识文件字节、业务事实、路由、admission/财务生命周期、transport和输入源仍为显式替身。正常执行循环订单解释/开业诊断/报价澄清，验证host/body/header快照、执行中的并发ambient/缺header/错令牌拒绝、退出后的凭据失效、一个fence/一调用/四项资源记录、原知识结果与来源重开、跨task恢复拒绝、注销拒绝。第二例验证未知usage保持原收据、取消不回滚、不二次发模型，预abort保持QUEUED且零输入。正常澄清答案/等待确认phase尚无正式生产者，本片不手写其状态、不宣称其完整恢复路径已验。

环境同上轮严格离线：无效DATABASE_URL、本树preload、AI_OFFLINE_WRITE_ROOT及cache/tmp、DISABLE_V8_COMPILE_CACHE=1；audit为output/ca-model-request-bound.audit。命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='request-bound model' tests/ai-native-lane-a-original-scene-host.test.cjs`

首轮2pass/0fail/0skip/0todo，退出0；第一例内部循环三场景不另算项。API沿用本树shared源码paths+现有私有Prisma的noEmit程序，0diagnostics/退出0；diff0；type/smoke audit无阻断记录。不生成client/dist，不改schema、不安装/启服务/外联/迁移/推送/合main，旧生成失败的lock/previous/temp/output保持。主线另报其新B create附件门使旧knowledge fixture的assertKnowledgeBinding占位触发，主线独占修该固定集成fixture后再交SHA；本片未导入B上传链，自己的2/2不冒称主线新门已验。

独立subagent仅做本包新增约束的只读审查（两生产文件局部、既有fixture与两用例，共5次读取），未发现可复现跨请求泄露、租约/提示词注入或未授权副作用；未重审全库或重跑测试。

Runtime替换仅门面后的原驱动边界，当前请求身份、host租约、原收据、财务源及知识重授权不迁入引擎；Provider SDK仍只在唯一Gateway后替换，本门面不接SDK类型。取消/核对不是重派；停装request-bound模型门面不删除历史模型输入或unknown。07正式reprepareServices工厂/06phase到达后再串联相应场景，不在本包另造。

双替换的具体接口/状态映射（当前只准备，不安装框架或迁移）：

- Runtime入口：`composeRequestBoundOriginalSceneModel(dependencies, {enabled,audience,host,runServices})`固定7个请求方法；外部引擎以后只能作为原application的宿主驱动。`start`仍以原inputRef找到原task/run，`resume`仍提交原submission/receipt，`reconcile`仍查询原持有租约，不把它翻译成新claim或retry；`requestCancel`返回requested_not_rollback，不映射成已撤销Core或已退费。
- Runtime结果：保留`execution.kind=run_outcome|not_started`及原outcome status；unknown不可转换为成功或零用量，`recovery_lease_unavailable`不可转换为重新运行。readModelResult/reopenModelSource继续读取原resultId及绑定的input/step/action/invocation、knowledge hash。正常WAITING_INPUT/WAITING_CONFIRMATION映射须等06正式phase，不用外部框架的暂停状态代替证据。
- Runtime耦合：host holder/leaseMs、runServices(input)提供的原inputSource与financialEvidence、原数据库仓储/plan/step/fence是明确耦合点；第三方引擎不得拥有另一份task成功账、许可决定或预算账。请求凭据仅当前调用内有效，不持久化给引擎后台重用；后台继续执行须走原可信宿主重新鉴权路径，本包不另发服务令牌。
- Provider SDK入口：只替换`runtime.ports.transport.invoke/stream`的协议适配，不替换当前请求门面、原routing/admission/dispatch/budget。稳定保留requestId/callId、configId/configRevision/credentialRef、intent/configuration hash和priceVersion；SDK usage须归一为实际reported输入/输出token，缺usage沿用unknown/pending_reconciliation，SDK错误或超时不得触发无原幂等证据的自动补发。
- 迁移/回退：先以本包两项离线链路确认同一原输入、单个fence/调用、四项资源记录和原结果来源；再在唯一宿主或唯一transport装配点单边切换，禁止新旧Runtime/SDK对同一run双跑。回退仅停止新装配/新派发并恢复旧装配；旧input/selection/approval/Core、财务记录和unknown留存，用原read/reconcile确认，不能删除后重建。真实第三方运行行为和真实SDK协议仍待另行授权验收。

## CA03/CB07 原场景知识冻结与来源重授权（20261008）

从请求绑定包6f5dbf58接续，固定知识政策1faf979674efefb028b108ad045d5bd125796135已导入f961a1fb1e6ebdf78ee15aed77597a6b7ef34797。主线确认A只消费场景、B维护knowledge。B固定8c3d8b42e7896bd626387c7c1f80406e224fe7d9仅两个生产文件的grant差异已导入f0c8971296695f6ab93f2b434a777e65e27f3254：scope与document分别复验相同resource，不要求不同资源同grantKey。原补丁因B旧上下文take:101而A为take:100不能直接应用，check未写入；逐hunk移植其8增3删，未导入上传测试链、schema或改动其他B逻辑。

现有composeAiOriginalSceneModel可显式接knowledge基础设施，内部用同一A auth、credentials、clock创建composePrismaFormalHumanKnowledge，而非接受预授权服务。原prepareHeldRun只读原请求和Core准备结果，另外收集有界知识与已确认偏好（4来源、每段1000字符、合计16384 UTF-8字节、4偏好），原材料复验后冻结originalInputRef/contentHash/material。缺政策、无结果、未ready或正文不可用不伪造成空ready。订单查询词取原question，开业取原sections，报价使用quote；这是现有词法检索，不宣称语义召回或完备知识库。Core的facts/materialHash保留独立，知识金额、库存、付款说法不覆盖Core；偏好保持preference_not_authority、人选歧义保持human_selection。

原已登记executor对冻结包复验，并在同调用AsyncLocalStorage作用域内扩展原Gateway routing.assertCurrent：保留原路由检查，再校验当前原请求/task身份及冻结来源。Gateway现有发送前/返回后路由检查均复用此检查，不另造transport、不调用SDK、不改变单账或租约转换。结果读者解析同一持久input/step/invocation，复验知识和确认记录后才展示模型文字；来源重开只接受sourceKind=knowledge及已冻结sources索引，重读原source并复验同一result/knowledge hash，不重新搜索替换材料、不接受URL或任意来源。没有知识包的原输入仍按原Core路径读取；读者未配置知识基础设施时不能展示含知识的旧结果。整个包不建立跨Core/知识事务，后校验拒绝不代表已写输入、财务记录或已发模型被回滚。

扩两份既有A测试。原模型夹具继续实际Auth/Guard、原请求、QUEUED启动、lease、计划/登记、Gateway输入/持久调用证据/捕获/资源记录；新增实际正式政策源与知识/记忆Prisma适配、文档create/parse/index/publish及人工propose/confirm/revoke。数据库、精确政策行、文件字节、路由/admission/财务生命周期/模型transport为显式离线替身，不是实际MySQL锁、文件ACL后端、真实HTTP/模型或生产验收。政策行按具体principal/action/resource预置，不用共享grantKey或万能授权回调。测试覆盖三个场景、Core隔离、真实确认偏好、来源索引/URL拒绝、结果不重搜、source-policy撤销、撤回同意、Gateway最后路由复验撤权后零transport，以及缺search政策零输入/计划/invocation；旧成功与未知用量路径一并定向回归。

环境为本树固定离线preload、无效DATABASE_URL、本树AI_OFFLINE_WRITE_ROOT及TMP/TEMP/TMPDIR/XDG_CACHE_HOME/npm_config_cache，DISABLE_V8_COMPILE_CACHE=1；audit为output/ca-knowledge-smoke.audit。首次命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='scene knowledge|original model application' tests/ai-native-lane-a-original-scene-host.test.cjs`

首次1pass/4fail：新executor错误将含routeScene的binding整体传入严格两字段policy，导致CONFIG_INVALID；修为显式sceneCode/maxOutputTokens投影，未放宽schema。仅四项复验3pass/1fail；剩余测试误把重开正文查询计作搜索，按真实SQL text.contains计数修正；随后暴露夹具遗漏撤回同意所需的显式delete政策，补齐该已确认资源的测试政策，不改产品授权。最终仅`--test-name-pattern='scene knowledge stays'`复验1pass/0fail/0skip/0todo，退出0（内部循环三场景，不另算三项）。不同轮次不合称单次5/5。API用上节source paths/隔离Prisma noEmit校验，最终0 diagnostics，diff check退出0；type/smoke audit均无阻断记录。

隔离生成器早前返回失败：临时共享junction清理被严格preload正确拒绝，output/ca-knowledge-generate.audit保留runtime与@alloc两条write-outside-temp；未放宽护栏或删除锁。只读核验新私有client归属、schema及所有files指纹均一致，含AiKnowledgeActionPolicyDelegate；schemaHash=df8e5334143d0c8202d26064fe7b9f5dd510cfc89ceea2bf39941d4162af0022。此为独立客户端状态证据，不将生成命令失败称成功。主线已交安全清理f0ae011bbd03cf36797c895633fb97924ec23513，本包未导入/重跑；旧lock、previous、temp、output一律保留，未动共享生成物、未执行迁移。

独立只读subagent定向审查了三个场景生产文件、两份测试及必要的知识授权/冻结/路由相邻函数，未发现本批新增代码的可复现凭证借用、扩权、跨原请求、来源替换、Core覆盖或无知识路径回归问题；未扩大到全项目审计，也未运行额外测试。

Runtime独立替换继续保持原inputRef、plan/step/fence、知识快照与当前重授权；只迁编排，不搬知识权限、人工确认、Core和财务事实进引擎。Provider SDK仍仅唯一Gateway后的独立transport/protocol边界；本包无SDK类型，模型文本不能授权执行。停止knowledge装配可阻止新知识调用，但不能绕过含知识旧结果的重授权，不能抹历史或自动重派unknown。正常澄清/等待确认phase仍待06固定消费，实际新方案reprepare工厂归07；A只负责后续场景调用，不重造工厂。

## CA01/05/09 请求绑定场景入口（20261008）

从317826933f8d3f8144ff9eb8a0dbda9e73e40654接续，源码无WIP/未完成git操作，保留output与唯一心跳da772047。主线确认本批原场景/选择module、controller及新request-bound-scenes.application无其他作者争写。

新增composeRequestBoundOriginalScenes、composeRequestBoundQuoteSelections、composeRequestBoundHumanQuoteOrder：服务端固定enabled=true及operator/staff audience；仅读取请求headers.authorization，进入await前固定Bearer、requestId与命令克隆。在独立ALS中按本请求凭据装配原Auth/Guard、原请求仓储、选择与原人类审批应用；不接受预绑定credentials/originals，不接受body里的scope/owner/lease，不回退到ambient身份。调用结束使该凭据提供器失效；没有持久令牌、副作用队列或新任务状态机。

两个既有registerHttp现在需要无credentials/originals的正式依赖以及options，controller显式@Req读取请求。raw服务器应用仍保留原register/registerApplication；请求绑定分别用AI_ORIGINAL_SCENE_REQUESTS、AI_HUMAN_QUOTE_SELECTION_REQUESTS和AI_HUMAN_QUOTE_ORDER_REQUESTS，避免Nest容器混用接口。AiHumanQuoteSelectionModule.registerRequestBoundApplication只提供原选择绑定的人类审阅/决定/决定收据/重准备资格，不提供publish、prepare、submit或运行租约。人类决定仍不创建订单，原Core执行只留在服务器/runner应用；未注册AppModule或新增公开审批路由。

扩现有A两份测试，不新建测试脚本：真实Bearer由AuthService签发，实际当前会话、原Guard、独立ALS、原请求/选择持久化与人类AiApprovalService/CAS均被驱动；DB/业务事实仍为明确替身，审批前运行lease/step为显式测试前置。原请求测试包含禁用/ambient装配拒绝、缺header/错误令牌拒绝、并发不能借身份、await前header/body快照、读后撤权；选择/审批测试包含同请求原材料重建、选中不等于批准、私带lease拒绝、真实人类批准与原收据、注销拒绝、无HTTP提交方法。

离线环境沿用上轮：固定无效DATABASE_URL；本树绝对AI_OFFLINE_WRITE_ROOT/audit；TMP/TEMP/TMPDIR/XDG_CACHE_HOME/npm_config_cache均本树output/lane-a-original-request-tmp；DISABLE_V8_COMPILE_CACHE=1。首次命令（audit output/ca-request-bound.audit）：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='opt-in module|request-bound' tests/ai-native-lane-a-original-scene-host.test.cjs tests/ai-native-lane-a-human-quote-selection.test.cjs`

首次2pass/1fail，失败是新审批前置夹具缺aiTaskEvent delegate导致原注册事务AI_STORAGE_UNAVAILABLE；只给夹具补表，不改任何产品门槛。最终仅受影响`--test-name-pattern='request-bound quote' tests/ai-native-lane-a-human-quote-selection.test.cjs`复验1pass/0fail/0skip/0todo，退出0，不拼称一次3/3。API使用下节相同本树源码paths+隔离Prisma的noEmit程序，output/ca-request-bound-types.audit，API source diagnostics:0、退出0；diff0。未做真实HTTP传输/Nest服务器/MySQL/模型/支付/设备或生产验证，不生成shared dist，不读.env/安装/启服务/外联。

Runtime替换继续只在请求宿主之后的驱动边界，当前Bearer/人类选择/审批/Core权威不迁入引擎；Provider SDK保持唯一Gateway后的独立边界，本片无SDK/协议类型。回退不装配request-bound模块即可保留原服务器应用，不恢复ambient HTTP模式、不撤销已记录决定或重派unknown。正常澄清/等待确认checkpoint及新方案实际重新准备仍依赖06/07固定交付；配置/资料CAS和原收据未齐保持unavailable。

## CA05/09 临时代班接续：正式审批投影与原操作重准备资格（20261008）

固定导入07前置0a64993e→62ce491b、79f3e02a→c79477b0、359e52d9→90d23a72，没有覆盖07源码。现有选择应用的readSelectedProposal、decideSelectedProposal、readSelectedDecisionReceipt改消费controlled.application的正式JSON-schema校验输出；原facts快照只在内部参与选择/提案绑定，不再作为审阅输出。新增readSelectedReprepareEligibility({selection,request})消费07原资格读者，先核对相同选择、原输入和proposal，再按原批准/消费/业务幂等收据返回pending/rejected/committed等原状态。资格为true仅表示可提供新材料，不创建新run、不新建proposal、不重准备或重派。

原选择→审批/Core测试继续使用同一A fixture。命令为相同严格离线环境、audit本树output/ca05-public-approval.audit：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='selected order' tests/ai-native-lane-a-human-quote-selection.test.cjs`

初次2pass/0fail/0skip/0todo，退出0；验证正式draftVersion、审阅无内部facts、待确认pending、已提交不许重新准备、拒绝仅要求新材料，并保留两种COMMIT应答丢失原核对和拒绝不得执行。随后收到主线63ed7e6b5683f4d503ddd0646ec27250b1236a84，精确导入shared/index及3个OpenAPI公共文件，补齐该固定版本缺失的ai-inspection-persistence类型叶子，依赖提交905e7432；不整包导入63ed、不拉B行为或改schema/dist。原请求/选择和original-scene-model的9个import-only固定差异改为@rental-os/shared，不改变业务逻辑。扩同一用例断言正式shared导出及OpenAPI generatedText严格null-only，再次仅该2项退出0，不累计为4项。

最终API noEmit采用本树shared源码和隔离Prisma类型（默认dist未重建、不能据此宣称普通发布构建通过），audit本树output/ca05-public-source-types.audit。相同离线环境下真实命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "const ts=require('typescript'),path=require('node:path');const c=ts.readConfigFile('apps/api/tsconfig.json',ts.sys.readFile);if(c.error)throw Error(ts.flattenDiagnosticMessageText(c.error.messageText,' '));const p=ts.parseJsonConfigFileContent(c.config,ts.sys,path.resolve('apps/api'),{noEmit:true,incremental:false,rootDir:path.resolve('.'),baseUrl:path.resolve('.'),paths:{'@rental-os/shared':['packages/shared/src/index.ts'],'@prisma/client':['apps/api/node_modules/@prisma/client/index.d.ts']}});const program=ts.createProgram(p.fileNames,p.options),d=[...p.errors,...ts.getPreEmitDiagnostics(program)];for(const e of d)console.error(ts.flattenDiagnosticMessageText(e.messageText,' '));console.log('API source diagnostics:',d.length);process.exitCode=d.length?1:0;"`

结果API source diagnostics:0，退出0；diff0。沿用上一节明确的DB/Core业务事实/运行前置替身边界，不变成真实服务或完整worker证据。

Runtime只消费公开状态和原引用，不能把canRequestReprepare当授权执行；Provider与SDK完全不进入本应用，未知用量/原收据语义不变。回退显式装配，不删除历史选择/审批/订单。请求隔离生产者359e已导入但本片未注册/验证HTTP；完整公开路由仍待公共宿主消费。06新宿主e8867d38与本线已有模型场景能力重叠，不盲目再造或改接另一宿主；正常澄清与等待确认仍待06固定交付。CA06/07继续缺合法业务CAS/幂等收据，明确unavailable。

## CA05 临时代班接续：原选择、人类决定与受控建单（20261008）

前置为既有bdfe989c808712243d226ade4c67375dc4e80563选择包；07正式人类审批df86b688导入cdd2bd02、审阅事实c255c4c4导入033796d9。没有重写原选择仓储、审批器、Core或迁移；07后续请求绑定运输及重新准备资格是独立固定依赖，不冒充本片已经接入HTTP。

现有composeHumanQuoteOrder/registerApplication增加readSelectedProposal、decideSelectedProposal、readSelectedDecisionReceipt、submitSelectedOrder、reconcileSelectedOrder。输入只采用严格选择证明+原proposal引用/decision或原受控command；命令仍为服务器应用内部调用，不对外开放lease。每次审阅/决定/提交绑定原请求对应task/run、持久选择inputHash、quoteId、已登记step/action、quote-selection:<selectionId>原输入及被审阅INPUT快照；不能拿另一同金额提案或普通聊天代替选择。审阅沿用原PREVIEW的确定性金额/期限，generatedText=null；decide只调用原AiApprovalService/CAS，order明确not_created_by_decision。提交和核对完全复用controlled.submit/reconcile及原Core事务/审批消费记录。历史核对使用原选择的当前受权历史读，不因原输入/选择到期或停用执行政策而删除已提交订单。

复用tests/ai-native-lane-a-human-quote-selection.test.cjs，新增A专属lane-a-selected-order.cjs。实际原请求保存/task创建、选择、publisher、plan/step登记、提案准备、人类read/decide/readReceipt、RentalOrderConfirmationService及审批消费/Core提交事务被驱动；没有手写APPROVED、COMMITTED或业务成功收据。租约和步骤RUNNING为显式测试前置；数据库为串行事务替身，Core报价/库存/prepareOrder业务事实为既有替身，因此不是运行worker、四品类真实Core算法或MySQL锁验收。独立CA03另验真实首次QUEUED启动，不把两份夹具拼称完整模型→等待批准worker链。

离线环境同CA03，AI_OFFLINE_AUDIT为本树output/ca05-selected-order.audit；初次命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-lane-a-human-quote-selection.test.cjs`

初次2pass/2fail：旧选择用例通过，新夹具误传createTask字符串而非正式引用；修正后发现错从registration回执取actionId，改读原已登记step；再修夹具findFirst在relation展开前过滤，保证原审批消费step.is条件真实生效。未改产品授权检查。拒绝决定负例随后通过；最后仅受影响`--test-name-pattern='selected order goes'`复验1pass/0fail/0skip/0todo，退出0。该例验证审批COMMIT应答丢失后原readReceipt、无订单副作用，Core提交应答丢失后原reconcile、选择到期/AI关闭后保留同一订单、跨hash和注销拒绝。不同执行的通过数不相加为一次4/4。API源码rootDir . noEmit同轮退出0，包含本片生产源；diff check退出0。

Runtime依赖边界：选择/提案/审批/原action与原业务幂等收据不迁入引擎，宿主只编排原引用和租约，readReceipt/reconcile不能自动转成submit。Provider SDK只在唯一Gateway后替换；本片没有SDK类型或模型协议调用，模型文字不授审批。回退停止新方法的宿主装配，不撤销历史人类决定、不删除原选择/订单/unknown，不双跑提交。

尚缺：07/06等待批准executor与实际场景运行计划的完整联接、明确拒绝/到期后的新输入/新run重新准备、公共request-bound运输最终消费。CA06/07普通配置/资料仍无已核验版本CAS及原操作收据，不借order.commit；真实HTTP/DB/模型/支付/四品类算法/设备/生产均未验。本片保持opt-in，没有安装、启服务、读.env、共享生成物写入、推送或合main。

## CA03 临时代班接续：固定模型转换与实际场景运行（20261008）

接手核验HEAD为8de5d833b3385886aff4eb9eb12da2afd9da11d5，源码干净、无MERGE_HEAD/CHERRY_PICK_HEAD；负责人本会话直接授权恢复，主线确认旧Codex停写。沿用现有original-scene-model.composition.createApplication，不新造场景运行器。主线d59ef3d491d0d9ffc493e90d15bca26b9dd35cf0导入为879e2666；缺usage公共修复d035cbaba58f4d0eb8586c4093550560b1bed775导入为85c0953b。

场景应用固定使用model.commands和model.createTransitionAuthority(run.financialEvidence)；run只接受inputSource、必需的原持久financialEvidence及可选时钟，不再依赖宿主自造命令/转换authority。原publisher、plan、step、invocation、Gateway、capture和资源结算均复用原实现，缺正式输入源/财务源在装配时拒绝。

扩展既有host测试并抽出A专属lane-a-original-model.cjs：订单解释、开业诊断、报价澄清逐个从原请求创建的QUEUED task/run开始，经原租约领取/首次激活/输入计划发布/模型执行/结果artifact/四项资源记录，再从真实结果消费者读回；全程不手写RUNNING或模型成功artifact。实际PrismaGatewayAccountingFacts与PrismaGatewayInvocationBindings读取所关联的财务记录。DB、路由/能力/政策数据、admission、财务reserve/settle生命周期和transport是显式离线替身；这不是实际MySQL或完整财务账本写链/真实模型验收。

命令：固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT为本树；TMP/TEMP/TMPDIR/XDG_CACHE_HOME/npm_config_cache均本树output/lane-a-original-request-tmp；DISABLE_V8_COMPILE_CACHE=1；AI_OFFLINE_AUDIT为本树output/ca03-model-app.audit。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='original model application' tests/ai-native-lane-a-original-scene-host.test.cjs`

最终2 pass/0 fail/0 skip/0 todo，退出0。其中第一例循环三个场景，不另算三项。缺usage原completed载荷保持不完整UNKNOWN、POSSIBLE、token=null、财务待核对；重查不新派发。AI关闭后的读取/取消不删除已有事实；启动前AbortSignal不领租约、不发布。跨task输入与注销读取拒绝。初次编译报financialEvidence可选类型已改必需；fixture补Prisma字符串Decimal查询等价，未放宽真实查询；原d59缺usage拒绝由主线固定d035修复，未在A维护authority。首两次缓存写到系统临时目录的尝试被preload阻断，审计保留两条write-outside-temp，无外联记录；之后明确设置本树临时目录并关闭v8编译缓存。

API同离线环境及preload，`node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--rootDir','.','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`退出0。未生成shared dist、未改schema/执行迁移、未安装/启服务/读.env/真实HTTP、DB、DNS、模型、支付或生产启用。

明确剩余：正常澄清等待仍受原PrismaTaskInputRepository.afterSucceeded只接受readonly且必须有后续pending步骤的约束；当前单步external_unknown模型计划不能伪装成该路径，已报主线/06。不声称正常答案receipt→继续执行已端到端验证；CA05另片消费人类批准/Core，CA06/07仍缺合法配置/资料CAS及原操作收据。

Runtime替换映射：保留original/inputRef、registrationRef、planHash、holder/fence、resultRef与四项资源证据；只替换外层驱动，不搬授权、审批或Core入引擎。Provider SDK替换仅唯一Gateway后的transport/protocol层，场景代码无SDK类型，completed/usage unknown不能改成success或自动重派。回退停止新opt-in装配即可；保留原源码、测试、持久输入及unknown收据，不双跑新旧引擎。

# Codex A 总册接续：人类报价选择

继承 HEAD：69c753084c928e0c48271ccccb62f5c6ac044002（Claude WIP）；原树/原分支，无未完合并。负责人已确认原作者停写。本记录只认领A，不修改主文档、06/07、Gateway或Core。

## 本片实际功能

- 复用独立 AiTaskQuoteSelection 及已提交迁移，未重写迁移。保留当前身份、原请求、task/run、当前Core报价校验、不可变载荷/报价hash和选择幂等键；选择不授审批。
- AiHumanQuoteSelectionModule.registerHttp 可选装配 select/read/reconcile。真实会话与原Guard在仓储内复验；HTTP不接收租约、不暴露发布/审批、不自动注册AppModule。运输目录在A独占 shared 叶子 AI_QUOTE_SELECTION_HTTP_DRAFT，总出口交主线。
- composeHumanQuoteOrder / registerApplication：publishSelectedInput只从持久化选择读取body，派生 quote-selection:<selectionId>，调用原publishOrderInput；prepareSelectedProposal核查原step→input→selection的hash与registrationRef，再调用原受控prepare。不得由外部传另一份order body。运行租约与步骤启动归06，人类审批/提交归07。
- 原task锁下拒绝在已有order输入或已冻结plan的run中创建另一选择；原键重放不替换。需要改需求时重发原请求/新run。
- 发布/准备前后重新验证选择；它们是独立事务，后校验失败可能已留原输入或pending proposal，不能称原子回滚/未提交。此应用不执行订单、不声称端到端已闭环。

## 定向快检

只新增一份两项冒烟，不扩全矩阵。驱动真实Auth/Guard/Subscription、Core报价/匹配、原请求/选择Prisma适配及应用composition；数据库/政策数据为离线替身。

环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a/output/lane-a-ca02-audit.log。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-human-quote-selection.test.cjs`

最终2 pass /0 fail /0 skip /0 todo，退出0。先遇到夹具错用getQuote参数、误传Core内部行快照字段、组合缺结果artifact delegate，已修夹具，未放宽产品校验。先前仓储版2/2不能与最终应用版相加。

同preload、audit本树output/lane-a-ca02-types-audit.log：`node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--rootDir','.','--noEmit','--incremental','false'];require('typescript/lib/tsc')"` 退出0。采用已有整树rootDir检查；非默认API build，shared叶子总出口仍缺整合。

## 准确剩余与下一步

CA02仓储/显式应用/运输代码可用；本次未运行合法held lease→真实运行步骤→pending审批的正常组合，也未验证新HTTP网络运输。不能据2项冒烟宣布CA02、CA05或AIN15全链完成。CA01已有原请求代码复用，公共出口等待主线。继续固定81db55a7模型输入依赖与06同租约准备宿主消费，再做CA03/04/05；CA06/07合法业务写端口、CA08客户独立身份链、CA09公共结果需逐一核查，未实现不计完成。

Runtime替换只消费原引用、指纹与租约，不改变本片选择事实/批准提交点。Provider替换仍只在唯一Gateway适配层，本片无SDK类型。回退装配可停止注册新模块，保留持久选择与历史，不重派unknown、不改原审批收据。

未验：MySQL/迁移执行、真实HTTP/模型/支付、浏览器/设备、生产。无安装/启服务/读.env/外联/共享生成物写入。

## CA03：原请求事实到模型输入/计划的装配（本次）

已将固定依赖 `81db55a77f6c6119b6bce19280d1b02a9437e5d9` 合入本线，合并提交为 `0376c084384668053b799aa30850ac8cf94a18b3`。新增 `composeAiOriginalSceneModel` 与 `original-scenes.module.ts` 的可选 `registerModel` 装配：它复用原请求、历史事实、任务收据、持久化模型输入与计划端口，要求同一 inputRef、task revision、身份和受控运行租约；模型输入发布前不启动 runner、不调用供应商模型、不创建审批或业务写入。输入正文以不可信业务数据封装，结果只返回冻结的 registration/input/plan 引用和明确阶段。

### 本片验证

- 人类选择既有定向冒烟：2 pass / 0 fail / 0 skip / 0 todo，退出码 0。
- API 隔离 TypeScript 检查：退出码 0。
- `git diff --check`：在删除临时红测后重跑，预期仅保留行尾提示；本片提交前必须以实际退出码为准。

曾临时尝试用扩大的合成夹具直接驱动 held-lease→模型输入，但因缺少可信预算/动作策略/权限关联而被真实授权门拒绝；已删除该临时测试，不把替身补表当作生产接通证据。CA03 的生产组合代码已完成静态类型验证，真实模型/数据库/运行器组合仍未验，不能称 CA03 或 AIN06/15 完成。下一步继续核对 CA04 订单解释消费入口和 CA06 业务差异准备，缺正式结果/审批端口保持 unavailable。

## CA08：客户身份隔离的只读宿主装配（本次）

新增 `apps/api/src/modules/ai-native/client-scene.composition.ts`。该叶子只接现有 `ClientApiService` 和由 `ClientAuthService`/客户端路由创建的 `AiClientSessionSource`：游客只能读取已发布渠道 bootstrap/catalog；登录客户只通过当前会话读取白名单目录、可用性、本人订单、本人订单详情和企业身份候选。每次成员操作重新取得会话，拒绝缺失/非 active/非 personal-or-corporate 上下文；订单归属和发布过滤仍由现有 ClientApiService 复核。

适配器不接受模型传入 tenant/workspace/customer/token，不复用 operator/staff 工具，不注册路由，不执行报价、支付、取消或业务写操作。当前仅完成可被未来客户宿主显式导入的实际组合，真实客户端 HTTP 接入与匿名登录迁移仍未接通；不把该组合称为 AIN-21/22 完成。

## CA04：订单解释结果校验边界修复（本次）

修复 `AiOrderExplanationPreparationService.validateGenerated`：金额或支付来源被拒绝/未加载时，事实对象只有 coverage、没有 `value`，校验器现在保持 unavailable，不再对缺失值执行 `Object.entries` 或把缺失金额当作零。已有可用来源仍按订单/支付记录 ID 和精确字段值校验；文本始终标记为未验证且不得执行。

定向验证：API 隔离 TypeScript 检查退出码 0，`git diff --check` 退出码 0。未接真实模型结果读取、浏览器或生产支付；CA04 的真实模型→结果读回仍受 R/P 的结果端口约束。

## CA09：任务中心只读场景聚合（本次）

新增 `task-center-scene.composition.ts`，组合已有有界任务列表、原请求 `readHistorical`、任务收据和恢复读者。它输出原请求版本/scope/audience、任务元数据、恢复下一步和结果可用性声明；所有读取继续走原仓储授权与逐次复核，不创建新 run、不重连、不批准、不执行。`resultAvailable` 只表示存在受权结果引用，不把任务元数据当结果正文。

`AiBusinessScenesModule.registerClient` 现提供显式 opt-in 注册；仍不注册 AppModule/HTTP。定向验证：API 隔离 TypeScript 检查退出码 0，`git diff --check` 退出码 0。R/P 的正式 result/approval DTO 尚未在本线提供，真实结果正文、事件 cursor 与公开任务 HTTP 仍保持 unavailable；没有把 CA09 适配器宣称为完整任务中心。

另补客户端组合装配检查：缺任一现有只读 client service 方法即在装配时 fail closed，而不是在请求中途抛出未定义方法。该修复同样以隔离 TypeScript 0、diff check 0 验证。

## CA04/CA09 接续：实际持久模型结果消费

固定依赖已接回：主线81f66af1/64dba2cf/827dc0eb，本树对应a8341795/c4003053/732ab29b；未追随主线活动HEAD。

新增 `AiOriginalSceneResultService.read({original,resultId})`，组合主线实际 `AiTaskResultRepository`。订单解释结果按原请求、task/run/step/action、不可变模型输入、身份hash、意图fingerprint、Gateway invocation及配置/价格版本绑定读取。只返回有完整计量的completed文本；unknown/failed不返回正文、不自动重派。订单结果重新调用原受权准备服务，比较实际事实、版本和coverage；变化返回stale，不展示旧答案。仅排除明确的查询观察时间，不排除业务日期/金额/版本。生成文本始终不是业务执行证据，不输出Gateway凭据/供应商配置或原始异常。

实际入口：`composeAiOriginalSceneModel(deps).readModelResult(command)`；任务中心可注入 `modelResults: {read: model.readModelResult}` 后调用 `readModelResult(command)`。缺该读取器返回AI_RESOURCE_UNAVAILABLE。装配需要显式提供已有 `aiTaskResultArtifact` delegate，不自动注册生产模块。订单外的模型场景结果尚未实现此业务事实复核，不冒称全场景完成。

未新增测试脚本，仅在既有 `tests/ai-native-lane-a-original-scene-host.test.cjs` 加一个组合冒烟。先运行4 pass/1 fail，发现把含routeScene的binding传给严格text policy导致CONFIG_INVALID；本片已投影到正式policy字段。最终命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-original-scene-host.test.cjs`

5 pass /0 fail /0 skip /0 todo，退出0。覆盖实际结果仓储与场景/任务中心正常读取、跨调用绑定拒绝、unknown不展示和注销拒绝；数据/事务为离线替身，没有真实模型派发证据。

API命令（同preload）：`node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--rootDir','.','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`，退出0。固定无效DATABASE_URL；审计路径本树output/scene-result-smoke.log、output/scene-result-types.log；不提交output。

已按负责人授权向主线对话报告CA06/CA07正式配置/资料提案和执行端口缺口；主线确认由其核查和交付固定接口，本线维持prepared_not_submitted/unavailable。不改审批合同、不复用order.commit批准资料。下一步核对CA05选定报价到原受控审批/Core接法。未验MySQL、真实HTTP/模型/支付、浏览器/设备、生产；本片不代表AIN13或CA队列整项验收。

## CA08 接续：真实客户端Guard身份生产者（20261008）

`createAiGuardedClientSession(guard,credentials)`不再仅有current接口：实际调用原ApiAuthGuard的client路由分支，由原ClientAuthService解析令牌/读取当前会话，由Guard执行现有客户端限流与经营政策并写入ALS。服务端request host只提供authorization/ip；业务输入不能提供身份、scope或路径。目录、可用性、我的订单、订单详情、企业候选分别映射现有ClientApiController的固定路由，读后再次走同一Guard并核对客户端上下文。缺clientAuth/限流等原Guard依赖依然拒绝。

`composeAiClientScenes.member`接回该实际生产者；旧显式session注入兼容路径也新增读后复核及独立ALS，避免读取等待期间切会话后仍返回旧内容。订单/可用性参数进入await前固定；可用性和分页复用原ClientAvailabilityRequestDto/ClientMyOrdersQueryDto+ValidationPipe，不另造公开schema。`AiBusinessScenesModule.registerAuthenticatedClient({client,guard,credentials})`为显式生产组合入口，不注册AppModule或HTTP；原guest路径仍仅暴露原公开投影，不宣称已完成公开HTTP限流装配。

仅复用原host测试文件加一个快检，命令：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-name-pattern='client scene' tests/ai-native-lane-a-original-scene-host.test.cjs`。实际ClientAuthService.sign/parse/authenticate、ApiAuthGuard、ClientApiService.getOrder/本人校验/投影被驱动，DB与限流为明确离线替身，secret为测试内合成来源，不读取.env。1 pass/0 fail/0 skip/0 todo，退出0。验证默认装配无读取、本人读取、不回传内部备注、跨客户404、运营令牌拒绝、await期间撤销会话401、分页伪造tenant字段400。

API类型命令同上一节，audit为本树output/client-guard-types.log，退出0；`git diff --check`退出0。非真库/真实HTTP/生产会话验证，没有客户模型派发、客户任务持久化或企业资格业务写入，不能称CA08整项完成。

CA05当前已复用受控prepare/submit/reconcile，但本树缺总册07人类readProposal/decide/readReceipt及正式审阅组合的固定交付；已直接发给主线索取固定SHA/入口。绝不手写APPROVED行来假装正常全链。CA06/07继续等待主线正式合同，未新增审批旁路。后续接续先检查主线固定回复，再消费原审批与06宿主；不修改它们的实现。

## CA03/09 接续：原应用输入、核对与取消消费（20261008）

上述createApplication返回值新增readInput(originalRef)、resume({original,submission},signal)、reconcile(originalRef,signal)、requestCancel({original,expectedRevision})，分别调用原PrismaTaskApplication和AiTaskTransitionRepository。submission复用正式isAiTaskInputSubmissionDraft，并核对taskId为原请求对应任务；核对只读原holder的有效租约，不新领取、不重派。取消保持原revision CAS/动作权限/事件事务，仅cancel_requested，不伪造已回滚。等待后再核对原请求身份和task/run绑定。读输入/取消仅要求历史请求当前可读，不重新开执行gate；AI关闭仍可人工收口。没有注册HTTP/worker或新状态机。

仅扩既有单个应用冒烟，实际runner和仓储路径延续上节；增加无原持有租约不恢复、跨task补充回答拒绝、AI关闭后readInput返回无待填/取消请求持久化、注销拒绝及零新invocation。首次因合成夹具缺claim_recovery_run动作政策被正确拒绝，补明确测试政策后通过，没有改生产授权。命令 `node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-name-pattern='original model application' tests/ai-native-lane-a-original-scene-host.test.cjs`：1 pass/0 fail/0 skip/0 todo，退出0；API类型同前命令退出0（output/scene-recovery-types.log）；diff0。

合法待填回答的正常继续仍需正式inputSource和模型转换证据；这次只验证跨任务拒绝，不将其称为澄清执行全链。人工takeover正式宿主合同仍归06/主线，不在A新增接管权限。所有真库/模型/HTTP/设备及生产未验边界保留。

## CA03/05 接续：原请求到同租约实际运行应用（20261008）

已按主线固定指令接回b700c9bd→855f694a、d51bf62a→e2b6db78、33db875c→7ba250a9。composition冲突保留原results并加入createApplication；A树没有inspection-media.reader，按主线指令不接该独立type import，不拉B链。后续实际首次QUEUED运行红测发现aiTask变RUNNING、aiRun仍QUEUED，资源准入拒绝；主线修复bca4576a已接为141c2156，没有在A树私改运行状态。

实际入口 `composeAiOriginalSceneModel(deps).createApplication(serverHost,runDependencies).start(originalReference,signal)`。原app读取当前task/run修订、原runner原子领取一次并启动，再在同一lease/taskRevision下调用实际prepareHeldRun→冻结模型输入→持久计划。每次start绑定自己不可变原请求，调用方不传holder/plan/taskId/prompt/身份。装配不启动、无后台循环；当前场景仍走唯一Gateway，不自建模型执行或财务账本。runDependencies必须显式提供commands/inputSource/transitionAuthority/financialEvidence，不用只读转换器冒充模型转换证据。

复用既有host文件一个快检：原Auth/Guard/原请求仓储/真实task+run QUEUED/实际runner/实际模型publisher与计划仓储被驱动。DB、路由能力与policy为明确合成替身；transitionAuthority及financialEvidence故意不可用，没有用测试恒真authority冒充生产适配。正常准备形成一份input和plan、同fence=1，到步骤转换拒绝，零Gateway invocation且租约释放。正式模型转换证据尚缺，因此不是完整模型执行通过。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-name-pattern='original model application' tests/ai-native-lane-a-original-scene-host.test.cjs`最终1 pass/0 fail/0 skip/0 todo，退出0。红测阶段先暴露替身缺DB默认cancelRequestedAt/updatedAt，补真实默认后暴露上述QUEUED run核心缺陷；没有放宽生产权限。最后缺转换adapter被AiStepTransitionRepository按原语义映射AI_ACCESS_DENIED，断言同时要求确实到达转换器一次及run已RUNNING，防止把前置资源失败误计为正确拒绝。

报价澄清结果已接回同一实际结果消费者，不新建同义reader；按selection/config/input/缺项与可用性事实重新复核，仅忽略原服务明确的观察元数据。没有明确人类选择证明，模型文字不成为选定报价、批准或建单事实。复用原结果快检循环三场景，`--test-name-pattern='persisted scene model result'`1 pass/0 fail/0 skip/0 todo（最近组合命令中该例通过），无新增脚本。API类型同前命令退出0，output/scene-run-types.log；diff0。

主线已收到两项精确阻塞：首次run事务激活已修复；model.text.generate/external_unknown的正式转换authority、运行中possible语义及冻结输入/invocation/artifact/计量会计证据仍由主线补交，本线不扩大readonly白名单。CA05人类审批固定依赖、CA06/07配置资料正式提交合同、CA08客户任务/模型身份政策、CA09公共运输/首个快照cursor仍未齐；全部保留unavailable，不称整包完成。未验MySQL、真实HTTP/模型/支付、浏览器、设备与生产。

Runtime替换只替代现有app外的编排，保留原请求/plan/input/lease/结果及批准提交点；Provider替换仅唯一Gateway内部适配，场景输入无SDK专有类型。可关闭本opt-in装配回退，不删除持久材料、不重发unknown。

## CA06 接续：开业诊断持久模型结果读回（20261008）

同一实际AiOriginalSceneResultService现在支持opening_diagnosis，按原请求/模型输入/invocation/artifact复核，并仅重新读取用户明确选择的开业分区。配置版本、分区检查、覆盖与当前权限变化后旧正文不可用；只有各原投影明确的observedAt观察元数据不参加事实变化比较。不制造开业来源重开接口，sources为空；没有配置提案/批准/写入端口，仍未提交、不执行。

复用现有host测试，未新增脚本。`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-name-pattern='persisted scene model result' tests/ai-native-lane-a-original-scene-host.test.cjs`退出0，1 pass/0 fail/0 skip/0 todo（同一案例分别驱动订单与开业实际结果读者）。API类型检查同前命令退出0，audit本树output/opening-result-types.log；数据库/模型记录仍为离线替身，未验实际模型、MySQL、HTTP与生产。主线已提供同租约运行器固定前置，提交本片后再同步消费，不在A树维护runner。

## CA04/09 接续：本次模型来源重开与原事件消费

结果读者现在只从实际持久模型输入的事实中提取最多5个受控order来源；返回来源集合不等于证明模型文字正确，明确标记supplied_sources_only_text_not_validated。`reopenModelSource({original,resultId,sourceIndex})`从该结果自己的集合选来源，拒绝额外URL/字段，调用原 `reopenOrderCitation` 受权读取；等待后再次复验同结果/材料，stale或unknown不能继续打开旧内容。模型场景与任务中心均暴露实际入口，没有新增HTTP地址或公共DTO。

`composeAiTaskCenterScene({list,events,scenes,modelResults})`的readEvents接回现有 `AiTaskEventRepository.readPage`，输入只有原请求及已有字符串after/limit；返回原公共page/reset对象，不创建新cursor、不Number转换、不启动run。缺events依赖明确不可用。聚合详情新增最终身份/原请求/任务revision复验，分页非法参数映射AI_INVALID_INPUT而非直接泄露Zod异常。首个正式快照cursor仍由公共任务快照端口提供，本线不自行发明“安全继续”的游标。

支付事实比较仅排除原支付reader自己的requestId/observedAt，记录ID、金额、状态、coverage及业务时间仍精确比较，避免把不同HTTP观察标识当成支付事实变化。

只扩既有组合冒烟，未新建脚本：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-name-pattern='persisted order model result' tests/ai-native-lane-a-original-scene-host.test.cjs`：1 pass/0 fail/0 skip/0 todo，退出0。实际驱动原请求/模型结果/业务来源/事件仓储及任务中心；包括仅order来源可打开、来源越界/额外URL拒绝、大cursor原样读回、Number cursor拒绝。事务/记录为离线替身，不声称MySQL或实际模型链验收。

API类型命令同前，audit本树output/source-events-types.log，退出0；diff check0。主线回复CA05固定07前置尚需其核验接回，本线不自行宣布当前主线已有。另已报告CA03：本树runner尚无总册同租约createApplication/prepare-start正式宿主入口，请主线提供06固定前置及后续交付；A保留prepareHeldRun，不复制worker或伪造RUNNING。CA03/05/06/07全链仍未完成。下一步优先消费主线固定依赖；未验真实环境全部保留。
