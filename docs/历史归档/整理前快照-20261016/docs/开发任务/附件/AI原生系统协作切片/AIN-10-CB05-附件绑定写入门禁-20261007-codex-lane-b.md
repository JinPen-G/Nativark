# AIN-10 / CB05：附件绑定写入门禁

## 本片

`KnowledgeDocumentService.create` 与 `newVersion` 现在在真实持久化入口执行可选的正式 `KnowledgeFilePort.assertBound`。此前只有 `HumanKnowledgeService.prepareCreate` 做预检，直接调用创建或修订入口可能绕过业务附件归属检查；本片把门禁放到写入前的服务边界。非 workspace scope 或绑定端口拒绝时 fail closed；未提供正式绑定端口时不伪造成功，继续由主线装配。

## 验证

- 使用既有 `tests/ai-native-knowledge-lane-b-input-composition.test.cjs`，配合本树 `lane-b-local-runtime.cjs`、`prisma-offline-preload.cjs`、固定离线 `DATABASE_URL`：1 pass / 0 fail / 0 skip / 0 todo，退出码 0。
- `git diff --check`：退出码 0。

## 边界

未连接真实 FileStorage、MySQL 或 HTTP；未修改 schema/shared/Auth/Guard。正式 `KnowledgeFilePort.assertBound` 生产者及其业务归属字段仍需主线提供。

## 接续纠正：缺失绑定端口不再放行

早期实现的 `assertBound` 可选分支只会调用已有端口，缺端口仍放行，不能称为缺依赖拒绝。现已在 `KnowledgeDocumentService.create/newVersion` 与 `HumanKnowledgeService.prepareCreate` 中拒绝缺失绑定端口；保留元数据只读组合能力。端口类型仍可选以支持只读消费者，写入执行时必须存在。

复用原 `ai-native-knowledge-lane-b-input-composition.test.cjs` 增加一个定向负例（没有新增测试文件）：缺端口的 create/prepare/revise 必须拒绝，创建前无文档写入，修订拒绝后 revision 不变。红测 1 pass / 1 fail，退出 1；修复后连同原正式授权冒烟 3 pass / 0 fail / 0 skip / 0 todo，退出 0。Node 使用本树 runtime、offline preload、固定无效 DATABASE_URL 和本树审计/临时路径；ts-node 启用类型检查。全API类型检查未重跑，真实文件存储/数据库未验。

测试中的绑定生产者明确为合成依赖，不计入正式 FileStorage 装配。主线已说明正在交付正式政策及文件业务类型修复；本片不修改 formal authorization adapter 或 persistent composition，等待固定交付再按范围接入。
