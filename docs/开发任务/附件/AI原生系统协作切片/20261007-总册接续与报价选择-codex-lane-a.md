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
