# AI 内容保留与恢复接口

这是原 AI Native 的清理适配，不是另一套业务账本或备份平台。

- `POST /api/ai-native/privacy/cleanup`：`{kind, limit?, after?}`，kind 为 task/request/knowledge/memory/material/attachment，每批最多10项。按不可变ID排序，宿主用 `nextAfter` 继续有界候选页，避免受保留或已清理的首批对象阻塞后续；不是后台循环，也不表示全空间已完成清理。真实当前 Auth、operator、`system:params:manage`、完整 workspace/data/location 范围全部必需。没有默认后台定时器。
- `receipt {id}` / `receipts {limit?, before?}`：只观察当前空间收据。批次应答不明先查收据，不能换ID重发业务动作。
- `AiRetentionService` 的普通到期材料30天，未绑定知识临时附件7天。未知步骤、进行中任务、未结预算或派发待核对会保留；审批/业务执行材料和账务收据不随普通对话清理。清理不改变业务成功、失败或财务状态。
- 知识删除/撤回和记忆删除在原 CAS 事务中写最少 tombstone。撤回立即停止当前读取；删除清理正文和重复确认正文，保留版本/hash/原操作收据。不得复活删除过的ID。
- 附件只接受原AI知识命名空间与原空间/对象绑定；检查、订单及共享 storageKey 文件拒绝清理。新上传记录服务器生成的存储位置hash。缺历史位置证据的旧附件保持 unavailable，不能用当前Bucket猜旧位置。
- 文件 DELETE 之前持久领取；应答不明只 HEAD 原对象。只有404证明不存在，403/超时/仍存在不算删除。模拟存储不算物理删除。

## 备份与恢复

`AiRetentionRestoreVerifier` 的 Ed25519 公钥hash必须由服务器固定。签名键不可来自HTTP；没有配置时恢复拒绝。由可信备份宿主调用 `exportRestoreManifest({id, sha256, createdAt}, privateKey)`，从**恢复快照以外的当前删除账本**导出完整清单（最多500项；超限拒绝，不能把分页冒充完整）。清单绑定原快照SHA256、租户/空间、期限和删除/撤回，签名后60秒内有效。

对仍隔离的目标库调用 `reapplyRestore(permit, {database, privateKey})`，重新擦除/撤回并生成范围证书；未知、越权、缺证据均不出放行证书。恢复旧库须先具备追加迁移结构，本模块不代执行迁移。

原 `scripts/ops/restore-source.cjs` 在GRANT之前校验全部恢复空间的证书、原dump摘要和准确目标库。首次导入后未满足隐私门会保留隔离库与output接续记录；重放完成后使用同一 `--file`、`--finalize-ai <接续记录>`、`--ai-retention-certificates <证书数组JSON>` 接续，**不重复导入、不覆盖旧库**。公钥来自服务器 `OPS_AI_RETENTION_PUBLIC_KEY`，不接受证书自带公钥。恢复演练同样不将缺证据当作验收通过。

`scripts/ops/ai-retention.cjs` 的 `AiOnlyBackupRetentionStore` 是可选本地AI专用副本适配：显式服务器目录/当前权限/固定公钥，AES-256-GCM加密保存，签名绑定内容hash，指定最多10个原ID清理30天到期副本。不得清理混合业务SQL备份、业务原件、外部tombstone档案、目录、链接或数据卷。混合业务备份仍需原运维保留策略，不能把AI专用适配当作所有备份已完成清理。

## 装配与替换边界

新增结构仅由追加迁移 `20261015130000_ai_data_retention` 提供；部署前按原运维审批执行，应用不自动迁移。API主装配只注册显式管理操作，不启动收集器；备份签名/目录/密钥仍须由正式运维宿主配置，不能从URL或模型输入启用。

Runtime/Provider替换继续复用此持久删除账本、当前授权和单账证据。清理不依赖SDK/框架类型，unknown不能通过换Runtime、Provider或ID重发；新Runtime的checkpoint也必须按同一内容保留及恢复门处理。本文描述代码接口，不代表真实MySQL锁、对象存储、备份或生产隐私验收已通过。
