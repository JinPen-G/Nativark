# AI Native：当前协作接续

> 文档状态：当前接续入口，只覆盖最新现场和未完成事项，不追加历史流水。
> 更新时间：2026-10-20。最新功能：`14ae78e4`，前置`142c97f6`、`fae829e3`。后台本人任务中心接原订单/通知提案审阅、人类决定、原决定/业务收据及明确批准后继续；仍由原宿主执行，不造第二运行器。五组代表性stdin（订单决定丢应答、通知决定、订单继续/原结果、通知继续/原结果、后台生命周期）各1/1、0 fail/skip/todo、退出0；订单Core提交丢应答另作相关复验，原键可读且不重复办理。Admin noEmit227 roots/0诊断/退出0；API684 roots/2项原支付WIP诊断/退出1；diff/定向lint退出0，机械UI检测无命中。无新测试脚本或真实环境验证；原28项64.3%、ENTRY48.6%、验收0/28不变，不能称全部收口。
> **负责人已确认全部停写，本会话接回主线。最新优先级：先补核心底座和管理后台，小程序/官网只推进服务端能力与接口预留，暂不开发页面。** 保留接手WIP，不启动A/B、辅助施工或真实服务；按完整功能收口维护本接续/开发记录，正式需求/任务正文WIP不夹带提交，不为目标百分比加分。

## 权威依据

- 产品范围、任务依赖与阶段放行：[正式需求](<AI Native-需求.md>)、[开发任务](<AI Native-开发任务.md>)。新补的目标驱动和场景闭环原则适用，不改原28项及 ENTRY 的分母或既有百分比。
- 已做/剩余、固定功能提交及验证边界只维护在[开发记录](<AI Native-开发记录.md>)。
- 未来设计分别查[Runtime/Provider SDK替换](<未来规划/AI Native-Runtime替换方案.md>)与[通用SaaS底座](<未来规划/AI Native-通用SaaS底座方案.md>)；均不授权当前拆库、拆服务、开源或另造通用平台。
- 原总册、旧派工和历史接任提示词已归档，只供追溯，不能覆盖负责人本轮单线授权。

## 工作树与写入归属

唯一写入树：`D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`。
分支：`ai/ai-native-contracts-s01-20261002`。主线认领公共Gateway/预算、运行器及审批接点；本轮不向辅助树写入或派工，不与其他线双写公共文件。

四条辅助树仍保留在同级目录：`codex-ai-native-lane-a`、`codex-ai-native-lane-b`、`claude-ai-native-lane-a`、`claude-ai-native-lane-b`。负责人确认四线停写，Codex A/B另已确认无在途操作；本次核对均无独有提交、源码WIP或合并状态，按固定主线仅快进同步并保持暂停，不再派工、不删除工作树/output、不复制私有生成物。主线后续提交不会自动同步；恢复辅助线前重新核对实际差异。本次没有合main或推送授权。

开工核对 branch、HEAD、status、index、MERGE_HEAD、CHERRY_PICK_HEAD、未提交归属及写入者。本轮接续时已有10份文档WIP（AI需求/任务、Rental Core任务、界面规范、品类三文档、导航及平台需求/记录）；之后接手支付/Core/客户端/后台/shared及两个支付测试的WIP，负责人确认旧作者停写，全部保留、不夹带。本轮未跨新验收门，不修改任务百分比。AI Native源码按完整功能提交；接手仍须以实际status为准，不能把其他线WIP视为已提交或已验证。未跟踪output、保全副本、旧patch、私有Prisma client及锁继续保留，不清理或附带提交。

## 当前核心接点及下一步

后台配置现沿原API实际装配：租户“服务与渠道→AI服务设置”（`/settings/ai`）复用C07与原Auth/Guard/CAS/Profile，平台模式无需供应商输入，BYOK支持三种已有原生协议；切换保留原加密配置，清密钥同时停用。旧系统配置单独审阅来源版本，只有明确新密钥+disabled替换才保存，不自动导入。平台“平台AI配置”（`/platform/ai`）沿原GET/PUT `/platform/ai/providers/{profileId}`和原operation接口；严格按当前SaaS view/manage分别显示和保存，不给所有SaaS账号自动权限。暂无Profile目录读取端口，需人工输入已知编号；首次配置是明确CAS修订0且停用，不把读取失败当不存在。两端仅sessionStorage保存原操作引用/修订，绝不保存密钥；未知锁住新保存、只核对原收据，收据确认后重新读当前配置。配置保存不会开放预算、能力验证或执行。能力验证/价格/预算及正式后台审批、场景完整消费仍待补，不重复这些设置宿主。

后台任务中心（`/ai/tasks`）复用原Auth/动作政策/owner查询，标准POST `/ai-native/task-center/{list|snapshot|events|result|usage|confirmation|review|decision|decision-receipt|business|continue}`有明确shared/OpenAPI。首次零AI读、无自动轮询。正常完整计量的模型终态与`step.changed`、`task.output_ready`同事务；unknown不发布。正文按原输入及场景reader逐次复核业务事实/知识ACL，过期正文为空，无artifact旁路；快照引用为lookup而非授权。原用量人工分页≤20、非总费用/账单；原确认历史≤2阶段/转换、只读不授继续。新增审阅由服务器从原等待步骤定位提案，展示原报价分项/版本或通知分区差异；同一人类决定仍经原领域权限/权益/CAS，标准服务器新执行配置缺失即拒绝。决定收据离开等待、到期或关新执行后仍按当前权限核对，不能串步骤/主体。明确继续绑定当前checkpoint/任务修订/已审提案和原批准，原订单/通知宿主保留claim/fencing/累计资源/Core检查；预检5秒，实际原运行器不套读取用的5秒总限，HTTP/继续上限120秒且可取消。正文、批准、运行应答、Core原提交分别表示；订单原结果由唯一受权报价选择进入既有结果reader，通知沿原步骤键读取真实收据，均不查最新对象冒充原操作。决定/继续不明时sessionStorage仅存原引用并锁重提，刷新只读原收据；不换ID、不释放预算或重派。切空间/隐藏/撤权清旧显示。来源打开的统一后台消费、连续事件刷新和真实浏览器/HTTP仍缺，不把局部链路称完整工作台验收。

下一步优先可信计数/上界正式生产者、标准模型单账正向执行和剩余恢复窗口，再补后台能力/预算/审批与场景消费；不能用calls换算token、猜计数、恒真权限或默认开关补齐。平台费率与BYOK审阅生产者已存在，不重复开发。全部源码/类型/离线证据不代替shared正常构建、真实MySQL/供应商及浏览器验收；本批未构建dist、迁移或启用。

客户上下文澄清：标准服务器模型DI可显式设置`clarification:true`，选择原`original_client_clarification`来源；默认仍只做原摘要，不自动开启模型或任务政策。只解释同一原task/run/step/frozen input及已测量结果中的固定问题代码，输出原`clarification_text`合同；回答为context_only，不是客户/商品选择、报价确认或建单批准。最多两轮追问且受原政策maxCalls、原材料及五分钟问题期限约束；原输入仓储持久化问题/回答/同键收据，后续run沿原resourceOriginRunId，不清零资源、不覆盖旧输入。关闭新执行或新提问后，原问题读取/回答收据仍走当前独立政策；该读入口不能创建问题/调用模型。客户model/result按持久workflowStatus区分answer/clarification/not_attested，模型单轮成功不等于业务成功；website/wechat的input/submit/receipt/continue与模型control/result已有shared/OpenAPI契约，Controller保留受控停止原因。

达到澄清上限：实际输入仓储在写新问题前确认`input_limit_reached`，运行器返回unavailable/manual_handoff、释放原worker租约，保留已计量步骤/费用，不将全成功步骤伪造为FAILED或把未完成目标报成功。现有任务FSM没有“全部登记步骤成功但目标仍待人工”的独立终态，本片保持原任务非终态，由原取消/人工流程办理，不另造状态；重建按原记录仍停止，不授新额度。COMMIT应答不明仍unknown，不能当明确上限重试。后续须补完整客户当前身份/政策/标准HTTP/单账正向及多轮真实供应商验收，再收口自然语言→明确业务参数/选择→原报价和预约，而非把纯上下文回答当参数选择。可信计数缺正式生产者时保持recorded拒绝，其他合法功能继续；不引入第二计数派发器或猜token。

原确认历史：`PrismaTaskApplication.readConfirmationHistory({taskId,runId,stepId})`已接订单/通知设置宿主；选报价及通知原请求的既有`readConfirmation`在非等待状态返回只读history（通知尚无步骤时为null），等待状态仍走原有效checkpoint，不以历史授权继续。原phase/receipt/plan/人类decision和事件关联复验，最多两阶段/两次转换、两次一致快照；审批到期按原事件时点核验，不因现在到期否认历史，不授新执行。当前read_step_terminal/read_events撤权或串绑定拒绝；缺记录不证明未执行，阶段成功不证明Core业务成功。shared/OpenAPI已有结构，未新注册HTTP/生产驱动。实际Auth、Prisma适配、运行器、人类审批与Core组合的DB/业务事实为替身；通知原请求HTTP消费者只做代码/类型核对，未宣称全宿主或MySQL验收。后续沿原依赖补可信计数/标准执行及剩余恢复窗口，不重复此历史读取或把已关闭执行门改成默认成功。

原任务预算汇总：原`POST /api/ai-native/scene-requests/model/performance`请求可显式增加`includeTaskFinancial:true`，返回可选`taskFinancial`；不传则保持原单页路径。`TaskBudgetUsageReader.summary({taskId})`沿当前Auth/任务动作政策和原Prisma调用/预留绑定，最多51条探测、3页账务和每页一次复验，按原run→task owner范围读取，不新建账本或统计存储。≤50个已登记调用全部观察才给分单位/币种的整数原子汇总；reserved、pending、settled、releasedReservation及settledExcess分开，缺账计数明示，未全部结算/释放时accountingComplete=false。>50返回limit_exceeded/not_computed且无金额；空记录不证明无消耗，完整性仅针对已登记调用，不是供应商账单或派发许可。跨页版本/调用集合变化或撤权拒绝旧汇总。当前仍无大任务全量成本、全局成功/接管率、正式SLO/容量及真实环境证据，AIN-25不据此升75%。

运行器事务接点：步骤start/result、审批checkpoint/resume及任务start/resume/outcome均先绑定原task/run/step、修订与holder，已写回执立即快照并核对事件data、状态/原因、游标、时间及精确新修订。畸形回执为AI_RESULT_UNKNOWN，不再抛普通存储失败或发生空data异常后尝试旧租约清理。Task/Step事务回调完成后的错误即使形似CAS拒绝仍为unknown；已尝试写入的非确定事务错误也保留未知，确定的事务内权限/CAS拒绝不放宽。原快照/事件用于核对，不借观察重新取得执行权。正常订单host已离线驱动暂停→人类审批→原Core提交→同一批资源结算；DB/业务事实是替身，不是MySQL、真实模型或全宿主验收。下一步沿原依赖补可信输入计量生产者与标准Gateway/预算执行、混合恢复及取消边界，不把已收口回执重复开发，也不声称仅剩环境。

运行器工作窗和登记恢复：本次held run计时从进入持有阶段开始，计划/资源准备不再获得免费前缀；每步的取消前检、登记、资源准备、start及effect共用该步剩余时间和本次总工作时间。时间不足不登记/执行新动作，不补1毫秒；已发生结果的原收据、资源结算及租约善后仍保留各自有限等待，不能将工作窗结束当作回滚或无消耗证明。领取前和计划尚未取得时沿既有5秒边界，不宣称全部HTTP墙钟严格等于计划工作时间。持久累计资源门不变，恢复不清零。

原登记适配器先核对command对应的task/registrationRef/holder/CAS，返回后立即快照原结果；新登记必须匹配原step.registered事件、task/run/step/sequence与精确新task/run revision，重放不产生新run revision。读回等待期间生产者修改共享对象不改变原观察。畸形已写回执为AI_RESULT_UNKNOWN；仓储已尝试写入后的不明事务，以及回调完成但COMMIT丢应答，现抛AiStepRegistrationCommitUnknownError，不重试、不报告普通未提交失败、不尝试释放猜测的旧租约。按当前原任务快照/事件及既有登记重放读取核对，不新建收据系统或HTTP。实际离线组合已核对原PENDING步骤和游标可读；混合步骤/全部宿主、真实多进程/宕机仍未验，可信计数及完整标准消费仍待补，不扩大AIN-06验收结论。

预算拒绝观测：Unified仅在原预算`reserve`明确返回`BUDGET_UNAVAILABLE`时调用既有观察者的`budgetDenied`，最多等待1秒、沿宿主取消；失败保留原拒绝，不转换为成功、退额或重试。标准运营/员工、客户与能力探测沿已有`PrismaTaskGatewayAudit`实例接入，未覆盖的自定义观察者不补造记录。生产者复核当前身份、原task/invocation/configuration/registration、领取token及有效期；原预留或会计收据存在时不制造“干净拒绝”依据。只向原OperationLog追加ID/hash和固定代码，同键同载荷可观察、COMMIT应答不明不重写。`TaskPerformanceReader.budgetAdmission`仅返回当前owner的50调用窗口中已记录拒绝，读后复验；没有记录不等于准入成功，拒绝不是未消耗证明，不计算完整拒绝率或SLO。资金/调用账本未新增写入，未注册新HTTP或启用配置。下一步仍补可信计数生产和标准全链，不以此片宣称AIN-25已到75%。

原账成本与恢复：`TaskBudgetUsageReader.read`的可选`pageAmounts`由原`PrismaBudgetRepository`读取，现有`TaskPerformanceReader.financial`直接消费；按money币种及tokens/calls分别汇聚reserved/pending/settled/releasedReservation/settledExcess的整数原子字符串。此字段仍仅本页，跨页汇总另见上述显式taskFinancial；二者都不是退款额或供应商账单。缺记录不补零、过期unknown仍占用、超额实耗不截断；原账版本变化或新出现占用拒绝旧页。仓储按真实计量列、状态与精度读回，非法/缺额/混合单位拒绝。下一步仍需大任务成本、完整标准全链及SLO，不以局部观察提升AIN-25。

`BudgetService.release`允许当前正式权限下观察已释放的同一原eventKey，仓储必须存在同载荷原事件；新键、unknown/已派发释放仍拒绝，不再退额或授派发。`mutate`各生命周期写及同键读取遇COMMIT应答丢失统一待核对、不自动重试；原占用与账本仍同事务，提交前与重放返回前复验当前授权。重建服务可读原结果，不凭异常认定回滚。本片沿实际Auth/订阅/任务预算授权、Service和Prisma仓储，DB/锁/事务及派发证据是受控替身，不是MySQL或外部调用验收。

预算管理与历史观察：显式服务端`AI_NATIVE_BUDGET_MANAGEMENT_CONFIGURATION`接`{enabled:true,platformProfileId,priceVersion}`，无需同时开放订单模型执行；显式false优先，未提供时兼容原执行配置，无配置仍默认关闭。它不播种政策、不授权预留或派发。标准`pricing/{price|publication|input-bound}`已接原Controller与只读provider；前两者按当前经营空间管理权读取，input-bound另核对原调用owner并从持久invocation取得scene，不接客户端scene或计数声明。历史到期/Profile停用不阻断原依据读取。5秒依赖/15秒HTTP边界及断线关闭当前凭据，迟到结果不交付；撤权映射为access denied。平台审阅、租户采用和BYOK原服务继续复用，无新账本/供应商请求。本批仅离线实际Auth/Guard/Controller/仓储适配及事务替身，不是标准HTTP监听、MySQL或完整模型验收。

用量计价：Responses、Messages及Chat Completions的invoke/stream保留缓存读写计数，已包含在inputTokens内，不重复相加；原`usageDetails`与总量/hash原子保存，重放同明细，旧NULL不反推历史缓存。平台/BYOK money审阅可明确提供`inputCache.readPerMillion/writePerMillion`，两项同时提供、六位精度且可显式为零；预留对可信总输入上界采用三种已审阅输入费率的最大值，结算按普通/缓存读/缓存写互斥数量与输出费率BigInt合计后一次向上取微单位。实际超额如实计入；缺缓存费率仍待核对，不猜折扣、命中率或不同缓存期限的供应商成本。tokens/calls及公开C03总量不变。这是预算费率，不是供应商账单认证。追加迁移`20261019100000_ai_gateway_usage_billing_details`尚未执行。下一实质缺口：原`GatewayPricingRecordManagement.publishInputBound`已有消费者但无实际可信计数生产者；需绑定同一冻结输入/工具schema/配置、受控计数请求与持久收据，不能另发未计量HTTP、用字符数或用户填写上界代替认证。本片离线组合的上界为合成证据，不授生产money准入。

计价生产：标准预算Controller/provider保留BYOK的`pricing/{review|review/receipt}`，新增平台`platform/pricing/{review|review/receipt}`及租户`pricing/platform/{adopt|receipt}`（均POST，前缀`/api/ai-native/budget-settings/`）。平台发布沿真实SaaS身份与`system:ai-provider:manage`，历史读取沿`view`；租户采用沿当前Auth/Guard/ALS及原设置权限，不得改平台费率或借用其他场景。服务器选择Profile、模型/协议/凭据引用；人类审阅tokens口径或六位money费率/币种/版本/有效期不认证token数、不开放预算。平台锁Profile后复验版本与当前权限，审阅与价格同一不可变行，原价格reader兼容旧记录并保留完整payloadHash。租户只采用同一原价的受权投影，沿原仓储/财务账本；原采用后继续复核当前权限，跨空间或读取期间撤权拒绝。BYOK仍锁租户配置再锁Profile，与原OperationLog收据同事务追加。同键异载荷冲突，写应答不明保持unknown，只读原operationKey/priceId收据，不能另换版本重试；配置改版、停用、切模式或到期不重授新采用，但原收据可按当前权限读取。输出不含凭据/平台审阅人，明确人类审阅预算费率非供应商账单、非输入计数或派发许可。标准宿主显式配置仍默认关闭；可信计数/输入上界生产者及完整执行验收仍缺，不能凭recorded启用money准入。官方Responses计数规范已核对，尚未另建计数HTTP旁路。

运行观测：`POST /api/ai-native/scene-requests/model/performance`接原观察provider，输入为原请求引用与usageLimit/usageAfter；不接受scope/actor或任意工具。`TaskPerformanceReader`复用当前任务动作政策和原账，读后复验身份、task修订/eventCursor、运行/步骤、资源、调用及审计。上限50运行/200步骤/20账务/50调用，截断不冒充全量，BigInt字符串精确展示、unknown占用不归零。步骤`activeTime`来自原ACTIVE_MS charge，仅未知时实值null，不是供应商时延。原运营/员工及客户Gateway显式组合现接`PrismaTaskGatewayAudit.record`，同一OperationLog保留唯一调用/预留/配置/价格/派发hash与单调时钟采样，不存正文或原token。`modelDelivery`仅展示有原派发绑定的完成观察；传输墙钟含usage收据/权限复验及流消费者等待，非纯Provider耗时。首个非空、复验后的文本片段有服务端计时；invoke无逐片依据为null，未观测不补0；不把片段当token数或端侧首屏。写应答不明保持原账unknown，不重发、重写或退额；按原审计和账务核对。当前无首次页面卡片/端侧首字证据、完整工具墙钟、成功/接管率、SLO/容量/公平性/告警与真实演练，标准原请求全链仍待核实，AIN-25不升75%。

隐私维护现有cleanup/receipt/receipts沿标准provider；清理最多30秒等待，收据依赖5秒，断线关闭本次身份凭据，迟到读取不得进入下一项删除。清理可能已提交保持unknown并列原收据，读取中断仅unavailable；没有新增定时器、真实删除或存储访问。外部副本、真实删除传播和备份验收仍缺，不以HTTP收口宣称隐私全完成。

知识消费现有四个标准POST入口：`/api/ai-native/knowledge-consumption/{documents/read|sources/read|memories/read|preferences/read}`，请求工厂为`AI_NATIVE_KNOWLEDGE_CONSUMPTION_PROVIDER`。当前仅运营人类入口，沿原`system:params:manage`门，再逐资源核对持久动作政策；无政策仍拒绝，管理员权限不自动授予正文或偏好。当前确认记录/版本/空间复验、撤回后禁用、来源定位沿原服务；无模型调用、任务创建、下载URL或自动授权。HTTP最长15秒、依赖5秒，取消只停止本次读取，不宣称数据删除。下一步继续正式内容来源及文件/删除传播、可信价格/计数与标准执行的完整组合；本片已验证已解析合成内容和确认生命周期，不代表对象存储或真实环境已验。

预算仓储现用原三层政策锁下的 `AiBudgetReservation.groupBy/count`，不再全量载入政策历史；新预留必须含适用的全部层级/场景，不能由quote漏层。派发/结算/释放/unknown/reconcile沿原allocation取得相同固定顺序锁；新标记派发另核对原政策修订、当前门/白名单及有效期CAS，预算标记不是供应商派发许可。旧账依当前独立权限/证据收敛，不要求新执行门仍开。两项本批Service/Prisma仓储stdin先0/2、修后2/2；数据库聚合/事务为替身，旧通用夹具尚无groupBy/count，未跑全回归或MySQL实锁。下一步仍需正式费率与可信计数/输入上界生产者、完整执行消费；不能用模型名、字符数或估计价格补成已验。

当前新增经营入口：`AI_NATIVE_ORIGINAL_REQUEST_PROVIDER`的`queryOrders`和`POST /api/ai-native/scene-requests/order-candidates/read`，复用当前Guard/ALS及Core分页仓储，最多20条，只读最少订单字段与同订单版本来源。时间范围是租期重叠，不是今日新增/待取还统计；不返回客户隐私或资金，不新增模型工具、任务、派发或库存预占。选中后沿原订单解释原请求入口重新受权，不能把候选版本当授权。

原请求`create/reissue/createTask`及读取/材料/核对/恢复准备复用现有5秒依赖边界；标准Controller接断线、15秒外层等待、命令/认证快照及no-store，原HTTP状态未改。中断关闭本次凭据，迟到依赖不进入后续动作；写入可能已提交时保持unknown，仅原requestKey/inputRef核对。此限制不施加到实际runner的正常运行，不授重试、退额或换ID权。其他执行/观察宿主仍按既有边界独立核查，不声称所有入口只剩真环境。

负责人最新选择：现在自己实现两种主流协议，不安装pi-ai，不切换Harness。`native-model-protocols.ts`列出三种已实现协议，原服务端配置选择具体协议；工厂注册不是能力证明。平台/BYOK、标准后台/员工/客户与原能力探测均消费相同适配器，当前权限、能力收据和单账门继续生效。新协议文本/流式、既有受控工具和闭合结构化输出已作离线冒烟；图像编码仍待完整媒体验证，Messages/Responses不支持本实现的WAV audio，先于能力派发拒绝。下一步继续正式计价/计数来源及原任务依赖，不因协议已实现猜价格或开放真实模型。未来Harness只在正式替换适配阶段进入，专有类型不得扩散到业务层，原unknown不重发。

继续原 AIN-03/04/05/06/07/11 依赖，不以界面或空包装代替核心。当前场景交付矩阵与剩余实施缺口见[开发记录](<AI Native-开发记录.md>)；优先补可信价格/计数生产与完整标准执行依赖、其他输入格式/规模下的来源关系及真实删除传播，不以正确拒绝算正向交付。

运行器当前边界：确认resume后的原修订/decision/租约先快照再复核；读回任务或状态变化不进入继续。新领取必须是请求CAS的同task/run/holder和精确新revision/fence。任何已尝试持久写入的畸形回执保留unknown，不释放旧租约、重消批准或换操作重试；原任务/步骤/审批收据仍为恢复依据，不另造状态机。还需混合步骤、全宿主以及真实多进程/宕机验收，不能把本片防护算全部运行器只剩环境。

客户原任务当前消费：历史答复使用原持久 `receiptReader`，已释放输入等待使用原取消见证；从未启动取消需当前独立取消授权及原任务锁事务的无副作用证明。三项新增取消方法已进入标准web/微信应用与公开契约，未知只读原修订事件，不重发、不释放原未知预算。仍需混合步骤/全部澄清变体及真实客户宿主验收。模型ID、Base URL和协议由平台/租户受权配置；未指定具体模型不是后续开发前置，money缺可信费率/计数时仍拒绝，不猜价或硬编码模型。

**当前收口结果：** AIN-19/21沿原G3登记75%，AIN-25本轮G1/G2为50%；原28项等权64.3%、正式验收0/28，不代表全部功能只剩验收。`AI_NATIVE_STAFF_MANUAL_CONFIGURATION`只开放原人工检查草稿/提交，不开放识别；停用后原操作/提交收据仍受权可读。`AI_NATIVE_CATEGORY_DRAFT_CONFIGURATION`只开放原治理草稿/校验，仍受原平台预览门和权限限制，没有发布/采用旁路。任务中心标准scene观察已接原报价批准/订单收据及通知设置等待/结果，不因刷新重启run；原Controller通过ModuleRef延迟取原实例，避免Nest把Controller误当provider。

**下一缺口（先核实实际实现，不重造）：** 通知设置“prepare新变更→create新任务→当前政策CAS→start-original发布→等待→真人批准→原Core提交/收据”已用实际服务离线贯通，不再列为未实现；其余配置分区/普通资料写入消费者、标准报价原请求→显式选择整链仍待补齐或复验。原PNG/WAV宿主至单账派发/计量已有离线正向，标准员工HTTP至真实对象/模型及完整草稿应用仍待核验；客户标准原材料→任务→原计划/runner→Gateway→三层calls→结算/原结果和独立原账核对已贯通离线，尚需可信计价生产、正式模型澄清来源与企业资格；本次闭合文本计划不冒充完整多轮澄清。品类仍缺高风险发布/资格/采用的确认消费；安全保留仍缺外部副本/真实删除传播及集中独立验收。AIN-25～28不能靠现有资源限额或局部冒烟抬分。原报价/设置/主动事件执行配置继续独立，当前授权、原输入/计划、人类批准和单账预算不省略；unknown仅原键核对，不换ID/Provider重试。

**当前可接入口：** 员工`AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION`显式选择image及可选audio的profile/calls版本、host/limits；原文件ObjectReader、inspection-tasks、inspection-task-policies和结果保存桥均已接AppModule，人工检查门不随之自动开放。客户`AI_NATIVE_CLIENT_MODEL_CONFIGURATION`明确提供pricing/prompt/output/limits/host，web/微信共用原文本Gateway；`AI_NATIVE_CLIENT_POLICY_CONFIGURATION`另行开放`/api/ai-native/client-task-policies`的原政策read/change/operation及model-plan CAS，固定quote_clarification场景，不播种政策。两种管理/执行开关不互相授权。原结果读取不需要模型开放；客户original_client输入源只接受同一冻结输入、单步骤计划及已完整计量的原文本结果，拒绝未知结果、工具动作和自造答案。当前范围/字段及GenericObject合同缺口见源码与开发记录，不另建Runtime/SDK协议。 客户web/微信另接`orders/material/{prepare|receipt}`、`tasks/{create|creation/read}`及`tasks/accounting/{read|reconcile}`；原账按当前本人/原调用及可信用量收敛，不要求模型仍开启，不暴露内部计价/配置，不授新派发。

**本批证据：** 失效草稿元数据/取消、两轮澄清及原回答收据、从未启动取消、释放的输入等待取消，四组stdin各1/1、0 fail/skip/todo、退出0，不与前序批次相加称全量。API669 roots/0诊断、diff退出0；无新测试文件、构建、迁移或服务。沿原双offline preload、固定无效DATABASE_URL和本树绝对审计/TEMP运行；`output/core-staff-original-lifecycle-20261019/`保留旧实现阻塞复现及夹具修正。Auth/Guard/订阅、runner/Gateway/Prisma仓储与Controller为实际实现；DB、能力历史、协议和对象流为替身，不是HTTP/真库锁、真实计价/存储/供应商/设备验收。原28项62.5%、整项验收0/28不变。

**员工善后入口：** `inspection-tasks/accounting/{read|reconcile}`继续按当前同员工任务政策及原invocation/dispatch/usage收敛，不依赖新识别配置/文件/profile/lease。`c5dfe92c`让`creation/read`、取消和原收据只核对当前订单读权、原草稿关联及原任务输入，不因草稿过期/修改/附件移除消失；原草稿关联缺失仍拒绝，不读附件或表单正文。`0279dfe5`让`input/receipt`精确核对原问题、回答键/内容指纹、计划及原run，停用后可读但不继续执行。`53df5cec`/`91ec248c`提供`cancel/settle-unstarted`、`cancel/settle-released-input`和`cancel/settlement/receipt`：只有原事务证明无执行证据，或原模型结果及四种资源全部计量且执行槽已释放时才关闭任务；重复复用原事件，未知/运行中/未计量拒绝，不退额、不回滚业务。候选正文的`inspection-assist/result-read`及保存/采用仍需有效原附件/草稿绑定；这些历史载荷、其他恢复窗口及全端失效处理尚未齐，不能说只剩环境。新启动/恢复、保存和人工提交保持各自原门。

**本轮验证边界：** 员工人工链、品类原治理链（含内存Nest DI）、设置等待聚合、报价原订单结果聚合、通知新变更至原任务审批执行，五个不同场景各1/1、0 fail/skip/todo、退出0，不与旧批次/复验相加。API源码664 roots/0诊断、diff退出0；日志`output/core-consumer-closure-20261018/`保留首轮失败，未新增测试文件，未加载正式AppModule、监听端口或改变共享产物。DB、Core数据/检查提交/设置存储和候选为替身，报价采用受控monotonic，仅验证原资源门未放宽。旧事件组合0/1、旧宿主1 pass/1 fail及旧shared JS缺schema仍是历史失败，本轮未重跑、不算通过。新配置收据迁移只完成前序隔离generate/validate/diff，未执行；真实MySQL、供应商/存储及浏览器/微信设备未验。

AIN-01已复核原15项目录与实际消费者，补齐当前实现/原业务入口/仅候选/缺依赖的区分；四品类原报价与确认、实际目录消费者及归档证据链接已用现有入口快检。当前按原G3将AIN-01/05/11更新为75%，整项验收仍0/28，不改分母或门槛。AIN-01尚缺完整人工流程/指标及目标环境版本；本轮补上`rental.change.preview`中的续租预览：`business-tools.orderExtensionPreview(orderId).read`及原`next_steps`请求的`previewOrderExtension`→标准同名POST入口。订单由原请求绑定，原view及extend/operate权限、订单版本、服务地点和读后身份均复验；只复用原Core试算，不保存/批准/执行，也未登记自动模型工具。其他变更类型、完整响应协议及真实HTTP/四品类全范围仍未验。其他任务具备门槛证据再更新，不批量估分。

配置标准入口支持租户双轨read/save与平台Profile读写，复用原C07/CAS/Profile/Vault。租户及平台后台表单与原键收据核对现已消费，具体入口见本节顶部；`POST /api/ai-native/model-settings/operation`及平台`GET /api/platform/ai/providers/{profileId}/operations/{operationKey}`只返回当前原主体的安全保存结果，异载荷/跨主体拒绝。`POST /api/ai-native/model-settings/legacy`仅审阅原来源/版本，显式替换需原版本、operationKey、全新密钥和disabled，原记录保留，不自动导入或认证能力。不支持旧协议仍拒绝。`20261018090000_ai_tenant_service_gate`及`20261018100000_ai_model_configuration_operations`未执行；真实升级/并发、旧客户端无原键的保存恢复及后台浏览器验收仍未齐，不把当前修订补造成原收据。

知识/记忆标准管理已接回原实现：`e46b4c76`注册`HumanMemoryManagementController`和`KnowledgePolicyManagementController`，`2784aedd`注册`HumanKnowledgeManagementController`，均为当前人类操作。记忆提议/确认/撤回、政策prepare/commit/原operation及文件上传/创建/解析/发布/撤回沿原仓储、正式政策和原文件集成；新增`index/{read|request|resume|operation-read}`复用原词法索引协调器/收据，不启动worker。取消及5秒等待关闭本次凭据，未知写入只核对原操作。缺正式管理authority或动作政策仍不可用，不播种授权。AIN-03已按标准持久消费者与实际仓储冒烟跨G3为75%，真实迁移/并发及完整升级回退仍未验；其余百分比不因入口数量变化。BYOK配置→租户/场景预算首次初始化→配置变更后显式重绑定，已用标准预算provider/controller及真实Auth/Guard/订阅/仓储实现跑通离线正向；旧unknown债务/占用不归零，重绑定关闭本层执行门，未提供服务器配置仍拒绝。该结果不证明平台模式、tokens/money或模型派发全链。下一步继续可信价格/计数生产、完整标准执行、知识authority配置/正式内容消费及真实删除传播，不重复造已接回的管理服务或索引器。

`d93b866b`将平台配置观察单独复验`system:ai-provider:view`，保存仍要求manage；只读SaaS角色不借用写权限，租户角色仍拒绝。知识政策中断按原target/preparation/operation分别指引；撤回记忆同意后只读当前状态，不冒称存在delete操作收据。`cae1b0d7`补`uploads/original`与`uploads/revision/original`：首次应答丢失、没有sessionId时仍可按原文档/版本键和完整原请求观察原上传，复验当前metadata读权、存储actor/workspace及原文件/修订绑定；过期不抹掉原意图、另一主体不返回存在性。观察不访问存储、不签发地址、不重传；未找到仍unknown，上传意图不是文档创建/修订收据。完整外部存储、正式authority配置及删除传播仍未验，不以此宣称全部知识生命周期完成。

`ebd5d479`将原能力验证的17个shared路径与`AI_NATIVE_CAPABILITY_PROBE_PROVIDER`接回标准AppModule；另需服务器`AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION`显式提供profile、scene/price版本、host、能力白名单及政策TTL。标准根没有该值，默认关闭且组装零读写；订单执行配置不会顺带开放付费probe。原计划管理provider按独立配置只开放对应固定scene/tool，人类按CAS配置政策，无自动种子。请求沿原Auth/Guard/ALS、原输入→task→runner→唯一Gateway/预算→能力收据，mock结果不变成live认证。当前已验标准准备/政策/读取和既有mock完整生命周期，真实模型/全部能力及标准传输完整链未验；配置保存现有正式入口但不替代这些依赖。未来首选Harness的调整仅属未来方案，不启动接入。

`500c839d`已把同一持久订单链接入AppModule的原控制器及17个既有契约路径，复用`composeRequestBoundPersistedOriginalOrderRead`，没有第二运行器或账本。可信服务器DI token `AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION`需明确提供enabled、platformProfileId、maxOutputTokens、pricing、host及includeKnowledge；标准根未提供它，全部执行方法默认不可用，不创建政策或发模型请求。原独立观察provider不随新执行开关关闭。启用配置不是授权，原当前身份/动作及计划政策、能力/连接/Vault、权益与预算仍逐调用校验。OpenAPI暂用GenericObject表达多态结果，不能称完整响应协议已冻结。`91631362`进一步将启动/恢复/准备恢复/接管的只读预检设为5秒有界等待，取消立即关闭本次凭据，迟到compose不进入consume；不把此5秒限额施加于后续正常运行，不推断回滚/退额。下一步仍是可信政策/计价生产依赖及完整正向标准消费者；未启动服务或开放调用。

`b09b0215`已让清理消费原冻结输入的知识/偏好/媒体引用，核查原输入指纹、原请求和空间；仅实际引用的未决任务保留对应来源，不重新打开已撤回正文。每类最多核查50条、50个任务及每任务50份模型输入，超限/旧格式/孤立账务关联仍unavailable，不把页内未出现当无引用；当前不代表全格式或生产规模删除完成。`2aaaa910`将原账务read/releaseUnsent/reconcile整个请求含前置Auth/DB等待设为有界，取消/期限后关闭本次凭据，迟到compose不继续消费；可能写入不明仍unknown、不重试。

**可信计价的精确剩余：** 平台人类审阅费率发布/租户采用及租户BYOK费率生产已实现，复用原`AiGatewayPriceRecord`；它们不是供应商账单校验。`GatewayPricingEvidenceSource.readInputBound`仍需认证tokenizer或经过原受控通道的供应商计数收据，绑定原invocation/registrationHash/intentHash/configurationHash/priceHash；`PrismaPlatformReviewedPriceSource.readInputBound`仍明确UNAVAILABLE。当前没有完整正式计数生产者，不以字符估算、用户自报上界、当前价或合成种子替代，也不因此开放recorded调用。后续补同一受控Gateway内的合法计数/计量接点，不重复费率管理、不新建未计量的计数派发器；真实计数/外部访问须另获授权。

原预算标准设置、首次配置与显式重绑定已复验离线正向，沿同一可信服务器DI配置默认关闭；初始化/重绑定只消费正式当前配置、保留旧债务并关闭本层政策门，不自动开额度、派发或建立第二账本。当前平台/租户Guard和CAS不省略，写应答不明只读原政策；未释放/已计量占用不能换成不同单位或币种，不经停用/未配置清零，不自动换汇。平台模式、tokens/money首次配置的完整组合、真实费率/计数与模型执行仍待核实，不再重复列租户BYOK首次配置为完全未验。

标准计划政策入口现在同时承接固定报价/开业准备工具；订单模型、能力probe、通知设置写工具与报价建单工具各需独立服务器配置才成为可选政策项。任务动作政策默认仍限三项读操作；订单只读执行与quote_clarification建单/批准操作的模板按原持久场景分开，不能以order:view模板取得建单许可。人类还须同主体当前管理权及业务权限、真实CAS和审计，任务创建不播种政策，政策配置不是真人批准或财务准入。现有OpenAPI部分响应仍GenericObject草案，不称全部协议冻结；真实费率/计数与完整标准模型链仍缺可信生产依赖。

原生协议→Routed→Unified→原财务收据现先保留已核验usage，再进行文本交付复验、观察和当前授权下的结算；中断/写应答不明不自动重写或重发。旧预算组合若缺`recordUsage`现先拒绝，宿主须使用同一`PersistentGatewayBudget`，不能再建账本。任务/原请求/客户材料按真实关联核查清理；无法核验的来源仍明确`source_task_binding_unavailable`。原生流只合并同一有界网络块已验证片段，每个实际交付块仍复核，不用定时权限缓存。以下既有接点继续复用：

1. **持久计价与标准执行装配。** 原任务Gateway支持服务端选择recorded或calls，未配置不回退。`composePersistedTaskGateway`及原场景/员工持久模型宿主现可由服务器显式指定`gateway.nativeProtocol:'openai_chat_completions'`，复用原有界/出网校验传输和受控订单工具协议；与adapters互斥，二者皆缺仍拒绝，不因省字段启用。配置、Vault、当前身份、能力收据和单账门仍逐调用复核；本地协议缺功能时先拒绝，不能以远端能力证据顶替。本原生选项不附带任意structured output schema，须另供正式适配器。默认审计接原OperationLog，绑定当前主体/原task/run/step/call、预留和dispatch关联，只留必要ID/hash，不存正文、密钥或原dispatch token。客户`createGateway/createPersistedGateway`现显式选择calls或recorded（tokens/money），已接回`client-request.application`原消费者；旧`createCallGateway/createPersistedCallGateway`保持兼容，混用参数、缺计价和recorded搭配vision均拒绝。这些客户入口及`composeAuthorizedPersistedTextProbeWorkflow`复用该审计生产者，缺日志仓储仍拒绝。审计COMMIT应答不明不重写、不据此派发，不代表标准应用执行放行。计价历史及发布收据仍可独立于生产器读取；显式`registerHttpPricingHistory`默认关闭。下一步仍需真实费率/可信token上界生产者、已发布能力及标准完整执行依赖；原生协议支持或calls调用计数不等于真实供应商/成本已验真。
2. **中断与结果收敛。** 原请求/模型订单、选报价、审批及能力验证已接有界等待和原runner恢复，领取丢应答不凭重读授执行权，证据发布超时仍unknown。原请求→模型→受权订单事实→回答现有正式输入证据来源，不再强制宿主补一个not_required替身：复核原计划、输入、完成步骤、用量/财务关联和固定工具候选，回答还复核订单快照。历史回答现按不可变原请求的执行时授权指纹核对证据，并复验当前结果读权限与事实；原输入过期/停新执行不单独阻断已完成回答观察，原记录撤销、串绑定或当前撤权仍拒绝，不授继续派发权。入口沿`composeRequestBoundPersistedOriginalSceneModel`的服务端`orderReadChain:{enabled:true,answerRoundTrip:true}`，可省inputSource，仍未注册生产执行。未知/串绑定/事实变化拒绝推进；该封闭链不承担自由澄清，报价多轮仍走原澄清源。已存计划/指纹/累计额度不改，maxSteps与原calls门分别限制，超时不补1毫秒强行启动。下一步仍核对完整可信执行装配及各中断窗口，不把定向组合当运行器、真实财务预算或供应商整项验收。
3. **原账恢复与宿主。** `29cbc608`将既有原订单账务控制器和`AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER`接入标准AppModule，提供`POST /api/ai-native/scene-requests/accounting/{read|release-unsent|reconcile}`，只收original/callId。它独立于新执行DI配置，按当前主体、原订单/任务动作政策、同一调用和持久dispatch/usage证据处理原账；不能预留、派发、改业务资金或无证据退款。标准原订单执行的17个路径已补全局Guard精确匹配，GET/未知后缀仍拒绝，入口权限不替代任务政策或派发权。能力验证的`TextCapabilityProbeModule.registerHttp`原账及其他场景仍须各自显式装配；客户`composeClientTaskAccountingRecovery`继续复用当前客户政策及原任务，同账处理calls/tokens/money，停新执行不抹掉原用量。结算按原调用价格版本，不用当前价格覆盖；撤回新用量权益与当前善后授权分离，权益目录/主体/证据缺失仍拒绝，已派发缺usage保持unknown。未完成的是标准原请求至真实账务的正向全链、tokens/money及各提交故障窗和员工/客户正式运输入口；本轮只有入口/拒绝及原账仓储分层冒烟，不把分层证据冒充完整结算验收。
4. **标准观察与剩余原任务。** 标准`AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER`已接`POST /api/ai-native/scene-requests/model/{scene|input|result|source}`：聚合原任务/快照与指定模型结果，读取当前澄清或明确null；源自原计划/步骤/结果、当前业务候选与权限，变化后拒绝旧问题。问题来源复用原执行宿主逻辑，但观察不构造Gateway、不授lease/提交/继续执行权，也不把旧问题标签直接当当前可用。原知识政策/版本与人类确认仍复验，缺依赖不丢来源露文本。新增scene/input读取使用原有限等待；只读仓储不发FOR UPDATE语句，执行及取消事务锁保持原样。标准政策仍仅原订单解释；报价正向澄清由显式服务端组合消费，不默认开放报价模型执行。下一步仍是完整可信执行宿主、AIN-06/07其余中断窗口、真实文件ACL/保留删除传播；真实费率/计数生产者未交付，不将这些代码缺口混称为仅剩部署。

上文历史接点中的“未注册生产执行”指未提供启用配置、未开放真实运行；标准默认关闭的执行注册现已补齐，不应再重复造宿主。原审查不能据此整体结项。继续核对未接可信生产依赖和标准消费者；未知结果、缺正式来源和未验环境分别保留。不启动服务、Worker、Cron、真实模型调用或辅助开发线。

## 验证与交接边界

- 本轮配置、平台管理、记忆/政策和知识文件/索引消费者的最终定向冒烟均退出0，API663 roots/0诊断，diff退出0，无新增测试脚本。首轮夹具/类型/无效验证命令及修复证据均保留，具体分阶段数量/命令见开发记录；标准知识索引冒烟使用合成已解析版本，未访问对象存储。Prisma隔离生成/validate/diff退出0且共享产物未变，未执行迁移。不得称全量或真实环境通过；既有失败仍保留。继续功能，不为报告新增全矩阵或测试文件。

- 最新预算设置stdin组合2/2（实际Auth/Guard、BudgetService/Prisma仓储，含平台首次保存、租户变更、zero/not_configured、CAS、旧COMMIT读回、跨单位/币种拒绝及断线），同单位正常预留/历史混合拒绝仓储冒烟1/1；既有C03仅选微金额写回1/1。API660 roots/0诊断、diff退出0。混合计量红测、首轮缺profile/表夹具及Prisma allocation无id字段的类型失败均保留并修正；未放宽校验。日志`output/core-budget-settings-20261018/`，无新增测试文件/迁移/生成。DB为串行事务替身、Profile和权益为合成种子，预留仓储冒烟的报价/复验端口为替身，不代表真实供应商价格、真库锁或完整标准派发验收。

- 最新`1149deac`：业务/订单读取故障分类先各留1 fail，修后合并冒烟2/2；包含真实Auth/Guard下正常读取、业务503不误报权限、嵌套权限/空间错误及并发撤权仍拒绝，报价R1的原unknown路径保持独立。标准原请求→Core订单状态→不可变输入→排队任务→显式同主体claim_run政策→原请求读取/换空间拒绝，stdin冒烟1/1。API660 roots/0诊断及diff退出0，未新增测试文件。Core/Auth/Guard及仓储实现真实，DB/订单数据为离线替身，其他业务源为拒绝调用的哨兵；没有供应商派发或真实数据库。
- 前片已定向核对标准计划政策保存/启停/CAS/事务审计/撤权、17个精确原订单路径与未知路径拒绝、原账宿主默认执行关闭及caller usage拒绝；原账仓储重建和幂等仅选既有用例验证。原用量先行留存、原冻结来源保留及原账等待证据沿开发记录追溯，不将不同阶段计数相加称最新全量通过。
- 旧原请求夹具的具体阻塞已确认：`lane-a-business-consumption.cjs`的吸收式配置store不提供正式持久分页端口，初始化报价候选时Core拒绝，不能退回全量目录。现已修正该运行故障被误报FORBIDDEN的产品错误，未补造夹具分页或宣称这套旧夹具已通过。本轮标准订单状态准备验证不依赖该无关报价初始化；旧红测/无效day枚举及一次stdin同名声明失败均保留。既有知识输入组合仍3 pass/1 fail（缺assertBound创建断言与既有受权元数据语义不一致），全局静态门此前失败未重跑，不删除断言或伪报全绿。
- 本轮日志沿`output/core-business-faults-20261018/`；前片在`output/core-policy-management-20261018/`及`output/core-usage-receipt-20261018/`。完整标准原请求→真实路由/预算/派发/结果及账务收敛、真实费率/认证计数源、MySQL锁与故障、供应商/存储/浏览器/微信仍未验或缺可信生产依赖；不是仅剩部署。百分比未跨原验收门槛，不调整。

## 操作边界

不读.env、不安装、不启服务、不访问真实HTTP/DB/DNS/模型/支付/对象存储、不迁移、不改共享生成物、不写其他树/main、不推送或部署。未来替换与抽离不是当前功能前置。

Node沿用本树 `tests/fixtures/ai-native/prisma-offline-preload.cjs`，固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`；审计、写入根、TEMP/TMP及缓存均指向本树。Prisma仅走已有隔离方案，不删锁或复制别树产物绕过。

负责人暂停或移交时立即停止相关写入；恢复辅助线须另行确认归属、独有成果和固定同步依赖。每个完整功能提交后覆盖本文的当前事项和下一步，不在此积累已完成历史。
