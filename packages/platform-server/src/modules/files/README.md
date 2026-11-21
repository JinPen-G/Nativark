# 文件存储与原回执

本模块提供公共文件应用、字节处理、格式校验、元数据、上传会话及原回执。Core通过受控宿主登记自己的真实业务权威，再调用同一创建、完成、下载、删除和清理实现。原组合继续提供当前身份、业务授权及专用资料裁定。[模块出口](index.ts) · [原消费者](../../../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)

## 阅读路径

| 源码 | 职责及直接消费者 |
| --- | --- |
| [公共文件应用](file-storage.application.ts) | 按受控登记消费实际权威，沿原键创建/回读、一次冻结及同事务激活；Core不需要导入旧API运行时 |
| [上传恢复流程](file-upload-workflow.ts) | 公共应用与 Rental 兼容入口共同消费原键重放、完成恢复及服务端字节上传；所属参加者供给授权、原收据和提交失应答解释 |
| [激活与失败收据](file-upload-activation.ts) | 同一原事务中按 Session → File 执行激活 CAS，迟到失败按原会话版本收口；领域复验和历史模式的版本字段由调用方提供 |
| [业务权威合同](file-storage-authority.ts) | module/type/scene绑定、当前权限、原回执和领域激活参加者；登记本身不授予访问权 |
| [共用上传DTO](file-upload.dto.ts) | 正式 `/file-dto` 与原Staff/文件HTTP共用原创建、完成类和装饰器；实际场景、权限与metadata由所属Core裁定 |
| [应用事务端口](file-storage.application-store.ts) | 同一文件表与冻结/激活/清理事务能力，业务表由Core参加者访问 |
| [公共字节原语](file-storage-primitives.ts) | 原文件类型/大小校验、存储键、会话/资产投影、对象删除及精确限长读取；原运行时继承消费 |
| [内容冻结内核](file-content-freeze.ts) | 原通用上传完成入口委托同一目标占用、单次写入及原目标读取核验；当前授权、配置锁及专用字节由原参加者供给 |
| [上传事实创建](file-upload-session.ts) | 原普通创建入口委托同一 ID、原键、15 分钟有效期、配置锁及 pending 文件/会话事务，专用规则由原参加者供给 |
| [原上传回执](file-upload-receipt.ts) | 原会话及同一暂存键续签，保持原有效期，终态、过期和未知冻结只返回原回执 |
| [文件删除与按租户清理](file-cleanup.ts) | 同一排队、占用和原键恢复处理单文件删除及原未完成过期、已完成暂存清理，专用保留场景由宿主提供 |
| [清理事务与占用收据](file-cleanup-transactions.ts) | 核原文件/会话锁与完整日期快照，提交确认后登记本次调用的派发收据；所属主体、Core 和配置锁由宿主按原顺序供给 |
| [受保护下载](file-download.ts) | 实际业务 ACL、原绑定复核及成功审计完成后释放短时 GET 引用 |
| [文件仓储](file-storage.repository.ts) | 原租户内元数据查询、原幂等键/会话 ID 读取、同事务建立文件及上传会话；原运行时与 IntegrationsRepository 委托 |
| [公共文件台账](file-ledger.ts) | `FileLedgerApplication` 共用原列表过滤、租户模拟元数据和创建日志回调，业务可读范围由实际权威提供；原 IntegrationsService 委托 |
| [私有存储端口](file-storage.store.ts) | 原 FileAsset 与 FileUploadSession 字段以及本片实际使用的表操作 |
| [对象存储提供者](../integrations/object-storage.provider.service.ts) | 原 S3/OSS/COS 签名、受控出站请求与连接探针 |
| [S3 对象读取签名](s3-object-read-request.ts) | 原 GET 路径、请求头签名及配置/键校验，检查与知识对象读取共用；实际出站、字节边界和当前业务授权由消费者处理 |
| [原冻结合同](../../../../platform-contracts/src/file-content-binding.ts) | 存储位置及已冻结字节指纹，原兼容入口继续消费同源合同 |
| [Rental 附件权限](../../../../rental-core/src/file-access.ts) | 当前业务对象读取 ACL、已发布商品图、客户敏感附件以及业务引用存在性 |

原 [FilesController](../../../../../apps/api/src/modules/files/files.controller.ts) 混合公共工具及实名、承运等 Rental 专用入口，各自保留原 Guard 和业务授权。原 [员工控制器](../../../../../apps/api/src/modules/files/staff-uploads.controller.ts) 再导出 [Rental员工HTTP](../../../../rental-core/src/http-staff-uploads.controller.ts)，继续校验场景、阶段、地点范围、本人上传和检查绑定；[实际接线](../../../../../apps/api/src/modules/files/staff-http.providers.ts)供给同一文件/数据库及原始body解析器。原 [文件 ACL 接线](../../../../../apps/api/src/modules/files/file-business-access.service.ts) 供给同一 Rental 事实仓储、报价读取和客户敏感资料参加者。

## Core 接入

1. 宿主提供唯一文件数据库、原事务、集成配置及配置锁。模拟模式由宿主明确选择，真实配置与成功审计仍按实际能力提供。
2. Core为固定的`businessModule/businessType/uploadScene`提供`FileStorageAuthority`，每次核当前主体、Core使用权、对象/范围及领域证据。未登记或缺真实权威时拒绝，不能从请求payload动态生成登记。
3. Core从正式`@rental-os/platform-server/files`创建应用并调用原键接口。业务HTTP由所选Core声明，公共宿主不会因为文件表存在而开放所有上传场景。

```ts
import { FileStorageApplication } from "@rental-os/platform-server/files";

// hostFiles提供真实存储/事务/配置，coreAuthority提供该业务的当前权限与证据。
const files = new FileStorageApplication(hostFiles, [coreAuthority]);
await files.createUploadSession(tenantId, request, owner);
await files.readUploadReceipt(tenantId, originalSessionId, owner);
await files.completeUpload(tenantId, originalSessionId, completion, owner);
await files.downloadUrl(tenantId, fileAssetId, owner);
```

`FileStorageApplicationParticipants`、`FileStorageApplicationTransaction`和各authority context从同一正式出口取得。需要主体锁的Core在参加者的`transaction`中先取得原主体lease，再执行公共回调和配置锁，提交前沿同一lease复验。文件与会话一起创建，冻结意图先提交，激活与领域绑定在后续原事务一起提交。清理调用将原`FileCleanupBoundary`交给同一参加者，所属宿主据原对象、操作和阶段核定当前权限。PUT、DELETE、HEAD在派发前的短事务复验所属授权、配置及文件／会话完整快照。知识等专用来源按需提供原回执、受控字节和同事务激活参加者，unknown继续从所属原操作读取。

每租户清理由`files.cleanup`提供，计时器和租户发现只在宿主登记一次。不同Core的专用保留场景必须由宿主按其实际规则明确供给。普通页面防重不替代原幂等键、文件事实CAS与服务端授权。

需要文件目录时，从同一 `/files` 出口使用 `FileLedgerApplication`，给它提供 `storage`、实际 `authority`、存储模式和原创建日志回调，然后调用 `listFiles(query)`。当前租户从同一ALS读取，存储等待后复核权限范围；缺业务权威时拒绝读取。`excludedScene` 只供所属业务明确排除自己的专用来源，公共模块没有Rental场景枚举。

`createFile` 与配套存储函数 `createSimulationFileAsset` 只登记原开发模拟元数据，不上传对象。普通Core附件使用前面的原键上传链；模拟创建在应用入口继续拒绝生产模式，日志失败向上返回并保留已经写入的原台账事实。列表和应用返回投影不包含存储键或公开地址。原[服务](../../../../../apps/api/src/modules/integrations/integrations.service.ts)与[存储](../../../../../apps/api/src/modules/integrations/integrations.repository.ts)继续在公共调用前处理Rental专用场景。

## 业务与字节边界

公共文件仓储仅保存已核定事实。`businessId`、`workspaceId`、文件 metadata 和客户端摘要不能授予业务读取或写入权限。列表候选继续由原业务 ACL 过滤，未知绑定、知识与资格资料继续按原专用入口处理。公共投影保持原字段集合，不返回存储键或公开地址。公开商品图仍由 Rental 读取真实启用工作空间、租户、已发布客户端渠道及商品媒体绑定证据。

公共字节读取保持原八秒流超时、取消、响应类型、精确声明长度、累计字节上限及最终长度核对。取消时释放 reader 和 timer。签名、网络请求和旧测试注入点沿原提供者实现。`completeOriginalFileUpload`按原会话与文件的持久状态选择完成回读或冻结恢复，调用`freezeFileUploadContent`计算实际字节SHA-256。进入冻结内核的字节先核对原声明大小和20MB上限，包括业务参加者提供的受控字节，再在原事务记录唯一冻结目标。占用前将原文件／会话快照中的 Date 按 JSON 语义保留，有效期或日期修订变化时返回冲突。`beforeWrite`接收已确认提交的原占用快照，公共应用在同一短事务复验当前业务ACL、配置修订及文件／会话版本后发送一次PUT，恢复仅核对原目标。原知识授权及其受控字节来源在占用前复验。最终激活前仍核完整日期快照，再统一委托`activateOriginalFileUpload`，调用方供给原事务、完整版本CAS及领域复验。Rental的冻结结果沿原结果事务收口，模拟激活沿原Tenant新写入锁。专用检查、企业凭证和隐私擦除各自保持原授权及unknown收据。

`s3ObjectReadRequest(config, storageKey, at)` 使用服务端实际配置生成同一 S3 GET 和请求头签名。[Rental 检查对象读取](../../../../rental-core/src/inspection-object-reader.ts)沿原文件/会话、订单空间、MIME、精确长度及冻结摘要读取，返回流前和流末复验同一持久事实与配置。[知识正文读取](../../../../../apps/api/src/modules/integrations/knowledge-object-reader.ts)消费同一签名函数，知识 ACL、正文绑定和受控运输继续由原消费者维护。原[检查对象入口](../../../../../apps/api/src/modules/integrations/inspection-object-reader.ts)再导出同一实现，检查媒体、员工文件与既有 AI 消费者沿原调用链使用。

`persistUploadFacts(tx, tenantId, facts, metadata)` 仅接调用方已经使用的原事务，先创建 `pending_upload` 文件，再以同一文件 ID 创建原上传会话。metadata 由原编排过滤客户端保留字段并补入可信操作者、空间、配置和专用证据，仓储保持原内容。`findUploadSession(tenantId, reference)` 只读取当前租户下指定原会话 ID 或原幂等键。

公共应用与 Rental 兼容入口共同调用 `createOriginalFileUploadSession`，先核同一租户/幂等键的既有回执、请求描述及业务归属，再授权首建并调用 `createOriginalFileUploadFacts`。事实内核创建原标识与有效期，读取原默认配置，在原同一事务锁住配置并调用所属来源的授权/引用复验和事实写入。重放来源、普通业务引用及知识写入尝试标记由原参加者解释，知识提交失应答使用写入前固定的原错误工厂。模拟模式由宿主显式允许，公共内核缺此许可时保持配置不可用。

`uploadOriginalFileBuffer` 将服务端已有字节送入同一原会话、派发复验和完成流程。已完成或冻结待核的会话直接进入原完成读取，运输失败沿 `failOriginalFileUpload` 写原失败收据。失败 CAS 只接仍由本次占用的 pending 会话，其他完成者已经取得的冻结结果继续按其原收据处理。知识观察的授权后快照比较共用 `assertOriginalFileUploadSnapshot`，日期版本和有效期按原JSON语义参与比较，具体主体、空间、文档修订和状态范围由知识参加者核定。

`readOriginalFileUploadReceipt` 保留原会话、文件、配置指纹和有效期。仅仍有效的 `pending_upload` 可以取得原暂存键的 PUT，返回前再核原业务引用、原会话、原文件及当前配置，包括Date版本和会话有效期在授权等待期间的变化。已完成、过期、失败或 `freeze_pending` 返回原回执，续签不会延长有效期或另建目标。租户共享客户资料与空间业务的区别由 Rental 原参加者判断，公共框架没有 Rental 场景枚举。

`FileStorageCleanup` 没有计时器或租户发现。原 Nest 宿主仍持有唯一计时器，Rental 兼容应用发现原租户集合并逐租户委托三个清理方法。[兼容应用](../../../../rental-core/src/file-application-runtime.ts)没有启动钩子或另一套定时器。原完成暂存清理在发送 DELETE 前记录 unknown，失应答及提交结果未知时只 HEAD 原键，保持完成文件与证据不变。专用保留场景由原宿主明确传入，缺少租户的调用在查询前拒绝。

Rental 的清理事务通过 `createOriginalFileCleanupTransactions` 共用 Session → File 锁、完整日期快照及调用内收据。主体/Tenant/Core 授权和配置锁在文件锁前由原参加者取得。只有收到原占用事务的提交确认后，公共流程才登记本次 DELETE 或 HEAD 收据；提交失应答保留原状态，由后续调用观察原键。派发前的短事务与运输后的结果事务沿同一收据复核，worker 的存储位置指纹继续由所属参加者核定。

过期未完成上传只有原 `pending_upload`、零次清理且首次占用提交已确认的调用方发送一次 DELETE。session→asset 按原锁序在同一事务内核完整版本、配置和原对象键；冲突一起回滚，事务内不请求对象存储。占用、删除或结果提交失应答，以及 TTL 后恢复或旧失败记录，均只 HEAD 原键，404 才确认删除。未知收据只保存随机标识与证据摘要，供应商错误、凭据和签名地址不落入该字段。

单文件删除调用 `FileStorageCleanup.deleteFileAsset`，所属业务在同一事务复验原文件归属，将 active 文件保存为 `delete_queued`。Core 在原解绑事务中保存这个内部状态后，worker 才能办理首次删除。只有收到本次 `delete_queued → delete_in_progress` 占用提交确认的调用方发送一次 DELETE。单文件请求只处理原目标，worker 沿原租户集合处理排队文件。并发调用、重启、占用或删除失应答后只 HEAD 原键，404 才能确认删除。旧 `delete_pending` 混合了未派发和失应答来源，同样只观察原键，保留未证实结果。结果写入仍匹配原占用修订，迟到响应不能改写新的文件事实。明确在派发前缺配置或授权变化时可释放自己的占用回排队状态。DELETE 开始后，Boolean 失败或异常都保留原结果待核对。员工原只读观察将内部排队及占用状态投影为 `delete_pending`，继续返回原上传收据和恢复语义。[Rental 原删除参加者](../../../../rental-core/src/file-application-runtime.ts) · [员工上传观察](../../../../rental-core/src/file-application-staff-observation.ts)

`issueFileDownloadReference` 必须接实际业务 ACL 和成功审计参加者，配置/审计让出执行后继续核对原文件绑定及当前权限。模拟引用需宿主显式允许。原组合在进入公共内核前继续执行实名、知识、企业凭证及专用检查的原拒绝或专用读取规则。可公开商品图片仍经 Rental 原发布证据和当前绑定核验，公共内核没有默认公开场景。

## 数据与装配

独立公共 [schema](../../../../../apps/platform-api/prisma/schema.prisma) 持有原 FileAsset 与 `file_upload_sessions` 两模型及 Tenant 反向关系，当前公共版本与迁移链由 [数据计划](../../../../../apps/platform-api/src/platform-data.ts) 固定。文件字段、默认、原 ID、字符串状态和历史 JSON 保留，`fileAssetId` 唯一、原幂等唯一键、会话状态索引及 FileAsset 两个租户索引均沿原来源。组合 schema 的 AI 检查反向关系仍由其所属模块装配。[公共文件迁移](../../../../../apps/platform-api/prisma/migrations/20261118010000_public_files/migration.sql) 用于独立公共库，原组合链不覆盖。

正式包出口 `@rental-os/platform-server/files` 暴露本模块入口。原运行时与仓储使用同一 Prisma 实例，Staff 五组固定场景通过公共应用处理，其他旧合法输入和历史记录由 Rental 的正式 `/file-application-runtime` 选择原兼容分支，并共用公共上传、激活及清理恢复流程。根存储仅要求公共文件能力，业务回调仍接调用方的完整原事务。Staff 的原主体权威由 `RENTAL_FILE_AUTHORITY` 窄 token 提供，组合宿主在实际调用时延迟取得同一 AuthService，避免原 Auth→Platform→Rental→文件构造链回环。缺原 Auth 或文件 ACL 时拒绝受控 Staff 场景。Rental ACL 从 `@rental-os/rental-core/file-access` 消费单源业务规则。组合模块/独立宿主的 Provider、Controller、schema 和迁移由装配负责人统一维护。

存储配置停用或原位变更从 `@rental-os/platform-server/file-integration-dependencies` 复用 [只读核验](file-integration-dependencies.ts)。它使用配置已锁定的同一事务读取当前租户/提供者的文件、上传与清理原收据；active/pending/delete、freeze_pending 及非空 cleanupError 均需先迁移或处理。空 Core 目录也执行核验，查询失败向上返回，不据目录为空推断没有文件依赖。业务附件 ACL 和原配置授权仍由各自入口核定。

## 验证

本片复用原文件生命周期用例及必要定向类型检查，覆盖存储原语、元数据/原键回执、原上传/冻结、过期及完成暂存清理、拒绝与 ACL。待删除文件另核并发单次派发、失应答仅观察、原键修订冲突和提交失应答；这些离线 fixture 不代替真实数据库、对象存储、HTTP、浏览器与完整安装验证。[原生命周期用例](../../../../../tests/file-storage-lifecycle.test.cjs) · [知识文件用例](../../../../../tests/ai-native-knowledge-lane-b-file-runtime.test.cjs) · [Core接入手册](../../../../core-contracts/README.md#五步快速接入)
