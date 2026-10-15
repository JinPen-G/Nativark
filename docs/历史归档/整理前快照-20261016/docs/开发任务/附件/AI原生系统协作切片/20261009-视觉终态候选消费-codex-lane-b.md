# Codex B｜CB-01/02 持久视觉终态→履约候选消费

施工树 `codex-ai-native-lane-b`，分支 `ai/codex-ai-native-lane-b-20261007`。本片固定前置 `bc7eb1478dea635c186156742f9709dcba2e9e6b`；保留原 c1ee113d / 1fb1f0af / 41e96a1b 员工宿主成果及历史 output。主线明确授权本片结果服务与 composition 独占；未修改主线树、runner、model-input、Gateway、预算、Auth、Core、shared 或 schema。

## 实际入口与调用链

新增 `InspectionRecognitionResultService`，回接原 `composeInspectionAssist`、`StaffInspectionRequestFactory.open` 与显式 `InspectionAssistModule`。未注册 HTTP/AppModule/worker，也不自动执行任何业务。

- `recognitionResults.read({orderId,allocationId,stage,templateId,draftId,inputId,expectedRevision,taskId,resultId})`：只读候选。
- `recognitionResults.save({...上述原引用,operationId})`：显式保存候选，复用原 `drafts.saveCandidates`、CAS 和原操作收据；人工字段不改，不自动采用/修改/提交检查。
- `recognitionResults.reconcileSave({...上述原引用,operationId})`：只读原保存收据。absent 不证明远端没执行，不调用保存或模型；unknown 禁止换键盲重做。

服务端 composition 必须提供 `recognitionResults:{db,auth,subscriptions,clock?,policy:{kind:'image',sceneCode,maxOutputTokens},financialEvidence}`。db 为本树真实 Prisma delegate 合同；auth/subscriptions 与原持久任务动作政策共同组成 `composePersistedTaskAuthorization`，credentials 由原请求工厂绑定，不由结果调用者另传身份。financialEvidence 复用原 `PrismaGatewayAccountingFacts.readDispatch`，不另记账。缺正式依赖时服务入口存在但返回 STORAGE_UNAVAILABLE；不把当前身份解析当动作授权。

读链：当前检查 Guard + 原任务 read_step_terminal → **实际 AiTaskResultRepository.read** → 同 scope/task/run/step 的 ai.model.image 原 inputRef/payload/fingerprint → parseTaskModelInput/taskModelFingerprint/taskModelIdentity → 原 invocation/config/price/call/actor 与 artifact holder/fencing → recognition.gatewayMedia 原 draft/input/template/附件版本和内容 hash → 原正式 candidate schema/snapshotInspectionCandidates/InspectionCandidateService.consume → 再读当前绑定和授权。

仅 SUCCEEDED、完整计量、Gateway completed/reported、同源持久 dispatch/admission/usage receipt 才有候选。unknown/failed 不产候选、不自动重派。用量核对沿原 receipt usageHash，BigInt 保留整数精度，不以整对象 JSON.stringify 处理数据库 BigInt。外部只接受严格原引用，拒绝 caller payload/text/授权/金额；原模型正文必须是有界正式候选数组，不接受 Markdown 修复、未知字段、动态动作或外来附件/URL。上限100候选、240000 UTF-8字节，字段/值/来源继续由原模板及文件证据服务判断。

原检查草稿的候选保存收据证明的是候选写入，不是视觉执行证明；执行证明继续来自原任务 artifact、冻结输入和账务事实，不复制第二账本。save/reconcile 在新 draft revision 下只能重建同一原请求核对已存在收据；没有原收据时禁止用旧 revision 写新候选。当前草稿已删除、附件被替换或冻结输入消失时保持拒绝，不能复活旧结果。

## 本片验证（少量原用例，无新测试脚本）

在原 `tests/ai-native-inspection-media-submission.test.cjs` 的 image host 用例中，驱动原模型任务 application、实际持久结果仓储、新消费服务及原草稿仓储。使用真实 AuthService/ApiAuthGuard/持久动作政策装配；权限行、DB事务、transport、计价预留和文件对象为明确离线替身，非生产 grant/模型或 MySQL。

首次预加载命令反斜杠转义失败 exit1，未进入业务；修正为绝对正斜杠路径。新增功能初始红测 0 pass / 1 fail / 0 skip / 0 todo，exit1（尚无结果消费入口）。实现后曾暴露两处：事务替身读提交替换对象后，测试恢复的是旧对象；新增收据复核对 BigInt 用 JSON 指纹不合法。分别修正为当前替身对象、精确 isDeepStrictEqual；没有放宽关联/计量/权限断言。

最终原文件 **11 pass / 0 fail / 0 cancelled / 0 skip / 0 todo，exit0**。覆盖真实 image host 保存结果、原输入/媒体/账务关联、只读不改草稿、显式保存保留人工值、原键 replay/reconcile、旧 revision 新键拒绝、跨调用 step 拒绝、未知/失败无候选、caller payload 拒绝、缺依赖及当前撤权拒绝。其余10项原用例保留。

命令（每个 Node 子进程沿用 preload）：

```powershell
$env:DATABASE_URL='mysql://offline:offline@127.0.0.1:1/rental_os_offline'
$env:AI_OFFLINE_WRITE_ROOT=(Get-Location).Path
$env:AI_OFFLINE_AUDIT=Join-Path (Get-Location).Path 'output/inspection-lb05-tmp/vision-result-smoke.jsonl'
$env:TEMP=Join-Path (Get-Location).Path 'output/inspection-lb05-tmp'; $env:TMP=$env:TEMP
$env:NODE_OPTIONS='--require D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-b/tests/fixtures/ai-native/prisma-offline-preload.cjs'
node -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-inspection-media-submission.test.cjs
```

必要类型检查使用 TypeScript createProgram/noEmit/incremental:false，沿现有 API tsconfig，入口为 composition 和新服务，shared 源码/本树私有 Prisma 路径；**2入口、1074依赖文件、0诊断，exit0**。不是全仓 API build。完整命令可由本对话工具记录复核；未生成或改共享 client。`git diff --check` exit0（仅LF/CRLF提示）。

## 主线接入及未验

主线需为每个员工请求注入同一当前身份及正式 task action policy、原持久图像模型 policy、受权检查模板/文件能力及同账务 dispatch producer。消费原任务 output_ready 的 taskId/resultId，与原识别准备的 draftId/inputId/revision 一起调用本服务；不可接 caller 模型正文。UI先只读候选，再由明确动作保存，之后继续原人工 edit 与检查提交。

真实供应商 vision 能力、价格/权益配置、真实文件存储、MySQL锁/宕机、HTTP与微信宿主未验。后台调度/分布式证明未新增。读取多依赖的复验不是与模型派发/人工保存的跨模块原子事务；保存仍由原草稿 CAS 防迟到覆盖。当前仅 PNG/JPEG 原图像合同，音频/OCR其他格式未声称支持。Runtime/SDK消息不进入候选合同，未来替换只影响原 image step/Gateway 适配，不改变原模板、证据、草稿和人工办理边界。不重算原AIN完成率，不宣称CB或AIN整项验收。
