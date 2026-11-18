# 文件存储与原回执

本模块持有原公共文件字节处理、格式校验、文件元数据和上传会话持久操作。原组合运行时使用同一数据库及同一事务调用这些实现，原业务控制器继续提供当前授权。当前切片的生命周期编排入口仍在原运行时，独立公共宿主接入由后续切片沿同一状态机完成。[模块出口](index.ts) · [原编排](../../../../../apps/api/src/modules/integrations/file-storage.runtime.service.ts)

## 阅读路径

| 源码 | 职责及直接消费者 |
| --- | --- |
| [公共字节原语](file-storage-primitives.ts) | 原文件类型/大小校验、存储键、会话/资产投影、对象删除及精确限长读取；原运行时继承消费 |
| [文件仓储](file-storage.repository.ts) | 原租户内元数据查询、原幂等键/会话 ID 读取、同事务建立文件及上传会话；原运行时与 IntegrationsRepository 委托 |
| [私有存储端口](file-storage.store.ts) | 原 FileAsset 与 FileUploadSession 字段以及本片实际使用的表操作 |
| [对象存储提供者](../integrations/object-storage.provider.service.ts) | 原 S3/OSS/COS 签名、受控出站请求与连接探针 |
| [原冻结合同](../../../../platform-contracts/src/file-content-binding.ts) | 存储位置及已冻结字节指纹，原兼容入口继续消费同源合同 |
| [Rental 附件权限](../../../../rental-core/src/file-access.ts) | 当前业务对象读取 ACL、已发布商品图、客户敏感附件以及业务引用存在性 |

原 [FilesController](../../../../../apps/api/src/modules/files/files.controller.ts) 混合公共工具及实名、承运等 Rental 专用入口，各自保留原 Guard 和业务授权。原 [员工控制器](../../../../../apps/api/src/modules/files/staff-uploads.controller.ts) 继续校验场景、阶段、地点范围、本人上传和检查绑定。原 [文件 ACL 接线](../../../../../apps/api/src/modules/files/file-business-access.service.ts) 供给同一 Rental 事实仓储、报价读取和客户敏感资料参加者。

## 业务与字节边界

公共文件仓储仅保存已核定事实。`businessId`、`workspaceId`、文件 metadata 和客户端摘要不能授予业务读取或写入权限。列表候选继续由原业务 ACL 过滤，未知绑定、知识与资格资料继续按原专用入口处理。公共投影保持原字段集合，不返回存储键或公开地址。公开商品图仍由 Rental 读取真实启用工作空间、租户、已发布客户端渠道及商品媒体绑定证据。

公共字节读取保持原八秒流超时、取消、响应类型、精确声明长度、累计字节上限及最终长度核对。取消时释放 reader 和 timer。签名、网络请求和旧测试注入点沿原提供者实现。原完成编排继续计算实际字节 SHA-256，先在同事务记录唯一冻结目标再发送 PUT，恢复仅核对原目标。知识、检查、企业凭证和隐私擦除各自保持原授权及 unknown 收据。

`persistUploadFacts(tx, tenantId, facts, metadata)` 仅接调用方已经使用的原事务，先创建 `pending_upload` 文件，再以同一文件 ID 创建原上传会话。metadata 由原编排过滤客户端保留字段并补入可信操作者、空间、配置和专用证据，仓储保持原内容。`findUploadSession(tenantId, reference)` 只读取当前租户下指定原会话 ID 或原幂等键。

## 数据与装配

本片不执行 schema 或迁移。独立公共 schema 需要复用原 FileAsset 与 `file_upload_sessions` 表及 Tenant 反向关系，字段、默认、原 ID、字符串状态和历史 JSON 沿原来源核对。保留 `fileAssetId` 唯一、`file_upload_sessions_scope_idem_key`、`file_upload_sessions_scope_status_idx` 以及 FileAsset 的两个原租户索引。组合 schema 的 AI 检查证据反向关系仍由其所属模块装配。[原模型](../../../../../apps/api/prisma/schema.prisma)

正式包出口 `@rental-os/platform-server/files` 暴露本模块入口。原运行时构造参数及原 Nest provider 保持，内部仓储使用原 Prisma 实例。Rental 原 ACL 接线通过 `@rental-os/rental-core/file-access` 消费单源业务规则。组合模块/独立宿主的 Provider、Controller、schema 和迁移由装配负责人统一维护。

## 验证

本片复用原文件生命周期用例及必要定向类型检查，覆盖存储原语、元数据/原键回执、原上传/冻结、过期及完成暂存清理、拒绝与 ACL。类型和离线 fixture 证据随原专项记录收口，真实数据库、对象存储、HTTP、浏览器与完整安装继续沿原验收入口。[原生命周期用例](../../../../../tests/file-storage-lifecycle.test.cjs) · [知识文件用例](../../../../../tests/ai-native-knowledge-lane-b-file-runtime.test.cjs) · [专项接续](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)
