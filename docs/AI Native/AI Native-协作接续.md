# AI Native：当前协作接续

> 文档状态：当前接续入口，只覆盖最新现场和未完成事项，不追加历史流水。
> 更新时间：2026-10-24。功能保全为`05e71b1f`，后续`a17d4444`补13路执行/恢复响应合同，`ec9f7c53`补模型请求期限及迟到Auth隔离。本片接通报价澄清的原回答引用→重新准备/明确报价/原报价收据/明确继续，无须重传回答；旧载荷入口保留。保存不明只读原操作，未把报价当建单批准；下一轮澄清仍占原任务累计资源。API/shared离线noEmit为694 roots/0诊断。原28项64.3%、ENTRY52.8%、正式0/28不变。可信计数、平台独立付费验证、其他剩余实现及适用G4仍待补/待验，不称全部仅待测试；本地客户端成果独立保留，不夹带其OpenAPI修改。
> **五线功能基线已同步到`73b11477`，Claude A/B还同步了分工提交`8ede5906`；主线现恢复原75%任务的功能与契约收口，持续目标已设定。** 下方Claude任务须由负责人转发并由接收方确认，不宣称工具已送达或会话已启动；Codex A/B继续暂停。原任务达到全文实现、适用验证及独立验收后才100%，不以目标改变G4。本树客户端文件已出现新修改，主线只保留不暂存；仍只做服务端，不自动恢复其他线或改客户端。没有合main、推送、安装、真实环境连接或生产启用授权。

## 权威依据

- 产品范围、任务依赖与阶段放行：[正式需求](<AI Native-需求.md>)、[开发任务](<AI Native-开发任务.md>)。新补的目标驱动和场景闭环原则适用，不改原28项及 ENTRY 的分母；百分比按原门槛及时复核更新，不冻结旧值或凭提交数加分。
- 已做/剩余、固定功能提交及验证边界只维护在[开发记录](<AI Native-开发记录.md>)。
- 未来设计分别查[Runtime/Provider SDK替换](<未来规划/AI Native-Runtime替换方案.md>)与[通用SaaS底座](<未来规划/AI Native-通用SaaS底座方案.md>)；均不授权当前拆库、拆服务、开源或另造通用平台。
- 原总册、旧派工和历史接任提示词已归档，只供追溯，不能覆盖负责人本轮原服务端继续授权；独立客户端专项不改变原服务端需求或预算规则。

## 工作树与写入归属

本会话唯一写入树：`D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`。
分支：`ai/ai-native-contracts-s01-20261002`。服务端会话认领原Gateway/预算、运行器及审批接点；本轮不向辅助树写入或派工，不与其他线双写公共文件。

原服务端与客户端作者的代码和归属分别保留；本次仅统一保全和同步，不把继承成果改称本轮功能实现，也不续接旧会话的执行权。此前未提交的 `clients/`、后台agent-desktop、Auth/HTTP/Router/Shell、shared出口、Agent接入改造四册，以及服务端/预算/隐私/支付/Core等成果均已纳入上述保全提交。Harness固定上游源码、许可和来源记录保留；依赖、缓存、构建产物、output及私有Prisma产物未纳入。

四条辅助树位于同级目录，分别为 `codex-ai-native-lane-a` / `ai/codex-ai-native-lane-a-20261007`、`codex-ai-native-lane-b` / `ai/codex-ai-native-lane-b-20261007`、`claude-ai-native-lane-a` / `ai/claude-ai-native-lane-a-20261007`、`claude-ai-native-lane-b` / `ai/claude-ai-native-lane-b-20261007`。同步前均无独有提交、未提交源码或合并状态，原落后主线85个提交；本次仅快进到功能保全及本接续更新后的固定主线，保留各树与全部output。源码同步不包括依赖安装、私有client生成或运行验收。派工前逐树重核HEAD/status和唯一文件作者，主线后续提交不会自动同步。

开工仍须核对 branch、HEAD、status、index、MERGE_HEAD、CHERRY_PICK_HEAD、未提交归属及写入者。本次负责人明确授权在全部停写后提交保全并同步，既有正式依据内容原样保留，未重排任务或上调进度。未跟踪output、保全副本、旧patch、私有Prisma client及锁继续保留，不清理或附带提交；后续新WIP必须重新核对，不能据本次清洁现场覆盖。

**阶段收口必须同步进度：** 本次已纠正“记录了功能但任务百分比复核滞后”的问题。接手者每个完整功能/阶段收口时，核对受影响任务的原G1～G4证据，达到下一档就及时更新开发任务表及整体汇总；未跨档在开发记录简短说明已复核及缺口。开发记录留关键提交/已做/剩余，本文覆盖最新现场与下一步，三者同片同步；不逐方法写流水，不把进度提醒写入需求或任务正文，不为涨分改门槛或把未验说成已验。

## 当前核心接点及下一步

### 本轮Claude双线认领（仅服务端，原批收口后接下一长批）

已只读核对：Claude A仍在原计数生产批WIP（新增`input-counting/**`及原计价接点），Claude B已提交`bbbcc303`的平台主体/预算/probe组合，不能据提交标题认定整体验收。下一批追加到原对话，不中断在途工作；当前无Claude客户端直发工具，由负责人转发，不能冒称已发送。主线当前固定功能点`77f1da02`已补报价回答引用消费，两线先保全提交自己的原批，再安全merge这个固定提交、不reset或追移动HEAD，然后继续下列认领。不合入对方活动HEAD，不动主线树或客户端。

**下一长批A：可信计数到真实计价消费（AIN-03/04/05/11/25）。** 沿原文件继续三阶段，不重做已实现计数器：①冻结输入/配置/工具schema/协议请求一致性及计数原键恢复，计数调用自身使用原账；②把可信计数收据接到原上界发布、recorded计价、实际Gateway请求生产者，扩展现有正式身份能支撑的operator/staff/customer/platform来源；③原usage/取消/结算/unknown的成本与最少诊断事实消费。文本先真实接通，再做正式有依据的工具/结构化/媒体分支；协议未提供的计数、非token维度和缓存费率缺依据就明确拒绝，不以文本估值补。不得越过B的平台身份与预算主服务，交主线精确组合参数/调用序列和最小公共补丁。完整阶段一次定向冒烟/必要类型，不新增脚本；不是只交新的空端口或材料包。

**下一长批B：平台及两轨完整能力运行与恢复（AIN-03/04/05/06/11/19/25）。** 沿原文件继续三阶段：①先复核平台当前主体/动作政策的稳定绑定（`platform-capability-probe.composition.ts`中`policyAuthority`读后比较整个context，须排除每次生成的authorizedAt/requestId误伤，但保留独立时效/撤权检查）；②在原平台Task/单账与真实挑战上接Streaming/Tool/Structured及已有合法Vision/Audio挑战，Embedding/Reasoning仅在原协议与正式工具具备时实现，不虚构功能；③把原request/task/run/invocation/dispatch/capability与账务收据、取消/恢复/换配置/撤权的合法只读观察连成实际消费，并复核平台与租户/BYOK不串主体或账。复用原runner/媒体ACL/出网与唯一Gateway，不写runner、A计数/计价、协议传输及中央Auth/Guard。没有可信媒体源则仅隔离相应变体，继续文本/流/工具/结构化与恢复；向主线交真实显式装配而非平台对象壳。

两批均不新增HTTP/worker/AppModule启用，确需公共入口由主线整合；不注册默认成功adapter，不把calls当token上界。每阶段提交固定SHA和真实入口后直接下一阶段，无新增测试脚本/递归review/全量回归。阶段性文档只简报实际已做/未接，不写三份中央依据或调百分比；原G1-G4与离线边界不变。未来Runtime/Provider SDK各自可替换，当前不安装、不迁移，两套驱动不能同发，unknown只核对原证据。全部原队列已做则直接复用，确实阻塞则精确列缺口并做后续无依赖阶段，不为持续工作造新平台。

- **Claude A**：`claude-ai-native-lane-a` / `ai/claude-ai-native-lane-a-20261007`。沿AIN-03/04/05/11完成可信冻结输入→受控计数→持久原收据→正式输入上界→原recorded计价消费。独占新增`input-counting/**`，现有`budget/platform-reviewed-gateway-price.service.ts`、`gateway-pricing-evidence.ts`、`prisma-gateway-pricing-records.ts`、`prisma-gateway-recorded-pricing.ts`、`gateway-pricing-request.composition.ts`，以及`model-input/task-model-gateway-input.source.ts`中的计数绑定；仅确需时改原`model-egress.transport.ts`及计数专用协议适配。不得修改B的probe、预算主服务/事务仓储、runner或审批。
- **Claude B**：`claude-ai-native-lane-b` / `ai/claude-ai-native-lane-b-20261007`。沿AIN-03/04/05/06/11完成平台独立主体→原任务/授权/平台单账→真实挑战→usage/能力原收据→恢复/取消/核对。独占新增`platform-capability-probe/**`、既有`text-capability-probe*`、`provider-capability*`、`prisma-text-capability-receipt.repository.ts`、`capability-verification.ts`和图片/语音挑战；如平台主体确需扩展，认领`budget.ports.ts`、`budget.service.ts`、`prisma-budget.repository.ts`、`budget-dependency-adapters.ts`、`gateway-budget-principal.ts`、`budget-gateway-adapter.ts`、`gateway-budget.composition.ts`及`prisma-gateway-invocation-bindings.ts`的相关平台分支。保留租户/员工/客户原链，禁止伪造workspace或借租户额度。不得修改A计数/计价、协议传输或原生协议实现。
- **主线唯一整合区**：shared公共契约/出口、schema/迁移排序、Auth/Guard内核、OpenAPI、AppModule、`ai-native-application.providers.ts`、公共Unified/Routed Gateway、runner和审批。两线需这些文件时报告精确类型/方法/生产者/消费者与最小补丁，不跨树代写；如底层确需变化先认领再施工，不用私有同名协议或假成功绕过。调用A的计数材料对B不是启用前置的替代品；B可先闭环明确配置的原calls计量，不能用calls证明token上界，金额/token链待A正式材料后另验。
- 每线接收后先核对基线包含`73b11477`、实际HEAD/status/合并状态和唯一写入者。连续完成实际功能包，阻塞仅隔离受影响项；不新增测试脚本，仅已有入口/临时命令的定向冒烟与必要类型检查。固定SHA交付后等待主线按依赖整合，不自动合main或互摘活动HEAD；本次不启动定时器，也不承诺应用退出后持续运行。
- 四册中央文档仍由主线维护；两线向交付消息简短报告实际入口、当前WIP/下一步、阶段SHA和未验边界；如本树已有未归档本线接续则更新，不能改历史归档或另建文档群。完整阶段达到原门槛才由主线以5%档更新任务百分比，无整体验收就不标完成。

当前收口与下一队列（覆盖下方历史接点中的旧待办）：

- **本片公共契约收口（AIN-02/06/14）：** 原恢复快照及runner结果共用shared类型/封闭schema；开业六个模型接口、报价六个执行接口、原快照观察共13路公布命名响应，默认开业/报价Controller与快照读取实际校验。可能已执行的坏响应保留unknown并指向原观察，纯读异常不返回内部字段；取消意图/输入等待取消落库/原账释放不混淆。其余多态动作尚未全部冻结，原任务仍75%，不得称AIN-02全部通过。
- **模型请求生命周期（AIN-04/06/14/15）：** 两种原模型请求组合的短观察默认整体5秒，刷新问题/确认报价/保存回答/取消按可能写入处理，超时unknown；start/resume/continue/recover/reconcile/takeover只给装配预检加界，运行仍按原runner工作窗。请求超时/abort后关闭本地凭据，真实Auth返回后再次核对凭据是否仍有效及token/audience未替换，旧授权不能再推进scope读取或写入，requestId不作授权比较。已用真实Auth/应用/runner的离线组合验证超时、迟到和正常长于短期限的运行；DB/路由/财务/传输为替身，非真实单账/供应商验收。
- **75%逐项收口顺序：** AIN-01完整人工参考基线与目标版本仍未核实，不能只把盘点表改成100%；AIN-02剩余多态合同与全端兼容由主线补。AIN-05/11的计数和平台独立验证由Claude A/B按认领推进；主线继续其余公开装配、运行恢复、审批/场景缺项，再按任务适用性申请真实环境/独立验收。不把所有余项归为“只差测试”，也不让不依赖真实模型的盘点/合同无条件等最终试点。

- 原`scene-requests/accounting/operation`只收original/callId及releaseUnsent或reconcile，观察既有同载荷账本事件；当前已settled/released但缺该事件仍not_observed。当前owner/资源/任务读权限必需，不依赖新模型启用；无新派发、变更或自动退款。
- 员工/客户原账直接应用入口共用5秒依赖等待，读取超限不可用，可能写入超限unknown；关闭当前凭据/绑定、读取等待后再检查，迟到依赖不能推进新的业务读取或变更。原Controller的外层期限与原账核对继续保留。
- `AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION`显式提供后，标准`opening-model/{start|recover|reconcile|takeover|cancel|execution}`复用原opening_diagnosis模型材料、持久计划/输入、runner和Gateway单账。原任务模型/result/source观察继续复用已有只读宿主；模型门不开放settings批准/写入。原人类CAS计划/动作政策管理按场景提供模型工具与执行操作，仍不自动播种政策。
- 报价澄清最终参数已可明确审阅/确认：持久回答改变完整candidate时，旧候选修订仍原样保存；仅修订是唯一阻碍才局部重读当前事实提供待确认request。原普通prepare不放宽，confirm再次比对当前最终修订/hash，报价不批准订单；同后继/审批/Core/原收据链已定向离线验证，全部业务变体与真库仍未验。
- 验证环境注意：本树现有TypeScript7不提供旧ts-node所需Compiler API，未安装/覆盖或复制生成物；本片隔离验证显式用ts-node解析到的已安装兼容编译器，原默认类型命令的兼容性未认证。不得删除/降级依赖来消除现场。
- 优先余项：可信冻结输入计数与可计量计数调用/持久收据生产者（仍缺实际实现，现有readInputBound不能补造）；平台独立主体的付费能力验证；标准live准入下完整模型单账及中断窗口。后两类所需真实连接/凭据/验收另授权，明确区分代码缺口与未验环境。不重复已有报价/诊断/账务宿主，不以calls计数当token上界；小程序/官网暂只后端接口，不扩页面。


当前报价模型执行已由标准`AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER`消费既有持久澄清链，独立`AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION`选择Profile/输出上限/pricing/host/knowledge，默认关闭；不顺带开放订单解释、能力probe或建单。原计划CAS生产者只在模型门存在时加入`ai.model.text`，动作政策加入request/submit/resume输入权，建单批准仍必须原独立quote-order门和真实人类决策。标准独立Controller只挂既有执行动作，观察Controller继续单独保留，任务中心ModuleRef现在可取原执行provider。resume/continue/reconcile前置等待与断线绑定，实际运行维持原工作窗和累计资源；unknown只核对原任务/回答/调用，不重发。已离线贯通TaskCenter回答丢COMMIT应答→明确同后继两次调用/六allocation/两settle；标准provider缺live原收据拒绝，未冒用合成能力。本轮新增`input/submit`只保存回答不启动后继，再由标准`quote-selections/clarified/{select|operation}`明确交接原已确认报价；同一后继交原订单宿主，模型publication/选择沿原task锁互斥，已冻结input/plan不换选择。正常task/人类审批复用原场景authority，reprepare独立；approved Core执行按原持久报价读取，丢应答不依赖缓存或重建。该完整定向离线链已通过四类COMMIT丢应答核对和原订单收据，仍未认证真实MySQL/标准live单账/全部变体。本轮已恢复服务端开发；后续优先可信输入计数/recorded、标准live能力与单账全链及剩余故障窗，不用calls/字符替代，真实环境须另授权。

平台`/platform/ai`的`PlatformCapabilityObservation`只读原Profile能力证据，`GET /platform/ai/providers/{profileId}/capabilities`复用当前SaaS view、canonical platform scope及原live收据验证器；白名单、原支持声明与当前verified/unverified/disabled分开。原记录的模式/修订/检测/期限可观察，不暴露证据详情或密钥；缺原live收据、mock/manual/declared、过期及旧修订不认证。八类有界读取，读后身份/Profile/证据变化拒绝；首次零请求，配置变化重挂，隐藏/卸载迟到不回填且不锁住下一次明确读取。该端口无probe、任务创建、dispatch、预算或Vault写读，观察不授执行；原平台付费probe仍缺平台主体任务/预算/invocation装配，Embedding/Reasoning缺客观方法，不借租户身份补成功。下一步仍按原服务端依赖推进可做核心功能，可信计数缺生产依赖时保持unavailable，不重做已接的设置/收据观察。

原动作政策收据：`PrismaTaskActionPolicyRepository.put`可明确选择将原CAS转换和`OperationLog`收据放入同一事务，当前验证配置入口已启用；其他旧调用不自动改行为。`readMutation`按scope/task/operation/原expectedRevision及当前actor观察，不用当前政策值推断原提交。`POST /ai-native/text-capability/task/action/receipt`复用当前管理权、不可变原请求和同owner任务，原模型移除、材料/政策过期不阻断合法历史核对；仍需可信探测宿主配置。shared/OpenAPI/现有Guard路由映射及后台会话已接；浏览器只留原任务/动作/CAS引用，收据匹配后清unknown、清当前政策，必须重读当前政策，不授执行。缺收据、旧journal无CAS引用及旧保存仍保持未知。取消原收据现由后台独立复用任务中心`stop-receipt`：发送前持久保存taskId/expectedRevision，刷新后只读原事件及同主体当前权限；匹配observed才解除取消unknown，保留原取消引用、不再start/cancel。not_observed不证明未提交，旧journal缺引用不从当前修订倒推；合法明确reconcile仍走原运行器善后，不由观察自动触发。原任务元数据沿真实read_metadata读前/后复验，不构造runner或写端口，但原创建材料的有效性约束未放宽。

租户`/settings/ai`的`CapabilityProbePanel`消费原`POST /ai-native/text-capability/*`及共享协议，不另建运行器。当前params管理权和服务器能力白名单必需；首次挂载零读取/轮询/动作。`CapabilityProbeSession`按tenant/workspace/actor保留一个原请求引用及不明操作阶段，保存丢应答后只按原键读取；启动尝试后不再启动，恢复走原runner规则，绝不凭task完成授能力。动作政策仅提交服务器模板代码和CAS，权限/期限不能由浏览器指定；证据登记明确可能写入，但不派发。读前/读后失权清除旧结果，页面卸载/旧代次不回填。会话不提供清锁换ID；取消/动作政策写应答不明只按各自原CAS收据核对，不因当前状态擅自清锁。取消收据复用既有任务中心只读端口，无独立probe新路由；取消意图记录不证明任务取消、远端停止或费用释放。本页原账务宿主现消费既有`accounting/{read|release-unsent|reconcile}`，仅按原requestKey由服务器绑定同一调用；读取原预留/实耗精确单位，不当能力证明或供应商账单。释放/核对是明确可能写原账的确认动作，发送前保存最少原task/call/reservation/动作引用，不由页面提供金额或证据；同调用/终态回执才返回成功，丢应答后读取当前账保持unknown；新增`accounting/operation`只读既有原恢复事件，严格核对同一request/task/call/reservation/operation才解除对应不明标记，引用保留、本页不重复办理。该入口复用原Gateway recovery.readOperation→BudgetService当前read授权→Prisma原账本eventKey/payload核验，不重放release/reconcile、不改账；旧adapter无读端口或缺原事件仍不可用/not_observed，不能由终态猜原提交。原Profile移除不单独阻断合法历史，撤权/旧代次仍拒绝；账务观察不解除原取消unknown。Embedding、Reasoning、平台独立主体验证及其他宿主的精确账务收据消费者仍未接此页；完整真实挑战与标准执行尚未验，不能称能力管理整项完成。下一核心缺口仍是下述可信输入计数生产、完整标准Gateway/单账执行及合法恢复，不重复已接的租户操作入口。

平台`/platform/ai`的原ProfileHost挂载`PlatformPriceReview`，新审阅仅取原服务已读取的profileId/revision，配置保存进行中或unknown时禁止新费率；字段/修订变化清人类确认，默认零计价读取或发布。复用`budget-settings/platform/pricing/{review|review/receipt}`、现有shared及SaaS view/manage；服务器只接受正式管理配置指定的Profile，不能由页面选中自授权。金额/缓存费率按六位字符串，不猜供应商价格/缓存折扣/汇率；也可明确Token原量计量，不代替可信计数。原键/场景/内容hash留sessionStorage，unknown锁重提；原Profile变化、无当前配置或只剩view权限时仍可核对原收据，撤权清旧结果。结果是原版本，不证明当前配置、预算、能力或执行可用。

租户`/settings/ai`挂载`TenantPlatformRate`：手工输入平台给出的原费率引用与场景，零初始读；先通过`POST /ai-native/budget-settings/pricing/platform/preview`读取原价，再明确采用已有`adopt`，`receipt`独立观察原采用。预览复用`GatewayPricingRecordManagement.previewPrice`的当前settings_read、平台模式/原Profile与有效期、双次来源及读后权限复核，不写任何记录，shared命名schema/Guard/OpenAPI/默认关闭provider齐备。租户无价格覆盖输入，输出不含平台供应商/模型/凭据/审阅者；采用仍走原publishPrice与当前写权。原引用/evidenceHash按tenant/workspace/actor留sessionStorage，unknown锁住新采用，重载后只核对原键；模式/Profile变化不阻止合法历史读取，缺收据或撤权不推定未采用。费率采用是空间原价记录，不改额度、不授计数/模型执行，不新建账本。租户能力消费者已接上述原任务入口；可信输入计数生产者仍按下文拒绝，不能因费率链可用就开启模型。

同页`TenantByokRate`显式调用`POST /ai-native/budget-settings/pricing/configuration`：仅按当前身份/tenant/场景解析唯一默认BYOK Profile（take 2拒绝歧义），读后复验当前授权和配置修订，返回真实Profile引用、不泄露模型/凭据。租户设置摘要的configId是tenantId，不可拿来充当Profile。复用原`review`与`review/receipt`、同一费率表及原审阅事务；通用编辑会话按平台/BYOK分别核验authority，原键、实际configId与内容hash留owner分区journal，模式切换/Profile移除或到期后仍能核对历史，未读当前配置不阻断原收据。无新派发、计数证明或账本；本地引用不是授权。

后台`/settings/ai`的`TenantBudgetSettings`复用原`budget-settings/{read|change|initialize|refresh-configuration}`，明确选择当前tenant/workspace与scene；入口仍需当前`system:params:manage`及服务端Auth/Guard/Scope复核。not_configured/zero/limited分开，六位金额字符串、不重算；白名单只读，平台模型细节不外泄，首次停用、重绑定保留旧债务。新保存携带原operationKey，政策CAS和`OperationLog`收据在同事务提交，绑定原actor/workspace/scene、动作、请求指纹及原修订。`POST /ai-native/budget-settings/operation`沿当前读权限和原归属观察，不依赖活跃Profile，不授执行；重复原键只核对，不再写。后台仅存原引用/指纹，unknown锁重提；核对匹配后清锁但清空政策，必须再读当前修订。缺收据、错指纹和旧版无原键记录保持unknown/人工核对，不按TTL或当前值解锁。原调用的结算/占用账本不变；平台独立能力宿主、可信计数和完整模型执行仍未齐。

平台`/platform/ai`挂载`PlatformBudgetSettings`，与上方所选Profile无关，按scene编辑原平台全局政策；显式read/save，首次三门停用，精确额度/币种、白名单、并发/每run上限和原CAS。服务器仍选正式配置，保存和原收据由同一BudgetService/Prisma事务完成：平台使用现有`AiModelConfigurationOperation`的`ai-native:platform-budget-settings:scene:`命名空间，不伪造tenant审计、不改租户原`OperationLog`。`POST /ai-native/budget-settings/platform/operation`绑定scope/scene/原actor/请求hash/修订，view即可只读观察，缺Profile或撤销manage不阻断本人历史；别人原键只返回unknown。后台owner/scene分区journal保留原键/hash，丢应答锁重提；收据匹配后必须重新读政策，不以当前值、TTL或失败推定回滚。shared/OpenAPI/Guard/默认关闭provider齐备；不自动调用、改费率或重置债务。

任务中心澄清现有标准`POST /ai-native/task-center/{input|input/resume|input/receipt|input/continue}`及shared命名类型/OpenAPI。当前owner/原请求绑定后，只读问题/收据不构造执行宿主；明确提交/继续才惰性解析正式宿主。后台零初始读、选项不默认选，unknown锁重提，浏览器仅留原操作引用。刷新后先核对原收据，再明确点击继续；`AiTaskClarificationContinueQueryDraft`允许原完整submission或原引用，resume仍必须完整回答。内部`resolveAnswerContinuation`复用原仓储核验持久answerHash、问题历史、actor/scope和后继run，再复验当前任务修订，交既有continueAnswer复核计划/租约/累计资源；没有新增公开正文读取接口。非RUNNING任务只读原收据，不解析回答或claim。缺收据不证明未提交、不能重发；回答和继续均不授业务批准。已离线驱动真实报价澄清的保存后中断→刷新→明确继续；其他场景全部追问、完整单账/真实供应商及浏览器仍待验。沿原UIArc/主题，无视觉改版。

后台配置现沿原API实际装配：租户“服务与渠道→AI服务设置”（`/settings/ai`）复用C07与原Auth/Guard/CAS/Profile，平台模式无需供应商输入，BYOK支持三种已有原生协议；切换保留原加密配置，清密钥同时停用。旧系统配置单独审阅来源版本，只有明确新密钥+disabled替换才保存，不自动导入。平台“平台AI配置”（`/platform/ai`）沿原GET/PUT `/platform/ai/providers/{profileId}`和原operation接口；严格按当前SaaS view/manage分别显示和保存，不给所有SaaS账号自动权限。现有`GET /platform/ai/providers?limit=20&after=...`目录，默认20、最多50项，Prisma平台scope/serviceMode条件、ID排序与limit+1游标探测；当前读权前后复核，仅元数据，无URL/凭据/能力证据。后台明确读取并选择，不默认选首条，不自动读配置/测试或启用；仍支持人工编号首次配置。首次配置是明确CAS修订0且停用，不把读取失败当不存在。两端仅sessionStorage保存原操作引用/修订，绝不保存密钥；未知锁住新保存、只核对原收据，收据确认后重新读当前配置。配置保存不会开放预算、能力验证或执行。价格/预算及上述租户能力消费者现已接入；平台独立能力宿主、正式后台审批与场景完整消费仍待补，不重复这些设置宿主。

后台任务中心（`/ai/tasks`）复用原Auth/动作政策/owner查询，标准POST `/ai-native/task-center/{list|snapshot|events|result|source|usage|confirmation|review|decision|decision-receipt|business|continue|stop|stop-receipt}`有明确shared/OpenAPI。首次零AI读，无默认轮询；主动跟随只读当前任务持久快照，每3秒、最多200次/10分钟，终态/失败/隐藏/换空间停止，不启动或恢复任务。正文及原来源沿原请求、场景事实和知识ACL逐次复验；来源hash/index仅lookup，最大64KiB惰性文本/JSON，页面最多展示20000字符并说明截断，不执行HTML/URL。来源重开现按原请求选择场景，不将默认订单政策套到开业/报价。unknown不发布成功事件；原用量/确认历史仍为有限只读观察。原订单/通知审阅、人类决定、批准后明确继续及原Core收据沿原宿主/claim/fencing/累计资源/审批，非另一运行器。决定/继续/停止不明仅sessionStorage原引用锁重提；停止按当前任务owner/transition政策/CAS/事件和同主体原修订收据办理，模型原请求不是取消前置，设置等合法同主体任务也适用；只记录请求，不声称远端停止、回滚或预算释放。原设置/订单持久等待与累计资源核对可独立于新执行政策收敛，实际取消须原宿主持有当前恢复租约及无业务提交证据；未知仍保留。只读恢复请求整体5秒有界并关闭迟到凭据，三条原取消写路径超时为unknown；实际原运行器继续保持自身上限而非读取5秒。切空间/隐藏/撤权清旧正文。当前不是全列表推送、完整事件流消费者或浏览器/HTTP验收，不把局部链路称完整工作台完成。

下一步优先可信计数/上界正式生产者、标准模型单账正向执行和剩余恢复窗口，再补后台能力/预算/审批与场景消费；不能用calls换算token、猜计数、恒真权限或默认开关补齐。平台费率与BYOK审阅生产者已存在，不重复开发。已收到的原派发usage可独立于结果交付、取消或当前执行门变化保存；提交丢应答不自动重写，善后仍要求当前权限和同一派发证据。适配器与Unified响应快照已收口，不用重建协议或派发器。全部源码/类型/离线证据不代替shared正常构建、真实MySQL/供应商及浏览器验收；本批未构建dist、迁移或启用。

可信计数当前精确缺口：`PrismaPlatformReviewedPriceSource.readInputBound`仍明确UNAVAILABLE；已有`GatewayPricingRecordManagement.publishInputBound`只消费可信来源，不自行计数。现有lockfile没有适配模型的正式tokenizer，协议结果usage也不能倒用作派发前上界。需要同一完整不可变协议输入、配置/模型版本和有效期绑定的认证tokenizer或供应商计数原收据生产者；不能将字符/字节数或管理员任填token数当证明。该点尚缺实现/可信依赖，不笼统写成“只差真实环境”；继续其他核心配置/恢复消费者，不以目录入口补齐计数项。

Profile发现不是只有页面有界：原`PrismaProviderProfileRepository.list`现以scopeId/scopeKind、固定role/profileKey/id排序及take101读取，最多接收100项；Router与仓储共用同一上限。超过上限整次不可用，不截断选赢家；list/get核对原scope/对象键，不沿调用方await期间变更的scope读取。该约束同时供原路由和能力probe复用；未改角色优先级、能力白名单或派发政策。

预算新占用与原记录读取仍是不同语义：原Service和Prisma仓储现覆盖提交前撤权回滚、提交后撤权/丢应答待核对、P2002同键观察的当前复核及锁后过期拒绝。后两种可能已有原占用，必须走现有readCall/read与原证据核对，不换键预留、释放unknown或从重读获得派发权。事务结果与返回值独立快照，不修改原三层锁/并发/每run限额。相关离线时钟均显式传给服务与仓储，不能用历史夹具误判生产时间门。

正式持久模型宿主：`composePersistedTaskModelHost`与calls兼容入口现返回同一原任务绑定的`accountingRecovery.{readCall,read,releaseUnsent,reconcile}`，复用原Gateway创建的预算，不创建第二份服务账本。已离线驱动真实运行器/累计资源/金融Prisma链：文本与图片各一次派发、一预留、三allocation、一settle；结算事务失败后usage保留，关Profile/执行门仍可按原证据reconcile一次。财务settled不把UNKNOWN模型步骤变为成功，恢复不重发；跨任务拒绝，缺配置及善后零凭据读取/新派发。路由/dispatch/协议/文件来源及DB为明确替身，calls不是金额/token的替代方案；可信计数生产、标准正式配置→HTTP全链与真实环境仍待验。旧夹具不转发事务选项、缺SQL聚合的差异仅在一次性命令补齐；原脚本/断言未改，旧整例默认DISABLED的预期差异不得报通过。

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

**历史阶段证据（2026-10-19，非当前汇总）：** 失效草稿元数据/取消、两轮澄清及原回答收据、从未启动取消、释放的输入等待取消，四组stdin各1/1、0 fail/skip/todo、退出0，不与前序批次相加称全量。API669 roots/0诊断、diff退出0；无新测试文件、构建、迁移或服务。沿原双offline preload、固定无效DATABASE_URL和本树绝对审计/TEMP运行；`output/core-staff-original-lifecycle-20261019/`保留旧实现阻塞复现及夹具修正。Auth/Guard/订阅、runner/Gateway/Prisma仓储与Controller为实际实现；DB、能力历史、协议和对象流为替身，不是HTTP/真库锁、真实计价/存储/供应商/设备验收。原28项62.5%、整项验收0/28不变。

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
