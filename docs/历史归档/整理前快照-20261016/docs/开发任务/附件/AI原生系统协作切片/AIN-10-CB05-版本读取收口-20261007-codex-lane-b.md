# CB-05 知识版本读取与历史比较收口

本片接续 `bf940075`，只修改 Knowledge 线，没有新增测试脚本。

提交：

- `abf67213`：`PrismaKnowledgeRepository.versions` 查询在 `AiKnowledgeVersion` relation 上绑定当前 tenant/workspace，避免仅按 documentId 先枚举后置检查。
- `c2378c63`：`compareVersions` 对左右历史 contentHash 分别执行 `read_body` 授权；当前 head 的授权不能代替历史正文授权，任一缺失时只返回元数据。
- `61de71f4`：`HumanKnowledgeService.versions(documentId, limit)` 暴露有界版本元数据（版本、contentHash、状态、chunkCount、当前版本），正文固定 unavailable；任一历史版本无法获得当前政策的元数据授权时整体拒绝，避免泄露部分版本存在性。

定向验证复用 `tests/ai-native-knowledge-lane-b-input-composition.test.cjs`：1 pass / 0 fail / 0 skip / 0 todo，退出码0；`git diff --check` 退出码0。使用本树离线 preload/runtime、无效 DATABASE_URL 和本树 AI_OFFLINE_AUDIT；数据库/政策是受控替身，不是真实 MySQL 或正式动作政策生产者。

仍未声称历史版本/正文生产装配完成：正式 KnowledgePolicySource、文件业务归属与非URL有界 bytes producer 仍由主线提供。本入口复用现有 Prisma 版本模型，不新增 schema 或历史影子存储。
