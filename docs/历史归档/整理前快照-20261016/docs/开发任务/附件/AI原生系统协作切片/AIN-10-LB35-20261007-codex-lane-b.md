# LB35 发布前材料状态

`HumanKnowledgeService.publishReadiness(documentId)`读取当前head，分别检查当前publish权限、parsed、indexed、draft/withdrawn和validity。返回checks/ready/nextStep；只观察，不改状态，不把已解析当已发布或已索引。真实publish仍走KnowledgePublicationService的原CAS和索引任务。

定向冒烟 `node --test tests/ai-native-knowledge-lane-b-publication-readiness.test.cjs`：1pass/0fail/0skip/0todo，退出0。覆盖创建→未解析、解析→未索引、publish权限拒绝和只读语义。固定无效DB、本树b5-audit、双离线preload。真实服务及Prisma替身；未验真实数据库/文件/HTTP。
