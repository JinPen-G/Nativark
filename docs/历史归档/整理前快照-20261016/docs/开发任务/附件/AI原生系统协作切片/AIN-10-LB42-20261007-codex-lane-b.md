# 第二批 Codex B（B13-B24）交接记录

## 固定提交

- `f2da0bc0`：有界版本读取/比较、受权正文差异和实际确认证明详情。
- `8bf38f9e`：旧引用状态、不自动跳转当前版本、批量引用安全打开与总字节上限。
- `dd53b112`：Memory operationRecovery，缺收据保持 unknown，复用同一 operationId 核对。
- `6c890f64`：当前人类有界元数据 lookup/精确选择入口。
- `359ba3b2`：知识、可选已确认偏好和 Core 权威业务事实的显式上下文分区。

## B13-B24 对照

- B13/B14：`compareVersions`、`referenceStatus`；历史正文无授权时只返回元数据，不把新版本当旧引用替代。
- B15/B16/B17：既有 `KnowledgeCitationSession.resolve/manifest/openMany` 加固后的 `openManySafe`；来源必须来自本次上下文集合，逐项重新授权、校验指纹、限制数量/字节，错误不泄露内部详情。
- B18：`HumanKnowledgeService.lookup`；只做有界元数据查找/用户精确选择，不做隐式全文扫描。
- B19/B20：上下文 `sections` 分区和既有 `HumanKnowledgeContextService.revalidate`/`HumanKnowledgeInputService.revalidate`；知识正文、偏好、业务事实不混淆，消费前重新授权和指纹核对。
- B21/B22/B23：`confirmationDetail`、`operationRecovery`、既有 `confirmedPreferences/selectPreferences/revalidate`；确认记录来自持久证明，恢复不新建同意，偏好每项复验 revision/期限/确认记录。
- B24：复用 `composePersistedHumanKnowledge`/`HumanKnowledgeModule.register`，实际组合冒烟已覆盖生命周期、引用、Memory 和分区。

## 实际验证

命令：Node 离线 preload + lane-local runtime，固定 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline` 和本树 `AI_OFFLINE_AUDIT`，运行 B13-B24 相关 15 个测试文件。

结果：23 pass，0 fail，0 skip，0 todo，退出码 0；`git diff --check` 退出码 0。

API `npm run lint -- --pretty false` 退出码 2，原因是当前树既有 shared dist/公共类型不同步（大量 `@rental-os/shared` 导出缺失），不是本批离线行为测试通过的替代证据；未改 shared 以绕过。

## 未验与正式依赖

- 未连接真实 MySQL、正式 KnowledgeAuthorization/MemoryAuthorization、文件存储、跨实例索引/缓存或模型 runner。
- 未证明真实分布式撤回传播、真实文件下载和浏览器/设备体验。
- 主线仍需提供正式文件业务归属、有界 bytes 读取、动作政策和 Core 业务事实端口；本线缺依赖时保持 unavailable，不自造权限或业务状态。
