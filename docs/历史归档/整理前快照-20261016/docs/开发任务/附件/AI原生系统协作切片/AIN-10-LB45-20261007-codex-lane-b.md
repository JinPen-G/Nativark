# AIN-10-LB45：正式授权与文件适配的显式装配

## 实现

- 新增 `composeFormalPersistedHumanKnowledge`，把当前 Auth/credentials、Knowledge/Memory server-owned action policy source 和现有 FileStorageRuntimeService 绑定到既有 HumanKnowledge composition。
- 不创建默认策略、不注册全局 AppModule、不开启 HTTP；缺 policy/file runtime 依赖时无法构造或执行，保持 fail closed。
- 复用既有文档、Memory、索引、来源和消费状态机，不复制状态或引入运行时框架。

## 验证

离线正式组合冒烟覆盖 Auth→policy→知识创建→受控文件读取→解析：1 pass，0 fail，0 skip，0 todo，退出码 0。Knowledge 目录隔离类型检查通过，退出码 0。使用本树隔离 runtime 和无效 DATABASE_URL；测试中的 file runtime 仅为离线替身，不是生产对象存储证据。

## 主线必须提供

- `FormalKnowledgePolicySource`：按 action、当前 scope/actor/audience、document/version/attachment/ACL revision 返回版本化、过期的 requiredPermissions 和不可伪造 grantKey。
- `FormalMemoryPolicySource`：按 read/propose/modify/confirm/delete 及 memory owner/scope/revision/ACL/期限返回独立政策。
- FileAsset 业务绑定生产者：将 attachment 绑定为 `ai_knowledge_document` + documentId + workspace + `ai-knowledge`，并接入已有上传/替换流程。
- 真实 `FileStorageRuntimeService` 读取依赖已实现边读限额，但真实 OSS/COS/S3 未连接验证。
