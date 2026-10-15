# CB07 原场景文件知识接线

基线 `1e0bc932`，仅 B 树 `ai/codex-ai-native-lane-b-20261007`。主线已完成固定合并；没有重复合并、修改 A 场景/runner/Gateway 或公共模型。

## 可调用接线

`composeKnowledgeFileApplication(deps).sceneKnowledge(includePreferences)` 返回现有 `AiOriginalSceneKnowledgeOptions`，复用本次组合创建的 Knowledge 专用 `FileStorageRuntimeService`、持久精确政策及可选 Memory 仓储。必须显式传 boolean；要求偏好却未装配 Memory 时拒绝。构造和获取选项不读取存储、不上传、不派发。

`HumanKnowledgeModule.registerFiles` 导出 `KNOWLEDGE_SCENE_OPTIONS` 工厂。服务器宿主按原请求绑定真实 Auth/credentials，将 `factory(false)` 或明确请求偏好的 `factory(true)` 交给原 `composeOriginalSceneModelApplication` 的 `dependencies.knowledge`；原消费者仍在收集、冻结前及执行检查点调用既有 `collect/revalidate`。不得缓存跨会话工厂、序列化依赖对象、放到客户端 properties 或当授权令牌。

复用已有 `composeOriginalSceneKnowledge`，没有再造上下文格式。既有 `ain-scene-knowledge-1`、originalInputRef、contentHash、源版本与偏好确认绑定保持原样。知识正文是数据，偏好不替代 Core、权限、审批或预算；本片不调用模型、不登记 invocation。

## 一次功能冒烟及类型

沿用原 `ai-native-knowledge-lane-b-file-runtime.test.cjs`，不新增脚本。实际正式政策 adapter、Knowledge 文件组合、Prisma 仓储、Memory consent 与主线原场景知识消费者共同运行；Auth/DB/S3 transport 是明确离线替身，政策行也是合成测试数据，不计作真实置备授权。

- 红测：在原附件生命周期添加真实场景消费者调用，0 pass / 1 fail / 0 skip / 0 todo，退出1，缺少 `sceneKnowledge`。
- 实现后原 file-runtime + inspection-media-submission 两文件：15 pass / 0 fail / 0 skip / 0 todo，退出0。
- 补模块导出、无 Memory/非法选项及零构造读取断言后，仅复验原附件生命周期：1 pass / 0 fail / 0 skip / 0 todo，退出0。
- API TypeScript program noEmit（原 tsconfig，显式本树 shared 源码与本树 Prisma paths，禁 incremental，不输出文件）：0 diagnostics，退出0。未放宽 strict/type 检查。
- `git diff --check`：退出0。

测试统一 `node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test ...`，固定无效 `DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`，AI_OFFLINE_AUDIT/TEMP/TMP 为本树 `output/inspection-lb05-tmp` 下绝对路径。

此前合并后首次旧 client 冒烟3 pass / 1 fail，退出1，Core settingsRevision 缺类型；既有 `node scripts/ai-native-generate-local-prisma.cjs` 隔离生成退出0，`guardViolations=0/sharedArtifactsUnchanged=true`。旧生成备份和临时 output 保留，没有清理或提交。该旧类型阻塞未通过改 Core 或关闭类型检查掩盖。

## 剩余边界

主线需在实际请求组合将上述工厂结果传入已有 `knowledge` 选项；本片没有修改 A 独占组合或生产注册。正式政策管理/置备的动作许可生产者仍需主线认领，缺持久政策仍拒绝，当前身份/owner不等于授权。真实 MySQL/S3/HTTP/模型、部署及跨资源原子复验未验；读后再验不保证与派发原子一致，不声明 AIN-10/24 完成。
