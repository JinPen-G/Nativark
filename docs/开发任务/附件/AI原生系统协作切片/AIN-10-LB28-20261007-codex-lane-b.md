# LB28 记忆宿主结果读取

原 PersistentMemoryConsentService 增加 state、changeStatus、confirmationRecovery，随现有 HumanMemoryModule 服务导出。state 在正式read授权下仅返回状态/修订/期限：撤销同意后存储状态仍confirmed，但consentStatus=revoked、usable=false；删除后storageStatus=deleted。不会返回已撤销偏好正文。

changeStatus 使用原modify/delete载荷及原operationId核对真实收据指纹，区分当前提交/后续修改；not_recorded不是回滚证明，不允许盲重试。confirmationRecovery只映射既有五种恢复状态的宿主下一步，不生产第二份确认。

定向命令（固定无效数据库URL、本树绝对审计目录、双离线preload）：`node --test tests/ai-native-memory-lane-b-preferences.test.cjs tests/ai-native-memory-lane-b-resume.test.cjs`，pass2/fail0/skip0/todo0，退出0。真实服务及Prisma仓储，数据库事务替身；包括撤销→删除、原操作载荷冲突、两次提交应答丢失恢复。

未验：真实数据库、正式Memory动作政策装配、HTTP。读取是顺序复核，不宣称跨请求原子快照。类型检查本批集中执行，不扩大回归。
