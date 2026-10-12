# AIN-10 知识政策准备目标接续

本片承接 `97e7cd1f` 的未提交 WIP，未另建授权状态机。准备目标由已授权的 knowledge/upload 管理政策冻结，随后仅允许绑定同一租户、空间、目标主体、文档和幂等上传会话；绑定不是上传完成，也不是文档创建或发布成功。

实际入口：`createKnowledgePolicyManagementFactory` 暴露 `prepareTarget`、`target`、`bindTarget`。调用方不提交 actor/scope；服务从当前 Auth/Guard 会话取得管理身份，目标规格来自受权政策的 `preparationTarget`。目标创建使用唯一的 scope/manager/operationKey 关系和 revision，事务内锁定政策、重读授权及文件参与者；绑定再次复核政策 hash、目标 revision、文件上传会话、附件归属、业务类型、工作区、操作者、存储提供者和大小/类型，CAS 失败拒绝。提交应答不明返回 `unknown/read_target`，不换 operationKey 重派。

本次修复已复现的组合接线错误：保留 shared 草案要求的显式原 operationKey，补齐绑定返回/重放内部 target 调用及冒烟宿主调用的漏传。bindTarget 在绑定前及重放时都核对 operationKey 与冻结目标一致；错键冲突且不写入。不将字段改成可选，不放宽授权或默认成功。首轮继承现场冒烟 5 pass / 1 fail（invalid_input）；修正调用合同后 6 pass / 0 fail。

验证：`tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs` 6 pass / 0 fail / 0 skip / 0 todo，退出码 0；API 离线 noEmit TypeScript `DIAGNOSTICS=0`，退出码 0；`git diff --check` 退出码 0。测试使用本树离线 Prisma preload 和固定无效 DATABASE_URL；未连接真实 MySQL、文件存储、HTTP、模型或生产模块。

schema validate/datamodel diff 沿既有 `tests/fixtures/ai-native/prisma-offline.cjs` 运行，退出码 0，guard violations 0，差异对应继承的追加迁移 `20261009132000_ai_knowledge_policy_preparation_targets`（新目标表及 authority.preparationTarget）。临时目录在本树；该既有 helper 内部固定无效库名仍为 rental_os_e2e_offline_schema，未连接数据库。`scripts/ai-native-generate-local-prisma.cjs` 退出 0、generated:false；本树 client 所有权和文件指纹检查通过，schemaHash=aae3593aa99e9101d9736ea93877a68db28a63e187f5aba6d9a06049d97fb42f。本轮没有重新生成/写入共享产物。

实际命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test tests/ai-native-knowledge-lane-b-formal-authorization.test.cjs`；noEmit 使用现有 TypeScript API、工作树 Prisma 类型及 shared 源码。AUDIT/TEMP/TMP 指向本树 output/inspection-lb05-tmp，旧 output 保留且不提交。

继承的 schema/shared leaf WIP 随包交主线统一整合，不修改 shared 总出口、OpenAPI 或历史迁移。仍需主线核验：迁移部署、可信治理根记录的受审计置备、正式 HTTP/路由装配、真实文件服务和跨实例数据库锁。缺根记录/文件能力仍拒绝；本片不是生产全链路验收。

Runtime/Provider 替换边界：目标/策略/CAS/收据属于知识业务持久事实，不依赖 checkpoint 或 SDK 消息类型；未新增模型调用、派发器、财务账本或后台循环。关闭显式组合入口不删除既有记录、不宣称撤销远端已提交事实。

## 20261012 CB13：已受权附件的唯一后继与原删除收据

固定 base/HEAD `a63954aa48edde098a54188cf78474467f810782`，唯一树 `codex-ai-native-lane-b`、原分支未变。本节为未提交作者交付，不是主线验收。CB12 六文件及其交付记录保持冻结哈希；本节补记其后续验证，不改写首轮失败证据。

### 本域实现

- 复用 `AiKnowledgePolicyManagementAuthority.preparationTarget` JSON，新增严格 `knowledge-successor-target-1` / `knowledge-deletion-target-1` 两种规格。固定原 documentId/revision/version/attachment/acl、唯一 operationId、动作、expiry；后继另固定目标版本、已完成上传的附件/session、标题及有效期。规格纳入原 authorityFingerprint，治理 prepare/commit 继续绑定 sourceHash/authorizationHash、原 policy revision 和唯一 commitSlot，不另设表、进程 Map 或影子账本。
- `knowledgePolicyResourceBasis` 只给上述显式规格增加独立分支，原普通文档的 current-version/attachment/acl/deleted 校验不删除。允许的资源集合仅原头、revise 检查使用的原版本+目标附件、唯一后继；动作仅 revise/delete 与独立 read_metadata，不派生 publish/read_body/search/index 权限。
- 准备、提交和实际政策消费都重新读取头、当前 owner/ACL、参与者和后继上传绑定；附件须 active、非 local_mock、同 tenant/workspace/document/actor，完成上传 session 的 provider/storageKey/fileAssetId/idempotencyKey 与 knowledgeRevision 全部匹配。目标版本在变更前必须未占用，变更后必须是同一原 operation 指纹证明的 revision+1 和目标版本；后续额外头变化不沿用本授权。
- `KnowledgeAuthorizationRequest.lifecycle` 从原严格解析的 revise/delete 参数贯穿 documents.load/save、FormalKnowledgeAuthorizationAdapter 和 Prisma policy source；服务提交前在附件检查后再复验。请求换 operationId/title/expectedRevision/附件/版本不能借已有 resource 权限消费另一项变更。原 operationFingerprint 字节语义不变，只收窄 TypeScript 参数到其实际读取字段。
- 墓碑仅允许原删除请求的回读或 `operationStatus` 携带同一 receiptOperationId 的最少 metadata；还须当前人类授权、删除 receipt 指纹、原版本/ACL/revision+1 和对应 remove job 全部一致。普通 read、其他 operationId、read_body/index 不能借此恢复。未知应答只查原收据，不自动重试或生成新键，不宣称索引/文件物理清理。
- 治理准备结果新增 `lifecycleTarget`，只在当前准备仍有效且原授权哈希吻合时返回审核目标，供人类显式 review/commit；输入仍仅引用原 authority 和原 changeHash，不从 HTTP 生产 unmanaged 政策。

CB13 源码范围：`knowledge-policy-management-authority.ts`、`knowledge-policy-management.validation.ts`、`knowledge-policy-preparation-target.ts`、`human-knowledge-policy-management.service.ts`、`prisma-knowledge-policy.source.ts`，以及已认领的 `knowledge.ports.ts`、`formal-knowledge-authorization.adapter.ts`、`knowledge-document.service.ts`、`knowledge-publication.service.ts`、`human-knowledge.service.ts`、`knowledge-validation.ts`。测试只扩原 `tests/ai-native-knowledge-lane-b-version-lifecycle.test.cjs` 一项，加本记录共13文件；另有主线交付的单个生成器脚本，不算本域功能原创。

### 实际验证与隔离客户端

1. CB13 仅运行原版本生命周期文件的 `--test-name-pattern='managed successor and tombstone'`：1 pass / 0 fail / 0 skip / 0 cancelled / 0 todo，exit0。真实 Auth/Guard、治理 prepare/commit、Prisma policy source、HumanKnowledgeService/原仓储参与，数据库执行和已受权上传记录由既有 fixture 边界替身承载。覆盖附件 ACL 变化使准备失效、换 ID/标题拒绝、修订应答丢失后原收据读回、独立发布权限、删除后只读原收据及正文/索引/撤权拒绝；不是跨实例真实数据库锁或真实文件服务验收。证据 `output/cb13-knowledge-lifecycle-Q4bp81nN/smoke.tap`；offline-audit.log 0字节。
2. CB12 冻结六文件在当前 CB13 消费绑定源码下，原 `prepared first document` 一项重跑：1/1、exit0，0 skip/cancelled/todo；证据 `output/cb12-knowledge-management-5Svy3y6s/smoke-after-client.tap`。原 `smoke.tap` 的私有 client 类型失败保留；不把 CB12 预置服务器政策的版本/墓碑片段说成治理 HTTP 生产实证。
3. 主线固定脚本 `scripts/ai-native-generate-local-prisma.cjs`（SHA256 `af749b830187acc2b369a71a0c98de2ae1e980e98e13a1ae1ff20aeb67352aec`）单文件接入后默认 preserveArtifacts=true 实际生成一次，exit0、guardViolations0、sharedArtifactsUnchanged:true。schemaHash `b49be4b1e97eb1d25521088a67d00546c766a5193222898d6f4ea196a16ad32c`。旧 client 保留在本树 `apps/api/node_modules/@prisma/client.previous-49c26364-c776-4b62-bcad-ca8a4b25551a`，临时生成输出保留在 `output/cb12-knowledge-management-5Svy3y6s/rental-os-ai-client-MXNwkx`；不复制跨树 client/marker，不手工删锁。
4. 所有 Node（含生成子进程）均原双 preload、固定无效 DATABASE_URL、本树绝对 audit/write/temp/cache、禁 Node/V8/ts-node compile cache。生成外层/子进程/CB12/CB13 审计均0字节。未读 .env、安装依赖、开服务、连接真实网络/DB/存储/模型/支付或跑迁移。`git diff --check` exit0；未运行全项目 noEmit 或全量回归。

### 未覆盖与后续边界

- 新版本上传 target 的治理生产仍未接：`AiKnowledgePolicyPreparationTarget.documentId` 的 `ai_kp_target_document_key` 为全局唯一，旧首文档目标表不能直接承载多次版本上传。本片从已受权且 knowledgeRevision 匹配的附件开始，不能以测试的合成持久记录声称治理已完成该上传。
- 后继授权只覆盖批准的原头或同一已提交原操作的即时 revision+1；后续解析/索引/其他头变化需重新独立授权，不把本次规格变成任意未来版本或永久授权。墓碑授权不执行索引删除，既有 remove job 的独立完成路径不在本包验收内。
- 原治理 authority 的受审计置备、中央公开契约/OpenAPI 的 lifecycleTarget 展示、正式宿主启用与真实并发锁验收仍由主线统筹。Runtime/Provider SDK 均未安装，本包不授业务执行权，不将 AIN-10 整项计为完成。

## 20261012 CB14：本树契约收口，主线已有等价实现

主线同日消息确认临时接续已完成公开 lifecycle/controller/只读目标快照，且后续已有修订上传及 memory 管理改动。以下仅为本树固定基线上的维护与作者离线证据，不作为待整包导入的新功能，不覆盖主线后续，也不重复计完成率；主线所述 3/3 不是本树本轮测试结果。

- 原四个治理方法 prepare/preparation/commit/operation 返回逐字段安全投影。独立 shared leaf 提供13个严格 schema，生命周期标注 `target_review_not_execution_permission`；stale/expired 不返回可用 target，unknown 仅保留原 operationKey/changeHash 查询指引。
- `reviewLifecycleTarget` 只读原准备记录、当前授权根及资源基线；绑定原 changeHash/authorizationHash/revision，复读基线及当前身份。根撤销只让可选目标 unavailable，不改写已经 observed 的原治理收据。删除目标给出原 receiptOperationId，仍由原知识操作授权判断能否读取墓碑收据；不恢复正文或索引。
- factory 每次请求独立凭据闭包，finally 清除；四个 Controller 方法返回200/no-store。无新路由、准备账本、schema/migration、中央 guard/OpenAPI 聚合或默认启用。
- 本树首次定向冒烟因 publicResult 联合类型收窄编译失败（`smoke.tap`）保留。改用既有 nextAction 字段收窄后，同一 `--test-name-pattern='managed successor and tombstone'` 重跑1 pass / 0 fail / 0 skip / 0 cancelled / 0 todo，exit0（`smoke-after-narrowing.tap`）；未新增测试矩阵。现有用例覆盖真实 factory/controller/Auth/Guard/治理服务、严格契约及叶子 OpenAPI 转换、额外字段不泄漏、请求关闭后凭据拒绝、失效目标、unknown 原键查回、墓碑原收据及正文/索引拒绝，DB/文件仍是既有离线替身。
- 输出固定目录 `output/cb14-knowledge-contract-PoMirTwT`；before 六文件与 `before-sha256.txt` 保留，after/after-sha256.txt 与 cb14.patch 仅供作者增量比对。原双 preload、固定无效 DATABASE_URL、本树绝对 audit/writeRoot/temp/cache、禁 Node/V8/ts-node compile cache；audit 0字节。未安装/启服务/读.env/连接真实外部系统/生成共享产物/提交推送。

员工页面及宿主 WIP 不在本知识包验收范围，尚未真实设备/HTTP/生产验收；接续以原 CB10 记录为准。
