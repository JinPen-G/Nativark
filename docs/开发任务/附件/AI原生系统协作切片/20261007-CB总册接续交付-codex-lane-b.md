# Codex B 总册接续交付与精确未闭合项

## 2026-10-08 CB09 / AIN18：人类历史核对、关闭与反馈收据

基线ae43f1e0（主线等价691f32e7已接），本片继续同一B认领。新HumanAutomationReviewService由原composeBusinessFailureEvents/Module.register导出为reviews，也随automation组合导出；不需要automation policy、预算或订阅作为人类凭据，不注册HTTP/worker或改A/06/07。原BusinessFailureReadAuthority实例提供当前Auth/Guard、本人workspace/地点与Core可见性前后复验；源已成功/候选到期可核对历史，原资源缺失、不可见或当前人类撤权则拒绝，不发明永久历史授权。

- `reviews.read({inputRef})` 校对冻结input/event/scope及原task创建键、owner、inputHash、scene/policy版本和first run。返回当前源revision/failed、历史event、独立review状态、observed/not_observed task与精确actionResource/resourceHash。可读失联link后的原task，或尚未观测到task的creation_unknown；不借过期automation actor、不恢复执行许可。
- 原input仅追加reviewRevision(default1)、reviewStatus(open/closed)、closeReason、feedbackCode、reviewedAt。原payload/inputHash、创建status和task/run状态不变。追加独占迁移 `20261008143000_ai_automation_human_review` 与AiAutomationReviewGrant/AiAutomationReviewOperation，不改旧迁移。grant默认disabled，明确user/audience/当前scope/input/event、close或feedback、expectedRevision、resourceHash、有效期/requiredPermissions；GET可见性与此正式动作grant同时成立才写入，没有从读权推导写权。
- close输入为 `{inputRef,operationKey,expectedRevision,expectedEventFence,expectedTaskId,reason}`，reason限resolved/dismissed/duplicate/not_applicable；feedback同一base加code(helpful/not_helpful/incorrect/not_applicable)。不收自由正文、scope、actor、审批或任意action。reason与feedback是人的处理标签，不是Core事实判决或模型学习材料。
- 原Outbox/input锁与CAS、grant前后复验、独立review更新和immutable operation receipt在同一Serializable事务。关闭时只把原AI Outbox设closed并推进fence/清理候选租约，阻止后续候选及自动准入；不是取消原task，更不改通知/退款或清除creation_unknown。在途创建仍可能稍后被观测，不以close回执断言它从未调用或已撤销。反馈只更新review版本/代码，closed保持closed。
- operation持久原input/event/已观测task/run或null、actor/audience/scope、command hash、expected/result reviewRevision、event fence、grant/hash及结果。unique(scopeId,actorId,audience,operationKey)和(scopeId,inputId,resultRevision)；grant/operation通过input的tenant/workspace/scope/event复合FK，task/run及grant再按scope/input复合约束。记录不是业务操作收据或批准。
- `reviews.operation({inputRef,operationKey})` 严格只读，未观测/未知返回retryable=false；丢ACK后只查原key。相同命令已有receipt直接核对，异内容同key冲突；此重放和读收据只要求当前人类读权且原actor/audience精确匹配，不要求旧write grant仍启用，也不能产生新写入。并发版本变化可报conflict，随后查原operation；没有自动重试、换键、修复关联或恢复执行。

只在原events同一CB09组合用例增加此实际链，一次1pass/0fail/0skip/0todo退出0，实际ts-node transpileOnly=false、diff check0；未新增测试脚本/矩阵。覆盖已过期/撤销automation后人类读原task与成功源、无独立grant写拒绝、关闭提交丢ACK→原operation只读→旧grant停用仍重放原receipt、异内容拒绝、feedback必须自己的grant、closed保持、未观测task的unknown关闭、人类撤权读拒绝；直接比较原通知/退款/task/run未变。DB、身份存储、Core端口为显式替身，未称真实MySQL锁隔离或多实例验证。

隔离Prisma生成exit0，schemaHash=47ea491ececa0c9da3350da15ee966874d7adf068e99139a1542158718920a0a，guardViolations0/sharedArtifactsUnchanged=true。命令沿原preload+local-runtime、固定无效DATABASE_URL；本树output/cb09-human-review-audit，writeRoot=本树，TEMP/TMP=原inspection-lb05-tmp。未执行迁移/生产置备、读.env、安装、服务、网络/DB/模型/支付、push或合main。正式政策管理/宿主入口与真库FK/并发故障深测仍缺；不以缺UI空等，也不把测试grant当生产配置。

Runtime替换只能驱动读/close/feedback/operation，不拥有人类动作grant、review CAS或收据；checkpoint不能解释为关闭成功或业务撤销。Provider SDK本片无调用，仍只在原Gateway边界。回退停用显式入口，保留原input/event/task/unknown与人类operation；反馈不进入Memory/Knowledge自动学习。唯一心跳00965714保留，未接入尚不完整的媒体单账桥。

## 2026-10-08 CB09：持久独立主体到原任务创建与只读核对

基线928d4567；依赖本线42626a29的CB08事实revision/事务Outbox（主线已等价接收8861c1d9），不反摘活动主线。本包归属已确认：仅automation新目录、B自己的business-events组合、原AiTaskCreationRepository新增只读方法、最小schema及独占迁移；没有修改人类token解析、Auth/Guard、runner、审批、A scenes、Gateway或根模块。

- 追加 `20261008133000_ai_automation_policy_inputs`，不修改旧迁移。AiAutomationSubject独立id、workspace归属、authorizationRevision、默认enabled=false、有限原权限/locationScope、expiresAt/revokedAt；AiAutomationPolicy默认disabled，支持shadow/manual_confirmation，绑定subject、scene/version、允许事件类型、有效期及maxTasksPerDay/cooldown。没有默认启用政策、凭人类token换actor或自行授予商业权益。政策配置/审批管理入口仍未提供，需受信任生产置备；缺行拒绝。
- AiAutomationInput固定原eventId/resourceRevision/dedup、subject/authRevision、policy/revision、scene/version、authorityHash与payload/inputHash、expiry、派生creationKey。unique(scope,policyId,policyRevision,eventId)，creationKey唯一；subject/policy/event均tenant/workspace复合FK，input的scopeId+tenant/workspace关联AiScope，原task/run引用再经scopeId复合FK约束。不写正式检查、Memory、Knowledge或日志正文。
- `PrismaAutomationAuthority`逐次读取当前启用主体、当前政策与workspace、原通知/退款事实；明确失败且revision/订单关联一致才准入，模拟/成功/未知/过期/关闭事件拒绝。按持久有限权限及locationScope读取最少事实，selected范围保守要求订单出还两据点均可见；无订单通知只支持全空间subject。scope/actor由政策产生，不由event body或调用者传入。当前subject授权revision、policy及source头在prepare、create、readCreation前复验，撤权后原输入失效。
- 复用原三层AiScope/AiBudgetPolicy settings验证、平台/租户/场景enabled及允许模型交集/调用限额，原AiTaskPlanPolicy版本/有效期/limits，以及PrismaSubscriptionBudgetReader + SubscriptionBudgetEntitlementAdapter的正式权益读源；缺任一依赖拒绝。没有选模型、写模型预算账、预占模型费用或第二计费算法。日计数仅元数据任务准入，UTC窗口、每事件每政策版本只占一次；事务锁policy/subject/原event/原事实并冻结输入，不把Runtime checkpoint当授权。
- 显式入口 `composeAutomationFailureTasks`、`AutomationFailureTasksModule.register` 与 `composeBusinessFailureAutomation` / `BusinessFailureEventsModule.registerAutomation`。服务 `prepare({eventId})`、`read({inputRef})`、`create({inputRef})`、`reconcile({inputRef})` 只接服务器选定policyId；组合不启动worker、不注册HTTP、不派模型/工具/通知/退款，也不生成确认或批准。任务仍由原AiTaskCreationRepository创建queued task和first run，真实AUTOMATION owner、原input/hash与政策列，不另写创建器。
- create之前先CAS为creation_unknown；同输入其他调用者只核对，不再次调用create。应答丢失按原creationKey/inputRef读取；成功观测不等于业务执行成功。占位后进程崩溃可能尚未调用create，读不到task报告not_observed/unknown + retryable=false，永不解释成失败后可重派。reconcile不修复关联或做任何写入；原任务若已提交而关联未写，仍读回原task/run。prepare重放读到旧input后若事务应答未知，也保留旧inputRef，不返回新生成的无关引用。
- 原 `AiTaskCreationRepository.readCreation` 是唯一新增方法，复用grant/fingerprint/result/owner/scope与原key；只有findFirst，既不调用newId、upsert、create，也不换键，前后授权变化拒绝。严格当前源/政策检查意味着已解决或撤权后此automation入口不可继续读旧创建材料；后续人类历史核对须另用正式授权入口，不能借本包绕过撤权。

仅扩展原events文件中的一项CB08/CB09完整链，没有新增测试脚本、矩阵或全仓回归。最终 `--test-name-pattern='CB09' tests/ai-native-events-contracts.test.cjs` 1pass/0fail/0skip/0todo，退出0，ts-node transpileOnly=false；验证缺policy/默认停用拒绝、原退款event冻结、重复准备只计一次、原creator并发一次、提交应答丢失读取原task/run且核对零写、占位后没有task不补发、平台gate停用与subject revision撤销。旧CB08通知/退款原事务断言也在此同项运行。没有实际调用模型、支付或网络。

过程中先出现locationScope闭包缩窄/gates数组的TS类型错误；接着事务替身不能structuredClone Prisma.Decimal，并需明确支持原creator授权复验中的独立订阅只读事务，均修复后该同项通过。最后补旧inputRef未知保留时发现randomUUID模板字符串类型过窄，标明string后再次同项通过；未隐藏失败、未改原creator创建逻辑迎合替身。替身不是MySQL锁/隔离证明。

离线命令沿原两个preload、固定无效DATABASE_URL；audit=`output/cb09-automation-audit`，AI_OFFLINE_WRITE_ROOT=本树，TEMP/TMP=原output/inspection-lb05-tmp。本树隔离Prisma生成退出0，schemaHash=`afed8e6386cc9306ad0e3a0240f1a3af9dca6cdc8ed5e4655c917e3a4f28d304`、guardViolations=0、sharedArtifactsUnchanged=true。未执行迁移、置备生产政策、安装、读.env、启动服务、外联、push或合main。真实MySQL FK/并发/故障、UTC跨日/限额深测、生产政策管理与宿主接入仍未验；未称整个CB09/AIN自动化验收完成。

Runtime仅可驱动上述显式服务；恢复必须保持原event、input、creationKey和unknown，不拥有事实、授权、准入或任务收据。Provider SDK继续只在原Gateway边界；本包零模型调用。回退停用显式模块/政策，保留原input/task/run/event；不清理历史输出、不因切引擎创建新任务。人类关闭/反馈学习、其他事件类型与真正审批/执行消费者仍是后续功能，不能把本包元数据任务称自动执行闭环。

## 2026-10-08 固定公共依赖接入

仅消费主线 `64e9c6cc4302b578d2b3b0bb9f6140f2f2322d65` 的 `prisma-knowledge-policy.source.ts` 精确生产差异：用isDeepStrictEqual比较row.resource与请求resource，保留resourceKey/grantKey及全局/历史收据指纹。没有复制主线schema或其活动文件。既有formal-authorization小冒烟一次3pass/0fail/0skip/0todo，实际ts-node编译与diff check通过；沿原离线preload，audit为本树output/cb-policy-key-order-audit。未在B重复新增主线键序测试，不冒称真实MySQL验证；这是等价公共依赖，主线不要反向重摘。

## 2026-10-08 CB08：通知与退款明确失败的事务Outbox

基线54e7cd27；主线已确认原通知仓储、原payment退款事实方法及最小模型/迁移认领。只覆盖本完整子包notification.failed/refund.failed，不把交付资源风险、归还异常、开业缺项或CB09自动化声明已完成。

- 原RentalNotificationLog与RentalPaymentRefund新增UnsignedInt revision，默认1仅表示升级起点、不推断历史。通知insert默认1、claim/update原子递增；退款create默认1、成功/入账/待恢复/accepted/明确失败/未知更新均原子递增。唯一外部历史入口rental-snapshot-backfill.service的upsert(update:{})不改，不回填事件。旧头变化会使失败候选失效，未用attempts或时间戳冒充version。
- 追加 `20261008123000_ai_business_failure_events`：两原表revision和scope+id唯一索引；AiBusinessFailureOutbox持久最少源引用/revision、固定failureCode、源因果hash、dedup键、发生/到期时间及status/attempts/lease/fence/重试时间。workspace与两原事实均scope复合FK，CHECK限定恰一资源及状态/计数，24小时候选有效期、最多3次处理。无通知正文/收款信息/供应商错误正文入事件。
- `PrismaBusinessFailureOutbox.notification/refund(tx,scope,id)`只从同一tx重读原事实；notification接受delivery_failed或不再计划重试的failed，排除模拟；refund只failed且无成功/入账事实。pending/accepted/delivery_uncertain/资金待恢复不产生明确失败事件。traceId/causationId明确由原fact身份/版本确定性派生，不冒称原HTTP trace。
- `RentalBusinessFactRepository`第二参数和`PaymentRuntimeService`第四参数可选BUSINESS_FAILURE_OUTBOX，未注入保持原业务路径且不访问Outbox；显式启用时原事实写入/读回/事件在一个事务，Outbox失败回滚该事务并向原调用链报错，不事后append、不假成功。通知原幂等catch只包create，不吞事件写失败。退款非成功结果CAS绑定原revision，迟到失败不能覆盖已推进的成功事实。不改金额、资金算法、签名、出网或原重试规则。
- 实际入口 `composeBusinessFailureEvents` / `BusinessFailureEventsModule.register` 返回已接participant的原notifications/payment实例和candidates；宿主需显式使用这些实例/导出token，未注册根模块/worker。候选 `prepare({eventId})`、`read({eventId})`、`preparePending({limit:1..10})` 使用原ApiAuthGuard+独立ALS，通知沿原notification-logs权限及原通知范围函数，退款沿原finance GET并复用Core.getOrder当前范围检查。每次重读源状态/revision和当前身份；候选输出复用AiBusinessEventDraft，taskCreated=false，仅human_review，不等于执行许可。
- 原子claim/fence、10秒处理租约、有界重试/死信/过期语义已接实际候选消费；应答未知读原event，不换源id。并发同事件只领取一次，成功回执推进revision后旧候选expired。队列候选状态不会发送通知、退款或模型调用。记录开启后的事务失败策略不等同于生产已启用；关模型不触发任何新外部调用。

仅在原 `tests/ai-native-events-contracts.test.cjs` 增一项CB08实际组合小冒烟，未新增脚本或大矩阵。覆盖原通知回滚/明确与未知区分、实际Guard候选/并发单领、成功后旧建议失效、原退款未知/明确失败/成功、撤权与默认未注入；最终1pass/0fail/0skip/0todo退出0。首次0/1在失效读回处误把整行作为scope展开，修为显式tenant/workspace后仅复验同用例。TS编译随transpileOnly:false启用；之后仅整理通知方法缩进，diff check0。

原隔离Prisma生成退出0，guardViolations=0、sharedArtifactsUnchanged=true。冒烟沿原preload+lane-b-local-runtime，固定无效DATABASE_URL，本树绝对output/cb08-events-audit与原TEMP/TMP；`node ... --test --test-name-pattern='CB08' tests/ai-native-events-contracts.test.cjs`。真实AuthService/ApiAuthGuard/原仓储/Payment方法/Outbox/候选组合运行；DB事务、身份存储、Core事实、资金记账外部端口均显式替身，未发HTTP/DB/DNS/模型/支付。未执行迁移，真MySQL FK/锁/故障及3次重试/死信深测、真实回执、宿主接入后补，不冒称已验全部分支。

Runtime可替换驱动，不替换原fact revision、事件id/dedup、claim fence与当前业务授权；checkpoint不能当事件提交/业务成功或任务创建。Provider SDK本片不调用，仍归原Gateway；回退停止显式participant/消费者且保留事实和原event，未知不换键。CB09所需独立automation政策/主体及原task创建端口未在本片伪造，候选材料不是shadow task。

## 2026-10-08 CB06：原人类确认到实际准备包的组合证据

按主线续派，复用全部既有Memory生产服务，没有新增wrapper/确认表/默认授权。原file-runtime完整功能用例现在用同一正式Prisma政策组合实例验证：无Memory政策的propose拒绝→精确owner/逐revision政策→实际propose/confirm/confirmationStatus→preparation.collect(includePreferences=true)/revalidate→原revoke/state读回→旧准备包拒绝→重新收集不含被撤回偏好。scope/base与每个memory revision均为独立持久policy行，不用一个通用grantKey冒充。同一请求的Auth/credentials与Knowledge保持一致；确认仍由原Memory consent事务生成，测试没有手填confirmed状态。

沿同一预加载及固定无效DB执行原file-runtime `--test-name-pattern='first creation'`，本次一次运行1pass/0fail/0skip/0todo，退出0；audit为本树output/cb06-consent-input-audit。DB、身份会话、政策置备、存储仍是显式离线替身，原Prisma政策读取/授权服务/确认事务/收据/输入生产消费均为真实代码；无新增生产修复，不把本片验证当新增功能。源码类型检查随ts-node启用，diff0。A已收到原合同与8c3d8b42依赖，实际模型派发/结果来源读回仍由A独占接线，未在B伪称已执行。

Runtime与Provider边界保持：确认/撤回属于原业务事实，知识/偏好只放独立untrusted_data输入分区，不能改Core事实、工具、预算或批准；Runtime重启/替换不能把旧已撤回准备包重新授权。本片没有模型SDK调用或框架安装。

## 2026-10-08 CB07：精确资源政策的实际消费

基线dd6b8ea2。A确认原prepareHeldRun还未消费Knowledge/Memory，本线已交collect/revalidate真实固定接口及限制，A在自己的冻结/结果/来源入口接续，B未写scenes。

发现原PrismaKnowledgeSelectionAdapter将每文档search grant与scope search grant全等比较；HumanKnowledgeService.list对metadata也有同一错误。正式Prisma政策的grantKey包含各自resource，所以合法文档也被拒绝。修复为scope政策保持自身前后复验，每文档政策与其自身读后grant比较，list保存每文档指纹并在最后返回前再次核对；不把不同资源的独立授权合成同一个grant，不改正式policy源或旧receipt指纹。

在原file-runtime完整生命周期用例中增加实际 `management.list → preparation.collect → preparation.revalidate → 精确来源政策撤销拒绝`。定向命令同前两节，仅追加 `--test-name-pattern='first creation'`，audit改本树output/cb07-policy-consumption-audit；最终1pass/0fail/0skip/0todo，退出0，非全文件或全专项验收。最初0pass/1fail源于原离线list替身捕获事务回滚前的Map，已改为每次读取当前db.state.documents；没有隐藏失败或放宽生产权限。没有单独运行旧生产代码红测，不伪报红绿证据。实际ts-node类型检查及diff check通过。真实MySQL JSON键序/索引、正式policy置备、A模型执行闭环仍未验。

本片接口不变，A应复用主线已经接回的HumanKnowledgeInputService及正式policy组合再加此两文件消费修复；不需为了只读chunks重复摘首建文件链。Runtime驱动与Provider SDK均不获得知识授权裁决权，旧包撤权后拒绝而非替换为新来源；回退本消费修复会恢复拒绝行为，不迁移或重写历史operation。

## 2026-10-08 CB05：版本附件接回原revise

依赖固定 `49fc07841b663370b1b71135d42e5614b95c115b`，主线确认继续同一Knowledge/storage分支认领；本节解除上一片“新版本附件上传未实现”的代码缺口，其他未验边界保留。

- 同一 `uploads` 增加 `beginRevision({documentId,targetVersion,expectedRevision,fileName,mimeType,sizeBytes})` / `completeRevision({documentId,targetVersion,expectedRevision,sessionId})`。当前旧documentVersion/aclRevision由原PrismaKnowledgeRepository读取，不由客户端填充；原head revision、未结束parse、deleted或同版本目标均拒绝。upload精确政策新增 `revision:{documentVersion,expectedRevision,aclRevision,targetVersion}` 绑定，已有版本不复用。
- `FileBusinessOwner.knowledgeRevision` 只在受权服务端装配中传递，原FileAsset metadata保存同一合法上传意图（不是授权凭据）。版本上传键由docId与targetVersion派生，同租户同版共用原唯一键，同版异文件或跨workspace拒绝；旧首建派生键及“已有文档拒绝首建”保持。原complete事务前后重验source head/ACL，重放读取原completed session；不能换成最新head或假报文档已更新。
- 文件端口 `assertBound` 增加目标documentVersion/expectedRevision，新附件必须与上传时的source快照、target版本一致。原KnowledgeDocumentService.newVersion在入口和save提交前都复验，随后仍调用原revision CAS、version唯一性及immutable operation；不新建版本提交器。原revision操作重放发生在再次绑定前，不重写已提交版本。正文reader再核对附件目标版本与当前文档相符。
- 原file-runtime测试增加一项完整版本链：无版本upload政策拒绝→并发同版共用session→同版异文件拒绝→首建complete不能消费版本附件→source头/ACL变化拒绝→完成事务应答丢失按原session恢复→原revise/原receipt重放→新版本解析→附件不可改投第三版，未旧版本重用。最终6pass/0fail/0skip/0todo、退出0；首次运行因TS interface与Prisma JSON结构不兼容编译失败，改为字段结构化复制，未用unknown强转绕过。实际ts-node类型编译启用，diff check0。

命令仍是上一节同一测试文件与两个preload，固定无效DATABASE_URL；本次AI_OFFLINE_AUDIT为本树绝对output/cb05-revisions-audit，TEMP/TMP沿原目录。真DB、S3、HTTP/DNS、模型和迁移均未执行；无schema或共享产物修改。测试串行事务替身不能证明MySQL锁隔离。主线已收到公共policy使用JSON.stringify指纹的JSON键顺序兼容隐患：本片不全局改指纹、重算历史收据或迁移政策。

Runtime继续复用原上传session与Knowledge原operation；切引擎不重新begin/complete或给unknown parse换键。SDK仍只可替换受控对象传输，模型调用/权限/原业务收据不迁移。回退停用显式组合即可，保留已有版本和原上传事实。物理附件删除/保留策略、正式政策置备、分布式失效和真实S3不可变版本仍待后续，不称CB05整项验收。

## 2026-10-08 CB05：首建上传与非URL正文源（Claude接续）

基线 `bea3d85d8eacf043c6149c6dabc638cb4efdc1ec`，本会话唯一施工树仍是 codex-ai-native-lane-b；主线确认本片独占 FileStorageRuntime 的 Knowledge 分支和新增 knowledge-object-reader。原 inspection reader、其他文件业务、Auth/Guard/Core、根模块、schema/迁移及shared总出口均未改。历史output与原开发建议保留。

入口 `composeKnowledgeFileApplication` / `HumanKnowledgeModule.registerFiles` 以实际Auth、当前request-bound credentials、Prisma精确政策、原FileStorage及独立正文producer组成同一管理/index/context/input包，新增 `uploads.begin({documentId,fileName,mimeType,sizeBytes})` 和 `uploads.complete({documentId,sessionId})`。仅支持首建、S3-compatible、UTF-8纯文本/Markdown，最大262144字节。装配不读配置、不启动HTTP/worker/上传清理生命周期；服务端必须为每次请求绑定独立credentials，不能用可变全局会话源。

- 首建不伪造KnowledgeDocument占位行。原FileAsset+FileUploadSession就是上传意图，原tenant+idempotency唯一键是持久冲突边界；键由服务端取 `knowledge.` + SHA256(documentId)，不含workspace，故同租户跨空间同目标冲突。客户端不能提交metadata/owner/scope/任意key。upload正式政策精确绑定当前actor/audience/scope及 `{upload:{documentId,idempotencyKey,fileName,mimeType,sizeBytes}}`；没有政策行不上传。documentId只是待核验选择，不是授权。已有文档（包含其他范围）拒绝首建，不能用本入口替换已有文档附件。
- 原事务创建pending资产和session，服务端只写原workspace/上传人及 `knowledgeUploadVersion:1` 绑定标记；不在metadata存正文或授权。只有原completeUpload对象存在检查和CAS成功才active/completed。完成前后与create消费前复验当前身份和绑定；其他空间/人、自由metadata、缺存储、未完成上传都拒绝。并发/应答丢失继续使用同一目标派生键，读回原session；待上传重放仅为原session重签PUT，不新建第二上传。过期/失败session不会自动更换键或接管目标，需人工处置。
- `FileStorageRuntimeService` 第五参数 `KNOWLEDGE_FILE_ACCESS` 是必需Knowledge授权/读源（其他原业务仍用原构造参数）。`PrismaKnowledgeFileAccess` 复验当前Auth/政策/文档，`TenantKnowledgeObjectReader` 独立核验Knowledge文档、业务附件和completed session，仅复用原inspection文件的纯SigV4请求编码，绝不复用rental_order权限。旧readKnowledgeBytes的presign GET已移除；正文走无query header-auth GET、原出网限制、8秒读取边界、逐块大小限制与实际字节hash；不接受URL/路径，不返回存储凭据。配置/资产/文档/当前政策读后复验，取消不等待不合作provider清理。
- 已接原create→parse→index→publish→preview→withdraw及原parse/operation收据。授权撤销后的读取不返回已缓冲正文，parse admission保持pending/unknown；reconcile不重读对象、不重解析。通用下载URL和物理删除入口拒绝Knowledge资产：受权来源读取走知识服务，文档撤回/删除走原生命周期；物理存储留存/清理政策并未因此实现。

复用 `tests/ai-native-knowledge-lane-b-file-runtime.test.cjs`，没有新增测试脚本。最终5pass/0fail/0skip/0todo，退出0；之前一次类型编译失败（原session key可空，已明确拒绝为空的知识key）、一次4pass/1fail（同步strict输入拒绝的测试断言用错，已修复），没有隐去失败。运行时ts-node为transpileOnly:false，实际新增组合和生产源码类型编译通过，非全API验收；git diff --check退出0。覆盖完整原生命周期、并发同目标、响应丢失原session恢复、不同payload/跨workspace/自由metadata/未完成/无policy/无存储拒绝、撤权后原parse核对、超限和不合作取消。

命令：NODE_ENV=test；DATABASE_URL固定 `mysql://offline:offline@127.0.0.1:1/rental_os_offline`；AI_OFFLINE_AUDIT为本树绝对output/cb05-files-audit；TEMP/TMP为本树绝对output/inspection-lb05-tmp；`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-knowledge-lane-b-file-runtime.test.cjs`。DB/Auth、集成配置、上传HEAD结果和transport/egress明确替身；真实政策读取/上传事务调用/正文reader/Knowledge仓储及管理组合使用生产实现。未连接真实网络/DB/S3/模型，未安装、读.env、执行迁移或改共享产物；未push/合main/生产启用。

边界：本片解除首建循环和非URL正文代码缺口，不等于整个CB05验收。新版本附件上传、原文件的物理删除/保留策略、可信政策管理/置备入口仍缺。正文实际hash只反映本次读到的字节，不冒称存储不可变versionId或以调用者documentVersion代替实际hash；已解析结果是原持久chunks。真实MySQL竞争/锁、S3签名/存储对象版本与当前授权跨资源原子性、多实例传播仍未验。

Runtime替换只驱动uploads/management/index等稳定服务，原session、Knowledge operation/CAS/generation与正文授权仍由系统持有；checkpoint不能当上传完成或解析收据。Provider SDK不进入知识服务，本片S3对象传输不是模型调用，未来只能替换独立对象IO与签名实现并保留出网/取消/限额；不得借此新增Gateway派发路径。回退停用显式组合，不删除已上传资产/原收据，也不因切换引擎重解析unknown操作。

## 2026-10-08 正式S3生产者固定接入与显式模块

仅接主线固定`41381429454bcebbc061056cb95be739ad701055`，本树映射`4c2916ce`；未重放主线接回的媒体消费者历史。新增`InspectionObjectReaderModule.register(db, integrations)`，导出原`INSPECTION_OBJECT_READER` token；缺实际delegate或runtimeConfig立即STORAGE_UNAVAILABLE。宿主显式import该动态模块后，在宿主模块中提供现有FileStorageRuntimeService（第四参数注入该token），将同一storage实例交给既有InspectionAssistModule.registerStaffRequests的storage依赖。宿主handler使用factory.open，并在finally close；本片不注册根模块、HTTP、worker或FileStorageRuntime启动生命周期。

现有媒体测试增加真实Nest application context取得token的断言，构造/装配零配置读取，关闭容器；既有正式生产者→FileStorage→媒体消费仍在同一文件验证，未新增脚本。固定依赖接入时原9pass/0fail/0skip/0todo，退出0。模块红测0pass/1fail退出1；实现中import顺序错误导致8pass/1fail退出1，已修复，最终9pass/0fail/0skip/0todo退出0。使用既有local-runtime/offline-preload、固定无效DATABASE_URL及本树绝对audit/TEMP。实际运行时类型编译通过，不替代全API noEmit；diff check退出0。

CB01的S3对象生产者不再记为仅接口；只支持s3_compatible及已验证配置。仍未验证真实S3、DNS、MySQL、设备或供应商签名兼容；CB03媒体Gateway、Knowledge专用首建/文件、Outbox/影子、员工HTTP及品类适用批准缺口保持，不宣称整项完成。

## 单来源正文的数据库侧定向读取

`PrismaKnowledgeReadAdapter.chunk`保留scope/document/version关系限定，按持久JSON中的实际chunkId查询，take=2检测重复逻辑标识；不再为一条来源读回整版正文。数据库随机row.id不是逻辑chunkId，不作混用。读回仍验证JSON、正文列、定位、当前head及当前授权。没有修改schema或公共契约；JSON过滤仍可能扫描该版本，真实MySQL性能和索引优化未验。

复用原persistent-content冒烟和DB替身，无新增测试脚本。先在原正常路径增加查询形状/上限断言，红测0pass/1fail/0skip/0todo，退出1；实现后使用既有local-runtime与offline-preload，定向选择`actual repository|scope, actor|revocation and head|corrupt body|bounded reads|a caller changing`：6pass/0fail/0skip/0todo，退出0，含ts-node实际类型编译。不是全文件或全API类型验收。`git diff --check`退出0。未连接数据库、存储、模型或网络。

依据20261007总册CB-01～12；唯一树codex-ai-native-lane-b，分支ai/codex-ai-native-lane-b-20261007。本记录不更改中央完成率、不宣称任何AIN验收完成。原作者已由负责人确认停写；保留全部继承历史、源码及output。本次未合并移动主线、未改其他树、没有MERGE_HEAD。

## 已提交的接续功能

| 固定提交 | 实际变化 |
| --- | --- |
| 27fe3967 | per-item prepareReview形成manual_review_only材料，多资源订单仍可人工审阅；这种材料不可调用原订单级检查提交 |
| 618b7bcb | 草稿列表在DB查询阶段绑定完整allocation/stage/template目标，而非只按订单查询 |
| ca9c54f5 | 继承的Knowledge module WIP核对后独立提交，显式导出同一Memory consent实例 |
| 1b385339 | 原平台CAT-GOV Guard/preview gate/DTO/service草稿创建、分区CAS修改、校验和影响审阅应用；不发布或采用 |
| 9c61df7c | 员工请求级factory和显式模块，独立凭据、关闭释放、实际草稿读写；不开放HTTP |
| 01686ef5 | 正式Knowledge/Memory政策组合接入opt-in模块；修复持久Memory owner独立对象导致合法操作恒被拒绝 |

本记录所在提交还修复CB-01媒体读取的清理阻塞：取消会拒绝正在等待的read，provider cancel仅尝试一次并观察错误，不再无限等待其清理应答，释放reader锁。取消不代表外部存储已完成清理。没有新增测试脚本，只在原媒体冒烟补不合作cancel场景。

## 按原工作包核对，不缩减任务范围

| 包 | 当前代码事实 | 尚未闭合的原要求 |
| --- | --- | --- |
| CB-01 | 原FileAsset/上传/业务绑定、持久EvidenceBinding、媒体hash/尺寸/时长和有界reader；清理阻塞已修 | INSPECTION_OBJECT_READER仅接口和可选注入，没有正式存储生产者；不能说真实附件读取已装配 |
| CB-02 | 实际当前身份/阶段动作授权、Prisma草稿CAS、精确operation、人工更正/采用/拒绝、目标隔离 | 独立正式草稿/识别动作政策若与原订单动作不同，须公共认领人定映射；不是GET授予写权。真实多人MySQL并发未验 |
| CB-03 | 持久识别输入准备、严格候选与来源校验，明确caller_supplied_not_model_execution_proof | 实际媒体Gateway输入、invocation与结果证据绑定未实现；当前仍CAPABILITY_UNSUPPORTED，不能伪称OCR |
| CB-04 | 原Controller+Guard+独立ALS+DTO+精确Core收据→提交/核对→草稿关联；读回失败不重提 | 真实Core/数据库/设备未验；多资源review材料不能绕过原单资源提交限制 |
| CB-05 | 文档生命周期/当前人类管理/持久检索/来源重授权/索引generation/收据恢复已有 | 正式动作政策与合法文件bytes生产者未齐；单进程缓存不等于分布式失效 |
| CB-06 | propose/change/confirm/read/revoke/delete及确认中断恢复、已确认偏好有界消费；正式模块已接 | FormalMemoryPolicySource仍由公共正式政策源提供；测试政策不是生产许可 |
| CB-07 | HumanKnowledgeInputService.collect/revalidate已有总预算、知识/偏好分区和当前复验 | A/R真实冻结输入消费者尚未在本树接入，不可修改其独占目录或把包生成称已派发 |
| CB-08 | shared AiBusinessEventDraft/AiBusinessDeliveryDraft已存在；原通知有自己的业务outbox | 尚无AI业务事件持久模型/原事务生产hook/有界消费者；不能把旧通知投递表冒充完整事件总线，需要先协调同事务写点和正式资源版本 |
| CB-09 | shared AiAutomationPolicyDraft已有有限主体、scope与模式 | 尚未实现持久影子任务生产/政策消费；依赖CB-08、正式automation授权/政策及R任务入口，不能伪造task或借人类session |
| CB-10 | composeInspectionAssist与StaffInspectionRequestFactory已可消费真实服务，关闭隔离；共享检查叶子已有 | 原员工route白名单、公共输出/错误运输与正式媒体能力仍待主线；没有HTTP可用声明 |
| CB-11 | 原平台治理草稿/校验/差异与影响审阅接通 | 适用P批准与发布/租户资格/空间采用入口未装配；不把原preview环境门切成生产开启，也不用订单审批代替品类批准 |
| CB-12 | 随功能复用原少量越权/回放/unknown/释放等冒烟；旧评测语料保留 | 跨线最终集中验收待正式功能链；未有独立审查、真库、供应商或设备证据 |

## 需主线协调的精确接入点

1. 文件生产者：`inspection-assist/inspection-media.reader.ts`的`INSPECTION_OBJECT_READER`：`open({tenantId,workspaceId,fileAssetId,provider,storageKey},signal):Promise<ReadableStream<Uint8Array>>`。应来自已验证配置和真实对象读取，支持关闭与取消；不得把模型URL或签名下载URL喂给fetch。本树`FileStorageRuntimeService.readInspectionBytes`已有业务/上传/对象及读后版本复核，生产者到位后原注入点直接消费。现有`readKnowledgeBytes`内部仍走presign GET+fetchWithTimeout，不能将此路径宣称为本批要求的非URL正文生产者。知识需要当前业务附件绑定与有界bytes，不新增另一存储平台。
2. 动作政策：`knowledge/formal-knowledge-authorization.adapter.ts`的`FormalKnowledgePolicySource.resolve`与`FormalMemoryPolicySource.resolve`。必须返回当前actor/audience/scope、action、revision/expiry、requiredPermissions/grantKey及具体资源绑定；本线adapter重验真实Auth。没有正式政策不能用owner、任意ACL字符串或测试grant补齐。
3. 媒体模型：本树`model-gateway.ports.ts`的真实ModelRequest.messages.content仍是string、features仅tools/structuredOutput/streaming。需要主线提供实际媒体intent、可信内容/version/hash绑定、唯一invocation/dispatch/usage证明及结果恢复合同。识别服务prepare中的unavailable保留，不能自改Gateway或用文本图片描述替代。
4. 输入消费：A/R在实际冻结材料前调用现有`HumanKnowledgeInputService.collect`，在真正消费点调用`revalidate`。返回包仍不是派发授权或原子快照；变化要求重收集，不静默替换。主线指定固定消费提交再整合，本线不写A/R。
5. 可靠事件：原通知事实入口在`rental-core/rental-business.service.ts:sendNotification`和`rental-business-fact.repository.ts:insertNotificationLog/updateNotificationDelivery`，已有通知投递租约/幂等不等同AI事件。交付风险、归还异常、退款失败和开业缺项需各自原事实事务的唯一作者提供eventId、scope、resource.version、trace/causation与dedup键的生产点。总册要求先报精确文件由主线协调；本线没有改上述Core文件，没有用事务后append冒充原子Outbox。AI事件模型/消费者仍属于未实现代码，不能仅写“环境未验”。
6. 影子链：在事件提交点明确后，需正式automation身份/动作政策与R受权任务创建/去重端口；模式仅disabled/shadow/manual_confirmation。没有这些依赖不创建影子假任务，不做通知或退款副作用。
7. 员工宿主：`InspectionAssistModule.registerStaffRequests`导出factory，服务器绑定header和requestId后`open`，handler的finally调用close。原员工白名单/正式运输和动作政策由公共认领人装配；不从业务body接scope/actor。close不证明已提交操作被撤销，继续按原operation核对。
8. 品类：`category-assist/category-draft.application.ts`复用原`rental-core/category-governance.controller.ts`及service。发布/采用必须由主线/P给适用品类的明确人类确认/批准接线；原订单批准与租户operator均不能授予平台治理权。本树不改原CAT-GOV内核。

## 这次媒体片的实际验证

`node --test tests/ai-native-inspection-media-submission.test.cjs`：8pass/0fail/0skip/0todo，退出码0。没有新增脚本、全仓回归或测试框架。原用例驱动真实FileStorage runtime/检查服务/仓储适配；Auth、数据库、对象流与原Core外部边界按现有fixture显式替代。追加cancel不合作场景用受控Promise与setImmediate事件循环边界，没有sleep。没有单独运行旧实现红测，不伪报红测数量。

Node preload为本树`prisma-offline-preload.cjs`和`lane-b-local-runtime.cjs`；DATABASE_URL固定mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT为本树output/cb01-cleanup-audit；TEMP/TMP为本树output/inspection-lb05-tmp。非transpileOnly加载源码检查通过，非全API tsc；git diff --check退出码0。各提交此前命令与分阶段计数见自己的切片，不将它们相加伪装最新全量结果。

## 替换与回退

业务授权、Prisma草稿/确认/原operation和来源引用不依赖LangGraph checkpoint或Provider消息类型；将来Runtime仅替换驱动，Provider仅在唯一Gateway适配。不得替换账本/确认/业务幂等。回退新宿主装配不撤销已提交检查或确认；仍凭原Core/Memory收据读回。不安装框架/SDK、不改线上开关。

剩余均需上述正式跨线政策/存储/媒体/原事务或消费合同，不以继续新增孤立wrapper、影子表或报告当作闭环。移交时请提供固定依赖提交与唯一写入者范围；不追活动HEAD。本线合法功能交付不是整个CB队列或AIN验收完成。
# 接续：底层预览及来源枚举撤权竞态

## Memory 确认详情迟到读取

实际复现 `PersistentMemoryConsentService.confirmationDetail` 最后一次 Memory 读等待期间撤销身份或正式同意，仍返回旧 confirmed 证明。修复为复读确认记录并比较原证明，最后再次执行现有当前身份/Memory read 动作授权；不改变撤销与删除语义，不创建新确认。

原 preferences 测试内增加一项两分支负例，无新脚本。红测 1 pass / 1 fail、退出 1；修复后 preferences + consent 两文件 4 pass / 0 fail / 0 skip / 0 todo、退出 0。使用既有本树 runtime/preload/固定离线数据库地址及本树临时路径，ts-node 类型检查启用。仅数据库/Auth替身，未验 MySQL 或真实权限政策配置；读后复核不宣称原子跨资源快照。

## 固定主线依赖接入

接入主线固定 `1faf979674efefb028b108ad045d5bd125796135`，本树对应 `84966d0c`。仅同步该七文件切片，未合并活动主线；两处 formal adapter 冲突逐块采用主线完整资源指纹比较，保留本线所有其他功能和失败断言。schema/追加迁移均来自主线原切片，本线未扩展模型。显式入口 `composePrismaFormalHumanKnowledge` 已可消费持久精确政策，缺行/停用/过期仍拒绝，未提供政策管理生产入口。

隔离 Prisma 生成退出 0，`guardViolations=0`、`sharedArtifactsUnchanged=true`。原 formal-authorization + input-composition 两文件 5 pass / 0 fail / 0 skip / 0 todo，退出 0（实际政策源、实际身份 adapter 与旧知识/记忆组合，外部数据库/Auth为离线替身）。未执行迁移/播种/服务启动，未验 MySQL/正式政策配置/文件存储。主线仍在补首次文档附件业务生命周期，未要求本线自行造正式授权。

实际复现 `PrismaKnowledgeReadAdapter.previewChunks/listSources` 等待 chunk 查询期间发生撤权/撤回仍返回旧结果。现已在底层返回前复读持久 head，并比较当前授权 grant；预览初始状态已 withdrawn 时也拒绝，合法 parsed draft 预览仍保留。未修改主线政策/组合/Gateway/结果读端。

在原 `ai-native-knowledge-persistent-content.test.cjs` 增加一项含四种组合的受控回调负例，无新测试脚本。红测 0 pass / 1 fail、退出 1；修复后用 `--test-name-pattern` 定向运行本项和原来源读取、scope绑定、撤权场景，4 pass / 0 fail / 0 skip / 0 todo，退出 0。名称过滤为限定验证范围，不是全文件或全量验收。使用既有本树 local runtime + offline preload、固定无效 DATABASE_URL、本树 audit/TEMP；ts-node 类型检查启用。真实 MySQL/FileStorage/多实例仍未验。读后复核不是跨资源原子授权，正式动作政策仍需主线提供。
