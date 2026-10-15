# AIN-10-LB37：版本比较与确认详情

## 实现

- 为持久知识仓储增加有界版本读取，按文档、scope 和当前 head 过滤，不从当前正文反推历史版本。
- `HumanKnowledgeService.compareVersions` 返回当前/历史元数据；只有当前正文读取权限存在时才返回受权 chunk 差异，否则保持 metadata-only。
- `PersistentMemoryConsentService.confirmationDetail` 读取实际确认证明、记忆 revision、范围、操作者和期限，并校验绑定关系；不从当前偏好重建历史同意内容。
- 离线 Prisma 内容夹具补充版本读取 delegate。

## 验证

命令：`node --test tests/ai-native-knowledge-lane-b-versions.test.cjs`，使用本树 `prisma-offline-preload.cjs`、`lane-b-local-runtime.cjs`、固定无效 DATABASE_URL 和本树 AI_OFFLINE_AUDIT。

结果：2 pass，0 fail，0 skip，0 todo，退出码 0。覆盖版本修订/差异、正文权限缺失时 metadata-only、确认详情实际证明读取。

## 未验与阻塞

未连接真实 MySQL、文件服务或生产权限系统；跨实例索引/缓存传播仍需正式基础设施。历史正文无权限时只提供元数据，不能证明历史内容可访问。
