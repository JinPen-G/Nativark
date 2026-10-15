# AIN-10-LB46：附件业务绑定前置校验

## 实现

- `KnowledgeFilePort` 增加可选的 `assertBound`，保持旧注入实现兼容；正式文件适配器实现该校验。
- `HumanKnowledgeService.prepareCreate` 在授权与文件能力检查后，若文件端提供绑定校验，则先确认附件属于当前文档、workspace 和 `ai-knowledge` 业务引用，再允许创建准备态。
- `FileStorageRuntimeService.assertKnowledgeBinding` 复用现有活动 FileAsset、owner 与业务引用校验；不返回路径/URL，不改变通用文件上传下载行为。
- 正式知识文件适配器将创建前绑定核验与有界 `readKnowledgeBytes` 连接到既有显式组合；缺绑定或缺正式 policy 仍拒绝，不自动建立 ACL。

## 验证

- `node --test tests/ai-native-knowledge-lane-b-formal-composition.test.cjs tests/ai-native-knowledge-lane-b-management.test.cjs`：3 pass，0 fail，0 skip，0 todo，退出码 0。
- Knowledge 目录隔离类型检查：退出码 0。
- 使用本树 `prisma-offline-preload.cjs`、`lane-b-local-runtime.cjs`、固定无效 `DATABASE_URL`；未连接真实文件服务或数据库。

## 未验与主线依赖

- 生产仍需主线提供 FileAsset 到 `ai_knowledge_document`/documentId/workspace/`ai-knowledge` 的真实绑定生产者。
- 正式 Knowledge/Memory action policy source 尚未在本线发现；缺少时组合保持 unavailable/fail closed。
- 内部 provider 的真实 OSS/COS/S3 读链、跨实例失效传播、真实 MySQL 事务未验。
