# CB05/06/07/10 后端实际消费续接

施工树 codex-ai-native-lane-b，分支 ai/codex-ai-native-lane-b-20261007。固定整合基线 `b0c36a920f44bb5bab67afc2389c6bf14caa01a0`；开工 tracked/index 干净、无 MERGE_HEAD，历史 output、stash 和具名前像未动。本批只续后端，不改页面、公共合同或主文档，不计算 AIN 完成率。

## 第一片：知识管理的原索引消费者

核查已有 CB07 实际链：`composeKnowledgeFileApplication.sceneKnowledge` → `composeOriginalSceneKnowledge.collect/revalidate` → `original-scene-model.composition` 的原 publisher/计划。已有输入、文档正文、版本、ACL 与确认偏好复验，未复制第二输入存储或修改 scenes/runner/Gateway。

实际缺口：当前人类知识管理请求 factory 暴露 parse/publish，但没有接出原索引 request/status/resume。现同一私有当前会话中复用 `HumanKnowledgeIndexService`，在 `HumanKnowledgeManagementRequest` 增服务器实例方法 `indexStatus({documentId})`、`requestIndex(原 index request)`、`resumeIndex({documentId,operationId,generation})`。status 只读；request/resume 保留原逐动作 index 授权、CAS、原收据与 generation；不自动调用、不创建 worker。关闭请求后拒绝调用。没有添加 HTTP route 或 shared 字段，HTTP 索引映射仍待主线正式合同，不冒称前端已能调用。

只改 `knowledge/human-knowledge-management.composition.ts` 和原 `tests/ai-native-knowledge-lane-b-file-runtime.test.cjs`；原完整生命周期测试改经实际 factory 索引消费者推进，继续验证正式政策/原文件读取/确认偏好/原场景快照。补原撤回后旧 upsert generation 拒绝、同 remove 任务接续、逻辑删除和物理删除未验证分开、close 拒绝。未知仍核对原键，未扩大测试矩阵或新脚本。

定向：`node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='first creation uses original upload receipt' tests/ai-native-knowledge-lane-b-file-runtime.test.cjs`，最终 1 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，exit 0。

API compiler API noEmit：原严格选项，内存 rootDir/baseUrl 本树，shared 源码与本树私有 Prisma paths；根 `human-knowledge-management.composition.ts`，842 files、0 diagnostics、exit 0，无生成物。diff check exit 0。

所有 Node 使用原 prisma-offline-preload、固定无效 DATABASE_URL，write-root/audit/TEMP/TMP 位于本树绝对路径，禁 compile cache。数据库、文件对象传输/上传成功证据为明确替身，不是真实存储/MySQL/HTTP/模型验收。未读 .env、安装、启服务、迁移、推送或生产启用。正式政策未置备仍拒绝；关系索引不是分布式外部索引清除。

下一片：当前人类记忆管理到明确选择与消费前复验；复用原 consent/receipt/head，随后补员工原结果与人工办理实际消费。每片只暂存明确文件，旧成果不回灌。

## 第二片：当前人类明确选择偏好与消费前检查

改 `persistent-memory-consent.service.ts`、`human-memory-management.composition.ts`，仅扩同一原 file-runtime 测试的人类记忆用例。服务器请求实例现接 `selectPreferences({kinds,limit})`、`revalidatePreferences(原选择)`、`confirmationDetail({memoryId})`，不新增 HTTP 或共享合同。复用原正式政策与确认仓储，所选数据绑定当次 owner/audience/workspace、原记忆 revision/ACL/确认 ID/具体值/期限；消费时重新读取同值，撤销/改变后拒绝而不替换为最新值。

原 selectPreferences 仍有界查询/确认读取；保留 requestedKinds，新增明确 scope/owner/audience 和 limit，以及 returned-items-only 歧义。只选明确 kinds，不默认带所有偏好，重复 kind/ID 或篡改范围/内容拒绝。冲突偏好仍需人类选择，不决定业务资格/价格/地点授权。选取前后当前身份及每项原动作授权复核；这是有界复验，非多资源事务或永久授权，主线真正冻结/派发仍复核。

定向 `node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='memory management request uses persisted' tests/ai-native-knowledge-lane-b-file-runtime.test.cjs`：1 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，exit 0。原 factory/controller→正式持久政策 adapter→consent/仓储，验证选择、原确认详情、同材料复验、跨空间/内容篡改拒绝、撤销后旧选择拒绝/新列表为空、关闭请求拒绝，继续原 modify/delete/原操作核对链。事务与 Auth/文件为离线替身，不冒称真实授权部署或存储通过。

同原严格 compiler API noEmit，根 human-memory-management.composition.ts：772 files、0 diagnostics、exit 0；diff check exit 0，无生成物。未修改 human-knowledge-input/context 或场景 publisher，无新模型调用/执行/确认生产捷径。环境约束同第一片。

## 第三片：原识别保存收据与当前人工审阅的后端消费

改 inspection-assist.composition.ts / staff-inspection-assist.controller.ts 与原 inspection-media-submission 两个 image/audio 场景。`saveRecognitionReview` 仅调用原 recognitionResults.save，再联读原保存收据与当前 drafts.readReview；`readRecognitionSaveReview` 是纯原键读取，不保存候选、不重新识别、不提交检查。原操作收据与当前头经过两次读回指纹比较、当前 bind/来源/版本政策复验。`savedRevisionMatchesCurrent` 明示旧收据是否与当前头同修订，人工 edit 后 false，不复活旧字段。

真实员工 Controller 现有 result-save / result-save-receipt 接上述方法但仍返回原 receipt 载荷，未扩 HTTP/shared。服务组合和 StaffInspectionRequestFactory 继承显式联读入口。保存候选和采用值分开；后续必须原人工 drafts.edit，检查办理仍原 submission prepare/submit/receipt，未新造一键办理或自动采用。

命令：`node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='original inspection frozen' tests/ai-native-inspection-media-submission.test.cjs`：2 pass / 0 fail / 0 cancelled / 0 skip / 0 todo、exit 0。原 image/audio runner/持久结果/财务证据/来源验证→保存→当前审阅→显式人工采用→同原保存收据读回，人工采用为 43，保存前后人工值 42 未被识别自动覆盖；采用后旧保存修订标 false，不新派发，原未知/撤权/附件变化拒绝仍验证。Positive 使用既有 operator 测试身份与事务/模型替身，不冒称正式 staff 执行政策或真实图像语音能力验收。

源码 noEmit 根 inspection-assist.composition.ts：1090 files、0 diagnostics、exit 0，diff check exit 0。原 partial-safe 公共结果/正式 staff 新任务动作政策仍缺；unknown 不暴露候选，不私改 runner、公共政策、Gateway、预算或 Core。新增联读失败可能发生在保存已提交后，继续原 operationId 核对，不认为失败等于未写入或换键重新保存。未改任何 UI。

## 第四片：默认关闭的服务器显式 DI 出口

原 HumanKnowledgeModule 新增 `registerManagementRequests` 与 `registerMemoryManagementRequests`；两者默认空 provider/controller/export，显式 enabled=true 仍需完整原依赖。仅导出原 request factory，无 HTTP/worker/AppModule 注册，不创建活跃凭据会话、读存储或索引。每次由服务端调用 `factory.open({headers})`，原逐动作授权和 request.close 保持不变，宿主 finally 关闭；启用模块不是提供管理/文档/记忆许可。

只改 human-knowledge.module.ts 和同一原 file-runtime 测试，用模块实际 provider 获取 request factory，继续原正常链及拒绝链。定向原两项 `--test-name-pattern='first creation uses original upload receipt|memory management request uses persisted'`：2 pass / 0 fail / 0 cancelled / 0 skip / 0 todo、exit 0。noEmit 根 human-knowledge.module.ts：848 files、0 diagnostics、exit 0，diff check exit 0。不是全仓或整项验收，不累加各阶段计数。

## 完整包接入与剩余边界

提交依赖顺序：`b0c36a920f44bb5bab67afc2389c6bf14caa01a0` → `ac348553ccf314f9c6f2ddb124c8b265e4870c2d` → `1cdcadc9739338a7bc7f4dd593d11cdfc743ce21` → `157b75430fca4481cf8e76aaee5a22038cd30936` → 本记录最后 DI 出口提交（实际 SHA 由 Git 与对话交接提供）。不是重导 CB14 或旧 WIP；原 output/stash/ref 保留。

服务器使用：

- 知识 root 提供原 AuthService、db/policyDb、clock、TenantIntegrationService 与真实受控文件读取；显式模块提供 HumanKnowledgeManagementRequestFactory；每个请求 open/close，create/revise/parse/publish/withdraw/delete/operationStatus 原方法不变，新增原索引 status/request/resume 可由服务器应用显式调用。HTTP 索引路由/合同未提供，不新增公共权限码；管理政策和当前文件归属缺失拒绝。
- 模型输入继续原 `knowledge-file.composition.sceneKnowledge(includePreferences)` 交 `original-scene-model.composition`，实际材料由原 preparation collect/revalidate 和原 publisher 冻结。主体、版本、正文指纹、来源集合与确认偏好仍在原链验证。本包没有改 scenes/publisher，也没有新生产 frozen 输入/Invocation；完整正式模型派发与财务成功链不在本次证据范围。
- 记忆 root 提供原 db/Auth/clock/正式持久动作政策，服务器 module 提供 HumanMemoryManagementRequestFactory；显式 kinds 选择、保存本次材料，真正使用前 `revalidatePreferences`，变化重新收集，不静默换值。原确认/修改/撤销/删除/原操作恢复仍原方法，原确认详情单独读，不将历史收据当当前有效值。
- 员工 `StaffInspectionRequestFactory.open` 与显式 InspectionAssist 组合提供新保存/审阅联读；原 HTTP result-save/result-save-receipt 保持原载荷消费。采用/修改仍原 drafts.edit，准备/业务提交仍原 submission，读取原业务收据仍纯 readReceipt。

准确待主线事项：

1. 原 staff 新图像/音频任务需置备同一主体、scope、scene/step 的 `read_step_terminal`/执行等正式动作政策；本包不自动发布政策。具体入口为 task-authorization.composition 与 composeInspectionRecognitionTaskHost 所需依赖。
2. `runner/ai-task-result.repository.ts` 的 AiTaskResultProjection 仅 succeeded/failed/unknown；缺 partial-safe 持久可读内容/完整性合同，unknown 不能保存或展示截断候选，本线不扩公共状态。
3. 多 allocation 原准备只允许 manual_review_only；原 OriginalInspectionApplication/Controller/Guard/Core/receipt 与签名/模板/资源条件必须真实提供，不以候选或保存收据授予 order-wide 提交。
4. 知识 HTTP 索引映射尚未有 shared/Guard 白名单合同，仅服务器 DI 已接。原正式管理根、知识/记忆动作政策、知识附件业务绑定、受控 file runtime 均为必需依赖，没配置不回退 owner 全权。已有实现不表示真实对象存储/ACL 部署已验。
5. 关系索引任务接续与单进程缓存/当前 head 拒绝不等于外部分布式物理删除完成；逻辑墓碑仍保留 physicalIndexDeletion=not_verified。没有新增队列/调度或留存清理政策。

本包合法源码接线已交，未接公共合同与真实环境按以上逐项保留，不宣称 AIN10/19/20/24 或 M1 完成。没有改三端 UI/主文档/中央记录/身份内核/共享 schema/迁移/Gateway/预算/审批/Core，无生产启用。

## 20261013 固定基线后的后端接续完整包

基线 `ebc036ea81cf01f3f8e60cc5120338affcfff75e`，开工分支正确、tracked/index 干净、无 MERGE_HEAD/CHERRY_PICK_HEAD，仅历史 output 保留。没有重复导入前包或套用旧 stash。严格没有新增或修改 tests、fixture、测试脚本；沿原服务、组合与模块施工。

三个源码提交顺序：

1. `35ebdd8353d30013157aea9bacf3c137837d3821`：`HumanKnowledgeIndexService.operationStatus({documentId,operationId,generation})` 接 `HumanKnowledgeManagementRequest.indexOperationStatus`。复用当前正式 index 授权、仓储/关系索引收据，纯查询不推进任务。返回所请求 generation 的 pending/completed/failed 或 not_observed/superseded，不能拿最新任务当原任务成功；被新 remove 替代的旧 upsert 不复活。历史完整 job 未存于 receipt，不从当前 head 反推旧事实，historicalCompletion=not_attested、physicalIndexDeletion=not_verified。原 request/resume 不变，同原键显式接续、缺政策拒绝；已有 server module 继续导出同 factory，未新增 HTTP。
2. `2fb777997a980e107db5f242784f1670e597ef33`：既有 `HumanKnowledgeInputService.collect` 接可选 `preferenceKinds`，复用原 `PersistentMemoryConsentService.selectPreferences`，只带明确类型的当前确认项，拒绝重复 kinds 或 includePreferences=false 却提供 kinds。沿原材料格式投影，不另造 frozen 输入/账本；原 legacy includePreferences 路径保持。`HumanKnowledgeConsumptionService.revalidateInput` 与同请求 factory 的 `collectInput/revalidateInput` 现接实际准备/复验服务，使用前失权、撤销、版本/hash/期限变化拒绝，不静默换正文。无新增持久缓存，失败不返回旧材料；原历史包不能被当当前许可。
3. `231821c9cd4d3e06f57176e8a507532e9e96350b`：InspectionAssist 组合/Staff request 新 `editHumanReview` 调原 drafts.edit，再读当前人工审阅；原员工 draft-edit 保持旧 mutation 载荷。新 `readSubmissionReview` 纯原收据→当前审阅→收据/审阅重读，包裹原 submit 动作复验，strict 原 target/draft 输入，不接受额外 scope。原 submission-read 保持旧 receipt 载荷，不回写、不新提交、不识别。人工修订与原收据分别表达，迟到观察失败仍按原 edit/提交键核对，不能假定未写。仅改 inspection-assist.composition/staff controller，不改 Core、文件基础设施或媒体执行链。

实际验证：只一次直接 Node 内联冒烟场景（失败修正后复验同一场景，没有新增脚本/扩矩阵）。命令入口 `node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e <本对话内联生命周期冒烟>`，原 prisma-offline-preload 经 NODE_OPTIONS 注入。内联调用既有 lane-b-functional/inspection-persistent 的事务替身，真实知识/index/consent/inspection 服务：create→parse→index pending/原 resume→publish；两个确认偏好只选择 locale；原材料复验；撤销旧材料拒绝；withdraw 后旧 generation superseded/禁 resume、新 remove 同键完成；撤权 index 查询拒绝；员工人工 42→43、原收据 not_prepared 只读零操作写入、缺持久识别来源拒绝。最终 stdout `smoke=passed; knowledge/index/consent/inspection services; synthetic transactions/auth only; no media/model execution`、exit 0。不是 node:test suite，故不伪填 pass/fail/skip 数量；首轮 exit1 是源码误取 AiInspectionOperationResult.result，已改真实扁平 revision；内联 draft.create 也按真实扁平 draftId/revision 读取，后续相关复验 exit0。

必要 compiler API noEmit 使用原 apps/api/tsconfig 严格选项和内存 shared/本树私有 Prisma paths、incremental=false，根为 human-knowledge-management.composition / human-knowledge-consumption.composition / inspection-assist.composition：最终 1139 files、0 diagnostics、exit 0；首轮一个真实 result 属性错误保留，不放宽类型。diff check exit 0，仅继承 CRLF 提示；无生成共享产物。

Node DATABASE_URL 固定 mysql://offline:offline@127.0.0.1:1/rental_os_offline；write-root 为本树绝对路径，audit=本树 output/inspection-lb05-tmp/20261013-backend.audit，TEMP/TMP 同该目录，禁 compile cache。原测试替身 Auth/事务不是本次真实 MySQL/正式政策部署或对象存储验证；未读取 .env、启服务、安装、执行迁移、连接 HTTP/DB/DNS/模型/支付/存储、push/main/生产启用。

精确接入边界：服务器消费 factory 已接原知识/记忆授权、file runtime、索引与材料服务，但索引 generation 查询 HTTP 仍无 shared/Guard 合同。本线不改 `scenes/original-scene-knowledge.ts`：其现有 collect→原 publisher 保持；若主线要在场景冻结时指定 preferenceKinds，需在该原 collect 调用 `services.preparation.collect(..., {includePreferences,maxPreferences,preferenceKinds})` 的可信服务器配置位置传递，不从模型或任意 caller scope 取值。本次验证了原消费服务材料，不冒称该场景新选择策略已发布或完整财务/模型链新验。

员工正式新任务动作政策/partial-safe 公共结果、真实受控 ObjectReader/来源部署、多 allocation 原办理能力仍为前文准确硬依赖。已有图片/语音 Task/Gateway 输入、文件绑定与预算单账全部保留，不用文本桩声称识别；缺来源明确拒绝。仅当前合法人工更正与原收据消费已接，原签名/资格/责任/费用不在此层决策。真实外部存储/模型/设备/MySQL均未验，原 AIN 完成率不变。

## 20261013 持久媒体 Gateway 正式依赖装配包

固定基线 `b0ed18f3c3b4c8ba40a220b93284c494d9a8c24e`，tracked/index 干净、无 merge/cherry 状态，旧 output 全保留。只认领 inspection-assist 两个组合文件及 human-knowledge.module，不触碰公共 Gateway/runner/model-input/scenes/Auth/shared/schema 或页面。

### 实际功能与固定提交

- `8f0eb162d9f9d69919a69d38325f4e2a15e662cb`：原 `InspectionRecognitionTaskApplication` 支持显式 persistent model（gateway 参数）与旧 injected-runtime 两条互斥服务器路径；image/audio 均不双跑。original task ID/run ID 从 `creation.readCreation` 收据取得，原 `StaffInspectionRequestFactory.recognitionPersistedTaskHost` 再逐动作 read_metadata 复核 task/inputRef/scene/run/当前主体，当前字段/模板/附件/hash 仍经原 `recognition.gatewayMedia`。参数在等待前快照，拒绝混入 credentials/runtime/priceVersion/另一个 financialEvidence 或 caller media。
- 同一原 `composePersistedTaskCallGateway` 接当前 media.resolve/assertCurrent；vision route 必需。其 readDispatch 财务证据同时用于原 recognition-result 消费/inputSource，不另造财务账本，不自发派发许可。原实际 runner 继续消费，Provider 与 Runtime 边界仍独立。公共组合的 `composePersistedCallTaskModelHost` 已开放媒体依赖；本线使用它内部同一 Gateway+原 composeTaskModelHost 分两步，以便将同一 readDispatch 绑定原候选/后继输入消费者，不复制派发器。
- 原 app 新服务器 `readResultReview(request,reference,resultId)` 从原任务收据派生 taskId，接同财务源的原结果→当前人工审阅。仅服务器方法，不扩 HTTP/shared。after save 的旧 revision、未知结果等仍按原政策拒绝，不以构建宿主成功冒充识别或审批完成。原人工更正/提交/收据入口沿已整合版本保留，不重做。
- `composeStoredInspectionRecognitionApplication` 和 opt-in `InspectionRecognitionTaskModule.registerStored` 接原 `TenantInspectionObjectReader`→`FileStorageRuntimeService`→原附件业务 ACL/版本/hash/有界 bytes；默认模块空 provider，无 HTTP/worker/root 注册。显式启用需完整原 PrismaService/TenantIntegrationService/model/guard，构造不读对象、secret 或配置；没有任意 URL/fetch 下载或测试字节默认 adapter。
- `78d8ef5e260418aaaf68dbc5613c00585ba62c5d`：`HumanKnowledgeModule.registerConsumptionRequests` 将原请求消费 factory 显式导出，不要求 HTTP 注册。默认空；当前请求 open→原 collectInput/revalidateInput→close，知识/确认偏好沿同一正式政策/file runtime/consent 服务。主线自有 scenes 的 preferenceKinds 参数接入不在本线双写。

### 一次直接内联冒烟与必要类型（无脚本新增）

入口：`node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e <本对话内联媒体/知识场景>`；原 prisma-offline-preload 经 NODE_OPTIONS，固定无效 DB URL，write-root 为本树，audit=`output/inspection-lb05-tmp/20261013-persistent-media.audit`，TEMP/TMP 同本树目录，禁 compile cache。只是同场景失败修正/相关复验，不新增或改 tests/fixtures。

最终显式完成标记：`smoke=passed; persisted staff media host assembled with real services and explicit offline storage/db doubles; zero provider sends; knowledge withdrawal denied`，exit 0。调用实际 staff request factory/AuthService/Guard、inspection 冻结材料/当前附件验证、持久 Gateway 与实际模型 host；数据库及 object stream 为原 fixture 的明确替身。原 scene/正式 plan 条件下创建 queued 原任务，未置备完整执行依赖的新任务启动拒绝，provider sends=0；拒绝他 task、请求关闭后重用、混入旧 runtime、缺正式存储依赖；知识 collect/revalidate 成功后撤回旧包拒绝。不是实际媒体派发、模型识别准确性或财务成功测试。

失败历史真实保留：原请求冒烟漏 requestId，factory正确 ACCESS_DENIED；类型首轮 priceVersion 在持久分支不存在，修为原 gateway.callPriceVersion；新增原结果消费联合返回被 TS 推为 unknown，按互斥分支明确返回修正，未放宽类型。直接内联创建时原串行事务替身出现嵌套等待，Node 曾 exit0 但没有完成标记，**该次不算通过**；沿已有用例的 AsyncLocalStorage 事务替身适配并加45秒 watchdog 后复验正常完成。PowerShell双引号展开 `$transaction` 曾导致纯命令SyntaxError，改单引号字面传递后复验；不改生产事务、fixture或授权绕过。

最后必要 compiler API noEmit 根 inspection-recognition-task.application/human-knowledge.module，原 API strict 配置、内存 shared源码/本树私有Prisma paths：1171 files、0 diagnostics、exit 0；diff check exit 0。没有共享生成物修改、迁移执行、全量回归或新的测试文件。正向为离线服务装配/原创建，非真实 MySQL/对象存储/HTTP/供应商/设备验收。

### 精确公共依赖与下一接入

1. 主线显式服务器提供 model.gateway 的 secrets/platformProfileId/vision route/callPriceVersion/adapters/audit，原 scene/host/limits/auth/subscriptions/db/guard。参考 `StoredInspectionRecognitionDependencies` 与 `PersistedInspectionTaskHostDependencies`；调用输入仍只有原 reference，不能让客户端指定 taskId、scope、模型或 URL。settings/权益/预算/当前工具政策仍原服务复验。
2. 当前持久 capability producer `createPersistedTextCapabilityEvidence`（prisma-text-capability-receipt.repository.ts）支持 text/streaming/vision/structured_output/tools，**audio 仍 fail closed**。audio 服务器路径已能装配不代表正式音频能力证据已齐；音频 proof producer/feature验证由主线补公共能力，不在本线造 verified:true。
3. 新原识别 task 需要合法 task-action-policy 与 scene/plan/execution 配置；代码不默认发布政策。public partial-safe 结果/截断 JSON 仍缺，unknown 无候选，不能换Provider/ID重发。实际 platform/BYOK secret/config/能力、预算call定价与额度缺失均拒绝。
4. 正式对象存储 runtimeConfig、合法 upload/fileAsset/binding、当前附件版本/hash 与租户订单资源须真实存在；本线提供实际原生产者组合，不声明真实读取已验。无来源时拒绝，原人工填单不受AI开启失败替代。
5. 已保存候选/人工检查仍走原 result-save/edit/submission/receipt；读 result 的 reference 修订必须仍合法，历史保存后变更/提交终态不能靠重建旧活跃宿主放行。更窄历史读取政策和 partial-safe 合同需主线明确，当前保持拒绝。原确认偏好/知识撤回复验与模块服务器出口已接，不私造索引HTTP。

本包可做正式依赖装配与消费已交；未连接真实 DB/DNS/HTTP/模型/支付/对象存储，未读.env/安装/启服务/共享生成/迁移/main/push/部署/生产启用。无完成率或整项验收声明，中央记录由主线整合固定提交后更新。
