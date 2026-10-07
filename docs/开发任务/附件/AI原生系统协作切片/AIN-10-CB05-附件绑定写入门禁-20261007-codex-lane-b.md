# AIN-10 / CB05：附件绑定写入门禁

## 本片

`KnowledgeDocumentService.create` 与 `newVersion` 现在在真实持久化入口执行可选的正式 `KnowledgeFilePort.assertBound`。此前只有 `HumanKnowledgeService.prepareCreate` 做预检，直接调用创建或修订入口可能绕过业务附件归属检查；本片把门禁放到写入前的服务边界。非 workspace scope 或绑定端口拒绝时 fail closed；未提供正式绑定端口时不伪造成功，继续由主线装配。

## 验证

- 使用既有 `tests/ai-native-knowledge-lane-b-input-composition.test.cjs`，配合本树 `lane-b-local-runtime.cjs`、`prisma-offline-preload.cjs`、固定离线 `DATABASE_URL`：1 pass / 0 fail / 0 skip / 0 todo，退出码 0。
- `git diff --check`：退出码 0。

## 边界

未连接真实 FileStorage、MySQL 或 HTTP；未修改 schema/shared/Auth/Guard。正式 `KnowledgeFilePort.assertBound` 生产者及其业务归属字段仍需主线提供。
