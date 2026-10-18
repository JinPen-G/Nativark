# AI Native：当前协作接续

> 文档状态：当前接续入口，只覆盖最新现场和未完成事项，不追加历史流水。
> 更新时间：2026-10-18。最近核心功能：标准持久能力验证链及AIN-01基线收口；模型执行仍默认关闭。固定提交与证据见开发记录，开工以实际Git现场为准，不将SHA作为回退目标。
> **负责人已确认全部停写，本会话接回主线核心源码开发。** 保留接手时未提交文档成果；维护本接续/开发记录，本轮按负责人要求仅另外更新任务百分比与其核对日期，不夹带其他既有正文，不启动A/B、辅助施工或真实服务。

## 权威依据

- 产品范围、任务依赖与阶段放行：[正式需求](<AI Native-需求.md>)、[开发任务](<AI Native-开发任务.md>)。新补的目标驱动和场景闭环原则适用，不改原28项及 ENTRY 的分母或既有百分比。
- 已做/剩余、固定功能提交及验证边界只维护在[开发记录](<AI Native-开发记录.md>)。
- 未来设计分别查[Runtime/Provider SDK替换](<未来规划/AI Native-Runtime替换方案.md>)与[通用SaaS底座](<未来规划/AI Native-通用SaaS底座方案.md>)；均不授权当前拆库、拆服务、开源或另造通用平台。
- 原总册、旧派工和历史接任提示词已归档，只供追溯，不能覆盖负责人本轮单线授权。

## 工作树与写入归属

唯一写入树：`D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`。
分支：`ai/ai-native-contracts-s01-20261002`。主线认领公共Gateway/预算、运行器及审批接点；本轮不向辅助树写入或派工，不与其他线双写公共文件。

四条辅助树仍保留在同级目录：`codex-ai-native-lane-a`、`codex-ai-native-lane-b`、`claude-ai-native-lane-a`、`claude-ai-native-lane-b`。上次交接已实际同步四树到`71dbdd65`，当时均干净且与主线差异0/0；本轮主线已有新提交，辅助树未再同步，不宣称它们仍与最新主线一致。不复制私有生成物。本地main仍为`46cbaf0f`，本次没有合main或推送授权。

开工核对 branch、HEAD、status、index、MERGE_HEAD、CHERRY_PICK_HEAD、未提交归属及写入者。本轮从干净主线接续，既有需求、任务、未来方案及文档整理成果不重做。未跟踪 output、保全副本、旧patch、私有Prisma client及锁继续保留，不清理或附带提交。

## 当前核心接点及下一步

继续原 AIN-03/04/05/06/07/11 依赖，不以界面或空包装代替核心。当前场景交付矩阵与剩余实施缺口见[开发记录](<AI Native-开发记录.md>)；优先补可信价格/计数生产与完整标准执行依赖、其他输入格式/规模下的来源关系及真实删除传播，不以正确拒绝算正向交付。

AIN-01已复核原15项目录与实际消费者，补齐当前实现/原业务入口/仅候选/缺依赖的区分；四品类原报价与确认、实际目录消费者及归档证据链接已用现有入口快检。当前按原G3将AIN-01/05/11更新为75%，整项验收仍0/28，不改分母或门槛。AIN-01尚缺完整人工流程/指标及目标环境版本；新增发现的实际功能缺口包括`rental.change.preview`只有人工候选，尚无正式AI预览消费者，不能把Core已有预览记为AI已接通。其他任务先核对已有实现，具备门槛证据再更新，不批量估分。

`ebd5d479`将原能力验证的17个shared路径与`AI_NATIVE_CAPABILITY_PROBE_PROVIDER`接回标准AppModule；另需服务器`AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION`显式提供profile、scene/price版本、host、能力白名单及政策TTL。标准根没有该值，默认关闭且组装零读写；订单执行配置不会顺带开放付费probe。原计划管理provider按独立配置只开放对应固定scene/tool，人类按CAS配置政策，无自动种子。请求沿原Auth/Guard/ALS、原输入→task→runner→唯一Gateway/预算→能力收据，mock结果不变成live认证。当前已验标准准备/政策/读取和既有mock完整生命周期，真实模型/全部能力及标准传输完整链未验；配置管理的完整标准消费者仍需接，不重复造能力工作流。未来首选Harness的调整仅属未来方案，不启动接入。

`500c839d`已把同一持久订单链接入AppModule的原控制器及17个既有契约路径，复用`composeRequestBoundPersistedOriginalOrderRead`，没有第二运行器或账本。可信服务器DI token `AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION`需明确提供enabled、platformProfileId、maxOutputTokens、pricing、host及includeKnowledge；标准根未提供它，全部执行方法默认不可用，不创建政策或发模型请求。原独立观察provider不随新执行开关关闭。启用配置不是授权，原当前身份/动作及计划政策、能力/连接/Vault、权益与预算仍逐调用校验。OpenAPI暂用GenericObject表达多态结果，不能称完整响应协议已冻结。`91631362`进一步将启动/恢复/准备恢复/接管的只读预检设为5秒有界等待，取消立即关闭本次凭据，迟到compose不进入consume；不把此5秒限额施加于后续正常运行，不推断回滚/退额。下一步仍是可信政策/计价生产依赖及完整正向标准消费者；未启动服务或开放调用。

`b09b0215`已让清理消费原冻结输入的知识/偏好/媒体引用，核查原输入指纹、原请求和空间；仅实际引用的未决任务保留对应来源，不重新打开已撤回正文。每类最多核查50条、50个任务及每任务50份模型输入，超限/旧格式/孤立账务关联仍unavailable，不把页内未出现当无引用；当前不代表全格式或生产规模删除完成。`2aaaa910`将原账务read/releaseUnsent/reconcile整个请求含前置Auth/DB等待设为有界，取消/期限后关闭本次凭据，迟到compose不继续消费；可能写入不明仍unknown、不重试。

**可信计价的精确剩余：** `budget/prisma-gateway-pricing-records.ts`的`GatewayPricingEvidenceSource.readPrice`仍需正式费率/币种/有效期及来源修订，`readInputBound`需认证tokenizer或供应商计数收据，绑定原invocation/registrationHash/intentHash/configurationHash/priceHash。当前未找到其正式数据生产者，不以字符估算、当前价或合成种子替代，也不因此开放真实调用。

`bd052264`将原预算设置控制器与`AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER`装入标准应用，沿同一可信服务器DI配置默认关闭；当前有权管理员仍须通过原平台/租户Guard及政策CAS。六个既有设置路径已补OpenAPI，初始化/重绑定只消费正式当前配置，重绑定继续关闭政策门，不自动开额度、发模型或建立第二账本。设置请求有界/传递取消并关闭本次凭据，写应答不明只读原政策核对。政策CAS锁持有期间拒绝将未释放/已计量占用换成不同单位或币种，准入也拒绝历史混合计量，不能经中间停用/未配置状态清零旧用量；没有自动换汇或账期重置。本片已验现有政策读写与平台首次保存，租户首次配置/重绑定的全部正向组合及真实模型执行仍待核实。

`0b74345e`补齐同一服务器配置下的人类政策入口：标准`AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER`接原`AiScenePlanPolicyController`，仅管理order_explanation v1及ai.model.text/rental.order.explain；无执行配置仍不可用。原只读动作provider默认仍限三项读政策；明确服务器配置后可由当前同主体管理员逐项配置claim_run/claim_recovery_run/release_run/transition_task/takeover_run，不开放输入、建单或批准。沿原Auth/Guard、CAS、原政策审计事务及有限请求等待，不在创建任务时播种政策，也不创建财务占用。OpenAPI补原两条plan-policies路径；响应仍GenericObject，未宣布完整协议冻结。下一步需完整原请求→政策→执行的标准正向组合、可信费率/计数源及其余场景消费者，不把管理入口就绪等同运行放行。

原生协议→Routed→Unified→原财务收据现先保留已核验usage，再进行文本交付复验、观察和当前授权下的结算；中断/写应答不明不自动重写或重发。旧预算组合若缺`recordUsage`现先拒绝，宿主须使用同一`PersistentGatewayBudget`，不能再建账本。任务/原请求/客户材料按真实关联核查清理；无法核验的来源仍明确`source_task_binding_unavailable`。原生流只合并同一有界网络块已验证片段，每个实际交付块仍复核，不用定时权限缓存。以下既有接点继续复用：

1. **持久计价与标准执行装配。** 原任务Gateway支持服务端选择recorded或calls，未配置不回退。`composePersistedTaskGateway`及原场景/员工持久模型宿主现可由服务器显式指定`gateway.nativeProtocol:'openai_chat_completions'`，复用原有界/出网校验传输和受控订单工具协议；与adapters互斥，二者皆缺仍拒绝，不因省字段启用。配置、Vault、当前身份、能力收据和单账门仍逐调用复核；本地协议缺功能时先拒绝，不能以远端能力证据顶替。本原生选项不附带任意structured output schema，须另供正式适配器。默认审计接原OperationLog，绑定当前主体/原task/run/step/call、预留和dispatch关联，只留必要ID/hash，不存正文、密钥或原dispatch token。客户`createGateway/createPersistedGateway`现显式选择calls或recorded（tokens/money），已接回`client-request.application`原消费者；旧`createCallGateway/createPersistedCallGateway`保持兼容，混用参数、缺计价和recorded搭配vision均拒绝。这些客户入口及`composeAuthorizedPersistedTextProbeWorkflow`复用该审计生产者，缺日志仓储仍拒绝。审计COMMIT应答不明不重写、不据此派发，不代表标准应用执行放行。计价历史及发布收据仍可独立于生产器读取；显式`registerHttpPricingHistory`默认关闭。下一步仍需真实费率/可信token上界生产者、已发布能力及标准完整执行依赖；原生协议支持或calls调用计数不等于真实供应商/成本已验真。
2. **中断与结果收敛。** 原请求/模型订单、选报价、审批及能力验证已接有界等待和原runner恢复，领取丢应答不凭重读授执行权，证据发布超时仍unknown。原请求→模型→受权订单事实→回答现有正式输入证据来源，不再强制宿主补一个not_required替身：复核原计划、输入、完成步骤、用量/财务关联和固定工具候选，回答还复核订单快照。历史回答现按不可变原请求的执行时授权指纹核对证据，并复验当前结果读权限与事实；原输入过期/停新执行不单独阻断已完成回答观察，原记录撤销、串绑定或当前撤权仍拒绝，不授继续派发权。入口沿`composeRequestBoundPersistedOriginalSceneModel`的服务端`orderReadChain:{enabled:true,answerRoundTrip:true}`，可省inputSource，仍未注册生产执行。未知/串绑定/事实变化拒绝推进；该封闭链不承担自由澄清，报价多轮仍走原澄清源。已存计划/指纹/累计额度不改，maxSteps与原calls门分别限制，超时不补1毫秒强行启动。下一步仍核对完整可信执行装配及各中断窗口，不把定向组合当运行器、真实财务预算或供应商整项验收。
3. **原账恢复与宿主。** `29cbc608`将既有原订单账务控制器和`AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER`接入标准AppModule，提供`POST /api/ai-native/scene-requests/accounting/{read|release-unsent|reconcile}`，只收original/callId。它独立于新执行DI配置，按当前主体、原订单/任务动作政策、同一调用和持久dispatch/usage证据处理原账；不能预留、派发、改业务资金或无证据退款。标准原订单执行的17个路径已补全局Guard精确匹配，GET/未知后缀仍拒绝，入口权限不替代任务政策或派发权。能力验证的`TextCapabilityProbeModule.registerHttp`原账及其他场景仍须各自显式装配；客户`composeClientTaskAccountingRecovery`继续复用当前客户政策及原任务，同账处理calls/tokens/money，停新执行不抹掉原用量。结算按原调用价格版本，不用当前价格覆盖；撤回新用量权益与当前善后授权分离，权益目录/主体/证据缺失仍拒绝，已派发缺usage保持unknown。未完成的是标准原请求至真实账务的正向全链、tokens/money及各提交故障窗和员工/客户正式运输入口；本轮只有入口/拒绝及原账仓储分层冒烟，不把分层证据冒充完整结算验收。
4. **标准观察与剩余原任务。** 标准`AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER`已接`POST /api/ai-native/scene-requests/model/{scene|input|result|source}`：聚合原任务/快照与指定模型结果，读取当前澄清或明确null；源自原计划/步骤/结果、当前业务候选与权限，变化后拒绝旧问题。问题来源复用原执行宿主逻辑，但观察不构造Gateway、不授lease/提交/继续执行权，也不把旧问题标签直接当当前可用。原知识政策/版本与人类确认仍复验，缺依赖不丢来源露文本。新增scene/input读取使用原有限等待；只读仓储不发FOR UPDATE语句，执行及取消事务锁保持原样。标准政策仍仅原订单解释；报价正向澄清由显式服务端组合消费，不默认开放报价模型执行。下一步仍是完整可信执行宿主、AIN-06/07其余中断窗口、真实文件ACL/保留删除传播；真实费率/计数生产者未交付，不将这些代码缺口混称为仅剩部署。

上文历史接点中的“未注册生产执行”指未提供启用配置、未开放真实运行；标准默认关闭的执行注册现已补齐，不应再重复造宿主。原审查不能据此整体结项。继续核对未接可信生产依赖和标准消费者；未知结果、缺正式来源和未验环境分别保留。不启动服务、Worker、Cron、真实模型调用或辅助开发线。

## 验证与交接边界

- 最新预算设置stdin组合2/2（实际Auth/Guard、BudgetService/Prisma仓储，含平台首次保存、租户变更、zero/not_configured、CAS、旧COMMIT读回、跨单位/币种拒绝及断线），同单位正常预留/历史混合拒绝仓储冒烟1/1；既有C03仅选微金额写回1/1。API660 roots/0诊断、diff退出0。混合计量红测、首轮缺profile/表夹具及Prisma allocation无id字段的类型失败均保留并修正；未放宽校验。日志`output/core-budget-settings-20261018/`，无新增测试文件/迁移/生成。DB为串行事务替身、Profile和权益为合成种子，预留仓储冒烟的报价/复验端口为替身，不代表真实供应商价格、真库锁或完整标准派发验收。

- 最新`1149deac`：业务/订单读取故障分类先各留1 fail，修后合并冒烟2/2；包含真实Auth/Guard下正常读取、业务503不误报权限、嵌套权限/空间错误及并发撤权仍拒绝，报价R1的原unknown路径保持独立。标准原请求→Core订单状态→不可变输入→排队任务→显式同主体claim_run政策→原请求读取/换空间拒绝，stdin冒烟1/1。API660 roots/0诊断及diff退出0，未新增测试文件。Core/Auth/Guard及仓储实现真实，DB/订单数据为离线替身，其他业务源为拒绝调用的哨兵；没有供应商派发或真实数据库。
- 前片已定向核对标准计划政策保存/启停/CAS/事务审计/撤权、17个精确原订单路径与未知路径拒绝、原账宿主默认执行关闭及caller usage拒绝；原账仓储重建和幂等仅选既有用例验证。原用量先行留存、原冻结来源保留及原账等待证据沿开发记录追溯，不将不同阶段计数相加称最新全量通过。
- 旧原请求夹具的具体阻塞已确认：`lane-a-business-consumption.cjs`的吸收式配置store不提供正式持久分页端口，初始化报价候选时Core拒绝，不能退回全量目录。现已修正该运行故障被误报FORBIDDEN的产品错误，未补造夹具分页或宣称这套旧夹具已通过。本轮标准订单状态准备验证不依赖该无关报价初始化；旧红测/无效day枚举及一次stdin同名声明失败均保留。既有知识输入组合仍3 pass/1 fail（缺assertBound创建断言与既有受权元数据语义不一致），全局静态门此前失败未重跑，不删除断言或伪报全绿。
- 本轮日志沿`output/core-business-faults-20261018/`；前片在`output/core-policy-management-20261018/`及`output/core-usage-receipt-20261018/`。完整标准原请求→真实路由/预算/派发/结果及账务收敛、真实费率/认证计数源、MySQL锁与故障、供应商/存储/浏览器/微信仍未验或缺可信生产依赖；不是仅剩部署。百分比未跨原验收门槛，不调整。

## 操作边界

不读.env、不安装、不启服务、不访问真实HTTP/DB/DNS/模型/支付/对象存储、不迁移、不改共享生成物、不写其他树/main、不推送或部署。未来替换与抽离不是当前功能前置。

Node沿用本树 `tests/fixtures/ai-native/prisma-offline-preload.cjs`，固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`；审计、写入根、TEMP/TMP及缓存均指向本树。Prisma仅走已有隔离方案，不删锁或复制别树产物绕过。

负责人暂停或移交时立即停止相关写入；恢复辅助线须另行确认归属、独有成果和固定同步依赖。每个完整功能提交后覆盖本文的当前事项和下一步，不在此积累已完成历史。
