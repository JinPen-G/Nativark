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
