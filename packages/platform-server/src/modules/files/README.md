# 文件存储与原回执

本模块提供公共文件应用、字节处理、格式校验、元数据、上传会话及原回执。Core通过受控宿主登记自己的真实业务权威，再调用同一创建、完成、下载和清理实现。原组合继续提供当前身份、业务授权及专用资料裁定。[模块出口](index.ts) · [原消费者](../../../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)

## 阅读路径

| 源码 | 职责及直接消费者 |
| --- | --- |
| [公共文件应用](file-storage.application.ts) | 按受控登记消费实际权威，沿原键创建/回读、一次冻结及同事务激活；Core不需要导入旧API运行时 |
| [业务权威合同](file-storage-authority.ts) | module/type/scene绑定、当前权限、原回执和领域激活参加者；登记本身不授予访问权 |
| [共用上传DTO](file-upload.dto.ts) | 正式 `/file-dto` 与原Staff/文件HTTP共用原创建、完成类和装饰器；实际场景、权限与metadata由所属Core裁定 |
| [应用事务端口](file-storage.application-store.ts) | 同一文件表与冻结/激活/清理事务能力，业务表由Core参加者访问 |
| [公共字节原语](file-storage-primitives.ts) | 原文件类型/大小校验、存储键、会话/资产投影、对象删除及精确限长读取；原运行时继承消费 |
| [内容冻结内核](file-content-freeze.ts) | 原通用上传完成入口委托同一目标占用、单次写入及原目标读取核验；当前授权、配置锁及专用字节由原参加者供给 |
| [上传事实创建](file-upload-session.ts) | 原普通创建入口委托同一 ID、原键、15 分钟有效期、配置锁及 pending 文件/会话事务，专用规则由原参加者供给 |
| [原上传回执](file-upload-receipt.ts) | 原会话及同一暂存键续签，保持原有效期，终态、过期和未知冻结只返回原回执 |
| [按租户清理](file-cleanup.ts) | 原未完成过期、已完成暂存及待删除文件的原键处理，专用保留场景由宿主提供 |
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

`FileStorageApplicationParticipants`、`FileStorageApplicationTransaction`和各authority context从同一正式出口取得。需要主体锁的Core在参加者的`transaction`中先获取原主体lease，再执行公共应用回调；回调内才锁配置，提交前沿同一lease复验。文件会话、冻结、激活与领域绑定使用同一事务，不在配置锁之后反向获取主体锁。知识等专用来源按需提供原回执、受控字节和同事务激活参加者，unknown继续从所属原操作读取。

每租户清理由`files.cleanup`提供，计时器和租户发现只在宿主登记一次。不同Core的专用保留场景必须由宿主按其实际规则明确供给。普通页面防重不替代原幂等键、文件事实CAS与服务端授权。

需要文件目录时，从同一 `/files` 出口使用 `FileLedgerApplication`，给它提供 `storage`、实际 `authority`、存储模式和原创建日志回调，然后调用 `listFiles(query)`。当前租户从同一ALS读取，存储等待后复核权限范围；缺业务权威时拒绝读取。`excludedScene` 只供所属业务明确排除自己的专用来源，公共模块没有Rental场景枚举。

`createFile` 与配套存储函数 `createSimulationFileAsset` 只登记原开发模拟元数据，不上传对象。普通Core附件使用前面的原键上传链；模拟创建在应用入口继续拒绝生产模式，日志失败向上返回并保留已经写入的原台账事实。列表和应用返回投影不包含存储键或公开地址。原[服务](../../../../../apps/api/src/modules/integrations/integrations.service.ts)与[存储](../../../../../apps/api/src/modules/integrations/integrations.repository.ts)继续在公共调用前处理Rental专用场景。

## 业务与字节边界

公共文件仓储仅保存已核定事实。`businessId`、`workspaceId`、文件 metadata 和客户端摘要不能授予业务读取或写入权限。列表候选继续由原业务 ACL 过滤，未知绑定、知识与资格资料继续按原专用入口处理。公共投影保持原字段集合，不返回存储键或公开地址。公开商品图仍由 Rental 读取真实启用工作空间、租户、已发布客户端渠道及商品媒体绑定证据。

公共字节读取保持原八秒流超时、取消、响应类型、精确声明长度、累计字节上限及最终长度核对。取消时释放 reader 和 timer。签名、网络请求和旧测试注入点沿原提供者实现。原通用完成编排调用 `freezeFileUploadContent` 计算实际字节 SHA-256，先在同事务记录唯一冻结目标再发送 PUT，恢复仅核对原目标。恢复分支从原会话与文件的持久状态决定。原知识授权及其受控字节来源继续在占用前复验，原最终激活事务仍由完成编排执行。专用检查、企业凭证和隐私擦除各自保持原授权及 unknown 收据。

`s3ObjectReadRequest(config, storageKey, at)` 使用服务端实际配置生成同一 S3 GET 和请求头签名。[Rental 检查对象读取](../../../../rental-core/src/inspection-object-reader.ts)沿原文件/会话、订单空间、MIME、精确长度及冻结摘要读取，返回流前和流末复验同一持久事实与配置。[知识正文读取](../../../../../apps/api/src/modules/integrations/knowledge-object-reader.ts)消费同一签名函数，知识 ACL、正文绑定和受控运输继续由原消费者维护。原[检查对象入口](../../../../../apps/api/src/modules/integrations/inspection-object-reader.ts)再导出同一实现，检查媒体、员工文件与既有 AI 消费者沿原调用链使用。

`persistUploadFacts(tx, tenantId, facts, metadata)` 仅接调用方已经使用的原事务，先创建 `pending_upload` 文件，再以同一文件 ID 创建原上传会话。metadata 由原编排过滤客户端保留字段并补入可信操作者、空间、配置和专用证据，仓储保持原内容。`findUploadSession(tenantId, reference)` 只读取当前租户下指定原会话 ID 或原幂等键。

原创建入口先核同一租户/幂等键的既有回执、请求描述及业务归属，再调用 `createOriginalFileUploadFacts`。公共内核创建原标识与有效期，读取原默认配置，在原同一事务锁住配置并调用所属来源的授权/引用复验和事实写入。普通业务引用及知识写入尝试标记由原参加者负责，唯一键冲突重读和知识提交失应答继续由原入口解释。模拟模式由宿主显式允许，公共内核缺此许可时保持配置不可用。

`readOriginalFileUploadReceipt` 保留原会话、文件、配置指纹和有效期。仅仍有效的 `pending_upload` 可以取得原暂存键的 PUT，返回前再核原业务引用、原会话、原文件及当前配置。已完成、过期、失败或 `freeze_pending` 返回原回执，续签不会延长有效期或另建目标。租户共享客户资料与空间业务的区别由 Rental 原参加者判断，公共框架没有 Rental 场景枚举。

`FileStorageCleanup` 没有计时器或租户发现。原 Nest 宿主仍持有唯一计时器，Rental 兼容应用发现原租户集合并逐租户委托三个清理方法。[兼容应用](../../../../rental-core/src/file-application-runtime.ts)没有启动钩子或另一套定时器。原完成暂存清理在发送 DELETE 前记录 unknown，失应答及提交结果未知时只 HEAD 原键，保持完成文件与证据不变。原过期 session→asset 两写以同一 callback 事务按原顺序提交或回滚，事务内不请求对象存储。专用保留场景由原宿主明确传入，缺少租户的调用在查询前拒绝。

`issueFileDownloadReference` 必须接实际业务 ACL 和成功审计参加者，配置/审计让出执行后继续核对原文件绑定及当前权限。模拟引用需宿主显式允许。原组合在进入公共内核前继续执行实名、知识、企业凭证及专用检查的原拒绝或专用读取规则。可公开商品图片仍经 Rental 原发布证据和当前绑定核验，公共内核没有默认公开场景。

## 数据与装配

独立公共 [schema](../../../../../apps/platform-api/prisma/schema.prisma) 持有原 FileAsset 与 `file_upload_sessions` 两模型及 Tenant 反向关系，当前公共版本与迁移链由 [数据计划](../../../../../apps/platform-api/src/platform-data.ts) 固定。文件字段、默认、原 ID、字符串状态和历史 JSON 保留，`fileAssetId` 唯一、原幂等唯一键、会话状态索引及 FileAsset 两个租户索引均沿原来源。组合 schema 的 AI 检查反向关系仍由其所属模块装配。[公共文件迁移](../../../../../apps/platform-api/prisma/migrations/20261118010000_public_files/migration.sql) 用于独立公共库，原组合链不覆盖。

正式包出口 `@rental-os/platform-server/files` 暴露本模块入口。原运行时与仓储使用同一 Prisma 实例，Staff 五组固定场景通过公共应用处理，其他旧合法输入和历史记录由 Rental 的正式 `/file-application-runtime` 保持原兼容编排。根存储仅要求公共文件能力，业务回调仍接调用方的完整原事务。Staff 的原主体权威由 `RENTAL_FILE_AUTHORITY` 窄 token 提供，组合宿主在实际调用时延迟取得同一 AuthService，避免原 Auth→Platform→Rental→文件构造链回环。缺原 Auth 或文件 ACL 时拒绝受控 Staff 场景。Rental ACL 从 `@rental-os/rental-core/file-access` 消费单源业务规则。组合模块/独立宿主的 Provider、Controller、schema 和迁移由装配负责人统一维护。

存储配置停用或原位变更从 `@rental-os/platform-server/file-integration-dependencies` 复用 [只读核验](file-integration-dependencies.ts)。它使用配置已锁定的同一事务读取当前租户/提供者的文件、上传与清理原收据；active/pending/delete、freeze_pending 及非空 cleanupError 均需先迁移或处理。空 Core 目录也执行核验，查询失败向上返回，不据目录为空推断没有文件依赖。业务附件 ACL 和原配置授权仍由各自入口核定。

## 验证

本片复用原文件生命周期用例及必要定向类型检查，覆盖存储原语、元数据/原键回执、原上传/冻结、过期及完成暂存清理、拒绝与 ACL。类型和离线 fixture 证据随原专项记录收口，真实数据库、对象存储、HTTP、浏览器与完整安装继续沿原验收入口。[原生命周期用例](../../../../../tests/file-storage-lifecycle.test.cjs) · [知识文件用例](../../../../../tests/ai-native-knowledge-lane-b-file-runtime.test.cjs) · [专项接续](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)
