# AIN-10-LB44：知识附件受控正文读取入口

## 实现

- `FileStorageRuntimeService.readKnowledgeBytes` 增加知识专用内部读取入口：先查询 active FileAsset、校验业务 owner/scope 和业务对象归属，再读取 provider 对象；不返回下载 URL。
- 读取使用 provider 内部受控 GET，校验媒体类型，逐 chunk 累计并在 `maxBytes` 超限时中止/取消 reader；local_mock、停用 provider 和无业务绑定均 fail closed。
- `FileStorageKnowledgeFileAdapter` 将 Knowledge 文档 attachmentId 映射到固定的 `ai_knowledge_document`/`ai-knowledge` 业务绑定，拒绝 tenant scope、任意 URL/path 和非 workspace 上下文。
- 未改变既有上传、普通下载、订单或其他业务文件行为。

## 验证

- `node --test tests/ai-native-knowledge-lane-b-file-runtime.test.cjs`：1 pass，0 fail，0 skip，0 todo，退出码 0。
- `node --test tests/file-storage-lifecycle.test.cjs`：既有文件生命周期测试通过，退出码 0。
- API lint 的本片相关输出仅受当前共享类型产物不同步影响（`@rental-os/shared` 类型缺失）；file runtime 本身未产生额外错误。

## 精确阻塞与未验

- 当前仓库没有正式知识附件上传/绑定生产者把 FileAsset 写成 `ai_knowledge_document` + `ai-knowledge`；因此知识解析仍需显式注入本 adapter，缺绑定时拒绝。
- 未连接真实 OSS/COS/S3，未宣称真实流、取消、网络超时或对象存储验收；现有文件生命周期测试只验证离线服务行为。
