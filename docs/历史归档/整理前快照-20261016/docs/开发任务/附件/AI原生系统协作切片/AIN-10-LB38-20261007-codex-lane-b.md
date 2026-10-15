# AIN-10-LB38：旧引用状态与批量安全打开

## 实现

- `HumanKnowledgeService.referenceStatus` 对旧来源引用重新核对当前文档元数据、版本、撤回/解析/索引状态和当前正文授权；版本变化不会自动跳转到当前版本，历史访问保留为正式政策依赖。
- `KnowledgeCitationSession.openManySafe` 复用既有上下文成员集合和逐项重授权，返回 available/unavailable/unknown，隐藏拒绝原因和资源详情，并执行批量数量与总字节上限。

## 验证

命令：`node --test tests/ai-native-knowledge-lane-b-citations.test.cjs`，本树离线 preload/runtime、固定无效 DATABASE_URL、绝对 AI_OFFLINE_AUDIT。

结果：1 pass，0 fail，0 skip，0 todo，退出码 0。覆盖已知引用可打开、未知引用安全拒绝且不泄露标题字段。

## 未验与阻塞

没有真实浏览器/文件服务/多实例缓存环境；历史版本是否可读仍必须由正式 KnowledgeAuthorization 提供，当前门面不会以新版本替代旧引用。
