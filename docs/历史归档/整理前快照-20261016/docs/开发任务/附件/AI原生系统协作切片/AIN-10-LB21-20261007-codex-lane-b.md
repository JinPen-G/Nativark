# LB21 人类确认撤销与显式模块

PersistentMemoryConsentService.revoke({memoryId,expectedRevision})从真实当前人类会话取得主体/空间，以必需的既有MemoryAction.delete授权门检查自己的偏好。它撤回同一偏好确认，不授予新动作/权限码，也不宣称偏好已删除。按memory owner/scope/revision/confirmationRecordId条件锁定，再按confirmation scope/subject/proposalHash/revision/confirmedBy/status CAS写revoked及一致JSON。重复撤销读回原revoked证明；提交应答不明result_unknown，不推定回滚。

原StructuredMemoryService.read每次复验持久确认，因此撤销后旧confirmed JSON不能继续返回偏好；如需修改，仍通过原modify→proposed→新的明确确认。撤销不依靠本地缓存Map，也不声称存在多实例广播；其他实例通过当前DB确认读回拒绝，真实跨实例时延/隔离仍未验。

新增HumanMemoryModule.register({db,auth,credentials,authorization,clock})，显式导出PersistentMemoryConsentService，未注册AppModule/HTTP/模型工具。允许独立于尚缺文件源的文档模块使用；缺授权依赖立即拒绝。auth/credentials复用正式当前会话入口，authorization的正式记忆动作政策仍需主线交付，测试动作政策替身不计为正式装配。

定向冒烟同tests/ai-native-memory-lane-b-consent.test.cjs，红测1pass/1fail（revoke不存在）exit1；实现后2pass/0fail/cancel/skip/todo exit0；加入显式模块装配后必要复跑同2/2 exit0（7453ms）。实际模块注册、服务、身份resolver、Prisma仓储和原记忆生命周期参与，数据库/Auth执行与动作政策为明确替身。撤销→重复撤销→旧读取拒绝→修改/删除均在实际服务链执行，无静态字符串假交互。

命令node --test tests/ai-native-memory-lane-b-consent.test.cjs；固定无效DATABASE_URL、本树绝对双preload、output/lb21-audit。ts-node启用实际类型检查，本片未再扩大全API/全矩阵；LB20已记录整批当时API0诊断，后加模块/撤销不冒充同一冻结检查。diff --check退出0。

主线接入：只在人类宿主明确操作时注入本服务；propose/read/change/confirm/revoke都不接caller身份或scope。confirm证明生产与偏好确认是两个持久事务，不能称整体原子；未知后用同operationId核对，不换ID生产另一证明。revoke不是delete成功；delete仍用change(operationId,{原AiMemoryChangeDraft operation:'delete'})。请求不得由模型/automation代人发起，未来Controller必须保留此边界，当前无生产HTTP入口。

本批真实依赖阻塞：文档KnowledgeAction/偏好MemoryAction正式政策及ACL修订来源、知识document/version/attachment与FileAsset合法归属、有界bytes读取入口。现有files downloadUrl不是正文读源；不fetch签名链接、不猜read ACL字符串、不把会话成员即授权。未实现client/automation/platform/tenant scope支持、pending解析自动恢复或分布式广播。真实MySQL/文件存储/HTTP/模型/浏览器/设备未验。未读.env、启服务、执行迁移、改共享生成物、push/main/部署；未更新完成率，不宣称AIN结项。
